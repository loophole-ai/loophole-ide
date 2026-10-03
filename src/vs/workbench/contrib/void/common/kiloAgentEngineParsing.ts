/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// The parts of talking to the agent engine that are pure data handling, pulled out of the
// electron-main host channel so they can be unit tested without spawning a process or an
// Electron instance. Nothing here imports anything outside `common`, and none of it performs
// I/O.
//
// The two shapes and the security-relevant merge are the two places this code is easiest to
// get subtly wrong, so both are covered by tests in `common/test/kiloAgentEngineParsing.test.ts`.

import { KiloAgentEvent } from './kiloAgentTypes.js';

/**
 * Splits a server-sent-events buffer into complete frames.
 *
 * The spec separator is a blank line, and encoders differ on whether that is `\n\n` or
 * `\r\n\r\n`, so both are accepted. A trailing partial frame is returned as `rest` for the
 * caller to prepend to the next chunk - getting this wrong drops or duplicates events at
 * chunk boundaries.
 */
export function splitEngineEventFrames(buffer: string): { frames: string[]; rest: string } {
	const frames: string[] = [];
	let rest = buffer;
	for (; ;) {
		const match = /\r?\n\r?\n/.exec(rest);
		if (!match) break;
		const frame = rest.slice(0, match.index);
		rest = rest.slice(match.index + match[0].length);
		if (frame.length) frames.push(frame);
	}
	return { frames, rest };
}

/**
 * Event types the renderer has no use for. They are still well-formed and harmless, but they
 * arrive in bulk and forwarding them over IPC is pure noise.
 *
 * - `server.heartbeat` - one every 10s, transport keep-alive.
 * - `sync` - the engine's sync envelope, emitted around most state changes. A live run produced
 *   ~20 of them for a single one-line prompt.
 * - `server.connected` - the opening handshake frame.
 */
const IGNORED_EVENT_TYPES = new Set(['server.heartbeat', 'sync', 'server.connected']);

/**
 * Turns one raw SSE frame into a normalized event, or undefined if it should be ignored.
 *
 * Three things the engine does that this absorbs:
 *  - the newer event bus uses `data` where the legacy bus used `properties`; the renderer only
 *    ever sees `properties`
 *  - `sync` envelopes and `server.heartbeat`s, which are transport noise rather than events
 *  - the `sync` envelope carries no `type` at all, so it drops out naturally anyway
 *
 * The first frame after connecting is `server.connected` and carries no `directory`.
 */
export function normalizeEngineEvent(rawJson: string): KiloAgentEvent | undefined {
	const json = JSON.parse(rawJson); // throws on malformed frames; callers decide what to do
	const payload = json?.payload ?? json;
	if (!payload?.type) return undefined;
	if (IGNORED_EVENT_TYPES.has(payload.type)) return undefined;
	return {
		id: payload.id,
		directory: json.directory ?? 'global',
		type: payload.type,
		properties: payload.properties ?? payload.data ?? {},
	};
}

/** Pulls the `data:` lines out of one SSE frame and joins them, as the spec requires. */
export function engineFrameData(frame: string): string | undefined {
	const dataLines = frame
		.split('\n')
		.filter(l => l.startsWith('data:'))
		.map(l => l.slice(5).trimStart());
	if (!dataLines.length) return undefined;
	return dataLines.join('\n');
}

/**
 * Reads the port out of the engine's startup line, e.g.
 *   "kilo server listening on http://127.0.0.1:52341"
 * Returns undefined for anything else, including partial output.
 */
export function parseEnginePort(stdout: string): number | undefined {
	const match = stdout.match(/kilo server listening on http:\/\/[^:\s]+:(\d+)/);
	if (!match) return undefined;
	const port = Number(match[1]);
	return Number.isInteger(port) && port > 0 ? port : undefined;
}

/**
 * Merges caller-supplied engine config over the locked-down baseline.
 *
 * Two guarantees:
 *  - `disabled_providers` is a union. A caller can add a provider to the block list but can
 *    never remove `kilo`.
 *  - `kilo` is stripped from `enabled_providers` even if a caller supplies it. That list is the
 *    hard allowlist, so leaving `kilo` in it would defeat the block above.
 */
export function mergeEngineConfig(
	baseline: Record<string, unknown>,
	extra?: Record<string, unknown>,
): Record<string, unknown> & { disabled_providers: string[] } {
	const base = (baseline['disabled_providers'] as string[] | undefined) ?? [];
	const add = (extra?.['disabled_providers'] as string[] | undefined) ?? [];
	const disabled_providers = [...new Set([...base, ...add])];
	const merged: Record<string, unknown> & { disabled_providers: string[] } = {
		...baseline,
		...(extra ?? {}),
		disabled_providers,
	};
	// Never let the allowlist re-admit the one provider Loophole refuses to use.
	if (Array.isArray(merged['enabled_providers'])) {
		merged['enabled_providers'] = (merged['enabled_providers'] as string[]).filter(id => id !== 'kilo');
	}
	return merged;
}
