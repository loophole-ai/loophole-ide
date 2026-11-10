/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidCustomDropdownBox } from '../../util/inputs.js'
import type { LoopholeServeModelInfo } from '../../../../../common/loopholeServeTypes.js'

type ModelOption = {
	key: string
	label: string
	detail?: string
}

/** Composer model picker fed by the Loophole Serve model list. Writes `loophole.serve.model`. */
export const ServeModelPicker = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const serveService = accessor.get('ILoopholeServeService')

	const [models, setModels] = useState<LoopholeServeModelInfo[]>([])
	const [fallback, setFallback] = useState<LoopholeServeModelInfo | null>(null)
	const [current, setCurrent] = useState(() => configService.getValue<string>('loophole.serve.model') ?? '')

	const load = useCallback(async () => {
		const [list, defaultModel] = await Promise.all([
			serveService.models().catch(() => [] as LoopholeServeModelInfo[]),
			serveService.defaultModel().catch(() => null),
		])
		setModels(list)
		setFallback(defaultModel)
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

	const options = useMemo(() => {
		const defaultLabel = fallback ? `${fallback.name ?? fallback.modelID} (server default)` : 'Loophole Serve default'
		const list: ModelOption[] = [{ key: '', label: defaultLabel }]
		for (const model of models) {
			list.push({ key: `${model.providerID}/${model.modelID}`, label: model.name ?? model.modelID, detail: model.providerID })
		}
		if (current && !list.some((option) => option.key === current)) {
			list.push({ key: current, label: current })
		}
		return list
	}, [models, fallback, current])

	const selected = options.find((option) => option.key === current) ?? options[0]

	return <div onClick={() => { void load() }}>
		<VoidCustomDropdownBox
			options={options}
			selectedOption={selected}
			onChangeOption={(option) => {
				const next = option.key
				configService.updateValue('loophole.serve.model', next)
				setCurrent(next)
			}}
			getOptionDisplayName={(option) => option.label}
			getOptionDropdownName={(option) => option.label}
			getOptionDropdownDetail={(option) => option.detail ?? ''}
			getOptionsEqual={(a, b) => a.key === b.key}
			className={className}
			matchInputWidth={false}
		/>
	</div>
}
