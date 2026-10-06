/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Keeps the agent engine's own configuration in step with Loophole's settings.
//
// The engine has no idea the user's provider keys or indexing preferences exist, so this pushes
// them across whenever they change. Two things this deliberately does NOT do:
//
//  - write into the user's repository. Indexing and credentials are per-user, so they go to the
//    engine's global config and auth store, both under Loophole's userDataPath.
//  - send the `kilo` provider. It is disabled permanently at launch; the only hosted gateway
//    Loophole will ever offer is our own "Loophole Pass", added as a custom provider.
//
// The translation itself lives in kiloAgentEngineMapping.ts, which is pure and unit tested.

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { buildIndexingConfig, classifyConnection, collectEngineCredentials, providerBaseUrlConfig } from './kiloAgentEngineMapping.js';
import { IKiloAgentService } from './kiloAgentService.js';
import { KiloProviderSyncResult } from './kiloAgentTypes.js';
import { IVoidSettingsService, VoidSettingsState } from './voidSettingsService.js';

export interface IKiloAgentConfigSync {
	readonly _serviceBrand: undefined;
	/** Push current Loophole settings into the engine. Safe to call repeatedly. */
	sync(): Promise<KiloProviderSyncResult>;
	/** The outcome of the last sync, for the settings UI to surface per-provider errors. */
	readonly lastResult: KiloProviderSyncResult | undefined;
	readonly onDidSync: Event<KiloProviderSyncResult>;
}

export const IKiloAgentConfigSync = createDecorator<IKiloAgentConfigSync>('KiloAgentConfigSync');

const EMPTY: KiloProviderSyncResult = { providers: [] };

export class KiloAgentConfigSync extends Disposable implements IKiloAgentConfigSync {
	_serviceBrand: undefined;

	private readonly disposables = this._register(new DisposableStore());
	private syncing: Promise<KiloProviderSyncResult> | undefined;
	private _lastResult: KiloProviderSyncResult | undefined = EMPTY;
	private readonly _onDidSync = this._register(new Emitter<KiloProviderSyncResult>());
	readonly onDidSync = this._onDidSync.event;

	get lastResult() { return this._lastResult; }

	constructor(
		@ILogService private readonly logService: ILogService,
		@IKiloAgentService private readonly agentService: IKiloAgentService,
		@IVoidSettingsService private readonly settingsService: IVoidSettingsService,
	) {
		super();

		this.disposables.add(this.settingsService.onDidChangeState(() => void this.sync()));
	}

	sync(): Promise<KiloProviderSyncResult> {
		if (this.syncing) return this.syncing;
		this.syncing = this.doSync().finally(() => { this.syncing = undefined; });
		return this.syncing;
	}

	private async doSync(): Promise<KiloProviderSyncResult> {
		const state = this.settingsService.state;
		let result: KiloProviderSyncResult = { providers: [] };

		// Deliberately does NOT start the engine. Settings fire on every keystroke in the API
		// key field, and a start attempt costs up to STARTUP_TIMEOUT_MS, so starting here meant
		// dozens of overlapping spawns and a hung UI. The engine starts lazily on the first
		// chat turn instead; until then there is simply nothing to push credentials to.
		if (this.agentService.state.status !== 'running') {
			this._lastResult = result;
			this._onDidSync.fire(result);
			return result;
		}

		try {
			result = await this.syncProviders(state);
			await this.syncIndexing(state);
		} catch (err) {
			this.logService.warn(`[kilo-agent] could not sync settings to the engine: ${String(err?.message ?? err)}`);
		}
		this._lastResult = result;
		this._onDidSync.fire(result);
		return result;
	}

	/**
	 * Copies API keys into the engine's own auth store, which sits under Loophole's userDataPath.
	 *
	 * NOTE: the engine writes these to `data/kilo/auth.json` as **plaintext**. See
	 * docs/kilo-engine-notes.md ("Credential storage") - this is a known, flagged limitation,
	 * not an oversight.
	 *
	 * Every key is followed by a `GET /provider` check, because `PUT /auth/{id}` answers 200
	 * even for ids the engine does not recognise.
	 */
	private async syncProviders(state: VoidSettingsState): Promise<KiloProviderSyncResult> {
		const providers: KiloProviderSyncResult['providers'] = [];

		const credentials = collectEngineCredentials(state);
		for (const cred of credentials) {
			// Keys are user secrets: log the provider, never the value.
			this.logService.debug(`[kilo-agent] syncing credentials for ${cred.providerID}`);
			try {
				await this.agentService.setAuth({ providerID: cred.providerID, key: cred.key });
				providers.push(await this.verify(cred.providerID));
			} catch (err) {
				providers.push({ providerID: cred.providerID, ok: false, reason: String(err?.message ?? err) });
			}
		}

		const config = providerBaseUrlConfig(state);
		if (Object.keys(config).length) {
			try {
				await this.agentService.patchConfig(config);
			} catch (err) {
				providers.push({ providerID: '(provider config)', ok: false, reason: String(err?.message ?? err) });
			}
		}

		return { providers };
	}

	private async verify(providerID: string): Promise<KiloProviderSyncResult['providers'][number]> {
		try {
			const status = await this.agentService.getProviderStatus();
			// classifyConnection returns a bare verdict; the id is attached here so the settings
			// UI can tell the rows apart.
			return { providerID, ...classifyConnection(providerID, status) };
		} catch (err) {
			return { providerID, ok: false, reason: `could not read provider status: ${String(err?.message ?? err)}` };
		}
	}

	/**
	 * Indexing goes into the engine's GLOBAL config on purpose. Its per-project config route
	 * writes a `.kilo/kilo.jsonc` into the user's repository, which indexing must never do.
	 */
	private async syncIndexing(state: VoidSettingsState): Promise<void> {
		await this.agentService.configureIndexing(undefined, buildIndexingConfig(state.globalSettings));
	}
}

registerSingleton(IKiloAgentConfigSync, KiloAgentConfigSync, InstantiationType.Delayed);