/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IKiloAgentService } from '../kiloAgentService.js';
import { IVoidSettingsService } from '../voidSettingsService.js';
import { IKiloAgentConfigSync, KiloAgentConfigSync } from '../kiloAgentConfigSync.js';
import { defaultProviderSettings } from '../modelCapabilities.js';
import { defaultGlobalSettings } from '../voidSettingsTypes.js';

suite('KiloAgentConfigSync', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let sync: IKiloAgentConfigSync;

	let calls: string[];
	let warnings: string[];
	let ensureStartedCalls: number;
	let connected: string[];
	let failed: string[];
	let setAuthThrows: Set<string>;
	let patchConfigThrows: boolean;
	let statusThrows: boolean;
	let settingsChanged: Emitter<void>;
	let apiKeys: Record<string, string>;
	let engineState: { status: 'stopped' | 'starting' | 'running' | 'error' };

	function buildState() {
		const providerSettings: Record<string, any> = {};
		for (const [name, def] of Object.entries(defaultProviderSettings as Record<string, any>)) {
			providerSettings[name] = { ...def, apiKey: apiKeys[name] ?? def.apiKey };
		}
		return { providerSettings, globalSettings: { ...defaultGlobalSettings } } as any;
	}

	setup(() => {
		calls = [];
		warnings = [];
		ensureStartedCalls = 0;
		connected = [];
		failed = [];
		setAuthThrows = new Set();
		patchConfigThrows = false;
		statusThrows = false;
		engineState = { status: 'running' };
		settingsChanged = disposables.add(new Emitter<void>());
		apiKeys = {};

		instantiationService = disposables.add(new TestInstantiationService(workbenchInstantiationService));
		instantiationService.stub(ILogService, {
			debug: () => { }, info: () => { },
			warn: (m: string) => { warnings.push(m); },
			error: () => { }, trace: () => { },
		} as unknown as ILogService);

		instantiationService.stub(IKiloAgentService, {
			state: engineState,
			ensureStarted: async () => { ensureStartedCalls++; calls.push('ensureStarted'); },
			setAuth: async ({ providerID }: { providerID: string }) => {
				calls.push(`setAuth:${providerID}`);
				if (setAuthThrows.has(providerID)) throw new Error(`rejected ${providerID}`);
			},
			patchConfig: async () => { calls.push('patchConfig'); if (patchConfigThrows) throw new Error('no config route'); },
			getProviderStatus: async () => {
				calls.push('getProviderStatus');
				if (statusThrows) throw new Error('status unavailable');
				return { connected, failed };
			},
			configureIndexing: async () => { calls.push('configureIndexing'); },
		} as unknown as IKiloAgentService);

		instantiationService.stub(IVoidSettingsService, {
			state: buildState(),
			onDidChangeState: settingsChanged.event,
		} as unknown as IVoidSettingsService);

		sync = disposables.add(instantiationService.createInstance(KiloAgentConfigSync) as unknown as IKiloAgentConfigSync);
	});

	/**
	 * The settings service stub reads `state` once at stub time, so point it at a fresh
	 * object before each sync to model a changed settings object.
	 */
	function useState(state: any) {
		(instantiationService as any).get(IVoidSettingsService).state = state;
	}

	suite('engine startup', () => {

		test('never starts the engine: a settings change must not spawn it', async () => {
			engineState = { status: 'stopped' };
			useState(buildState());
			await sync.sync();
			assert.strictEqual(ensureStartedCalls, 0, 'sync must not spawn the engine');
			assert.deepStrictEqual(calls, [], 'nothing should be pushed to a stopped engine');
		});

		test('is quiet when the engine is stopped, not noisy', async () => {
			engineState = { status: 'stopped' };
			useState(buildState());
			settingsChanged.fire();
			await new Promise(r => setTimeout(r, 0));
			assert.deepStrictEqual(warnings, [], 'a stopped engine is normal, not an error');
		});

		test('still skips while the engine is starting', async () => {
			engineState = { status: 'starting' };
			useState(buildState());
			const result = await sync.sync();
			assert.deepStrictEqual(result.providers, []);
			assert.strictEqual(ensureStartedCalls, 0);
		});

		test('syncs for real once the engine is running', async () => {
			engineState = { status: 'running' };
			apiKeys = { mistral: 'sk-1' };
			connected = ['mistral'];
			useState(buildState());
			await sync.sync();
			assert.ok(calls.includes('setAuth:mistral'), 'a running engine gets the keys');
			assert.strictEqual(ensureStartedCalls, 0, 'still must not start it');
		});
	});

	suite('provider results', () => {

		test('attaches providerID to every row, including failures', async () => {
			apiKeys = { mistral: 'sk-1' };
			connected = ['mistral'];
			failed = ['openai'];
			apiKeys.openai = 'sk-bad';
			useState(buildState());
			const result = await sync.sync();
			for (const row of result.providers) {
				assert.strictEqual(typeof row.providerID, 'string', 'every row needs an id for the settings UI');
			}
			const mistral = result.providers.find(p => p.providerID === 'mistral');
			assert.strictEqual(mistral?.ok, true);
		});

		test('reports a rejected key without aborting the rest', async () => {
			apiKeys = { mistral: 'sk-1', openai: 'sk-2' };
			setAuthThrows.add('mistral');
			connected = ['openai'];
			useState(buildState());
			const result = await sync.sync();
			const mistral = result.providers.find(p => p.providerID === 'mistral');
			const openai = result.providers.find(p => p.providerID === 'openai');
			assert.strictEqual(mistral?.ok, false);
			assert.strictEqual(openai?.ok, true);
		});

		test('reports a status-read failure per provider', async () => {
			apiKeys = { mistral: 'sk-1' };
			statusThrows = true;
			useState(buildState());
			const result = await sync.sync();
			assert.strictEqual(result.providers[0].ok, false);
			assert.ok(result.providers[0].reason?.includes('could not read provider status'));
		});

		test('never logs a key value', async () => {
			const debugs: string[] = [];
			(instantiationService.get(ILogService) as any).debug = (m: string) => { debugs.push(m); };
			apiKeys = { mistral: 'sk-super-secret' };
			useState(buildState());
			await sync.sync();
			assert.ok(!debugs.some(d => d.includes('sk-super-secret')), 'keys must never be logged');
		});
	});

	suite('concurrency', () => {

		test('coalesces overlapping syncs into one', async () => {
			useState(buildState());
			const [a, b] = await Promise.all([sync.sync(), sync.sync()]);
			assert.strictEqual(ensureStartedCalls, 1);
			assert.deepStrictEqual(a, b);
		});

		test('allows a later sync after the first settles', async () => {
			useState(buildState());
			await sync.sync();
			await sync.sync();
			assert.strictEqual(ensureStartedCalls, 2);
		});
	});

	suite('results', () => {

		test('starts with an empty result rather than undefined', () => {
			assert.deepStrictEqual(sync.lastResult, { providers: [] });
		});

		test('publishes the result to onDidSync', async () => {
			apiKeys = { mistral: 'sk-1' };
			connected = ['mistral'];
			useState(buildState());
			const seen: any[] = [];
			disposables.add(sync.onDidSync(r => seen.push(r)));
			await sync.sync();
			assert.strictEqual(seen.length, 1);
			assert.ok(seen[0].providers.length >= 1);
		});
	});
});