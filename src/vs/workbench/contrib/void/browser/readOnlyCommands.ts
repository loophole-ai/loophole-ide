/*---------------------------------------------------------------------------------------------
 *  Recognising shell commands that only read, so they can run without an approval prompt.
 *--------------------------------------------------------------------------------------------*/

// Commands that observe state and change nothing. Matched on the leading words
// of the command, so `git log --oneline` is covered by `git log` while
// `git commit` is not covered by anything here.
const READ_ONLY_COMMANDS = [
	// listing and inspection
	'ls', 'dir', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'which', 'whereis', 'type',
	'file', 'stat', 'du', 'df', 'tree',
	// identity and environment
	'whoami', 'id', 'groups', 'env', 'printenv', 'hostname', 'uname', 'date', 'cal', 'uptime', 'time',
	// git, read only forms only
	'git status', 'git log', 'git diff', 'git show', 'git branch', 'git tag', 'git remote',
	'git ls-files', 'git ls-remote', 'git rev-parse', 'git describe', 'git blame',
	'git grep', 'git shortlog', 'git whatchanged', 'git reflog', 'git stash list',
	'git config --get', 'git config --list',
	// toolchain, read only forms only
	'go version', 'go env', 'go list', 'go doc', 'go vet', 'go fmt', 'go mod',
	'node --version', 'npm --version', 'npm list', 'npm ls', 'npx tsc --version',
	'python --version', 'pip list', 'pip show',
	'cargo --version', 'cargo tree', 'cargo metadata',
	'java -version', 'javac -version', 'dotnet --info',
	'git --version', 'curl --version', 'docker --version', 'kubectl version',
];

/** Splits a command into leading words, ignoring quotes. */
function leadingWords(command: string, count: number): string[] {
	const words: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;

	for (const ch of command) {
		if (quote) {
			if (ch === quote) {
				quote = null;
			} else {
				current += ch;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				words.push(current);
				current = '';
			}
			if (words.length === count) {
				return words;
			}
			continue;
		}
		current += ch;
	}
	if (current) {
		words.push(current);
	}
	return words;
}

/**
 * Whether a terminal command only reads and can run without asking.
 *
 * A command that is prefixed by something which changes state, such as `sudo`
 * or a variable assignment, is never treated as read only no matter what
 * follows it. Chaining is not followed either: `ls && rm -rf /` is not read
 * only, and is treated as unsafe by not matching at all.
 */
export function isReadOnlyShellCommand(command: string): boolean {
	const trimmed = (command ?? '').trim();
	if (!trimmed) {
		return false;
	}

	// Anything after a shell operator means the safe prefix is not the whole
	// story. `git status && rm x` must not be waved through.
	if (/[;&|><`\n]/.test(trimmed)) {
		return false;
	}

	const words = leadingWords(trimmed, 3);
	if (words.length === 0) {
		return false;
	}

	// `sudo ls` is not `ls`. A leading `FOO=bar` assignment can change what a
	// later command does, so neither is treated as read only.
	const first = words[0];
	if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
		return false;
	}
	const ELEVATORS = ['sudo', 'doas', 'su', 'nohup', 'time', 'nice', 'command', 'nohup', 'stdbuf', 'time'];
	if (ELEVATORS.includes(first.toLowerCase())) {
		return false;
	}

	// Try the longest match first so `git config --get` beats a bare `git`
	// style rule and `npm list` is not satisfied by anything shorter.
	for (let n = Math.min(words.length, 3); n >= 1; n--) {
		const candidate = words.slice(0, n).join(' ').toLowerCase();
		const matched = READ_ONLY_COMMANDS.find(safe => {
			const safeWords = safe.split(' ');
			if (safeWords.length !== n) {
				return false;
			}
			return candidate === safe;
		});
		if (matched) {
			// A bare `git status --help` style flag is fine, but a redirect or
			// subshell was already rejected above.
			return true;
		}
	}
	return false;
}
