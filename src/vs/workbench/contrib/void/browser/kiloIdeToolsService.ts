/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Implements the IDE tools the agent engine cannot answer for itself: real diagnostics for a
// file, and the persistent terminals the sidebar shows.
//
// The HTTP listener that exposes these to the engine lives in electron-main, NOT here. The
// workbench bundle is built with `platform: 'neutral'` + `packages: 'external'`, so importing
// 'http' or 'crypto' from a `browser/` file leaves them as bare specifiers in the ESM output.
// Node resolves those, which is why the bare-import check passes, but the renderer has no
// import map for Node builtins - `import()` rejects and the IDE boots to a black screen.
//
// So this file stays renderer-only and exposes a channel that the main process calls.

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IKiloAgentService } from '../common/kiloAgentService.js';
import {
	KILO_IDE_TOOLS_CHANNEL,
	LOOPHOLE_MCP_SERVER_NAME,
	McpToolResult,
} from '../common/kiloIdeToolsProtocol.js';
import { ITerminalToolService } from './terminalToolService.js';

export { KILO_IDE_TOOLS_CHANNEL, LOOPHOLE_MCP_SERVER_NAME };
export type { McpToolResult };

export interface IKiloIdeToolsService {
	readonly _serviceBrand: undefined;
	/**
	 * Asks the main process to start the MCP listener and register it with the engine for every
	 * open workspace folder. Safe to call repeatedly; resolves once the engine can reach us.
	 */
	ensureRegistered(): Promise<void>;
	stop(): Promise<void>;
}

export const IKiloIdeToolsService = createDecorator<IKiloIdeToolsService>('KiloIdeToolsService');

/**
 * The renderer end of the IDE tools bridge.
 *
 * Registered as a channel so the main process - which owns the loopback HTTP listener, because
 * the renderer cannot bind a socket - can invoke a tool over IPC. Channels are one-directional
 * per name, and this is the main -> renderer direction, so it is a channel rather than a plain
 * service.
 */
class KiloIdeToolsChannel implements IServerChannel {
	constructor(private readonly svc: KiloIdeToolsService) { }

	async call(_: unknown, command: string, params: any): Promise<any> {
		switch (command) {
			case 'callIdeTool':
				return this.svc.callIdeTool(String(params?.name ?? ''), (params?.args ?? {}) as Record<string, unknown>);
			default:
				throw new Error(`Unknown kilo ide tools command: ${command}`);
		}
	}

	listen(): never {
		throw new Error('KiloIdeToolsChannel does not emit events');
	}
}

class KiloIdeToolsService extends Disposable implements IKiloIdeToolsService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMarkerService private readonly markerService: IMarkerService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IKiloAgentService private readonly agentService: IKiloAgentService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
	) {
		super();
		// Publish the tool implementations so the main process can reach them.
		this.mainProcessService.registerChannel(KILO_IDE_TOOLS_CHANNEL, new KiloIdeToolsChannel(this));
		this._register(toDisposable(() => this.agentService.stopIdeToolsServer()));
	}

	async ensureRegistered(): Promise<void> {
		const folders = (this.workspaceContextService.getWorkspace().folders ?? []).map(f => f.uri.fsPath);
		await this.agentService.startIdeToolsServer(folders);
	}

	async stop(): Promise<void> {
		await this.agentService.stopIdeToolsServer();
	}

	/** Invoked by the main process over IPC when the engine calls a tool. */
	async callIdeTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		try {
			switch (name) {
				case `${LOOPHOLE_MCP_SERVER_NAME}_read_diagnostics`:
					return text(this.readDiagnostics(String(args.uri ?? '')));
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
					// runCommand resolves to { interrupt, resPromise }; the result is on the inner promise.
					const { resPromise } = await this.terminalToolService.runCommand(String(args.command ?? ''), { type: 'persistent', persistentTerminalId: terminalId });
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

function text(t: string): McpToolResult { return { content: [{ type: 'text', text: t }] }; }

registerSingleton(IKiloIdeToolsService, KiloIdeToolsService, InstantiationType.Delayed);