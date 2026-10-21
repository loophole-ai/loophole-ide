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

export interface ILoopholeEngineMainService {
	readonly _serviceBrand: undefined;
	connect(): Promise<{ ok: true } | { ok: false; error: string }>;
	listModels(directory?: string): Promise<EngineModel[]>;
	defaultModel(directory?: string): Promise<EngineModel | null>;
}
