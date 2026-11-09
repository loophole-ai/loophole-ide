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
import type { LoopholeServeConfigUpdateParams, LoopholeServeConnectKeyParams, LoopholeServeConnectParams, LoopholeServeFimEvent, LoopholeServeFimParams, LoopholeServeModelInfo, LoopholeServeProviderInfo, LoopholeServeStatus } from './loopholeServeTypes.js';

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
	/** `PATCH /api/experimental/config` (Config.Patch — only `shell` is supported). */
	configUpdate: (params: LoopholeServeConfigUpdateParams) => Promise<void>;
	/** `POST /api/integration/:integrationID/connect/key` — stores a provider API key server-side. */
	connectKey: (params: LoopholeServeConnectKeyParams) => Promise<void>;
	/** Start a direct Inception FIM completion. Progress arrives via `onFimEvent`; cancel with `fimAbort`. */
	fim: (params: Omit<LoopholeServeFimParams, 'requestId'>, hooks: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void }) => string;
	/** Cancel an in-flight FIM request started with `fim`. */
	fimAbort: (requestId: string) => void;
	/** Raw channel events from the main process (currently `LoopholeServeFimEvent`s). */
	onFimEvent: Event<LoopholeServeFimEvent>;
}

export class LoopholeServeService extends Disposable implements ILoopholeServeService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel;

	// requestId -> callbacks for in-flight FIM requests (progress arrives over `onEvent_loopholeServe`)
	private readonly _fimHooks: { [requestId: string]: { onChunk?: (text: string) => void; onFinal: (text: string) => void; onError: (error: string) => void } } = {};
	private readonly _fimBuffers: { [requestId: string]: string } = {};
	private readonly _onFimEvent = new Emitter<LoopholeServeFimEvent>();

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
	}

	// Raw channel events forwarded from the main process (currently FIM progress).
	get onFimEvent(): Event<LoopholeServeFimEvent> {
		return this._onFimEvent.event;
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

	async configUpdate(params: LoopholeServeConfigUpdateParams): Promise<void> {
		await this.channel.call('configUpdate', params);
	}

	async connectKey(params: LoopholeServeConnectKeyParams): Promise<void> {
		await this.channel.call('connectKey', params);
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
}

registerSingleton(ILoopholeServeService, LoopholeServeService, InstantiationType.Eager);
