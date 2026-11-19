/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { useAccessor, useSettingsState } from '../../util/services.js'
import { VoidSwitch } from '../../util/inputs.js'
import type { LoopholeCliModelInfo } from '../../../../../common/loopholeCliTypes.js'
import { CliModelSelect } from './CliModelSelect.js'
import { SettingsList, SettingsRow, SettingsSection } from './CliSettingsRows.js'

const fimEnabledSetting = 'loophole.fim.enabled'
const fimModelSetting = 'loophole.fim.model'

/**
 * The Inception FIM endpoint serves exactly these models (anything else is a
 * 400). Chat models from the connected provider cannot do fill-in-the-middle,
 * so the picker offers only these four. Kilo does the same for its inline
 * autocomplete: it only ships Mercury models for FIM.
 */
const FIM_MODELS: LoopholeCliModelInfo[] = [
	{ id: 'inception/mercury-coder', providerID: 'inception', modelID: 'mercury-coder', name: 'Mercury Coder' },
	{ id: 'inception/mercury-coder-small', providerID: 'inception', modelID: 'mercury-coder-small', name: 'Mercury Coder Small' },
	{ id: 'inception/mercury-edit', providerID: 'inception', modelID: 'mercury-edit', name: 'Mercury Edit' },
	{ id: 'inception/mercury-edit-2', providerID: 'inception', modelID: 'mercury-edit-2', name: 'Mercury Edit 2' },
]

const DEFAULT_FIM_MODEL = 'mercury-edit-2'
const normalizeModel = (model: string) =>
	FIM_MODELS.some((entry) => entry.modelID === model) ? model : DEFAULT_FIM_MODEL

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

	const [enabled, setEnabled] = useState(() => settingsState.globalSettings.enableAutocomplete)
	const [ref, setRef] = useState(() =>
		normalizeModel(configService.getValue<string>(fimModelSetting) ?? ''),
	)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(fimModelSetting)) return
			setRef(normalizeModel(configService.getValue<string>(fimModelSetting) ?? ''))
		})
		return () => disposable.dispose()
	}, [configService])

	const save = (nextRef: string) => {
		const modelID = normalizeModel(nextRef.includes('/') ? nextRef.slice(nextRef.lastIndexOf('/') + 1) : nextRef)
		setRef(modelID)
		configService.updateValue(fimModelSetting, modelID)
	}

	return <SettingsSection
		title='Autocomplete'
		description='Inline completions use the Inception provider connected on the Providers page. Pick a fill-in-the-middle Mercury model here and turn the feature on.'
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
			<SettingsRow label='Model' description='Fill-in-the-middle models only. Default: mercury-edit-2.'>
				<CliModelSelect value={`inception/${ref}`} models={FIM_MODELS} onChange={save} allowDefault={false} />
			</SettingsRow>
		</SettingsList>
	</SettingsSection>
}
