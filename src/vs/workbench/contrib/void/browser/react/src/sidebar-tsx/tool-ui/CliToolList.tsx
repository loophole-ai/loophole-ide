/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo } from 'react';
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';
import { exploreKindOf, isBashTool, isFetchTool, isGlobTool, isGrepTool, isTaskTool, isWebSearchTool } from './toolData.js';
import { ToolCard } from './ToolCard.js';
import { TodoListCard, isTodoToolName } from './TodoList.js';
import { CommandCard } from './CommandCard.js';
import { TaskCard } from './TaskCard.js';
import { ExploreGroupCard } from './ExploreGroup.js';
import { FetchCard, FindFilesCard, SearchResultsCard, WebSearchCard } from './ResultCards.js';

export type ToolEntry =
	| { kind: 'single'; tool: CliToolState }
	| { kind: 'group'; tools: CliToolState[] };

export const groupTools = (tools: CliToolState[]): ToolEntry[] => {
	const entries: ToolEntry[] = [];
	let run: CliToolState[] = [];
	const flush = () => {
		if (run.length >= 2) entries.push({ kind: 'group', tools: run });
		else run.forEach((tool) => entries.push({ kind: 'single', tool }));
		run = [];
	};
	for (const tool of tools) {
		if (exploreKindOf(tool.name)) {
			run.push(tool);
			continue;
		}
		flush();
		entries.push({ kind: 'single', tool });
	}
	flush();
	return entries;
};

export const CliToolView = ({ tool }: { tool: CliToolState }) => {
	const name = tool.name;
	const done = tool.status === 'done';
	if (isTodoToolName(name)) return <TodoListCard tool={tool} />;
	if (isBashTool(name)) return <CommandCard tool={tool} />;
	if (isTaskTool(name)) return <TaskCard tool={tool} />;
	if (done && isGrepTool(name)) return <SearchResultsCard tool={tool} />;
	if (done && isGlobTool(name)) return <FindFilesCard tool={tool} />;
	if (done && isFetchTool(name)) return <FetchCard tool={tool} />;
	if (done && isWebSearchTool(name)) return <WebSearchCard tool={tool} />;
	return <ToolCard tool={tool} />;
};

export const CliToolList = ({ tools }: { tools: CliToolState[] }) => {
	const entries = useMemo(() => groupTools(tools), [tools]);
	return <>
		{entries.map((entry) => entry.kind === 'group'
			? <ExploreGroupCard key={`group:${entry.tools[0].id}`} tools={entry.tools} />
			: <CliToolView key={entry.tool.id} tool={entry.tool} />)}
	</>;
};
