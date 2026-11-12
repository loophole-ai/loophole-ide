/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { useAccessor, useSettingsState } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSimpleInputBox, VoidSwitch } from '../../util/inputs.js'
import { loopholeCliModelSettingId } from './cliSettingIds.js'
import { CliModelSelect, useCliModels } from './CliModelSelect.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'

const fimEnabledSetting = 'loophole.fim.enabled'
const fimModelSetting = 'loophole.fim.model'
const fimApiKeySetting = 'loophole.fim.apiKey'

/** Inline completion (FIM) settings, with the model chosen from the CLI list. */
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
	const [apiKey, setApiKey] = useState(() => configService.getValue<string>(fimApiKeySetting) ?? '')
	const [message, setMessage] = useState<string | null>(null)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(fimModelSetting)) {
				const fallback = configService.getValue<string>(fimModelSetting) ?? ''
				const role = configService.getValue<string>(loopholeCliModelSettingId('autocompletion')) ?? ''
				setRef(role || fallback || 'mercury-edit-2')
			}
			if (event.affectsConfiguration(fimApiKeySetting)) {
				setApiKey(configService.getValue<string>(fimApiKeySetting) ?? '')
			}
		})
		return () => disposable.dispose()
	}, [configService])

	const save = (nextRef: string) => {
		setRef(nextRef)
		const modelID = nextRef.includes('/') ? nextRef.slice(nextRef.lastIndexOf('/') + 1) : nextRef
		configService.updateValue(loopholeCliModelSettingId('autocompletion'), nextRef)
		configService.updateValue(fimModelSetting, modelID || 'mercury-edit-2')
	}

	const saveKey = () => {
		configService.updateValue(fimApiKeySetting, apiKey)
		setMessage('Saved. Autocomplete stays off until a key is set and the feature is enabled.')
	}

	return <SettingsSection
		title='Autocomplete'
		description='Inline completions use the Inception FIM API. The CLI model list supplies the picker; the model id alone is sent to Inception.'
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

		<div className='flex flex-col gap-2 max-w-md mt-4'>
			<div className='text-sm text-loophole-fg-1'>Inception API key</div>
			<VoidSimpleInputBox
				value={apiKey}
				onChangeValue={setApiKey}
				placeholder='Inception API Key'
				passwordBlur={true}
				compact={true}
			/>
			<div className='flex items-center gap-2'>
				<VoidButtonBgDarken className='px-3 py-1 w-fit' onClick={saveKey}>Save</VoidButtonBgDarken>
				{message ? <SettingsNote>{message}</SettingsNote> : null}
			</div>
		</div>
	</SettingsSection>
}
