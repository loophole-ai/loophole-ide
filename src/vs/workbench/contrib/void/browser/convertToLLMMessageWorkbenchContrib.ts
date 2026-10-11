/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IVoidModelService } from '../common/voidModelService.js';

class ConvertContribWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.void.convertcontrib'
	_serviceBrand: undefined;

	constructor(
		@IVoidModelService private readonly voidModelService: IVoidModelService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
	) {
		super()

		// Every candidate instruction file has to have a model reference before it
		// can be read, and a reference only exists once it has been initialised
		// here. Files that do not exist come back with empty contents, which the
		// reader skips, so it is safe to initialise all three names.
		const instructionFilenames = ['AGENTS.md', 'CLAUDE.md', '.loopholerules']

		const initializeURI = (uri: URI) => {
			instructionFilenames.forEach(filename => {
				this.voidModelService.initializeModel(URI.joinPath(uri, filename))
			})
		}

		// call
		this._register(this.workspaceContext.onDidChangeWorkspaceFolders((e) => {
			[...e.changed, ...e.added].forEach(w => { initializeURI(w.uri) })
		}))
		this.workspaceContext.getWorkspace().folders.forEach(w => { initializeURI(w.uri) })
	}
}


registerWorkbenchContribution2(ConvertContribWorkbenchContribution.ID, ConvertContribWorkbenchContribution, WorkbenchPhase.BlockRestore);
