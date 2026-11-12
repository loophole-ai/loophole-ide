/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface LoopholeCliConnectParams {
	// override the bundled binary path; undefined = bundled <app>/resources/app/bin/loophole[.exe], then $PATH
	binaryPath?: string;
	// workspace to run the server in (cwd for sessions); undefined = first workspace folder
	workspacePath?: string;
	// extra env to pass to the server process
	env?: { [key: string]: string | undefined };
}

export interface LoopholeCliStatus {
	status: 'disconnected' | 'starting' | 'connected' | 'error';
	port?: number;
	error?: string;
	// which binary is (or would be) used
	binaryPath?: string;
	pid?: number;
}

/** Result of comparing the installed CLI with the published release. */
export interface LoopholeCliUpdateInfo {
	/** Version reported by the installed binary, e.g. "loophole-cli v1.1.5". */
	current: string;
	/** Latest published version, or empty when the check failed. */
	latest: string;
	updateAvailable: boolean;
	/** Release notes for `latest`, from the GitHub release body. */
	notes?: string;
	/** Release page to open in a browser. */
	url?: string;
	/** Why the check failed, when it did. */
	error?: string;
}

/** Result of running an upgrade. */
export interface LoopholeCliUpdateResult {
	ok: boolean;
	version: string;
	output: string;
}

/** Subset of the server's `Provider.Info` (packages/schema/src/provider.ts). */
export interface LoopholeCliProviderInfo {	id: string;
	name: string;
	integrationID?: string;
	activation?: string;
}

/** Subset of `Integration.Method` (packages/schema/src/integration.ts). */
export interface LoopholeCliIntegrationMethod {
	/** `oauth`, `command`, `key`, `external`, or `env` today. */
	type: string;
	label?: string;
	names?: string[];
}

/** Subset of `Connection.Info` (packages/schema/src/connection.ts). */
export interface LoopholeCliIntegrationConnection {
	type: 'credential' | 'env';
	id?: string;
	label?: string;
	method?: 'key' | 'oauth' | 'external';
	name?: string;
	status?: {
		status: string;
		message: string;
		url?: string;
	};
}

/** Subset of `Integration.Info` (packages/schema/src/integration.ts). */
export interface LoopholeCliIntegrationInfo {
	id: string;
	name: string;
	metadata?: Record<string, unknown>;
	methods: LoopholeCliIntegrationMethod[];
	connections: LoopholeCliIntegrationConnection[];
}

/** Subset of the server's `Model.Info` (packages/schema/src/model.ts). */
export interface LoopholeCliModelInfo {
	id: string;
	modelID: string;
	providerID: string;
	name?: string;
	family?: string;
}

/** CLI model selection: a `Model.Ref` without the optional variant. */
export interface LoopholeCliModelRef {
	providerID: string;
	modelID: string;
}

/** Subset of the CLI's `Config.Info` used by the Context and Commit Message pages. */
export interface LoopholeCliCompactionConfig {
	auto?: boolean;
	threshold_percent?: number | null;
	prune?: boolean;
}

export interface LoopholeCliConfig {
	model?: string | null;
	small_model?: string | null;
	subagent_model?: string | null;
	compaction?: LoopholeCliCompactionConfig;
	commit_message?: {
		prompt?: string;
	};
}

/**
 * `PATCH /api/config` body. Provider keys must NOT go through this endpoint;
 * they are stored via `POST /api/integration/:integrationID/connect/key`
 * instead (see connectKey below).
 */
export interface LoopholeCliConfigUpdateParams extends LoopholeCliConfig {
	shell?: string | null;
}

/** `POST /api/integration/:integrationID/connect/key` body (packages/protocol/src/groups/integration.ts). */
export interface LoopholeCliConnectKeyParams {
	integrationID: string;
	key: string;
	label?: string;
}

/** Direct Inception FIM completion (the CLI has no FIM endpoint). */
export interface LoopholeCliFimParams {
	requestId: string;
	prefix: string;
	suffix: string;
	apiKey: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
}

export interface LoopholeCliFimResult {
	text: string;
}

/** Channel event emitted while a `fim` command streams (see `onEvent_loopholeCli`). */
export interface LoopholeCliFimEvent {
	kind: 'fim';
	requestId: string;
	type: 'chunk' | 'final' | 'error';
	text?: string;
	error?: string;
}

// ---- Loophole CLI sessions / messages / commands / skills / permissions /
// ---- usage / revert / voice (all shapes mirror packages/schema + protocol) ----

/** Subset of the server's `Session.Info` (packages/schema/src/session.ts). */
export interface LoopholeCliSessionInfo {
	id: string;
	parentID?: string;
	title?: string;
	cost: number;
	tokens: LoopholeCliTokenUsage;
	time: {
		created: number;
		updated: number;
		busy?: number;
		idle?: number;
	};
	revert?: LoopholeCliRevert;
	[key: string]: unknown;
}

/** `TokenUsage.Info` (packages/schema/src/token-usage.ts). */
export interface LoopholeCliTokenUsage {
	input: number;
	output: number;
	reasoning: number;
	cache: {
		read: number;
		write: number;
	};
}

/** Minimal projected message (packages/schema/src/session-message.ts); extra fields pass through. */
export type LoopholeCliSessionMessage = {
	id: string;
	type: string;
	text?: string;
	content?: Array<LoopholeCliAssistantContent>;
	[key: string]: unknown;
};

export type LoopholeCliAssistantContent = {
	type: string;
	text?: string;
	// tool part: { id, name, state: { status, input?, content?, error? } }
	id?: string;
	name?: string;
	state?: {
		status?: string;
		input?: Record<string, unknown>;
		content?: Array<{ type?: string; text?: string }>;
		error?: { message?: string };
		[key: string]: unknown;
	};
	[key: string]: unknown;
};

/** `Command.Info` (packages/schema/src/command.ts). */
export interface LoopholeCliCommandInfo {
	name: string;
	description?: string;
}

/** `Skill.Info` (packages/schema/src/skill.ts). */
export interface LoopholeCliSkillInfo {
	id: string;
	name: string;
	description?: string;
	autoinvoke?: boolean;
	path: string;
	content: string;
}

/** `Permission.Request` subset (packages/schema/src/permission.ts); reply is `once | always | reject`. */
export interface LoopholeCliPermissionRequest {
	id: string;
	sessionID: string;
	action: string;
	resources: string[];
	save?: string[];
	metadata?: Record<string, unknown>;
	message?: string;
	[key: string]: unknown;
}

export type LoopholeCliPermissionDecision = 'once' | 'always' | 'reject';

/** `Session.Revert` (packages/schema/src/session-revert.ts). */
export interface LoopholeCliRevert {
	messageID: string;
	snapshot?: string;
	files?: Array<{
		file?: string;
		status?: string;
		additions?: number;
		deletions?: number;
		patch?: string;
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
}

/** `VoiceModel` (packages/protocol/src/groups/voice.ts). */
export interface LoopholeCliVoiceModel {
	model: string;
	provider: string;
	transports: string[];
	available: boolean;
}

export type LoopholeCliVoiceTransport =
	| { type: 'webrtc'; sdp: string }
	| { type: 'websocket'; url: string; token: string; expiresAt: number };

/** Channel event for a proxied voice WebSocket (see `onEvent_loopholeCli`). */
export interface LoopholeCliVoiceWsEvent {
	kind: 'voiceWs';
	requestId: string;
	type: 'message' | 'error' | 'close';
	text?: string;
	error?: string;
}

/**
 * Largest tool input/output/compaction string the IDE keeps for one CLI call.
 * A web page or file dump can be arbitrarily large; keeping it whole would sit
 * in the webview's memory (and thread storage) forever, so it is cut here.
 */
const CLI_TEXT_LIMIT = 20_000;

/** Marker appended when CLI text is cut at CLI_TEXT_LIMIT. */
export const LOOPHOLE_CLI_TRUNCATION_MARKER = '\n… (truncated)';

/** Truncate CLI text before it is stored or sent to the webview. */
export const truncateLoopholeCliText = (text: string, limit: number = CLI_TEXT_LIMIT): string => {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}${LOOPHOLE_CLI_TRUNCATION_MARKER}`;
};
