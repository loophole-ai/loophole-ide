/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { FileText, Folder, Globe, Loader2, Pencil, Search, Terminal, Wrench, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';
import { stepRowOf } from './toolData.js';
import type { StepIcon } from './toolData.js';
import { CodeBlock, MAX_VISIBLE_CHARS, truncate } from './ToolCard.js';
import { FileLink } from './toolUi.js';

const ICONS: Record<StepIcon, LucideIcon> = {
	file: FileText,
	search: Search,
	folder: Folder,
	terminal: Terminal,
	globe: Globe,
	edit: Pencil,
	tool: Wrench,
};

const StepRow = ({ step }: { step: CliToolState }) => {
	const [isOpen, setIsOpen] = useState(false);
	const row = stepRowOf(step);
	const running = step.status === 'running' || step.status === 'input';
	const failed = step.status === 'error';
	const Icon = ICONS[row.icon];
	const body = step.outputText ?? step.error ?? '';
	const expandable = body.length > 0;
	return <div className='min-w-0'>
		<div
			className={`flex items-center gap-1.5 min-h-[22px] px-0.5 rounded text-xs ${expandable ? 'cursor-pointer hover:bg-loophole-bg-2' : ''}`}
			onClick={expandable ? () => setIsOpen((value) => !value) : undefined}
		>
			{running
				? <Loader2 size={12} className='text-loophole-fg-4 animate-spin flex-shrink-0' />
				: failed
					? <X size={12} className='text-red-400 flex-shrink-0' />
					: <Icon size={12} className='text-loophole-fg-4 flex-shrink-0' />}
			<span className='text-loophole-fg-3 flex-shrink-0 w-11'>{row.verb}</span>
			{row.path
				? <FileLink path={row.path} className='text-loophole-fg-2 truncate min-w-0 flex-1'>{row.target}</FileLink>
				: <span className='text-loophole-fg-2 truncate min-w-0 flex-1'>{row.target}</span>}
			<span className={`text-[11px] flex-shrink-0 ${failed ? 'text-red-400' : 'text-loophole-fg-4'}`}>{running ? 'running…' : row.meta}</span>
		</div>
		{isOpen && expandable && <div className='mx-1 mb-1'>
			<CodeBlock>{truncate(body, MAX_VISIBLE_CHARS).text}</CodeBlock>
		</div>}
	</div>;
};

export const StepRows = ({ steps }: { steps: CliToolState[] }) => {
	return <div className='flex flex-col min-w-0'>
		{steps.map((step) => <StepRow key={step.id} step={step} />)}
	</div>;
};
