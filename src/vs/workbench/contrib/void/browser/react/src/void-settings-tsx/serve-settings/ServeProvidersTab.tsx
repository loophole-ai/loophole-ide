/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSimpleInputBox } from '../../util/inputs.js'
import { ServeProviderConnectDialog } from './ServeProviderConnectDialog.js'
import { ServeStatusCard } from './ServeStatusCard.js'
import type { LoopholeServeIntegrationConnection, LoopholeServeIntegrationInfo, LoopholeServeProviderInfo } from '../../../../../common/loopholeServeTypes.js'

// Providers worth surfacing before the full integration catalog. Any missing id is simply ignored.
const popularIntegrationIDs = new Set([
	'anthropic',
	'openai',
	'google',
	'openrouter',
	'github-copilot',
	'amazon-bedrock',
	'azure',
	'mistral',
	'gitlab',
	'xai',
	'deepseek',
])

const hasConnectMethod = (integration: LoopholeServeIntegrationInfo) =>
	integration.methods.some((method) => method.type === 'key' || method.type === 'oauth')

const isRemovable = (connection: LoopholeServeIntegrationConnection): connection is LoopholeServeIntegrationConnection & { id: string } =>
	connection.type === 'credential' && typeof connection.id === 'string'

/** Connected providers plus the connectable integration catalog. */
export const ServeProvidersTab = () => {
	const accessor = useAccessor()
	const serveService = accessor.get('ILoopholeServeService')

	const [providers, setProviders] = useState<LoopholeServeProviderInfo[]>([])
	const [integrations, setIntegrations] = useState<LoopholeServeIntegrationInfo[]>([])
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [connecting, setConnecting] = useState<LoopholeServeIntegrationInfo | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const status = await serveService.status()
			if (status.status !== 'connected') {
				setProviders([])
				setIntegrations([])
				return
			}
			const [nextProviders, nextIntegrations] = await Promise.all([
				serveService.providers(),
				serveService.integrations(),
			])
			setProviders(nextProviders)
			setIntegrations(nextIntegrations)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setLoading(false)
		}
	}, [serveService])

	useEffect(() => { void load() }, [load])

	const connectedIntegrationIDs = useMemo(
		() => new Set(providers.map((provider) => provider.integrationID ?? provider.id)),
		[providers],
	)

	const catalog = useMemo(() => {
		const query = search.trim().toLowerCase()
		const available = integrations.filter((integration) =>
			integration.metadata?.source !== 'mcp' &&
			!connectedIntegrationIDs.has(integration.id) &&
			hasConnectMethod(integration) &&
			(!query || integration.name.toLowerCase().includes(query) || integration.id.toLowerCase().includes(query)),
		)
		if (query) return available.sort((a, b) => a.name.localeCompare(b.name))
		const popular = available.filter((integration) => popularIntegrationIDs.has(integration.id))
		const rest = available.filter((integration) => !popularIntegrationIDs.has(integration.id))
		popular.sort((a, b) => a.name.localeCompare(b.name))
		rest.sort((a, b) => a.name.localeCompare(b.name))
		return [...popular, ...rest]
	}, [integrations, connectedIntegrationIDs, search])

	const integrationOfProvider = (provider: LoopholeServeProviderInfo) =>
		integrations.find((integration) => integration.id === (provider.integrationID ?? provider.id))

	const onDisconnect = useCallback(async (provider: LoopholeServeProviderInfo) => {
		setBusy(provider.id)
		setError(null)
		try {
			const integration = integrations.find((integration) => integration.id === (provider.integrationID ?? provider.id))
			const credentials = (integration?.connections ?? []).filter(isRemovable)
			if (credentials.length === 0) {
				setError(`${provider.name} is configured by the server environment and cannot be disconnected here.`)
				return
			}
			for (const credential of credentials) {
				await serveService.credentialRemove(credential.id)
			}
			await load()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(null)
		}
	}, [serveService, load, integrations])

	return <div>
		<ServeStatusCard onChange={load} />

		{error ? <div className='text-xs text-red-500 my-2'>{error}</div> : null}
		{loading ? <div className='text-xs text-loophole-fg-3 my-2'>Loading providers...</div> : null}

		<h4 className='text-base mt-4 mb-2'>Connected</h4>
		<div className='border border-loophole-border-2 bg-loophole-bg-1 rounded-sm'>
			{providers.length === 0
				? <div className='text-sm text-loophole-fg-3 p-3'>No providers connected on the server.</div>
				: providers.map((provider) => {
					const integration = integrationOfProvider(provider)
					const credential = (integration?.connections ?? []).find(isRemovable)
					return <div key={provider.id} className='flex flex-wrap items-center justify-between gap-2 p-3 border-b border-loophole-border-2 last:border-b-0'>
						<div className='min-w-0'>
							<div className='text-sm font-medium text-loophole-fg-1 truncate'>{provider.name}</div>
							<div className='text-xs text-loophole-fg-3 truncate'>
								{provider.id}
								{credential?.label ? ` · ${credential.label}` : ''}
							</div>
						</div>
						{credential
							? <VoidButtonBgDarken
								className='px-3 py-1'
								onClick={() => { void onDisconnect(provider) }}
								disabled={busy === provider.id}
							>
								{busy === provider.id ? 'Disconnecting...' : 'Disconnect'}
							</VoidButtonBgDarken>
							: <span className='text-xs text-loophole-fg-3'>Server environment</span>}
					</div>
				})}
		</div>

		<h4 className='text-base mt-6 mb-2'>Add provider</h4>
		<div className='mb-2 max-w-sm'>
			<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder='Search providers' compact={true} />
		</div>
		<div className='border border-loophole-border-2 bg-loophole-bg-1 rounded-sm'>
			{catalog.length === 0
				? <div className='text-sm text-loophole-fg-3 p-3'>
					{search ? 'No matching providers.' : 'No additional providers available from the server.'}
				</div>
				: catalog.map((integration) => {
					const oauthOnly = !integration.methods.some((method) => method.type === 'key')
					return <div key={integration.id} className='flex flex-wrap items-center justify-between gap-2 p-3 border-b border-loophole-border-2 last:border-b-0'>
						<div className='min-w-0'>
							<div className='text-sm font-medium text-loophole-fg-1 truncate'>{integration.name}</div>
							<div className='text-xs text-loophole-fg-3 truncate'>
								{integration.id}
								{oauthOnly ? ' · OAuth sign-in' : ''}
							</div>
						</div>
						<VoidButtonBgDarken className='px-3 py-1' onClick={() => setConnecting(integration)}>
							{oauthOnly ? 'Details' : 'Connect'}
						</VoidButtonBgDarken>
					</div>
				})}
		</div>

		{connecting ? <ServeProviderConnectDialog
			integration={connecting}
			onClose={() => setConnecting(null)}
			onConnected={() => { void load() }}
		/> : null}
	</div>
}
