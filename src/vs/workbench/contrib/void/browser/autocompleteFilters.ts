/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *------------------------------------------------------------------------------------*/

/**
 * Post-processing for streamed inline completions.
 *
 * The model streams text that is mostly useful but is punctuated with chat artefacts
 * (markdown fences, "Sure! Here is the code:"), leaked FIM sentinels, and degenerate
 * repetition. None of that belongs in a ghost-text suggestion, and the longer the
 * completion the more likely it is to contain some.
 *
 * Everything here is a pure function over `(rawText, context) -> cleanedText`, so the same
 * call can be run on every chunk of a stream and again on the final text.
 *
 * Most filters (`stopAtStopSequences`, `stopAtLineBelow`, blank-line collapse, bracket
 * balance, the single-line clamp) only ever discard *trailing* content, so their output
 * grows monotonically with the stream.
 *
 * Three are necessarily retroactive, because deciding they apply requires seeing a
 * pattern that completes partway through: `stripCodeFences` and `dropEnglishPreamble`
 * rewrite the front, and `stopAtRepeatingLines` can retroactively drop an already-shown
 * repeated line. That is why the caller (a) shows a partial only once the first line is
 * complete or the partial-show deadline expires, and (b) never treats "the filtered text
 * stopped growing" as a signal that the model is finished. The final result is always
 * correct; only the intermediate frames can be revised.
 */

/**
 * Substrings that terminate generation. Checked at the character level, so this also
 * handles a sentinel arriving split across two chunks.
 */
const STOP_SEQUENCES: readonly string[] = [
	// chat / markdown framing.
	// NOTE: '```' is deliberately NOT here. A fenced block is legitimate model output and
	// is unwrapped by stripCodeFences; killing it here would truncate the whole completion
	// to the empty string. Stray fences are caught by LINES_TO_STOP_AT instead.
	'</code>',
	'</COMPLETION>',
	'<COMPLETION>',
	'// Explanation:',
	// FIM sentinels from the model families we route through /completions
	'<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>', '<|fim_hole|>',
	'<|repo_name|>', '<|file_sep|>', '<|file_separator|>', '<|endoftext|>',
	'<|endoftext|>', '<|end▁of▁sentence|>', '<|eot_id|>',
	'<｜fim▁begin｜>', '<｜fim▁hole｜>', '<｜fim▁end｜>',
	// codellama / seed / codestral
	'<PRE>', '<SUF>', '<MID>', '</MID>', '<EOT>',
	'[PREFIX]', '[SUFFIX]', '+++++ ',
];

/**
 * Full lines that mean the model has started writing something other than code.
 * Checked against the trimmed line so indentation and trailing spaces don't matter.
 */
const LINES_TO_STOP_AT: readonly string[] = [
	'# End of file.',
	'<STOP EDITING HERE',
	'<|/updated_code|>',
	'```',
];

/**
 * Conversational preambles. Only ever applied to the *first* line, and only when that
 * line could not plausibly be code (see `looksLikeCode`) - otherwise a legitimate
 * `// here is the tricky part` comment would get silently deleted.
 */
const PREAMBLE_PATTERNS: readonly RegExp[] = [
	/^here'?s? (is|are) /i,
	/^here (is|are) /i,
	/^sure[,!.]?\s/i,
	/^certainly[,!.]?\s/i,
	/^of course[,!.]?\s/i,
	/^to fill in /i,
	/^the (code|function|class|method) (is|should|would) /i,
];

/**
 * Cheap structural test: a real first line of code virtually always contains one of
 * these. Used to keep the preamble filter from eating code.
 *
 * Deliberately excludes `:` `,` `.` - prose sentences end in them, so including them
 * would spare exactly the preambles we are trying to remove ("Here is the code:").
 */
const CODE_STRUCTURE_CHARS = /[=(){};\[\]<>+\-*/|&$#@^]/;

const looksLikeCode = (line: string): boolean => CODE_STRUCTURE_CHARS.test(line);

/** Truncate at the first occurrence of any stop sequence. */
export const stopAtStopSequences = (text: string, extra: readonly string[] = []): string => {
	let earliest = -1;
	for (const seq of [...STOP_SEQUENCES, ...extra]) {
		if (!seq) { continue; }
		const idx = text.indexOf(seq);
		if (idx !== -1 && (earliest === -1 || idx < earliest)) {
			earliest = idx;
		}
	}
	return earliest === -1 ? text : text.slice(0, earliest);
};

/**
 * Drop trailing runs of the same line. Models fall into loops far more often on longer
 * completions, and three identical lines in a row is a reliable signal.
 */
export const stopAtRepeatingLines = (text: string, ln: string, maxRun = 3): string => {
	const lines = text.split(ln);
	// a run of `maxRun` identical lines needs exactly `maxRun` lines
	if (lines.length < maxRun) { return text; }

	for (let i = 0; i + maxRun - 1 < lines.length; i++) {
		const candidate = lines[i].trim();
		if (candidate === '') { continue; }
		let isRun = true;
		for (let j = 1; j < maxRun; j++) {
			if (lines[i + j].trim() !== candidate) { isRun = false; break; }
		}
		if (isRun) {
			// keep the first occurrence of the run, cut the repeats
			return lines.slice(0, i + 1).join(ln);
		}
	}
	return text;
};

/**
 * Are these two lines close enough that one is the model re-emitting the other?
 *
 * Deliberately much stricter than a plain "one is a prefix of the other": in a block
 * completion a generated `return user;` must NOT be treated as a re-emission of a
 * `return` further down the file, which a prefix test would happily do and which would
 * silently truncate the block. So: exact match, or a prefix that differs only by a
 * character or two of trailing punctuation.
 */
const isNearDuplicateLine = (a: string, b: string): boolean => {
	if (a === b) { return true }
	const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
	if (shorter.length < 5) { return false }
	return longer.startsWith(shorter) && (longer.length - shorter.length) <= 2
}

/**
 * The model re-generating the line that is already below the cursor. If the line under
 * the cursor is non-empty, a generated line that is a near-duplicate of it means we are
 * about to duplicate text the user already has.
 */
export const stopAtLineBelow = (text: string, ln: string, lineBelow: string): string => {
	const target = lineBelow.trim();
	if (target === '') { return text; }

	const lines = text.split(ln);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === '') { continue; }
		if (isNearDuplicateLine(line, target)) {
			return lines.slice(0, i).join(ln);
		}
	}
	return text;
};

/** Remove a conversational opener, but only when it is clearly not code. */
export const dropEnglishPreamble = (text: string, ln: string): string => {
	const lines = text.split(ln);
	const first = lines[0].trim();
	if (first === '') { return text; }
	// only worth doing if there is more to the completion
	if (lines.length < 2) { return text; }
	if (looksLikeCode(first)) { return text; }
	if (!PREAMBLE_PATTERNS.some(p => p.test(first))) { return text; }
	return lines.slice(1).join(ln);
};

/** Collapse runs of 3+ blank lines down to one. Models like to pad their output. */
export const collapseBlankLineRuns = (text: string, ln: string): string => {
	return text.replace(/(?:\r?\n[ \t]*){3,}/g, ln + ln);
};

/** Pull a bare ```lang opener off the front, and a closing fence off the end. */
export const stripCodeFences = (text: string, ln: string): string => {
	let out = text;
	const openingFence = out.match(new RegExp(`^\\s*\`\`\`[a-zA-Z0-9_+-]*\\s*${ln === '\r\n' ? '\\r\\n' : '\\n'}`));
	if (openingFence) {
		out = out.slice(openingFence[0].length);
	}
	out = out.replace(new RegExp(`${ln === '\r\n' ? '\\r\\n' : '\\n'}[ \\t]*\`\`\`\\s*$`), '');
	// an unterminated fence with nothing after it
	out = out.replace(/^\s*```[a-zA-Z0-9_+-]*\s*$/, '');
	return out;
};

/**
 * Trim at the first closing bracket that has no opener, using the brackets already present
 * in the prefix to seed the stack. This is what stops `foo(bar))` style output.
 *
 * (Lifted out of autocompleteService so it can be unit tested directly.)
 */
export const getStringUpToUnbalancedClosingParenthesis = (s: string, prefix: string): string => {
	const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };

	// seed the stack from the prefix, starting at the first opener so that brackets in
	// earlier unrelated code don't throw the count off
	let stack: string[] = [];
	const firstOpenIdx = prefix.search(/[[({]/);
	if (firstOpenIdx !== -1) {
		for (const bracket of prefix.slice(firstOpenIdx).split('')) {
			if (!'()[]{}'.includes(bracket)) { continue; }
			if (bracket === '(' || bracket === '{' || bracket === '[') {
				stack.push(bracket);
			} else if (stack.length > 0 && stack[stack.length - 1] === pairs[bracket]) {
				stack.pop();
			} else {
				stack.push(bracket);
			}
		}
	}

	for (let i = 0; i < s.length; i++) {
		const char = s[i];
		if (char === '(' || char === '{' || char === '[') {
			stack.push(char);
		} else if (char === ')' || char === '}' || char === ']') {
			if (stack.length === 0 || stack.pop() !== pairs[char]) {
				return s.substring(0, i);
			}
		}
	}
	return s;
};

export type ApplyFiltersOptions = {
	/** Line ending used by the document. */
	ln: string;
	/** Raw text below the cursor's line, used to detect re-generation. */
	lineBelow: string;
	/** Extra stop tokens for this request (newline, provider sentinels, ...). */
	stopSequences?: readonly string[];
	/**
	 * Single-line predictions must not introduce a line break. When true the result is
	 * truncated at the first newline.
	 */
	singleLineOnly?: boolean;
	/** Apply the bracket balance check against the prefix. */
	prefix?: string;
};

/**
 * The full pipeline. Order matters:
 *   char-level sentinels -> fences -> preamble -> repeated lines -> re-generation
 *   -> blank-line padding -> single-line clamp -> bracket balance
 */
export const applyCompletionFilters = (raw: string, opts: ApplyFiltersOptions): string => {
	const { ln, lineBelow, stopSequences, singleLineOnly, prefix } = opts;

	let text = raw;
	if (!text) { return ''; }

	text = stopAtStopSequences(text, stopSequences);
	text = stripCodeFences(text, ln);
	text = dropEnglishPreamble(text, ln);

	// only meaningful once we actually have multiple lines
	text = stopAtRepeatingLines(text, ln);
	text = stopAtLineBelow(text, ln, lineBelow);
	text = collapseBlankLineRuns(text, ln);

	// The whole-line stop list, checked after the char pass so stray sentinels are gone.
	// Any remaining fence line is a stray opener (` ```ts `, ` ```python `), because
	// stripCodeFences has already unwrapped a legitimate leading/trailing one.
	const lines = text.split(ln);
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith('```') || LINES_TO_STOP_AT.includes(trimmed)) {
			text = lines.slice(0, i).join(ln);
			break;
		}
	}

	if (singleLineOnly) {
		const nl = text.indexOf(ln);
		if (nl !== -1) { text = text.slice(0, nl); }
	}

	if (prefix !== undefined) {
		text = getStringUpToUnbalancedClosingParenthesis(text, prefix);
	}

	return text;
};
