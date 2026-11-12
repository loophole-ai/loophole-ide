/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccessor } from '../../util/services.js'
import { VoidButtonBgDarken, VoidSimpleInputBox } from '../../util/inputs.js'
import { CliProviderConnectDialog } from './CliProviderConnectDialog.js'
import { CliCustomProviderDialog } from './CliCustomProviderDialog.js'
import { CliStatusCard } from './CliStatusCard.js'
import { SettingsList, SettingsNote, SettingsRow, SettingsSection } from './CliSettingsRows.js'
import { LoopholeCliCustomProvidersSettingId, type LoopholeCliCustomProvider } from './cliSettingIds.js'
import type { LoopholeCliIntegrationConnection, LoopholeCliIntegrationInfo, LoopholeCliProviderInfo } from '../../../../../common/loopholeCliTypes.js'

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

const hasConnectMethod = (integration: LoopholeCliIntegrationInfo) =>
	integration.methods.some((method) => method.type === 'key' || method.type === 'oauth')

const isRemovable = (connection: LoopholeCliIntegrationConnection): connection is LoopholeCliIntegrationConnection & { id: string } =>
	connection.type === 'credential' && typeof connection.id === 'string'

/** Connected providers plus the connectable integration catalog, both owned by the CLI. */
export const CliProvidersTab = () => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')

	const [providers, setProviders] = useState<LoopholeCliProviderInfo[]>([])
	const [integrations, setIntegrations] = useState<LoopholeCliIntegrationInfo[]>([])
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [connecting, setConnecting] = useState<LoopholeCliIntegrationInfo | null>(null)
	const [customOpen, setCustomOpen] = useState(false)
	const configService = accessor.get('IConfigurationService')
	const [custom, setCustom] = useState<LoopholeCliCustomProvider[]>(() =>
		configService.getValue<LoopholeCliCustomProvider[]>(LoopholeCliCustomProvidersSettingId) ?? [],
	)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(LoopholeCliCustomProvidersSettingId)) return
			setCustom(configService.getValue<LoopholeCliCustomProvider[]>(LoopholeCliCustomProvidersSettingId) ?? [])
		})
		return () => disposable.dispose()
	}, [configService])

	const removeCustom = (id: string) => {
		configService.updateValue(
			LoopholeCliCustomProvidersSettingId,
			custom.filter((entry) => entry.id !== id),
		)
	}

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const status = await cliService.status()
			if (status.status !== 'connected') {
				setProviders([])
				setIntegrations([])
				return
			}
			const [nextProviders, nextIntegrations] = await Promise.all([
				cliService.providers(),
				cliService.integrations(),
			])
			setProviders(nextProviders)
			setIntegrations(nextIntegrations)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setLoading(false)
		}
	}, [cliService])

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

	const onDisconnect = useCallback(async (provider: LoopholeCliProviderInfo) => {
		setBusy(provider.id)
		setError(null)
		try {
			const integration = integrations.find((entry) => entry.id === (provider.integrationID ?? provider.id))
			const credentials = (integration?.connections ?? []).filter(isRemovable)
			if (credentials.length === 0) {
				setError(`${provider.name} is configured by the CLI environment and cannot be disconnected here.`)
				return
			}
			for (const credential of credentials) {
				await cliService.credentialRemove(credential.id)
			}
			await load()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(null)
		}
	}, [cliService, load, integrations])

	return <SettingsSection
		title='Providers'
		description='Providers and API keys are owned by the Loophole CLI.'
	>
		<CliStatusCard onChange={load} />
		{error ? <SettingsNote>{error}</SettingsNote> : null}
		{loading ? <SettingsNote>Loading providers from the CLI...</SettingsNote> : null}

		<h4 className='text-base mt-4 mb-2'>Connected</h4>
		<SettingsList>
			{providers.length === 0
				? <SettingsRow label='No providers connected' description='Connect one below to use its models.' />
				: providers.map((provider) => {
					const integration = integrations.find((entry) => entry.id === (provider.integrationID ?? provider.id))
					const credential = (integration?.connections ?? []).find(isRemovable)
					return <SettingsRow
						key={provider.id}
						label={<span className='flex items-center gap-2'><span className='w-2 h-2 rounded-full bg-loophole-fg-1' />{provider.name}</span>}
						description={<>{provider.id}{credential?.label ? ` · ${credential.label}` : ''}</>}
					>
						{credential
							? <VoidButtonBgDarken className='px-3 py-1' onClick={() => { void onDisconnect(provider) }} disabled={busy === provider.id}>
								{busy === provider.id ? 'Disconnecting...' : 'Disconnect'}
							</VoidButtonBgDarken>
							: <span className='text-xs text-loophole-fg-3'>CLI environment</span>}
					</SettingsRow>
				})}
		</SettingsList>

		<h4 className='text-base mt-6 mb-2'>Custom providers</h4>
		<SettingsList>
			{custom.length === 0
				? <SettingsRow label='No custom providers' description='Add an OpenAI-compatible endpoint by base URL and model id.' />
				: custom.map((entry) => <SettingsRow
					key={entry.id}
					label={entry.name}
					description={<>{entry.id} · {entry.model}{entry.baseURL ? ` · ${entry.baseURL}` : ''}</>}
				>
					<VoidButtonBgDarken className='px-3 py-1' onClick={() => removeCustom(entry.id)}>Remove</VoidButtonBgDarken>
				</SettingsRow>)}
		</SettingsList>
		<div className='mt-2'>
			<VoidButtonBgDarken className='px-3 py-1' onClick={() => setCustomOpen(true)}>Add custom provider</VoidButtonBgDarken>
		</div>

		<h4 className='text-base mt-6 mb-2'>Add provider</h4>
		<div className='mb-2 max-w-sm'>
			<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder='Search providers' compact={true} />
		</div>
		<SettingsList>
			{catalog.length === 0
				? <SettingsRow label={search ? 'No matching providers' : 'No additional providers'} />
				: catalog.map((integration) => {
					const oauthOnly = !integration.methods.some((method) => method.type === 'key')
					return <SettingsRow
						key={integration.id}
						label={integration.name}
						description={<>{integration.id}{oauthOnly ? ' · OAuth sign-in' : ''}</>}
					>
						<VoidButtonBgDarken className='px-3 py-1' onClick={() => setConnecting(integration)}>
							{oauthOnly ? 'Details' : 'Connect'}
						</VoidButtonBgDarken>
					</SettingsRow>
				})}
		</SettingsList>

		{connecting ? <CliProviderConnectDialog
			integration={connecting}
			onClose={() => setConnecting(null)}
			onConnected={() => { void load() }}
		/> : null}

		{customOpen ? <CliCustomProviderDialog
			onClose={() => setCustomOpen(false)}
			onSaved={() => { /* settings listener refreshes the list */ }}
		/> : null}
	</SettingsSection>
}
