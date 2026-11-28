/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles.css';
import { useAccessor, useIsDark } from '../util/services.js';
import {
	expertCanvasStore,
	modelLabel,
	expertModelRef,
	type ExpertState,
	type ExpertMessage,
} from './expertCanvasStore.js';
import { EXPERTS } from './expertDefs.js';
import { toolDisplayName } from './expertDefs.js';

// ---- Status badge ----
type StatusType = ExpertState['status'];

const STATUS_BADGE: Record<StatusType, { label: string; cls: string }> = {
	idle:    { label: 'Queued',     cls: 'text-loophole-fg-4 border border-loophole-border-3' },
	working: { label: 'In Progress', cls: 'text-yellow-400 border border-yellow-400/40' },
	done:    { label: 'Completed',   cls: 'text-green-400 border border-green-400/40' },
	failed:  { label: 'Failed',      cls: 'text-red-400 border border-red-400/40' },
	skipped: { label: 'Skipped',     cls: 'text-loophole-fg-4 border border-loophole-border-3 opacity-70' },
};

const STATUS_DOT: Record<StatusType, string> = {
	idle:    'bg-loophole-fg-4',
	working: 'bg-yellow-400 animate-pulse',
	done:    'bg-green-400',
	failed:  'bg-red-400',
	skipped: 'bg-loophole-fg-4 opacity-40',
};

// ---- Avatar component ----
const Avatar = ({ id, name, size = 32 }: { id: string; name: string; size?: number }) => {
	const expert = EXPERTS.find(e => e.id === id);
	return (
		<img
			src={expert?.avatar ?? ''}
			alt={name}
			width={size}
			height={size}
			className="rounded-md flex-shrink-0"
			style={{ imageRendering: 'pixelated', width: size, height: size }}
		/>
	);
};

// ============================================================
// LEFT PANEL — Task list
// ============================================================

const TaskRow = ({ expert, isActive, onClick }: {
	expert: ExpertState;
	isActive: boolean;
	onClick: () => void;
}) => {
	const badge = STATUS_BADGE[expert.status];
	const lastMsg = expert.messages.filter(m => m.role === 'assistant').slice(-1)[0];
	const preview = lastMsg?.content?.split('\n')?.find(l => l.trim())?.slice(0, 52) ?? '';

	return (
		<div
			onClick={onClick}
			className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-loophole-border-4
				${isActive ? 'bg-loophole-bg-1' : 'hover:bg-loophole-bg-1/50'}`}
		>
			<div className="relative flex-shrink-0 mt-0.5">
				<Avatar id={expert.id} name={expert.name} size={32} />
				<span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-loophole-bg-2 ${STATUS_DOT[expert.status]}`} />
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between gap-2 mb-0.5">
					<span className="text-xs font-semibold text-loophole-fg-1 truncate">{expert.name}</span>
					<span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${badge.cls}`}>
						{badge.label}
					</span>
				</div>
				<div className="text-[10px] text-loophole-fg-4 truncate">{expert.role}</div>
				{preview && (
					<div className="text-[10px] text-loophole-fg-3 truncate mt-0.5">{preview}</div>
				)}
				{expert.status === 'skipped' && expert.skipReason && (
					<div className="text-[10px] text-loophole-fg-4 opacity-70 truncate mt-0.5" title={expert.skipReason}>
						{expert.skipReason}
					</div>
				)}
			</div>
		</div>
	);
};

const LeftPanel = ({ experts, activeId, onSelect, progress }: {
	experts: ExpertState[];
	activeId: string | null;
	onSelect: (id: string) => void;
	progress: number;
}) => {
	const done    = experts.filter(e => e.status === 'done').length;
	const working = experts.filter(e => e.status === 'working').length;
	const idle    = experts.filter(e => e.status === 'idle').length;
	const failed  = experts.filter(e => e.status === 'failed').length;
	const skipped = experts.filter(e => e.status === 'skipped').length;

	return (
		<div className="flex flex-col flex-shrink-0 border-r border-loophole-border-4 bg-loophole-bg-2"
			style={{ width: '220px', minWidth: '220px' }}>

			<div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-loophole-border-4">
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-semibold text-loophole-fg-1">Agent Canvas</span>
					<span className="text-[10px] text-loophole-fg-4">{experts.length} experts</span>
				</div>

				{/* Progress counts only experts that were actually asked to do
				    something. Counting skipped experts would cap the bar below
				    100% for any goal that did not need everyone. */}
				<div className="mb-2">
					<div className="flex items-center justify-between mb-1">
						<span className="text-[10px] text-loophole-fg-4">Progress</span>
						<span className="text-[10px] text-loophole-fg-3 font-medium">{progress}%</span>
					</div>
					<div className="h-1 bg-loophole-bg-1 rounded-full overflow-hidden">
						<div
							className="h-full bg-green-500 rounded-full transition-all duration-500"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-x-3 gap-y-1">
					{[
						{ label: 'Completed',   val: done,    cls: 'text-green-400'  },
						{ label: 'In Progress', val: working, cls: 'text-yellow-400' },
						{ label: 'Queued',      val: idle,    cls: 'text-loophole-fg-4' },
						{ label: 'Skipped',     val: skipped, cls: 'text-loophole-fg-4' },
						{ label: 'Failed',      val: failed,  cls: 'text-red-400'    },
					].filter(s => s.val > 0 || s.label === 'Completed' || s.label === 'In Progress').map(({ label, val, cls }) => (
						<div key={label}>
							<div className={`text-sm font-semibold ${cls}`}>{val}</div>
							<div className="text-[10px] text-loophole-fg-4">{label}</div>
						</div>
					))}
				</div>
			</div>

			<div className="flex-shrink-0 px-3 py-2 border-b border-loophole-border-4">
				<span className="text-[10px] text-loophole-fg-4 uppercase tracking-wide font-medium">
					Tasks {experts.length}
				</span>
			</div>

			<div className="flex-1 overflow-y-auto">
				{experts.map(expert => (
					<TaskRow
						key={expert.id}
						expert={expert}
						isActive={activeId === expert.id}
						onClick={() => onSelect(expert.id)}
					/>
				))}
			</div>
		</div>
	);
};

// ============================================================
// Tool activity + messages
// ============================================================

const TOOL_STATUS_CLS: Record<string, string> = {
	'pending':          'text-loophole-fg-4',
	'awaiting-approval': 'text-yellow-400',
	'running':          'text-loophole-fg-3',
	'success':          'text-green-400',
	'rejected':         'text-red-400',
	'error':            'text-red-400',
};

const ToolActivityList = ({ activity }: { activity: { id: string, toolName: string, title: string, status: string }[] }) => {
	if (activity.length === 0) return null;
	return (
		<div className="space-y-0.5 py-1.5 border-y border-loophole-border-4">
			{activity.map(t => (
				<div key={t.id} className="flex items-center gap-1.5">
					<span className={`text-[9px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${
						t.status === 'success' ? 'bg-green-400'
							: t.status === 'error' || t.status === 'rejected' ? 'bg-red-400'
								: t.status === 'awaiting-approval' ? 'bg-yellow-400 animate-pulse'
									: 'bg-loophole-fg-4'
					}`} />
					<span className={`text-[10px] truncate ${TOOL_STATUS_CLS[t.status] ?? ''}`} title={t.title}>
						{toolDisplayName(t.toolName)}
						{t.status === 'awaiting-approval' && ' — waiting for you'}
						{t.status === 'rejected' && ' — denied'}
					</span>
				</div>
			))}
		</div>
	);
};

const MessageBubble = ({ msg }: { msg: ExpertMessage }) => {
	const isUser = msg.role === 'user';
	return (
		<div className={`text-xs leading-relaxed ${isUser ? 'text-loophole-fg-4' : 'text-loophole-fg-1'}`}>
			{isUser && (
				<div className="text-[10px] text-loophole-fg-4 uppercase tracking-wide mb-0.5 font-medium">Task</div>
			)}
			<span className="whitespace-pre-wrap break-words">{msg.content}</span>
			{msg.isStreaming && (
				<span className="inline-block w-[2px] h-3 ml-0.5 bg-loophole-fg-3 animate-pulse align-middle rounded-full" />
			)}
		</div>
	);
};

const AgentColumn = ({ expert, isActive, toolActivities }: {
	expert: ExpertState;
	isActive: boolean;
	toolActivities: { id: string, toolName: string, title: string, status: string }[];
}) => {
	const bottomRef = useRef<HTMLDivElement>(null);
	const configService = useAccessor().get('IConfigurationService');

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [expert.messages.length, expert.messages[expert.messages.length - 1]?.content]);

	const badge = STATUS_BADGE[expert.status];
	const myTools = useMemo(
		() => toolActivities.filter(t => t.expertId === expert.id),
		[toolActivities, expert.id],
	);

	return (
		<div
			className={`flex flex-col flex-shrink-0 h-full border-r border-loophole-border-4 last:border-r-0 transition-colors
				${isActive ? 'bg-loophole-bg-1' : 'bg-loophole-bg-2'}`}
			style={{ width: '260px', minWidth: '260px' }}
		>
			<div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-loophole-border-4">
				<Avatar id={expert.id} name={expert.name} size={28} />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5 mb-0.5">
						<span className="text-xs font-semibold text-loophole-fg-1 truncate">{expert.name}</span>
						<span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
					</div>
					<div className="text-[10px] text-loophole-fg-4 truncate">{expert.role}</div>
				</div>
				{expert.status === 'working' && (
					<div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
				)}
			</div>

			<div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
				{expert.messages.length === 0 && myTools.length === 0 ? (
					<div className="text-[10px] text-loophole-fg-4 mt-2 select-none">
						{expert.status === 'skipped'
							? (expert.skipReason ?? 'Not needed for this goal.')
							: expert.status === 'idle' ? 'Waiting...' : 'Starting...'}
					</div>
				) : (
					<>
						<Messages messages={expert.messages} />
						<ToolActivityList activity={myTools} />
					</>
				)}
				<div ref={bottomRef} />
			</div>

			<div className="flex-shrink-0 px-3 py-1.5 border-t border-loophole-border-4">
				<span className="text-[10px] text-loophole-fg-4">
					{modelLabel(expertModelRef(configService, expert.id))}
				</span>
			</div>
		</div>
	);
};

/**
 * Collapses consecutive assistant messages. Without the agent loop an expert
 * produced one message; now each tool round adds another, and rendering the
 * tool-instrumented chatter as separate paragraphs made every transcript
 * harder to read.
 */
const Messages = ({ messages }: { messages: ExpertMessage[] }) => {
	const collapsed: { role: 'user' | 'assistant', content: string, isStreaming: boolean }[] = [];
	for (const m of messages) {
		const last = collapsed[collapsed.length - 1];
		if (last && m.role === 'assistant' && last.role === 'assistant') {
			last.content = `${last.content}\n\n${m.content}`.trim();
			last.isStreaming = m.isStreaming;
		} else {
			collapsed.push({ role: m.role, content: m.content, isStreaming: m.isStreaming });
		}
	}
	return (
		<>
			{collapsed.map((m, i) => <MessageBubble key={i} msg={m} />)}
		</>
	);
};

// ============================================================
// Empty state
// ============================================================
const EmptyState = () => (
	<div className="flex-1 flex flex-col items-center justify-center select-none">
		<div className="text-xs text-loophole-fg-4 mb-1">Expert Canvas</div>
		<div className="text-[10px] text-loophole-fg-4">Start a task from the Expert panel on the left.</div>
	</div>
);

// ============================================================
// Main page
// ============================================================
export const ExpertCanvasPage = () => {
	const isDark = useIsDark();
	const [state, setState] = useState(() => expertCanvasStore.getState());
	const [toolActivities, setToolActivities] = useState(() => expertCanvasStore.getToolActivities());
	const [activeExpertId, setActiveExpertId] = useState<string | null>(null);

	useEffect(() => {
		return expertCanvasStore.subscribe(() => {
			setState({ ...expertCanvasStore.getState() });
			setToolActivities([...expertCanvasStore.getToolActivities()]);
		});
	}, []);

	const { experts, currentGoal } = state;
	// Show every column that has started, not just those with text, so an
	// expert that is mid-tool-call is visible.
	const hasActivity = experts.some(e => e.messages.length > 0 || e.status === 'working');

	// Progress over the experts that were actually asked to work, so a goal
	// that legitimately skipped half the team can still reach 100%.
	const engaged = experts.filter(e => e.status !== 'skipped');
	const done = engaged.filter(e => e.status === 'done').length;
	const progress = engaged.length > 0 ? Math.round((done / engaged.length) * 100) : 0;

	useEffect(() => {
		if (activeExpertId) return;
		const working = experts.find(e => e.status === 'working');
		if (working) setActiveExpertId(working.id);
	}, [experts, activeExpertId]);

	return (
		<div className={`@@loophole-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%' }}>
			<div className="w-full h-full flex overflow-hidden bg-loophole-bg-2">

				<LeftPanel
					experts={experts}
					activeId={activeExpertId}
					onSelect={setActiveExpertId}
					progress={progress}
				/>

				{hasActivity ? (
					<div className="flex-1 flex overflow-x-auto overflow-y-hidden">
						{experts.filter(e => e.messages.length > 0 || e.status === 'working').map(expert => (
							<AgentColumn
								key={expert.id}
								expert={expert}
								isActive={activeExpertId === expert.id}
								toolActivities={toolActivities}
							/>
						))}
					</div>
				) : (
					<EmptyState />
				)}

			</div>
			{currentGoal && <div className="hidden" data-goal={currentGoal} />}
		</div>
	);
};
