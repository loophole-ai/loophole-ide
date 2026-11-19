/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';
import { firstString } from './toolData.js';
import { CodeBlock, MAX_VISIBLE_CHARS, truncate } from './ToolCard.js';
import { CardShell, useAutoOpen, useCopyText, useDuration } from './toolUi.js';

const exitCodeOf = (metadata: Record<string, unknown> | undefined): number | undefined => {
	if (!metadata) return undefined;
	for (const key of ['exit', 'exitCode', 'exit_code']) {
		const value = metadata[key];
		if (typeof value === 'number') return value;
	}
	return undefined;
};

export const CommandCard = ({ tool }: { tool: CliToolState }) => {
	const running = tool.status === 'running' || tool.status === 'input';
	const exit = exitCodeOf(tool.metadata);
	const failed = tool.status === 'error' || (exit !== undefined && exit !== 0);
	const [isOpen, toggle] = useAutoOpen(running, failed);
	const [copied, copy] = useCopyText();
	const duration = useDuration(tool.startedAt, tool.endedAt, running);
	const command = firstString(tool.input, ['command', 'cmd']) ?? '';
	const liveOutput = typeof tool.metadata?.output === 'string' ? tool.metadata.output : '';
	const output = tool.outputText ?? liveOutput;
	const hasBody = command.length > 0 || output.length > 0 || !!tool.error || running;

	const head = <>
		{running
			? <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />
			: failed
				? <X size={13} className='text-red-400 flex-shrink-0' />
				: <Check size={13} className='text-emerald-500 flex-shrink-0' />}
		<span className='font-mono text-xs text-loophole-fg-2 truncate min-w-0 flex-1'>{command || 'Run command'}</span>
		<span className='flex items-center gap-2 flex-shrink-0 text-[11px]'>
			{running
				? <span className='text-loophole-fg-4'>{duration ? `running · ${duration}` : 'running…'}</span>
				: <>
					{exit !== undefined && <span className={`font-mono ${exit === 0 ? 'text-emerald-500' : 'text-red-400'}`}>exit {exit}</span>}
					{duration && <span className='text-loophole-fg-4'>{duration}</span>}
				</>}
			{command && <button
				type='button'
				title='Copy command'
				className='flex items-center justify-center h-5 w-5 rounded text-loophole-fg-4 hover:text-loophole-fg-1 hover:bg-loophole-bg-2'
				onClick={(e) => {
					e.stopPropagation();
					copy(command);
				}}
			>
				{copied ? <Check size={12} className='text-emerald-500' /> : <Copy size={12} />}
			</button>}
		</span>
	</>;

	return <CardShell isOpen={isOpen && hasBody} onToggle={toggle} head={head}>
		<div className='flex flex-col gap-1.5 px-0.5 min-w-0'>
			{command.length > 34 && <div className='font-mono text-xs text-loophole-fg-2 whitespace-pre-wrap break-all px-0.5 select-text'>
				<span className='text-loophole-fg-4'>$ </span>{command}
			</div>}
			{(output.length > 0 || running) && <CodeBlock>{truncate(output, MAX_VISIBLE_CHARS).text}{running ? '▍' : ''}</CodeBlock>}
			{!running && output.length === 0 && !tool.error && <span className='text-xs text-loophole-fg-4 px-0.5'>No output</span>}
			{tool.error && <CodeBlock>{truncate(tool.error, MAX_VISIBLE_CHARS).text}</CodeBlock>}
		</div>
	</CardShell>;
};
