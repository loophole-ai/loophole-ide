/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// The agent engine knows how to read files, glob, grep, edit and run shell commands, but it has
// no idea what the IDE knows. This module is the contract for the small MCP server that answers
// the two things only Loophole can: real diagnostics for a file, and the persistent terminals the
// sidebar shows (which the engine's own `bash` tool cannot reach).
//
// The transport is split across the process boundary on purpose:
//
//   electron-main  runs the HTTP listener. The workbench bundle is built with
//                  `platform: 'neutral'` and `packages: 'external'` (build/next/index.ts), so a
//                  `browser/` file that imports 'http' or 'crypto' keeps those as *bare*
//                  specifiers in the ESM output. Node resolves them fine, which is why the
//                  bare-import check passes, but the renderer has no import map for Node
//                  builtins - `import()` rejects and the IDE boots to a black screen. Verified:
//                  this was the only production `browser/` file importing a Node builtin.
//
//   browser        implements the tools, because IMarkerService and ITerminalToolService only
//                  exist there. The host channel calls back into the renderer over IPC.
//
// Everything here is pure data so both sides can share it without importing each other.

/** Name this server registers under; also the prefix on every tool it exposes. */
export const LOOPHOLE_MCP_SERVER_NAME = 'loophole';

/** One JSON-RPC 2.0 request, as the engine POSTs it to us. */
export type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string; method: string; params?: any };

/** The MCP `tools/call` result shape. */
export type McpToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/**
 * The tools we advertise on `tools/list`.
 *
 * Kept as data rather than code so the exact same list is served from the main process and
 * asserted in tests, with no chance of the advertised list drifting from the implemented one.
 */
export const LOOPHOLE_MCP_TOOLS = [
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
] as const;

/** Channel name the renderer registers so the main process can invoke IDE tools. */
export const KILO_IDE_TOOLS_CHANNEL = 'kiloIdeTools';

/**
 * Answers one JSON-RPC request, given a way to reach the renderer's tool implementations.
 *
 * Pure and synchronous apart from `callTool`, so the protocol handling can be unit tested with a
 * stub and does not need a socket or Electron.
 *
 * Deliberately not a full MCP transport: the engine only ever calls `initialize`,
 * `notifications/initialized`, `tools/list` and `tools/call` against us.
 */
export function handleMcpRequest(rpc: JsonRpcRequest, callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>): Record<string, unknown> | Promise<Record<string, unknown>> {
	switch (rpc.method) {
		case 'initialize':
			return { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: LOOPHOLE_MCP_SERVER_NAME, version: '1' } } };
		case 'notifications/initialized':
			return {}; // notification, no response body expected
		case 'tools/list':
			return { result: { tools: LOOPHOLE_MCP_TOOLS } };
		case 'tools/call':
			return callTool(String(rpc.params?.name ?? ''), (rpc.params?.arguments ?? {}) as Record<string, unknown>)
				.then(result => ({ result }))
				.catch(err => ({ result: { content: [{ type: 'text', text: `Tool failed: ${String(err?.message ?? err)}` }], isError: true } }));
		default:
			return { error: { code: -32601, message: `method not found: ${rpc.method}` } };
	}
}