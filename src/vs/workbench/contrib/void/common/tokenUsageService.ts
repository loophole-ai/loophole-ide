/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Garv Agnihotri, Inc. All rights reserved.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { getModelCapabilities } from './modelCapabilities.js';
import { ProviderName } from './voidSettingsTypes.js';

export const ITokenUsageService = createDecorator<ITokenUsageService>('tokenUsageService');

const TOTAL_TOKENS_STORAGE_KEY = 'loophole.totalTokensUsed';
const ESTIMATED_COST_STORAGE_KEY = 'loophole.estimatedCostUsed';
const DAILY_TOKENS_STORAGE_KEY = 'loophole.dailyTokenUsage.v2';

export type TokenUsageInfo = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	providerName?: string;
	modelName?: string;
};

export type ModelDayEntry = {
	tokens: number;
	cost: number;
};

export type DailyTokenEntry = {
	date: string;
	tokens: number;
	cost: number;
	models: Record<string, ModelDayEntry>;
};

const FREE_PROVIDERS = new Set<string>(['ollama', 'vLLM', 'lmStudio']);

export function estimateCost(tokens: TokenUsageInfo): number {
	if (!tokens.providerName || FREE_PROVIDERS.has(tokens.providerName)) return 0;
	if (!tokens.modelName) return 0;

	try {
		const caps = getModelCapabilities(tokens.providerName as ProviderName, tokens.modelName, undefined);
		const { input, output } = caps.cost;
		return (tokens.inputTokens / 1_000_000) * input + (tokens.outputTokens / 1_000_000) * output;
	} catch {
		return (tokens.inputTokens / 1_000_000) * 1.0 + (tokens.outputTokens / 1_000_000) * 3.0;
	}
}

export function formatDollarCount(amount: number): string {
	if (amount === 0) return '$0';
	const abs = Math.abs(amount);
	if (abs < 0.01) return '<$0.01';
	if (abs < 1000) return `$${amount.toFixed(2)}`;
	if (abs < 1_000_000) return `$${(amount / 1000).toFixed(1).replace(/\.0$/, '')}k`;
	if (abs < 1_000_000_000) return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	return `$${(amount / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
}

export function formatTokenCount(count: number): string {
	if (count === 0) return '0';
	const abs = Math.abs(count);
	if (abs < 1000) return count.toString();
	if (abs < 1_000_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
	if (abs < 1_000_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	if (abs < 1_000_000_000_000) return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
	return `${(count / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')}T`;
}

export interface ITokenUsageService {
	readonly _serviceBrand: undefined;
	onTokenUsageChanged: Event<void>;
	getTotalTokensUsed(): number;
	addTokens(tokens: TokenUsageInfo): void;
	getFormattedTotalTokens(): string;
	getEstimatedCost(): number;
	getFormattedEstimatedCost(): string;
	getDailyUsage(): DailyTokenEntry[];
}

export class TokenUsageService implements ITokenUsageService {
	readonly _serviceBrand: undefined;

	private readonly _onTokenUsageChanged = new Emitter<void>();
	onTokenUsageChanged: Event<void> = this._onTokenUsageChanged.event;

	private _totalTokensUsed = 0;
	private _estimatedCost = 0;
	private _dailyUsage: Map<string, { tokens: number; cost: number; models: Record<string, ModelDayEntry> }> = new Map();

	constructor(@IStorageService private readonly storageService: IStorageService) {
		const storedTokens = this.storageService.get(TOTAL_TOKENS_STORAGE_KEY, StorageScope.APPLICATION);
		if (storedTokens) this._totalTokensUsed = parseInt(storedTokens, 10) || 0;

		const storedCost = this.storageService.get(ESTIMATED_COST_STORAGE_KEY, StorageScope.APPLICATION);
		if (storedCost) this._estimatedCost = parseFloat(storedCost) || 0;

		const storedDaily = this.storageService.get(DAILY_TOKENS_STORAGE_KEY, StorageScope.APPLICATION);
		if (storedDaily) {
			try {
				const parsed: Record<string, { tokens: number; cost: number; models?: Record<string, ModelDayEntry> }> = JSON.parse(storedDaily);
				for (const [date, entry] of Object.entries(parsed)) {
					this._dailyUsage.set(date, {
						tokens: entry.tokens,
						cost: entry.cost,
						models: entry.models ?? {},
					});
				}
			} catch { }
		}
	}

	getTotalTokensUsed(): number { return this._totalTokensUsed; }

	addTokens(tokens: TokenUsageInfo): void {
		this._totalTokensUsed += tokens.totalTokens;
		const cost = estimateCost(tokens);
		this._estimatedCost += cost;

		const today = new Date().toISOString().slice(0, 10);
		const existing = this._dailyUsage.get(today) ?? { tokens: 0, cost: 0, models: {} };
		const modelKey = tokens.modelName ?? 'unknown';
		const existingModel = existing.models[modelKey] ?? { tokens: 0, cost: 0 };

		existing.tokens += tokens.totalTokens;
		existing.cost += cost;
		existing.models[modelKey] = {
			tokens: existingModel.tokens + tokens.totalTokens,
			cost: existingModel.cost + cost,
		};
		this._dailyUsage.set(today, existing);

		this.storageService.store(TOTAL_TOKENS_STORAGE_KEY, this._totalTokensUsed.toString(), StorageScope.APPLICATION, StorageTarget.USER);
		this.storageService.store(ESTIMATED_COST_STORAGE_KEY, this._estimatedCost.toString(), StorageScope.APPLICATION, StorageTarget.USER);

		const dailyObj: Record<string, { tokens: number; cost: number; models: Record<string, ModelDayEntry> }> = {};
		this._dailyUsage.forEach((v, k) => { dailyObj[k] = v; });
		this.storageService.store(DAILY_TOKENS_STORAGE_KEY, JSON.stringify(dailyObj), StorageScope.APPLICATION, StorageTarget.USER);

		this._onTokenUsageChanged.fire();
	}

	getFormattedTotalTokens(): string { return formatTokenCount(this._totalTokensUsed); }
	getEstimatedCost(): number { return this._estimatedCost; }
	getFormattedEstimatedCost(): string { return formatDollarCount(this._estimatedCost); }

	getDailyUsage(): DailyTokenEntry[] {
		return Array.from(this._dailyUsage.entries())
			.map(([date, { tokens, cost, models }]) => ({ date, tokens, cost, models }))
			.sort((a, b) => a.date.localeCompare(b.date));
	}
}

registerSingleton(ITokenUsageService, TokenUsageService, InstantiationType.Eager);
