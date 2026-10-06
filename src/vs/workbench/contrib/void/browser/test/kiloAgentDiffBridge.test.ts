/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../../editor/common/model.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IVoidModelService } from '../../common/voidModelService.js';
import { IVoidSettingsService } from '../../common/voidSettingsService.js';
import { IEditCodeService } from '../editCodeServiceInterface.js';
import type { KiloAgentFileDiff } from '../../common/kiloAgentTypes.js';
import { EngineEditOutcome, IKiloAgentDiffBridge, KiloAgentDiffBridge } from '../kiloAgentDiffBridge.js';

suite('KiloAgentDiffBridge', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let bridge: IKiloAgentDiffBridge;

	let modelValue: string | undefined;
	let appliedEdits: Array<{ text: string }>;
	let rewrites: Array<{ uri: URI; newContent: string }>;
	let dirtyUris: Set<string>;
	let warnings: string[];
	let showDiffs: boolean;

	function fakeModel() {
		return {
			getValue: (_p: EndOfLinePreference) => modelValue,
			getLineCount: () => (modelValue ?? '').split('\n').length,
			getLineMaxColumn: (n: number) => ((modelValue ?? '').split('\n')[n - 1]?.length ?? 0) + 1,
			applyEdits: (edits: Array<{ text: string }>) => { appliedEdits.push(...edits); modelValue = edits[0].text; },
		};
	}

	const diff = (over: Partial<KiloAgentFileDiff> = {}): KiloAgentFileDiff => ({
		file: '/w/a.ts',
		status: 'modified',
		additions: 1,
		deletions: 1,
		before: 'old',
		after: 'new',
		...over,
	});

	async function stage(d: KiloAgentFileDiff) {
		return bridge.stageEdit({ directory: '/w', diff: d });
	}

	setup(() => {
		modelValue = undefined;
		appliedEdits = [];
		rewrites = [];
		dirtyUris = new Set();
		warnings = [];
		showDiffs = true;

		instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(ILogService, { warn: (m: string) => { warnings.push(m); }, info: () => { }, error: () => { }, debug: () => { }, trace: () => { } } as unknown as ILogService);
		instantiationService.stub(IVoidSettingsService, { state: { globalSettings: { get engineShowDiffs() { return showDiffs; } } } } as unknown as IVoidSettingsService);
		instantiationService.stub(IVoidModelService, {
			getModelSafe: async () => modelValue === undefined ? { model: undefined } : { model: fakeModel() },
		} as unknown as IVoidModelService);
		instantiationService.stub(IEditCodeService, {
			instantlyRewriteFile: (o: { uri: URI; newContent: string }) => { rewrites.push(o); },
		} as unknown as IEditCodeService);
		instantiationService.stub(IEditorService, {
			findEditors: (uri: URI) => (dirtyUris.has(uri.fsPath) ? [{ editor: { isDirty: () => true } }] : []),
		} as unknown as IEditorService);

		const instance = instantiationService.createInstance(KiloAgentDiffBridge);
		disposables.add(instance);
		bridge = instance;
	});

	suite('staging', () => {

		test('writes the model back to before, then stages after', async () => {
			modelValue = 'old';
			const out = await stage(diff());
			assert.deepStrictEqual(out, { kind: 'staged', file: '/w/a.ts' });
			assert.deepStrictEqual(appliedEdits.map(e => e.text), ['old'], 'must rewind the buffer first so reject is exact');
			assert.strictEqual(rewrites[0].newContent, 'new');
		});

		test('skips the rewind when the model already holds before', async () => {
			modelValue = 'old';
			await stage(diff());
			assert.deepStrictEqual(appliedEdits, []);
			assert.strictEqual(rewrites[0].newContent, 'new');
		});

		test('treats a created file as before = empty string', async () => {
			modelValue = '';
			const out = await stage(diff({ status: 'added', before: undefined }));
			assert.strictEqual((out as EngineEditOutcome).kind, 'staged');
			assert.strictEqual(rewrites[0].newContent, 'new');
		});

		test('treats a deleted file as after = empty string', async () => {
			modelValue = 'old';
			const out = await stage(diff({ status: 'deleted', after: undefined }));
			assert.strictEqual((out as EngineEditOutcome).kind, 'staged');
			assert.strictEqual(rewrites[0].newContent, '');
		});
	});

	suite('user data protection', () => {

		test('refuses to touch a dirty buffer with unsaved work', async () => {
			modelValue = 'user edit';
			dirtyUris.add('/w/a.ts');
			const out = await stage(diff());
			assert.strictEqual((out as EngineEditOutcome).kind, 'unsaved-conflict');
			assert.deepStrictEqual(appliedEdits, [], 'must not overwrite unsaved work');
			assert.deepStrictEqual(rewrites, []);
		});

		test('allows a dirty buffer whose content matches before', async () => {
			modelValue = 'old';
			dirtyUris.add('/w/a.ts');
			const out = await stage(diff());
			assert.strictEqual((out as EngineEditOutcome).kind, 'staged');
		});

		test('a file with no open editor is treated as clean', async () => {
			modelValue = 'old';
			dirtyUris.clear();
			const out = await stage(diff());
			assert.strictEqual((out as EngineEditOutcome).kind, 'staged');
		});
	});

	suite('early exits', () => {

		test('reports unsupported when the file cannot be opened', async () => {
			modelValue = undefined;
			const out = await stage(diff());
			assert.strictEqual((out as EngineEditOutcome).kind, 'unsupported');
			assert.deepStrictEqual(rewrites, []);
			assert.ok(warnings.some(w => w.includes('could not stage')));
		});

		test('reports unsupported for an unknown status without touching the model', async () => {
			modelValue = 'old';
			const out = await stage(diff({ status: 'renamed' as any }));
			assert.strictEqual((out as EngineEditOutcome).kind, 'unsupported');
			assert.deepStrictEqual(appliedEdits, []);
		});

		test('reports a no-op when the engine already wrote the change', async () => {
			modelValue = 'new';
			const out = await stage(diff());
			assert.strictEqual((out as EngineEditOutcome).kind, 'no-op');
			assert.deepStrictEqual(rewrites, []);
		});

		test('does not stage anything when diff review is off', async () => {
			showDiffs = false;
			modelValue = 'old';
			await stage(diff());
			assert.deepStrictEqual(appliedEdits, []);
			assert.deepStrictEqual(rewrites, []);
		});
	});

	suite('stageAll', () => {

		test('stages each diff and returns one outcome per diff, in order', async () => {
			modelValue = 'old';
			const out = await bridge.stageAll({
				directory: '/w',
				diffs: [diff(), diff({ file: '/w/b.ts' }), diff({ status: 'added', before: undefined })],
			});
			assert.strictEqual(out.length, 3);
			assert.deepStrictEqual(out.map(o => o.file), ['/w/a.ts', '/w/b.ts', '/w/a.ts']);
		});

		test('keeps going after one file fails', async () => {
			modelValue = 'old';
			const out = await bridge.stageAll({
				directory: '/w',
				diffs: [diff({ status: 'renamed' as any }), diff()],
			});
			assert.deepStrictEqual(out.map(o => o.kind), ['unsupported', 'staged']);
		});

		test('returns an empty list for no diffs', async () => {
			assert.deepStrictEqual(await bridge.stageAll({ directory: '/w', diffs: [] }), []);
		});
	});
});