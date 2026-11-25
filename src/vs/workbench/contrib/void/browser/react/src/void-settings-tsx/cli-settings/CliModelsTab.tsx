/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidSimpleInputBox } from '../../util/inputs.js'
import { loopholeCliModelSettingId, type LoopholeCliModelRole } from './cliSettingIds.js'
import type { LoopholeCliModelInfo } from '../../../../../common/loopholeCliTypes.js'
import { CliModelSelect, cliModelRef, useCliModels, useEnabledCliModels, visibleCliModels } from './CliModelSelect.js'
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
	const { enabled: enabledRefs, toggle, setMany } = useEnabledCliModels()
	const [search, setSearch] = useState('')
	const query = search.trim().toLowerCase()
	// Providers whose model list the user opened. Collapsed by default so a provider
	// with hundreds of models never mounts hundreds of rows.
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const [saveError, setSaveError] = useState<string | null>(null)

	const [values, setValues] = useState<Record<string, string>>(() => {
		const next: Record<string, string> = {}
		for (const { role } of roles) next[role] = configService.getValue<string>(loopholeCliModelSettingId(role)) ?? ''
		return next
	})
	const [editing, setEditing] = useState<LoopholeCliModelRole | null>(null)

	// Role dropdowns offer only checked models; whatever a role already uses stays listed.
	const pinned = useMemo(() => Object.values(values).filter(Boolean), [values])
	const roleModels = useMemo(() => visibleCliModels(models, enabledRefs, pinned), [models, enabledRefs, pinned])

	// Models grouped by provider, filtered by the search box. A search opens every
	// group that has a match so results are never hidden behind a collapsed header.
	const enabledSet = useMemo(() => new Set(enabledRefs), [enabledRefs])
	const groups = useMemo(() => {
		const byProvider = new Map<string, LoopholeCliModelInfo[]>()
		for (const model of models) {
			const list = byProvider.get(model.providerID)
			if (list) list.push(model)
			else byProvider.set(model.providerID, [model])
		}
		return [...byProvider.entries()]
			.map(([providerID, all]) => {
				const shown = query
					? all.filter((model) => `${model.providerID}/${model.modelID} ${model.name ?? ''}`.toLowerCase().includes(query))
					: all
				return { providerID, all, shown, on: all.filter((model) => enabledSet.has(cliModelRef(model))).length }
			})
			.filter((group) => group.shown.length > 0)
			.sort((a, b) => a.providerID.localeCompare(b.providerID))
	}, [models, query, enabledSet])

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
					models={roleModels}
					onChange={(value) => save(role, value)}
					onCustom={() => setEditing(role)}
				/>
			</SettingsRow>)}
		</SettingsList>

		{models.length > 0 ? <div className='mt-6'>
			<div className='text-sm text-loophole-fg-1 mb-1'>Available models</div>
			<div className='text-xs text-loophole-fg-3 mb-3'>Models start switched off. Switch on the ones you want and only those appear in the model pickers. {enabledRefs.length} enabled of {models.length}.</div>
			<div className='mb-2 max-w-sm'>
				<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder='Search models' compact={true} />
			</div>
			{groups.length === 0 ? <SettingsNote>No models match "{search}".</SettingsNote> : <SettingsList>
				{groups.map(({ providerID, all, shown, on }) => {
					const open = !!query || !!expanded[providerID]
					const providerRefs = all.map(cliModelRef)
					return <div key={providerID} className='border-b border-loophole-border-2 last:border-b-0'>
						<div className='flex items-center justify-between gap-3 py-3 px-4'>
							<button
								type='button'
								className='flex items-center gap-2 min-w-0 text-left'
								aria-expanded={open}
								onClick={() => setExpanded(prev => ({ ...prev, [providerID]: !prev[providerID] }))}
							>
								<span className='text-loophole-fg-3 text-xs w-3'>{open ? '\u25BE' : '\u25B8'}</span>
								<span className='text-[15px] text-loophole-fg-1 truncate'>{providerID}</span>
								<span className='text-[13px] text-loophole-fg-3 shrink-0'>{on} of {all.length} enabled</span>
							</button>
							<SettingsSlider
								checked={on === all.length}
								label={`Enable all ${providerID} models`}
								onChange={(checked) => setMany(providerRefs, checked)}
							/>
						</div>
						{open ? <div className='border-t border-loophole-border-2'>
							{shown.map((model) => {
								const ref = cliModelRef(model)
								return <SettingsRow
									key={ref}
									label={model.name ?? model.modelID}
									description={<span className='text-loophole-fg-3'>{model.modelID}</span>}
								>
									<SettingsSlider checked={enabledSet.has(ref)} label={`Show ${model.name ?? model.modelID}`} onChange={() => toggle(ref)} />
								</SettingsRow>
							})}
						</div> : null}
					</div>
				})}
			</SettingsList>}
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
