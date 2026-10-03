/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { planEngineEdit } from '../kiloAgentDiffDecision.js';
import { KiloAgentFileDiff } from '../kiloAgentTypes.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('Kilo agent diff decision', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const modified = (over: Partial<KiloAgentFileDiff> = {}): KiloAgentFileDiff => ({
		file: '/w/a.ts',
		status: 'modified',
		additions: 1,
		deletions: 0,
		before: 'const a = 1',
		after: 'const a = 2',
		...over,
	});

	suite('happy path', () => {

		test('stages when the buffer still holds the original content', () => {
			const plan = planEngineEdit({
				diff: modified(),
				currentText: 'const a = 1',
				isDirty: false,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'stage', file: '/w/a.ts', before: 'const a = 1', after: 'const a = 2' });
		});

		test('stages when the file is new and the buffer is empty', () => {
			const plan = planEngineEdit({
				diff: modified({ status: 'added', before: undefined, after: 'brand new' }),
				currentText: '',
				isDirty: false,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'stage', file: '/w/a.ts', before: '', after: 'brand new' });
		});

		test('stages a deletion, treating the missing `after` as empty', () => {
			const plan = planEngineEdit({
				diff: modified({ status: 'deleted', before: 'gone soon', after: undefined }),
				currentText: 'gone soon',
				isDirty: false,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'stage', file: '/w/a.ts', before: 'gone soon', after: '' });
		});

		test('stages when a dirty buffer happens to hold exactly the original content', () => {
			// e.g. the user typed something and undid it back to the on-disk text. Not a conflict.
			const plan = planEngineEdit({
				diff: modified(),
				currentText: 'const a = 1',
				isDirty: true,
				showDiffs: true,
			});
			assert.strictEqual(plan.kind, 'stage');
		});
	});

	suite('already-applied edits', () => {

		test('reports no-op when a clean buffer already holds the new content', () => {
			// The common case: VS Code reloaded the clean buffer after the engine wrote to disk.
			// If we rewrote to `before` first we would blank the editor and then report no-op.
			const plan = planEngineEdit({
				diff: modified(),
				currentText: 'const a = 2',
				isDirty: false,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'no-op', file: '/w/a.ts' });
		});

		test('stages a new file whose content VS Code already reloaded', () => {
			// Before fix: this blanked the buffer to '' and then returned no-op, losing the file.
			const plan = planEngineEdit({
				diff: modified({ status: 'added', before: undefined, after: 'brand new' }),
				currentText: 'brand new',
				isDirty: false,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'no-op', file: '/w/a.ts' });
		});

		test('stages when the buffer already equals the new content but is dirty', () => {
			// Dirty means the user is in there; do not treat it as "already handled".
			const plan = planEngineEdit({
				diff: modified(),
				currentText: 'const a = 2',
				isDirty: true,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'stage', file: '/w/a.ts', before: 'const a = 1', after: 'const a = 2' });
		});
	});

	suite('unsaved work', () => {

		test('refuses when the user has unrelated unsaved edits', () => {
			const plan = planEngineEdit({
				diff: modified(),
				currentText: 'const a = 1\n// my work in progress',
				isDirty: true,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'unsaved-conflict', file: '/w/a.ts' });
		});

		test('refuses for a new file the user has started typing over', () => {
			const plan = planEngineEdit({
				diff: modified({ status: 'added', before: undefined, after: 'generated' }),
				currentText: 'my own file',
				isDirty: true,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'unsaved-conflict', file: '/w/a.ts' });
		});

		test('checks the conflict before the no-op case', () => {
			// Both conditions hold; protecting the user's buffer must win.
			const plan = planEngineEdit({
				diff: modified(),
				currentText: 'const a = 2',
				isDirty: true,
				showDiffs: true,
			});
			assert.strictEqual(plan.kind, 'unsaved-conflict');
		});
	});

	suite('refusals', () => {

		test('refuses a change with no file path', () => {
			const plan = planEngineEdit({
				diff: modified({ file: '' }),
				currentText: '',
				isDirty: false,
				showDiffs: true,
			});
			assert.strictEqual(plan.kind, 'unsupported');
		});

		test('refuses an unrecognized status', () => {
			const plan = planEngineEdit({
				diff: modified({ status: 'renamed' as any }),
				currentText: '',
				isDirty: false,
				showDiffs: true,
			});
			assert.strictEqual(plan.kind, 'unsupported');
		});

		test('refuses when status is missing entirely', () => {
			const plan = planEngineEdit({
				diff: modified({ status: undefined }),
				currentText: '',
				isDirty: false,
				showDiffs: true,
			});
			assert.strictEqual(plan.kind, 'unsupported');
		});

		test('refuses a modified file with no `after`', () => {
			// Without both sides a reject cannot be exact, so refuse rather than guess.
			const plan = planEngineEdit({
				diff: modified({ after: undefined }),
				currentText: 'const a = 1',
				isDirty: false,
				showDiffs: true,
			});
			assert.strictEqual(plan.kind, 'unsupported');
		});

		test('refuses a modified file with no `before`', () => {
			const plan = planEngineEdit({
				diff: modified({ before: undefined }),
				currentText: 'const a = 1',
				isDirty: false,
				showDiffs: true,
			});
			assert.strictEqual(plan.kind, 'unsupported');
		});

		test('treats a legitimately empty side as present, not missing', () => {
			// Deleting the last line of a file gives before="x", after="" - that is a real change.
			const plan = planEngineEdit({
				diff: modified({ before: 'x', after: '' }),
				currentText: 'x',
				isDirty: false,
				showDiffs: true,
			});
			assert.deepStrictEqual(plan, { kind: 'stage', file: '/w/a.ts', before: 'x', after: '' });
		});
	});

	suite('review disabled', () => {

		test('never stages when the user turned diff review off', () => {
			const plan = planEngineEdit({
				diff: modified(),
				currentText: 'const a = 1',
				isDirty: false,
				showDiffs: false,
			});
			assert.deepStrictEqual(plan, { kind: 'no-op', file: '/w/a.ts' });
		});

		test('still refuses unsafe input even with review off', () => {
			// A caller must never be handed a `stage` plan it could not honour.
			const plan = planEngineEdit({
				diff: modified({ after: undefined }),
				currentText: 'const a = 1',
				isDirty: false,
				showDiffs: false,
			});
			assert.strictEqual(plan.kind, 'unsupported');
		});
	});
});
