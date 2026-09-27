/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react';
import '../styles.css';
import { useIsDark } from '../util/services.js';
import { expertCanvasStore, type ExpertState, type ExpertMessage } from './expertCanvasStore.js';

// ---- Avatars ----
import saraAvatar  from './avatars/sara.png';
import leoAvatar   from './avatars/leo.png';
import karlAvatar  from './avatars/karl.png';
import jakeAvatar  from './avatars/jake.png';
import rayAvatar   from './avatars/ray.png';
import noraAvatar  from './avatars/nora.png';
import elenaAvatar from './avatars/elena.png';
import maxAvatar   from './avatars/max.png';

const EXPERT_AVATARS: Record<string, string> = {
	sara: saraAvatar, leo: leoAvatar, karl: karlAvatar, jake: jakeAvatar,
	ray: rayAvatar, nora: noraAvatar, elena: elenaAvatar, max: maxAvatar,
};

// ---- Status badge ----
type StatusType = ExpertState['status'];

const STATUS_BADGE: Record<StatusType, { label: string; cls: string }> = {
	idle:    { label: 'Pending',     cls: 'text-loophole-fg-4 border border-loophole-border-3' },
	working: { label: 'In Progress', cls: 'text-yellow-400 border border-yellow-400/40' },
	done:    { label: 'Completed',   cls: 'text-green-400 border border-green-400/40' },
	failed:  { label: 'Failed',      cls: 'text-red-400 border border-red-400/40' },
};

const STATUS_DOT: Record<StatusType, string> = {
	idle:    'bg-loophole-fg-4',
	working: 'bg-yellow-400 animate-pulse',
	done:    'bg-green-400',
	failed:  'bg-red-400',
};

// ---- Avatar component ----
const Avatar = ({ id, name, size = 32 }: { id: string; name: string; size?: number }) => (
	<img
		src={EXPERT_AVATARS[id] ?? ''}
		alt={name}
		width={size}
		height={size}
		className="rounded-md flex-shrink-0"
		style={{ imageRendering: 'pixelated', width: size, height: size }}
	/>
);

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
	const preview = lastMsg?.content?.split('\n')[0]?.slice(0, 52) ?? '';

	return (
		<div
			onClick={onClick}
			className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-loophole-border-4
				${isActive ? 'bg-loophole-bg-1' : 'hover:bg-loophole-bg-1/50'}`}
		>
			{/* Avatar with status dot */}
			<div className="relative flex-shrink-0 mt-0.5">
				<Avatar id={expert.id} name={expert.name} size={32} />
				<span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-loophole-bg-2 ${STATUS_DOT[expert.status]}`} />
			</div>

			{/* Content */}
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
			</div>
		</div>
	);
};

const LeftPanel = ({ experts, activeId, onSelect, goal, progress }: {
	experts: ExpertState[];
	activeId: string | null;
	onSelect: (id: string) => void;
	goal: string;
	progress: number;
}) => {
	const done    = experts.filter(e => e.status === 'done').length;
	const working = experts.filter(e => e.status === 'working').length;
	const idle    = experts.filter(e => e.status === 'idle').length;
	const failed  = experts.filter(e => e.status === 'failed').length;

	return (
		<div className="flex flex-col flex-shrink-0 border-r border-loophole-border-4 bg-loophole-bg-2"
			style={{ width: '220px', minWidth: '220px' }}>

			{/* Panel header */}
			<div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-loophole-border-4">
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-semibold text-loophole-fg-1">Agent Canvas</span>
					<span className="text-[10px] text-loophole-fg-4">{experts.length} experts</span>
				</div>

				{/* Progress bar */}
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

				{/* Stats row */}
				<div className="grid grid-cols-2 gap-x-3 gap-y-1">
					{[
						{ label: 'Completed',   val: done,    cls: 'text-green-400'  },
						{ label: 'In Progress', val: working, cls: 'text-yellow-400' },
						{ label: 'Pending',     val: idle,    cls: 'text-loophole-fg-4' },
						{ label: 'Failed',      val: failed,  cls: 'text-red-400'    },
					].map(({ label, val, cls }) => (
						<div key={label}>
							<div className={`text-sm font-semibold ${cls}`}>{val}</div>
							<div className="text-[10px] text-loophole-fg-4">{label}</div>
						</div>
					))}
				</div>
			</div>

			{/* Task count */}
			<div className="flex-shrink-0 px-3 py-2 border-b border-loophole-border-4">
				<span className="text-[10px] text-loophole-fg-4 uppercase tracking-wide font-medium">
					Tasks {experts.length}
				</span>
			</div>

			{/* Task list */}
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
// RIGHT AREA — Parallel agent columns
// ============================================================

const MessageBubble = ({ msg }: { msg: ExpertMessage }) => {
	const isUser = msg.role === 'user';
	return (
		<div className={`text-xs leading-relaxed ${isUser ? 'text-loophole-fg-4' : 'text-loophole-fg-1'}`}>
			{isUser && (
				<div className="text-[10px] text-loophole-fg-4 uppercase tracking-wide mb-0.5 font-medium">Goal</div>
			)}
			<span className="whitespace-pre-wrap break-words">{msg.content}</span>
			{msg.isStreaming && (
				<span className="inline-block w-[2px] h-3 ml-0.5 bg-loophole-fg-3 animate-pulse align-middle rounded-full" />
			)}
		</div>
	);
};

const AgentColumn = ({ expert, isActive }: { expert: ExpertState; isActive: boolean }) => {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [expert.messages.length, expert.messages[expert.messages.length - 1]?.content]);

	const badge = STATUS_BADGE[expert.status];

	return (
		<div
			className={`flex flex-col flex-shrink-0 h-full border-r border-loophole-border-4 last:border-r-0 transition-colors
				${isActive ? 'bg-loophole-bg-1' : 'bg-loophole-bg-2'}`}
			style={{ width: '260px', minWidth: '260px' }}
		>
			{/* Column header */}
			<div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-loophole-border-4">
				<Avatar id={expert.id} name={expert.name} size={28} />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-1.5 mb-0.5">
						<span className="text-xs font-semibold text-loophole-fg-1 truncate">{expert.name}</span>
						<span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
					</div>
					<div className="text-[10px] text-loophole-fg-4 truncate">{expert.role}</div>
				</div>
				{/* working indicator */}
				{expert.status === 'working' && (
					<div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
				)}
			</div>

			{/* Messages */}
			<div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
				{expert.messages.length === 0 ? (
					<div className="text-[10px] text-loophole-fg-4 mt-2 select-none">
						{expert.status === 'idle' ? 'Waiting...' : 'Starting...'}
					</div>
				) : (
					expert.messages.map((msg, i) => (
						<MessageBubble key={i} msg={msg} />
					))
				)}
				<div ref={bottomRef} />
			</div>

			{/* Footer */}
			<div className="flex-shrink-0 px-3 py-1.5 border-t border-loophole-border-4">
				<span className="text-[10px] text-loophole-fg-4">{expert.model}</span>
			</div>
		</div>
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
	const [activeExpertId, setActiveExpertId] = useState<string | null>(null);

	useEffect(() => {
		return expertCanvasStore.subscribe(() => setState({ ...expertCanvasStore.getState() }));
	}, []);

	const { experts, currentGoal } = state;
	const hasActivity = experts.some(e => e.messages.length > 0);

	// Progress = done / total * 100
	const done = experts.filter(e => e.status === 'done').length;
	const progress = experts.length > 0 ? Math.round((done / experts.length) * 100) : 0;

	// Auto-select the first working expert
	useEffect(() => {
		if (activeExpertId) return;
		const working = experts.find(e => e.status === 'working');
		if (working) setActiveExpertId(working.id);
	}, [experts, activeExpertId]);

	return (
		<div className={`@@loophole-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%' }}>
			<div className="w-full h-full flex overflow-hidden bg-loophole-bg-2">

				{/* Left task list panel */}
				<LeftPanel
					experts={experts}
					activeId={activeExpertId}
					onSelect={setActiveExpertId}
					goal={currentGoal}
					progress={progress}
				/>

				{/* Right: parallel columns */}
				{hasActivity ? (
					<div className="flex-1 flex overflow-x-auto overflow-y-hidden">
						{experts.filter(e => e.messages.length > 0).map(expert => (
							<AgentColumn
								key={expert.id}
								expert={expert}
								isActive={activeExpertId === expert.id}
							/>
						))}
					</div>
				) : (
					<EmptyState />
				)}

			</div>
		</div>
	);
};
