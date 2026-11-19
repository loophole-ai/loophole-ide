/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, Check, ChevronRight, ExternalLink, FilePlus, FileText, Loader2, RefreshCw } from 'lucide-react';
import type { CliCompactionState, CliToolState, CliToolStatus } from '../../../../../common/sendLLMMessageTypes.js';
import { splitPath } from './toolData.js';
import { FileLink, useAutoOpen, useOpenFile } from './toolUi.js';

// The transport caps stored text at 20k; rendering much less keeps the DOM
// small even when a stored block is still large.
export const MAX_VISIBLE_CHARS = 8000;

export const titleOfToolName = (name: string): string => {
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
	if (n === 'task' || n === 'subagent') return 'Run subagent';
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

export const truncate = (text: string, max: number): { text: string; truncated: boolean } => {
	if (text.length <= max) return { text, truncated: false };
	return { text: text.slice(0, max), truncated: true };
};

const lineCountOf = (text: string): number => text.length === 0 ? 0 : text.split('\n').length;

export const firstLineOf = (text: string, max = 120): string => {
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

export const summaryOfText = (text: string): string => {
	const first = firstLineOf(text);
	const size = sizeOfText(text);
	return first ? `${first} · ${size}` : size;
};

export const CodeBlock = ({ children }: { children: React.ReactNode }) => {
	return <pre className='font-mono whitespace-pre-wrap break-words text-xs text-loophole-fg-2 bg-loophole-bg-1 rounded p-1.5 overflow-auto max-h-[220px] select-text'>{children}</pre>;
};

// A labelled, collapsible inner block. Children are not mounted while closed,
// so a very large result never sits in the DOM unless the user opens it.
export const Section = ({ label, summary, defaultOpen, icon, children }: {
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

// File changes: plain green/red unified diff built from the CLI's own
// `metadata.files[]` ({ file, patch, additions, deletions }) — the editor's
// own look, no third-party diff component.
export type DiffRow =
	| { kind: 'hunk'; text: string }
	| { kind: 'add' | 'del' | 'ctx'; text: string; oldLine?: number; newLine?: number }
export const parsePatch = (patch: string): DiffRow[] => {
	const rows: DiffRow[] = [];
	let oldLine = 0;
	let newLine = 0;
	const ctx = (raw: string, o: number, n: number) => ({ kind: 'ctx' as const, text: raw.charAt(0) === ' ' ? raw.slice(1) : raw, oldLine: o, newLine: n });
	for (const raw of patch.split('\n')) {
		const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
		if (match) {
			oldLine = parseInt(match[1], 10);
			newLine = parseInt(match[2], 10);
			rows.push({ kind: 'hunk', text: raw.replace(/^@@[^@]*@@\s*/, '').trim() || `Line ${newLine}` });
			continue;
		}
		if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('new file') || raw.startsWith('deleted file') || raw.startsWith('rename ') || raw === '') continue;
		const sign = raw.charAt(0);
		const text = raw.slice(1);
		if (sign === '+') {
			rows.push({ kind: 'add', text, newLine: newLine++ });
		} else if (sign === '-') {
			rows.push({ kind: 'del', text, oldLine: oldLine++ });
		} else {
			rows.push(ctx(raw, oldLine, newLine));
			oldLine++;
			newLine++;
		}
	}
	return rows;
};

const stripAbbreviatedPath = (path: string) => {
	const trimmed = path.replace(/\\/g, '/');
	const parts = trimmed.split('/');
	return parts.length > 2 ? parts.slice(-2).join('/') : trimmed;
};

export const DiffRows = ({ rows, showLineNumbers = true, onLineClick }: { rows: DiffRow[]; showLineNumbers?: boolean; onLineClick?: (line: number) => void }) => {
	return <>
		{rows.map((row, i) => {
			if (row.kind === 'hunk') {
				return <div key={i} className='px-2 py-0.5 bg-loophole-bg-2 text-loophole-fg-4 whitespace-pre-wrap'>{row.text}</div>;
			}
			const gutter = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' ';
			return <div key={i} className={`flex border-l-2 ${row.kind === 'add' ? 'bg-[rgba(52,211,153,0.18)] text-[#4ade80] border-[#22c55e]' : row.kind === 'del' ? 'bg-[rgba(248,113,113,0.18)] text-[#ff7b86] border-[#ef4444]' : 'text-loophole-fg-3 border-transparent'} whitespace-pre-wrap break-all`}>
				{showLineNumbers && <>
					<span className='w-7 flex-shrink-0 text-right px-1 select-none text-loophole-fg-4'>{row.oldLine ?? ''}</span>
					<span
						className={`w-7 flex-shrink-0 text-right px-1 select-none text-loophole-fg-4 ${onLineClick && row.newLine !== undefined ? 'cursor-pointer hover:text-[var(--vscode-textLink-foreground)] hover:underline' : ''}`}
						onClick={onLineClick && row.newLine !== undefined ? () => onLineClick(row.newLine as number) : undefined}
					>{row.newLine ?? ''}</span>
				</>}
				<span className='w-4 flex-shrink-0 select-none text-center'>{gutter}</span>
				<span className='pr-2'>{row.text || ' '}</span>
			</div>;
		})}
	</>;
};

const FileDiffBlock = ({ file, patch, additions, deletions }: { file: string; patch: string; additions?: number; deletions?: number }) => {
	const [open, setOpen] = useState(true);
	const rows = React.useMemo(() => parsePatch(patch), [patch]);
	const add = typeof additions === 'number' ? additions : rows.filter(r => r.kind === 'add').length;
	const del = typeof deletions === 'number' ? deletions : rows.filter(r => r.kind === 'del').length;
	return <div className='border border-loophole-border-3 rounded overflow-hidden min-w-0'>
		<div className='flex select-none min-w-0 cursor-pointer items-center px-1 min-h-[22px]' onClick={() => setOpen(v => !v)}>
			<ChevronRight className={`text-loophole-fg-4 mr-0.5 h-3 w-3 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'rotate-90' : ''}`} />
			<span className='text-[11px] text-loophole-fg-3 font-mono truncate min-w-0 flex-1'>{stripAbbreviatedPath(file)}</span>
			<span className='text-[11px] font-mono flex-shrink-0'>
				{add > 0 && <span className='text-emerald-400'>+{add}</span>}
				{add > 0 && del > 0 && <span className='text-loophole-fg-4'> </span>}
				{del > 0 && <span className='text-red-400'>−{del}</span>}
			</span>
		</div>
		{open && <div className='max-h-[280px] overflow-auto border-t border-loophole-border-3 select-text font-mono text-[11px] leading-[1.4]'>
			<DiffRows rows={rows} />
		</div>}
	</div>;
};

const DiffBody = ({ tool, running }: { tool: CliToolState; running: boolean }) => {
	const files = (tool.metadata as { files?: unknown } | undefined)?.files;
	if (!Array.isArray(files)) return null;
	const entries = files
		.map((item) => item && typeof item === 'object' ? item as { file?: unknown; patch?: unknown; additions?: unknown; deletions?: unknown } : undefined)
		.filter((item): item is { file?: unknown; patch: string; additions?: unknown; deletions?: unknown } =>
			!!item && typeof item.patch === 'string' && item.patch.length > 0);
	if (entries.length === 0) return null;
	const name = (p: unknown) => typeof p === 'string' ? p : 'file';
	const add = entries.reduce((acc, entry) => acc + (typeof entry.additions === 'number' ? entry.additions : 0), 0);
	const del = entries.reduce((acc, entry) => acc + (typeof entry.deletions === 'number' ? entry.deletions : 0), 0);
	return <Section label='Changes' summary={`${entries.length} file${entries.length === 1 ? '' : 's'} · +${add} −${del}`} defaultOpen={running}>
		<div className='flex flex-col gap-1.5 min-w-0'>
			{entries.map((entry, index) => <FileDiffBlock
				key={index}
				file={name(entry.file)}
				patch={entry.patch}
				additions={typeof entry.additions === 'number' ? entry.additions : undefined}
				deletions={typeof entry.deletions === 'number' ? entry.deletions : undefined}
			/>)}
		</div>
	</Section>;
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

export const StatusIcon = ({ status }: { status: CliToolState['status'] }) => {
	if (status === 'done') return <Check size={13} className='text-emerald-500 flex-shrink-0' />;
	if (status === 'error') return <AlertTriangle size={13} className='text-loophole-warning flex-shrink-0' />;
	return <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />;
};

const GenericToolCard = ({ tool }: { tool: CliToolState }) => {
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
				<DiffBody tool={tool} running={running} />
				<InputBody tool={tool} running={running} />
				<OutputBody tool={tool} running={running} />
				<ErrorBody tool={tool} running={running} />
			</div>
		</div>}
	</div>;
};

type FileChange = {
	file: string;
	patch: string;
	additions?: number;
	deletions?: number;
	isNew: boolean;
	synthetic: boolean;
};

const FILE_CHANGE_TOOLS = new Set(['write', 'edit', 'patch', 'apply_patch', 'multiedit', 'multi_edit']);

export const isFileChangeTool = (name: string): boolean => FILE_CHANGE_TOOLS.has(name.toLowerCase());

const rawTextOf = (input: Record<string, unknown>, keys: string[]): string | undefined => {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === 'string') return value;
	}
	return undefined;
};

const linesOf = (text: string): string[] => {
	const normalized = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
	return normalized === '' ? [] : normalized.split('\n');
};

const patchFromTexts = (oldText: string, newText: string, label: string): string => {
	const oldLines = linesOf(oldText);
	const newLines = linesOf(newText);
	return [
		`@@ -1,${oldLines.length} +1,${newLines.length} @@ ${label}`,
		...oldLines.map((line) => `-${line}`),
		...newLines.map((line) => `+${line}`),
	].join('\n');
};

const PATCH_FILE_HEADER = /^\*\*\* (Update|Add|Delete|Move) File: (.+)$/;

const filesFromPatchText = (text: string): FileChange[] => {
	const files: FileChange[] = [];
	let current: { file: string; isNew: boolean; lines: string[] } | undefined;
	const flush = () => {
		if (current) files.push({ file: current.file, patch: current.lines.join('\n'), isNew: current.isNew, synthetic: true });
	};
	for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
		const header = PATCH_FILE_HEADER.exec(raw);
		if (header) {
			flush();
			current = { file: header[2].trim(), isNew: header[1] === 'Add', lines: ['@@ -1,0 +1,0 @@ Changing'] };
			continue;
		}
		if (!current || raw.startsWith('*** ') || raw.startsWith('@@')) continue;
		const sign = raw.charAt(0);
		current.lines.push(sign === '+' || sign === '-' || sign === ' ' ? raw : ` ${raw}`);
	}
	flush();
	return files;
};

const changesOfTool = (tool: CliToolState): FileChange[] => {
	const metaFiles = (tool.metadata as { files?: unknown } | undefined)?.files;
	if (Array.isArray(metaFiles)) {
		const changes: FileChange[] = [];
		for (const item of metaFiles) {
			if (!item || typeof item !== 'object') continue;
			const entry = item as { file?: unknown; patch?: unknown; additions?: unknown; deletions?: unknown; status?: unknown };
			if (typeof entry.patch !== 'string' || entry.patch.length === 0) continue;
			changes.push({
				file: typeof entry.file === 'string' ? entry.file : '',
				patch: entry.patch,
				additions: typeof entry.additions === 'number' ? entry.additions : undefined,
				deletions: typeof entry.deletions === 'number' ? entry.deletions : undefined,
				isNew: entry.status === 'added' || /^@@ -0,0 /m.test(entry.patch),
				synthetic: false,
			});
		}
		if (changes.length > 0) return changes;
	}
	const input = tool.input;
	if (!input) return [{ file: '', patch: '', isNew: false, synthetic: true }];
	const file = rawTextOf(input, ['filePath', 'file_path', 'path', 'filename', 'file']) ?? '';
	const patchText = rawTextOf(input, ['patchText', 'patch', 'patch_text']);
	if (patchText !== undefined) {
		const fromPatch = filesFromPatchText(patchText);
		if (fromPatch.length > 0) return fromPatch;
	}
	if (tool.name.toLowerCase() === 'write') {
		const content = rawTextOf(input, ['content', 'text', 'newContent']);
		return [{ file, patch: content === undefined ? '' : patchFromTexts('', content, 'Writing'), isNew: false, synthetic: true }];
	}
	const edits = (Array.isArray(input.edits) ? input.edits : [input]).filter((edit): edit is Record<string, unknown> => !!edit && typeof edit === 'object');
	const patches: string[] = [];
	edits.forEach((edit, index) => {
		const oldText = rawTextOf(edit, ['oldString', 'old_string', 'oldText']);
		const newText = rawTextOf(edit, ['newString', 'new_string', 'newText', 'newContent']);
		if (oldText === undefined && newText === undefined) return;
		patches.push(patchFromTexts(oldText ?? '', newText ?? '', edits.length > 1 ? `Edit ${index + 1}` : 'Changing'));
	});
	return [{ file, patch: patches.join('\n'), isNew: false, synthetic: true }];
};

const countsOf = (change: FileChange, rows: DiffRow[]): { added: number; removed: number } => ({
	added: change.additions ?? rows.filter((row) => row.kind === 'add').length,
	removed: change.deletions ?? rows.filter((row) => row.kind === 'del').length,
});

const isRejection = (text: string | undefined): boolean => !!text && /reject|denied|declin/i.test(text);

export const FileStatusIcon = ({ status, rejected, isNew }: { status: CliToolStatus; rejected: boolean; isNew: boolean }) => {
	if (status === 'running' || status === 'input') return <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />;
	if (status === 'error') return rejected
		? <Ban size={13} className='text-loophole-fg-4 flex-shrink-0' />
		: <AlertTriangle size={13} className='text-loophole-warning flex-shrink-0' />;
	return isNew
		? <FilePlus size={13} className='text-loophole-fg-4 flex-shrink-0' />
		: <FileText size={13} className='text-loophole-fg-4 flex-shrink-0' />;
};

export const ChangeCounts = ({ added, removed }: { added: number; removed: number }) => {
	return <span className='ml-auto flex gap-1.5 flex-shrink-0 font-mono text-[11px]'>
		{added > 0 && <span className='text-emerald-400'>+{added}</span>}
		{removed > 0 && <span className='text-red-400'>−{removed}</span>}
	</span>;
};

const FileChangeView = ({ change, status, errorText, fallbackName, nested }: { change: FileChange; status: CliToolStatus; errorText: string | undefined; fallbackName: string; nested: boolean }) => {
	const running = status === 'running' || status === 'input';
	const [isOpen, toggle] = useAutoOpen(running);
	const openFile = useOpenFile();
	const rows = useMemo(() => parsePatch(change.patch), [change.patch]);
	const bodyRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (running && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
	}, [rows.length, running]);
	const { added, removed } = countsOf(change, rows);
	const rejected = status === 'error' && isRejection(errorText);
	const { name, dir } = splitPath(change.file);
	const hasBody = rows.length > 0 || !!errorText;
	return <div className={`w-full min-w-0 border border-loophole-border-3 rounded overflow-hidden ${nested ? 'bg-loophole-bg-1' : 'bg-loophole-bg-3'}`}>
		<div className={`group flex items-center gap-1.5 min-h-[26px] pl-1 pr-2 py-0.5 min-w-0 select-none ${hasBody ? 'cursor-pointer' : ''}`} onClick={hasBody ? toggle : undefined}>
			<ChevronRight className={`text-loophole-fg-3 h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''} ${hasBody ? '' : 'opacity-0'}`} />
			<FileStatusIcon status={status} rejected={rejected} isNew={change.isNew} />
			{change.file
				? <FileLink path={change.file} className={`flex items-center gap-1 flex-shrink-0 max-w-[60%] text-xs font-medium text-loophole-fg-2 ${rejected ? 'line-through' : ''}`}>
					<span className='truncate'>{name || fallbackName}</span>
					<ExternalLink size={10} className='flex-shrink-0 opacity-0 group-hover:opacity-100' />
				</FileLink>
				: <span className={`text-xs font-medium text-loophole-fg-2 flex-shrink-0 max-w-[60%] truncate ${rejected ? 'line-through' : ''}`}>{name || fallbackName}</span>}
			{dir && <span className={`text-[11px] text-loophole-fg-4 min-w-0 truncate ${rejected ? 'line-through' : ''}`}>{dir}</span>}
			{change.isNew && <span className='text-[10px] text-loophole-fg-3 border border-loophole-border-3 rounded-sm px-1 flex-shrink-0'>New</span>}
			<ChangeCounts added={added} removed={removed} />
		</div>
		{isOpen && hasBody && <div ref={bodyRef} className='border-t border-loophole-border-3 max-h-[260px] overflow-auto select-text font-mono text-[11px] leading-[1.45]'>
			<DiffRows rows={rows} showLineNumbers={!change.synthetic} onLineClick={change.synthetic || !change.file ? undefined : (line) => openFile(change.file, line)} />
			{errorText && <pre className='m-0 px-2 py-1.5 text-xs font-mono text-loophole-fg-2 whitespace-pre-wrap break-words'>{truncate(errorText, MAX_VISIBLE_CHARS).text}</pre>}
		</div>}
	</div>;
};

const FileChangeGroup = ({ changes, status, errorText, fallbackName }: { changes: FileChange[]; status: CliToolStatus; errorText: string | undefined; fallbackName: string }) => {
	const running = status === 'running' || status === 'input';
	const [isOpen, toggle] = useAutoOpen(running);
	const totals = changes.reduce((sum, change) => {
		const { added, removed } = countsOf(change, parsePatch(change.patch));
		return { added: sum.added + added, removed: sum.removed + removed };
	}, { added: 0, removed: 0 });
	return <div className='w-full min-w-0 border border-loophole-border-3 rounded bg-loophole-bg-3 overflow-hidden'>
		<div className='flex items-center gap-1.5 min-h-[26px] pl-1 pr-2 py-0.5 min-w-0 select-none cursor-pointer' onClick={toggle}>
			<ChevronRight className={`text-loophole-fg-3 h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />
			<FileStatusIcon status={status} rejected={false} isNew={false} />
			<span className='text-xs font-medium text-loophole-fg-2 flex-shrink-0'>{changes.length} files changed</span>
			<ChangeCounts added={totals.added} removed={totals.removed} />
		</div>
		{isOpen && <div className='flex flex-col gap-1 p-1.5 border-t border-loophole-border-3'>
			{changes.map((change, index) => <FileChangeView key={`${change.file}:${index}`} change={change} status={status} errorText={undefined} fallbackName={fallbackName} nested={true} />)}
			{errorText && <pre className='m-0 px-2 py-1.5 text-xs font-mono text-loophole-fg-2 whitespace-pre-wrap break-words'>{truncate(errorText, MAX_VISIBLE_CHARS).text}</pre>}
		</div>}
	</div>;
};

const FileChangeCard = ({ tool }: { tool: CliToolState }) => {
	const changes = changesOfTool(tool);
	const fallbackName = titleOfToolName(tool.name);
	if (changes.length > 1) {
		return <FileChangeGroup changes={changes} status={tool.status} errorText={tool.error} fallbackName={fallbackName} />;
	}
	return <FileChangeView change={changes[0]} status={tool.status} errorText={tool.error} fallbackName={fallbackName} nested={false} />;
};

export const ToolCard = ({ tool }: { tool: CliToolState }) => {
	if (!isFileChangeTool(tool.name)) return <GenericToolCard tool={tool} />;
	return <FileChangeCard tool={tool} />;
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
