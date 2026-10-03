/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Turns edits the agent engine made on disk into Loophole diff zones the user can accept or
// reject, using the engine's own before/after content instead of snapshots we take ourselves.
//
// Why this is not just "call instantlyRewriteFile": the engine writes straight to disk, and
// VS Code silently reloads a *clean* buffer when its file changes underneath it. By the time we
// hear about the edit the buffer may already hold the new content, so there would be nothing
// left to show. The engine's diff endpoint gives us the full text on both sides, which is what
// lets us put the buffer back to `before` and stage a real, reviewable change.
//
// The invariant that makes reject exact: a diff zone's originalCode is whatever the model held
// when the zone was created. So we always set the model to the engine's `before` first, and
// only then create the zone with `after`. Rejecting then restores `before` verbatim.
//
// The "what should we do" half lives in common/kiloAgentDiffDecision.ts so it can be tested
// without a text model; this file is the I/O that acts on the plan.

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { planEngineEdit } from '../common/kiloAgentDiffDecision.js';
import { KiloAgentFileDiff } from '../common/kiloAgentTypes.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { IEditCodeService } from './editCodeServiceInterface.js';

export type EngineEditOutcome =
	| { kind: 'staged'; file: string }
	| { kind: 'no-op'; file: string }
	| { kind: 'unsaved-conflict'; file: string }
	| { kind: 'unsupported'; file: string; reason: string };

export interface IKiloAgentDiffBridge {
	readonly _serviceBrand: undefined;
	/** Stages one engine edit as a Loophole diff zone. */
	stageEdit(opts: { directory: string; diff: KiloAgentFileDiff }): Promise<EngineEditOutcome>;
	/** Stages every edit in a batch, in the order the engine reported them. */
	stageAll(opts: { directory: string; diffs: KiloAgentFileDiff[] }): Promise<EngineEditOutcome[]>;
}

export const IKiloAgentDiffBridge = createDecorator<IKiloAgentDiffBridge>('KiloAgentDiffBridge');

class KiloAgentDiffBridge extends Disposable implements IKiloAgentDiffBridge {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IVoidSettingsService private readonly settingsService: IVoidSettingsService,
		@IVoidModelService private readonly voidModelService: IVoidModelService,
		@IEditCodeService private readonly editCodeService: IEditCodeService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
	}

	/**
	 * Whether the user has unsaved changes in this file.
	 *
	 * Dirty state lives on the editor *input*, not on ITextModel - a text model has no notion
	 * of saved-vs-unsaved. So we ask the editor service about every editor currently showing this
	 * resource. A file with no open editor is by definition clean: if it had unsaved work, some
	 * editor would be holding it.
	 */
	private isDirty(uri: URI): boolean {
		return this.editorService.findEditors(uri).some(({ editor }) => editor.isDirty());
	}

	async stageAll({ directory, diffs }: { directory: string; diffs: KiloAgentFileDiff[] }) {
		const out: EngineEditOutcome[] = [];
		for (const diff of diffs) out.push(await this.stageEdit({ directory, diff }));
		return out;
	}

	// `directory` is accepted so callers can stay uniform across the bridge's API, but each edit
	// carries an absolute path so it is not needed to resolve the file.
	async stageEdit({ diff }: { directory: string; diff: KiloAgentFileDiff }): Promise<EngineEditOutcome> {
		// First pass: everything that can be decided without touching a text model.
		let plan = planEngineEdit({
			diff,
			currentText: '',
			isDirty: false,
			showDiffs: this.settingsService.state.globalSettings.engineShowDiffs,
		});
		if (plan.kind === 'unsupported' || plan.kind === 'no-op') {
			if (plan.kind === 'unsupported') this.logService.warn(`[kilo-agent] ${plan.file}: ${plan.reason}`);
			return plan;
		}

		const uri = URI.file(diff.file);
		const { model } = await this.voidModelService.getModelSafe(uri);
		if (!model) {
			const reason = 'the file could not be opened as a text model';
			this.logService.warn(`[kilo-agent] could not stage ${diff.file}: ${reason}`);
			return { kind: 'unsupported', file: diff.file, reason };
		}

		// Second pass, now that the buffer's real state is known.
		plan = planEngineEdit({
			diff,
			currentText: model.getValue(EndOfLinePreference.LF),
			isDirty: this.isDirty(uri),
			showDiffs: true,
		});
		if (plan.kind === 'unsaved-conflict') {
			this.logService.warn(`[kilo-agent] skipped ${plan.file}: it has unsaved editor changes`);
			return plan;
		}
		if (plan.kind !== 'stage') return plan;

		if (model.getValue(EndOfLinePreference.LF) !== plan.before) {
			const range = {
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: model.getLineCount(),
				endColumn: model.getLineMaxColumn(model.getLineCount()),
			};
			model.applyEdits([{ range, text: plan.before }]);
		}

		this.editCodeService.instantlyRewriteFile({ uri, newContent: plan.after });
		return { kind: 'staged', file: plan.file };
	}
}

registerSingleton(IKiloAgentDiffBridge, KiloAgentDiffBridge, InstantiationType.Delayed);
