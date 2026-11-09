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
