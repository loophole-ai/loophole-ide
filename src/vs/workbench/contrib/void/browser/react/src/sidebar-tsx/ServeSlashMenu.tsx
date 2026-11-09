/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from 'react';
import { useAccessor } from '../util/services.js';
import type { LoopholeServeCommandInfo, LoopholeServeSkillInfo } from '../../../../common/loopholeServeTypes.js';

export type ServeSlashEntry = {
	kind: 'command' | 'skill';
	name: string; // display name (skills colliding with a command get the `:skill` suffix, Kilo-style)
	description?: string;
	skillId?: string;
};

// Merges server commands + skills into one `/` menu list (Kilo useSlashCommand look).
// Data path: GET /api/command + GET /api/skill -> ILoopholeServeService.
export const useServeSlashEntries = (serveEnabled: boolean): ServeSlashEntry[] => {
	const accessor = useAccessor()
	const serveService = accessor.get('ILoopholeServeService')
	const [entries, setEntries] = useState<ServeSlashEntry[]>([])

	useEffect(() => {
		if (!serveEnabled) {
			setEntries([])
			return;
		}
		let cancelled = false;
		const load = async () => {
			try {
				const [commands, skills] = await Promise.all([
					serveService.commands().catch(() => [] as LoopholeServeCommandInfo[]),
					serveService.skills().catch(() => [] as LoopholeServeSkillInfo[]),
				])
				if (cancelled) return;
				const taken = new Set(commands.map((c) => c.name));
				const merged: ServeSlashEntry[] = [
					...commands.map((c): ServeSlashEntry => ({ kind: 'command', name: c.name, description: c.description })),
					...skills.map((s): ServeSlashEntry => ({
						kind: 'skill',
						name: taken.has(s.name) ? `${s.name}:skill` : s.name,
						description: s.description,
						skillId: s.id,
					})),
				];
				merged.sort((a, b) => a.name.localeCompare(b.name));
				setEntries(merged)
			} catch {
				if (!cancelled) setEntries([])
			}
		};
		void load();
		return () => { cancelled = true; }
	}, [serveService, serveEnabled])

	return entries
};

const score = (entry: ServeSlashEntry, query: string): number => {
	if (!query) return 1;
	const n = entry.name.toLowerCase()
	const q = query.toLowerCase()
	if (n === q) return 3
	if (n.startsWith(q)) return 2
	if (n.includes(q)) return 1
	if (entry.description?.toLowerCase().includes(q)) return 1
	return 0
};

// Menu shown above the composer when the draft starts with `/`.
export const ServeSlashMenu = ({
	query,
	entries,
	index,
	onHover,
	onPick,
}: {
	query: string;
	entries: ServeSlashEntry[];
	index: number;
	onHover: (idx: number) => void;
	onPick: (entry: ServeSlashEntry) => void;
}) => {
	const filtered = useMemo(() => {
		return entries
			.map((e) => ({ e, s: score(e, query) }))
			.filter((x) => x.s > 0)
			.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
			.map((x) => x.e)
			.slice(0, 20)
	}, [entries, query])

	if (filtered.length === 0) {
		return <div className='w-full border border-loophole-border-3 bg-loophole-bg-2-alt rounded shadow-lg px-3 py-1 text-xs text-loophole-fg-4'>No matching commands</div>
	}

	return <div className='w-full border border-loophole-border-3 bg-loophole-bg-2-alt rounded shadow-lg max-h-[240px] overflow-y-auto flex flex-col'>
		{filtered.map((e, i) => <div
			key={`${e.kind}:${e.name}`}
			className={`flex items-center gap-2 px-3 py-1 cursor-pointer text-sm ${i === index ? 'bg-blue-500 text-white/80' : 'text-loophole-fg-1'}`}
			onMouseMove={() => onHover(i)}
			onClick={() => onPick(e)}
		>
			<span className='font-medium'>/{e.name}</span>
			{e.kind === 'skill' && <span className='text-xs opacity-60'>skill</span>}
			{e.description && <span className='truncate text-xs opacity-60'>{e.description}</span>}
		</div>)}
	</div>
};

// Best filtered list for the given query (shared by menu + key handling).
export const filterServeSlashEntries = (entries: ServeSlashEntry[], query: string): ServeSlashEntry[] => {
	return entries
		.map((e) => ({ e, s: score(e, query) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
		.map((x) => x.e)
		.slice(0, 20)
};
