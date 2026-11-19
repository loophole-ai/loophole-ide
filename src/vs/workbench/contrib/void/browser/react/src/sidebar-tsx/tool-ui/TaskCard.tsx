/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { AlertTriangle, Bot, Check, Loader2 } from 'lucide-react';
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';
import { firstString, stepRowOf } from './toolData.js';
import { CardShell, useAutoOpen, useDuration } from './toolUi.js';
import { CodeBlock, MAX_VISIBLE_CHARS, Section, firstLineOf, truncate } from './ToolCard.js';
import { StepRows } from './StepRows.js';

const TextBlock = ({ text }: { text: string }) => {
	return <div className='text-xs text-loophole-fg-2 whitespace-pre-wrap break-words select-text px-0.5 py-0.5'>{truncate(text, MAX_VISIBLE_CHARS).text}</div>;
};

export const TaskCard = ({ tool }: { tool: CliToolState }) => {
	const running = tool.status === 'running' || tool.status === 'input';
	const failed = tool.status === 'error';
	const [isOpen, toggle] = useAutoOpen(running, failed);
	const duration = useDuration(tool.startedAt, tool.endedAt, running);
	const prompt = firstString(tool.input, ['prompt', 'task', 'instructions']) ?? '';
	const title = firstString(tool.input, ['description', 'title']) ?? (prompt ? firstLineOf(prompt, 80) : 'Subagent');
	const agent = firstString(tool.input, ['subagent_type', 'subagentType', 'agent']);
	const steps = tool.steps ?? [];
	const current = [...steps].reverse().find((step) => step.status === 'running' || step.status === 'input');
	const currentRow = current ? stepRowOf(current) : undefined;
	const calls = steps.length > 0 ? `${steps.length} tool call${steps.length === 1 ? '' : 's'}` : '';
	const meta = (running
		? [currentRow ? `${currentRow.verb} ${currentRow.target}`.trim() : '', duration]
		: [calls, duration]
	).filter((part) => part.length > 0).join(' · ');
	const result = tool.outputText ?? '';

	const head = <>
		{running
			? <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />
			: failed
				? <AlertTriangle size={13} className='text-loophole-warning flex-shrink-0' />
				: <Check size={13} className='text-emerald-500 flex-shrink-0' />}
		<span className='text-xs font-medium text-loophole-fg-2 truncate min-w-0'>{title}</span>
		{agent && <span className='flex items-center gap-1 flex-shrink-0 text-[10px] text-loophole-fg-3 border border-loophole-border-3 rounded-full px-1.5'>
			<Bot size={11} />{agent}
		</span>}
		<span className='ml-auto text-[11px] text-loophole-fg-4 truncate min-w-0'>{meta}</span>
	</>;

	return <CardShell isOpen={isOpen} onToggle={toggle} head={head}>
		<div className='flex flex-col gap-1.5 px-0.5 min-w-0'>
			{steps.length > 0 && <Section label='Steps' summary={`${steps.length} tool call${steps.length === 1 ? '' : 's'}`} defaultOpen={running}>
				<StepRows steps={steps} />
			</Section>}
			{prompt && <Section label='Prompt' summary={firstLineOf(prompt)}>
				<TextBlock text={prompt} />
			</Section>}
			{result && <Section label='Result' summary={firstLineOf(result)} defaultOpen={!running && !failed}>
				<TextBlock text={result} />
			</Section>}
			{tool.error && <Section label='Error' summary={firstLineOf(tool.error)} defaultOpen={true}>
				<CodeBlock>{truncate(tool.error, MAX_VISIBLE_CHARS).text}</CodeBlock>
			</Section>}
		</div>
	</CardShell>;
};
