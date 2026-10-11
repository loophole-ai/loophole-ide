import React, { useEffect, useRef, useState } from 'react';

let mermaidPromise: Promise<any> | null = null;

/**
 * Mermaid is large and pulls in its own layout engine, so it is never pulled in
 * for a chat that contains no diagrams. The first diagram pays the import; every
 * later one reuses it.
 */
async function loadMermaid(): Promise<any> {
	if (!mermaidPromise) {
		mermaidPromise = import(/* webpackMode: "eager" */ 'mermaid')
			.then(mod => (mod as any).default ?? mod)
			.then(mermaid => {
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					theme: 'dark',
					fontFamily: 'var(--vscode-editor-font-family, monospace)',
				});
				return mermaid;
			});
	}
	return mermaidPromise;
}

let renderSeq = 0;

export const MermaidBlock = ({ code }: { code: string }) => {
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const hostRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open || svg || error) return;

		let cancelled = false;
		const id = `mermaid-${++renderSeq}`;

		loadMermaid()
			.then(mermaid => {
				if (cancelled) return;
				// render() throws on malformed input rather than rejecting, and it
				// writes into a DOM node it creates itself.
				return mermaid.render(id, code)
					.then(result => {
						if (!cancelled) setSvg(result.svg)
					})
					.catch(e => {
						if (!cancelled) setError(e?.message ? String(e.message) : 'Could not render this diagram.')
					});
			})
			.catch(e => {
				if (!cancelled) setError(`Mermaid failed to load: ${e?.message ?? e}`)
			});

		return () => { cancelled = true }
	}, [open, svg, error, code]);

	if (!open) {
		return <div className='border border-loophole-border-3 rounded-sm overflow-hidden'>
			<button
				className='w-full text-left px-2 py-1 text-xs text-loophole-fg-3 hover:bg-loophole-bg-1 flex items-center gap-2'
				onClick={() => setOpen(true)}
			>
				<span>▸</span>
				<span>mermaid diagram</span>
				<span className='ml-auto opacity-70'>click to render</span>
			</button>
		</div>
	}

	return <div className='border border-loophole-border-3 rounded-sm p-2 overflow-auto'>
		{error
			? <>
				<div className='text-xs text-loophole-fg-3 mb-1'>{error}</div>
				<pre className='text-xs whitespace-pre-wrap'>{code}</pre>
			</>
			: <div ref={hostRef} className='mermaid-host' dangerouslySetInnerHTML={{ __html: svg ?? '' }} />}
	</div>
};