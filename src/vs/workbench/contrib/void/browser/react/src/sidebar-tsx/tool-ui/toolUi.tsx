import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useAccessor } from '../../util/services.js';
import { URI, ScrollType } from '../../util/vscodeInternals.js';
import { formatDuration } from './toolData.js';

export const useAutoOpen = (running: boolean, keepOpen: boolean = false): [boolean, () => void] => {
	const [isOpen, setIsOpen] = useState(running || keepOpen);
	const userToggled = useRef(false);
	useEffect(() => {
		if (userToggled.current) return;
		if (running || keepOpen) {
			setIsOpen(true);
			return;
		}
		const timer = window.setTimeout(() => setIsOpen(false), 700);
		return () => window.clearTimeout(timer);
	}, [running, keepOpen]);
	const toggle = () => {
		userToggled.current = true;
		setIsOpen((value) => !value);
	};
	return [isOpen, toggle];
};

export const useDuration = (startedAt: number | undefined, endedAt: number | undefined, running: boolean): string => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [running]);
	if (startedAt === undefined) return '';
	const end = endedAt ?? (running ? now : undefined);
	return end === undefined ? '' : formatDuration(Math.max(0, end - startedAt));
};

const isAbsolutePath = (path: string): boolean => path.startsWith('/') || path.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(path);

export const useOpenFile = () => {
	const accessor = useAccessor();
	return useCallback((path: string, line?: number) => {
		const commandService = accessor.get('ICommandService');
		const editorService = accessor.get('ICodeEditorService');
		const workspaceService = accessor.get('IWorkspaceContextService');
		const folder = workspaceService.getWorkspace().folders[0]?.uri;
		const uri = isAbsolutePath(path) || !folder ? URI.file(path) : URI.joinPath(folder, path);
		commandService.executeCommand('vscode.open', uri).then(() => {
			if (line === undefined) return;
			setTimeout(() => {
				const editor = editorService.getActiveCodeEditor();
				if (!editor) return;
				const range = { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: Number.MAX_SAFE_INTEGER };
				editor.setSelection(range);
				editor.revealRange(range, ScrollType.Immediate);
			}, 50);
		});
	}, [accessor]);
};

export const useOpenUrl = () => {
	const accessor = useAccessor();
	return useCallback((url: string) => {
		accessor.get('ICommandService').executeCommand('vscode.open', URI.parse(url));
	}, [accessor]);
};

export const useCopyText = (): [boolean, (text: string) => void] => {
	const accessor = useAccessor();
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	const copy = useCallback((text: string) => {
		void accessor.get('IClipboardService').writeText(text);
		setCopied(true);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setCopied(false), 1200);
	}, [accessor]);
	return [copied, copy];
};

export const FileLink = ({ path, line, className, children }: { path: string; line?: number; className?: string; children: React.ReactNode }) => {
	const openFile = useOpenFile();
	return <span
		className={`cursor-pointer hover:text-[var(--vscode-textLink-foreground)] hover:underline ${className ?? ''}`}
		title='Open in editor'
		onClick={(e) => {
			e.stopPropagation();
			openFile(path, line);
		}}
	>{children}</span>;
};

export const UrlLink = ({ url, className, children }: { url: string; className?: string; children: React.ReactNode }) => {
	const openUrl = useOpenUrl();
	return <span
		className={`cursor-pointer hover:text-[var(--vscode-textLink-foreground)] hover:underline ${className ?? ''}`}
		title='Open in browser'
		onClick={(e) => {
			e.stopPropagation();
			openUrl(url);
		}}
	>{children}</span>;
};

export const CardShell = ({ isOpen, onToggle, head, children }: { isOpen: boolean; onToggle: () => void; head: React.ReactNode; children: React.ReactNode }) => {
	return <div className='w-full min-w-0 border border-loophole-border-3 rounded px-2 py-1 bg-loophole-bg-3 overflow-hidden'>
		<div className='select-none flex items-center gap-1.5 min-h-[24px] min-w-0 cursor-pointer' onClick={onToggle}>
			<ChevronRight className={`text-loophole-fg-3 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`} />
			{head}
		</div>
		{isOpen && <div className='pt-1 pb-0.5 min-w-0'>{children}</div>}
	</div>;
};
