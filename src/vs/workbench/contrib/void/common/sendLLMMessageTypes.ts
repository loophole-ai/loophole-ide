/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { InternalToolInfo } from './prompt/prompts.js'
import { ToolName, ToolParamName } from './toolsServiceTypes.js'
import { ChatMode, ModelSelection, ModelSelectionOptions, OverridesOfModel, ProviderName, RefreshableProviderName, SettingsOfProvider } from './voidSettingsTypes.js'


export const errorDetails = (fullError: Error | null): string | null => {
	if (fullError === null) {
		return null
	}
	else if (typeof fullError === 'object') {
		if (Object.keys(fullError).length === 0) return null
		return JSON.stringify(fullError, null, 2)
	}
	else if (typeof fullError === 'string') {
		return null
	}
	return null
}

export const getErrorMessage: (error: unknown) => string = (error) => {
	if (error instanceof Error) return `${error.name}: ${error.message}`
	return error + ''
}



export type AnthropicLLMChatMessage = {
	role: 'assistant',
	content: string | (AnthropicReasoning | { type: 'text'; text: string }
		| { type: 'tool_use'; name: string; input: Record<string, any>; id: string; }
	)[];
} | {
	role: 'user',
	content: string | (
		{ type: 'text'; text: string; } | { type: 'tool_result'; tool_use_id: string; content: string; }
	)[]
}
export type OpenAILLMChatMessage = {
	role: 'system' | 'user' | 'developer';
	content: string;
} | {
	role: 'assistant',
	content: string | (AnthropicReasoning | { type: 'text'; text: string })[];
	tool_calls?: { type: 'function'; id: string; function: { name: string; arguments: string; } }[];
} | {
	role: 'tool',
	content: string;
	tool_call_id: string;
}

export type GeminiLLMChatMessage = {
	role: 'model'
	parts: (
		| { text: string; }
		| { functionCall: { id: string; name: ToolName, args: Record<string, unknown> } }
	)[];
} | {
	role: 'user';
	parts: (
		| { text: string; }
		| { functionResponse: { id: string; name: ToolName, response: { output: string } } }
	)[];
}

export type LLMChatMessage = AnthropicLLMChatMessage | OpenAILLMChatMessage | GeminiLLMChatMessage



export type LLMFIMMessage = {
	prefix: string;
	suffix: string;
	stopTokens: string[];
}


export type RawToolParamsObj = {
	[paramName in ToolParamName<ToolName>]?: string;
}
export type RawToolCallObj = {
	name: ToolName;
	rawParams: RawToolParamsObj;
	doneParams: ToolParamName<ToolName>[];
	id: string;
	isDone: boolean;
};

export type AnthropicReasoning = ({ type: 'thinking'; thinking: any; signature: string; } | { type: 'redacted_thinking', data: any })

export type TokenUsageInfo = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	providerName?: string;
	modelName?: string;
}

export type OnText = (p: { fullText: string; fullReasoning: string; toolCall?: RawToolCallObj }) => void
export type OnFinalMessage = (p: { fullText: string; fullReasoning: string; toolCall?: RawToolCallObj; anthropicReasoning: AnthropicReasoning[] | null; tokenUsage?: TokenUsageInfo }) => void // id is tool_use_id
export type OnError = (p: { message: string; fullError: Error | null }) => void
export type OnAbort = () => void
export type AbortRef = { current: (() => void) | null }


// Loophole CLI (server-side agent loop, Phase 3: tool UI). The server runs
// tools itself and streams their lifecycle as session.tool.* events; these
// hooks carry snapshots back to the renderer. All fields are JSON-safe for IPC.
export type CliToolStatus = 'input' | 'running' | 'done' | 'error'
export type CliToolState = {
	id: string; // opencode tool call id (session.tool.* `id`)
	name: string; // opencode tool name (e.g. 'edit', 'bash', 'todowrite')
	status: CliToolStatus;
	input?: Record<string, unknown>; // parsed call input (session.tool.called `input`)
	inputText?: string; // raw input JSON fragments (session.tool.input.delta, ephemeral)
	outputText?: string; // concatenated text content (session.tool.success `content`)
	error?: string; // failure message (session.tool.failed `error.message`)
	metadata?: Record<string, unknown>; // UI metadata (session.tool.success/failed `metadata`)
}
export type OnTool = (p: { tools: CliToolState[] }) => void
export type CliCompactionPhase = 'started' | 'streaming' | 'done' | 'failed'
export type CliCompactionState = {
	phase: CliCompactionPhase;
	reason?: string; // 'auto' | 'manual' (session.compaction.* `reason`)
	text?: string; // summary text (session.compaction.delta / .ended `text`)
	error?: string; // failure message (session.compaction.failed `error.message`)
}
export type OnCompaction = (p: { compaction: CliCompactionState }) => void

// Loophole CLI session binding + permission + usage (optional; CLI-only).
// The server owns the agent loop, so the IDE reuses one session per thread:
// the first CLI turn creates it and reports it here so chatThreadService can
// persist it onto the Void thread; later turns pass it back via `cliSessionId`.
export type OnCliSession = (p: { cliSessionId: string }) => void
export type CliPermissionRequest = {
	id: string; // Permission.ID (permission.asked `id`)
	sessionID: string;
	action: string; // tool action e.g. 'edit' | 'bash'
	resources: string[];
	message?: string;
	save?: string[];
	metadata?: Record<string, unknown>;
}
export type OnPermission = (p: { permission: CliPermissionRequest }) => void
export type CliUsage = {
	cost: number; // USD, cumulative for the session (Session.Info + session.usage.updated)
	tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}
export type OnUsage = (p: { usage: CliUsage }) => void


// service types
type SendLLMType = {
	messagesType: 'chatMessages';
	messages: LLMChatMessage[]; // the type of raw chat messages that we send to Anthropic, OAI, etc
	separateSystemMessage: string | undefined;
	chatMode: ChatMode | null;
} | {
	messagesType: 'FIMMessage';
	messages: LLMFIMMessage;
	separateSystemMessage?: undefined;
	chatMode?: undefined;
}
export type ServiceSendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	// Loophole CLI tool/compaction UI (optional; only set in CLI mode, the
	// direct-LLM path never calls them).
	onTool?: OnTool;
	onCompaction?: OnCompaction;
	// Loophole CLI session binding (optional, CLI-only): reuses the thread's
	// server session when set; the main process reports the created id via onCliSession.
	cliSessionId?: string;
	onCliSession?: OnCliSession;
	onPermission?: OnPermission;
	onUsage?: OnUsage;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	modelSelection: ModelSelection | null;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	onAbort: OnAbort;
} & SendLLMType;

// params to the true sendLLMMessage function
export type SendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	onTool?: OnTool;
	onCompaction?: OnCompaction;
	cliSessionId?: string;
	onCliSession?: OnCliSession;
	onPermission?: OnPermission;
	onUsage?: OnUsage;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	abortRef: AbortRef;

	modelSelection: ModelSelection | null;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;

	settingsOfProvider: SettingsOfProvider;
	mcpTools: InternalToolInfo[] | undefined;
} & SendLLMType



// Loophole CLI overrides the provider-backed transport (Phase 2). When set, the
// main process routes chat to the CLI instead of `modelSelection`'s provider.
export type CliOverrides = {
	enabled: boolean;
	// CLI model (picker / default); undefined = server's own default
	model?: { providerID: string; modelID: string } | null;
}

// can't send functions across a proxy, use listeners instead
export type BlockedMainLLMMessageParams = 'onText' | 'onFinalMessage' | 'onError' | 'onTool' | 'onCompaction' | 'onCliSession' | 'onPermission' | 'onUsage' | 'abortRef'
export type MainSendLLMMessageParams = Omit<SendLLMMessageParams, BlockedMainLLMMessageParams | 'modelSelection'> & { requestId: string, modelSelection: ModelSelection | null, cli?: CliOverrides } & SendLLMType

export type MainLLMMessageAbortParams = { requestId: string }

export type EventLLMMessageOnTextParams = Parameters<OnText>[0] & { requestId: string }
export type EventLLMMessageOnFinalMessageParams = Parameters<OnFinalMessage>[0] & { requestId: string }
export type EventLLMMessageOnErrorParams = Parameters<OnError>[0] & { requestId: string }
export type EventLLMMessageOnToolParams = Parameters<OnTool>[0] & { requestId: string }
export type EventLLMMessageOnCompactionParams = Parameters<OnCompaction>[0] & { requestId: string }
export type EventLLMMessageOnCliSessionParams = Parameters<OnCliSession>[0] & { requestId: string }
export type EventLLMMessageOnPermissionParams = Parameters<OnPermission>[0] & { requestId: string }
export type EventLLMMessageOnUsageParams = Parameters<OnUsage>[0] & { requestId: string }

// service -> main -> internal -> event (back to main)
// (browser)









// These are from 'ollama' SDK
interface OllamaModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

export type OllamaModelResponse = {
	name: string;
	modified_at: Date;
	size: number;
	digest: string;
	details: OllamaModelDetails;
	expires_at: Date;
	size_vram: number;
}

export type OpenaiCompatibleModelResponse = {
	id: string;
	created: number;
	object: 'model';
	owned_by: string;
}



// params to the true list fn
export type ModelListParams<ModelResponse> = {
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	onSuccess: (param: { models: ModelResponse[] }) => void;
	onError: (param: { error: string }) => void;
}

// params to the service
export type ServiceModelListParams<modelResponse> = {
	providerName: RefreshableProviderName;
	onSuccess: (param: { models: modelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}

type BlockedMainModelListParams = 'onSuccess' | 'onError'
export type MainModelListParams<modelResponse> = Omit<ModelListParams<modelResponse>, BlockedMainModelListParams> & { providerName: RefreshableProviderName, requestId: string }

export type EventModelListOnSuccessParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onSuccess']>[0] & { requestId: string }
export type EventModelListOnErrorParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onError']>[0] & { requestId: string }
