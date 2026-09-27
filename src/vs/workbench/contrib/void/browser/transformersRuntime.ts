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
// Both packages ship inside resources/app/node_modules, so an import map pointing
// at their browser/ESM builds resolves them. Note we must use the *web* dist:
// transformers.js is the Node build and contains __dirname / node: imports.

type TransformersModule = typeof import('@huggingface/transformers');

/** Paths relative to the app root (the sibling of `out/`). */
const TRANSFORMERS_ENTRY = 'node_modules/@huggingface/transformers/dist/transformers.web.js';
const ORT_WEBGPU_ENTRY = 'node_modules/onnxruntime-web/dist/ort.webgpu.min.js';
const ORT_COMMON_ENTRY = 'node_modules/onnxruntime-common/dist/esm/index.js';
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

let importMapInstalled = false;

/**
 * Injects a second <script type="importmap"> for the bare specifiers that the
 * Transformers browser build imports. Multiple import maps are supported, and
 * these specifiers have not been resolved yet at the point the mic is first used.
 *
 * The workbench CSP sets `require-trusted-types-for 'script'`, so the JSON has
 * to go through a Trusted Types policy, exactly as workbench.js does for its own
 * CSS import map.
 */
const installImportMap = (imports: { [specifier: string]: string }) => {
	if (importMapInstalled) { return; }
	if (typeof document === 'undefined') { return; }
	importMapInstalled = true;

	const json = JSON.stringify({ imports }, undefined, 2);
	const element = document.createElement('script');
	element.type = 'importmap';

	const trustedTypes = (globalThis as {
		trustedTypes?: { createPolicy?: (name: string, rules: { createScript: (t: string) => string }) => { createScript: (t: string) => string } }
	}).trustedTypes;

	let text: string = json;
	if (trustedTypes?.createPolicy) {
		try {
			// A policy name can only be registered once, hence the guard above.
			const policy = trustedTypes.createPolicy('loopholeTransformersImportMap', { createScript: (t: string) => t });
			text = policy.createScript(json);
		} catch {
			// If a policy could not be created, fall through and try the raw text.
		}
	}

	try {
		element.textContent = text;
		document.head.appendChild(element);
	} catch (e) {
		// Reset so a later attempt (e.g. after a theme/window change) can retry.
		importMapInstalled = false;
		console.error('Loophole: failed to install the Transformers import map', e);
	}
};

export const loadTransformers = async (): Promise<TransformersModule> => {
	const root = appRootUrl();

	installImportMap({
		'onnxruntime-web/webgpu': root + ORT_WEBGPU_ENTRY,
		'onnxruntime-common': root + ORT_COMMON_ENTRY,
	});

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
