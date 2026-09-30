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

/** Roughly what Continue uses; keeps the request small enough to stay interactive. */
export const MAX_PROMPT_TOKENS = 1024;

/**
 * How the budget is split. The prefix carries the code being written and the suffix tells
 * the model what comes next - both matter, but the prefix matters more.
 */
export const PREFIX_PERCENTAGE = 0.35;
export const SUFFIX_PERCENTAGE = 0.25;

const MAX_PREFIX_TOKENS = Math.floor(MAX_PROMPT_TOKENS * PREFIX_PERCENTAGE);
const MAX_SUFFIX_TOKENS = Math.floor(MAX_PROMPT_TOKENS * SUFFIX_PERCENTAGE);

/** Hard line cap, so a very large window can't produce an enormous string to scan. */
const MAX_LINES = 300;

/**
 * Drop whole lines from the TOP of the prefix (farthest from the cursor) until it fits.
 * We always keep the line the cursor is on.
 */
export const prunePrefix = (prefix: string, ln: string, maxTokens: number = MAX_PREFIX_TOKENS): string => {
	let lines = prefix.split(ln);
	if (lines.length > MAX_LINES) {
		lines = lines.slice(-MAX_LINES);
	}
	if (lines.length <= 1) { return prefix; }

	while (lines.length > 1) {
		if (estimateTokens(lines.join(ln)) <= maxTokens) { break; }
		lines = lines.slice(1);
	}
	return lines.join(ln);
};

/**
 * Drop whole lines from the BOTTOM of the suffix (farthest from the cursor) until it fits.
 * The line directly right of the cursor is always kept - it is what decides whether the
 * cursor is at the end of a line or in the middle of one.
 */
export const pruneSuffix = (suffix: string, ln: string, maxTokens: number = MAX_SUFFIX_TOKENS): string => {
	let lines = suffix.split(ln);
	if (lines.length > MAX_LINES) {
		lines = lines.slice(0, MAX_LINES);
	}
	if (lines.length <= 1) { return suffix; }

	while (lines.length > 1) {
		if (estimateTokens(lines.join(ln)) <= maxTokens) { break; }
		lines = lines.slice(0, lines.length - 1);
	}
	return lines.join(ln);
};
