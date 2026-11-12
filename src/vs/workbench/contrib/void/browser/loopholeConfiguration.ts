/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Workbench settings for the Loophole CLI backend and Loophole FIM autocomplete.
// Registered via ConfigurationRegistry, matching how VS Code core declares its settings
// (e.g. `chat.agentHost.mistralAgent.*` in chat.shared.contribution.ts).

import * as nls from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, type IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

export const LoopholeCliEnabledSettingId = 'loophole.cli.enabled';
/** Legacy single-model setting; kept as the fallback when a role has no explicit model. */
export const LoopholeCliModelSettingId = 'loophole.cli.model';

export type LoopholeCliModelRole = 'default' | 'small' | 'subagent' | 'autocompletion' | 'speechToText' | 'commitMessage';

export const loopholeCliModelSettingId = (role: LoopholeCliModelRole) => `loophole.cli.models.${role}`;

/** Models switched off in Settings > Models; they disappear from every picker. */
export const LoopholeCliDisabledModelsSettingId = 'loophole.cli.models.disabled';

export const LoopholeNotificationCategorySettingId = (category: 'chatErrors' | 'applyChanges' | 'commitMessages' | 'voice') =>
	`loophole.notifications.${category}`;

export const LoopholeFimEnabledSettingId = 'loophole.fim.enabled';
export const LoopholeFimApiKeySettingId = 'loophole.fim.apiKey';
export const LoopholeFimModelSettingId = 'loophole.fim.model';

const roleProperties = {
	'default': nls.localize('loophole.cli.models.default', 'Model used by chat, agents, apply, and every request without a more specific role.'),
	'small': nls.localize('loophole.cli.models.small', 'Fast model used for small background tasks such as titles and summaries.'),
	'subagent': nls.localize('loophole.cli.models.subagent', 'Default model used by task-tool subagents.'),
	'autocompletion': nls.localize('loophole.cli.models.autocompletion', 'Model used for inline autocomplete suggestions.'),
	'speechToText': nls.localize('loophole.cli.models.speechToText', 'Model used to transcribe speech to text.'),
	'commitMessage': nls.localize('loophole.cli.models.commitMessage', 'Model used by the commit message generator.'),
};

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'loophole',
	title: nls.localize('loopholeConfigurationTitle', 'Loophole'),
	type: 'object',
	properties: {
		[LoopholeCliEnabledSettingId]: {
			type: 'boolean',
			description: nls.localize('loophole.cli.enabled', 'When enabled, Loophole uses the Loophole CLI for providers, models, and chat.'),
			default: true,
		},
		[LoopholeCliModelSettingId]: {
			type: 'string',
			description: nls.localize('loophole.cli.model', 'Fallback CLI model, as "providerID/modelID". Prefer the per-role Models settings.'),
			default: '',
		},
		[loopholeCliModelSettingId('default')]: {
			type: 'string',
			description: roleProperties['default'],
			default: '',
		},
		[loopholeCliModelSettingId('small')]: {
			type: 'string',
			description: roleProperties['small'],
			default: '',
		},
		[loopholeCliModelSettingId('subagent')]: {
			type: 'string',
			description: roleProperties['subagent'],
			default: '',
		},
		[loopholeCliModelSettingId('autocompletion')]: {
			type: 'string',
			description: roleProperties['autocompletion'],
			default: '',
		},
		[loopholeCliModelSettingId('speechToText')]: {
			type: 'string',
			description: roleProperties['speechToText'],
			default: '',
		},
		[loopholeCliModelSettingId('commitMessage')]: {
			type: 'string',
			description: roleProperties['commitMessage'],
			default: '',
		},
		[LoopholeCliDisabledModelsSettingId]: {
			type: 'array',
			items: { type: 'string' },
			description: nls.localize('loophole.cli.models.disabled', 'Models switched off in Settings > Models, as "providerID/modelID". They are hidden from every picker.'),
			default: [],
		},
		[LoopholeNotificationCategorySettingId('chatErrors')]: {
			type: 'boolean',
			description: nls.localize('loophole.notifications.chatErrors', 'Show a notification when a chat response fails.'),
			default: true,
		},
		[LoopholeNotificationCategorySettingId('applyChanges')]: {
			type: 'boolean',
			description: nls.localize('loophole.notifications.applyChanges', 'Show a notification when applying an edit fails.'),
			default: true,
		},
		[LoopholeNotificationCategorySettingId('commitMessages')]: {
			type: 'boolean',
			description: nls.localize('loophole.notifications.commitMessages', 'Show a notification when a commit message cannot be generated.'),
			default: true,
		},
		[LoopholeNotificationCategorySettingId('voice')]: {
			type: 'boolean',
			description: nls.localize('loophole.notifications.voice', 'Show a notification when voice input fails.'),
			default: true,
		},
		[LoopholeFimEnabledSettingId]: {
			type: 'boolean',
			description: nls.localize('loophole.fim.enabled', 'When enabled, Loophole provides inline completions via the Inception FIM API. Does nothing unless an Inception API key is configured.'),
			default: true,
		},
		[LoopholeFimApiKeySettingId]: {
			type: 'string',
			description: nls.localize('loophole.fim.apiKey', 'Inception API key used by Loophole FIM autocomplete (https://api.inceptionlabs.ai). Never synced.'),
			default: '',
			scope: ConfigurationScope.MACHINE,
		},
		[LoopholeFimModelSettingId]: {
			type: 'string',
			description: nls.localize('loophole.fim.model', 'Inception model used by Loophole FIM autocomplete.'),
			default: 'mercury-edit-2',
		},
	},
});
