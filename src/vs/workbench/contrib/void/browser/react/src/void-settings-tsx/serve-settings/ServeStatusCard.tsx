/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken } from '../../util/inputs.js'
import type { LoopholeServeStatus } from '../../../../../common/loopholeServeTypes.js'

const connectedColor = (status: LoopholeServeStatus['status']) => {
	if (status === 'connected') return 'bg-green-500'
	if (status === 'starting') return 'bg-yellow-500'
	if (status === 'error') return 'bg-red-500'
	return 'bg-loophole-fg-3'
}

/** Small banner for the Loophole Serve process: status, port, binary, last error, connect/disconnect. */
export const ServeStatusCard = ({ onChange }: { onChange?: () => void }) => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const serveService = accessor.get('ILoopholeServeService')

	const [status, setStatus] = useState<LoopholeServeStatus>({ status: 'disconnected' })
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const connect = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			const next = await serveService.connect()
			setStatus(next)
			if (next.status === 'error' && next.error) setError(next.error)
			onChange?.()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [serveService, onChange])

	const disconnect = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			await serveService.disconnect()
			setStatus(await serveService.status())
			onChange?.()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [serveService, onChange])

	const refresh = useCallback(async () => {
		setError(null)
		try {
			setStatus(await serveService.status())
			onChange?.()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [serveService, onChange])

	// Auto-connect when settings open so provider/model lists are populated without a manual click.
	useEffect(() => {
		let cancelled = false
		const run = async () => {
			if (configService.getValue<boolean>('loophole.serve.enabled') !== true) return
			try {
				const next = await serveService.status()
				if (cancelled) return
				setStatus(next)
				if (next.status === 'connected' || next.status === 'starting') return
				await connect()
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e))
			}
		}
		void run()
		return () => { cancelled = true }
	}, [configService, serveService, connect])

	const shownError = error ?? status.error

	return <div className='border border-loophole-border-2 bg-loophole-bg-1 rounded-sm p-3 my-2'>
		<div className='flex items-center flex-wrap gap-2'>
			<span className={`w-2 h-2 rounded-full ${connectedColor(status.status)}`} />
			<span className='text-sm font-medium text-loophole-fg-1'>Loophole Serve</span>
			<span className='text-xs text-loophole-fg-3'>
				{status.status}
				{status.pid ? ` · pid ${status.pid}` : ''}
			</span>
			<div className='flex-1' />
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void connect() }} disabled={busy || status.status === 'connected' || status.status === 'starting'}>Connect</VoidButtonBgDarken>
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void disconnect() }} disabled={busy || status.status === 'disconnected'}>Disconnect</VoidButtonBgDarken>
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void refresh() }} disabled={busy}>Refresh</VoidButtonBgDarken>
		</div>

		<div className='text-xs text-loophole-fg-3 mt-2 flex flex-col gap-y-0.5'>
			{status.port !== undefined ? <span>Port: {status.port}</span> : null}
			{status.binaryPath ? <span className='truncate'>Binary: {status.binaryPath}</span> : null}
			{shownError ? <span className='text-red-500'>Last error: {shownError}</span> : null}
		</div>
	</div>
}
