/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import type { IConfigurationService } from '../../../../../../../../platform/configuration/common/configuration.js'
import { VoidSimpleInputBox } from '../../util/inputs.js'
import { loopholeCliModelSettingId } from './cliSettingIds.js'
import { cliModelRef, useCliModels, useDisabledCliModels, visibleCliModels } from './CliModelSelect.js'
import { CliCustomModelDialog } from './CliCustomModelDialog.js'
import type { LoopholeCliModelInfo } from '../../../../../common/loopholeCliTypes.js'

const readDefaultModel = (configService: IConfigurationService) => {
	const role = configService.getValue<string>(loopholeCliModelSettingId('default')) ?? ''
	return role || (configService.getValue<string>('loophole.cli.model') ?? '')
}

/**
 * Composer model picker with search.
 *
 * The list is the CLI model list minus anything switched off in Settings, and the
 * box filters provider, model id and display name so a long catalog stays usable.
 */
export const CliModelPicker = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const chatThreadService = accessor.get('IChatThreadService')
	const { models } = useCliModels()
	const { disabled } = useDisabledCliModels()
	const enabled = useMemo(() => visibleCliModels(models, disabled), [models, disabled])

	const [value, setValue] = useState(() => readDefaultModel(configService))
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState('')
	const [custom, setCustom] = useState(false)
	const boxRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(loopholeCliModelSettingId('default')) && !event.affectsConfiguration('loophole.cli.model')) return
			setValue(readDefaultModel(configService))
		})
		return () => disposable.dispose()
	}, [configService])

	useEffect(() => {
		if (!open) return
		const close = (event: MouseEvent) => {
			if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
		}
		window.addEventListener('mousedown', close)
		return () => window.removeEventListener('mousedown', close)
	}, [open])

	const choose = (next: string) => {
		configService.updateValue(loopholeCliModelSettingId('default'), next)
		configService.updateValue('loophole.cli.model', next)
		setValue(next)
		setOpen(false)
		setSearch('')
		chatThreadService.clearCliSessionId(chatThreadService.state.currentThreadId)
	}

	const query = search.trim().toLowerCase()
	const filtered = useMemo(() => {
		if (!query) return enabled
		return enabled.filter((model) =>
			`${model.providerID}/${model.modelID} ${model.name ?? ''}`.toLowerCase().includes(query),
		)
	}, [enabled, query])

	const current = enabled.find((model) => cliModelRef(model) === value)
	const label = current ? (current.name ?? current.modelID) : (value || 'Select model')

	return <div ref={boxRef} className='relative'>
		<button
			type='button'
			onClick={() => setOpen((next) => !next)}
			className={className ?? 'text-xs text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-1 rounded-md px-2 py-1'}
			title={value || 'Select model'}
		>
			{label}
		</button>

		{open ? <div className='absolute z-[9999999] mt-1 w-[320px] max-h-[360px] overflow-hidden rounded-md border border-loophole-border-1 bg-loophole-bg-2-alt shadow-lg'>
			<div className='p-2 border-b border-loophole-border-2'>
				<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder='Search models' compact={true} />
			</div>
			<div className='max-h-[280px] overflow-y-auto py-1'>
				{filtered.length === 0
					? <div className='px-3 py-2 text-xs text-loophole-fg-3'>No matching models</div>
					: filtered.map((model: LoopholeCliModelInfo) => {
						const ref = cliModelRef(model)
						return <button
							key={ref}
							type='button'
							onClick={() => choose(ref)}
							className={`w-full text-left px-3 py-1.5 hover:bg-loophole-bg-2 ${ref === value ? 'text-loophole-fg-1' : 'text-loophole-fg-2'}`}
						>
							<div className='text-sm'>{model.name ?? model.modelID}</div>
							<div className='text-xs text-loophole-fg-3'>{ref}</div>
						</button>
					})}
			</div>
			<div className='border-t border-loophole-border-2'>
				<button
					type='button'
					onClick={() => { setOpen(false); setCustom(true) }}
					className='w-full text-left px-3 py-2 text-xs text-loophole-fg-2 hover:bg-loophole-bg-2'
				>
					Custom model...
				</button>
			</div>
		</div> : null}

		{custom ? <CliCustomModelDialog
			value={value}
			onClose={() => setCustom(false)}
			onSave={(ref) => {
				choose(ref)
				setCustom(false)
			}}
		/> : null}
	</div>
}
