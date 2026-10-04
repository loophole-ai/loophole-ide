/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	handleMcpRequest,
	LOOPHOLE_MCP_SERVER_NAME,
	LOOPHOLE_MCP_TOOLS,
	type McpToolResult,
} from '../kiloIdeToolsProtocol.js';

suite('kiloIdeToolsProtocol', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const ok = (text: string): McpToolResult => ({ content: [{ type: 'text', text }] });

	function dispatcher(result: McpToolResult = ok('done')) {
		const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
		const dispatch = async (name: string, args: Record<string, unknown>) => {
			calls.push({ name, args });
			return result;
		};
		return { dispatch, calls };
	}

	suite('initialize', () => {

		test('advertises a 2024-11-05 protocol with tool capability', () => {
			const out = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, dispatcher().dispatch) as any;
			assert.strictEqual(out.result.protocolVersion, '2024-11-05');
			assert.deepStrictEqual(out.result.capabilities, { tools: {} });
		});

		test('identifies itself by the registered server name', () => {
			const out = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, dispatcher().dispatch) as any;
			assert.strictEqual(out.result.serverInfo.name, LOOPHOLE_MCP_SERVER_NAME);
		});
	});

	suite('tools/list', () => {

		test('lists the IDE tools we actually implement', () => {
			const out = handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, dispatcher().dispatch) as any;
			const names = out.result.tools.map((t: any) => t.name);
			for (const expected of [
				'read_diagnostics',
				'list_terminals',
				'run_in_terminal',
				'read_terminal',
				'kill_terminal',
			]) {
				assert.ok(
					names.includes(`${LOOPHOLE_MCP_SERVER_NAME}_${expected}`),
					`tools/list is missing ${expected}`,
				);
			}
		});

		test('every advertised tool is namespaced to this server', () => {
			// Attribution in kiloAgentProjection.ts keys off the `loophole_` prefix, so a tool
			// without it would show up as an unattributed engine tool in the sidebar.
			for (const t of LOOPHOLE_MCP_TOOLS) {
				assert.ok(t.name.startsWith(`${LOOPHOLE_MCP_SERVER_NAME}_`), t.name);
			}
		});

		test('only run_in_terminal declares a required argument', () => {
			// The terminal tools all default to terminal 1, so requiring the id would be wrong.
			for (const t of LOOPHOLE_MCP_TOOLS) {
				const required = (t.inputSchema as any).required;
				if (t.name.endsWith('run_in_terminal')) {
					assert.deepStrictEqual(required, ['command']);
				} else {
					assert.strictEqual(required, undefined, t.name);
				}
			}
		});
	});

	suite('tools/call', () => {

		test('forwards the name and arguments to the dispatcher', async () => {
			const { dispatch, calls } = dispatcher(ok('42 problems'));
			const out = await handleMcpRequest({
				jsonrpc: '2.0', id: 3, method: 'tools/call',
				params: { name: 'loophole_read_diagnostics', arguments: { uri: '/w/a.ts' } },
			}, dispatch) as any;
			assert.deepStrictEqual(calls, [{ name: 'loophole_read_diagnostics', args: { uri: '/w/a.ts' } }]);
			assert.deepStrictEqual(out.result, ok('42 problems'));
		});

		test('treats a missing arguments field as empty, not a crash', async () => {
			// The engine may omit `arguments` for a no-arg tool; that must not reject the call.
			const { dispatch, calls } = dispatcher();
			const out = await handleMcpRequest({
				jsonrpc: '2.0', id: 4, method: 'tools/call',
				params: { name: 'loophole_list_terminals' },
			}, dispatch) as any;
			assert.deepStrictEqual(calls, [{ name: 'loophole_list_terminals', args: {} }]);
			assert.ok(out.result);
		});

		test('reports a throwing tool as an error result rather than rejecting', async () => {
			// A rejected promise here would surface to the engine as a transport failure.
			const dispatch = async () => { throw new Error('terminal is gone'); };
			const out = await handleMcpRequest({
				jsonrpc: '2.0', id: 5, method: 'tools/call',
				params: { name: 'loophole_read_terminal', arguments: {} },
			}, dispatch) as any;
			assert.strictEqual(out.result.isError, true);
			assert.ok(out.result.content[0].text.includes('terminal is gone'));
		});
	});

	suite('unknown methods', () => {

		test('returns a JSON-RPC method-not-found error', () => {
			const out = handleMcpRequest({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, dispatcher().dispatch) as any;
			assert.strictEqual(out.error.code, -32601);
			assert.ok(out.error.message.includes('resources/list'));
		});

		test('does not invoke the dispatcher', () => {
			const { dispatch, calls } = dispatcher();
			handleMcpRequest({ jsonrpc: '2.0', id: 7, method: 'nope' }, dispatch);
			assert.strictEqual(calls.length, 0);
		});
	});

	suite('notifications', () => {

		test('answers notifications/initialized with an empty object', () => {
			const out = handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, dispatcher().dispatch) as any;
			assert.deepStrictEqual(out, {});
		});
	});
});