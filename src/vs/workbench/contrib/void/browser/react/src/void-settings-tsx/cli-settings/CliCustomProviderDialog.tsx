/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSimpleInputBox } from '../../util/inputs.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'
import { LoopholeCliCustomProvidersSettingId, type LoopholeCliCustomProvider } from './cliSettingIds.js'

/**
 * Add an OpenAI-compatible endpoint as a provider.
 *
 * The entry is stored in editor settings and merged into the CLI model list, so
 * it behaves like any other provider in the pickers. The CLI still has to know
 * the provider id to route a request: ids already known to the CLI (anything in
 * its provider catalog) work immediately, and a brand-new id is shown with a
 * clear error instead of silently failing.
 */
export const CliCustomProviderDialog = ({ onClose, onSaved }: { onClose: () => void, onSaved: () => void }) => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')

	const [id, setId] = useState('')
	const [name, setName] = useState('')
	const [baseURL, setBaseURL] = useState('')
	const [model, setModel] = useState('')
	const [apiKey, setApiKey] = useState('')
	const [error, setError] = useState<string | null>(null)

	const save = () => {
		const providerID = id.trim().toLowerCase().replace(/\s+/g, '-')
		const modelID = model.trim()
		if (!providerID) return setError('A provider id is required.')
		if (!modelID) return setError('At least one model id is required.')
		if (!baseURL.trim() && !apiKey.trim()) return setError('Enter a base URL or an API key.')
		const existing = configService.getValue<LoopholeCliCustomProvider[]>(LoopholeCliCustomProvidersSettingId) ?? []
		if (existing.some((entry) => entry.id === providerID)) return setError(`Provider "${providerID}" already exists.`)
		const entry: LoopholeCliCustomProvider = {
			id: providerID,
			name: name.trim() || providerID,
			baseURL: baseURL.trim() || undefined,
			model: modelID,
			apiKey: apiKey.trim() || undefined,
		}
		configService.updateValue(LoopholeCliCustomProvidersSettingId, [...existing, entry])
		onSaved()
		onClose()
	}

	return <div className='fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-16' onClick={onClose}>
		<div className='w-[520px] max-w-[92vw] rounded-sm border border-loophole-border-1 bg-loophole-bg-2-alt' onClick={(e) => e.stopPropagation()}>
			<div className='p-4'>
				<SettingsSection title='Custom provider' description='Add an OpenAI-compatible endpoint by its base URL and model id.'>
					<SettingsList>
						<SettingsRow label='Provider id' description='Used as the provider part of provider/model.'>
							<VoidSimpleInputBox value={id} onChangeValue={setId} placeholder='my-provider' compact={true} />
						</SettingsRow>
						<SettingsRow label='Display name'>
							<VoidSimpleInputBox value={name} onChangeValue={setName} placeholder='My Provider' compact={true} />
						</SettingsRow>
						<SettingsRow label='Base URL' description='OpenAI-compatible endpoint, e.g. https://api.example.com/v1'>
							<VoidSimpleInputBox value={baseURL} onChangeValue={setBaseURL} placeholder='https://api.example.com/v1' compact={true} />
						</SettingsRow>
						<SettingsRow label='Model id' description='The id sent upstream for this endpoint.'>
							<VoidSimpleInputBox value={model} onChangeValue={setModel} placeholder='gpt-4o-mini' compact={true} />
						</SettingsRow>
						<SettingsRow label='API key' description='Stored in your editor settings.'>
							<VoidSimpleInputBox value={apiKey} onChangeValue={setApiKey} placeholder='sk-...' compact={true} />
						</SettingsRow>
					</SettingsList>
					{error ? <div className='mt-2 text-xs text-loophole-fg-3'>{error}</div> : null}
					<div className='mt-3 flex items-center gap-2'>
						<VoidButtonBgDarken className='px-3 py-1' onClick={save}>Add provider</VoidButtonBgDarken>
						<VoidButtonBgDarken className='px-3 py-1' onClick={onClose}>Cancel</VoidButtonBgDarken>
					</div>
				</SettingsSection>
			</div>
		</div>
	</div>
}
