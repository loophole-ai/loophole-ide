/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSwitch } from '../../util/inputs.js'
import type { LoopholeCliStatus } from '../../../../../common/loopholeCliTypes.js'
import { cliStatusLabel } from './CliStatusCard.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection, SettingsStatus } from './CliSettingsRows.js'

/** The CLI connection page: state, binary, version, and manual controls. */
const VoidSwitchForEnabled = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const [enabled, setEnabled] = useState(() => configService.getValue<boolean>('loophole.cli.enabled') !== false)
	return <VoidSwitch
		size='xs'
		value={enabled}
		onChange={(next) => {
			configService.updateValue('loophole.cli.enabled', next)
			setEnabled(next)
		}}
	/>
}

export const CliStatusTab = () => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')

	const [status, setStatus] = useState<LoopholeCliStatus>({ status: 'disconnected' })
	const [version, setVersion] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setError(null)
		try {
			setStatus(await cliService.status())
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}, [cliService])

	const check = useCallback(async () => {
		await refresh()
		setVersion(await cliService.version().catch(() => 'unknown'))
	}, [refresh, cliService])

	const connect = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			setStatus(await cliService.connect())
			setVersion(await cliService.version().catch(() => 'unknown'))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [cliService])

	const reconnect = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			await cliService.disconnect()
			setStatus(await cliService.connect())
			setVersion(await cliService.version().catch(() => 'unknown'))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [cliService])

	const disconnect = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			await cliService.disconnect()
			setStatus(await cliService.status())
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [cliService])

	useEffect(() => {
		void check()
		// Keep the state honest while the process starts or exits; version is fetched by `check`.
		const timer = setInterval(() => { void refresh() }, 5000)
		return () => clearInterval(timer)
	}, [check, refresh])

	const shownError = error ?? status.error
	const connected = status.status === 'connected'

	return <SettingsSection
		title='Status'
		description='Check whether the Loophole CLI is installed, running, and ready for chat.'
	>
		<div className='border border-loophole-border-2 bg-loophole-bg-1 rounded-sm p-4'>
			<div className='flex items-center gap-3'>
				<span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-loophole-fg-1' : 'bg-loophole-fg-3'}`} />
				<div className='text-lg text-loophole-fg-1'>{cliStatusLabel(status.status)}</div>
				<div className='flex-1' />
				<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void check() }} disabled={busy}>Check again</VoidButtonBgDarken>
			</div>
			<div className='text-xs text-loophole-fg-3 mt-2'>
				{connected ? 'Chat, models, and providers come from the CLI.' : 'Start the CLI to load providers and models.'}
			</div>
		</div>

		<div className='flex flex-wrap items-center gap-2 mt-3'>
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void connect() }} disabled={busy || connected || status.status === 'starting'}>Connect</VoidButtonBgDarken>
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void reconnect() }} disabled={busy}>Reconnect</VoidButtonBgDarken>
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void disconnect() }} disabled={busy || status.status === 'disconnected'}>Disconnect</VoidButtonBgDarken>
		</div>

		<div className='mt-4'>
			<SettingsList>
				<SettingsRow label='Connection'>
					<SettingsStatus ok={connected} label={cliStatusLabel(status.status)} />
				</SettingsRow>
				<SettingsRow label='Binary' description={status.binaryPath ?? 'Not resolved yet.'}>
					<span className='text-xs text-loophole-fg-3'>--version</span>
				</SettingsRow>
				<SettingsRow label='CLI version'>
					<span className='text-xs text-loophole-fg-2'>{version || 'Checking...'}</span>
				</SettingsRow>
				<SettingsRow label='Process' description={status.port !== undefined ? `Local API on port ${status.port}` : 'No local API port yet.'}>
					<span className='text-xs text-loophole-fg-3'>{status.pid ? `pid ${status.pid}` : 'not running'}</span>
				</SettingsRow>
				<SettingsRow label='Last error'>
					<span className='text-xs text-loophole-fg-3'>{shownError || 'None'}</span>
				</SettingsRow>
				<SettingsRow label='Enable the CLI' description='Disabling stops new CLI connections but leaves this page available.'>
					<VoidSwitchForEnabled />
				</SettingsRow>
			</SettingsList>
		</div>

		<div className='mt-3'>
			<SettingsNote>The CLI binary is bundled with Loophole, then looked up on PATH. Version comes from the binary itself.</SettingsNote>
		</div>
	</SettingsSection>
}
