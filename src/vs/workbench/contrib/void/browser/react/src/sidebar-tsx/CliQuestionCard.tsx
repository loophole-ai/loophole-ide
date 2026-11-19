/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, HelpCircle, Loader2, X } from 'lucide-react';
import { useAccessor, useChatThreadsState, useCliForms } from '../util/services.js';
import type { LoopholeCliFormRequest } from '../../../../common/loopholeCliTypes.js';
import type { CliToolState } from '../../../../common/sendLLMMessageTypes.js';
import { ToolCard, firstLineOf } from './tool-ui/ToolCard.js';
import { CardShell, UrlLink } from './tool-ui/toolUi.js';
import { allowsCustom, defaultInputState, fieldHeading, isRequired, layoutForm, optionsOf, rowsOfQuestionTool, summaryOfAnswer } from './cliFormLogic.js';
import type { FieldState, FormAnswer, FormInputState, FormValue, SummaryRow } from './cliFormLogic.js';

const friendlyError = (error: unknown): string => {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('not recognized') && /form(Reply|Cancel)/.test(message)) {
		return 'Loophole is still running an older background process. Fully quit and reopen it, then try again.';
	}
	return `Couldn’t send your answer: ${message}`;
};

const OptionRow = ({ label, description, selected, multi, disabled, onClick }: {
	label: string;
	description?: string;
	selected: boolean;
	multi: boolean;
	disabled: boolean;
	onClick: () => void;
}) => {
	return <button
		type='button'
		disabled={disabled}
		onClick={onClick}
		className={`flex items-start gap-2 w-full text-left px-2 py-1.5 rounded border cursor-pointer disabled:cursor-default disabled:opacity-60 ${selected ? 'border-[var(--vscode-focusBorder)] bg-loophole-bg-2' : 'border-loophole-border-3 bg-loophole-bg-1 hover:border-loophole-border-1'}`}
	>
		<span className={`flex-shrink-0 mt-px h-3.5 w-3.5 border flex items-center justify-center text-white ${multi ? 'rounded-[3px]' : 'rounded-full'} ${selected ? 'bg-[var(--vscode-focusBorder)] border-[var(--vscode-focusBorder)]' : 'border-loophole-border-1'}`}>
			{selected && <Check size={10} />}
		</span>
		<span className='flex flex-col min-w-0'>
			<span className='text-xs font-medium text-loophole-fg-1 break-words'>{label}</span>
			{description && <span className='text-[11px] text-loophole-fg-4 break-words'>{description}</span>}
		</span>
	</button>;
};

const AnswerSummary = ({ rows, skipped, note }: { rows: SummaryRow[]; skipped: boolean; note?: string }) => {
	const [isOpen, setIsOpen] = useState(false);
	const first = rows[0];
	const preview = skipped
		? (note ?? '')
		: first ? `${first.label}${first.values.length > 0 ? ` · ${first.values.join(', ')}` : ''}` : '';
	const head = <>
		{skipped
			? <X size={13} className='text-loophole-fg-4 flex-shrink-0' />
			: <Check size={13} className='text-emerald-500 flex-shrink-0' />}
		<span className='text-loophole-fg-3 text-xs flex-shrink-0'>{skipped ? 'Skipped' : 'Answered'}</span>
		<span className='text-loophole-fg-4 text-xs italic truncate min-w-0'>{preview}</span>
	</>;
	return <CardShell isOpen={isOpen && rows.length > 0} onToggle={() => setIsOpen((value) => !value)} head={head}>
		<div className='flex flex-col gap-1.5 px-1 pb-1'>
			{rows.map((row, index) => <div key={index} className='flex flex-col gap-0.5 min-w-0'>
				<span className='text-[11px] text-loophole-fg-4 break-words'>{row.label}</span>
				{row.values.length > 0
					? <div className='flex flex-wrap gap-1'>
						{row.values.map((value, valueIndex) => <span key={valueIndex} className='text-[11px] text-loophole-fg-1 bg-loophole-bg-2 border border-loophole-border-1 rounded-full px-2 break-words max-w-full'>{value}</span>)}
					</div>
					: <span className='text-[11px] text-loophole-fg-4 italic'>No answer</span>}
			</div>)}
		</div>
	</CardShell>;
};

const FormCard = ({ form, threadId, byLabel, onSubmitted, onSkipped }: {
	form: LoopholeCliFormRequest;
	threadId: string;
	byLabel?: string;
	onSubmitted?: (answer: FormAnswer) => void;
	onSkipped?: () => void;
}) => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const cliService = accessor.get('ILoopholeCliService');
	const threadsState = useChatThreadsState();
	const threadSessionID = threadsState.allThreads[threadId]?.state.cliSessionId;
	const replySessionID = form.sessionID || threadSessionID || '';

	const [input, setInput] = useState<FormInputState>(() => defaultInputState(form));
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const layout = useMemo(() => layoutForm(form, input), [form, input]);

	useEffect(() => {
		const node = rootRef.current;
		if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}, []);
	const anyAnswer = Object.keys(layout.answer).length > 0;

	const choose = (key: string, value: FormValue | undefined) => {
		setInput((prev) => ({ ...prev, choices: { ...prev.choices, [key]: value }, customOpen: { ...prev.customOpen, [key]: false } }));
	};
	const setPicked = (key: string, picked: string[]) => {
		setInput((prev) => ({ ...prev, choices: { ...prev.choices, [key]: picked } }));
	};
	const setText = (key: string, text: string) => {
		setInput((prev) => ({ ...prev, texts: { ...prev.texts, [key]: text } }));
	};
	const setCustomOpen = (key: string, open: boolean, clearChoice: boolean) => {
		setInput((prev) => ({
			...prev,
			choices: clearChoice ? { ...prev.choices, [key]: undefined } : prev.choices,
			customOpen: { ...prev.customOpen, [key]: open },
		}));
	};

	const submit = async () => {
		setSending(true);
		setError(null);
		try {
			await cliService.formReply(replySessionID, form.id, layout.answer);
			onSubmitted?.(layout.answer);
			chatThreadsService.removeCliForm(threadId, form.id);
		}
		catch (e) {
			setError(friendlyError(e));
			setSending(false);
		}
	};

	const skip = async () => {
		setSending(true);
		setError(null);
		try {
			await cliService.formCancel(replySessionID, form.id);
			onSkipped?.();
			chatThreadsService.removeCliForm(threadId, form.id);
		}
		catch (e) {
			setError(friendlyError(e));
			setSending(false);
		}
	};

	const renderField = (item: FieldState) => {
		const { field, value, problem } = item;
		const heading = fieldHeading(form, field);
		const shownProblem = problem && problem !== 'Required' && value !== undefined ? problem : undefined;

		const head = <>
			<div className='flex items-center gap-1.5 min-w-0'>
				<span className='text-xs font-semibold text-loophole-fg-1 break-words min-w-0'>
					{heading.label}{isRequired(field) && <span className='text-red-400 ml-0.5'>*</span>}
				</span>
				{heading.tag && <span className='flex-shrink-0 text-[10px] text-loophole-fg-3 border border-loophole-border-3 rounded-full px-1.5'>{heading.tag}</span>}
			</div>
			{heading.helper && <div className='text-[11px] text-loophole-fg-4 break-words'>{heading.helper}</div>}
		</>;

		if (field.type === 'external') {
			return <div key={field.key} className='flex flex-col gap-1.5 min-w-0'>
				{head}
				<UrlLink url={field.url} className='text-xs break-all text-[var(--vscode-textLink-foreground)]'>{field.url}</UrlLink>
				<OptionRow
					label='I’ve done this'
					selected={value === true}
					multi={true}
					disabled={sending}
					onClick={() => choose(field.key, value === true ? undefined : true)}
				/>
			</div>;
		}

		if (field.type === 'boolean') {
			const on = value === true;
			return <div key={field.key} className='flex flex-col gap-1.5 min-w-0'>
				{head}
				<button
					type='button'
					disabled={sending}
					onClick={() => choose(field.key, !on)}
					className='flex items-center gap-2 self-start cursor-pointer disabled:cursor-default disabled:opacity-60 text-xs text-loophole-fg-1'
				>
					<span className={`relative h-[17px] w-[30px] rounded-full transition-colors ${on ? 'bg-[var(--vscode-focusBorder)]' : 'bg-loophole-border-1'}`}>
						<span className={`absolute top-[2px] left-[2px] h-[13px] w-[13px] rounded-full bg-white transition-transform ${on ? 'translate-x-[13px]' : ''}`} />
					</span>
					{on ? 'Yes' : 'No'}
				</button>
			</div>;
		}

		if (field.type === 'number' || field.type === 'integer') {
			const range = field.minimum !== undefined && field.maximum !== undefined
				? `${field.minimum} to ${field.maximum}`
				: field.minimum !== undefined ? `at least ${field.minimum}` : field.maximum !== undefined ? `at most ${field.maximum}` : '';
			return <div key={field.key} className='flex flex-col gap-1.5 min-w-0'>
				{head}
				<div className='flex items-center gap-2'>
					<input
						type='number'
						disabled={sending}
						min={field.minimum}
						max={field.maximum}
						step={field.type === 'integer' ? 1 : 'any'}
						value={input.texts[field.key] ?? ''}
						onChange={(e) => setText(field.key, e.target.value)}
						className={`w-24 text-xs bg-loophole-bg-1 border rounded px-2 py-1.5 text-loophole-fg-1 outline-none focus:border-[var(--vscode-focusBorder)] ${shownProblem ? 'border-red-400' : 'border-loophole-border-3'}`}
					/>
					{range && <span className='text-[11px] text-loophole-fg-4'>{range}</span>}
				</div>
				{shownProblem && <div className='text-[11px] text-red-400'>{shownProblem}</div>}
			</div>;
		}

		const options = optionsOf(field);
		if (options.length > 0) {
			const multi = field.type === 'multiselect';
			const custom = allowsCustom(field);
			const customIsOpen = input.customOpen[field.key] === true;
			const chosen = input.choices[field.key];
			const picked = Array.isArray(chosen) ? chosen : (field.type === 'multiselect' ? (field.default ?? []) : []);
			const selectedCount = Array.isArray(value) ? value.length : 0;
			const atMax = field.type === 'multiselect' && field.maxItems !== undefined && selectedCount >= field.maxItems;
			return <div key={field.key} className='flex flex-col gap-1.5 min-w-0'>
				{head}
				<div className='flex flex-col gap-1'>
					{options.map((option) => {
						const selected = multi ? picked.includes(option.value) : (!customIsOpen && value === option.value);
						return <OptionRow
							key={option.value}
							label={option.label}
							description={option.description}
							selected={selected}
							multi={multi}
							disabled={sending || (multi && !selected && atMax)}
							onClick={() => {
								if (!multi) choose(field.key, option.value);
								else setPicked(field.key, selected ? picked.filter((item) => item !== option.value) : [...picked, option.value]);
							}}
						/>;
					})}
					{custom && <OptionRow
						label='Something else…'
						selected={customIsOpen}
						multi={multi}
						disabled={sending || (multi && !customIsOpen && atMax)}
						onClick={() => {
							if (multi) setCustomOpen(field.key, !customIsOpen, false);
							else if (!customIsOpen) setCustomOpen(field.key, true, true);
						}}
					/>}
					{custom && customIsOpen && <input
						type='text'
						autoFocus
						disabled={sending}
						placeholder='Type your own answer'
						value={input.texts[field.key] ?? ''}
						onChange={(e) => setText(field.key, e.target.value)}
						className='w-full text-xs bg-loophole-bg-1 border border-loophole-border-3 rounded px-2 py-1.5 text-loophole-fg-1 placeholder:text-loophole-fg-5 outline-none focus:border-[var(--vscode-focusBorder)]'
					/>}
				</div>
				{field.type === 'multiselect' && (field.maxItems !== undefined || field.minItems !== undefined) && <div className='text-[11px] text-loophole-fg-4'>
					{selectedCount} chosen{field.maxItems !== undefined ? ` · up to ${field.maxItems}` : ''}{field.minItems ? ` · at least ${field.minItems}` : ''}
				</div>}
				{shownProblem && <div className='text-[11px] text-red-400'>{shownProblem}</div>}
			</div>;
		}

		const hasFormat = (field as { format?: unknown }).format !== undefined;
		const shortInput = field.type === 'string' && (hasFormat || field.pattern !== undefined || (field.maxLength !== undefined && field.maxLength <= 80));
		return <div key={field.key} className='flex flex-col gap-1.5 min-w-0'>
			{head}
			{shortInput
				? <input
					type='text'
					disabled={sending}
					placeholder={field.type === 'string' ? (field.placeholder ?? 'Your answer') : 'Your answer'}
					value={input.texts[field.key] ?? (typeof value === 'string' ? value : '')}
					onChange={(e) => setText(field.key, e.target.value)}
					className={`w-full text-xs bg-loophole-bg-1 border rounded px-2 py-1.5 text-loophole-fg-1 placeholder:text-loophole-fg-5 outline-none focus:border-[var(--vscode-focusBorder)] ${shownProblem ? 'border-red-400' : 'border-loophole-border-3'}`}
				/>
				: <textarea
					disabled={sending}
					rows={2}
					placeholder={field.type === 'string' ? (field.placeholder ?? 'Your answer') : 'Your answer'}
					value={input.texts[field.key] ?? (typeof value === 'string' ? value : '')}
					onChange={(e) => setText(field.key, e.target.value)}
					className={`w-full text-xs bg-loophole-bg-1 border rounded px-2 py-1.5 text-loophole-fg-1 placeholder:text-loophole-fg-5 outline-none resize-none focus:border-[var(--vscode-focusBorder)] ${shownProblem ? 'border-red-400' : 'border-loophole-border-3'}`}
				/>}
			{shownProblem && <div className='text-[11px] text-red-400'>{shownProblem}</div>}
		</div>;
	};

	return <div ref={rootRef} className='w-full min-w-0 border border-[var(--vscode-focusBorder)] rounded-md bg-loophole-bg-3 overflow-hidden shadow-[0_0_0_3px_rgba(55,148,255,0.12)]'>
		<div className='flex items-center gap-2 px-2.5 py-1.5 border-b border-loophole-border-3'>
			<HelpCircle size={15} className='text-loophole-fg-4 flex-shrink-0' />
			<span className='text-[13px] font-semibold text-loophole-fg-1 truncate min-w-0 flex-1'>{form.title}</span>
			{byLabel && <span className='flex-shrink-0 text-[10px] text-loophole-fg-3 border border-loophole-border-3 rounded-full px-1.5'>{byLabel}</span>}
			<span className='flex items-center gap-1.5 flex-shrink-0 text-[11px] text-[var(--vscode-focusBorder)]'>
				<span className='h-1.5 w-1.5 rounded-full bg-[var(--vscode-focusBorder)] animate-pulse' />
				waiting for you
			</span>
		</div>
		<div className='flex flex-col gap-3 p-2.5'>
			{layout.fields.map(renderField)}
		</div>
		{error && <div className='mx-2.5 mb-2 px-2 py-1.5 border border-red-400 rounded text-xs text-red-400 bg-red-500/10 break-words'>{error}</div>}
		<div className='flex items-center gap-2 px-2.5 py-2 border-t border-loophole-border-3'>
			<button
				type='button'
				disabled={sending || !layout.ready || !anyAnswer}
				onClick={() => void submit()}
				className='flex items-center gap-1.5 px-3 py-1 rounded text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50'
			>
				{sending ? <><Loader2 size={12} className='animate-spin' />Sending…</> : error ? 'Try again' : 'Submit answer'}
			</button>
			<button
				type='button'
				disabled={sending}
				onClick={() => void skip()}
				className='px-3 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] disabled:opacity-50'
			>
				Skip
			</button>
			<span className='ml-auto text-[11px] text-loophole-fg-4 text-right'>
				{!layout.ready ? 'Answer the required questions' : !anyAnswer ? 'Choose an answer or skip' : 'Ready to send'}
			</span>
		</div>
	</div>;
};

export const LooseFormCard = ({ form, threadId, byLabel }: { form: LoopholeCliFormRequest; threadId: string; byLabel?: string }) => {
	return <FormCard form={form} threadId={threadId} byLabel={byLabel} />;
};

export const QuestionToolCard = ({ tool, form, threadId }: { tool: CliToolState; form: LoopholeCliFormRequest | undefined; threadId: string }) => {
	const [submitted, setSubmitted] = useState<{ form: LoopholeCliFormRequest; answer: FormAnswer } | undefined>(undefined);
	const [skipped, setSkipped] = useState(false);

	if (form && !submitted && !skipped) {
		return <FormCard
			form={form}
			threadId={threadId}
			onSubmitted={(answer) => setSubmitted({ form, answer })}
			onSkipped={() => setSkipped(true)}
		/>;
	}
	if (submitted) return <AnswerSummary rows={summaryOfAnswer(submitted.form, submitted.answer)} skipped={false} />;
	if (skipped) return <AnswerSummary rows={[]} skipped={true} />;
	if (tool.status === 'done') {
		const rows = rowsOfQuestionTool(tool);
		if (rows) return <AnswerSummary rows={rows} skipped={false} />;
	}
	if (tool.status === 'error') {
		return <AnswerSummary rows={[]} skipped={true} note={tool.error ? firstLineOf(tool.error) : undefined} />;
	}
	return <ToolCard tool={tool} />;
};

// Ask-follow-question card for the Loophole CLI (`form.created`).
// Renders every pending question form for the thread; answers and skips flow
// through ILoopholeCliService.formReply / formCancel inside FormCard, which
// also removes the form from the pending list once answered.
export const CliQuestionCard = ({ threadId }: { threadId: string }) => {
	const forms = useCliForms(threadId);

	if (forms.length === 0) return null;

	return <div className='flex flex-col gap-1 w-full'>
		{forms.map((form) => <LooseFormCard key={form.id} form={form} threadId={threadId} />)}
	</div>;
};
