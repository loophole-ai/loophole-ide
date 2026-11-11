/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Phase 3: Loophole FIM autocomplete (Kilo-grade).
//
// Direct Inception FIM POST (the CLI has no FIM endpoint):
//   POST https://api.inceptionlabs.ai/v1/fim/completions
//   { model, prompt: prefix, suffix, max_tokens: 256, temperature: 0 }
//   Authorization: Bearer <loophole.fim.apiKey>
//
// FULLY INERT when `loophole.fim.enabled` is false or the API key is empty
// (log/console hint only, never popups). Registered alongside the existing
// AutocompleteService provider (see autocompleteService.ts) following the same
// `ILanguageFeaturesService.inlineCompletionsProvider.register` pattern.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { EndOfLinePreference, ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILoopholeCliService } from '../common/loopholeCliService.js';
import { extractCodeFromRegular } from '../common/helpers/extractCodeFromResult.js';

// --- completion stats shared with the status bar ---
export const loopholeFimStats = {
	completionCount: 0,
	firstCompletionStart: 0,
	lastCompletionEnd: 0,
};
const _onFimStatsChanged = new Emitter<void>();
export const onDidChangeLoopholeFimStats = _onFimStatsChanged.event;

const DEBOUNCE_MS = 500;
const MIN_PREFIX_LENGTH = 5;
const MAX_TOKENS = 256;
const FIM_TEMPERATURE = 0;

// trim all whitespace except a single leading/trailing space (mirrors autocompleteService.ts)
const processStartAndEndSpaces = (result: string): string => {
	const [text,] = extractCodeFromRegular({ text: result, recentlyAddedTextLen: result.length });
	const hasLeadingSpace = text.startsWith(' ');
	const hasTrailingSpace = text.endsWith(' ');
	return (hasLeadingSpace ? ' ' : '')
		+ text.trim()
		+ (hasTrailingSpace ? ' ' : '');
};

export class LoopholeFimProvider extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.void.loopholeFimProvider';

	private _lastRequestStart = 0;
	private _activeRequestId: string | null = null;
	private _loggedInert = false;

	constructor(
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILoopholeCliService private readonly _cliService: ILoopholeCliService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		this._register(this._languageFeaturesService.inlineCompletionsProvider.register('*', {
			provideInlineCompletions: async (model, position, context, token) => {
				const items = await this._provide(model, position, token);
				return { items };
			},
			handleItemDidShow: (_completions: unknown, _item: unknown, _updatedInsertText: string) => { /* no-op */ },
			disposeInlineCompletions: (_completions: unknown) => { /* no-op */ },
		}));
	}

	private _settings(): { enabled: boolean; apiKey: string; model: string } {
		return {
			enabled: this._configurationService.getValue<boolean>('loophole.fim.enabled') !== false,
			apiKey: this._configurationService.getValue<string>('loophole.fim.apiKey') ?? '',
			model: this._configurationService.getValue<string>('loophole.fim.model') ?? 'mercury-edit-2',
		};
	}

	private async _provide(model: ITextModel, position: Position, token: { isCancellationRequested?: boolean }): Promise<{ insertText: string; range: Range }[]> {
		const { enabled, apiKey, model: fimModel } = this._settings();
		if (!enabled || !apiKey) {
			if (!this._loggedInert) {
				this._loggedInert = true;
				console.log(`[LoopholeFim] inert (${!enabled ? 'loophole.fim.enabled is false' : 'no Inception API key set'}).`);
			}
			return [];
		}

		const fullText = model.getValue(EndOfLinePreference.LF);
		const cursorOffset = model.getOffsetAt(position);
		const prefix = fullText.substring(0, cursorOffset);
		const suffix = fullText.substring(cursorOffset);
		if (prefix.length < MIN_PREFIX_LENGTH) return [];

		// debounce ~500ms, cancel prior request (abort on retype)
		if (this._activeRequestId) {
			this._cliService.fimAbort(this._activeRequestId);
			this._activeRequestId = null;
		}
		const startedAt = Date.now();
		this._lastRequestStart = startedAt;
		const typingHappened = await new Promise<boolean>((resolve) => setTimeout(() => resolve(this._lastRequestStart !== startedAt), DEBOUNCE_MS));
		if (typingHappened) return [];
		if (token?.isCancellationRequested) return [];

		const accumulated = { text: '' };
		const result = await new Promise<string | null>((resolve) => {
			let done = false;
			const requestId = this._cliService.fim(
				{ prefix, suffix, apiKey, model: fimModel, maxTokens: MAX_TOKENS, temperature: FIM_TEMPERATURE },
				{
					onChunk: (chunk) => { accumulated.text += chunk; },
					onFinal: (text) => { if (!done) { done = true; this._activeRequestId = null; resolve(text); } },
					onError: (error) => { if (!done) { done = true; this._activeRequestId = null; if (error !== 'aborted') console.warn(`[LoopholeFim] ${error}`); resolve(null); } },
				},
			);
			this._activeRequestId = requestId;
		});
		if (result === null) return [];

		if (!loopholeFimStats.firstCompletionStart) loopholeFimStats.firstCompletionStart = startedAt;
		loopholeFimStats.completionCount += 1;
		loopholeFimStats.lastCompletionEnd = Date.now();
		_onFimStatsChanged.fire();

		const insertText = processStartAndEndSpaces(result);
		if (!insertText) return [];
		return [{
			insertText,
			range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
		}];
	}
}

registerWorkbenchContribution2(LoopholeFimProvider.ID, LoopholeFimProvider, WorkbenchPhase.BlockRestore);
