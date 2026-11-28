/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// compare against sidebarPane.ts, scm.contribution.ts, search.contribution.ts

import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions,
	IViewDescriptorService,
} from '../../../common/views.js';

import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Orientation } from '../../../../base/browser/ui/sash/sash.js';
import { localize, localize2 } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

import { mountExpertCanvas } from './react/out/expert-canvas-tsx/index.js';

// ── IDs ──
export const EXPERT_VIEW_CONTAINER_ID = 'workbench.view.experts';
export const EXPERT_VIEW_ID = EXPERT_VIEW_CONTAINER_ID;

// ── Activity bar icon ──
// Using Codicon.organization (people/team icon) to represent the expert team
const expertViewIcon = registerIcon(
	'expert-view-icon',
	Codicon.organization,
	localize('expertViewIcon', 'View icon of the Expert Canvas view.')
);

// ── ViewPane — mounts the React ExpertCanvas component ──
class ExpertViewPane extends ViewPane {
	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		parent.style.userSelect = 'text';

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn: (() => void) | undefined = mountExpertCanvas(parent, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.element.style.height = `${height}px`;
		this.element.style.width = `${width}px`;
	}
}

// ── Register ViewContainer (creates the activity bar button on the LEFT sidebar) ──
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

viewContainerRegistry.registerViewContainer({
	id: EXPERT_VIEW_CONTAINER_ID,
	title: localize2('expertContainer', 'Expert Canvas'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [EXPERT_VIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.VERTICAL,
	}]),
	hideIfEmpty: false,
	order: 4, // Explorer=1, Search=2, SCM/Git=3, Experts=4
	rejectAddedViews: true,
	icon: expertViewIcon,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: true });

// ── Register ViewPane inside the container ──
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

const container = viewContainerRegistry.get(EXPERT_VIEW_CONTAINER_ID)!;

viewsRegistry.registerViews([{
	id: EXPERT_VIEW_ID,
	hideByDefault: false,
	name: localize2('expertCanvas', 'Expert Canvas'),
	ctorDescriptor: new SyncDescriptor(ExpertViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	weight: 100,
	order: 1,
}], container);
