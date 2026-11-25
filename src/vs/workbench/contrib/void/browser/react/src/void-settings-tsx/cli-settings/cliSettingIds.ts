/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Setting ids used by the CLI settings pages.
//
// These are declared here rather than imported from browser/loopholeConfiguration.ts
// because the settings bundle is flattened into a single entry file, so a relative
// path that walks up to the browser/ directory only resolves from the original
// source location - not from the emitted bundle. Keeping the ids local keeps the
// bundle self-contained; loopholeConfiguration.ts registers the same keys.

export type LoopholeCliModelRole =
	| 'default'
	| 'small'
	| 'subagent'
	| 'autocompletion'
	| 'speechToText'
	| 'commitMessage'

export const loopholeCliModelSettingId = (role: LoopholeCliModelRole) => `loophole.cli.models.${role}`

export type LoopholeNotificationCategory = 'chatErrors' | 'applyChanges' | 'commitMessages' | 'voice'

export const loopholeNotificationCategorySettingId = (category: LoopholeNotificationCategory) =>
	`loophole.notifications.${category}`

/**
 * Models the user switched on in Settings > Models, as `providerID/modelID`.
 *
 * Opt-in on purpose: a provider such as OpenRouter reports ~350 models, and
 * putting all of them in the composer dropdown makes it lag. Nothing is shown in
 * a picker until it is checked here.
 */
export const LoopholeCliEnabledModelsSettingId = 'loophole.cli.models.enabled'

/** OpenAI-compatible providers added in Settings > Providers. */
export const LoopholeCliCustomProvidersSettingId = 'loophole.cli.customProviders'

export type LoopholeCliCustomProvider = {
	id: string
	name: string
	baseURL?: string
	model: string
	apiKey?: string
}
