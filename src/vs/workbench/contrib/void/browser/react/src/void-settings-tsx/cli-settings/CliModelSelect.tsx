/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidCustomDropdownBox } from '../../util/inputs.js'
import { LoopholeCliEnabledModelsSettingId, LoopholeCliCustomProvidersSettingId, type LoopholeCliCustomProvider } from './cliSettingIds.js'
import type { LoopholeCliModelInfo } from '../../../../../common/loopholeCliTypes.js'

export type CliModelOption = {
	value: string
	label: string
	detail?: string
}

export const cliModelRef = (model: LoopholeCliModelInfo) => `${model.providerID}/${model.modelID}`

/** Ids (`providerID/modelID`) of models the user switched on in Settings > Models. */
export const useEnabledCliModels = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const read = () => configService.getValue<string[]>(LoopholeCliEnabledModelsSettingId) ?? []
	const [enabled, setEnabled] = useState<string[]>(read)
	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(LoopholeCliEnabledModelsSettingId)) return
			setEnabled(read())
		})
		return () => disposable.dispose()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [configService])

	// One write per change, even when a provider switch flips hundreds of models.
	const setMany = useCallback((refs: string[], on: boolean) => {
		const current = new Set(read())
		for (const ref of refs) on ? current.add(ref) : current.delete(ref)
		const next = [...current]
		configService.updateValue(LoopholeCliEnabledModelsSettingId, next)
		setEnabled(next)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [configService])
	const toggle = useCallback((ref: string) => setMany([ref], !read().includes(ref)), [setMany])
	return { enabled, toggle, setMany }
}

/**
 * Models the pickers offer: only the ones the user checked. `pinned` refs (the
 * models currently assigned to a role) are always kept so a selection never
 * disappears from its own dropdown just because it was never checked.
 */
export const visibleCliModels = (models: LoopholeCliModelInfo[], enabled: string[], pinned: string[] = []) => {
	if (enabled.length === 0 && pinned.length === 0) return []
	const allowed = new Set([...enabled, ...pinned])
	return models.filter((model) => allowed.has(cliModelRef(model)))
}

/** Model list + connection state shared by the Models, Autocomplete, and Commit Message pages. */
// Shared cache: every page that mounts asks for the same list and one fetch is
// 250 KB of JSON. Serving it from a short-lived cache keeps opening Settings from
// parsing it four or five times in the same breath.
let cachedModels: LoopholeCliModelInfo[] | undefined
let cachedAt = 0
const CACHE_MS = 30_000

export const clearCliModelsCache = () => {
	cachedModels = undefined
	cachedAt = 0
}

export const useCliModels = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const cliService = accessor.get('ILoopholeCliService')

	const [models, setModels] = useState<LoopholeCliModelInfo[]>(() => cachedModels ?? [])
	const [loading, setLoading] = useState(() => !cachedModels)
	const [error, setError] = useState<string | null>(null)
	const [version, setVersion] = useState(0)

	const reload = useCallback(() => {
		cachedModels = undefined
		cachedAt = 0
		setVersion(v => v + 1)
	}, [])

	useEffect(() => {
		let cancelled = false
		const load = async () => {
			if (cachedModels && Date.now() - cachedAt < CACHE_MS) {
				if (!cancelled) {
					setModels(cachedModels)
					setLoading(false)
				}
				return
			}
			setLoading(true)
			setError(null)
			try {
				if (configService.getValue<boolean>('loophole.cli.enabled') === false) {
					throw new Error('The Loophole CLI is disabled in Settings.')
				}
				const status = await cliService.status()
				const next = status.status === 'connected' ? status : await cliService.connect()
				if (next.status !== 'connected') {
					throw new Error(next.error ?? 'The Loophole CLI is not connected.')
				}
				const list = await cliService.models()
				cachedModels = list
				cachedAt = Date.now()
				if (!cancelled) {
					// Providers added on the Providers page are endpoints the editor owns,
					// so their models are appended to what the CLI reports.
					const custom = configService.getValue<LoopholeCliCustomProvider[]>(LoopholeCliCustomProvidersSettingId) ?? []
					const extra: LoopholeCliModelInfo[] = custom.map((entry) => ({
						id: `${entry.id}/${entry.model}`,
						providerID: entry.id,
						modelID: entry.model,
						name: `${entry.name} (${entry.model})`,
					}))
					const known = new Set(list.map((model) => `${model.providerID}/${model.modelID}`))
					setModels([...list, ...extra.filter((model) => !known.has(model.id))])
				}
			} catch (e) {
				if (!cancelled) {
					setModels([])
					setError(e instanceof Error ? e.message : String(e))
				}
			} finally {
				if (!cancelled) setLoading(false)
			}
		}
		void load()
		return () => { cancelled = true }
	}, [cliService, configService, version])

	return { models, loading, error, reload }
}

/** Dropdown over the CLI model list using the editor's standard dropdown component. */
export const CliModelSelect = ({ value, models, onChange, onCustom, onManage, allowDefault = true, className }: {
	value: string
	models: LoopholeCliModelInfo[]
	onChange: (value: string) => void
	onCustom?: () => void
	/** Adds a pinned "Manage models..." entry that opens Settings > Models (where models are switched on). */
	onManage?: () => void
	allowDefault?: boolean
	className?: string
}) => {
	const options = useMemo(() => {
		const list: CliModelOption[] = []
		// With real models available the list is the models themselves; "default"
		// only exists as a fallback so the picker is never empty.
		if (allowDefault && models.length === 0) list.push({ value: '', label: 'Default', detail: 'Let the CLI choose' })
		for (const model of models) {
			list.push({ value: cliModelRef(model), label: model.name ?? model.modelID, detail: model.providerID })
		}
		if (value && !list.some(option => option.value === value)) {
			list.push({ value, label: value, detail: 'Custom model' })
		}
		if (onCustom) list.push({ value: '__custom__', label: 'Custom model...', detail: 'Enter a model id and provider' })
		if (onManage) list.push({ value: '__manage__', label: 'Manage models...', detail: models.length === 0 ? 'No models enabled yet' : 'Choose which models appear here' })
		return list
	}, [models, value, allowDefault, onCustom, onManage])

	const selected = options.find(option => option.value === value) ?? options[0]

	return <VoidCustomDropdownBox
		className={className ?? 'text-xs text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-1 rounded-md p-0.5 px-1'}
		options={options}
		selectedOption={selected}
		onChangeOption={(option) => {
			if (option.value === '__custom__') {
				onCustom?.()
				return
			}
			if (option.value === '__manage__') {
				onManage?.()
				return
			}
			onChange(option.value)
		}}
		getOptionDisplayName={(option) => option.label}
		getOptionDropdownName={(option) => option.label}
		getOptionDropdownDetail={(option) => option.detail ?? ''}
		getOptionsEqual={(a, b) => a.value === b.value}
		matchInputWidth={false}
		searchable={models.length > 6}
		searchPlaceholder='Search models...'
		isPinnedOption={(option) => option.value === '__custom__' || option.value === '__manage__'}
	/>
}
