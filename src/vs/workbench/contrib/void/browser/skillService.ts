import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

export const SKILL_DIRS = ['.loophole/skills', 'skills'];

export type Skill = {
	name: string;
	description: string;
	body: string;
	path: string;
};

export function parseSkill(content: string, path: string): Skill | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
	if (!match) return null;

	let name = '';
	let description = '';
	for (const raw of match[1].split(/\r?\n/)) {
		const line = raw.trim();
		const sep = line.indexOf(':');
		if (sep === -1) continue;
		const key = line.slice(0, sep).trim().toLowerCase();
		const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
		if (key === 'name') name = value;
		else if (key === 'description') description = value;
	}

	const body = match[2].trim();
	if (!name || !body) return null;
	return { name, description, body, path };
}

export interface ISkillService {
	readonly _serviceBrand: undefined;
	getSkills(): Skill[];
	getSkill(name: string): Skill | undefined;
	refresh(): Promise<Skill[]>;
	describeSkills(): string;
}

export const ISkillService = createDecorator<ISkillService>('voidSkillService');

class SkillService extends Disposable implements ISkillService {
	readonly _serviceBrand: undefined;

	private skills: Skill[] = [];

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
	) { super() }

	getSkills(): Skill[] { return this.skills }

	getSkill(name: string): Skill | undefined {
		return this.skills.find(s => s.name === name);
	}

	describeSkills(): string {
		if (!this.skills.length) { return 'No skills are installed.' }
		return this.skills.map(s => `- ${s.name}${s.description ? `: ${s.description}` : ''}`).join('\n');
	}

	async refresh(): Promise<Skill[]> {
		const folders = this.workspaceContext.getWorkspace().folders ?? [];
		const found: Skill[] = [];

		for (const folder of folders) {
			for (const rel of SKILL_DIRS) {
				const base = URI.joinPath(folder.uri, ...rel.split('/'))
				for (const file of await this._collect(base)) {
					try {
						const content = await this.fileService.readFile(file)
						const skill = parseSkill(content.value.toString(), file.fsPath)
						if (skill && !found.some(s => s.name === skill.name)) found.push(skill)
					}
					catch { continue }
				}
			}
		}

		this.skills = found
		return found
	}

	private async _collect(dir: URI, depth = 0): Promise<URI[]> {
		if (depth > 4) return [];
		let listing;
		try { listing = await this.fileService.resolve(dir) } catch { return [] }
		if (!listing?.isDirectory) return [];

		const out: URI[] = [];
		for (const child of listing.children) {
			if (child.isDirectory) {
				out.push(...await this._collect(child.resource, depth + 1));
			}
			else if (child.name.endsWith('.md')) {
				out.push(child.resource);
			}
		}
		return out;
	}
}

registerSingleton(ISkillService, SkillService, InstantiationType.Delayed);