/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';
import { exploreKindOf, stepRowOf } from './toolData.js';
import { CardShell, useAutoOpen } from './toolUi.js';
import { StepRows } from './StepRows.js';

const plural = (count: number, singular: string, pluralWord: string): string => `${count} ${count === 1 ? singular : pluralWord}`;

export const ExploreGroupCard = ({ tools }: { tools: CliToolState[] }) => {
	const running = tools.some((tool) => tool.status === 'running' || tool.status === 'input');
	const failedCount = tools.filter((tool) => tool.status === 'error').length;
	const [isOpen, toggle] = useAutoOpen(running);
	const count = (kind: string) => tools.filter((tool) => exploreKindOf(tool.name) === kind).length;
	const parts: string[] = [];
	if (count('read') > 0) parts.push(plural(count('read'), 'file', 'files'));
	if (count('search') > 0) parts.push(plural(count('search'), 'search', 'searches'));
	if (count('list') > 0) parts.push(plural(count('list'), 'listing', 'listings'));
	const current = [...tools].reverse().find((tool) => tool.status === 'running' || tool.status === 'input');
	const currentRow = current ? stepRowOf(current) : undefined;

	const head = <>
		{running
			? <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />
			: <Check size={13} className='text-emerald-500 flex-shrink-0' />}
		<span className='text-loophole-fg-3 text-xs flex-shrink-0'>{running ? 'Exploring…' : `Explored ${parts.join(', ')}`}</span>
		{running && currentRow && <span className='text-loophole-fg-4 text-xs italic truncate min-w-0'>{`${currentRow.verb} ${currentRow.target}`.trim()}</span>}
		{!running && failedCount > 0 && <span className='text-red-400 text-xs flex-shrink-0'>{failedCount} failed</span>}
	</>;

	return <CardShell isOpen={isOpen} onToggle={toggle} head={head}>
		<div className='px-0.5 min-w-0'>
			<StepRows steps={tools} />
		</div>
	</CardShell>;
};
