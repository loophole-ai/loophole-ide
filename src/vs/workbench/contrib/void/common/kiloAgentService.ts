/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Renderer-side handle to the agent engine host (electron-main/kiloAgentHostChannel.ts).
// This service only forwards typed calls and events. It never sees the engine's port or
// password, and it never speaks HTTP to the engine itself - everything goes over IPC so the
// workbench CSP is not a concern.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import {
	KILO_AGENT_CHANNEL,
	KiloAgentCommand,
	KiloAgentCreateSessionParams,
	KiloAgentEvent,
	KiloAgentFileDiff,
	KiloAgentHostState,
	KiloAgentMcpRegistration,
	KiloAgentPermission,
	KiloAgentPermissionReply,
	KiloAgentPromptParams,
	KiloAgentQuestion,
	KiloAgentQuestionReply,
	KiloAgentRevertParams,
	KiloAgentSessionRef,
	KiloAgentTodo,
	KiloIndexingConfig,
	KiloProviderStatus,
	KiloIndexingStatus,
} from './kiloAgentTypes.js';

export type KiloAgentSessionInfo = { id: string; [k: string]: unknown };

export interface IKiloAgentService {
	readonly _serviceBrand: undefined;

	/** last known host state (starting / running / error ...) */
	readonly state: KiloAgentHostState;
	readonly onDidChangeState: Event<KiloAgentHostState>;
	/** every engine event, for every workspace. Filter by `directory`, or use the helper below. */
	readonly onDidReceiveEvent: Event<KiloAgentEvent>;
	onDidReceiveEventForDirectory(directory: string): Event<KiloAgentEvent>;

	/** starts the engine if it isn't running yet. Safe to call repeatedly. */
	ensureStarted(): Promise<void>;
	stop(): Promise<void>;

	createSession(params: KiloAgentCreateSessionParams): Promise<KiloAgentSessionInfo>;
	listSessions(directory: string): Promise<KiloAgentSessionInfo[]>;
	getSession(ref: KiloAgentSessionRef): Promise<unknown>;
	/** the full turn history, as `[{ info, parts }]` */
	getMessages(ref: KiloAgentSessionRef): Promise<Array<{ info: any; parts: any[] }>>;
	getTodos(ref: KiloAgentSessionRef): Promise<KiloAgentTodo[]>;
	listAgents(directory: string): Promise<unknown>;
	deleteSession(ref: KiloAgentSessionRef): Promise<void>;

	/** returns as soon as the turn is queued; the reply streams back over onDidReceiveEvent */
	prompt(params: KiloAgentPromptParams): Promise<void>;
	abort(ref: KiloAgentSessionRef): Promise<void>;

	listPendingPermissions(directory: string): Promise<KiloAgentPermission[]>;
	replyPermission(params: KiloAgentPermissionReply): Promise<void>;
	listPendingQuestions(directory: string): Promise<KiloAgentQuestion[]>;
	replyQuestion(params: KiloAgentQuestionReply): Promise<void>;
	rejectQuestion(params: { directory: string; questionID: string }): Promise<void>;

	getDiff(ref: KiloAgentSessionRef): Promise<KiloAgentFileDiff[]>;
	revert(params: KiloAgentRevertParams): Promise<void>;
	unrevert(ref: KiloAgentSessionRef): Promise<void>;

	getIndexingStatus(directory: string): Promise<KiloIndexingStatus>;
	/** Indexing is patched into the engine's global config, so `directory` is currently unused. */
	configureIndexing(directory: string | undefined, indexing: KiloIndexingConfig): Promise<void>;
	listIndexingModels(directory: string): Promise<unknown>;

	/** the engine's global config. NOTE: patching this never writes into the user's repo. */
	getConfig(): Promise<Record<string, any>>;
	patchConfig(config: Record<string, unknown>): Promise<unknown>;
	listProviders(directory?: string): Promise<unknown>;
	/**
	 * `GET /provider` -> `{connected, failed}`. This is the only trustworthy confirmation that a
	 * pushed API key actually took, because `PUT /auth/{id}` returns 200 for unknown ids.
	 */
	getProviderStatus(directory?: string): Promise<KiloProviderStatus>;
	/** stores a provider API key in the engine's own auth store (never in the repo) */
	setAuth(params: { directory?: string; providerID: string; key: string }): Promise<void>;
	removeAuth(params: { directory?: string; providerID: string }): Promise<void>;

	addMcpServer(server: KiloAgentMcpRegistration): Promise<void>;
	removeMcpServer(params: { directory?: string; name: string }): Promise<void>;
	listMcpServers(directory: string): Promise<Record<string, unknown>>;
	/** Starts the loopback MCP listener in the main process and registers it per workspace folder. */
	startIdeToolsServer(directories: string[]): Promise<void>;
	stopIdeToolsServer(): Promise<void>;
}

export const IKiloAgentService = createDecorator<IKiloAgentService>('KiloAgentService');

export class KiloAgentService extends Disposable implements IKiloAgentService {
	_serviceBrand: undefined;

	private readonly channel: IChannel;

	private _state: KiloAgentHostState = { status: 'stopped' };
	get state() { return this._state; }

	private starting: Promise<void> | undefined;

	private readonly _onDidChangeState = this._register(new Emitter<KiloAgentHostState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private readonly _onDidReceiveEvent = this._register(new Emitter<KiloAgentEvent>());
	readonly onDidReceiveEvent = this._onDidReceiveEvent.event;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		this.channel = mainProcessService.getChannel(KILO_AGENT_CHANNEL);

		this._register((this.channel.listen('onState') as Event<KiloAgentHostState>)(s => {
			this._state = s;
			this._onDidChangeState.fire(s);
		}));
		this._register((this.channel.listen('onEvent') as Event<KiloAgentEvent>)(e => this._onDidReceiveEvent.fire(e)));
	}

	onDidReceiveEventForDirectory(directory: string): Event<KiloAgentEvent> {
		return Event.filter(this.onDidReceiveEvent, e => e.directory === directory);
	}

	private call<T = void>(command: KiloAgentCommand, params?: unknown): Promise<T> {
		return this.channel.call<T>(command, params);
	}

	/**
	 * Starts the engine if it is not already up, and resolves once it is usable.
	 *
	 * Idempotent: concurrent callers share one in-flight start, and a start already under way
	 * (status "starting") is joined rather than duplicated. Without this, a settings change and
	 * a chat turn racing each other would both call 'start'.
	 */
	ensureStarted(): Promise<void> {
		if (this._state.status === 'running') return Promise.resolve();
		if (this.starting) return this.starting;
		this.starting = this.doStart().finally(() => { this.starting = undefined; });
		return this.starting;
	}

	private async doStart(): Promise<void> {
		await this.call('start');
		this._state = await this.call<KiloAgentHostState>('getState');
	}
	stop() { return this.call('stop'); }

	createSession(p: KiloAgentCreateSessionParams) { return this.call<KiloAgentSessionInfo>('createSession', p); }
	listSessions(directory: string) { return this.call<KiloAgentSessionInfo[]>('listSessions', { directory }); }
	getSession(ref: KiloAgentSessionRef) { return this.call('getSession', ref); }
	getMessages(ref: KiloAgentSessionRef) { return this.call<Array<{ info: any; parts: any[] }>>('getMessages', ref); }
	getTodos(ref: KiloAgentSessionRef) { return this.call<KiloAgentTodo[]>('getTodos', ref); }
	listAgents(directory: string) { return this.call('listAgents', { directory }); }
	deleteSession(ref: KiloAgentSessionRef) { return this.call('deleteSession', ref); }

	prompt(p: KiloAgentPromptParams) { return this.call('prompt', p); }
	abort(ref: KiloAgentSessionRef) { return this.call('abort', ref); }

	listPendingPermissions(directory: string) { return this.call<KiloAgentPermission[]>('listPendingPermissions', { directory }); }
	replyPermission(p: KiloAgentPermissionReply) { return this.call('replyPermission', p); }
	listPendingQuestions(directory: string) { return this.call<KiloAgentQuestion[]>('listPendingQuestions', { directory }); }
	replyQuestion(p: KiloAgentQuestionReply) { return this.call('replyQuestion', p); }
	rejectQuestion(p: { directory: string; questionID: string }) { return this.call('rejectQuestion', p); }

	getDiff(ref: KiloAgentSessionRef) { return this.call<KiloAgentFileDiff[]>('getDiff', ref); }
	revert(p: KiloAgentRevertParams) { return this.call('revert', p); }
	unrevert(ref: KiloAgentSessionRef) { return this.call('unrevert', ref); }

	getIndexingStatus(directory: string) { return this.call<KiloIndexingStatus>('getIndexingStatus', { directory }); }
	configureIndexing(directory: string | undefined, indexing: KiloIndexingConfig) { return this.call('configureIndexing', { directory, indexing }); }
	listIndexingModels(directory: string) { return this.call('listIndexingModels', { directory }); }

	getConfig() { return this.call<Record<string, any>>('getConfig'); }
	patchConfig(config: Record<string, unknown>) { return this.call('patchConfig', { config }); }
	listProviders(directory?: string) { return this.call('listProviders', { directory }); }
	getProviderStatus(directory?: string) { return this.call<KiloProviderStatus>('getProviderStatus', { directory }); }
	setAuth(p: { directory?: string; providerID: string; key: string }) { return this.call('setAuth', p); }
	removeAuth(p: { directory?: string; providerID: string }) { return this.call('removeAuth', p); }

	addMcpServer(server: KiloAgentMcpRegistration) { return this.call('addMcpServer', server); }
	removeMcpServer(p: { directory?: string; name: string }) { return this.call('removeMcpServer', p); }
	listMcpServers(directory: string) { return this.call<Record<string, unknown>>('listMcpServers', { directory }); }
	startIdeToolsServer(directories: string[]) { return this.call('startIdeToolsServer', { directories }); }
	stopIdeToolsServer() { return this.call('stopIdeToolsServer'); }
}

// Delayed rather than Eager: nothing here should spin up just because the module is imported.
// The engine only starts when the user actually switches an agent thread to the new backend.
registerSingleton(IKiloAgentService, KiloAgentService, InstantiationType.Delayed);
