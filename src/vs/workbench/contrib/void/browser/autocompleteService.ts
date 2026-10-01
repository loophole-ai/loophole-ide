/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { EndOfLinePreference, ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { InlineCompletion, InlineCompletionEndOfLifeReasonKind, } from '../../../../editor/common/languages.js';
import { Range } from '../../../../editor/common/core/range.js';
import { extractCodeFromRegular } from '../common/helpers/extractCodeFromResult.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { isWindows } from '../../../../base/common/platform.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { FeatureName, MultilineCompletionsMode } from '../common/voidSettingsTypes.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { applyCompletionFilters, getStringUpToUnbalancedClosingParenthesis } from './autocompleteFilters.js';
import { prunePrefix, pruneSuffix, resolveMaxPromptTokens } from './autocompletePromptSizing.js';
import { shouldCompleteMultiline } from './autocompleteMultiline.js';
import { getTemplateForModel, universalStopTokens } from './autocompleteFimTemplates.js';
import { getModelCapabilities } from '../common/modelCapabilities.js';
// import { IContextGatheringService } from './contextGatheringService.js';



const allLinebreakSymbols = ['\r\n', '\n']
const _ln = isWindows ? allLinebreakSymbols[0] : allLinebreakSymbols[1]

// The extension this was called from is here - https://github.com/voideditor/void/blob/autocomplete/extensions/void/src/extension/extension.ts


/*
A summary of autotab:

Postprocessing
-one common problem for all models is outputting unbalanced parentheses
we solve this by trimming all extra closing parentheses from the generated string
(./autocompleteFilters.ts also strips fences, leaked sentinels, chat preambles,
 repeated lines, re-generation of the line below, and blank-line padding)

-another problem is completing the middle of a string, eg. "const [x, CURSOR] = useState()"
we complete up to first matchup character
but should instead complete the whole line / block (difficult because of parenthesis accuracy)

Preprocessing
- we don't generate if cursor is at end / beginning of a line (no spaces)
- we generate 1 line if there is text to the right of cursor
- we generate 1 line if variable declaration
- the context window is sized in tokens, not lines (./autocompletePromptSizing.ts)
- TODO add context from other files (./contextGatheringService.ts exists but is unwired
  and needs caching + timeouts before it is safe to put on this path)

State
- cache based on prefix (and do some trimming first)
- the request streams: a filtered partial is shown as soon as the first line is
  complete, or after MAX_TIME_TO_SHOW_PARTIAL, and later keystrokes pick up the
  longer text from the same cache entry
- accepted completions are evicted and stamp `_lastCompletionAccept`, which is what
  unlocks the 'multi-line-start-on-next-line' prediction
- [todo] remove each autotab when accepted
!- [todo] provide type information
*/

class LRUCache<K, V> {
	public items: Map<K, V>;
	private keyOrder: K[];
	private maxSize: number;
	private disposeCallback?: (value: V, key?: K) => void;

	constructor(maxSize: number, disposeCallback?: (value: V, key?: K) => void) {
		if (maxSize <= 0) throw new Error('Cache size must be greater than 0');

		this.items = new Map();
		this.keyOrder = [];
		this.maxSize = maxSize;
		this.disposeCallback = disposeCallback;
	}

	set(key: K, value: V): void {
		// If key exists, remove it from the order list
		if (this.items.has(key)) {
			this.keyOrder = this.keyOrder.filter(k => k !== key);
		}
		// If cache is full, remove least recently used item
		else if (this.items.size >= this.maxSize) {
			const key = this.keyOrder[0];
			const value = this.items.get(key);

			// Call dispose callback if it exists
			if (this.disposeCallback && value !== undefined) {
				this.disposeCallback(value, key);
			}

			this.items.delete(key);
			this.keyOrder.shift();
		}

		// Add new item
		this.items.set(key, value);
		this.keyOrder.push(key);
	}

	delete(key: K): boolean {
		const value = this.items.get(key);

		if (value !== undefined) {
			// Call dispose callback if it exists
			if (this.disposeCallback) {
				this.disposeCallback(value, key);
			}

			this.items.delete(key);
			this.keyOrder = this.keyOrder.filter(k => k !== key);
			return true;
		}

		return false;
	}

	clear(): void {
		// Call dispose callback for all items if it exists
		if (this.disposeCallback) {
			for (const [key, value] of this.items.entries()) {
				this.disposeCallback(value, key);
			}
		}

		this.items.clear();
		this.keyOrder = [];
	}

	get size(): number {
		return this.items.size;
	}

	has(key: K): boolean {
		return this.items.has(key);
	}
}

type AutocompletionPredictionType =
	| 'single-line-fill-middle'
	| 'single-line-redo-suffix'
	// | 'multi-line-start-here'
	| 'multi-line-start-on-next-line'
	| 'do-not-predict'

type Autocompletion = {
	id: number,
	prefix: string,
	suffix: string,
	llmPrefix: string,
	llmSuffix: string,
	startTime: number,
	endTime: number | undefined,
	status: 'pending' | 'finished' | 'error',
	type: AutocompletionPredictionType,
	llmPromise: Promise<string> | undefined,
	insertText: string,
	requestId: string | null,
	_newlineCount: number,
	/** Set when the first token lands, so the partial-show deadline is measured from the
	 *  first byte the user can actually see, not from when the request was issued. */
	firstTokenTime: number | undefined,
	/** True once we've decided the text is good enough and asked the model to stop. */
	stoppedEarly: boolean,
}

/**
 * An inline completion that remembers which cache entry (and which document) produced
 * it, so the accept callback can find its way back to it. The editor hands the very same
 * objects back to us in `handleEndOfLifetime`.
 */
type TrackedInlineCompletion = InlineCompletion & { autocompleteId: number, documentUri: string }

/** How long the user must be idle before we spend a request. */
const DEBOUNCE_TIME = 250

/**
 * Once the first token arrives, wait at most this long for a *useful* amount of text and
 * then show it. The request keeps streaming in the background and later keystrokes pick
 * up the longer version from the cache, so a slow model degrades into a progressive
 * suggestion rather than into no suggestion.
 */
const MAX_TIME_TO_SHOW_PARTIAL = 300

/**
 * Hard ceiling on a single request. This is a backstop for a hung socket, not the normal
 * exit - requests normally end via the stream filters or the partial-show deadline.
 */
const TIMEOUT_TIME = 10000

/**
 * How much raw output we will accept before deciding the model is producing something we
 * can never show. Guards against paying for a whole essay.
 */
const GARBAGE_RAW_THRESHOLD = 400

const MAX_CACHE_SIZE = 20
const MAX_PENDING_REQUESTS = 2

/**
 * How long after an accept we should assume the user is chaining completions and offer
 * the next block on the following line.
 */
const JUST_ACCEPTED_WINDOW = 500

// postprocesses the result
const processStartAndEndSpaces = (result: string) => {

	// trim all whitespace except for a single leading/trailing space
	// return result.trim()

	[result,] = extractCodeFromRegular({ text: result, recentlyAddedTextLen: result.length })

	const hasLeadingSpace = result.startsWith(' ');
	const hasTrailingSpace = result.endsWith(' ');

	return (hasLeadingSpace ? ' ' : '')
		+ result.trim()
		+ (hasTrailingSpace ? ' ' : '');



}


/**
 * Run streamed text through the filter pipeline. Called on every chunk and again on the
 * final text.
 *
 * Note a few of the filters are retroactive (see autocompleteFilters.ts), so this is not
 * guaranteed to be a prefix-extension of its previous result. That is fine: callers re-read
 * `insertText` on every keystroke rather than accumulating, so a revised frame simply
 * replaces the last one.
 */
const filterStreamedText = (text: string, prefixAndSuffix: PrefixAndSuffixInfo, predictionType: AutocompletionPredictionType, reindentContinuation: boolean): string => {
	const { prefix, prefixToTheLeftOfCursor, suffixLines } = prefixAndSuffix
	// the line *under* the cursor's line - if the model re-generates it we are duplicating
	const lineBelow = suffixLines[1] ?? ''
	// the indent the cursor is sitting at, so a block keeps that indent
	const baseIndent = (prefixToTheLeftOfCursor.match(/^[ \t]*/) ?? [''])[0]

	return processStartAndEndSpaces(applyCompletionFilters(text, {
		ln: _ln,
		lineBelow,
		prefix,
		prefixToTheLeftOfCursor,
		baseIndent,
		reindentContinuation,
		// Only a block prediction may span lines. Everything else is inserted at a zero-width
		// cursor on the current line, so a newline in the reply would push the whole suggestion
		// onto the next line. This was previously never passed, so the invariant was unenforced.
		singleLineOnly: predictionType !== 'multi-line-start-on-next-line',
	}))
}


// trims the end of the prefix to improve cache hit rate
const removeLeftTabsAndTrimEnds = (s: string): string => {
	const trimmedString = s.trimEnd();
	const trailingEnd = s.slice(trimmedString.length);

	// keep only a single trailing newline
	if (trailingEnd.includes(_ln)) {
		s = trimmedString + _ln;
	}

	s = s.replace(/^\s+/gm, ''); // remove left tabs

	return s;
}



const removeAllWhitespace = (str: string): string => str.replace(/\s+/g, '');



function getIsSubsequence({ of, subsequence }: { of: string, subsequence: string }): [boolean, string] {
	if (subsequence.length === 0) return [true, ''];
	if (of.length === 0) return [false, ''];

	let subsequenceIndex = 0;
	let lastMatchChar = '';

	for (let i = 0; i < of.length; i++) {
		if (of[i] === subsequence[subsequenceIndex]) {
			lastMatchChar = of[i];
			subsequenceIndex++;
		}
		if (subsequenceIndex === subsequence.length) {
			return [true, lastMatchChar];
		}
	}

	return [false, lastMatchChar];
}


// bracket balancing now lives in ./autocompleteFilters.ts so it can be unit tested


// further trim the autocompletion
const postprocessAutocompletion = ({ autocompletionMatchup, autocompletion, prefixAndSuffix }: { autocompletionMatchup: AutocompletionMatchupBounds, autocompletion: Autocompletion, prefixAndSuffix: PrefixAndSuffixInfo }) => {

	const { prefix, prefixToTheLeftOfCursor, suffixToTheRightOfCursor } = prefixAndSuffix

	const generatedMiddle = autocompletion.insertText

	let startIdx = autocompletionMatchup.startIdx
	let endIdx = generatedMiddle.length // exclusive bounds

	// Defensive: a matchup computed against a partially-streamed multi-line completion can
	// land outside the text we now hold. Clamping is always safe (a negative start would
	// otherwise slice from the end of the string).
	startIdx = Math.max(0, Math.min(startIdx, generatedMiddle.length))
	endIdx = Math.max(startIdx, endIdx)

	// const naiveReturnValue = generatedMiddle.slice(startIdx)
	// console.log('naiveReturnValue: ', JSON.stringify(naiveReturnValue))
	// return [{ insertText: naiveReturnValue, }]

	// do postprocessing for better ux
	// this is a bit hacky but may change a lot

	// if there is space at the start of the completion and user has added it, remove it
	const charToLeftOfCursor = prefixToTheLeftOfCursor.slice(-1)[0] || ''
	const userHasAddedASpace = charToLeftOfCursor === ' ' || charToLeftOfCursor === '\t'
	const rawFirstNonspaceIdx = generatedMiddle.slice(startIdx).search(/[^\t ]/)
	if (rawFirstNonspaceIdx > -1 && userHasAddedASpace) {
		const firstNonspaceIdx = rawFirstNonspaceIdx + startIdx;
		// console.log('p0', startIdx, rawFirstNonspaceIdx)
		startIdx = Math.max(startIdx, firstNonspaceIdx)
	}

	// if user is on a blank line and the generation starts with newline(s), remove them
	const numStartingNewlines = generatedMiddle.slice(startIdx).match(new RegExp(`^${_ln}+`))?.[0].length || 0;
	if (
		!prefixToTheLeftOfCursor.trim()
		&& !suffixToTheRightOfCursor.trim()
		&& numStartingNewlines > 0
	) {
		// console.log('p1', numStartingNewlines)
		startIdx += numStartingNewlines
	}

	// if the generated FIM text matches with the suffix on the current line, stop
	if (autocompletion.type === 'single-line-fill-middle' && suffixToTheRightOfCursor.trim()) { // completing in the middle of a line
		// complete until there is a match
		const rawMatchIndex = generatedMiddle.slice(startIdx).lastIndexOf(suffixToTheRightOfCursor.trim()[0])
		if (rawMatchIndex > -1) {
			// console.log('p2', rawMatchIndex, startIdx, suffixToTheRightOfCursor.trim()[0], 'AAA', generatedMiddle.slice(startIdx))
			const matchIdx = rawMatchIndex + startIdx;
			const matchChar = generatedMiddle[matchIdx]
			if (`{}()[]<>\`'"`.includes(matchChar)) {
				endIdx = Math.min(endIdx, matchIdx)
			}
		}
	}

	const restOfLineToGenerate = generatedMiddle.slice(startIdx).split(_ln)[0] ?? ''
	// Clamp to one line - but NEVER for a block prediction, or we would chop the block
	// down to its first line, which is exactly what a multi-line completion must not do.
	if (
		autocompletion.type !== 'multi-line-start-on-next-line'
		&& prefixToTheLeftOfCursor.trim()
		&& !suffixToTheRightOfCursor.trim()
		&& restOfLineToGenerate.trim()
	) {

		const rawNewlineIdx = generatedMiddle.slice(startIdx).indexOf(_ln)
		if (rawNewlineIdx > -1) {
			// console.log('p3', startIdx, rawNewlineIdx)
			const newlineIdx = rawNewlineIdx + startIdx;
			endIdx = Math.min(endIdx, newlineIdx)
		}
	}

	// // if a generated line matches with a suffix line, stop
	// if (suffixLines.length > 1) {
	// 	console.log('4')
	// 	const lines = []
	// 	for (const generatedLine of generatedLines) {
	// 		if (suffixLines.slice(0, 10).some(suffixLine =>
	// 			generatedLine.trim() !== '' && suffixLine.trim() !== ''
	// 			&& generatedLine.trim().startsWith(suffixLine.trim())
	// 		)) break;
	// 		lines.push(generatedLine)
	// 	}
	// 	endIdx = lines.join('\n').length // this is hacky, remove or refactor in future
	// }

	// console.log('pFinal', startIdx, endIdx)
	let completionStr = generatedMiddle.slice(startIdx, endIdx)

	// filter out unbalanced parentheses
	completionStr = getStringUpToUnbalancedClosingParenthesis(completionStr, prefix)
	// console.log('originalCompletionStr: ', JSON.stringify(generatedMiddle.slice(startIdx)))
	// console.log('finalCompletionStr: ', JSON.stringify(completionStr))


	return completionStr

}

// returns the text in the autocompletion to display, assuming the prefix is already matched
const toInlineCompletions = ({ autocompletionMatchup, autocompletion, prefixAndSuffix, position, debug }: { autocompletionMatchup: AutocompletionMatchupBounds, autocompletion: Autocompletion, prefixAndSuffix: PrefixAndSuffixInfo, position: Position, debug?: boolean }): { insertText: string, range: Range }[] => {

	let trimmedInsertText = postprocessAutocompletion({ autocompletionMatchup, autocompletion, prefixAndSuffix, })
	let rangeToReplace: Range = new Range(position.lineNumber, position.column, position.lineNumber, position.column)

	// handle special cases

	// if we redid the suffix, replace the suffix
	if (autocompletion.type === 'single-line-redo-suffix') {

		const oldSuffix = prefixAndSuffix.suffixToTheRightOfCursor
		const newSuffix = autocompletion.insertText

		const [isSubsequence, lastMatchingChar] = getIsSubsequence({ // check that the old text contains the same brackets + symbols as the new text
			subsequence: removeAllWhitespace(oldSuffix), // old suffix
			of: removeAllWhitespace(newSuffix), // new suffix
		})
		if (isSubsequence) {
			rangeToReplace = new Range(position.lineNumber, position.column, position.lineNumber, Number.MAX_SAFE_INTEGER)
		}
		else {

			const lastMatchupIdx = trimmedInsertText.lastIndexOf(lastMatchingChar)
			trimmedInsertText = trimmedInsertText.slice(0, lastMatchupIdx + 1)
			const numCharsToReplace = oldSuffix.lastIndexOf(lastMatchingChar) + 1
			rangeToReplace = new Range(position.lineNumber, position.column, position.lineNumber, position.column + numCharsToReplace)
			// console.log('show____', trimmedInsertText, rangeToReplace)
		}
	}

	// The editor requires that a completion containing a line break replaces a range which
	// ends at the end of a line - a zero-width range makes multi-line ghost text render in
	// the wrong place (or not at all). This costs nothing because a block prediction is
	// only ever produced when the line suffix is already empty.
	if (trimmedInsertText.includes(_ln)) {
		rangeToReplace = new Range(position.lineNumber, position.column, position.lineNumber, Number.MAX_SAFE_INTEGER)
	}

	// nothing survived post-processing - showing empty ghost text is worse than showing none
	if (!trimmedInsertText) { return [] }

	return [{
		insertText: trimmedInsertText,
		range: rangeToReplace,
	}]

}





// returns whether this autocompletion is in the cache
// const doesPrefixMatchAutocompletion = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): boolean => {

// 	const originalPrefix = autocompletion.prefix
// 	const generatedMiddle = autocompletion.result
// 	const originalPrefixTrimmed = trimPrefix(originalPrefix)
// 	const currentPrefixTrimmed = trimPrefix(prefix)

// 	if (currentPrefixTrimmed.length < originalPrefixTrimmed.length) {
// 		return false
// 	}

// 	const isMatch = (originalPrefixTrimmed + generatedMiddle).startsWith(currentPrefixTrimmed)
// 	return isMatch

// }


type PrefixAndSuffixInfo = { prefix: string, suffix: string, prefixLines: string[], suffixLines: string[], prefixToTheLeftOfCursor: string, suffixToTheRightOfCursor: string }
const getPrefixAndSuffixInfo = (model: ITextModel, position: Position): PrefixAndSuffixInfo => {

	const fullText = model.getValue(EndOfLinePreference.LF);

	const cursorOffset = model.getOffsetAt(position)
	const prefix = fullText.substring(0, cursorOffset)
	const suffix = fullText.substring(cursorOffset)


	const prefixLines = prefix.split(_ln)
	const suffixLines = suffix.split(_ln)

	const prefixToTheLeftOfCursor = prefixLines.slice(-1)[0] ?? ''
	const suffixToTheRightOfCursor = suffixLines[0] ?? ''

	return { prefix, suffix, prefixLines, suffixLines, prefixToTheLeftOfCursor, suffixToTheRightOfCursor }

}

/**
 * Offset in the raw `insertText` that a character count in the trimmed middle maps to.
 *
 * `removeLeftTabsAndTrimEnds` is `s.replace(/^\s+/gm, '')` - it deletes only the whitespace
 * at the START of each line. Interior whitespace survives, and so does trailing
 * whitespace on the final line. So to map a trimmed offset back onto the raw text,
 * walk forward skipping the whitespace run at each line start and counting
 * everything else, until `charCount` surviving characters have been seen.
 *
 * Deliberately walks the raw text instead of splitting the trimmed text on `_ln`:
 * the trimmer strips the `\r` of a `\r\n` as well, so under Windows line endings the trimmed
 * text holds lone `\r` and reads as a single line.
 */
const rawOffsetOfTrimmedIndex = (rawMiddle: string, charCount: number): number => {
	if (charCount <= 0) { return 0 }
	let seen = 0
	let i = 0
	while (i < rawMiddle.length) {
		const atLineStart = i === 0 || /^\s/.test(rawMiddle[i - 1])
		if (atLineStart && /\s/.test(rawMiddle[i])) { i++; continue }
		if (seen === charCount) { break }
		seen++
		i++
	}
	return Math.min(i, rawMiddle.length)
}


type AutocompletionMatchupBounds = {
	/** Index into the raw `autocompletion.insertText`, where the new text begins. */
	startIdx: number,
}
// returns the startIdx of the match if there is a match, or undefined if there is no match
// all results are wrt `autocompletion.result`
const getAutocompletionMatchup = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): AutocompletionMatchupBounds | undefined => {

	const trimmedCurrentPrefix = removeLeftTabsAndTrimEnds(prefix)
	const trimmedCompletionPrefix = removeLeftTabsAndTrimEnds(autocompletion.prefix)
	const trimmedCompletionMiddle = removeLeftTabsAndTrimEnds(autocompletion.insertText)

	// console.log('@result: ', JSON.stringify(autocompletion.insertText))
	// console.log('@trimmedCurrentPrefix: ', JSON.stringify(trimmedCurrentPrefix))
	// console.log('@trimmedCompletionPrefix: ', JSON.stringify(trimmedCompletionPrefix))
	// console.log('@trimmedCompletionMiddle: ', JSON.stringify(trimmedCompletionMiddle))

	if (trimmedCurrentPrefix.length < trimmedCompletionPrefix.length) { // user must write text beyond the original prefix at generation time
		// console.log('@undefined1')
		return undefined
	}

	if ( // check that completion starts with the prefix
		!(trimmedCompletionPrefix + trimmedCompletionMiddle)
			.startsWith(trimmedCurrentPrefix)
	) {
		// console.log('@undefined2')
		return undefined
	}

	// How much of the middle the user has already typed, as a plain character
	// count. This is the same quantity Continue computes in GeneratorReuseManager,
	// and unlike the line/character reconstruction it replaced, it cannot disagree
	// with the strings it was derived from.
	const typedAheadChars = trimmedCurrentPrefix.length - trimmedCompletionPrefix.length

	if (typedAheadChars < 0) {
		// console.log('@undefined3')
		return undefined
	}

	if (typedAheadChars > trimmedCompletionMiddle.length) {
		// console.log('@undefined4')
		return undefined
	}

	const startIdx = rawOffsetOfTrimmedIndex(autocompletion.insertText, typedAheadChars)

	return {
		startIdx,
	}


}


type CompletionOptions = {
	predictionType: AutocompletionPredictionType,
	shouldGenerate: boolean,
	llmPrefix: string,
	llmSuffix: string,
	stopTokens: string[],
}

/**
 * Should this position get a block rather than a line? The decision itself, and the
 * safety invariant that a block never replaces existing text, live in
 * ./autocompleteMultiline.ts so they can be tested directly.
 */
const getCompletionOptions = (prefixAndSuffix: PrefixAndSuffixInfo, relevantContext: string, justAcceptedAutocompletion: boolean, multilineCompletions: MultilineCompletionsMode, maxPromptTokens: number): CompletionOptions => {

	let { prefix, suffix, prefixToTheLeftOfCursor, suffixToTheRightOfCursor, suffixLines } = prefixAndSuffix

	// Size the context window by tokens rather than a flat line count. 25 lines of dense
	// code blows the budget while 25 lines of nested indentation is nearly worthless, and
	// the tokenizer is already available locally so this costs nothing extra.
	prefix = prunePrefix(prefix, _ln, undefined, maxPromptTokens)
	suffix = pruneSuffix(suffix, _ln, undefined, maxPromptTokens)
	suffixLines = suffix.split(_ln)

	// An empty (or whitespace-only) file has nothing to fill a hole with. Sending it anyway
	// wastes a request and, on the few-shot path, reliably produces a reply about the prompt
	// itself rather than code - a chat model handed a bare hole decides the task is
	// impossible and says so.
	if (!prefix.trim() && !suffix.trim()) {
		return {
			predictionType: 'do-not-predict',
			shouldGenerate: false,
			llmPrefix: prefix,
			llmSuffix: suffix,
			stopTokens: [],
		}
	}

	let completionOptions: CompletionOptions

	// if line is empty, do multiline completion
	const isLineEmpty = !prefixToTheLeftOfCursor.trim() && !suffixToTheRightOfCursor.trim()
	const isLinePrefixEmpty = removeAllWhitespace(prefixToTheLeftOfCursor).length === 0

	// How much of the current line is already typed. Decides whether "redo the suffix" applies.
	const suffixChars = removeAllWhitespace(suffixToTheRightOfCursor).length

	// TODO add context to prefix
	// llmPrefix = '\n\n/* Relevant context:\n' + relevantContext + '\n*/\n' + llmPrefix

	// a block prediction gets first refusal, and is the only one that may span lines
	if (shouldCompleteMultiline(multilineCompletions, prefixAndSuffix, justAcceptedAutocompletion)) {
		completionOptions = {
			predictionType: 'multi-line-start-on-next-line',
			shouldGenerate: true,
			// ask the model to begin on a new line; the prepended newline is stripped again
			// in postprocessing when the cursor is already sitting on a fresh line
			llmPrefix: prefix + _ln,
			llmSuffix: suffix,
			// stop at a blank line, so we get one coherent block rather than the whole file
			stopTokens: [`${_ln}${_ln}`]
		}
	}
	// if the current line is empty, predict a single-line completion
	else if (isLineEmpty) {
		completionOptions = {
			predictionType: 'single-line-fill-middle',
			shouldGenerate: true,
			llmPrefix: prefix,
			llmSuffix: suffix,
			stopTokens: allLinebreakSymbols
		}
	}
	// Redo the line ignoring what is already on it - but ONLY when there is something to
	// ignore.
	//
	// This condition used to be "<= 3", which is also true of 0. So a line that was already
	// complete up to the cursor (print("Hello World" with nothing after it) took this branch,
	// which drops the rest of the current line from llmSuffix. That moves the model's FIM hole
	// to "end of this line -> start of the next one", so the model bridges the gap with a
	// newline and the suggestion renders on the following line instead of in place.
	// suffixChars > 0 is the missing guard.
	else if (suffixChars > 0 && suffixChars <= 3) {
		const suffixLinesIgnoringThisLine = suffixLines.slice(1)
		const suffixStringIgnoringThisLine = suffixLinesIgnoringThisLine.length === 0 ? '' : _ln + suffixLinesIgnoringThisLine.join(_ln)
		completionOptions = {
			predictionType: 'single-line-redo-suffix',
			shouldGenerate: true,
			llmPrefix: prefix,
			llmSuffix: suffixStringIgnoringThisLine,
			stopTokens: allLinebreakSymbols
		}
	}
	// else attempt to complete the middle of the line if there is a prefix (the completion looks bad if there is no prefix)
	else if (!isLinePrefixEmpty) {
		completionOptions = {
			predictionType: 'single-line-fill-middle',
			shouldGenerate: true,
			llmPrefix: prefix,
			llmSuffix: suffix,
			stopTokens: allLinebreakSymbols
		}
	} else {
		completionOptions = {
			predictionType: 'do-not-predict',
			shouldGenerate: false,
			llmPrefix: prefix,
			llmSuffix: suffix,
			stopTokens: []
		}
	}

	return completionOptions

}

export interface IAutocompleteService {
	readonly _serviceBrand: undefined;
}

export const IAutocompleteService = createDecorator<IAutocompleteService>('AutocompleteService');

export class AutocompleteService extends Disposable implements IAutocompleteService {

	static readonly ID = 'void.autocompleteService'

	_serviceBrand: undefined;

	private _autocompletionId: number = 0;
	private _autocompletionsOfDocument: { [docUriStr: string]: LRUCache<number, Autocompletion> } = {}

	private _lastCompletionStart = 0
	private _lastCompletionAccept = 0
	// private _lastPrefix: string = ''

	// used internally by vscode
	// fires after every keystroke and returns the completion to show
	async _provideInlineCompletionItems(
		model: ITextModel,
		position: Position,
		token: CancellationToken,
	): Promise<InlineCompletion[]> {

		const isEnabled = this._settingsService.state.globalSettings.enableAutocomplete
		if (!isEnabled) return []

		const docUriStr = model.uri.fsPath;

		const prefixAndSuffix = getPrefixAndSuffixInfo(model, position)
		const { prefix, suffix } = prefixAndSuffix

		// initialize cache if it doesnt exist
		// note that whenever an autocompletion is accepted, it is removed from cache
		if (!this._autocompletionsOfDocument[docUriStr]) {
			this._autocompletionsOfDocument[docUriStr] = new LRUCache<number, Autocompletion>(
				MAX_CACHE_SIZE,
				(autocompletion: Autocompletion) => {
					if (autocompletion.requestId)
						this._llmMessageService.abort(autocompletion.requestId)
				}
			)
		}
		// this._lastPrefix = prefix

		// print all pending autocompletions
		// let _numPending = 0
		// this._autocompletionsOfDocument[docUriStr].items.forEach((a: Autocompletion) => { if (a.status === 'pending') _numPending += 1 })
		// console.log('@numPending: ' + _numPending)

		// get autocompletion from cache
		let cachedAutocompletion: Autocompletion | undefined = undefined
		let autocompletionMatchup: AutocompletionMatchupBounds | undefined = undefined
		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].items.values()) {
			// if the user's change matches with the autocompletion
			autocompletionMatchup = getAutocompletionMatchup({ prefix, autocompletion })
			if (autocompletionMatchup !== undefined) {
				cachedAutocompletion = autocompletion
				break;
			}
		}

		// if there is a cached autocompletion, return it
		if (cachedAutocompletion && autocompletionMatchup) {

			if (cachedAutocompletion.status === 'finished') {
				const completions = toInlineCompletions({ autocompletionMatchup, autocompletion: cachedAutocompletion, prefixAndSuffix, position })
				return this._track(completions, cachedAutocompletion.id, docUriStr)

			} else if (cachedAutocompletion.status === 'pending') {
				try {
					// resolves as soon as there is enough text to be worth showing
					// (MAX_TIME_TO_SHOW_PARTIAL), not when the model finishes
					await cachedAutocompletion.llmPromise;
					const completions = toInlineCompletions({ autocompletionMatchup, autocompletion: cachedAutocompletion, prefixAndSuffix, position })
					return this._track(completions, cachedAutocompletion.id, docUriStr)

				} catch (e) {
					this._autocompletionsOfDocument[docUriStr].delete(cachedAutocompletion.id)
				}

			}

			// Either the request errored, or a pending one failed. Drop it, otherwise it
			// keeps matching the prefix and suppresses every future suggestion in this
			// file until the LRU happens to evict it.
			this._autocompletionsOfDocument[docUriStr].delete(cachedAutocompletion.id)
			return []
		}

		// else if no more typing happens, then go forwards with the request

		// wait DEBOUNCE_TIME for the user to stop typing
		const thisTime = Date.now()

		const justAcceptedAutocompletion = thisTime - this._lastCompletionAccept < JUST_ACCEPTED_WINDOW

		this._lastCompletionStart = thisTime
		const didTypingHappenDuringDebounce = await new Promise<boolean>((resolve) =>
			setTimeout(() => {
				resolve(this._lastCompletionStart !== thisTime)
			}, DEBOUNCE_TIME)
		)

		// the editor moved on (or the user typed) while we were waiting - this request is
		// already stale, so don't spend it
		if (didTypingHappenDuringDebounce || token.isCancellationRequested) {
			return []
		}


		// if there are too many pending requests, cancel the oldest one
		let numPending = 0
		let oldestPending: Autocompletion | undefined = undefined
		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].items.values()) {
			if (autocompletion.status === 'pending') {
				numPending += 1
				if (oldestPending === undefined) {
					oldestPending = autocompletion
				}
				if (numPending >= MAX_PENDING_REQUESTS) {
					// cancel the oldest pending request and remove it from cache
					this._autocompletionsOfDocument[docUriStr].delete(oldestPending.id)
					break
				}
			}
		}


		// gather relevant context from the code around the user's selection and definitions
		// const relevantSnippetsList = await this._contextGatheringService.readCachedSnippets(model, position, 3);
		// const relevantSnippetsList = this._contextGatheringService.getCachedSnippets();
		// const relevantSnippets = relevantSnippetsList.map((text) => `${text}`).join('\n-------------------------------\n')
		const relevantContext = ''

		const multilineCompletions = this._settingsService.state.globalSettings.multilineCompletions ?? 'auto'
		const maxPromptTokens = resolveMaxPromptTokens(this._settingsService.state.globalSettings.autocompleteContextTokens)
		const { shouldGenerate, predictionType, llmPrefix, llmSuffix, stopTokens } = getCompletionOptions(prefixAndSuffix, relevantContext, justAcceptedAutocompletion, multilineCompletions, maxPromptTokens)

		if (!shouldGenerate) return []



		// create a new autocompletion and add it to cache
		const newAutocompletion: Autocompletion = {
			id: this._autocompletionId++,
			prefix: prefix, // the actual prefix and suffix
			suffix: suffix,
			llmPrefix: llmPrefix, // the prefix and suffix the llm sees
			llmSuffix: llmSuffix,
			startTime: Date.now(),
			endTime: undefined,
			type: predictionType,
			status: 'pending',
			llmPromise: undefined,
			insertText: '',
			requestId: null,
			_newlineCount: 0,
			firstTokenTime: undefined,
			stoppedEarly: false,
		}

		const featureName: FeatureName = 'Autocomplete'
		const overridesOfModel = this._settingsService.state.overridesOfModel
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName] : undefined

		// Native FIM ("prefix" + "suffix" on a /completions route) is both faster and more
		// accurate, so use it whenever the model has it. Anthropic, OpenAI, Gemini and the
		// rest have no such route and hard-error with "does not support FIM", so they get
		// the few-shot hole filler instead - slower, but it works.
		const supportsNativeFim = !!modelSelection && getModelCapabilities(
			modelSelection.providerName, modelSelection.modelName, overridesOfModel
		).supportsFIM

		// When the model has no native FIM route we render the prompt ourselves using
		// Continue's per-model template, so the model still sees proper hole markers.
		// Continue does exactly this in CompletionStreamer:
		//   llm.supportsFim() ? streamFim(prefix, suffix) : streamComplete(prompt, {raw:true})
		const template = getTemplateForModel(modelSelection?.modelName ?? '')
		const renderedPrompt = supportsNativeFim ? '' : template.template(
			llmPrefix,
			llmSuffix,
			model.uri.path.split('/').pop() ?? '',
			'', // reponame: only used by Continue's multi-file templates, unused here
		)
		const templateStopTokens = supportsNativeFim
			? []
			: [...new Set([...template.stop, ...universalStopTokens(modelSelection?.modelName ?? ''), ...stopTokens])]

		// set parameters of `newAutocompletion` appropriately
		//
		// The promise below is a "there is something worth showing" signal, not a
		// "the request finished" signal. It is resolved either as soon as a filtered
		// partial survives the filters, or when the stream ends. Callers read
		// `insertText` directly, so a later keystroke that hits the cache gets whatever
		// has streamed in since - the suggestion grows instead of restarting.
		newAutocompletion.llmPromise = new Promise((resolve, reject) => {

			let settled = false
			const settle = (fn: () => void) => {
				if (settled) { return }
				settled = true
				fn()
			}

			// Once a partial has been handed over the suggestion is already on screen, so a
			// later failure of the same request must NOT poison the cache entry - that would
			// retract good text the user is looking at.
			const fail = (message: string) => {
				if (settled) { return }
				newAutocompletion.status = 'error'
				settle(() => reject(message))
			}

			// deadline for showing a partial, armed once the first token lands
			let partialTimer: ReturnType<typeof setTimeout> | undefined = undefined

			// Sent as a raw completion, so the reply IS the completion - there is no wrapper
			// tag to unwrap. Kept as a hook because the chat-model path can still narrate.
			const clean = (text: string) => text

			const onText = ({ fullText }: { fullText: string }) => {
				if (settled) { return }
				if (newAutocompletion.status !== 'pending') { return }

				if (newAutocompletion.firstTokenTime === undefined) {
					newAutocompletion.firstTokenTime = Date.now()
					// Measure the partial-show budget from the first byte the model
					// actually produced, not from when the request was issued.
					partialTimer = setTimeout(() => {
						if (!settled && newAutocompletion.insertText) {
							settle(() => resolve(newAutocompletion.insertText))
						}
					}, MAX_TIME_TO_SHOW_PARTIAL)
				}

				const filtered = filterStreamedText(clean(fullText), prefixAndSuffix, newAutocompletion.type, !supportsNativeFim)
				newAutocompletion.insertText = filtered

				// A long stretch of output where nothing at all survives filtering means
				// the model is not writing code - prose, a reflog, a wall of markdown.
				// Nothing later will be showable either, so stop paying for it.
				//
				// Note this deliberately does NOT trigger on "the filtered text did not
				// grow": that is a false positive whenever a chunk is pure whitespace
				// or is entirely chopped off by a trailing filter.
				if (!filtered && fullText.length > GARBAGE_RAW_THRESHOLD) {
					newAutocompletion.stoppedEarly = true
					newAutocompletion.status = 'finished'
					if (newAutocompletion.requestId) {
						this._llmMessageService.abort(newAutocompletion.requestId)
					}
					return
				}

				// Hand over a partial as soon as the first line is *complete* - a newline
				// has arrived behind it. Waiting for that means the retroactive filters
				// (fence unwrapping, preamble removal) have already fired, so we do not
				// flash "Here is the code:" and then replace it a frame later.
				//
				// A genuinely single-line completion never gets a second line, so the
				// partial-show timer is the backstop for that case.
				if (partialTimer !== undefined && filtered && newAutocompletion.type !== 'multi-line-start-on-next-line') {
					if (filtered.includes(_ln)) {
						settle(() => resolve(newAutocompletion.insertText))
					}
				}
			}

			const onFinalMessage = ({ fullText }: { fullText: string }) => {
				if (partialTimer !== undefined) { clearTimeout(partialTimer) }
				newAutocompletion.endTime = Date.now()
				if (newAutocompletion.status !== 'error') {
					newAutocompletion.status = 'finished'
				}
				newAutocompletion.insertText = filterStreamedText(clean(fullText), prefixAndSuffix, newAutocompletion.type, !supportsNativeFim)

				// handle special case for predicting starting on the next line, add a newline character
				if (newAutocompletion.type === 'multi-line-start-on-next-line') {
					newAutocompletion.insertText = _ln + newAutocompletion.insertText
				}

				settle(() => resolve(newAutocompletion.insertText))
			}

			const onError = ({ message }: { message: string }) => {
				if (partialTimer !== undefined) { clearTimeout(partialTimer) }
				newAutocompletion.endTime = Date.now()
				fail(message)
			}

			const onAbort = () => {
				if (partialTimer !== undefined) { clearTimeout(partialTimer) }
				if (settled) { return }
				// an abort before anything was shown is a normal, successful outcome as
				// far as the user is concerned - keep whatever text arrived
				newAutocompletion.status = 'finished'
				settle(() => resolve(newAutocompletion.insertText))
			}

			// everything except the message itself, which differs per transport
			const commonParams = {
				modelSelection,
				modelSelectionOptions,
				overridesOfModel,
				logging: { loggingName: 'Autocomplete' },
				onText,
				onFinalMessage,
				onError,
				onAbort,
			}

			const requestId = supportsNativeFim
				? this._llmMessageService.sendLLMMessage({
					...commonParams,
					messagesType: 'FIMMessage',
					messages: this._convertToLLMMessageService.prepareFIMMessage({
						messages: {
							prefix: llmPrefix,
							suffix: llmSuffix,
							stopTokens: stopTokens,
						}
					}),
				})
				: this._llmMessageService.sendLLMMessage({
					...commonParams,
					messagesType: 'FIMMessage',
					messages: {
						prefix: llmPrefix,
						suffix: llmSuffix,
						// Continue's templates render the model's own FIM tokens around the hole
						// (or a few-shot hole filler for chat models). Sent as a raw
						// completion so no chat wrapper is injected around it.
						rawPrompt: renderedPrompt,
						stopTokens: templateStopTokens,
					},
				})
			newAutocompletion.requestId = requestId

			// backstop for a request that never produces a token or a final message
			setTimeout(() => {
				if (partialTimer !== undefined) { clearTimeout(partialTimer) }
				if (newAutocompletion.status === 'pending') {
					fail('Timeout receiving message to LLM.')
				}
			}, TIMEOUT_TIME)

		})



		// add autocompletion to cache
		this._autocompletionsOfDocument[docUriStr].set(newAutocompletion.id, newAutocompletion)

		// show autocompletion
		try {
			await newAutocompletion.llmPromise

			const autocompletionMatchup: AutocompletionMatchupBounds = { startIdx: 0 }
			const completions = toInlineCompletions({ autocompletionMatchup, autocompletion: newAutocompletion, prefixAndSuffix, position })
			return this._track(completions, newAutocompletion.id, docUriStr)

		} catch (e) {
			this._autocompletionsOfDocument[docUriStr].delete(newAutocompletion.id)
			return []
		}

	}

	/**
	 * Tag the returned items with the id of the cache entry that produced them, so the
	 * accept callback can find it. The editor hands the very same objects back to us.
	 */
	private _track(completions: InlineCompletion[], autocompleteId: number, docUriStr: string): TrackedInlineCompletion[] {
		return completions.map(c => ({ ...c, autocompleteId, documentUri: docUriStr }))
	}

	/**
	 * Called when the user accepts a suggestion. Two things depend on this:
	 *  - `_lastCompletionAccept` unlocks the "continue on the next line" prediction, which
	 *    is what makes accepting a line chain into a block instead of going quiet.
	 *  - the accepted entry is evicted, so the next keystroke starts from a clean cache.
	 */
	private _onAutocompletionAccepted(completions: unknown, item: unknown): void {
		this._lastCompletionAccept = Date.now()

		const tracked = item as Partial<TrackedInlineCompletion> | undefined
		if (tracked?.autocompleteId === undefined || tracked?.documentUri === undefined) { return; }

		this._autocompletionsOfDocument[tracked.documentUri]?.delete(tracked.autocompleteId)
	}

	constructor(
		@ILanguageFeaturesService private _langFeatureService: ILanguageFeaturesService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessageService: IConvertToLLMMessageService
		// @IContextGatheringService private readonly _contextGatheringService: IContextGatheringService,
	) {
		super()

		this._register(this._langFeatureService.inlineCompletionsProvider.register('*', {
			provideInlineCompletions: async (model, position, context, token) => {
				const items = await this._provideInlineCompletionItems(model, position, token)
				return { items: items, }
			},
			handleItemDidShow: (_completions: any, _item: any, _updatedInsertText: string) => {
				// no-op
			},
			handleEndOfLifetime: (completions: any, item: any, reason: any) => {
				// The accept signal we were missing. Without this the
				// `multi-line-start-on-next-line` path was unreachable, because
				// `_lastCompletionAccept` was never written, and accepted completions
				// were never evicted from the cache.
				if (reason?.kind === InlineCompletionEndOfLifeReasonKind.Accepted) {
					this._onAutocompletionAccepted(completions, item)
				}
			},
			disposeInlineCompletions: (_completions: any) => {
				// no-op
			},
		}))
	}


}

registerWorkbenchContribution2(AutocompleteService.ID, AutocompleteService, WorkbenchPhase.BlockRestore);


