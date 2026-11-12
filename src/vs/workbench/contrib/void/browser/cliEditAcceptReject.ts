/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// The CLI runs its own agent loop and applies file edits server-side, so by the
// time a tool result reaches us the file on disk has already changed. This
// bridges that back into Void's diff review: the file is snapshotted before the
// tool runs, then the post-edit text is replayed through IEditCodeService so the
// change shows up as the usual green/red hunks with Accept/Reject. Accept keeps
// the server's content; Reject restores the snapshot (both go through the same
// undoable path as an LLM edit).
//
// Snapshot fallbacks, in order: the open text model (still pre-write), the file
// on disk, reversing a reported search/replace, and finally rebuilding the old
// side from the tool's unified-diff metadata. If none is available the change
// is left as-is (the tool card still shows the result); see the report.

import { URI } from '../../../../base/common/uri.js';
import { isAbsolute } from '../../../../base/common/path.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { LOOPHOLE_CLI_TRUNCATION_MARKER } from '../common/loopholeCliTypes.js';
import type { CliToolState } from '../common/sendLLMMessageTypes.js';

const EDIT_TOOL_NAMES = new Set(['write', 'edit', 'patch', 'apply_patch', 'multiedit', 'multi_edit']);

const isEditTool = (name: string): boolean => EDIT_TOOL_NAMES.has(name.toLowerCase());

// The diff engine compares LF text; normalize both sides so CRLF files do not
// look like every line changed.
const normalizeEol = (text: string): string => text.replace(/\r\n/g, '\n');

const textOf = (input: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
	if (!input) return undefined;
	for (const key of keys) {
		const value = input[key];
		if (typeof value === 'string') return value;
	}
	return undefined;
};

// `filePath`/`path` on write/edit; `apply_patch`-style tools carry the target
// path inside the patch header instead; the CLI also reports the touched file in
// `metadata.files[].file` after the edit (packages/core/src/tool/plugin/file-diff.ts).
const pathOf = (tool: CliToolState): string | undefined => {
	const direct = textOf(tool.input, ['filePath', 'file_path', 'path', 'filename', 'file']);
	if (direct) return direct;
	const files = tool.metadata?.files;
	if (Array.isArray(files)) {
		const first = (files[0] as { file?: unknown } | undefined)?.file;
		if (typeof first === 'string') return first;
	}
	const patch = textOf(tool.input, ['patch', 'patchText', 'patch_text', 'input']);
	if (!patch) return undefined;
	const match = patch.match(/^\*\*\* (?:Update|Add|Delete|Move) File: (.+)$/m);
	return match?.[1]?.trim();
};

/**
 * The unified diff the CLI attached to a finished edit.
 *
 * `fileDiff()` emits `metadata.files[]` as `{ file, patch, status, additions,
 * deletions }`, so the patch is the authoritative "before" source - unlike a
 * snapshot it cannot race the server write.
 */
const patchOf = (tool: CliToolState): string | undefined => {
	const files = tool.metadata?.files;
	if (Array.isArray(files)) {
		for (const item of files) {
			if (item && typeof item === 'object') {
				const patch = textOf(item as Record<string, unknown>, ['patch']);
				if (patch) return patch;
			}
		}
	}
	const filediff = tool.metadata?.filediff;
	if (filediff && typeof filediff === 'object') {
		const patch = textOf(filediff as Record<string, unknown>, ['patch']);
		if (patch) return patch;
	}
	return textOf(tool.metadata, ['diff']);
};

type Snapshot = { text: string; existed: boolean };

type CliEditAcceptRejectOpts = {
	editCodeService: IEditCodeService;
	voidModelService: IVoidModelService;
	fileService: IFileService;
	// Used to resolve relative tool paths (the CLI's cwd is the workspace root).
	workspaceRoot?: URI;
};

export class CliEditAcceptReject {
	private readonly _pending = new Map<string, Promise<Snapshot>>();
	private readonly _handled = new Set<string>();

	constructor(private readonly _opts: CliEditAcceptRejectOpts) { }

	/** Feed every tool snapshot received during a turn. Idempotent per call id. */
	handle = (tools: CliToolState[]): void => {
		for (const tool of tools) {
			if (!isEditTool(tool.name)) continue;
			if (this._handled.has(tool.id)) continue;
			const path = pathOf(tool);
			if (!path) continue;
			const uri = this._uriOfPath(path);
			if (!uri) continue;

			if (!this._pending.has(tool.id)) {
				this._trimPending();
				this._pending.set(tool.id, this._capture(uri));
			}

			if (tool.status !== 'done' && tool.status !== 'error') continue;
			this._handled.add(tool.id);
			void this._settle(tool, uri);
		}
	};

	private _trimPending() {
		// Keep bookkeeping bounded even if a turn is aborted mid-tool.
		if (this._pending.size < 32) return;
		const oldest = this._pending.keys().next().value;
		if (oldest) this._pending.delete(oldest);
	}

	private _uriOfPath(path: string): URI | null {
		if (isAbsolute(path)) return URI.file(path);
		const root = this._opts.workspaceRoot;
		return root ? URI.joinPath(root, path) : null;
	}

	private _capture = async (uri: URI): Promise<Snapshot> => {
		// An open model is the exact pre-write text: the watcher has not reloaded
		// the file yet (this runs when the tool is reported as running).
		const model = this._opts.voidModelService.getModel(uri).model;
		if (model) return { text: model.getValue(EndOfLinePreference.LF), existed: true };
		try {
			const content = await this._opts.fileService.readFile(uri);
			return { text: normalizeEol(content.value.toString()), existed: true };
		} catch {
			return { text: '', existed: false };
		}
	};

	private _readDisk = async (uri: URI): Promise<string | null> => {
		try {
			const content = await this._opts.fileService.readFile(uri);
			return normalizeEol(content.value.toString());
		} catch {
			return null;
		}
	};

	private _settle = async (tool: CliToolState, uri: URI): Promise<void> => {
		const pending = this._pending.get(tool.id);
		this._pending.delete(tool.id);
		const snapshot = pending ? await pending : { text: '', existed: false };
		const afterLf = await this._readDisk(uri);
		if (afterLf === null) return; // the tool never wrote (or the file is gone)

		const beforeLf = this._beforeOf(tool, snapshot, afterLf);
		if (beforeLf === null || beforeLf === afterLf) return;

		try {
			// Make sure the model exists and reflects the server's write before we
			// put the pre-edit text back (this save is a no-op for the content).
			await this._opts.editCodeService.callBeforeApplyOrEdit(uri);
			const { model } = await this._opts.voidModelService.getModelSafe(uri);
			if (!model) return;
			// Keep the file's line endings so a review does not rewrite every line.
			const eol = model.getEOL();
			const convert = (text: string) => eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
			const before = convert(beforeLf);
			if (model.getValue() !== before) {
				// Restore first so the diff zone uses the snapshot as its original:
				// Accept keeps the server's content, Reject writes `before` back.
				model.setValue(before);
			}
			this._opts.editCodeService.instantlyRewriteFile({ uri, newContent: convert(afterLf) });
		} catch (e) {
			console.log('Loophole CLI: could not open an accept/reject diff for this edit', e);
		}
	};

	private _beforeOf(tool: CliToolState, snapshot: Snapshot, after: string): string | null {
		// A capture that found no file means the tool created it: the old side is
		// empty (Reject leaves an empty file; the undo entry removes the content).
		if (!snapshot.existed) return '';

		// The CLI's own unified diff is authoritative: it was produced from the
		// pre-write text, so unlike the snapshot it cannot lose the race with the
		// server write. Try it first whenever it is complete and usable.
		const patch = patchOf(tool);
		if (patch && !patch.includes(LOOPHOLE_CLI_TRUNCATION_MARKER)) {
			const fromPatch = this._beforeFromPatch(after, patch);
			if (fromPatch !== null) return fromPatch;
		}

		if (snapshot.text !== after) return snapshot.text;

		// Reverse the search/replace the tool reported (exact for `edit`).
		const oldStr = textOf(tool.input, ['oldString', 'old_string', 'oldText']);
		const newStr = textOf(tool.input, ['newString', 'new_string', 'newText']);
		if (oldStr !== undefined && newStr !== undefined && newStr.length > 0 && after.includes(newStr)) {
			const replaceAll = tool.input?.replaceAll === true || tool.input?.replace_all === true;
			if (replaceAll) return after.split(newStr).join(oldStr);
			// Only reverse a single occurrence when it is unambiguous.
			if (after.split(newStr).length === 2) return after.replace(newStr, oldStr);
		}

		return null;
	}

	// Reconstruct the old file from the new file plus the hunk headers. Context
	// lines are taken from `after` (exact); removed lines come from the patch.
	private _beforeFromPatch(after: string, patch: string): string | null {
		const lines = patch.split('\n');
		const afterLines = after.split('\n');
		const old: string[] = [];
		let afterIdx = 0;
		let sawHunk = false;

		for (let i = 0; i < lines.length; i++) {
			const header = lines[i].match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (!header) continue;
			const newStart = Number(header[1]) - 1;
			if (!Number.isFinite(newStart) || newStart < afterIdx) return null;
			sawHunk = true;
			old.push(...afterLines.slice(afterIdx, newStart));
			afterIdx = newStart;

			for (i++; i < lines.length && !lines[i].startsWith('@@'); i++) {
				const line = lines[i];
				if (line === '' && i === lines.length - 1) break; // trailing newline
				const kind = line.charAt(0);
				if (kind === ' ' || line === '') {
					old.push(afterLines[afterIdx] ?? '');
					afterIdx++;
				}
				else if (kind === '-') {
					old.push(normalizeEol(line.slice(1)));
				}
				else if (kind === '+') {
					afterIdx++;
				}
				// '\' ("no newline at end of file") and anything else is ignored.
			}
			i--; // the outer loop re-examines the next hunk header
		}

		if (!sawHunk) return null;
		old.push(...afterLines.slice(afterIdx));
		return old.join('\n');
	}
}
