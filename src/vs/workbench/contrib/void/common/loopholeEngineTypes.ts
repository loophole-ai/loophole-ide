/*--------------------------------------------------------------------------------------
 *  Shared contract between the workbench and the Loophole engine channel.
 *--------------------------------------------------------------------------------------*/

/** A model the engine reports it can run. */
export interface EngineModel {
	readonly providerID: string;
	readonly id: string;
	readonly name?: string;
	readonly contextWindow?: number;
	readonly outputTokens?: number;
	readonly supportsTools?: boolean;
	readonly cost?: { readonly input: number; readonly output: number };
}

export interface EngineIntegrationMethod {
	readonly type: 'oauth' | 'command' | 'key' | 'external' | 'env';
	readonly id?: string;
	readonly label?: string;
	readonly names?: string[];
}

export interface EngineIntegrationConnection {
	readonly type: 'credential' | 'env';
	readonly id?: string;
	readonly name?: string;
	readonly label?: string;
	readonly method?: string;
	readonly needsAuth: boolean;
}

export interface EngineIntegration {
	readonly id: string;
	readonly name: string;
	readonly methods: EngineIntegrationMethod[];
	readonly connections: EngineIntegrationConnection[];
}

export interface EngineOAuthAttempt {
	readonly attemptID: string;
	readonly url: string;
	readonly instructions: string;
	readonly mode: 'auto' | 'code';
	readonly expires?: number;
}

export type EngineOAuthAttemptStatus =
	| { readonly status: 'pending' }
	| { readonly status: 'complete' }
	| { readonly status: 'failed'; readonly message?: string }
	| { readonly status: 'expired' };

/** A stored credential, reduced to safe metadata. */
export interface EngineCredential {
	readonly id: string;
	readonly integrationID: string;
	readonly label: string;
	readonly active: boolean;
	readonly kind: 'oauth' | 'key' | 'external';
}

export interface EngineProvider {
	readonly id: string;
	readonly name: string;
	readonly integrationID?: string;
}

export interface ILoopholeEngineMainService {
	readonly _serviceBrand: undefined;
	connect(): Promise<{ ok: true } | { ok: false; error: string }>;
	listModels(directory?: string): Promise<EngineModel[]>;
	defaultModel(directory?: string): Promise<EngineModel | null>;
	listIntegrations(directory?: string): Promise<EngineIntegration[]>;
	getIntegration(integrationID: string, directory?: string): Promise<EngineIntegration>;
	connectWithKey(integrationID: string, key: string, directory?: string, label?: string): Promise<void>;
	connectWithExternal(integrationID: string, methodID: string, directory?: string, label?: string): Promise<void>;
	beginOAuth(integrationID: string, methodID: string, directory?: string, label?: string): Promise<EngineOAuthAttempt>;
	oauthStatus(integrationID: string, attemptID: string, directory?: string): Promise<EngineOAuthAttemptStatus>;
	completeOAuth(integrationID: string, attemptID: string, code: string | undefined, directory?: string): Promise<void>;
	cancelOAuth(integrationID: string, attemptID: string, directory?: string): Promise<void>;
	beginCommand(integrationID: string, methodID: string, directory?: string, label?: string): Promise<{ readonly attemptID: string }>;
	commandStatus(integrationID: string, attemptID: string, directory?: string): Promise<EngineOAuthAttemptStatus>;
	cancelCommand(integrationID: string, attemptID: string, directory?: string): Promise<void>;
	listCredentials(directory?: string): Promise<EngineCredential[]>;
	renameCredential(credentialID: string, label: string, directory?: string): Promise<void>;
	activateCredential(credentialID: string, directory?: string): Promise<void>;
	removeCredential(credentialID: string, directory?: string): Promise<void>;
	listProviders(directory?: string): Promise<EngineProvider[]>;
}
