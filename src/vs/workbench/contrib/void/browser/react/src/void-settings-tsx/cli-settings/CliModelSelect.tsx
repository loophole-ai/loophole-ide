/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidCustomDropdownBox } from '../../util/inputs.js'
import { LoopholeCliEnabledModelsSettingId, LoopholeCliCustomProvidersSettingId, type LoopholeCliCustomProvider } from './cliSettingIds.js'
import type { LoopholeCliModelInfo } from '../../../../../common/loopholeCliTypes.js'
import type { ILoopholeCliService } from '../../../../../common/loopholeCliService.js'
import type { IConfigurationService } from '../../../../../../../../platform/configuration/common/configuration.js'

export type CliModelOption = {
	value: string
	label: string
	detail?: string
}

export const cliModelRef = (model: LoopholeCliModelInfo) => `${model.providerID}/${model.modelID}`

// ---------------------------------------------------------------------------
// Shared state
//
// The sidebar, Settings and quick-edit are separate bundles (tsup runs with `splitting: false`), so each one
// carries its own copy of this module. Plain module variables would therefore be per-bundle: Settings could
// clear "the cache" or toggle a model and the sidebar's picker would never hear about it. The state lives on a
// `Symbol.for` key of globalThis instead, so every bundle reads and writes the same object, and every mounted
// picker is told when it changes.
// ---------------------------------------------------------------------------
type CliModelsStore = {
	/** Bumped on every change; this is what React subscribes to. */
	version: number
	listeners: Set<() => void>
	/** Models reported by the CLI (custom providers are merged in by the hook). */
	list: LoopholeCliModelInfo[] | undefined
	/** When `list` was fetched; 0 marks it stale. */
	at: number
	error: string | null
	loading: boolean
	/** Bumped by every invalidation so a fetch that started earlier is dropped instead of overwriting newer state. */
	epoch: number
	attempts: number
	retryTimer: ReturnType<typeof setTimeout> | undefined
	/** Models checked in Settings > Models (`providerID/modelID`). */
	enabled: string[] | undefined
}

const store: CliModelsStore = ((globalThis as any)[Symbol.for('loophole.cliModelsStore')] ??= {
	version: 0,
	listeners: new Set<() => void>(),
	list: undefined,
	at: 0,
	error: null,
	loading: false,
	epoch: 0,
	attempts: 0,
	retryTimer: undefined,
	enabled: undefined,
} satisfies CliModelsStore)

const notify = () => {
	store.version++
	for (const listener of [...store.listeners]) listener()
}
const subscribe = (listener: () => void) => {
	store.listeners.add(listener)
	return () => { store.listeners.delete(listener) }
}
const getVersion = () => store.version

const readEnabled = (configService: IConfigurationService) => configService.getValue<string[]>(LoopholeCliEnabledModelsSettingId) ?? []
const readCustomProviders = (configService: IConfigurationService) => configService.getValue<LoopholeCliCustomProvider[]>(LoopholeCliCustomProvidersSettingId) ?? []
const sameRefs = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((ref, i) => ref === b[i])

/** Ids (`providerID/modelID`) of models the user switched on in Settings > Models. */
export const useEnabledCliModels = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	useSyncExternalStore(subscribe, getVersion)
	const enabled = store.enabled ?? (store.enabled = readEnabled(configService))

	// Also picks up edits made straight in settings.json.
	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(LoopholeCliEnabledModelsSettingId)) return
			const next = readEnabled(configService)
			if (sameRefs(store.enabled, next)) return
			store.enabled = next
			notify()
		})
		return () => disposable.dispose()
	}, [configService])

	// One write per change, even when a provider switch flips hundreds of models.
	// The shared state updates first so every picker reflects it immediately, in every bundle,
	// without waiting for the settings file to be written.
	const setMany = useCallback((refs: string[], on: boolean) => {
		const current = new Set(store.enabled ?? readEnabled(configService))
		for (const ref of refs) on ? current.add(ref) : current.delete(ref)
		const next = [...current]
		store.enabled = next
		notify()
		void Promise.resolve(configService.updateValue(LoopholeCliEnabledModelsSettingId, next)).catch(() => {
			// The write failed: fall back to what is really stored so the pickers never show a lie.
			store.enabled = readEnabled(configService)
			notify()
		})
	}, [configService])
	const toggle = useCallback((ref: string) => setMany([ref], !(store.enabled ?? []).includes(ref)), [setMany])
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

// A fetch is ~250 KB of JSON, so opening Settings should not parse it four or five times in the same breath.
const CACHE_MS = 30_000
// When the CLI is not up yet (the sidebar mounts before it finishes starting) the load fails. Retry a few times
// instead of leaving an empty dropdown until the sidebar is remounted.
const RETRY_BASE_MS = 3_000
const MAX_RETRIES = 4

/**
 * Marks the model list stale and tells every mounted picker (sidebar, Settings, ...) to reload it.
 * Call after anything that changes which models exist: a provider connected or removed, a custom provider
 * added, the CLI restarted. The old list stays on screen until the new one arrives.
 */
export const clearCliModelsCache = () => {
	store.epoch++
	store.at = 0
	store.error = null
	store.attempts = 0
	if (store.retryTimer) {
		clearTimeout(store.retryTimer)
		store.retryTimer = undefined
	}
	notify()
}

const scheduleRetry = () => {
	if (store.retryTimer || store.attempts >= MAX_RETRIES) return
	store.retryTimer = setTimeout(() => {
		store.retryTimer = undefined
		store.attempts++
		store.error = null // lets the next pass try again
		notify()
	}, RETRY_BASE_MS * 2 ** store.attempts)
}

const loadCliModels = (cliService: ILoopholeCliService, configService: IConfigurationService) => {
	if (store.loading) return
	store.loading = true
	const epoch = store.epoch
	notify()
	void (async () => {
		let list: LoopholeCliModelInfo[] | undefined
		let error: string | null = null
		try {
			if (configService.getValue<boolean>('loophole.cli.enabled') === false) {
				throw new Error('The Loophole CLI is disabled in Settings.')
			}
			const status = await cliService.status()
			const next = status.status === 'connected' ? status : await cliService.connect()
			if (next.status !== 'connected') {
				throw new Error(next.error ?? 'The Loophole CLI is not connected.')
			}
			list = await cliService.models()
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		}
		store.loading = false
		// If something invalidated the list while this was in flight, drop the result; the notify below reloads.
		if (epoch === store.epoch) {
			if (list) {
				store.list = list
				store.at = Date.now()
				store.error = null
				store.attempts = 0
			} else {
				store.list = undefined
				store.error = error
				scheduleRetry()
			}
		}
		notify()
	})()
}

/** Model list + connection state shared by the sidebar picker and the Models, Autocomplete, and Commit Message pages. */
export const useCliModels = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const cliService = accessor.get('ILoopholeCliService')

	const version = useSyncExternalStore(subscribe, getVersion)
	const [custom, setCustom] = useState<LoopholeCliCustomProvider[]>(() => readCustomProviders(configService))

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(LoopholeCliCustomProvidersSettingId)) setCustom(readCustomProviders(configService))
			if (event.affectsConfiguration('loophole.cli.enabled')) clearCliModelsCache()
		})
		return () => disposable.dispose()
	}, [configService])

	// Load whenever there is nothing fresh. Every change to the shared state re-runs this, so a
	// clearCliModelsCache() from anywhere makes every mounted picker reload.
	useEffect(() => {
		const fresh = store.list !== undefined && Date.now() - store.at < CACHE_MS
		if (!fresh && !store.error) loadCliModels(cliService, configService)
	}, [version, cliService, configService])

	const list = store.list
	// Providers added on the Providers page are endpoints the editor owns, so their models are
	// appended to what the CLI reports. Done here (not at fetch time) so adding or removing one shows instantly.
	const models = useMemo(() => {
		if (!list) return []
		const known = new Set(list.map(cliModelRef))
		const extra: LoopholeCliModelInfo[] = custom
			.map((entry) => ({
				id: `${entry.id}/${entry.model}`,
				providerID: entry.id,
				modelID: entry.model,
				name: `${entry.name} (${entry.model})`,
			}))
			.filter((model) => !known.has(model.id))
		return [...list, ...extra]
	}, [list, custom])

	const loading = store.loading || (!store.list && !store.error)
	return { models, loading, error: store.error, reload: clearCliModelsCache }
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
