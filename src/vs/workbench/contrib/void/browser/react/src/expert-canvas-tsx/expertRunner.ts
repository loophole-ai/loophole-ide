/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * expertRunner - runs one expert as one Loophole CLI turn.
 *
 * The CLI owns the agent loop: it calls the model, runs the tools and feeds the
 * results back until the turn is finished. An expert is therefore a fresh CLI
 * session with the role prompt on top, streamed into the canvas through the same
 * `sendLLMMessage` path the chat uses.
 *
 * What the runner adds on top of a plain chat turn:
 *   1. Role limits. Every permission the CLI asks for is checked against the
 *      expert's access (see expertDefs): a reviewer's edit and a planner's
 *      command are refused. This is enforced on permission requests, so it only
 *      covers actions the CLI asks about; the role prompt covers the rest.
 *   2. Approval. Edits and commands an expert is allowed to make wait for the
 *      user in the canvas, unless auto-approve is on or the action is preset
 *      as always-allowed in Settings.
 *   3. A per-expert model, passed as `cliModel`.
 */

import type { ILLMMessageService } from '../../../../common/sendLLMMessageService.js';
import type { ILoopholeCliService } from '../../../../common/loopholeCliService.js';
import type { CliPermissionRequest, CliToolState } from '../../../../common/sendLLMMessageTypes.js';
import { expertCanvasStore, expertModelRef, expertsAutoApproveSettingId } from './expertCanvasStore.js';
import { ExpertDef, expertById } from './expertDefs.js';

const REQUEST_POLL_TIMEOUT_MS = 30 * 60 * 1000;

export interface RunExpertArgs {
	accessor: { get: (service: 'ILLMMessageService' | 'ILoopholeCliService' | 'IConfigurationService') => any };
	expert: ExpertDef;
	/** The user turn for this expert. */
	userMessage: string;
	/** What the preceding experts produced, if any. */
	priorContext?: string;
	/** Shared abort across the whole pipeline, so Stop stops every expert. */
	isCancelled: () => boolean;
}

type PermissionKind = 'write' | 'run' | 'other';

/** Buckets a CLI permission action (`edit`, `bash`, `read`, ...). */
const permissionKindOf = (action: string): PermissionKind => {
	const a = action.toLowerCase();
	if (a === 'edit' || a === 'write' || a === 'patch' || a === 'apply_patch' || a === 'multiedit' || a === 'multi_edit') return 'write';
	if (a === 'bash' || a === 'shell' || a === 'command' || a === 'run') return 'run';
	return 'other';
};

const describePermission = (p: CliPermissionRequest): string => {
	const target = p.resources[0];
	const short = target ? (target.split(/[\\/]/).pop() || target) : '';
	return `${p.action}${short ? ` ${short}` : ''}`.slice(0, 70);
};

const describeTool = (tool: CliToolState): string => {
	const input = tool.input ?? {};
	const target = (input.filePath ?? input.path ?? input.pattern ?? input.command ?? input.url) as unknown;
	if (typeof target !== 'string' || !target) return tool.name;
	return `${tool.name} ${target.split(/[\\/]/).pop() || target}`.slice(0, 70);
};

const truncateForDisplay = (s: string, max = 400): string =>
	s.length > max ? `${s.slice(0, max)}...` : s;

const accessSummary = (expert: ExpertDef): string => {
	const can = ['read and search files'];
	if (expert.access.write) can.push('create, edit and delete files');
	if (expert.access.run) can.push('run commands');
	const cannot = [expert.access.write ? '' : 'create, edit or delete files', expert.access.run ? '' : 'run commands'].filter(Boolean);
	return `YOUR ACCESS: you may ${can.join(', ')}.${cannot.length ? ` You may NOT ${cannot.join(' or ')}; such requests are refused.` : ''}`;
};

export const runExpert = async (args: RunExpertArgs): Promise<string> => {
	const { accessor, expert, userMessage, priorContext, isCancelled } = args;
	const store = expertCanvasStore;

	const llmMessageService = accessor.get('ILLMMessageService') as ILLMMessageService;
	const cliService = accessor.get('ILoopholeCliService') as ILoopholeCliService;
	const config = accessor.get('IConfigurationService') as { getValue: <T>(key: string) => T | undefined };

	const cliModel = expertModelRef(config, expert.id) || undefined;
	const autoApprove = config.getValue<boolean>(expertsAutoApproveSettingId) === true;

	store.setExpertStatus(expert.id, 'working');
	const fullUserMessage = priorContext ? `${userMessage}\n\n--- context from the team ---\n\n${priorContext}` : userMessage;
	store.addUserMessage(expert.id, userMessage);
	store.beginAssistantMessage(expert.id);

	if (isCancelled()) {
		store.setExpertStatus(expert.id, 'idle');
		store.finalizeLastMessage(expert.id);
		return '';
	}

	const systemMessage = `${expert.prompt}\n\n${accessSummary(expert)}`;

	// The CLI lists tools as one ordered snapshot per update; remember what has
	// already been shown so each call is added once and then updated in place.
	const shownTools = new Set<string>();

	const result = await new Promise<{ type: 'done'; fullText: string } | { type: 'error'; message: string } | { type: 'cancelled' }>((resolve) => {
		let settled = false;
		let poll: ReturnType<typeof setInterval> | undefined;
		let pollGuard: ReturnType<typeof setTimeout> | undefined;
		const settle = (r: { type: 'done'; fullText: string } | { type: 'error'; message: string } | { type: 'cancelled' }) => {
			if (settled) return;
			settled = true;
			clearInterval(poll);
			clearTimeout(pollGuard);
			resolve(r);
		};

		async function handlePermission(permission: CliPermissionRequest): Promise<void> {
			const reply = (decision: 'once' | 'reject', message?: string) =>
				cliService.permissionReply(permission.sessionID, permission.id, decision, message).catch(() => { /* the turn may already be over */ });

			const kind = permissionKindOf(permission.action);
			const title = describePermission(permission);
			const activityId = `${expert.id}-perm-${permission.id}`;

			// 1. Role limits.
			if ((kind === 'write' && !expert.access.write) || (kind === 'run' && !expert.access.run)) {
				store.beginToolActivity(expert.id, permission.action, title, `perm-${permission.id}`, 'rejected', undefined);
				store.setToolActivityStatus(activityId, 'rejected', 'Not permitted for this role.');
				await reply('reject', `${expert.name} (${expert.role}) is not allowed to do this. Continue without it, or say what you need another expert to do.`);
				return;
			}

			// 2. Approval. Only edits and commands need asking.
			const preset = (config.getValue<string[]>('loophole.permissions.alwaysAllowed') ?? []).includes(permission.action);
			if (kind === 'other' || autoApprove || preset) {
				await reply('once');
				return;
			}

			store.beginToolActivity(expert.id, permission.action, title, `perm-${permission.id}`, 'awaiting-approval', undefined);
			const approved = await store.waitForApproval(activityId);
			if (approved) {
				await reply('once');
			} else {
				await reply('reject', 'The user rejected this. Do not retry it. Find another way to make progress, or explain what you need.');
			}
		}

		// onText delivers the whole message so far, so emit only the new part.
		let emitted = 0;

		const requestId = llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			messages: [{ role: 'user', content: fullUserMessage }],
			separateSystemMessage: systemMessage,
			chatMode: 'agent',
			modelSelection: null,
			modelSelectionOptions: undefined,
			overridesOfModel: undefined,
			...(cliModel ? { cliModel } : {}),
			logging: { loggingName: `expert-${expert.id}` },
			onText: ({ fullText }) => {
				if (fullText.length > emitted) {
					store.appendToLastMessage(expert.id, fullText.slice(emitted));
					emitted = fullText.length;
				}
			},
			onTool: ({ tools }) => {
				for (const tool of tools) {
					const status = tool.status === 'error' ? 'error' : tool.status === 'done' ? 'success' : 'running';
					const activityId = `${expert.id}-${tool.id}`;
					if (!shownTools.has(tool.id)) {
						shownTools.add(tool.id);
						store.beginToolActivity(expert.id, tool.name, describeTool(tool), tool.id, status);
					} else {
						// Keep a tool the user is still being asked about, or one that was
						// refused, in that state until its outcome is known.
						const current = store.getToolActivities().find(t => t.id === activityId);
						if (current?.status === 'awaiting-approval' || current?.status === 'rejected') continue;
						store.setToolActivityStatus(activityId, status,
							tool.error ? truncateForDisplay(tool.error) : tool.outputText ? truncateForDisplay(tool.outputText) : undefined);
					}
				}
			},
			onPermission: ({ permission }) => {
				void handlePermission(permission);
			},
			onFinalMessage: ({ fullText }) => settle({ type: 'done', fullText }),
			onError: ({ message }) => settle({ type: 'error', message }),
			onAbort: () => settle({ type: 'cancelled' }),
		});

		if (!requestId) {
			settle({ type: 'error', message: 'Could not start the model request.' });
			return;
		}

		// A cancellation that arrives while the turn is running has to abort it,
		// otherwise Stop would leave the CLI working on a turn nobody will read.
		poll = setInterval(() => {
			if (isCancelled()) {
				llmMessageService.abort(requestId);
				settle({ type: 'cancelled' });
			}
		}, 200);
		pollGuard = setTimeout(() => clearInterval(poll), REQUEST_POLL_TIMEOUT_MS);
	});

	if (result.type === 'cancelled') {
		store.setExpertStatus(expert.id, 'idle');
		store.finalizeLastMessage(expert.id);
		return '';
	}

	if (result.type === 'error') {
		store.appendToLastMessage(expert.id, `\n\n**Error:** ${result.message}`);
		store.setExpertStatus(expert.id, 'failed');
		store.finalizeLastMessage(expert.id);
		return '';
	}

	store.setExpertStatus(expert.id, 'done');
	store.finalizeLastMessage(expert.id);
	return result.fullText;
};

// ── Sara's plan parsing ─────────────────────────────────────────────────────

export interface PlanStep {
	expertId: string;
	task: string;
	why: string;
}

export interface ParsedPlan {
	steps: PlanStep[];
	/** The plan text with the roster block stripped, for display. */
	summary: string;
}

/**
 * Parses the `<plan>` block Sara is required to emit.
 *
 * A malformed roster is not treated as fatal. A team lead that writes a plan in
 * prose is still a useful team lead, so we fall back to a sensible default set
 * derived from the goal's keywords. Refusing to run at all because the model
 * formatted its output differently would be a worse failure than guessing.
 */
export const parsePlan = (goal: string, planText: string, enabledIds: string[]): ParsedPlan => {
	const blockMatch = planText.match(/<plan>([\s\S]*?)<\/plan>/i);
	const summary = planText.replace(/<plan>[\s\S]*?<\/plan>/i, '').trim();
	const body = blockMatch?.[1];

	const steps: PlanStep[] = [];
	if (body) {
		for (const line of body.split('\n')) {
			const stepMatch = line.match(/^\s*[-*]?\s*([a-z]+)\s*\|(.*)\|(.*)$/i);
			if (!stepMatch) continue;
			const expertId = stepMatch[1].trim().toLowerCase();
			// Sara is excluded: a plan that assigns work to the planner is a
			// plan we should not act on, and Sara has no tools to act with anyway.
			if (!expertById(expertId) || expertId === 'sara') continue;
			if (!enabledIds.includes(expertId)) continue;
			const task = stepMatch[2].trim();
			if (!task) continue;
			steps.push({ expertId, task, why: stepMatch[3].trim() });
		}
	}

	// Deduplicate while preserving order, and cap the roster: eight sequential
	// agents each doing real tool calls is a long run, and more than one pass per
	// expert is rarely useful for a single goal.
	const seen = new Set<string>();
	const deduped = steps.filter(s => {
		if (seen.has(s.expertId)) return false;
		seen.add(s.expertId);
		return true;
	});

	if (deduped.length > 0) {
		return { steps: deduped, summary };
	}

	return { steps: fallbackSteps(goal, enabledIds), summary };
};

/** Used when Sara's roster is missing or unparseable. */
const fallbackSteps = (goal: string, enabledIds: string[]): PlanStep[] => {
	const lower = goal.toLowerCase();
	const has = (...words: string[]) => words.some(w => lower.includes(w));
	const wants = (id: string) => enabledIds.includes(id);

	const steps: PlanStep[] = [];
	// Leo first whenever there is an existing codebase to understand.
	if (wants('leo') && has('fix', 'bug', 'error', 'existing', 'refactor', 'add', 'update', 'change')) {
		steps.push({ expertId: 'leo', task: 'Research the relevant code.', why: 'There is existing code to understand first.' });
	}
	if (wants('karl')) {
		steps.push({ expertId: 'karl', task: `Implement: ${goal}`, why: 'Implementing the change is the core work.' });
	}
	// Nora is for something already broken, never for building something new.
	if (wants('nora') && has('bug', 'broken', 'crash', 'error', 'not working', 'fails', 'exception', 'debug')) {
		steps.push({ expertId: 'nora', task: `Diagnose and fix: ${goal}`, why: 'The goal describes something that is already broken.' });
	}
	if (wants('elena') && has('ui', 'ux', 'design', 'layout', 'css', 'style', 'responsive', 'accessibility', 'looks', 'visual')) {
		steps.push({ expertId: 'elena', task: 'Check the interface end to end.', why: 'The goal involves a user interface.' });
	}
	if (wants('ray')) {
		steps.push({ expertId: 'ray', task: 'Review the changes.', why: 'New code should be reviewed before it is documented.' });
	}
	if (wants('jake') && (has('test', 'verify', 'check') || steps.some(s => s.expertId === 'karl'))) {
		steps.push({ expertId: 'jake', task: 'Verify the work actually runs.', why: 'A change is not done until it has been run.' });
	}
	if (wants('max') && steps.some(s => s.expertId === 'karl')) {
		steps.push({ expertId: 'max', task: 'Document the work.', why: 'Code that changed should be documented.' });
	}
	// Nothing matched (e.g. an empty or very short goal): have the engineer try.
	if (steps.length === 0 && wants('karl')) {
		steps.push({ expertId: 'karl', task: goal, why: 'No other expert matched the goal.' });
	}
	return steps;
};

/** The prompt that tells Sara which experts are available to assign work to. */
export const planPromptFor = (enabledExperts: ExpertDef[]): string => {
	const roster = enabledExperts
		.filter(e => e.id !== 'sara')
		.map(e => `- ${e.id} (${e.name}, ${e.role})`)
		.join('\n');
	return `The experts currently enabled on this team are:
${roster}

Assign work only to these experts.`;
};
