/*--------------------------------------------------------------------------------------
 *  Loophole engine adapter — connects the IDE to the loophole server.
 *
 *  The engine owns sessions, tools, agents and providers. The IDE keeps the editing
 *  experience and inline autocomplete; this module is the only place that talks to
 *  the engine, so swapping providers means changing nothing else in the workbench.
 *--------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { delimiter, join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import {
	EngineIntegration,
	EngineIntegrationConnection,
	EngineIntegrationMethod,
	EngineCredential,
	EngineModel,
	EngineOAuthAttempt,
	EngineOAuthAttemptStatus,
	EngineProvider,
} from '../../common/loopholeEngineTypes.js';

export interface EngineCredentials {
	readonly url: string;
	readonly password: string;
}

/** The model reference shape the server accepts (provider/id[#variant]). */
export interface EngineModelRef {
	readonly providerID: string;
	readonly id: string;
	readonly variant?: string;
}

export interface EngineSession {
	readonly id: string;
	readonly title?: string;
}

/** A V2 server event. Durable and ephemeral events share this envelope. */
export interface EngineEvent {
	readonly type: string;
	readonly data?: Record<string, unknown>;
}

export class EngineRequestError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'EngineRequestError';
		this.status = status;
	}
}

export function formatModelRef(ref: EngineModelRef): string {
	return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ''}`;
}

/** Parse the model picker's `provider/id[#variant]` string. */
export function parseModelRef(modelName: string): EngineModelRef | undefined {
	const slash = modelName.indexOf('/');
	if (slash <= 0 || slash === modelName.length - 1) {
		return undefined;
	}
	const providerID = modelName.slice(0, slash);
	const rest = modelName.slice(slash + 1);
	const hash = rest.indexOf('#');
	const id = hash === -1 ? rest : rest.slice(0, hash);
	if (!id) {
		return undefined;
	}
	const variant = hash === -1 ? undefined : rest.slice(hash + 1) || undefined;
	return { providerID, id, variant };
}

type RequestOptions = {
	readonly method?: string;
	readonly body?: string;
	readonly signal?: AbortSignal;
	readonly accept?: string;
};

async function request(credentials: EngineCredentials, path: string, options: RequestOptions = {}): Promise<Response> {
	const headers: Record<string, string> = {
		// The Loophole/OpenCode server's Basic username is fixed to `loophole`; only the
		// password varies per server (see ServerAuth and the standalone service).
		Authorization: `Basic ${Buffer.from(`loophole:${credentials.password}`).toString('base64')}`,
	};
	if (options.accept) {
		headers.Accept = options.accept;
	}
	if (options.body !== undefined) {
		headers['Content-Type'] = 'application/json';
	}
	const response = await fetch(`${credentials.url}${path}`, {
		method: options.method ?? 'GET',
		body: options.body,
		headers,
		signal: options.signal,
	});
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new EngineRequestError(
			response.status,
			`Loophole engine request failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 500)}` : ''}`,
		);
	}
	return response;
}

async function requestJson(credentials: EngineCredentials, path: string, options: RequestOptions = {}): Promise<unknown> {
	const response = await request(credentials, path, options);
	return response.json();
}

/** Fire-and-forget requests still need their bodies drained so keep-alive can reuse the socket. */
async function requestVoid(credentials: EngineCredentials, path: string, options: RequestOptions = {}): Promise<void> {
	const response = await request(credentials, path, options);
	await response.text().catch(() => undefined);
}

function unwrap(value: unknown): unknown {
	if (value && typeof value === 'object' && 'data' in value) {
		return (value as { data: unknown }).data;
	}
	return value;
}

function locationQuery(directory?: string): string {
	if (!directory) {
		return '';
	}
	return `?location[directory]=${encodeURIComponent(directory)}`;
}

function numberField(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function modelFromInfo(value: unknown): EngineModel | undefined {
	const info = recordField(value);
	if (!info || typeof info.providerID !== 'string' || typeof info.id !== 'string') {
		return undefined;
	}
	if (info.enabled === false || info.status === 'deprecated') {
		return undefined;
	}
	const limit = recordField(info.limit);
	const capabilities = recordField(info.capabilities);
	const outputs = capabilities && Array.isArray(capabilities.output) ? capabilities.output : undefined;
	if (outputs && !outputs.includes('text')) {
		return undefined;
	}
	const costs = Array.isArray(info.cost) ? info.cost.map(recordField).filter((cost): cost is Record<string, unknown> => !!cost) : [];
	const baseCost = costs.find((cost) => cost.tier === undefined) ?? costs[0];
	return {
		providerID: info.providerID,
		id: info.id,
		name: typeof info.name === 'string' ? info.name : undefined,
		contextWindow: numberField(limit?.context),
		outputTokens: numberField(limit?.output),
		supportsTools: typeof capabilities?.tools === 'boolean' ? capabilities.tools : undefined,
		cost: baseCost && typeof baseCost.input === 'number' && typeof baseCost.output === 'number'
			? { input: baseCost.input, output: baseCost.output }
			: undefined,
	};
}

function engineModelRef(model: EngineModel): EngineModelRef {
	return { providerID: model.providerID, id: model.id };
}

async function isLive(credentials: EngineCredentials): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 1_500);
	try {
		// Probe the lightweight info route and require the V2 protocol this adapter targets.
		// `/api/session` also exists on older servers, so it cannot tell them apart.
		const info = recordField(unwrap(await requestJson(credentials, '/api/info', { signal: controller.signal })));
		const major = typeof info?.version === 'string' ? Number.parseInt(info.version.replace(/^v/, ''), 10) : NaN;
		return Number.isFinite(major) && major >= 2;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function stateDirectories(): string[] {
	const directories: string[] = [];
	// Only the Loophole namespace is trusted. Sharing files or URLs with an OpenCode
	// install would make both clients connect to whichever server won the race.
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg) {
		directories.push(join(xdg, 'loophole'));
	}
	directories.push(join(homedir(), '.local', 'state', 'loophole'));
	return [...new Set(directories)];
}

function registrationRank(name: string): number {
	if (name === 'service-loophole.json') return 0;
	if (name === 'service-prod.json') return 1;
	if (name === 'service.json') return 2;
	return 3;
}

/** Running servers advertise themselves through a small registration file. */
function readRegistrations(): EngineCredentials[] {
	const found: EngineCredentials[] = [];
	const explicitUrl = process.env.LOOPHOLE_SERVER_URL;
	const explicitPassword = process.env.LOOPHOLE_SERVER_PASSWORD;
	if (explicitUrl) {
		found.push({ url: explicitUrl.replace(/\/+$/, ''), password: explicitPassword ?? '' });
	}

	for (const directory of stateDirectories()) {
		if (!existsSync(directory)) {
			continue;
		}
		let names: string[] = [];
		try {
			names = readdirSync(directory).filter((name) => /^service.*\.json$/.test(name));
		} catch {
			continue;
		}
		names.sort((a, b) => registrationRank(a) - registrationRank(b) || a.localeCompare(b));
		for (const name of names) {
			try {
				const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8')) as { url?: unknown; password?: unknown };
				if (typeof parsed.url === 'string') {
					found.push({
						url: parsed.url.replace(/\/+$/, ''),
						// A server without auth omits the password; send an empty one.
						password: typeof parsed.password === 'string' ? parsed.password : '',
					});
				}
			} catch {
				// A half-written or foreign service file is not fatal.
			}
		}
	}

	const seen = new Set<string>();
	return found.filter((credentials) => {
		const key = `${credentials.url}\u0000${credentials.password}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function binaryCandidates(): string[] {
	const names = process.platform === 'win32'
		? ['loophole.exe', 'loophole.cmd', 'loophole.bat', 'loophole']
		: ['loophole'];
	const pathDirectories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
	const bunInstall = process.env.BUN_INSTALL;
	const candidates: Array<string | undefined> = [
		process.env.LOOPHOLE_BIN,
		process.env.LOOPHOLE_CLI_PATH,
		...pathDirectories.flatMap((directory) => names.map((name) => join(directory, name))),
		bunInstall ? join(bunInstall, 'bin', process.platform === 'win32' ? 'loophole.exe' : 'loophole') : undefined,
		join(homedir(), '.bun', 'bin', process.platform === 'win32' ? 'loophole.exe' : 'loophole'),
		process.env.APPDATA ? join(process.env.APPDATA, 'npm', process.platform === 'win32' ? 'loophole.cmd' : 'loophole') : undefined,
		join(homedir(), '.local', 'bin', 'loophole'),
		join(homedir(), '.local', 'share', 'loophole', 'bin', 'loophole'),
		join(homedir(), '.cache', 'loophole', 'bin', 'loophole'),
		'/usr/local/bin/loophole',
		'/opt/homebrew/bin/loophole',
	];
	return [...new Set(candidates.filter((candidate): candidate is string => !!candidate && isEngineBinary(candidate)))];
}

function isEngineBinary(candidate: string): boolean {
	if (!existsSync(candidate)) {
		return false;
	}
	if (/\.(cmd|bat)$/i.test(candidate)) {
		try {
			const head = readFileSync(candidate, 'utf8').slice(0, 4_000).toLowerCase();
			// Editor installs ship command shims that forward every argument to Electron.
			return !head.includes('electron_run_as_node') && !head.includes('cli.js');
		} catch {
			return false;
		}
	}
	const extension = candidate.slice(candidate.lastIndexOf('.') + 1).toLowerCase();
	if (extension === 'exe' && statSync(candidate).size < 1_000_000) {
		return false;
	}
	return true;
}

/**
 * The CLI can ship inside the IDE install (like the desktop app does). Prefer that copy so
 * a fresh install works without a separately installed `loophole` binary.
 */
function bundledBinaryCandidates(): string[] {
	const name = process.platform === 'win32' ? 'loophole-cli.exe' : 'loophole-cli';
	const candidates: string[] = [];
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		candidates.push(join(resourcesPath, name));
	}
	// Development runs from the repo root.
	candidates.push(join(process.cwd(), 'resources', name));
	return candidates;
}

function resolveEngineBinary(): string | undefined {
	const overrides = [process.env.LOOPHOLE_BIN, process.env.LOOPHOLE_CLI_PATH].filter((value): value is string => !!value);
	return [...overrides, ...bundledBinaryCandidates(), ...binaryCandidates()].find((candidate) => existsSync(candidate));
}

let cached: EngineCredentials | undefined;
let connecting: Promise<EngineCredentials> | undefined;
let spawned: ChildProcess | undefined;

function waitForReady(child: ChildProcess, binary: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let buffer = '';
		let stderr = '';
		let settled = false;
		const timer = setTimeout(
			() => finish(new Error(`The Loophole engine at ${binary} did not become ready in time.${stderr ? ` Last output: ${stderr.trim()}` : ''}`)),
			60_000,
		);

		const cleanup = () => {
			clearTimeout(timer);
			child.stdout?.off('data', onStdout);
			child.stderr?.off('data', onStderr);
			child.off('exit', onExit);
			child.off('error', onError);
		};
		const finish = (error: Error | undefined, url?: string) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			if (error) {
				reject(error);
			} else {
				// Keep draining both pipes so a chatty server cannot block on a full pipe.
				child.stdout?.resume();
				child.stderr?.resume();
				resolve(url!);
			}
		};
		const onStdout = (chunk: string) => {
			buffer += chunk;
			let newline = buffer.indexOf('\n');
			while (newline !== -1) {
				const line = buffer.slice(0, newline).replace(/\r$/, '');
				buffer = buffer.slice(newline + 1);
				if (line.trim()) {
					try {
						const parsed = JSON.parse(line) as { url?: unknown };
						if (typeof parsed.url === 'string') {
							finish(undefined, parsed.url.replace(/\/+$/, ''));
							return;
						}
					} catch {
						// Servers are allowed to print human-readable startup lines too.
					}
				}
				newline = buffer.indexOf('\n');
			}
		};
		const onStderr = (chunk: string) => {
			stderr = (stderr + chunk).slice(-4_000);
		};
		const onExit = (code: number | null) => {
			finish(new Error(`The Loophole engine at ${binary} exited before it was ready (code ${code ?? 'unknown'})${stderr ? `: ${stderr.trim()}` : ''}`));
		};
		const onError = (error: Error) => finish(error);

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');
		child.stdout?.on('data', onStdout);
		child.stderr?.on('data', onStderr);
		child.once('exit', onExit);
		child.once('error', onError);
	});
}

async function spawnEngine(): Promise<EngineCredentials> {
	const binary = resolveEngineBinary();
	if (!binary) {
		throw new Error('Could not find the Loophole engine. Install the Loophole CLI or start the Loophole desktop app.');
	}

	const password = randomBytes(32).toString('base64url');
	const args = ['serve', '--stdio', '--port', '0'];
	const options = {
		cwd: process.cwd(),
		env: { ...process.env, OPENCODE_PASSWORD: password },
		stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
	};
	const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary);
	const child = isWindowsScript
		? spawn(`"${binary}" ${args.join(' ')}`, { ...options, shell: true })
		: spawn(binary, args, options);

	// The stdio lease ends when stdin closes; surface EPIPE as a normal exit instead.
	child.stdin?.on('error', () => undefined);

	spawned = child;
	child.once('exit', () => {
		if (spawned === child) {
			spawned = undefined;
			cached = undefined;
		}
	});

	try {
		const url = await waitForReady(child, binary);
		return { url, password };
	} catch (error) {
		// A server that never became ready must not linger and block the next attempt.
		try {
			child.stdin?.end();
			child.kill();
		} catch {
			// The child may already be gone.
		}
		if (spawned === child) {
			spawned = undefined;
		}
		throw error;
	}
}

async function doConnect(): Promise<EngineCredentials> {
	if (cached && await isLive(cached)) {
		return cached;
	}
	cached = undefined;

	for (const credentials of readRegistrations()) {
		if (await isLive(credentials)) {
			cached = credentials;
			return credentials;
		}
	}

	const credentials = await spawnEngine();
	cached = credentials;
	return credentials;
}

/** Attach to a running engine or start one. Concurrent callers share one attempt. */
export function connect(): Promise<EngineCredentials> {
	if (!connecting) {
		connecting = doConnect().finally(() => {
			connecting = undefined;
		});
	}
	return connecting;
}

export function stop(): void {
	const child = spawned;
	spawned = undefined;
	cached = undefined;
	if (!child) {
		return;
	}
	try {
		child.stdin?.end();
	} catch {
		// The child may already be gone.
	}
	try {
		child.kill();
	} catch {
		// The child may already be gone.
	}
}

/** The engine's catalog for the model picker. */
export async function listModels(credentials: EngineCredentials, directory?: string): Promise<EngineModel[]> {
	const raw = unwrap(await requestJson(credentials, `/api/model${locationQuery(directory)}`));
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.map(modelFromInfo)
		.filter((model): model is EngineModel => !!model);
}

/** The model a new session uses when no explicit model was chosen. */
export async function defaultModel(credentials: EngineCredentials, directory?: string): Promise<EngineModel | null> {
	const raw = unwrap(await requestJson(credentials, `/api/model/default${locationQuery(directory)}`));
	return modelFromInfo(raw) ?? null;
}

export async function createSession(
	credentials: EngineCredentials,
	input: {
		readonly directory?: string;
		readonly model?: EngineModelRef;
		readonly agent?: string;
		readonly title?: string;
	} = {},
): Promise<EngineSession> {
	const body: Record<string, unknown> = {};
	if (input.title) body.title = input.title;
	if (input.model) body.model = input.model;
	if (input.agent) body.agent = input.agent;
	if (input.directory) body.location = { directory: input.directory };

	const raw = unwrap(await requestJson(credentials, '/api/session', {
		method: 'POST',
		body: JSON.stringify(body),
	}));
	const session = recordField(raw);
	if (!session || typeof session.id !== 'string') {
		throw new Error('The Loophole engine did not return a session id.');
	}
	return { id: session.id, title: typeof session.title === 'string' ? session.title : undefined };
}

export async function switchModel(credentials: EngineCredentials, sessionID: string, model: EngineModelRef): Promise<void> {
	await requestVoid(credentials, `/api/session/${encodeURIComponent(sessionID)}/model`, {
		method: 'POST',
		body: JSON.stringify({ model }),
	});
}

export async function switchAgent(credentials: EngineCredentials, sessionID: string, agent: string): Promise<void> {
	await requestVoid(credentials, `/api/session/${encodeURIComponent(sessionID)}/agent`, {
		method: 'POST',
		body: JSON.stringify({ agent }),
	});
}

export async function removeSession(credentials: EngineCredentials, sessionID: string): Promise<void> {
	try {
		await requestVoid(credentials, `/api/session/${encodeURIComponent(sessionID)}`, { method: 'DELETE' });
	} catch (error) {
		if (!(error instanceof EngineRequestError) || error.status !== 404) {
			throw error;
		}
	}
}

/** Admit one user message. Events stream separately over subscribe(). */
export async function prompt(
	credentials: EngineCredentials,
	sessionID: string,
	text: string,
	id?: string,
	signal?: AbortSignal,
): Promise<void> {
	const body: Record<string, unknown> = { text };
	if (id) body.id = id;
	await requestVoid(credentials, `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
		method: 'POST',
		body: JSON.stringify(body),
		signal,
	});
}

export async function interrupt(credentials: EngineCredentials, sessionID: string): Promise<void> {
	await requestVoid(credentials, `/api/session/${encodeURIComponent(sessionID)}/interrupt`, { method: 'POST' });
}

export async function replyPermission(
	credentials: EngineCredentials,
	sessionID: string,
	requestID: string,
	decision: 'once' | 'always' | 'reject',
): Promise<void> {
	await requestVoid(credentials, `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, {
		method: 'POST',
		body: JSON.stringify({ decision }),
	});
}

/**
 * Decline an interactive form with model-facing feedback. The IDE chat has no form UI, so
 * cancelling with a message makes the engine continue instead of waiting forever.
 */
export async function cancelForm(
	credentials: EngineCredentials,
	sessionID: string,
	formID: string,
	message: string,
): Promise<void> {
	await requestVoid(
		credentials,
		`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}?message=${encodeURIComponent(message)}`,
		{ method: 'DELETE' },
	);
}

/** Stateless, tool-free generation. Used by quick edit / apply / commit messages. */
export async function generateText(
	credentials: EngineCredentials,
	promptText: string,
	model?: EngineModelRef,
	signal?: AbortSignal,
): Promise<string> {
	const body: Record<string, unknown> = { prompt: promptText };
	if (model) body.model = model;
	const raw = unwrap(await requestJson(credentials, '/api/experimental/generate', {
		method: 'POST',
		body: JSON.stringify(body),
		signal,
	}));
	const data = recordField(raw);
	if (!data || typeof data.text !== 'string') {
		throw new Error('The Loophole engine did not return generated text.');
	}
	return data.text;
}

/** Resolve a model picker name, falling back to the engine's default model. */
export async function resolveModelRef(
	credentials: EngineCredentials,
	modelName: string,
	directory?: string,
): Promise<EngineModelRef> {
	const parsed = parseModelRef(modelName);
	if (parsed) {
		return parsed;
	}
	const fallback = await defaultModel(credentials, directory);
	if (!fallback) {
		throw new Error('No model is available in the Loophole engine. Add a provider in the Loophole app first.');
	}
	return engineModelRef(fallback);
}

function handleEventFrame(frame: string, onEvent: (event: EngineEvent) => void): void {
	const data = frame
		.split('\n')
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trimStart())
		.join('\n');
	if (!data) {
		return;
	}
	try {
		const parsed = JSON.parse(data) as EngineEvent;
		if (parsed && typeof parsed.type === 'string') {
			onEvent(parsed);
		}
	} catch {
		// Ignore malformed frames; the next frame is independent.
	}
}

/**
 * Subscribe to the server's SSE feed. Resolves once the stream is connected, so callers
 * can subscribe before prompting without racing the first event. The returned function
 * closes the stream.
 */
export async function subscribe(
	credentials: EngineCredentials,
	onEvent: (event: EngineEvent) => void,
	onError?: (error: unknown) => void,
	signal?: AbortSignal,
): Promise<() => void> {
	const controller = new AbortController();
	const onExternalAbort = () => controller.abort();
	if (signal?.aborted) {
		controller.abort();
	} else {
		signal?.addEventListener('abort', onExternalAbort, { once: true });
	}
	const response = await request(credentials, '/api/event', {
		accept: 'text/event-stream',
		signal: controller.signal,
	});
	if (!response.body) {
		throw new Error('The Loophole engine event stream is unavailable.');
	}

	void (async () => {
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					if (!controller.signal.aborted) {
						onError?.(new Error('The Loophole engine event stream closed unexpectedly.'));
					}
					break;
				}
				buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
				let boundary = buffer.indexOf('\n\n');
				while (boundary !== -1) {
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					handleEventFrame(frame, onEvent);
					boundary = buffer.indexOf('\n\n');
				}
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				onError?.(error);
			}
		}
	})();

	return () => {
		signal?.removeEventListener('abort', onExternalAbort);
		controller.abort();
	};
}

function methodFromInfo(value: unknown): EngineIntegrationMethod | undefined {
	const info = recordField(value);
	if (!info || typeof info.type !== 'string') {
		return undefined;
	}
	const type = info.type;
	if (type === 'oauth' || type === 'command' || type === 'external') {
		if (typeof info.id !== 'string') {
			return undefined;
		}
		return { type, id: info.id, label: stringField(info.label) };
	}
	if (type === 'key') {
		return { type, label: stringField(info.label) };
	}
	if (type === 'env') {
		const names = Array.isArray(info.names)
			? info.names.filter((name): name is string => typeof name === 'string')
			: undefined;
		return { type, names };
	}
	return undefined;
}

function connectionFromInfo(value: unknown): EngineIntegrationConnection | undefined {
	const info = recordField(value);
	if (!info || typeof info.type !== 'string') {
		return undefined;
	}
	const needsAuth = recordField(info.status)?.status === 'needs_auth';
	if (info.type === 'credential') {
		if (typeof info.id !== 'string') {
			return undefined;
		}
		return {
			type: 'credential',
			id: info.id,
			label: stringField(info.label),
			method: stringField(info.method),
			needsAuth,
		};
	}
	if (info.type === 'env') {
		if (typeof info.name !== 'string') {
			return undefined;
		}
		return { type: 'env', name: info.name, needsAuth };
	}
	return undefined;
}

function integrationFromInfo(value: unknown): EngineIntegration | undefined {
	const info = recordField(value);
	if (!info || typeof info.id !== 'string' || typeof info.name !== 'string') {
		return undefined;
	}
	return {
		id: info.id,
		name: info.name,
		methods: Array.isArray(info.methods)
			? info.methods.map(methodFromInfo).filter((method): method is EngineIntegrationMethod => !!method)
			: [],
		connections: Array.isArray(info.connections)
			? info.connections.map(connectionFromInfo).filter((connection): connection is EngineIntegrationConnection => !!connection)
			: [],
	};
}

function credentialFromEntry(value: unknown): EngineCredential | undefined {
	const entry = recordField(value);
	if (!entry || typeof entry.id !== 'string' || typeof entry.integrationID !== 'string') {
		return undefined;
	}
	const kind = recordField(entry.value)?.type;
	return {
		id: entry.id,
		integrationID: entry.integrationID,
		label: stringField(entry.label) ?? '',
		active: entry.active === true,
		kind: kind === 'oauth' ? 'oauth' : kind === 'external' ? 'external' : 'key',
	};
}

function providerFromInfo(value: unknown): EngineProvider | undefined {
	const info = recordField(value);
	if (!info || typeof info.id !== 'string') {
		return undefined;
	}
	return {
		id: info.id,
		name: stringField(info.name) ?? info.id,
		integrationID: stringField(info.integrationID),
	};
}

function attemptStatusFromInfo(value: unknown): EngineOAuthAttemptStatus {
	const info = recordField(value);
	const status = stringField(info?.status);
	if (status === 'complete') {
		return { status: 'complete' };
	}
	if (status === 'failed') {
		return { status: 'failed', message: stringField(info?.message) };
	}
	if (status === 'expired') {
		return { status: 'expired' };
	}
	return { status: 'pending' };
}

export async function listIntegrations(credentials: EngineCredentials, directory?: string): Promise<EngineIntegration[]> {
	const raw = unwrap(await requestJson(credentials, `/api/integration${locationQuery(directory)}`));
	return Array.isArray(raw)
		? raw.map(integrationFromInfo).filter((integration): integration is EngineIntegration => !!integration)
		: [];
}

export async function getIntegration(
	credentials: EngineCredentials,
	integrationID: string,
	directory?: string,
): Promise<EngineIntegration> {
	const raw = unwrap(await requestJson(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}${locationQuery(directory)}`,
	));
	const integration = integrationFromInfo(raw);
	if (!integration) {
		throw new Error(`The Loophole engine returned an unknown shape for integration ${integrationID}.`);
	}
	return integration;
}

export async function connectWithKey(
	credentials: EngineCredentials,
	integrationID: string,
	key: string,
	directory?: string,
	label?: string,
): Promise<void> {
	const body: Record<string, unknown> = { key };
	if (label) body.label = label;
	await requestVoid(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/key${locationQuery(directory)}`,
		{ method: 'POST', body: JSON.stringify(body) },
	);
}

export async function connectWithExternal(
	credentials: EngineCredentials,
	integrationID: string,
	methodID: string,
	directory?: string,
	label?: string,
): Promise<void> {
	const body: Record<string, unknown> = { methodID };
	if (label) body.label = label;
	await requestVoid(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/external${locationQuery(directory)}`,
		{ method: 'POST', body: JSON.stringify(body) },
	);
}

export async function beginOAuth(
	credentials: EngineCredentials,
	integrationID: string,
	methodID: string,
	directory?: string,
	label?: string,
): Promise<EngineOAuthAttempt> {
	const body: Record<string, unknown> = { methodID };
	if (label) body.label = label;
	const raw = unwrap(await requestJson(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/oauth${locationQuery(directory)}`,
		{ method: 'POST', body: JSON.stringify(body) },
	));
	const attempt = recordField(raw);
	if (!attempt || typeof attempt.attemptID !== 'string' || typeof attempt.url !== 'string') {
		throw new Error('The Loophole engine did not return an authorization attempt.');
	}
	const time = recordField(attempt.time);
	return {
		attemptID: attempt.attemptID,
		url: attempt.url,
		instructions: stringField(attempt.instructions) ?? '',
		mode: attempt.mode === 'code' ? 'code' : 'auto',
		expires: numberField(time?.expires),
	};
}

export async function oauthStatus(
	credentials: EngineCredentials,
	integrationID: string,
	attemptID: string,
	directory?: string,
): Promise<EngineOAuthAttemptStatus> {
	const raw = unwrap(await requestJson(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/oauth/${encodeURIComponent(attemptID)}${locationQuery(directory)}`,
	));
	return attemptStatusFromInfo(raw);
}

export async function completeOAuth(
	credentials: EngineCredentials,
	integrationID: string,
	attemptID: string,
	code: string | undefined,
	directory?: string,
): Promise<void> {
	const body: Record<string, unknown> = {};
	if (code) body.code = code;
	await requestVoid(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/oauth/${encodeURIComponent(attemptID)}/complete${locationQuery(directory)}`,
		{ method: 'POST', body: JSON.stringify(body) },
	);
}

export async function cancelOAuth(
	credentials: EngineCredentials,
	integrationID: string,
	attemptID: string,
	directory?: string,
): Promise<void> {
	await requestVoid(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/oauth/${encodeURIComponent(attemptID)}${locationQuery(directory)}`,
		{ method: 'DELETE' },
	);
}

export async function beginCommand(
	credentials: EngineCredentials,
	integrationID: string,
	methodID: string,
	directory?: string,
	label?: string,
): Promise<{ readonly attemptID: string }> {
	const body: Record<string, unknown> = { methodID };
	if (label) body.label = label;
	const raw = unwrap(await requestJson(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/command${locationQuery(directory)}`,
		{ method: 'POST', body: JSON.stringify(body) },
	));
	const attemptID = stringField(recordField(raw)?.attemptID);
	if (!attemptID) {
		throw new Error('The Loophole engine did not return a connection attempt.');
	}
	return { attemptID };
}

export async function commandStatus(
	credentials: EngineCredentials,
	integrationID: string,
	attemptID: string,
	directory?: string,
): Promise<EngineOAuthAttemptStatus> {
	const raw = unwrap(await requestJson(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/command/${encodeURIComponent(attemptID)}${locationQuery(directory)}`,
	));
	return attemptStatusFromInfo(raw);
}

export async function cancelCommand(
	credentials: EngineCredentials,
	integrationID: string,
	attemptID: string,
	directory?: string,
): Promise<void> {
	await requestVoid(
		credentials,
		`/api/integration/${encodeURIComponent(integrationID)}/connect/command/${encodeURIComponent(attemptID)}${locationQuery(directory)}`,
		{ method: 'DELETE' },
	);
}

export async function listCredentials(credentials: EngineCredentials, directory?: string): Promise<EngineCredential[]> {
	const raw = unwrap(await requestJson(credentials, '/api/credential'));
	return Array.isArray(raw)
		? raw.map(credentialFromEntry).filter((credential): credential is EngineCredential => !!credential)
		: [];
}

export async function renameCredential(
	credentials: EngineCredentials,
	credentialID: string,
	label: string,
	directory?: string,
): Promise<void> {
	await requestVoid(
		credentials,
		`/api/credential/${encodeURIComponent(credentialID)}${locationQuery(directory)}`,
		{ method: 'PATCH', body: JSON.stringify({ label }) },
	);
}

export async function activateCredential(
	credentials: EngineCredentials,
	credentialID: string,
	directory?: string,
): Promise<void> {
	await requestVoid(
		credentials,
		`/api/credential/${encodeURIComponent(credentialID)}/activate${locationQuery(directory)}`,
		{ method: 'POST' },
	);
}

export async function removeCredential(
	credentials: EngineCredentials,
	credentialID: string,
	directory?: string,
): Promise<void> {
	await requestVoid(
		credentials,
		`/api/credential/${encodeURIComponent(credentialID)}${locationQuery(directory)}`,
		{ method: 'DELETE' },
	);
}

export async function listProviders(credentials: EngineCredentials, directory?: string): Promise<EngineProvider[]> {
	const raw = unwrap(await requestJson(credentials, `/api/provider${locationQuery(directory)}`));
	return Array.isArray(raw)
		? raw.map(providerFromInfo).filter((provider): provider is EngineProvider => !!provider)
		: [];
}
