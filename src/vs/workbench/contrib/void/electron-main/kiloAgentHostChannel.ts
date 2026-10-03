/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Registered in src/vs/code/electron-main/app.ts as 'void-channel-kilo-agent'.
//
// This file is the ONLY place that talks to the agent engine (the Kilo CLI running as
// `kilo serve`, a fork of OpenCode, MIT). Keep it that way: if we ever switch to upstream
// OpenCode, only this file changes.
//
// What it does:
//  - finds the engine binary, spawns it on 127.0.0.1 with a random password
//  - pins the engine (no autoupdate, telemetry off) and moves its config/data into
//    Loophole's own directory so it never touches - or reads - the user's own Kilo install
//  - supervises the process (restart with backoff, kill on quit, kill the process tree)
//  - keeps ONE /global/event SSE connection open and forwards events to the renderer
//  - exposes one `call()` command per KiloAgentCommand (see common/kiloAgentTypes.ts)
//
// The password and port never leave this process.

import { ChildProcess, spawn, execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import {
	KiloAgentCommand,
	KiloAgentCreateSessionParams,
	KiloAgentEvent,
	KiloAgentFileDiff,
	KiloAgentHostState,
	KiloAgentMcpRegistration,
	KiloAgentPermissionReply,
	KiloAgentPromptParams,
	KiloAgentQuestionReply,
	KiloAgentRevertParams,
	KiloAgentSessionRef,
	KiloIndexingConfig,
	KiloIndexingStatus,
	KNOWN_CONNECTED_PROVIDER_IDS,
} from '../common/kiloAgentTypes.js';
import { engineFrameData, mergeEngineConfig, normalizeEngineEvent, parseEnginePort, splitEngineEventFrames } from '../common/kiloAgentEngineParsing.js';

/** Engine's default value for KILO_SERVER_USERNAME. */
const ENGINE_USERNAME = 'kilo';

/** Port the engine is expected to print; we parse the real one and only log this. */
const STARTUP_TIMEOUT_MS = 60_000;
const MAX_RESTARTS_IN_A_ROW = 5;
const SSE_RECONNECT_DELAY_MS = 1000;

/**
 * Config applied to every engine launch, on top of whatever the caller supplies.
 *
 * The important one is `enabled_providers`, which is an ALLOWLIST: "when set, ONLY these
 * providers will be enabled. All other providers will be ignored".
 *
 * A first live run showed why `disabled_providers` alone is not enough. It is documented as
 * "disable providers that are loaded automatically", so it only suppresses *automatic* loading -
 * `GET /provider` still reported `kilo` as connected before any credential had been pushed.
 * The allowlist is the control that actually removes it.
 *
 * `kilo` is Kilo's hosted gateway (`https://api.kilo.ai`). Loophole must never route a prompt,
 * or the source context the agent reads, through it. Our own future gateway ("Loophole Pass")
 * is added as an OpenAI-compatible provider entry instead - see kiloAgentEngineMapping.ts.
 *
 * Everything else here is supplied as environment variables instead of config, because the
 * engine reads those before it can load any config file at all.
 */
export const LOCKED_DOWN_ENGINE_CONFIG: Record<string, unknown> = {
	autoupdate: false,
	/** Hard block: only these provider ids may be used. `kilo` is deliberately absent. */
	enabled_providers: KNOWN_CONNECTED_PROVIDER_IDS.filter(id => id !== 'kilo'),
	/** Belt and braces - also unioned with any caller-supplied list, never replaced. */
	disabled_providers: ['kilo'],
	/** keeps per-turn file snapshots; required for GET /session/{id}/diff and revert */
	snapshot: true,
	share: 'disabled',
};

export type KiloAgentHostOptions = {
	/** Electron appRoot (IEnvironmentMainService.appRoot) - where node_modules/@kilocode/* live in a built app */
	appRoot: string;
	/** IEnvironmentMainService.userDataPath - the engine's config/data goes under <userDataPath>/kilo-engine */
	userDataPath: string;
	/** optional absolute override for the engine binary (useful in dev: set LOOPHOLE_KILO_BIN) */
	binaryOverride?: string;
	/**
	 * Extra engine config merged on top of LOCKED_DOWN_ENGINE_CONFIG and passed at spawn via
	 * KILO_CONFIG_CONTENT. This is where Loophole adds its own providers (e.g. a "Loophole Pass"
	 * OpenAI-compatible gateway), MCP servers (IDE tools) and rules.
	 */
	engineConfig?: Record<string, unknown>;
	log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

type Running = { port: number; password: string; proc: ChildProcess };

type ReqOpts = { directory?: string; body?: unknown };

export class KiloAgentHostChannel implements IServerChannel, IDisposable {

	private readonly _onState = new Emitter<KiloAgentHostState>();
	private readonly _onEvent = new Emitter<KiloAgentEvent>();

	private state: KiloAgentHostState = { status: 'stopped' };
	private running: Running | undefined;
	private starting: Promise<void> | undefined;
	private disposed = false;
	private stoppingOnPurpose = false;
	private restartsInARow = 0;
	private sseAbort: AbortController | undefined;

	constructor(private readonly opts: KiloAgentHostOptions) { }

	// ------------------------------------------------------------------ IServerChannel

	listen(_: unknown, event: string): Event<any> {
		if (event === 'onState') return this._onState.event;
		if (event === 'onEvent') return this._onEvent.event;
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: KiloAgentCommand | string, params: any): Promise<any> {
		const dir = (p: any): string | undefined => p?.directory;
		const ref = (p: any): KiloAgentSessionRef => ({ directory: p?.directory, sessionID: p?.sessionID });

		switch (command as KiloAgentCommand) {
			// ---- lifecycle ----
			case 'start': return this.start();
			case 'stop': return this.stop();
			case 'getState': return this.state;

			// ---- sessions ----
			case 'createSession': return this.createSession(params as KiloAgentCreateSessionParams);
			case 'listSessions': return this.req('GET', '/session', { directory: dir(params) });
			case 'getSession': return this.req('GET', `/session/${ref(params).sessionID}`, { directory: dir(params) });
			case 'getMessages': return this.req('GET', `/session/${ref(params).sessionID}/message`, { directory: dir(params) });
			case 'getTodos': return this.req('GET', `/session/${ref(params).sessionID}/todo`, { directory: dir(params) });
			case 'prompt': return this.prompt(params as KiloAgentPromptParams);
			case 'abort': return this.req('POST', `/session/${ref(params).sessionID}/abort`, { directory: dir(params) });
			case 'deleteSession': return this.req('DELETE', `/session/${ref(params).sessionID}`, { directory: dir(params) });
			case 'listAgents': return this.req('GET', '/experimental/agent', { directory: dir(params) });

			// ---- approvals ----
			case 'replyPermission': return this.replyPermission(params as KiloAgentPermissionReply);
			case 'listPendingPermissions': return this.req('GET', '/permission', { directory: dir(params) });
			case 'listPendingQuestions': return this.req('GET', '/question', { directory: dir(params) });
			case 'replyQuestion': return this.replyQuestion(params as KiloAgentQuestionReply);
			case 'rejectQuestion': return this.req('POST', `/question/${(params as { questionID: string }).questionID}/reject`, { directory: dir(params) });

			// ---- edits ----
			case 'getDiff': return this.getDiff(ref(params));
			case 'revert': return this.revert(params as KiloAgentRevertParams);
			case 'unrevert': return this.req('POST', `/session/${ref(params).sessionID}/unrevert`, { directory: dir(params) });

			// ---- indexing ----
			case 'getIndexingStatus': return this.req('GET', '/indexing/status', { directory: dir(params) }) as Promise<KiloIndexingStatus>;
			case 'listIndexingModels': return this.req('GET', '/indexing/models', { directory: dir(params) });
			// NOTE: this patches the engine's GLOBAL config on purpose. PATCH /config instead would
			// create a `.kilo/kilo.jsonc` inside the user's repository - see the note in
			// docs/kilo-engine-notes.md. Indexing is a per-user preference, not a repo setting.
			case 'configureIndexing': return this.configureIndexing(params as { directory?: string; indexing: KiloIndexingConfig });

			// ---- config / providers ----
			case 'getConfig': return this.req('GET', '/global/config');
			case 'patchConfig': return this.req('PATCH', '/global/config', { body: (params as { config: Record<string, unknown> })?.config });
			case 'setAuth': return this.req('PUT', `/auth/${(params as { providerID: string }).providerID}`, { directory: dir(params), body: { type: 'api', key: (params as { key: string }).key } });
			case 'removeAuth': return this.req('DELETE', `/auth/${(params as { providerID: string }).providerID}`, { directory: dir(params) });
			case 'listProviders': return this.req('GET', '/config/providers', { directory: dir(params) });
			// The only reliable "did my key take?" signal. `PUT /auth/{id}` answers 200 even for
			// ids the engine does not recognise, so this is what the settings UI checks after
			// every push. See common/kiloAgentEngineMapping.ts.
			case 'getProviderStatus': return this.req('GET', '/provider', { directory: dir(params) });

			// ---- mcp ----
			case 'addMcpServer': return this.addMcpServer(params as KiloAgentMcpRegistration);
			case 'removeMcpServer': return this.req('POST', '/mcp/remove', { directory: dir(params), body: { name: (params as { name: string }).name } });
			case 'listMcpServers': return this.req('GET', '/mcp', { directory: dir(params) });

			default: throw new Error(`Unknown kilo-agent command: ${command}`);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.killProcess();
		this._onState.dispose();
		this._onEvent.dispose();
	}

	// ------------------------------------------------------------------ lifecycle

	start(): Promise<void> {
		if (this.disposed) return Promise.reject(new Error('Kilo agent host is disposed'));
		if (this.running) return Promise.resolve();
		if (this.starting) return this.starting;
		this.starting = this.doStart().finally(() => { this.starting = undefined; });
		return this.starting;
	}

	async stop(): Promise<void> {
		this.stoppingOnPurpose = true;
		this.killProcess();
		this.setState({ status: 'stopped' });
	}

	private async doStart(): Promise<void> {
		this.stoppingOnPurpose = false;
		this.setState({ status: 'starting' });

		const binary = this.resolveBinary();
		if (!binary) {
			const message = 'Agent engine binary not found. Reinstall Loophole, or set LOOPHOLE_KILO_BIN to the engine executable.';
			this.setState({ status: 'error', message });
			throw new Error(message);
		}

		const password = randomBytes(32).toString('hex');
		const dirs = this.engineDirs();
		for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

		// We deliberately do NOT change HOME: the engine shells out to git, ssh and npm for
		// the user, and those need the real environment. KILO_CONFIG_DIR (plus the XDG vars as a
		// belt-and-braces measure) is what actually moves the engine's own state out of the way.
		const env: NodeJS.ProcessEnv = {
			...process.env,
			KILO_SERVER_PASSWORD: password,
			KILO_SERVER_USERNAME: ENGINE_USERNAME,
			// no PostHog, ever
			KILO_TELEMETRY_LEVEL: 'off',
			// the engine must not replace the pinned binary; there is also a POST /global/upgrade
			// route, which this host deliberately never calls
			KILO_DISABLE_AUTOUPDATE: '1',
			// don't stand up an embedded web UI we never use
			KILO_DISABLE_EMBEDDED_WEB_UI: '1',
			KILO_CONFIG_CONTENT: JSON.stringify(this.buildEngineConfig()),
			KILO_CONFIG_DIR: dirs.config,
			XDG_CONFIG_HOME: dirs.config,
			XDG_DATA_HOME: dirs.data,
			XDG_CACHE_HOME: dirs.cache,
			XDG_STATE_HOME: dirs.state,
			// The engine needs its bundled grammars to parse source; see treeSitterEnv().
			...this.treeSitterEnv(binary),
		};

		this.opts.log('info', `[kilo-agent] starting engine: ${binary}`);
		const proc = spawn(binary, ['serve', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

		const port = await new Promise<number>((resolve, reject) => {
			let settled = false;
			const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
			const timer = setTimeout(() => done(() => { this.killTree(proc); reject(new Error('Timed out waiting for the agent engine to start')); }), STARTUP_TIMEOUT_MS);

			let buf = '';
			proc.stdout?.on('data', (chunk: Buffer) => {
				buf += chunk.toString();
				const port = parseEnginePort(buf);
				if (port !== undefined) done(() => resolve(port));
			});
			proc.stderr?.on('data', (chunk: Buffer) => this.opts.log('warn', `[kilo-agent:stderr] ${chunk.toString().trimEnd()}`));
			proc.on('error', err => done(() => reject(err)));
			proc.on('exit', code => done(() => reject(new Error(`Agent engine exited during startup (code ${code})`))));
		}).catch(err => {
			this.killTree(proc);
			this.setState({ status: 'error', message: String(err?.message ?? err) });
			throw err;
		});

		this.running = { port, password, proc };
		proc.on('exit', (code, signal) => this.onProcessExit(code, signal));

		// confirm it's healthy and learn the version
		const health = await this.req('GET', '/global/health') as { healthy: boolean; version?: string };
		if (!health?.healthy) {
			this.killProcess();
			const message = 'Agent engine started but reported unhealthy';
			this.setState({ status: 'error', message });
			throw new Error(message);
		}

		this.restartsInARow = 0;
		this.setState({ status: 'running', version: health.version });
		this.opts.log('info', `[kilo-agent] engine ${health.version} ready on 127.0.0.1:${port}`);
		this.connectEvents();
	}

	/** All engine state lives under Loophole's userDataPath so it can never collide with a user's own Kilo install. */
	private engineDirs() {
		const root = join(this.opts.userDataPath, 'kilo-engine');
		return {
			root,
			config: join(root, 'config'),
			data: join(root, 'data'),
			cache: join(root, 'cache'),
			state: join(root, 'state'),
		};
	}

	private buildEngineConfig(): Record<string, unknown> {
		return mergeEngineConfig(LOCKED_DOWN_ENGINE_CONFIG, this.opts.engineConfig);
	}

	private onProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
		this.opts.log('warn', `[kilo-agent] engine exited (code=${code}, signal=${signal})`);
		this.sseAbort?.abort();
		this.running = undefined;
		if (this.disposed || this.stoppingOnPurpose) return;

		if (this.restartsInARow >= MAX_RESTARTS_IN_A_ROW) {
			this.setState({ status: 'error', message: `Agent engine crashed ${MAX_RESTARTS_IN_A_ROW} times in a row; giving up.` });
			return;
		}
		this.restartsInARow++;
		const delay = Math.min(1000 * 2 ** (this.restartsInARow - 1), 15_000);
		this.setState({ status: 'starting', message: `Engine exited, restarting in ${Math.round(delay / 1000)}s` });
		setTimeout(() => { if (!this.disposed && !this.stoppingOnPurpose) this.start().catch(() => { /* state already set */ }); }, delay);
	}

	private killProcess(): void {
		this.sseAbort?.abort();
		const p = this.running?.proc;
		this.running = undefined;
		if (p) this.killTree(p);
	}

	/**
	 * The engine spawns helper processes (sandbox workers, tree-sitter), so killing the direct
	 * child is not enough on Windows, where `kill()` does not walk the process tree.
	 */
	private killTree(proc: ChildProcess): void {
		if (proc.exitCode !== null || proc.signalCode !== null) return;
		try {
			if (process.platform === 'win32' && proc.pid) {
				spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
				return;
			}
			proc.kill();
		} catch (err) {
			this.opts.log('warn', `[kilo-agent] could not stop engine process: ${String(err)}`);
		}
	}

	private setState(next: KiloAgentHostState): void {
		this.state = next;
		this._onState.fire(next);
	}

	// ------------------------------------------------------------------ binary resolution

	/**
	 * The engine ships as `@kilocode/cli` plus one platform package it depends on, e.g.
	 * `@kilocode/cli-linux-x64`. Variants: `-baseline` (CPUs without AVX2) and `-musl` (Alpine).
	 *
	 * `@kilocode/cli/bin/kilo` is only a Node launcher; the real binary is the one we resolve
	 * here. The launcher prefers the AVX2 build and falls back to `-baseline`, so we do the same
	 * rather than taking whichever name happens to sort first.
	 */
	private resolveBinary(): string | undefined {
		const exe = process.platform === 'win32' ? 'kilo.exe' : 'kilo';
		const override = this.opts.binaryOverride ?? process.env['LOOPHOLE_KILO_BIN'];
		if (override && existsSync(override)) return override;

		const plat = process.platform === 'win32' ? 'windows' : process.platform; // darwin | linux | windows
		const arch = process.arch; // x64 | arm64
		const base = `cli-${plat}-${arch}`;
		const musl = process.platform === 'linux' && this.isMusl();
		const baseline = arch === 'x64' && !this.supportsAvx2();

		// Same preference order as the vendor launcher: fastest build that actually works here.
		const names = musl
			? (baseline ? [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base] : [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`])
			: arch === 'x64'
				? (baseline ? [`${base}-baseline`, base, `${base}-musl`, `${base}-baseline-musl`] : [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`])
				: [base];

		const roots = [
			this.opts.appRoot,
			join(this.opts.appRoot, 'node_modules.asar.unpacked'),
			join(this.opts.appRoot, '..', 'app.asar.unpacked'),
		];
		for (const root of roots) {
			for (const n of names) {
				const candidate = join(root, 'node_modules', '@kilocode', n, 'bin', exe);
				if (existsSync(candidate)) return candidate;
			}
		}
		return this.findBinaryByScan(roots, exe);
	}

	/**
	 * Whether this CPU supports AVX2, which decides baseline vs. non-baseline on x64.
	 * Best effort: when in doubt we assume no AVX2, because the baseline build runs everywhere.
	 */
	private supportsAvx2(): boolean {
		if (process.arch !== 'x64') return false;
		try {
			if (process.platform === 'linux') {
				return /(^|\s)avx2(\s|$)/i.test(readFileSync('/proc/cpuinfo', 'utf8'));
			}
			if (process.platform === 'darwin') {
				return execFileSync('sysctl', ['-n', 'hw.optional.avx2_0'], { encoding: 'utf8', timeout: 1500 }).trim() === '1';
			}
		} catch {
			return false;
		}
		return false;
	}

	/** Alpine / musl libc detection, mirroring the launcher. */
	private isMusl(): boolean {
		if (process.platform !== 'linux') return false;
		try {
			if (existsSync('/etc/alpine-release')) return true;
		} catch { /* ignore */ }
		try {
			const out = (execFileSync('ldd', ['--version'], { encoding: 'utf8', timeout: 1500 }) + '').toLowerCase();
			return out.includes('musl');
		} catch {
			return false;
		}
	}

	/**
	 * The launcher also points the engine at its bundled tree-sitter grammars via
	 * `KILO_TREE_SITTER_WASM_DIR`. Without it the engine cannot parse source, which breaks the
	 * semantic index, so we set it the same way.
	 */
	private treeSitterEnv(binary: string): Record<string, string> {
		const dir = join(dirname(binary), 'tree-sitter');
		if (process.env['KILO_TREE_SITTER_WASM_DIR']) return {};
		try {
			if (existsSync(join(dir, 'tree-sitter.wasm'))) return { KILO_TREE_SITTER_WASM_DIR: dir };
		} catch { /* ignore */ }
		return {};
	}

	/** Last resort: find any `kilo[.exe]` under an installed @kilocode platform package. */
	private findBinaryByScan(roots: string[], exe: string): string | undefined {
		for (const root of roots) {
			const scope = join(root, 'node_modules', '@kilocode');
			if (!existsSync(scope)) continue;
			for (const pkg of readdirSync(scope)) {
				if (!pkg.startsWith('cli-')) continue;
				const candidate = join(scope, pkg, 'bin', exe);
				if (existsSync(candidate)) return candidate;
			}
		}
		return undefined;
	}

	// ------------------------------------------------------------------ HTTP helpers (engine API)

	private authHeader(r: Running): string {
		return 'Basic ' + Buffer.from(`${ENGINE_USERNAME}:${r.password}`).toString('base64');
	}

	private async req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts?: ReqOpts): Promise<any> {
		const r = this.running;
		if (!r) throw new Error('Agent engine is not running');
		const url = new URL(`http://127.0.0.1:${r.port}${path}`);
		if (opts?.directory) url.searchParams.set('directory', opts.directory);

		const res = await fetch(url, {
			method,
			headers: {
				'authorization': this.authHeader(r),
				...(opts?.body !== undefined ? { 'content-type': 'application/json' } : {}),
			},
			body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`Agent engine ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
		}
		const text = await res.text();
		return text ? JSON.parse(text) : undefined;
	}

	// ------------------------------------------------------------------ commands

	private createSession(p: KiloAgentCreateSessionParams) {
		return this.req('POST', '/session', {
			directory: p.directory,
			body: { ...(p.title ? { title: p.title } : {}), ...(p.agent ? { agent: p.agent } : {}) },
		});
	}

	/**
	 * POST .../prompt_async returns as soon as the turn is queued; the answer streams back over
	 * /global/event. We deliberately use the async variant so a long turn never blocks the
	 * renderer on an open HTTP request.
	 */
	private async prompt(p: KiloAgentPromptParams): Promise<void> {
		await this.req('POST', `/session/${p.sessionID}/prompt_async`, {
			directory: p.directory,
			body: {
				parts: [{ type: 'text', text: p.text }],
				...(p.model ? { model: p.model } : {}),
				...(p.agent ? { agent: p.agent } : {}),
				...(p.system ? { system: p.system } : {}),
				...(p.tools ? { tools: p.tools } : {}),
				...(p.editorContext ? { editorContext: p.editorContext } : {}),
			},
		});
	}

	private replyPermission(p: KiloAgentPermissionReply) {
		return this.req('POST', `/permission/${p.requestID}/reply`, {
			directory: p.directory,
			body: { reply: p.reply, ...(p.message ? { message: p.message } : {}) },
		});
	}

	private replyQuestion(p: KiloAgentQuestionReply) {
		return this.req('POST', `/question/${p.questionID}/reply`, {
			directory: p.directory,
			body: { answers: p.answers },
		});
	}

	private getDiff(p: KiloAgentSessionRef): Promise<KiloAgentFileDiff[]> {
		return this.req('GET', `/session/${p.sessionID}/diff`, { directory: p.directory });
	}

	private revert(p: KiloAgentRevertParams) {
		return this.req('POST', `/session/${p.sessionID}/revert`, {
			directory: p.directory,
			body: { messageID: p.messageID, ...(p.partID ? { partID: p.partID } : {}) },
		});
	}

	private configureIndexing(p: { directory?: string; indexing: KiloIndexingConfig }) {
		return this.req('PATCH', '/global/config', { body: { indexing: p.indexing } });
	}

	private addMcpServer(p: KiloAgentMcpRegistration) {
		return this.req('POST', '/mcp', { directory: p.directory, body: { name: p.name, config: p.config } });
	}

	// ------------------------------------------------------------------ event stream

	/**
	 * One SSE connection to /global/event, shared by every workspace. Frames look like:
	 *   data: {"directory":"/abs/path"|"global","project":"...","payload":{"id","type","properties"}}
	 * The first frame ("server.connected") has no directory, and the engine sends a
	 * "server.heartbeat" every 10s to keep the connection warm.
	 */
	private connectEvents(): void {
		const r = this.running;
		if (!r) return;
		const abort = new AbortController();
		this.sseAbort = abort;

		void (async () => {
			try {
				const res = await fetch(`http://127.0.0.1:${r.port}/global/event`, {
					headers: { 'authorization': this.authHeader(r), 'accept': 'text/event-stream' },
					signal: abort.signal,
				});
				if (!res.ok || !res.body) throw new Error(`event stream failed: ${res.status}`);

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buf = '';
				for (; ;) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += decoder.decode(value, { stream: true });
					const { frames, rest } = splitEngineEventFrames(buf);
					buf = rest;
					for (const frame of frames) this.handleFrame(frame);
				}
				throw new Error('event stream ended');
			} catch (err: any) {
				if (abort.signal.aborted || this.disposed) return;
				this.opts.log('warn', `[kilo-agent] event stream dropped: ${err?.message ?? err}; reconnecting`);
				// Only reconnect to the SAME engine instance; a restarted engine opens its own
				// stream from doStart().
				setTimeout(() => { if (this.running === r && !this.disposed) this.connectEvents(); }, SSE_RECONNECT_DELAY_MS);
			}
		})();
	}

	private handleFrame(frame: string): void {
		const data = engineFrameData(frame);
		if (!data) return;
		try {
			const event = normalizeEngineEvent(data);
			if (event) this._onEvent.fire(event);
		} catch (err) {
			this.opts.log('warn', `[kilo-agent] could not parse event frame: ${String(err)}`);
		}
	}
}
