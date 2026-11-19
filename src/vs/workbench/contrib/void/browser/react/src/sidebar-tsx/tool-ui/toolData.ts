/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Loophole AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/
import type { CliToolState } from '../../../../../common/sendLLMMessageTypes.js';

const TRUNCATION_TAIL = '… (truncated)';

const lower = (name: string): string => name.toLowerCase();

export type ExploreKind = 'read' | 'search' | 'list';

export const exploreKindOf = (name: string): ExploreKind | undefined => {
	const n = lower(name);
	if (n === 'read') return 'read';
	if (n === 'grep' || n === 'search') return 'search';
	if (n === 'glob' || n === 'list') return 'list';
	return undefined;
};

export const isBashTool = (name: string): boolean => ['bash', 'terminal', 'shell'].includes(lower(name));
export const isTaskTool = (name: string): boolean => ['task', 'subagent'].includes(lower(name));
export const isGrepTool = (name: string): boolean => ['grep', 'search'].includes(lower(name));
export const isGlobTool = (name: string): boolean => lower(name) === 'glob';
export const isFetchTool = (name: string): boolean => ['webfetch', 'fetch'].includes(lower(name));
export const isWebSearchTool = (name: string): boolean => lower(name) === 'websearch';

export const firstString = (input: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
	if (!input) return undefined;
	for (const key of keys) {
		const value = input[key];
		if (typeof value === 'string' && value.length > 0) return value;
	}
	return undefined;
};

const PATH_KEYS = ['filePath', 'file_path', 'path', 'uri', 'filename', 'file', 'target'];

export const toolPathOf = (input: Record<string, unknown> | undefined): string | undefined => firstString(input, PATH_KEYS);

export const formatDuration = (ms: number): string => {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)}m ${whole % 60}s`;
};

export const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max - 1)}…` : text;

const normalizePath = (path: string): string => path.replace(/\\/g, '/');

export const baseOf = (path: string): string => {
	const parts = normalizePath(path).split('/').filter((part) => part.length > 0);
	return parts.length > 0 ? parts[parts.length - 1] : path;
};

export const parentOf = (path: string): string => {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf('/');
	return index > 0 ? normalized.slice(0, index) : '';
};

export const shortDirOf = (dirPath: string): string => {
	const parts = normalizePath(dirPath).split('/').filter((part) => part.length > 0);
	if (parts.length === 0) return '';
	return `${parts.slice(Math.max(0, parts.length - 3)).join('/')}/`;
};

export const splitPath = (file: string): { name: string; dir: string } => {
	const parts = normalizePath(file).split('/').filter((part) => part.length > 0);
	if (parts.length === 0) return { name: '', dir: '' };
	const parents = parts.slice(Math.max(0, parts.length - 3), parts.length - 1);
	return { name: parts[parts.length - 1], dir: parents.length > 0 ? `${parents.join('/')}/` : '' };
};

export const domainOf = (url: string): string => {
	try {
		return new URL(url).hostname || url;
	}
	catch {
		return url;
	}
};

const countNonEmpty = (text: string): number => text.split('\n').filter((line) => line.trim().length > 0).length;

export const readLineCount = (text: string): number => {
	const numbered = text.split('\n').filter((line) => /^\s*\d+\s*[|:\t\u2192]/.test(line)).length;
	return numbered > 0 ? numbered : countNonEmpty(text);
};

export type GrepHit = { line: number; text: string };
export type GrepGroup = { path: string; hits: GrepHit[] };

export const parseGrepOutput = (text: string): GrepGroup[] => {
	const groups: GrepGroup[] = [];
	const byPath = new Map<string, GrepGroup>();
	const groupFor = (path: string): GrepGroup => {
		let group = byPath.get(path);
		if (!group) {
			group = { path, hits: [] };
			byPath.set(path, group);
			groups.push(group);
		}
		return group;
	};
	let current: GrepGroup | undefined;
	for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
		if (raw.trim() === '' || /^Found \d+ match/i.test(raw)) continue;
		const labelled = /^\s*Line\s+(\d+):\s?(.*)$/.exec(raw);
		if (labelled && current) {
			current.hits.push({ line: Number(labelled[1]), text: clip(labelled[2].trim(), 300) });
			continue;
		}
		const numbered = /^(\d+)[:-]\s?(.*)$/.exec(raw);
		if (numbered && current) {
			current.hits.push({ line: Number(numbered[1]), text: clip(numbered[2].trim(), 300) });
			continue;
		}
		const flat = /^(.+?):(\d+):(.*)$/.exec(raw);
		if (flat) {
			groupFor(flat[1]).hits.push({ line: Number(flat[2]), text: clip(flat[3].trim(), 300) });
			current = byPath.get(flat[1]);
			continue;
		}
		if (/^\S.*:$/.test(raw)) {
			current = groupFor(raw.slice(0, -1));
		}
	}
	return groups.filter((group) => group.hits.length > 0);
};

export const matchCountOf = (text: string): number => {
	const header = /Found (\d+) match/i.exec(text);
	if (header) return Number(header[1]);
	return parseGrepOutput(text).reduce((sum, group) => sum + group.hits.length, 0);
};

export const parseGlobOutput = (text: string): string[] => text
	.replace(/\r\n/g, '\n')
	.split('\n')
	.map((line) => line.trim())
	.filter((line) => line.length > 0 && line.length < 500 && !/^(Found |No files|\(|\u2026)/i.test(line));

export type FetchView = { domain: string; title: string; excerpt: string; chars: number; truncated: boolean };

export const fetchViewOf = (url: string, text: string): FetchView => {
	const domain = domainOf(url);
	const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
	const heading = /^#{1,3}\s+(.+)$/m.exec(text);
	const firstLine = text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
	const rawTitle = (titleTag?.[1] ?? heading?.[1] ?? firstLine).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	const body = text
		.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ')
		.replace(/^#{1,6}\s+.*$/m, ' ')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\s+/g, ' ')
		.trim();
	return {
		domain,
		title: clip(rawTitle || domain, 100),
		excerpt: clip(body, 320),
		chars: text.length,
		truncated: text.endsWith(TRUNCATION_TAIL),
	};
};

export type WebResult = { title: string; url: string; domain: string; snippet: string };

export const parseWebSearchOutput = (text: string): WebResult[] => {
	const results: WebResult[] = [];
	for (const block of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
		const title = /^\s*Title:\s*(.+)$/im.exec(block)?.[1]?.trim();
		const url = /^\s*URL:\s*(\S+)/im.exec(block)?.[1]?.trim();
		if (!title || !url) continue;
		const snippet = block
			.split('\n')
			.filter((line) => !/^\s*(Title|URL|Author|Published|Published Date|Id):/i.test(line))
			.map((line) => line.replace(/^\s*(Text|Snippet|Highlights|Summary):\s*/i, '').trim())
			.filter((line) => line.length > 0)
			.join(' ');
		results.push({ title: clip(title, 120), url, domain: domainOf(url), snippet: clip(snippet, 240) });
	}
	return results;
};

export type StepIcon = 'file' | 'search' | 'folder' | 'terminal' | 'globe' | 'edit' | 'tool';
export type StepRowData = { icon: StepIcon; verb: string; target: string; path?: string; meta: string };

export const stepRowOf = (step: CliToolState): StepRowData => {
	const name = lower(step.name);
	const input = step.input;
	const path = toolPathOf(input);
	const text = step.outputText ?? '';
	const finished = step.status === 'done' && text.length > 0;
	const plus = step.outputLines !== undefined || !text.endsWith(TRUNCATION_TAIL) ? '' : '+';
	const counted = (count: number, singular: string, plural: string): string => `${count}${plus} ${count === 1 ? singular : plural}`;
	const failedMeta = step.status === 'error' ? 'failed' : '';
	if (name === 'read') {
		return { icon: 'file', verb: 'Read', target: path ? baseOf(path) : '', path, meta: finished ? counted(step.outputLines ?? readLineCount(text), 'line', 'lines') : failedMeta };
	}
	if (name === 'grep' || name === 'search') {
		const pattern = firstString(input, ['pattern', 'query', 'search']);
		return { icon: 'search', verb: 'Search', target: pattern ? `"${clip(pattern, 40)}"` : '', meta: finished ? counted(matchCountOf(text), 'match', 'matches') : failedMeta };
	}
	if (name === 'glob') {
		const pattern = firstString(input, ['pattern', 'glob']);
		return { icon: 'folder', verb: 'Find', target: pattern ? clip(pattern, 40) : '', meta: finished ? counted(parseGlobOutput(text).length, 'file', 'files') : failedMeta };
	}
	if (name === 'list') {
		return { icon: 'folder', verb: 'List', target: path ? `${baseOf(path)}/` : '', path, meta: finished ? counted(countNonEmpty(text), 'item', 'items') : failedMeta };
	}
	if (name === 'edit' || name === 'write' || name === 'patch' || name === 'apply_patch' || name === 'multiedit' || name === 'multi_edit') {
		return { icon: 'edit', verb: name === 'write' ? 'Write' : 'Edit', target: path ? baseOf(path) : '', path, meta: failedMeta };
	}
	if (isBashTool(name)) {
		const command = firstString(input, ['command', 'cmd']);
		return { icon: 'terminal', verb: 'Run', target: command ? clip(command, 60) : '', meta: failedMeta };
	}
	if (isFetchTool(name)) {
		const url = firstString(input, ['url']);
		return { icon: 'globe', verb: 'Fetch', target: url ? domainOf(url) : '', meta: failedMeta };
	}
	if (isWebSearchTool(name)) {
		const query = firstString(input, ['query']);
		return { icon: 'search', verb: 'Web', target: query ? `"${clip(query, 40)}"` : '', meta: failedMeta };
	}
	return { icon: 'tool', verb: clip(step.name || 'Tool', 8), target: path ? baseOf(path) : '', path, meta: failedMeta };
};

export type PermissionDetail =
	| { kind: 'command'; command: string }
	| { kind: 'file'; path: string; diff?: string }
	| { kind: 'url'; url: string }
	| { kind: 'other' };

export const permissionDetailOf = (action: string, resources: string[], metadata: Record<string, unknown> | undefined): PermissionDetail => {
	const a = lower(action);
	const first = resources[0];
	if (isBashTool(a)) {
		const command = firstString(metadata, ['command', 'cmd']) ?? first;
		return command ? { kind: 'command', command } : { kind: 'other' };
	}
	if (['edit', 'write', 'patch', 'apply_patch', 'multiedit', 'multi_edit'].includes(a)) {
		const path = firstString(metadata, ['filepath', 'filePath', 'file_path', 'path', 'file']) ?? first;
		const diff = firstString(metadata, ['diff', 'patch']);
		return path ? { kind: 'file', path, diff } : { kind: 'other' };
	}
	if (isFetchTool(a)) {
		const url = firstString(metadata, ['url']) ?? first;
		return url && /^https?:\/\//i.test(url) ? { kind: 'url', url } : { kind: 'other' };
	}
	if ((a === 'read' || a === 'list') && first) return { kind: 'file', path: first };
	return { kind: 'other' };
};

export const permissionTitleOf = (action: string): string => {
	const a = lower(action);
	if (isBashTool(a)) return 'Run command';
	if (a === 'edit' || a === 'patch' || a === 'apply_patch' || a === 'multiedit' || a === 'multi_edit') return 'Edit file';
	if (a === 'write') return 'Write file';
	if (a === 'read') return 'Read file';
	if (a === 'list') return 'List directory';
	if (a === 'glob') return 'Find files';
	if (a === 'grep' || a === 'search') return 'Search';
	if (isFetchTool(a)) return 'Fetch web page';
	if (isWebSearchTool(a)) return 'Web search';
	if (isTaskTool(a)) return 'Run subagent';
	return action || 'Tool';
};
