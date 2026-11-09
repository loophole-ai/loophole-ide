/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import type { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import type { LoopholeServeConnectParams, LoopholeServeStatus } from './loopholeServeTypes.js';

/** Loophole Serve (opencode) backend connection. See LOOPSERVE.md. */
export const ILoopholeServeService = createDecorator<ILoopholeServeService>('loopholeServeService');

export interface ILoopholeServeService {
	readonly _serviceBrand: undefined;
	/** Spawn/attach to the bundled `loophole serve` and wait until it responds. */
	connect: (params?: LoopholeServeConnectParams) => Promise<LoopholeServeStatus>;
	/** Stop the server process we spawned (attach-mode servers are left alone). */
	disconnect: () => Promise<void>;
	status: () => Promise<LoopholeServeStatus>;
}

export class LoopholeServeService extends Disposable implements ILoopholeServeService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
	) {
		super();
		this.channel = this.mainProcessService.getChannel('void-channel-loopholeServe');
	}

	async connect(params: LoopholeServeConnectParams = {}): Promise<LoopholeServeStatus> {
		return this.channel.call('connect', params);
	}

	async disconnect(): Promise<void> {
		await this.channel.call('disconnect');
	}

	async status(): Promise<LoopholeServeStatus> {
		return this.channel.call('status');
	}
}

registerSingleton(ILoopholeServeService, LoopholeServeService, InstantiationType.Eager);
