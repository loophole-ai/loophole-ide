import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ITerminalService } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IChatThreadService } from './chatThreadService.js';
import { VOID_VIEW_CONTAINER_ID } from './sidebarPane.js';
import { IMetricsService } from '../common/metricsService.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';

function selectedTerminalText(accessor: ServicesAccessor): string {
	const terminalService = accessor.get(ITerminalService);
	const xterm = terminalService.activeInstance?.xterm;
	if (!xterm) return '';

	const lines: string[] = [];
	for (const line of xterm.getBufferReverseIterator()) {
		lines.unshift(line);
	}

	const all = removeAnsiEscapeCodes(lines.join('\n')).trim();
	if (!all) return '';

	// Long scrollback is mostly noise; the tail is what the user is looking at.
	return all.length > 6000 ? all.slice(-6000) : all;
}

async function sendToChat(accessor: ServicesAccessor, event: string, buildPrompt: (text: string) => string): Promise<void> {
	accessor.get(IMetricsService).capture(event, {});

	const text = selectedTerminalText(accessor);
	if (!text) return;

	const viewsService = accessor.get(IViewsService);
	const chatThreadService = accessor.get(IChatThreadService);

	if (!viewsService.isViewContainerVisible(VOID_VIEW_CONTAINER_ID)) {
		await viewsService.openViewContainer(VOID_VIEW_CONTAINER_ID);
	}
	await chatThreadService.focusCurrentChat();

	const threadId = chatThreadService.state.currentThreadId;
	await chatThreadService.addUserMessageAndStreamResponse({
		userMessage: buildPrompt(text),
		threadId,
	});
}

class ExplainTerminalSelectionAction extends Action2 {
	constructor() {
		super({
			id: 'void.explainTerminalSelection',
			title: localize2('voidExplainTerminal', 'Loophole: Explain Terminal Output'),
			menu: [{
				id: MenuId.TerminalInstanceContext,
				group: '9_void@1',
			}],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return sendToChat(accessor, 'Explain Terminal', (text) =>
			`Here is output from a terminal:\n\n\`\`\`\n${text}\n\`\`\`\n\nExplain what it means and what I should do about it. If it looks like an error, say what caused it and how to fix it.`);
	}
}

class FixTerminalSelectionAction extends Action2 {
	constructor() {
		super({
			id: 'void.fixTerminalSelection',
			title: localize2('voidFixTerminal', 'Loophole: Fix This Error'),
			menu: [{
				id: MenuId.TerminalInstanceContext,
				group: '9_void@2',
			}],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return sendToChat(accessor, 'Fix Terminal Error', (text) =>
			`This terminal command failed:\n\n\`\`\`\n${text}\n\`\`\`\n\nFind out why and fix it. Reproduce the failure first so you are fixing the real cause, and re-run the command afterwards to confirm.`);
	}
}

class GenerateCommandAction extends Action2 {
	constructor() {
		super({
			id: 'void.generateTerminalCommand',
			title: localize2('voidGenerateCommand', 'Loophole: Generate Command From Selection'),
			menu: [{
				id: MenuId.TerminalInstanceContext,
				group: '9_void@3',
			}],
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return sendToChat(accessor, 'Generate Command', (text) =>
			`Write the shell command that does this:\n\n\`\`\`\n${text}\n\`\`\`\n\nOutput only the command, nothing else.`);
	}
}

registerAction2(ExplainTerminalSelectionAction);
registerAction2(FixTerminalSelectionAction);
registerAction2(GenerateCommandAction);