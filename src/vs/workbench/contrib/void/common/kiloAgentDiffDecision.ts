/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// The decision half of the diff bridge, as a pure function.
//
// `KiloAgentDiffBridge` has to do I/O - open a text model, read the buffer, ask the edit
// service to stage a zone - which makes the part that actually matters (what to do with a
// given edit, and in what order) awkward to test. The ordering in particular is subtle: the
// "nothing to review" check has to happen *before* the buffer is rewritten, or a file that
// VS Code already auto-reloaded gets blanked and then reported as a no-op.
//
// This module holds that decision. Tests live in `common/test/kiloAgentDiffDecision.test.ts`.

import { KiloAgentFileDiff } from './kiloAgentTypes.js';

export type EngineEditPlan =
	| { kind: 'stage'; file: string; before: string; after: string }
	| { kind: 'no-op'; file: string }
	| { kind: 'unsaved-conflict'; file: string }
	| { kind: 'unsupported'; file: string; reason: string };

/** Statuses the engine reports that map onto a reviewable change. */
export function isStageableStatus(status: KiloAgentFileDiff['status']): boolean {
	return status === 'added' || status === 'modified' || status === 'deleted';
}

/**
 * Decides what to do with one engine edit.
 *
 * `currentText` is what the text model holds right now, and `isDirty` whether the user has
 * unsaved changes in it.
 */
export function planEngineEdit(opts: {
	diff: KiloAgentFileDiff;
	currentText: string;
	isDirty: boolean;
	/** false when the user turned diff review off, in which case we only report no-ops */
	showDiffs: boolean;
}): EngineEditPlan {
	const { diff, currentText, isDirty, showDiffs } = opts;
	const file = diff.file;

	if (!file) return { kind: 'unsupported', file: '', reason: 'the engine did not report a file path' };
	if (!isStageableStatus(diff.status)) return { kind: 'unsupported', file, reason: `unknown status ${String(diff.status)}` };

	// A created file has no `before` and a deleted one has no `after`; both are still stageable
	// because the missing side is the empty string. Without both sides we cannot promise that a
	// reject restores the file exactly, so refuse rather than risk a lossy review.
	const before = diff.before ?? (diff.status === 'added' ? '' : undefined);
	const after = diff.after ?? (diff.status === 'deleted' ? '' : undefined);
	if (before === undefined || after === undefined) {
		return { kind: 'unsupported', file, reason: 'the engine did not return both sides of the change' };
	}

	if (!showDiffs) return { kind: 'no-op', file };

	// The user has unsaved work the engine never saw. Overwriting their buffer - even behind a
	// diff zone - would quietly destroy it, so refuse and let the caller tell the model which
	// file to leave alone.
	if (isDirty && currentText !== before) return { kind: 'unsaved-conflict', file };

	// Checked before anything mutates the buffer. VS Code reloads a *clean* buffer when the
	// engine rewrites the file underneath it, so the common case is a model that already holds
	// `after`; rewriting to `before` first would blank the editor and then report no-op.
	if (currentText === after && !isDirty) return { kind: 'no-op', file };

	return { kind: 'stage', file, before, after };
}
