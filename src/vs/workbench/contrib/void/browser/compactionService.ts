import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { ChatMessage } from '../common/chatThreadServiceTypes.js';
import { estimateTokens } from '../common/tokenizer.js';
import { ModelSelection } from '../common/voidSettingsTypes.js';
import { LLMChatMessage } from '../common/sendLLMMessageTypes.js';

export const TAIL_TURNS = 2;
export const MIN_PRESERVE_RECENT_TOKENS = 2_000;
export const MAX_PRESERVE_RECENT_TOKENS = 15_000;

export const COMPACTION_PROMPT = `You are a context summarization agent. You are given a conversation between a user and a coding agent. Produce a structured summary so another coding agent can continue the work without the original transcript.

Keep every section below. Preserve exact file paths, symbol names, error messages and commands when they are known. Prefer terse bullets over paragraphs. Do not continue the conversation and do not answer any question inside it. Output only the summary.

## Goal
What the user is ultimately trying to achieve.

## Done
What has already been completed, with file paths.

## In progress
What is half-finished and what the next step is.

## Key files
Paths touched or read, and what each one contains that matters.

## Decisions
Choices already made and constraints that still apply, including anything the user said not to do.

## Errors and dead ends
Failures hit and approaches already ruled out, so they are not retried.

## Current state
What the workspace looks like right now after the changes above.`;

export type Compaction = {
	summary: string;
	upToMessageIdx: number;
};

export function usableTokens(contextWindow: number, reservedOutputTokenSpace: number): number {
	if (contextWindow <= 0) return 0;
	return Math.max(0, contextWindow - reservedOutputTokenSpace);
}

export function preserveRecentBudget(usable: number): number {
	return Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable * 0.25)));
}

export const PRUNE_MINIMUM = 20_000;
export const PRUNE_PROTECT = 40_000;

/**
 * Replaces the payloads of old tool calls with a placeholder.
 *
 * A tool result is the bulkiest thing in a long session and almost never needs
 * to be re-read verbatim once the assistant has moved on from it. Dropping the
 * bodies buys back most of the window for the cost of one pass and no model
 * call, which is why it runs separately from summarisation: pruning is cheap
 * and lossy, summarising is expensive and keeps the shape of the conversation.
 */
export function pruneToolResults(messages: { role: string; content: string }[]): { role: string; content: string }[] {
	if (messages.length < 4) return messages

	const out = messages.map(m => ({ ...m }))
	let protectFrom = out.length - 1
	while (protectFrom > 0) {
		if (out[protectFrom].role === 'tool') { protectFrom -= 1 } else { break }
	}
	if (protectFrom <= 0) return messages

	let budget = 0
	for (let i = protectFrom - 1; i >= 0; i--) {
		const m = out[i];
		if (m.role !== 'tool') continue
		const size = estimateTokens(m.content)
		if (budget + size <= PRUNE_MINIMUM) break
		if (size <= PRUNE_PROTECT) continue
		budget += size
		out[i] = { ...m, content: `[tool output removed to save context: ${size} tokens]` }
	}

	return out
}

/**
 * Indices where a user message starts, oldest first.
 */
function turnStarts(messages: ChatMessage[]): number[] {
	const starts: number[] = []
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role === 'user') starts.push(i)
	}
	return starts
}

/**
 * Picks where the summary ends and the verbatim tail begins.
 *
 * Whole turns are kept, walking backwards from the newest, so a turn is never
 * cut in half between the user's request and the work that answered it. Returns
 * -1 when there is nothing worth summarizing.
 */
export function selectCompactionPoint(messages: ChatMessage[], usable: number): number {
	const starts = turnStarts(messages)
	if (starts.length <= TAIL_TURNS) return -1

	const budget = preserveRecentBudget(usable)
	const recentStarts = starts.slice(-TAIL_TURNS)

	let total = 0
	let tailStart = recentStarts[0]
	for (let i = recentStarts.length - 1; i >= 0; i--) {
		const start = recentStarts[i]
		const end = i === recentStarts.length - 1 ? messages.length : recentStarts[i + 1]
		const size = messages.slice(start, end).reduce((acc, m) => acc + estimateTokens(textOf(m)), 0)
		if (total + size > budget && tailStart !== start) break
		total += size
		tailStart = start
	}

	const headEnd = tailStart
	if (headEnd <= 0) return -1
	if (starts[0] === 0 && headEnd <= starts[1]) return -1
	return headEnd
}

function textOf(message: ChatMessage): string {
	if (message.role === 'user') return message.content
	if (message.role === 'assistant') return message.displayContent
	if (message.role === 'tool') return `${message.name}: ${message.content}`
	return ''
}

function transcript(messages: ChatMessage[]): string {
	const lines: string[] = []
	for (const message of messages) {
		if (message.role === 'user') lines.push(`USER: ${message.content}`)
		else if (message.role === 'assistant') lines.push(`ASSISTANT: ${message.displayContent}`)
		else if (message.role === 'tool' && message.type === 'success') lines.push(`TOOL ${message.name}: ${JSON.stringify(message.result).substring(0, 1500)}`)
		else if (message.role === 'tool' && message.type === 'tool_error') lines.push(`TOOL ${message.name} FAILED: ${message.result}`)
	}
	return lines.join('\n\n')
}

export async function compact({
	llmMessageService,
	voidSettingsService,
	messages,
	modelSelection,
	usable,
}: {
	llmMessageService: ILLMMessageService;
	voidSettingsService: IVoidSettingsService;
	messages: ChatMessage[];
	modelSelection: ModelSelection | null;
	usable: number;
}): Promise<Compaction | null> {
	const upto = selectCompactionPoint(messages, usable)
	if (upto <= 0) return null

	const head = messages.slice(0, upto)
	const body = transcript(head)
	if (!body.trim()) return null

	const llmMessages: LLMChatMessage[] = [{ role: 'user', content: body }]

	const summary = await new Promise<string>((resolve, reject) => {
		const requestId = llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			messages: llmMessages,
			separateSystemMessage: COMPACTION_PROMPT,
			chatMode: null,
			modelSelection,
			if (!modelSelection) {
				resolve('');
				return;
			}
			modelSelectionOptions: voidSettingsService.state.optionsOfModelSelection['Chat']?.[modelSelection.providerName]?.[modelSelection.modelName],
			overridesOfModel: voidSettingsService.state.overridesOfModel,
			onText: () => { },
			onFinalMessage: ({ fullText }) => resolve(fullText.trim()),
			onError: ({ message }) => reject(new Error(message)),
			onAbort: () => reject(new Error('Compaction aborted')),
			logging: { loggingName: 'Compaction' },
		})
		if (requestId === null) reject(new Error('Compaction could not start'))
	})

	if (!summary) return null
	return { summary, upToMessageIdx: upto }
}