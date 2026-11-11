/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Kilo-style generic tool-call cards. Mirrors the shape of Kilo's BasicTool
// cards (compact header: status icon + title + prominent arg, chevron
// expand/collapse, muted border, monospace code body) without importing Kilo
// code — re-implemented with Void's existing Tailwind classes. Special cases:
// edit/write (file path + diff-ish snippet), bash/terminal (command string),
// search/web (query or url); everything else falls back to formatted JSON.
import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import type { CliCompactionState, CliToolState } from '../../../../../common/sendLLMMessageTypes.js';

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

// The one short arg Kilo shows beside the title: file, command, query or url.
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

const CodeBlock = ({ children }: { children: React.ReactNode }) => {
	return <pre className='font-mono whitespace-pre-wrap break-words text-xs text-loophole-fg-2 bg-loophole-bg-1 rounded p-1.5 overflow-auto max-h-[300px] select-text'>{children}</pre>;
};

const InputBody = ({ tool }: { tool: CliToolState }) => {
	const input = tool.input;
	if (!input && !tool.inputText) return null;
	if (!input) {
		// Still receiving input fragments (ephemeral deltas): show the raw text.
		const { text, truncated } = truncate(tool.inputText ?? '', 2000);
		return <div>
			<div className='text-[10px] uppercase tracking-wide text-loophole-fg-4 px-1'>Input</div>
			<CodeBlock>{text}{truncated ? '\n… (truncated)' : ''}</CodeBlock>
		</div>;
	}
	const snippet = stringOf(input, ['newString', 'new_string', 'newContent', 'content', 'edit', 'diff', 'oldString', 'newText']);
	const { text: json, truncated: jsonTruncated } = truncate(JSON.stringify(input, null, 2), 2000);
	// For edit/write, prefer the snippet as the primary view (Kilo shows the diff);
	// the full arg JSON stays available inside the same code block when short.
	const { text: snippetText, truncated: snippetTruncated } = snippet ? truncate(snippet, 1500) : { text: '', truncated: false };
	return <div>
		<div className='text-[10px] uppercase tracking-wide text-loophole-fg-4 px-1'>Input</div>
		<CodeBlock>{snippet ? `${snippetText}${snippetTruncated ? '\n… (truncated)' : ''}` : `${json}${jsonTruncated ? '\n… (truncated)' : ''}`}</CodeBlock>
	</div>;
};

const OutputBody = ({ tool }: { tool: CliToolState }) => {
	const { text, truncated } = truncate(tool.outputText ?? '', 3000);
	if (!tool.outputText) return null;
	return <div>
		<div className='text-[10px] uppercase tracking-wide text-loophole-fg-4 px-1'>Output</div>
		<CodeBlock>{text}{truncated ? '\n… (truncated)' : ''}</CodeBlock>
	</div>;
};

const StatusIcon = ({ status }: { status: CliToolState['status'] }) => {
	if (status === 'done') return <Check size={13} className='text-emerald-500 flex-shrink-0' />;
	if (status === 'error') return <AlertTriangle size={13} className='text-loophole-warning flex-shrink-0' />;
	return <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />;
};

export const ToolCard = ({ tool }: { tool: CliToolState }) => {
	const running = tool.status === 'running' || tool.status === 'input';
	const [isOpen, setIsOpen] = useState(running);
	const title = titleOfToolName(tool.name);
	const subtitle = subtitleOf(tool);
	const hasBody = !!tool.input || !!tool.inputText || !!tool.outputText || !!tool.error;
	return <div className='w-full border border-loophole-border-3 rounded px-2 py-1 bg-loophole-bg-3 overflow-hidden'>
		<div className={`select-none flex items-center min-h-[24px] min-w-0 ${hasBody ? 'cursor-pointer' : ''}`} onClick={hasBody ? () => setIsOpen(v => !v) : undefined}>
			{hasBody && <ChevronRight className={`text-loophole-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />}
			<StatusIcon status={tool.status} />
			<span className='text-loophole-fg-3 text-xs ml-1.5 flex-shrink-0'>{title}</span>
			{subtitle && <span className='text-loophole-fg-4 text-xs italic truncate ml-2'>{subtitle}</span>}
		</div>
		{hasBody && <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}`}>
			<div className='flex flex-col gap-1.5 px-1'>
				<InputBody tool={tool} />
				<OutputBody tool={tool} />
				{tool.error && <div>
					<div className='text-[10px] uppercase tracking-wide text-loophole-fg-4 px-1'>Error</div>
					<CodeBlock>{tool.error}</CodeBlock>
				</div>}
			</div>
		</div>}
	</div>;
};

// Compact banner for session.compaction.* (context compaction). Text is the
// summary stream; empty until the server emits it.
export const CompactionBanner = ({ compaction }: { compaction: CliCompactionState }) => {
	const [isOpen, setIsOpen] = useState(compaction.phase === 'streaming');
	const { text, truncated } = truncate(compaction.text ?? '', 3000);
	const label = compaction.phase === 'failed' ? 'Compaction failed'
		: compaction.phase === 'done' ? 'Context compacted'
			: 'Compacting context…';
	const failed = compaction.phase === 'failed';
	const done = compaction.phase === 'done';
	return <div className='w-full border border-loophole-border-3 rounded px-2 py-1 bg-loophole-bg-3 overflow-hidden'>
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
			<div className='flex flex-col gap-1.5 px-1'>
				{text && <CodeBlock>{text}{truncated ? '\n… (truncated)' : ''}</CodeBlock>}
				{compaction.error && <CodeBlock>{compaction.error}</CodeBlock>}
			</div>
		</div>
	</div>;
};
