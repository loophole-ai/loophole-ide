/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Starts the agent engine when the window is up, rather than waiting for the first message.
//
// The engine is a ~170 MB binary that takes several seconds to become ready, so paying that cost
// on the user's first prompt makes the IDE feel broken. Starting it here means the chat is warm
// by the time they type.
//
// Deliberately NOT awaited: this runs during workbench restore, and blocking that would hold up
// the window. The turn path calls ensureStarted() too, and that is idempotent, so if the user
// sends a message before the engine is ready they simply join the start already in flight
// instead of racing it.
//
// The engine is stopped again by the main process when the last window closes, so it never
// outlives the UI.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IKiloAgentService } from '../common/kiloAgentService.js';

class KiloAgentStartupContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.kiloAgentStartup';

	constructor(@IKiloAgentService private readonly agentService: IKiloAgentService) {
		super();
	}

	async initialize(): Promise<void> {
		try {
			await this.agentService.ensureStarted();
		} catch {
			// A failed warm-up must never break startup. The next chat turn retries, and the real
			// error is reported to the user there with the engine's own message.
		}
	}
}

registerWorkbenchContribution2(
	KiloAgentStartupContribution.ID,
	KiloAgentStartupContribution,
	WorkbenchPhase.AfterRestored,
);