/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { LoopholeCheckUpdateRespose, ILoopholeUpdateInfo } from './voidUpdateServiceTypes.js';

export const ILoopholeUpdateService = createDecorator<ILoopholeUpdateService>('LoopholeUpdateService');


export interface ILoopholeUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<LoopholeCheckUpdateRespose>;
	downloadUpdate: () => Promise<boolean>;
	applyUpdate: () => Promise<boolean>;
	quitAndInstall: () => Promise<void>;
	getUpdateInfo: () => Promise<ILoopholeUpdateInfo>;
}





// implemented by calling channel
export class LoopholeUpdateService implements ILoopholeUpdateService {

	readonly _serviceBrand: undefined;
	private readonly loopholeUpdateService: ILoopholeUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
	) {
		// creates an IPC proxy to use voidUpdateMainService.ts
		this.loopholeUpdateService = ProxyChannel.toService<ILoopholeUpdateService>(mainProcessService.getChannel('loophole-channel-update'));
	}

	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: ILoopholeUpdateService['check'] = async (explicit) => {
		const res = await this.loopholeUpdateService.check(explicit);
		return res;
	}

	downloadUpdate: ILoopholeUpdateService['downloadUpdate'] = async () => {
		const res = await this.loopholeUpdateService.downloadUpdate();
		return res;
	}

	applyUpdate: ILoopholeUpdateService['applyUpdate'] = async () => {
		const res = await this.loopholeUpdateService.applyUpdate();
		return res;
	}

	quitAndInstall: ILoopholeUpdateService['quitAndInstall'] = async () => {
		await this.loopholeUpdateService.quitAndInstall();
	}

	getUpdateInfo: ILoopholeUpdateService['getUpdateInfo'] = async () => {
		const res = await this.loopholeUpdateService.getUpdateInfo();
		return res;
	}
}

registerSingleton(ILoopholeUpdateService, LoopholeUpdateService, InstantiationType.Eager);
