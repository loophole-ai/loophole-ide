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
import type { LoopholeServeConnectParams, LoopholeServeStatus } from '../common/loopholeServeTypes.js';

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

	// browser never listens today; surface exists so Phase 2 can stream SSE frames without a channel rewire
	listen(_: unknown, event: string): Event<any> {
		if (event === 'onEvent_loopholeServe') return this._onEvent.event;
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, params: any): Promise<any> {
		if (command === 'connect') return this._callConnect(params);
		if (command === 'disconnect') return this._callDisconnect();
		if (command === 'status') return this._callStatus();
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
}

