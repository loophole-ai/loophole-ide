/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken } from '../../util/inputs.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'
import type { LoopholeCliUpdateInfo } from '../../../../../common/loopholeCliTypes.js'

/** App and CLI identity, version, updates, license, and project links. */
export const CliAboutTab = () => {
	const accessor = useAccessor()
	const productService = accessor.get('IProductService')
	const cliService = accessor.get('ILoopholeCliService')

	const [version, setVersion] = useState('')
	const [cliPath, setCliPath] = useState('')
	const [update, setUpdate] = useState<LoopholeCliUpdateInfo | null>(null)
	const [checking, setChecking] = useState(false)
	const [installing, setInstalling] = useState(false)
	const [result, setResult] = useState<string | null>(null)

	const check = useCallback(async () => {
		setChecking(true)
		try {
			setUpdate(await cliService.updateCheck())
		} catch (e) {
			setUpdate({ current: '', latest: '', updateAvailable: false, error: e instanceof Error ? e.message : String(e) })
		} finally {
			setChecking(false)
		}
	}, [cliService])

	useEffect(() => {
		let cancelled = false
		void cliService.version().then(next => { if (!cancelled) setVersion(next) }).catch(() => { if (!cancelled) setVersion('unknown') })
		void cliService.status().then(next => { if (!cancelled) setCliPath(next.binaryPath ?? '') }).catch(() => { /* optional */ })
		void cliService.updateCheck().then(next => { if (!cancelled) setUpdate(next) }).catch(() => { /* offline is fine */ })
		return () => { cancelled = true }
	}, [cliService])

	const install = async () => {
		if (!update?.latest) return
		setInstalling(true)
		setResult(null)
		try {
			const done = await cliService.updateInstall({ version: update.latest })
			setResult(done.ok ? `Updated to ${done.version}. The CLI restarted.` : done.output || 'Update failed.')
			const next = await cliService.version()
			setVersion(next)
			setUpdate(await cliService.updateCheck())
		} catch (e) {
			setResult(e instanceof Error ? e.message : String(e))
		} finally {
			setInstalling(false)
		}
	}

	const notes = update?.notes?.trim()

	return <>
		<SettingsSection title='About'>
			<SettingsList>
				<SettingsRow label='Application' description={productService.nameLong}>
					<span className='text-xs text-loophole-fg-2'>{productService.version}</span>
				</SettingsRow>
				<SettingsRow label='Loophole CLI'>
					<span className='text-xs text-loophole-fg-2'>{version || 'Checking...'}</span>
				</SettingsRow>
				<SettingsRow label='CLI location' description={cliPath || 'Using a binary from PATH.'}>
					<span className='text-xs text-loophole-fg-3'>binary</span>
				</SettingsRow>
				<SettingsRow label='Engine' description='Chat, agents, providers, and sessions all run in the Loophole CLI.'>
					<span className='text-xs text-loophole-fg-3'>local CLI</span>
				</SettingsRow>
			</SettingsList>
		</SettingsSection>

		<div className='mt-6'>
			<SettingsSection
				title='Updates'
				description={update?.updateAvailable
					? `A new release is available: Loophole CLI ${update.latest}`
					: 'You are on the latest Loophole CLI.'}
			>
				<SettingsList>
					<SettingsRow
						label={update?.updateAvailable ? `New release: Loophole CLI ${update.latest}` : 'Loophole CLI'}
						description={update?.error
							? `Could not check for updates: ${update.error}`
							: update?.updateAvailable
								? `Installed ${update.current} · latest ${update.latest}`
								: update ? `Installed ${update.current}` : 'Checking...'}
					>
						{update?.updateAvailable
							? <VoidButtonBgDarken className='px-3 py-1' onClick={() => { void install() }} disabled={installing}>
								{installing ? 'Updating...' : 'Update'}
							</VoidButtonBgDarken>
							: <VoidButtonBgDarken className='px-3 py-1' onClick={() => { void check() }} disabled={checking}>
								{checking ? 'Checking...' : 'Check again'}
							</VoidButtonBgDarken>}
					</SettingsRow>
				</SettingsList>

				{notes ? <div className='mt-3'>
					<div className='text-xs text-loophole-fg-3 mb-1'>What changed in {update?.latest}</div>
					<pre className='whitespace-pre-wrap break-words text-xs text-loophole-fg-2 border border-loophole-border-2 bg-loophole-bg-1 rounded-sm p-3 max-h-64 overflow-auto'>{notes}</pre>
				</div> : null}

				{result ? <div className='mt-3'><SettingsNote>{result}</SettingsNote></div> : null}
				{update?.url ? <div className='mt-3'>
					<a className='text-xs text-loophole-fg-2 underline' href={update.url} target='_blank' rel='noreferrer'>Release notes on GitHub</a>
				</div> : null}
			</SettingsSection>
		</div>

		<div className='mt-6'>
			<SettingsSection title='License'>
				<SettingsList>
					<SettingsRow label='License' description='Loophole IDE is based on VS Code and is distributed under the Apache License 2.0.'>
						<span className='text-xs text-loophole-fg-3'>Apache-2.0</span>
					</SettingsRow>
					<SettingsRow label='Project' description='Source, issues, and documentation.'>
						<a className='text-xs text-loophole-fg-2 underline' href='https://github.com/loophole-ai/loophole-ide' target='_blank' rel='noreferrer'>github.com/loophole-ai/loophole-ide</a>
					</SettingsRow>
				</SettingsList>
			</SettingsSection>
		</div>
	</>
}
