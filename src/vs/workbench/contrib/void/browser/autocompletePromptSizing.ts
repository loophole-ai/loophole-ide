/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *------------------------------------------------------------------------------------*/

/**
 * Prefix/suffix sizing for inline completions.
 *
 * The previous behaviour was a flat 25 lines either side of the cursor. That is wrong in
 * both directions: 25 lines of minified or dense code can be far more than the budget,
 * while 25 lines inside a wide block of indentation can be worth almost nothing. We size
 * by tokens instead, and trim whole lines from the far end so we never cut a line in half
 * (a half-line prefix makes the model's FIM prompt malformed).
 */

import { estimateTokens } from '../common/tokenizer.js';

/**
 * Total budget for prefix + suffix.
 *
 * Defaults to 2048. An earlier value of 1024 was small enough that on a large file the
 * model saw only a sliver of what the user had open - it had enough local context to
 * finish the line but not enough to know what the line was for.
 *
 * Overridable per user in settings; see `GlobalSettings.autocompleteContextTokens`.
 */
export const DEFAULT_MAX_PROMPT_TOKENS = 2048

/**
 * How the budget is split. The prefix carries the code being written and the suffix tells
 * the model what comes next - both matter, but the prefix matters more.
 */
export const PREFIX_PERCENTAGE = 0.35;
export const SUFFIX_PERCENTAGE = 0.25;

/** Hard line cap, so a very large window can't produce an enormous string to scan. */
const MAX_LINES = 500;

/**
 * Resolve the budget for a request. Clamped so a typo in settings cannot ask for zero
 * context (which would silently break completions) or an unbounded amount.
 */
export const resolveMaxPromptTokens = (userSetting: number | undefined | null): number => {
	if (typeof userSetting !== 'number' || !Number.isFinite(userSetting)) {
		return DEFAULT_MAX_PROMPT_TOKENS
	}
	return Math.max(256, Math.min(16384, Math.floor(userSetting)))
}

type Budget = { maxPrefixTokens: number, maxSuffixTokens: number }

const budgetOf = (maxPromptTokens: number): Budget => ({
	maxPrefixTokens: Math.floor(maxPromptTokens * PREFIX_PERCENTAGE),
	maxSuffixTokens: Math.floor(maxPromptTokens * SUFFIX_PERCENTAGE),
})

/**
 * Drop whole lines from the TOP of the prefix (farthest from the cursor) until it fits.
 * We always keep the line the cursor is on.
 */
export const prunePrefix = (prefix: string, ln: string, maxTokens?: number, maxPromptTokens?: number): string => {
	const budget = budgetOf(resolveMaxPromptTokens(maxPromptTokens))
	const limit = maxTokens ?? budget.maxPrefixTokens

	let lines = prefix.split(ln);
	if (lines.length > MAX_LINES) {
		lines = lines.slice(-MAX_LINES);
	}
	if (lines.length <= 1) { return prefix; }

	while (lines.length > 1) {
		if (estimateTokens(lines.join(ln)) <= limit) { break; }
		lines = lines.slice(1);
	}
	return lines.join(ln);
};

/**
 * Drop whole lines from the BOTTOM of the suffix (farthest from the cursor) until it fits.
 * The line directly right of the cursor is always kept - it is what decides whether the
 * cursor is at the end of a line or in the middle of one.
 */
export const pruneSuffix = (suffix: string, ln: string, maxTokens?: number, maxPromptTokens?: number): string => {
	const budget = budgetOf(resolveMaxPromptTokens(maxPromptTokens))
	const limit = maxTokens ?? budget.maxSuffixTokens

	let lines = suffix.split(ln);
	if (lines.length > MAX_LINES) {
		lines = lines.slice(0, MAX_LINES);
	}
	if (lines.length <= 1) { return suffix; }

	while (lines.length > 1) {
		if (estimateTokens(lines.join(ln)) <= limit) { break; }
		lines = lines.slice(0, lines.length - 1);
	}
	return lines.join(ln);
};
