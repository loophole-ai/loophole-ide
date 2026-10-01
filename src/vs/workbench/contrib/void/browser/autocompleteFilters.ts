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
	// FIM sentinels from the model families we route through /completions.
	// The chat-marker family matters most in practice: qwen2.5-coder is the model we
	// recommend, and it will happily emit <|im_start|> / <|im_end|> / <|fim_pad|> at the
	// end of a completion if nothing stops it.
	'<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>', '<|fim_hole|>', '<|fim_pad|>',
	'<|repo_name|>', '<|file_sep|>', '<|file_separator|>',
	'<|endoftext|>', '<|end▁of▁sentence|>', '<|end▁of▁text|>', '<|eot_id|>', '<|eom_id|>',
	'<|begin_of_text|>', '<|end_of_text|>',
	'<|im_start|>', '<|im_end|>', '<|start_header_id|>', '<|end_header_id|>',
	'<|system|>', '<|user|>', '<|assistant|>',
	'<｜fim▁begin｜>', '<｜fim▁hole｜>', '<｜fim▁end｜>',
	// codellama / seed / codestral
	'<PRE>', '<SUF>', '<MID>', '</MID>', '<EOT>',
	'[PREFIX]', '[SUFFIX]', '+++++ ',
	// Python-family models emit this as a header and never close it
	'#- coding: utf-8',
	// Fragments of the few-shot hole-filler prompt. No real code contains these, and if one
	// reaches the user it means the model is narrating the instructions instead of
	// completing. They are cut here as well as rejected upstream, so they cannot survive on
	// the native FIM path either.
	'<QUERY>', '</QUERY>', '{{FILL_HERE}}', '{{HOLE_NAME}}',
];

/**
 * Tag-shaped sentinels are matched case-insensitively.
 *
 * Models are inconsistent about casing - `</COMPLETION>`, `</Completion>` and `</completion>`
 * all turn up - and a case-sensitive list simply misses the variants it did not enumerate.
 * Only sequences that open with `<` or `[` qualify, so this can never affect real code
 * (`+++++ ` and the Python header stay exact).
 */
const isTagShaped = (seq: string): boolean => seq.startsWith('<') || seq.startsWith('[');

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
	// lowercased once and reused, rather than once per sequence
	const haystack = text.toLowerCase()

	let earliest = -1;
	for (const seq of [...STOP_SEQUENCES, ...extra]) {
		if (!seq) { continue; }
		const idx = isTagShaped(seq) ? haystack.indexOf(seq.toLowerCase()) : text.indexOf(seq);
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

/**
 * Trim a partially-streamed stop sequence off the end of the text.
 *
 * A stop sequence can arrive split across two chunks. Mid-sequence the text legitimately
 * ends with something like `</CO` or `<|fim`, which matches nothing in the stop list, so
 * it would be shown to the user and then have to be retracted a moment later. This removes
 * the fragment as soon as it appears.
 *
 * The floor is 3 characters, not 4. `</CO` is exactly 4 and the shorter sequences
 * (`<PRE>`, `<EOT>`, `<SUF>`) are only 5-6 long, so a higher floor leaves visible fragments
 * of the most common cases. The floor still has to be well above 1, because `+` is a prefix
 * of `+++++ ` and without one a completion of `a +` would have its operator chopped off
 * mid-expression. 3 characters is not a plausible ending for real code on its own.
 */
const MIN_PARTIAL_LEN = 3

export const trimPartialStopSequence = (text: string, sequences: readonly string[]): string => {
	if (!text) { return '' }

	let trimTo = text.length
	// lowercased once and reused, so the per-sequence loop does not reallocate
	const haystack = text.toLowerCase()
	for (const seq of sequences) {
		if (seq.length <= MIN_PARTIAL_LEN) { continue }
		// tag-shaped sentinels are matched case-insensitively; see isTagShaped
		const caseInsensitive = isTagShaped(seq)
		const needle = caseInsensitive ? seq.toLowerCase() : seq
		// only the tail can be a partial
		const maxFragment = Math.min(seq.length - 1, text.length)
		for (let k = maxFragment; k >= MIN_PARTIAL_LEN; k--) {
			const fragment = needle.slice(0, k)
			const ends = caseInsensitive ? haystack.endsWith(fragment) : text.endsWith(fragment)
			if (ends) {
				trimTo = Math.min(trimTo, text.length - k)
				break
			}
		}
	}

	return trimTo === text.length ? text : text.slice(0, trimTo)
}

/**
 * The model re-emitting the part of the current line that is already on screen.
 *
 * With the cursor after `print(`, a chat model quite often returns the whole line
 * `print("Hello, World!")` instead of just the part after the hole. Inserting that at the
 * cursor yields `print(print("Hello, World!"))`. Stripping the echoed prefix is the
 * difference between completing a line and corrupting it.
 *
 * Compared whitespace-insensitively, because the model rarely reproduces leading
 * indentation exactly. Only the FIRST occurrence is removed, so a later legitimate repeat
 * of the same text is left alone.
 */
export const stripEchoedLinePrefix = (text: string, lineBeforeCursor: string): string => {
	const typed = lineBeforeCursor
	if (!typed.trim() || !text) { return text }

	// exact
	if (text.startsWith(typed)) {
		const rest = text.slice(typed.length)
		return rest.trim() ? rest : text
	}

	// Whitespace-insensitive: walk both strings in parallel, skipping spaces and tabs, and
	// require the characters to actually match. An earlier version compared only how many
	// non-space characters each had, which matched almost any text and shredded unrelated
	// completions.
	let ti = 0, xi = 0
	while (ti < typed.length) {
		while (ti < typed.length && /[ \t]/.test(typed[ti])) { ti++ }
		if (ti >= typed.length) { break }
		while (xi < text.length && /[ \t]/.test(text[xi])) { xi++ }
		if (xi >= text.length) { return text }  // completion ran out - not an echo
		if (typed[ti] !== text[xi]) { return text } // diverged - not an echo
		ti++
		xi++
	}
	// typed was fully consumed, so the whole of it was echoed
	while (xi < text.length && /[ \t]/.test(text[xi])) { xi++ }

	const rest = text.slice(xi)
	return rest.trim() ? rest : text
}

/**
 * Re-indent a block that the model emitted at column 0.
 *
 * A block inserted on an already-indented blank line has every line after the first landing
 * at the wrong column, because the model was imitating the hole-filler examples, which show
 * the body relative to the hole rather than to the file.
 *
 * Only lines with NO leading whitespace are touched. A model that already indented a line
 * relative to the hole was deliberate, and a line that is genuinely at column 0 (a closing
 * brace, for instance) is left alone.
 */
export const indentContinuationLines = (text: string, ln: string, baseIndent: string): string => {
	if (!baseIndent || !text.includes(ln)) { return text }

	return text.split(ln).map((line, i) => {
		if (i === 0) { return line }         // the first line lands at the cursor as-is
		if (line.trim() === '') { return line } // blank lines stay blank
		if (/^[ \t]/.test(line)) { return line } // model already indented it
		// A line starting with a closing bracket is a DEDENT, not a missing indent. The
		// suffix supplies the block's real closing brace, so it belongs at column 0.
		if (/^[}\])>]/.test(line)) { return line }
		return baseIndent + line
	}).join(ln)
}

/* ---------------------------------------------------------------------------------------
 * The remaining stages of Continue's StreamTransformPipeline.
 *
 * Transcribed from continue-main/core/autocomplete/filtering/streamTransforms/{charStream,lineStream}.ts
 * Continue runs these as generators over a line stream; here they are whole-string transforms
 * that return the truncated text. Their `fullStop()` callback has no counterpart - by the time
 * these run the request has already finished, so there is nothing left to cancel.
 *
 * Continue's token ceiling is DEFAULT_MAX_TOKENS = 4096 (core/llm/constants.ts) and it is
 * only ever a backstop: generation normally ends on one of the boundaries below, which is
 * why a long completion is chopped at a semantic boundary rather than mid-statement. The
 * filters above already covered stopAtStopSequences, stopAtLines, stopAtLinesExact and
 * stopAtRepeatingLines; these are the rest.
 * ------------------------------------------------------------------------------------ */

/** Levenshtein distance. Continue uses the `fastest-levenshtein` package for this. */
const editDistance = (a: string, b: string): number => {
	if (a === b) { return 0 }
	if (!a.length) { return b.length }
	if (!b.length) { return a.length }

	let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		const cur = [i]
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(
				prev[j] + 1,                                        // deletion
				cur[j - 1] + 1,                                     // insertion
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),     // substitution
			)
		}
		prev = cur
	}
	return prev[b.length]
}

/**
 * Are these two lines near-identical, i.e. is the model re-emitting the other?
 *
 * Continue: lineStream.ts. Lines of 4 characters or fewer are never considered repeated,
 * because `}` and `});` legitimately recur and cutting on them would truncate most blocks.
 */
export const lineIsRepeated = (a: string, b: string): boolean => {
	if (a.length <= 4 || b.length <= 4) { return false }
	return editDistance(a.trim(), b.trim()) / b.trim().length < 0.1
}

/** Does this line end in something that closes a construct? */
const BRACKET_ENDING_CHARS = [')', ']', '}', ';']
const isBracketEnding = (line: string): boolean =>
	line.trim().split('').some(char => BRACKET_ENDING_CHARS.includes(char))

/**
 * Stop when the completion produces the line that already sits below the cursor.
 *
 * Unlike `stopAtLineBelow`, which requires a near-duplicate, this is Continue's fuzzy
 * version: a line within 10% edit distance of the one below ends the completion, which
 * catches the model drifting back toward text the user already has.
 *
 * The bracket-ending exemption is deliberate and load-bearing: closing braces repeat
 * constantly in real code, so an exact match on one must be allowed through. Note that
 * Continue tests `nextLine === line` before yielding, so a completion whose FIRST line
 * equals the line below yields the empty string. That is faithful rather than useful -
 * in practice the line below the cursor is empty or a closing brace, so it does not arise.
 */
export const stopAtSimilarLine = (text: string, ln: string, line: string): string => {
	const trimmedLine = line.trim()
	if (trimmedLine === '') { return text }
	const lineIsBracketEnding = isBracketEnding(trimmedLine)

	const kept: string[] = [];
	for (const nextLine of text.split(ln)) {
		if (lineIsBracketEnding && trimmedLine === nextLine.trim()) { kept.push(nextLine); continue }
		if (nextLine === line) { break }
		if (lineIsRepeated(nextLine, trimmedLine)) { break }
		kept.push(nextLine);
	}
	return kept.join(ln);
}

/**
 * Stop when the completion runs into the start of the suffix.
 *
 * The model has regenerated the document text that is already to the right of the cursor.
 * Continue only applies this when the suffix is at least `sequenceLength` characters, since
 * a short suffix is too weak a signal to cut on.
 */
export const stopAtStartOfSuffix = (text: string, suffix: string, sequenceLength = 20): string => {
	if (suffix.length < sequenceLength) { return text }
	const targetPart = suffix.trimStart().slice(0, Math.floor(sequenceLength * 1.5))
	const idx = text.indexOf(targetPart)
	return idx === -1 ? text : text.slice(0, idx)
}

/** Drop a comment line that carries no text, e.g. a bare `//`. */
export const avoidEmptyComments = (text: string, ln: string, comment?: string): string => {
	if (!comment) { return text }
	return text.split(ln).filter(line => line.trim() !== comment).join(ln);
}

/**
 * Drop a snippet path header.
 *
 * Snippets get inserted as comments opening with `// Path: <PATH>`, and the model
 * sometimes copies the pattern. Continue matches that prefix literally, so prose starting
 * the same way is dropped too; kept verbatim rather than tightened.
 */
export const avoidPathLine = (text: string, ln: string, comment?: string): string => {
	if (!comment) { return text }
	const needle = `${comment} Path: `
	return text.split(ln).filter(line => !line.startsWith(needle)).join(ln);
}

const PREFIXES_TO_SKIP: readonly string[] = ['<COMPLETION>']

/** Strip a template prefix from the first line, e.g. a leading `<COMPLETION>`. */
export const skipPrefixes = (text: string, ln: string): string => {
	const lines = text.split(ln);
	if (lines.length === 0) { return text }
	const match = PREFIXES_TO_SKIP.find(prefix => lines[0].startsWith(prefix));
	if (match) { lines[0] = lines[0].slice(match.length); }
	return lines.join(ln);
}

// Continue's noDoubleNewLine is NOT applied here. It returns at the first blank line,
// which would reduce 'a\n\n\n\n\n\nb' to 'a' and eat the trailing newline of every
// completion that ends on one. collapseBlankLineRuns already handles blank-line padding,
// and it collapses a run to a single blank line rather than truncating at the first.

// Continue's removeTrailingWhitespace is NOT applied here. It turns 'total + ' into
// 'total +', and the trailing space is load-bearing: on a single-line prediction it tells
// the editor the completion is unfinished, so the cursor lands after the space and typing
// continues naturally. Trimming it makes 'total + ' look complete and drops the cursor
// back onto the operator.

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
	/**
	 * Text on the current line to the LEFT of the cursor. If the model re-emits it, it is
	 * stripped - otherwise you get `print(print("hi"))`.
	 */
	prefixToTheLeftOfCursor?: string;
	/**
	 * Indentation of the cursor's line. Continuation lines the model left at column 0 are
	 * shifted by this, so a block inserted on an indented line stays a block.
	 */
	baseIndent?: string;
	/** Apply `indentContinuationLines`. Off for native FIM, which indents correctly itself. */
	reindentContinuation?: boolean;
	/** The line below the cursor, for `stopAtSimilarLine`. Falls back to lineBelow if unset. */
	lineBelowForSimilarity?: string;
	/** The suffix to the right of the cursor, for `stopAtStartOfSuffix`. */
	suffix?: string;
	/** Single-line comment token for the file's language, e.g. `//`. */
	commentSyntax?: string;
};

/**
 * The full pipeline. Order matters:
 *   char-level sentinels -> fences -> preamble -> repeated lines -> re-generation
 *   -> blank-line padding -> single-line clamp -> bracket balance
 */
export const applyCompletionFilters = (raw: string, opts: ApplyFiltersOptions): string => {
	const { ln, lineBelow, stopSequences, singleLineOnly, prefix, prefixToTheLeftOfCursor, baseIndent, reindentContinuation, lineBelowForSimilarity, suffix, commentSyntax } = opts;

	let text = raw;
	if (!text) { return ''; }

	// Prefix: '\n\n/* Relevant context:\n' + relevantContext + '\n*/\n' + prefix

	// The model re-emitted the part of this line that is already on screen. Must run before
	// anything else, or the duplicate gets carried into every later step.
	if (prefixToTheLeftOfCursor !== undefined) {
		text = stripEchoedLinePrefix(text, prefixToTheLeftOfCursor);
	}

	// Must run before the single-line clamp, which would hide the mistake.
	if (reindentContinuation && baseIndent) {
		text = indentContinuationLines(text, ln, baseIndent);
	}

	text = stopAtStopSequences(text, stopSequences);
	text = stripCodeFences(text, ln);
	text = dropEnglishPreamble(text, ln);

	// only meaningful once we actually have multiple lines
	text = stopAtRepeatingLines(text, ln);
	text = stopAtLineBelow(text, ln, lineBelow);
	text = collapseBlankLineRuns(text, ln);

	// Continue's remaining boundaries, in its pipeline order. These are what let a long
	// completion end on a semantic boundary instead of at the token ceiling, which is how
	// it avoids inserting half a statement.
	text = skipPrefixes(text, ln);
	text = avoidEmptyComments(text, ln, commentSyntax);
	text = avoidPathLine(text, ln, commentSyntax);
	if (!singleLineOnly) {
		// a single-line prediction is clamped at the first newline anyway
		text = stopAtSimilarLine(text, ln, lineBelowForSimilarity ?? lineBelow);
	}
	if (suffix !== undefined) {
		text = stopAtStartOfSuffix(text, suffix);
	}

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
		// A single-line prediction is inserted at a zero-width cursor on the current line, so
		// a leading newline would render the whole thing on the NEXT line. Strip leading
		// newlines first - otherwise the clamp below would truncate the completion to nothing,
		// because the first newline is at index 0.
		let lead = 0;
		while (lead < text.length && (text[lead] === '\n' || text[lead] === '\r')) { lead++; }
		if (lead > 0) { text = text.slice(lead); }

		const nl = text.indexOf(ln);
		if (nl !== -1) { text = text.slice(0, nl); }
	}

	if (prefix !== undefined) {
		text = getStringUpToUnbalancedClosingParenthesis(text, prefix);
	}

	// LAST, so it also catches a stop sequence left dangling by an earlier cut
	text = trimPartialStopSequence(text, [...STOP_SEQUENCES, ...(stopSequences ?? [])]);

	return text;
};
