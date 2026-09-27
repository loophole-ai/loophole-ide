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
// the wrapper and hoists its static import to the top of the bundle. So we build
// every URL at runtime, which the bundler cannot statically resolve.
//
// `transformers.web.js` is the browser build, but it has two *static* bare
// imports of its own:
//
//   import * as ONNX_WEB from "onnxruntime-web/webgpu";
//   import { Tensor }      from "onnxruntime-common";
//
// Both packages ship inside resources/app/node_modules. Those specifiers are
// mapped in the bootstrap import map (see setupCSSImportMaps in
// vs/code/electron-browser/workbench/workbench.ts), which is installed before
// the workbench module is imported and is the only place the CSP and Trusted
// Types requirements are known to hold. Note we must use the *web* dist:
// transformers.js is the Node build and contains __dirname / node: imports.

type TransformersModule = typeof import('@huggingface/transformers');

/** Paths relative to the app root (the sibling of `out/`). */
const TRANSFORMERS_ENTRY = 'node_modules/@huggingface/transformers/dist/transformers.web.js';
/** Directory holding the ORT .wasm/.mjs binaries, so they are never fetched from a CDN. */
const ORT_DIST_DIR = 'node_modules/onnxruntime-web/dist/';

const appRootUrl = (): string => {
	// workbench.js sets this before importing the workbench bundle, e.g.
	// "vscode-file://vscode-app/out/" - so node_modules is its sibling.
	const fileRoot = (globalThis as { _VSCODE_FILE_ROOT?: string })._VSCODE_FILE_ROOT;
	if (typeof fileRoot === 'string' && fileRoot.length > 0) {
		return fileRoot.replace(/\/out\/$/, '/');
	}
	// Dev / web fallback: resolve against the current document.
	const href = (globalThis as { location?: { href?: string } }).location?.href;
	return new URL('../', href ?? 'file:///').toString();
};

export const loadTransformers = async (): Promise<TransformersModule> => {
	const root = appRootUrl();

	// Non-literal specifier: kept as a runtime dynamic import on purpose.
	const mod = await import(/* @vite-ignore */ root + TRANSFORMERS_ENTRY);
	const transformers = (mod as { default?: TransformersModule }).default ?? (mod as TransformersModule);

	// Keep inference fully local: without this ONNX Runtime resolves its ~25 MB
	// wasm binaries against a public CDN, which is both a privacy leak and a
	// hard failure when offline. They ship inside the app, so point at those.
	const wasm = (transformers as { env?: { backends?: { onnx?: { wasm?: { wasmPaths?: unknown } } } } }).env
		?.backends?.onnx?.wasm;
	if (wasm) {
		wasm.wasmPaths = root + ORT_DIST_DIR;
	}

	return transformers;
};
