/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken } from '../../util/inputs.js'
import type { LoopholeCliStatus } from '../../../../../common/loopholeCliTypes.js'
import { SettingsStatus } from './CliSettingsRows.js'

export const cliStatusLabel = (status: LoopholeCliStatus['status']) => {
	if (status === 'connected') return 'Connected'
	if (status === 'starting') return 'Starting'
	if (status === 'error') return 'Error'
	return 'Not connected'
}

/** Small banner shared by the CLI-backed settings pages. */
export const CliStatusCard = ({ onChange }: { onChange?: () => void }) => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const cliService = accessor.get('ILoopholeCliService')

	const [status, setStatus] = useState<LoopholeCliStatus>({ status: 'disconnected' })
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const connect = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			const next = await cliService.connect()
			setStatus(next)
			if (next.status === 'error' && next.error) setError(next.error)
			onChange?.()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [cliService, onChange])

	const refresh = useCallback(async () => {
		setError(null)
		try {
			setStatus(await cliService.status())
			onChange?.()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [cliService, onChange])

	// Populate provider/model lists without a manual click, unless the user disabled the CLI.
	useEffect(() => {
		let cancelled = false
		const run = async () => {
			if (configService.getValue<boolean>('loophole.cli.enabled') === false) return
			const next = await cliService.status()
			if (cancelled) return
			setStatus(next)
			if (next.status === 'connected' || next.status === 'starting') return
			await connect()
		}
		void run()
		return () => { cancelled = true }
	}, [configService, cliService, connect])

	const shownError = error ?? status.error

	return <div className='border border-loophole-border-2 bg-loophole-bg-1 rounded-sm p-3 my-2'>
		<div className='flex items-center flex-wrap gap-3'>
			<SettingsStatus ok={status.status === 'connected'} label={`Loophole CLI: ${cliStatusLabel(status.status)}`} />
			<div className='flex-1' />
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void connect() }} disabled={busy || status.status === 'connected' || status.status === 'starting'}>Connect</VoidButtonBgDarken>
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void refresh() }} disabled={busy}>Check again</VoidButtonBgDarken>
		</div>
		{shownError ? <div className='text-xs text-loophole-fg-3 mt-2'>Last error: {shownError}</div> : null}
	</div>
}
