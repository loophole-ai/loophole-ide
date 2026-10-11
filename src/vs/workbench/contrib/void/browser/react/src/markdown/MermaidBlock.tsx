import React, { useEffect, useState } from 'react';

const MERMAID_URL = 'https://esm.sh/mermaid@11';

let mermaidPromise: Promise<any> | null = null;

/**
 * Mermaid is large and pulls in its own layout engine, so it is never pulled in
 * for a chat that contains no diagrams, and it is not a bundled dependency at
 * all. Loading it from a URL keeps it out of the build entirely, which means the
 * workbench does not carry three megabytes it will mostly never use.
 *
 * A full URL is left alone by the bundler, so this costs nothing at build time.
 */
async function loadMermaid(): Promise<any> {
	if (!mermaidPromise) {
		mermaidPromise = import(/* @vite-ignore */ MERMAID_URL)
			.then((mod: any) => {
				const mermaid = mod?.default ?? mod;
				if (!mermaid || typeof mermaid.initialize !== 'function') {
					throw new Error('the mermaid module loaded but did not look like mermaid');
				}
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					theme: 'dark',
				});
				return mermaid;
			})
			.catch(e => {
				// A failed load must not poison every later attempt.
				mermaidPromise = null;
				throw e;
			});
	}
	return mermaidPromise;
}

let renderSeq = 0;

export const MermaidBlock = ({ code }: { code: string }) => {
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open || svg || error) return;

		let cancelled = false;
		const id = `mermaid-${++renderSeq}`;

		loadMermaid()
			.then(mermaid => mermaid.render(id, code))
			.then(result => { if (!cancelled) setSvg(result.svg) })
			.catch(e => {
				if (!cancelled) setError(e?.message ? String(e.message) : 'Could not render this diagram.');
			});

		return () => { cancelled = true };
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
		</div>;
	}

	return <div className='border border-loophole-border-3 rounded-sm p-2 overflow-auto'>
		{error
			? <>
				<div className='text-xs text-loophole-fg-3 mb-1'>{error}</div>
				<pre className='text-xs whitespace-pre-wrap'>{code}</pre>
			</>
			: <div className='mermaid-host' dangerouslySetInnerHTML={{ __html: svg ?? '' }} />}
	</div>;
};