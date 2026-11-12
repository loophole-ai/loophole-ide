/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useAccessor, useChatThreadsState } from '../util/services.js';
import type { CliUsage } from '../../../../common/sendLLMMessageTypes.js';

const formatTokens = (n: number): string => {
	if (n < 1000) return `${Math.round(n)}`;
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n / 1000)}k`;
};

const formatCost = (n: number): string => {
	if (n > 0 && n < 0.000001) return '<$0.000001';
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(n);
};

// Compact token/cost chip for the active CLI session.
// Data path: Session.Info (cumulative) on bind + live `session.usage.updated`
// via chatThreadService.updateCliUsage; rendered from thread state.
export const CliUsageChip = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')
	const configService = accessor.get('IConfigurationService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const threadsState = useChatThreadsState()
	const cliEnabled = configService.getValue<boolean>('loophole.cli.enabled') === true
	const cliSessionId = threadsState.allThreads[threadId]?.state.cliSessionId
	const usage = threadsState.allThreads[threadId]?.state.cliUsage as CliUsage | undefined
	const [loading, setLoading] = useState(false)

	// Refresh cumulative usage from Session.Info whenever the bound session changes,
	// and poll while it is bound: `session.usage.updated` can arrive before a thread
	// is bound, which left the chip showing the previous session's numbers.
	useEffect(() => {
		if (!cliEnabled || !cliSessionId) return;
		let cancelled = false;
		const load = () => {
			cliService.session(cliSessionId)
				.then((info) => {
					if (cancelled) return;
					if (info && info.tokens) {
						chatThreadsService.updateCliUsage(threadId, {
							cost: typeof info.cost === 'number' ? info.cost : 0,
							tokens: {
								input: info.tokens.input ?? 0,
								output: info.tokens.output ?? 0,
								reasoning: info.tokens.reasoning ?? 0,
								cache: { read: info.tokens.cache?.read ?? 0, write: info.tokens.cache?.write ?? 0 },
							},
						})
					}
				})
				.catch(() => { /* best effort — live usage.updated still updates the chip */ })
		}
		setLoading(true)
		load()
		const timer = window.setInterval(load, 5000)
		return () => { cancelled = true; window.clearInterval(timer); }
	}, [cliService, chatThreadsService, cliEnabled, cliSessionId, threadId])

	if (!cliEnabled) return null;
	if (!cliSessionId || !usage) {
		return loading ? <span className='text-loophole-fg-4 text-xs'>…</span> : null;
	}

	const { tokens } = usage
	const title = `Input ${Math.round(tokens.input).toLocaleString()} · Output ${Math.round(tokens.output).toLocaleString()} · Reasoning ${Math.round(tokens.reasoning).toLocaleString()} · Cache read ${Math.round(tokens.cache.read).toLocaleString()} / write ${Math.round(tokens.cache.write).toLocaleString()} · Cost ${formatCost(usage.cost)}`;

	return <span
		className='text-loophole-fg-3 text-xs whitespace-nowrap cursor-default'
		title={title}
	>
		<span>↑ {formatTokens(tokens.input)}</span>
		{' · '}
		<span>↓ {formatTokens(tokens.output)}</span>
		{' · '}
		<span>{formatCost(usage.cost)}</span>
	</span>
};
