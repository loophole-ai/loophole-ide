/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Starts the Loophole CLI as soon as the workbench has restored.
//
// The CLI used to start only when the chat sidebar mounted (or when a settings
// page asked for it), so the first thing the user did - open chat, open the model
// list - raced a cold start and showed "disconnected" until they clicked
// Reconnect. Booting here puts the cold start (binary spawn + plugin activation)
// in the background of editor startup, so it is already warm when it is needed.
// connect() is idempotent: callers that arrive during startup wait on the same
// attempt instead of spawning a second one.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILoopholeCliService } from '../common/loopholeCliService.js';

export class LoopholeCliBoot extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'loophole.cliBoot';

	constructor(
		@ILoopholeCliService private readonly cli: ILoopholeCliService,
		@IConfigurationService private readonly config: IConfigurationService,
	) {
		super();
		if (this.config.getValue<boolean>('loophole.cli.enabled') === false) return;
		void this.boot();
	}

	private async boot(): Promise<void> {
		try {
			const { status } = await this.cli.status();
			if (status === 'connected' || status === 'starting') return;
			await this.cli.connect();
		} catch (e) {
			// Not fatal: the first feature that needs the CLI retries the connection.
			console.warn(`[LoopholeCli] startup connect failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

registerWorkbenchContribution2(LoopholeCliBoot.ID, LoopholeCliBoot, WorkbenchPhase.AfterRestored);
