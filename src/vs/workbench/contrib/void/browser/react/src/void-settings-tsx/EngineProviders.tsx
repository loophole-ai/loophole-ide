/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, X, ExternalLink, RefreshCw } from 'lucide-react';
import { useAccessor } from '../util/services.js';
import { VoidButtonBgDarken, VoidSimpleInputBox } from '../util/inputs.js';
import { WarningBox } from './WarningBox.js';
import Severity from '../../../../../../../base/common/severity.js';
import {
	EngineCredential,
	EngineIntegration,
	EngineIntegrationMethod,
	EngineOAuthAttempt,
	EngineOAuthAttemptStatus,
} from '../../../../common/loopholeEngineTypes.js';

const POPULAR_PROVIDER_IDS = ['anthropic', 'openai', 'google', 'openrouter', 'vercel', 'github-copilot', 'ollama'];

const msgOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type ConnectStep =
	| { readonly kind: 'pick' }
	| { readonly kind: 'key' }
	| { readonly kind: 'oauth'; readonly attempt: EngineOAuthAttempt; readonly status: EngineOAuthAttemptStatus; readonly codeInput?: string }
	| { readonly kind: 'command'; readonly attemptID: string; readonly status: EngineOAuthAttemptStatus };

type AccountRow = {
	readonly credentialID: string;
	readonly label: string;
	readonly active: boolean;
	readonly method: string | undefined;
	readonly needsAuth: boolean;
};

const isDirectMethod = (method: EngineIntegrationMethod): boolean =>
	method.type === 'oauth' || method.type === 'command' || method.type === 'external' || method.type === 'key';

const methodLabel = (method: EngineIntegrationMethod): string => {
	if (method.label) return method.label;
	if (method.type === 'oauth') return 'Sign in with browser';
	if (method.type === 'command') return 'Run helper command';
	if (method.type === 'key') return 'API key';
	if (method.type === 'external') return 'External credentials';
	return 'Environment variables';
};

const badgeFor = (method: string | undefined): string => {
	if (method === 'oauth') return 'browser setup';
	if (method === 'external') return 'external setup';
	if (method === 'key') return 'API key';
	return 'account';
};

const accountsOf = (integration: EngineIntegration, credentials: EngineCredential[]): AccountRow[] => {
	const rows: AccountRow[] = [];
	for (const connection of integration.connections) {
		if (connection.type === 'credential' && connection.id) {
			const credential = credentials.find((entry) => entry.id === connection.id);
			rows.push({
				credentialID: connection.id,
				label: credential?.label ?? connection.label ?? 'Account',
				active: credential?.active ?? true,
				method: connection.method,
				needsAuth: connection.needsAuth,
			});
		}
	}
	return rows;
};

const envNamesOf = (integration: EngineIntegration): string[] | undefined =>
	integration.methods.find((method) => method.type === 'env')?.names;

export const EngineProvidersSection = () => {
	const accessor = useAccessor()
	const engine = accessor.get('ILoopholeEngineService')
	const engineWorkbench = accessor.get('ILoopholeEngineWorkbenchService')
	const notificationService = accessor.get('INotificationService')

	const [data, setData] = useState<{ readonly integrations: EngineIntegration[]; readonly credentials: EngineCredential[] } | null>(null)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [dialogIntegration, setDialogIntegration] = useState<EngineIntegration | null>(null)
	const [search, setSearch] = useState('')

	const reload = useCallback(() => {
		setLoadError(null)
		Promise.all([
			engine.listIntegrations(),
			engine.listCredentials(),
		]).then(([integrations, credentials]) => {
			setData({ integrations, credentials })
		}, (error) => {
			setLoadError(msgOf(error))
			setData({ integrations: [], credentials: [] })
		})
	}, [engine])

	useEffect(() => {
		reload()
	}, [reload])

	const onConnected = useCallback((integration: EngineIntegration) => {
		setDialogIntegration(null)
		notificationService.info(`${integration.name} connected`)
		void engineWorkbench.preferIntegration(integration.id)
		reload()
	}, [engineWorkbench, notificationService, reload])

	const searchValue = search.trim().toLowerCase()
	const integrations = data?.integrations ?? []
	const matched = integrations.filter((integration) => {
		if (!searchValue) return true
		return integration.name.toLowerCase().includes(searchValue) || integration.id.toLowerCase().includes(searchValue)
	})
	const connected = matched.filter((integration) => integration.connections.length > 0)
	const unconnected = matched.filter((integration) => integration.connections.length === 0)
	const popular = unconnected.filter((integration) => POPULAR_PROVIDER_IDS.some((id) => integration.id === id || integration.id.startsWith(id)))
	const popularIDs = new Set(popular.map((integration) => integration.id))
	const others = unconnected.filter((integration) => !popularIDs.has(integration.id))

	const renderRows = (rows: EngineIntegration[], keyPrefix: string) => (
		<div className='flex flex-col gap-1'>
			{rows.map((integration) => (
				<ProviderRow
					key={`${keyPrefix}-${integration.id}`}
					integration={integration}
					credentials={data?.credentials ?? []}
					reload={reload}
					hasDirect={integration.methods.some(isDirectMethod)}
					envNames={envNamesOf(integration)}
					onConnect={() => setDialogIntegration(integration)}
				/>
			))}
			{rows.length === 0 && <p className='text-loophole-fg-3 text-sm px-3 py-2'>None yet.</p>}
		</div>
	)

	return (
		<div>
			<div className='flex items-center justify-between mb-3'>
				<h2 className='text-3xl'>Providers</h2>
				<VoidButtonBgDarken className='px-3 py-1.5 rounded-md' onClick={reload} disabled={data === null}>
					{data === null
						? <Loader2 className='w-4 h-4 animate-spin' />
						: <RefreshCw className='w-4 h-4' />}
				</VoidButtonBgDarken>
			</div>

			<p className='text-loophole-fg-3 text-sm mb-5'>Connect the providers the engine uses for chat, editing and terminal features. Connections are shared with the Loophole CLI.</p>

			{loadError && <div className='mb-5'><WarningBox text={loadError} /></div>}

			<div className='mb-6'>
				<VoidSimpleInputBox
					value={search}
					onChangeValue={setSearch}
					placeholder='Search providers...'
					className='w-full'
				/>
			</div>

			<h3 className='text-lg mb-2'>Connected</h3>
			<div className='mb-8'>{renderRows(connected, 'connected')}</div>

			{popular.length > 0 && <>
				<h3 className='text-lg mb-2'>Popular</h3>
				<div className='mb-8'>{renderRows(popular, 'popular')}</div>
			</>}

			{others.length > 0 && <>
				<h3 className='text-lg mb-2'>Other providers</h3>
				<div className='mb-8'>{renderRows(others, 'others')}</div>
			</>}

			{data !== null && integrations.length === 0 && !loadError && (
				<p className='text-loophole-fg-3 text-sm'>No providers are available. Start the Loophole engine and reopen this page.</p>
			)}

			{dialogIntegration && <ConnectDialog
				integration={dialogIntegration}
				onClose={() => setDialogIntegration(null)}
				onConnected={onConnected}
			/>}
		</div>
	)
}

const ProviderRow = ({ integration, credentials, reload, hasDirect, envNames, onConnect }: {
	integration: EngineIntegration
	credentials: EngineCredential[]
	reload: () => void
	hasDirect: boolean
	envNames: string[] | undefined
	onConnect: () => void
}) => {
	const accessor = useAccessor()
	const engine = accessor.get('ILoopholeEngineService')
	const engineWorkbench = accessor.get('ILoopholeEngineWorkbenchService')
	const notificationService = accessor.get('INotificationService')

	const [busy, setBusy] = useState(false)
	const [renaming, setRenaming] = useState<{ readonly credentialID: string; readonly value: string } | null>(null)

	const accounts = accountsOf(integration, credentials)

	const disconnect = async (credentialID: string) => {
		setBusy(true)
		try {
			await engine.removeCredential(credentialID)
			notificationService.info(`${integration.name} disconnected`)
			await engineWorkbench.refreshModels()
			reload()
		} catch (error) {
			notificationService.notify({ message: `Could not disconnect ${integration.name}`, source: msgOf(error), severity: Severity.Error })
		} finally {
			setBusy(false)
		}
	}

	const activate = async (credentialID: string) => {
		setBusy(true)
		try {
			await engine.activateCredential(credentialID)
			await engineWorkbench.preferIntegration(integration.id)
			reload()
		} catch (error) {
			notificationService.notify({ message: `Could not switch the account for ${integration.name}`, source: msgOf(error), severity: Severity.Error })
		} finally {
			setBusy(false)
		}
	}

	const rename = async (credentialID: string, label: string) => {
		setBusy(true)
		try {
			await engine.renameCredential(credentialID, label)
			setRenaming(null)
			reload()
		} catch (error) {
			notificationService.notify({ message: 'Could not rename the account', source: msgOf(error), severity: Severity.Error })
		} finally {
			setBusy(false)
		}
	}

	const manageAccounts = accounts.filter((account) => account.method !== 'env')

	return (
		<div className='px-3 py-2.5 rounded-md bg-loophole-bg-2'>
			<div className='flex items-start justify-between gap-4'>
				<div className='min-w-0'>
					<div className='flex items-center gap-2 flex-wrap'>
						<span className='text-sm font-medium'>{integration.name}</span>
						{accounts.map((account) => (
							<span key={`badge-${account.credentialID}`} className='text-[11px] px-1.5 py-0.5 rounded bg-loophole-bg-3 text-loophole-fg-3'>
								{badgeFor(account.method)}{account.needsAuth ? ' · sign in again' : ''}
							</span>
						))}
						{accounts.length === 0 && envNames && integration.connections.length === 0 && (
							<span className='text-[11px] px-1.5 py-0.5 rounded bg-loophole-bg-3 text-loophole-fg-3'>
								environment variables
							</span>
						)}
					</div>
					{manageAccounts.length > 0 && !renaming && (
						<div className='text-[11px] text-loophole-fg-3 mt-1'>
							{manageAccounts.map((account) => account.active ? account.label : `${account.label} · inactive`).join(' · ')}
						</div>
					)}
					{envNames && (
						<div className='text-[11px] text-loophole-fg-3 mt-1'>
							uses {envNames.join(' / ')} when no account is connected
						</div>
					)}
				</div>

				<div className='flex items-center gap-2 shrink-0'>
					{hasDirect && <VoidButtonBgDarken className='px-3 py-1 rounded-md text-xs' onClick={onConnect} disabled={busy}>{accounts.length > 0 ? 'Add account' : 'Connect'}</VoidButtonBgDarken>}
					{!hasDirect && <span className='text-[11px] text-loophole-fg-3'>set the variables above</span>}
				</div>
			</div>

			{manageAccounts.length > 0 && <div className='mt-2 pt-2 border-t border-loophole-bg-3 flex flex-col gap-1.5'>
				{manageAccounts.map((account) => (
					<div key={account.credentialID} className='flex items-center justify-between gap-2'>
						{renaming?.credentialID === account.credentialID ? <div className='flex items-center gap-2'>
							<VoidSimpleInputBox value={renaming.value} onChangeValue={(value) => setRenaming((current) => current ? { ...current, value } : current)} placeholder={account.label} className='w-60' />
							<VoidButtonBgDarken className='px-2 py-0.5 rounded text-xs' onClick={() => account.credentialID && rename(account.credentialID, renaming.value)} disabled={busy}>Save</VoidButtonBgDarken>
							<VoidButtonBgDarken className='px-2 py-0.5 rounded text-xs' onClick={() => setRenaming(null)} disabled={busy}>Cancel</VoidButtonBgDarken>
						</div>
							: <>
								<span className={`text-xs ${account.active ? 'text-loophole-fg-1' : 'text-loophole-fg-3'}`}>
									{account.active && <Check className='inline w-3 h-3 mr-1' />}{account.label}
								</span>
								<span className='flex items-center gap-1.5'>
									{!account.active && <VoidButtonBgDarken className='px-2 py-0.5 rounded text-xs' onClick={() => activate(account.credentialID)} disabled={busy}>Use</VoidButtonBgDarken>}
									<VoidButtonBgDarken className='px-2 py-0.5 rounded text-xs' onClick={() => setRenaming({ credentialID: account.credentialID, value: account.label })} disabled={busy}>Rename</VoidButtonBgDarken>
									<VoidButtonBgDarken className='px-2 py-0.5 rounded text-xs' onClick={() => disconnect(account.credentialID)} disabled={busy}><X className='w-3 h-3' /></VoidButtonBgDarken>
								</span>
							</>}
					</div>
				))}
			</div>}
		</div>
	)
}

const ConnectDialog = ({ integration, onClose, onConnected }: {
	integration: EngineIntegration
	onClose: () => void
	onConnected: (integration: EngineIntegration) => void
}) => {
	const accessor = useAccessor()
	const engine = accessor.get('ILoopholeEngineService')

	const directMethods = integration.methods.filter(isDirectMethod)
	const [step, setStep] = useState<ConnectStep>({ kind: 'pick' })
	const [error, setError] = useState<string | null>(null)
	const [apiKey, setApiKey] = useState('')
	const [busy, setBusy] = useState(false)

	const succeed = useCallback(() => {
		onConnected(integration)
	}, [integration, onConnected])

	const fail = useCallback((error: unknown) => {
		setError(msgOf(error))
		setBusy(false)
	}, [])

	const startOAuth = useCallback((method: EngineIntegrationMethod) => {
		if (!method.id) return
		setBusy(true)
		engine.beginOAuth(integration.id, method.id).then(
			(attempt) => {
				setBusy(false)
				if (attempt.mode === 'auto') window.open(attempt.url, '_blank')
				setStep({ kind: 'oauth', attempt, status: { status: 'pending' }, codeInput: '' })
			},
			fail,
		)
	}, [engine, integration.id, fail])

	const startCommand = useCallback((method: EngineIntegrationMethod) => {
		if (!method.id) return
		setBusy(true)
		engine.beginCommand(integration.id, method.id).then(
			({ attemptID }) => {
				setBusy(false)
				setStep({ kind: 'command', attemptID, status: { status: 'pending' } })
			},
			fail,
		)
	}, [engine, integration.id, fail])

	const connectExternal = useCallback((method: EngineIntegrationMethod) => {
		if (!method.id) return
		setBusy(true)
		engine.connectWithExternal(integration.id, method.id).then(succeed, fail)
	}, [engine, integration.id, succeed, fail])

	const chooseStep = useCallback((method: EngineIntegrationMethod) => {
		if (method.type === 'oauth' && method.id) return startOAuth(method)
		if (method.type === 'command' && method.id) return startCommand(method)
		if (method.type === 'external' && method.id) return connectExternal(method)
		setStep({ kind: 'key' })
	}, [startOAuth, startCommand, connectExternal])

	const envNames = integration.methods.find((method) => method.type === 'env')?.names

	useEffect(() => {
		const method = directMethods[0]
		if (!method || directMethods.length !== 1) return
		if (method.type === 'oauth' && method.id) startOAuth(method)
		else if (method.type === 'command' && method.id) startCommand(method)
		else if (method.type === 'external' && method.id) connectExternal(method)
		else setStep({ kind: 'key' })
	}, [])

	useEffect(() => {
		if (step.kind !== 'oauth' || !step.attempt.attemptID) return
		const timer = setInterval(() => {
			engine.oauthStatus(integration.id, step.attempt.attemptID).then(
				(status) => setStep((current) => current.kind === 'oauth' ? { ...current, status } : current),
				fail,
			)
		}, 1000)
		return () => clearInterval(timer)
	}, [step, engine, integration.id, fail])

	useEffect(() => {
		if (step.kind !== 'oauth' || step.status.status !== 'complete') return
		const timer = setTimeout(() => {
			engine.completeOAuth(integration.id, step.attempt.attemptID, undefined).then(succeed, fail)
		}, 10)
		return () => clearTimeout(timer)
	}, [step, engine, integration.id, succeed, fail])

	useEffect(() => {
		if (step.kind !== 'command' || !step.attemptID) return
		const timer = setInterval(() => {
			engine.commandStatus(integration.id, step.attemptID).then(
				(status) => setStep((current) => current.kind === 'command' ? { ...current, status } : current),
				fail,
			)
		}, 1000)
		return () => clearInterval(timer)
	}, [step, engine, integration.id, fail])

	useEffect(() => {
		if (step.kind !== 'command' || step.status.status !== 'complete') return
		succeed()
	}, [step, succeed])

	const finishCode = () => {
		if (step.kind !== 'oauth') return
		setBusy(true)
		engine.completeOAuth(integration.id, step.attempt.attemptID, step.codeInput).then(
			() => succeed(),
			fail,
		)
	}

	const cancelOAuth = () => {
		if (step.kind !== 'oauth' || !step.attempt.attemptID) return
		void engine.cancelOAuth(integration.id, step.attempt.attemptID).catch(() => undefined)
		onClose()
	}

	const cancelCommand = () => {
		if (step.kind !== 'command' || !step.attemptID) return
		void engine.cancelCommand(integration.id, step.attemptID).catch(() => undefined)
		onClose()
	}

	const statusView: React.ReactNode = (() => {
		if (step.kind === 'oauth') {
			if (step.status.status === 'complete') return <p className='text-sm flex items-center gap-2'><Check className='w-4 h-4' />Authorized — finishing up...</p>
			if (step.status.status === 'failed') return <p className='text-sm text-[#dd6666]'>{step.status.message ?? 'Authorization failed.'}</p>
			if (step.status.status === 'expired') return <p className='text-sm text-[#dd6666]'>The authorization attempt expired. Start again.</p>
			return <p className='text-sm text-loophole-fg-3 flex items-center gap-2'><Loader2 className='w-3.5 h-3.5 animate-spin' />Waiting for authorization...</p>
		}
		if (step.kind === 'command') {
			if (step.status.status === 'complete') return <p className='text-sm flex items-center gap-2'><Check className='w-4 h-4' />Connected</p>
			if (step.status.status === 'failed') return <p className='text-sm text-[#dd6666]'>{step.status.message ?? 'The helper command failed.'}</p>
			if (step.status.status === 'expired') return <p className='text-sm text-[#dd6666]'>The attempt expired. Start again.</p>
			return <p className='text-sm text-loophole-fg-3 flex items-center gap-2'><Loader2 className='w-3.5 h-3.5 animate-spin' />{step.status.message ?? 'Running the helper...'}</p>
		}
		return null
	})()

	return (
		<div className='fixed inset-0 flex items-center justify-center bg-black/60' style={{ zIndex: 1000 }} onClick={onClose}>
			<div className='bg-loophole-bg-1 rounded-lg shadow-2xl w-[480px] max-w-[90vw] max-h-[80vh] overflow-y-auto p-6' onClick={(event) => event.stopPropagation()}>
				<div className='flex items-center justify-between mb-4'>
					<h3 className='text-xl'>{integration.name}</h3>
					<VoidButtonBgDarken className='p-1 rounded' onClick={onClose}><X className='w-4 h-4' /></VoidButtonBgDarken>
				</div>

				{error && <div className='mb-4'><WarningBox text={error} /></div>}

				{step.kind === 'pick' && <div className='flex flex-col gap-2'>
					{directMethods.map((method) => (
						<VoidButtonBgDarken key={`${method.type}-${method.id ?? 'key'}`} className='px-3 py-2 rounded-md text-left text-sm' onClick={() => chooseStep(method)} disabled={busy}>
							{methodLabel(method)}
						</VoidButtonBgDarken>
					))}
					{envNames && <p className='text-xs text-loophole-fg-3'>Also usable with the {envNames.join(' / ')} environment variables.</p>}
				</div>}

				{step.kind === 'key' && <KeyStep integrationName={integration.name} busy={busy} apiKey={apiKey} onApiKey={setApiKey} onSubmit={async () => {
					setBusy(true)
					await engine.connectWithKey(integration.id, apiKey).then(succeed, fail)
				}} />}

				{step.kind === 'oauth' && <>
					{step.attempt.instructions && <p className='text-sm text-loophole-fg-3 mb-3'>{step.attempt.instructions}</p>}
					{step.attempt.url && <VoidButtonBgDarken className='px-3 py-1.5 rounded-md self-start mb-3' onClick={() => window.open(step.attempt.url, '_blank')}>
						<ExternalLink className='inline w-3.5 h-3.5 mr-1.5' />Open authorization page
					</VoidButtonBgDarken>}
					{step.attempt.mode === 'code' && <div className='flex flex-col gap-2 mb-3'>
						<VoidSimpleInputBox
							value={step.codeInput ?? ''}
							onChangeValue={(value) => setStep((current) => current.kind === 'oauth' ? { ...current, codeInput: value } : current)}
							placeholder='Paste the code here'
							className='w-full'
						/>
						<VoidButtonBgDarken className='px-3 py-1.5 rounded-md self-start' onClick={finishCode} disabled={busy || !step.codeInput?.trim()}>Finish</VoidButtonBgDarken>
					</div>}
					{statusView}
					<VoidButtonBgDarken className='px-3 py-1.5 rounded-md mt-3' onClick={cancelOAuth}>Cancel</VoidButtonBgDarken>
				</>}

				{step.kind === 'command' && <>
					{statusView}
					<VoidButtonBgDarken className='px-3 py-1.5 rounded-md mt-3' onClick={cancelCommand}>Cancel</VoidButtonBgDarken>
				</>}
			</div>
		</div>
	)
}

const KeyStep = ({ integrationName, busy, apiKey, onApiKey, onSubmit }: {
	integrationName: string
	busy: boolean
	apiKey: string
	onApiKey: (value: string) => void
	onSubmit: () => void
}) => (
	<div className='flex flex-col gap-3'>
		<p className='text-sm text-loophole-fg-3'>Paste the {integrationName} API key. It is stored by the engine, not inside the editor.</p>
		<VoidSimpleInputBox value={apiKey} onChangeValue={onApiKey} placeholder='API key' className='w-full' passwordBlur />
		<div className='flex items-center gap-2'>
			<VoidButtonBgDarken className='px-3 py-1.5 rounded-md' onClick={onSubmit} disabled={busy || !apiKey.trim()}>Connect</VoidButtonBgDarken>
		</div>
	</div>
)
