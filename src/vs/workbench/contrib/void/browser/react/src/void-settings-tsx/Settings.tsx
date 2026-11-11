/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { os } from '../../../../common/helpers/systemInfo.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidButtonBgDarken, VoidCustomDropdownBox, VoidInputBox2, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useIsOptedOut, useSettingsState } from '../util/services.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import Severity from '../../../../../../../base/common/severity.js'
import { TransferEditorType } from '../../../extensionTransferTypes.js'
import { MCPServer } from '../../../../common/mcpServiceTypes.js'
import { useMCPServiceState } from '../util/services.js'
import { PROJECT_MEMORY_STORAGE_KEY } from '../../../../common/storageKeys.js'
import { StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js'
import { CliProvidersTab } from './cli-settings/CliProvidersTab.js'
import { CliModelsTab } from './cli-settings/CliModelsTab.js'
import { CliAutocompleteTab } from './cli-settings/CliAutocompleteTab.js'
import { CliContextTab } from './cli-settings/CliContextTab.js'
import { CliCommitMessageTab } from './cli-settings/CliCommitMessageTab.js'
import { CliNotificationsTab } from './cli-settings/CliNotificationsTab.js'
import { CliStatusTab } from './cli-settings/CliStatusTab.js'
import { CliAboutTab } from './cli-settings/CliAboutTab.js'

type Tab =
	| 'models'
	| 'providers'
	| 'autocomplete'
	| 'context'
	| 'commitMessage'
	| 'notifications'
	| 'status'
	| 'general'
	| 'mcp'
	| 'about'
	| 'all';

const navItems: { tab: Tab, label: string }[] = [
	{ tab: 'models', label: 'Models' },
	{ tab: 'providers', label: 'Providers' },
	{ tab: 'autocomplete', label: 'Autocomplete' },
	{ tab: 'context', label: 'Context' },
	{ tab: 'commitMessage', label: 'Commit Message' },
	{ tab: 'notifications', label: 'Notifications' },
	{ tab: 'status', label: 'Status' },
	{ tab: 'general', label: 'General' },
	{ tab: 'mcp', label: 'MCP' },
	{ tab: 'about', label: 'About' },
	{ tab: 'all', label: 'All Settings' },
]

export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40)

	useEffect(() => {
		const startTime = performance.now()
		const duration = 500

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime
			const progress = Math.min(elapsed / duration, 1)
			setDashOffset(40 - (progress * 40))
			if (progress < 1) requestAnimationFrame(animate)
		}

		const animationId = requestAnimationFrame(animate)
		return () => cancelAnimationFrame(animationId)
	}, [])

	return <div
		className={`flex items-center gap-1.5 w-fit
			${className ? className : `px-2 py-0.5 text-xs text-zinc-900 bg-zinc-100 rounded-sm`}
		`}
	>
		<svg className='size-4' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
			<path
				d='M5 13l4 4L19 7'
				stroke='currentColor'
				strokeWidth='2'
				strokeLinecap='round'
				strokeLinejoin='round'
				style={{ strokeDasharray: 40, strokeDashoffset: dashOffset }}
			/>
		</svg>
		{text}
	</div>
}

// ConfirmButton prompts for a second click to confirm an action, cancels if clicking outside
const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!confirm) return
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false)
			}
		}
		document.addEventListener('click', handleClickOutside)
		return () => document.removeEventListener('click', handleClickOutside)
	}, [confirm])
	return (
		<div ref={ref} className='inline-block'>
			<VoidButtonBgDarken className={className} onClick={() => {
				if (!confirm) {
					setConfirm(true)
				} else {
					onConfirm()
					setConfirm(false)
				}
			}}>
				{confirm ? `Confirm Reset` : children}
			</VoidButtonBgDarken>
		</div>
	)
}

export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	return <VoidInputBox2
		className='min-h-[81px] p-3 rounded-sm'
		initValue={voidSettingsState.globalSettings.aiInstructions}
		placeholder={`Do not change my indentation or delete my comments. When writing TS or JS, do not add ;'s. Write new code using Rust if possible. `}
		multiline
		onChangeText={(newText) => {
			voidSettingsService.setGlobalSetting('aiInstructions', newText)
		}}
	/>
}

const FastApplyMethodDropdown = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const options = useMemo(() => [true, false], [])

	const onChangeOption = useCallback((newVal: boolean) => {
		voidSettingsService.setGlobalSetting('enableFastApply', newVal)
	}, [voidSettingsService])

	return <VoidCustomDropdownBox
		className='text-xs text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-1 rounded p-0.5 px-1'
		options={options}
		selectedOption={voidSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Output Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>
}

const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	return <div
		className={`text-loophole-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
		onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		See onboarding screen?
	</div>
}

export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: 'xxs' | 'xs' | 'sm' | 'sm+' | 'md', desc: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		voidSettingsService.setGlobalSetting('autoApprove', {
			...voidSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [voidSettingsService, metricsService])

	return <>
		<VoidSwitch
			size={size}
			value={voidSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className='text-loophole-fg-3 text-xs'>{desc}</span>
	</>
}

export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const extensionTransferService = accessor.get('IExtensionTransferService')

	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: 'loading' | 'justfinished' }>({ type: 'done' })

	const onClick = async () => {
		if (transferState.type !== 'done') return
		setTransferState({ type: 'loading' })
		const errAcc = await extensionTransferService.transferExtensions(os, fromEditor)
		if (errAcc) {
			setTransferState({ type: 'done', error: errAcc })
		} else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }) }, 3000)
		}
	}

	return <>
		<VoidButtonBgDarken className={`max-w-48 p-4 ${className}`} disabled={transferState.type !== 'done'} onClick={onClick}>
			{transferState.type === 'done' ? `Transfer from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='text-nowrap flex flex-nowrap'>Transferring<IconLoading /></span>
					: transferState.type === 'justfinished' ? <AnimatedCheckmarkButton text='Settings Transferred' className='bg-none' />
						: null
			}
		</VoidButtonBgDarken>
		{transferState.type === 'done' && transferState.error ? <WarningBox text={transferState.error} /> : null}
	</>
}

// MCP Server component
const MCPServerComponent = ({ name, server }: { name: string, server: MCPServer }) => {
	const accessor = useAccessor()
	const mcpService = accessor.get('IMCPService')

	const voidSettings = useSettingsState()
	const isOn = voidSettings.mcpUserStateOfName[name]?.isOn

	const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_')

	return (
		<div className='border border-loophole-border-2 bg-loophole-bg-1 py-3 px-4 rounded-sm my-2'>
			<div className='flex items-center justify-between'>
				<div className='flex items-center gap-2'>
					<div className={`w-2 h-2 rounded-full
						${server.status === 'success' ? 'bg-green-500'
							: server.status === 'error' ? 'bg-red-500'
								: server.status === 'loading' ? 'bg-yellow-500'
									: server.status === 'offline' ? 'bg-loophole-fg-3'
										: ''}
					`}></div>
					<div className='text-sm font-medium text-loophole-fg-1'>{name}</div>
				</div>
				<VoidSwitch
					value={isOn ?? false}
					size='xs'
					disabled={server.status === 'error'}
					onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
				/>
			</div>

			{isOn && (
				<div className='mt-3'>
					<div className='flex flex-wrap gap-2 max-h-32 overflow-y-auto'>
						{(server.tools ?? []).length > 0 ? (
							(server.tools ?? []).map((tool: { name: string; description?: string }) => (
								<span
									key={tool.name}
									className='px-2 py-0.5 bg-loophole-bg-2 text-loophole-fg-3 rounded-sm text-xs'
									data-tooltip-id='loophole-tooltip'
									data-tooltip-content={tool.description || ''}
									data-tooltip-class-name='loophole-max-w-[300px]'
								>
									{removeUniquePrefix(tool.name)}
								</span>
							))
						) : (
							<span className='text-xs text-loophole-fg-3'>No tools available</span>
						)}
					</div>
				</div>
			)}

			{isOn && server.command && (
				<div className='mt-3'>
					<div className='text-xs text-loophole-fg-3 mb-1'>Command:</div>
					<div className='px-2 py-1 bg-loophole-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-loophole-fg-2 rounded-sm'>
						{server.command}
					</div>
				</div>
			)}

			{server.error && (
				<div className='mt-3'>
					<WarningBox text={server.error} />
				</div>
			)}
		</div>
	)
}

const MCPServersList = () => {
	const mcpServiceState = useMCPServiceState()

	let content: React.ReactNode
	if (mcpServiceState.error) {
		content = <div className='text-loophole-fg-3 text-sm mt-2'>{mcpServiceState.error}</div>
	} else {
		const entries = Object.entries(mcpServiceState.mcpServerOfName)
		content = entries.length === 0
			? <div className='text-loophole-fg-3 text-sm mt-2'>No servers found</div>
			: entries.map(([name, server]) => <MCPServerComponent key={name} name={name} server={server} />)
	}

	return <div className='my-2'>{content}</div>
}

const GeneralTab = () => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')
	const storageService = accessor.get('IStorageService')
	const workspaceContextService = accessor.get('IWorkspaceContextService')
	const metricsService = accessor.get('IMetricsService')
	const isOptedOut = useIsOptedOut()

	const [s, ss] = useState(0)
	const workspaceName = workspaceContextService.getWorkspace().folders[0]?.name
	const [projectMemory, setProjectMemory] = useState(() => storageService.get(PROJECT_MEMORY_STORAGE_KEY, StorageScope.WORKSPACE) ?? '')
	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'loophole-chats.json'
		} else {
			dataStr = JSON.stringify(voidSettingsService.state, null, 2)
			downloadName = 'loophole-settings.json'
		}
		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}

	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files) return
		const file = files[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string)
				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				} else {
					voidSettingsService.dangerousSetState(json as any)
				}
				notificationService.info(`${t} imported successfully!`)
			} catch (err) {
				notificationService.notify({ message: `Failed to import ${t}`, source: err + '', severity: Severity.Error })
			}
		}
		reader.readAsText(file)
		e.target.value = ''
		ss(s => s + 1)
	}

	return <div className='flex flex-col gap-12'>
		<div>
			<ErrorBoundary>
				<h2 className='text-3xl mb-2'>One-Click Switch</h2>
				<h4 className='text-loophole-fg-3 mb-4'>Transfer your editor settings into Loophole.</h4>
				<div className='flex flex-col gap-2'>
					<OneClickSwitchButton className='w-48' fromEditor='VS Code' />
					<OneClickSwitchButton className='w-48' fromEditor='Cursor' />
					<OneClickSwitchButton className='w-48' fromEditor='Windsurf' />
				</div>
			</ErrorBoundary>
		</div>

		<div>
			<h2 className='text-3xl mb-2'>Import/Export</h2>
			<h4 className='text-loophole-fg-3 mb-4'>Transfer Loophole's settings and chats in and out of Loophole.</h4>
			<div className='flex flex-col gap-8'>
				<div className='flex flex-col gap-2 max-w-48 w-full'>
					<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
					<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputSettingsRef.current?.click() }}>Import Settings</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Settings')}>Export Settings</VoidButtonBgDarken>
					<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { voidSettingsService.resetState() }}>Reset Settings</ConfirmButton>
				</div>
				<div className='flex flex-col gap-2 max-w-48 w-full'>
					<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
					<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputChatsRef.current?.click() }}>Import Chats</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Chats')}>Export Chats</VoidButtonBgDarken>
					<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { chatThreadsService.resetState() }}>Reset Chats</ConfirmButton>
				</div>
			</div>
		</div>

		<div>
			<h2 className='text-3xl mb-2'>Built-in Settings</h2>
			<h4 className='text-loophole-fg-3 mb-4'>IDE settings, keyboard settings, and theme customization.</h4>
			<ErrorBoundary>
				<div className='flex flex-col gap-2 justify-center max-w-48 w-full'>
					<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>General Settings</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>Keyboard Settings</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>Theme Settings</VoidButtonBgDarken>
					<VoidButtonBgDarken className='px-4 py-1' onClick={() => { void nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>Open Logs</VoidButtonBgDarken>
				</div>
			</ErrorBoundary>
		</div>

		<div className='max-w-[600px]'>
			<h2 className='text-3xl mb-2'>Metrics</h2>
			<h4 className='text-loophole-fg-3 mb-4'>Very basic anonymous usage tracking helps us keep Loophole running smoothly. You may opt out below. Regardless of this setting, Loophole never sees your code, messages, or API keys.</h4>
			<div className='flex items-center gap-x-2 my-2'>
				<VoidSwitch
					size='xs'
					value={isOptedOut}
					onChange={(newVal) => { metricsService.setOptOut(newVal) }}
				/>
				<span className='text-loophole-fg-3 text-xs pointer-events-none'>Opt-out of basic usage metrics</span>
			</div>
		</div>

		<div className='max-w-[600px]'>
			<h2 className='text-3xl mb-2'>AI Instructions</h2>
			<h4 className='text-loophole-fg-3 mb-4'>
				<ChatMarkdownRender inPTag={true} string={`System instructions to include with all AI requests.
Alternatively, place a \`.loopholerules\` file in the root of your workspace.`} chatMessageLocation={undefined} />
			</h4>
			<ErrorBoundary>
				<AIInstructionsBox />
			</ErrorBoundary>
			<div className='my-4'>
				<div className='flex items-center gap-x-2'>
					<VoidSwitch
						size='xs'
						value={!!settingsState.globalSettings.disableSystemMessage}
						onChange={(newValue) => { voidSettingsService.setGlobalSetting('disableSystemMessage', newValue) }}
					/>
					<span className='text-loophole-fg-3 text-xs pointer-events-none'>Disable system message</span>
				</div>
				<div className='text-loophole-fg-3 text-xs mt-1'>When disabled, Loophole will not include anything in the system message except for content you specified above.</div>
			</div>
		</div>

		<div>
			<h2 className='text-3xl mb-2'>Tools</h2>
			<h4 className='text-loophole-fg-3 mb-4'>Tools are functions that models can call. Some tools require approval.</h4>
			<ErrorBoundary>
				{[...toolApprovalTypes].map((approvalType) => <div key={approvalType} className='flex items-center gap-x-2 my-2'>
					<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
				</div>)}
				<div className='flex items-center gap-x-2 my-2'>
					<VoidSwitch size='xs' value={settingsState.globalSettings.includeToolLintErrors} onChange={(newVal) => voidSettingsService.setGlobalSetting('includeToolLintErrors', newVal)} />
					<span className='text-loophole-fg-3 text-xs pointer-events-none'>Fix lint errors</span>
				</div>
				<div className='flex items-center gap-x-2 my-2'>
					<VoidSwitch size='xs' value={settingsState.globalSettings.autoAcceptLLMChanges} onChange={(newVal) => voidSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)} />
					<span className='text-loophole-fg-3 text-xs pointer-events-none'>Auto-accept model changes</span>
				</div>
			</ErrorBoundary>
		</div>

		<div>
			<h2 className='text-3xl mb-2'>Editor</h2>
			<h4 className='text-loophole-fg-3 mb-4'>Settings that control Loophole suggestions in the code editor.</h4>
			<div className='flex items-center gap-x-2 my-2'>
				<VoidSwitch size='xs' value={settingsState.globalSettings.showInlineSuggestions} onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)} />
				<span className='text-loophole-fg-3 text-xs pointer-events-none'>Show suggestions on select</span>
			</div>
			<div className='flex items-center gap-x-2 my-2'>
				<FastApplyMethodDropdown />
			</div>
		</div>

		<div className='max-w-[600px]'>
			<h2 className='text-3xl mb-2'>Project Memory</h2>
			<h4 className='text-loophole-fg-3 mb-4'>Durable notes the agent has saved across sessions, stored locally on this machine.</h4>
			<div className='text-loophole-fg-3 text-xs mb-4'>
				{`Showing memory for the currently open project only: ${workspaceName ? `"${workspaceName}"` : 'this workspace'}.`}
			</div>
			<ErrorBoundary>
				<VoidInputBox2
					key={`project-memory-${s}`}
					className='min-h-[81px] p-3 rounded-sm'
					initValue={projectMemory}
					placeholder='No project memory stored yet.'
					multiline
					onChangeText={(newText) => {
						setProjectMemory(newText)
						storageService.store(PROJECT_MEMORY_STORAGE_KEY, newText, StorageScope.WORKSPACE, StorageTarget.MACHINE)
					}}
				/>
			</ErrorBoundary>
			<div className='mt-2'>
				<ConfirmButton className='px-4 py-1' onConfirm={() => {
					storageService.remove(PROJECT_MEMORY_STORAGE_KEY, StorageScope.WORKSPACE)
					setProjectMemory('')
					ss(s => s + 1)
				}}>Delete Project Memory</ConfirmButton>
			</div>
		</div>
	</div>
}

const MCPTab = () => {
	const accessor = useAccessor()
	const mcpService = accessor.get('IMCPService')
	return <>
		<h2 className='text-3xl mb-2'>MCP</h2>
		<h4 className='text-loophole-fg-3 mb-4'>
			<ChatMarkdownRender inPTag={true} string={`Use Model Context Protocol to provide Agent mode with more tools.`} chatMessageLocation={undefined} />
		</h4>
		<div className='my-2'>
			<VoidButtonBgDarken className='px-4 py-1 w-full max-w-48' onClick={async () => { await mcpService.revealMCPConfigFile() }}>Add MCP Server</VoidButtonBgDarken>
		</div>
		<ErrorBoundary>
			<MCPServersList />
		</ErrorBoundary>
	</>
}

export const Settings = () => {
	const isDark = useIsDark()
	const [selectedSection, setSelectedSection] = useState<Tab>('models')
	const shouldShowTab = (tab: Tab) => selectedSection === 'all' || selectedSection === tab

	useEffect(() => {
		window.scrollTo({ top: 0, behavior: 'smooth' })
	}, [selectedSection])

	return (
		<div className={`@@loophole-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', overflow: 'auto' }}>
			<div className='flex flex-col md:flex-row w-full gap-6 max-w-[900px] mx-auto mb-32' style={{ minHeight: '80vh' }}>
				{/* ──────────────  SIDEBAR  ────────────── */}
				<aside className='md:w-1/4 w-full p-6 shrink-0'>
					<div className='flex flex-col gap-1 mt-12'>
						{navItems.map(({ tab, label }) => (
							<button
								key={tab}
								onClick={() => setSelectedSection(tab)}
								className={`
									py-2 px-3 rounded-sm text-left text-sm border
									${selectedSection === tab
										? 'bg-loophole-bg-3 text-loophole-fg-1 border-loophole-border-1'
										: 'bg-transparent text-loophole-fg-2 border-transparent hover:bg-loophole-bg-2'}
								`}
							>
								{label}
							</button>
						))}
					</div>
				</aside>

				{/* ───────────── MAIN PANE ───────────── */}
				<main className='flex-1 p-6 select-none'>
					<div className='max-w-3xl'>
						<h1 className='text-2xl w-full'>{`Loophole's Settings`}</h1>
						<div className='w-full h-[1px] my-2' />
						<ErrorBoundary>
							<RedoOnboardingButton />
						</ErrorBoundary>
						<div className='w-full h-[1px] my-4' />

						<div className='flex flex-col gap-12'>
							<div className={shouldShowTab('models') ? '' : 'hidden'}>
								<ErrorBoundary><CliModelsTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('providers') ? '' : 'hidden'}>
								<ErrorBoundary><CliProvidersTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('autocomplete') ? '' : 'hidden'}>
								<ErrorBoundary><CliAutocompleteTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('context') ? '' : 'hidden'}>
								<ErrorBoundary><CliContextTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('commitMessage') ? '' : 'hidden'}>
								<ErrorBoundary><CliCommitMessageTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('notifications') ? '' : 'hidden'}>
								<ErrorBoundary><CliNotificationsTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('status') ? '' : 'hidden'}>
								<ErrorBoundary><CliStatusTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('general') ? '' : 'hidden'}>
								<ErrorBoundary><GeneralTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('mcp') ? '' : 'hidden'}>
								<ErrorBoundary><MCPTab /></ErrorBoundary>
							</div>

							<div className={shouldShowTab('about') ? '' : 'hidden'}>
								<ErrorBoundary><CliAboutTab /></ErrorBoundary>
							</div>
						</div>
					</div>
				</main>
			</div>
		</div>
	)
}
