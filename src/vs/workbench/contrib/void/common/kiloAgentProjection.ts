/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Projects the agent engine's message parts onto the `ChatMessage` shapes the existing sidebar
// already renders. This is pure: no services, no I/O, no state beyond what it is handed.
//
// The mapping is what lets the engine backend ship without touching the React UI:
//   text part      -> assistant displayContent
//   reasoning part -> assistant reasoning
//   tool part      -> a 'tool' ChatMessage (pending -> running_now -> success | tool_error)
//   question/permission asked -> a 'tool_request' ChatMessage, so the sidebar's existing
//                                 approve/reject buttons drive the engine's API
//
// Tests live in `common/test/kiloAgentProjection.test.ts`.

import { ChatMessage } from './chatThreadServiceTypes.js';

/** One engine part, as it arrives on `message.part.updated` / `message.part.delta`. */
export type EnginePart = {
	id?: string;
	sessionID?: string;
	messageID?: string;
	type: string;
	text?: string;
	delta?: string;
	name?: string;
	callID?: string;
	/**
	 * Engine-generated placeholder text rather than the model's answer - e.g. the
	 * "⠋ Initializing snapshot…" progress line the engine injects while it prepares the repo
	 * (packages/opencode/src/kilocode/snapshot/track.ts, `progressPart`). These must never be
	 * shown as the assistant's reply. Keyed off the flag, not the wording, so it keeps working
	 * if the engine changes the text or adds more of these.
	 */
	synthetic?: boolean;
	metadata?: Record<string, unknown>;
	state?: {
		status: 'pending' | 'running' | 'completed' | 'error' | string;
		input?: unknown;
		result?: unknown;
		content?: unknown;
		error?: { name?: string; message?: string; data?: { message?: string } };
	};
};

/** Accumulates the text and reasoning of one turn so deltas can be appended. */
export type EngineProjection = {
	textByMessage: Map<string, string>;
	reasoningByMessage: Map<string, string>;
	/** part ids we have already reported as running, so repeated updates do not re-trigger the UI */
	startedTools: Set<string>;
	/**
	 * Message ids the engine has told us belong to the user. Their parts are dropped, because
	 * Loophole renders the user's own message the moment it is sent.
	 */
	userMessageIDs: Set<string>;
};

export function newProjection(): EngineProjection {
	return {
		textByMessage: new Map(),
		reasoningByMessage: new Map(),
		startedTools: new Set(),
		userMessageIDs: new Set(),
	};
}

export type ProjectionResult =
	| { kind: 'message'; message: ChatMessage }
	| { kind: 'tool-started'; id: string; name: string; params: Record<string, unknown> }
	| { kind: 'tool-finished'; id: string; message: ChatMessage }
	| { kind: 'ignored' };

function assistant(text: string, reasoning: string): ChatMessage {
	return { role: 'assistant', displayContent: text, reasoning, anthropicReasoning: null };
}

/**
 * Applies one part to the projection.
 *
 * `isDelta` distinguishes `message.part.delta` (only the new text is sent, so append) from
 * `message.part.updated` (the whole part is sent, so replace). Getting this backwards either
 * duplicates text or loses it.
 */
export function projectEnginePart(projection: EngineProjection, part: EnginePart, isDelta: boolean): ProjectionResult {
	// Engine-generated placeholder ("⠋ Initializing snapshot…"). Rendering it would put a spinner
	// in the chat as if it were the model's answer. Dropped for both updates and deltas.
	if (part.synthetic) return { kind: 'ignored' };

	// The engine echoes a `message.part.updated` for the user's OWN message as well as the
	// assistant's, and a part carries no role - the role lives on the parent message. We
	// already render the user's message locally when they send it, so projecting theirs would
	// show their text twice. `userMessageIDs` is populated from `message.updated`, which is the
	// only event that names a message and its role.
	if (part.messageID && projection.userMessageIDs.has(part.messageID)) return { kind: 'ignored' };

	const messageID = part.messageID ?? '';
	const partID = part.id ?? '';

	switch (part.type) {
		case 'text': {
			const next = isDelta
				? (projection.textByMessage.get(messageID) ?? '') + (part.text ?? part.delta ?? '')
				: (part.text ?? '');
			projection.textByMessage.set(messageID, next);
			return { kind: 'message', message: assistant(next, projection.reasoningByMessage.get(messageID) ?? '') };
		}
		case 'reasoning': {
			const next = isDelta
				? (projection.reasoningByMessage.get(messageID) ?? '') + (part.text ?? part.delta ?? '')
				: (part.text ?? '');
			projection.reasoningByMessage.set(messageID, next);
			return { kind: 'message', message: assistant(projection.textByMessage.get(messageID) ?? '', next) };
		}
		case 'tool': {
			const name: string = part.name ?? 'tool';
			const id: string = part.callID ?? partID;
			const status: string = part.state?.status ?? 'pending';

			// The todowrite tool returns its list as raw JSON (packages/opencode/src/tool/todo.ts
			// sets `output: JSON.stringify(params.todos)`), which would dump a JSON blob into the
			// chat. The todo.updated event already renders the same list as readable checkboxes,
			// so the tool itself is noise.
			if (name === 'todowrite') return { kind: 'ignored' };

			if (status === 'pending' || status === 'running') {
				// The engine re-sends the part on every tick; only announce the start once.
				if (projection.startedTools.has(partID)) return { kind: 'ignored' };
				projection.startedTools.add(partID);
				return { kind: 'tool-started', id, name, params: (part.state?.input ?? {}) as Record<string, unknown> };
			}

			const content = toolResultText(part.state);
			const params = (part.state?.input ?? {}) as Record<string, unknown>;
			// `ToolMessage` is an intersection of a base object with a discriminated union, so
			// `type` and `result` have to be narrowed together. Branching explicitly is the only
			// way TS accepts it; computing both fields independently does not type-check.
			const base = {
				role: 'tool' as const,
				id,
				content,
				rawParams: params as any,
				// our own IDE tools are namespaced `loophole_*`; attribute them to that server
				mcpServerName: name.startsWith('loophole_') ? name.split('_')[0] : undefined,
			};
			const message: ChatMessage = status === 'error'
				? { ...base, type: 'tool_error', result: content, name: name as any, params: params as any }
				: { ...base, type: 'success', result: (part.state?.result ?? content) as any, name: name as any, params: params as any };
			return { kind: 'tool-finished', id, message };
		}
		default:
			// step-start, step-finish, file, snapshot, patch, retry, compaction, agent, subtask:
			// all valid engine parts with no sidebar representation today.
			return { kind: 'ignored' };
	}
}

/** Flattens a tool result into something the sidebar can render. */
export function toolResultText(state: EnginePart['state']): string {
	if (!state) return '';
	if (state.status === 'error') {
		return String(state.error?.data?.message ?? state.error?.message ?? state.error?.name ?? 'The tool failed');
	}
	if (Array.isArray(state.content)) {
		return state.content.map(c => (typeof c === 'string' ? c : String((c as any)?.text ?? JSON.stringify(c)))).join('\n');
	}
	if (typeof state.result === 'string') return state.result;
	return state.content ? JSON.stringify(state.content) : '';
}

/**
 * The `role: 'tool'` arm of ChatMessage. These three builders below always produce one, so
 * declaring it here keeps callers (and the tests) from having to narrow the whole union.
 */
export type ProjectedToolMessage = Extract<ChatMessage, { role: 'tool' }>;

/**
 * The `tool_request` arm specifically.
 *
 * Narrowing only on `role: 'tool'` is not enough: that arm is a 6-way union and `params` is
 * absent from `invalid_params`, so callers reading `.params` still fail to compile. Naming the
 * discriminant here keeps the permission shape - the only one with `result: null` and the one the
 * sidebar's approve/reject buttons drive.
 */
export type ProjectedPermissionMessage = Extract<ChatMessage, { role: 'tool'; type: 'tool_request' }>;

/** Renders a `permission.asked` event as the sidebar's existing approval affordance. */
export function projectPermissionRequest(props: {
	id?: string;
	permission?: string;
	patterns?: string[];
	tool?: { callID?: string };
}): ProjectedPermissionMessage {
	const permission = props.permission ?? 'tool';
	return {
		role: 'tool',
		type: 'tool_request',
		result: null,
		name: permission as any,
		params: { patterns: props.patterns ?? [] } as any,
		id: props.tool?.callID ?? props.id ?? permission,
		content: `Allow ${permission}?`,
		rawParams: { permission, patterns: props.patterns ?? [] } as any,
		mcpServerName: undefined,
	};
}

/** Renders the model's plan as a tool message, since the sidebar has no todo widget. */
export function projectTodos(todos: Array<{ content: string; status: string }>, sessionID: string): Extract<ProjectedToolMessage, { type: 'success' }> {
	return {
		role: 'tool',
		type: 'success',
		result: todos,
		name: 'todowrite' as any,
		params: { todos } as any,
		id: `todo-${sessionID}`,
		content: todos.map(t => `${t.status === 'completed' ? 'x' : ' '} ${t.content}`).join('\n'),
		rawParams: { todos } as any,
		mcpServerName: undefined,
	};
}

/** Pulls a human-readable message out of whatever shape the engine reported an error in. */
export function engineErrorMessage(payload: any): string {
	return String(payload?.error?.data?.message ?? payload?.error?.message ?? 'The agent reported an error');
}
