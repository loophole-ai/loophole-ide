/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidSimpleInputBox } from '../../util/inputs.js'
import { loopholeCliModelSettingId, type LoopholeCliModelRole } from './cliSettingIds.js'
import { CliModelSelect, cliModelRef, useCliModels, useDisabledCliModels, visibleCliModels } from './CliModelSelect.js'
import { CliCustomModelDialog } from './CliCustomModelDialog.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection, SettingsSlider } from './CliSettingsRows.js'

const roles: { role: LoopholeCliModelRole, label: string, description: string }[] = [
	{ role: 'default', label: 'Default', description: 'Chat, agents, and every request without a more specific role.' },
	{ role: 'small', label: 'Small / fast', description: 'Titles, summaries, and other quick background work.' },
	{ role: 'subagent', label: 'Subagent', description: 'Model task-tool subagents run on by default.' },
	{ role: 'autocompletion', label: 'Autocompletion', description: 'Inline completion suggestions in the editor.' },
	{ role: 'speechToText', label: 'Speech to text', description: 'Transcribes your voice input.' },
]

/** Agent role models, all chosen from the CLI model list. */
export const CliModelsTab = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const chatThreadService = accessor.get('IChatThreadService')
	const cliService = accessor.get('ILoopholeCliService')
	const { models, loading, error, reload } = useCliModels()
	const { disabled, toggle } = useDisabledCliModels()
	const [search, setSearch] = useState('')
	const query = search.trim().toLowerCase()
	const enabled = useMemo(() => {
		const visible = visibleCliModels(models, disabled)
		if (!query) return visible
		return visible.filter((model) =>
			`${model.providerID}/${model.modelID} ${model.name ?? ''}`.toLowerCase().includes(query),
		)
	}, [models, disabled, query])
	const allEnabled = useMemo(() => visibleCliModels(models, disabled), [models, disabled])
	const [saveError, setSaveError] = useState<string | null>(null)

	const [values, setValues] = useState<Record<string, string>>(() => {
		const next: Record<string, string> = {}
		for (const { role } of roles) next[role] = configService.getValue<string>(loopholeCliModelSettingId(role)) ?? ''
		return next
	})
	const [editing, setEditing] = useState<LoopholeCliModelRole | null>(null)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!roles.some(({ role }) => event.affectsConfiguration(loopholeCliModelSettingId(role)))) return
			const next: Record<string, string> = {}
			for (const { role } of roles) next[role] = configService.getValue<string>(loopholeCliModelSettingId(role)) ?? ''
			setValues(next)
		})
		return () => disposable.dispose()
	}, [configService])

	const save = (role: LoopholeCliModelRole, value: string) => {
		configService.updateValue(loopholeCliModelSettingId(role), value)
		if (role === 'default') configService.updateValue('loophole.cli.model', value)
		setValues(prev => ({ ...prev, [role]: value }))
		// Roles the CLI resolves itself are mirrored into its config.
		if (role === 'small' || role === 'subagent') {
			const patch = role === 'small' ? { small_model: value || null } : { subagent_model: value || null }
			void cliService.configUpdate(patch).then(() => setSaveError(null)).catch((e) => {
				setSaveError(e instanceof Error ? e.message : String(e))
			})
		}
		// A CLI session is bound to the model it was created with; start a fresh one next turn.
		chatThreadService.clearCliSessionId(chatThreadService.state.currentThreadId)
	}

	return <SettingsSection
		title='Models'
		description='Agent roles use models reported by the Loophole CLI. A CLI session is recreated when you change its model.'
	>
		{!loading && !error && models.length === 0 ? <SettingsNote>No models reported by the CLI. Connect a provider first.</SettingsNote> : null}
		{loading ? <SettingsNote>Loading models from the CLI...</SettingsNote> : null}
		{error ? <div className='text-xs text-loophole-fg-3 mb-2'>CLI: {error} <button className='underline' onClick={reload}>Check again</button></div> : null}
		{saveError ? <SettingsNote>CLI config: {saveError}</SettingsNote> : null}

		<SettingsList>
			{roles.map(({ role, label, description }) => <SettingsRow key={role} label={label} description={description}>
				<CliModelSelect
					value={values[role] ?? ''}
					models={enabled}
					onChange={(value) => save(role, value)}
					onCustom={() => setEditing(role)}
				/>
			</SettingsRow>)}
		</SettingsList>

		{models.length > 0 ? <div className='mt-6'>
			<div className='text-sm text-loophole-fg-1 mb-1'>Available models</div>
			<div className='text-xs text-loophole-fg-3 mb-3'>Switch a model off to hide it from every picker. {allEnabled.length} of {models.length} shown.</div>
			<div className='mb-2 max-w-sm'>
				<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder='Search models' compact={true} />
			</div>
			<SettingsList>
				{models
					.filter((model) => !query || `${model.providerID}/${model.modelID} ${model.name ?? ''}`.toLowerCase().includes(query))
					.map((model) => {
					const ref = cliModelRef(model)
					const on = !disabled.includes(ref)
					return <SettingsRow
						key={ref}
						label={model.name ?? model.modelID}
						description={<span className='text-loophole-fg-3'>{model.providerID} · {model.modelID}</span>}
					>
						<SettingsSlider checked={on} label={`Show ${model.name ?? model.modelID}`} onChange={() => toggle(ref)} />
					</SettingsRow>
				})}
			</SettingsList>
		</div> : null}

		{editing ? <CliCustomModelDialog
			value={values[editing] ?? ''}
			onClose={() => setEditing(null)}
			onSave={(ref) => {
				save(editing, ref)
				setEditing(null)
			}}
		/> : null}
	</SettingsSection>
}
