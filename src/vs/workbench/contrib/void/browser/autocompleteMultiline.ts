/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *------------------------------------------------------------------------------------*/

/**
 * Deciding whether an inline completion should be a whole block rather than a single line.
 *
 * Kept separate from the service (and free of VS Code imports) because this is the single
 * decision most likely to produce a visibly wrong suggestion, and it is pure string logic
 * that can be tested directly.
 *
 * The invariant that keeps this safe: a block is only ever offered when there is nothing to
 * the right of the cursor. Accepting a block that replaced existing text on the line would
 * silently delete the user's code, so no setting can turn that on.
 */

// Type-only import: erased at runtime, so this module stays importable by the standalone
// test harness while keeping one source of truth for the mode names.
import type { MultilineCompletionsMode } from '../common/voidSettingsTypes.js'

export type MultilineContext = {
	/** Text on the cursor's line, left of the cursor. */
	prefixToTheLeftOfCursor: string
	/** Text on the cursor's line, right of the cursor. */
	suffixToTheRightOfCursor: string
}

export const shouldCompleteMultiline = (
	mode: MultilineCompletionsMode,
	context: MultilineContext,
	/** True when the user accepted a suggestion within the last few hundred ms. */
	justAcceptedAutocompletion: boolean,
): boolean => {

	// A block replaces the rest of the line, so it is only safe where there is no rest of
	// the line. This applies in every mode - a setting must never be able to delete the
	// text you already typed.
	if (context.suffixToTheRightOfCursor.trim()) { return false }

	if (mode === 'never') { return false }
	if (mode === 'always') { return true }

	// --- auto ---

	// Chaining: the user is taking suggestions a block at a time, so give them the next one
	// without making them press Enter.
	if (justAcceptedAutocompletion) { return true }

	const before = context.prefixToTheLeftOfCursor

	// Enter on a blank line is the universal "put a body here" gesture. Covers the common
	// case of the editor having already indented the cursor onto its own line, and also
	// covers `if (x)` / `for (...)` where the user pressed Enter before typing a brace.
	if (!before.trim()) { return true }

	// Directly after a block opener, where the body has to be indented.
	if (/[{]\s*$/.test(before)) { return true }

	// Python-style block header, and `case`/`default` labels. Excluded when the line looks
	// like a ternary, where the colon is followed by an expression, not a block.
	if (!before.includes('?') && /:\s*$/.test(before)) { return true }

	// Control-flow keywords whose body is always an indented block.
	//
	// Deliberately NOT `return` or `throw` (those are followed by an expression on the same
	// line) and NOT `=>` (an arrow body is very often an expression - `arr.map(x =>` wants
	// `x * 2`, not a block). Offering a block there produces confidently wrong code.
	if (/\b(else|do|try|finally)\b[^;{]*$/.test(before)) { return true }

	return false
}
