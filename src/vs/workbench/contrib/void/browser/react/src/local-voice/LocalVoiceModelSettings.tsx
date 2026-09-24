/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useId } from 'react';
import { Check, Download, Loader2, Mic, RotateCcw, Trash2 } from 'lucide-react';
import { LOCAL_VOICE_MODELS } from '../../../../common/localVoiceModelTypes.js';
import type { LocalVoiceModelId } from '../../../../common/localVoiceModelTypes.js';
import { localVoiceModelService } from '../../../localVoiceModelService.js';
import type { LocalVoiceModelStatus } from '../../../localVoiceModelService.js';
import { useLocalVoiceModel } from '../util/localVoiceModel.js';
import { useAccessor, useSettingsState } from '../util/services.js';

const statusLabel = (status: LocalVoiceModelStatus): string => {
	switch (status) {
		case 'ready': return 'Ready';
		case 'installed': return 'Installed';
		case 'downloading': return 'Downloading';
		case 'loading': return 'Loading';
		case 'error': return 'Retry needed';
		default: return 'Not installed';
	}
};

const isInstalledStatus = (status: LocalVoiceModelStatus): boolean => status === 'installed' || status === 'ready';
const isBusyStatus = (status: LocalVoiceModelStatus): boolean => status === 'downloading' || status === 'loading';

export const LocalVoiceModelSettings = ({ compact = false }: { compact?: boolean }) => {
	const headingId = useId();
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const settingsState = useSettingsState();
	const voiceState = useLocalVoiceModel();
	const selectedModelId = settingsState.globalSettings.localVoiceModelId;

	const selectModel = (modelId: LocalVoiceModelId) => {
		voidSettingsService.setGlobalSetting('localVoiceModelId', modelId);
	};

	const installModel = (modelId: LocalVoiceModelId) => {
		selectModel(modelId);
		void localVoiceModelService.installModel(modelId).catch(() => undefined);
	};

	const removeModel = (modelId: LocalVoiceModelId) => {
		if (selectedModelId === modelId) {
			voidSettingsService.setGlobalSetting('localVoiceModelId', null);
		}
		void localVoiceModelService.removeModel(modelId).catch(() => undefined);
	};

	return (
		<section className={`w-full text-left ${compact ? 'text-sm' : ''}`} aria-labelledby={headingId}>
			<div className="flex items-start gap-3">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-loophole-bg-2 text-loophole-fg-2">
					<Mic size={16} />
				</div>
				<div className="min-w-0">
					<h2 id={headingId} className="text-lg font-medium">Microphone</h2>
					<p className="text-sm text-loophole-fg-3">
						Dictate privately with a local speech model. Audio never leaves this computer.
					</p>
				</div>
			</div>

			<div className={`mt-4 flex flex-col gap-2 ${compact ? '' : 'max-w-2xl'}`} role="radiogroup" aria-label="Local voice model">
				{LOCAL_VOICE_MODELS.map(model => {
					const status = voiceState.statusByModel[model.id];
					const isSelected = selectedModelId === model.id;
					const isInstalled = isInstalledStatus(status);
					const isBusy = isBusyStatus(status);
					const progress = voiceState.progressByModel[model.id];
					const error = voiceState.errorsByModel[model.id];

					return (
						<div key={model.id} className={`rounded-md border p-3 transition-colors ${isSelected ? 'border-loophole-border-1 bg-loophole-bg-1' : 'border-loophole-border-3 bg-loophole-bg-1/40'}`}>
							<div className="flex items-start gap-3">
								<input
									type="radio"
									name="loophole-local-voice-model"
									checked={isSelected}
									onChange={() => selectModel(model.id)}
									className="mt-1"
									aria-label={`Select ${model.label}`}
								/>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium">{model.label}</span>
										{model.recommended && <span className="rounded bg-[#0e70c0]/20 px-1.5 py-0.5 text-[10px] text-[#0e70c0]">Recommended</span>}
										<span className="text-xs text-loophole-fg-3">{model.downloadSizeLabel}</span>
									</div>
									<div className="mt-1 text-xs text-loophole-fg-3">
										{model.language} · {model.license} license
									</div>
									<div className="mt-1 text-xs text-loophole-fg-3">{model.description}</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									{isSelected && status === 'ready' && <Check size={15} className="text-emerald-500" aria-label="Selected and ready" />}
									{isBusy && <Loader2 size={15} className="animate-spin text-loophole-fg-3" aria-label={statusLabel(status)} />}
									{!isBusy && isInstalled && !isSelected && (
										<button type="button" className="rounded px-2 py-1 text-xs text-loophole-fg-2 hover:bg-loophole-bg-2" onClick={() => installModel(model.id)}>
											Use
										</button>
									)}
									{!isBusy && !isInstalled && (
										<button type="button" className="flex items-center gap-1 rounded bg-[#0e70c0] px-2 py-1 text-xs text-white hover:bg-[#1177cb]" onClick={() => installModel(model.id)}>
											{status === 'error' ? <RotateCcw size={13} /> : <Download size={13} />}
											{status === 'error' ? 'Retry' : 'Install'}
										</button>
									)}
									{isInstalled && (
										<button type="button" className="rounded p-1 text-loophole-fg-3 hover:bg-loophole-bg-2 hover:text-loophole-fg-1" onClick={() => removeModel(model.id)} title="Remove downloaded model" aria-label={`Remove ${model.label}`}>
											<Trash2 size={14} />
										</button>
									)}
								</div>
							</div>

							{isBusy && (
								<div className="mt-3" aria-live="polite">
									<div className="mb-1 flex justify-between text-[11px] text-loophole-fg-3">
										<span>{statusLabel(status)}</span>
										<span>{Math.round(progress)}%</span>
									</div>
									<div className="h-1 overflow-hidden rounded bg-loophole-bg-3">
										<div className="h-full bg-[#0e70c0] transition-[width] duration-200" style={{ width: `${progress}%` }} />
									</div>
								</div>
							)}
							{!isBusy && <div className="mt-2 text-[11px] text-loophole-fg-3">{statusLabel(status)}</div>}
							{error && <div className="mt-2 text-xs text-red-400" role="alert">{error}</div>}
						</div>
					);
				})}
			</div>

			<div className="mt-3 text-xs text-loophole-fg-3">
				Models are downloaded from Hugging Face only when you choose Install. The microphone button appears in Chat after a model is ready.
			</div>
		</section>
	);
};
