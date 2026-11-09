/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useAccessor, useChatThreadsState } from '../util/services.js';
import type { ServeUsage } from '../../../../common/sendLLMMessageTypes.js';

const formatTokens = (n: number): string => {
	if (n < 1000) return `${Math.round(n)}`;
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n / 1000)}k`;
};

const formatCost = (n: number): string => {
	if (n > 0 && n < 0.000001) return '<$0.000001';
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(n);
};

// Compact token/cost chip for the active serve session (Kilo TaskUsage look).
// Data path: Session.Info (cumulative) on bind + live `session.usage.updated`
// via chatThreadService.updateServeUsage; rendered from thread state.
export const ServeUsageChip = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const serveService = accessor.get('ILoopholeServeService')
	const configService = accessor.get('IConfigurationService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const threadsState = useChatThreadsState()
	const serveEnabled = configService.getValue<boolean>('loophole.serve.enabled') === true
	const serveSessionId = threadsState.allThreads[threadId]?.state.serveSessionId
	const usage = threadsState.allThreads[threadId]?.state.serveUsage as ServeUsage | undefined
	const [loading, setLoading] = useState(false)

	// Refresh cumulative usage from Session.Info whenever the bound session changes.
	useEffect(() => {
		if (!serveEnabled || !serveSessionId) return;
		let cancelled = false;
		setLoading(true)
		serveService.session(serveSessionId)
			.then((info) => {
				if (cancelled) return;
				if (info && info.tokens) {
					chatThreadsService.updateServeUsage(threadId, {
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
			.finally(() => { if (!cancelled) setLoading(false); })
		return () => { cancelled = true; }
	}, [serveService, chatThreadsService, serveEnabled, serveSessionId, threadId])

	if (!serveEnabled) return null;
	if (!serveSessionId || !usage) {
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
