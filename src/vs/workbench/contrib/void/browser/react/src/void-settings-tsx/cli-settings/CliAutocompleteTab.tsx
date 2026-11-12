/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { useAccessor, useSettingsState } from '../../util/services.js'
import { VoidSwitch } from '../../util/inputs.js'
import { loopholeCliModelSettingId } from './cliSettingIds.js'
import { CliModelSelect, useCliModels } from './CliModelSelect.js'
import { SettingsList, SettingsRow, SettingsSection } from './CliSettingsRows.js'

const fimEnabledSetting = 'loophole.fim.enabled'
const fimModelSetting = 'loophole.fim.model'

/**
 * Inline completion (FIM) settings.
 *
 * No API key field here on purpose: provider keys live on the Providers page and
 * are read from the CLI, so this page only chooses the model and turns the
 * feature on.
 */
export const CliAutocompleteTab = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()
	const { models, loading, error } = useCliModels()

	const [enabled, setEnabled] = useState(() => settingsState.globalSettings.enableAutocomplete)
	const [ref, setRef] = useState(() => {
		const role = configService.getValue<string>(loopholeCliModelSettingId('autocompletion')) ?? ''
		const fallback = configService.getValue<string>(fimModelSetting) ?? ''
		return role || fallback || 'mercury-edit-2'
	})

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(fimModelSetting)) return
			const fallback = configService.getValue<string>(fimModelSetting) ?? ''
			const role = configService.getValue<string>(loopholeCliModelSettingId('autocompletion')) ?? ''
			setRef(role || fallback || 'mercury-edit-2')
		})
		return () => disposable.dispose()
	}, [configService])

	const save = (nextRef: string) => {
		setRef(nextRef)
		const modelID = nextRef.includes('/') ? nextRef.slice(nextRef.lastIndexOf('/') + 1) : nextRef
		configService.updateValue(loopholeCliModelSettingId('autocompletion'), nextRef)
		configService.updateValue(fimModelSetting, modelID || 'mercury-edit-2')
	}

	return <SettingsSection
		title='Autocomplete'
		description='Inline completions use the provider you connected on the Providers page. Pick the model here and turn the feature on.'
	>
		<SettingsList>
			<SettingsRow label='Enable autocomplete' description='Show inline suggestions as you type.'>
				<VoidSwitch
					size='xs'
					value={enabled}
					onChange={(next) => {
						voidSettingsService.setGlobalSetting('enableAutocomplete', next)
						configService.updateValue(fimEnabledSetting, next)
						setEnabled(next)
					}}
				/>
			</SettingsRow>
			<SettingsRow label='Model' description={loading ? 'Loading models...' : error ? error : 'Default: mercury-edit-2.'}>
				<CliModelSelect value={ref} models={models} onChange={save} />
			</SettingsRow>
		</SettingsList>
	</SettingsSection>
}
