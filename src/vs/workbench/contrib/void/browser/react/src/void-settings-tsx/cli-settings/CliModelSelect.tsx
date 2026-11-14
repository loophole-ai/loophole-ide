/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccessor } from '../../util/services.js'
import { VoidSimpleInputBox } from '../../util/inputs.js'
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

/**
 * Model picker with search.
 *
 * Every place that lists models uses this component, so the search box is
 * consistent: type to filter provider, model id, and display name. Used by the
 * Models / Autocomplete / Commit Message rows and by the composer.
 */
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
		// only exists as a fallback so the picker is never empty.
		if (allowDefault && models.length === 0) list.push({ value: '', label: 'CLI default', detail: 'Let the CLI choose' })
		for (const model of models) {
			list.push({ value: cliModelRef(model), label: model.name ?? model.modelID, detail: model.providerID })
		}
		if (value && !list.some(option => option.value === value)) {
			list.push({ value, label: value, detail: 'Custom model' })
		}
		if (onCustom) list.push({ value: '__custom__', label: 'Custom model...', detail: 'Enter a model id and provider' })
		return list
	}, [models, value, allowDefault, onCustom])

	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState('')
	const [pos, setPos] = useState<{ left: number, top: number, width: number } | null>(null)
	const box = useRef<HTMLDivElement>(null)
	const menu = useRef<HTMLDivElement>(null)
	const trigger = useRef<HTMLButtonElement>(null)

	const WIDTH = 340

	/**
	 * Open the list in a fixed-position portal.
	 *
	 * The composer and the settings rows both live inside containers with their own
	 * overflow and stacking context, so an absolutely positioned menu rendered in
	 * place was drawn behind the input box. A portal on document.body, positioned
	 * from the trigger, cannot be clipped by any ancestor.
	 */
	const openMenu = () => {
		const rect = trigger.current?.getBoundingClientRect()
		if (!rect) return
		const width = Math.min(WIDTH, window.innerWidth - 16)
		const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
		const below = rect.bottom + 4
		const openUp = below + 320 > window.innerHeight
		setPos({ left, top: openUp ? Math.max(8, rect.top - 324) : below, width })
		setOpen(true)
	}

	useEffect(() => {
		if (!open) return
		const close = (event: MouseEvent) => {
			const target = event.target as Node
			if (box.current?.contains(target) || menu.current?.contains(target)) return
			setOpen(false)
		}
		const onResize = () => setOpen(false)
		window.addEventListener('mousedown', close)
		window.addEventListener('resize', onResize)
		return () => {
			window.removeEventListener('mousedown', close)
			window.removeEventListener('resize', onResize)
		}
	}, [open])

	const query = search.trim().toLowerCase()
	const filtered = query
		? options.filter((option) => `${option.value} ${option.label}`.toLowerCase().includes(query))
		: options
	const selected = options.find((option) => option.value === value)

	const pick = (option: CliModelOption) => {
		setOpen(false)
		setSearch('')
		if (option.value === '__custom__') {
			onCustom?.()
			return
		}
		onChange(option.value)
	}

	return <div ref={box} className='relative'>
		<button
			ref={trigger}
			type='button'
			onClick={() => (open ? setOpen(false) : openMenu())}
			className={className ?? 'text-xs text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-1 rounded-md px-2 py-1'}
			title={selected?.label ?? value}
		>
			{selected?.label ?? (value || 'Select model')}
		</button>

		{open && pos ? createPortal(<div
			ref={menu}
			className='rounded-md border border-loophole-border-1 bg-loophole-bg-2-alt shadow-lg overflow-hidden'
			style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 1000000 }}
		>
			<div className='p-2 border-b border-loophole-border-2'>
				<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder='Search models' compact={true} />
			</div>
			<div className='max-h-[280px] overflow-y-auto py-1'>
				{filtered.length === 0
					? <div className='px-3 py-2 text-xs text-loophole-fg-3'>No matching models</div>
					: filtered.map((option, index) => <button
						key={`${option.value}:${index}`}
						type='button'
						onClick={() => pick(option)}
						className={`w-full text-left px-3 py-1.5 hover:bg-loophole-bg-2 ${option.value === value ? 'text-loophole-fg-1' : 'text-loophole-fg-2'}`}
					>
						<div className='text-sm'>{option.label}</div>
						{option.detail ? <div className='text-xs text-loophole-fg-3'>{option.detail}</div> : null}
					</button>)}
			</div>
		</div>, document.body) : null}
	</div>
}
