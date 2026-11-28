/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Mirrors voidSettingsPane.ts exactly — same pattern, same approach.

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import * as nls from '../../../../nls.js';
import { EditorExtensions, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';

import { mountExpertCanvasPage } from './react/out/expert-canvas-tsx/index.js';

// ── Editor Input ──────────────────────────────────────────────────────────────

class ExpertCanvasInput extends EditorInput {

	static readonly ID = 'workbench.input.loophole.expertCanvas';

	static readonly RESOURCE = URI.from({
		scheme: 'loophole',
		path: 'expert-canvas',
	});

	readonly resource = ExpertCanvasInput.RESOURCE;

	constructor() {
		super();
	}

	override get typeId(): string {
		return ExpertCanvasInput.ID;
	}

	override getName(): string {
		return nls.localize('expertCanvasInputName', 'Expert Canvas');
	}

	override getIcon() {
		return Codicon.organization;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof ExpertCanvasInput;
	}
}

// ── Editor Pane ───────────────────────────────────────────────────────────────

class ExpertCanvasPane extends EditorPane {
	static readonly ID = 'workbench.pane.loophole.expertCanvas';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(ExpertCanvasPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';

		const container = document.createElement('div');
		container.style.height = '100%';
		container.style.width = '100%';
		parent.appendChild(container);

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountExpertCanvasPage(container, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	override layout(_dimension: Dimension): void {
		// React handles layout internally
	}

	override get minimumWidth() { return 600; }
}

// ── Register EditorPane ───────────────────────────────────────────────────────

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ExpertCanvasPane,
		ExpertCanvasPane.ID,
		nls.localize('expertCanvasPane', 'Expert Canvas'),
	),
	[new SyncDescriptor(ExpertCanvasInput)]
);

// ── Toggle action (open if closed, focus if open, close if focused) ───────────

export const OPEN_EXPERT_CANVAS_PAGE_ACTION_ID = 'workbench.action.loophole.expertCanvas.toggle';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OPEN_EXPERT_CANVAS_PAGE_ACTION_ID,
			title: nls.localize2('expertCanvasToggle', 'Loophole: Toggle Expert Canvas'),
			icon: Codicon.organization,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		// If already open — focus it if not active, close it if active (toggle)
		const openEditors = editorService.findEditors(ExpertCanvasInput.RESOURCE);
		if (openEditors.length !== 0) {
			const openEditor = openEditors[0].editor;
			const isActive = editorService.activeEditor?.resource?.fsPath === openEditor.resource?.fsPath;
			if (isActive) {
				await editorService.closeEditors(openEditors);
			} else {
				await editorService.openEditor(openEditor, { pinned: true });
			}
			return;
		}

		// Not open — open it
		const input = instantiationService.createInstance(ExpertCanvasInput);
		await editorService.openEditor(input, { pinned: true });
	}
});

// ── Open action (always opens fresh) ─────────────────────────────────────────

export const OPEN_EXPERT_CANVAS_FRESH_ACTION_ID = 'workbench.action.loophole.expertCanvas.open';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OPEN_EXPERT_CANVAS_FRESH_ACTION_ID,
			title: nls.localize2('expertCanvasOpen', 'Loophole: Open Expert Canvas'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		// Close existing instances first
		const openEditors = editorService.findEditors(ExpertCanvasInput.RESOURCE);
		if (openEditors.length > 0) {
			await editorService.closeEditors(openEditors);
		}

		const input = instantiationService.createInstance(ExpertCanvasInput);
		await editorService.openEditor(input, { pinned: true });
	}
});
