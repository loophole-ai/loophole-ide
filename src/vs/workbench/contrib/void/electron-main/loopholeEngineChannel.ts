/*--------------------------------------------------------------------------------------
 *  Loophole engine channel — exposes the engine to the workbench over IPC.
 *
 *  The renderer cannot spawn processes, so engine discovery crosses this channel. Chat
 *  itself stays on the existing LLM message path (loopholeProvider.impl.ts) so it can
 *  reuse the workbench's streaming and abort plumbing.
 *--------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';
import { EngineModel } from '../common/loopholeEngineTypes.js';
import {
	connect,
	defaultModel,
	listModels,
	stop,
	type EngineCredentials,
} from './loophole/engineAdapter.js';

export class LoopholeEngineChannel implements IServerChannel {
	private credentials: EngineCredentials | undefined;
	private connecting: Promise<EngineCredentials> | undefined;

	listen(_: unknown, event: string): Event<any> {
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		// ProxyChannel passes the method's arguments as an array.
		const arg = Array.isArray(params) ? params[0] : params;
		switch (command) {
			case 'connect':
				return this._connect();
			case 'listModels':
				return this._listModels(typeof arg === 'string' ? arg : undefined);
			case 'defaultModel':
				return this._defaultModel(typeof arg === 'string' ? arg : undefined);
			default:
				throw new Error(`Method not found: ${command}`);
		}
	}

	private ensure(): Promise<EngineCredentials> {
		if (this.credentials) {
			return Promise.resolve(this.credentials);
		}
		if (!this.connecting) {
			this.connecting = connect()
				.then((credentials) => {
					this.credentials = credentials;
					return credentials;
				})
				.finally(() => {
					this.connecting = undefined;
				});
		}
		return this.connecting;
	}

	private async _connect(): Promise<{ ok: true } | { ok: false; error: string }> {
		try {
			await this.ensure();
			return { ok: true };
		} catch (error) {
			this.credentials = undefined;
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	private async _listModels(directory?: string): Promise<EngineModel[]> {
		try {
			return await listModels(await this.ensure(), directory);
		} catch {
			// A failed refresh should leave the previous model list in place, not crash the window.
			this.credentials = undefined;
			return [];
		}
	}

	private async _defaultModel(directory?: string): Promise<EngineModel | null> {
		try {
			return await defaultModel(await this.ensure(), directory);
		} catch {
			this.credentials = undefined;
			return null;
		}
	}

	dispose(): void {
		this.credentials = undefined;
		stop();
	}
}
