import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { estimateTokens } from '../common/tokenizer.js';

const MAX_FILE_BYTES = 200_000;
const CHUNK_LINES = 60;
const CHUNK_OVERLAP_LINES = 10;
const MAX_FILES = 4_000;

const SKIP_DIRS = new Set([
	'node_modules', '.git', 'dist', 'out', 'build', '.next', '.nuxt',
	'vendor', '__pycache__', '.venv', 'venv', 'target', '.gradle',
	'.idea', '.vscode-test', 'coverage', '.cache', '.turbo', '.output',
]);

const TEXT_EXTENSIONS = new Set([
	'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb',
	'.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh',
	'.sql', '.lua', '.dart', '.scala', '.ex', '.exs', '.clj', '.vue', '.svelte',
	'.json', '.md', '.yaml', '.yml', '.toml', '.css', '.scss', '.html',
]);

export type IndexChunk = {
	fsPath: string;
	startLine: number;
	endLine: number;
	text: string;
};

export type CodebaseIndex = {
	chunks: IndexChunk[];
	builtAt: number;
	fileCount: number;
	truncated: boolean;
};

export interface ICodebaseIndexService {
	readonly _serviceBrand: undefined;
	get(): CodebaseIndex | null;
	isBuilding(): boolean;
	build(): Promise<CodebaseIndex>;
	search(query: string, limit: number, pathPrefix?: string): { chunk: IndexChunk; score: number }[];
}

export const ICodebaseIndexService = createDecorator<ICodebaseIndexService>('voidCodebaseIndexService');

class CodebaseIndexService extends Disposable implements ICodebaseIndexService {
	readonly _serviceBrand: undefined;

	private index: CodebaseIndex | null = null;
	private building = false;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
	) { super() }

	get(): CodebaseIndex | null { return this.index }

	isBuilding(): boolean { return this.building }

	async build(): Promise<CodebaseIndex> {
		if (this.index) return this.index
		this.building = true
		try {
			const chunks: IndexChunk[] = []
			let fileCount = 0
			let truncated = false

			for (const folder of this.workspaceContext.getWorkspace().folders ?? []) {
				for (const uri of await this._collect(folder.uri)) {
					if (fileCount >= MAX_FILES) { truncated = true; break }
					fileCount += 1
					try {
						const stat = await this.fileService.stat(uri)
						if (!stat.isFile || stat.size > MAX_FILE_BYTES) continue
						const content = await this.fileService.readFile(uri)
						chunks.push(...chunkFile(uri.fsPath, content.value.toString()))
					}
					catch { continue }
				}
			}

			this.index = { chunks, builtAt: Date.now(), fileCount, truncated }
			return this.index
		}
		finally {
			this.building = false
		}
	}

	/**
	 * Scores a chunk by how many of the query's distinctive terms it contains.
	 *
	 * This is term matching, not embeddings. It needs no model, no API key and no
	 * download, which is why it can run at all inside an editor. The tradeoff is
	 * that it matches words rather than meaning, so a natural language question
	 * like "where do we validate paths" needs those words in the query.
	 */
	search(query: string, limit: number, pathPrefix?: string) {
		const index = this.index
		if (!index) return []

		const terms = Array.from(new Set(
			query.toLowerCase().split(/[^a-z0-9_]+/i).filter(t => t.length > 2 && !STOP.has(t))
		))
		if (!terms.length) return []

		const scored: { chunk: IndexChunk; score: number }[] = []
		for (const chunk of index.chunks) {
			if (pathPrefix && !chunk.fsPath.replace(/\\/g, '/').includes(pathPrefix.replace(/\\/g, '/'))) continue
			const haystack = `${chunk.fsPath}\n${chunk.text}`.toLowerCase()
			let score = 0
			for (const term of terms) {
				let from = 0
				let hits = 0
				for (;;) {
					const at = haystack.indexOf(term, from)
					if (at === -1 || hits >= 5) break
					hits += 1
					from = at + term.length
				}
				score += hits
			}
			if (score > 0) scored.push({ chunk, score })
		}

		scored.sort((a, b) => b.score - a.score)
		return scored.slice(0, limit)
	}

	private async _collect(dir: URI, depth = 0): Promise<URI[]> {
		if (depth > 12) return []
		let listing
		try { listing = await this.fileService.resolve(dir) } catch { return [] }
		if (!listing?.isDirectory) return []

		const out: URI[] = []
		for (const child of listing.children ?? []) {
			if (out.length >= MAX_FILES) break
			if (child.isDirectory) {
				if (SKIP_DIRS.has(child.name)) continue
				out.push(...await this._collect(child.resource, depth + 1));
			}
			else if (TEXT_EXTENSIONS.has(extname(child.name))) {
				out.push(child.resource);
			}
		}
		return out
	}
}

function extname(name: string): string {
	const i = name.lastIndexOf('.')
	return i === -1 ? '' : name.slice(i).toLowerCase()
}

function chunkFile(fsPath: string, content: string): IndexChunk[] {
	const lines = content.replace(/\r\n/g, '\n').split('\n')
	const out: IndexChunk[] = []
	for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP_LINES) {
		const end = Math.min(start + CHUNK_LINES, lines.length)
		const text = lines.slice(start, end).join('\n')
		if (estimateTokens(text) > 15) {
			out.push({ fsPath, startLine: start + 1, endLine: end, text })
		}
		if (end === lines.length) break
	}
	return out
}

const STOP = new Set([
	'the', 'and', 'for', 'with', 'that', 'this', 'from', 'where', 'what', 'how',
	'does', 'are', 'was', 'you', 'our', 'their', 'about', 'into', 'when', 'then',
	'them', 'they', 'have', 'been', 'into', 'some', 'more', 'than', 'also',
]);

registerSingleton(ICodebaseIndexService, CodebaseIndexService, InstantiationType.Delayed);