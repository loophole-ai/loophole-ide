/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * expertCanvasRunState — the types for a single Expert Canvas run, plus the
 * one place the roster is instantiated.
 *
 * Split out of expertCanvasStore so that the expert types can be imported
 * without pulling in the store's runtime (and, through it, the avatar imports).
 */

import { EXPERTS, ExpertDef } from './expertDefs.js';

export interface ExpertMessage {
	role: 'user' | 'assistant';
	content: string;
	isStreaming: boolean;
}

/**
 * `skipped` was added because Nora and Elena used to sit at "Pending" for the
 * whole run: the old pipeline simply never called them, so the UI could not
 * distinguish "has not started yet" from "was never asked to do anything".
 */
export type ExpertStatus = 'idle' | 'working' | 'done' | 'failed' | 'skipped';

export interface ExpertState extends ExpertDef {
	status: ExpertStatus;
	/** Why this expert was not asked to work. Only set when status is 'skipped'. */
	skipReason?: string;
	messages: ExpertMessage[];
	/** Tool calls this expert made, in order. Mirrors the store's activity list. */
	toolActivities: string[];
}

// `messages` and `toolActivities` are set here rather than on each entry so a
// fresh transcript cannot be half-specified.
export const resetExperts = (): ExpertState[] =>
	EXPERTS.map(e => ({
		...e,
		status: 'idle' as ExpertStatus,
		messages: [],
		toolActivities: [],
	}));

export interface CanvasState {
	currentGoal: string;
	isRunning: boolean;
	experts: ExpertState[];
}
