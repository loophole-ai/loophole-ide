/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Drives one engine-backed chat turn and projects the engine's event stream onto the shapes
// the existing sidebar already renders.
//
// The engine runs its own agent loop: it decides which tools to call, in what order, and when
// it is finished. So unlike the legacy agent there is no tool loop here to run. What this file
// does instead is translate the engine's stream into the same `ChatMessage` / stream-state
// vocabulary the React sidebar already understands, which is why the UI needs no changes:
//   text part      -> assistant displayContent
//   reasoning part -> assistant reasoning
//   tool part      -> a 'tool' ChatMessage (pending -> running -> success | tool_error)
//   permission.asked -> a 'tool_request' ChatMessage, so the sidebar's existing
//                       approve/reject buttons drive the engine's permission API
//   session.idle   -> end of turn
//   todo.updated   -> a synthetic tool message showing the model's plan

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../base/common/platform.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ChatMessage } from '../common/chatThreadServiceTypes.js';
import {
	EnginePart,
	EngineProjection,
	engineErrorMessage,
	newProjection,
	projectEnginePart,
	projectPermissionRequest,
	projectTodos,
} from '../common/kiloAgentProjection.js';
import { IKiloAgentService } from '../common/kiloAgentService.js';
import { KiloAgentEditorContext, KiloAgentModelRef } from '../common/kiloAgentTypes.js';
import { EngineEditOutcome, IKiloAgentDiffBridge } from './kiloAgentDiffBridge.js';
import { IKiloIdeToolsService } from './kiloIdeToolsService.js';

/** The slice of chatThreadService the runner drives. Implemented by ChatThreadService. */
export interface IEngineChatSink {
	threadId: string;
	/** push a message onto the thread */
	addMessage(message: ChatMessage): void;
	/** mark the turn as finished; `error` is shown in the sidebar's error slot */
	finishTurn(opts?: { error?: { message: string; fullError: Error | null } }): void;
	/** called whenever a tool starts, so the UI can show a spinner */
	setToolRunning(tool: { id: string; name: string; params: Record<string, unknown> }): void;
	/** called when a tool finishes, successfully or not */
	clearToolRunning(id: string): void;
}

type TurnState = {
	threadId: string;
	directory: string;
	sessionID: string;
	sink: IEngineChatSink;
	/** accumulates streamed text/reasoning and de-duplicates tool starts */
	projection: EngineProjection;
	/** tool call ids the user is being asked to approve, in the order they were asked */
	awaitingApproval: string[];
	finished: boolean;
};

export type StartEngineTurnOpts = {
	threadId: string;
	/** reused across turns; created on first use */
	sessionID: string;
	directory: string;
	text: string;
	model?: KiloAgentModelRef;
	/** merged .voidrules + any user instructions */
	system?: string;
	sink: IEngineChatSink;
};

export interface IKiloAgentChatRunner extends IDisposable {
	readonly _serviceBrand: undefined;
	/** Sends a turn and resolves once the engine reports the session idle. */
	startTurn(opts: StartEngineTurnOpts): Promise<void>;
	/** Aborts the in-flight turn for a thread, if any. */
	abort(threadId: string): Promise<void>;
	/** Approves or rejects whatever the engine is currently blocked on. */
	resolveApproval(threadId: string, behavior: 'accept' | 'reject'): Promise<void>;
	/** The engine session backing a Loophole thread, if one has been created. */
	sessionOf(threadId: string): string | undefined;
	/** Forgets the engine session for a thread (e.g. the thread was deleted). */
	forgetThread(threadId: string): void;
}

export const IKiloAgentChatRunner = createDecorator<IKiloAgentChatRunner>('KiloAgentChatRunner');

class KiloAgentChatRunner extends Disposable implements IKiloAgentChatRunner {
	_serviceBrand: undefined;

	private readonly turns = new Map<string, TurnState>();
	private readonly sessions = new Map<string, string>();
	/** callID -> the permission request the engine is blocked on */
	private readonly pendingPermission = new Map<string, { requestID: string; directory: string }>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IKiloAgentService private readonly agentService: IKiloAgentService,
		@IKiloAgentDiffBridge private readonly diffBridge: IKiloAgentDiffBridge,
		@IKiloIdeToolsService private readonly ideToolsService: IKiloIdeToolsService,
		@IModelService private readonly modelService: IModelService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this._register(this.agentService.onDidReceiveEvent(e => this.onEngineEvent(e)));
		this._register(this.agentService.onDidChangeState(() => {
			// A restarted engine keeps its sessions on disk, so the ids we hold stay valid.
			// Nothing to do beyond letting the next turn re-establish its stream.
		}));
	}

	sessionOf(threadId: string) { return this.sessions.get(threadId); }
	forgetThread(threadId: string) { this.sessions.delete(threadId); }

	async startTurn(opts: StartEngineTurnOpts): Promise<void> {
		const { threadId, sessionID, directory, sink } = opts;
		this.sessions.set(threadId, sessionID);

		// The engine cannot see IDE diagnostics or the sidebar's terminals until it knows about
		// our local MCP server, so make sure that is wired up before the first prompt.
		try {
			await this.ideToolsService.ensureRegistered();
		} catch (err) {
			this.logService.warn(`[kilo-agent] IDE tools unavailable: ${String(err?.message ?? err)}`);
		}

		const turn: TurnState = {
			threadId, directory, sessionID, sink,
			projection: newProjection(),
			awaitingApproval: [],
			finished: false,
		};
		this.turns.set(threadId, turn);

		try {
			await this.agentService.prompt({
				directory,
				sessionID,
				text: opts.text,
				...(opts.model ? { model: opts.model } : {}),
				...(opts.system ? { system: opts.system } : {}),
				editorContext: this.currentEditorContext(directory),
			});
		} catch (err) {
			this.logService.error('[kilo-agent] could not send the prompt', err);
			this.turns.delete(threadId);
			sink.finishTurn({ error: { message: `Could not reach the agent engine: ${String(err?.message ?? err)}`, fullError: null } });
		}
	}

	async abort(threadId: string): Promise<void> {
		const turn = this.turns.get(threadId);
		if (!turn) return;
		try {
			await this.agentService.abort({ directory: turn.directory, sessionID: turn.sessionID });
		} catch (err) {
			this.logService.warn(`[kilo-agent] abort failed: ${String(err?.message ?? err)}`);
		}
		this.endTurn(turn, { aborted: true });
	}

	async resolveApproval(threadId: string, behavior: 'accept' | 'reject'): Promise<void> {
		const turn = this.turns.get(threadId);
		if (!turn) return;

		// The sidebar's approve/reject buttons act on the newest outstanding request.
		const callID = turn.awaitingApproval.at(-1);
		if (!callID) return;
		const pending = this.pendingPermission.get(callID);
		if (!pending) return;

		turn.awaitingApproval = turn.awaitingApproval.filter(id => id !== callID);
		this.pendingPermission.delete(callID);

		try {
			// "once", never "always": a single approval must not silently widen the engine's
			// own permissions for the rest of the session.
			await this.agentService.replyPermission({
				directory: pending.directory,
				requestID: pending.requestID,
				reply: behavior === 'accept' ? 'once' : 'reject',
			});
		} catch (err) {
			this.logService.warn(`[kilo-agent] permission reply failed: ${String(err?.message ?? err)}`);
		}
	}

	// ------------------------------------------------------------------ event handling

	private onEngineEvent(ev: { directory: string; type: string; properties: Record<string, any> }): void {
		// Only one turn can be streaming per directory in practice, but several threads in the
		// same folder can interleave, so match on the session the event belongs to.
		if (ev.type === 'server.heartbeat' || ev.directory === 'global') return;

		switch (ev.type) {
			case 'message.updated':
				this.onMessageUpdated(ev.properties);
				return;
			case 'message.part.updated':
			case 'message.part.delta':
				this.onPart(ev.properties, ev.type === 'message.part.delta');
				return;
			case 'permission.asked':
				this.onPermissionAsked(ev.properties);
				return;
			case 'permission.replied':
				this.onPermissionReplied(ev.properties);
				return;
			case 'todo.updated':
				this.onTodos(ev.properties);
				return;
			case 'session.error':
				this.onSessionError(ev.properties);
				return;
			case 'session.idle':
				this.onIdle(ev.properties);
				return;
			default:
				return; // session.diff, file.edited, indexing.*, etc. are handled elsewhere or ignored
		}
	}

	/** The turn that owns the given engine session, if we are running one. */
	private turnForSession(sessionID: string | undefined): TurnState | undefined {
		if (!sessionID) return undefined;
		for (const turn of this.turns.values()) if (turn.sessionID === sessionID) return turn;
		return undefined;
	}

	/**
	 * Records which messages belong to the user.
	 *
	 * A part carries no role of its own (see packages/schema/src/v1/session.ts - `partBase` is
	 * just id/sessionID/messageID), so this is the only place the role is visible. Without it we
	 * cannot tell an assistant text part from the echo of the user's own, and their message
	 * renders twice.
	 *
	 * Applies to every turn in the session, not just the current one, because the engine replays
	 * history when a turn starts.
	 */
	private onMessageUpdated(props: Record<string, any>): void {
		const info = props.info ?? props.message ?? props;
		const id: string | undefined = info?.id;
		const role: string | undefined = info?.role;
		if (!id || role !== 'user') return;
		for (const turn of this.turns.values()) turn.projection.userMessageIDs.add(id);
	}

	private onPart(props: Record<string, any>, isDelta: boolean): void {
		const part = props.part ?? props.info ?? props;
		const turn = this.turnForSession(part?.sessionID);
		if (!turn) return;

		const result = projectEnginePart(turn.projection, part as EnginePart, isDelta);
		if (result.kind === 'ignored') return;
		if (result.kind === 'message') { turn.sink.addMessage(result.message); return; }
		if (result.kind === 'tool-started') {
			turn.sink.setToolRunning({ id: result.id, name: result.name, params: result.params });
			return;
		}
		turn.sink.clearToolRunning(result.id);
		turn.sink.addMessage(result.message);
	}

	

	private onPermissionAsked(props: Record<string, any>): void {
		const requestID: string = props.id ?? props.requestID;
		const sessionID: string = props.sessionID;
		const turn = this.turnForSession(sessionID);
		if (!turn || !requestID) return;

		const callID: string = props.tool?.callID ?? requestID;
		this.pendingPermission.set(callID, { requestID, directory: turn.directory });
		turn.awaitingApproval.push(callID);

		// Reuse the sidebar's existing approval affordance.
		turn.sink.addMessage(projectPermissionRequest({ ...props, id: callID }));
	}

	private onPermissionReplied(props: Record<string, any>): void {
		const callID: string = props.requestID;
		for (const [key, value] of [...this.pendingPermission.entries()]) {
			if (value.requestID === callID) this.pendingPermission.delete(key);
		}
	}

	private onTodos(props: Record<string, any>): void {
		const turn = this.turnForSession(props.sessionID);
		if (!turn) return;
		const todos = props.todos;
		if (!Array.isArray(todos) || !todos.length) return;
		turn.sink.addMessage(projectTodos(todos, props.sessionID));
	}

	private onSessionError(props: Record<string, any>): void {
		const turn = this.turnForSession(props.sessionID ?? props.info?.sessionID);
		if (!turn) return;
		this.endTurn(turn, { error: { message: engineErrorMessage(props), fullError: null } });
	}

	private onIdle(props: Record<string, any>): void {
		const sessionID: string = props.sessionID ?? props.info?.sessionID;
		const turn = this.turnForSession(sessionID);
		if (!turn) return;
		// The engine may have gone idle mid-turn because it is blocked on a permission; the
		// approval is still outstanding, so leave the turn open in that case.
		if (turn.awaitingApproval.length > 0) return;
		void this.endTurn(turn, {});
	}

	/**
	 * Ends a turn and stages whatever the engine changed on disk as Loophole diff zones.
	 * Staging happens after the turn so the user reviews a settled set of edits.
	 */
	private async endTurn(turn: TurnState, opts: { aborted?: boolean; error?: { message: string; fullError: Error | null } }): Promise<void> {
		if (turn.finished) return;
		turn.finished = true;
		this.turns.delete(turn.threadId);
		for (const callID of turn.awaitingApproval) this.pendingPermission.delete(callID);
		turn.awaitingApproval = [];

		if (!opts.aborted && !opts.error) {
			try {
				const diffs = await this.agentService.getDiff({ directory: turn.directory, sessionID: turn.sessionID });
				const outcomes = await this.diffBridge.stageAll({ directory: turn.directory, diffs });
				this.reportSkippedEdits(turn, outcomes);
			} catch (err) {
				this.logService.warn(`[kilo-agent] could not stage the engine's edits: ${String(err?.message ?? err)}`);
			}
		}

		turn.sink.finishTurn(opts.error ? { error: opts.error } : {});
	}

	private reportSkippedEdits(turn: TurnState, outcomes: EngineEditOutcome[]): void {
		const skipped = outcomes.filter(o => o.kind === 'unsaved-conflict' || o.kind === 'unsupported');
		if (!skipped.length) return;
		// Be explicit rather than letting the model believe its edits landed.
		turn.sink.addMessage({
			role: 'assistant',
			displayContent: `I could not show these changes for review, so they are already on disk: ${skipped.map(o => o.file).join(', ')}. They may conflict with unsaved edits.`,
			reasoning: '',
			anthropicReasoning: null,
		});
	}

	// ------------------------------------------------------------------ IDE context

	/** Tells the engine what the user is actually looking at, per turn. */
	private currentEditorContext(directory: string): KiloAgentEditorContext {
		// `isAttachedToEditor` is the same signal the legacy system prompt uses for open tabs,
		// and it excludes the chat webview.
		const openTabs = this.modelService.getModels()
			.filter(m => m.isAttachedToEditor())
			.map(m => m.uri.fsPath);
		const activeFile = this.editorService.activeEditor?.resource?.fsPath;

		return {
			directory,
			...(activeFile ? { activeFile } : {}),
			...(openTabs.length ? { openTabs: [...new Set(openTabs)] } : {}),
			// Rendered by the engine as a "Default shell:" prompt line (see
		// packages/opencode/src/kilocode/editor-context.ts). isWindows comes from the platform
		// module rather than `process.platform`, which does not exist in the renderer.
		shell: isWindows ? 'powershell' : 'bash',
		};
	}
}

registerSingleton(IKiloAgentChatRunner, KiloAgentChatRunner, InstantiationType.Delayed);

export { KiloAgentChatRunner };
