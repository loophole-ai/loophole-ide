/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { useAccessor, useChatThreadsState, useServePermissions } from '../util/services.js';
import type { LoopholeServePermissionDecision } from '../../../../../../../workbench/contrib/void/common/loopholeServeTypes.js';

// Server-side tool approval card (Loophole Serve `permission.asked`).
// Wired to POST /api/session/:id/permission/:requestID/reply via
// ILoopholeServeService.permissionReply; decision maps once/always/reject.
export const ServePermissionCard = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const serveService = accessor.get('ILoopholeServeService')
	const threadsState = useChatThreadsState()
	const permissions = useServePermissions(threadId)
	const sessionID = threadsState.allThreads[threadId]?.state.serveSessionId
	const [busyId, setBusyId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	if (!sessionID || permissions.length === 0) return null;

	const reply = async (requestID: string, decision: LoopholeServePermissionDecision) => {
		setBusyId(requestID)
		setError(null)
		try {
			await serveService.permissionReply(sessionID, requestID, decision)
			chatThreadsService.clearServePermission(threadId, requestID)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusyId(null)
		}
	}

	return <div className='flex flex-col gap-1 w-full'>
		{permissions.map((p) => <div
			key={p.id}
			className='w-full border border-loophole-border-1 rounded px-2 py-1 bg-loophole-bg-3'
		>
			<div className='flex items-center gap-2 text-xs'>
				<span className='text-loophole-fg-1 font-medium'>Permission required</span>
				<span className='text-loophole-fg-3 truncate'>{p.action}</span>
				{p.resources.length > 0 && <span className='text-loophole-fg-4 truncate'>· {p.resources.join(', ')}</span>}
			</div>
			{p.message && <div className='text-loophole-fg-3 text-xs mt-0.5'>{p.message}</div>}
			{error && <div className='text-red-500 text-xs mt-1'>{error}</div>}
			<div className='flex gap-2 mt-1.5'>
				<button
					type='button'
					disabled={busyId === p.id}
					className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50'
					onClick={() => void reply(p.id, 'once')}
				>
					Allow once
				</button>
				<button
					type='button'
					disabled={busyId === p.id}
					className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50'
					onClick={() => void reply(p.id, 'always')}
				>
					Allow always
				</button>
				<button
					type='button'
					disabled={busyId === p.id}
					className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50'
					onClick={() => void reply(p.id, 'reject')}
				>
					Deny
				</button>
			</div>
		</div>)}
	</div>
};
