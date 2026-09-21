/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2, localize } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INotificationActions, INotificationHandle, INotificationService } from '../../../../platform/notification/common/notification.js';
import { IMetricsService } from '../common/metricsService.js';
import { ILoopholeUpdateService } from '../common/voidUpdateService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import * as dom from '../../../../base/browser/dom.js';
import { LoopholeCheckUpdateRespose } from '../common/voidUpdateServiceTypes.js';
import { IAction } from '../../../../base/common/actions.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

const UPDATE_STATUS_BAR_ID = 'loophole.updateAvailable';




let updateStatusBarAccessor: { update: (entry: any) => void; dispose: () => void } | null = null;

const notifyUpdate = (res: LoopholeCheckUpdateRespose & { message: string }, notifService: INotificationService, loopholeUpdateService: ILoopholeUpdateService, statusbarService?: IStatusbarService, storageService?: IStorageService): INotificationHandle => {
	const message = res?.message || 'This is a very old version of Loophole, please download the latest version! [Loophole](https://www.loopholeeditor.in/download-beta)!'

	let actions: INotificationActions | undefined

	if (res?.action) {
		const primary: IAction[] = []

		if (res.action === 'reinstall') {
			primary.push({
				label: `Reinstall`,
				id: 'loophole.updater.reinstall',
				enabled: true,
				tooltip: '',
				class: undefined,
				run: () => {
					const { window } = dom.getActiveWindow()
					window.open('https://www.loopholeeditor.in/download-beta')
				}
			})
		}

		if (res.action === 'download') {
			primary.push({
				label: `Download`,
				id: 'loophole.updater.download',
				enabled: true,
				tooltip: '',
				class: undefined,
				run: async () => {
					const success = await loopholeUpdateService.downloadUpdate();
					if (success) {
						// Refresh the check to show "Restart" button
						const newRes = await loopholeUpdateService.check(true);
						if (newRes && 'message' in newRes && newRes.message) {
							notifyUpdate(newRes as LoopholeCheckUpdateRespose & { message: string }, notifService, loopholeUpdateService, statusbarService, storageService);
						}
					}
				}
			})
		}

		if (res.action === 'apply') {
			primary.push({
				label: `Apply`,
				id: 'loophole.updater.apply',
				enabled: true,
				tooltip: '',
				class: undefined,
				run: async () => {
					await loopholeUpdateService.applyUpdate();
				}
			})
		}

		if (res.action === 'restart') {
			primary.push({
				label: `Restart to Update`,
				id: 'loophole.updater.restart',
				enabled: true,
				tooltip: '',
				class: undefined,
				run: async () => {
					// Clear flag before restart
					storageService?.remove('loophole.pendingUpdate', StorageScope.APPLICATION);
					updateStatusBarAccessor?.dispose();
					updateStatusBarAccessor = null;
					await loopholeUpdateService.quitAndInstall();
				}
			})
		}

		primary.push({
			id: 'loophole.updater.site',
			enabled: true,
			label: `Loophole Site`,
			tooltip: '',
			class: undefined,
			run: () => {
				const { window } = dom.getActiveWindow()
				window.open('https://www.loopholeeditor.in/')
			}
		})

		actions = {
			primary: primary,
			secondary: [{
				id: 'loophole.updater.close',
				enabled: true,
				label: `Keep current version`,
				tooltip: '',
				class: undefined,
				run: () => {
					notifController.close();
					// Clear status bar and pending update flag
					updateStatusBarAccessor?.dispose();
					updateStatusBarAccessor = null;
					storageService?.remove('loophole.pendingUpdate', StorageScope.APPLICATION);
				}
			}]
		}
	}
	else {
		actions = undefined
	}

	// Use Warning severity for restart action to make it more prominent
	const severity = res.action === 'restart' ? Severity.Warning : Severity.Info;

	const notifController = notifService.notify({
		severity: severity,
		message: message,
		sticky: true,
		progress: actions ? { worked: 0, total: 100 } : undefined,
		actions: actions,
	})

	// Add/update status bar entry when update is ready to restart
	if (res.action === 'restart' && statusbarService) {
		const entry = {
			name: localize('updateAvailable', 'Update Available'),
			text: '$(cloud-download) Update Ready',
			ariaLabel: localize('updateAvailableAria', 'An update is ready to install. Click to restart.'),
			tooltip: localize('updateTooltip', 'Click to restart and update Loophole'),
			command: 'loophole.updater.restart',
			showBeak: true,
		};

		if (!updateStatusBarAccessor) {
			updateStatusBarAccessor = statusbarService.addEntry(
				entry,
				UPDATE_STATUS_BAR_ID,
				StatusbarAlignment.LEFT,
				10000 // high priority - right side
			);
		} else {
			updateStatusBarAccessor.update(entry);
		}

		// Store that we have a pending update
		storageService?.store('loophole.pendingUpdate', true, StorageScope.APPLICATION, StorageTarget.USER);
	}

	return notifController
	// const d = notifController.onDidClose(() => {
	// 	notifyYesUpdate(notifService, res)
	// 	d.dispose()
	// })
}
const notifyErrChecking = (notifService: INotificationService): INotificationHandle => {
	const message = `Loophole Error: There was an error checking for updates. If this persists, please get in touch or reinstall Loophole [here](https://github.com/loophole-ai/loophole-ide/releases)!`
	const notifController = notifService.notify({
		severity: Severity.Info,
		message: message,
		sticky: true,
	})
	return notifController
}


const performLoopholeCheck = async (
	explicit: boolean,
	notifService: INotificationService,
	loopholeUpdateService: ILoopholeUpdateService,
	metricsService: IMetricsService,
	statusbarService?: IStatusbarService,
	storageService?: IStorageService,
): Promise<INotificationHandle | null> => {

	const metricsTag = explicit ? 'Manual' : 'Auto'

	metricsService.capture(`LoopholeUpdate ${metricsTag}: Checking...`, {})
	const res = await loopholeUpdateService.check(explicit)
	if (!res) {
		const notifController = notifyErrChecking(notifService);
		metricsService.capture(`LoopholeUpdate ${metricsTag}: Error`, { res })
		return notifController
	}
	else {
		if (res.message) {
			const notifController = notifyUpdate(res, notifService, loopholeUpdateService, statusbarService, storageService)
			metricsService.capture(`LoopholeUpdate ${metricsTag}: Yes`, { res })
			return notifController
		}
		else {
			metricsService.capture(`LoopholeUpdate ${metricsTag}: No`, { res })
			// If no update needed but status bar is showing, clear it
			if (updateStatusBarAccessor) {
				updateStatusBarAccessor.dispose();
				updateStatusBarAccessor = null;
				storageService?.remove('loophole.pendingUpdate', StorageScope.APPLICATION);
			}
			return null
		}
	}
}


// Action
let lastNotifController: INotificationHandle | null = null


registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: true,
			id: 'loophole.voidCheckUpdate',
			title: localize2('loopholeCheckUpdate', 'Loophole: Check for Updates'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const loopholeUpdateService = accessor.get(ILoopholeUpdateService)
		const notifService = accessor.get(INotificationService)
		const metricsService = accessor.get(IMetricsService)
		const statusbarService = accessor.get(IStatusbarService)
		const storageService = accessor.get(IStorageService)

		const currNotifController = lastNotifController

		const newController = await performLoopholeCheck(true, notifService, loopholeUpdateService, metricsService, statusbarService, storageService)

		if (newController) {
			currNotifController?.close()
			lastNotifController = newController
		}
	}
})

// Register restart command for status bar
registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: false,
			id: 'loophole.updater.restart',
			title: localize2('loopholeRestartUpdate', 'Loophole: Restart to Update'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const loopholeUpdateService = accessor.get(ILoopholeUpdateService);
		await loopholeUpdateService.quitAndInstall();
	}
})

// on mount
class LoopholeUpdateWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.loophole.loopholeUpdate'
	constructor(
		@ILoopholeUpdateService loopholeUpdateService: ILoopholeUpdateService,
		@IMetricsService metricsService: IMetricsService,
		@INotificationService notifService: INotificationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super()

		// Check if there's a pending update from previous session
		const hasPendingUpdate = this.storageService.getBoolean('loophole.pendingUpdate', StorageScope.APPLICATION, false);
		if (hasPendingUpdate) {
			// Immediately check to get current status and show notification/statusbar
			performLoopholeCheck(false, notifService, loopholeUpdateService, metricsService, this.statusbarService, this.storageService);
		}

		const autoCheck = () => {
			performLoopholeCheck(false, notifService, loopholeUpdateService, metricsService, this.statusbarService, this.storageService)
		}

		// check once 5 seconds after mount
		// check every 3 hours
		const { window } = dom.getActiveWindow()

		const initId = window.setTimeout(() => autoCheck(), 5 * 1000)
		this._register({ dispose: () => window.clearTimeout(initId) })


		const intervalId = window.setInterval(() => autoCheck(), 3 * 60 * 60 * 1000) // every 3 hrs
		this._register({ dispose: () => window.clearInterval(intervalId) })

	}
}
registerWorkbenchContribution2(LoopholeUpdateWorkbenchContribution.ID, LoopholeUpdateWorkbenchContribution, WorkbenchPhase.BlockRestore);
