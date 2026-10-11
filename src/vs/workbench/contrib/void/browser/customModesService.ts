import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

export const CUSTOM_MODES_DIR = '.loophole/modes';

export type CustomMode = {
	id: string;
	name: string;
	description: string;
	/** Tool names this mode may use. Empty means read-only. */
	tools: string[];
	prompt: string;
	path: string;
};

function stripQuotes(value: string): string {
	const t = value.trim()
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
	return t
}

function parseList(value: string): string[] {
	const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
	return inner.split(',').map(s => stripQuotes(s)).filter(Boolean)
}

/**
 * Reads one mode file. Anything malformed yields nothing rather than throwing,
 * because a typo in someone's mode file must not stop the editor starting.
 */
export function parseCustomMode(content: string, path: string, id: string): CustomMode | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content)
	if (!match) return null

	const front = match[1]
	const prompt = match[2].trim()
	if (!prompt) return null

	let name = id
	let description = ''
	let tools: string[] = []

	for (const raw of front.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const sep = line.indexOf(':')
		if (sep === -1) continue
		const key = line.slice(0, sep).trim().toLowerCase()
		const value = line.slice(sep + 1).trim()
		if (key === 'name') name = stripQuotes(value) || id
		else if (key === 'description') description = stripQuotes(value)
		else if (key === 'tools') tools = parseList(value)
	}

	return { id, name, description, tools, prompt, path }
}

export function parseCustomModesDir(files: { name: string, content: string, path: string }[]): CustomMode[] {
	const out: CustomMode[] = []
	for (const file of files) {
		if (!file.name.endsWith('.md')) continue
		const id = file.name.slice(0, -3)
		const mode = parseCustomMode(file.content, file.path, id)
		if (mode) out.push(mode)
	}
	return out
}

export interface ICustomModesService {
	readonly _serviceBrand: undefined;
	getModes(): CustomMode[];
	getMode(id: string): CustomMode | undefined;
	refresh(): Promise<CustomMode[]>;
}

export const ICustomModesService = createDecorator<ICustomModesService>('voidCustomModesService');

class CustomModesService extends Disposable implements ICustomModesService {
	readonly _serviceBrand: undefined;

	private modes: CustomMode[] = [];

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
	) { super() }

	getModes(): CustomMode[] { return this.modes }

	getMode(id: string): CustomMode | undefined { return this.modes.find(m => m.id === id) }

	async refresh(): Promise<CustomMode[]> {
		const folders = this.workspaceContext.getWorkspace().folders ?? []
		const found: CustomMode[] = []

		for (const folder of folders) {
			const dirUri = URI.joinPath(folder.uri, ...CUSTOM_MODES_DIR.split('/'))
			let listing
			try { listing = await this.fileService.resolve(dirUri) } catch { continue }
			if (!listing?.isDirectory) continue

			for (const name of listing.children.map(c => c.name)) {
				if (!name.endsWith('.md')) continue
				const fileUri = dirUri.with({ path: `${dirUri.path}/${name}` })
				try {
					const content = await this.fileService.readFile(fileUri)
					const text = content.value.toString()
					const mode = parseCustomMode(text, fileUri.fsPath, name.slice(0, -3))
					if (mode) found.push(mode)
				} catch { continue }
			}
		}

		this.modes = found
		return found
	}
}

registerSingleton(ICustomModesService, CustomModesService, InstantiationType.Delayed);