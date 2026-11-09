/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Phase 3: bottom-left "Autocomplete" status item (Kilo position).
// Shows enabled/disabled + completion count; click toggles `loophole.fim.enabled`.
// Tooltip mirrors: "Loophole completed N completions between ... for a total cost of $X."

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { loopholeFimStats, onDidChangeLoopholeFimStats } from './loopholeFimProvider.js';

export const LOOHOLE_AUTOCOMPLETE_TOGGLE_COMMAND_ID = 'loophole.toggleAutocomplete';

const AUTOCOMPLETE_STATUS_BAR_ID = 'loophole.autocomplete';

const formatTime = (timestamp: number): string =>
	new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export class LoopholeAutocompleteStatusBar extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'loophole.autocompleteStatusBar';
	readonly _serviceBrand: undefined;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		const accessor = this.statusbarService.addEntry(
			{
				name: localize('loopholeAutocomplete', 'Autocomplete'),
				text: this._text(),
				ariaLabel: localize('loopholeAutocompleteAria', 'Loophole Autocomplete'),
				tooltip: this._tooltip(),
				command: LOOHOLE_AUTOCOMPLETE_TOGGLE_COMMAND_ID,
			},
			AUTOCOMPLETE_STATUS_BAR_ID,
			StatusbarAlignment.LEFT,
			98,
		);
		this._register(accessor);

		const update = () => {
			accessor.update({
				name: localize('loopholeAutocomplete', 'Autocomplete'),
				text: this._text(),
				ariaLabel: localize('loopholeAutocompleteAria', 'Loophole Autocomplete'),
				tooltip: this._tooltip(),
				command: LOOHOLE_AUTOCOMPLETE_TOGGLE_COMMAND_ID,
			});
		};
		this._register(onDidChangeLoopholeFimStats(() => update()));
		this._register(this.configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('loophole.fim.enabled') || e.affectsConfiguration('loophole.fim.apiKey')) update();
		}));

		this._register(CommandsRegistry.registerCommand(LOOHOLE_AUTOCOMPLETE_TOGGLE_COMMAND_ID, async () => {
			const enabled = this.configurationService.getValue<boolean>('loophole.fim.enabled') !== false;
			await this.configurationService.updateValue('loophole.fim.enabled', !enabled);
		}));
	}

	private _isEnabled(): boolean {
		return this.configurationService.getValue<boolean>('loophole.fim.enabled') !== false;
	}

	private _text(): string {
		const { completionCount } = loopholeFimStats;
		return this._isEnabled()
			? `Autocomplete (${completionCount})`
			: 'Autocomplete';
	}

	private _tooltip(): string {
		if (!this._isEnabled()) {
			return localize('loopholeAutocompleteDisabled', 'Loophole Autocomplete is disabled. Click to enable.');
		}
		const { completionCount, firstCompletionStart } = loopholeFimStats;
		if (completionCount === 0 || !firstCompletionStart) {
			return localize('loopholeAutocompleteBasic', 'Loophole Autocomplete (Inception FIM). Click to toggle.');
		}
		return localize('loopholeAutocompleteSummary', 'Loophole completed {0} completions between {1} and {2}, for a total cost of {3}.',
			completionCount, formatTime(firstCompletionStart), formatTime(Date.now()), '$0.00');
	}
}

registerWorkbenchContribution2(LoopholeAutocompleteStatusBar.ID, LoopholeAutocompleteStatusBar, WorkbenchPhase.AfterRestored);
