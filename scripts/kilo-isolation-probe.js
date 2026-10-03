// Probe: which environment variable actually redirects the engine's data/config directory?
//
// The prebuilt binary references XDG_DATA_HOME / KILO_CONFIG_DIR as strings, but a live run
// still wrote to the user's real ~/.local/share/kilo. That is the signature of a bundler
// inlining process.env.X at build time. This probe sets each candidate one at a time and
// reports where the engine actually wrote.
//
// Usage: node scripts/kilo-isolation-probe.js
'use strict'

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const BINARY = process.env.KILO_BIN ||
	path.join(os.tmpdir(), 'kilo-only', 'node_modules', '@kilocode', 'cli-windows-x64', 'bin', 'kilo.exe')

const SCENARIOS = [
	{ name: 'XDG_* only', vars: d => ({ XDG_DATA_HOME: path.join(d, 'data'), XDG_CONFIG_HOME: path.join(d, 'config'), XDG_CACHE_HOME: path.join(d, 'cache'), XDG_STATE_HOME: path.join(d, 'state') }) },
	{ name: 'KILO_CONFIG_DIR only', vars: d => ({ KILO_CONFIG_DIR: path.join(d, 'config') }) },
	{ name: 'USERPROFILE redirected', vars: d => ({ USERPROFILE: d, HOME: d }) },
	{ name: 'all three', vars: d => ({ XDG_DATA_HOME: path.join(d, 'data'), XDG_CONFIG_HOME: path.join(d, 'config'), XDG_CACHE_HOME: path.join(d, 'cache'), XDG_STATE_HOME: path.join(d, 'state'), KILO_CONFIG_DIR: path.join(d, 'config'), USERPROFILE: d, HOME: d }) },
]

/** Lists files under dir, relative, capped. */
function listFiles(dir, cap = 12) {
	const out = []
	const walk = (p, depth) => {
		if (depth > 4 || out.length >= cap) return
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

async function run(scenario) {
	const root = path.join(os.tmpdir(), `kilo-iso-${crypto.randomBytes(4).toString('hex')}`)
	fs.mkdirSync(root, { recursive: true })

	const env = {
		...process.env,
		KILO_SERVER_USERNAME: 'kilo',
		KILO_SERVER_PASSWORD: crypto.randomBytes(16).toString('hex'),
		KILO_TELEMETRY_LEVEL: 'off',
		...scenario.vars(root),
	}

	const proc = spawn(BINARY, ['serve', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
	await new Promise((resolve) => {
		let buf = ''
		const done = () => resolve()
		const timer = setTimeout(done, 45000)
		proc.stdout.on('data', c => {
			buf += c.toString()
			if (buf.includes('listening on')) { clearTimeout(timer); done() }
		})
		proc.on('error', done)
		proc.on('exit', done)
	})

	// let it settle, then kill hard so we see what it wrote at startup
	await new Promise(r => setTimeout(r, 2500))
	try { proc.kill('SIGKILL') } catch { /* ignore */ }
	await new Promise(r => setTimeout(r, 700))

	const wrote = listFiles(root)
	console.log(`\n[${scenario.name}]`)
	console.log(`  wrote into our dir : ${wrote.length ? wrote.join(', ') : 'NOTHING'}`)
	return wrote.length
}

async function main() {
	if (!fs.existsSync(BINARY)) {
		console.error(`binary not found: ${BINARY}\nset KILO_BIN`)
		process.exit(2)
	}
	console.log(`binary: ${BINARY}`)
	console.log(`watching: ${os.tmpdir()}`)
	for (const s of SCENARIOS) {
		await run(s)
	}
}

main()