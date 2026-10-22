/*--------------------------------------------------------------------------------------
 *  Loophole engine service — the workbench-facing API for the loophole engine.
 *
 *  Autocomplete deliberately does NOT come through here: the engine has no FIM model, so
 *  inline completion keeps using the IDE's own providers.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import {
	ILoopholeEngineMainService,
	EngineCredential,
	EngineIntegration,
	EngineModel,
	EngineOAuthAttempt,
	EngineOAuthAttemptStatus,
	EngineProvider,
} from './loopholeEngineTypes.js';

export interface ILoopholeEngineService {
	readonly _serviceBrand: undefined;
	/** Attach to a running engine or start one. Idempotent. */
	connect(): Promise<{ ok: true } | { ok: false; error: string }>;
	/** Models the engine can run, for the model picker. */
	listModels(directory?: string): Promise<EngineModel[]>;
	/** The engine's default model, used when seeding a fresh selection. */
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

export const ILoopholeEngineService = createDecorator<ILoopholeEngineService>('loopholeEngineService');

export class LoopholeEngineService implements ILoopholeEngineService {
	readonly _serviceBrand: undefined;
	private readonly _main: ILoopholeEngineMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._main = ProxyChannel.toService<ILoopholeEngineMainService>(mainProcessService.getChannel('void-channel-loopholeEngine'));
	}

	connect = () => this._main.connect();
	listModels = (directory?: string) => this._main.listModels(directory);
	defaultModel = (directory?: string) => this._main.defaultModel(directory);
	listIntegrations = (directory?: string) => this._main.listIntegrations(directory);
	getIntegration = (integrationID: string, directory?: string) => this._main.getIntegration(integrationID, directory);
	connectWithKey = (integrationID: string, key: string, directory?: string, label?: string) => this._main.connectWithKey(integrationID, key, directory, label);
	connectWithExternal = (integrationID: string, methodID: string, directory?: string, label?: string) => this._main.connectWithExternal(integrationID, methodID, directory, label);
	beginOAuth = (integrationID: string, methodID: string, directory?: string, label?: string) => this._main.beginOAuth(integrationID, methodID, directory, label);
	oauthStatus = (integrationID: string, attemptID: string, directory?: string) => this._main.oauthStatus(integrationID, attemptID, directory);
	completeOAuth = (integrationID: string, attemptID: string, code: string | undefined, directory?: string) => this._main.completeOAuth(integrationID, attemptID, code, directory);
	cancelOAuth = (integrationID: string, attemptID: string, directory?: string) => this._main.cancelOAuth(integrationID, attemptID, directory);
	beginCommand = (integrationID: string, methodID: string, directory?: string, label?: string) => this._main.beginCommand(integrationID, methodID, directory, label);
	commandStatus = (integrationID: string, attemptID: string, directory?: string) => this._main.commandStatus(integrationID, attemptID, directory);
	cancelCommand = (integrationID: string, attemptID: string, directory?: string) => this._main.cancelCommand(integrationID, attemptID, directory);
	listCredentials = (directory?: string) => this._main.listCredentials(directory);
	renameCredential = (credentialID: string, label: string, directory?: string) => this._main.renameCredential(credentialID, label, directory);
	activateCredential = (credentialID: string, directory?: string) => this._main.activateCredential(credentialID, directory);
	removeCredential = (credentialID: string, directory?: string) => this._main.removeCredential(credentialID, directory);
	listProviders = (directory?: string) => this._main.listProviders(directory);
}

registerSingleton(ILoopholeEngineService, LoopholeEngineService, InstantiationType.Eager);
