/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Generic tool-call cards. Mirrors the shape of the compact BasicTool cards in
// other clients (compact header: status icon + title + prominent arg, chevron
// expand/collapse, muted border, monospace code body). Special cases:
// edit/write (file path + diff-ish snippet), bash/terminal (command string),
// search/web (query or url); everything else falls back to formatted JSON.
//
// Tool results must never spill into the transcript: the card auto-collapses
// as soon as the call finishes and the result body lives in its own collapsible
// section with a summary line and a scrollable, wrapping code block.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import type { CliCompactionState, CliToolState } from '../../../../../common/sendLLMMessageTypes.js';

// The transport caps stored text at 20k; rendering much less keeps the DOM
// small even when a stored block is still large.
const MAX_VISIBLE_CHARS = 8000;

const titleOfToolName = (name: string): string => {
	const n = name.toLowerCase();
	if (n === 'read') return 'Read file';
	if (n === 'edit') return 'Edit file';
	if (n === 'write') return 'Write file';
	if (n === 'bash' || n === 'terminal' || n === 'shell') return 'Run command';
	if (n === 'grep' || n === 'search') return 'Search';
	if (n === 'glob') return 'Find files';
	if (n === 'list') return 'List directory';
	if (n === 'webfetch' || n === 'fetch') return 'Fetch web page';
	if (n === 'websearch') return 'Web search';
	if (n === 'task') return 'Run subagent';
	if (n === 'todowrite' || n === 'todoread') return 'Todos';
	return name || 'Tool';
};

const basenameOf = (p: string): string => {
	const parts = p.replace(/[/\\]+/g, '/').split('/').filter((s) => s.length > 0);
	return parts.length > 0 ? parts[parts.length - 1] : p;
};

const stringOf = (input: Record<string, unknown>, keys: string[]): string | undefined => {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === 'string' && value.length > 0) return value;
	}
	return undefined;
};

// The one short arg shown beside the title: file, command, query or url.
const subtitleOf = (tool: CliToolState): string => {
	const input = tool.input;
	if (!input) return '';
	const path = stringOf(input, ['filePath', 'file_path', 'path', 'uri', 'filename', 'file', 'target']);
	if (path) return basenameOf(path);
	const command = stringOf(input, ['command', 'cmd']);
	if (command) return `"${command.length > 60 ? command.slice(0, 57) + '…' : command}"`;
	const query = stringOf(input, ['query', 'pattern', 'search']);
	if (query) return `"${query.length > 60 ? query.slice(0, 57) + '…' : query}"`;
	const url = stringOf(input, ['url']);
	if (url) return url.length > 60 ? url.slice(0, 57) + '…' : url;
	return '';
};

const truncate = (text: string, max: number): { text: string; truncated: boolean } => {
	if (text.length <= max) return { text, truncated: false };
	return { text: text.slice(0, max), truncated: true };
};

const lineCountOf = (text: string): number => text.length === 0 ? 0 : text.split('\n').length;

const firstLineOf = (text: string, max = 120): string => {
	const line = text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// "3 lines · 1.2k chars": a compact summary that says how big the result is.
const sizeOfText = (text: string): string => {
	const chars = text.length;
	const lines = lineCountOf(text);
	const charsLabel = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : `${chars}`;
	return `${lines} line${lines === 1 ? '' : 's'} · ${charsLabel} chars`;
};

const summaryOfText = (text: string): string => {
	const first = firstLineOf(text);
	const size = sizeOfText(text);
	return first ? `${first} · ${size}` : size;
};

const CodeBlock = ({ children }: { children: React.ReactNode }) => {
	return <pre className='font-mono whitespace-pre-wrap break-words text-xs text-loophole-fg-2 bg-loophole-bg-1 rounded p-1.5 overflow-auto max-h-[220px] select-text'>{children}</pre>;
};

// A labelled, collapsible inner block. Children are not mounted while closed,
// so a very large result never sits in the DOM unless the user opens it.
const Section = ({ label, summary, defaultOpen, icon, children }: {
	label: string;
	summary?: string;
	defaultOpen?: boolean;
	icon?: React.ReactNode;
	children: React.ReactNode;
}) => {
	const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
	return <div className='border border-loophole-border-3 rounded overflow-hidden min-w-0'>
		<div className='select-none flex items-center min-h-[20px] min-w-0 px-1 cursor-pointer' onClick={() => setIsOpen(v => !v)}>
			<ChevronRight className={`text-loophole-fg-4 mr-0.5 h-3 w-3 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />
			{icon}
			<span className='text-[10px] uppercase tracking-wide text-loophole-fg-4 flex-shrink-0'>{label}</span>
			{summary && <span className='text-loophole-fg-4 text-[10px] truncate ml-2 min-w-0'>{summary}</span>}
		</div>
		{isOpen && <div className='px-1 pb-1 min-w-0'>{children}</div>}
	</div>;
};

const InputBody = ({ tool, running }: { tool: CliToolState; running: boolean }) => {
	const input = tool.input;
	if (!input && !tool.inputText) return null;
	const snippet = input ? stringOf(input, ['newString', 'new_string', 'newContent', 'content', 'edit', 'diff', 'oldString', 'newText']) : undefined;
	const raw = !input
		? (tool.inputText ?? '')
		: (snippet ?? JSON.stringify(input, null, 2));
	const { text, truncated } = truncate(raw, MAX_VISIBLE_CHARS);
	return <Section label='Input' summary={summaryOfText(raw)} defaultOpen={running}>
		<CodeBlock>{text}{truncated ? '\n… (truncated)' : ''}</CodeBlock>
	</Section>;
};

const OutputBody = ({ tool, running }: { tool: CliToolState; running: boolean }) => {
	const raw = tool.outputText ?? '';
	if (!raw) return null;
	const { text, truncated } = truncate(raw, MAX_VISIBLE_CHARS);
	return <Section label='Output' summary={summaryOfText(raw)} defaultOpen={running}>
		<CodeBlock>{text}{truncated ? '\n… (truncated)' : ''}</CodeBlock>
	</Section>;
};

const ErrorBody = ({ tool, running }: { tool: CliToolState; running: boolean }) => {
	const raw = tool.error ?? '';
	if (!raw) return null;
	const { text, truncated } = truncate(raw, MAX_VISIBLE_CHARS);
	return <Section
		label='Error'
		summary={summaryOfText(raw)}
		defaultOpen={running}
		icon={<AlertTriangle size={11} className='text-loophole-warning flex-shrink-0 mr-1' />}
	>
		<CodeBlock>{text}{truncated ? '\n… (truncated)' : ''}</CodeBlock>
	</Section>;
};

const StatusIcon = ({ status }: { status: CliToolState['status'] }) => {
	if (status === 'done') return <Check size={13} className='text-emerald-500 flex-shrink-0' />;
	if (status === 'error') return <AlertTriangle size={13} className='text-loophole-warning flex-shrink-0' />;
	return <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />;
};

export const ToolCard = ({ tool }: { tool: CliToolState }) => {
	const running = tool.status === 'running' || tool.status === 'input';
	// Expanded while the call runs, collapsed once it finishes so its result
	// cannot push the transcript around.
	const [isOpen, setIsOpen] = useState(running);
	const wasRunning = useRef(running);
	useEffect(() => {
		if (wasRunning.current === running) return;
		wasRunning.current = running;
		setIsOpen(running);
	}, [running]);

	const title = titleOfToolName(tool.name);
	const subtitle = subtitleOf(tool);
	const hasBody = !!tool.input || !!tool.inputText || !!tool.outputText || !!tool.error;
	const resultText = tool.outputText ?? tool.error ?? '';
	const resultSummary = resultText ? summaryOfText(resultText) : '';
	return <div className='w-full min-w-0 border border-loophole-border-3 rounded px-2 py-1 bg-loophole-bg-3 overflow-hidden'>
		<div className={`select-none flex items-center min-h-[24px] min-w-0 ${hasBody ? 'cursor-pointer' : ''}`} onClick={hasBody ? () => setIsOpen(v => !v) : undefined}>
			{hasBody && <ChevronRight className={`text-loophole-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />}
			<StatusIcon status={tool.status} />
			<span className='text-loophole-fg-3 text-xs ml-1.5 flex-shrink-0'>{title}</span>
			{subtitle && <span className='text-loophole-fg-4 text-xs italic truncate ml-2'>{subtitle}</span>}
			{!isOpen && resultSummary && <span className='text-loophole-fg-4 text-xs truncate ml-2 min-w-0'>{resultSummary}</span>}
		</div>
		{hasBody && <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}`}>
			<div className='flex flex-col gap-1.5 px-1 min-w-0'>
				<InputBody tool={tool} running={running} />
				<OutputBody tool={tool} running={running} />
				<ErrorBody tool={tool} running={running} />
			</div>
		</div>}
	</div>;
};

// Compact banner for session.compaction.* (context compaction). Text is the
// summary stream; empty until the server emits it.
export const CompactionBanner = ({ compaction }: { compaction: CliCompactionState }) => {
	const [isOpen, setIsOpen] = useState(compaction.phase === 'streaming');
	const { text, truncated } = truncate(compaction.text ?? '', MAX_VISIBLE_CHARS);
	const label = compaction.phase === 'failed' ? 'Compaction failed'
		: compaction.phase === 'done' ? 'Context compacted'
			: 'Compacting context…';
	const failed = compaction.phase === 'failed';
	const done = compaction.phase === 'done';
	return <div className='w-full min-w-0 border border-loophole-border-3 rounded px-2 py-1 bg-loophole-bg-3 overflow-hidden'>
		<div className='select-none flex items-center min-h-[24px] cursor-pointer' onClick={() => setIsOpen(v => !v)}>
			<ChevronRight className={`text-loophole-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />
			{failed
				? <AlertTriangle size={13} className='text-loophole-warning flex-shrink-0' />
				: done
					? <Check size={13} className='text-emerald-500 flex-shrink-0' />
					: <RefreshCw size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />}
			<span className='text-loophole-fg-3 text-xs ml-1.5'>{label}</span>
			{compaction.reason && <span className='text-loophole-fg-4 text-xs italic ml-2'>({compaction.reason})</span>}
		</div>
		<div className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}`}>
			<div className='flex flex-col gap-1.5 px-1 min-w-0'>
				{text && <CodeBlock>{text}{truncated ? '\n… (truncated)' : ''}</CodeBlock>}
				{compaction.error && <CodeBlock>{compaction.error}</CodeBlock>}
			</div>
		</div>
	</div>;
};
