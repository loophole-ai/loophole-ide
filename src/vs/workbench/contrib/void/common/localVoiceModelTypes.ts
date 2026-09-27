/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * The local speech-to-text models offered by Loophole.
 *
 * Every entry is an English-only Whisper checkpoint. The multilingual ones were
 * dropped on purpose: dictation is fed to the model with no `language` option,
 * and Transformers.js rejects `language` (and `task`) outright for an
 * English-only model, so a multilingual catalog only bought a language picker
 * that the transcription path cannot honour anyway.
 *
 * Model files are intentionally not bundled with the IDE. The revisions below
 * pin the remote model artifacts used by the Transformers.js downloader, and
 * downloadSizeBytes is the q8 encoder + merged-decoder pair the service actually
 * fetches, not the full-precision weights.
 */
export const LOCAL_VOICE_MODEL_IDS = [
	'whisper-base-en',
	'whisper-small-en',
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
	language: 'English';
	description: string;
	license: string;
	recommended?: boolean;
};

export const LOCAL_VOICE_MODELS: readonly LocalVoiceModelDefinition[] = [
	// Sizes are the q8 encoder + merged-decoder pair the service actually
	// downloads, read off the model repos rather than guessed. Whisper Tiny was
	// dropped: it is fast but its accuracy is poor enough to be unusable.
	{
		id: 'whisper-base-en',
		label: 'Whisper Base',
		modelId: 'onnx-community/whisper-base.en',
		revision: '51eefc0af78b103839eda9e7e4f4186acc6517fe',
		downloadSizeBytes: 74_000_000,
		downloadSizeLabel: '~73 MB',
		language: 'English',
		description: 'The small one. Quick to download and fast enough for short sentences, but it will drop or garble longer ones.',
		license: 'MIT',
	},
	{
		id: 'whisper-small-en',
		label: 'Whisper Small',
		modelId: 'onnx-community/whisper-small.en',
		revision: '482fb8ba081b6e906f92efe103622316b2a0cc69',
		downloadSizeBytes: 238_000_000,
		downloadSizeLabel: '~238 MB',
		language: 'English',
		description: 'The best balance of size and accuracy here. Handles ordinary dictation well on a normal desktop.',
		license: 'MIT',
		recommended: true,
	},
	{
		id: 'distil-medium-en',
		label: 'Distil Whisper Medium',
		modelId: 'distil-whisper/distil-medium.en',
		revision: '6e61418885eaf4d5cc9f64e508e80ac5b4c052b7',
		downloadSizeBytes: 384_000_000,
		downloadSizeLabel: '~384 MB',
		language: 'English',
		description: 'The most accurate option here, at the cost of a much longer download, more memory, and slower transcription. Best with WebGPU.',
		license: 'MIT',
	},
];

export const localVoiceModelById: Readonly<Record<LocalVoiceModelId, LocalVoiceModelDefinition>> =
	Object.fromEntries(LOCAL_VOICE_MODELS.map(model => [model.id, model])) as Record<LocalVoiceModelId, LocalVoiceModelDefinition>;

export const isLocalVoiceModelId = (value: unknown): value is LocalVoiceModelId =>
	typeof value === 'string' && (LOCAL_VOICE_MODEL_IDS as readonly string[]).includes(value);
