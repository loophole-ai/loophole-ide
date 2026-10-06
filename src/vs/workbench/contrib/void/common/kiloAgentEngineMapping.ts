/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Translating Loophole's settings into the shape the agent engine expects.
//
// Kept separate from the service that pushes these values over IPC, and free of any service
// imports, so it can be unit tested without pulling in the settings service. Tests live in
// `common/test/kiloAgentEngineMapping.test.ts`.

import { KiloIndexingConfig, KiloIndexingProvider, KNOWN_CONNECTED_PROVIDER_IDS } from './kiloAgentTypes.js';
import { ProviderName, providerNames } from './voidSettingsTypes.js';
import { VoidSettingsState } from './voidSettingsService.js';

/**
 * Loophole provider name -> engine provider id, and what to hand the engine for each.
 *
 * The engine's catalog ids are the models.dev ones. `GET /provider` only ever reports these in
 * `connected`, so an id outside this list is useless even though `PUT /auth/{id}` returns 200.
 * Note in particular that plain `ollama` is NOT a catalog id (only `ollama-cloud` is), so a
 * local Ollama server has to be declared as a custom provider entry pointing at its
 * OpenAI-compatible endpoint.
 *
 * Typed as Record<ProviderName, ...> on purpose: adding a provider to
 * `defaultProviderSettings` without giving it a mapping is a compile error.
 */
export type EngineAuthMapping = {
	/** Catalog provider id, used for both `PUT /auth/{id}` and the `connected` check. */
	engineID?: string;
	/** Pushes an API key via `PUT /auth/{engineID}`. */
	apiKey?: (s: VoidSettingsState) => string | undefined;
	/** Base URL, written into the engine's `provider` config when it differs from the default. */
	baseUrl?: (s: VoidSettingsState) => string | undefined;
	/**
	 * True when `engineID` is not a real catalog id but a custom entry we are declaring in the
	 * engine's config. Custom entries are skipped by the `connected` check because the engine
	 * does not resolve them the same way.
	 */
	custom?: boolean;
};

export const ENGINE_AUTH_MAPPING: Record<ProviderName, EngineAuthMapping> = {
	anthropic: { engineID: 'anthropic', apiKey: s => s.settingsOfProvider.anthropic.apiKey },
	openAI: { engineID: 'openai', apiKey: s => s.settingsOfProvider.openAI.apiKey },
	deepseek: { engineID: 'deepseek', apiKey: s => s.settingsOfProvider.deepseek.apiKey },
	openRouter: { engineID: 'openrouter', apiKey: s => s.settingsOfProvider.openRouter.apiKey },
	gemini: { engineID: 'google', apiKey: s => s.settingsOfProvider.gemini.apiKey },
	groq: { engineID: 'groq', apiKey: s => s.settingsOfProvider.groq.apiKey },
	xAI: { engineID: 'xai', apiKey: s => s.settingsOfProvider.xAI.apiKey },
	mistral: { engineID: 'mistral', apiKey: s => s.settingsOfProvider.mistral.apiKey },
	awsBedrock: { engineID: 'amazon-bedrock', apiKey: s => s.settingsOfProvider.awsBedrock.apiKey },
	microsoftAzure: { engineID: 'azure', apiKey: s => s.settingsOfProvider.microsoftAzure.apiKey },
	googleVertex: { engineID: 'google-vertex' },
	// A real catalog id, but the host/port is user-configurable so it still needs a baseUrl.
	lmStudio: { engineID: 'lmstudio', baseUrl: s => s.settingsOfProvider.lmStudio.endpoint },
	// No `ollama` catalog id exists; these are all custom OpenAI-compatible entries.
	ollama: { engineID: 'openai-compatible', baseUrl: s => s.settingsOfProvider.ollama.endpoint, custom: true },
	vLLM: { engineID: 'openai-compatible', baseUrl: s => s.settingsOfProvider.vLLM.endpoint, custom: true },
	mlx: { engineID: 'openai-compatible', baseUrl: s => s.settingsOfProvider.mlx.endpoint, custom: true },
	appleFoundationModels: { engineID: 'openai-compatible', baseUrl: s => s.settingsOfProvider.appleFoundationModels.endpoint, custom: true },
	liteLLM: { engineID: 'openai-compatible', baseUrl: s => s.settingsOfProvider.liteLLM.endpoint, custom: true },
	openAICompatible: {
		engineID: 'openai-compatible',
		baseUrl: s => s.settingsOfProvider.openAICompatible.endpoint,
		apiKey: s => s.settingsOfProvider.openAICompatible.apiKey,
		custom: true,
	},
};

/** Catalog ids the engine reports in `GET /provider` -> `connected`. Re-exported from the shared
 * wire types so both the pure parser and this module agree on one list. */
export { KNOWN_CONNECTED_PROVIDER_IDS } from './kiloAgentTypes.js';

export type KiloProviderConnection = {
	/** connected plus failed, as returned by `GET /provider`. */
	connected: string[];
	failed: string[];
};

/**
 * The credentials the engine needs, derived from Loophole's provider settings.
 *
 * Providers the user has not filled in are skipped rather than sent as empty strings, which
 * would otherwise clear a key the engine already had. Custom entries are skipped too: they are
 * config, not credentials.
 */
export function collectEngineCredentials(state: VoidSettingsState): Array<{ providerID: string; key: string }> {
	const out: Array<{ providerID: string; key: string }> = [];
	const index = new Map<string, number>();
	for (const name of providerNames) {
		const mapping = ENGINE_AUTH_MAPPING[name];
		if (!mapping?.engineID || mapping.custom) continue;
		const key = mapping.apiKey?.(state)?.trim();
		if (!key) continue;

		const existing = index.get(mapping.engineID);
		if (existing !== undefined) {
			out[existing].key = key; // last one configured wins
			continue;
		}
		index.set(mapping.engineID, out.length);
		out.push({ providerID: mapping.engineID, key });
	}
	return out;
}

/**
 * The `provider` config block: base URLs for the real catalog ids that take one, plus the
 * single `openai-compatible` custom entry.
 *
 * The engine supports only one `openai-compatible` entry, so the first custom Loophole provider
 * with an endpoint configured wins. This is also the slot a "Loophole Pass" gateway would use.
 */
export function providerBaseUrlConfig(state: VoidSettingsState): Record<string, unknown> {
	const provider: Record<string, { baseURL: string }> = {};
	for (const name of providerNames) {
		const mapping = ENGINE_AUTH_MAPPING[name];
		const baseUrl = mapping?.baseUrl?.(state)?.trim();
		if (!baseUrl) continue;

		if (mapping.custom) {
			provider[mapping.engineID!] ??= { baseURL: baseUrl };
			continue;
		}
		// A real catalog id: only override it when the user moved it off the default host.
		if (mapping.engineID && provider[mapping.engineID] === undefined) {
			provider[mapping.engineID] = { baseURL: baseUrl };
		}
	}
	return Object.keys(provider).length ? { provider } : {};
}

/**
 * Decides whether a just-pushed credential actually took, using `GET /provider`.
 *
 * `PUT /auth/{id}` answers 200 for any id, including ones the engine does not know, so the
 * only trustworthy signal is whether the id shows up in `connected`. `failed` distinguishes
 * "the key was rejected" from "this id is not a real provider".
 */
export function classifyConnection(
	providerID: string,
	status: KiloProviderConnection,
): { ok: true } | { ok: false; reason: string } {
	if (status.connected.includes(providerID)) return { ok: true };
	if (status.failed.includes(providerID)) {
		return { ok: false, reason: 'the engine rejected these credentials' };
	}
	if (!(KNOWN_CONNECTED_PROVIDER_IDS as readonly string[]).includes(providerID)) {
		return { ok: false, reason: `"${providerID}" is not a provider the engine recognises` };
	}
	return { ok: false, reason: `"${providerID}" did not connect; the key may be wrong or expired` };
}

/** Builds the engine's `indexing` config block from Loophole's settings. */
export function buildIndexingConfig(g: VoidSettingsState['globalSettings']): KiloIndexingConfig {
	// `kilo` (Kilo-hosted embeddings) is never allowed: it would ship the user's source code
	// to Kilo's servers. If it ever reaches here anyway, fall back to the local default.
	const provider: KiloIndexingProvider = (g.engineIndexingProvider as string) === 'kilo'
		? 'ollama'
		: g.engineIndexingProvider;

	const indexing: KiloIndexingConfig = {
		enabled: g.engineIndexingEnabled,
		provider,
	};
	if (g.engineIndexingModel?.trim()) indexing.model = g.engineIndexingModel.trim();
	if (provider === 'ollama' && g.engineOllamaBaseUrl.trim()) {
		indexing.ollama = { baseUrl: g.engineOllamaBaseUrl.trim() };
	}
	if (provider === 'openai-compatible') {
		indexing['openai-compatible'] = {
			baseUrl: g.engineOpenAiCompatibleBaseUrl.trim(),
			...(g.engineOpenAiCompatibleApiKey ? { apiKey: g.engineOpenAiCompatibleApiKey } : {}),
		};
	}
	return indexing;
}

/**
 * Engine permission keys that count as "edits" for Loophole's auto-approve switch.
 *
 * Loophole's settings speak in the legacy categories ('edits' | 'terminal' | 'MCP tools'),
 * while the engine asks about fine-grained capabilities. This maps one onto the other.
 *
 * Keys verified against the engine's permission schema
 * (packages/core/src/v1/config/permission.ts) - every name here exists there.
 */
const EDIT_PERMISSION_KEYS = ['edit', 'notebook_edit', 'external_directory', 'markdown_source'] as const;

/** Engine permission keys that count as "terminal" for Loophole's auto-approve switch. */
const TERMINAL_PERMISSION_KEYS = ['bash', 'task', 'skill', 'lsp'] as const;

/**
 * Builds the engine's `permission` block from Loophole's per-category auto-approve settings.
 *
 * The engine auto-allows by default, so without this it edits files straight to disk and the
 * sidebar's accept/reject has nothing to review. Anything Loophole has NOT auto-approved becomes
 * "ask", which is what makes the engine emit `permission.asked`.
 *
 * Read-only actions stay allowed either way: prompting on every file read made the agent
 * tediously slow for no safety gain.
 */
export function buildPermissionConfig(autoApprove: Record<string, boolean | undefined> | undefined): Record<string, string> {
	const approved = autoApprove ?? {};
	const out: Record<string, string> = {};

	for (const key of EDIT_PERMISSION_KEYS) out[key] = approved.edits ? 'allow' : 'ask';
	for (const key of TERMINAL_PERMISSION_KEYS) out[key] = approved.terminal ? 'allow' : 'ask';

	// Our own MCP tools (diagnostics, terminals) are harmless reads, so they follow the
	// "MCP tools" switch only when it is on; otherwise they ask like any other tool.
	out['question'] = 'allow';
	out['todowrite'] = 'allow';
	out['read'] = 'allow';
	out['glob'] = 'allow';
	out['grep'] = 'allow';
	out['list'] = 'allow';
	out['webfetch'] = 'allow';
	out['websearch'] = 'allow';
	out['doom_loop'] = 'allow';

	return out;
}
