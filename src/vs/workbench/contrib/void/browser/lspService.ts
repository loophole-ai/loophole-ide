import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Location } from '../../../../editor/common/languages.js';
import { getHoverProviderResultsAsAsyncIterable } from '../../../../editor/contrib/hover/browser/getHover.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

const MAX_RESULTS = 200;

export type LspLocation = { uri: string; line: number; preview: string };

function previewAt(model: ITextModel, offset: number): string {
	return model.getLineContent(model.getPositionAt(offset).lineNumber).trim().substring(0, 300);
}

function stringifyHoverContents(contents: unknown): string {
	if (typeof contents === 'string') { return contents }
	if (Array.isArray(contents)) {
		return contents.map(stringifyHoverContents).filter(Boolean).join('\n\n')
	}
	if (contents && typeof contents === 'object' && 'value' in contents) {
		const value = (contents as { value: unknown }).value
		return typeof value === 'string' ? value : ''
	}
	return ''
}

export interface ILspService {
	readonly _serviceBrand: undefined;
	findDefinition(uri: URI, line: number, character: number): Promise<LspLocation[]>;
	findReferences(uri: URI, line: number, character: number): Promise<LspLocation[]>;
	getHover(uri: URI, line: number, character: number): Promise<string>;
	getDocumentSymbols(uri: URI): Promise<string>;
}

export const ILspService = createDecorator<ILspService>('voidLspService');

class LspService implements ILspService {
	readonly _serviceBrand: undefined;

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IVoidModelService private readonly voidModelService: IVoidModelService,
	) { }

	private async _model(uri: URI): Promise<ITextModel | null> {
		await this.voidModelService.initializeModel(uri)
		const { model } = await this.voidModelService.getModelSafe(uri)
		return model ?? null
	}

	private _position(model: ITextModel, line: number, character: number): Position {
		const safeLine = Math.min(Math.max(line, 1), model.getLineCount())
		return model.validatePosition(new Position(safeLine, Math.max(character, 1)))
	}

	async findDefinition(uri: URI, line: number, character: number): Promise<LspLocation[]> {
		const model = await this._model(uri)
		if (!model) return []

		const position = this._position(model, line, character)
		const providers = this.languageFeaturesService.definitionProvider.all(model)
		for (const provider of providers) {
			const result = await provider.provideDefinition(model, position, CancellationToken.None)
			if (!result) continue

			// Definition is a single Location, an array of them, or LocationLinks.
			const locations: Location[] = Array.isArray(result) ? result as Location[] : [result as Location]

			const seen = new Set<string>()
			const out: LspLocation[] = []
			for (const location of locations) {
				if (out.length >= MAX_RESULTS) break
				if (!location || !location.uri) continue
				if (seen.has(location.uri.fsPath)) continue
				seen.add(location.uri.fsPath)
				const targetLine = location.range?.startLineNumber ?? 1
				const target = await this._model(location.uri)
				out.push({
					uri: location.uri.fsPath,
					line: targetLine,
					preview: target ? target.getLineContent(Math.min(Math.max(targetLine, 1), target.getLineCount())).trim().substring(0, 300) : '',
				})
			}
			return out
		}
		return []
	}

	async findReferences(uri: URI, line: number, character: number): Promise<LspLocation[]> {
		const model = await this._model(uri)
		if (!model) return []

		const position = this._position(model, line, character)
		const providers = this.languageFeaturesService.referenceProvider.all(model)
		for (const provider of providers) {
			const result = await provider.provideReferences(model, position, { includeDeclaration: false }, CancellationToken.None)
			if (!result) continue

			const out: LspLocation[] = []
			for (const reference of result) {
				if (out.length >= MAX_RESULTS) break
				if (!reference || !reference.uri) continue
				const refModel = await this._model(reference.uri)
				const refLine = reference.range?.startLineNumber ?? 1
				if (refModel && refLine >= 1 && refLine <= refModel.getLineCount()) {
					out.push({
						uri: reference.uri.fsPath,
						line: refLine,
						preview: refModel.getLineContent(refLine).trim().substring(0, 300),
					})
				}
			}
			return out
		}
		return []
	}

	async getHover(uri: URI, line: number, character: number): Promise<string> {
		const model = await this._model(uri)
		if (!model) return ''

		const position = this._position(model, line, character)
		const parts: string[] = []
		for await (const result of getHoverProviderResultsAsAsyncIterable(
			this.languageFeaturesService.hoverProvider,
			model,
			position,
			CancellationToken.None,
		)) {
			parts.push(stringifyHoverContents(result.hover.contents))
			if (parts.join('\n\n').length > 4000) break
		}
		return parts.filter(Boolean).join('\n\n').substring(0, 4000)
	}

	async getDocumentSymbols(uri: URI): Promise<string> {
		const model = await this._model(uri)
		if (!model) return ''

		const providers = this.languageFeaturesService.documentSymbolProvider.all(model)
		for (const provider of providers) {
			const result = await provider.provideDocumentSymbols(model, CancellationToken.None)
			if (!result) continue

			const lines: string[] = []
			for (const symbol of result) {
				if (lines.length >= MAX_RESULTS) break
				const children = 'children' in symbol && Array.isArray(symbol.children) ? symbol.children : []
				const contains = children.length ? ` — contains: ${children.map(child => child.name).join(', ')}` : ''
				lines.push(`- ${symbol.name} (${symbol.kind})${contains}`)
			}
			return lines.join('\n')
		}
		return ''
	}
}

registerSingleton(ILspService, LspService, InstantiationType.Delayed);