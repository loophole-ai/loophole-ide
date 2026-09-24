/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * The local speech-to-text models offered by Loophole.
 *
 * Model files are intentionally not bundled with the IDE. The revisions below
 * pin the remote model artifacts used by the Transformers.js downloader.
 */
export const LOCAL_VOICE_MODEL_IDS = [
	'whisper-base',
	'whisper-small',
	'distil-medium-en',
] as const;

export type LocalVoiceModelId = typeof LOCAL_VOICE_MODEL_IDS[number];

export type LocalVoiceModelDefinition = {
	id: LocalVoiceModelId;
	label: string;
	modelId: string;
	revision: string;
	/** Approximate q8 encoder/decoder download size, excluding small metadata files. */
	downloadSizeBytes: number;
	downloadSizeLabel: string;
	language: 'Multilingual' | 'English';
	languageOption?: string;
	description: string;
	license: string;
	recommended?: boolean;
};

export const LOCAL_VOICE_MODELS: readonly LocalVoiceModelDefinition[] = [
	{
		id: 'whisper-base',
		label: 'Whisper Base',
		modelId: 'onnx-community/whisper-base',
		revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
		downloadSizeBytes: 78_000_000,
		downloadSizeLabel: '~78 MB',
		language: 'Multilingual',
		description: 'Fastest option with broad language support. Good for everyday dictation and older computers.',
		license: 'MIT',
	},
	{
		id: 'whisper-small',
		label: 'Whisper Small',
		modelId: 'onnx-community/whisper-small',
		revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
		downloadSizeBytes: 245_000_000,
		downloadSizeLabel: '~242 MB',
		language: 'Multilingual',
		description: 'Best balance of accuracy, speed, and language coverage for normal desktops.',
		license: 'MIT',
		recommended: true,
	},
	{
		id: 'distil-medium-en',
		label: 'Distil Whisper Medium',
		modelId: 'distil-whisper/distil-medium.en',
		revision: '6e61418885eaf4d5cc9f64e508e80ac5b4c052b7',
		downloadSizeBytes: 390_000_000,
		downloadSizeLabel: '~388 MB',
		language: 'English',
		languageOption: 'english',
		description: 'Highest-quality English option in this catalog. Uses more memory and works best with WebGPU.',
		license: 'MIT',
	},
];

export const localVoiceModelById: Readonly<Record<LocalVoiceModelId, LocalVoiceModelDefinition>> =
	Object.fromEntries(LOCAL_VOICE_MODELS.map(model => [model.id, model])) as Record<LocalVoiceModelId, LocalVoiceModelDefinition>;

export const isLocalVoiceModelId = (value: unknown): value is LocalVoiceModelId =>
	typeof value === 'string' && (LOCAL_VOICE_MODEL_IDS as readonly string[]).includes(value);
