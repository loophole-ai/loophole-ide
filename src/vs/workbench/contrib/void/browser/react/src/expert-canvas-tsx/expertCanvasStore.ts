/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * expertCanvasStore — singleton pub/sub store.
 * Both ExpertCanvas (sidebar) and ExpertCanvasPage (editor tab) subscribe to this.
 */

import { ModelOption, VoidSettingsState } from '../../../../common/voidSettingsService.js';
import {
	displayInfoOfProviderName,
	ModelSelection,
	modelSelectionsEqual,
	ProviderName,
} from '../../../../common/voidSettingsTypes.js';

// ── Shared model helpers ──────────────────────────────────────────────────────
//
// Used by both the sidebar (ExpertCanvas) and the canvas tab (ExpertCanvasPage).
// Nothing here is provider-specific. The lists come from the user's own settings
// (`_modelOptions`), so this works with whatever they have actually configured:
// OpenRouter, Ollama, LM Studio, an OpenAI-compatible endpoint, or a cloud
// provider. An expert with no explicit choice inherits the model the user picked
// for Chat, so a fresh install needs no configuration at all.

export const inheritLabel = 'Same as Chat';

/** The model an expert will actually run on, or null if nothing is available. */
export const resolveModel = (
	expertModel: ModelSelection | null,
	settingsState: VoidSettingsState,
): ModelSelection | null => {
	const options = settingsState._modelOptions;
	if (expertModel) {
		// The expert's model may have been removed from settings since it was
		// chosen, so fall back rather than sending an unusable selection.
		const stillThere = options.find(o => modelSelectionsEqual(o.selection, expertModel));
		if (stillThere) { return stillThere.selection; }
	}
	const chatModel = settingsState.modelSelectionOfFeature.Chat;
	if (chatModel) {
		const match = options.find(o => modelSelectionsEqual(o.selection, chatModel));
		if (match) { return match.selection; }
	}
	return options.length > 0 ? options[0].selection : null;
};

export const modelLabel = (selection: ModelSelection | null): string =>
	selection
		? `${displayInfoOfProviderName(selection.providerName).title} / ${selection.modelName}`
		: 'No model';

/** Providers that have at least one usable model, in first-seen order. */
export const providerNamesOfOptions = (options: ModelOption[]): ProviderName[] => {
	const seen: ProviderName[] = [];
	for (const o of options) {
		if (!seen.includes(o.selection.providerName)) { seen.push(o.selection.providerName); }
	}
	return seen;
};

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
	/**
	 * Provider + model this expert runs on. `null` means "inherit whatever the
	 * user has selected for Chat", which is the default so a fresh install
	 * works with the provider they already configured. Never hard-code a
	 * provider here - the available list comes from the user's own settings.
	 */
	model: ModelSelection | null;
	status: ExpertStatus;
	messages: ExpertMessage[];
}

export interface CanvasState {
	currentGoal: string;
	isRunning: boolean;
	experts: ExpertState[];
}

// `messages` is left off each entry on purpose: `resetExperts` below is the one
// place transcripts are created, so a fresh transcript cannot be half-specified.
const DEFAULT_EXPERTS: Omit<ExpertState, 'model' | 'messages'>[] = [
	{ id: 'sara',  name: 'Sara',  role: 'Team Lead',      status: 'idle' },
	{ id: 'leo',   name: 'Leo',   role: 'Researcher',     status: 'idle' },
	{ id: 'karl',  name: 'Karl',  role: 'Engineer',       status: 'idle' },
	{ id: 'jake',  name: 'Jake',  role: 'QA Engineer',    status: 'idle' },
	{ id: 'ray',   name: 'Ray',   role: 'Code Reviewer',  status: 'idle' },
	{ id: 'nora',  name: 'Nora',  role: 'Debug Engineer', status: 'idle' },
	{ id: 'elena', name: 'Elena', role: 'UI/UX Operator', status: 'idle' },
	{ id: 'max',   name: 'Max',   role: 'Docs Writer',    status: 'idle' },
];

const resetExperts = (): ExpertState[] =>
	DEFAULT_EXPERTS.map(e => ({ ...e, model: null, messages: [], status: 'idle' as ExpertStatus }));

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

	/** Full team run — clears transcripts, but keeps each expert's chosen model. */
	reset(goal: string) {
		this.state = {
			currentGoal: goal,
			isRunning: true,
			experts: this.state.experts.map(e => ({
				...e,
				status: 'idle' as ExpertStatus,
				messages: [],
			})),
		};
		this.notify();
	}

	/** Clears transcripts everywhere and drops all model choices back to "inherit". */
	resetModelsToDefault() {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e => ({ ...e, model: null })),
		};
		this.notify();
	}

	/** Per-expert provider + model. `null` means inherit the Chat selection. */
	setExpertModel(expertId: string, model: ModelSelection | null) {
		this.state = {
			...this.state,
			experts: this.state.experts.map(e => (e.id === expertId ? { ...e, model } : e)),
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
