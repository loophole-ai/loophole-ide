/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { VoidButtonBgDarken, VoidSimpleInputBox, VoidSwitch } from '../../util/inputs.js'
import { useCliConfig } from './CliConfig.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'

/** Context/compaction settings backed by the CLI's `compaction` config block. */
export const CliContextTab = () => {
	const { config, loading, error, update, reload } = useCliConfig()
	const [threshold, setThreshold] = useState('')

	useEffect(() => {
		setThreshold(config?.compaction?.threshold_percent != null ? String(config.compaction.threshold_percent) : '')
	}, [config])

	const auto = config?.compaction?.auto !== false
	const prune = config?.compaction?.prune !== false

	const saveThreshold = () => {
		const value = Number(threshold)
		if (threshold.trim() === '' || Number.isNaN(value) || value <= 0 || value > 100) return
		void update({ compaction: { ...(config?.compaction ?? {}), threshold_percent: value } })
	}

	return <SettingsSection
		title='Context'
		description='Compaction is owned by the Loophole CLI. These controls write its compaction config.'
	>
		{loading ? <SettingsNote>Reading the CLI config...</SettingsNote> : null}
		{error ? <div className='text-xs text-loophole-fg-3 mb-2'>CLI: {error} <button className='underline' onClick={reload}>Check again</button></div> : null}

		<SettingsList>
			<SettingsRow label='Auto-compaction' description='Compact the session automatically when the context window fills.'>
				<VoidSwitch
					size='xs'
					disabled={!config}
					value={auto}
					onChange={(next) => { void update({ compaction: { ...(config?.compaction ?? {}), auto: next } }) }}
				/>
			</SettingsRow>
			<SettingsRow label='Prune old tool output' description='Drop stale tool output before compacting.'>
				<VoidSwitch
					size='xs'
					disabled={!config}
					value={prune}
					onChange={(next) => { void update({ compaction: { ...(config?.compaction ?? {}), prune: next } }) }}
				/>
			</SettingsRow>
			<SettingsRow label='Compact at' description='Percentage of the context window that triggers auto-compaction (1-100). Leave empty for the CLI default.'>
				<div className='flex items-center gap-2'>
					<div className='w-16'>
						<VoidSimpleInputBox value={threshold} onChangeValue={setThreshold} placeholder='default' compact={true} />
					</div>
					<VoidButtonBgDarken className='px-3 py-1' onClick={saveThreshold} disabled={!config}>Save</VoidButtonBgDarken>
				</div>
			</SettingsRow>
			<SettingsRow label='Maximum context tokens' description='Not exposed by the CLI config. The CLI derives the window from the selected model.'>
				<span className='text-xs text-loophole-fg-3'>Unsupported</span>
			</SettingsRow>
		</SettingsList>

		<div className='mt-4'>
			<SettingsNote>The Context page only shows fields the CLI actually exposes. Model windows come from each provider's model metadata.</SettingsNote>
		</div>
	</SettingsSection>
}
