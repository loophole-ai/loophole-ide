/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import { Brain, Check, ChevronRight, DollarSign, ExternalLink, Loader2, Lock, X } from 'lucide-react';
import { OneClickSwitchButton } from '../void-settings-tsx/Settings.js';
import { ColorScheme } from '../../../../../../../platform/theme/common/theme.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { isLinux } from '../../../../../../../base/common/platform.js';
import { LocalVoiceModelSettings } from '../local-voice/LocalVoiceModelSettings.js';
import { VoidSimpleInputBox } from '../util/inputs.js';
import { clearCliModelsCache, cliModelRef, useCliModels, useEnabledCliModels } from '../void-settings-tsx/cli-settings/CliModelSelect.js';
import { hintOfIntegration } from '../void-settings-tsx/cli-settings/CliProviderConnectDialog.js';
import { LoopholeCliCustomProvidersSettingId, loopholeCliModelSettingId, type LoopholeCliCustomProvider } from '../void-settings-tsx/cli-settings/cliSettingIds.js';
import type { LoopholeCliIntegrationInfo, LoopholeCliModelInfo, LoopholeCliProviderInfo } from '../../../../common/loopholeCliTypes.js';

const OVERRIDE_VALUE = false

export const LoopholeOnboarding = () => {

	const voidSettingsState = useSettingsState()
	const isOnboardingComplete = voidSettingsState.globalSettings.isOnboardingComplete || OVERRIDE_VALUE

	const isDark = useIsDark()

	return (
		<div className={`@@loophole-scope ${isDark ? 'dark' : ''}`}>
			<div
				className={`
					bg-loophole-bg-3 fixed top-0 right-0 bottom-0 left-0 width-full z-[99999]
					transition-all duration-1000 ${isOnboardingComplete ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}
				`}
				style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
			>
				<ErrorBoundary>
					<LoopholeOnboardingContent />
				</ErrorBoundary>
			</div>
		</div>
	)
}

const LoopholeIcon = () => {
	const accessor = useAccessor()
	const themeService = accessor.get('IThemeService')

	const divRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		// loophole icon style
		const updateTheme = () => {
			const theme = themeService.getColorTheme().type
			const isDark = theme === ColorScheme.DARK || theme === ColorScheme.HIGH_CONTRAST_DARK
			if (divRef.current) {
				divRef.current.style.maxWidth = '220px'
				divRef.current.style.opacity = '50%'
				divRef.current.style.filter = isDark ? '' : 'invert(1)'
			}
		}
		updateTheme()
		const d = themeService.onDidColorThemeChange(updateTheme)
		return () => d.dispose()
	}, [])

	return <div ref={divRef} className='@@loophole-void-icon' />
}

const FADE_DURATION_MS = 2000

const FadeIn = ({ children, className, delayMs = 0, durationMs, ...props }: { children: React.ReactNode, delayMs?: number, durationMs?: number, className?: string } & React.HTMLAttributes<HTMLDivElement>) => {

	const [opacity, setOpacity] = useState(0)

	const effectiveDurationMs = durationMs ?? FADE_DURATION_MS

	useEffect(() => {

		const timeout = setTimeout(() => {
			setOpacity(1)
		}, delayMs)

		return () => clearTimeout(timeout)
	}, [setOpacity, delayMs])


	return (
		<div className={className} style={{ opacity, transition: `opacity ${effectiveDurationMs}ms ease-in-out` }} {...props}>
			{children}
		</div>
	)
}

// =============================================
//  ConnectProviderPage (Loophole CLI)
//
//  Providers, keys and models are owned by the Loophole CLI, so this page talks to it
//  through ILoopholeCliService - the same calls as Settings > Providers - but keeps the
//  onboarding look. The CLI is started at editor launch (loopholeCliBoot); if it is still
//  starting when this page opens, the page waits for it and shows progress.
// =============================================

type ProviderTab = 'Popular' | 'All' | 'Custom'

const providerTabNames: ProviderTab[] = ['Popular', 'All', 'Custom']

const descriptionOfProviderTab: Record<ProviderTab, string> = {
	Popular: `Connect with your own API key. Keys are stored by the Loophole CLI. Add as many as you'd like!`,
	All: `Every provider the Loophole CLI supports. Search to find yours.`,
	Custom: `Add any OpenAI-compatible endpoint by its base URL and model id.`,
}

// Shown first, in this order. An id the CLI does not report is simply skipped.
const popularIntegrationIDs = [
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
]

// The "All" tab can hold hundreds of providers, and OpenRouter alone reports ~350 models.
// Cap what is mounted; search narrows the rest.
const MAX_PROVIDERS_SHOWN = 20
const MAX_MODELS_SHOWN = 8
const MAX_MODEL_SEARCH_RESULTS = 20

const hasConnectMethod = (integration: LoopholeCliIntegrationInfo) =>
	integration.methods.some((method) => method.type === 'key' || method.type === 'oauth')

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e)

const inlineActionButtonClass = (disabled?: boolean) =>
	`px-4 py-2 rounded-md text-white bg-[#0e70c0]/80 hover:bg-[#0e70c0] transition-all duration-200 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`

/** Connection state, connected providers and the connectable catalog, all owned by the CLI. */
const useCliProviders = () => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')

	const [providers, setProviders] = useState<LoopholeCliProviderInfo[]>([])
	const [integrations, setIntegrations] = useState<LoopholeCliIntegrationInfo[]>([])
	const [phase, setPhase] = useState<'starting' | 'ready' | 'error'>('starting')
	const [error, setError] = useState<string | null>(null)

	// Full load: waits for the CLI to come up (connect() joins a start that is already in flight).
	const load = useCallback(async () => {
		setPhase('starting')
		setError(null)
		try {
			const status = await cliService.status()
			const next = status.status === 'connected' ? status : await cliService.connect()
			if (next.status !== 'connected') {
				setError(next.error ?? 'The Loophole CLI is not connected.')
				setPhase('error')
				return
			}
			const [nextProviders, nextIntegrations] = await Promise.all([cliService.providers(), cliService.integrations()])
			setProviders(nextProviders)
			setIntegrations(nextIntegrations)
			setPhase('ready')
		} catch (e) {
			setError(errorText(e))
			setPhase('error')
		}
	}, [cliService])

	// Light refresh after a provider was connected: no "starting" flash, the lists just update.
	const refresh = useCallback(async () => {
		try {
			const [nextProviders, nextIntegrations] = await Promise.all([cliService.providers(), cliService.integrations()])
			setProviders(nextProviders)
			setIntegrations(nextIntegrations)
		} catch (e) {
			setError(errorText(e))
		}
	}, [cliService])

	useEffect(() => { void load() }, [load])

	return { providers, integrations, phase, error, reload: load, refresh }
}

/** Custom (OpenAI-compatible) providers saved in the editor settings. */
const useCustomProviders = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const read = () => configService.getValue<LoopholeCliCustomProvider[]>(LoopholeCliCustomProvidersSettingId) ?? []
	const [custom, setCustom] = useState<LoopholeCliCustomProvider[]>(read)

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(LoopholeCliCustomProvidersSettingId)) setCustom(read())
		})
		return () => disposable.dispose()
	}, [configService])

	return custom
}

/** "Add Anthropic" + API key field. OAuth-only providers show how to sign in instead. */
const ProviderKeyBlock = ({ integration, onConnected }: { integration: LoopholeCliIntegrationInfo, onConnected: () => void }) => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')
	const configService = accessor.get('IConfigurationService')

	const [key, setKey] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const keyMethod = integration.methods.find((method) => method.type === 'key')

	const connect = async () => {
		if (!keyMethod || busy) return
		if (!key.trim()) {
			setError('Enter an API key first.')
			return
		}
		setBusy(true)
		setError(null)
		try {
			await cliService.connectKey({ integrationID: integration.id, key: key.trim() })
			// Inline completions talk to the provider directly, so this key is also the autocomplete key.
			if (/inception|mercury/i.test(integration.id) || /inception/i.test(integration.name)) {
				configService.updateValue('loophole.fim.apiKey', key.trim())
			}
			clearCliModelsCache()
			setKey('')
			onConnected()
		} catch (e) {
			setError(errorText(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="w-full max-w-xl mb-10">
			<div className="text-xl mb-2">Add {integration.name}</div>
			{keyMethod ? (
				<div className="flex items-center gap-2">
					<div className="flex-1">
						<VoidSimpleInputBox
							value={key}
							onChangeValue={setKey}
							placeholder={keyMethod.label ?? 'API Key'}
							passwordBlur={true}
							className=""
							onKeyDown={(e) => { if (e.key === 'Enter') void connect() }}
						/>
					</div>
					<button className={inlineActionButtonClass(busy)} disabled={busy} onClick={() => { void connect() }}>
						{busy ? 'Connecting...' : 'Connect'}
					</button>
				</div>
			) : (
				<div className="text-sm opacity-80 text-loophole-fg-3">{hintOfIntegration(integration)}</div>
			)}
			{error && <div className="text-amber-400 mt-2 text-sm opacity-80">{error}</div>}
		</div>
	)
}

/** Inline form for an OpenAI-compatible endpoint (same storage as Settings > Providers > Custom). */
const CustomProviderForm = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')

	const [id, setId] = useState('')
	const [name, setName] = useState('')
	const [baseURL, setBaseURL] = useState('')
	const [model, setModel] = useState('')
	const [apiKey, setApiKey] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [added, setAdded] = useState<string | null>(null)

	const save = () => {
		setAdded(null)
		const providerID = id.trim().toLowerCase().replace(/\s+/g, '-')
		const modelID = model.trim()
		if (!providerID) return setError('A provider id is required.')
		if (!modelID) return setError('A model id is required.')
		if (!baseURL.trim() && !apiKey.trim()) return setError('Enter a base URL or an API key.')
		const existing = configService.getValue<LoopholeCliCustomProvider[]>(LoopholeCliCustomProvidersSettingId) ?? []
		if (existing.some((entry) => entry.id === providerID)) return setError(`Provider "${providerID}" already exists.`)
		const entry: LoopholeCliCustomProvider = {
			id: providerID,
			name: name.trim() || providerID,
			baseURL: baseURL.trim() || undefined,
			model: modelID,
			apiKey: apiKey.trim() || undefined,
		}
		configService.updateValue(LoopholeCliCustomProvidersSettingId, [...existing, entry])
		clearCliModelsCache()
		setError(null)
		setAdded(entry.name)
		setId(''); setName(''); setBaseURL(''); setModel(''); setApiKey('')
	}

	const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string, hint?: string, secret?: boolean) => (
		<div className="flex flex-col gap-1">
			<div className="text-sm">{label}</div>
			<VoidSimpleInputBox value={value} onChangeValue={onChange} placeholder={placeholder} passwordBlur={secret} className="" />
			{hint && <div className="text-xs opacity-60 text-loophole-fg-3">{hint}</div>}
		</div>
	)

	return (
		<div className="w-full max-w-xl mb-10 flex flex-col gap-4">
			<div className="text-xl">Add a custom provider</div>
			{field('Provider id', id, setId, 'my-provider', 'Used as the provider part of provider/model.')}
			{field('Display name', name, setName, 'My Provider')}
			{field('Base URL', baseURL, setBaseURL, 'https://api.example.com/v1', 'OpenAI-compatible endpoint.')}
			{field('Model id', model, setModel, 'gpt-4o-mini', 'The id sent upstream for this endpoint.')}
			{field('API key', apiKey, setApiKey, 'sk-...', 'Stored in your editor settings.', true)}
			{error && <div className="text-amber-400 text-sm opacity-80">{error}</div>}
			{added && <div className="text-emerald-500 text-sm">Added {added}.</div>}
			<div>
				<button className={inlineActionButtonClass()} onClick={save}>Add provider</button>
			</div>
		</div>
	)
}

/**
 * Models are opt-in (nothing shows in the pickers until switched on), so a freshly connected
 * provider would leave chat with no model. This lets the user switch some on right here;
 * the first one switched on becomes the default chat model.
 */
const ModelsBlock = () => {
	const accessor = useAccessor()
	const configService = accessor.get('IConfigurationService')
	const chatThreadService = accessor.get('IChatThreadService')

	const { models, loading, error, reload } = useCliModels()
	const { enabled, toggle } = useEnabledCliModels()
	const [search, setSearch] = useState('')
	const [defaultRef, setDefaultRef] = useState(() => configService.getValue<string>(loopholeCliModelSettingId('default')) ?? '')

	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration(loopholeCliModelSettingId('default'))) return
			setDefaultRef(configService.getValue<string>(loopholeCliModelSettingId('default')) ?? '')
		})
		return () => disposable.dispose()
	}, [configService])

	const setDefault = (ref: string) => {
		configService.updateValue(loopholeCliModelSettingId('default'), ref)
		configService.updateValue('loophole.cli.model', ref)
		setDefaultRef(ref)
		// A CLI session is bound to the model it was created with; start a fresh one next turn.
		chatThreadService.clearCliSessionId(chatThreadService.state.currentThreadId)
	}

	const onPick = (model: LoopholeCliModelInfo) => {
		const ref = cliModelRef(model)
		const wasOn = enabled.includes(ref)
		toggle(ref)
		if (!wasOn && !defaultRef) setDefault(ref)
		if (wasOn && defaultRef === ref) setDefault(enabled.find((other) => other !== ref) ?? '')
	}

	const enabledSet = useMemo(() => new Set(enabled), [enabled])
	const query = search.trim().toLowerCase()
	const shown = useMemo(() => {
		const pool = query
			? models.filter((model) => `${model.providerID}/${model.modelID} ${model.name ?? ''}`.toLowerCase().includes(query))
			: models
		// Switched-on models first, so what the user picked never scrolls out of the short list.
		const sorted = [...pool].sort((a, b) => Number(enabledSet.has(cliModelRef(b))) - Number(enabledSet.has(cliModelRef(a))))
		return sorted.slice(0, query ? MAX_MODEL_SEARCH_RESULTS : MAX_MODELS_SHOWN)
	}, [models, query, enabledSet])

	return (
		<div className="w-full max-w-xl mt-8 bg-loophole-bg-2/50 rounded-lg p-6 border border-loophole-border-4">
			<div className="text-xl font-medium mb-2">Models</div>
			<div className="text-sm opacity-80 text-loophole-fg-3 mb-4">
				Switch on the models you want to use. The first one you pick becomes your default.
			</div>

			{loading && models.length === 0 && (
				<div className="flex items-center gap-2 text-sm opacity-80 text-loophole-fg-3">
					<Loader2 className="w-4 h-4 animate-spin" />Loading models from the CLI...
				</div>
			)}
			{error && (
				<div className="text-amber-400 text-sm opacity-80">
					{error} <button className="underline" onClick={reload}>Check again</button>
				</div>
			)}

			{models.length > 0 && (
				<>
					{models.length > MAX_MODELS_SHOWN && (
						<div className="mb-3">
							<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder={`Search ${models.length} models`} className="" />
						</div>
					)}
					<div className="flex flex-col gap-2">
						{shown.map((model) => {
							const ref = cliModelRef(model)
							const on = enabledSet.has(ref)
							return (
								<div
									key={ref}
									className={`flex items-center justify-between gap-3 py-2 px-3 rounded-md border cursor-pointer transition-all duration-200
										${on ? 'border-loophole-fg-1 bg-loophole-bg-2' : 'border-loophole-border-2 hover:border-loophole-border-1'}`}
									onClick={() => onPick(model)}
								>
									<div className="flex items-center gap-2 min-w-0">
										{on ? <Check className="w-4 h-4 text-emerald-500 shrink-0" /> : <div className="w-4 h-4 shrink-0" />}
										<span className="truncate">{model.name ?? model.modelID}</span>
										<span className="text-xs opacity-60 text-loophole-fg-3 shrink-0">{model.providerID}</span>
									</div>
									{on && (defaultRef === ref
										? <span className="text-xs text-emerald-500 shrink-0">Default</span>
										: <button
											className="text-xs text-loophole-fg-3 underline shrink-0"
											onClick={(e) => { e.stopPropagation(); setDefault(ref) }}
										>Set default</button>)}
								</div>
							)
						})}
						{shown.length === 0 && <div className="text-sm opacity-80 text-loophole-fg-3">No models match "{search}".</div>}
					</div>
					{!query && models.length > shown.length && (
						<div className="text-xs opacity-60 text-loophole-fg-3 mt-3">
							Showing {shown.length} of {models.length} models. Search to find the rest.
						</div>
					)}
				</>
			)}
		</div>
	)
}

const ConnectProviderPage = ({ pageIndex, setPageIndex }: { pageIndex: number, setPageIndex: (index: number) => void }) => {
	const { providers, integrations, phase, error, reload, refresh } = useCliProviders()
	const custom = useCustomProviders()
	const { enabled } = useEnabledCliModels()

	const [currentTab, setCurrentTab] = useState<ProviderTab>('Popular')
	const [search, setSearch] = useState('')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	useEffect(() => {
		let timeoutId: NodeJS.Timeout | null = null;
		if (errorMessage) {
			timeoutId = setTimeout(() => {
				setErrorMessage(null);
			}, 5000);
		}
		return () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		};
	}, [errorMessage]);

	const connectedIntegrationIDs = useMemo(
		() => new Set(providers.map((provider) => provider.integrationID ?? provider.id)),
		[providers],
	)

	// Everything the user can still connect with a key or OAuth (MCP servers are not providers).
	const available = useMemo(
		() => integrations.filter((integration) =>
			integration.metadata?.source !== 'mcp' &&
			!connectedIntegrationIDs.has(integration.id) &&
			hasConnectMethod(integration)),
		[integrations, connectedIntegrationIDs],
	)

	const popular = useMemo(
		() => popularIntegrationIDs
			.map((id) => available.find((integration) => integration.id === id))
			.filter((integration): integration is LoopholeCliIntegrationInfo => !!integration),
		[available],
	)

	const query = search.trim().toLowerCase()
	const allMatches = useMemo(
		() => available
			.filter((integration) => !query || integration.name.toLowerCase().includes(query) || integration.id.toLowerCase().includes(query))
			.sort((a, b) => a.name.localeCompare(b.name)),
		[available, query],
	)

	const providerCount = providers.length + custom.length
	const modelCount = enabled.length

	const checklist: { label: string, done: boolean, busy?: boolean }[] = [
		{ label: 'Loophole CLI', done: phase === 'ready', busy: phase === 'starting' },
		{ label: 'Provider', done: providerCount > 0 },
		{ label: 'Model', done: modelCount > 0 },
	]

	const onNext = () => {
		if (providerCount === 0) {
			setErrorMessage('Connect at least one provider, or choose "Skip for now".')
		} else if (modelCount === 0) {
			setErrorMessage('Switch on at least one model, or choose "Skip for now".')
		} else {
			setPageIndex(pageIndex + 1)
			setErrorMessage(null)
		}
	}

	const connectedNames = [...providers.map((provider) => provider.name), ...custom.map((entry) => entry.name)]

	return (<div className="flex flex-col md:flex-row w-full h-[80vh] gap-6 max-w-[900px] mx-auto relative">
		{/* Left Column */}
		<div className="md:w-1/4 w-full flex flex-col gap-6 p-6 border-none border-loophole-border-2 h-full overflow-y-auto">
			{/* Tab Selector */}
			<div className="flex md:flex-col gap-2">
				{providerTabNames.map(tab => (
					<button
						key={tab}
						className={`py-2 px-4 rounded-md text-left ${currentTab === tab
							? 'bg-[#0e70c0]/80 text-white font-medium shadow-sm'
							: 'bg-loophole-bg-2 hover:bg-loophole-bg-2/80 text-loophole-fg-1'
							} transition-all duration-200`}
						onClick={() => {
							setCurrentTab(tab);
							setErrorMessage(null);
						}}
					>
						{tab}
					</button>
				))}
			</div>

			{/* Setup Checklist */}
			<div className="flex flex-col gap-1 mt-4 text-sm opacity-80">
				{checklist.map(({ label, done, busy }) => (
					<div key={label} className="flex items-center gap-2">
						{done ? (
							<Check className="w-4 h-4 text-emerald-500" />
						) : busy ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<div className="w-3 h-3 rounded-full flex items-center justify-center">
								<div className="w-1 h-1 rounded-full bg-white/70"></div>
							</div>
						)}
						<span>{label}</span>
					</div>
				))}
			</div>
		</div>

		{/* Right Column */}
		<div className="flex-1 flex flex-col items-center justify-start p-6 h-full overflow-y-auto">
			<div className="text-5xl mb-2 text-center w-full">Add a Provider</div>

			<div className="w-full max-w-xl mt-4 mb-10">
				<div className="text-4xl font-light my-4 w-full">{currentTab}</div>
				<div className="text-sm opacity-80 text-loophole-fg-3 my-4 w-full">{descriptionOfProviderTab[currentTab]}</div>
			</div>

			{phase === 'starting' && (
				<div className="w-full max-w-xl mb-10 flex items-center gap-3 text-sm opacity-80 text-loophole-fg-3">
					<Loader2 className="w-4 h-4 animate-spin" />
					Starting the Loophole CLI... this can take a few seconds.
				</div>
			)}

			{phase === 'error' && (
				<div className="w-full max-w-xl mb-10 flex flex-col items-start gap-3">
					<div className="text-amber-400 text-sm opacity-80">{error ?? 'The Loophole CLI is not connected.'}</div>
					<button className={inlineActionButtonClass()} onClick={() => { void reload() }}>Try again</button>
					<div className="text-xs opacity-60 text-loophole-fg-3">You can also skip this step and connect a provider later in Settings.</div>
				</div>
			)}

			{phase === 'ready' && (
				<>
					{connectedNames.length > 0 && (
						<div className="w-full max-w-xl mb-8 flex flex-wrap gap-2">
							{connectedNames.map((providerName, i) => (
								<div key={`${providerName}-${i}`} className="flex items-center gap-1.5 text-sm px-3 py-1 rounded-md bg-loophole-bg-2">
									<Check className="w-4 h-4 text-emerald-500" />
									{providerName}
								</div>
							))}
						</div>
					)}

					{currentTab === 'Popular' && (
						popular.length > 0
							? popular.map((integration) => (
								<ProviderKeyBlock key={integration.id} integration={integration} onConnected={() => { void refresh() }} />
							))
							: <div className="w-full max-w-xl mb-10 text-sm opacity-80 text-loophole-fg-3">
								{integrations.length === 0 ? 'The CLI reported no providers.' : 'All popular providers are connected. Browse the rest in the All tab.'}
							</div>
					)}

					{currentTab === 'All' && (
						<>
							<div className="w-full max-w-xl mb-8">
								<VoidSimpleInputBox value={search} onChangeValue={setSearch} placeholder="Search providers" className="" />
							</div>
							{allMatches.slice(0, MAX_PROVIDERS_SHOWN).map((integration) => (
								<ProviderKeyBlock key={integration.id} integration={integration} onConnected={() => { void refresh() }} />
							))}
							{allMatches.length === 0 && (
								<div className="w-full max-w-xl mb-10 text-sm opacity-80 text-loophole-fg-3">
									{search ? 'No matching providers.' : 'No additional providers.'}
								</div>
							)}
							{allMatches.length > MAX_PROVIDERS_SHOWN && (
								<div className="w-full max-w-xl mb-10 text-xs opacity-60 text-loophole-fg-3">
									Showing {MAX_PROVIDERS_SHOWN} of {allMatches.length}. Search to narrow it down.
								</div>
							)}
						</>
					)}

					{currentTab === 'Custom' && <CustomProviderForm />}

					{providerCount > 0 && <ModelsBlock />}
				</>
			)}

			<div className="w-full max-w-xl mt-8 bg-loophole-bg-2/30 rounded-lg p-6 border border-loophole-border-4">
				<LocalVoiceModelSettings compact />
			</div>

			{/* Navigation buttons in right column */}
			<div className="flex flex-col items-end w-full mt-auto pt-8">
				{errorMessage && (
					<div className="text-amber-400 mb-2 text-sm opacity-80 transition-opacity duration-300">{errorMessage}</div>
				)}
				<div className="flex items-center gap-2">
					<PreviousButton onClick={() => setPageIndex(pageIndex - 1)} />
					<SkipButton onClick={() => setPageIndex(pageIndex + 1)} />
					<NextButton onClick={onNext} />
				</div>
			</div>
		</div>
	</div>);
};

const SkipButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded text-loophole-fg-3 opacity-80 underline underline-offset-4 hover:brightness-115 duration-600 transition-all"
			{...props}
		>
			Skip for now
		</button>
	)
}

const NextButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	const { disabled, ...buttonProps } = props;
	return (
		<button
			onClick={disabled ? undefined : onClick}
			onDoubleClick={onClick}
			className={`px-6 py-2 bg-zinc-100 ${disabled
				? 'bg-zinc-100/40 cursor-not-allowed'
				: 'hover:bg-zinc-100'
				} rounded text-black duration-600 transition-all
			`}
			{...disabled && {
				'data-tooltip-id': 'loophole-tooltip',
				"data-tooltip-content": 'Please enter all required fields or choose another provider',
				"data-tooltip-place": 'top',
			}}
			{...buttonProps}
		>
			Next
		</button>
	)
}

const PreviousButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded text-loophole-fg-3 opacity-80 hover:brightness-115 duration-600 transition-all"
			{...props}
		>
			Back
		</button>
	)
}

const OnboardingPageShell = ({ top, bottom, content, hasMaxWidth = true, className = '', }: {
	top?: React.ReactNode,
	bottom?: React.ReactNode,
	content?: React.ReactNode,
	hasMaxWidth?: boolean,
	className?: string,
}) => {
	return (
		<div className={`h-[80vh] text-lg flex flex-col gap-4 w-full mx-auto ${hasMaxWidth ? 'max-w-[600px]' : ''} ${className}`}>
			{top && <FadeIn className='w-full mb-auto pt-16'>{top}</FadeIn>}
			{content && <FadeIn className='w-full my-auto'>{content}</FadeIn>}
			{bottom && <div className='w-full pb-8'>{bottom}</div>}
		</div>
	)
}

const OllamaDownloadOrRemoveModelButton = ({ modelName, isModelInstalled, sizeGb }: { modelName: string, isModelInstalled: boolean, sizeGb: number | false | 'not-known' }) => {
	return <a
		href={`https://ollama.com/library/${modelName}`}
		target="_blank"
		rel="noopener noreferrer"
		className="flex items-center justify-center text-loophole-fg-2 hover:text-loophole-fg-1"
	>
		<ExternalLink className="w-3.5 h-3.5" />
	</a>
}

const YesNoText = ({ val }: { val: boolean | null }) => {
	return <div
		className={
			val === true ? "text text-emerald-500"
				: val === false ? 'text-rose-600'
					: "text text-amber-300"
		}
	>
		{val === true ? "Yes" : val === false ? 'No' : "Yes*"}
	</div>
}

const abbreviateNumber = (num: number): string => {
	if (num >= 1000000) return Math.floor(num / 1000000) + 'M';
	else if (num >= 1000) return Math.floor(num / 1000) + 'K';
	else return num.toString();
}

const PrimaryActionButton = ({ children, className, ringSize, ...props }: { children: React.ReactNode, ringSize?: undefined | 'xl' | 'screen' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			type='button'
			className={`
				flex items-center justify-center
				text-white dark:text-black
				bg-black/90 dark:bg-white/90
				${ringSize === 'xl' ? `gap-2 px-16 py-8 transition-all duration-300 ease-in-out`
					: ringSize === 'screen' ? `gap-2 px-16 py-8 transition-all duration-1000 ease-in-out`
					: ringSize === undefined ? `gap-1 px-4 py-2 transition-all duration-300 ease-in-out`
					: ''}
				rounded-lg
				group
				${className}
			`}
			{...props}
		>
			{children}
			<ChevronRight
				className={`
					transition-all duration-300 ease-in-out
					transform
					group-hover:translate-x-1
					group-active:translate-x-1
				`}
			/>
		</button>
	)
}

// =============================================
//  ThemePickerPage (Loophole feature)
// =============================================

type ThemeOption = {
	name: string;
	id: string;
	isDark: boolean;
	isLoophole: boolean;
}

const themeOptions: ThemeOption[] = [
	{ name: 'Loophole Dark',  id: 'Loophole Dark',  isDark: true,  isLoophole: true  },
	{ name: 'Loophole Light', id: 'Loophole Light', isDark: false, isLoophole: true  },
	{ name: 'Dark 2026',      id: 'Dark 2026',      isDark: true,  isLoophole: false },
	{ name: 'Light 2026',     id: 'Light 2026',     isDark: false, isLoophole: false },
]

const ThemePickerPage = ({ pageIndex, setPageIndex }: { pageIndex: number, setPageIndex: (index: number) => void }) => {
	const accessor = useAccessor()
	const [selectedThemeId, setSelectedThemeId] = useState<string>('Loophole Dark')

	const applyTheme = (themeId: string) => {
		const configurationService = accessor.get('IConfigurationService')
		configurationService.updateValue('workbench.colorTheme', themeId)
	}

	const navButtons = (
		<div className="max-w-[700px] w-full mx-auto flex flex-col items-end">
			<div className="flex items-center gap-2">
				<PreviousButton onClick={() => setPageIndex(pageIndex - 1)} />
				<NextButton onClick={() => setPageIndex(pageIndex + 1)} />
			</div>
		</div>
	)

	return (
		<OnboardingPageShell
			hasMaxWidth={false}
			content={
				<div className="flex flex-col items-center w-full max-w-[700px] mx-auto">
					<div className="text-5xl font-light text-center mb-12">Choose your theme</div>

					<div className="grid grid-cols-2 gap-5 w-full mb-8">
						{themeOptions.map((theme) => (
							<div
								key={theme.id}
								className={`
									relative cursor-pointer rounded-xl p-4 border-2 transition-all duration-200
									${selectedThemeId === theme.id
										? 'border-loophole-fg-1 bg-loophole-bg-2'
										: 'border-loophole-border-2 hover:border-loophole-border-1'
									}
								`}
								onClick={() => {
									setSelectedThemeId(theme.id)
									applyTheme(theme.id)
								}}
							>
								{/* Theme Preview */}
								<div
									className="w-full h-36 rounded-lg mb-3 overflow-hidden"
									style={{
										background: theme.isLoophole
											? (theme.isDark ? '#131210' : '#ffffff')
											: (theme.isDark ? '#1e1e1e' : '#ffffff'),
										padding: '8px',
										fontFamily: 'Consolas, Monaco, monospace',
										fontSize: '11px',
									}}
								>
									<div
										className="flex gap-1 mb-2 p-1 rounded"
										style={{
											background: theme.isLoophole
												? (theme.isDark ? '#24221e' : '#f0f0f0')
												: (theme.isDark ? '#181818' : '#f3f3f3'),
										}}
									>
										<div
											className="w-2 h-2 rounded-full"
											style={{
												background: theme.isLoophole
													? '#80cbc4'
													: (theme.isDark ? '#3d3d3d' : '#d0d0d0')
											}}
										/>
									</div>

									<div style={{
										color: theme.isLoophole
											? (theme.isDark ? '#dfd9d0' : '#2d2d2d')
											: (theme.isDark ? '#d4d4d4' : '#333333')
									}}>
										<div>
											<span style={{
												color: theme.isLoophole
													? (theme.isDark ? '#89DDFF' : '#4a90d9')
													: (theme.isDark ? '#569cd6' : '#0000ff')
											}}>function</span>{' '}
											<span style={{
												color: theme.isLoophole
													? (theme.isDark ? '#82AAFF' : '#4a7cc9')
													: (theme.isDark ? '#dcdcaa' : '#795e26')
											}}>add</span>
											(x, y) {'{'}
										</div>
										<div style={{ paddingLeft: '12px' }}>
											<span style={{
												color: theme.isLoophole
													? (theme.isDark ? '#89DDFF' : '#4a90d9')
													: (theme.isDark ? '#569cd6' : '#0000ff')
											}}>return</span>{' '}
											x + y;
										</div>
										<div style={{
											color: theme.isLoophole
												? (theme.isDark ? '#46443e' : '#6b6b6b')
												: (theme.isDark ? '#6a9955' : '#008000')
										}}>
											{'// code comment'}
										</div>
										<div>{'}'}</div>
									</div>
								</div>

								<div className="text-center text-sm font-medium text-loophole-fg-1">
									{theme.name}
								</div>

								{selectedThemeId === theme.id && (
									<div className="absolute top-3 right-3">
										<Check className="w-5 h-5 text-loophole-fg-1" />
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			}
			bottom={navButtons}
		/>
	)
}

// =============================================
//  LoopholeOnboardingContent
// =============================================

const LoopholeOnboardingContent = () => {

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidMetricsService = accessor.get('IMetricsService')

	const voidSettingsState = useSettingsState()

	const [pageIndex, setPageIndex] = useState(0)

	const prevAndNextButtons = <div className="max-w-[600px] w-full mx-auto flex flex-col items-end">
		<div className="flex items-center gap-2">
			<PreviousButton onClick={() => { setPageIndex(pageIndex - 1) }} />
			<NextButton onClick={() => { setPageIndex(pageIndex + 1) }} />
		</div>
	</div>

	const lastPagePrevAndNextButtons = <div className="max-w-[600px] w-full mx-auto flex flex-col items-end">
		<div className="flex items-center gap-2">
			<PreviousButton onClick={() => { setPageIndex(pageIndex - 1) }} />
			<PrimaryActionButton
				onClick={() => {
					voidSettingsService.setGlobalSetting('isOnboardingComplete', true);
					voidMetricsService.capture('Completed Onboarding', {})
				}}
				ringSize={voidSettingsState.globalSettings.isOnboardingComplete ? 'screen' : undefined}
			>Enter Loophole</PrimaryActionButton>
		</div>
	</div>

	// reset the page to page 0 if the user redos onboarding
	const prevIsComplete = useRef(voidSettingsState.globalSettings.isOnboardingComplete)
	useEffect(() => {
		const isComplete = voidSettingsState.globalSettings.isOnboardingComplete
		if (prevIsComplete.current === true && isComplete === false) {
			setPageIndex(0)
		}
		prevIsComplete.current = isComplete
	}, [voidSettingsState.globalSettings.isOnboardingComplete])

	const contentOfIdx: { [pageIndex: number]: React.ReactNode } = {
		// Page 0: Welcome
		0: <OnboardingPageShell
			content={
				<div className='flex flex-col items-center gap-8'>
					<div className="text-5xl font-light text-center">Welcome to Loophole</div>
					<div className='max-w-md w-full h-[30vh] mx-auto flex items-center justify-center'>
						{!isLinux && <LoopholeIcon />}
					</div>
					<FadeIn delayMs={1000}>
						<PrimaryActionButton onClick={() => { setPageIndex(1) }}>
							Get Started
						</PrimaryActionButton>
					</FadeIn>
				</div>
			}
		/>,

		// Page 1: Add a Provider (Loophole CLI)
		1: <OnboardingPageShell hasMaxWidth={false}
			content={
				<ConnectProviderPage pageIndex={pageIndex} setPageIndex={setPageIndex} />
			}
		/>,

		// Page 2: Choose Your Theme
		2: <ThemePickerPage pageIndex={pageIndex} setPageIndex={setPageIndex} />,

		// Page 3: Settings and editor import
		3: <OnboardingPageShell
			content={
				<div>
					<div className="text-5xl font-light text-center">Settings and Themes</div>
					<div className="mt-8 text-center flex flex-col items-center gap-4 w-full max-w-md mx-auto">
						<h4 className="text-loophole-fg-3 mb-4">Transfer your settings from an existing editor?</h4>
						<OneClickSwitchButton className='w-full px-4 py-2' fromEditor="VS Code" />
						<OneClickSwitchButton className='w-full px-4 py-2' fromEditor="Cursor" />
						<OneClickSwitchButton className='w-full px-4 py-2' fromEditor="Windsurf" />
					</div>
				</div>
			}
			bottom={lastPagePrevAndNextButtons}
		/>,
	}

	return <div key={pageIndex} className="w-full h-[80vh] text-left mx-auto flex flex-col items-center justify-center">
		<ErrorBoundary>
			{contentOfIdx[pageIndex]}
		</ErrorBoundary>
	</div>

}
