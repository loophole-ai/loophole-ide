/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react';
import { Check, ExternalLink, FileText, Folder, Globe, Search } from 'lucide-react';
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';
import { baseOf, fetchViewOf, firstString, matchCountOf, parentOf, parseGlobOutput, parseGrepOutput, parseWebSearchOutput, shortDirOf, splitPath } from './toolData.js';
import { CodeBlock, MAX_VISIBLE_CHARS, ToolCard, truncate } from './ToolCard.js';
import { CardShell, FileLink, UrlLink, useAutoOpen } from './toolUi.js';

const patternRegex = (pattern: string): RegExp | undefined => {
	if (!pattern) return undefined;
	try {
		return new RegExp(pattern, 'gi');
	}
	catch {
		return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
	}
};

const Highlighted = ({ text, regex }: { text: string; regex: RegExp | undefined }) => {
	if (!regex) return <>{text}</>;
	const parts: React.ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(regex)) {
		const start = match.index ?? 0;
		if (match[0].length === 0) continue;
		if (start > last) parts.push(text.slice(last, start));
		parts.push(<mark key={start} className='bg-yellow-500/30 text-inherit rounded-sm px-px'>{match[0]}</mark>);
		last = start + match[0].length;
	}
	if (last < text.length) parts.push(text.slice(last));
	return <>{parts}</>;
};

const Count = ({ children }: { children: React.ReactNode }) => {
	return <span className='ml-auto text-[11px] text-loophole-fg-3 whitespace-nowrap flex-shrink-0'>{children}</span>;
};

const DoneIcon = () => <Check size={13} className='text-emerald-500 flex-shrink-0' />;

export const SearchResultsCard = ({ tool }: { tool: CliToolState }) => {
	const text = tool.outputText ?? '';
	const groups = useMemo(() => parseGrepOutput(text), [text]);
	const term = firstString(tool.input, ['pattern', 'query', 'search']) ?? '';
	const regex = useMemo(() => patternRegex(term), [term]);
	const [isOpen, toggle] = useAutoOpen(false);
	if (groups.length === 0) return <ToolCard tool={tool} />;
	const total = Math.max(matchCountOf(text), groups.reduce((sum, group) => sum + group.hits.length, 0));

	const head = <>
		<DoneIcon />
		<span className='text-loophole-fg-3 text-xs flex-shrink-0'>Search</span>
		{term && <span className='text-loophole-fg-4 text-xs italic truncate min-w-0'>"{term}"</span>}
		<Count>{total} {total === 1 ? 'match' : 'matches'} · {groups.length} {groups.length === 1 ? 'file' : 'files'}</Count>
	</>;

	return <CardShell isOpen={isOpen} onToggle={toggle} head={head}>
		<div className='max-h-[280px] overflow-auto select-text px-0.5'>
			{groups.map((group) => {
				const { name, dir } = splitPath(group.path);
				return <div key={group.path} className='mb-1.5'>
					<div className='flex items-center gap-1.5 min-h-[22px] text-xs'>
						<FileText size={12} className='text-loophole-fg-4 flex-shrink-0' />
						<FileLink path={group.path} className='font-medium text-loophole-fg-2 flex-shrink-0 max-w-[60%] truncate'>{name}</FileLink>
						<span className='text-[11px] text-loophole-fg-4 truncate min-w-0'>{dir}</span>
						<span className='ml-auto text-[11px] text-loophole-fg-4 flex-shrink-0'>{group.hits.length}</span>
					</div>
					{group.hits.map((hit, index) => <div key={index} className='flex gap-2 font-mono text-[11px] leading-[1.6] pl-[18px] min-w-0'>
						<FileLink path={group.path} line={hit.line} className='flex-shrink-0 min-w-[34px] text-right text-loophole-fg-4'>{hit.line}</FileLink>
						<span className='text-loophole-fg-3 truncate min-w-0'><Highlighted text={hit.text} regex={regex} /></span>
					</div>)}
				</div>;
			})}
		</div>
	</CardShell>;
};

export const FindFilesCard = ({ tool }: { tool: CliToolState }) => {
	const text = tool.outputText ?? '';
	const paths = useMemo(() => parseGlobOutput(text), [text]);
	const pattern = firstString(tool.input, ['pattern', 'glob']) ?? '';
	const [isOpen, toggle] = useAutoOpen(false);
	const folders = useMemo(() => {
		const byDir = new Map<string, string[]>();
		for (const path of paths) {
			const dir = parentOf(path);
			byDir.set(dir, [...(byDir.get(dir) ?? []), path]);
		}
		return [...byDir.entries()];
	}, [paths]);
	if (paths.length === 0) return <ToolCard tool={tool} />;

	const head = <>
		<DoneIcon />
		<span className='text-loophole-fg-3 text-xs flex-shrink-0'>Find files</span>
		{pattern && <span className='text-loophole-fg-4 text-xs italic truncate min-w-0'>{pattern}</span>}
		<Count>{paths.length} {paths.length === 1 ? 'file' : 'files'}</Count>
	</>;

	return <CardShell isOpen={isOpen} onToggle={toggle} head={head}>
		<div className='max-h-[280px] overflow-auto select-text px-0.5'>
			{folders.map(([dir, files]) => <div key={dir} className='mb-1.5'>
				<div className='flex items-center gap-1.5 min-h-[22px] text-xs'>
					<Folder size={12} className='text-loophole-fg-4 flex-shrink-0' />
					<span className='font-medium text-loophole-fg-2 truncate min-w-0'>{shortDirOf(dir) || './'}</span>
					<span className='ml-auto text-[11px] text-loophole-fg-4 flex-shrink-0'>{files.length}</span>
				</div>
				{files.map((file) => <div key={file} className='font-mono text-[11px] leading-[1.6] pl-[18px] min-w-0 truncate'>
					<FileLink path={file} className='text-loophole-fg-2'>{baseOf(file)}</FileLink>
				</div>)}
			</div>)}
		</div>
	</CardShell>;
};

const countLabel = (chars: number, truncated: boolean): string => `${chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : chars}${truncated ? '+' : ''} chars`;

export const FetchCard = ({ tool }: { tool: CliToolState }) => {
	const url = firstString(tool.input, ['url']) ?? '';
	const text = tool.outputText ?? '';
	const view = useMemo(() => fetchViewOf(url, text), [url, text]);
	const [isOpen, toggle] = useAutoOpen(false);
	const [showFull, setShowFull] = useState(false);
	if (!url || !text) return <ToolCard tool={tool} />;

	const head = <>
		<Globe size={13} className='text-loophole-fg-4 flex-shrink-0' />
		<span className='text-xs font-medium text-loophole-fg-2 truncate min-w-0 flex-shrink-0 max-w-[40%]'>{view.domain}</span>
		<span className='text-loophole-fg-4 text-xs italic truncate min-w-0'>{view.title}</span>
		<Count>{countLabel(view.chars, view.truncated)}</Count>
	</>;

	return <CardShell isOpen={isOpen} onToggle={toggle} head={head}>
		<div className='flex flex-col gap-1 px-0.5 min-w-0'>
			<div className='flex items-center gap-1.5 text-[11px] text-loophole-fg-3 min-w-0'>
				<ExternalLink size={11} className='text-loophole-fg-4 flex-shrink-0' />
				<UrlLink url={url} className='truncate min-w-0'>{url}</UrlLink>
			</div>
			<div className='text-[13px] font-semibold text-loophole-fg-1 mt-1'>{view.title}</div>
			{showFull
				? <CodeBlock>{truncate(text, MAX_VISIBLE_CHARS).text}</CodeBlock>
				: <div className='text-xs text-loophole-fg-3 overflow-hidden' style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>{view.excerpt}</div>}
			<button
				type='button'
				className='self-start text-[11px] text-[var(--vscode-textLink-foreground)] hover:underline'
				onClick={() => setShowFull((value) => !value)}
			>{showFull ? 'Hide full content' : 'Show full content'}</button>
		</div>
	</CardShell>;
};

export const WebSearchCard = ({ tool }: { tool: CliToolState }) => {
	const text = tool.outputText ?? '';
	const results = useMemo(() => parseWebSearchOutput(text), [text]);
	const query = firstString(tool.input, ['query']) ?? '';
	const [isOpen, toggle] = useAutoOpen(false);
	if (results.length === 0) return <ToolCard tool={tool} />;

	const head = <>
		<Search size={13} className='text-emerald-500 flex-shrink-0' />
		<span className='text-loophole-fg-3 text-xs flex-shrink-0'>Web search</span>
		{query && <span className='text-loophole-fg-4 text-xs italic truncate min-w-0'>"{query}"</span>}
		<Count>{results.length} {results.length === 1 ? 'result' : 'results'}</Count>
	</>;

	return <CardShell isOpen={isOpen} onToggle={toggle} head={head}>
		<div className='max-h-[280px] overflow-auto select-text px-0.5'>
			{results.map((result, index) => <div key={`${result.url}:${index}`} className={`py-1 min-w-0 ${index > 0 ? 'border-t border-loophole-border-3' : ''}`}>
				<div className='flex items-baseline gap-1.5 min-w-0'>
					<UrlLink url={result.url} className='text-xs font-medium text-loophole-fg-1 truncate min-w-0'>{result.title}</UrlLink>
					<span className='text-[11px] text-loophole-fg-4 flex-shrink-0'>{result.domain}</span>
				</div>
				{result.snippet && <div className='text-xs text-loophole-fg-3 overflow-hidden' style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{result.snippet}</div>}
			</div>)}
		</div>
	</CardShell>;
};
