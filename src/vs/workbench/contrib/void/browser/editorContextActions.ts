/*---------------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { URI } from '../../../../base/common/uri.js';
import { IChatThreadService } from './chatThreadService.js';
import { roundRangeToLines } from './sidebarActions.js';
import { VOID_VIEW_CONTAINER_ID } from './sidebarPane.js';
import { IMetricsService } from '../common/metricsService.js';

/**
 * How many diagnostics are worth putting in a prompt before they stop helping.
 * A file with four hundred errors is broken in a way that no single message can
 * describe, and the list just crowds out the request.
 */
const MAX_ERRORS_IN_PROMPT = 20;

/**
 * What an editor context action needs from the editor in front of the user.
 *
 * The selection is captured before the chat panel is opened, because opening it
 * takes focus and an editor that no longer has focus reports no selection.
 */
type EditorTarget = {
	uri: URI;
	language: string;
	/** 1-indexed, inclusive line range, or null when nothing is selected. */
	startLine: number;
	endLine: number;
	hasSelection: boolean;
};

/**
 * Reads the active editor and its selection, rounded out to whole lines.
 * Returns null when there is no editor or no model, which is the case when the
 * action is run from the command palette with the focus somewhere else.
 */
function readEditorTarget(accessor: ServicesAccessor): EditorTarget | null {
	const editorService = accessor.get(ICodeEditorService);
	const editor = editorService.getActiveCodeEditor();
	const model = editor?.getModel();
	if (!editor || !model) return null;

	// An empty selection is treated as the caret's line, so an action still does
	// something sensible when invoked without a selection.
	const selection = editor.getSelection();
	const range = roundRangeToLines(selection, { emptySelectionBehavior: 'line' });
	const hasSelection = !!selection && !selection.isEmpty();

	return {
		uri: model.uri,
		language: model.getLanguageId(),
		startLine: range?.startLineNumber ?? 1,
		endLine: range?.endLineNumber ?? 1,
		hasSelection,
	};
}

/**
 * Puts the file, or the selected lines of it, into the chat context, opens the
 * chat if it is closed, and hands focus back to the input.
 *
 * The selection is staged rather than pasted into the prompt, so the model
 * receives the real file contents with line numbers instead of a copy that can
 * drift from the file.
 */
async function stageEditorContext(accessor: ServicesAccessor, target: EditorTarget): Promise<void> {
	const viewsService = accessor.get(IViewsService);
	const chatThreadService = accessor.get(IChatThreadService);
	const editorService = accessor.get(ICodeEditorService);

	const wasAlreadyOpen = viewsService.isViewContainerVisible(VOID_VIEW_CONTAINER_ID);
	if (!wasAlreadyOpen) {
		// Awaited so the container is really up before anything tries to focus
		// the input inside it.
		await viewsService.openViewContainer(VOID_VIEW_CONTAINER_ID);
	}

	if (target.hasSelection) {
		chatThreadService.addNewStagingSelection({
			type: 'CodeSelection',
			uri: target.uri,
			language: target.language,
			range: [target.startLine, target.endLine],
			state: { wasAddedAsCurrentFile: false },
		});
	} else {
		chatThreadService.addNewStagingSelection({
			type: 'File',
			uri: target.uri,
			language: target.language,
			state: { wasAddedAsCurrentFile: false },
		});
	}

	await chatThreadService.focusCurrentChat();

	// The panel has taken focus, so the editor's own selection is gone. Restore
	// it so the staged chip and any inline diff highlight line up with what the
	// user had selected when they clicked.
	if (target.hasSelection) {
		const editor = editorService.getActiveCodeEditor();
		if (editor && editor.getModel()?.uri.toString() === target.uri.toString()) {
			editor.setSelection({
				startLineNumber: target.startLine,
				startColumn: 1,
				endLineNumber: target.endLine,
				endColumn: Number.MAX_SAFE_INTEGER,
			});
		}
	}
}

/**
 * Stages the context, then sends a prompt straight away.
 *
 * Sending rather than only filling the box matches what the user just asked for
 * by clicking the menu item, and it is the only way an action like "Fix Error"
 * can act on diagnostics that the chat itself would otherwise have to go and
 * fetch.
 */
async function runEditorAction(
	accessor: ServicesAccessor,
	event: string,
	buildPrompt: (target: EditorTarget) => string,
): Promise<void> {
	accessor.get(IMetricsService).capture(event, {});

	const target = readEditorTarget(accessor);
	if (!target) return;

	await stageEditorContext(accessor, target);

	const chatThreadService = accessor.get(IChatThreadService);
	const threadId = chatThreadService.state.currentThreadId;
	await chatThreadService.addUserMessageAndStreamResponse({
		userMessage: buildPrompt(target),
		threadId,
	});
}

/** Describes a target in a sentence, so the prompt is not ambiguous about scope. */
function describeTarget(target: EditorTarget): string {
	const name = target.uri.fsPath;
	return target.hasSelection
		? `${name} (lines ${target.startLine}-${target.endLine})`
		: name;
}

/**
 * Reads the errors the language server currently reports for a file, in a shape
 * that survives being written into a prompt.
 */
function readErrors(accessor: ServicesAccessor, uri: URI): string[] {
	const markerService = accessor.get(IMarkerService);
	return markerService
		.read({ resource: uri, severities: MarkerSeverity.Error })
		.slice(0, MAX_ERRORS_IN_PROMPT)
		.map(marker => `line ${marker.startLineNumber}: ${marker.message}`);
}

class ExplainSelectionAction extends Action2 {
	constructor() {
		super({
			id: 'void.explainSelection',
			title: localize2('voidExplainSelection', 'Loophole: Explain Selection'),
			menu: [{
				id: MenuId.EditorContext,
				group: '9_void@1',
			}],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return runEditorAction(accessor, 'Explain Selection', (target) =>
			`Explain the selected code in ${describeTarget(target)}. Cover what it does, why it is written this way, and anything surprising about it.`);
	}
}

class FixErrorAction extends Action2 {
	constructor() {
		super({
			id: 'void.fixError',
			title: localize2('voidFixError', 'Loophole: Fix Error'),
			menu: [{
				id: MenuId.EditorContext,
				group: '9_void@2',
			}],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const target = readEditorTarget(accessor);
		if (!target) return;

		const errors = readErrors(accessor, target.uri);
		// With nothing to fix, sending "fix these errors: " with an empty list
		// would only waste a turn, so the user is told instead.
		if (errors.length === 0) {
			void runEditorAction(accessor, 'Fix Error', () =>
				`Check ${target.uri.fsPath} for problems and fix anything you find. If nothing is wrong, say so rather than changing the file.`);
			return;
		}

		return runEditorAction(accessor, 'Fix Error', () =>
			`Fix these errors in ${target.uri.fsPath}:\n${errors.map(e => `- ${e}`).join('\n')}\n\nRead the file before editing, and confirm the fix resolves each one rather than silencing it.`);
	}
}

class AddTestsAction extends Action2 {
	constructor() {
		super({
			id: 'void.addTests',
			title: localize2('voidAddTests', 'Loophole: Add Tests'),
			menu: [{
				id: MenuId.EditorContext,
				group: '9_void@3',
			}],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return runEditorAction(accessor, 'Add Tests', (target) =>
			`Write tests for ${describeTarget(target)}. Match the testing style already used in this project, cover the edge cases rather than the happy path alone, and run them to confirm they pass.`);
	}
}

class GenerateDocsAction extends Action2 {
	constructor() {
		super({
			id: 'void.generateDocs',
			title: localize2('voidGenerateDocs', 'Loophole: Generate Documentation'),
			menu: [{
				id: MenuId.EditorContext,
				group: '9_void@4',
			}],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return runEditorAction(accessor, 'Generate Docs', (target) =>
			`Document ${describeTarget(target)}. Add doc comments in the style this project already uses, and describe behaviour and arguments rather than restating the code.`);
	}
}

registerAction2(ExplainSelectionAction);
registerAction2(FixErrorAction);
registerAction2(AddTestsAction);
registerAction2(GenerateDocsAction);