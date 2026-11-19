/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { LoopholeCliFormField, LoopholeCliFormOption, LoopholeCliFormRequest } from '../../../../common/loopholeCliTypes.js';
import type { CliToolState } from '../../../../common/sendLLMMessageTypes.js';

export type FormValue = string | number | boolean | string[];
export type FormAnswer = Record<string, FormValue>;

export type FormInputState = {
	choices: Record<string, FormValue | undefined>;
	texts: Record<string, string>;
	customOpen: Record<string, boolean>;
};

export const emptyInputState = (): FormInputState => ({ choices: {}, texts: {}, customOpen: {} });

export type FieldState = {
	field: LoopholeCliFormField;
	value: FormValue | undefined;
	problem: string | undefined;
};

export type FormLayout = {
	fields: FieldState[];
	answer: FormAnswer;
	ready: boolean;
};

export type SummaryRow = { label: string; values: string[] };

type WhenCondition = { key: string; op: 'eq' | 'neq'; value: string | number | boolean };
type StringFormat = 'email' | 'uri' | 'date' | 'date-time';

export const optionsOf = (field: LoopholeCliFormField): LoopholeCliFormOption[] => {
	const options = (field as { options?: unknown }).options;
	return Array.isArray(options)
		? options.filter((option): option is LoopholeCliFormOption => !!option && typeof option.value === 'string' && typeof option.label === 'string')
		: [];
};

export const allowsCustom = (field: LoopholeCliFormField): boolean => (field as { custom?: unknown }).custom === true;

export const isRequired = (field: LoopholeCliFormField): boolean => (field as { required?: unknown }).required === true;

const whenOf = (field: LoopholeCliFormField): WhenCondition[] => {
	const when = (field as { when?: unknown }).when;
	return Array.isArray(when) ? when as WhenCondition[] : [];
};

const matches = (when: WhenCondition, value: FormValue | undefined): boolean => {
	if (value === undefined) return false;
	const hit = Array.isArray(value) ? value.some((item) => item === when.value) : value === when.value;
	return when.op === 'eq' ? hit : !hit;
};

export const valueOf = (field: LoopholeCliFormField, input: FormInputState): FormValue | undefined => {
	const key = field.key;
	if (field.type === 'external') return input.choices[key] === true ? true : undefined;
	if (field.type === 'boolean') {
		const chosen = input.choices[key];
		return typeof chosen === 'boolean' ? chosen : field.default;
	}
	if (field.type === 'number' || field.type === 'integer') {
		const text = input.texts[key];
		if (text === undefined) return field.default;
		return text.trim() === '' ? undefined : Number(text.trim());
	}
	if (field.type === 'multiselect') {
		const chosen = input.choices[key];
		const picked = Array.isArray(chosen) ? chosen : (field.default ?? []);
		const custom = input.customOpen[key] ? (input.texts[key] ?? '').trim() : '';
		return custom ? [...picked, custom] : picked;
	}
	if (optionsOf(field).length > 0) {
		if (input.customOpen[key]) {
			const text = (input.texts[key] ?? '').trim();
			return text === '' ? undefined : text;
		}
		const chosen = input.choices[key];
		return typeof chosen === 'string' ? chosen : field.default;
	}
	const text = input.texts[key];
	return text === undefined ? field.default : text;
};

const isDate = (value: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const fieldProblem = (field: LoopholeCliFormField, value: FormValue | undefined): string | undefined => {
	if (field.type === 'external') return undefined;
	if (value === undefined) return isRequired(field) ? 'Required' : undefined;
	if (field.type === 'string') {
		if (typeof value !== 'string') return 'Enter text';
		if (field.minLength !== undefined && value.length < field.minLength) return `At least ${field.minLength} characters`;
		if (field.maxLength !== undefined && value.length > field.maxLength) return `At most ${field.maxLength} characters`;
		if (field.pattern !== undefined) {
			try {
				if (!new RegExp(field.pattern).test(value)) return 'Doesn’t match the expected format';
			}
			catch {
				return 'Doesn’t match the expected format';
			}
		}
		const format = (field as { format?: StringFormat }).format;
		if (format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email';
		if (format === 'uri' && !URL.canParse(value)) return 'Enter a valid URL';
		if (format === 'date' && !isDate(value)) return 'Enter a date like 2026-01-31';
		if (format === 'date-time' && Number.isNaN(new Date(value).getTime())) return 'Enter a valid date and time';
		const options = optionsOf(field);
		if (options.length > 0 && !allowsCustom(field) && !options.some((option) => option.value === value)) return 'Pick one of the options';
		return undefined;
	}
	if (field.type === 'number' || field.type === 'integer') {
		if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number';
		if (field.type === 'integer' && !Number.isInteger(value)) return 'Enter a whole number';
		if (field.minimum !== undefined && value < field.minimum) return `Must be at least ${field.minimum}`;
		if (field.maximum !== undefined && value > field.maximum) return `Must be at most ${field.maximum}`;
		return undefined;
	}
	if (field.type === 'boolean') return typeof value === 'boolean' ? undefined : 'Choose yes or no';
	if (field.type === 'multiselect') {
		if (!Array.isArray(value)) return 'Choose at least one';
		if (field.minItems !== undefined && value.length < field.minItems) return `Choose at least ${field.minItems}`;
		if (field.maxItems !== undefined && value.length > field.maxItems) return `Choose at most ${field.maxItems}`;
		if (!allowsCustom(field) && value.some((item) => !field.options.some((option) => option.value === item))) return 'Pick from the options';
	}
	return undefined;
};

const normalize = (value: FormValue | undefined): FormValue | undefined => {
	if (value === undefined) return undefined;
	if (typeof value === 'string') return value.trim() === '' ? undefined : value;
	if (Array.isArray(value)) return value.length === 0 ? undefined : value;
	return value;
};

export const layoutForm = (form: LoopholeCliFormRequest, input: FormInputState): FormLayout => {
	const answer: FormAnswer = {};
	const fields: FieldState[] = [];
	let ready = true;
	for (const field of form.fields) {
		if (field.type === 'external') {
			const value = valueOf(field, input);
			if (value === true) answer[field.key] = true;
			else ready = false;
			fields.push({ field, value, problem: undefined });
			continue;
		}
		if (!whenOf(field).every((when) => matches(when, answer[when.key]))) continue;
		const value = normalize(valueOf(field, input));
		if (value !== undefined) answer[field.key] = value;
		const problem = fieldProblem(field, value);
		if (problem) ready = false;
		if ((field as { hidden?: unknown }).hidden !== true) fields.push({ field, value, problem });
	}
	return { fields, answer, ready };
};

export const defaultInputState = (form: LoopholeCliFormRequest): FormInputState => {
	const input = emptyInputState();
	for (const field of form.fields) {
		if (field.type === 'number' || field.type === 'integer') {
			if (field.default !== undefined) input.texts[field.key] = String(field.default);
		}
	}
	return input;
};

export const isQuestionForm = (form: LoopholeCliFormRequest): boolean => form.metadata?.kind === 'question';

export const formToolIdOf = (form: LoopholeCliFormRequest): string | undefined => {
	const tool = form.metadata?.tool;
	if (!tool || typeof tool !== 'object') return undefined;
	const id = (tool as { id?: unknown }).id;
	return typeof id === 'string' ? id : undefined;
};

export const fieldHeading = (form: LoopholeCliFormRequest, field: LoopholeCliFormField): { label: string; tag?: string; helper?: string } => {
	const title = typeof field.title === 'string' && field.title.length > 0 ? field.title : undefined;
	const description = typeof field.description === 'string' && field.description.length > 0 ? field.description : undefined;
	if (isQuestionForm(form) && description) return { label: description, tag: title };
	return { label: title ?? field.key, helper: description };
};

export const labelsOf = (field: LoopholeCliFormField, value: FormValue | undefined): string[] => {
	const options = optionsOf(field);
	const labelFor = (raw: string) => options.find((option) => option.value === raw)?.label ?? raw;
	if (Array.isArray(value)) return value.map(labelFor);
	if (typeof value === 'boolean') return [value ? 'Yes' : 'No'];
	if (typeof value === 'number') return [String(value)];
	if (typeof value === 'string') return [labelFor(value)];
	return [];
};

export const summaryOfAnswer = (form: LoopholeCliFormRequest, answer: FormAnswer): SummaryRow[] => {
	const rows: SummaryRow[] = [];
	for (const field of form.fields) {
		if (field.type === 'external') continue;
		const value = answer[field.key];
		if (value === undefined) continue;
		rows.push({ label: fieldHeading(form, field).label, values: labelsOf(field, value) });
	}
	return rows;
};

export const isQuestionToolName = (name: string): boolean => name.toLowerCase() === 'question';

export const rowsOfQuestionTool = (tool: CliToolState): SummaryRow[] | undefined => {
	const questions = tool.input?.questions;
	const answers = tool.metadata?.answers;
	if (Array.isArray(questions) && Array.isArray(answers)) {
		return questions.map((question, index) => {
			const prompt = (question && typeof question === 'object') ? question as { question?: unknown; header?: unknown } : {};
			const label = typeof prompt.question === 'string' ? prompt.question : typeof prompt.header === 'string' ? prompt.header : `Question ${index + 1}`;
			const given = answers[index];
			return { label, values: Array.isArray(given) ? given.filter((item): item is string => typeof item === 'string') : [] };
		});
	}
	const text = tool.outputText ?? '';
	const rows: SummaryRow[] = [];
	for (const match of text.matchAll(/"([^"]*)"="([^"]*)"/g)) rows.push({ label: match[1], values: [match[2]] });
	return rows.length > 0 ? rows : undefined;
};

type ToolRef = { id: string; name: string; status: string };

export const assignForms = (tools: ToolRef[], forms: LoopholeCliFormRequest[], threadSessionID: string | undefined): { byTool: Map<string, LoopholeCliFormRequest>; loose: LoopholeCliFormRequest[] } => {
	const byTool = new Map<string, LoopholeCliFormRequest>();
	const loose: LoopholeCliFormRequest[] = [];
	const questionTools = tools.filter((tool) => isQuestionToolName(tool.name));
	const rest: LoopholeCliFormRequest[] = [];
	for (const form of forms) {
		const wanted = formToolIdOf(form);
		const exact = wanted ? questionTools.find((tool) => tool.id === wanted && !byTool.has(tool.id)) : undefined;
		if (exact) byTool.set(exact.id, form);
		else rest.push(form);
	}
	for (const form of rest) {
		const mine = threadSessionID !== undefined && form.sessionID === threadSessionID && isQuestionForm(form);
		const waiting = mine
			? [...questionTools].reverse().find((tool) => (tool.status === 'running' || tool.status === 'input') && !byTool.has(tool.id))
			: undefined;
		if (waiting) byTool.set(waiting.id, form);
		else loose.push(form);
	}
	return { byTool, loose };
};
