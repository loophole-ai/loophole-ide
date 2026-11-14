/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Checks for updates when the workbench is restored.
//
// The desktop app does this on launch, and the CLI ships a release every few
// days, so the editor should not wait for the user to open Settings > About.
// Two checks run here:
//   1. the Loophole CLI, via ILoopholeCliService.updateCheck() (npm registry),
//      with an inline "Update" action that installs and restarts it;
//   2. the editor itself, via the GitHub releases of loophole-ai/loophole-ide.
//      The editor's built-in updater is disabled in this build, so the action
//      opens the release page instead of pretending to self-update.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILoopholeCliService } from '../common/loopholeCliService.js';

const STARTUP_DELAY_MS = 8000;
const IDE_REPO = 'loophole-ai/loophole-ide';

/** True when `candidate` is a newer dotted version than `current`. */
const isNewer = (candidate: string, current: string): boolean => {
	const parse = (value: string) => value.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
	const next = parse(candidate);
	const now = parse(current);
	for (let i = 0; i < Math.max(next.length, now.length); i++) {
		const a = next[i] ?? 0;
		const b = now[i] ?? 0;
		if (a !== b) return a > b;
	}
	return false;
};

export class LoopholeUpdateChecker extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'loophole.updateChecker';

	constructor(
		@ILoopholeCliService private readonly cli: ILoopholeCliService,
		@INotificationService private readonly notifications: INotificationService,
		@IProductService private readonly product: IProductService,
		@IOpenerService private readonly opener: IOpenerService,
		@IConfigurationService private readonly config: IConfigurationService,
	) {
		super();
		const handle = setTimeout(() => void this.check(), STARTUP_DELAY_MS);
		this._register({ dispose: () => clearTimeout(handle) });
	}

	private async check(): Promise<void> {
		if (this.config.getValue<boolean>('loophole.updates.checkOnStartup') === false) return;
		await Promise.allSettled([this.checkCli(), this.checkEditor()]);
	}

	private async checkCli(): Promise<void> {
		try {
			const update = await this.cli.updateCheck();
			if (!update.updateAvailable || !update.latest) return;
			this.notifications.notify({
				severity: Severity.Info,
				message: localize('loophole.cliUpdate', 'Loophole CLI {0} is available (you have {1}).', update.latest, update.current),
				actions: {
					primary: [{
						id: 'loophole.cliUpdate.install',
						label: localize('loophole.cliUpdate.install', 'Update CLI'),
						tooltip: '',
						class: undefined,
						enabled: true,
						run: async () => {
							const result = await this.cli.updateInstall({ version: update.latest });
							this.notifications.notify({
								severity: result.ok ? Severity.Info : Severity.Error,
								message: result.ok
									? localize('loophole.cliUpdate.done', 'Loophole CLI updated to {0}.', result.version)
									: localize('loophole.cliUpdate.failed', 'Loophole CLI update failed: {0}', result.output),
							});
						},
					}],
				},
			});
		} catch {
			// Offline or the registry is unreachable: stay quiet on startup.
		}
	}

	private async checkEditor(): Promise<void> {
		try {
			const response = await fetch(`https://api.github.com/repos/${IDE_REPO}/releases/latest`, {
				headers: { accept: 'application/vnd.github+json', 'user-agent': `loophole/${this.product.version}` },
			});
			if (!response.ok) return;
			const release = (await response.json()) as { tag_name?: string; html_url?: string };
			const latest = release.tag_name ?? '';
			if (!latest || !isNewer(latest, this.product.version)) return;
			const url = release.html_url ?? `https://github.com/${IDE_REPO}/releases/latest`;
			this.notifications.notify({
				severity: Severity.Info,
				message: localize('loophole.editorUpdate', 'Loophole {0} is available (you have {1}).', latest, this.product.version),
				actions: {
					primary: [{
						id: 'loophole.editorUpdate.download',
						label: localize('loophole.editorUpdate.download', 'Download'),
						tooltip: '',
						class: undefined,
						enabled: true,
						run: () => void this.opener.open(URI.parse(url)),
					}],
				},
			});
		} catch {
			// Offline: no notification.
		}
	}
}

registerWorkbenchContribution2(LoopholeUpdateChecker.ID, LoopholeUpdateChecker, WorkbenchPhase.AfterRestored);
