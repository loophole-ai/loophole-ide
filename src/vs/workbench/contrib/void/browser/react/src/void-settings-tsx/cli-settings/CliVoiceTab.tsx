/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSwitch } from '../../util/inputs.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'
import { loopholeCliModelSettingId } from './cliSettingIds.js'
import type { LoopholeCliVoiceModel } from '../../../../../common/loopholeCliTypes.js'

const VOICE_ENABLED_SETTING = 'loophole.voice.enabled'

/**
 * Voice input settings.
 *
 * Speech-to-text runs on a provider model through the CLI; there are no local
 * downloads any more. The page lists the transcription models the CLI reports as
 * available, remembers the choice in the `speechToText` role, and says plainly
 * when no provider is connected instead of failing on the first mic click.
 */
export const CliVoiceTab = () => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')
	const configService = accessor.get('IConfigurationService')

	const [models, setModels] = useState<LoopholeCliVoiceModel[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [enabled, setEnabled] = useState(() => configService.getValue<boolean>(VOICE_ENABLED_SETTING) !== false)
	const [selected, setSelected] = useState(() => configService.getValue<string>(loopholeCliModelSettingId('speechToText')) ?? '')

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const status = await cliService.status()
			const next = status.status === 'connected' ? status : await cliService.connect()
			if (next.status !== 'connected') {
				setModels([])
				setError(next.error ?? 'The Loophole CLI is not connected.')
				return
			}
			const result = await cliService.voiceModels()
			setModels(result.models ?? [])
			if (!selected && result.default) setSelected(result.default)
		} catch (e) {
			setModels([])
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setLoading(false)
		}
	}, [cliService, selected])

	useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

	const available = models.filter((model) => model.available)
	const current = available.find((model) => model.model === selected) ?? available[0]

	const choose = (model: LoopholeCliVoiceModel) => {
		setSelected(model.model)
		configService.updateValue(loopholeCliModelSettingId('speechToText'), `${model.provider}/${model.model}`)
	}

	return <SettingsSection
		title='Voice'
		description='Speech-to-text runs on a provider model through the Loophole CLI. Nothing is downloaded to this machine.'
	>
		<SettingsList>
			<SettingsRow label='Enable microphone' description='Show the mic button in the composer.'>
				<VoidSwitch
					size='xs'
					value={enabled}
					onChange={(next) => {
						configService.updateValue(VOICE_ENABLED_SETTING, next)
						setEnabled(next)
					}}
				/>
			</SettingsRow>

			<SettingsRow
				label='Speech to text model'
				description={loading
					? 'Loading transcription models...'
					: error
						? `Could not read voice models: ${error}`
						: available.length === 0
							? 'No transcription provider connected yet.'
							: current
								? `${current.provider} · ${current.model}`
								: 'Pick a model'}
			>
				{available.length === 0
					? <VoidButtonBgDarken className='px-3 py-1' onClick={() => { void load() }}>Check again</VoidButtonBgDarken>
					: <select
						className='text-sm bg-loophole-bg-1 text-loophole-fg-1 border border-loophole-border-1 rounded-md px-2 py-1'
						value={current?.model ?? ''}
						onChange={(event) => {
							const picked = available.find((model) => model.model === event.target.value)
							if (picked) choose(picked)
						}}
					>
						{available.map((model) => <option key={`${model.provider}/${model.model}`} value={model.model}>
							{model.provider} · {model.model}
						</option>)}
					</select>}
			</SettingsRow>
		</SettingsList>

		{available.length === 0 && !loading ? <div className='mt-3'>
			<SettingsNote>
				Voice needs a provider with a transcription model. Connect one on the Providers page, then press Check again.
			</SettingsNote>
		</div> : null}
	</SettingsSection>
}
