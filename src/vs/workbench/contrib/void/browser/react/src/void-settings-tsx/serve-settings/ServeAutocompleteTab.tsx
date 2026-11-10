/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSimpleInputBox, VoidSwitch } from '../../util/inputs.js'

const fimEnabledSetting = 'loophole.fim.enabled'
const fimModelSetting = 'loophole.fim.model'
const fimApiKeySetting = 'loophole.fim.apiKey'

/** Inline completion (FIM) settings: enable switch, Inception model, and API key. */
export const ServeAutocompleteTab = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')

	const [enabled, setEnabled] = useState(() => configService.getValue<boolean>(fimEnabledSetting) !== false)
	const [model, setModel] = useState(() => configService.getValue<string>(fimModelSetting) ?? 'mercury-edit-2')
	const [apiKey, setApiKey] = useState(() => configService.getValue<string>(fimApiKeySetting) ?? '')
	const [message, setMessage] = useState<string | null>(null)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(fimEnabledSetting) && !event.affectsConfiguration(fimModelSetting) && !event.affectsConfiguration(fimApiKeySetting)) return
			setEnabled(configService.getValue<boolean>(fimEnabledSetting) !== false)
			setModel(configService.getValue<string>(fimModelSetting) ?? 'mercury-edit-2')
			setApiKey(configService.getValue<string>(fimApiKeySetting) ?? '')
		})
		return () => disposable.dispose()
	}, [configService])

	const save = () => {
		configService.updateValue(fimModelSetting, model.trim() || 'mercury-edit-2')
		configService.updateValue(fimApiKeySetting, apiKey)
		setMessage('Saved. Autocomplete stays off until a key is set and the feature is enabled.')
	}

	return <div>
		<h2 className='text-3xl mb-2'>Autocomplete</h2>
		<div className='text-sm text-loophole-fg-3 mb-4'>
			Inline completions use the Inception FIM API. The default model is mercury-edit-2.
		</div>

		<div className='flex items-center gap-x-2 my-2'>
			<VoidSwitch
				size='xs'
				value={enabled}
				onChange={(next) => {
					configService.updateValue(fimEnabledSetting, next)
					setEnabled(next)
				}}
			/>
			<span className='text-loophole-fg-3 text-xs pointer-events-none'>{enabled ? 'Enabled' : 'Disabled'}</span>
		</div>

		<div className='flex flex-col gap-2 max-w-md mt-4'>
			<div className='text-sm text-loophole-fg-1'>Model</div>
			<VoidSimpleInputBox
				value={model}
				onChangeValue={setModel}
				placeholder='mercury-edit-2'
				compact={true}
			/>
			<div className='text-sm text-loophole-fg-1 mt-2'>Inception API key</div>
			<VoidSimpleInputBox
				value={apiKey}
				onChangeValue={setApiKey}
				placeholder='Inception API Key'
				passwordBlur={true}
				compact={true}
			/>
			<VoidButtonBgDarken className='px-3 py-1 w-fit' onClick={save}>Save</VoidButtonBgDarken>
			{message ? <div className='text-xs text-loophole-fg-3'>{message}</div> : null}
		</div>
	</div>
}
