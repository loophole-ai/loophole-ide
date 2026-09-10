/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Garv Agnihotri, Inc. All rights reserved.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';

export const IReportIssueStatusBarService = createDecorator<IReportIssueStatusBarService>('reportIssueStatusBarService');

export interface IReportIssueStatusBarService {
	readonly _serviceBrand: undefined;
}

export const REPORT_ISSUE_COMMAND_ID = 'loophole.reportIssue';

const REPORT_ISSUE_STATUS_BAR_ID = 'loophole.reportIssue';

export class ReportIssueStatusBarService extends Disposable implements IReportIssueStatusBarService, IWorkbenchContribution {
	static readonly ID = 'loophole.reportIssueStatusBar';
	readonly _serviceBrand: undefined;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
	) {
		super();

		// Add Report Issue button to status bar
		// Priority: 99 places it right next to the token counter (which has priority 100)
		this.statusbarService.addEntry(
			{
				name: localize('reportIssue', 'Report Issue'),
				text: '$(bug) ' + localize('reportIssueText', 'Report Issue'),
				ariaLabel: localize('reportIssueAria', 'Report an issue on GitHub'),
				tooltip: localize('reportIssueTooltip', 'Report a bug or request a feature on GitHub'),
				command: REPORT_ISSUE_COMMAND_ID,
			},
			REPORT_ISSUE_STATUS_BAR_ID,
			StatusbarAlignment.LEFT,
			99 // Just to the right of token counter (100)
		);

		// Register the command
		this._register(
			CommandsRegistry.registerCommand(REPORT_ISSUE_COMMAND_ID, async () => {
				const issueUrl = this.productService.reportIssueUrl || 'https://github.com/loophole-ai/loophole-ide/issues/new';
				await this.openerService.open(URI.parse(issueUrl));
			})
		);
	}
}

registerSingleton(IReportIssueStatusBarService, ReportIssueStatusBarService, InstantiationType.Eager);
registerWorkbenchContribution2(ReportIssueStatusBarService.ID, ReportIssueStatusBarService, WorkbenchPhase.AfterRestored);
