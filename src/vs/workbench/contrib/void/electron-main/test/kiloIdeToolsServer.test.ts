/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as http from 'http';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { McpToolResult } from '../../common/kiloIdeToolsProtocol.js';
import { KiloIdeToolsServer, type IdeToolDispatcher } from '../kiloIdeToolsServer.js';

suite('KiloIdeToolsServer', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let server: KiloIdeToolsServer | undefined;
	let port: number;
	let token: string;
	let dispatched: Array<{ name: string; args: Record<string, unknown> }>;
	let dispatcherResult: McpToolResult;

	function start(getDispatcher?: () => IdeToolDispatcher | undefined) {
		dispatched = [];
		dispatcherResult = { content: [{ type: 'text', text: 'ok' }] };
		server = disposables.add(new KiloIdeToolsServer(
			getDispatcher ?? (() => async (name: string, args: Record<string, unknown>) => {
				dispatched.push({ name, args });
				return dispatcherResult;
			}),
			() => { },
		));
		return server.start();
	}

	function post(body: unknown, opts: { path?: string; method?: string; auth?: string } = {}): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			const req = http.request({
				host: '127.0.0.1',
				port,
				path: opts.path ?? '/mcp',
				method: opts.method ?? 'POST',
				headers: {
					'content-type': 'application/json',
					...(opts.auth === undefined ? { authorization: `Bearer ${token}` } : { authorization: opts.auth }),
				},
			}, res => {
				let buf = '';
				res.on('data', c => { buf += c; });
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
			});
			req.on('error', reject);
			req.end(typeof body === 'string' ? body : JSON.stringify(body));
		});
	}

	async function rpc(method: string, params?: unknown, id: number = 1) {
		const res = await post({ jsonrpc: '2.0', id, method, params });
		return { status: res.status, json: res.body ? JSON.parse(res.body) : undefined };
	}

	setup(async () => {
		const started = await start();
		port = started.port;
		token = started.token;
	});

	teardown(async () => {
		await server?.stop();
		server = undefined;
	});

	suite('lifecycle', () => {

		test('binds an OS-assigned port on loopback', async () => {
			assert.ok(port > 0, `expected a real port, got ${port}`);
		});

		test('returns the same port when started twice', async () => {
			const again = await server!.start();
			assert.strictEqual(again.port, port);
			assert.strictEqual(again.token, token);
		});

		test('shares one bind across concurrent starts', async () => {
			const [a, b] = await Promise.all([server!.start(), server!.start()]);
			assert.strictEqual(a.port, b.port);
		});

		test('stop releases the port and start rebinds a new one', async () => {
			await server!.stop();
			const restarted = await server!.start();
			assert.ok(restarted.port > 0);
			assert.notStrictEqual(restarted.token, token, 'a fresh token must be issued');
			port = restarted.port;
			token = restarted.token;
		});
	});

	suite('authorization', () => {

		test('rejects a request with no token', async () => {
			const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { auth: '' });
			assert.strictEqual(res.status, 401);
		});

		test('rejects a wrong token', async () => {
			const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { auth: 'Bearer nope' });
			assert.strictEqual(res.status, 401);
		});

		test('rejects a token that is a prefix of the real one', async () => {
			const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { auth: `Bearer ${token.slice(0, 8)}` });
			assert.strictEqual(res.status, 401);
		});

		test('never dispatches a tool for an unauthorized caller', async () => {
			await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'loophole_list_terminals' } }, { auth: 'Bearer wrong' });
			assert.strictEqual(dispatched.length, 0);
		});
	});

	suite('routing', () => {

		test('404s an unknown path', async () => {
			const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { path: '/nope' });
			assert.strictEqual(res.status, 404);
		});

		test('404s a GET even on the right path', async () => {
			const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { method: 'GET' });
			assert.strictEqual(res.status, 404);
		});

		test('400s a malformed JSON body', async () => {
			const res = await post('{not json');
			assert.strictEqual(res.status, 400);
		});

		test('400s an empty body', async () => {
			const res = await post('');
			assert.strictEqual(res.status, 400);
		});
	});

	suite('protocol', () => {

		test('echoes the request id back', async () => {
			const { json } = await rpc('tools/list', undefined, 4242);
			assert.strictEqual(json.id, 4242);
		});

		test('omits id for a notification', async () => {
			const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
			assert.strictEqual(JSON.parse(res.body).id, undefined);
		});

		test('handles a large body without truncating arguments', async () => {
			const big = 'x'.repeat(200_000);
			await rpc('tools/call', { name: 'loophole_read_terminal', arguments: { terminalId: big } });
			assert.strictEqual(dispatched[0].args.terminalId.length, 200_000);
		});
	});

	suite('dispatch', () => {

		test('forwards the tool name and arguments', async () => {
			await rpc('tools/call', { name: 'loophole_read_diagnostics', arguments: { uri: '/w/a.ts' } });
			assert.deepStrictEqual(dispatched, [{ name: 'loophole_read_diagnostics', args: { uri: '/w/a.ts' } }]);
		});

		test('returns the dispatcher result verbatim', async () => {
			dispatcherResult = { content: [{ type: 'text', text: 'boom' }], isError: true };
			const { json } = await rpc('tools/call', { name: 'loophole_run_in_terminal', arguments: { command: 'ls' } });
			assert.deepStrictEqual(json.result, dispatcherResult);
		});

		test('a throwing dispatcher becomes an isError result, not a 500', async () => {
			await server!.stop();
			server = disposables.add(new KiloIdeToolsServer(
				() => async () => { throw new Error('terminal gone'); },
				() => { },
			));
			({ port, token } = await server!.start());
			const { status, json } = await rpc('tools/call', { name: 'loophole_read_terminal', arguments: {} });
			assert.strictEqual(status, 200);
			assert.strictEqual(json.result.isError, true);
		});

		test('answers with an error when the renderer channel is absent', async () => {
			await server!.stop();
			server = disposables.add(new KiloIdeToolsServer(() => undefined, () => { }));
			({ port, token } = await server!.start());
			const { status, json } = await rpc('tools/call', { name: 'loophole_list_terminals', arguments: {} });
			assert.strictEqual(status, 200, 'must answer promptly rather than hang the engine');
			assert.strictEqual(json.result.isError, true);
		});
	});
});