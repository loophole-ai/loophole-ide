/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { ServeStatusCard } from './ServeStatusCard.js'
import type { LoopholeServeModelInfo, LoopholeServeProviderInfo } from '../../../../../common/loopholeServeTypes.js'

const refOfModel = (model: LoopholeServeModelInfo) => `${model.providerID}/${model.modelID}`

/** Chat model list from the server, grouped by provider. Selecting a row writes `loophole.serve.model`. */
export const ServeModelsTab = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const serveService = accessor.get('ILoopholeServeService')

	const [models, setModels] = useState<LoopholeServeModelInfo[]>([])
	const [providers, setProviders] = useState<LoopholeServeProviderInfo[]>([])
	const [current, setCurrent] = useState(() => configService.getValue<string>('loophole.serve.model') ?? '')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const status = await serveService.status()
			if (status.status !== 'connected') {
				setModels([])
				setProviders([])
				return
			}
			const [nextModels, nextProviders] = await Promise.all([
				serveService.models(),
				serveService.providers(),
			])
			setModels(nextModels)
			setProviders(nextProviders)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setLoading(false)
		}
	}, [serveService])

	useEffect(() => { void load() }, [load])

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('loophole.serve.model')) {
				setCurrent(configService.getValue<string>('loophole.serve.model') ?? '')
			}
		})
		return () => disposable.dispose()
	}, [configService])

	const groups = useMemo(() => {
		const byProvider = new Map<string, LoopholeServeModelInfo[]>()
		for (const model of models) {
			const list = byProvider.get(model.providerID) ?? []
			list.push(model)
			byProvider.set(model.providerID, list)
		}
		return [...byProvider.entries()]
	}, [models])

	const nameOfProvider = (providerID: string) =>
		providers.find((provider) => provider.id === providerID)?.name ?? providerID

	const choose = (value: string) => {
		configService.updateValue('loophole.serve.model', value)
		setCurrent(value)
	}

	return <div>
		<ServeStatusCard onChange={load} />

		{error ? <div className='text-xs text-red-500 my-2'>{error}</div> : null}
		{loading ? <div className='text-xs text-loophole-fg-3 my-2'>Loading models...</div> : null}

		<div className='text-xs text-loophole-fg-3 my-2'>
			Selection: {current || 'server default'}
		</div>

		<div className='border border-loophole-border-2 bg-loophole-bg-1 rounded-sm'>
			<button
				type='button'
				onClick={() => choose('')}
				className={`w-full text-left p-3 border-b border-loophole-border-2 last:border-b-0 hover:bg-black/5 dark:hover:bg-white/5 ${current === '' ? 'bg-[#0e70c0]/15' : ''}`}
			>
				<div className='text-sm text-loophole-fg-1'>Server default</div>
				<div className='text-xs text-loophole-fg-3'>Use whatever model the Loophole Serve server selects.</div>
			</button>

			{groups.map(([providerID, list]) => <div key={providerID}>
				<div className='px-3 py-1 text-xs font-medium text-loophole-fg-3 bg-loophole-bg-2'>
					{nameOfProvider(providerID)}
				</div>
				{list.map((model) => {
					const value = refOfModel(model)
					return <button
						key={value}
						type='button'
						onClick={() => choose(value)}
						className={`w-full text-left px-3 py-2 border-b border-loophole-border-2 last:border-b-0 hover:bg-black/5 dark:hover:bg-white/5 ${current === value ? 'bg-[#0e70c0]/15' : ''}`}
					>
						<div className='text-sm text-loophole-fg-1 truncate'>{model.name ?? model.modelID}</div>
						<div className='text-xs text-loophole-fg-3 truncate'>{value}{model.family ? ` · ${model.family}` : ''}</div>
					</button>
				})}
			</div>)}

			{models.length === 0 && !loading
				? <div className='text-sm text-loophole-fg-3 p-3'>No models reported by the server.</div>
				: null}
		</div>
	</div>
}
