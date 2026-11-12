/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// registered in app.ts next to LLMMessageChannel; consumed by LoopholeCliService (renderer)

import { execFile, spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { createServer, request, type IncomingMessage } from 'http';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { WebSocket } from 'ws';
import type { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import type { LoopholeCliConfig, LoopholeCliConfigUpdateParams, LoopholeCliConnectKeyParams, LoopholeCliConnectParams, LoopholeCliFimParams, LoopholeCliStatus, LoopholeCliVoiceWsEvent } from '../common/loopholeCliTypes.js';
import type { LoopholeCliCommandInfo, LoopholeCliPermissionDecision, LoopholeCliPermissionRequest, LoopholeCliSessionInfo, LoopholeCliSessionMessage, LoopholeCliSkillInfo, LoopholeCliUpdateInfo, LoopholeCliUpdateResult, LoopholeCliVoiceModel, LoopholeCliVoiceTransport, LoopholeCliRevert } from '../common/loopholeCliTypes.js';

// Direct Inception FIM endpoint (the CLI has no FIM endpoint).
const INCEPTION_FIM_URL = 'https://api.inceptionlabs.ai/v1/fim/completions';

// Module-level accessor so main-process helpers (llmMessage/loopholeCliChat.ts) can reuse
// this channel's connection without a second registry.
let currentChannel: LoopholeCliChannel | null = null;

export function getLoopholeCliChannel(): LoopholeCliChannel | null {
	return currentChannel;
}

type CliState = 'disconnected' | 'starting' | 'connected' | 'error';

class LoopholeCliHandle {
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

/** Bundled binary, then overrides, then PATH - but only if it really is the Loophole CLI. */
function resolveBinary(explicit?: string): string {
	if (explicit) return explicit;
	if (process.env.LOOPHOLE_CLI_BIN) return process.env.LOOPHOLE_CLI_BIN;
	const exe = process.platform === 'win32' ? 'loophole.exe' : 'loophole';
	const cliExe = process.platform === 'win32' ? 'loophole-cli.exe' : 'loophole-cli';
	// A packaged build puts the app in <install>/resources/app next to the
	// executable, so every candidate is resolved from there - not from two
	// directories above it, which only worked for the dev electron layout.
	const dir = path.dirname(process.execPath);
	const candidates = [
		path.join(dir, 'resources', 'app', 'bin', cliExe),
		path.join(dir, 'resources', 'app', 'bin', exe),
		path.join(dir, 'resources', cliExe),
		path.join(dir, 'resources', exe),
		path.join(dir, 'bin', cliExe),
	]
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate
	}
	// Nothing bundled: fall back to PATH, but the probe rejects the editor's own
	// `loophole` shim, which shares the name and would exit 0 on `serve`.
	const onPath = ['loophole-cli', exe, cliExe].find((name) => isLoopholeCli(name))
	return onPath ?? cliExe
}

/**
 * True when `binary` answers `--version` like the Loophole CLI.
 *
 * The editor ships its own `loophole` command (the VS Code CLI shim). Running
 * `loophole serve` through that shim starts the editor CLI, which knows no
 * `serve` subcommand and exits 0 - the exact "exited code 0" failure. Probing
 * `--version` distinguishes them cheaply.
 */
function isLoopholeCli(binary: string): boolean {
	const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
	const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.toLowerCase()
	return out.includes('loophole-cli')
}

export class LoopholeCliChannel implements IServerChannel {

	private handle: LoopholeCliHandle | null = null;
	private state: CliState = 'disconnected';
	private statusError: string | undefined = undefined;
	private readonly _onEvent = new Emitter<unknown>();
	// requestId -> FIM abort controllers (cancel on new request / on fimAbort)
	private readonly _fimControllers = new Map<string, AbortController>();
	// requestId -> proxied voice WebSockets (provider realtime audio; browser WS cannot set Authorization headers)
	private readonly _voiceWsSockets = new Map<string, WebSocket>();

	constructor() {
		currentChannel = this;
	}

	// browser never listens today; surface exists so Phase 2 can stream SSE frames without a channel rewire
	listen(_: unknown, event: string): Event<any> {
		if (event === 'onEvent_loopholeCli') return this._onEvent.event;
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		if (command === 'connect') return this._callConnect(params);
		if (command === 'disconnect') return this._callDisconnect();
		if (command === 'status') return this._callStatus();
		if (command === 'version') return this._callVersion();
		if (command === 'config') return this._callConfig();
		if (command === 'providers') return this._callProviders();
		if (command === 'models') return this._callModels();
		if (command === 'integrations') return this._callIntegrations();
		if (command === 'configUpdate') return this._callConfigUpdate(params);
		if (command === 'connectKey') return this._callConnectKey(params);
		if (command === 'credentialRemove') return this._callCredentialRemove(params);
		if (command === 'fim') return this._callFim(params);
		if (command === 'fimAbort') return this._callFimAbort(params);
		// ---- sessions / messages / commands / skills / revert / permission / usage / voice ----
		if (command === 'sessions') return this._callSessions(params);
		if (command === 'sessionGet') return this._callSessionGet(params);
		if (command === 'sessionMessages') return this._callSessionMessages(params);
		if (command === 'sessionContext') return this._callSessionContext(params);
		if (command === 'sessionCreate') return this._callSessionCreate(params);
		if (command === 'sessionDelete') return this._callSessionDelete(params);
		if (command === 'sessionFork') return this._callSessionFork(params);
		if (command === 'sessionRename') return this._callSessionRename(params);
		if (command === 'commands') return this._callCommands();
		if (command === 'skills') return this._callSkills();
		if (command === 'runCommand') return this._callRunCommand(params);
		if (command === 'activateSkill') return this._callActivateSkill(params);
		if (command === 'revertStage') return this._callRevertStage(params);
		if (command === 'revertClear') return this._callRevertClear(params);
		if (command === 'revertCommit') return this._callRevertCommit(params);
		if (command === 'permissionList') return this._callPermissionList(params);
		if (command === 'permissionReply') return this._callPermissionReply(params);
		if (command === 'voiceModels') return this._callVoiceModels();
		if (command === 'voiceSession') return this._callVoiceSession(params);
		if (command === 'voiceWsConnect') return this._callVoiceWsConnect(params);
		if (command === 'voiceWsSend') return this._callVoiceWsSend(params);
		if (command === 'voiceWsClose') return this._callVoiceWsClose(params);
		if (command === 'updateCheck') return this._callUpdateCheck();
		if (command === 'updateInstall') return this._callUpdateInstall(params);
		throw new Error(`LoopholeCli: command "${command}" not recognized.`);
	}

	private _callStatus(): LoopholeCliStatus {
		return {
			status: this.state,
			port: this.handle?.port,
			error: this.statusError,
			binaryPath: resolveBinary(),
			pid: this.handle?.process?.pid,
		};
	}

	/** Runs `<binary> --version`; the CLI is the only thing needed to answer this. */
	private _callVersion(): Promise<string> {
		const binary = resolveBinary();
		return new Promise((resolve) => {
			execFile(binary, ['--version'], { windowsHide: true, timeout: 10_000 }, (_error, stdout) => {
				const line = String(stdout ?? '').trim().split('\n')[0];
				if (line) {
					resolve(line);
					return;
				}
				resolve('unknown');
			});
		});
	}

	/**
	 * Pick the session database the CLI should open.
	 *
	 * `databasePath()` derives the file name from the build channel
	 * (`loophole.db` for prod, `loophole-<channel>.db` otherwise), so a release
	 * built on a different channel silently opens an empty database and every
	 * session and statistic looks wiped after an update. Pinning `OPENCODE_DB` to
	 * the existing file with the most data keeps history across upgrades and
	 * across the CLI, desktop app and editor.
	 */
	private _resolveDatabase(): string | undefined {
		try {
			const dir = path.join(homedir(), '.local', 'share', 'loophole');
			const files = readdirSync(dir)
				.filter((name) => /^loophole.*\.db$/.test(name))
				.map((name) => ({ name, size: statSync(path.join(dir, name)).size }))
				.sort((a, b) => b.size - a.size);
			return files[0]?.name;
		} catch {
			return undefined;
		}
	}

	private async _callDisconnect(): Promise<void> {
		this._teardown('disconnected');
	}

	/**
	 * Compare the installed CLI with the latest published release.
	 *
	 * Reads the npm registry (the same source `upgrade` installs from) and the
	 * GitHub release body for notes, so the editor can announce a new release
	 * without bundling a changelog of its own.
	 */
	private async _callUpdateCheck(): Promise<LoopholeCliUpdateInfo> {
		const current = await this._callVersion();
		const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(current);
		const installed = match ? match[1] : '';
		try {
			const response = await fetch('https://registry.npmjs.org/@loophole-ai/cli/latest', {
				headers: { accept: 'application/json', 'user-agent': `loophole/${installed || 'unknown'}` },
			});
			if (!response.ok) throw new Error(`registry responded ${response.status}`);
			const pkg = (await response.json()) as { version?: string };
			const latest = pkg.version ?? '';
			const updateAvailable = !!latest && !!installed && latest !== installed;
			let notes: string | undefined;
			if (updateAvailable) {
				notes = await this._releaseNotes(latest, installed);
			}
			return {
				current: installed || current,
				latest,
				updateAvailable,
				notes,
				url: latest ? `https://github.com/loophole-ai/cli/releases/tag/v${latest}` : undefined,
			};
		} catch (e) {
			return {
				current: installed || current,
				latest: '',
				updateAvailable: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	}

	/** Release body for a version; notes are optional, so failures are swallowed. */
	private async _releaseNotes(version: string, installed: string): Promise<string | undefined> {
		try {
			const response = await fetch(`https://api.github.com/repos/loophole-ai/cli/releases/tags/v${version}`, {
				headers: { accept: 'application/vnd.github+json', 'user-agent': `loophole/${installed || 'unknown'}` },
			});
			if (!response.ok) return undefined;
			const body = (await response.json()) as { body?: string };
			return body.body ?? undefined;
		} catch {
			return undefined;
		}
	}

	/** Run `<binary> upgrade <version>` and restart the CLI so the new build takes over. */
	private async _callUpdateInstall(params: { version?: string } = {}): Promise<LoopholeCliUpdateResult> {
		const binary = resolveBinary();
		const version = (params.version ?? '').trim();
		const args = version ? ['upgrade', version] : ['upgrade'];
		const output = await new Promise<string>((resolve) => {
			execFile(binary, args, { windowsHide: true, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
				resolve(`${stdout ?? ''}${stderr ?? ''}${error ? `\n${error.message}` : ''}`.trim());
			});
		});
		const failed = /\b(failed|timed out)\b/i.test(output);
		if (!failed) {
			// The running process still serves the old binary; restart it so the new
			// version answers and the status page reflects reality.
			const wasConnected = this.state === 'connected';
			this._teardown('disconnected');
			if (wasConnected) await this._callConnect({});
		}
		return { ok: !failed, version, output };
	}

	private _teardown(next: CliState) {
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

	/** Public helper for main-process callers (e.g. llmMessage/loopholeCliChat.ts). */
	connectionInfo(): { port: number; password: string } | null {
		if (!this.handle || this.state !== 'connected') return null;
		return { port: this.handle.port, password: this.handle.password };
	}

	/**
	 * JSON request against the running server. `Location.response(...)` and most
	 * other groups wrap payloads as `{ data }` (see packages/schema/src/location.ts),
	 * so the envelope is unwrapped here; `204 No Content` resolves to undefined.
	 */
	async cliApi<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', urlPath: string, body?: unknown): Promise<T> {
		const connection = this.connectionInfo();
		if (!connection) throw new Error('Loophole CLI is not connected.');
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
						reject(new Error(`Loophole CLI ${method} ${urlPath} failed (${res.statusCode}): ${text.slice(0, 500)}`));
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
			if (proc.exitCode !== null) {
				throw new Error(
					proc.exitCode === 0
						? 'The resolved binary is not the Loophole CLI: it exited immediately. Install the Loophole CLI, or point LOOPHOLE_CLI_BIN at it.'
						: `Loophole CLI exited with code ${proc.exitCode}`,
				)
			}
			try {
				// any answered request proves the server is up; 401 means auth works, 404 means the port is ours but route changed
				const status = await this._httpGet(port, password, '/api/session/active');
				if (status >= 200 && status < 500) return;
			} catch { /* not up yet */ }
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error('Loophole CLI did not become ready in time');
	}

	private async _callConnect(params: LoopholeCliConnectParams = {}): Promise<LoopholeCliStatus> {
		if (this.state === 'connected' && this.handle) return this._callStatus();
		if (this.state === 'starting') {
			// Another caller is already spawning the CLI; wait for that attempt instead of failing.
			const deadline = Date.now() + 120_000;
			while (this.state === 'starting' && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			return this._callStatus();
		}
		this._teardown('starting');
		this.state = 'starting';

		const binary = resolveBinary(params.binaryPath);
		const password = randomBytes(24).toString('base64url');
		const port = await freePort();
		const cwd = params.workspacePath ?? process.cwd();
		// The server refuses to boot without a password (ServerProcess.run fails
		// with "Missing server password"), and every request is Basic-authenticated
		// against it, so the same secret has to be handed to the child.
		const env = { ...process.env, ...params.env, OPENCODE_SERVER_PASSWORD: password };
		if (!env.OPENCODE_DB) {
			const database = this._resolveDatabase();
			if (database) env.OPENCODE_DB = database;
		}

		console.log(`[LoopholeCli] spawning ${binary} serve --port ${port} in ${cwd}`);

		const proc = spawn(binary, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
			cwd,
			env,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		proc.stdout?.on('data', (chunk) => console.log(`[LoopholeCli] ${String(chunk).trim()}`));
		proc.stderr?.on('data', (chunk) => console.warn(`[LoopholeCli] ${String(chunk).trim()}`));
		proc.on('error', (err) => {
			if (this.handle?.process === proc) {
				this._teardown('error');
				this.statusError = `failed to spawn ${binary}: ${err.message}`;
				console.warn(`[LoopholeCli] spawn failed: ${err.message}`);
			}
		});
		proc.on('exit', (code) => {
			if (this.handle?.process === proc) {
				this._teardown('error');
				this.statusError = `Loophole CLI exited with code ${code}`;
			}
		});

		const onEvent = this._onEvent;
		this.handle = new LoopholeCliHandle({
			process: proc,
			port,
			password,
			dispose: () => { /* process killed in teardown; nothing else held */ },
			onEvent,
		});

		try {
			await this._waitReady(port, password, proc, 120_000);
			this.state = 'connected';
			console.log(`[LoopholeCli] connected on port ${port}`);
		} catch (e) {
			this._teardown('error');
			this.statusError = e instanceof Error ? e.message : String(e);
			console.warn(`[LoopholeCli] failed to start: ${this.statusError}`);
		}
		return this._callStatus();
	}

	// ---- Phase 1: providers / models from the server (server owns config) ----

	/**
	 * Retry a read while the CLI's Location plugin is still activating.
	 *
	 * The CLI answers 503 `{ _tag: "ServiceUnavailableError", message: "Location
	 * plugin did not finish activating" }` for the first seconds after startup,
	 * and a single-shot read then fails in the UI even though the CLI is healthy
	 * (clicking "Check again" worked). Waiting it out here keeps every caller simple.
	 */
	private async _callWhenReady<T>(read: () => Promise<T>): Promise<T> {
		const deadline = Date.now() + 20_000;
		for (;;) {
			try {
				return await read()
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e)
				const transient = /\(503\)/.test(message) || /did not finish activating/i.test(message)
				if (!transient || Date.now() > deadline) throw e
			}
			await new Promise((resolve) => setTimeout(resolve, 400))
		}
	}

	private async _callProviders(): Promise<unknown> {
		return this._callWhenReady(() => this.cliApi('GET', '/api/provider'))
	}

	private async _callModels(): Promise<unknown> {
		return this._callWhenReady(() => this.cliApi('GET', '/api/model'))
	}

	// Connectable integrations (auth methods + current connections) for the provider settings UI.
	private async _callIntegrations(): Promise<unknown> {
		return this._callWhenReady(() => this.cliApi('GET', '/api/integration'))
	}

	// Read the CLI's live config (models, compaction, commit message prompt).
	private async _callConfig(): Promise<LoopholeCliConfig> {
		try {
			return await this.cliApi<LoopholeCliConfig>('GET', '/api/config');
		} catch (e) {
			// Older CLI builds expose config under the experimental prefix only.
			if (!/\(404\)/.test(e instanceof Error ? e.message : String(e))) throw e;
			return this.cliApi<LoopholeCliConfig>('GET', '/api/experimental/config');
		}
	}

	// Persist supported settings into the CLI config.
	//
	// `Config.Patch` only accepts `shell`; sending anything else is rejected with
	// 400 "missing key ... at shell kind". Context / Commit Message preferences are
	// editor-side settings, so only a `shell` payload is forwarded and an empty one
	// is skipped entirely rather than provoking a validation error.
	private async _callConfigUpdate(params: LoopholeCliConfigUpdateParams): Promise<void> {
		const payload = params as { shell?: unknown }
		if (payload?.shell === undefined) return
		try {
			await this.cliApi('PATCH', '/api/config', { shell: payload.shell })
		} catch (e) {
			// Older CLI builds expose config under the experimental prefix only.
			if (!/\(404\)/.test(e instanceof Error ? e.message : String(e))) throw e
			await this.cliApi('PATCH', '/api/experimental/config', { shell: payload.shell })
		}
	}

	// Provider keys are stored via the integration connect endpoint, not the config patch.
	private async _callConnectKey(params: LoopholeCliConnectKeyParams): Promise<void> {
		const integrationID = encodeURIComponent(params.integrationID);
		await this.cliApi('POST', `/api/integration/${integrationID}/connect/key`, { key: params.key, ...(params.label ? { label: params.label } : {}) });
	}

	// Disconnect removes the stored credential; env-backed providers have no credential to remove.
	private async _callCredentialRemove(params: { credentialID: string }): Promise<void> {
		await this.cliApi('DELETE', `/api/credential/${encodeURIComponent(params.credentialID)}`);
	}

	// ---- Phase 3: direct Inception FIM (streaming, abortable by requestId) ----

	private _callFim(params: LoopholeCliFimParams): Promise<void> {
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

	// ---- sessions / messages / commands / skills / revert / permission / usage / voice ----
	// All shapes follow packages/protocol/src/groups/*. cliApi unwraps `{ data }`.

	private _callSessions(params?: { limit?: number; search?: string; archived?: boolean }): Promise<LoopholeCliSessionInfo[]> {
		const p = params ?? {};
		const q = new URLSearchParams({
			limit: String(p.limit ?? 100),
			order: 'desc',
			...(p.search ? { search: p.search } : {}),
			...(p.archived !== undefined ? { archived: String(p.archived) } : {}),
		});
		return this.cliApi('GET', `/api/session?${q.toString()}`);
	}

	private _callSessionGet(params: { sessionID: string }): Promise<LoopholeCliSessionInfo> {
		return this.cliApi('GET', `/api/session/${encodeURIComponent(params.sessionID)}`);
	}

	private _callSessionMessages(params: { sessionID: string; limit?: number; order?: string }): Promise<LoopholeCliSessionMessage[]> {
		const q = new URLSearchParams({
			limit: String(params.limit ?? 200),
			order: params.order === 'asc' ? 'asc' : 'desc',
		});
		return this.cliApi('GET', `/api/session/${encodeURIComponent(params.sessionID)}/message?${q.toString()}`);
	}

	// Active context (all messages after the last compaction) — complete window, no pagination cursor.
	private _callSessionContext(params: { sessionID: string }): Promise<LoopholeCliSessionMessage[]> {
		return this.cliApi('GET', `/api/session/${encodeURIComponent(params.sessionID)}/context`);
	}

	private _callSessionCreate(params?: Record<string, unknown>): Promise<LoopholeCliSessionInfo> {
		return this.cliApi('POST', '/api/session', params ?? {});
	}

	private _callSessionDelete(params: { sessionID: string }): Promise<void> {
		return this.cliApi('DELETE', `/api/session/${encodeURIComponent(params.sessionID)}`);
	}

	private _callSessionFork(params: { sessionID: string; before?: string }): Promise<LoopholeCliSessionInfo> {
		return this.cliApi('POST', `/api/session/${encodeURIComponent(params.sessionID)}/fork`, {
			...(params.before ? { before: params.before } : {}),
		});
	}

	private _callSessionRename(params: { sessionID: string; title: string }): Promise<void> {
		return this.cliApi('PATCH', `/api/session/${encodeURIComponent(params.sessionID)}`, { title: params.title });
	}

	private _callCommands(): Promise<LoopholeCliCommandInfo[]> {
		return this.cliApi('GET', '/api/command');
	}

	private _callSkills(): Promise<LoopholeCliSkillInfo[]> {
		return this.cliApi('GET', '/api/skill');
	}

	private _callRunCommand(params: { sessionID: string; name: string; text: string }): Promise<void> {
		return this.cliApi('POST', `/api/session/${encodeURIComponent(params.sessionID)}/command`, {
			name: params.name,
			text: params.text,
		});
	}

	private _callActivateSkill(params: { sessionID: string; id: string; resume?: boolean }): Promise<void> {
		return this.cliApi('POST', `/api/experimental/session/${encodeURIComponent(params.sessionID)}/skill`, {
			id: params.id,
			...(params.resume !== undefined ? { resume: params.resume } : {}),
		});
	}

	private _callRevertStage(params: { sessionID: string; messageID: string; files?: boolean }): Promise<LoopholeCliRevert> {
		return this.cliApi('POST', `/api/session/${encodeURIComponent(params.sessionID)}/revert/stage`, {
			messageID: params.messageID,
			...(params.files !== undefined ? { files: params.files } : {}),
		});
	}

	private _callRevertClear(params: { sessionID: string }): Promise<void> {
		return this.cliApi('DELETE', `/api/session/${encodeURIComponent(params.sessionID)}/revert`);
	}

	private _callRevertCommit(params: { sessionID: string }): Promise<void> {
		return this.cliApi('POST', `/api/session/${encodeURIComponent(params.sessionID)}/revert/commit`);
	}

	private _callPermissionList(params: { sessionID: string }): Promise<LoopholeCliPermissionRequest[]> {
		return this.cliApi('GET', `/api/session/${encodeURIComponent(params.sessionID)}/permission`);
	}

	private _callPermissionReply(params: { sessionID: string; requestID: string; decision: LoopholeCliPermissionDecision; message?: string }): Promise<void> {
		return this.cliApi('POST', `/api/session/${encodeURIComponent(params.sessionID)}/permission/${encodeURIComponent(params.requestID)}/reply`, {
			decision: params.decision,
			...(params.message ? { message: params.message } : {}),
		});
	}

	private _callVoiceModels(): Promise<{ models: LoopholeCliVoiceModel[]; default?: string }> {
		return this.cliApi<{ models: LoopholeCliVoiceModel[]; default?: string }>('GET', '/api/experimental/voice/models');
	}

	private _callVoiceSession(params: { model: string; session?: Record<string, unknown>; transport: { type: string; sdp?: string; dcid?: number } }): Promise<{ transport: LoopholeCliVoiceTransport }> {
		return this.cliApi('POST', '/api/experimental/voice/session', {
			model: params.model,
			...(params.session ? { session: params.session } : {}),
			transport: params.transport,
		});
	}

	// Browser WebSocket cannot set Authorization headers, so the main process
	// dials the provider realtime endpoint with the server-issued ephemeral
	// token and relays frames to the renderer over onEvent_loopholeCli.
	private _callVoiceWsConnect(params: { requestId: string; url: string; token: string; provider?: string }): Promise<void> {
		const { requestId, url, token, provider } = params ?? ({} as { requestId: string; url: string; token: string; provider?: string });
		this._callVoiceWsClose({ requestId });
		const headers: Record<string, string> = provider === 'google'
			? { 'x-goog-api-key': token }
			: { Authorization: `Bearer ${token}` };
		const socket = new WebSocket(url, { headers });
		this._voiceWsSockets.set(requestId, socket);
		socket.on('message', (data: unknown) => {
			const text = typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf8');
			const evt: LoopholeCliVoiceWsEvent = { kind: 'voiceWs', requestId, type: 'message', text };
			this._onEvent.fire(evt);
		});
		socket.on('error', (err: Error) => {
			const evt: LoopholeCliVoiceWsEvent = { kind: 'voiceWs', requestId, type: 'error', error: err.message };
			this._onEvent.fire(evt);
		});
		socket.on('close', () => {
			if (this._voiceWsSockets.get(requestId) === socket) this._voiceWsSockets.delete(requestId);
			const evt: LoopholeCliVoiceWsEvent = { kind: 'voiceWs', requestId, type: 'close' };
			this._onEvent.fire(evt);
		});
		return Promise.resolve();
	}

	private _callVoiceWsSend(params: { requestId: string; message: string }): Promise<void> {
		const socket = params?.requestId ? this._voiceWsSockets.get(params.requestId) : undefined;
		if (socket && socket.readyState === WebSocket.OPEN) {
			try {
				socket.send(params.message);
			} catch { /* best effort */ }
		}
		return Promise.resolve();
	}

	private _callVoiceWsClose(params: { requestId: string }): Promise<void> {
		const socket = params?.requestId ? this._voiceWsSockets.get(params.requestId) : undefined;
		if (socket) {
			this._voiceWsSockets.delete(params.requestId);
			try {
				if (socket.readyState === WebSocket.OPEN) {
					try {
						socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
					} catch { /* best effort */ }
				}
				socket.close();
			} catch { /* best effort */ }
		}
		return Promise.resolve();
	}
}

