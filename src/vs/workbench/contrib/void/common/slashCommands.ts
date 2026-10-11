export type SlashCommand = {
	name: string;
	description: string;
	template: string;
};

export const slashCommands: SlashCommand[] = [
	{
		name: 'review',
		description: 'Review the changes in this workspace',
		template: 'Review the uncommitted changes in this workspace. Look for bugs, missing edge cases and anything that breaks existing behaviour. Report what you find; do not change anything unless asked.',
	},
	{
		name: 'test',
		description: 'Run the tests and fix what fails',
		template: 'Run this project\'s tests and fix whatever fails. Show me the output first, then fix the cause rather than the symptom, and re-run to confirm.',
	},
	{
		name: 'fix',
		description: 'Fix the errors in the active file',
		template: 'Fix the errors reported in the active file. Read it before editing, and confirm each error is actually resolved rather than silenced.',
	},
	{
		name: 'explain',
		description: 'Explain the selected code',
		template: 'Explain the selected code. Cover what it does, why it is written this way, and anything surprising about it.',
	},
	{
		name: 'docs',
		description: 'Document the selected code',
		template: 'Document the selected code. Add doc comments in the style this project already uses, describing behaviour and arguments rather than restating the code.',
	},
	{
		name: 'commit',
		description: 'Write a commit message',
		template: 'Write a commit message for the current changes. Describe what changed and why, in the imperative, following the style of this repository\'s recent commits. Output only the message.',
	},
	{
		name: 'init',
		description: 'Create an AGENTS.md for this project',
		template: 'Explore this project and write an AGENTS.md in the root describing how it is laid out, how to build and test it, and the conventions its code follows. Keep it short and specific to this repository.',
	},
	{
		name: 'security',
		description: 'Review the changes for security problems',
		template: 'Review the uncommitted changes for security problems. Look for injection, unsafe path handling, secrets in code, missing authorisation checks and anything that trusts its input. Report findings with file and line; do not change anything unless asked.',
	},
];

export function matchSlashCommands(query: string): SlashCommand[] {
	const q = query.toLowerCase();
	if (!q) return slashCommands;
	return slashCommands.filter(c => c.name.startsWith(q));
}

export function findSlashCommand(name: string): SlashCommand | undefined {
	return slashCommands.find(c => c.name === name.toLowerCase());
}