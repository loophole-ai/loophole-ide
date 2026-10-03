/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ChatMessage } from '../chatThreadServiceTypes.js';
import {
	EnginePart,
	engineErrorMessage,
	newProjection,
	projectEnginePart,
	projectPermissionRequest,
	projectTodos,
	toolResultText,
} from '../kiloAgentProjection.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('Kilo agent projection', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const text = (s: string, messageID = 'msg_1'): EnginePart => ({ type: 'text', text: s, messageID });
	const reasoning = (s: string, messageID = 'msg_1'): EnginePart => ({ type: 'reasoning', text: s, messageID });

	/** Narrow to the assistant variant so `.displayContent` / `.reasoning` are typed, not union-typed. */
	type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;
	type ToolMessageOf = Extract<ChatMessage, { role: 'tool' }>;

	function assistantOf(result: ReturnType<typeof projectEnginePart>): AssistantMessage {
		assert.strictEqual(result.kind, 'message', `expected a message, got ${result.kind}`);
		const msg = (result as { kind: 'message'; message: ChatMessage }).message;
		assert.strictEqual(msg.role, 'assistant', `expected an assistant message, got ${msg.role}`);
		return msg as AssistantMessage;
	}

	function toolMessageOf(result: ReturnType<typeof projectEnginePart>): ToolMessageOf {
		assert.strictEqual(result.kind, 'tool-finished', `expected tool-finished, got ${result.kind}`);
		const msg = (result as { kind: 'tool-finished'; message: ChatMessage }).message;
		assert.strictEqual(msg.role, 'tool', `expected a tool message, got ${msg.role}`);
		return msg as ToolMessageOf;
	}

	suite('text parts', () => {

		test('replaces on a full part update', () => {
			const p = newProjection();
			// The engine re-sends the whole part on every update; appending would duplicate it.
			assistantOf(projectEnginePart(p, text('Hello'), false));
			const msg = assistantOf(projectEnginePart(p, text('Hello there'), false));
			assert.strictEqual(msg.displayContent, 'Hello there');
		});

		test('appends on a delta', () => {
			const p = newProjection();
			assistantOf(projectEnginePart(p, text('Hel', 'msg_1'), true));
			const msg = assistantOf(projectEnginePart(p, text('lo', 'msg_1'), true));
			assert.strictEqual(msg.displayContent, 'Hello');
		});

		test('reads the increment from `delta` when the engine uses that field', () => {
			const p = newProjection();
			assistantOf(projectEnginePart(p, { type: 'text', delta: 'a', messageID: 'msg_1' }, true));
			const msg = assistantOf(projectEnginePart(p, { type: 'text', delta: 'b', messageID: 'msg_1' }, true));
			assert.strictEqual(msg.displayContent, 'ab');
		});

		test('keeps separate messages apart', () => {
			const p = newProjection();
			assistantOf(projectEnginePart(p, text('first', 'msg_1'), false));
			const msg = assistantOf(projectEnginePart(p, text('second', 'msg_2'), false));
			assert.strictEqual(msg.displayContent, 'second');
		});

		test('tolerates a part with no text', () => {
			const p = newProjection();
			const msg = assistantOf(projectEnginePart(p, { type: 'text', messageID: 'msg_1' }, false));
			assert.strictEqual(msg.displayContent, '');
		});

		test('always produces an assistant message shape', () => {
			const p = newProjection();
			const msg = assistantOf(projectEnginePart(p, text('hi'), false));
			assert.strictEqual(msg.role, 'assistant');
			assert.strictEqual(msg.anthropicReasoning, null);
		});
	});

	suite('reasoning parts', () => {

		test('accumulates reasoning separately from text', () => {
			const p = newProjection();
			assistantOf(projectEnginePart(p, reasoning('thinking'), false));
			const msg = assistantOf(projectEnginePart(p, reasoning('thinking more'), false));
			assert.strictEqual(msg.reasoning, 'thinking more');
			assert.strictEqual(msg.displayContent, '', 'reasoning must not clobber the visible text');
		});

		test('keeps text alongside reasoning', () => {
			const p = newProjection();
			assistantOf(projectEnginePart(p, text('answer'), false));
			const msg = assistantOf(projectEnginePart(p, reasoning('because'), false));
			assert.strictEqual(msg.displayContent, 'answer');
			assert.strictEqual(msg.reasoning, 'because');
		});

		test('appends reasoning deltas', () => {
			const p = newProjection();
			assistantOf(projectEnginePart(p, reasoning('a'), true));
			const msg = assistantOf(projectEnginePart(p, reasoning('b'), true));
			assert.strictEqual(msg.reasoning, 'ab');
		});
	});

	suite('tool parts', () => {

		const pending = (id = 'prt_1'): EnginePart => ({
			type: 'tool', id, name: 'read', state: { status: 'pending', input: { filePath: '/w/a.ts' } },
		});

		test('announces a tool start', () => {
			const p = newProjection();
			const result = projectEnginePart(p, pending(), false);
			assert.deepStrictEqual(result, { kind: 'tool-started', id: 'prt_1', name: 'read', params: { filePath: '/w/a.ts' } });
		});

		test('announces a running tool the same as pending', () => {
			const p = newProjection();
			const result = projectEnginePart(p, { ...pending(), state: { status: 'running', input: {} } }, false);
			assert.strictEqual(result.kind, 'tool-started');
		});

		test('ignores a repeated start for the same part', () => {
			// The engine re-sends pending parts on every tick; the UI should not flicker.
			const p = newProjection();
			projectEnginePart(p, pending(), false);
			assert.strictEqual(projectEnginePart(p, pending(), false).kind, 'ignored');
		});

		test('emits a success message when the tool completes', () => {
			const p = newProjection();
			const result = projectEnginePart(p, {
				type: 'tool', id: 'prt_1', name: 'read', callID: 'call_1',
				state: { status: 'completed', input: { filePath: '/w/a.ts' }, result: 'contents' },
			}, false);
			assert.strictEqual(result.kind, 'tool-finished');
			if (result.kind !== 'tool-finished') return;
			assert.strictEqual(result.id, 'call_1');
			const msg = toolMessageOf(result);
			assert.strictEqual(msg.type, 'success');
			assert.strictEqual(msg.content, 'contents');
		});

		test('emits a tool_error message when the tool fails', () => {
			const p = newProjection();
			const result = projectEnginePart(p, {
				type: 'tool', id: 'prt_1', name: 'read', callID: 'call_1',
				state: { status: 'error', input: {}, error: { data: { message: 'ENOENT' } } },
			}, false);
			assert.strictEqual(result.kind, 'tool-finished');
			if (result.kind !== 'tool-finished') return;
			const msg = toolMessageOf(result);
			assert.strictEqual(msg.type, 'tool_error');
			assert.strictEqual(msg.content, 'ENOENT');
		});

		test('falls back to the part id when there is no call id', () => {
			const p = newProjection();
			const result = projectEnginePart(p, {
				type: 'tool', id: 'prt_1', name: 'read',
				state: { status: 'completed', input: {}, result: 'x' },
			}, false);
			assert.strictEqual(result.kind, 'tool-finished');
			if (result.kind !== 'tool-finished') return;
			assert.strictEqual(result.id, 'prt_1');
		});

		test('attributes our own IDE tools to the loophole mcp server', () => {
			const p = newProjection();
			const result = projectEnginePart(p, {
				type: 'tool', id: 'prt_1', name: 'loophole_read_diagnostics', callID: 'call_1',
				state: { status: 'completed', input: {}, result: 'no problems' },
			}, false);
			assert.strictEqual(result.kind, 'tool-finished');
			if (result.kind !== 'tool-finished') return;
			assert.strictEqual(toolMessageOf(result).mcpServerName, 'loophole');
		});

		test('leaves engine tools unattributed', () => {
			const p = newProjection();
			const result = projectEnginePart(p, {
				type: 'tool', id: 'prt_1', name: 'bash', callID: 'call_1',
				state: { status: 'completed', input: {}, result: 'ok' },
			}, false);
			assert.strictEqual(result.kind, 'tool-finished');
			if (result.kind !== 'tool-finished') return;
			assert.strictEqual(toolMessageOf(result).mcpServerName, undefined);
		});

		test('treats a part with no state as pending', () => {
			const p = newProjection();
			assert.strictEqual(projectEnginePart(p, { type: 'tool', id: 'prt_1', name: 'read' }, false).kind, 'tool-started');
		});
	});

	suite('ignored part types', () => {

		for (const type of ['step-start', 'step-finish', 'file', 'snapshot', 'patch', 'retry', 'compaction', 'agent', 'subtask']) {
			test(`ignores ${type}`, () => {
				const p = newProjection();
				assert.strictEqual(projectEnginePart(p, { type }, false).kind, 'ignored');
			});
		}
	});

	suite('synthetic progress parts', () => {

		// Caught by the live smoke run: the engine injects "⠋ Initializing snapshot…" as a
		// text part while it prepares the repo, which would otherwise render as the answer.
		test('drops a synthetic text part on update', () => {
			const p = newProjection();
			const result = projectEnginePart(p, {
				type: 'text', messageID: 'msg_1', text: '⠋ Initializing snapshot…', synthetic: true,
			}, false);
			assert.strictEqual(result.kind, 'ignored');
		});

		test('drops a synthetic text part on delta', () => {
			const p = newProjection();
			assert.strictEqual(
				projectEnginePart(p, { type: 'text', messageID: 'msg_1', delta: '⠙ Initializing snapshot…', synthetic: true }, true).kind,
				'ignored',
			);
		});

		test('does not pollute the accumulated assistant text', () => {
			const p = newProjection();
			projectEnginePart(p, { type: 'text', messageID: 'msg_1', text: 'pong', synthetic: false }, false);
			projectEnginePart(p, { type: 'text', messageID: 'msg_1', text: '⠋ Initializing snapshot…', synthetic: true }, false);
			assert.strictEqual(p.textByMessage.get('msg_1'), 'pong');
		});

		test('keeps the real answer that arrives after a synthetic part', () => {
			const p = newProjection();
			projectEnginePart(p, { type: 'text', messageID: 'msg_1', text: '⠋ Initializing snapshot…', synthetic: true }, false);
			const msg = assistantOf(projectEnginePart(p, { type: 'text', messageID: 'msg_1', text: 'pong' }, false));
			assert.strictEqual(msg.displayContent, 'pong');
		});

		test('drops a synthetic reasoning part too', () => {
			const p = newProjection();
			assert.strictEqual(
				projectEnginePart(p, { type: 'reasoning', messageID: 'msg_1', text: 'working', synthetic: true }, false).kind,
				'ignored',
			);
		});

		test('treats a part with no synthetic flag as real', () => {
			const p = newProjection();
			assert.strictEqual(projectEnginePart(p, text('real answer'), false).kind, 'message');
		});
	});

	suite('toolResultText', () => {

		test('returns a string result as-is', () => {
			assert.strictEqual(toolResultText({ status: 'completed', input: {}, result: 'hello' }), 'hello');
		});

		test('joins an array of content parts', () => {
			assert.strictEqual(
				toolResultText({ status: 'completed', input: {}, content: [{ text: 'a' }, { text: 'b' }] }),
				'a\nb',
			);
		});

		test('handles a bare string in a content array', () => {
			assert.strictEqual(toolResultText({ status: 'completed', input: {}, content: ['a', 'b'] }), 'a\nb');
		});

		test('prefers the nested error message', () => {
			assert.strictEqual(toolResultText({ status: 'error', input: {}, error: { data: { message: 'nested' } } }), 'nested');
		});

		test('falls back to a flat error message', () => {
			assert.strictEqual(toolResultText({ status: 'error', input: {}, error: { message: 'flat' } }), 'flat');
		});

		test('falls back to the error name', () => {
			assert.strictEqual(toolResultText({ status: 'error', input: {}, error: { name: 'ENOENT' } }), 'ENOENT');
		});

		test('returns a generic message for an error with no detail', () => {
			assert.strictEqual(toolResultText({ status: 'error', input: {} }), 'The tool failed');
		});

		test('returns an empty string for no state', () => {
			assert.strictEqual(toolResultText(undefined), '');
		});

		test('stringifies an object result', () => {
			assert.strictEqual(toolResultText({ status: 'completed', input: {}, result: { a: 1 } }), '{"a":1}');
		});
	});

	suite('permission requests', () => {

		test('becomes the sidebar approval affordance', () => {
			const msg = projectPermissionRequest({ id: 'per_1', permission: 'bash', patterns: ['rm -rf /'] });
			assert.strictEqual(msg.role, 'tool');
			assert.strictEqual(msg.type, 'tool_request');
			assert.strictEqual(msg.result, null);
			assert.strictEqual(msg.content, 'Allow bash?');
		});

		test('prefers the tool call id so it matches the tool card', () => {
			const msg = projectPermissionRequest({ id: 'per_1', permission: 'edit', tool: { callID: 'call_9' } });
			assert.strictEqual(msg.id, 'call_9');
		});

		test('falls back to the request id', () => {
			assert.strictEqual(projectPermissionRequest({ id: 'per_1', permission: 'edit' }).id, 'per_1');
		});

		test('copes with an almost-empty request', () => {
			const msg = projectPermissionRequest({});
			assert.strictEqual(msg.type, 'tool_request');
			assert.strictEqual(msg.content, 'Allow tool?');
		});

		test('carries the patterns through for display', () => {
			const msg = projectPermissionRequest({ id: 'per_1', permission: 'write', patterns: ['/w/**'] });
			// `params` is ToolCallParams<T>, a union across every tool name; the engine picked the
	// permission id at runtime, so narrow to the shape actually produced here.
	assert.deepStrictEqual((msg.params as { patterns: string[] }).patterns, ['/w/**']);
		});
	});

	suite('todos', () => {

		test('renders the plan with a checkbox per item', () => {
			const msg = projectTodos([
				{ content: 'read the file', status: 'completed' },
				{ content: 'edit it', status: 'in_progress' },
			], 'ses_1');
			assert.strictEqual(msg.content, 'x read the file\n  edit it');
		});

		test('is keyed to the session so turns do not collide', () => {
			assert.strictEqual(projectTodos([{ content: 'x', status: 'pending' }], 'ses_7').id, 'todo-ses_7');
		});
	});

	suite('engineErrorMessage', () => {

		test('prefers the nested message', () => {
			assert.strictEqual(engineErrorMessage({ error: { data: { message: 'rate limited' } } }), 'rate limited');
		});

		test('falls back to a flat message', () => {
			assert.strictEqual(engineErrorMessage({ error: { message: 'bad request' } }), 'bad request');
		});

		test('falls back to a generic message', () => {
			assert.strictEqual(engineErrorMessage({}), 'The agent reported an error');
		});
	});
});
