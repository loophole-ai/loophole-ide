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

const MAX_ERRORS_IN_PROMPT = 20

type EditorTarget = {
	uri: URI;
	language: string;
	startLine: number;
	endLine: number;
	hasSelection: boolean;
};

function readEditorTarget(accessor: ServicesAccessor): EditorTarget | null {
	const editorService = accessor.get(ICodeEditorService);
	const editor = editorService.getActiveCodeEditor();
	const model = editor?.getModel();
	if (!editor || !model) return null;

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

async function stageEditorContext(accessor: ServicesAccessor, target: EditorTarget): Promise<void> {
	const viewsService = accessor.get(IViewsService);
	const chatThreadService = accessor.get(IChatThreadService);
	const editorService = accessor.get(ICodeEditorService);

	const wasAlreadyOpen = viewsService.isViewContainerVisible(VOID_VIEW_CONTAINER_ID);
	if (!wasAlreadyOpen) {
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

function describeTarget(target: EditorTarget): string {
	return target.hasSelection
		? `${target.uri.fsPath} (lines ${target.startLine}-${target.endLine})`
		: target.uri.fsPath;
}

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
			menu: [{ id: MenuId.EditorContext, group: '9_void@1' }],
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
			menu: [{ id: MenuId.EditorContext, group: '9_void@2' }],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const target = readEditorTarget(accessor);
		if (!target) return;

		const errors = readErrors(accessor, target.uri);
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
			menu: [{ id: MenuId.EditorContext, group: '9_void@3' }],
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
			menu: [{ id: MenuId.EditorContext, group: '9_void@4' }],
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