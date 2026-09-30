/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *------------------------------------------------------------------------------------*/

/**
 * Few-shot autocomplete for models with no FIM ("fill-in-the-middle") endpoint.
 *
 * Anthropic, OpenAI, Gemini, DeepSeek, Groq, Bedrock, Vertex and Azure all expose chat
 * completions only. Their `/completions` routes either reject a `suffix` parameter or
 * silently ignore it, so they cannot complete the middle of a file - the one thing an
 * inline suggestion has to do.
 *
 * The workaround is to pretend it is a chat model that has been asked to fill a hole. The
 * prompt is a handful of worked examples followed by the real file with a `{{FILL_HERE}}`
 * marker where the cursor is, and it ends with an *unclosed* `<COMPLETION>` tag so the
 * model's continuation lands inside the tag. `</COMPLETION>` is the stop token.
 *
 * Adapted from Continue's `holeFillerTemplate`
 * (core/autocomplete/templating/AutocompleteTemplate.ts), itself from
 * https://github.com/VictorTaelin/AI-scripts.
 *
 * Trade-off, stated plainly: this sends ~5x the tokens of a real FIM request on every
 * keystroke, because the examples are resent each time, and a chat model is less
 * predictable than a completion model. It is still far better than no autocomplete, which
 * is the alternative today. Native FIM is always preferred when the model has it.
 */

/** Terminates generation. Matches an entry in autocompleteFilters' stop list. */
export const HOLE_FILLER_STOP = '</COMPLETION>'

/**
 * Three examples rather than Continue's five, because this prompt is resent on every
 * keystroke and the token cost is paid every time. They cover the three shapes we
 * actually see: a full indented body, a single indented line, and a fill in the middle
 * of an expression.
 *
 * The Haskell-to-TypeScript example from Continue is omitted as too long for its value,
 * and the "5th planet" example is omitted on purpose - it demonstrates prose as a valid
 * completion, which is exactly the behaviour we do not want to teach.
 */
const SYSTEM_MSG = `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'. Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed. All completions MUST be truthful, accurate, well-written and correct.

## EXAMPLE QUERY:

<QUERY>
function sum_evens(lim) {
  var sum = 0;
  for (var i = 0; i < lim; ++i) {
    {{FILL_HERE}}
  }
  return sum;
}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole.

## CORRECT COMPLETION

<COMPLETION>if (i % 2 === 0) {
      sum += i;
    }</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
def sum_list(lst):
  total = 0
  for x in lst:
  {{FILL_HERE}}
  return total
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>  total += x</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
function hypothenuse(a, b) {
  return Math.sqrt({{FILL_HERE}}b ** 2);
}
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>a ** 2 + </COMPLETION>`

/**
 * Build the prompt for one request. The caller is responsible for having already sized
 * `prefix` and `suffix` to the token budget.
 */
export const buildHoleFillerPrompt = (prefix: string, suffix: string, ln: string): string => {
	return SYSTEM_MSG
		+ ln + ln
		+ '<QUERY>' + ln
		+ prefix + '{{FILL_HERE}}' + suffix + ln
		+ '</QUERY>' + ln
		+ 'TASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.' + ln
		// deliberately unclosed: the model's continuation becomes the tag's contents
		+ '<COMPLETION>'
}

/**
 * How far into the reply we will still treat a `<COMPLETION>` as a tag rather than as
 * text. A chat model that announces itself does so briefly; a literal `<COMPLETION>`
 * appearing further into a long completion is far more likely to be part of the code the
 * model is writing, and cutting there would truncate real output.
 */
const OPEN_TAG_SEARCH_WINDOW = 200

/**
 * Characters that appear in essentially all code and in essentially no English sentence.
 * Used only to tell "this reply is prose" from "this reply is a short completion", never
 * to validate code.
 */
const CODE_STRUCTURE_CHARS = /[=(){}\[\]<>+\-*/|&$#@^:;]/

/**
 * A completion model cannot refuse, but a chat model can - and a refusal offered as ghost
 * text is one keystroke from being pasted into the user's source. Refusals are short and
 * formulaic, so match them explicitly.
 */
const REFUSAL_PATTERNS: readonly RegExp[] = [
	/^i (cannot|can't|am unable|'m unable|do not|don't)\b/i,
	/^i (apolog|apologize|apologise)\w*/i,
	/^(sorry|unfortunately)\b/i,
	/^as an ai\b/i,
	/^(there (is|are) no|not enough|insufficient)\b/i,
	/^(i (need|require)|please provide|you (must|need to) (provide|supply))\b/i,
]

/**
 * Is this reply prose rather than a completion?
 *
 * Deliberately conservative: a short reply is kept even if it has no code characters,
 * because `total`, `}` and `return 1` are all legitimate completions. We only reject when
 * there is nothing code-shaped anywhere AND it reads like a sentence.
 */
const looksLikeProse = (text: string): boolean => {
	const trimmed = text.trim()
	if (!trimmed) { return true }
	if (REFUSAL_PATTERNS.some(p => p.test(trimmed))) { return true }

	const lines = trimmed.split(/\r?\n/).filter(l => l.trim() !== '')
	if (lines.length === 0) { return true }
	if (lines.some(l => CODE_STRUCTURE_CHARS.test(l))) { return false }

	// no code characters on any line - only call it prose if it also reads as a sentence
	return trimmed.split(/\s+/).length > 3
}

/**
 * Fragments that only ever appear in THIS prompt, never in real code.
 *
 * If any of these turn up in a reply, the model is not filling the hole - it is reading the
 * instructions and talking about them. That is exactly what happens on an empty file, where
 * the query is a bare `{{FILL_HERE}}` with nothing around it and the model decides it has
 * been given an impossible task. The reply is then a complaint about the prompt, not code.
 *
 * A completion containing any of these is discarded outright rather than trimmed, because
 * once the model has lost the plot the rest of the reply is not worth showing either.
 */
const PROMPT_ECHO_MARKERS: readonly string[] = [
	'<QUERY>',
	'</QUERY>',
	'{{FILL_HERE}}',
	'{{HOLE_NAME}}',
	'## EXAMPLE QUERY',
	'## CORRECT COMPLETION',
	'You are a HOLE FILLER',
	'TASK: Fill the',
]

const isPromptEcho = (text: string): boolean => {
	const head = text.slice(0, 600)
	return PROMPT_ECHO_MARKERS.some(marker => head.includes(marker))
}

/**
 * Pull the completion out of the model's reply.
 *
 * Because the prompt ends with an unclosed tag, the normal case needs no work at all - the
 * text arrives already inside the tag. These are the defensive cases, because a chat model
 * is not as obedient as a completion model and the usual failure is chatty rather than
 * structural.
 *
 * Returns '' when the reply is clearly not code, so the caller shows no suggestion rather
 * than offering prose to be tabbed into the file.
 */
export const extractHoleFillerCompletion = (raw: string): string => {
	if (!raw) { return '' }

	// the model is answering about the prompt, not filling the hole
	if (isPromptEcho(raw)) { return '' }

	let text = raw

	// The model opened the tag itself - it should not have, the prompt left it open. This
	// happens when it announces itself first ("Sure! Here you go:") and only then complies.
	// Take the last such tag inside the window: a chatty reply often names the tag in
	// passing before settling on it.
	const window = text.slice(0, OPEN_TAG_SEARCH_WINDOW)
	const openIdx = window.lastIndexOf('<COMPLETION>')
	if (openIdx !== -1) {
		text = text.slice(openIdx + '<COMPLETION>'.length)
	} else if (looksLikeProse(text)) {
		// it ignored the task outright - offering this would be worse than offering nothing
		return ''
	}

	// it closed the tag - take only what came before. (This is also the stop token, so in
	// the normal streaming case this branch never runs.)
	const closeIdx = text.indexOf(HOLE_FILLER_STOP)
	if (closeIdx !== -1) {
		text = text.slice(0, closeIdx)
	}

	// it emitted a markdown fence instead of using the tag
	const fenceIdx = text.indexOf('```')
	if (fenceIdx !== -1) { text = text.slice(0, fenceIdx) }

	// Re-check: the slice above can expose a refusal that the tag wrapped.
	if (looksLikeProse(text)) { return '' }

	// NOTE: leading whitespace is deliberately left alone. The examples in the prompt show
	// the completion indented relative to the hole, and that indentation is real - it is
	// stripped again only if the caller decides the cursor already supplies it. An earlier
	// version trimmed it here and every block came out flush-left.
	return text
}
