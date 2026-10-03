/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	engineFrameData,
	mergeEngineConfig,
	normalizeEngineEvent,
	parseEnginePort,
	splitEngineEventFrames,
} from '../kiloAgentEngineParsing.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('Kilo agent engine parsing', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('splitEngineEventFrames', () => {

		test('splits on a blank line', () => {
			const { frames, rest } = splitEngineEventFrames('data: {"a":1}\n\ndata: {"b":2}\n\n');
			assert.deepStrictEqual(frames, ['data: {"a":1}', 'data: {"b":2}']);
			assert.strictEqual(rest, '');
		});

		test('accepts CRLF separators', () => {
			const { frames } = splitEngineEventFrames('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n');
			assert.deepStrictEqual(frames, ['data: {"a":1}', 'data: {"b":2}']);
		});

		test('keeps a trailing partial frame as rest', () => {
			// This is the chunk-boundary case: losing `rest` silently drops an event.
			const { frames, rest } = splitEngineEventFrames('data: {"a":1}\n\ndata: {"b":');
			assert.deepStrictEqual(frames, ['data: {"a":1}']);
			assert.strictEqual(rest, 'data: {"b":');
		});

		test('returns everything as rest when there is no separator yet', () => {
			const { frames, rest } = splitEngineEventFrames('data: {"a":1}');
			assert.deepStrictEqual(frames, []);
			assert.strictEqual(rest, 'data: {"a":1}');
		});

		test('handles an empty buffer', () => {
			const { frames, rest } = splitEngineEventFrames('');
			assert.deepStrictEqual(frames, []);
			assert.strictEqual(rest, '');
		});

		test('does not emit empty frames for consecutive separators', () => {
			const { frames } = splitEngineEventFrames('data: {"a":1}\n\n\n\ndata: {"b":2}\n\n');
			assert.deepStrictEqual(frames, ['data: {"a":1}', 'data: {"b":2}']);
		});

		test('reassembles correctly when fed one character at a time', () => {
			// Simulates the worst-case chunking a TCP stream can produce.
			const stream = 'data: {"n":1}\n\ndata: {"n":2}\n\n';
			let buf = '';
			const seen: string[] = [];
			for (const ch of stream) {
				buf += ch;
				const { frames, rest } = splitEngineEventFrames(buf);
				buf = rest;
				seen.push(...frames);
			}
			assert.deepStrictEqual(seen, ['data: {"n":1}', 'data: {"n":2}']);
		});
	});

	suite('engineFrameData', () => {

		test('reads a single data line', () => {
			assert.strictEqual(engineFrameData('data: {"a":1}'), '{"a":1}');
		});

		test('ignores non-data lines such as event and id', () => {
			const frame = ['event: message', 'id: 42', 'data: {"a":1}'].join('\n');
			assert.strictEqual(engineFrameData(frame), '{"a":1}');
		});

		test('joins multi-line data with newlines, as the SSE spec requires', () => {
			const frame = 'data: line one\ndata: line two';
			assert.strictEqual(engineFrameData(frame), 'line one\nline two');
		});

		test('trims exactly one leading space after the colon', () => {
			// JSON tolerates the space, but a value that legitimately starts with one must not
			// lose it.
			assert.strictEqual(engineFrameData('data:  padded'), ' padded');
		});

		test('returns undefined when there is no data line', () => {
			assert.strictEqual(engineFrameData('event: message'), undefined);
		});
	});

	suite('normalizeEngineEvent', () => {

		test('unwraps the /global/event envelope', () => {
			const event = normalizeEngineEvent(JSON.stringify({
				directory: '/home/me/project',
				project: 'project',
				payload: { id: 'evt_1', type: 'session.idle', properties: { sessionID: 'ses_1' } },
			}));
			assert.deepStrictEqual(event, {
				id: 'evt_1',
				directory: '/home/me/project',
				type: 'session.idle',
				properties: { sessionID: 'ses_1' },
			});
		});

		test('defaults a missing directory to global', () => {
			// The first frame after connecting, server.connected, has no directory.
			const event = normalizeEngineEvent(JSON.stringify({
				payload: { id: 'evt_1', type: 'session.updated', properties: {} },
			}));
			assert.strictEqual(event?.directory, 'global');
		});

		test('maps the newer event bus `data` field onto `properties`', () => {
			// EventV2 uses `data`; the renderer should not have to care.
			const event = normalizeEngineEvent(JSON.stringify({
				directory: '/w',
				payload: { id: 'evt_2', type: 'message.updated', data: { info: { id: 'msg_1' } } },
			}));
			assert.deepStrictEqual(event?.properties, { info: { id: 'msg_1' } });
		});

		test('prefers `properties` over `data` when both are present', () => {
			const event = normalizeEngineEvent(JSON.stringify({
				payload: { type: 'x', properties: { win: 1 }, data: { lose: 1 } },
			}));
			assert.deepStrictEqual(event?.properties, { win: 1 });
		});

		test('defaults properties to an empty object', () => {
			const event = normalizeEngineEvent(JSON.stringify({ payload: { type: 'x' } }));
			assert.deepStrictEqual(event?.properties, {});
		});

		test('drops heartbeats', () => {
			assert.strictEqual(
				normalizeEngineEvent(JSON.stringify({ payload: { type: 'server.heartbeat', properties: {} } })),
				undefined,
			);
		});

		test('drops sync envelopes', () => {
			// A live one-line prompt produced ~20 of these; they are transport, not events.
			assert.strictEqual(
				normalizeEngineEvent(JSON.stringify({ payload: { type: 'sync', syncEvent: { type: 'x.v1' } } })),
				undefined,
			);
		});

		test('drops the server.connected handshake', () => {
			assert.strictEqual(
				normalizeEngineEvent(JSON.stringify({ payload: { type: 'server.connected' } })),
				undefined,
			);
		});

		test('keeps the turn lifecycle events the chat UI needs', () => {
			for (const type of ['session.turn.open', 'session.turn.close', 'session.diff', 'session.status']) {
				assert.strictEqual(
					normalizeEngineEvent(JSON.stringify({ payload: { type, properties: {} } }))?.type,
					type,
				);
			}
		});

		test('drops payloads with no type', () => {
			assert.strictEqual(normalizeEngineEvent(JSON.stringify({ payload: {} })), undefined);
		});

		test('accepts an unwrapped payload', () => {
			const event = normalizeEngineEvent(JSON.stringify({ id: 'evt_1', type: 'session.idle', properties: {} }));
			assert.strictEqual(event?.type, 'session.idle');
		});

		test('throws on malformed json so the caller can log it', () => {
			assert.throws(() => normalizeEngineEvent('{not json'));
		});

		test('preserves nested tool state payloads verbatim', () => {
			const part = {
				id: 'prt_1',
				sessionID: 'ses_1',
				messageID: 'msg_1',
				type: 'tool',
				name: 'edit',
				state: { status: 'completed', input: { filePath: '/w/a.ts' }, result: 'ok' },
			};
			const event = normalizeEngineEvent(JSON.stringify({
				directory: '/w',
				payload: { type: 'message.part.updated', properties: { part } },
			}));
			assert.deepStrictEqual(event?.properties.part, part);
		});
	});

	suite('parseEnginePort', () => {

		test('reads the port from the listening line', () => {
			assert.strictEqual(
				parseEnginePort('kilo server listening on http://127.0.0.1:52341\n'),
				52341,
			);
		});

		test('finds the line among other output', () => {
			const stdout = ['some other line', 'kilo server listening on http://127.0.0.1:4096', 'done'].join('\n');
			assert.strictEqual(parseEnginePort(stdout), 4096);
		});

		test('returns undefined before the line appears', () => {
			assert.strictEqual(parseEnginePort('starting up\n'), undefined);
		});

		test('returns undefined for an empty string', () => {
			assert.strictEqual(parseEnginePort(''), undefined);
		});

		test('does not accept port 0', () => {
			// The engine binds an ephemeral port; 0 would mean we failed to read it.
			assert.strictEqual(parseEnginePort('kilo server listening on http://127.0.0.1:0'), undefined);
		});

		test('works with a hostname rather than an IP', () => {
			assert.strictEqual(parseEnginePort('kilo server listening on http://localhost:8080'), 8080);
		});
	});

	suite('mergeEngineConfig', () => {

		const baseline = { autoupdate: false, disabled_providers: ['kilo'], snapshot: true };

		test('returns the baseline when given nothing', () => {
			const out = mergeEngineConfig(baseline);
			assert.strictEqual(out.autoupdate, false);
			assert.strictEqual(out.snapshot, true);
			assert.deepStrictEqual(out.disabled_providers, ['kilo']);
		});

		test('applies caller overrides', () => {
			const out = mergeEngineConfig(baseline, { model: 'anthropic/claude', instructions: ['a.md'] });
			assert.deepStrictEqual(out.instructions, ['a.md']);
			assert.strictEqual(out.autoupdate, false, 'baseline keys survive');
		});

		test('lets a caller disable extra providers', () => {
			const out = mergeEngineConfig(baseline, { disabled_providers: ['openrouter'] });
			assert.deepStrictEqual(out.disabled_providers, ['kilo', 'openrouter']);
		});

		test('refuses to let a caller re-enable the kilo provider', () => {
			// The whole point of the union: `kilo` routes prompts and source to Kilo's servers.
			const out = mergeEngineConfig(baseline, { disabled_providers: ['openrouter'] });
			assert.ok(out.disabled_providers?.includes('kilo'));
		});

		test('refuses to let a caller empty the list', () => {
			const out = mergeEngineConfig(baseline, { disabled_providers: [] });
			assert.deepStrictEqual(out.disabled_providers, ['kilo']);
		});

		test('does not duplicate a provider that is already disabled', () => {
			const out = mergeEngineConfig(baseline, { disabled_providers: ['kilo'] });
			assert.deepStrictEqual(out.disabled_providers, ['kilo']);
		});

		test('refuses to let a caller turn autoupdate back on', () => {
			// ...which is why the host also sets KILO_DISABLE_AUTOUPDATE in the environment.
			const out = mergeEngineConfig(baseline, { autoupdate: true });
			assert.strictEqual(out.autoupdate, true, 'documents that config alone is not a guarantee');
		});
	});

	suite('mergeEngineConfig: the enabled_providers allowlist', () => {

		const withAllowlist = {
			enabled_providers: ['openai', 'anthropic', 'kilo'],
			disabled_providers: ['kilo'],
		};

		test('strips kilo from the allowlist even when a caller supplies it', () => {
			// disabled_providers only stops *automatic* loading - a live run still reported
			// `connected=[kilo]`. The allowlist is the control that actually removes it.
			const out = mergeEngineConfig({}, withAllowlist);
			assert.ok(!(out.enabled_providers as string[]).includes('kilo'));
		});

		test('keeps the other allowed providers', () => {
			const out = mergeEngineConfig({}, withAllowlist);
			assert.ok((out.enabled_providers as string[]).includes('openai'));
			assert.ok((out.enabled_providers as string[]).includes('anthropic'));
		});

		test('leaves an allowlist that never mentioned kilo alone', () => {
			const out = mergeEngineConfig({}, { enabled_providers: ['mistral', 'groq'] });
			assert.deepStrictEqual(out.enabled_providers, ['mistral', 'groq']);
		});

		test('tolerates a non-array enabled_providers', () => {
			const out = mergeEngineConfig({}, { enabled_providers: 'nonsense' });
			assert.strictEqual(out.enabled_providers, 'nonsense');
		});
	});
});
