/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Kilo-style todo checklist card. opencode's `todowrite` tool arrives as an
// ordinary tool call whose input/metadata carries `todos: [{ content, status }]`
// (see packages/core/src/tool/plugin/todo.ts); Kilo renders that same shape as
// a live checklist (TodoChip panel), so this re-implements that look in React.
import React, { useState } from 'react';
import { Check, ChevronRight, Circle, Loader2, X } from 'lucide-react';
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';

export type TodoItemLike = {
	content: string;
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
	priority?: string;
};

export const isTodoToolName = (name: string): boolean => /todo/i.test(name);

// Prefer the parsed call input (live), then the result metadata (canonical),
// then the streamed raw input text as a fallback.
export const todoItemsOfTool = (tool: CliToolState): TodoItemLike[] => {
	const read = (value: unknown): TodoItemLike[] | undefined => {
		if (!Array.isArray(value)) return undefined;
		const items: TodoItemLike[] = [];
		for (const item of value) {
			if (!item || typeof item !== 'object') continue;
			const content = (item as { content?: unknown }).content;
			const status = (item as { status?: unknown }).status;
			if (typeof content !== 'string') continue;
			items.push({
				content,
				status: status === 'in_progress' || status === 'completed' || status === 'cancelled' ? status : 'pending',
				priority: typeof (item as { priority?: unknown }).priority === 'string' ? (item as { priority: string }).priority : undefined,
			});
		}
		return items;
	};
	const fromInput = read(tool.input?.todos);
	if (fromInput) return fromInput;
	const fromMetadata = read(tool.metadata?.todos);
	if (fromMetadata) return fromMetadata;
	const text = tool.inputText?.trim();
	if (text) {
		try {
			const parsed = JSON.parse(text) as { todos?: unknown };
			const fromText = read(parsed?.todos);
			if (fromText) return fromText;
		} catch { /* partial JSON while streaming: no items yet */ }
	}
	return [];
};

export const TodoListCard = ({ tool }: { tool: CliToolState }) => {
	const [isOpen, setIsOpen] = useState(true);
	const items = todoItemsOfTool(tool);
	const live = items.filter((i) => i.status !== 'cancelled');
	const done = live.filter((i) => i.status === 'completed').length;
	const active = live.find((i) => i.status === 'in_progress') ?? live.find((i) => i.status === 'pending');
	const running = tool.status === 'running' || tool.status === 'input';
	return <div className='w-full border border-loophole-border-3 rounded px-2 py-1 bg-loophole-bg-3 overflow-hidden'>
		<div className='select-none flex items-center min-h-[24px] justify-between cursor-pointer' onClick={() => setIsOpen(v => !v)}>
			<div className='flex items-center min-w-0 overflow-hidden'>
				<ChevronRight className={`text-loophole-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />
				{running
					? <Loader2 size={13} className='text-loophole-fg-4 animate-spin flex-shrink-0' />
					: done === live.length && live.length > 0
						? <Check size={13} className='text-emerald-500 flex-shrink-0' />
						: <Circle size={13} className='text-loophole-fg-4 flex-shrink-0' />}
				<span className='text-loophole-fg-3 text-xs ml-1.5 flex-shrink-0'>Todos</span>
				<span className='text-loophole-fg-4 text-xs italic truncate ml-2'>{active ? active.content : ''}</span>
			</div>
			<span className='text-loophole-fg-4 text-xs ml-auto mr-1 flex-shrink-0'>{done}/{live.length}</span>
		</div>
		<div className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}`}>
			<div className='flex flex-col gap-1 max-h-[300px] overflow-y-auto'>
				{items.length === 0
					? <div className='text-loophole-fg-4 text-xs italic px-2'>{running ? 'Planning…' : 'No items yet.'}</div>
					: items.map((item, i) => <div key={i} className={`flex items-start gap-1.5 px-2 text-xs ${item.status === 'completed' || item.status === 'cancelled' ? 'text-loophole-fg-4' : 'text-loophole-fg-2'}`}>
						<span className='flex-shrink-0 mt-0.5'>
							{item.status === 'completed'
								? <Check size={12} className='text-emerald-500' />
								: item.status === 'cancelled'
									? <X size={12} className='text-loophole-fg-4' />
									: item.status === 'in_progress'
										? <Loader2 size={12} className='animate-spin text-loophole-fg-3' />
										: <Circle size={12} className='text-loophole-fg-4' />}
						</span>
						<span className={`${item.status === 'completed' ? 'line-through' : ''} ${item.status === 'cancelled' ? 'line-through opacity-60' : ''}`}>{item.content}</span>
						{item.priority && <span className='text-loophole-fg-4 text-[10px] italic ml-auto flex-shrink-0'>{item.priority}</span>}
					</div>)}
			</div>
		</div>
	</div>;
};
