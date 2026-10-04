/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// The IDE-tools MCP server: the only part of Loophole that listens on a socket.
//
// This lives in the main process on purpose. The workbench bundle is built with
// `platform: 'neutral'` and `packages: 'external'` (build/next/index.ts), so a `browser/` file
// importing 'http' or 'crypto' keeps them as bare specifiers in the ESM output. Node resolves
// them - which is why the bare-import check reports "all resolvable" - but the renderer has no
// import map for Node builtins, so its `import()` rejects and the IDE boots to a black screen.
//
// The tool implementations stay in the renderer (IMarkerService, ITerminalToolService), so
// incoming `tools/call` requests are forwarded back over IPC. Nothing here interprets tool
// semantics; see common/kiloIdeToolsProtocol.ts.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import {
	handleMcpRequest,
	LOOPHOLE_MCP_SERVER_NAME,
	type JsonRpcRequest,
	type McpToolResult,
} from '../common/kiloIdeToolsProtocol.js';

/** How we reach the renderer's tool implementations. */
export type IdeToolDispatcher = (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;

export type RunningIdeToolsServer = { port: number; token: string };

/**
 * A minimal streamable-HTTP MCP endpoint: JSON-RPC 2.0 over POST, one request per call.
 * Binds to 127.0.0.1 on an OS-assigned port, guarded by a random bearer token.
 */
export class KiloIdeToolsServer extends Disposable {

	private server: Server | undefined;
	private token: string | undefined;
	private port: number | undefined;
	private starting: Promise<RunningIdeToolsServer> | undefined;

	constructor(
		private readonly getDispatcher: () => IdeToolDispatcher | undefined,
		private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void,
	) {
		super();
	}

	/** Starts the listener if needed. Concurrent calls share one bind. */
	start(): Promise<RunningIdeToolsServer> {
		if (this.port && this.token) return Promise.resolve({ port: this.port, token: this.token });
		if (this.starting) return this.starting;

		this.starting = this.doStart().finally(() => { this.starting = undefined; });
		return this.starting;
	}

	async stop(): Promise<void> {
		await new Promise<void>(resolve => {
			if (!this.server) return resolve();
			this.server.close(() => resolve());
		});
		this.server = undefined;
		this.port = undefined;
		this.token = undefined;
	}

	private doStart(): Promise<RunningIdeToolsServer> {
		const token = randomBytes(32).toString('hex');
		const server = createServer((req, res) => this.handle(req, res, token));
		this.server = server;
		this.token = token;
		this._register(toDisposable(() => void server.close()));

		return new Promise((resolve, reject) => {
			server.once('error', reject);
			// Port 0 lets the OS pick a free port; we then read back what it chose.
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				if (!addr || typeof addr === 'string') return reject(new Error('could not determine the IDE tools port'));
				this.port = addr.port;
				this.log('info', `[kilo-agent] IDE tools MCP server listening on 127.0.0.1:${addr.port}`);
				resolve({ port: addr.port, token });
			});
		});
	}

	private async handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
		// The engine is the only expected caller, but the port is reachable by anything on the
		// machine, so the token is the actual access control.
		if (req.headers.authorization !== `Bearer ${token}`) {
			res.writeHead(401).end('unauthorized');
			return;
		}
		if (req.url !== '/mcp' || req.method !== 'POST') {
			res.writeHead(404).end('not found');
			return;
		}

		const body = await readBody(req);
		let rpc: JsonRpcRequest;
		try {
			rpc = JSON.parse(body);
		} catch {
			res.writeHead(400).end('bad request');
			return;
		}

		const result = await handleMcpRequest(rpc, async (name, args) => {
			const dispatch = this.getDispatcher();
			// No renderer channel yet: answer immediately rather than let the engine hang.
			if (!dispatch) {
				return { content: [{ type: 'text', text: 'The IDE tools bridge is not available yet.' }], isError: true };
			}
			return dispatch(name, args);
		});
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
			jsonrpc: '2.0',
			...(rpc.id === undefined ? {} : { id: rpc.id }),
			...result,
		}));
	}
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = '';
		req.on('data', c => { buf += c; });
		req.on('end', () => resolve(buf));
		req.on('error', reject);
	});
}

export { LOOPHOLE_MCP_SERVER_NAME };