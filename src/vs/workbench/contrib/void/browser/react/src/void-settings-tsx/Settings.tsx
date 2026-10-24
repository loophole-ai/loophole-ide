/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidStatefulModelInfo, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, nonlocalProviderNames, localProviderNames, ollamaProviderNames, mlxProviderNames, appleProviderNames, otherLocalProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, hasDownloadButtonsOnModelsProviderNames, subTextMdOfProviderName } from '../../../../common/voidSettingsTypes.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidButtonBgDarken, VoidCustomDropdownBox, VoidInputBox2, VoidSimpleInputBox, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useIsOptedOut, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, Asterisk, Plus } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { ModelDropdown } from './ModelDropdown.js'
import { LocalVoiceModelSettings } from '../local-voice/LocalVoiceModelSettings.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import Severity from '../../../../../../../base/common/severity.js'
import { TransferEditorType, TransferFilesInfo } from '../../../extensionTransferTypes.js';
import { MCPServer } from '../../../../common/mcpServiceTypes.js';
import { EngineProvidersSection } from './EngineProviders.js'
import { useMCPServiceState } from '../util/services.js';
import { OPT_OUT_KEY, PROJECT_MEMORY_STORAGE_KEY } from '../../../../common/storageKeys.js';
import { StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';

type Tab =
	| 'models'
	| 'engineProviders'
	| 'voice'
	| 'ollama'
	| 'mlx'
	| 'apple'
	| 'localOther'
	| 'providers'
	| 'featureOptions'
	| 'autocomplete'
	| 'display'
	| 'notifications'
	| 'context'
	| 'checkpoints'
	| 'agentBehavior'
	| 'autoApprove'
	| 'mcp'
	| 'general'
	| 'language'
	| 'experimental'
	| 'about'
	| 'all';

const SettingsSection = ({ title, description, children }: { title: string, description?: string, children: React.ReactNode }) => (
	<div className='mb-8'>
		<div className='mb-4'>
			<h2 className='text-[15px] font-semibold text-[var(--vscode-foreground)] mb-1'>{title}</h2>
			{description && <p className='text-[13px] text-[var(--vscode-descriptionForeground)] leading-relaxed'>{description}</p>}
		</div>
		<div className='flex flex-col gap-3'>
			{children}
		</div>
	</div>
);

const SettingsCard = ({ children }: { children: React.ReactNode }) => (
	<div className='bg-[var(--vscode-sideBar-background)] border border-[var(--vscode-panel-border)] rounded-lg overflow-hidden'>
		{children}
	</div>
);

const SettingsRow = ({ title, description, children }: { title: string, description?: string, children: React.ReactNode }) => (
	<div className='flex items-start justify-between gap-4 px-4 py-3 border-b border-[var(--vscode-panel-border)] last:border-b-0'>
		<div className='flex-1 min-w-0'>
			<div className='text-[13px] text-[var(--vscode-foreground)] font-medium mb-0.5'>{title}</div>
			{description && <div className='text-[12px] text-[var(--vscode-descriptionForeground)] leading-relaxed'>{description}</div>}
		</div>
		<div className='flex-shrink-0 flex items-center'>
			{children}
		</div>
	</div>
);

const ButtonLeftTextRightOption = ({ text, leftButton }: { text: string, leftButton?: React.ReactNode }) => {
	return <div className='flex items-center gap-2 text-[12px] text-[var(--vscode-descriptionForeground)]'>
		{leftButton ? leftButton : null}
		<span>{text}</span>
	</div>
}

// models
const RefreshModelButton = ({ providerName }: { providerName: RefreshableProviderName }) => {
	const refreshModelState = useRefreshModelState()
	const accessor = useAccessor()
	const refreshModelService = accessor.get('IRefreshModelService')
	const metricsService = accessor.get('IMetricsService')
	const [justFinished, setJustFinished] = useState<null | 'finished' | 'error'>(null)

	useRefreshModelListener(
		useCallback((providerName2, refreshModelState) => {
			if (providerName2 !== providerName) return
			const { state } = refreshModelState[providerName]
			if (!(state === 'finished' || state === 'error')) return
			setJustFinished(state)
			const tid = setTimeout(() => { setJustFinished(null) }, 2000)
			return () => clearTimeout(tid)
		}, [providerName])
	)

	const { state } = refreshModelState[providerName]
	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <ButtonLeftTextRightOption
		leftButton={
			<button
				className='flex items-center p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors'
				disabled={state === 'refreshing' || justFinished !== null}
				onClick={() => {
					refreshModelService.startRefreshingModels(providerName, { enableProviderOnSuccess: false, doNotFire: false })
					metricsService.capture('Click', { providerName, action: 'Refresh Models' })
				}}
			>
				{justFinished === 'finished' ? <Check className='stroke-[var(--vscode-testing-iconPassed)] size-3' />
					: justFinished === 'error' ? <X className='stroke-[var(--vscode-errorForeground)] size-3' />
						: state === 'refreshing' ? <Loader2 className='size-3 animate-spin text-[var(--vscode-descriptionForeground)]' />
							: <RefreshCw className='size-3 text-[var(--vscode-descriptionForeground)]' />}
			</button>
		}
		text={justFinished === 'finished' ? `${providerTitle} models up to date`
			: justFinished === 'error' ? `${providerTitle} not found`
				: `Refresh ${providerTitle} models`}
	/>
}

const RefreshableModels = ({ providerNamesFilter }: { providerNamesFilter?: readonly ProviderName[] }) => {
	const settingsState = useSettingsState()
	const names = providerNamesFilter ?? refreshableProviderNames

	const buttons = names.map(providerName => {
		if (!settingsState.settingsOfProvider[providerName]._didFillInProviderSettings) return null
		return <RefreshModelButton key={providerName} providerName={providerName} />
	})

	return <div className='flex flex-col gap-2'>{buttons}</div>
}

export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40);

	useEffect(() => {
		const startTime = performance.now();
		const duration = 500;

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const newOffset = 40 - (progress * 40);
			setDashOffset(newOffset);
			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		const animationId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationId);
	}, []);

	return <div
		className={`flex items-center gap-1.5 w-fit ${className ? className : `px-2 py-1 text-[12px] text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] rounded`}`}
	>
		<svg className="size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5 13l4 4L19 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					strokeDasharray: 40,
					strokeDashoffset: dashOffset
				}}
			/>
		</svg>
		{text}
	</div>
}

const AddButton = ({ disabled, text = 'Add', ...props }: { disabled?: boolean, text?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return <button
		disabled={disabled}
		className={`px-3 py-1 text-[12px] rounded transition-colors ${!disabled ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]' : 'opacity-50 cursor-not-allowed bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)]'}`}
		{...props}
	>{text}</button>
}

const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!confirm) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [confirm]);
	return (
		<div ref={ref} className={`inline-block`}>
			<button
				className={className || 'px-3 py-1 text-[12px] rounded bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] transition-colors'}
				onClick={(e) => {
					e.stopPropagation();
					if (!confirm) {
						setConfirm(true);
					} else {
						onConfirm();
						setConfirm(false);
					}
				}}
			>
				{confirm ? 'Confirm' : children}
			</button>
		</div>
	);
};

export const ModelDump = ({ filteredProviders }: { filteredProviders?: ProviderName[] }) => {
	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	const [isAddModelOpen, setIsAddModelOpen] = useState(false);
	const [showCheckmark, setShowCheckmark] = useState(false);
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName | null>(null);
	const [modelName, setModelName] = useState<string>('');
	const [errorString, setErrorString] = useState('');
	const [searchQuery, setSearchQuery] = useState('');

	const modelDump: (VoidStatefulModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []
	const providersToShow = filteredProviders || providerNames;

	for (let providerName of providersToShow) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: !!providerSettings._didFillInProviderSettings })))
	}

	modelDump.sort((a, b) => {
		return Number(b.providerEnabled) - Number(a.providerEnabled)
	})

	const modelDumpFiltered = (() => {
		const query = searchQuery.trim().toLowerCase()
		if (!query) return modelDump
		return modelDump.filter((m) => {
			const providerTitle = displayInfoOfProviderName(m.providerName).title.toLowerCase()
			return m.modelName.toLowerCase().includes(query)
				|| m.providerName.toLowerCase().includes(query)
				|| providerTitle.includes(query)
		})
	})()

	const handleAddModel = () => {
		if (!userChosenProviderName) {
			setErrorString('Please select a provider.');
			return;
		}
		if (!modelName) {
			setErrorString('Please enter a model name.');
			return;
		}

		if (settingsState.settingsOfProvider[userChosenProviderName].models.find(m => m.modelName === modelName)) {
			setErrorString('This model already exists.');
			return;
		}

		settingsStateService.addModel(userChosenProviderName, modelName);
		setShowCheckmark(true);
		setTimeout(() => {
			setShowCheckmark(false);
			setIsAddModelOpen(false);
			setUserChosenProviderName(null);
			setModelName('');
		}, 1500);
		setErrorString('');
	};

	return <div>
		<div className='mb-3'>
			<VoidSimpleInputBox
				value={searchQuery}
				compact={true}
				onChangeValue={setSearchQuery}
				placeholder='Search models...'
			/>
		</div>
		<SettingsCard>
			{modelDumpFiltered.map((m, i) => {
				const { isHidden, type, modelName, providerName, providerEnabled } = m
				const isNewProviderName = (i > 0 ? modelDumpFiltered[i - 1] : undefined)?.providerName !== providerName
				const providerTitle = displayInfoOfProviderName(providerName).title
				const disabled = !providerEnabled
				const value = disabled ? false : !isHidden

				const tooltipName = (
					disabled ? `Add ${providerTitle} to enable`
						: value === true ? 'Show in dropdown'
							: 'Hide from dropdown'
				)

				const detailAboutModel = type === 'autodetected' ?
					<Asterisk size={12} className="text-[var(--vscode-charts-blue)]" data-tooltip-id='loophole-tooltip' data-tooltip-place='right' data-tooltip-content='Detected locally' />
					: type === 'custom' ?
						<Asterisk size={12} className="text-[var(--vscode-charts-blue)]" data-tooltip-id='loophole-tooltip' data-tooltip-place='right' data-tooltip-content='Custom model' />
						: undefined

				return <div key={`${modelName}${providerName}`}
					className='flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--vscode-panel-border)] last:border-b-0 hover:bg-[var(--vscode-list-hoverBackground)] transition-colors'
				>
					<div className='flex items-center gap-3 flex-1 min-w-0'>
						<span className='text-[12px] text-[var(--vscode-descriptionForeground)] w-24 truncate'>{isNewProviderName ? providerTitle : ''}</span>
						<span className='text-[13px] text-[var(--vscode-foreground)] truncate flex-1'>{modelName}</span>
					</div>
					<div className='flex items-center gap-2'>
						{detailAboutModel}
						<VoidSwitch
							value={value}
							onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName); }}
							disabled={disabled}
							size='sm'
							data-tooltip-id='loophole-tooltip'
							data-tooltip-place='right'
							data-tooltip-content={tooltipName}
						/>
						{type === 'default' || type === 'autodetected' ? <div className='w-4' /> : 
							<button
								onClick={() => { settingsStateService.deleteModel(providerName, modelName); }}
								data-tooltip-id='loophole-tooltip'
								data-tooltip-place='right'
								data-tooltip-content='Delete'
								className='p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded opacity-0 group-hover:opacity-100 transition-opacity'
							>
								<X size={12} className="text-[var(--vscode-descriptionForeground)]" />
							</button>
						}
					</div>
				</div>
			})}
		</SettingsCard>

		<div className='mt-3'>
			{showCheckmark ? (
				<AnimatedCheckmarkButton text='Added' />
			) : isAddModelOpen ? (
				<div className='flex items-center gap-2 flex-wrap'>
					<ErrorBoundary>
						<VoidCustomDropdownBox
							options={providersToShow}
							selectedOption={userChosenProviderName}
							onChangeOption={(pn) => setUserChosenProviderName(pn)}
							getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider'}
							getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider'}
							getOptionsEqual={(a, b) => a === b}
							className='w-32 text-[12px]'
							arrowTouchesText={false}
						/>
					</ErrorBoundary>
					<ErrorBoundary>
						<VoidSimpleInputBox
							value={modelName}
							compact={true}
							onChangeValue={setModelName}
							placeholder='Model name'
							className='w-40'
						/>
					</ErrorBoundary>
					<ErrorBoundary>
						<AddButton
							type='button'
							disabled={!modelName || !userChosenProviderName}
							onClick={handleAddModel}
						/>
					</ErrorBoundary>
					<button
						type="button"
						onClick={() => {
							setIsAddModelOpen(false);
							setErrorString('');
							setUserChosenProviderName(null);
							setModelName('');
						}}
						className='px-2 py-1 text-[12px] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'
					>
						Cancel
					</button>
					{errorString && <span className='text-[11px] text-[var(--vscode-errorForeground)]'>{errorString}</span>}
				</div>
			) : (
				<button
					onClick={() => setIsAddModelOpen(true)}
					className='flex items-center gap-1.5 px-2 py-1 text-[12px] text-[var(--vscode-textLink-foreground)] hover:underline'
				>
					<Plus size={12} /> Add custom model
				</button>
			)}
		</div>
	</div>
};

const LocalProviderSection = ({ title, description, instructions, providerNames, refreshable, autoSetup, modelFilter }: {
	title: string
	description?: string
	instructions?: React.ReactNode
	providerNames: readonly ProviderName[]
	refreshable?: boolean
	autoSetup?: React.ReactNode
	modelFilter?: readonly ProviderName[]
}) => (
	<SettingsSection title={title} description={description}>
		{instructions && <div className='text-[12px] text-[var(--vscode-descriptionForeground)] leading-relaxed'>{instructions}</div>}
		{autoSetup}
		{refreshable && <RefreshableModels providerNamesFilter={providerNames} />}
		<VoidProviderSettings providerNames={providerNames} />
		{modelFilter && (
			<>
				<div className='mt-4 mb-2'>
					<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-1'>Models</div>
					<div className='text-[12px] text-[var(--vscode-descriptionForeground)]'>Manage models for {title}</div>
				</div>
				<ModelDump filteredProviders={[...modelFilter]} />
			</>
		)}
	</SettingsSection>
)

export const AutoDetectLocalModelsToggle = () => {
	const settingName: GlobalSettingName = 'autoRefreshModels'
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const metricsService = accessor.get('IMetricsService')
	const voidSettingsState = useSettingsState()
	const enabled = voidSettingsState.globalSettings[settingName]

	return <SettingsRow 
		title="Auto-detect local models" 
		description={`Automatically detect local providers and models (${refreshableProviderNames.map(providerName => displayInfoOfProviderName(providerName).title).join(', ')}).`}
	>
		<VoidSwitch
			size='xs'
			value={enabled}
			onChange={(newVal) => {
				voidSettingsService.setGlobalSetting(settingName, newVal)
				metricsService.capture('Click', { action: 'Autorefresh Toggle', settingName, enabled: newVal })
			}}
		/>
	</SettingsRow>
}

export const AutoSetupMlxToggle = () => {
	if (os !== 'mac') {
		return null
	}

	const settingName: GlobalSettingName = 'autoSetupMlx'
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const metricsService = accessor.get('IMetricsService')
	const voidSettingsState = useSettingsState()
	const enabled = voidSettingsState.globalSettings[settingName]

	return <SettingsRow 
		title="Auto-setup MLX" 
		description="Install mlx-lm if needed, start mlx_lm.server, and autodetect models."
	>
		<VoidSwitch
			size='xs'
			value={enabled}
			onChange={(newVal) => {
				voidSettingsService.setGlobalSetting(settingName, newVal)
				metricsService.capture('Click', { action: 'MLX Auto-Setup Toggle', settingName, enabled: newVal })
			}}
		/>
	</SettingsRow>
}

export const AutoSetupAppleFoundationModelsToggle = () => {
	if (os !== 'mac') {
		return null
	}

	const settingName: GlobalSettingName = 'autoSetupAppleFoundationModels'
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const metricsService = accessor.get('IMetricsService')
	const voidSettingsState = useSettingsState()
	const enabled = voidSettingsState.globalSettings[settingName]

	return <SettingsRow 
		title="Auto-setup Apple Foundation Models" 
		description="Install and start maclocal-api (afm) server on port 9999."
	>
		<VoidSwitch
			size='xs'
			value={enabled}
			onChange={(newVal) => {
				voidSettingsService.setGlobalSetting(settingName, newVal)
				metricsService.capture('Click', { action: 'Apple FM Auto-Setup Toggle', settingName, enabled: newVal })
			}}
		/>
	</SettingsRow>
}

export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	return <VoidInputBox2
		className='min-h-[100px] p-3 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]'
		initValue={voidSettingsState.globalSettings.aiInstructions}
		placeholder={`System instructions to include with all AI requests...`}
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
		className='text-[12px]'
		options={options}
		selectedOption={voidSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>
}

export const OllamaSetupInstructions = ({ sayWeAutoDetect }: { sayWeAutoDetect?: boolean }) => {
	return <div className='text-[12px] text-[var(--vscode-descriptionForeground)] space-y-1'>
		<div className='font-medium text-[var(--vscode-foreground)]'>Ollama Setup</div>
		<ol className='list-decimal list-inside space-y-1 ml-1'>
			<li>Download <a href='https://ollama.com/download' className='text-[var(--vscode-textLink-foreground)] hover:underline'>Ollama</a></li>
			<li>Open your terminal</li>
			<li>Run <code className='px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded'>ollama pull &lt;model&gt;</code> to install a model</li>
		</ol>
		{sayWeAutoDetect && <div>Loophole automatically detects locally running models.</div>}
	</div>
}

export const MlxSetupInstructions = () => {
	return <div className='text-[12px] text-[var(--vscode-descriptionForeground)] space-y-1'>
		<div className='font-medium text-[var(--vscode-foreground)]'>MLX (one model at a time)</div>
		<ol className='list-decimal list-inside space-y-1 ml-1'>
			<li>Enable auto-setup or manually install <code className='px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded'>mlx-lm</code> and start <code className='px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded'>mlx_lm.server</code></li>
			<li>Only the currently loaded model is autodetected</li>
			<li>To switch models, restart the server with a different model</li>
		</ol>
	</div>
}

export const AppleFoundationModelsSetupInstructions = () => {
	if (os !== 'mac') return null
	return <div className='text-[12px] text-[var(--vscode-descriptionForeground)] space-y-1'>
		<div className='font-medium text-[var(--vscode-foreground)]'>Apple Foundation Models</div>
		<ol className='list-decimal list-inside space-y-1 ml-1'>
			<li>Requires macOS 26+, Apple Silicon, and Apple Intelligence</li>
			<li>Use <a href='https://github.com/scouzi1966/maclocal-api' className='text-[var(--vscode-textLink-foreground)] hover:underline'>maclocal-api</a> (<code className='px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded'>afm</code>)</li>
			<li>Default: <code className='px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded'>afm -p 9999</code> at <code className='px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded'>http://127.0.0.1:9999/v1</code></li>
		</ol>
	</div>
}

const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	return <button
		className={`text-[12px] text-[var(--vscode-textLink-foreground)] hover:underline ${className || ''}`}
		onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		Redo onboarding
	</button>
}

export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string }) => {
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

	return <SettingsRow title={desc}>
		<VoidSwitch
			size={size}
			value={voidSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
	</SettingsRow>
}

export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const extensionTransferService = accessor.get('IExtensionTransferService')
	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: 'loading' | 'justfinished' }>({ type: 'done' })

	const onClick = async () => {
		if (transferState.type !== 'done') return
		setTransferState({ type: 'loading' })
		const errAcc = await extensionTransferService.transferExtensions(os, fromEditor)
		const hadError = !!errAcc
		if (hadError) {
			setTransferState({ type: 'done', error: errAcc })
		}
		else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }); }, 2000)
		}
	}

	return <>
		<button
			className={`px-4 py-2 text-[13px] rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
			disabled={transferState.type !== 'done'} 
			onClick={onClick}
		>
			{transferState.type === 'done' ? `Import from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='flex items-center gap-2'>Importing<IconLoading /></span>
					: transferState.type === 'justfinished' ? 'Done' : null
			}
		</button>
		{transferState.type === 'done' && transferState.error ? <div className='text-[11px] text-[var(--vscode-errorForeground)] mt-1'>{transferState.error}</div> : null}
	</>
}

const MCPServerComponent = ({ name, server }: { name: string, server: MCPServer }) => {
	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');
	const voidSettings = useSettingsState()
	const isOn = voidSettings.mcpUserStateOfName[name]?.isOn
	const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_')

	return (
		<div className="border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-4 py-3 rounded-lg mb-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className={`w-2 h-2 rounded-full ${
						server.status === 'success' ? 'bg-[var(--vscode-testing-iconPassed)]'
							: server.status === 'error' ? 'bg-[var(--vscode-errorForeground)]'
								: server.status === 'loading' ? 'bg-[var(--vscode-charts-yellow)]'
									: 'bg-[var(--vscode-descriptionForeground)]'}
					`}></div>
					<div className="text-[13px] font-medium text-[var(--vscode-foreground)]">{name}</div>
				</div>
				<VoidSwitch
					value={isOn ?? false}
					size='xs'
					disabled={server.status === 'error'}
					onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
				/>
			</div>
			{isOn && (server.tools ?? []).length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{(server.tools ?? []).map((tool: { name: string; description?: string }) => (
						<span
							key={tool.name}
							className="px-1.5 py-0.5 bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded text-[11px]"
							data-tooltip-id='loophole-tooltip'
							data-tooltip-content={tool.description || ''}
						>
							{removeUniquePrefix(tool.name)}
						</span>
					))}
				</div>
			)}
		</div>
	)
}

const MCPServersList = () => {
	const mcpServiceState = useMCPServiceState()
	let content: React.ReactNode
	if (mcpServiceState.error) {
		content = <div className="text-[12px] text-[var(--vscode-errorForeground)] mt-2">{mcpServiceState.error}</div>
	}
	else {
		const entries = Object.entries(mcpServiceState.mcpServerOfName)
		if (entries.length === 0) {
			content = <div className="text-[12px] text-[var(--vscode-descriptionForeground)] mt-2">No MCP servers configured</div>
		}
		else {
			content = entries.map(([name, server]) => (
				<MCPServerComponent key={name} name={name} server={server} />
			))
		}
	}
	return <div className="mt-3">{content}</div>
};

const ProviderSetting = ({ providerName, settingName, subTextMd }: { providerName: ProviderName, settingName: SettingName, subTextMd: React.ReactNode }) => {

	const { title: settingTitle, placeholder, isPasswordField } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	const settingValue = settingsState.settingsOfProvider[providerName][settingName] as string // this should always be a string in this component
	if (typeof settingValue !== 'string') {
		console.log('Error: Provider setting had a non-string value.')
		return
	}

	// Create a stable callback reference using useCallback with proper dependencies
	const handleChangeValue = useCallback((newVal: string) => {
		voidSettingsService.setSettingOfProvider(providerName, settingName, newVal)
	}, [voidSettingsService, providerName, settingName]);

	return <ErrorBoundary>
		<div className='my-1'>
			<VoidSimpleInputBox
				value={settingValue}
				onChangeValue={handleChangeValue}
				placeholder={`${settingTitle} (${placeholder})`}
				passwordBlur={isPasswordField}
				compact={true}
			/>
			{!subTextMd ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				{subTextMd}
			</div>}
		</div>
	</ErrorBoundary>
}

// const OldSettingsForProvider = ({ providerName, showProviderTitle }: { providerName: ProviderName, showProviderTitle: boolean }) => {
// 	const voidSettingsState = useSettingsState()

// 	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

// 	// const accessor = useAccessor()
// 	// const voidSettingsService = accessor.get('IVoidSettingsService')

// 	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
// 	const settingNames = customSettingNamesOfProvider(providerName)

// 	const { title: providerTitle } = displayInfoOfProviderName(providerName)

// 	return <div className='my-4'>

// 		<div className='flex items-center w-full gap-4'>
// 			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

// 			{/* enable provider switch */}
// 			{/* <VoidSwitch
// 				value={!!enabled}
// 				onChange={
// 					useCallback(() => {
// 						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
// 						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
// 					}, [voidSettingsService, providerName])}
// 				size='sm+'
// 			/> */}
// 		</div>

// 		<div className='px-0'>
// 			{/* settings besides models (e.g. api key) */}
// 			{settingNames.map((settingName, i) => {
// 				return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
// 			})}

// 			{needsModel ?
// 				providerName === 'ollama' ?
// 					<WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} />
// 					: <WarningBox text={`Please add a model for ${providerTitle} (Models section).`} />
// 				: null}
// 		</div>
// 	</div >
// }


export const SettingsForProvider = ({ providerName, showProviderTitle, showProviderSuggestions }: { providerName: ProviderName, showProviderTitle: boolean, showProviderSuggestions: boolean }) => {
	const voidSettingsState = useSettingsState()

	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

	// const accessor = useAccessor()
	// const voidSettingsService = accessor.get('IVoidSettingsService')

	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
	const settingNames = customSettingNamesOfProvider(providerName)

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <div>

		<div className='flex items-center w-full gap-4'>
			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

			{/* enable provider switch */}
			{/* <VoidSwitch
				value={!!enabled}
				onChange={
					useCallback(() => {
						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
					}, [voidSettingsService, providerName])}
				size='sm+'
			/> */}
		</div>

		<div className='px-0'>
			{/* settings besides models (e.g. api key) */}
			{settingNames.map((settingName, i) => {

				return <ProviderSetting
					key={settingName}
					providerName={providerName}
					settingName={settingName}
					subTextMd={i !== settingNames.length - 1 ? null
						: <ChatMarkdownRender string={subTextMdOfProviderName(providerName)} chatMessageLocation={undefined} />}
				/>
			})}

			{showProviderSuggestions && needsModel ?
				providerName === 'ollama' ?
					<WarningBox className="pl-2 mb-4" text={`Please install an Ollama model. We'll auto-detect it.`} />
					: (providerName === 'mlx' || providerName === 'appleFoundationModels' || providerName === 'lmStudio' || providerName === 'vLLM') ?
						<WarningBox className="pl-2 mb-4" text={`Start your local server — Loophole will auto-detect models at the endpoint.`} />
						: <WarningBox className="pl-2 mb-4" text={`Please add a model for ${providerTitle} (Models section).`} />
				: null}
		</div>
	</div >
}

export const VoidProviderSettings = ({ providerNames }: { providerNames: readonly ProviderName[] }) => {
	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} showProviderTitle={true} showProviderSuggestions={true} />
		)}
	</>
}

export const Settings = () => {
	const isDark = useIsDark()
	const [selectedSection, setSelectedSection] = useState<Tab>('models');

	const navItems: { tab: Tab; label: string; icon: React.ReactNode }[] = [
		{ tab: 'models', label: 'Models', icon: <Bot size={14} /> },
		{ tab: 'agentBehavior', label: 'Agent Behavior', icon: <Sparkles size={14} /> },
		{ tab: 'autoApprove', label: 'Auto Approve', icon: <Shield size={14} /> },
		{ tab: 'mcp', label: 'MCP Servers', icon: <Layers size={14} /> },
		{ tab: 'ollama', label: 'Ollama', icon: <Cpu size={14} /> },
		...(os === 'mac' ? ([
			{ tab: 'mlx' as const, label: 'MLX', icon: <Cpu size={14} /> },
			{ tab: 'apple' as const, label: 'Apple Intelligence', icon: <Cpu size={14} /> },
		]) : []),
		{ tab: 'localOther', label: 'Other Local', icon: <Cpu size={14} /> },
		{ tab: 'autocomplete', label: 'Autocomplete', icon: <Zap size={14} /> },
		{ tab: 'display', label: 'Display', icon: <Settings2 size={14} /> },
		{ tab: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
		{ tab: 'context', label: 'Context', icon: <Layers size={14} /> },
		{ tab: 'checkpoints', label: 'Checkpoints', icon: <GitBranch size={14} /> },
		{ tab: 'voice', label: 'Voice', icon: <MessageSquare size={14} /> },
		{ tab: 'featureOptions', label: 'Tools & Features', icon: <Wrench size={14} /> },
		{ tab: 'general', label: 'General', icon: <Settings2 size={14} /> },
		{ tab: 'language', label: 'Language', icon: <Globe size={14} /> },
		{ tab: 'experimental', label: 'Experimental', icon: <Sparkles size={14} /> },
		{ tab: 'about', label: 'About', icon: <Info size={14} /> },
		{ tab: 'all', label: 'All Settings', icon: <Settings2 size={14} /> },
	];
	
	const groups: string[] = [];
	const shouldShowTab = (tab: Tab) => selectedSection === 'all' || selectedSection === tab;
	
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')
	const mcpService = accessor.get('IMCPService')
	const storageService = accessor.get('IStorageService')
	const workspaceContextService = accessor.get('IWorkspaceContextService')
	const metricsService = accessor.get('IMetricsService')
	const isOptedOut = useIsOptedOut()

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'loophole-chats.json'
		}
		else if (t === 'Settings') {
			dataStr = JSON.stringify(voidSettingsService.state, null, 2)
			downloadName = 'loophole-settings.json'
		}
		else {
			dataStr = ''
			downloadName = ''
		}

		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}

	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)
	const [s, ss] = useState(0)
	const workspaceName = workspaceContextService.getWorkspace().folders[0]?.name
	const [projectMemory, setProjectMemory] = useState(() => storageService.get(PROJECT_MEMORY_STORAGE_KEY, StorageScope.WORKSPACE) ?? '')

	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>,) => {
		const files = e.target.files
		if (!files) return;
		const file = files[0]
		if (!file) return

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string);
				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				}
				else if (t === 'Settings') {
					voidSettingsService.dangerousSetState(json as any)
				}
				notificationService.info(`${t} imported successfully`)
			} catch (err) {
				notificationService.notify({ message: `Failed to import ${t}`, source: err + '', severity: Severity.Error, })
			}
		};
		reader.readAsText(file);
		e.target.value = '';
		ss(s => s + 1)
	}

	return (
		<div className={`@@loophole-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', overflow: 'auto', backgroundColor: 'var(--vscode-editor-background)' }}>
			<div className="flex w-full h-full">
				<aside className="w-56 flex-shrink-0 border-r border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] overflow-y-auto">
					<div className="p-4">
						<h1 className='text-[16px] font-semibold text-[var(--vscode-foreground)] mb-4'>Settings</h1>
						<nav className='flex flex-col gap-0.5'>
							{navItems.map(({ tab, label, icon }) => (
								<button
									key={tab}
									onClick={() => {
										setSelectedSection(tab);
										if (tab !== 'all') {
											const mainEl = document.querySelector('.settings-main-content');
											if (mainEl) mainEl.scrollTop = 0;
										}
									}}
									className={`flex items-center gap-2 px-2 py-1.5 text-left text-[13px] rounded transition-colors ${
										selectedSection === tab
											? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]'
											: 'text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]'
									}`}
								>
									{label}
								</button>
							))}
						</nav>
					</div>
				</aside>

				<main className="flex-1 overflow-y-auto settings-main-content">
					<div className='max-w-3xl mx-auto px-8 py-6'>
						<div className='mb-6'>
							<h1 className='text-[24px] font-semibold text-[var(--vscode-foreground)] mb-1'>Loophole Settings</h1>
							<p className='text-[13px] text-[var(--vscode-descriptionForeground)]'>Configure your AI coding assistant</p>
						</div>

						<ErrorBoundary>
							<div className='mb-6'>
								<RedoOnboardingButton />
							</div>
						</ErrorBoundary>

						<div className='flex flex-col'>
							<div className={shouldShowTab('models') ? `` : 'hidden'}>
								<ErrorBoundary>
									<SettingsSection title="Models" description="Manage models and their visibility across all providers">
										<ModelDump />
										<SettingsCard>
											<AutoDetectLocalModelsToggle />
										</SettingsCard>
										<p className='text-[11px] text-[var(--vscode-descriptionForeground)]'>Configure local providers like Ollama, MLX, and Apple in their respective sections.</p>
									</SettingsSection>
								</ErrorBoundary>
							</div>

							<div className={shouldShowTab('voice') ? `` : 'hidden'}>
								<ErrorBoundary>
									<SettingsSection title="Voice" description="Voice and speech settings">
										<LocalVoiceModelSettings />
									</SettingsSection>
								</ErrorBoundary>
							</div>

							<div className={shouldShowTab('ollama') ? `` : 'hidden'}>
								<ErrorBoundary>
									<LocalProviderSection
										title='Ollama'
										description='Local LLM inference with Ollama'
										instructions={<OllamaSetupInstructions sayWeAutoDetect={true} />}
										providerNames={ollamaProviderNames}
										refreshable
										modelFilter={ollamaProviderNames}
									/>
								</ErrorBoundary>
							</div>

							{os === 'mac' && (
								<div className={shouldShowTab('mlx') ? `` : 'hidden'}>
									<ErrorBoundary>
										<LocalProviderSection
											title='MLX'
											description='Apple Silicon optimized inference with MLX'
											instructions={<MlxSetupInstructions />}
											providerNames={mlxProviderNames}
											refreshable
											autoSetup={<SettingsCard><AutoSetupMlxToggle /></SettingsCard>}
											modelFilter={mlxProviderNames}
										/>
									</ErrorBoundary>
								</div>
							)}

							{os === 'mac' && (
								<div className={shouldShowTab('apple') ? `` : 'hidden'}>
									<ErrorBoundary>
										<LocalProviderSection
											title='Apple Intelligence'
											description='On-device Apple Foundation Models'
											instructions={<AppleFoundationModelsSetupInstructions />}
											providerNames={appleProviderNames}
											refreshable
											autoSetup={<SettingsCard><AutoSetupAppleFoundationModelsToggle /></SettingsCard>}
											modelFilter={appleProviderNames}
										/>
									</ErrorBoundary>
								</div>
							)}

							<div className={shouldShowTab('localOther') ? `` : 'hidden'}>
								<ErrorBoundary>
									<LocalProviderSection
										title='Other Local Providers'
										description='OpenAI-compatible local servers'
										providerNames={otherLocalProviderNames}
									/>
								</ErrorBoundary>
							</div>

							<div className={shouldShowTab('featureOptions') ? `` : 'hidden'}>
								<ErrorBoundary>
									<SettingsSection title="Features" description="Configure AI features and their behavior">
										<SettingsCard>
											<SettingsRow title="Autocomplete" description="Inline code completions">
												<div className='flex items-center gap-3'>
													<VoidSwitch
														size='xs'
														value={settingsState.globalSettings.enableAutocomplete}
														onChange={(newVal) => voidSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
													/>
													<div className={`${!settingsState.globalSettings.enableAutocomplete ? 'opacity-50 pointer-events-none' : ''}`}>
														<ModelDropdown featureName={'Autocomplete'} className='text-[12px]' />
													</div>
												</div>
											</SettingsRow>
											<SettingsRow title="Apply" description="Apply AI-generated code changes">
												<div className='flex items-center gap-3'>
													<span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>
														{settingsState.globalSettings.syncApplyToChat ? 'Same as Chat' : 'Custom'}
													</span>
													<VoidSwitch
														size='xs'
														value={settingsState.globalSettings.syncApplyToChat}
														onChange={(newVal) => voidSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
													/>
													<div className={`${settingsState.globalSettings.syncApplyToChat ? 'opacity-50 pointer-events-none' : ''}`}>
														<ModelDropdown featureName={'Apply'} className='text-[12px]' />
													</div>
													<FastApplyMethodDropdown />
												</div>
											</SettingsRow>
											<SettingsRow title="Commit Messages" description="AI-generated commit messages">
												<div className='flex items-center gap-3'>
													<span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>
														{settingsState.globalSettings.syncSCMToChat ? 'Same as Chat' : 'Custom'}
													</span>
													<VoidSwitch
														size='xs'
														value={settingsState.globalSettings.syncSCMToChat}
														onChange={(newVal) => voidSettingsService.setGlobalSetting('syncSCMToChat', newVal)}
													/>
													<div className={`${settingsState.globalSettings.syncSCMToChat ? 'opacity-50 pointer-events-none' : ''}`}>
														<ModelDropdown featureName={'SCM'} className='text-[12px]' />
													</div>
												</div>
											</SettingsRow>
											<SettingsRow title="Inline Suggestions" description="Show AI suggestions in the editor">
												<VoidSwitch
													size='xs'
													value={settingsState.globalSettings.showInlineSuggestions}
													onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
												/>
											</SettingsRow>
										</SettingsCard>

										<div className='mt-6'>
											<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>Tool Permissions</div>
											<div className='text-[12px] text-[var(--vscode-descriptionForeground)] mb-3'>Auto-approve tools without asking for confirmation</div>
											<SettingsCard>
												{[...toolApprovalTypes].map((approvalType) => (
													<ToolApprovalTypeSwitch key={approvalType} approvalType={approvalType} size='xs' desc={`Auto-approve ${approvalType}`} />
												))}
											</SettingsCard>
										</div>

										<div className='mt-6'>
											<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>Advanced</div>
											<SettingsCard>
												<SettingsRow title="Fix lint errors" description="Include lint errors in tool context">
													<VoidSwitch
														size='xs'
														value={settingsState.globalSettings.includeToolLintErrors}
														onChange={(newVal) => voidSettingsService.setGlobalSetting('includeToolLintErrors', newVal)}
													/>
												</SettingsRow>
												<SettingsRow title="Auto-accept LLM changes" description="Automatically accept file changes">
													<VoidSwitch
														size='xs'
														value={settingsState.globalSettings.autoAcceptLLMChanges}
														onChange={(newVal) => voidSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)}
													/>
												</SettingsRow>
											</SettingsCard>
										</div>
									</SettingsSection>
								</ErrorBoundary>
							</div>

							<div className={shouldShowTab('general') ? `` : 'hidden'}>
								<SettingsSection title="General" description="General preferences and data management">
									<div className='mb-6'>
										<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>Import Settings</div>
										<div className='text-[12px] text-[var(--vscode-descriptionForeground)] mb-3'>Transfer settings from other editors</div>
										<div className='flex gap-2 flex-wrap'>
											<OneClickSwitchButton fromEditor="VS Code" />
											<OneClickSwitchButton fromEditor="Cursor" />
											<OneClickSwitchButton fromEditor="Windsurf" />
										</div>
									</div>

									<div className='mb-6'>
										<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>Data Management</div>
										<div className='text-[12px] text-[var(--vscode-descriptionForeground)] mb-3'>Import, export, or reset your settings and chats</div>
										<SettingsCard>
											<SettingsRow title="Settings" description="Import or export Loophole settings">
												<div className='flex gap-2'>
													<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
													<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => { fileInputSettingsRef.current?.click() }}>Import</button>
													<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => onDownload('Settings')}>Export</button>
													<ConfirmButton onConfirm={() => { voidSettingsService.resetState(); }}>Reset</ConfirmButton>
												</div>
											</SettingsRow>
											<SettingsRow title="Chats" description="Import or export chat history">
												<div className='flex gap-2'>
													<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
													<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => { fileInputChatsRef.current?.click() }}>Import</button>
													<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => onDownload('Chats')}>Export</button>
													<ConfirmButton onConfirm={() => { chatThreadsService.resetState(); }}>Reset</ConfirmButton>
												</div>
											</SettingsRow>
										</SettingsCard>
									</div>

									<div className='mb-6'>
										<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>IDE</div>
										<SettingsCard>
											<SettingsRow title="General Settings" description="Open VS Code settings">
												<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>Open</button>
											</SettingsRow>
											<SettingsRow title="Keyboard Shortcuts" description="Configure keybindings">
												<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>Open</button>
											</SettingsRow>
											<SettingsRow title="Theme" description="Change color theme">
												<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>Open</button>
											</SettingsRow>
											<SettingsRow title="Logs" description="Open logs folder">
												<button className='px-2 py-1 text-[12px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded' onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>Open</button>
											</SettingsRow>
										</SettingsCard>
									</div>

									<div className='mb-6'>
										<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>Telemetry</div>
										<SettingsCard>
											<SettingsRow title="Usage Analytics" description="Help improve Loophole with anonymous usage data">
												<div className='flex items-center gap-2'>
													<span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>{isOptedOut ? 'Opted out' : 'Enabled'}</span>
													<VoidSwitch
														size='xs'
														value={!isOptedOut}
														onChange={(newVal) => { metricsService.setOptOut(!newVal) }}
													/>
												</div>
											</SettingsRow>
										</SettingsCard>
									</div>

									<div className='mb-6'>
										<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>AI Instructions</div>
										<div className='text-[12px] text-[var(--vscode-descriptionForeground)] mb-3'>System instructions for all AI requests. You can also use a <code className='px-1 py-0.5 bg-[var(--vscode-textCodeBlock-background)] rounded'>.loopholerules</code> file.</div>
										<AIInstructionsBox />
										<SettingsCard className='mt-3'>
											<SettingsRow title="Disable System Message" description="Only use custom instructions above">
												<VoidSwitch
													size='xs'
													value={!!settingsState.globalSettings.disableSystemMessage}
													onChange={(newValue) => { voidSettingsService.setGlobalSetting('disableSystemMessage', newValue); }}
												/>
											</SettingsRow>
										</SettingsCard>
									</div>

									<div className='mb-6'>
										<div className='text-[13px] font-medium text-[var(--vscode-foreground)] mb-2'>Project Memory</div>
										<div className='text-[12px] text-[var(--vscode-descriptionForeground)] mb-3'>
											Durable notes for {workspaceName ? `"${workspaceName}"` : ''} stored locally
										</div>
										<VoidInputBox2
											key={`project-memory-${s}`}
											className='min-h-[80px] p-3 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]'
											initValue={projectMemory}
											placeholder='No project memory stored yet.'
											multiline
											onChangeText={(newText) => {
												setProjectMemory(newText)
												storageService.store(PROJECT_MEMORY_STORAGE_KEY, newText, StorageScope.WORKSPACE, StorageTarget.MACHINE)
											}}
										/>
										<div className='mt-2'>
											<ConfirmButton onConfirm={() => {
												storageService.remove(PROJECT_MEMORY_STORAGE_KEY, StorageScope.WORKSPACE)
												setProjectMemory('')
												ss(s => s + 1)
											}}>Delete Project Memory</ConfirmButton>
										</div>
									</div>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('mcp') ? `` : 'hidden'}>
								<SettingsSection title="MCP Servers" description="Model Context Protocol servers for extended capabilities">
									<button 
										className='px-3 py-1.5 text-[12px] bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded w-fit'
										onClick={async () => { await mcpService.revealMCPConfigFile() }}
									>
										Configure MCP Servers
									</button>
									<MCPServersList />
								</SettingsSection>
							</div>

							<div className={shouldShowTab('agentBehavior') ? `` : 'hidden'}>
								<SettingsSection title="Agent Behavior" description="Configure how the AI agent behaves in your workspace">
									<SettingsCard>
										<SettingsRow title="Agent Mode" description="Default mode for agent interactions"><span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>Auto</span></SettingsRow>
										<SettingsRow title="Max Tool Calls" description="Maximum number of tool calls per request"><span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>Unlimited</span></SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('autoApprove') ? `` : 'hidden'}>
								<SettingsSection title="Auto Approve" description="Auto-approve tools without asking for confirmation">
									<SettingsCard>
										{[...toolApprovalTypes].map((approvalType) => (
											<ToolApprovalTypeSwitch key={approvalType} approvalType={approvalType} size='xs' desc={approvalType} />
										))}
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('autocomplete') ? `` : 'hidden'}>
								<SettingsSection title="Autocomplete" description="Inline code completions">
									<SettingsCard>
										<SettingsRow title="Enable Autocomplete" description="Show AI suggestions as you type">
											<VoidSwitch size='xs' value={settingsState.globalSettings.enableAutocomplete} onChange={(newVal) => voidSettingsService.setGlobalSetting('enableAutocomplete', newVal)} />
										</SettingsRow>
										<SettingsRow title="Model" description="Model used for autocomplete">
											<ModelDropdown featureName={'Autocomplete'} className='text-[12px]' />
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('display') ? `` : 'hidden'}>
								<SettingsSection title="Display" description="Visual preferences">
									<SettingsCard>
										<SettingsRow title="Show Inline Suggestions" description="Display AI suggestions inline in the editor">
											<VoidSwitch size='xs' value={settingsState.globalSettings.showInlineSuggestions} onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)} />
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('notifications') ? `` : 'hidden'}>
								<SettingsSection title="Notifications" description="Notification preferences">
									<SettingsCard>
										<SettingsRow title="Enable Notifications" description="Show notifications for AI actions">
											<VoidSwitch size='xs' value={true} onChange={() => {}} />
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('context') ? `` : 'hidden'}>
								<SettingsSection title="Context" description="Context and memory management">
									<SettingsCard>
										<SettingsRow title="Include Tool Lint Errors" description="Include lint errors in tool context">
											<VoidSwitch size='xs' value={settingsState.globalSettings.includeToolLintErrors} onChange={(newVal) => voidSettingsService.setGlobalSetting('includeToolLintErrors', newVal)} />
										</SettingsRow>
										<SettingsRow title="Auto-accept LLM Changes" description="Automatically accept file changes">
											<VoidSwitch size='xs' value={settingsState.globalSettings.autoAcceptLLMChanges} onChange={(newVal) => voidSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)} />
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('checkpoints') ? `` : 'hidden'}>
								<SettingsSection title="Checkpoints" description="Checkpoint and history management">
									<SettingsCard>
										<SettingsRow title="Enable Checkpoints" description="Create checkpoints before AI changes">
											<VoidSwitch size='xs' value={true} onChange={() => {}} />
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('language') ? `` : 'hidden'}>
								<SettingsSection title="Language" description="Language preferences">
									<SettingsCard>
										<SettingsRow title="Display Language" description="Language for the UI">
											<span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>English</span>
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('experimental') ? `` : 'hidden'}>
								<SettingsSection title="Experimental" description="Experimental features">
									<SettingsCard>
										<SettingsRow title="Fast Apply" description="Use fast apply for code changes">
											<FastApplyMethodDropdown />
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

							<div className={shouldShowTab('about') ? `` : 'hidden'}>
								<SettingsSection title="About" description="About Loophole">
									<SettingsCard>
										<SettingsRow title="Version" description="Loophole IDE version">
											<span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>2.2.4</span>
										</SettingsRow>
										<SettingsRow title="License" description="Open source license">
											<span className='text-[12px] text-[var(--vscode-descriptionForeground)]'>Apache-2.0</span>
										</SettingsRow>
										<SettingsRow title="GitHub" description="Source code and issues">
											<a href='https://github.com/loophole-ai/loophole-ide' className='text-[12px] text-[var(--vscode-textLink-foreground)] hover:underline'>github.com/loophole-ai/loophole-ide</a>
										</SettingsRow>
										<SettingsRow title="Discord" description="Community chat">
											<a href='https://discord.gg/loophole' className='text-[12px] text-[var(--vscode-textLink-foreground)] hover:underline'>Join Discord</a>
										</SettingsRow>
										<SettingsRow title="Report a Bug" description="File an issue on GitHub">
											<a href='https://github.com/loophole-ai/loophole-ide/issues/new' className='text-[12px] text-[var(--vscode-textLink-foreground)] hover:underline'>Open issue</a>
										</SettingsRow>
										<SettingsRow title="Reset All Settings" description="Reset Loophole settings to defaults">
											<ConfirmButton onConfirm={() => {}}>Reset</ConfirmButton>
										</SettingsRow>
										<SettingsRow title="Redo Onboarding" description="Restart the onboarding flow">
											<RedoOnboardingButton />
										</SettingsRow>
									</SettingsCard>
								</SettingsSection>
							</div>

						</div>
					</div>
				</main>
			</div>
		</div>
	);
}
