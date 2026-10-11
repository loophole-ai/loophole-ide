/*---------------------------------------------------------------------------------------------
 *  Web fetching and HTML to text or markdown conversion for the fetch_url tool.
 *--------------------------------------------------------------------------------------------*/

import type { FetchFormat } from '../common/toolsServiceTypes.js';

export const FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_MAX_TIMEOUT_MS = 120_000;
export const FETCH_TRUNCATE_CHARS = 100_000;

export interface FetchResult {
	content: string;
	truncated: boolean;
}

export function validateFetchUrl(raw: string): URL {
	const url = raw.trim();
	if (!/^https?:\/\//i.test(url)) {
		throw new Error('URL must start with http:// or https://');
	}
	return new URL(url);
}

export async function fetchUrl(rawUrl: string, format: FetchFormat, timeoutMs?: number): Promise<FetchResult> {
	const url = validateFetchUrl(rawUrl);
	const timeout = Math.min(Math.max(timeoutMs ?? FETCH_TIMEOUT_MS, 1000), FETCH_MAX_TIMEOUT_MS);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(url.toString(), {
			method: 'GET',
			redirect: 'follow',
			signal: controller.signal,
			headers: {
				'User-Agent': 'Loophole-IDE',
				'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
			},
		});

		if (!response.ok) {
			throw new Error(`Request failed with status code ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
		}

		const body = await readCapped(response);
		const contentType = response.headers.get('content-type') ?? '';

		let content: string;
		switch (format) {
			case 'markdown':
				content = isHtml(contentType) ? htmlToMarkdown(body) : '```\n' + body + '\n```';
				break;
			case 'text':
				content = isHtml(contentType) ? htmlToText(body) : body;
				break;
			default:
				content = body;
		}

		// A page that converts to nothing is a failure, not a result. An empty
		// body here previously came back as a successful tool call holding
		// nothing, and the only sensible thing the model could do with that was
		// tell the user the fetch had failed - which is exactly what it did,
		// with the real reason nowhere on screen. Throwing puts the reason in
		// the tool call the user can already see.
		if (!content.trim()) {
			throw new Error('The page was fetched but contains no readable text. It may render its content with JavaScript, which this tool cannot execute.');
		}

		return clip(content);
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw new Error(`Request timed out after ${Math.round(timeout / 1000)}s`);
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

function isHtml(contentType: string): boolean {
	return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function clip(content: string): FetchResult {
	if (content.length <= FETCH_TRUNCATE_CHARS) {
		return { content, truncated: false };
	}
	return {
		content: content.slice(0, FETCH_TRUNCATE_CHARS) + `\n\n[truncated: response exceeded ${FETCH_TRUNCATE_CHARS} characters]`,
		truncated: true,
	};
}

async function readCapped(response: Response): Promise<string> {
	if (!response.body) {
		return await response.text();
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8');
	const parts: string[] = [];
	let received = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			received += value.byteLength;
			parts.push(decoder.decode(value, { stream: received <= FETCH_MAX_BYTES }));
			if (received >= FETCH_MAX_BYTES) {
				await reader.cancel();
				break;
			}
		}
	} finally {
		parts.push(decoder.decode());
	}

	return parts.join('');
}

const ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
	mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
	rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d',
	copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0', euro: '\u20ac', pound: '\u00a3',
	times: '\u00d7', middot: '\u00b7', bull: '\u2022', laquo: '\u00ab', raquo: '\u00bb',
};

export function decodeEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
		if (entity[0] === '#') {
			const code = entity[1] === 'x' || entity[1] === 'X'
				? parseInt(entity.slice(2), 16)
				: parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[entity.toLowerCase()] ?? match;
	});
}

const DROPPED = /<(script|style|noscript|svg|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function htmlToText(html: string): string {
	const stripped = html
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(DROPPED, ' ')
		.replace(/<(script|style|noscript|svg|iframe|object|embed|template)\b[^>]*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, ' ');
	return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

const INLINE_TAGS = 'a|strong|b|em|i|code|del|s|sup|sub|small|mark|u|span|br|img';
const INLINE_STRIP = new RegExp(`</?(?:${INLINE_TAGS})\\b[^>]*>`, 'gi');
const ANY_TAG = /<[^>]+>/g;

function bare(markup: string): string {
	return markup.replace(INLINE_STRIP, '').trim();
}

function inline(markup: string): string {
	let out = markup;

	out = out.replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_m, alt: string) => `[image: ${alt}]`);
	out = out.replace(/<img\b[^>]*>/gi, '[image]');
	out = out.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
		const text = bare(label);
		const target = href.trim();
		return text && target && !target.startsWith('#') ? `[${text}](${target})` : text;
	});
	out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `**${bare(inner)}**`);
	out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `*${bare(inner)}*`);
	out = out.replace(/<(del|s)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `~~${bare(inner)}~~`);
	out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => '`' + bare(inner) + '`');
	out = out.replace(/<br\s*\/?>/gi, '\n');

	return out.replace(INLINE_STRIP, '');
}

export function htmlToMarkdown(html: string): string {
	const source = html
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(DROPPED, ' ')
		.replace(/<(script|style|noscript|svg|iframe|object|embed|template)\b[^>]*\/?>/gi, ' ')
		.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${bare(inner)}\n\n`)
		.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => `\n\n\`\`\`\n${bare(inner)}\n\`\`\`\n\n`)
		.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => '\n\n' + bare(inner).split('\n').map(l => '> ' + l).join('\n') + '\n\n')
		.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${bare(inner)}`)
		.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|section|article|tr|ul|ol|table)>/gi, '\n\n');

	// Everything structural has been turned into markdown by now, so any tag
	// still present is layout the converter does not model. Those are dropped
	// before entities are decoded, otherwise text that legitimately contains
	// escaped angle brackets, such as &lt;div&gt;, would be eaten as a tag.
	const withoutTags = inline(source).replace(ANY_TAG, '');

	const out = decodeEntities(withoutTags)
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return out;
}
