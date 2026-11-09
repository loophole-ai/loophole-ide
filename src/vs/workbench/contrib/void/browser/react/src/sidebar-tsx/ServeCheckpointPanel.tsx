/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useAccessor, useChatThreadsState } from '../util/services.js';
import type { LoopholeServeSessionMessage } from '../../../../common/loopholeServeTypes.js';

// Checkpoints / rewind (serve session revert endpoints):
//   POST   /api/session/:id/revert/stage  { messageID, files? } -> { messageID, files? }
//   DELETE /api/session/:id/revert        (undo staged)
//   POST   /api/session/:id/revert/commit (commit staged)
// Two-step restore: stage (preview files) -> commit; undo clears the stage.
export const ServeCheckpointPanel = ({ threadId, onClose }: { threadId: string; onClose: () => void }) => {
	const accessor = useAccessor()
	const serveService = accessor.get('ILoopholeServeService')
	const threadsState = useChatThreadsState()
	const sessionID = threadsState.allThreads[threadId]?.state.serveSessionId
	const [messages, setMessages] = useState<LoopholeServeSessionMessage[]>([])
	const [staged, setStaged] = useState<{ messageID: string; files?: Array<{ file?: string; status?: string; additions?: number; deletions?: number }> } | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const refresh = async () => {
		if (!sessionID) return;
		setError(null)
		try {
			// User messages are the rewind boundaries; first page (newest first) is enough for the list.
			const list = await serveService.sessionMessages(sessionID, { limit: 200, order: 'asc' })
			const users = (Array.isArray(list) ? list : []).filter((m) => m.type === 'user')
			setMessages(users)
			try {
				const info = await serveService.session(sessionID)
				if (info.revert) setStaged({ messageID: info.revert.messageID, files: info.revert.files })
				else setStaged(null)
			} catch { /* staged state stays as-is */ }
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	useEffect(() => { void refresh(); }, [sessionID])

	if (!sessionID) {
		return <div className='px-3 py-2 text-xs text-loophole-fg-4'>No serve session bound to this thread yet. Send a message with Loophole Serve enabled first.</div>
	}

	const onStage = async (messageID: string) => {
		setBusy(true)
		setError(null)
		try {
			const result = await serveService.revertStage(sessionID, messageID, true)
			setStaged({ messageID: result.messageID, files: result.files })
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const onCommit = async () => {
		setBusy(true)
		setError(null)
		try {
			await serveService.revertCommit(sessionID)
			setStaged(null)
			onClose()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const onUndo = async () => {
		setBusy(true)
		setError(null)
		try {
			await serveService.revertClear(sessionID)
			setStaged(null)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return <div className='flex flex-col w-full'>
		<div className='flex items-center justify-between px-3 py-2 border-b border-loophole-border-3'>
			<span className='text-xs text-loophole-fg-3'>Checkpoints (user messages)</span>
			<button type='button' className='text-xs text-loophole-fg-4 hover:text-loophole-fg-1' onClick={onClose}>Close</button>
		</div>
		{error && <div className='px-3 py-1 text-xs text-red-500'>{error}</div>}
		{staged && <div className='px-3 py-2 text-xs border-b border-loophole-border-3 bg-loophole-bg-3'>
			<div className='text-loophole-fg-1'>Rewind staged at {staged.messageID.slice(0, 12)}…</div>
			{(staged.files ?? []).length > 0 && <div className='text-loophole-fg-4 mt-0.5'>
				{(staged.files ?? []).map((f, i) => <div key={i} className='truncate'>{f.file ?? '?'} · {f.status ?? ''} (+{f.additions ?? 0} −{f.deletions ?? 0})</div>)}
			</div>}
			<div className='flex gap-2 mt-1'>
				<button type='button' disabled={busy} className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] disabled:opacity-50' onClick={() => void onCommit()}>Commit rewind</button>
				<button type='button' disabled={busy} className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] disabled:opacity-50' onClick={() => void onUndo()}>Undo stage</button>
			</div>
		</div>}
		<div className='overflow-y-auto flex flex-col max-h-[260px]'>
			{messages.length === 0 && <div className='px-3 py-2 text-xs text-loophole-fg-4'>No user messages yet.</div>}
			{messages.map((m) => <div key={m.id} className='flex items-center gap-2 px-3 py-2 border-b border-loophole-border-3/40'>
				<span className='flex-1 min-w-0 truncate text-xs text-loophole-fg-1'>{typeof m.text === 'string' ? m.text : m.id}</span>
				<button
					type='button'
					disabled={busy}
					className='text-xs text-loophole-fg-4 hover:text-loophole-fg-1 disabled:opacity-50'
					onClick={() => void onStage(m.id)}
				>
					Rewind here
				</button>
			</div>)}
		</div>
	</div>
};
