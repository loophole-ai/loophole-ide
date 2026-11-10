/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSimpleInputBox } from '../../util/inputs.js'
import type { LoopholeServeIntegrationInfo } from '../../../../../common/loopholeServeTypes.js'

const hintOfIntegration = (integration: LoopholeServeIntegrationInfo) => {
	const oauth = integration.methods.find((method) => method.type === 'oauth')
	if (oauth) return `Sign-in for ${integration.name} uses OAuth/device code. Complete it from the Loophole app; this editor stores API keys only.`
	const external = integration.methods.find((method) => method.type === 'external')
	if (external) return `${integration.name} uses credentials managed outside Loophole Serve. Configure them where the server runs.`
	const command = integration.methods.find((method) => method.type === 'command')
	if (command) return `${integration.name} connects with a command (${command.label ?? command.type}). Run it on the machine hosting Loophole Serve.`
	const env = integration.methods.find((method) => method.type === 'env')
	if (env) return `The server reads ${integration.name} credentials from its environment${env.names?.length ? ` (${env.names.join(', ')})` : ''}.`
	return `${integration.name} does not advertise an API-key method.`
}

/** Connect one integration with an API key; OAuth/device/command flows are surfaced as hints only. */
export const ServeProviderConnectDialog = ({ integration, onClose, onConnected }: {
	integration: LoopholeServeIntegrationInfo
	onClose: () => void
	onConnected: () => void
}) => {
	const accessor = useAccessor()
	const serveService = accessor.get('ILoopholeServeService')

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
			await serveService.connectKey({ integrationID: integration.id, key: key.trim() })
			setKey('')
			setSuccess(`API key stored for ${integration.name}.`)
			onConnected()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}, [serveService, integration.id, integration.name, key, keyMethod, onConnected])

	return <div
		className='fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]'
		onClick={onClose}
	>
		<div
			className='bg-loophole-bg-1 rounded-md p-4 max-w-md w-full shadow-xl'
			onClick={(e) => e.stopPropagation()}
		>
			<h3 className='text-lg font-medium text-loophole-fg-1'>Connect {integration.name}</h3>
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
					<VoidButtonBgDarken className='px-3 py-1 bg-[#0e70c0] text-white' onClick={() => { void onConnect() }} disabled={busy}>
						{busy ? 'Connecting...' : 'Connect'}
					</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-3 py-1' onClick={onClose} disabled={busy}>Close</VoidButtonBgDarken>
				</div>
			</div> : <div className='text-sm text-loophole-fg-3 mt-4'>{hintOfIntegration(integration)}</div>}

			{keyMethod && integration.methods.some((method) => method.type === 'oauth' || method.type === 'command') ? <div className='text-xs text-loophole-fg-3 mt-3'>
				{hintOfIntegration(integration)}
			</div> : null}

			{success ? <div className='text-xs text-green-500 mt-3'>{success}</div> : null}
			{error ? <div className='text-xs text-red-500 mt-3'>{error}</div> : null}

			{!keyMethod ? <div className='flex justify-end mt-4'>
				<VoidButtonBgDarken className='px-3 py-1' onClick={onClose}>Close</VoidButtonBgDarken>
			</div> : null}
		</div>
	</div>
}
