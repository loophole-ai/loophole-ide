/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles.css';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import {
	expertCanvasStore,
	inheritLabel,
	modelLabel,
	providerNamesOfOptions,
	resolveModel,
} from './expertCanvasStore.js';
import { ModelOption } from '../../../../common/voidSettingsService.js';
import { VOID_TOGGLE_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';
import {
	displayInfoOfProviderName,
	ModelSelection,
	modelSelectionsEqual,
	ProviderName,
	VoidSettingsState,
} from '../../../../common/voidSettingsTypes.js';

// Action IDs — must match expertCanvasEditorPane.ts exactly
const OPEN_EXPERT_CANVAS_TOGGLE_ACTION_ID = 'workbench.action.loophole.expertCanvas.toggle';
const OPEN_EXPERT_CANVAS_FRESH_ACTION_ID  = 'workbench.action.loophole.expertCanvas.open';

// ── Avatars ──────────────────────────────────────────────────────────────────
import saraAvatar  from './avatars/sara.png';
import leoAvatar   from './avatars/leo.png';
import karlAvatar  from './avatars/karl.png';
import jakeAvatar  from './avatars/jake.png';
import rayAvatar   from './avatars/ray.png';
import noraAvatar  from './avatars/nora.png';
import elenaAvatar from './avatars/elena.png';
import maxAvatar   from './avatars/max.png';

const AVATARS: Record<string, string> = {
	sara: saraAvatar, leo: leoAvatar, karl: karlAvatar, jake: jakeAvatar,
	ray: rayAvatar, nora: noraAvatar, elena: elenaAvatar, max: maxAvatar,
};

// ── Expert definitions ────────────────────────────────────────────────────────
type ExpertDef = {
	id: string;
	name: string;
	role: string;
};

const EXPERTS: ExpertDef[] = [
	{ id: 'sara',  name: 'Sara',  role: 'Team Lead'      },
	{ id: 'leo',   name: 'Leo',   role: 'Researcher'     },
	{ id: 'karl',  name: 'Karl',  role: 'Engineer'       },
	{ id: 'jake',  name: 'Jake',  role: 'QA Engineer'    },
	{ id: 'ray',   name: 'Ray',   role: 'Code Reviewer'  },
	{ id: 'nora',  name: 'Nora',  role: 'Debug Engineer' },
	{ id: 'elena', name: 'Elena', role: 'UI/UX Operator' },
	{ id: 'max',   name: 'Max',   role: 'Docs Writer'    },
];

// ── System prompts ────────────────────────────────────────────────────────────
const PROMPTS: Record<string, string> = {
	sara:  `You are Sara, the Team Lead of an expert AI engineering team inside a code editor. Your job is to understand the user's goal deeply, break it into clear tasks, assign each task to the right expert, track progress, and ensure all outputs integrate into a cohesive result. You never write code yourself. Produce a structured plan: goal summary, numbered task list with assigned expert, dependencies, and risks. Be concise.`,
	leo:   `You are Leo, the Researcher. You go first, before any code is written. Map dependencies, find relevant functions, surface risks. You never write code — completely read-only. Output: relevant files, key functions, dependencies, risks, recommendations, unknowns.`,
	karl:  `You are Karl, the Full-Stack Engineer and main implementer. Write clean code following existing project conventions. Frontend and backend. Prefer simple over clever. Output: what you would change and why, edge cases handled, what QA should test.`,
	jake:  `You are Jake, the QA Engineer. Validate that what was built actually works. Write tests for happy paths, edge cases, failure scenarios. Report exact error messages, file names, line numbers. Output: tests to write, what to validate, pass/fail verdict.`,
	ray:   `You are Ray, the Code Reviewer. Read-only — you review, never rewrite. Check quality, security, performance, maintainability. Use [CRITICAL] / [WARNING] / [SUGGESTION] severity levels. Output: structured findings with file:line and suggested fixes.`,
	nora:  `You are Nora, the Debug Engineer. Called only when something is broken. Follow evidence, never gut feelings. Reproduce → diagnose → fix. Output: root cause, evidence, proposed fix, verification step.`,
	elena: `You are Elena, the UI/UX Operator. Validate the interface end-to-end — not just whether it works, but whether it feels right to a real user. Output: flows tested, issues found with severity (BROKEN/VISUAL/UX), responsive check.`,
	max:   `You are Max, the Documentation Writer. Always run last. Write for the developer who inherits this in 6 months. Write inline comments, JSDoc/TSDoc, README sections, changelog entries. Never document what isn't there.`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
	idle:    'bg-loophole-fg-4',
	working: 'bg-yellow-400 animate-pulse',
	done:    'bg-green-500',
	failed:  'bg-red-500',
};

function parseMention(text: string): { expertId: string; message: string } | null {
	const match = text.match(/^@(\w+)\s*(.*)/s);
	if (!match) return null;
	const name = match[1].toLowerCase();
	const expert = EXPERTS.find(e => e.id === name || e.name.toLowerCase() === name);
	if (!expert) return null;
	return { expertId: expert.id, message: match[2].trim() || text };
}

function getAtQuery(text: string, cursorPos: number): string | null {
	const before = text.slice(0, cursorPos);
	const match = before.match(/@(\w*)$/);
	return match ? match[1] : null;
}

// ── Config Panel ──────────────────────────────────────────────────────────────
const ConfigPanel = ({
	expertModels,
	allOptions,
	settingsState,
	onModelChange,
	onResetModels,
	openSettings,
	onClose,
}: {
	expertModels: Record<string, ModelSelection | null>;
	allOptions: ModelOption[];
	settingsState: VoidSettingsState;
	onModelChange: (expertId: string, model: ModelSelection | null) => void;
	onResetModels: () => void;
	openSettings: () => void;
	onClose: () => void;
}) => (
	<div className="absolute inset-0 z-50 flex flex-col bg-loophole-bg-2">
		{/* Header */}
		<div className="flex-shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-loophole-border-4">
			<span className="text-xs font-semibold text-loophole-fg-1">Expert Settings</span>
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

		{/* Expert model rows */}
		<div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
			<p className="text-[10px] text-loophole-fg-4 mb-2">
				Pick the provider and model each expert uses, from the ones you have set up in
				Loophole Settings. Changes apply to the next run.
			</p>

			{allOptions.length === 0 ? (
				<div className="text-[11px] text-loophole-fg-3 bg-loophole-bg-1 border border-loophole-border-3 rounded p-3">
					No models available yet. Add a provider and model in Settings, then reopen this panel.
					<div className="mt-2">
						<button
							onClick={openSettings}
							className="text-[10px] text-loophole-fg-2 bg-loophole-bg-2 border border-loophole-border-3 rounded px-2 py-1 hover:border-loophole-border-1 transition-colors"
						>
							Open Settings
						</button>
					</div>
				</div>
			) : EXPERTS.map(expert => {
				const chosen = expertModels[expert.id] ?? null;
				const effective = resolveModel(chosen, settingsState);
				const providerValue = chosen?.providerName ?? effective?.providerName ?? '';
				const modelOptions = allOptions.filter(o => o.selection.providerName === providerValue);
				const modelIndex = chosen ? modelOptions.findIndex(o => modelSelectionsEqual(o.selection, chosen)) : -1;
				const modelValue = modelIndex >= 0 ? String(modelIndex) : '-1';
				return (
					<div key={expert.id} className="flex items-center gap-2">
						<img
							src={AVATARS[expert.id]}
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
							<select
								value={providerValue}
								onChange={e => {
									const newProvider = e.target.value as ProviderName;
									// Switching provider invalidates the model, so jump
									// to that provider's first available model.
									const first = allOptions.find(o => o.selection.providerName === newProvider);
									onModelChange(expert.id, first ? first.selection : null);
								}}
								className="text-[10px] text-loophole-fg-2 bg-loophole-bg-1 border border-loophole-border-3 rounded px-1.5 py-1 outline-none hover:border-loophole-border-1 focus:border-loophole-border-1 transition-colors cursor-pointer"
							>
								<option value="">{inheritLabel}</option>
								{providerNamesOfOptions(allOptions).map(pn => (
									<option key={pn} value={pn}>{displayInfoOfProviderName(pn).title}</option>
								))}
							</select>
							<select
								value={modelValue}
								disabled={!chosen}
								onChange={e => {
									const picked = modelOptions[Number(e.target.value)];
							if (picked) { onModelChange(expert.id, picked.selection); }
								}}
								className="text-[10px] text-loophole-fg-2 bg-loophole-bg-1 border border-loophole-border-3 rounded px-1.5 py-1 outline-none hover:border-loophole-border-1 focus:border-loophole-border-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default max-w-[150px]"
							>
								{modelIndex < 0 && <option value="-1">{inheritLabel}</option>}
								{modelOptions.map((o, i) => (
									<option
										key={o.selection.modelName}
										value={String(i)}
									>
										{o.name}
									</option>
								))}
							</select>
						</div>
					</div>
				);
			})}
		</div>

		{/* Reset */}
		<div className="flex-shrink-0 px-3 py-2 border-t border-loophole-border-4">
			<button
				onClick={onResetModels}
				className="text-[10px] text-loophole-fg-4 hover:text-loophole-fg-2 transition-colors"
			>
				Reset all to {inheritLabel}
			</button>
		</div>
	</div>
);

// ── Expert Card ───────────────────────────────────────────────────────────────
const ExpertCard = ({ expert, status, model, isSelected, onClick }: {
	expert: ExpertDef;
	status: string;
	model: string;
	isSelected: boolean;
	onClick: () => void;
}) => (
	<div
		onClick={onClick}
		className={`rounded-lg p-2.5 cursor-pointer border transition-all bg-loophole-bg-1
			${isSelected ? 'border-loophole-border-1' : 'border-loophole-border-3 hover:border-loophole-border-2'}`}
	>
		<div className="flex items-center gap-1.5 mb-1.5">
			<img
				src={AVATARS[expert.id]}
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
		<div className="text-[10px] text-loophole-fg-4 bg-loophole-bg-2 rounded px-1.5 py-0.5 truncate max-w-full">
			{model}
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
					<img src={AVATARS[e.id]} alt={e.name} width={16} height={16} className="rounded flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
					<span className="text-xs font-medium text-loophole-fg-1">{e.name}</span>
					<span className="text-[10px] text-loophole-fg-4 ml-auto">{e.role}</span>
				</div>
			))}
		</div>
	);
};

// ── Main ExpertCanvas ─────────────────────────────────────────────────────────
export const ExpertCanvas = () => {
	const isDark = useIsDark();
	const accessor = useAccessor();
	const settingsState = useSettingsState();

	const [storeState, setStoreState] = useState(() => expertCanvasStore.getState());
	const [selectedId, setSelectedId]   = useState<string | null>(null);
	const [showConfig, setShowConfig]   = useState(false);
	const [prompt, setPrompt]           = useState('');
	const [atQuery, setAtQuery]         = useState<string | null>(null);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const abortRef    = useRef<string | null>(null);

	useEffect(() => expertCanvasStore.subscribe(() => setStoreState({ ...expertCanvasStore.getState() })), []);

	const { experts: storeExperts, isRunning } = storeState;

	// Every model the user has configured, across all providers. This is the same
	// list the chat's own model dropdown uses, so it already reflects which
	// providers have keys and which local servers are running.
	const allOptions = settingsState._modelOptions;

	// Per-expert overrides, read from the store so the canvas tab and the
	// sidebar stay in sync. `undefined`/null means inherit the Chat model.
	const expertModels = useMemo(() => {
		const out: Record<string, ModelSelection | null> = {};
		for (const e of storeExperts) { out[e.id] = e.model; }
		return out;
	}, [storeExperts]);

	const counts = {
		done:    storeExperts.filter(e => e.status === 'done').length,
		working: storeExperts.filter(e => e.status === 'working').length,
		idle:    storeExperts.filter(e => e.status === 'idle').length,
		failed:  storeExperts.filter(e => e.status === 'failed').length,
	};

	const openToggle = useCallback(() => {
		accessor.get('ICommandService').executeCommand(OPEN_EXPERT_CANVAS_TOGGLE_ACTION_ID);
	}, [accessor]);

	const openFresh = useCallback(() => {
		accessor.get('ICommandService').executeCommand(OPEN_EXPERT_CANVAS_FRESH_ACTION_ID);
	}, [accessor]);

	const openSettings = useCallback(() => {
		accessor.get('ICommandService').executeCommand(VOID_TOGGLE_SETTINGS_ACTION_ID);
	}, [accessor]);

	const handleModelChange = useCallback((expertId: string, model: ModelSelection | null) => {
		expertCanvasStore.setExpertModel(expertId, model);
	}, []);

	const handleResetModels = useCallback(() => {
		expertCanvasStore.resetModelsToDefault();
	}, []);

	// ── Core LLM call per expert ──
	const runExpert = useCallback(async (expertId: string, userMessage: string): Promise<string> => {
		const llmMessageService = accessor.get('ILLMMessageService');
		const modelSelection = resolveModel(expertModels[expertId] ?? null, settingsState);

		expertCanvasStore.setExpertStatus(expertId, 'working');
		expertCanvasStore.addUserMessage(expertId, userMessage);
		expertCanvasStore.beginAssistantMessage(expertId);

		if (!modelSelection) {
			expertCanvasStore.appendToLastMessage(
				expertId,
				'**No model available.** Add a provider and model in Loophole Settings, then try again.',
			);
			expertCanvasStore.setExpertStatus(expertId, 'failed');
			expertCanvasStore.finalizeLastMessage(expertId);
			return '';
		}

		return new Promise<string>(resolve => {
			let fullText = '';
			const requestId = llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: userMessage }],
				separateSystemMessage: PROMPTS[expertId],
				chatMode: null,
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: settingsState.overridesOfModel,
				logging: { loggingName: `expert-${expertId}` },
				onText: ({ fullText: newFullText }) => {
					// onText delivers the whole message so far, not a delta, so
					// compute the delta ourselves before appending.
					const delta = newFullText.slice(fullText.length);
					fullText = newFullText;
					if (delta) {
						expertCanvasStore.appendToLastMessage(expertId, delta);
					}
				},
				onFinalMessage: () => {
					expertCanvasStore.setExpertStatus(expertId, 'done');
					expertCanvasStore.finalizeLastMessage(expertId);
					resolve(fullText);
				},
				onError: ({ message }) => {
					expertCanvasStore.setExpertStatus(expertId, 'failed');
					// Surface the reason, e.g. a missing API key or a local server
					// that is not running. Otherwise the expert just shows "Failed".
					if (message) {
						expertCanvasStore.appendToLastMessage(expertId, `\n\n**Error:** ${message}`);
					}
					expertCanvasStore.finalizeLastMessage(expertId);
					resolve('');
				},
				onAbort: () => {
					expertCanvasStore.setExpertStatus(expertId, 'idle');
					expertCanvasStore.finalizeLastMessage(expertId);
					resolve('');
				},
			});
			if (requestId) abortRef.current = requestId;
		});
	}, [accessor, settingsState, expertModels]);

	// ── Full team pipeline ──
	const runFullTeam = useCallback(async (goal: string) => {
		expertCanvasStore.reset(goal);
		openFresh();
		try {
			const saraOut = await runExpert('sara', goal);
			const leoOut  = await runExpert('leo',  `Goal: ${goal}\n\nSara's plan:\n${saraOut}\n\nResearch what's relevant.`);
			const karlOut = await runExpert('karl', `Goal: ${goal}\n\nSara:\n${saraOut}\n\nLeo:\n${leoOut}\n\nDescribe your implementation.`);
			await Promise.all([
				runExpert('ray',  `Goal: ${goal}\n\nKarl's implementation:\n${karlOut}\n\nReview this code.`),
				runExpert('jake', `Goal: ${goal}\n\nKarl's implementation:\n${karlOut}\n\nDescribe your test plan.`),
			]);
			const karlFinal = expertCanvasStore.getState().experts.find(e => e.id === 'karl')?.messages.at(-1)?.content ?? karlOut;
			const rayFinal  = expertCanvasStore.getState().experts.find(e => e.id === 'ray')?.messages.at(-1)?.content ?? '';
			await runExpert('max', `Goal: ${goal}\n\nKarl:\n${karlFinal}\n\nRay:\n${rayFinal}\n\nWrite the documentation.`);
		} catch (err) {
			console.error('[ExpertCanvas] team run error', err);
		} finally {
			expertCanvasStore.setRunning(false);
		}
	}, [runExpert, openFresh]);

	// ── Direct @mention ──
	const runMention = useCallback(async (expertId: string, message: string) => {
		expertCanvasStore.directMessage(expertId, message);
		openFresh();
		try {
			await runExpert(expertId, message);
		} finally {
			expertCanvasStore.setRunning(false);
		}
	}, [runExpert, openFresh]);

	const handleRun = useCallback(async () => {
		const text = prompt.trim();
		if (!text || isRunning) return;
		setPrompt('');
		setAtQuery(null);
		const mention = parseMention(text);
		if (mention) {
			await runMention(mention.expertId, mention.message || text);
		} else {
			await runFullTeam(text);
		}
	}, [prompt, isRunning, runMention, runFullTeam]);

	const handleAbort = useCallback(() => {
		if (abortRef.current) accessor.get('ILLMMessageService').abort(abortRef.current);
		expertCanvasStore.setRunning(false);
	}, [accessor]);

	const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const val = e.target.value;
		setPrompt(val);
		setAtQuery(getAtQuery(val, e.target.selectionStart ?? val.length));
	}, []);

	const handleMentionSelect = useCallback((expertId: string) => {
		const expert = EXPERTS.find(e => e.id === expertId)!;
		setPrompt(p => p.replace(/@\w*$/, `@${expert.name} `));
		setAtQuery(null);
		textareaRef.current?.focus();
	}, []);

	// ── Render ──
	return (
		<div className={`@@loophole-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%' }}>
			<div className="relative w-full h-full bg-loophole-bg-2 text-loophole-fg-1 flex flex-col overflow-hidden">

				{/* Config panel overlay */}
				{showConfig && (
					<ConfigPanel
						expertModels={expertModels}
						allOptions={allOptions}
						settingsState={settingsState}
						onModelChange={handleModelChange}
						onResetModels={handleResetModels}
						openSettings={openSettings}
						onClose={() => setShowConfig(false)}
					/>
				)}

				{/* ── Header ── */}
				<div className="flex-shrink-0 flex items-center px-3 pt-3 pb-2 border-b border-loophole-border-4">
					<span className="text-sm font-semibold text-loophole-fg-1 flex-1">Experts</span>

					{/* Gear / config button */}
					<button
						onClick={() => setShowConfig(v => !v)}
						className={`p-1 rounded transition-colors mr-1.5
							${showConfig
								? 'text-loophole-fg-1 bg-loophole-bg-1'
								: 'text-loophole-fg-4 hover:text-loophole-fg-2 hover:bg-loophole-bg-1'
							}`}
						title="Expert settings — pick model per expert"
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<circle cx="12" cy="12" r="3" />
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
						</svg>
					</button>

					{/* Open canvas tab */}
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
						{ label: 'done',    cls: 'bg-green-500',     count: counts.done    },
						{ label: 'working', cls: 'bg-yellow-400',    count: counts.working },
						{ label: 'idle',    cls: 'bg-loophole-fg-4', count: counts.idle    },
						{ label: 'failed',  cls: 'bg-red-500',       count: counts.failed  },
					].filter(s => s.label !== 'failed' || s.count > 0).map(({ label, cls, count }) => (
						<span key={label} className="flex items-center gap-1">
							<span className={`w-1.5 h-1.5 rounded-full ${cls}`} />
							<span className="text-[10px] text-loophole-fg-4">{count} {label}</span>
						</span>
					))}
				</div>

				{/* ── Expert grid ── */}
				<div className="flex-1 overflow-y-auto p-3">
					<div className="grid grid-cols-2 gap-2">
						{EXPERTS.map(expert => (
							<ExpertCard
								key={expert.id}
								expert={expert}
								status={storeExperts.find(e => e.id === expert.id)?.status ?? 'idle'}
								model={modelLabel(resolveModel(expertModels[expert.id] ?? null, settingsState))}
								isSelected={selectedId === expert.id}
								onClick={() => {
									setSelectedId(p => p === expert.id ? null : expert.id);
									setPrompt(`@${expert.name} `);
									textareaRef.current?.focus();
								}}
							/>
						))}
					</div>

					{/* Empty state */}
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

						{/* @mention dropdown */}
						{atQuery !== null && (
							<MentionDropdown query={atQuery} onSelect={handleMentionSelect} />
						)}

						{/* Textarea */}
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

						{/* Bottom row — send/stop only */}
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
