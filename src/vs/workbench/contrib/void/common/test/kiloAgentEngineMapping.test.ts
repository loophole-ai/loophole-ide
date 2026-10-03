/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	buildIndexingConfig,
	classifyConnection,
	collectEngineCredentials,
	ENGINE_AUTH_MAPPING,
	KNOWN_CONNECTED_PROVIDER_IDS,
	providerBaseUrlConfig,
} from '../kiloAgentEngineMapping.js';
import { defaultProviderSettings } from '../modelCapabilities.js';
import { defaultGlobalSettings, GlobalSettings, providerNames } from '../voidSettingsTypes.js';
import { VoidSettingsState } from '../voidSettingsService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

/**
 * Builds a VoidSettingsState holding only the provider/global fields these functions read, so
 * the tests do not have to construct the whole (very wide) state object.
 */
function stateWith(opts: {
	/** per-provider api key */
	keys?: Record<string, string>;
	/** per-provider endpoint */
	endpoints?: Record<string, string>;
	global?: Partial<GlobalSettings>;
} = {}): VoidSettingsState {
	const settingsOfProvider: Record<string, Record<string, unknown>> = {};
	for (const name of providerNames) {
		const fields: Record<string, unknown> = {};
		for (const field of Object.keys(defaultProviderSettings[name])) {
			fields[field] = field === 'apiKey' ? (opts.keys?.[name] ?? '') : (opts.endpoints?.[name] ?? '');
		}
		settingsOfProvider[name] = { ...fields, models: [], _didFillInProviderSettings: false };
	}
	return {
		globalSettings: { ...defaultGlobalSettings, ...opts.global },
		settingsOfProvider,
	} as unknown as VoidSettingsState;
}

suite('Kilo agent config sync', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('provider mapping', () => {

		test('covers every Loophole provider', () => {
			// A new provider added to defaultProviderSettings must be given a mapping, or
			// Record<ProviderName, ...> fails to compile. This guards the runtime equivalent.
			for (const name of providerNames) {
				assert.ok(ENGINE_AUTH_MAPPING[name], `${name} has no engine mapping`);
			}
		});

		test('maps the names that differ from the engine', () => {
			assert.strictEqual(ENGINE_AUTH_MAPPING.openAI.engineID, 'openai');
			assert.strictEqual(ENGINE_AUTH_MAPPING.openRouter.engineID, 'openrouter');
			assert.strictEqual(ENGINE_AUTH_MAPPING.gemini.engineID, 'google');
			assert.strictEqual(ENGINE_AUTH_MAPPING.xAI.engineID, 'xai');
			assert.strictEqual(ENGINE_AUTH_MAPPING.microsoftAzure.engineID, 'azure');
			assert.strictEqual(ENGINE_AUTH_MAPPING.googleVertex.engineID, 'google-vertex');
		});

		test('maps awsBedrock to amazon-bedrock, not bedrock', () => {
			// 'bedrock' is not a catalog id; the engine accepts the PUT but never connects it.
			assert.strictEqual(ENGINE_AUTH_MAPPING.awsBedrock.engineID, 'amazon-bedrock');
		});

		test('maps lmStudio to its own catalog id, not openai-compatible', () => {
			assert.strictEqual(ENGINE_AUTH_MAPPING.lmStudio.engineID, 'lmstudio');
			assert.notStrictEqual(ENGINE_AUTH_MAPPING.lmStudio.custom, true);
		});

		test('never uses plain "ollama", which is not a catalog id', () => {
			// Only `ollama-cloud` exists upstream; a local Ollama server needs a custom entry.
			assert.notStrictEqual(ENGINE_AUTH_MAPPING.ollama.engineID, 'ollama');
			assert.strictEqual(ENGINE_AUTH_MAPPING.ollama.engineID, 'openai-compatible');
			assert.strictEqual(ENGINE_AUTH_MAPPING.ollama.custom, true);
		});

		test('marks every non-catalog id as a custom entry', () => {
			for (const name of ['ollama', 'vLLM', 'mlx', 'appleFoundationModels', 'liteLLM', 'openAICompatible'] as const) {
				assert.strictEqual(ENGINE_AUTH_MAPPING[name].custom, true, name);
			}
		});

		test('every non-custom id is one the engine actually reports as connected', () => {
			// This is the whole point: an id outside this list silently never connects.
			for (const name of providerNames) {
				const m = ENGINE_AUTH_MAPPING[name];
				if (!m.engineID || m.custom) continue;
				assert.ok(
					(KNOWN_CONNECTED_PROVIDER_IDS as readonly string[]).includes(m.engineID),
					`${name} -> ${m.engineID} is not a known connected id`,
				);
			}
		});

		test('never maps anything onto the kilo provider', () => {
			for (const name of providerNames) {
				assert.notStrictEqual(ENGINE_AUTH_MAPPING[name].engineID, 'kilo', name);
			}
		});
	});

	suite('collectEngineCredentials', () => {

		test('returns nothing when no keys are filled in', () => {
			assert.deepStrictEqual(collectEngineCredentials(stateWith()), []);
		});

		test('collects a filled-in key', () => {
			const creds = collectEngineCredentials(stateWith({ keys: { anthropic: 'sk-ant-123' } }));
			assert.deepStrictEqual(creds, [{ providerID: 'anthropic', key: 'sk-ant-123' }]);
		});

		test('trims whitespace so a stray space does not break auth', () => {
			const creds = collectEngineCredentials(stateWith({ keys: { openAI: '  sk-123  ' } }));
			assert.deepStrictEqual(creds, [{ providerID: 'openai', key: 'sk-123' }]);
		});

		test('skips providers with an empty key rather than sending an empty credential', () => {
			// An empty string would clear a key the engine may already hold.
			const creds = collectEngineCredentials(stateWith({ keys: { anthropic: '', openAI: 'sk-1' } }));
			assert.deepStrictEqual(creds, [{ providerID: 'openai', key: 'sk-1' }]);
		});

		test('skips providers with a whitespace-only key', () => {
			assert.deepStrictEqual(collectEngineCredentials(stateWith({ keys: { anthropic: '   ' } })), []);
		});

		test('collects several providers at once', () => {
			const creds = collectEngineCredentials(stateWith({
				keys: { anthropic: 'a', openAI: 'o', groq: 'g' },
			}));
			assert.deepStrictEqual(creds.map(c => c.providerID), ['anthropic', 'openai', 'groq']);
		});

		test('sends one credential per engine id when several Loophole providers collapse', () => {
			const creds = collectEngineCredentials(stateWith({
				keys: { openAICompatible: 'key-1' },
			}));
			const compatible = creds.filter(c => c.providerID === 'openai-compatible');
			assert.strictEqual(compatible.length, 1);
		});

		test('never sends a key for a custom entry', () => {
			// Custom entries are config, not credentials; the engine stores them in config.
			const creds = collectEngineCredentials(stateWith({ keys: { openAICompatible: 'key-1' } }));
			assert.deepStrictEqual(creds, []);
		});

		test('does not include providers that only have an endpoint', () => {
			// An endpoint is config, not a credential.
			const creds = collectEngineCredentials(stateWith({ endpoints: { ollama: 'http://127.0.0.1:11434' } }));
			assert.deepStrictEqual(creds, []);
		});

		test('sends bedrock under the id the engine reports as connected', () => {
			const creds = collectEngineCredentials(stateWith({ keys: { awsBedrock: 'b' } }));
			assert.deepStrictEqual(creds, [{ providerID: 'amazon-bedrock', key: 'b' }]);
		});
	});

	suite('providerBaseUrlConfig', () => {

		test('is empty when no endpoint is configured', () => {
			assert.deepStrictEqual(providerBaseUrlConfig(stateWith()), {});
		});

		test('declares local Ollama as a custom openai-compatible entry', () => {
			const config = providerBaseUrlConfig(stateWith({ endpoints: { ollama: 'http://127.0.0.1:11434' } }));
			assert.deepStrictEqual(config, { provider: { 'openai-compatible': { baseURL: 'http://127.0.0.1:11434' } } });
		});

		test('uses lmstudio\'s own id, not openai-compatible', () => {
			const config = providerBaseUrlConfig(stateWith({ endpoints: { lmStudio: 'http://localhost:1234' } }));
			assert.deepStrictEqual((config as any).provider.lmstudio, { baseURL: 'http://localhost:1234' });
			assert.strictEqual((config as any).provider['openai-compatible'], undefined);
		});

		test('keeps only the first custom entry, since the engine supports one', () => {
			const config = providerBaseUrlConfig(stateWith({
				endpoints: { ollama: 'http://127.0.0.1:11434', vLLM: 'http://localhost:8000' },
			}));
			const provider = (config as any).provider;
			assert.strictEqual(Object.keys(provider).length, 1);
			assert.strictEqual(provider['openai-compatible'].baseURL, 'http://127.0.0.1:11434');
		});

		test('ignores an endpoint that is only whitespace', () => {
			assert.deepStrictEqual(providerBaseUrlConfig(stateWith({ endpoints: { ollama: '  ' } })), {});
		});

		test('trims the endpoint', () => {
			const config = providerBaseUrlConfig(stateWith({ endpoints: { ollama: '  http://127.0.0.1:11434  ' } }));
			assert.strictEqual((config as any).provider['openai-compatible'].baseURL, 'http://127.0.0.1:11434');
		});
	});

	suite('classifyConnection', () => {

		const status = (connected: string[], failed: string[] = []) => ({ connected, failed });

		test('accepts a provider that connected', () => {
			assert.deepStrictEqual(classifyConnection('anthropic', status(['anthropic', 'openai'])), { ok: true });
		});

		test('reports a rejected key when the engine lists it as failed', () => {
			const result = classifyConnection('anthropic', status([], ['anthropic']));
			assert.strictEqual(result.ok, false);
			assert.ok(result.ok === false && result.reason.includes('rejected'));
		});

		test('reports an unrecognised id distinctly from a bad key', () => {
			// This is the 'bedrock' vs 'amazon-bedrock' case.
			const result = classifyConnection('bedrock', status([]));
			assert.strictEqual(result.ok, false);
			assert.ok(result.ok === false && result.reason.includes('not a provider the engine recognises'));
		});

		test('reports a known id that simply did not connect', () => {
			const result = classifyConnection('amazon-bedrock', status([]));
			assert.strictEqual(result.ok, false);
			assert.ok(result.ok === false && result.reason.includes('did not connect'));
		});

		test('accepts every documented connected id', () => {
			for (const id of KNOWN_CONNECTED_PROVIDER_IDS) {
				assert.deepStrictEqual(classifyConnection(id, status([id])), { ok: true }, id);
			}
		});
	});

	suite('buildIndexingConfig', () => {

		test('defaults to ollama, which needs no key and keeps embeddings local', () => {
			const config = buildIndexingConfig(defaultGlobalSettings);
			assert.strictEqual(config.provider, 'ollama');
			assert.strictEqual(config.enabled, false);
		});

		test('includes the ollama address', () => {
			const config = buildIndexingConfig({ ...defaultGlobalSettings, engineOllamaBaseUrl: 'http://127.0.0.1:11434' });
			assert.deepStrictEqual(config.ollama, { baseUrl: 'http://127.0.0.1:11434' });
		});

		test('omits the ollama address when it is blank', () => {
			const config = buildIndexingConfig({ ...defaultGlobalSettings, engineOllamaBaseUrl: '  ' });
			assert.strictEqual(config.ollama, undefined);
		});

		test('includes the model when set', () => {
			const config = buildIndexingConfig({ ...defaultGlobalSettings, engineIndexingModel: 'nomic-embed-text' });
			assert.strictEqual(config.model, 'nomic-embed-text');
		});

		test('omits the model when blank', () => {
			const config = buildIndexingConfig({ ...defaultGlobalSettings, engineIndexingModel: '   ' });
			assert.strictEqual(config.model, undefined);
		});

		test('carries the openai-compatible endpoint and key', () => {
			const config = buildIndexingConfig({
				...defaultGlobalSettings,
				engineIndexingProvider: 'openai-compatible',
				engineOpenAiCompatibleBaseUrl: 'https://embed.example.com',
				engineOpenAiCompatibleApiKey: 'secret',
			});
			assert.deepStrictEqual(config['openai-compatible'], { baseUrl: 'https://embed.example.com', apiKey: 'secret' });
		});

		test('omits the openai-compatible key when blank', () => {
			const config = buildIndexingConfig({
				...defaultGlobalSettings,
				engineIndexingProvider: 'openai-compatible',
				engineOpenAiCompatibleBaseUrl: 'https://embed.example.com',
				engineOpenAiCompatibleApiKey: '',
			});
			assert.deepStrictEqual(config['openai-compatible'], { baseUrl: 'https://embed.example.com' });
		});

		test('does not leak the openai-compatible block into an ollama config', () => {
			const config = buildIndexingConfig({
				...defaultGlobalSettings,
				engineIndexingProvider: 'ollama',
				engineOpenAiCompatibleBaseUrl: 'https://embed.example.com',
			});
			assert.strictEqual(config['openai-compatible'], undefined);
		});

		test('refuses the kilo embedding provider even if one is forced in', () => {
			// Kilo-hosted embeddings would ship the user's source code to Kilo.
			const config = buildIndexingConfig({
				...defaultGlobalSettings,
				engineIndexingProvider: 'kilo' as any,
			});
			assert.notStrictEqual(config.provider, 'kilo');
			assert.strictEqual(config.provider, 'ollama');
		});

		test('passes an ordinary provider through', () => {
			const config = buildIndexingConfig({ ...defaultGlobalSettings, engineIndexingProvider: 'openai' });
			assert.strictEqual(config.provider, 'openai');
		});

		test('reports whether indexing is on', () => {
			const config = buildIndexingConfig({ ...defaultGlobalSettings, engineIndexingEnabled: true });
			assert.strictEqual(config.enabled, true);
		});
	});
});
