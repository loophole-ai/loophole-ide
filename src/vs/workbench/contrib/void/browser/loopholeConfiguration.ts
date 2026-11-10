/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Workbench settings for Loophole Serve (Phase 1/2) and Loophole FIM autocomplete (Phase 3).
// Registered via ConfigurationRegistry, matching how VS Code core declares its settings
// (e.g. `chat.agentHost.mistralAgent.*` in chat.shared.contribution.ts).

import * as nls from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, type IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

export const LoopholeServeEnabledSettingId = 'loophole.serve.enabled';
export const LoopholeServeModelSettingId = 'loophole.serve.model';
export const LoopholeFimEnabledSettingId = 'loophole.fim.enabled';
export const LoopholeFimApiKeySettingId = 'loophole.fim.apiKey';
export const LoopholeFimModelSettingId = 'loophole.fim.model';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'loophole',
	title: nls.localize('loopholeConfigurationTitle', 'Loophole'),
	type: 'object',
	properties: {
		[LoopholeServeEnabledSettingId]: {
			type: 'boolean',
			description: nls.localize('loophole.serve.enabled', 'When enabled, Loophole uses the bundled Loophole Serve backend for providers, models, and chat transport (behind the Loophole Serve settings section).'),
			default: true,
		},
		[LoopholeServeModelSettingId]: {
			type: 'string',
			description: nls.localize('loophole.serve.model', 'Server model used by Loophole Serve for chat, as "providerID/modelID". Empty uses the server default model.'),
			default: '',
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
