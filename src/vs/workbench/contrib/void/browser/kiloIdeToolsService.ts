/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// The agent engine knows how to read files, glob, grep, edit, and run shell commands, but it
// has no idea what the IDE knows. This exposes the two things only Loophole can answer, as a
// small MCP server the engine talks to:
//
//   read_diagnostics  - real language-server errors/warnings for a file (replaces the legacy
//                       `read_lint_errors` tool)
//   list_terminals / read_terminal / run_in_terminal / kill_terminal
//                    - the persistent terminals the sidebar shows, which the engine's `bash`
//                       tool cannot reach
//
// It runs in the renderer rather than the host channel because that is where the VS Code
// language-features and terminal APIs live. It binds to 127.0.0.1 on a random port with a
// random bearer token, and is registered with the engine over `POST /mcp` as a `remote`
// transport - verified against packages/core/src/v1/config/mcp.ts.

import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IKiloAgentService } from '../common/kiloAgentService.js';
import { ITerminalToolService } from './terminalToolService.js';

/** Name this server registers under; also the prefix on every tool it exposes. */
export const LOOPHOLE_MCP_SERVER_NAME = 'loophole';

type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string; method: string; params?: any };

export interface IKiloIdeToolsService {
	readonly _serviceBrand: undefined;
	/**
	 * Starts the local MCP server (if needed) and registers it with the engine for every open
	 * workspace folder. Safe to call repeatedly; resolves once the engine can reach us.
	 */
	ensureRegistered(): Promise<void>;
	stop(): Promise<void>;
}

export const IKiloIdeToolsService = createDecorator<IKiloIdeToolsService>('KiloIdeToolsService');

class KiloIdeToolsService extends Disposable implements IKiloIdeToolsService {
	_serviceBrand: undefined;

	private server: Server | undefined;
	private token: string | undefined;
	private port: number | undefined;
	private starting: Promise<void> | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IMarkerService private readonly markerService: IMarkerService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IKiloAgentService private readonly agentService: IKiloAgentService,
	) {
		super();
	}

	async ensureRegistered(): Promise<void> {
		if (this.starting) return this.starting;
		this.starting = this.doRegister().finally(() => { this.starting = undefined; });
		return this.starting;
	}

	async stop(): Promise<void> {
		await this.server?.close();
		this.server = undefined;
		this.port = undefined;
		this.token = undefined;
	}

	private async doRegister(): Promise<void> {
		const { port, token } = await this.startServer();
		const url = `http://127.0.0.1:${port}/mcp`;

		for (const folder of this.workspaceContextService.getWorkspace().folders ?? []) {
			try {
				await this.agentService.addMcpServer({
					directory: folder.uri.fsPath,
					name: LOOPHOLE_MCP_SERVER_NAME,
					config: { type: 'remote', url, headers: { authorization: `Bearer ${token}` }, enabled: true },
				});
			} catch (err) {
				this.logService.warn(`[kilo-agent] could not register the IDE tools server: ${String(err?.message ?? err)}`);
			}
		}
	}

	/**
	 * Minimal streamable-HTTP MCP endpoint: JSON-RPC 2.0 over POST, one request per call.
	 * Deliberately not a full MCP transport - the engine only ever calls `tools/list` and
	 * `tools/call` against us.
	 */
	private startServer(): Promise<{ port: number; token: string }> {
		if (this.port && this.token) return Promise.resolve({ port: this.port, token: this.token });

		const token = randomBytes(32).toString('hex');
		const server = createServer((req, res) => this.handle(req, res, token));
		this.server = server;
		this.token = token;
		this._register(toDisposable(() => server.close()));

		return new Promise((resolve, reject) => {
			server.once('error', reject);
			// Port 0 lets the OS pick a free port; we then read back what it chose.
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				if (!addr || typeof addr === 'string') return reject(new Error('could not determine the IDE tools port'));
				this.port = addr.port;
				resolve({ port: addr.port, token });
			});
		});
	}

	private async handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
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

		const result = await this.dispatch(rpc);
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
			jsonrpc: '2.0',
			...(rpc.id === undefined ? {} : { id: rpc.id }),
			...result,
		}));
	}

	private async dispatch(rpc: JsonRpcRequest): Promise<Record<string, unknown>> {
		switch (rpc.method) {
			case 'initialize':
				return { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: LOOPHOLE_MCP_SERVER_NAME, version: '1' } } };
			case 'notifications/initialized':
				return {}; // notification, no response body expected
			case 'tools/list':
				return { result: { tools: TOOLS } };
			case 'tools/call':
				return { result: await this.callTool(rpc.params) };
			default:
				return { error: { code: -32601, message: `method not found: ${rpc.method}` } };
		}
	}

	private async callTool(params: any): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
		const name: string = params?.name;
		const args: Record<string, any> = params?.arguments ?? {};
		try {
			switch (name) {
				case `${LOOPHOLE_MCP_SERVER_NAME}_read_diagnostics`:
					return text(this.readDiagnostics(args.uri));
				case `${LOOPHOLE_MCP_SERVER_NAME}_list_terminals`:
					return text(JSON.stringify(this.terminalToolService.listPersistentTerminalIds(), null, 2));
				case `${LOOPHOLE_MCP_SERVER_NAME}_read_terminal`:
					return text(await this.terminalToolService.readTerminal(String(args.terminalId ?? '1')));
				case `${LOOPHOLE_MCP_SERVER_NAME}_kill_terminal`:
					await this.terminalToolService.killPersistentTerminal(String(args.terminalId ?? '1'));
					return text('Terminal closed.');
				case `${LOOPHOLE_MCP_SERVER_NAME}_run_in_terminal`: {
					const cwd = this.workspaceContextService.getWorkspace().folders?.[0]?.uri.fsPath ?? null;
					const terminalId = String(args.terminalId ?? '1');
					if (!this.terminalToolService.persistentTerminalExists(terminalId)) {
						await this.terminalToolService.createPersistentTerminal({ cwd });
					}
					const { resPromise } = this.terminalToolService.runCommand(String(args.command ?? ''), { type: 'persistent', persistentTerminalId: terminalId });
					const { result } = await resPromise;
					return text(result);
				}
				default:
					return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
			}
		} catch (err) {
			return { content: [{ type: 'text', text: `Tool failed: ${String(err?.message ?? err)}` }], isError: true };
		}
	}

	/**
	 * Diagnostics for one file. Reading the marker service rather than calling language features
	 * directly means the agent sees exactly what the Problems panel shows, including
	 * diagnostics contributed by extensions.
	 */
	private readDiagnostics(uriArg: string): string {
		const uri = uriArg ? URI.file(uriArg) : this.workspaceContextService.getWorkspace().folders?.[0]?.uri;
		if (!uri) return 'No file given and no workspace folder is open.';

		const markers = this.markerService.read({ resource: uri, take: 500 });
		if (!markers.length) return `No problems reported for ${uri.fsPath}.`;

		return markers.map(marker => {
			const severity = marker.severity === MarkerSeverity.Error ? 'error'
				: marker.severity === MarkerSeverity.Warning ? 'warning'
					: marker.severity === MarkerSeverity.Info ? 'info'
						: 'hint';
			return `${marker.startLineNumber}:${marker.startColumn} ${severity} ${marker.message}`;
		}).join('\n');
	}
}

function text(t: string) { return { content: [{ type: 'text', text: t }] }; }

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = '';
		req.on('data', c => { buf += c; });
		req.on('end', () => resolve(buf));
		req.on('error', reject);
	});
}

const TOOLS = [
	{
		name: `${LOOPHOLE_MCP_SERVER_NAME}_read_diagnostics`,
		description: "Read the language server's errors and warnings for a file, as shown in the IDE's Problems panel. Use this instead of guessing whether code compiles.",
		inputSchema: { type: 'object', properties: { uri: { type: 'string', description: 'Absolute path to the file' } } },
	},
	{
		name: `${LOOPHOLE_MCP_SERVER_NAME}_list_terminals`,
		description: 'List the ids of the persistent terminals the user can see in the IDE.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: `${LOOPHOLE_MCP_SERVER_NAME}_run_in_terminal`,
		description: 'Run a shell command in a persistent terminal the user can watch. Prefer this over a detached shell when output matters, e.g. dev servers and watch mode.',
		inputSchema: {
			type: 'object',
			properties: { command: { type: 'string' }, terminalId: { type: 'string', description: 'Terminal id; defaults to the first one' } },
			required: ['command'],
		},
	},
	{
		name: `${LOOPHOLE_MCP_SERVER_NAME}_read_terminal`,
		description: 'Read the recent output of a persistent terminal.',
		inputSchema: { type: 'object', properties: { terminalId: { type: 'string' } } },
	},
	{
		name: `${LOOPHOLE_MCP_SERVER_NAME}_kill_terminal`,
		description: 'Close a persistent terminal.',
		inputSchema: { type: 'object', properties: { terminalId: { type: 'string' } } },
	},
];

registerSingleton(IKiloIdeToolsService, KiloIdeToolsService, InstantiationType.Delayed);
