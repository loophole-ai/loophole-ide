/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * expertCanvasStore — singleton pub/sub store.
 * Both ExpertCanvas (sidebar) and ExpertCanvasPage (editor tab) subscribe to this.
 *
 * What lives here is *transient run state*: the goal, who is running, and each
 * expert's transcript for this run. Per-expert model choice, enabled flag, and
 * edit approval live in the `loophole.experts.*` settings instead, so they
 * survive a reload.
 */

import { ExpertState, ExpertMessage, CanvasState, ExpertStatus, resetExperts } from './expertCanvasRunState.js';
export { ExpertState, ExpertMessage, CanvasState, ExpertStatus };

// ── Shared model helpers ──────────────────────────────────────────────────────
//
// Models come from the Loophole CLI (`ILoopholeCliService.models()`), the same list
// the chat's model picker uses, so every provider connected in the CLI works here.
// A model is stored as "providerID/modelID". An expert with no choice runs on the
// chat model, so a fresh install needs no configuration at all.

export const inheritLabel = 'Same as Chat';

export const expertsModelsSettingId = 'loophole.experts.models';
export const expertsDisabledSettingId = 'loophole.experts.disabled';
export const expertsAutoApproveSettingId = 'loophole.experts.autoApprove';

type ConfigReader = { getValue: <T>(key: string) => T | undefined };

/** The model the user picked for this expert, or '' when it follows the chat model. */
export const expertModelRef = (config: ConfigReader, expertId: string): string =>
	(config.getValue<Record<string, string>>(expertsModelsSettingId) ?? {})[expertId] ?? '';

/** Short label for a "providerID/modelID" ref, or the inherit label when empty. */
export const modelLabel = (ref: string): string => ref || inheritLabel;

export const enabledExpertIds = (config: ConfigReader, allIds: string[]): string[] => {
	const disabled = config.getValue<string[]>(expertsDisabledSettingId) ?? [];
	return allIds.filter(id => !disabled.includes(id));
};

// ── Tool activity, for the UI ────────────────────────────────────────────────

export type ToolActivityStatus = 'pending' | 'awaiting-approval' | 'running' | 'success' | 'rejected' | 'error';

export interface ToolActivity {
	id: string;
	expertId: string;
	toolName: string;
	/** Short human summary, e.g. `create index.html`. */
	title: string;
	status: ToolActivityStatus;
	/** Populated for `success` (the model already saw it) and for `error`. */
	result?: string;
	/** Validated params, needed to run the call for real once approved. */
	params?: Record<string, any>;
	toolCallId: string;
}

class ExpertCanvasStore {
	private state: CanvasState = {
		currentGoal: '',
		isRunning: false,
		experts: resetExperts(),
	};

	private toolActivities: ToolActivity[] = [];
	/** Resolves when the user approves or rejects a pending tool. */
	private approvalWaiters = new Map<string, (approved: boolean) => void>();

	private listeners = new Set<() => void>();

	getState(): CanvasState {
		return this.state;
	}

	getToolActivities(): ToolActivity[] {
		return this.toolActivities;
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private notify() {
		this.listeners.forEach(fn => fn());
	}

	// ---- Mutations ----

	/**
	 * Full team run. Starts a clean slate for every expert: no transcripts, no
	 * tool activity, all statuses back to idle. Model choices are untouched
	 * because they live in settings, not here.
	 */
	reset(goal: string, enabledIds: string[]) {
		// A previous run could still be parked on an approval decision. Clearing
		// the activity list without releasing those waiters would leave that run's
		// promise unresolved forever.
		this.rejectAllApprovals();

		const experts = resetExperts().filter(e => enabledIds.includes(e.id));
		this.state = { currentGoal: goal, isRunning: true, experts };
		this.toolActivities = [];
		this.notify();
	}

	/** Direct @mention — only resets the named expert, keeps others intact. */
	directMessage(expertId: string, goal: string) {
		this.rejectAllApprovals();
		this.state = {
			...this.state,
			currentGoal: goal,
			isRunning: true,
			experts: this.state.experts.map(e =>
				e.id === expertId
					? { ...e, status: 'idle' as ExpertStatus, messages: [], toolActivities: [] }
					: e
			),
		};
		this.notify();
	}

	setRunning(running: boolean) {
		this.state = { ...this.state, isRunning: running };
		this.notify();
	}

	setExpertStatus(expertId: string, status: ExpertStatus) {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e =>
				e.id === expertId ? { ...e, status } : e
			),
		};
		this.notify();
	}

	/**
	 * Mark an expert as skipped. "Skipped" is not a status the old four-state
	 * model had, and it matters: previously Nora and Elena sat at "Pending"
	 * forever with no explanation, which read as "still working" rather than
	 * "Sara decided they were not needed".
	 */
	skipExpert(expertId: string, reason: string) {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e =>
				e.id === expertId ? { ...e, status: 'skipped' as ExpertStatus, skipReason: reason } : e
			),
		};
		this.notify();
	}

	addUserMessage(expertId: string, content: string) {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e =>
				e.id === expertId
					? { ...e, messages: [...e.messages, { role: 'user' as const, content, isStreaming: false }] }
					: e
			),
		};
		this.notify();
	}

	beginAssistantMessage(expertId: string) {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e =>
				e.id === expertId
					? { ...e, messages: [...e.messages, { role: 'assistant' as const, content: '', isStreaming: true }] }
					: e
			),
		};
		this.notify();
	}

	appendToLastMessage(expertId: string, newText: string) {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e => {
				if (e.id !== expertId) return e;
				const msgs = [...e.messages];
				const last = msgs[msgs.length - 1];
				if (!last) return e;
				msgs[msgs.length - 1] = { ...last, content: last.content + newText };
				return { ...e, messages: msgs };
			}),
		};
		this.notify();
	}

	finalizeLastMessage(expertId: string) {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e => {
				if (e.id !== expertId) return e;
				const msgs = [...e.messages];
				const last = msgs[msgs.length - 1];
				if (!last) return e;
				msgs[msgs.length - 1] = { ...last, isStreaming: false };
				return { ...e, messages: msgs };
			}),
		};
		this.notify();
	}

	// ---- Tool activity ----

	private updateToolActivity(id: string, patch: Partial<ToolActivity>) {
		this.toolActivities = this.toolActivities.map(t => (t.id === id ? { ...t, ...patch } : t));
		this.notify();
	}

	/** Called when the model asks for a tool that needs the user's OK. */
	beginToolActivity(expertId: string, toolName: string, title: string, toolCallId: string, status: ToolActivityStatus, params?: Record<string, any>): string {
		const id = `${expertId}-${toolCallId}`;
		const existing = this.toolActivities.find(t => t.id === id);
		// A repeated call with the same id is a retry of the same request, not a
		// new one, so update in place rather than stacking a second pending row the
		// user would have to answer twice.
		if (existing) {
			this.updateToolActivity(id, { status, params });
			return id;
		}
		this.toolActivities = [...this.toolActivities, { id, expertId, toolName, title, status, toolCallId, params }];
		this.notify();
		return id;
	}

	setToolActivityStatus(id: string, status: ToolActivityStatus, result?: string) {
		this.updateToolActivity(id, result === undefined ? { status } : { status, result });
	}

	/** Drops a tool's params once it is done, so the UI is not holding file contents. */
	clearToolParams(id: string) {
		this.updateToolActivity(id, { params: undefined });
	}

	/**
	 * Waits for the user to approve or reject `id`. Resolves true when approved.
	 * Any pending approvals are auto-rejected when a run is cancelled, so the
	 * agent loop can never be left hanging on a promise nobody will resolve.
	 */
	waitForApproval(id: string): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			this.approvalWaiters.set(id, resolve);
		});
	}

	resolveApproval(id: string, approved: boolean) {
		const waiter = this.approvalWaiters.get(id);
		if (!waiter) { return; }
		this.approvalWaiters.delete(id);
		this.setToolActivityStatus(id, approved ? 'running' : 'rejected',
			approved ? undefined : 'Rejected by user.');
		waiter(approved);
	}

	/** Reject everything still waiting. Called on abort/reset. */
	rejectAllApprovals() {
		for (const id of [...this.approvalWaiters.keys()]) {
			this.resolveApproval(id, false);
		}
	}
}

// Singleton — both sidebar and canvas page share this
export const expertCanvasStore = new ExpertCanvasStore();
