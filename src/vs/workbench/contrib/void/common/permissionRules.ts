export type PermissionAction = 'allow' | 'ask' | 'deny';

export type PermissionRuleItem = {
	permission: string;
	pattern: string;
	action: PermissionAction;
};

/**
 * Mirrors Kilo's defaults: nothing is off by default, but anything that
 * reaches outside the workspace or runs a command asks first.
 */
export const DEFAULT_PERMISSION_RULES: PermissionRuleItem[] = [
	{ permission: '*', pattern: '*', action: 'allow' },
	{ permission: 'external_directory', pattern: '*', action: 'ask' },
	{ permission: 'terminal', pattern: '*', action: 'ask' },
];

/**
 * Kilo's Work Style presets. One click sets the ruleset and the display
 * density together, because they are two halves of the same decision: a
 * supervised session wants to be interrupted, an autonomous one does not.
 */
export type WorkStyle = 'supervised' | 'autonomous';

export const WORK_STYLE_PRESETS: Record<WorkStyle, { label: string; description: string; rules: PermissionRuleItem[] }> = {
	supervised: {
		label: 'Supervised',
		description: 'Ask before every edit and command',
		rules: [
			{ permission: '*', pattern: '*', action: 'ask' },
		],
	},
	autonomous: {
		label: 'Autonomous',
		description: 'Only ask before commands that can break things',
		rules: [
			{ permission: '*', pattern: '*', action: 'allow' },
			{ permission: 'delete_file_or_folder', pattern: '*', action: 'ask' },
			{ permission: 'terminal', pattern: '*', action: 'ask' },
		],
	},
};

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function matchTool(tool: string, pattern: string): boolean {
	if (pattern === tool || pattern === '*') return true;
	if (!pattern.includes('*')) return false;
	return new RegExp(`^${escapeRe(pattern).replace(/\*/g, '.*')}$`).test(tool);
}

/**
 * Later rules win, so a broad default can be overridden by a narrow rule
 * appended below it without having to edit the default in place.
 */
export function effectiveRuleLevel(rules: PermissionRuleItem[] | undefined, tool: string): PermissionAction {
	const list = rules ?? []
	for (let i = list.length - 1; i >= 0; i--) {
		const item = list[i]
		if (item.pattern === '*' && matchTool(tool, item.permission)) return item.action
	}
	return 'ask'
}

export function mostRestrictive(actions: PermissionAction[]): PermissionAction {
	const order: PermissionAction[] = ['allow', 'ask', 'deny']
	return actions.reduce<PermissionAction>(
		(acc, a) => (order.indexOf(a) > order.indexOf(acc) ? a : acc),
		'allow'
	)
}