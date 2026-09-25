/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import type { IStorageService } from '../../../../platform/storage/common/storage.js';
import {
	LOCAL_VOICE_MODELS,
	isLocalVoiceModelId,
	localVoiceModelById,
} from '../common/localVoiceModelTypes.js';
import type { LocalVoiceModelDefinition, LocalVoiceModelId } from '../common/localVoiceModelTypes.js';
import { LOCAL_VOICE_MODELS_STORAGE_KEY } from '../common/storageKeys.js';

export type LocalVoiceModelStatus = 'notInstalled' | 'installed' | 'downloading' | 'loading' | 'ready' | 'error';

export type LocalVoiceModelRuntimeState = {
	readonly statusByModel: Readonly<Record<LocalVoiceModelId, LocalVoiceModelStatus>>;
	readonly progressByModel: Readonly<Record<LocalVoiceModelId, number>>;
	readonly errorsByModel: Readonly<Record<LocalVoiceModelId, string | undefined>>;
	readonly activeModelId: LocalVoiceModelId | null;
};

type ProgressInfo = {
	status: string;
	progress?: number;
	loaded?: number;
	total?: number;
	file?: string;
};

type VoiceTranscriber = {
	(audio: unknown, options?: Record<string, unknown>): Promise<{ text?: string }>;
	dispose?: () => Promise<unknown>;
};

type VoiceDevice = 'webgpu' | 'wasm';

type LoadedVoiceTranscriber = {
	transcriber: VoiceTranscriber;
	device: VoiceDevice;
};

type TransformersModule = typeof import('@huggingface/transformers');

const VOICE_CACHE_KEY = 'loophole-voice-models';
const AUDIO_SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 30_000;

const initialStatusByModel = () => Object.fromEntries(
	LOCAL_VOICE_MODELS.map(model => [model.id, 'notInstalled' as LocalVoiceModelStatus]),
) as Record<LocalVoiceModelId, LocalVoiceModelStatus>;

const initialProgressByModel = () => Object.fromEntries(
	LOCAL_VOICE_MODELS.map(model => [model.id, 0]),
) as Record<LocalVoiceModelId, number>;

const initialErrorsByModel = () => Object.fromEntries(
	LOCAL_VOICE_MODELS.map(model => [model.id, undefined]),
) as Record<LocalVoiceModelId, string | undefined>;

const createInitialState = (): LocalVoiceModelRuntimeState => ({
	statusByModel: initialStatusByModel(),
	progressByModel: initialProgressByModel(),
	errorsByModel: initialErrorsByModel(),
	activeModelId: null,
});

const errorMessageOf = (error: unknown): string => {
	if (error instanceof Error && error.message) return error.message;
	return String(error);
};

/**
 * Owns the local speech model cache and the lazily-created Transformers.js
 * pipeline. No model is loaded until the user explicitly installs or uses one.
 */
class LocalVoiceModelService {
	private state: LocalVoiceModelRuntimeState = createInitialState();
	private readonly listeners = new Set<() => void>();
	private storageService: IStorageService | undefined;
	private transformersModulePromise: Promise<TransformersModule> | undefined;
	private transcriber: VoiceTranscriber | undefined;
	private activeModelId: LocalVoiceModelId | null = null;
	private activeDevice: VoiceDevice | null = null;
	private webgpuDisabled = false;
	private operationId = 0;
	private modelOperationTail: Promise<void> = Promise.resolve();
	private installedModelIds = new Set<LocalVoiceModelId>();

	readonly getState = (): LocalVoiceModelRuntimeState => this.state;

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/**
	 * Reads only installation metadata. Model weights are kept by the browser
	 * Cache API and are intentionally not copied into the settings store.
	 */
	initialize(storageService: IStorageService): void {
		if (this.storageService === storageService) return;
		this.storageService = storageService;

		const stored = storageService.get(LOCAL_VOICE_MODELS_STORAGE_KEY, StorageScope.APPLICATION);
		let installedModelIds: LocalVoiceModelId[] = [];
		if (stored) {
			try {
				const parsed: unknown = JSON.parse(stored);
				if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { installedModelIds?: unknown }).installedModelIds)) {
					installedModelIds = (parsed as { installedModelIds: unknown[] }).installedModelIds.filter(isLocalVoiceModelId);
				}
			} catch {
				// Ignore malformed metadata and let the user install the model again.
			}
		}

		const installed = new Set(installedModelIds);
		this.installedModelIds = installed;
		this.state = {
			...this.state,
			statusByModel: Object.fromEntries(
				LOCAL_VOICE_MODELS.map(model => [model.id, installed.has(model.id) ? 'installed' : 'notInstalled']),
			) as Record<LocalVoiceModelId, LocalVoiceModelStatus>,
		};
		this.notify();
	}

	isInstalled(modelId: LocalVoiceModelId): boolean {
		const status = this.state.statusByModel[modelId];
		return status === 'installed' || status === 'ready';
	}

	getStatus(modelId: LocalVoiceModelId): LocalVoiceModelStatus {
		return this.state.statusByModel[modelId];
	}

	private async hasEnoughStorage(model: LocalVoiceModelDefinition): Promise<boolean> {
		if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return true;
		try {
			const estimate = await navigator.storage.estimate();
			if (estimate.quota === undefined || estimate.usage === undefined) return true;
			return estimate.quota - estimate.usage >= model.downloadSizeBytes * 1.15;
		} catch {
			return true;
		}
	}

	installModel(modelId: LocalVoiceModelId): Promise<void> {
		return this.enqueueModelOperation(() => this.installModelInternal(modelId));
	}

	ensureModel(modelId: LocalVoiceModelId): Promise<void> {
		return this.enqueueModelOperation(() => this.ensureModelInternal(modelId));
	}

	transcribeBlob(blob: Blob, modelId: LocalVoiceModelId): Promise<string> {
		return this.enqueueModelOperation(() => this.transcribeBlobInternal(blob, modelId));
	}

	removeModel(modelId: LocalVoiceModelId): Promise<void> {
		return this.enqueueModelOperation(() => this.removeModelInternal(modelId));
	}

	private enqueueModelOperation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.modelOperationTail.then(operation, operation);
		this.modelOperationTail = run.then(() => undefined, () => undefined);
		return run;
	}

	private async installModelInternal(modelId: LocalVoiceModelId): Promise<void> {
		const model = localVoiceModelById[modelId];
		if (!await this.hasEnoughStorage(model)) {
			const message = `Not enough local storage is available for ${model.downloadSizeLabel}. Remove another voice model and try again.`;
			this.setModelState(modelId, { status: 'error', error: message });
			throw new Error(message);
		}
		const requestId = ++this.operationId;
		this.setModelState(modelId, { status: 'downloading', progress: 0, error: undefined });

		try {
			const loaded = await this.createTranscriber(model, requestId, true);
			if (requestId !== this.operationId) {
				await this.disposeTranscriber(loaded.transcriber);
				this.setModelState(modelId, { status: this.installedModelIds.has(modelId) ? 'installed' : 'notInstalled', progress: 0 });
				return;
			}

			await this.disposeActiveTranscriber();
			this.transcriber = loaded.transcriber;
			this.activeDevice = loaded.device;
			this.activeModelId = modelId;
			this.setModelState(modelId, { status: 'ready', progress: 100, error: undefined });
			this.persistInstalledModel(modelId);
		} catch (error) {
			if (requestId !== this.operationId) return;
			this.setModelState(modelId, { status: 'error', error: errorMessageOf(error) });
			throw error;
		}
	}

	/** Load a model that is already marked installed without downloading it. */
	private async ensureModelInternal(modelId: LocalVoiceModelId): Promise<void> {
		if (this.activeModelId === modelId && this.transcriber && this.getStatus(modelId) === 'ready') return;
		if (!this.isInstalled(modelId)) {
			throw new Error('Install a local voice model before using the microphone.');
		}

		const requestId = ++this.operationId;
		this.setModelState(modelId, { status: 'loading', error: undefined });
		try {
			const loaded = await this.createTranscriber(localVoiceModelById[modelId], requestId, false);
			if (requestId !== this.operationId) {
				await this.disposeTranscriber(loaded.transcriber);
				this.setModelState(modelId, { status: this.installedModelIds.has(modelId) ? 'installed' : 'notInstalled', progress: 0 });
				return;
			}

			await this.disposeActiveTranscriber();
			this.transcriber = loaded.transcriber;
			this.activeDevice = loaded.device;
			this.activeModelId = modelId;
			this.setModelState(modelId, { status: 'ready', progress: 100, error: undefined });
		} catch (error) {
			if (requestId !== this.operationId) return;
			this.setModelState(modelId, { status: 'error', error: errorMessageOf(error) });
			throw error;
		}
	}

	private async transcribeBlobInternal(blob: Blob, modelId: LocalVoiceModelId): Promise<string> {
		if (!blob.size) return '';

		await this.ensureModelInternal(modelId);
		if (!this.transcriber) throw new Error('The local voice model is not ready.');

		const samples = await this.decodeAudioBlob(blob);
		const model = localVoiceModelById[modelId];
		const options: Record<string, unknown> = {
			task: 'transcribe',
			chunk_length_s: 30,
			stride_length_s: 5,
			condition_on_previous_text: false,
		};
		if (model.languageOption) options.language = model.languageOption;

		const transcriber = this.transcriber;
		if (!transcriber) throw new Error('The local voice model is not ready.');

		try {
			const result = await transcriber(samples, options);
			return result.text?.trim() ?? '';
		} catch (error) {
			if (this.activeDevice !== 'webgpu' || !this.installedModelIds.has(modelId)) throw error;

			// A WebGPU pipeline can construct successfully and still fail when
			// the first shader/session is executed. Retry once from the cached
			// CPU/WASM variant, never downloading during dictation.
			this.webgpuDisabled = true;
			await this.disposeActiveTranscriber();
			this.setModelState(modelId, { status: 'installed', error: undefined });
			await this.ensureModelInternal(modelId);
			const fallback = this.transcriber;
			if (!fallback) throw error;
			const fallbackResult = await fallback(samples, options);
			return fallbackResult.text?.trim() ?? '';
		}
	}

	private async removeModelInternal(modelId: LocalVoiceModelId): Promise<void> {
		++this.operationId;
		if (this.activeModelId === modelId) {
			await this.disposeActiveTranscriber();
			this.activeModelId = null;
		}
		await this.deleteCachedModel(localVoiceModelById[modelId]);
		this.setModelState(modelId, { status: 'notInstalled', progress: 0, error: undefined });
		this.removePersistedInstalledModel(modelId);
	}

	private async decodeAudioBlob(blob: Blob): Promise<Float32Array> {
		const AudioContextConstructor = globalThis.AudioContext;
		if (AudioContextConstructor) {
			try {
				const context = new AudioContextConstructor({ sampleRate: AUDIO_SAMPLE_RATE });
				try {
					const decoded = await context.decodeAudioData(await blob.arrayBuffer());
					if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();

					const mono = new Float32Array(decoded.length);
					for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex++) {
						const channel = decoded.getChannelData(channelIndex);
						for (let sampleIndex = 0; sampleIndex < decoded.length; sampleIndex++) {
							mono[sampleIndex] += channel[sampleIndex] / decoded.numberOfChannels;
						}
					}
					return mono;
				} finally {
					await context.close();
				}
			} catch {
				// Fall back to the Transformers.js decoder below.
			}
		}

		const transformers = await this.getTransformersModule();
		const objectUrl = URL.createObjectURL(blob);
		try {
			return await transformers.load_audio(objectUrl, AUDIO_SAMPLE_RATE);
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	}

	private async hasWebGPUAdapter(): Promise<boolean> {
		if (typeof navigator === 'undefined') return false;
		const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
		if (!gpu) return false;
		try {
			return Boolean(await gpu.requestAdapter());
		} catch {
			return false;
		}
	}

	private async createTranscriber(model: LocalVoiceModelDefinition, requestId: number, allowDownload: boolean): Promise<LoadedVoiceTranscriber> {
		const transformers = await this.getTransformersModule();
		const hasWebGPU = !this.webgpuDisabled && await this.hasWebGPUAdapter();
		const isCached = async (device: VoiceDevice) => transformers.ModelRegistry.is_pipeline_cached(
			'automatic-speech-recognition',
			model.modelId,
			{ revision: model.revision, device, dtype: 'q8' },
		);
		const create = async (device: VoiceDevice): Promise<LoadedVoiceTranscriber> => {
			const options = {
				revision: model.revision,
				dtype: 'q8' as const,
				...(allowDownload ? { progress_callback: (info: ProgressInfo) => this.handleProgress(model.id, info) } : {}),
				device,
			};
			const transcriber = (await transformers.pipeline('automatic-speech-recognition', model.modelId, options)) as unknown as VoiceTranscriber;
			return { transcriber, device };
		};

		if (!allowDownload) {
			if (hasWebGPU && await isCached('webgpu')) {
				try {
					return await create('webgpu');
				} catch (error) {
					this.webgpuDisabled = true;
					if (await isCached('wasm')) return create('wasm');
					throw error;
				}
			}
			if (await isCached('wasm')) return create('wasm');
			throw new Error('The downloaded voice model is missing from the local cache. Install it again.');
		}

		try {
			return hasWebGPU ? await create('webgpu') : await create('wasm');
		} catch (error) {
			if (hasWebGPU && requestId === this.operationId) {
				this.webgpuDisabled = true;
				return create('wasm');
			}
			throw error;
		}
	}

	private handleProgress(modelId: LocalVoiceModelId, info: ProgressInfo): void {
		if (info.status === 'progress' || info.status === 'progress_total') {
			const progress = typeof info.progress === 'number' ? info.progress : undefined;
			if (progress !== undefined) {
				const currentProgress = this.state.progressByModel[modelId];
				this.setModelState(modelId, { progress: Math.max(currentProgress, Math.max(0, Math.min(100, progress))) });
			}
		} else if (info.status === 'ready') {
			this.setModelState(modelId, { progress: 100 });
		}
	}

	private async getTransformersModule(): Promise<TransformersModule> {
		if (!this.transformersModulePromise) {
			this.transformersModulePromise = import('./transformersRuntime.js').then(({ transformers }) => {
				transformers.env.allowRemoteModels = true;
				transformers.env.allowLocalModels = false;
				transformers.env.useBrowserCache = true;
				transformers.env.useFSCache = false;
				transformers.env.useWasmCache = true;
				transformers.env.cacheKey = VOICE_CACHE_KEY;
				if (transformers.env.backends?.onnx?.wasm) {
					transformers.env.backends.onnx.wasm.numThreads = 1;
				}
				return transformers;
			}).catch(error => {
				this.transformersModulePromise = undefined;
				throw error;
			});
		}
		return this.transformersModulePromise;
	}

	private setModelState(modelId: LocalVoiceModelId, update: { status?: LocalVoiceModelStatus; progress?: number; error?: string | undefined }): void {
		this.state = {
			...this.state,
			statusByModel: {
				...this.state.statusByModel,
				[modelId]: update.status ?? this.state.statusByModel[modelId],
			},
			progressByModel: {
				...this.state.progressByModel,
				[modelId]: update.progress ?? this.state.progressByModel[modelId],
			},
			errorsByModel: {
				...this.state.errorsByModel,
				[modelId]: update.error,
			},
			activeModelId: this.activeModelId,
		};
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	private persistInstalledModel(modelId: LocalVoiceModelId): void {
		if (!this.storageService) return;
		this.installedModelIds.add(modelId);
		this.storageService.store(
			LOCAL_VOICE_MODELS_STORAGE_KEY,
			JSON.stringify({ installedModelIds: Array.from(this.installedModelIds) }),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}

	private removePersistedInstalledModel(modelId: LocalVoiceModelId): void {
		if (!this.storageService) return;
		this.installedModelIds.delete(modelId);
		this.storageService.store(
			LOCAL_VOICE_MODELS_STORAGE_KEY,
			JSON.stringify({ installedModelIds: Array.from(this.installedModelIds) }),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}

	private async deleteCachedModel(model: LocalVoiceModelDefinition): Promise<void> {
		try {
			const transformers = await this.getTransformersModule();
			await Promise.all((['webgpu', 'wasm'] as const).map(device => transformers.ModelRegistry.clear_pipeline_cache(
				'automatic-speech-recognition',
				model.modelId,
				{ revision: model.revision, device, dtype: 'q8' },
			)));
		} catch {
			// Fall back to deleting matching Cache API entries below.
		}

		if (typeof caches === 'undefined') return;
		try {
			const cache = await caches.open(VOICE_CACHE_KEY);
			const requests = await cache.keys();
			const modelPath = `/${model.modelId}/`;
			await Promise.all(requests
				.filter(request => request.url.includes(modelPath) || request.url.includes(model.modelId))
				.map(request => cache.delete(request)));
		} catch {
			// Clearing metadata is still useful if the browser cache is unavailable.
		}
	}

	private async disposeActiveTranscriber(): Promise<void> {
		const previousModelId = this.activeModelId;
		await this.disposeTranscriber(this.transcriber);
		this.transcriber = undefined;
		this.activeDevice = null;
		this.activeModelId = null;
		if (previousModelId) {
			this.setModelState(previousModelId, {
				status: this.installedModelIds.has(previousModelId) ? 'installed' : 'notInstalled',
			});
		}
	}

	private async disposeTranscriber(transcriber: VoiceTranscriber | undefined): Promise<void> {
		if (!transcriber?.dispose) return;
		try {
			await transcriber.dispose();
		} catch {
			// Disposal is best effort; the next model load will reclaim sessions.
		}
	}
}

export const localVoiceModelService = new LocalVoiceModelService();
export { MAX_RECORDING_MS };
