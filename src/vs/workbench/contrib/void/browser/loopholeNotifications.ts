/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { LoopholeNotificationCategorySettingId } from './loopholeConfiguration.js';

export type LoopholeNotificationCategory = 'chatErrors' | 'applyChanges' | 'commitMessages' | 'voice';

/** Notifications default to on; a category becomes silent only when explicitly disabled. */
export const isLoopholeNotificationEnabled = (configurationService: IConfigurationService, category: LoopholeNotificationCategory) =>
	configurationService.getValue<boolean>(LoopholeNotificationCategorySettingId(category)) !== false;
