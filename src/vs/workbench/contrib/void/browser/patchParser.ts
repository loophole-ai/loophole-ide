export type PatchOp =
	| { kind: 'add'; path: string; content: string }
	| { kind: 'delete'; path: string }
	| { kind: 'update'; path: string; moveTo?: string; hunks: PatchHunk[] };

export type PatchHunk = {
	/** Text from the @@ line, used to find where the hunk goes. */
	anchor: string;
	/** ' ' context, '-' removed, '+' added. */
	lines: { type: ' ' | '-' | '+'; text: string }[];
};

const HEADER_RE = /^\*\*\* (Add File|Update File|Delete File): (.+)$/;

export function parsePatch(patchText: string): PatchOp[] {
	const normalized = patchText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const lines = normalized.split('\n');

	const ops: PatchOp[] = [];
	let i = 0

	if (lines[i]?.trim() !== '*** Begin Patch') {
		throw new Error('Patch must start with "*** Begin Patch"')
	}
	i += 1

	while (i < lines.length) {
		const line = lines[i]
		if (line.trim() === '*** End Patch') { break }

		const header = HEADER_RE.exec(line)
		if (!header) {
			throw new Error(`Expected a file header on line ${i + 1}, got: ${line}`)
		}

		const kind = header[1]
		const path = header[2].trim()
		i += 1

		if (kind === 'Delete File') {
			ops.push({ kind: 'delete', path })
			continue
		}

		if (kind === 'Add File') {
			const content: string[] = []
			while (i < lines.length && !lines[i].startsWith('*** ')) {
				const l = lines[i]
				if (!l.startsWith('+')) {
					throw new Error(`Every line of an added file must start with +, on line ${i + 1}`)
				}
				content.push(l.slice(1))
				i += 1
			}
			ops.push({ kind: 'add', path, content: content.join('\n') })
			continue
		}

		let moveTo: string | undefined
		if (lines[i]?.startsWith('*** Move to: ')) {
			moveTo = lines[i].slice('*** Move to: '.length).trim()
			i += 1
		}

		const hunks: PatchHunk[] = []
		while (i < lines.length && !lines[i].startsWith('*** ')) {
			if (!lines[i].startsWith('@@')) {
				throw new Error(`Expected a hunk header (@@) on line ${i + 1}, got: ${lines[i]}`)
			}
			const anchor = lines[i].slice(2).trim()
			i += 1

			const hunkLines: PatchHunk['lines'] = []
			while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('*** ')) {
				const l = lines[i]
				const marker = l[0]
				if (marker === ' ' || marker === '-' || marker === '+') {
					hunkLines.push({ type: marker, text: l.slice(1) })
				}
				else if (l === '') {
					hunkLines.push({ type: ' ', text: '' })
				}
				else {
					throw new Error(`Hunk line must start with space, + or -, on line ${i + 1}: ${l}`)
				}
				i += 1
			}
			hunks.push({ anchor, lines: hunkLines })
		}

		ops.push({ kind: 'update', path, moveTo, hunks })
	}

	return ops
}

/**
 * Applies one hunk to the file's lines by finding its context.
 *
 * The anchor is a hint rather than a line number, so the same text matches
 * wherever it actually sits. Searching the whole file rather than from a
 * recorded position is what lets the patch survive the earlier hunks shifting
 * everything below them.
 */
export function applyHunks(original: string, hunks: PatchHunk[]): string {
	const lines = original.replace(/\r\n/g, '\n').split('\n')
	let searchFrom = 0

	for (const hunk of hunks) {
		const before = hunk.lines.filter(l => l.type !== '+').map(l => l.text)
		const after = hunk.lines.filter(l => l.type !== '-').map(l => l.text)

		const anchorText = hunk.anchor
		let start = -1

		if (anchorText) {
			for (let i = searchFrom; i < lines.length; i++) {
				if (lines[i].includes(anchorText)) { start = i + 1; break }
			}
			if (start === -1) {
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].includes(anchorText)) { start = i + 1; break }
				}
			}
			if (start === -1) {
				throw new Error(`Could not find the context for this hunk: "${anchorText}"`)
			}
		}
		else {
			start = searchFrom
		}

		const found = matchAt(lines, before, start)
		if (found === -1) {
			throw new Error(`Could not find the lines this hunk expects to change:\n${before.slice(0, 5).join('\n')}`)
		}

		lines.splice(found, before.length, ...after)
		searchFrom = found + after.length
	}

	return lines.join('\n')
}

function matchAt(lines: string[], pattern: string[], start: number): number {
	if (pattern.length === 0) return start
	for (let i = start; i <= lines.length - pattern.length; i++) {
		let ok = true
		for (let j = 0; j < pattern.length; j++) {
			if (lines[i + j] !== pattern[j]) { ok = false; break }
		}
		if (ok) return i
	}
	return -1
}