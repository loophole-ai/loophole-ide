/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useAccessor } from '../util/services.js';
import type { LoopholeServeSessionInfo } from '../../../../common/loopholeServeTypes.js';

const relativeTime = (ts: number): string => {
	const diff = Date.now() - ts;
	if (diff < 60_000) return 'just now';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
	return new Date(ts).toLocaleDateString();
};

const formatCost = (n: number): string =>
	new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n ?? 0);

// Sessions browser (Kilo look: compact rows with title, relative time, affordances).
// Data path: GET /api/session -> ILoopholeServeService.sessions -> list;
// select loads GET /api/session/:id/context + GET /api/session/:id into the Void thread.
export const ServeSessionsBrowser = ({ onClose }: { onClose: () => void }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const serveService = accessor.get('ILoopholeServeService')
	const [sessions, setSessions] = useState<LoopholeServeSessionInfo[]>([])
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(false)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [renameId, setRenameId] = useState<string | null>(null)
	const [renameVal, setRenameVal] = useState('')

	const refresh = async () => {
		setLoading(true)
		setLoadError(null)
		try {
			const list = await serveService.sessions({ limit: 100 })
			setSessions(Array.isArray(list) ? list : [])
		} catch (e) {
			setLoadError(e instanceof Error ? e.message : String(e))
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => { void refresh(); }, [serveService])

	const filtered = sessions.filter((s) => {
		const q = search.trim().toLowerCase();
		if (!q) return true;
		const title = (s.title ?? '').toLowerCase();
		const id = s.id.toLowerCase();
		return title.includes(q) || id.includes(q);
	});

	const onSelect = async (sessionID: string) => {
		setLoadError(null)
		try {
			const [context, info] = await Promise.all([
				serveService.sessionContext(sessionID),
				serveService.session(sessionID),
			])
			const threadId = chatThreadsService.state.currentThreadId
			chatThreadsService.importServeSession({
				threadId,
				sessionID,
				info,
				messages: Array.isArray(context) ? context : [],
			})
			chatThreadsService.focusCurrentChat().catch(() => { /* best effort */ })
			onClose()
		} catch (e) {
			setLoadError(`Failed to load session: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	const onDelete = async (sessionID: string) => {
		try {
			await serveService.deleteSession(sessionID)
			setSessions((prev) => prev.filter((s) => s.id !== sessionID))
		} catch (e) {
			setLoadError(e instanceof Error ? e.message : String(e))
		}
	}

	const onFork = async (sessionID: string) => {
		try {
			await serveService.forkSession(sessionID)
			await refresh()
		} catch (e) {
			setLoadError(e instanceof Error ? e.message : String(e))
		}
	}

	const onRename = async (sessionID: string) => {
		try {
			await serveService.renameSession(sessionID, renameVal)
			setRenameId(null)
			await refresh()
		} catch (e) {
			setLoadError(e instanceof Error ? e.message : String(e))
		}
	}

	return <div
		className='fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-16'
		onClick={onClose}
	>
		<div
			className='w-[560px] max-w-[92vw] max-h-[70vh] flex flex-col rounded-md border border-loophole-border-1 bg-loophole-bg-2-alt shadow-lg'
			onClick={(e) => e.stopPropagation()}
		>
			<div className='flex items-center gap-2 px-3 py-2 border-b border-loophole-border-3'>
				<input
					autoFocus
					className='flex-1 min-w-0 rounded bg-loophole-bg-1 text-loophole-fg-1 text-sm px-2 py-1 border border-loophole-border-2 focus:border-loophole-border-1'
					placeholder='Search sessions…'
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
				/>
				<button type='button' className='text-loophole-fg-3 text-xs hover:text-loophole-fg-1' onClick={() => void refresh()}>Refresh</button>
				<button type='button' className='text-loophole-fg-3 text-xs hover:text-loophole-fg-1' onClick={onClose}>Close</button>
			</div>
			{loadError && <div className='px-3 py-1 text-xs text-red-500'>{loadError}</div>}
			<div className='overflow-y-auto flex flex-col'>
				{loading && <div className='px-3 py-2 text-xs text-loophole-fg-4'>Loading…</div>}
				{!loading && filtered.length === 0 && <div className='px-3 py-2 text-xs text-loophole-fg-4'>No sessions found.</div>}
				{filtered.map((s) => {
					const updated = typeof s.time?.updated === 'number' ? s.time.updated : 0
					const isRenaming = renameId === s.id
					return <div
						key={s.id}
						className='flex items-center gap-2 px-3 py-2 border-b border-loophole-border-3/40 hover:bg-loophole-bg-1 cursor-pointer'
						onClick={() => void onSelect(s.id)}
					>
						<span className='flex-1 min-w-0 truncate text-sm text-loophole-fg-1'>
							{s.title || s.id.slice(0, 8)}
						</span>
						<span className='text-xs text-loophole-fg-4 whitespace-nowrap'>{relativeTime(updated)}</span>
						<span className='text-xs text-loophole-fg-4 whitespace-nowrap'>{formatCost(s.cost)}</span>
						{isRenaming ? <span
							className='flex items-center gap-1'
							onClick={(e) => e.stopPropagation()}
						>
							<input
								autoFocus
								className='w-32 rounded bg-loophole-bg-1 text-loophole-fg-1 text-xs px-1 py-0.5 border border-loophole-border-2'
								value={renameVal}
								onChange={(e) => setRenameVal(e.target.value)}
								onKeyDown={(e) => { if (e.key === 'Enter') void onRename(s.id); if (e.key === 'Escape') setRenameId(null); }}
							/>
							<button type='button' className='text-xs text-loophole-fg-1' onClick={() => void onRename(s.id)}>Save</button>
						</span> : <button
							type='button'
							className='text-xs text-loophole-fg-4 hover:text-loophole-fg-1'
							title='Rename'
							onClick={(e) => { e.stopPropagation(); setRenameId(s.id); setRenameVal(s.title ?? ''); }}
						>
							Rename
						</button>}
						<button
							type='button'
							className='text-xs text-loophole-fg-4 hover:text-loophole-fg-1'
							title='Fork'
							onClick={(e) => { e.stopPropagation(); void onFork(s.id); }}
						>
							Fork
						</button>
						<button
							type='button'
							className='text-xs text-loophole-fg-4 hover:text-red-400'
							title='Delete'
							onClick={(e) => { e.stopPropagation(); void onDelete(s.id); }}
						>
							Delete
						</button>
					</div>;
				})}
			</div>
		</div>
	</div>
};
