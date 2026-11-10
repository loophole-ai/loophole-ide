/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface LoopholeServeConnectParams {
	// override the bundled binary path; undefined = bundled <app>/resources/app/bin/loophole[.exe], then $PATH
	binaryPath?: string;
	// workspace to run the server in (cwd for sessions); undefined = first workspace folder
	workspacePath?: string;
	// extra env to pass to the server process
	env?: { [key: string]: string | undefined };
}

export interface LoopholeServeStatus {
	status: 'disconnected' | 'starting' | 'connected' | 'error';
	port?: number;
	error?: string;
	// which binary is (or would be) used
	binaryPath?: string;
	pid?: number;
}

/** Subset of the server's `Provider.Info` (packages/schema/src/provider.ts). */
export interface LoopholeServeProviderInfo {
	id: string;
	name: string;
	integrationID?: string;
	activation?: string;
}

/** Subset of `Integration.Method` (packages/schema/src/integration.ts). */
export interface LoopholeServeIntegrationMethod {
	/** `oauth`, `command`, `key`, `external`, or `env` today. */
	type: string;
	label?: string;
	names?: string[];
}

/** Subset of `Connection.Info` (packages/schema/src/connection.ts). */
export interface LoopholeServeIntegrationConnection {
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
export interface LoopholeServeIntegrationInfo {
	id: string;
	name: string;
	metadata?: Record<string, unknown>;
	methods: LoopholeServeIntegrationMethod[];
	connections: LoopholeServeIntegrationConnection[];
}

/** Subset of the server's `Model.Info` (packages/schema/src/model.ts). */
export interface LoopholeServeModelInfo {
	id: string;
	modelID: string;
	providerID: string;
	name?: string;
	family?: string;
}

/** Server model selection: an opencode `Model.Ref` without the optional variant. */
export interface LoopholeServeModelRef {
	providerID: string;
	modelID: string;
}

/**
 * `Config.Patch` (packages/schema/src/config.ts) only supports the shell field,
 * so provider keys must NOT go through configUpdate. They are stored via
 * `POST /api/integration/:integrationID/connect/key` instead (see connectKey* below).
 */
export interface LoopholeServeConfigUpdateParams {
	shell?: string | null;
}

/** `POST /api/integration/:integrationID/connect/key` body (packages/protocol/src/groups/integration.ts). */
export interface LoopholeServeConnectKeyParams {
	integrationID: string;
	key: string;
	label?: string;
}

/** Direct Inception FIM completion (loophole serve has no FIM endpoint). */
export interface LoopholeServeFimParams {
	requestId: string;
	prefix: string;
	suffix: string;
	apiKey: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
}

export interface LoopholeServeFimResult {
	text: string;
}

/** Channel event emitted while a `fim` command streams (see `onEvent_loopholeServe`). */
export interface LoopholeServeFimEvent {
	kind: 'fim';
	requestId: string;
	type: 'chunk' | 'final' | 'error';
	text?: string;
	error?: string;
}

// ---- Loophole Serve sessions / messages / commands / skills / permissions /
// ---- usage / revert / voice (all shapes mirror packages/schema + protocol) ----

/** Subset of the server's `Session.Info` (packages/schema/src/session.ts). */
export interface LoopholeServeSessionInfo {
	id: string;
	parentID?: string;
	title?: string;
	cost: number;
	tokens: LoopholeServeTokenUsage;
	time: {
		created: number;
		updated: number;
		busy?: number;
		idle?: number;
	};
	revert?: LoopholeServeRevert;
	[key: string]: unknown;
}

/** `TokenUsage.Info` (packages/schema/src/token-usage.ts). */
export interface LoopholeServeTokenUsage {
	input: number;
	output: number;
	reasoning: number;
	cache: {
		read: number;
		write: number;
	};
}

/** Minimal projected message (packages/schema/src/session-message.ts); extra fields pass through. */
export type LoopholeServeSessionMessage = {
	id: string;
	type: string;
	text?: string;
	content?: Array<LoopholeServeAssistantContent>;
	[key: string]: unknown;
};

export type LoopholeServeAssistantContent = {
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
export interface LoopholeServeCommandInfo {
	name: string;
	description?: string;
}

/** `Skill.Info` (packages/schema/src/skill.ts). */
export interface LoopholeServeSkillInfo {
	id: string;
	name: string;
	description?: string;
	autoinvoke?: boolean;
	path: string;
	content: string;
}

/** `Permission.Request` subset (packages/schema/src/permission.ts); reply is `once | always | reject`. */
export interface LoopholeServePermissionRequest {
	id: string;
	sessionID: string;
	action: string;
	resources: string[];
	save?: string[];
	metadata?: Record<string, unknown>;
	message?: string;
	[key: string]: unknown;
}

export type LoopholeServePermissionDecision = 'once' | 'always' | 'reject';

/** `Session.Revert` (packages/schema/src/session-revert.ts). */
export interface LoopholeServeRevert {
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
export interface LoopholeServeVoiceModel {
	model: string;
	provider: string;
	transports: string[];
	available: boolean;
}

export type LoopholeServeVoiceTransport =
	| { type: 'webrtc'; sdp: string }
	| { type: 'websocket'; url: string; token: string; expiresAt: number };

/** Channel event for a proxied voice WebSocket (see `onEvent_loopholeServe`). */
export interface LoopholeServeVoiceWsEvent {
	kind: 'voiceWs';
	requestId: string;
	type: 'message' | 'error' | 'close';
	text?: string;
	error?: string;
}
