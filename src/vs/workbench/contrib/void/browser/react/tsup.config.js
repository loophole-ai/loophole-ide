/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'tsup'

const reactDir = path.dirname(fileURLToPath(import.meta.url))

// Every entry is ./src2/<name>/index.tsx and is emitted to ./out/<name>/index.js, so every bundle sits exactly one folder below out/.
const bundleDir = path.join(reactDir, 'out', '__bundle__')

// Imports that point outside of this react/ folder (e.g. ../../../voidSettingsPane.js, ../../../../common/*.js) are the workbench's own modules.
// They must stay external (the workbench build bundles them), but their specifier has to be valid from where the bundle is emitted.
// Source files nested deeper than src2/<name>/ (e.g. src2/void-settings-tsx/cli-settings/*.tsx) write a longer path than the bundle needs,
// and a bundler that just keeps the specifier as written leaves it one or more `../` too deep ("Could not resolve ../../../../voidSettingsPane.js").
// So resolve the specifier against the importing file and re-express it relative to the bundle's output folder.
//
// This must ONLY touch imports written in our own source files. Relative imports inside npm packages (e.g. lucide-react's ./icons/*.js) also resolve
// to a path outside react/ (node_modules), but those have to be bundled like any other dependency; externalising them leaves raw node_modules files
// that import bare "react", which the renderer cannot resolve.
const isInsideNodeModules = (p) => p.split(path.sep).includes('node_modules')
const isInsideReactDir = (p) => {
	const rel = path.relative(reactDir, p)
	return !rel.startsWith('..') && !path.isAbsolute(rel)
}

const rewriteExternalRelativeImports = {
	name: 'rewrite-external-relative-imports',
	setup(build) {
		build.onResolve({ filter: /^\.\.?\// }, (args) => {
			if (args.kind === 'entry-point' || !args.resolveDir || !args.importer) return undefined
			if (!isInsideReactDir(args.importer) || isInsideNodeModules(args.importer)) return undefined // importer is a dependency -> bundle as usual
			const abs = path.resolve(args.resolveDir, args.path)
			if (isInsideReactDir(abs) || isInsideNodeModules(abs)) return undefined // our own react/ code or a dependency -> bundle as usual
			let external = path.relative(bundleDir, abs).split(path.sep).join('/')
			if (!external.startsWith('.')) external = './' + external
			return { path: external, external: true }
		})
	},
}

export default defineConfig({
	entry: [
		'./src2/void-editor-widgets-tsx/index.tsx',
		'./src2/sidebar-tsx/index.tsx',
		'./src2/void-settings-tsx/index.tsx',
		'./src2/void-tooltip/index.tsx',
		'./src2/void-onboarding/index.tsx',
		'./src2/quick-edit-tsx/index.tsx',
		'./src2/diff/index.tsx',
		'./src2/void-token-usage-tsx/index.tsx',
		'./src2/empty-editor-home-tsx/index.tsx',
	],
	outDir: './out',
	format: ['esm'],
	splitting: false,

	// dts: true,
	// sourcemap: true,

	clean: false,
	platform: 'browser', // 'node'
	target: 'esnext',
	injectStyle: true, // bundle css into the output file
	outExtension: () => ({ js: '.js' }),
	// default behavior is to take local files and make them internal (bundle them) and take imports like 'react' and leave them external (don't bundle them), we want the opposite in many ways
	noExternal: [ // noExternal means we should take these things and make them not external (bundle them into the output file) - anything that doesn't start with a "." needs to be force-flagged as not external
		'@huggingface/transformers',
		/^@huggingface\//,
		/^(?!\.).*$/
	],
	// NOTE: do not add a RegExp for relative imports to `external` here. tsup's own external plugin would claim them first and keep the specifier as written.
	// Relative imports that leave react/ are handled by rewriteExternalRelativeImports instead.
	esbuildPlugins: [rewriteExternalRelativeImports], // must go through esbuildPlugins: plugins assigned inside esbuildOptions() are never registered by tsup
	treeshake: true,
	esbuildOptions(options) {
		options.outbase = 'src2'  // tries copying the folder hierarchy starting at src2
	}
})
