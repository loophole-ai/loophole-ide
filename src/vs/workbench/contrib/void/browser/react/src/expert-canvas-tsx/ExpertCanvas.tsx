/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles.css';
import { useAccessor, useIsDark } from '../util/services.js';
import {
	enabledExpertIds,
	expertCanvasStore,
	expertModelRef,
	expertsAutoApproveSettingId,
	expertsDisabledSettingId,
	expertsModelsSettingId,
	inheritLabel,
	modelLabel,
} from './expertCanvasStore.js';
import { VOID_TOGGLE_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';
import { CliModelSelect, useCliModels, useEnabledCliModels, visibleCliModels } from '../void-settings-tsx/cli-settings/CliModelSelect.js';
import { EXPERTS, expertById, toolDisplayName } from './expertDefs.js';
import { parsePlan, runExpert, planPromptFor } from './expertRunner.js';

/** Re-renders when any `loophole.experts.*` setting changes. */
const useExpertsConfigVersion = (): number => {
	const accessor = useAccessor();
	const configService = accessor.get('IConfigurationService');
	const [version, setVersion] = useState(0);
	useEffect(() => {
		const disposable = configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('loophole.experts')) { setVersion(v => v + 1); }
		});
		return () => disposable.dispose();
	}, [configService]);
	return version;
};

// Action IDs — must match expertCanvasEditorPane.ts exactly
const OPEN_EXPERT_CANVAS_TOGGLE_ACTION_ID = 'workbench.action.loophole.expertCanvas.toggle';
const OPEN_EXPERT_CANVAS_FRESH_ACTION_ID  = 'workbench.action.loophole.expertCanvas.open';

// ── Status styling ───────────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
	idle:    'bg-loophole-fg-4',
	working: 'bg-yellow-400 animate-pulse',
	done:    'bg-green-500',
	failed:  'bg-red-500',
	skipped: 'bg-loophole-fg-4 opacity-50',
};

const STATUS_LABEL: Record<string, string> = {
	idle:    'Queued',
	working: 'Working',
	done:    'Done',
	failed:  'Failed',
	skipped: 'Skipped',
};

// ── @mention helpers ─────────────────────────────────────────────────────────
function parseMention(text: string): { expertId: string; message: string } | null {
	const match = text.match(/^@(\w+)\s*(.*)/s);
	if (!match) return null;
	const expert = expertById(match[1]);
	if (!expert) return null;
	return { expertId: expert.id, message: match[2].trim() || text };
}

function getAtQuery(text: string, cursorPos: number): string | null {
	const match = text.slice(0, cursorPos).match(/@(\w*)$/);
	return match ? match[1] : null;
}

// ── Config Panel ──────────────────────────────────────────────────────────────
const ConfigPanel = ({ openSettings, onClose }: { openSettings: () => void; onClose: () => void }) => {
	const accessor = useAccessor();
	const configService = accessor.get('IConfigurationService');
	useExpertsConfigVersion();

	// Same model list as the chat picker: whatever the CLI reports and the user
	// switched on in Settings > Models.
	const { models, loading } = useCliModels();
	const { enabled } = useEnabledCliModels();

	const chosen = configService.getValue<Record<string, string>>(expertsModelsSettingId) ?? {};
	const disabled = configService.getValue<string[]>(expertsDisabledSettingId) ?? [];
	const autoApprove = configService.getValue<boolean>(expertsAutoApproveSettingId) === true;
	const visible = visibleCliModels(models, enabled, Object.values(chosen).filter(Boolean));

	const setModel = (expertId: string, ref: string) => {
		const next = { ...chosen };
		if (ref) { next[expertId] = ref; } else { delete next[expertId]; }
		void configService.updateValue(expertsModelsSettingId, next);
	};
	const setEnabled = (expertId: string, on: boolean) => {
		const next = disabled.filter(id => id !== expertId);
		if (!on) { next.push(expertId); }
		void configService.updateValue(expertsDisabledSettingId, next);
	};

	return (
		<div className="absolute inset-0 z-50 flex flex-col bg-loophole-bg-2">
			<div className="flex-shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-loophole-border-4">
				<span className="text-xs font-semibold text-loophole-fg-1">Expert settings</span>
				<button
					onClick={onClose}
					className="text-loophole-fg-4 hover:text-loophole-fg-1 transition-colors"
					title="Close"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
				<p className="text-[10px] text-loophole-fg-4 mb-2">
					Each expert runs on a model from your Loophole CLI. Experts set to {inheritLabel} use the model you picked for chat.
				</p>

				{!loading && models.length === 0 && (
					<div className="text-[11px] text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-3 rounded p-3">
						No models available yet. Connect a provider in Settings, then reopen this panel.
						<div className="mt-2">
							<button
								onClick={openSettings}
								className="text-[10px] text-loophole-fg-2 bg-loophole-bg-2 border border-loophole-border-3 rounded px-2 py-1 hover:border-loophole-border-1 transition-colors"
							>
								Open Settings
							</button>
						</div>
					</div>
				)}

				{EXPERTS.map(expert => {
					const isOn = !disabled.includes(expert.id);
					return (
						<div key={expert.id} className={`flex items-center gap-2 ${isOn ? '' : 'opacity-60'}`}>
							<img
								src={expert.avatar}
								alt={expert.name}
								width={24} height={24}
								className="rounded flex-shrink-0"
								style={{ imageRendering: 'pixelated' }}
							/>
							<div className="flex-1 min-w-0">
								<div className="text-xs font-medium text-loophole-fg-1">{expert.name}</div>
								<div className="text-[10px] text-loophole-fg-4">{expert.role}</div>
							</div>
							<div className="flex flex-col gap-1 items-end flex-shrink-0">
								<CliModelSelect
									value={chosen[expert.id] ?? ''}
									models={visible}
									emptyLabel={inheritLabel}
									onChange={ref => setModel(expert.id, ref)}
								/>
								{expert.id !== 'sara' && (
									<label className="flex items-center gap-1 text-[10px] text-loophole-fg-4 cursor-pointer">
										<input type="checkbox" checked={isOn} onChange={e => setEnabled(expert.id, e.target.checked)} />
										Enabled
									</label>
								)}
							</div>
						</div>
					);
				})}

				<label className="flex items-start gap-2 text-[11px] text-loophole-fg-2 cursor-pointer pt-2 border-t border-loophole-border-4">
					<input
						type="checkbox"
						className="mt-0.5"
						checked={autoApprove}
						onChange={e => { void configService.updateValue(expertsAutoApproveSettingId, e.target.checked); }}
					/>
					<span>
						Let experts edit files and run commands without asking
						<span className="block text-[10px] text-loophole-fg-4">Off: you approve each edit and command in the canvas.</span>
					</span>
				</label>
			</div>

			<div className="flex-shrink-0 px-3 py-2 border-t border-loophole-border-4">
				<button
					onClick={() => { void configService.updateValue(expertsModelsSettingId, {}); }}
					className="text-[10px] text-loophole-fg-4 hover:text-loophole-fg-2 transition-colors"
				>
					Reset all to {inheritLabel}
				</button>
			</div>
		</div>
	);
};

// ── Expert Card ───────────────────────────────────────────────────────────────
const ExpertCard = ({ expert, status, model, isSelected, onClick }: {
	expert: (typeof EXPERTS)[number];
	status: string;
	model: string;
	isSelected: boolean;
	onClick: () => void;
}) => (
	<div
		onClick={onClick}
		title={status === 'skipped' ? expert.skipReason : undefined}
		className={`rounded-lg p-2.5 cursor-pointer border transition-all bg-loophole-bg-1
			${isSelected ? 'border-loophole-border-1' : 'border-loophole-border-3 hover:border-loophole-border-2'}`}
	>
		<div className="flex items-center gap-1.5 mb-1.5">
			<img
				src={expert.avatar}
				alt={expert.name}
				width={24} height={24}
				className="rounded flex-shrink-0"
				style={{ imageRendering: 'pixelated' }}
			/>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-xs font-semibold text-loophole-fg-1 truncate">{expert.name}</span>
					<span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? STATUS_DOT.idle}`} />
				</div>
				<div className="text-[10px] text-loophole-fg-4 truncate">{expert.role}</div>
			</div>
		</div>
		<div className="flex items-center justify-between gap-1">
			<span className="text-[10px] text-loophole-fg-4 bg-loophole-bg-2 rounded px-1.5 py-0.5 truncate min-w-0">
				{model}
			</span>
			{status !== 'idle' && (
				<span className="text-[9px] text-loophole-fg-4 flex-shrink-0">
					{STATUS_LABEL[status] ?? status}
				</span>
			)}
		</div>
	</div>
);

// ── @mention Dropdown ─────────────────────────────────────────────────────────
const MentionDropdown = ({ query, onSelect }: { query: string; onSelect: (id: string) => void }) => {
	const filtered = EXPERTS.filter(e =>
		e.id.startsWith(query.toLowerCase()) || e.name.toLowerCase().startsWith(query.toLowerCase())
	);
	if (filtered.length === 0) return null;
	return (
		<div className="absolute bottom-full left-0 mb-1 w-full bg-loophole-bg-1 border border-loophole-border-2 rounded-md overflow-hidden z-50">
			{filtered.map(e => (
				<div
					key={e.id}
					onMouseDown={ev => { ev.preventDefault(); onSelect(e.id); }}
					className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-loophole-bg-2 transition-colors"
				>
					<img src={e.avatar} alt={e.name} width={16} height={16} className="rounded flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
					<span className="text-xs font-medium text-loophole-fg-1">{e.name}</span>
					<span className="text-[10px] text-loophole-fg-4 ml-auto">{e.role}</span>
				</div>
			))}
		</div>
	);
};

// ── Pending tool approval ─────────────────────────────────────────────────────
const ApprovalRow = ({ title, toolName, onApprove, onReject }: {
	title: string;
	toolName: string;
	onApprove: () => void;
	onReject: () => void;
}) => (
	<div className="flex items-center gap-2 px-2 py-1.5 rounded bg-yellow-400/10 border border-yellow-400/30">
		<span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
		<div className="flex-1 min-w-0">
			<div className="text-[10px] text-loophole-fg-1 truncate">{title}</div>
			<div className="text-[9px] text-loophole-fg-4">{toolDisplayName(toolName)} · waiting for you</div>
		</div>
		<button
			onClick={onApprove}
			className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors flex-shrink-0"
		>
			Allow
		</button>
		<button
			onClick={onReject}
			className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors flex-shrink-0"
		>
			Deny
		</button>
	</div>
);

// ── Main ExpertCanvas ─────────────────────────────────────────────────────────
export const ExpertCanvas = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const configService = accessor.get('IConfigurationService');
	const configVersion = useExpertsConfigVersion();

	const [storeState, setStoreState] = useState(() => expertCanvasStore.getState());
	const [toolActivities, setToolActivities] = useState(() => expertCanvasStore.getToolActivities());
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [showConfig, setShowConfig] = useState(false);
	const [prompt, setPrompt] = useState('');
	const [atQuery, setAtQuery] = useState<string | null>(null);

	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// One cancellation flag for the whole pipeline. Previously each expert
	// overwrote a single `abortRef`, so Stop killed one request and the
	// sequential `await runExpert(...)` chain happily moved on to the next one.
	const cancelledRef = useRef(false);
	const isCancelled = useCallback(() => cancelledRef.current, []);

	useEffect(() => expertCanvasStore.subscribe(() => {
		setStoreState({ ...expertCanvasStore.getState() });
		setToolActivities([...expertCanvasStore.getToolActivities()]);
	}), []);

	const { experts: storeExperts, isRunning } = storeState;

	// Enabled experts, straight from settings. An expert turned off in Settings
	// does not appear in a run at all, rather than sitting at "Pending" forever.
	const enabledExperts = useMemo(
		() => {
			const ids = enabledExpertIds(configService, EXPERTS.map(e => e.id));
			return EXPERTS.filter(e => ids.includes(e.id));
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[configService, configVersion],
	);

	const counts = {
		done:    storeExperts.filter(e => e.status === 'done').length,
		working: storeExperts.filter(e => e.status === 'working').length,
		idle:    storeExperts.filter(e => e.status === 'idle').length,
		failed:  storeExperts.filter(e => e.status === 'failed').length,
		skipped: storeExperts.filter(e => e.status === 'skipped').length,
	};

	const pendingApprovals = useMemo(
		() => toolActivities.filter(t => t.status === 'awaiting-approval'),
		[toolActivities],
	);

	const openToggle = useCallback(() => {
		accessor.get('ICommandService').executeCommand(OPEN_EXPERT_CANVAS_TOGGLE_ACTION_ID);
	}, [accessor]);

	const openFresh = useCallback(() => {
		accessor.get('ICommandService').executeCommand(OPEN_EXPERT_CANVAS_FRESH_ACTION_ID);
	}, [accessor]);

	const openSettings = useCallback(() => {
		accessor.get('ICommandService').executeCommand(VOID_TOGGLE_SETTINGS_ACTION_ID);
	}, [accessor]);

	// ── Team pipeline, driven by Sara's plan ──
	const runTeam = useCallback(async (goal: string) => {
		cancelledRef.current = false;
		expertCanvasStore.reset(goal, enabledExperts.map(e => e.id));
		openFresh();

		const sara = expertById('sara')!;
		// Sara always runs, and always first, even if she is disabled: without a
		// plan there is no roster. She has no tools, so this is one round trip.
		try {
			await runExpert({
				accessor,
				expert: sara,
				userMessage: `${goal}\n\n${planPromptFor(enabledExperts)}`,
				isCancelled,
			});
		} catch (err) {
			console.error('[ExpertCanvas] sara failed', err);
		}

		if (isCancelled()) { expertCanvasStore.setRunning(false); return; }

		const saraOut = lastOutputOf('sara');
		const { steps } = parsePlan(goal, saraOut, enabledExperts.map(e => e.id));

		// Everyone Sara did not assign is explicitly marked skipped, so the
		// canvas never shows an expert that was simply not asked to do anything.
		const assigned = new Set(steps.map(s => s.expertId));
		for (const e of enabledExperts) {
			if (e.id !== 'sara' && !assigned.has(e.id)) {
				expertCanvasStore.skipExpert(e.id, 'Sara did not assign this expert a task for this goal.');
			}
		}

		if (steps.length === 0) {
			expertCanvasStore.setRunning(false);
			return;
		}

		// Each step gets everything the earlier steps concluded. Context is
		// accumulated rather than threaded pairwise so the last expert in a long
		// roster still knows what the first one found.
		const handoff: string[] = [`Sara's plan:\n${saraOut}`];
		try {
			for (const step of steps) {
				if (isCancelled()) break;
				const expert = expertById(step.expertId);
				if (!expert) continue;
				const out = await runExpert({
					accessor,
					expert,
					userMessage: `${goal}\n\nYour task from Sara: ${step.task}${step.why ? `\nReason: ${step.why}` : ''}`,
					priorContext: handoff.join('\n\n'),
						isCancelled,
				});
				if (out) handoff.push(`${expert.name}:\n${out}`);
			}
		} catch (err) {
			console.error('[ExpertCanvas] team run error', err);
		} finally {
			expertCanvasStore.setRunning(false);
		}
	}, [accessor, enabledExperts, openFresh, isCancelled]);

	/** The last assistant message an expert produced this run. */
	const lastOutputOf = (expertId: string): string => {
		const msgs = expertCanvasStore.getState().experts.find(e => e.id === expertId)?.messages ?? [];
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i].role === 'assistant' && msgs[i].content) return msgs[i].content;
		}
		return '';
	};

	// ── Direct @mention ──
	const runMention = useCallback(async (expertId: string, message: string) => {
		cancelledRef.current = false;
		const expert = expertById(expertId);
		if (!expert) return;
		expertCanvasStore.directMessage(expertId, message);
		openFresh();
		try {
			await runExpert({ accessor, expert, userMessage: message, isCancelled });
		} finally {
			expertCanvasStore.setRunning(false);
		}
	}, [accessor, openFresh, isCancelled]);

	const handleRun = useCallback(async () => {
		const text = prompt.trim();
		if (!text || isRunning) return;
		setPrompt('');
		setAtQuery(null);
		const mention = parseMention(text);
		if (mention) {
			await runMention(mention.expertId, mention.message || text);
		} else {
			await runTeam(text);
		}
	}, [prompt, isRunning, runMention, runTeam]);

	const handleAbort = useCallback(() => {
		cancelledRef.current = true;
		// Release anything blocked on a decision, or the agent loop would hang
		// waiting for an approval that is never coming.
		expertCanvasStore.rejectAllApprovals();
		expertCanvasStore.setRunning(false);
	}, []);

	const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const val = e.target.value;
		setPrompt(val);
		setAtQuery(getAtQuery(val, e.target.selectionStart ?? val.length));
	}, []);

	const handleMentionSelect = useCallback((expertId: string) => {
		const expert = expertById(expertId);
		if (!expert) return;
		setPrompt(p => p.replace(/@\w*$/, `@${expert.name} `));
		setAtQuery(null);
		textareaRef.current?.focus();
	}, []);

	// ── Render ──
	return (
		<div className={`@@loophole-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%' }}>
			<div className="relative w-full h-full bg-loophole-bg-2 text-loophole-fg-1 flex flex-col overflow-hidden">

				{showConfig && (
					<ConfigPanel
						openSettings={openSettings}
						onClose={() => setShowConfig(false)}
					/>
				)}

				{/* ── Header ── */}
				<div className="flex-shrink-0 flex items-center px-3 pt-3 pb-2 border-b border-loophole-border-4">
					<span className="text-sm font-semibold text-loophole-fg-1 flex-1">Experts</span>
					<button
						onClick={() => setShowConfig(v => !v)}
						className={`p-1 rounded transition-colors mr-1.5
							${showConfig
								? 'text-loophole-fg-1 bg-loophole-bg-1'
								: 'text-loophole-fg-4 hover:text-loophole-fg-2 hover:bg-loophole-bg-1'}`}
						title="Expert models"
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<circle cx="12" cy="12" r="3" />
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
						</svg>
					</button>
					<button
						onClick={openToggle}
						className="text-[10px] text-loophole-fg-4 hover:text-loophole-fg-2 px-1.5 py-0.5 rounded border border-transparent hover:border-loophole-border-3 transition-colors"
						title="Open Expert Canvas tab"
					>
						Canvas ↗
					</button>
				</div>

				{/* ── Stats bar ── */}
				<div className="flex-shrink-0 flex items-center gap-3 px-3 py-1.5 border-b border-loophole-border-4">
					{[
						{ label: 'done',    cls: 'bg-green-500',     count: counts.done },
						{ label: 'working', cls: 'bg-yellow-400',    count: counts.working },
						{ label: 'queued',  cls: 'bg-loophole-fg-4', count: counts.idle },
						{ label: 'failed',  cls: 'bg-red-500',       count: counts.failed },
						{ label: 'skipped', cls: 'bg-loophole-fg-4', count: counts.skipped },
					].filter(s => s.count > 0).map(({ label, cls, count }) => (
						<span key={label} className="flex items-center gap-1">
							<span className={`w-1.5 h-1.5 rounded-full ${cls}`} />
							<span className="text-[10px] text-loophole-fg-4">{count} {label}</span>
						</span>
					))}
					{storeExperts.length === 0 && (
						<span className="text-[10px] text-loophole-fg-4">no run yet</span>
					)}
				</div>

				{/* ── Pending approvals ── */}
				{pendingApprovals.length > 0 && (
					<div className="flex-shrink-0 px-2 py-1.5 space-y-1 border-b border-loophole-border-4 bg-yellow-400/5">
						{pendingApprovals.map(t => (
							<ApprovalRow
								key={t.id}
								title={t.title}
								toolName={t.toolName}
								onApprove={() => expertCanvasStore.resolveApproval(t.id, true)}
								onReject={() => expertCanvasStore.resolveApproval(t.id, false)}
							/>
						))}
					</div>
				)}

				{/* ── Expert grid ── */}
				<div className="flex-1 overflow-y-auto p-3">
					<div className="grid grid-cols-2 gap-2">
						{EXPERTS.map(expert => {
							const state = storeExperts.find(e => e.id === expert.id);
							const isEnabled = enabledExperts.some(e => e.id === expert.id);
							return (
								<ExpertCard
									key={expert.id}
									expert={{
										...expert,
										// A disabled expert has no state of its own, so say
										// why it is showing as skipped rather than leaving the
										// tooltip empty.
										skipReason: isEnabled ? state?.skipReason : 'Disabled in expert settings.',
									}}
									status={isEnabled ? (state?.status ?? 'idle') : 'skipped'}
									model={modelLabel(expertModelRef(configService, expert.id))}
									isSelected={selectedId === expert.id}
									onClick={() => {
										setSelectedId(p => p === expert.id ? null : expert.id);
										setPrompt(`@${expert.name} `);
										textareaRef.current?.focus();
									}}
								/>
							);
						})}
					</div>

					{enabledExperts.length < EXPERTS.length && (
						<p className="text-[10px] text-loophole-fg-4 mt-2 text-center">
							Some experts are disabled.{' '}
							<button onClick={() => setShowConfig(true)} className="text-loophole-fg-2 underline">Enable them in expert settings</button>
						</p>
					)}

					{!isRunning && storeExperts.every(e => e.messages.length === 0) && (
						<div className="text-center py-5 text-loophole-fg-4 text-xs mt-2">
							<div className="text-loophole-fg-3 mb-0.5">Describe a goal, or</div>
							<div><span className="text-loophole-fg-2">@mention</span> an expert directly</div>
						</div>
					)}
				</div>

				{/* ── Input Box ── */}
				<div className="flex-shrink-0 p-2 border-t border-loophole-border-4">
					<div className="relative flex flex-col p-2 rounded-md bg-loophole-bg-1 border border-loophole-border-3 focus-within:border-loophole-border-1 hover:border-loophole-border-1 transition-colors">
						{atQuery !== null && (
							<MentionDropdown query={atQuery} onSelect={handleMentionSelect} />
						)}

						<textarea
							ref={textareaRef}
							className="w-full resize-none bg-transparent outline-none text-xs text-loophole-fg-1 placeholder:text-loophole-fg-4 min-h-[56px] max-h-[140px] px-0.5 py-0.5"
							placeholder={isRunning ? 'Team working...' : 'Goal, or @sara @leo @karl...'}
							value={prompt}
							disabled={isRunning}
							onChange={handleChange}
							onKeyDown={e => {
								if (e.key === 'Escape' && atQuery !== null) {
									e.preventDefault();
									setAtQuery(null);
									return;
								}
								if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && atQuery === null) {
									e.preventDefault();
									handleRun();
								}
							}}
							onBlur={() => setTimeout(() => setAtQuery(null), 150)}
						/>

						<div className="flex items-center justify-end mt-1">
							{isRunning ? (
								<button
									type="button"
									onClick={handleAbort}
									className="rounded-full flex items-center justify-center w-[22px] h-[22px] bg-white cursor-pointer flex-shrink-0"
									title="Stop"
								>
									<svg className="fill-black" viewBox="0 0 24 24" width="10" height="10">
										<rect x="3" y="3" width="18" height="18" rx="3" />
									</svg>
								</button>
							) : (
								<button
									type="button"
									onClick={handleRun}
									disabled={!prompt.trim()}
									className={`rounded-full flex items-center justify-center w-[22px] h-[22px] bg-white flex-shrink-0 transition-opacity
										${!prompt.trim() ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
									title="Run (↵)"
								>
									<svg width="22" height="22" viewBox="0 0 20 20" fill="none">
										<path fill="black" fillRule="evenodd" clipRule="evenodd"
											d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" />
									</svg>
								</button>
							)}
						</div>
					</div>
				</div>

			</div>
		</div>
	);
};

