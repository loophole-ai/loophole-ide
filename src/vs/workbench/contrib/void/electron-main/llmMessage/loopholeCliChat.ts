/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Phase 2: chat transport via Loophole CLI (behind `loophole.cli.enabled`).
//
// Protocol (packages/protocol):
//   POST /api/session { model?: { id, providerID }, title? } -> { data: { id, ... } }
//   POST /api/session/:sessionID/prompt { text }             (PromptInput.Prompt fields)
//   GET  /api/event  (SSE; first frame `server.connected`, then framed events)
//   POST /api/session/:sessionID/interrupt                    (abort)
//
// SSE event shapes (packages/schema/src/session-event.ts):
//   session.text.delta      { sessionID, assistantMessageID, ordinal, delta }
//   session.reasoning.delta { sessionID, assistantMessageID, ordinal, delta }
//   session.step.ended      { sessionID, assistantMessageID, finish, cost, tokens, ... }
//   session.step.failed     { sessionID, assistantMessageID, error, ... }
//   session.execution.succeeded / .failed / .interrupted (sessionID (+ error/reason))
//
// Tool UI (Phase 3 - tool cards, emitted via onTool as an ordered list):
//   session.tool.input.started/ended { sessionID, assistantMessageID, id, name | text }
//   session.tool.input.delta         { sessionID, assistantMessageID, id, delta } (ephemeral)
//   session.tool.called              { sessionID, assistantMessageID, id, input, executed }
//   session.tool.progress            { sessionID, assistantMessageID, id, metadata } (ephemeral)
//   session.tool.success             { sessionID, assistantMessageID, id, content: Content[], metadata, executed }
//   session.tool.failed              { sessionID, assistantMessageID, id, error, content?, metadata, executed }
//   session.compaction.started/delta/ended/failed -> onCompaction
// Deltas are ephemeral (live-only); .ended/.called/success/failed are the replayable full-value boundaries.
//
// Permissions + usage (emitted via onPermission / onUsage):
//   permission.asked       { sessionID, id, action, resources[], save?, metadata?, message? }
//   session.usage.updated  { sessionID, cost, tokens: { input, output, reasoning, cache } }
//
// Simplifications:
// - Void's provider-shaped message history is flattened to a single prompt text:
//   system message first, then the last user text. Tool-call history is NOT replayed;
//   the server owns the agent loop and its own session history.
// - Token usage is best-effort: only mapped when the server includes numeric fields.
// - Tool input deltas are accumulated per call id and re-emitted as the full list;
//   file (non-text) content parts are dropped, only text output is kept for cards.

import type { LLMChatMessage, OnCompaction, OnError, OnFinalMessage, OnPermission, OnCliSession, OnText, OnTool, OnUsage, CliCompactionState, CliPermissionRequest, CliToolState, CliUsage } from '../../common/sendLLMMessageTypes.js';
import type { LoopholeCliModelRef } from '../../common/loopholeCliTypes.js';
import { LOOPHOLE_CLI_TRUNCATION_MARKER, truncateLoopholeCliText } from '../../common/loopholeCliTypes.js';
import { getLoopholeCliChannel } from '../loopholeCliChannel.js';

export type LoopholeCliChatParams = {
	messages: LLMChatMessage[];
	separateSystemMessage: string | undefined;
	modelRef?: LoopholeCliModelRef | null;
	// When set, reuse this server session instead of creating one (thread binding).
	cliSessionId?: string;
	onCliSession?: OnCliSession;
	onPermission?: OnPermission;
	onUsage?: OnUsage;
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	onTool?: OnTool;
	onCompaction?: OnCompaction;
	_setAborter: (fn: () => void) => void;
};

const messageText = (message: LLMChatMessage): string => {
	const content = (message as { content?: unknown }).content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content.map((part) => {
			if (typeof part === 'string') return part;
			if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
				return (part as { text: string }).text;
			}
			if (part && typeof part === 'object' && typeof (part as { type?: unknown }).type === 'string') {
				return '';
			}
			return '';
		}).join('');
	}
	// Gemini shape uses `parts`
	const parts = (message as { parts?: unknown }).parts;
	if (Array.isArray(parts)) {
		return parts.map((part) => {
			if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
				return (part as { text: string }).text;
			}
			return '';
		}).join('');
	}
	return '';
};

const buildPromptText = (messages: LLMChatMessage[], separateSystemMessage: string | undefined): string => {
	const userTexts: string[] = [];
	for (const message of messages) {
		if ((message as { role?: string }).role === 'user') userTexts.push(messageText(message));
	}
	const lastUserText = userTexts.length > 0 ? userTexts[userTexts.length - 1] : messages.map(messageText).join('\n');
	const system = (separateSystemMessage ?? '').trim();
	return system ? `${system}\n\n${lastUserText}` : lastUserText;
};

export const sendLoopholeCliChat = async ({ messages, separateSystemMessage, modelRef, cliSessionId, onCliSession, onPermission, onUsage, onText, onFinalMessage, onError, onTool, onCompaction, _setAborter }: LoopholeCliChatParams): Promise<void> => {
	const channel = getLoopholeCliChannel();
	if (!channel) {
		onError({ message: 'Loophole CLI channel is unavailable.', fullError: null });
		return;
	}
	const connection = channel.connectionInfo();
	if (!connection) {
		onError({ message: 'Loophole CLI is not connected. Connect it in Loophole Settings (Loophole CLI).', fullError: null });
		return;
	}

	// Reuse the thread's bound session when the renderer passes one; otherwise
	// create a fresh session and report it so the thread can rebind to it.
	// (Only the new user turn is prompted — the server owns the full history.)
	let sessionID: string;
	if (cliSessionId) {
		sessionID = cliSessionId;
	} else {
		try {
			const session = await channel.cliApi<{ id: string }>('POST', '/api/session', {
				...(modelRef ? { model: { id: modelRef.modelID, providerID: modelRef.providerID } } : {}),
				title: 'Loophole',
			});
			sessionID = session.id;
		} catch (e) {
			onError({ message: `Loophole CLI: failed to create session (${e instanceof Error ? e.message : String(e)})`, fullError: null });
			return;
		}
		if (onCliSession) onCliSession({ cliSessionId: sessionID });
	}

	const text = buildPromptText(messages, separateSystemMessage);

	// SSE subscribe BEFORE sending the prompt so no deltas are missed.
	const eventController = new AbortController();
	let settled = false;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

	const fail = (message: string) => {
		if (settled) return;
		settled = true;
		onError({ message, fullError: null });
	};

	const finish = (fullText: string, fullReasoning: string, tokens?: unknown) => {
		if (settled) return;
		settled = true;
		const tokenUsage = (tokens && typeof tokens === 'object'
			&& typeof (tokens as { input?: unknown }).input === 'number'
			&& typeof (tokens as { output?: unknown }).output === 'number')
			? {
				inputTokens: (tokens as { input: number }).input,
				outputTokens: (tokens as { output: number }).output,
				totalTokens: (typeof (tokens as { total?: unknown }).total === 'number')
					? (tokens as { total: number }).total
					: (tokens as { input: number }).input + (tokens as { output: number }).output,
			} : undefined;
		onFinalMessage({ fullText, fullReasoning, anthropicReasoning: null, ...(tokenUsage ? { tokenUsage } : {}) });
	};

	_setAborter(() => {
		// abort: stop the SSE stream + ask the server to interrupt the turn
		try { reader?.cancel().catch(() => { /* best effort */ }); } catch { /* best effort */ }
		eventController.abort();
		channel.cliApi('POST', `/api/session/${encodeURIComponent(sessionID)}/interrupt`, undefined).catch(() => { /* best effort */ });
	});

	let fullText = '';
	let fullReasoning = '';

	// Tool cards + compaction snapshots, merged per tool call id and emitted as
	// one ordered list so the renderer can replace its state wholesale.
	const toolsById = new Map<string, CliToolState>();
	const emitTools = () => {
		if (onTool) onTool({ tools: [...toolsById.values()] });
	};
	const upsertTool = (id: string, patch: Partial<CliToolState>) => {
		const prev = toolsById.get(id) ?? { id, name: typeof patch.name === 'string' ? patch.name : '', status: 'input' as const };
		const next: CliToolState = { ...prev, ...patch, id };
		toolsById.set(id, next);
		emitTools();
	};
	let compaction: CliCompactionState | undefined = undefined;
	const emitCompaction = (patch: CliCompactionState) => {
		compaction = { ...(compaction ?? { phase: patch.phase }), ...patch, phase: patch.phase };
		if (onCompaction) onCompaction({ compaction });
	};

	// Tool success content is Content[] ({ type: 'text' | 'file', ... }); keep
	// the text parts, drop the rest, so the card can render a plain string.
	// Text is capped: a fetched page or file dump must not be kept whole.
	const contentText = (content: unknown): string | undefined => {
		if (!Array.isArray(content)) return undefined;
		const texts = content
			.filter((c) => !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string')
			.map((c) => (c as { text: string }).text);
		return texts.length > 0 ? truncateLoopholeCliText(texts.join('\n')) : undefined;
	};
	const errorText = (error: unknown): string | undefined => {
		if (!!error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
			return truncateLoopholeCliText((error as { message: string }).message);
		}
		return typeof error === 'string' ? truncateLoopholeCliText(error) : undefined;
	};
	// Tool metadata can carry a full unified diff (and a file path); cap every
	// string so one edit cannot blow up the webview's retained state. Patches are
	// exempt: they are how the editor reconstructs the pre-write text for the
	// accept/reject diff, so cutting one would silently disable that review.
	const PATCH_KEYS = new Set(['patch', 'diff', 'patches']);
	const capText = (text: string, key?: string) =>
		PATCH_KEYS.has(key ?? '') ? text : truncateLoopholeCliText(text);
	const metadataOf = (metadata: unknown): Record<string, unknown> | undefined => {
		if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
			if (typeof value === 'string') {
				out[key] = capText(value, key);
			}
			else if (Array.isArray(value)) {
				out[key] = value.slice(0, 50).map((item) => typeof item === 'string' ? capText(item) : item);
			}
			else if (value && typeof value === 'object') {
				const nested: Record<string, unknown> = {};
				for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
					nested[nestedKey] = typeof nestedValue === 'string' ? capText(nestedValue, nestedKey) : nestedValue;
				}
				out[key] = nested;
			}
			else {
				out[key] = value;
			}
		}
		return out;
	};

	const started = Date.now();
	const handleEvent = (evt: { type?: string; data?: Record<string, unknown> }) => {
		if (!evt || typeof evt.type !== 'string') return;
		const data = evt.data ?? {};
		// stay scoped to this turn's session
		if (typeof data.sessionID === 'string' && data.sessionID !== sessionID) return;
		if (evt.type === 'session.text.delta') {
			const delta = typeof data.delta === 'string' ? data.delta : '';
			if (delta) {
				fullText += delta;
				onText({ fullText, fullReasoning });
			}
		}
		else if (evt.type === 'session.reasoning.delta') {
			const delta = typeof data.delta === 'string' ? data.delta : '';
			if (delta) {
				fullReasoning += delta;
				onText({ fullText, fullReasoning });
			}
		}
		else if (evt.type === 'session.tool.input.started') {
			const id = typeof data.id === 'string' ? data.id : '';
			if (id) upsertTool(id, { name: typeof data.name === 'string' ? data.name : '', status: 'input', inputText: '' });
		}
		else if (evt.type === 'session.tool.input.delta') {
			const id = typeof data.id === 'string' ? data.id : '';
			const delta = typeof data.delta === 'string' ? data.delta : '';
			if (id && delta) {
				const prev = toolsById.get(id);
				// Drop our own marker before appending so repeated deltas after the
				// cap do not stack "... (truncated)" markers.
				const prevText = (prev?.inputText ?? '').replace(LOOPHOLE_CLI_TRUNCATION_MARKER, '');
				upsertTool(id, { status: 'input', inputText: truncateLoopholeCliText(`${prevText}${delta}`) });
			}
		}
		else if (evt.type === 'session.tool.input.ended') {
			const id = typeof data.id === 'string' ? data.id : '';
			const text = typeof data.text === 'string' ? data.text : '';
			if (id) upsertTool(id, { status: 'input', inputText: truncateLoopholeCliText(text) });
		}
		else if (evt.type === 'session.tool.called') {
			const id = typeof data.id === 'string' ? data.id : '';
			if (!id) return;
			const input = (data.input && typeof data.input === 'object' && !Array.isArray(data.input))
				? data.input as Record<string, unknown>
				: undefined;
			const prev = toolsById.get(id);
			upsertTool(id, { status: 'running', input, inputText: prev?.inputText });
		}
		else if (evt.type === 'session.tool.progress') {
			// Ephemeral live metadata (e.g. partial output) — merge, keep status.
			const id = typeof data.id === 'string' ? data.id : '';
			const metadata = metadataOf(data.metadata);
			if (id && metadata) {
				const prev = toolsById.get(id);
				upsertTool(id, { status: prev?.status ?? 'running', metadata: { ...(prev?.metadata ?? {}), ...metadata } });
			}
		}
		else if (evt.type === 'session.tool.success') {
			const id = typeof data.id === 'string' ? data.id : '';
			if (!id) return;
			const outputText = contentText(data.content);
			const metadata = metadataOf(data.metadata);
			upsertTool(id, { status: 'done', outputText, metadata });
		}
		else if (evt.type === 'session.tool.failed') {
			const id = typeof data.id === 'string' ? data.id : '';
			if (!id) return;
			const outputText = contentText(data.content);
			const metadata = metadataOf(data.metadata);
			upsertTool(id, { status: 'error', error: errorText(data.error), outputText, metadata });
		}
		else if (evt.type === 'session.compaction.started') {
			emitCompaction({ phase: 'started', reason: typeof data.reason === 'string' ? data.reason : undefined });
		}
		else if (evt.type === 'session.compaction.delta') {
			const text = typeof data.text === 'string' ? data.text : '';
			if (text) {
				const prevText = (compaction?.text ?? '').replace(LOOPHOLE_CLI_TRUNCATION_MARKER, '');
				emitCompaction({ phase: 'streaming', text: truncateLoopholeCliText(`${prevText}${text}`) });
			}
		}
		else if (evt.type === 'session.compaction.ended') {
			const text = typeof data.text === 'string' ? truncateLoopholeCliText(data.text) : compaction?.text;
			emitCompaction({ phase: 'done', reason: typeof data.reason === 'string' ? data.reason : compaction?.reason, text });
		}
		else if (evt.type === 'session.compaction.failed') {
			emitCompaction({ phase: 'failed', reason: typeof data.reason === 'string' ? data.reason : compaction?.reason, error: errorText(data.error) });
		}
		else if (evt.type === 'permission.asked') {
			// Server-side tool permission request (packages/schema/src/permission.ts):
			// `data` is the full Permission.Request (id + sessionID/action/resources/...).
			// The server pauses execution until the client replies via
			// POST /api/session/:id/permission/:requestID/reply (see LoopholeCliService.permissionReply).
			const id = typeof data.id === 'string' ? data.id : '';
			if (id && onPermission) {
				const permission: CliPermissionRequest = {
					id,
					sessionID: sessionID,
					action: typeof data.action === 'string' ? data.action : 'unknown',
					resources: Array.isArray(data.resources) ? data.resources.filter((r): r is string => typeof r === 'string') : [],
					...(typeof data.message === 'string' ? { message: data.message } : {}),
					...(Array.isArray(data.save) ? { save: data.save.filter((r): r is string => typeof r === 'string') } : {}),
					...(data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? { metadata: data.metadata as Record<string, unknown> } : {}),
				};
				onPermission({ permission });
			}
		}
		else if (evt.type === 'session.usage.updated') {
			// Ephemeral per-session usage (packages/schema/src/session-event.ts):
			// { sessionID, cost, tokens: { input, output, reasoning, cache: { read, write } } }.
			const tokens = (data.tokens && typeof data.tokens === 'object') ? data.tokens as Record<string, unknown> : undefined;
			const cost = typeof data.cost === 'number' ? data.cost : undefined;
			if (tokens && cost !== undefined && onUsage) {
				const num = (v: unknown): number => typeof v === 'number' ? v : 0;
				const cache = (tokens.cache && typeof tokens.cache === 'object') ? tokens.cache as Record<string, unknown> : {};
				const usage: CliUsage = {
					cost,
					tokens: {
						input: num(tokens.input),
						output: num(tokens.output),
						reasoning: num(tokens.reasoning),
						cache: { read: num(cache.read), write: num(cache.write) },
					},
				};
				onUsage({ usage });
			}
		}
		else if (evt.type === 'session.step.ended' || evt.type === 'session.execution.succeeded') {
			const evtTokens = evt.type === 'session.step.ended' ? data.tokens : undefined;
			finish(fullText, fullReasoning, evtTokens);
		}
		else if (evt.type === 'session.step.failed' || evt.type === 'session.execution.failed') {
			const err = data.error as { message?: unknown } | undefined;
			if (err && typeof err.message === 'string') fail(err.message);
			else fail(`Loophole CLI: generation failed (${evt.type}).`);
		}
		else if (evt.type === 'session.execution.interrupted') {
			// abortRef already swallowed the abort; treat as a plain stop without an error
			if (!settled) {
				settled = true;
				onFinalMessage({ fullText, fullReasoning, anthropicReasoning: null });
			}
		}
	};

	const consumeStream = async () => {
		try {
			const response = await fetch(`http://127.0.0.1:${connection.port}/api/event`, {
				headers: { Authorization: 'Basic ' + Buffer.from(`loophole:${connection.password}`, 'utf8').toString('base64') },
				signal: eventController.signal,
			});
			if (!response.ok || !response.body) {
				fail(`Loophole CLI: event stream failed (${response.status}).`);
				return;
			}
			reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				if (settled) break;
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.startsWith('data:')) continue;
					const payload = line.slice(5).trim();
					if (!payload) continue;
					try {
						handleEvent(JSON.parse(payload));
					} catch { /* malformed frame: ignore */ }
					if (settled) break;
				}
			}
			if (!settled) fail('Loophole CLI: event stream ended before completion.');
		} catch (e) {
			if (!settled && !eventController.signal.aborted) {
				fail(`Loophole CLI: event stream error (${e instanceof Error ? e.message : String(e)})`);
			}
		}
	};

	// fire the stream consumer, then send the prompt once the stream is (likely) up
	const streamPromise = consumeStream();
	// small head-start so the server has the subscription before the prompt is admitted
	await new Promise((resolve) => setTimeout(resolve, 100));
	if (settled) return;
	try {
		await channel.cliApi('POST', `/api/session/${encodeURIComponent(sessionID)}/prompt`, { text });
	} catch (e) {
		fail(`Loophole CLI: failed to send prompt (${e instanceof Error ? e.message : String(e)})`);
		return;
	}
	// guard: no completion 5 minutes after the prompt (same spirit as AUTOCOMPLETE TIMEOUT_TIME, longer for chat)
	setTimeout(() => {
		if (!settled) fail(`Loophole CLI: timed out after ${Math.round((Date.now() - started) / 1000)}s without a completion event.`);
	}, 5 * 60 * 1000);
	await streamPromise;
};
