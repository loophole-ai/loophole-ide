#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Loophole. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Standalone BYOK smoke test for the agent engine.
//
// Purpose: answer three questions with a real run instead of an assumption.
//   1. Does the engine start under the exact environment the host channel uses?
//   2. After PUT /auth/{id}, does that id appear in GET /provider -> `connected`?
//   3. Does anything phone home while it runs - especially api.kilo.ai or models.dev?
//
// It deliberately mirrors src/vs/workbench/contrib/void/electron-main/kiloAgentHostChannel.ts
// rather than importing it, because that file is TypeScript inside the VS Code build. If you
// change the host's spawn environment, change it here too.
//
// Usage:
//   KILO_SMOKE_KEY=<your key> KILO_SMOKE_PROVIDER=anthropic node scripts/kilo-bok-smoke.js
//   KILO_SMOKE_KEY=<your key> KILO_SMOKE_PROVIDER=anthropic \
//     KILO_SMOKE_MODEL=claude-sonnet-4-5 node scripts/kilo-bok-smoke.js
//
// Options (env):
//   KILO_SMOKE_KEY       required. The API key to test with. Never printed.
//   KILO_SMOKE_PROVIDER  default "anthropic". Must be an engine catalog id.
//   KILO_SMOKE_MODEL     default "". Engine picks its own default for the provider.
//   KILO_SMOKE_DIR       default os.tmpdir()/kilo-smoke-<pid>. Workspace directory.
//   KILO_SMOKE_TIMEOUT   default 90000. ms to wait for the engine to become healthy.
//   KILO_BIN             optional. Absolute path to the engine binary, bypassing resolution.
//
// Exit codes: 0 all checks passed, 1 a check failed, 2 could not run (bad env/binary).

'use strict'

const { spawn, execFile } = require('child_process')
const crypto = require('crypto')
const dns = require('dns')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PROVIDER = process.env.KILO_SMOKE_PROVIDER || 'anthropic'
const MODEL = process.env.KILO_SMOKE_MODEL || ''
const KEY = process.env.KILO_SMOKE_KEY || ''
const TIMEOUT = Number(process.env.KILO_SMOKE_TIMEOUT || 90000)
const USERNAME = 'kilo'

// Hosts we specifically care about. Everything else is reported but not failed on.
const WATCH = ['api.kilo.ai', 'kilocode.ai', 'models.dev', 'openrouter.ai']

/**
 * Forward-resolves each watched hostname to its IP set.
 *
 * Comparing observed IPs against hostname *strings* can never match - the first version of this
 * check reported "no watched host contacted" while the engine was demonstrably talking to
 * api.kilo.ai. Reverse DNS is no better: these hosts have no PTR records. Forward resolution is
 * the only thing that actually identifies a destination.
 *
 * Uses `dns.lookup` rather than `dns.resolve4`: lookup goes through the OS resolver
 * (getaddrinfo), which is the same path an outbound connection actually takes, and it is the
 * one that works in this environment.
 */
async function resolveWatchedHosts(hosts) {
	const out = new Map() // ip -> hostname
	await Promise.all(hosts.map(async h => {
		try {
			const entries = await dns.promises.lookup(h, { all: true })
			for (const e of entries) out.set(e.address, h)
		} catch { /* not resolvable */ }
	}))
	return out
}

// The hard allowlist, mirroring LOCKED_DOWN_ENGINE_CONFIG in the host channel.
// `kilo` is deliberately absent - see the note in that file about disabled_providers being
// insufficient on its own.
const ALLOWED_PROVIDERS = [
	'openai', 'anthropic', 'google', 'xai', 'mistral', 'groq', 'deepseek',
	'openrouter', 'amazon-bedrock', 'lmstudio', 'azure', 'google-vertex',
]

let failures = 0
const log = (...a) => console.log(...a)
const ok = m => log(`  PASS  ${m}`)
const bad = m => { failures++; log(`  FAIL  ${m}`) }
const info = m => log(`  ..    ${m}`)

// ---------------------------------------------------------------- binary resolution

// Mirrors the launcher in @kilocode/cli/bin/kilo, which walks up from its own directory
// looking for node_modules/@kilocode/cli-<platform>-<arch>/bin/kilo[.exe].
function resolveBinary() {
	if (process.env.KILO_BIN) {
		return fs.existsSync(process.env.KILO_BIN) ? process.env.KILO_BIN : undefined
	}
	const exe = process.platform === 'win32' ? 'kilo.exe' : 'kilo'
	const plat = process.platform === 'win32' ? 'windows' : process.platform
	let dir = path.resolve(__dirname, '..')
	for (;;) {
		const scope = path.join(dir, 'node_modules', '@kilocode')
		if (fs.existsSync(scope)) {
			// Non-baseline first, matching the launcher's preference for AVX2 CPUs.
			for (const n of [`cli-${plat}-${process.arch}`, `cli-${plat}-${process.arch}-baseline`]) {
				const candidate = path.join(scope, n, 'bin', exe)
				if (fs.existsSync(candidate)) return candidate
			}
		}
		const parent = path.dirname(dir)
		if (parent === dir) return undefined
		dir = parent
	}
}

// ---------------------------------------------------------------- connection watch

// Records outbound TCP connections owned by the engine process.
//
// Uses `netstat -ano` on Windows, which is reliable and does not need an elevated shell the way
// Get-NetTCPConnection sometimes does. The first version of this script used Get-NetTCPConnection
// and silently returned nothing, which made "no connections" indistinguishable from "the monitor
// is broken" - so this returns `working: false` rather than an empty result when it cannot run.
function startConnectionWatch(pid) {
	const seen = new Set()
	let polls = 0
	let worked = false

	const poll = () => {
		polls++
		if (process.platform !== 'win32') return
		execFile('netstat.exe', ['-ano'], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
			if (err || !stdout) return
			worked = true
			for (const line of String(stdout).split(/\r?\n/)) {
				// ESTABLISHED lines end with the owning PID.
				if (!/\bESTABLISHED\b/i.test(line)) continue
				const cols = line.trim().split(/\s+/)
				if (cols.length < 5) continue
				if (cols[cols.length - 1] !== String(pid)) continue
				const remote = cols[2] // e.g. 1.2.3.4:443
				const host = remote.startsWith('[')
					? remote.slice(1, remote.indexOf(']'))
					: remote.slice(0, remote.lastIndexOf(':'))
				if (!host) continue
				if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '::') continue
				seen.add(host)
			}
		})
	}

	const timer = setInterval(poll, 1000)
	poll()
	return {
		stop: () => clearInterval(timer),
		hosts: () => [...seen].sort(),
		// Did the monitor actually manage to read netstat? If not, "no hosts" means "unknown".
		worked: () => worked && polls > 0,
	}
}

// Lists files under dir, relative, capped.
function listFiles(dir, cap = 40) {
	const out = []
	const walk = (p, depth) => {
		if (depth > 5 || out.length >= cap) return
		let entries
		try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch { return }
		for (const e of entries) {
			const full = path.join(p, e.name)
			if (e.isFile()) out.push(path.relative(dir, full))
			else if (e.isDirectory()) walk(full, depth + 1)
		}
	}
	walk(dir, 0)
	return out
}

// Finds auth.json by searching, rather than guessing the path. `Global.Path.data` is
// xdgData + "kilo", and on Windows `xdg-basedir` may not honour XDG_DATA_HOME, so the file can
// land somewhere other than where we told it to.
function findAuthFiles(root, maxDepth = 6) {
	const found = []
	const walk = (dir, depth) => {
		if (depth > maxDepth) return
		let entries
		try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
		for (const e of entries) {
			const full = path.join(dir, e.name)
			if (e.isFile() && e.name === 'auth.json') found.push(full)
			else if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(full, depth + 1)
		}
	}
	try { walk(root, 0) } catch { /* root missing */ }
	return found
}

// ---------------------------------------------------------------- engine lifecycle

function engineEnv(dir) {
	const home = path.join(dir, 'engine')
	const dirs = {
		config: path.join(home, 'config'),
		data: path.join(home, 'data'),
		cache: path.join(home, 'cache'),
		state: path.join(home, 'state'),
	}
	for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })

	// Isolation works through the XDG_* variables. Measured by scripts/kilo-isolation-probe.js:
	// setting them makes the engine write entirely inside `dir`, whereas KILO_CONFIG_DIR on its
	// own redirects nothing at all. We set KILO_CONFIG_DIR too, but XDG_* is what actually holds.
	return {
		...process.env,
		KILO_SERVER_USERNAME: USERNAME,
		KILO_SERVER_PASSWORD: crypto.randomBytes(32).toString('hex'),
		KILO_TELEMETRY_LEVEL: 'off',
		KILO_DISABLE_AUTOUPDATE: '1',
		KILO_DISABLE_EMBEDDED_WEB_UI: '1',
		KILO_CONFIG_CONTENT: JSON.stringify({
			autoupdate: false,
			enabled_providers: ALLOWED_PROVIDERS,
			disabled_providers: ['kilo'],
			snapshot: true,
			share: 'disabled',
		}),
		KILO_CONFIG_DIR: dirs.config,
		XDG_CONFIG_HOME: dirs.config,
		XDG_DATA_HOME: dirs.data,
		XDG_CACHE_HOME: dirs.cache,
		XDG_STATE_HOME: dirs.state,
	}
}

function startEngine(binary, env) {
	return new Promise((resolve, reject) => {
		const proc = spawn(binary, ['serve', '--port', '0'], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		})
		let buf = ''
		const timer = setTimeout(() => {
			try { proc.kill() } catch { /* ignore */ }
			reject(new Error(`engine did not report a port within ${TIMEOUT}ms`))
		}, TIMEOUT)

		proc.stdout.on('data', chunk => {
			buf += chunk.toString()
			const m = buf.match(/kilo server listening on http:\/\/[^:\s]+:(\d+)/)
			if (m) { clearTimeout(timer); resolve({ proc, port: Number(m[1]) }) }
		})
		let stderr = ''
		proc.stderr.on('data', c => { stderr += c.toString() })
		proc.on('error', e => { clearTimeout(timer); reject(e) })
		proc.on('exit', code => {
			clearTimeout(timer)
			reject(new Error(`engine exited during startup (code ${code})\n${stderr.slice(0, 2000)}`))
		})
	})
}

function makeApi(port, password) {
	const auth = 'Basic ' + Buffer.from(`${USERNAME}:${password}`).toString('base64')
	return async function api(method, routePath, { directory, body } = {}) {
		const url = new URL(`http://127.0.0.1:${port}${routePath}`)
		if (directory) url.searchParams.set('directory', directory)
		const res = await fetch(url, {
			method,
			headers: {
				authorization: auth,
				...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
		})
		const text = await res.text()
		if (!res.ok) throw new Error(`${method} ${routePath} -> ${res.status}: ${text.slice(0, 400)}`)
		return text ? JSON.parse(text) : undefined
	}
}

// Streams /global/event and prints a readable trace of one turn.
async function streamTurn(api, directory, sessionID, text, onEvent) {
	const events = []
	const controller = new AbortController()

	const res = await fetch(`http://127.0.0.1:${api.__port}/global/event`, {
		headers: { authorization: api.__auth, accept: 'text/event-stream' },
		signal: controller.signal,
	})

	let done
	const finished = new Promise(r => { done = r })

	void (async () => {
		try {
			const reader = res.body.getReader()
			const dec = new TextDecoder()
			let buf = ''
			for (; ;) {
				const { value, done: eof } = await reader.read()
				if (eof) break
				buf += dec.decode(value, { stream: true })
				for (; ;) {
					const idx = buf.search(/\r?\n\r?\n/)
					if (idx === -1) break
					const sep = /\r?\n\r?\n/.exec(buf.slice(idx))[0]
					const frame = buf.slice(0, idx)
					buf = buf.slice(idx + sep.length)
					const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
					if (!data) continue
					let json
					try { json = JSON.parse(data) } catch { continue }
					const payload = json.payload ?? json
					if (!payload?.type || payload.type === 'server.heartbeat') continue
					events.push({ type: payload.type, properties: payload.properties ?? payload.data ?? {} })
					if (onEvent) onEvent(events[events.length - 1])
				}
			}
		} catch (err) {
			if (!controller.signal.aborted) onEvent?.({ type: 'sse.error', properties: { message: String(err?.message ?? err) } })
		} finally {
			done()
		}
	})()

	await api('POST', `/session/${sessionID}/prompt_async`, {
		directory,
		body: { parts: [{ type: 'text', text }], ...(MODEL ? { model: { providerID: PROVIDER, modelID: MODEL } } : {}) },
	})

	// Wait for the session to report idle, with a ceiling.
	const deadline = Date.now() + 120000
	while (Date.now() < deadline) {
		if (events.some(e => e.type === 'session.idle' || e.type === 'session.error')) break
		await new Promise(r => setTimeout(r, 250))
	}
	controller.abort()
	await finished
	return events
}

// ---------------------------------------------------------------- main

async function main() {
	log('Kilo engine BYOK smoke test')
	log('='.repeat(70))

	if (!KEY) {
		bad('KILO_SMOKE_KEY is not set - refusing to run. Set it to a real provider key.')
		process.exit(2)
	}
	info(`provider under test: ${PROVIDER}${MODEL ? `  model: ${MODEL}` : ''}`)

	const binary = resolveBinary()
	if (!binary) {
		bad('engine binary not found. Run `npm install` in loophole-ide first, or set KILO_BIN.')
		process.exit(2)
	}
	ok(`engine binary: ${binary}`)

	const workDir = process.env.KILO_SMOKE_DIR || path.join(os.tmpdir(), `kilo-smoke-${process.pid}`)
	fs.mkdirSync(workDir, { recursive: true })
	fs.mkdirSync(path.join(workDir, 'project'), { recursive: true })
	info(`workspace: ${path.join(workDir, 'project')}`)

	const env = engineEnv(workDir)

	// --- start ------------------------------------------------------------------------
	let proc, port
	const startedAt = Date.now()
	try {
		const started = await startEngine(binary, env)
		proc = started.proc
		port = started.port
		ok(`engine started on 127.0.0.1:${port}`)
	} catch (err) {
		bad(`engine failed to start: ${err?.message ?? err}`)
		process.exit(2)
	}

	const watch = startConnectionWatch(proc.pid)
	const api = makeApi(port, env.KILO_SERVER_PASSWORD)
	api.__port = port
	api.__auth = 'Basic ' + Buffer.from(`${USERNAME}:${env.KILO_SERVER_PASSWORD}`).toString('base64')

	try {
		// --- isolation -----------------------------------------------------------------
		// Regression guard. An earlier version of this script destructured the env object and
		// then read `env.env`, so spawn silently fell back to process.env with no isolation
		// variables at all - and the engine happily read the user's real ~/.config/kilo and
		// wrote their API key to ~/.local/share/kilo/auth.json. Verify we actually redirected.
		const userKiloData = path.join(os.homedir(), '.local', 'share', 'kilo')
		const userKiloConfig = path.join(os.homedir(), '.config', 'kilo')
		const ourData = env.XDG_DATA_HOME
		const ourFiles = fs.existsSync(ourData) ? listFiles(ourData) : []
		if (ourFiles.length) {
			ok(`engine state is isolated inside our temp dir (${ourFiles.length} files)`)
		} else {
			bad('engine wrote nothing into XDG_DATA_HOME - isolation did not take effect')
		}
		// Anything already in the user's real dirs predates this run; a fresh auth.json there
		// after we push a key would mean the credential escaped.
		for (const realDir of [userKiloData, userKiloConfig]) {
			try {
				const newest = fs.readdirSync(realDir).map(f => {
					try { return fs.statSync(path.join(realDir, f)).mtimeMs } catch { return 0 }
				})
				const recent = newest.filter(t => t > startedAt - 60000)
				if (recent.length) {
					bad(`engine touched the user's real dir during this run: ${realDir}`)
				}
			} catch { /* dir does not exist = good */ }
		}
		info(`user dirs untouched: ${userKiloData}, ${userKiloConfig}`)

		// --- health -------------------------------------------------------------------
		const health = await api('GET', '/global/health')
		if (health?.healthy) ok(`health: version ${health.version}`)
		else bad(`health reported unhealthy: ${JSON.stringify(health)}`)

		// --- credential ---------------------------------------------------------------
		const before = await api('GET', '/provider', { directory: path.join(workDir, 'project') })
		info(`before: connected=[${(before.connected || []).join(', ')}] failed=[${(before.failed || []).join(', ')}]`)

		// The allowlist is the control that actually removes Kilo's hosted gateway.
		// A first run reported `connected=[kilo]` with only `disabled_providers` set.
		if ((before.connected || []).includes('kilo')) {
			bad('"kilo" is still reported as connected - the hosted gateway is reachable')
		} else {
			ok('"kilo" is not connected - the hosted gateway is blocked')
		}

		await api('PUT', `/auth/${PROVIDER}`, { body: { type: 'api', key: KEY } })
		info(`PUT /auth/${PROVIDER} accepted (note: this returns 200 for unknown ids too)`)

		const after = await api('GET', '/provider', { directory: path.join(workDir, 'project') })
		info(`after:  connected=[${(after.connected || []).join(', ')}] failed=[${(after.failed || []).join(', ')}]`)

		if ((after.connected || []).includes(PROVIDER)) ok(`"${PROVIDER}" is in connected - the key took effect`)
		else if ((after.failed || []).includes(PROVIDER)) bad(`"${PROVIDER}" is in failed - the engine rejected the key`)
		else bad(`"${PROVIDER}" is in neither connected nor failed - it is not a real catalog id, or the key was ignored`)

		// --- plain-text credential check ----------------------------------------------
		// Search rather than guess: xdg-basedir on Windows may ignore XDG_DATA_HOME, so the
		// file can land somewhere other than where we pointed the engine.
		const authFiles = findAuthFiles(path.dirname(workDir))
		if (!authFiles.length) {
			info(`no auth.json found under ${path.dirname(workDir)} - the engine may hold credentials in memory only`)
		}
		for (const f of authFiles) {
			try {
				const raw = fs.readFileSync(f, 'utf8')
				if (raw.includes(KEY.slice(0, 12))) {
					bad(`the raw key text appears verbatim in ${f} (plaintext on disk)`)
				} else {
					info(`${f} exists but does not contain the raw key verbatim`)
				}
			} catch (e) {
				info(`could not read ${f}: ${e.message}`)
			}
		}

		// --- a real turn ---------------------------------------------------------------
		const session = await api('POST', '/session', { directory: path.join(workDir, 'project'), body: { title: 'smoke' } })
		if (!session?.id) throw new Error('could not create a session')
		ok(`session created: ${session.id}`)

		let sawText = false
		let sawTool = false
		const events = await streamTurn(api, path.join(workDir, 'project'), session.id, 'Reply with exactly the word: pong', ev => {
			if (ev.type === 'message.part.updated') {
				const part = ev.properties?.part
				if (part?.type === 'text' && part.text) { sawText = true; info(`text: ${JSON.stringify(part.text.slice(0, 200))}`) }
				if (part?.type === 'tool') { sawTool = true; info(`tool: ${part.name} ${part.state?.status}`) }
			} else if (ev.type === 'message.part.delta') {
				sawText = true
			} else if (ev.type === 'session.error') {
				bad(`session.error: ${JSON.stringify(ev.properties?.error ?? ev.properties).slice(0, 400)}`)
			} else if (ev.type !== 'message.updated' && ev.type !== 'message.part.removed') {
				info(`event: ${ev.type}`)
			}
		})

		info(`received ${events.length} events`)
		const types = [...new Set(events.map(e => e.type))].sort()
		info(`event types: ${types.join(', ')}`)

		if (sawText) ok('assistant text streamed')
		else bad('no assistant text arrived')
		if (sawTool) info('a tool was called')
		if (events.some(e => e.type === 'session.idle')) ok('session reported idle (turn completed)')
		else bad('no session.idle - the turn did not finish')

	} catch (err) {
		bad(`unexpected error: ${err?.stack ?? err?.message ?? err}`)
	} finally {
		// --- egress ---------------------------------------------------------------------
		await new Promise(r => setTimeout(r, 2000))
		watch.stop()
		const hosts = watch.hosts()
		const monitorWorked = watch.worked()
		const identified = await resolveWatchedHosts(WATCH)
		log('')
		log('Outbound connections observed while running:')
		if (!monitorWorked) {
			bad('could not read netstat - egress is UNKNOWN, not clean. Do not treat this as a pass.')
		} else if (!hosts.length) {
			ok('no non-loopback connections observed (monitor was working)')
		}
		for (const ip of hosts) {
			const named = identified.get(ip)
			if (named) log(`  >>> ${ip}  =  ${named}   <-- WATCHED`)
			else log(`  ---> ${ip}  (not a watched host)`)
		}
		for (const ip of hosts) {
			const named = identified.get(ip)
			if (!named) continue
			if (named === 'api.kilo.ai' || named === 'kilocode.ai') {
				bad(`contacted Kilo's hosted gateway (${named} via ${ip}) - the provider block failed`)
			} else if (named === 'models.dev') {
				info('contacted models.dev - public model catalog, no user data (expected)')
			}
		}
		if (identified.size) {
			info(`watched host IPs resolved: ${[...identified.entries()].map(([i, h]) => `${h}=${i}`).join(', ')}`)
		} else {
			bad('could not resolve the watched hostnames - cannot identify destinations')
		}

		log('')
		log('='.repeat(70))
		log(failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`)
		log('='.repeat(70))

		try { proc.kill() } catch { /* ignore */ }
		process.exit(failures === 0 ? 0 : 1)
	}
}

main().catch(err => {
	console.error(err)
	process.exit(2)
})