/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { useAccessor, useSettingsState } from '../../util/services.js'
import { VoidButtonBgDarken, VoidInputBox2, VoidSwitch } from '../../util/inputs.js'
import { loopholeCliModelSettingId } from '../../../../loopholeConfiguration.js'
import { CliModelSelect, useCliModels } from './CliModelSelect.js'
import { useCliConfig } from './CliConfig.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'

/** Commit message settings: which model writes it and the prompt/rules sent with the diff. */
export const CliCommitMessageTab = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()
	const { models, loading, error } = useCliModels()
	const { config, loading: configLoading, error: configError, update, reload } = useCliConfig()

	const [model, setModel] = useState(() => configService.getValue<string>(loopholeCliModelSettingId('commitMessage')) ?? '')
	const [prompt, setPrompt] = useState('')
	const [message, setMessage] = useState<string | null>(null)

	useEffect(() => {
		setPrompt(config?.commit_message?.prompt ?? '')
	}, [config])

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(loopholeCliModelSettingId('commitMessage'))) return
			setModel(configService.getValue<string>(loopholeCliModelSettingId('commitMessage')) ?? '')
		})
		return () => disposable.dispose()
	}, [configService])

	const saveModel = (value: string) => {
		configService.updateValue(loopholeCliModelSettingId('commitMessage'), value)
		voidSettingsService.setGlobalSetting('syncSCMToChat', false)
		setModel(value)
		accessor.get('IChatThreadService').clearCliSessionId(accessor.get('IChatThreadService').state.currentThreadId)
	}

	const savePrompt = async () => {
		setMessage(null)
		await update({ commit_message: { prompt } })
		setMessage('Saved to the CLI config.')
	}

	return <SettingsSection
		title='Commit Message'
		description='The commit message generator uses the Loophole CLI. Its prompt is stored in the CLI config.'
	>
		{configLoading ? <SettingsNote>Reading the CLI config...</SettingsNote> : null}
		{configError ? <div className='text-xs text-loophole-fg-3 mb-2'>CLI: {configError} <button className='underline' onClick={reload}>Check again</button></div> : null}

		<SettingsList>
			<SettingsRow label='Use the default chat model' description='When off, commit messages use their own model.'>
				<VoidSwitch
					size='xs'
					value={settingsState.globalSettings.syncSCMToChat}
					onChange={(next) => voidSettingsService.setGlobalSetting('syncSCMToChat', next)}
				/>
			</SettingsRow>
			<SettingsRow label='Model' description={loading ? 'Loading models...' : error ? error : 'Choosing a model turns off “Use the default chat model”.'}>
				<CliModelSelect
					value={model}
					models={models}
					onChange={saveModel}
					allowDefault={true}
				/>
			</SettingsRow>
		</SettingsList>

		<div className='mt-6'>
			<div className='text-base text-loophole-fg-1'>Prompt / rules</div>
			<div className='text-sm text-loophole-fg-3 mt-1'>
				Optional custom prompt. When empty, the CLI uses its conventional-commits prompt.
			</div>
			<div className='my-2'>
				{config ? <VoidInputBox2
					className='min-h-[81px] p-3 rounded-sm'
					initValue={prompt}
					placeholder='Write a short conventional commit message focused on intent.'
					multiline
					onChangeText={(next) => {
						setPrompt(next)
						setMessage(null)
					}}
				/> : null}
			</div>
			<div className='flex items-center gap-2'>
				<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void savePrompt() }} disabled={!config}>Save prompt</VoidButtonBgDarken>
				{message ? <SettingsNote>{message}</SettingsNote> : null}
			</div>
		</div>
	</SettingsSection>
}
