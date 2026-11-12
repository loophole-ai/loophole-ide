/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidCustomDropdownBox } from '../../util/inputs.js'
import { LoopholeCliDisabledModelsSettingId, LoopholeCliCustomProvidersSettingId, type LoopholeCliCustomProvider } from './cliSettingIds.js'
import type { LoopholeCliModelInfo } from '../../../../../common/loopholeCliTypes.js'

export type CliModelOption = {
	value: string
	label: string
	detail?: string
}

export const cliModelRef = (model: LoopholeCliModelInfo) => `${model.providerID}/${model.modelID}`

/** Ids of models the user switched off in Settings > Models. */
export const useDisabledCliModels = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const [disabled, setDisabled] = useState<string[]>(() =>
		configService.getValue<string[]>(LoopholeCliDisabledModelsSettingId) ?? [],
	)
	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(LoopholeCliDisabledModelsSettingId)) return
			setDisabled(configService.getValue<string[]>(LoopholeCliDisabledModelsSettingId) ?? [])
		})
		return () => disposable.dispose()
	}, [configService])
	const toggle = (ref: string) => {
		const next = disabled.includes(ref) ? disabled.filter((id) => id !== ref) : [...disabled, ref]
		configService.updateValue(LoopholeCliDisabledModelsSettingId, next)
		setDisabled(next)
	}
	return { disabled, toggle }
}

/** Models the user has left enabled, i.e. what every picker should offer. */
export const visibleCliModels = (models: LoopholeCliModelInfo[], disabled: string[]) =>
	models.filter((model) => !disabled.includes(cliModelRef(model)))

/** Model list + connection state shared by the Models, Autocomplete, and Commit Message pages. */
export const useCliModels = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const cliService = accessor.get('ILoopholeCliService')

	const [models, setModels] = useState<LoopholeCliModelInfo[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [version, setVersion] = useState(0)

	const reload = useCallback(() => { setVersion(v => v + 1) }, [])

	useEffect(() => {
		let cancelled = false
		const load = async () => {
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

/** Dropdown over the CLI model list with an optional Custom... entry. */
export const CliModelSelect = ({ value, models, onChange, onCustom, allowDefault = true, className }: {
	value: string
	models: LoopholeCliModelInfo[]
	onChange: (value: string) => void
	onCustom?: () => void
	allowDefault?: boolean
	className?: string
}) => {
	const options = useMemo(() => {
		const list: CliModelOption[] = []
		// With real models available the list is the models themselves; "default"
		// only exists as a fallback so the dropdown is never empty.
		if (allowDefault && models.length === 0) list.push({ value: '', label: 'CLI default', detail: 'Let the CLI choose' })
		for (const model of models) {
			list.push({ value: cliModelRef(model), label: model.name ?? model.modelID, detail: model.providerID })
		}
		if (value && !list.some(option => option.value === value)) {
			list.push({ value, label: value, detail: 'Custom model' })
		}
		if (onCustom) list.push({ value: '__custom__', label: 'Custom...', detail: 'Enter a model id and provider' })
		return list
	}, [models, value, allowDefault, onCustom])

	const selected = options.find(option => option.value === value) ?? options[0]

	return <VoidCustomDropdownBox
		className={className ?? 'text-xs text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-1 rounded p-0.5 px-1'}
		options={options}
		selectedOption={selected}
		onChangeOption={(option) => {
			if (option.value === '__custom__') {
				onCustom?.()
				return
			}
			onChange(option.value)
		}}
		getOptionDisplayName={(option) => option.label}
		getOptionDropdownName={(option) => option.label}
		getOptionDropdownDetail={(option) => option.detail ?? ''}
		getOptionsEqual={(a, b) => a.value === b.value}
		matchInputWidth={false}
	/>
}
