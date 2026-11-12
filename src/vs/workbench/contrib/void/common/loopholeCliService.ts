/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import type { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import type { LoopholeCliConfig, LoopholeCliConfigUpdateParams, LoopholeCliConnectKeyParams, LoopholeCliConnectParams, LoopholeCliFimEvent, LoopholeCliFimParams, LoopholeCliIntegrationInfo, LoopholeCliModelInfo, LoopholeCliProviderInfo, LoopholeCliStatus, LoopholeCliVoiceWsEvent } from './loopholeCliTypes.js';
import type { LoopholeCliCommandInfo, LoopholeCliPermissionDecision, LoopholeCliPermissionRequest, LoopholeCliRevert, LoopholeCliSessionInfo, LoopholeCliSessionMessage, LoopholeCliSkillInfo, LoopholeCliUpdateInfo, LoopholeCliUpdateResult, LoopholeCliVoiceModel, LoopholeCliVoiceTransport } from './loopholeCliTypes.js';

/** Loophole CLI (opencode) backend connection. See LOOPHOLECLI.md. */
export const ILoopholeCliService = createDecorator<ILoopholeCliService>('loopholeCliService');

export interface ILoopholeCliService {
	readonly _serviceBrand: undefined;
	/** Spawn the bundled Loophole CLI and wait until its local API responds. */
	connect: (params?: LoopholeCliConnectParams) => Promise<LoopholeCliStatus>;
	/** Stop the server process we spawned (attach-mode servers are left alone). */
	disconnect: () => Promise<void>;
	status: () => Promise<LoopholeCliStatus>;
	/** Version line printed by the configured binary (`--version`). */
	version: () => Promise<string>;
	/** Compare the installed CLI with the published release. */
	updateCheck: () => Promise<LoopholeCliUpdateInfo>;
	/** Install a release and restart the CLI. */
	updateInstall: (params?: { version?: string }) => Promise<LoopholeCliUpdateResult>;
	/** `GET /api/config` on the running CLI. */
	config: () => Promise<LoopholeCliConfig>;
	/** `GET /api/provider` on the running CLI. */
	providers: () => Promise<LoopholeCliProviderInfo[]>;
	/** `GET /api/model` on the running CLI. */
	models: () => Promise<LoopholeCliModelInfo[]>;
	/** `GET /api/integration` — connectable integrations and their auth methods/connections. */
	integrations: () => Promise<LoopholeCliIntegrationInfo[]>;
	/** `PATCH /api/config` — persists Context and Commit Message settings. */
	configUpdate: (params: LoopholeCliConfigUpdateParams) => Promise<void>;
	/** `POST /api/integration/:integrationID/connect/key` — stores a provider API key server-side. */
	connectKey: (params: LoopholeCliConnectKeyParams) => Promise<void>;
	/** `DELETE /api/credential/:credentialID` — removes a stored credential (disconnect). */
	credentialRemove: (credentialID: string) => Promise<void>;
	/** Start a direct Inception FIM completion. Progress arrives via `onFimEvent`; cancel with `fimAbort`. */
	fim: (params: Omit<LoopholeCliFimParams, 'requestId'>, hooks: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void }) => string;
	/** Cancel an in-flight FIM request started with `fim`. */
	fimAbort: (requestId: string) => void;
	/** Raw channel events from the main process (currently `LoopholeCliFimEvent`s). */
	onFimEvent: Event<LoopholeCliFimEvent>;
	/** `GET /api/session` - CLI session list (newest first). */
	sessions: (opts?: { limit?: number; search?: string; archived?: boolean }) => Promise<LoopholeCliSessionInfo[]>;
	/** `GET /api/session/:id` — one session (cumulative `cost`/`tokens` + staged `revert`). */
	session: (sessionID: string) => Promise<LoopholeCliSessionInfo>;
	/** `GET /api/session/:id/message` — first page of projected messages (newest first). */
	sessionMessages: (sessionID: string, opts?: { limit?: number; order?: 'asc' | 'desc' }) => Promise<LoopholeCliSessionMessage[]>;
	/** `GET /api/session/:id/context` — active context window for history import (no pagination). */
	sessionContext: (sessionID: string) => Promise<LoopholeCliSessionMessage[]>;
	/** `POST /api/session` — create a session. */
	createSession: (payload?: Record<string, unknown>) => Promise<LoopholeCliSessionInfo>;
	/** `DELETE /api/session/:id`. */
	deleteSession: (sessionID: string) => Promise<void>;
	/** `POST /api/session/:id/fork`. */
	forkSession: (sessionID: string, before?: string) => Promise<LoopholeCliSessionInfo>;
	/** `PATCH /api/session/:id` with `{ title }`. */
	renameSession: (sessionID: string, title: string) => Promise<void>;
	/** `GET /api/command`. */
	commands: () => Promise<LoopholeCliCommandInfo[]>;
	/** `GET /api/skill`. */
	skills: () => Promise<LoopholeCliSkillInfo[]>;
	/** `POST /api/session/:id/command`. */
	runCommand: (sessionID: string, name: string, text: string) => Promise<void>;
	/** `POST /api/experimental/session/:id/skill`. */
	activateSkill: (sessionID: string, id: string, resume?: boolean) => Promise<void>;
	/** `POST /api/session/:id/revert/stage` — stage a reversible boundary (preview when `files` is false). */
	revertStage: (sessionID: string, messageID: string, files?: boolean) => Promise<LoopholeCliRevert>;
	/** `DELETE /api/session/:id/revert`. */
	revertClear: (sessionID: string) => Promise<void>;
	/** `POST /api/session/:id/revert/commit`. */
	revertCommit: (sessionID: string) => Promise<void>;
	/** `GET /api/session/:id/permission` — pending permission requests for a session. */
	permissionList: (sessionID: string) => Promise<LoopholeCliPermissionRequest[]>;
	/** `POST /api/session/:id/permission/:requestID/reply`. */
	permissionReply: (sessionID: string, requestID: string, decision: LoopholeCliPermissionDecision, message?: string) => Promise<void>;
	/** `GET /api/experimental/voice/models`. */
	voiceModels: () => Promise<{ models: LoopholeCliVoiceModel[]; default?: string }>;
	/** `POST /api/experimental/voice/session` — returns WebRTC SDP or WebSocket URL+ephemeral token. */
	voiceSession: (payload: { model: string; session?: Record<string, unknown>; transport: { type: string; sdp?: string; dcid?: number } }) => Promise<{ transport: LoopholeCliVoiceTransport }>;
	/** Dial the provider realtime WebSocket (main-process proxy — browsers cannot set Authorization headers). */
	voiceWsConnect: (requestId: string, url: string, token: string, provider?: string, hooks?: { onMessage?: (text: string) => void; onError?: (error: string) => void; onClose?: () => void }) => void;
	/** Send one raw text frame over a proxied voice WebSocket. */
	voiceWsSend: (requestId: string, message: string) => void;
	/** Close a proxied voice WebSocket. */
	voiceWsClose: (requestId: string) => void;
	/** Raw voice WebSocket channel events. */
	onVoiceWsEvent: Event<LoopholeCliVoiceWsEvent>;
}

export class LoopholeCliService extends Disposable implements ILoopholeCliService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel;

	// requestId -> callbacks for in-flight FIM requests (progress arrives over `onEvent_loopholeCli`)
	private readonly _fimHooks: { [requestId: string]: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void } } = {};
	private readonly _fimBuffers: { [requestId: string]: string } = {};
	private readonly _onFimEvent = new Emitter<LoopholeCliFimEvent>();

	// requestId -> callbacks for proxied voice WebSockets (provider realtime audio)
	private readonly _voiceWsHooks: { [requestId: string]: { onMessage?: (text: string) => void; onError?: (error: string) => void; onClose?: () => void } } = {};
	private readonly _onVoiceWsEvent = new Emitter<LoopholeCliVoiceWsEvent>();

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
	) {
		super();
		this.channel = this.mainProcessService.getChannel('void-channel-loopholeCli');

		this._register((this.channel.listen('onEvent_loopholeCli') satisfies Event<LoopholeCliFimEvent>)((e) => {
			if (!e || e.kind !== 'fim') return;
			this._onFimEvent.fire(e);
			const hooks = this._fimHooks[e.requestId];
			if (!hooks) return;
			if (e.type === 'chunk') {
				this._fimBuffers[e.requestId] = (this._fimBuffers[e.requestId] ?? '') + (e.text ?? '');
				hooks.onChunk?.(e.text ?? '');
			}
			else if (e.type === 'final') {
				const text = e.text ?? this._fimBuffers[e.requestId] ?? '';
				delete this._fimHooks[e.requestId];
				delete this._fimBuffers[e.requestId];
				hooks.onFinal(text);
			}
			else if (e.type === 'error') {
				delete this._fimHooks[e.requestId];
				delete this._fimBuffers[e.requestId];
				hooks.onError(e.error ?? 'FIM request failed.');
			}
		}));
		this._register((this.channel.listen('onEvent_loopholeCli') satisfies Event<LoopholeCliVoiceWsEvent>)((e) => {
			if (!e || (e as { kind?: string }).kind !== 'voiceWs') return;
			const ve = e as LoopholeCliVoiceWsEvent;
			this._onVoiceWsEvent.fire(ve);
			const hooks = this._voiceWsHooks[ve.requestId];
			if (!hooks) return;
			if (ve.type === 'message') hooks.onMessage?.(ve.text ?? '');
			else if (ve.type === 'error') hooks.onError?.(ve.error ?? 'Voice connection failed.');
			else if (ve.type === 'close') {
				delete this._voiceWsHooks[ve.requestId];
				hooks.onClose?.();
			}
		}));
	}

	// Raw channel events forwarded from the main process (currently FIM progress).
	get onFimEvent(): Event<LoopholeCliFimEvent> {
		return this._onFimEvent.event;
	}

	// Raw voice WebSocket channel events forwarded from the main process.
	get onVoiceWsEvent(): Event<LoopholeCliVoiceWsEvent> {
		return this._onVoiceWsEvent.event;
	}

	async connect(params: LoopholeCliConnectParams = {}): Promise<LoopholeCliStatus> {
		return this.channel.call('connect', params);
	}

	async disconnect(): Promise<void> {
		await this.channel.call('disconnect');
	}

	async status(): Promise<LoopholeCliStatus> {
		return this.channel.call('status');
	}

	async version(): Promise<string> {
		return this.channel.call('version');
	}

	async updateCheck(): Promise<LoopholeCliUpdateInfo> {
		return this.channel.call('updateCheck');
	}

	async updateInstall(params?: { version?: string }): Promise<LoopholeCliUpdateResult> {
		return this.channel.call('updateInstall', params ?? {});
	}

	async config(): Promise<LoopholeCliConfig> {
		return this.channel.call('config');
	}

	async providers(): Promise<LoopholeCliProviderInfo[]> {
		return this.channel.call('providers');
	}

	async models(): Promise<LoopholeCliModelInfo[]> {
		return this.channel.call('models');
	}

	async integrations(): Promise<LoopholeCliIntegrationInfo[]> {
		return this.channel.call('integrations');
	}

	async configUpdate(params: LoopholeCliConfigUpdateParams): Promise<void> {
		await this.channel.call('configUpdate', params);
	}

	async connectKey(params: LoopholeCliConnectKeyParams): Promise<void> {
		await this.channel.call('connectKey', params);
	}

	async credentialRemove(credentialID: string): Promise<void> {
		await this.channel.call('credentialRemove', { credentialID });
	}

	fim(params: Omit<LoopholeCliFimParams, 'requestId'>, hooks: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void }): string {
		const requestId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
		this._fimHooks[requestId] = hooks;
		this._fimBuffers[requestId] = '';
		// fire-and-forget: progress + terminal states are delivered via `onEvent_loopholeCli`.
		this.channel.call('fim', { ...params, requestId }).catch((e) => {
			const h = this._fimHooks[requestId];
			if (h) {
				delete this._fimHooks[requestId];
				delete this._fimBuffers[requestId];
				h.onError(e instanceof Error ? e.message : String(e));
			}
		});
		return requestId;
	}

	fimAbort(requestId: string): void {
		delete this._fimHooks[requestId];
		delete this._fimBuffers[requestId];
		this.channel.call('fimAbort', { requestId }).catch(() => { /* best effort */ });
	}

	// ---- sessions / messages / commands / skills / revert / permission / voice ----

	async sessions(opts?: { limit?: number; search?: string; archived?: boolean }): Promise<LoopholeCliSessionInfo[]> {
		return this.channel.call('sessions', opts ?? {});
	}

	async session(sessionID: string): Promise<LoopholeCliSessionInfo> {
		return this.channel.call('sessionGet', { sessionID });
	}

	async sessionMessages(sessionID: string, opts?: { limit?: number; order?: 'asc' | 'desc' }): Promise<LoopholeCliSessionMessage[]> {
		return this.channel.call('sessionMessages', { sessionID, ...(opts ?? {}) });
	}

	async sessionContext(sessionID: string): Promise<LoopholeCliSessionMessage[]> {
		return this.channel.call('sessionContext', { sessionID });
	}

	async createSession(payload?: Record<string, unknown>): Promise<LoopholeCliSessionInfo> {
		return this.channel.call('sessionCreate', payload ?? {});
	}

	async deleteSession(sessionID: string): Promise<void> {
		await this.channel.call('sessionDelete', { sessionID });
	}

	async forkSession(sessionID: string, before?: string): Promise<LoopholeCliSessionInfo> {
		return this.channel.call('sessionFork', { sessionID, ...(before ? { before } : {}) });
	}

	async renameSession(sessionID: string, title: string): Promise<void> {
		await this.channel.call('sessionRename', { sessionID, title });
	}

	async commands(): Promise<LoopholeCliCommandInfo[]> {
		return this.channel.call('commands');
	}

	async skills(): Promise<LoopholeCliSkillInfo[]> {
		return this.channel.call('skills');
	}

	async runCommand(sessionID: string, name: string, text: string): Promise<void> {
		await this.channel.call('runCommand', { sessionID, name, text });
	}

	async activateSkill(sessionID: string, id: string, resume?: boolean): Promise<void> {
		await this.channel.call('activateSkill', { sessionID, id, ...(resume !== undefined ? { resume } : {}) });
	}

	async revertStage(sessionID: string, messageID: string, files?: boolean): Promise<LoopholeCliRevert> {
		return this.channel.call('revertStage', { sessionID, messageID, ...(files !== undefined ? { files } : {}) });
	}

	async revertClear(sessionID: string): Promise<void> {
		await this.channel.call('revertClear', { sessionID });
	}

	async revertCommit(sessionID: string): Promise<void> {
		await this.channel.call('revertCommit', { sessionID });
	}

	async permissionList(sessionID: string): Promise<LoopholeCliPermissionRequest[]> {
		return this.channel.call('permissionList', { sessionID });
	}

	async permissionReply(sessionID: string, requestID: string, decision: LoopholeCliPermissionDecision, message?: string): Promise<void> {
		await this.channel.call('permissionReply', { sessionID, requestID, decision, ...(message ? { message } : {}) });
	}

	async voiceModels(): Promise<{ models: LoopholeCliVoiceModel[]; default?: string }> {
		return this.channel.call('voiceModels');
	}

	async voiceSession(payload: { model: string; session?: Record<string, unknown>; transport: { type: string; sdp?: string; dcid?: number } }): Promise<{ transport: LoopholeCliVoiceTransport }> {
		return this.channel.call('voiceSession', payload);
	}

	voiceWsConnect(requestId: string, url: string, token: string, provider?: string, hooks?: { onMessage?: (text: string) => void; onError?: (error: string) => void; onClose?: () => void }): void {
		this._voiceWsHooks[requestId] = hooks ?? {};
		this.channel.call('voiceWsConnect', { requestId, url, token, ...(provider ? { provider } : {}) }).catch((e) => {
			const h = this._voiceWsHooks[requestId];
			if (h) {
				delete this._voiceWsHooks[requestId];
				h.onError?.(e instanceof Error ? e.message : String(e));
			}
		});
	}

	voiceWsSend(requestId: string, message: string): void {
		this.channel.call('voiceWsSend', { requestId, message }).catch(() => { /* best effort */ });
	}

	voiceWsClose(requestId: string): void {
		delete this._voiceWsHooks[requestId];
		this.channel.call('voiceWsClose', { requestId }).catch(() => { /* best effort */ });
	}
}

registerSingleton(ILoopholeCliService, LoopholeCliService, InstantiationType.Eager);
