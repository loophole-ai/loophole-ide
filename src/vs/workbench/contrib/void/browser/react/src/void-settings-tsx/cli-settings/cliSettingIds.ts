/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
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

/** Models switched off in Settings > Models; they disappear from every picker. */
export const LoopholeCliDisabledModelsSettingId = 'loophole.cli.models.disabled'

/** OpenAI-compatible providers added in Settings > Providers. */
export const LoopholeCliCustomProvidersSettingId = 'loophole.cli.customProviders'

export type LoopholeCliCustomProvider = {
	id: string
	name: string
	baseURL?: string
	model: string
	apiKey?: string
}
