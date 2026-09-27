/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * expertCanvasStore — singleton pub/sub store.
 * Both ExpertCanvas (sidebar) and ExpertCanvasPage (editor tab) subscribe to this.
 */

export type ExpertStatus = 'idle' | 'working' | 'done' | 'failed';

export interface ExpertMessage {
	role: 'user' | 'assistant';
	content: string;
	isStreaming: boolean;
}

export interface ExpertState {
	id: string;
	name: string;
	role: string;
	model: string;
	status: ExpertStatus;
	messages: ExpertMessage[];
}

export interface CanvasState {
	currentGoal: string;
	isRunning: boolean;
	experts: ExpertState[];
}

const DEFAULT_EXPERTS: ExpertState[] = [
	{ id: 'sara',  name: 'Sara',  role: 'Team Lead',      model: 'claude-opus-5',             status: 'idle', messages: [] },
	{ id: 'leo',   name: 'Leo',   role: 'Researcher',     model: 'claude-opus-5',             status: 'idle', messages: [] },
	{ id: 'karl',  name: 'Karl',  role: 'Engineer',       model: 'claude-sonnet-5',           status: 'idle', messages: [] },
	{ id: 'jake',  name: 'Jake',  role: 'QA Engineer',    model: 'claude-sonnet-5',           status: 'idle', messages: [] },
	{ id: 'ray',   name: 'Ray',   role: 'Code Reviewer',  model: 'claude-sonnet-5',           status: 'idle', messages: [] },
	{ id: 'nora',  name: 'Nora',  role: 'Debug Engineer', model: 'claude-opus-5',             status: 'idle', messages: [] },
	{ id: 'elena', name: 'Elena', role: 'UI/UX Operator', model: 'claude-sonnet-5',           status: 'idle', messages: [] },
	{ id: 'max',   name: 'Max',   role: 'Docs Writer',    model: 'claude-haiku-4-5-20251001', status: 'idle', messages: [] },
];

const resetExperts = (): ExpertState[] =>
	DEFAULT_EXPERTS.map(e => ({ ...e, messages: [], status: 'idle' as ExpertStatus }));

class ExpertCanvasStore {
	private state: CanvasState = {
		currentGoal: '',
		isRunning: false,
		experts: resetExperts(),
	};

	private listeners = new Set<() => void>();

	getState(): CanvasState {
		return this.state;
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private notify() {
		this.listeners.forEach(fn => fn());
	}

	// ---- Mutations ----

	/** Full team run — resets all experts */
	reset(goal: string) {
		this.state = {
			currentGoal: goal,
			isRunning: true,
			experts: resetExperts(),
		};
		this.notify();
	}

	/** Direct @mention — only resets the named expert, keeps others intact */
	directMessage(expertId: string, goal: string) {
		this.state = {
			...this.state,
			currentGoal: goal,
			isRunning: true,
			experts: this.state.experts.map(e =>
				e.id === expertId
					? { ...e, status: 'idle' as ExpertStatus, messages: [] }
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
}

// Singleton — both sidebar and canvas page share this
export const expertCanvasStore = new ExpertCanvasStore();
