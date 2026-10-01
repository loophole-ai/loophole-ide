/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *------------------------------------------------------------------------------------*/

/**
 * Per-model FIM ("fill-in-the-middle") prompt templates.
 *
 * Extracted programmatically from Continue's
 * core/autocomplete/templating/AutocompleteTemplate.ts rather than retyped, because several
 * of these tokens contain characters that are easy to silently corrupt - deepseek uses
 * FULLWIDTH vertical bars (U+FF5C) and U+2581 lower one-eighth blocks, ByteDance's seed
 * uses U+2581. Normalise either and the model degrades to noise without any error.
 *
 * Why this exists: when a model has no native FIM route we must render the hole markers
 * ourselves. Handing a /completions endpoint a bare prefix + suffix gives the model no
 * indication of where the hole is, and the output is unusable.
 *
 * Deviations from Continue, all deliberate:
 *  - No Handlebars. The templates use {{{prefix}}}, {{{suffix}}}, {{{filename}}},
 *    {{{reponame}}} and {{{language}}}, substituted literally below.
 *  - No multi-file variants, which need a snippet payload (imports, definitions, open files)
 *    interleaved into the prompt. Loophole has no such system yet, so the single-file
 *    template is used. Upgrading later is a drop-in change.
 *  - CodeGeeX is omitted. Continue builds its prompt in code rather than from a literal, and
 *    guessing at that would risk shipping a wrong template.
 *
 * This module has no imports so it can be unit tested directly.
 */

/** A rendered FIM prompt: how to build it, and where to stop generating. */
export type FimTemplate = {
	/** Build the final prompt string. */
	template: (
		prefix: string,
		suffix: string,
		filename?: string,
		reponame?: string,
		language?: string,
	) => string
	/** Sent to the API as `stop` so generation ends at the hole boundary. */
	stop: string[]
}

/**
 * Substitute placeholders literally.
 *
 * split/join rather than String.replace, so a value containing $& or $1 is inserted
 * verbatim instead of being treated as a replacement pattern.
 */
const render = (tpl: string, prefix: string, suffix: string, filename: string, reponame: string, language: string): string => tpl
	.split('{{{prefix}}}').join(prefix)
	.split('{{{suffix}}}').join(suffix)
	.split('{{{filename}}}').join(filename)
	.split('{{{reponame}}}').join(reponame)
	.split('{{{language}}}').join(language)

const fromLiteral = (tpl: string, stops: string[]): FimTemplate => ({
	template: (prefix, suffix, filename = '', reponame = '', language = '') =>
		render(tpl, prefix, suffix, filename, reponame, language),
	stop: stops,
})

const stableCodeFimTemplate: FimTemplate = fromLiteral(
	"<fim_prefix>{{{prefix}}}<fim_suffix>{{{suffix}}}<fim_middle>",
	["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>", "<|endoftext|>", "</fim_middle>", "</code>"],
)

const qwenCoderFimTemplate: FimTemplate = fromLiteral(
	"<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	["<|endoftext|>", "<|fim_prefix|>", "<|fim_middle|>", "<|fim_suffix|>", "<|fim_pad|>", "<|repo_name|>", "<|file_sep|>", "<|im_start|>", "<|im_end|>"],
)

const granite4FimTemplate: FimTemplate = fromLiteral(
	"<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	["<|end_of_text|>", "<|fim_prefix|>", "<|fim_middle|>", "<|fim_suffix|>", "<|fim_pad|>"],
)

const seedCoderFimTemplate: FimTemplate = fromLiteral(
	"<[fim-prefix]>{{{prefix}}}<[fim-suffix]>{{{suffix}}}<[fim-middle]>",
	["<[end▁of▁sentence]>", "<[fim-prefix]>", "<[fim-middle]>", "<[fim-suffix]>", "<[PAD▁TOKEN]>", "<[SEP▁TOKEN]>", "<[begin▁of▁sentence]>"],
)

const codestralFimTemplate: FimTemplate = fromLiteral(
	"[SUFFIX]{{{suffix}}}[PREFIX]{{{prefix}}}",
	["[PREFIX]", "[SUFFIX]"],
)

const codegemmaFimTemplate: FimTemplate = fromLiteral(
	"<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	["<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "<|file_separator|>", "<end_of_turn>", "<eos>"],
)

const codeLlamaFimTemplate: FimTemplate = fromLiteral(
	"<PRE> {{{prefix}}} <SUF>{{{suffix}}} <MID>",
	["<PRE>", "<SUF>", "<MID>", "<EOT>"],
)

const deepseekFimTemplate: FimTemplate = fromLiteral(
	"<｜fim▁begin｜>{{{prefix}}}<｜fim▁hole｜>{{{suffix}}}<｜fim▁end｜>",
	["<｜fim▁begin｜>", "<｜fim▁hole｜>", "<｜fim▁end｜>", "//", "<｜end▁of▁sentence｜>"],
)

/**
 * Few-shot hole filler for chat models with no FIM route at all (gpt, claude).
 *
 * Body copied verbatim from Continue's holeFillerTemplate, itself from
 * https://github.com/VictorTaelin/AI-scripts. The prompt deliberately ends with an
 * UNCLOSED <COMPLETION> tag so the model's continuation lands inside it.
 */
const holeFillerTemplate: FimTemplate = {

  template: (prefix: string, suffix: string) => {
    // From https://github.com/VictorTaelin/AI-scripts
    const SYSTEM_MSG = `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'. Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed.  All completions MUST be truthful, accurate, well-written and correct.

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

print sum_list([1, 2, 3])
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>  total += x</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
// data Tree a = Node (Tree a) (Tree a) | Leaf a

// sum :: Tree Int -> Int
// sum (Node lft rgt) = sum lft + sum rgt
// sum (Leaf val)     = val

// convert to TypeScript:
{{FILL_HERE}}
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>type Tree<T>
  = {$:"Node", lft: Tree<T>, rgt: Tree<T>}
  | {$:"Leaf", val: T};

function sum(tree: Tree<number>): number {
  switch (tree.$) {
    case "Node":
      return sum(tree.lft) + sum(tree.rgt);
    case "Leaf":
      return tree.val;
  }
}</COMPLETION>

## EXAMPLE QUERY:

The 5th {{FILL_HERE}} is Jupiter.

## CORRECT COMPLETION:

<COMPLETION>planet from the Sun</COMPLETION>

## EXAMPLE QUERY:

function hypothenuse(a, b) {
  return Math.sqrt({{FILL_HERE}}b ** 2);
}

## CORRECT COMPLETION:

<COMPLETION>a ** 2 + </COMPLETION>`;

    const fullPrompt =
      SYSTEM_MSG +
      `\n\n<QUERY>\n${prefix}{{FILL_HERE}}${suffix}\n</QUERY>\nTASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.\n<COMPLETION>`;
    return fullPrompt;
  },
	stop: ['</COMPLETION>'],

}

/**
 * Pick a template by model name.
 *
 * Order mirrors Continue's getTemplateForModel and matters: specific patterns
 * (qwen + coder) must be tested before broad families (qwen, stable), or qwen2.5-coder
 * would silently match the generic stable-code template.
 */
export const getTemplateForModel = (model: string): FimTemplate => {
	const name = model.toLowerCase()

	if (name.includes('granite') && name.includes('4')) { return granite4FimTemplate }
	if (name.includes('seed') && name.includes('coder')) { return seedCoderFimTemplate }

	if (name.includes('qwen') && name.includes('coder')) { return qwenCoderFimTemplate }

	if (
		name.includes('starcoder') ||
		name.includes('star-coder') ||
		name.includes('starchat') ||
		name.includes('octocoder') ||
		name.includes('stable') ||
		name.includes('codeqwen') ||
		name.includes('qwen')
	) { return stableCodeFimTemplate }

	if (name.includes('codestral')) { return codestralFimTemplate }
	if (name.includes('codegemma')) { return codegemmaFimTemplate }
	if (name.includes('codellama')) { return codeLlamaFimTemplate }
	if (name.includes('deepseek')) { return deepseekFimTemplate }

	// Chat models have no FIM route, so they get the few-shot hole filler instead.
	if (
		name.includes('gpt') ||
		name.includes('davinci-002') ||
		name.includes('claude') ||
		name.includes('granite3') ||
		name.includes('granite-3')
	) { return holeFillerTemplate }

	return stableCodeFimTemplate
}

/**
 * Extra stop sequences every provider needs regardless of model.
 * Mirrors Continue's getStopTokens.
 */
export const universalStopTokens = (modelName: string): string[] => {
	const stops = ['</CODE>', '</code>', '#- coding: utf-8']
	if (modelName.toLowerCase().includes('starcoder2')) { stops.push('<file_sep>') }
	return stops
}

/** True when the model is a chat model, which means the few-shot filler is the only option. */
export const isChatOnlyModel = (model: string): boolean => {
	const name = model.toLowerCase()
	return name.includes('gpt') || name.includes('davinci-002') || name.includes('claude')
		|| name.includes('granite3') || name.includes('granite-3')
}
