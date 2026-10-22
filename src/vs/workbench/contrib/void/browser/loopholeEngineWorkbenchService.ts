/*--------------------------------------------------------------------------------------
 *  Loophole engine discovery for the workbench.
 *
 *  The engine owns credentials and model routing. On startup we ask it for its catalog
 *  and publish those models under the `loophole` provider, then point every chat/edit
 *  feature at an engine model so requests stop going directly from the prompt to a
 *  provider. Autocomplete is deliberately left alone: the engine has no FIM model.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILoopholeEngineService } from '../common/loopholeEngineService.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { LoopholeModelCapabilities, setLoopholeModelCapabilities } from '../common/modelCapabilities.js';
import { FeatureName, ModelSelection } from '../common/voidSettingsTypes.js';

export interface ILoopholeEngineWorkbenchService {
	readonly _serviceBrand: undefined;
	/** Re-read the engine catalog and refresh the model picker. */
	refreshModels(): Promise<void>;
	/** Refresh the catalog, then point every engine feature at the integration's provider. */
	preferIntegration(integrationID: string): Promise<void>;
}

export const ILoopholeEngineWorkbenchService = createDecorator<ILoopholeEngineWorkbenchService>('loopholeEngineWorkbenchService');

const engineFeatures: FeatureName[] = ['Chat', 'Ctrl+K', 'Apply', 'SCM'];

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class LoopholeEngineWorkbenchService extends Disposable implements ILoopholeEngineWorkbenchService {
	readonly _serviceBrand: undefined;

	constructor(
		@ILoopholeEngineService private readonly _engine: ILoopholeEngineService,
		@IVoidSettingsService private readonly _settings: IVoidSettingsService,
		@IWorkspaceContextService private readonly _workspaceContext: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		void this.refreshModels();
	}

	async refreshModels(): Promise<void> {
		try {
			await this.refreshModelsOrThrow();
		} catch (error) {
			// Engine discovery is best-effort at startup; direct providers keep working while
			// the engine is unavailable, and the next window reload retries discovery.
			this._logService.warn(`[Loophole] Could not load engine models: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async refreshModelsOrThrow(): Promise<void> {
		await this._settings.waitForInitState;

		const directory = this._workspaceContext.getWorkspace().folders[0]?.uri.fsPath;
		const connected = await this._engine.connect();
		if (!connected.ok) {
			this._logService.info(`[Loophole] Engine unavailable: ${connected.error}`);
			return;
		}

		// The catalog may still be settling plugins when a freshly spawned server answers.
		let models = await this._engine.listModels(directory);
		for (let attempt = 0; !models.length && attempt < 4; attempt++) {
			await delay(750);
			models = await this._engine.listModels(directory);
		}
		if (!models.length) {
			return;
		}

		const fallbackModel = await this._engine.defaultModel(directory);
		const capabilities: LoopholeModelCapabilities[] = models.map((model) => ({
			modelName: `${model.providerID}/${model.id}`,
			contextWindow: model.contextWindow,
			outputTokens: model.outputTokens,
			supportsTools: model.supportsTools,
			cost: model.cost,
		}));
		setLoopholeModelCapabilities(capabilities);

		const modelNames = capabilities.map((model) => model.modelName);
		this._settings.setAutodetectedModels('loophole', modelNames, { source: 'loophole-engine' });
		await this._settings.setSettingOfProvider('loophole', '_didFillInProviderSettings', true);

		const fallbackName = fallbackModel ? `${fallbackModel.providerID}/${fallbackModel.id}` : modelNames[0];
		const defaultSelection: ModelSelection = {
			providerName: 'loophole',
			modelName: modelNames.includes(fallbackName) ? fallbackName : modelNames[0],
		};

		// Keep a valid engine choice the user already made, but replace direct-provider
		// selections: those would bypass the engine entirely.
		const selectionFor = (feature: FeatureName): ModelSelection => {
			const current = this._settings.state.modelSelectionOfFeature[feature];
			if (current?.providerName === 'loophole' && modelNames.includes(current.modelName)) {
				return current;
			}
			return defaultSelection;
		};

		for (const feature of engineFeatures) {
			await this._settings.setModelSelectionOfFeature(feature, selectionFor(feature));
		}
	}

	async preferIntegration(integrationID: string): Promise<void> {
		try {
			await this.refreshModelsOrThrow();
			const directory = this._workspaceContext.getWorkspace().folders[0]?.uri.fsPath;
			const providers = await this._engine.listProviders(directory);
			const provider = providers.find((entry) => entry.integrationID === integrationID);
			if (!provider) {
				return;
			}
			const models = await this._engine.listModels(directory);
			const target = models.find((model) => model.providerID === provider.id);
			if (!target) {
				return;
			}
			const selection: ModelSelection = { providerName: 'loophole', modelName: `${target.providerID}/${target.id}` };
			for (const feature of engineFeatures) {
				await this._settings.setModelSelectionOfFeature(feature, selection);
			}
		} catch (error) {
			this._logService.warn(`[Loophole] Could not switch to the new provider: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

registerSingleton(ILoopholeEngineWorkbenchService, LoopholeEngineWorkbenchService, InstantiationType.Eager);
