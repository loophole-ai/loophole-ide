/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Types shared between the electron-main host (electron-main/kiloAgentHostChannel.ts)
// and the renderer-side service (common/kiloAgentService.ts).
//
// The agent engine is the Kilo CLI running in `serve` mode (a fork of OpenCode, MIT).
// Everything that touches its HTTP API lives in the host channel so that swapping to
// upstream OpenCode later only touches one file.
//
// Every shape below was read out of the engine source rather than guessed; see
// `docs/kilo-engine-notes.md` for the file/line each one came from.

export const KILO_AGENT_CHANNEL = 'void-channel-kilo-agent'

/** Engine version this client is written against. Kept in sync with package.json. */
export const KILO_ENGINE_VERSION = '7.8.3'

// ---------- host lifecycle ----------

export type KiloAgentHostStatus = 'stopped' | 'starting' | 'running' | 'error'

export type KiloAgentHostState = {
	status: KiloAgentHostStatus
	/** human readable detail, e.g. the error when status === 'error' */
	message?: string
	/** engine version reported by /global/health */
	version?: string
}

// ---------- events ----------

/**
 * One event from the engine's `/global/event` stream, flattened and normalized.
 *
 * The engine emits two different payload shapes on the same stream: the legacy bus uses
 * `{ id, type, properties }` and the newer EventV2 bus uses `{ id, type, data }`. The host
 * collapses both into `properties` so the renderer only has to understand one shape.
 *
 * `directory` is the workspace the event belongs to ("global" for app-wide events).
 * The first frame after connecting is `server.connected` and has no directory.
 *
 * Types the chat UI cares about (others are ignored): `message.updated`,
 * `message.part.updated`, `message.part.delta`, `message.part.removed`, `message.removed`,
 * `session.created`, `session.updated`, `session.deleted`, `session.status`, `session.idle`,
 * `session.error`, `session.diff`, `file.edited`, `file.watcher.updated`,
 * `permission.asked`, `permission.replied`, `question.asked`, `question.replied`,
 * `question.rejected`, `todo.updated`, `lsp.client.diagnostics`, `mcp.tools.changed`,
 * `indexing.status`, `indexing.warning`, `server.heartbeat`.
 */
export type KiloAgentEvent = {
	id?: string
	directory: string
	type: string
	properties: Record<string, any>
}

// ---------- engine domain types (only the fields Loophole reads) ----------

export type KiloAgentModelRef = { providerID: string; modelID: string }

/**
 * Mirrors the engine's `EditorContext` (packages/opencode/src/kilocode/editor-context.ts).
 * The engine renders this into an `<environment_details>` block on every user message, so
 * this is how the IDE tells the model what the user is actually looking at.
 */
export type KiloAgentEditorContext = {
	directory?: string
	worktree?: string
	visibleFiles?: string[]
	openTabs?: string[]
	activeFile?: string
	shell?: string
}

export type KiloAgentCreateSessionParams = {
	directory: string
	title?: string
	agent?: string
}

export type KiloAgentPromptParams = {
	directory: string
	sessionID: string
	text: string
	model?: KiloAgentModelRef
	/** engine-side agent/mode name, e.g. "build", "plan" */
	agent?: string
	/** extra system instructions appended for this turn (e.g. merged .voidrules content) */
	system?: string
	/** which tools the engine may use this turn; omitted means the engine's own permissions apply */
	tools?: Record<string, boolean>
	editorContext?: KiloAgentEditorContext
}

export type KiloAgentSessionRef = { directory: string; sessionID: string }

export type KiloAgentPermissionReply = {
	directory: string
	requestID: string
	reply: 'once' | 'always' | 'reject'
	message?: string
}

export type KiloAgentRevertParams = KiloAgentSessionRef & { messageID: string; partID?: string }

/** One choice the model offered. `description` is optional in practice, so treat it as such. */
/** See `Option` in packages/schema/src/v1/question.ts - `description` is not optional there. */
export type KiloAgentQuestionOption = { label: string; description: string; labelKey?: string; descriptionKey?: string; mode?: string }

/** A `question.asked` request can bundle several questions; each is answered in order. */
export type KiloAgentQuestionInfo = {
	question: string
	header: string
	options: KiloAgentQuestionOption[]
	/** when true the user may tick more than one option */
	multiple?: boolean
	/** when true the user may type an answer instead of choosing (engine default: true) */
	custom?: boolean
	/** exact option label to preselect; ignored when `multiple` or unknown */
	default?: string
}

/** See `Request` in packages/schema/src/v1/question.ts. */
export type KiloAgentQuestion = {
	id: string
	sessionID: string
	questions: KiloAgentQuestionInfo[]
	/** whether this question blocks prompt input (engine default: true) */
	blocking?: boolean
	tool?: { messageID: string; callID: string }
}

export type KiloAgentQuestionReply = {
	directory: string
	questionID: string
	/**
	 * One entry per question, in the order they were asked. Each entry is the list of selected
	 * option labels (or a single free-form string the user typed).
	 */
	answers: string[][]
}

export type KiloAgentTodo = {
	id: string
	content: string
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | string
	priority?: 'low' | 'medium' | 'high' | string
}

/**
 * One entry of `GET /session/{id}/diff`.
 *
 * Note the field is `file`, not `path`, and — critically for the diff bridge — the engine
 * returns the full `before`/`after` content alongside the unified patch. That is what makes
 * an exact reject possible without maintaining our own pre-edit snapshots.
 * See packages/schema/src/file-diff.ts.
 */
export type KiloAgentFileDiff = {
	file: string
	status?: 'added' | 'deleted' | 'modified'
	additions: number
	deletions: number
	/** unified diff text; may be absent for very large changes */
	patch?: string
	/** full content before the engine's edit; absent for files it created */
	before?: string
	/** full content after the engine's edit; absent for files it deleted */
	after?: string
}

/** A pending permission request, as surfaced by `permission.asked` / `GET /permission`. */
export type KiloAgentPermission = {
	id: string
	sessionID: string
	/** what the engine wants to do, e.g. "bash" or "edit" */
	permission: string
	patterns: string[]
	metadata?: Record<string, any>
	/** the "always allow" options the engine suggests, if any */
	always?: string[]
	tool?: { messageID: string; callID: string }
}



// ---------- indexing ----------

export type KiloIndexingState = 'Disabled' | 'In Progress' | 'Indexed' | 'Standby' | 'Error' | string

export type KiloIndexingStatus = {
	state: KiloIndexingState
	message: string
	processedFiles: number
	totalFiles: number
	percent: number
}

/**
 * Mirrors the engine's `indexing` config block.
 *
 * `kilo` (Kilo-hosted embeddings) is intentionally absent from the provider union: Loophole
 * must never send user code to Kilo's servers for embeddings, so it is not offered.
 */
export type KiloIndexingProvider =
	| 'ollama'
	| 'openai'
	| 'openai-compatible'
	| 'gemini'
	| 'mistral'
	| 'bedrock'
	| 'openrouter'
	| 'voyage'

export type KiloIndexingConfig = {
	enabled?: boolean
	provider?: KiloIndexingProvider
	model?: string | null
	dimension?: number | null
	vectorStore?: 'lancedb' | 'qdrant'
	openai?: { apiKey?: string }
	ollama?: { baseUrl?: string }
	'openai-compatible'?: { baseUrl?: string; apiKey?: string }
}

// ---------- config / providers / mcp ----------

export type KiloAgentConfigPatch = Record<string, unknown>

/**
 * What `GET /provider` reports. This is the only trustworthy signal that a pushed credential
 * took effect, because `PUT /auth/{id}` answers 200 for ids the engine does not know.
 */
export type KiloProviderStatus = { connected: string[]; failed: string[] };

/**
 * The provider ids the engine recognises. Anything outside this list is accepted by
 * `PUT /auth/{id}` with a 200 and then never connects, so the settings UI checks against it.
 *
 * Note `kilo` (Kilo's hosted gateway) is deliberately not here, and neither is plain `ollama` -
 * only `ollama-cloud` exists upstream, so a local Ollama server is declared as a custom
 * OpenAI-compatible entry instead. See kiloAgentEngineMapping.ts.
 */
export const KNOWN_CONNECTED_PROVIDER_IDS = [
	'openai', 'anthropic', 'google', 'xai', 'mistral', 'groq', 'deepseek',
	'openrouter', 'amazon-bedrock', 'lmstudio', 'azure', 'google-vertex',
] as const;

/**
 * Compile-time proof that the blocked ids can never be added to the allowlist above.
 *
 * For each blocked id, `'kilo' extends AllowedId` is `false` while the id is absent from the
 * list, which the conditional turns into `true`. Adding `'kilo'` to
 * KNOWN_CONNECTED_PROVIDER_IDS makes it assignable, the conditional yields `false`, and
 * `_AssertTrue` fails - so the build breaks instead of the block silently lapsing.
 *
 * Exported purely so `noUnusedLocals` does not flag it; it has no runtime effect.
 */
type _AssertTrue<T extends true> = T;
type AllowedProviderId = (typeof KNOWN_CONNECTED_PROVIDER_IDS)[number];
type _KiloStaysBlocked = _AssertTrue<'kilo' extends AllowedProviderId ? false : true>;
type _OpencodeZenStaysBlocked = _AssertTrue<'opencode' extends AllowedProviderId ? false : true>;
type _OpencodeGoStaysBlocked = _AssertTrue<'opencode-go' extends AllowedProviderId ? false : true>;
export type _BlockedProvidersStayExcluded =
	[_KiloStaysBlocked, _OpencodeZenStaysBlocked, _OpencodeGoStaysBlocked];

/** Per-provider outcome of a settings sync, for the settings UI. */
export type KiloProviderSyncResult = {
	providers: Array<{ providerID: string; ok: boolean; reason?: string }>;
};

/** A runtime MCP server registration (`POST /mcp` body is `{ name, config }`). */
export type KiloAgentMcpServer = {
	name: string
	config: {
		type: 'local'
		command: string[]
		cwd?: string
		environment?: Record<string, string>
		enabled?: boolean
		timeout?: number
	} | {
		type: 'remote'
		url: string
		enabled?: boolean
		headers?: Record<string, string>
		timeout?: number
	}
}

export type KiloAgentMcpRegistration = KiloAgentMcpServer & { directory?: string }

// ---------- channel command names (renderer -> main) ----------

export type KiloAgentCommand =
	// lifecycle
	| 'start'
	| 'stop'
	| 'getState'
	// sessions
	| 'createSession'
	| 'listSessions'
	| 'getSession'
	| 'getMessages'
	| 'prompt'
	| 'abort'
	| 'deleteSession'
	| 'listAgents'
	// approvals
	| 'replyPermission'
	| 'listPendingPermissions'
	| 'listPendingQuestions'
	| 'replyQuestion'
	| 'rejectQuestion'
	// edits
	| 'getDiff'
	| 'revert'
	| 'unrevert'
	| 'getTodos'
	// indexing
	| 'getIndexingStatus'
	| 'configureIndexing'
	| 'listIndexingModels'
	// config / providers
	| 'listProviders'
	| 'getProviderStatus'
	| 'getConfig'
	| 'patchConfig'
	| 'setAuth'
	| 'removeAuth'
	// mcp
	| 'addMcpServer'
	| 'removeMcpServer'
	| 'listMcpServers'
