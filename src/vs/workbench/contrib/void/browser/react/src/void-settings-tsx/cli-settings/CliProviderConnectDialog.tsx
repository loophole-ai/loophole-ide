/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSimpleInputBox } from '../../util/inputs.js'
import type { LoopholeCliIntegrationInfo } from '../../../../../common/loopholeCliTypes.js'

const hintOfIntegration = (integration: LoopholeCliIntegrationInfo) => {
	const oauth = integration.methods.find((method) => method.type === 'oauth')
	if (oauth) return `Sign-in for ${integration.name} uses OAuth or a device code. Complete it in the Loophole CLI; the editor stores API keys only.`
	const external = integration.methods.find((method) => method.type === 'external')
	if (external) return `${integration.name} uses credentials managed outside the Loophole CLI. Configure them where the CLI runs.`
	const command = integration.methods.find((method) => method.type === 'command')
	if (command) return `${integration.name} connects with a command (${command.label ?? command.type}). Run it in the Loophole CLI.`
	const env = integration.methods.find((method) => method.type === 'env')
	if (env) return `The CLI reads ${integration.name} credentials from its environment${env.names?.length ? ` (${env.names.join(', ')})` : ''}.`
	return `${integration.name} does not advertise an API-key method.`
}

/** Connect one integration with an API key; OAuth/device/command flows are surfaced as hints only. */
export const CliProviderConnectDialog = ({ integration, onClose, onConnected }: {
	integration: LoopholeCliIntegrationInfo
	onClose: () => void
	onConnected: () => void
}) => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')
	const configService = accessor.get('IConfigurationService')

	const [key, setKey] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState<string | null>(null)

	const keyMethod = integration.methods.find((method) => method.type === 'key')

	const onConnect = useCallback(async () => {
		if (!keyMethod) return
		if (!key.trim()) {
			setError('Enter an API key first.')
			return
		}
		setBusy(true)
		setError(null)
		setSuccess(null)
		try {
			await cliService.connectKey({ integrationID: integration.id, key: key.trim() })
			// Inline completions talk to the provider directly, so the key entered
			// here is also what autocomplete should use. Keeping one place to enter
			// keys is why the Autocomplete page has no key field of its own.
			if (/inception|mercury/i.test(integration.id) || /inception/i.test(integration.name)) {
				configService.updateValue('loophole.fim.apiKey', key.trim())
			}
			setKey('')
			setSuccess(`API key stored for ${integration.name}.`)
			onConnected()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [cliService, integration.id, integration.name, key, keyMethod, onConnected])

	return <div
		className='fixed inset-0 bg-black/40 flex items-center justify-center z-[9999999]'
		onClick={onClose}
	>
		<div
			className='bg-loophole-bg-1 border border-loophole-border-1 rounded-sm p-4 w-full max-w-md'
			onClick={(e) => e.stopPropagation()}
		>
			<h3 className='text-base text-loophole-fg-1'>Connect {integration.name}</h3>
			<div className='text-xs text-loophole-fg-3 mt-1'>{integration.id}</div>

			{keyMethod ? <div className='flex flex-col gap-2 mt-4'>
				<VoidSimpleInputBox
					value={key}
					onChangeValue={setKey}
					placeholder={keyMethod.label ?? 'API Key'}
					passwordBlur={true}
					compact={true}
				/>
				<div className='flex items-center gap-2'>
					<VoidButtonBgDarken className='px-3 py-1' onClick={() => { void onConnect() }} disabled={busy}>
						{busy ? 'Connecting...' : 'Connect'}
					</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-3 py-1' onClick={onClose} disabled={busy}>Close</VoidButtonBgDarken>
				</div>
			</div> : <div className='text-sm text-loophole-fg-3 mt-4'>{hintOfIntegration(integration)}</div>}

			{keyMethod && integration.methods.some((method) => method.type === 'oauth' || method.type === 'command') ? <div className='text-xs text-loophole-fg-3 mt-3'>
				{hintOfIntegration(integration)}
			</div> : null}

			{success ? <div className='text-xs text-loophole-fg-2 mt-3'>{success}</div> : null}
			{error ? <div className='text-xs text-loophole-fg-3 mt-3'>{error}</div> : null}

			{!keyMethod ? <div className='flex justify-end mt-4'>
				<VoidButtonBgDarken className='px-3 py-1' onClick={onClose}>Close</VoidButtonBgDarken>
			</div> : null}
		</div>
	</div>
}
