/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useAccessor, useChatThreadsState, useCliForms } from '../util/services.js';
import type { LoopholeCliFormField, LoopholeCliFormOption, LoopholeCliFormRequest } from '../../../../../common/loopholeCliTypes.js';
import type { CliFormRequest } from '../../../../../../workbench/contrib/void/common/sendLLMMessageTypes.js';

type FieldType = LoopholeCliFormField['type'];
const isFieldId = (field: LoopholeCliFormField, kind: FieldType) => field.type === kind;

const asOptions = (options: LoopholeCliFormOption[] | undefined): LoopholeCliFormOption[] =>
	Array.isArray(options) ? options.filter((o): o is LoopholeCliFormOption => !!o && typeof o.value === 'string' && typeof o.label === 'string') : [];

const fieldKey = (key: string) => `form-field-${key}`;

const optionValuesOf = (field: LoopholeCliFormField): Set<string> => new Set(asOptions('options' in field ? (field as { options?: LoopholeCliFormOption[] }).options : undefined).map((o) => o.value));

const QuestionItem = ({ field, answer, onToggle, onText }: {
	field: LoopholeCliFormField;
	answer: unknown;
	onToggle: (key: string, value: string) => void;
	onText: (key: string, text: string) => void;
}) => {
	const id = fieldKey(field.key);
	const options = asOptions('options' in field ? (field as { options?: LoopholeCliFormOption[] }).options : undefined);
	const checked = (value: string) => {
		const a = answer;
		if (Array.isArray(a)) return a.includes(value);
		return a === value;
	};
	void checked;

	const title = typeof field.title === 'string' && field.title.length > 0 ? field.title : field.key;
	const helper = typeof field.description === 'string' && field.description.length > 0 ? field.description : undefined;

	// Multiselect questions present as `type: "multiselect"`.
	if (isFieldId(field, 'multiselect')) {
		const selected = Array.isArray(answer) ? (answer as string[]) : [];
		const customValue = selected.find((v) => !options.some((o) => o.value === v)) ?? '';
		return <div className='flex flex-col gap-1'>
			<div className='text-xs font-medium text-loophole-fg-1'>{title}{field.required ? <span className='text-red-400'> *</span> : null}</div>
			{helper && <div className='text-[11px] text-loophole-fg-4'>{helper}</div>}
			<div className='flex flex-col gap-0.5 mt-0.5'>
				{options.map((option) => (
					<label key={option.value} htmlFor={`${id}-${option.value}`} className='flex items-start gap-1.5 cursor-pointer rounded px-1 py-0.5 hover:bg-loophole-bg-1'>
						<input
							id={`${id}-${option.value}`}
							type='checkbox'
							className='mt-[3px]'
							checked={selected.includes(option.value)}
							onChange={() => onToggle(field.key, option.value)}
						/>
						<span className='flex flex-col min-w-0'>
							<span className='text-xs text-loophole-fg-1'>{option.label}</span>
							{option.description && <span className='text-[11px] text-loophole-fg-4'>{option.description}</span>}
						</span>
					</label>
				))}
			</div>
			{'custom' in field && field.custom ? <input
				type='text'
				className='mt-1 w-full text-xs bg-loophole-bg-1 border border-loophole-border-3 rounded p-1.5 text-loophole-fg-1 placeholder:text-loophole-fg-5 outline-none focus:border-[var(--vscode-focusBorder)]'
				placeholder='Something else...'
				value={customValue}
				onChange={(e) => onText(field.key, e.target.value)}
			/> : null}
		</div>;
	}

	// String questions with options render as radio choices.
	if (isFieldId(field, 'string') && options.length > 0) {
		const value = typeof answer === 'string' ? answer : undefined;
		return <div className='flex flex-col gap-1'>
			<div className='text-xs font-medium text-loophole-fg-1'>{title}{field.required ? <span className='text-red-400'> *</span> : null}</div>
			{helper && <div className='text-[11px] text-loophole-fg-4'>{helper}</div>}
			<div className='flex flex-col gap-0.5 mt-0.5'>
				{options.map((option) => (
					<label key={option.value} htmlFor={`${id}-${option.value}`} className='flex items-start gap-1.5 cursor-pointer rounded px-1 py-0.5 hover:bg-loophole-bg-1'>
						<input
							id={`${id}-${option.value}`}
							type='radio'
							name={id}
							className='mt-[3px]'
							checked={value === option.value}
							onChange={() => onToggle(field.key, option.value)}
						/>
						<span className='flex flex-col min-w-0'>
							<span className='text-xs text-loophole-fg-1'>{option.label}</span>
							{option.description && <span className='text-[11px] text-loophole-fg-4'>{option.description}</span>}
						</span>
					</label>
				))}
			</div>
			{field.custom ? <textarea
				className='mt-1 w-full text-xs bg-loophole-bg-1 border border-loophole-border-3 rounded p-1.5 text-loophole-fg-1 placeholder:text-loophole-fg-5 outline-none focus:border-[var(--vscode-focusBorder)] resize-y min-h-[40px]'
				placeholder='Something else...'
				value={value && !options.some((o) => o.value === value) ? value : ''}
				onChange={(e) => onText(field.key, e.target.value)}
			/> : null}
		</div>;
	}

	// External URL questions point the user at a link.
	if (isFieldId(field, 'external')) {
		return <div className='flex flex-col gap-1'>
			<div className='text-xs font-medium text-loophole-fg-1'>{title}</div>
			{helper && <div className='text-[11px] text-loophole-fg-4'>{helper}</div>}
			<a href={field.url} target='_blank' rel='noreferrer noopener' className='text-xs text-[var(--vscode-textLink-foreground)] hover:underline break-all'>{field.url}</a>
		</div>;
	}

	// Boolean is a simple toggle other than radio choices.
	if (isFieldId(field, 'boolean')) {
		const value = typeof answer === 'boolean' ? answer : !!field.default;
		return <div className='flex flex-col gap-1'>
			<div className='text-xs font-medium text-loophole-fg-1'>{title}</div>
			{helper && <div className='text-[11px] text-loophole-fg-4'>{helper}</div>}
			<label className='flex items-center gap-1.5 cursor-pointer'>
				<input type='checkbox' className='mt-[1px]' checked={value} onChange={(e) => onText(field.key, String(e.target.checked))} />
				<span className='text-xs text-loophole-fg-1'>{value ? 'Yes' : 'No'}</span>
			</label>
		</div>;
	}

	// Plain text fallback.
	return <div className='flex flex-col gap-1'>
		<div className='text-xs font-medium text-loophole-fg-1'>{title}{field.required ? <span className='text-red-400'> *</span> : null}</div>
		{helper && <div className='text-[11px] text-loophole-fg-4'>{helper}</div>}
		<textarea
			className='w-full text-xs bg-loophole-bg-1 border border-loophole-border-3 rounded p-1.5 text-loophole-fg-1 placeholder:text-loophole-fg-5 outline-none focus:border-[var(--vscode-focusBorder)] min-h-[64px] resize-y'
			placeholder={('placeholder' in field && field.placeholder) ? field.placeholder : 'Your answer'}
			value={typeof answer === 'string' ? answer : ''}
			onChange={(e) => onText(field.key, e.target.value)}
		/>
	</div>;
};

const QuestionItemView = QuestionItem;

// Questionnaire card. Renders each pending form asked by the CLI (Form.Info)
// and posts answers via POST /api/session/:id/form/:formID/reply.
export const CliQuestionCard = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const cliService = accessor.get('ILoopholeCliService');
	const threadsState = useChatThreadsState();
	const forms = useCliForms(threadId);
	const sessionID = threadsState.allThreads[threadId]?.state.cliSessionId;
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Local answer state keyed by field key.
	const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});

	if (!sessionID || forms.length === 0) return null;

	const setAnswer = (formID: string, key: string, value: unknown) => {
		setAnswers((prev) => ({ ...prev, [formID]: { ...(prev[formID] ?? {}), [key]: value } }));
	};

	const toggle = (formID: string, key: string, value: string, multi: boolean) => {
		const current = answers[formID]?.[key];
		if (multi) {
			const list = Array.isArray(current) ? (current as string[]) : [];
			const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
			setAnswer(formID, key, next);
			return;
		}
		setAnswer(formID, key, value);
	};

	const submit = async (form: LoopholeCliFormRequest) => {
		setBusy(form.id);
		setError(null);
		// Boolean fields map to a real boolean value; free text uses string[] for multi.
		const answer: Record<string, unknown> = {};
		for (const field of form.fields) {
			const value = answers[form.id]?.[field.key];
			if (value === undefined) {
				answer[field.key] = field.type === 'multiselect' ? [] : '';
				continue;
			}
			answer[field.key] = value;
		}
		try {
			const replySessionID = form.sessionID || sessionID
			await cliService.formReply(replySessionID, form.id, answer);
			chatThreadsService.removeCliForm(threadId, form.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	};

	const cancel = async (form: LoopholeCliFormRequest) => {
		setBusy(form.id);
		setError(null);
		try {
			const replySessionID = form.sessionID || sessionID
			await cliService.formCancel(replySessionID, form.id);
			chatThreadsService.removeCliForm(threadId, form.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	};

	return <div className='flex flex-col gap-1 w-full'>
		{forms.map((form) => {
			const current = answers[form.id] ?? {};
			const ready = form.fields.every((f) => !f.required || current[f.key] !== undefined && current[f.key] !== '');
			return <div key={form.id} className='w-full border border-loophole-border-1 rounded px-2 py-1.5 bg-loophole-bg-3'>
				<div className='flex items-center gap-1.5 text-xs'>
					<HelpCircle size={14} className='text-loophole-fg-4 flex-shrink-0' />
					<span className='text-loophole-fg-1 font-medium'>{form.title}</span>
					<span className='text-loophole-fg-3 truncate'>needs an answer</span>
				</div>
				<div className='flex flex-col gap-2 mt-1.5 min-w-0'>
					{form.fields.map((field) => <QuestionItemView
						key={field.key}
						field={field}
						answer={current[field.key]}
						onToggle={(key, value) => toggle(form.id, key, value, field.type === 'multiselect')}
						onText={(key, text) => {
							if (field.type === 'boolean') {
								setAnswer(form.id, key, text === 'true');
								return;
							}
							if (field.type === 'multiselect') {
								// Replace free-typed text: keep option-selected values, swap in this new one.
								const currentList = Array.isArray(current[field.key]) ? (current[field.key] as string[]) : [];
								const optionValues = optionValuesOf(field);
								const kept = currentList.filter((item) => optionValues.has(item));
								const trimmed = text.trim();
								setAnswer(form.id, key, trimmed.length === 0 ? kept : [...kept, trimmed]);
								return;
							}
							setAnswer(form.id, key, text);
						}}
					/>)}
				</div>
				{error && <div className='text-red-500 text-xs mt-1'>{error}</div>}
				<div className='flex gap-2 mt-2'>
					<button
						type='button'
						disabled={busy === form.id || !ready}
						className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50'
						onClick={() => void submit(form)}
					>{busy === form.id ? 'Sending…' : 'Submit answer'}</button>
					<button
						type='button'
						disabled={busy === form.id}
						className='px-2 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50'
						onClick={() => void cancel(form)}
					>Skip</button>
				</div>
			</div>;
		})}
	</div>;
};
