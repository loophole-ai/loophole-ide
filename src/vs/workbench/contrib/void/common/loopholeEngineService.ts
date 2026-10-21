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
import { ILoopholeEngineMainService, EngineModel } from './loopholeEngineTypes.js';

export interface ILoopholeEngineService {
	readonly _serviceBrand: undefined;
	/** Attach to a running engine or start one. Idempotent. */
	connect(): Promise<{ ok: true } | { ok: false; error: string }>;
	/** Models the engine can run, for the model picker. */
	listModels(directory?: string): Promise<EngineModel[]>;
	/** The engine's default model, used when seeding a fresh selection. */
	defaultModel(directory?: string): Promise<EngineModel | null>;
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
}

registerSingleton(ILoopholeEngineService, LoopholeEngineService, InstantiationType.Eager);
