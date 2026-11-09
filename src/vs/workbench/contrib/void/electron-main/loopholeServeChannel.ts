/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// registered in app.ts next to LLMMessageChannel; consumed by LoopholeServeService (renderer)

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { createServer, request, type IncomingMessage } from 'http';
import { randomBytes } from 'crypto';
import * as path from 'path';
import type { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import type { LoopholeServeConfigUpdateParams, LoopholeServeConnectKeyParams, LoopholeServeConnectParams, LoopholeServeFimParams, LoopholeServeStatus } from '../common/loopholeServeTypes.js';

// Direct Inception FIM endpoint (loophole serve has no FIM endpoint).
const INCEPTION_FIM_URL = 'https://api.inceptionlabs.ai/v1/fim/completions';

// Module-level accessor so main-process helpers (llmMessage/loopholeServeChat.ts) can reuse
// this channel's connection without a second registry.
let currentChannel: LoopholeServeChannel | null = null;

export function getLoopholeServeChannel(): LoopholeServeChannel | null {
	return currentChannel;
}

type ServeState = 'disconnected' | 'starting' | 'connected' | 'error';

class LoopholeServeHandle {
	readonly process: ChildProcess | null;
	readonly port: number;
	readonly password: string;
	readonly dispose: () => void;
	readonly onEvent: Emitter<unknown>;

	constructor(opts: { process: ChildProcess | null; port: number; password: string; dispose: () => void; onEvent: Emitter<unknown> }) {
		this.process = opts.process;
		this.port = opts.port;
		this.password = opts.password;
		this.dispose = opts.dispose;
		this.onEvent = opts.onEvent;
	}
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

/** Bundled binary (Phase 4 packaging drops it here), then overrides, then PATH. */
function resolveBinary(explicit?: string): string {
	if (explicit) return explicit;
	if (process.env.LOOPHOLE_SERVE_BIN) return process.env.LOOPHOLE_SERVE_BIN;
	const exe = process.platform === 'win32' ? 'loophole.exe' : 'loophole';
	// appRoot is <install>/resources/app in a packaged build (vs code app layout)
	const appRoot = path.resolve(path.dirname(process.execPath), '..', '..', 'resources', 'app');
	const bundled = path.join(appRoot, 'bin', exe);
	if (existsSync(bundled)) return bundled;
	return 'loophole';
}

export class LoopholeServeChannel implements IServerChannel {

	private handle: LoopholeServeHandle | null = null;
	private state: ServeState = 'disconnected';
	private statusError: string | undefined = undefined;
	private readonly _onEvent = new Emitter<unknown>();
	// requestId -> FIM abort controllers (cancel on new request / on fimAbort)
	private readonly _fimControllers = new Map<string, AbortController>();

	constructor() {
		currentChannel = this;
	}

	// browser never listens today; surface exists so Phase 2 can stream SSE frames without a channel rewire
	listen(_: unknown, event: string): Event<any> {
		if (event === 'onEvent_loopholeServe') return this._onEvent.event;
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		if (command === 'connect') return this._callConnect(params);
		if (command === 'disconnect') return this._callDisconnect();
		if (command === 'status') return this._callStatus();
		if (command === 'providers') return this._callProviders();
		if (command === 'models') return this._callModels();
		if (command === 'defaultModel') return this._callDefaultModel();
		if (command === 'configUpdate') return this._callConfigUpdate(params);
		if (command === 'connectKey') return this._callConnectKey(params);
		if (command === 'fim') return this._callFim(params);
		if (command === 'fimAbort') return this._callFimAbort(params);
		throw new Error(`LoopholeServe: command "${command}" not recognized.`);
	}

	private _callStatus(): LoopholeServeStatus {
		return {
			status: this.state,
			port: this.handle?.port,
			error: this.statusError,
			binaryPath: resolveBinary(),
			pid: this.handle?.process?.pid,
		};
	}

	private async _callDisconnect(): Promise<void> {
		this._teardown('disconnected');
	}

	private _teardown(next: ServeState) {
		const handle = this.handle;
		this.handle = null;
		this.state = next;
		if (handle) {
			try { handle.dispose(); } catch { /* best effort */ }
			if (handle.process && !handle.process.killed) {
				handle.process.kill();
			}
		}
		if (next !== 'error') this.statusError = undefined;
	}

	private _basicAuth(password: string): string {
		return 'Basic ' + Buffer.from(`loophole:${password}`, 'utf8').toString('base64');
	}

	/** Public helper for main-process callers (e.g. llmMessage/loopholeServeChat.ts). */
	connectionInfo(): { port: number; password: string } | null {
		if (!this.handle || this.state !== 'connected') return null;
		return { port: this.handle.port, password: this.handle.password };
	}

	/**
	 * JSON request against the running server. `Location.response(...)` and most
	 * other groups wrap payloads as `{ data }` (see packages/schema/src/location.ts),
	 * so the envelope is unwrapped here; `204 No Content` resolves to undefined.
	 */
	async serveApi<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', urlPath: string, body?: unknown): Promise<T> {
		const connection = this.connectionInfo();
		if (!connection) throw new Error('Loophole Serve is not connected.');
		const raw = await this._httpJson(connection.port, connection.password, method, urlPath, body);
		return this._unwrapData<T>(raw, urlPath);
	}

	private _unwrapData<T>(parsed: unknown, urlPath: string): T {
		if (parsed === undefined) return undefined as T;
		if (parsed !== null && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
			return (parsed as { data: T }).data;
		}
		return parsed as T;
	}

	private _httpJson(port: number, password: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const payload = body === undefined ? undefined : JSON.stringify(body);
			const req = request({
				hostname: '127.0.0.1',
				port,
				path: urlPath,
				method,
				headers: {
					Authorization: this._basicAuth(password),
					...(payload !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
				},
				timeout: 30000,
			}, (res: IncomingMessage) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(`Loophole Serve ${method} ${urlPath} failed (${res.statusCode}): ${text.slice(0, 500)}`));
						return;
					}
					if (!text) {
						resolve(undefined);
						return;
					}
					try {
						resolve(JSON.parse(text));
					} catch {
						resolve(text);
					}
				});
			});
			req.on('error', reject);
			req.on('timeout', () => req.destroy(new Error(`timed out waiting for ${urlPath}`)));
			if (payload !== undefined) req.write(payload);
			req.end();
		});
	}

	private _httpGet(port: number, password: string, urlPath: string): Promise<number> {
		return new Promise((resolve, reject) => {
			const req = request({
				hostname: '127.0.0.1',
				port,
				path: urlPath,
				method: 'GET',
				headers: { Authorization: this._basicAuth(password) },
				timeout: 3000,
			}, (res: IncomingMessage) => resolve(res.statusCode ?? 0));
			req.on('error', reject);
			req.on('timeout', () => req.destroy(new Error(`timed out waiting for ${urlPath}`)));
			req.end();
		});
	}

	private async _waitReady(port: number, password: string, proc: ChildProcess, deadlineMs: number): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < deadlineMs) {
			if (proc.exitCode !== null) throw new Error(`loophole serve exited with code ${proc.exitCode}`);
			try {
				// any answered request proves the server is up; 401 means auth works, 404 means the port is ours but route changed
				const status = await this._httpGet(port, password, '/api/session/active');
				if (status >= 200 && status < 500) return;
			} catch { /* not up yet */ }
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error('loophole serve did not become ready in time');
	}

	private async _callConnect(params: LoopholeServeConnectParams = {}): Promise<LoopholeServeStatus> {
		if (this.state === 'connected' && this.handle) return this._callStatus();
		if (this.state === 'starting') return this._callStatus(); // already connecting; caller retries status()
		this._teardown('starting');
		this.state = 'starting';

		const binary = resolveBinary(params.binaryPath);
		const password = randomBytes(24).toString('base64url');
		const port = await freePort();
		const cwd = params.workspacePath ?? process.cwd();
		const env = { ...process.env, ...params.env };

		console.log(`[LoopholeServe] spawning ${binary} serve --port ${port} in ${cwd}`);

		const proc = spawn(binary, ['serve', '--port', String(port)], {
			cwd,
			env,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		proc.stdout?.on('data', (chunk) => console.log(`[LoopholeServe] ${String(chunk).trim()}`));
		proc.stderr?.on('data', (chunk) => console.warn(`[LoopholeServe] ${String(chunk).trim()}`));
		proc.on('error', (err) => {
			if (this.handle?.process === proc) {
				this._teardown('error');
				this.statusError = `failed to spawn ${binary}: ${err.message}`;
				console.warn(`[LoopholeServe] spawn failed: ${err.message}`);
			}
		});
		proc.on('exit', (code) => {
			if (this.handle?.process === proc) {
				this._teardown('error');
				this.statusError = `loophole serve exited with code ${code}`;
			}
		});

		const onEvent = this._onEvent;
		this.handle = new LoopholeServeHandle({
			process: proc,
			port,
			password,
			dispose: () => { /* process killed in teardown; nothing else held */ },
			onEvent,
		});

		try {
			await this._waitReady(port, password, proc, 30_000);
			this.state = 'connected';
			console.log(`[LoopholeServe] connected on port ${port}`);
		} catch (e) {
			this._teardown('error');
			this.statusError = e instanceof Error ? e.message : String(e);
			console.warn(`[LoopholeServe] failed to start: ${this.statusError}`);
		}
		return this._callStatus();
	}

	// ---- Phase 1: providers / models from the server (server owns config) ----

	private async _callProviders(): Promise<unknown> {
		return this.serveApi('GET', '/api/provider');
	}

	private async _callModels(): Promise<unknown> {
		return this.serveApi('GET', '/api/model');
	}

	private async _callDefaultModel(): Promise<unknown> {
		return this.serveApi('GET', '/api/model/default');
	}

	// Config.Patch only supports `shell`; kept for spec + for any future patchable fields.
	private async _callConfigUpdate(params: LoopholeServeConfigUpdateParams): Promise<void> {
		await this.serveApi('PATCH', '/api/experimental/config', params ?? {});
	}

	// Provider keys are stored via the integration connect endpoint, not the config patch.
	private async _callConnectKey(params: LoopholeServeConnectKeyParams): Promise<void> {
		const integrationID = encodeURIComponent(params.integrationID);
		await this.serveApi('POST', `/api/integration/${integrationID}/connect/key`, { key: params.key, ...(params.label ? { label: params.label } : {}) });
	}

	// ---- Phase 3: direct Inception FIM (streaming, abortable by requestId) ----

	private _callFim(params: LoopholeServeFimParams): Promise<void> {
		const { requestId, prefix, suffix, apiKey } = params;
		const model = params.model ?? 'mercury-edit-2';
		const maxTokens = params.maxTokens ?? 256;
		const temperature = params.temperature ?? 0;
		if (!apiKey) {
			this._onEvent.fire({ kind: 'fim', requestId, type: 'error', error: 'No Inception API key configured (loophole.fim.apiKey).' });
			return Promise.resolve();
		}
		// cancel any prior request under the same id (abort on retype)
		this._fimControllers.get(requestId)?.abort();
		const controller = new AbortController();
		this._fimControllers.set(requestId, controller);
		return this._runFim({ requestId, controller, prefix, suffix, apiKey, model, maxTokens, temperature })
			.finally(() => {
				if (this._fimControllers.get(requestId) === controller) this._fimControllers.delete(requestId);
			});
	}

	private async _runFim(args: { requestId: string; controller: AbortController; prefix: string; suffix: string; apiKey: string; model: string; maxTokens: number; temperature: number }): Promise<void> {
		const { requestId, controller, prefix, suffix, apiKey, model, maxTokens, temperature } = args;
		let fullText = '';
		try {
			const response = await fetch(INCEPTION_FIM_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ model, prompt: prefix, suffix, max_tokens: maxTokens, temperature, stream: true }),
				signal: controller.signal,
			});
			if (!response.ok || !response.body) {
				const detail = await response.text().catch(() => '');
				throw new Error(`Inception FIM failed (${response.status}): ${detail.slice(0, 500)}`);
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data:')) continue;
					const data = trimmed.slice(5).trim();
					if (!data || data === '[DONE]') continue;
					let chunk: { choices?: Array<{ delta?: { content?: unknown }; text?: unknown }> } | undefined;
					try {
						chunk = JSON.parse(data);
					} catch { continue; }
					const choice = chunk?.choices?.[0];
					const content = choice?.delta?.content ?? choice?.text;
					if (typeof content === 'string' && content) {
						fullText += content;
						this._onEvent.fire({ kind: 'fim', requestId, type: 'chunk', text: content });
					}
				}
			}
			if (!controller.signal.aborted) {
				this._onEvent.fire({ kind: 'fim', requestId, type: 'final', text: fullText });
			}
		} catch (e) {
			if (controller.signal.aborted) {
				this._onEvent.fire({ kind: 'fim', requestId, type: 'error', error: 'aborted' });
				return;
			}
			this._onEvent.fire({ kind: 'fim', requestId, type: 'error', error: e instanceof Error ? e.message : String(e) });
		}
	}

	private _callFimAbort(params: { requestId: string }): Promise<void> {
		const controller = params?.requestId ? this._fimControllers.get(params.requestId) : undefined;
		controller?.abort();
		if (controller && params.requestId) this._fimControllers.delete(params.requestId);
		return Promise.resolve();
	}
}

