/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import * as ReactDOM from 'react-dom/client'
import { areServicesRegistered, _registerServices } from '../util/services.js';
import { ServicesAccessor } from '../../../../../../../editor/browser/editorExtensions.js';

import { EmptyEditorHome } from './EmptyEditorHome.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';

/**
 * Mounts the empty-editor home screen into a workbench DOM element.
 *
 * Unlike the chat sidebar, this root is created and destroyed every time an editor
 * group gains or loses its first editor. It therefore must NOT own the shared
 * service wiring: `_registerServices` installs module-level singletons that the
 * sidebar also uses, and disposing them on unmount would break the sidebar. We
 * register only if nobody has yet, and never dispose.
 */
export const mountEmptyEditorHome = (rootElement: HTMLElement, accessor: ServicesAccessor) => {
	if (typeof document === 'undefined') {
		console.error('mountEmptyEditorHome error: document was undefined')
		return { rerender: () => { }, dispose: () => { } }
	}

	if (!areServicesRegistered()) {
		_registerServices(accessor)
	}

	const root = ReactDOM.createRoot(rootElement)
	root.render(<ErrorBoundary><EmptyEditorHome /></ErrorBoundary>)

	return {
		rerender: () => { root.render(<ErrorBoundary><EmptyEditorHome /></ErrorBoundary>) },
		// only unmount React - the shared services stay registered
		dispose: () => { root.unmount() },
	}
}
