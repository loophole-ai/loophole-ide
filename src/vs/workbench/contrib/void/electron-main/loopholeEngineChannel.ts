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
	activateCredential,
	beginCommand,
	beginOAuth,
	cancelCommand,
	cancelOAuth,
	commandStatus,
	completeOAuth,
	connect,
	connectWithExternal,
	connectWithKey,
	defaultModel,
	getIntegration,
	listCredentials,
	listIntegrations,
	listModels,
	listProviders,
	oauthStatus,
	removeCredential,
	renameCredential,
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
		const args = Array.isArray(params) ? params : [params];
		const arg = args[0];
		switch (command) {
			case 'connect':
				return this._connect();
			case 'listModels':
				return this._listModels(typeof arg === 'string' ? arg : undefined);
			case 'defaultModel':
				return this._defaultModel(typeof arg === 'string' ? arg : undefined);
			case 'listIntegrations':
				return this._use((credentials) => listIntegrations(credentials, arg));
			case 'getIntegration':
				return this._use((credentials) => getIntegration(credentials, args[1], arg));
			case 'connectWithKey':
				return this._use((credentials) => connectWithKey(credentials, args[1], args[2], arg, args[3]));
			case 'connectWithExternal':
				return this._use((credentials) => connectWithExternal(credentials, args[1], args[2], arg, args[3]));
			case 'beginOAuth':
				return this._use((credentials) => beginOAuth(credentials, args[1], args[2], arg, args[3]));
			case 'oauthStatus':
				return this._use((credentials) => oauthStatus(credentials, args[1], args[2], arg));
			case 'completeOAuth':
				return this._use((credentials) => completeOAuth(credentials, args[1], args[2], args[3], arg));
			case 'cancelOAuth':
				return this._use((credentials) => cancelOAuth(credentials, args[1], args[2], arg));
			case 'beginCommand':
				return this._use((credentials) => beginCommand(credentials, args[1], args[2], arg, args[3]));
			case 'commandStatus':
				return this._use((credentials) => commandStatus(credentials, args[1], args[2], arg));
			case 'cancelCommand':
				return this._use((credentials) => cancelCommand(credentials, args[1], args[2], arg));
			case 'listCredentials':
				return this._use((credentials) => listCredentials(credentials, arg));
			case 'renameCredential':
				return this._use((credentials) => renameCredential(credentials, args[1], args[2], arg));
			case 'activateCredential':
				return this._use((credentials) => activateCredential(credentials, args[1], arg));
			case 'removeCredential':
				return this._use((credentials) => removeCredential(credentials, args[1], arg));
			case 'listProviders':
				return this._use((credentials) => listProviders(credentials, arg));
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

	private async _use<T>(action: (credentials: EngineCredentials) => Promise<T>): Promise<T> {
		try {
			return await action(await this.ensure());
		} catch (error) {
			this.credentials = undefined;
			throw error;
		}
	}

	dispose(): void {
		this.credentials = undefined;
		stop();
	}
}
