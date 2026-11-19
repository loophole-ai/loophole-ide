/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { FileText, Globe, Shield, Terminal } from 'lucide-react';
import { useAccessor, useChatThreadsState, useCliPermissions } from '../util/services.js';
import type { LoopholeCliPermissionDecision, LoopholeCliPermissionRequest } from '../../../../../../../workbench/contrib/void/common/loopholeCliTypes.js';
import { domainOf, permissionDetailOf, permissionTitleOf, splitPath } from './tool-ui/toolData.js';
import { ChangeCounts, DiffRows, parsePatch } from './tool-ui/ToolCard.js';

const PermissionItem = ({ request, busy, error, onReply }: {
	request: LoopholeCliPermissionRequest,
	busy: boolean,
	error: string | null,
	onReply: (decision: LoopholeCliPermissionDecision) => void,
}) => {
	const detail = permissionDetailOf(request.action, request.resources, request.metadata)
	const diff = detail.kind === 'file' ? detail.diff : undefined
	const rows = useMemo(() => diff ? parsePatch(diff) : [], [diff])
	const [showDiff, setShowDiff] = useState(false)
	const added = rows.filter((row) => row.kind === 'add').length
	const removed = rows.filter((row) => row.kind === 'del').length
	const Icon = detail.kind === 'command' ? Terminal : detail.kind === 'file' ? FileText : detail.kind === 'url' ? Globe : Shield
	const file = detail.kind === 'file' ? splitPath(detail.path) : undefined

	return <div className='w-full border border-loophole-border-1 rounded px-2 py-1.5 bg-loophole-bg-3'>
		<div className='flex items-center gap-2 text-xs'>
			<Icon size={14} className='text-loophole-fg-4 flex-shrink-0' />
			<span className='text-loophole-fg-1 font-medium flex-shrink-0'>{permissionTitleOf(request.action)}</span>
			<span className='text-loophole-fg-3 truncate'>needs your approval</span>
		</div>
		<div className='flex flex-col gap-1 mt-1.5 min-w-0'>
			{detail.kind === 'command' && <pre className='m-0 font-mono text-xs text-loophole-fg-2 bg-loophole-bg-1 rounded p-1.5 whitespace-pre-wrap break-all max-h-[120px] overflow-auto select-text'>
				<span className='text-loophole-fg-4'>$ </span>{detail.command}
			</pre>}
			{file && <div className='flex items-center gap-1.5 text-xs min-w-0'>
				<span className='font-medium text-loophole-fg-2 flex-shrink-0 max-w-[60%] truncate'>{file.name}</span>
				<span className='text-[11px] text-loophole-fg-4 truncate min-w-0'>{file.dir}</span>
				<ChangeCounts added={added} removed={removed} />
			</div>}
			{rows.length > 0 && <button
				type='button'
				className='self-start text-[11px] text-[var(--vscode-textLink-foreground)] hover:underline'
				onClick={() => setShowDiff((value) => !value)}
			>{showDiff ? 'Hide changes' : 'Show changes'}</button>}
			{showDiff && rows.length > 0 && <div className='border border-loophole-border-3 rounded overflow-auto max-h-[160px] font-mono text-[11px] leading-[1.45] select-text'>
				<DiffRows rows={rows} />
			</div>}
			{detail.kind === 'url' && <div className='flex flex-col min-w-0'>
				<span className='text-xs font-medium text-loophole-fg-2 truncate'>{domainOf(detail.url)}</span>
				<span className='text-[11px] text-loophole-fg-4 break-all'>{detail.url}</span>
			</div>}
			{detail.kind === 'other' && request.resources.length > 0 && <span className='text-xs text-loophole-fg-4 break-all'>{request.resources.join(', ')}</span>}
		</div>
		{request.message && <div className='text-loophole-fg-3 text-xs mt-1'>{request.message}</div>}
		{error && <div className='text-red-500 text-xs mt-1'>{error}</div>}
		<div className='flex gap-2 mt-2'>
			<button
				type='button'
				disabled={busy}
				className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50'
				onClick={() => onReply('once')}
			>
				Allow once
			</button>
			<button
				type='button'
				disabled={busy}
				className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50'
				onClick={() => onReply('always')}
			>
				Allow always
			</button>
			<button
				type='button'
				disabled={busy}
				className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50'
				onClick={() => onReply('reject')}
			>
				Deny
			</button>
		</div>
	</div>
}

// Tool approval card for the Loophole CLI (`permission.asked`).
// Wired to POST /api/session/:id/permission/:requestID/reply via
// ILoopholeCliService.permissionReply; decision maps once/always/reject.
export const CliPermissionCard = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const cliService = accessor.get('ILoopholeCliService')
	const threadsState = useChatThreadsState()
	const permissions = useCliPermissions(threadId)
	const sessionID = threadsState.allThreads[threadId]?.state.cliSessionId
	const [busyId, setBusyId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	if (!sessionID || permissions.length === 0) return null;

	const reply = async (request: LoopholeCliPermissionRequest, decision: LoopholeCliPermissionDecision) => {
		setBusyId(request.id)
		setError(null)
		const replySessionID = request.sessionID || sessionID
		try {
			await cliService.permissionReply(replySessionID, request.id, decision)
			chatThreadsService.clearCliPermission(threadId, request.id)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusyId(null)
		}
	}

	return <div className='flex flex-col gap-1 w-full'>
		{permissions.map((p) => <PermissionItem
			key={p.id}
			request={p}
			busy={busyId === p.id}
			error={error}
			onReply={(decision) => void reply(p, decision)}
		/>)}
	</div>
};
