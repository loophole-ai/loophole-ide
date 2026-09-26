/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// This module deliberately contains NO static `import ... from '<npm-package>'`.
//
// The workbench is shipped as ONE native ES module: electron-browser/workbench.js
// does `await import('vs/workbench/workbench.desktop.main.js')`, and the only
// import map it installs is for CSS modules. There is no import map for bare npm
// specifiers, so if a bare specifier survives bundling into that file the
// browser's ESM loader cannot resolve it, the import() rejects, and the entire
// workbench fails to boot - a black window with no renderer log, because
// workbench.js has already painted the dark background before it imports us.
//
// Wrapping the package in a relative module was not enough: the bundler inlines
// the wrapper and hoists its static import to the top level of the bundle. So we
// build the URL at runtime, which the bundler cannot statically resolve, and load
// the browser build straight out of the node_modules shipped inside the app.

type TransformersModule = typeof import('@huggingface/transformers');

/** Browser build, relative to the app root (the sibling of `out/`). */
const TRANSFORMERS_ENTRY = 'node_modules/@huggingface/transformers/dist/transformers.web.js';

const resolveTransformersUrl = (): string => {
	// workbench.js sets this before importing the workbench bundle, e.g.
	// "vscode-file://vscode-app/out/" - so node_modules is its sibling.
	const fileRoot = (globalThis as { _VSCODE_FILE_ROOT?: string })._VSCODE_FILE_ROOT;
	if (typeof fileRoot === 'string' && fileRoot.length > 0) {
		return fileRoot.replace(/\/out\/$/, '/') + TRANSFORMERS_ENTRY;
	}

	// Dev / web fallback: resolve against the current document.
	const href = (globalThis as { location?: { href?: string } }).location?.href;
	return new URL(`../${TRANSFORMERS_ENTRY}`, href ?? 'file:///').toString();
};

export const loadTransformers = async (): Promise<TransformersModule> => {
	const url = resolveTransformersUrl();
	// Non-literal specifier: kept as a runtime dynamic import on purpose.
	const mod = await import(/* @vite-ignore */ url);
	// The dist build exposes both a default and named exports depending on version.
	return (mod as { default?: TransformersModule }).default ?? (mod as TransformersModule);
};
