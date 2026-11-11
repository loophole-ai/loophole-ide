/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import type { LoopholeCliConfig, LoopholeCliConfigUpdateParams } from '../../../../../common/loopholeCliTypes.js'

/** Reads and writes the CLI config, connecting first when needed. */
export const useCliConfig = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const cliService = accessor.get('ILoopholeCliService')

	const [config, setConfig] = useState<LoopholeCliConfig | null>(null)
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
				const current = await cliService.config()
				if (!cancelled) setConfig(current)
			} catch (e) {
				if (!cancelled) {
					setConfig(null)
					setError(e instanceof Error ? e.message : String(e))
				}
			} finally {
				if (!cancelled) setLoading(false)
			}
		}
		void load()
		return () => { cancelled = true }
	}, [cliService, configService, version])

	const update = useCallback(async (patch: LoopholeCliConfigUpdateParams) => {
		setError(null)
		try {
			await cliService.configUpdate(patch)
			setConfig(await cliService.config())
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [cliService])

	return { config, loading, error, update, reload }
}
