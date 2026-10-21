/*--------------------------------------------------------------------------------------
 *  The Loophole engine as a chat provider.
 *
 *  The engine owns sessions, tools, agents and permission prompts. This file only
 *  translates between the IDE's message stream and the engine's API:
 *
 *   - chat/agent turns run in an engine session, sending only the newest user message
 *     (the engine already owns the conversation); retries and edits rebuild the session
 *     from the IDE transcript so regenerating cannot silently duplicate context
 *   - quick edit / apply / commit messages use the engine's stateless generate endpoint
 *   - engine tool permissions are approved once so the agent loop can proceed
 *
 *  Autocomplete is intentionally not implemented here. The engine has no FIM model, so
 *  inline completion keeps using the IDE's own providers.
 *--------------------------------------------------------------------------------------*/

import { LLMChatMessage, OnError, OnFinalMessage, OnText, TokenUsageInfo } from '../../common/sendLLMMessageTypes.js';
import { ChatMode, ModelSelectionOptions, OverridesOfModel, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
import { InternalToolInfo } from '../../common/prompt/prompts.js';
import { estimateTokens } from '../../common/tokenizer.js';
import {
	cancelForm,
	connect,
	createSession,
	EngineCredentials,
	EngineEvent,
	EngineModelRef,
	EngineRequestError,
	formatModelRef,
	generateText,
	interrupt,
	prompt as enginePrompt,
	removeSession,
	replyPermission,
	resolveModelRef,
	subscribe,
	switchAgent,
	switchModel,
} from '../loophole/engineAdapter.js';

export const providerNameLoophole = 'loophole' satisfies ProviderName;

type SendChatParams = {
	messages: LLMChatMessage[];
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	settingsOfProvider: SettingsOfProvider;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	modelName: string;
	_setAborter: (aborter: () => void) => void;
	providerName: ProviderName;
	separateSystemMessage: string | undefined;
	chatMode: ChatMode | null;
	mcpTools: InternalToolInfo[] | undefined;
	/** Chat threads only. Other AI features leave this undefined and use generate(). */
	threadId?: string;
	/** Folder the engine's tools should operate in. */
	workspaceDir?: string;
};

type ThreadState = {
	sessionID: string;
	modelName: string;
	agent: string;
	workspaceDir: string | undefined;
	/** Number of user messages the engine session has already been given. */
	userCount: number;
	/** Subagent sessions spawned by this thread. They can ask for permissions too. */
	childSessionIDs: Set<string>;
};

const threadsByThread = new Map<string, ThreadState>();

class StaleSessionError extends Error {
	constructor() {
		super('The Loophole engine no longer knows this session.');
		this.name = 'StaleSessionError';
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function contentToText(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((piece) => {
			const part = record(piece);
			if (!part) {
				return '';
			}
			if (typeof part.text === 'string') {
				return part.text;
			}
			if (part.type === 'tool_use' && typeof part.name === 'string') {
				return `[tool call ${part.name} ${JSON.stringify(part.input ?? {})}]`;
			}
			if (part.type === 'tool_result') {
				return `[tool result]\n${contentToText(part.content)}`;
			}
			if (part.type === 'functionCall' || part.type === 'functionResponse') {
				return `[${part.type} ${JSON.stringify(part)}]`;
			}
			return '';
		}).filter(Boolean).join('\n');
	}
	if (value === undefined || value === null) {
		return '';
	}
	return JSON.stringify(value);
}

/** Remove the IDE's system prompt that the OpenAI-style formatter prepends to the first user message. */
function stripIdeSystemMessage(text: string): string {
	if (!text.startsWith('<SYSTEM_MESSAGE>')) {
		return text;
	}
	const end = text.indexOf('</SYSTEM_MESSAGE>');
	if (end === -1) {
		return text;
	}
	return text.slice(end + '</SYSTEM_MESSAGE>'.length).replace(/^[ \t]*\r?\n/, '');
}

/** Turn one IDE message into plain text for the engine. */
function messageToText(message: LLMChatMessage, stripSystemMessage = false): string {
	const value = message as unknown as Record<string, unknown>;
	let text = contentToText(value.content);
	if (Array.isArray(value.parts)) {
		text += (text ? '\n' : '') + contentToText(value.parts);
	}
	if (Array.isArray(value.tool_calls)) {
		const calls = value.tool_calls.map((call) => {
			const fn = record(record(call)?.function);
			return fn && typeof fn.name === 'string'
				? `[tool call ${fn.name} ${typeof fn.arguments === 'string' ? fn.arguments : '{}'}]`
				: '';
		}).filter(Boolean);
		if (calls.length) {
			text += (text ? '\n' : '') + calls.join('\n');
		}
	}
	const finalText = text.trim();
	return stripSystemMessage && messageRole(message) === 'User' ? stripIdeSystemMessage(finalText) : finalText;
}

function messageRole(message: LLMChatMessage): string {
	const role = (message as unknown as { role?: string }).role;
	switch (role) {
		case 'assistant':
		case 'model':
			return 'Assistant';
		case 'system':
		case 'developer':
			return 'System';
		case 'tool':
			return 'Tool result';
		default:
			return 'User';
	}
}

function userTexts(messages: LLMChatMessage[]): string[] {
	return messages
		.filter((message) => (message as unknown as { role?: string }).role === 'user')
		.map((message) => messageToText(message, true))
		.filter((text) => !!text.trim());
}

function conversationTranscript(messages: LLMChatMessage[]): string {
	const body = messages
		// The engine supplies its own system prompt. The IDE's copy contains tool
		// instructions that do not apply to the engine's tool loop.
		.filter((message) => {
			const role = (message as unknown as { role?: string }).role;
			return role !== 'system' && role !== 'developer';
		})
		.map((message) => {
			const text = messageToText(message, true);
			return text ? `${messageRole(message)}:\n${text}` : '';
		})
		.filter(Boolean)
		.join('\n\n');
	return `The conversation so far is reproduced below. Reply to the final user message as the assistant. Do not repeat or summarize the transcript.\n\n<conversation>\n${body}\n</conversation>`;
}

function promptForGenerate(systemMessage: string | undefined, messages: LLMChatMessage[]): string {
	const system = systemMessage?.trim();
	const body = messages
		.map((message) => {
			const text = messageToText(message);
			return text ? `${messageRole(message)}:\n${text}` : '';
		})
		.filter(Boolean)
		.join('\n\n');
	return [system, body].filter(Boolean).join('\n\n');
}

function partKey(data: Record<string, unknown>): string {
	const messageID = typeof data.assistantMessageID === 'string' ? data.assistantMessageID : '';
	const ordinal = typeof data.ordinal === 'number' ? data.ordinal : 0;
	return `${messageID}:${ordinal}`;
}

function isAbortError(error: unknown): boolean {
	return !!error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';
}

function titleOf(text: string): string {
	const firstLine = text.trim().split(/\r?\n/, 1)[0] ?? '';
	return firstLine.slice(0, 80) || 'Loophole chat';
}

/** Remove a thread session and every subagent session it spawned. */
async function removeEngineSessions(credentials: EngineCredentials, state: ThreadState): Promise<void> {
	const sessionIDs = [state.sessionID, ...state.childSessionIDs];
	state.childSessionIDs.clear();
	await Promise.all(sessionIDs.map((sessionID) => removeSession(credentials, sessionID).catch(() => undefined)));
}

async function createThread(
	credentials: EngineCredentials,
	input: { model: EngineModelRef; agent: string; directory?: string; title: string },
): Promise<ThreadState> {
	const session = await createSession(credentials, {
		directory: input.directory,
		model: input.model,
		agent: input.agent,
		title: input.title,
	});
	return {
		sessionID: session.id,
		modelName: formatModelRef(input.model),
		agent: input.agent,
		workspaceDir: input.directory,
		userCount: 0,
		childSessionIDs: new Set<string>(),
	};
}

async function runSessionPrompt(
	params: SendChatParams,
	credentials: EngineCredentials,
	state: ThreadState,
	currentText: string,
	userCount: number,
	replay: boolean,
): Promise<void> {
	const messageID = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const promptController = new AbortController();
	let dispose: (() => void) | undefined;
	let settled = false;
	let aborted = false;
	let ready = false;
	let fullText = '';
	let fullReasoning = '';
	let lastInputTokens = 0;
	let totalOutputTokens = 0;
	const textParts = new Map<string, string>();
	const reasoningParts = new Map<string, string>();
	// Stream fragments are best-effort, so a late delta must not be appended after the
	// durable `*.ended` event already supplied the finished value for that part. Text and
	// reasoning parts share ordinals, so they need separate ended sets.
	const endedTextParts = new Set<string>();
	const endedReasoningParts = new Set<string>();

	const rebuild = () => {
		fullText = [...textParts.values()].filter(Boolean).join('\n\n');
		fullReasoning = [...reasoningParts.values()].filter(Boolean).join('\n\n');
	};

	const removeThreadSessions = () => {
		// A stale-session retry can already have installed a newer engine session for the
		// same thread. An abort from the previous attempt must not delete that mapping.
		if (params.threadId && threadsByThread.get(params.threadId) === state) {
			threadsByThread.delete(params.threadId);
		}
		// Subagents run in their own sessions, so removing only the parent can leave
		// orphaned children that later block on a permission prompt nobody answers.
		void removeEngineSessions(credentials, state);
	};

	const settle = (kind: 'final' | 'error' | 'interrupted', errorMessage?: string) => {
		if (settled) {
			return;
		}
		settled = true;
		dispose?.();
		if (kind === 'final') {
			const tokenUsage: TokenUsageInfo | undefined = (lastInputTokens || totalOutputTokens)
				? {
					inputTokens: lastInputTokens,
					outputTokens: totalOutputTokens,
					totalTokens: lastInputTokens + totalOutputTokens,
					providerName: providerNameLoophole,
					modelName: state.modelName,
				}
				: undefined;
			params.onFinalMessage({ fullText, fullReasoning, anthropicReasoning: null, tokenUsage });
			return;
		}
		// A failed or interrupted execution leaves the engine's history ambiguous. Drop the
		// session so the next turn starts from the IDE's transcript instead of a partial one.
		removeThreadSessions();
		params.onError({
			message: errorMessage ?? (kind === 'interrupted'
				? 'The Loophole engine interrupted the request.'
				: 'The Loophole engine failed.'),
			fullError: null,
		});
	};

	const handleEvent = (event: EngineEvent) => {
		if (settled) {
			return;
		}
		const data = event.data ?? {};
		const eventSessionID = typeof data.sessionID === 'string' ? data.sessionID : undefined;

		// Track subagent sessions so their permission and form prompts do not block the
		// parent forever. Child output is intentionally ignored; the parent summarizes it.
		if (event.type === 'session.created' && eventSessionID) {
			const parentID = typeof data.parentID === 'string' ? data.parentID : undefined;
			if (parentID && (parentID === state.sessionID || state.childSessionIDs.has(parentID))) {
				state.childSessionIDs.add(eventSessionID);
			}
			return;
		}

		const nestedForm = event.type === 'form.created' ? record(data.form) : undefined;
		const sessionID = eventSessionID
			?? (typeof nestedForm?.sessionID === 'string' ? nestedForm.sessionID : undefined);
		const isOwnSession = sessionID === state.sessionID;
		const isChildSession = !!sessionID && state.childSessionIDs.has(sessionID);
		const childPrompt = isChildSession && (event.type === 'permission.asked' || event.type === 'form.created');
		if (!isOwnSession && !childPrompt) {
			return;
		}

		// Ignore a previous execution that was still finishing when this turn subscribed.
		// Child permission prompts are not part of the parent's execution and bypass this.
		if (isOwnSession && !ready) {
			if (event.type === 'session.inbox.delivered') {
				// Delivery of our message id is the only event that proves the text and
				// execution events that follow belong to this turn. Another client can
				// share the session, so admission alone is not enough.
				ready = typeof data.inboxID === 'string' && data.inboxID === messageID;
			} else {
				return;
			}
		}

		switch (event.type) {
			case 'session.inbox.delivered':
			case 'session.execution.started':
				return;
			case 'session.text.started': {
				const key = partKey(data);
				if (!textParts.has(key)) {
					textParts.set(key, '');
				}
				return;
			}
			case 'session.text.delta': {
				const key = partKey(data);
				if (typeof data.delta === 'string' && !endedTextParts.has(key)) {
					textParts.set(key, (textParts.get(key) ?? '') + data.delta);
					rebuild();
					params.onText({ fullText, fullReasoning });
				}
				return;
			}
			case 'session.text.ended': {
				const key = partKey(data);
				if (typeof data.text === 'string') {
					textParts.set(key, data.text);
					endedTextParts.add(key);
					rebuild();
					params.onText({ fullText, fullReasoning });
				}
				return;
			}
			case 'session.reasoning.started': {
				const key = partKey(data);
				if (!reasoningParts.has(key)) {
					reasoningParts.set(key, '');
				}
				return;
			}
			case 'session.reasoning.delta': {
				const key = partKey(data);
				if (typeof data.delta === 'string' && !endedReasoningParts.has(key)) {
					reasoningParts.set(key, (reasoningParts.get(key) ?? '') + data.delta);
					rebuild();
					params.onText({ fullText, fullReasoning });
				}
				return;
			}
			case 'session.reasoning.ended': {
				const key = partKey(data);
				if (typeof data.text === 'string') {
					reasoningParts.set(key, data.text);
					endedReasoningParts.add(key);
					rebuild();
					params.onText({ fullText, fullReasoning });
				}
				return;
			}
			case 'session.step.ended': {
				const tokens = record(data.tokens);
				const cache = record(tokens?.cache);
				if (tokens) {
					lastInputTokens = numberValue(tokens.input) + numberValue(cache?.read) + numberValue(cache?.write);
					totalOutputTokens += numberValue(tokens.output) + numberValue(tokens.reasoning);
				}
				return;
			}
			case 'permission.asked': {
				const requestID = typeof data.id === 'string' ? data.id : undefined;
				if (requestID) {
					// The engine owns the tool loop; without a reply it blocks forever.
					// Its own deny rules have already run, so only actual 'ask' prompts land here.
					void replyPermission(credentials, sessionID ?? state.sessionID, requestID, 'once').catch(() => undefined);
				}
				return;
			}
			case 'form.created': {
				const formID = typeof nestedForm?.id === 'string' ? nestedForm.id : undefined;
				if (formID) {
					// There is no form UI in the chat surface. Cancel with feedback so the
					// question tool returns a model-facing error instead of hanging the step.
					void cancelForm(
						credentials,
						sessionID ?? state.sessionID,
						formID,
						'The IDE chat cannot display interactive questions. Continue with your best judgment and ask the user in your final response if you still need input.',
					).catch(() => undefined);
				}
				return;
			}
			case 'session.execution.succeeded':
				settle('final');
				return;
			case 'session.execution.failed': {
				const error = record(data.error);
				settle('error', typeof error?.message === 'string' ? error.message : undefined);
				return;
			}
			case 'session.execution.interrupted':
				if (!aborted) {
					settle('interrupted');
				}
				return;
			default:
				return;
		}
	};

	params._setAborter(() => {
		if (settled) {
			return;
		}
		aborted = true;
		settled = true;
		dispose?.();
		promptController.abort();
		// The abort may land before or after admission, so the engine's history is now
		// ambiguous. Drop the session and let the next turn rebuild from the transcript.
		void interrupt(credentials, state.sessionID).catch(() => undefined);
		removeThreadSessions();
	});

	try {
		dispose = await subscribe(
			credentials,
			handleEvent,
			(error: unknown) => {
				if (aborted || settled) {
					return;
				}
				settle('error', error instanceof Error ? error.message : String(error));
			},
			promptController.signal,
		);
		if (aborted || settled) {
			dispose?.();
			return;
		}

		const promptText = replay ? conversationTranscript(params.messages) : currentText;
		if (settled) {
			dispose?.();
			return;
		}
		await enginePrompt(credentials, state.sessionID, promptText, messageID, promptController.signal);
		state.userCount = userCount;
	} catch (error) {
		dispose?.();
		if (aborted || isAbortError(error)) {
			return;
		}
		if (!settled && error instanceof EngineRequestError && error.status === 404) {
			// Disable this attempt's aborter before the caller installs a replacement.
			settled = true;
			removeThreadSessions();
			throw new StaleSessionError();
		}
		if (!settled) {
			settled = true;
			// The prompt never reached the session, so any seeded history is incomplete.
			// Drop the session and rebuild it from the IDE transcript on the next attempt.
			removeThreadSessions();
			throw error;
		}
	}
}

async function sendViaSession(params: SendChatParams, forceReplay: boolean): Promise<void> {
	const threadId = params.threadId;
	if (!threadId) {
		throw new Error('No chat thread id was supplied.');
	}

	const credentials = await connect();
	const model = await resolveModelRef(credentials, params.modelName, params.workspaceDir);
	const modelName = formatModelRef(model);
	const agent = params.chatMode === 'agent' ? 'build' : 'plan';
	const texts = userTexts(params.messages);
	const currentText = texts[texts.length - 1];
	if (!currentText?.trim()) {
		throw new Error('Nothing to send to the Loophole engine.');
	}

	let state = threadsByThread.get(threadId);
	let replay = false;

	if (forceReplay && state) {
		await removeEngineSessions(credentials, state);
		threadsByThread.delete(threadId);
		state = undefined;
	}

	if (!state) {
		state = await createThread(credentials, {
			model,
			agent,
			directory: params.workspaceDir,
			title: titleOf(currentText),
		});
		threadsByThread.set(threadId, state);
		// A thread that already has history predates this engine session (or the IDE was
		// restarted); seed the engine with the transcript instead of dropping context.
		replay = forceReplay || texts.length > 1;
	} else {
		const isNewTurn = texts.length > state.userCount;
		if (state.workspaceDir !== params.workspaceDir || !isNewTurn) {
			// Regenerate, edit, or moved workspace: the engine's history no longer matches
			// the IDE's transcript. Start clean and replay the visible conversation.
			await removeEngineSessions(credentials, state);
			state = await createThread(credentials, {
				model,
				agent,
				directory: params.workspaceDir,
				title: titleOf(currentText),
			});
			threadsByThread.set(threadId, state);
			replay = true;
		} else {
			if (state.modelName !== modelName) {
				await switchModel(credentials, state.sessionID, model);
				state.modelName = modelName;
			}
			if (state.agent !== agent) {
				await switchAgent(credentials, state.sessionID, agent);
				state.agent = agent;
			}
		}
	}

	await runSessionPrompt(params, credentials, state, currentText, texts.length, replay);
}

async function sendViaGenerate(params: SendChatParams): Promise<void> {
	const credentials = await connect();
	const model = await resolveModelRef(credentials, params.modelName, params.workspaceDir);
	const promptText = promptForGenerate(params.separateSystemMessage, params.messages);
	if (!promptText.trim()) {
		throw new Error('Nothing to send to the Loophole engine.');
	}

	const controller = new AbortController();
	params._setAborter(() => controller.abort());
	const text = await generateText(credentials, promptText, model, controller.signal);
	if (controller.signal.aborted) {
		return;
	}
	const inputTokens = estimateTokens(promptText);
	const outputTokens = estimateTokens(text);
	params.onText({ fullText: text, fullReasoning: '' });
	params.onFinalMessage({
		fullText: text,
		fullReasoning: '',
		anthropicReasoning: null,
		tokenUsage: {
			inputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
			providerName: providerNameLoophole,
			modelName: params.modelName,
		},
	});
}

const sendChat = async (params: SendChatParams): Promise<void> => {
	const usesSession = !!params.threadId
		&& (params.chatMode === 'agent' || params.chatMode === 'plan' || params.chatMode === 'normal' || params.chatMode === 'gather');
	try {
		if (usesSession) {
			await sendViaSession(params, false);
		} else {
			await sendViaGenerate(params);
		}
	} catch (error) {
		if (isAbortError(error)) {
			return;
		}
		const staleSession = error instanceof StaleSessionError
			|| (error instanceof EngineRequestError && error.status === 404);
		if (staleSession && params.threadId) {
			// The engine restarted (or the session was removed). Recreate it and replay.
			threadsByThread.delete(params.threadId);
			try {
				await sendViaSession(params, true);
			} catch (retryError) {
				params.onError({
					message: retryError instanceof Error ? retryError.message : String(retryError),
					fullError: retryError instanceof Error ? retryError : null,
				});
			}
			return;
		}
		params.onError({
			message: error instanceof Error ? error.message : String(error),
			fullError: error instanceof Error ? error : null,
		});
	}
};

export const sendLLMMessageToLoopholeImplementation = {
	sendChat,
	// No FIM: the engine has no fill-in-middle model, so autocomplete stays on the IDE's
	// own providers. Returning undefined makes the dispatcher report that clearly.
	sendFIM: undefined,
};

export const displayInfoLoophole = {
	title: 'Loophole',
	allNames: ['loophole'],
};
