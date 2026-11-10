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
import type { LoopholeServeConfigUpdateParams, LoopholeServeConnectKeyParams, LoopholeServeConnectParams, LoopholeServeFimEvent, LoopholeServeFimParams, LoopholeServeIntegrationInfo, LoopholeServeModelInfo, LoopholeServeProviderInfo, LoopholeServeStatus, LoopholeServeVoiceWsEvent } from './loopholeServeTypes.js';
import type { LoopholeServeCommandInfo, LoopholeServePermissionDecision, LoopholeServePermissionRequest, LoopholeServeRevert, LoopholeServeSessionInfo, LoopholeServeSessionMessage, LoopholeServeSkillInfo, LoopholeServeVoiceModel, LoopholeServeVoiceTransport } from './loopholeServeTypes.js';

/** Loophole Serve (opencode) backend connection. See LOOPSERVE.md. */
export const ILoopholeServeService = createDecorator<ILoopholeServeService>('loopholeServeService');

export interface ILoopholeServeService {
	readonly _serviceBrand: undefined;
	/** Spawn/attach to the bundled `loophole serve` and wait until it responds. */
	connect: (params?: LoopholeServeConnectParams) => Promise<LoopholeServeStatus>;
	/** Stop the server process we spawned (attach-mode servers are left alone). */
	disconnect: () => Promise<void>;
	status: () => Promise<LoopholeServeStatus>;
	/** `GET /api/provider` on the running server. */
	providers: () => Promise<LoopholeServeProviderInfo[]>;
	/** `GET /api/model` on the running server. */
	models: () => Promise<LoopholeServeModelInfo[]>;
	/** `GET /api/model/default` on the running server (may be empty). */
	defaultModel: () => Promise<LoopholeServeModelInfo | null>;
	/** `GET /api/integration` — connectable integrations and their auth methods/connections. */
	integrations: () => Promise<LoopholeServeIntegrationInfo[]>;
	/** `PATCH /api/experimental/config` (Config.Patch — only `shell` is supported). */
	configUpdate: (params: LoopholeServeConfigUpdateParams) => Promise<void>;
	/** `POST /api/integration/:integrationID/connect/key` — stores a provider API key server-side. */
	connectKey: (params: LoopholeServeConnectKeyParams) => Promise<void>;
	/** `DELETE /api/credential/:credentialID` — removes a stored credential (disconnect). */
	credentialRemove: (credentialID: string) => Promise<void>;
	/** Start a direct Inception FIM completion. Progress arrives via `onFimEvent`; cancel with `fimAbort`. */
	fim: (params: Omit<LoopholeServeFimParams, 'requestId'>, hooks: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void }) => string;
	/** Cancel an in-flight FIM request started with `fim`. */
	fimAbort: (requestId: string) => void;
	/** Raw channel events from the main process (currently `LoopholeServeFimEvent`s). */
	onFimEvent: Event<LoopholeServeFimEvent>;
	/** `GET /api/session` — serve session list (newest first). */
	sessions: (opts?: { limit?: number; search?: string; archived?: boolean }) => Promise<LoopholeServeSessionInfo[]>;
	/** `GET /api/session/:id` — one session (cumulative `cost`/`tokens` + staged `revert`). */
	session: (sessionID: string) => Promise<LoopholeServeSessionInfo>;
	/** `GET /api/session/:id/message` — first page of projected messages (newest first). */
	sessionMessages: (sessionID: string, opts?: { limit?: number; order?: 'asc' | 'desc' }) => Promise<LoopholeServeSessionMessage[]>;
	/** `GET /api/session/:id/context` — active context window for history import (no pagination). */
	sessionContext: (sessionID: string) => Promise<LoopholeServeSessionMessage[]>;
	/** `POST /api/session` — create a session. */
	createSession: (payload?: Record<string, unknown>) => Promise<LoopholeServeSessionInfo>;
	/** `DELETE /api/session/:id`. */
	deleteSession: (sessionID: string) => Promise<void>;
	/** `POST /api/session/:id/fork`. */
	forkSession: (sessionID: string, before?: string) => Promise<LoopholeServeSessionInfo>;
	/** `PATCH /api/session/:id` with `{ title }`. */
	renameSession: (sessionID: string, title: string) => Promise<void>;
	/** `GET /api/command`. */
	commands: () => Promise<LoopholeServeCommandInfo[]>;
	/** `GET /api/skill`. */
	skills: () => Promise<LoopholeServeSkillInfo[]>;
	/** `POST /api/session/:id/command`. */
	runCommand: (sessionID: string, name: string, text: string) => Promise<void>;
	/** `POST /api/experimental/session/:id/skill`. */
	activateSkill: (sessionID: string, id: string, resume?: boolean) => Promise<void>;
	/** `POST /api/session/:id/revert/stage` — stage a reversible boundary (preview when `files` is false). */
	revertStage: (sessionID: string, messageID: string, files?: boolean) => Promise<LoopholeServeRevert>;
	/** `DELETE /api/session/:id/revert`. */
	revertClear: (sessionID: string) => Promise<void>;
	/** `POST /api/session/:id/revert/commit`. */
	revertCommit: (sessionID: string) => Promise<void>;
	/** `GET /api/session/:id/permission` — pending permission requests for a session. */
	permissionList: (sessionID: string) => Promise<LoopholeServePermissionRequest[]>;
	/** `POST /api/session/:id/permission/:requestID/reply`. */
	permissionReply: (sessionID: string, requestID: string, decision: LoopholeServePermissionDecision, message?: string) => Promise<void>;
	/** `GET /api/experimental/voice/models`. */
	voiceModels: () => Promise<{ models: LoopholeServeVoiceModel[]; default?: string }>;
	/** `POST /api/experimental/voice/session` — returns WebRTC SDP or WebSocket URL+ephemeral token. */
	voiceSession: (payload: { model: string; session?: Record<string, unknown>; transport: { type: string; sdp?: string; dcid?: number } }) => Promise<{ transport: LoopholeServeVoiceTransport }>;
	/** Dial the provider realtime WebSocket (main-process proxy — browsers cannot set Authorization headers). */
	voiceWsConnect: (requestId: string, url: string, token: string, provider?: string, hooks?: { onMessage?: (text: string) => void; onError?: (error: string) => void; onClose?: () => void }) => void;
	/** Send one raw text frame over a proxied voice WebSocket. */
	voiceWsSend: (requestId: string, message: string) => void;
	/** Close a proxied voice WebSocket. */
	voiceWsClose: (requestId: string) => void;
	/** Raw voice WebSocket channel events. */
	onVoiceWsEvent: Event<LoopholeServeVoiceWsEvent>;
}

export class LoopholeServeService extends Disposable implements ILoopholeServeService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel;

	// requestId -> callbacks for in-flight FIM requests (progress arrives over `onEvent_loopholeServe`)
	private readonly _fimHooks: { [requestId: string]: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void } } = {};
	private readonly _fimBuffers: { [requestId: string]: string } = {};
	private readonly _onFimEvent = new Emitter<LoopholeServeFimEvent>();

	// requestId -> callbacks for proxied voice WebSockets (provider realtime audio)
	private readonly _voiceWsHooks: { [requestId: string]: { onMessage?: (text: string) => void; onError?: (error: string) => void; onClose?: () => void } } = {};
	private readonly _onVoiceWsEvent = new Emitter<LoopholeServeVoiceWsEvent>();

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
	) {
		super();
		this.channel = this.mainProcessService.getChannel('void-channel-loopholeServe');

		this._register((this.channel.listen('onEvent_loopholeServe') satisfies Event<LoopholeServeFimEvent>)((e) => {
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
		this._register((this.channel.listen('onEvent_loopholeServe') satisfies Event<LoopholeServeVoiceWsEvent>)((e) => {
			if (!e || (e as { kind?: string }).kind !== 'voiceWs') return;
			const ve = e as LoopholeServeVoiceWsEvent;
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
	get onFimEvent(): Event<LoopholeServeFimEvent> {
		return this._onFimEvent.event;
	}

	// Raw voice WebSocket channel events forwarded from the main process.
	get onVoiceWsEvent(): Event<LoopholeServeVoiceWsEvent> {
		return this._onVoiceWsEvent.event;
	}

	async connect(params: LoopholeServeConnectParams = {}): Promise<LoopholeServeStatus> {
		return this.channel.call('connect', params);
	}

	async disconnect(): Promise<void> {
		await this.channel.call('disconnect');
	}

	async status(): Promise<LoopholeServeStatus> {
		return this.channel.call('status');
	}

	async providers(): Promise<LoopholeServeProviderInfo[]> {
		return this.channel.call('providers');
	}

	async models(): Promise<LoopholeServeModelInfo[]> {
		return this.channel.call('models');
	}

	async defaultModel(): Promise<LoopholeServeModelInfo | null> {
		return this.channel.call('defaultModel');
	}

	async integrations(): Promise<LoopholeServeIntegrationInfo[]> {
		return this.channel.call('integrations');
	}

	async configUpdate(params: LoopholeServeConfigUpdateParams): Promise<void> {
		await this.channel.call('configUpdate', params);
	}

	async connectKey(params: LoopholeServeConnectKeyParams): Promise<void> {
		await this.channel.call('connectKey', params);
	}

	async credentialRemove(credentialID: string): Promise<void> {
		await this.channel.call('credentialRemove', { credentialID });
	}

	fim(params: Omit<LoopholeServeFimParams, 'requestId'>, hooks: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void }): string {
		const requestId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
		this._fimHooks[requestId] = hooks;
		this._fimBuffers[requestId] = '';
		// fire-and-forget: progress + terminal states are delivered via `onEvent_loopholeServe`.
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

	async sessions(opts?: { limit?: number; search?: string; archived?: boolean }): Promise<LoopholeServeSessionInfo[]> {
		return this.channel.call('sessions', opts ?? {});
	}

	async session(sessionID: string): Promise<LoopholeServeSessionInfo> {
		return this.channel.call('sessionGet', { sessionID });
	}

	async sessionMessages(sessionID: string, opts?: { limit?: number; order?: 'asc' | 'desc' }): Promise<LoopholeServeSessionMessage[]> {
		return this.channel.call('sessionMessages', { sessionID, ...(opts ?? {}) });
	}

	async sessionContext(sessionID: string): Promise<LoopholeServeSessionMessage[]> {
		return this.channel.call('sessionContext', { sessionID });
	}

	async createSession(payload?: Record<string, unknown>): Promise<LoopholeServeSessionInfo> {
		return this.channel.call('sessionCreate', payload ?? {});
	}

	async deleteSession(sessionID: string): Promise<void> {
		await this.channel.call('sessionDelete', { sessionID });
	}

	async forkSession(sessionID: string, before?: string): Promise<LoopholeServeSessionInfo> {
		return this.channel.call('sessionFork', { sessionID, ...(before ? { before } : {}) });
	}

	async renameSession(sessionID: string, title: string): Promise<void> {
		await this.channel.call('sessionRename', { sessionID, title });
	}

	async commands(): Promise<LoopholeServeCommandInfo[]> {
		return this.channel.call('commands');
	}

	async skills(): Promise<LoopholeServeSkillInfo[]> {
		return this.channel.call('skills');
	}

	async runCommand(sessionID: string, name: string, text: string): Promise<void> {
		await this.channel.call('runCommand', { sessionID, name, text });
	}

	async activateSkill(sessionID: string, id: string, resume?: boolean): Promise<void> {
		await this.channel.call('activateSkill', { sessionID, id, ...(resume !== undefined ? { resume } : {}) });
	}

	async revertStage(sessionID: string, messageID: string, files?: boolean): Promise<LoopholeServeRevert> {
		return this.channel.call('revertStage', { sessionID, messageID, ...(files !== undefined ? { files } : {}) });
	}

	async revertClear(sessionID: string): Promise<void> {
		await this.channel.call('revertClear', { sessionID });
	}

	async revertCommit(sessionID: string): Promise<void> {
		await this.channel.call('revertCommit', { sessionID });
	}

	async permissionList(sessionID: string): Promise<LoopholeServePermissionRequest[]> {
		return this.channel.call('permissionList', { sessionID });
	}

	async permissionReply(sessionID: string, requestID: string, decision: LoopholeServePermissionDecision, message?: string): Promise<void> {
		await this.channel.call('permissionReply', { sessionID, requestID, decision, ...(message ? { message } : {}) });
	}

	async voiceModels(): Promise<{ models: LoopholeServeVoiceModel[]; default?: string }> {
		return this.channel.call('voiceModels');
	}

	async voiceSession(payload: { model: string; session?: Record<string, unknown>; transport: { type: string; sdp?: string; dcid?: number } }): Promise<{ transport: LoopholeServeVoiceTransport }> {
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

registerSingleton(ILoopholeServeService, LoopholeServeService, InstantiationType.Eager);
