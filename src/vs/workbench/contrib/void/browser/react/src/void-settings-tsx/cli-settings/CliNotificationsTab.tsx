/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidSwitch } from '../../util/inputs.js'
import { loopholeNotificationCategorySettingId } from './cliSettingIds.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'

const categories = [
	{ id: 'chatErrors' as const, label: 'Chat errors', description: 'A chat turn failed or a tool stopped the agent.' },
	{ id: 'applyChanges' as const, label: 'Apply changes', description: 'Fast Apply ran but produced no editable blocks.' },
	{ id: 'commitMessages' as const, label: 'Commit messages', description: 'The commit message generator failed.' },
	{ id: 'voice' as const, label: 'Voice input', description: 'Microphone permission or voice capture failed.' },
]

/** Toggles only the notification categories the app actually emits. */
export const CliNotificationsTab = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const [values, setValues] = useState<Record<string, boolean>>(() => {
		const next: Record<string, boolean> = {}
		for (const category of categories) next[category.id] = configService.getValue<boolean>(loopholeNotificationCategorySettingId(category.id)) !== false
		return next
	})

	return <SettingsSection
		title='Notifications'
		description='Choose which Loophole notifications are shown.'
	>
		<SettingsList>
			{categories.map((category) => <SettingsRow key={category.id} label={category.label} description={category.description}>
				<VoidSwitch
					size='xs'
					value={values[category.id] ?? true}
					onChange={(next) => {
						configService.updateValue(loopholeNotificationCategorySettingId(category.id), next)
						setValues(prev => ({ ...prev, [category.id]: next }))
					}}
				/>
			</SettingsRow>)}
		</SettingsList>
		<div className='mt-4'>
			<SettingsNote>Import and export confirmations are always shown.</SettingsNote>
		</div>
	</SettingsSection>
}
