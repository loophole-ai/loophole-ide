/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LocalVoiceModelId } from '../../../../common/localVoiceModelTypes.js';
import { localVoiceModelService, MAX_RECORDING_MS } from '../../../localVoiceModelService.js';
import { useAccessor } from './services.js';

export const useLocalVoiceModel = () => {
	const storageService = useAccessor().get('IStorageService');
	localVoiceModelService.initialize(storageService);

	return useSyncExternalStore(
		localVoiceModelService.subscribe,
		localVoiceModelService.getState,
		localVoiceModelService.getState,
	);
};

export type LocalVoiceRecorderState = {
	isRecording: boolean;
	isTranscribing: boolean;
	error: string | undefined;
	start: () => Promise<void>;
	stop: () => void;
	clearError: () => void;
};

const supportedRecordingMimeTypes = [
	'audio/webm;codecs=opus',
	'audio/ogg;codecs=opus',
	'audio/mp4',
];

const errorMessageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const useLocalVoiceRecorder = (
	modelId: LocalVoiceModelId | null,
	onTranscript: (text: string) => void,
): LocalVoiceRecorderState => {
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const recorderRef = useRef<MediaRecorder | undefined>();
	const streamRef = useRef<MediaStream | undefined>();
	const chunksRef = useRef<Blob[]>([]);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
	const mountedRef = useRef(true);
	const onTranscriptRef = useRef(onTranscript);

	useEffect(() => {
		onTranscriptRef.current = onTranscript;
	}, [onTranscript]);

	const releaseCapture = useCallback(() => {
		if (timeoutRef.current !== undefined) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = undefined;
		}
		streamRef.current?.getTracks().forEach(track => track.stop());
		streamRef.current = undefined;
		recorderRef.current = undefined;
		chunksRef.current = [];
		if (mountedRef.current) setIsRecording(false);
	}, []);

	const finishRecording = useCallback(async () => {
		const chunks = chunksRef.current;
		const mimeType = recorderRef.current?.mimeType || 'audio/webm';
		releaseCapture();
		if (!mountedRef.current || chunks.length === 0) return;

		const blob = new Blob(chunks, { type: mimeType });
		if (blob.size === 0 || !modelId) return;

		setIsTranscribing(true);
		setError(undefined);
		try {
			const text = await localVoiceModelService.transcribeBlob(blob, modelId);
			if (text && mountedRef.current) onTranscriptRef.current(text);
		} catch (recordingError) {
			if (mountedRef.current) setError(errorMessageOf(recordingError));
		} finally {
			if (mountedRef.current) setIsTranscribing(false);
		}
	}, [modelId, releaseCapture]);

	const stop = useCallback(() => {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== 'inactive') {
			recorder.stop();
		} else {
			releaseCapture();
		}
	}, [releaseCapture]);

	const start = useCallback(async () => {
		if (!modelId) {
			setError('Install and select a local voice model first.');
			return;
		}
		if (isRecording || isTranscribing) return;
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
			setError('Microphone recording is not supported in this environment.');
			return;
		}

		setError(undefined);
		setIsTranscribing(true);
		try {
			await localVoiceModelService.ensureModel(modelId);
			if (!mountedRef.current) return;
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
			const mimeType = supportedRecordingMimeTypes.find(type => MediaRecorder.isTypeSupported(type));
			const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
			streamRef.current = stream;
			recorderRef.current = recorder;
			chunksRef.current = [];

			recorder.ondataavailable = event => {
				if (event.data.size > 0) chunksRef.current.push(event.data);
			};
			recorder.onerror = () => {
				if (mountedRef.current) setError('The microphone could not be recorded.');
				releaseCapture();
			};
			recorder.onstop = () => {
				void finishRecording();
			};

			recorder.start();
			setIsTranscribing(false);
			setIsRecording(true);
			timeoutRef.current = setTimeout(stop, MAX_RECORDING_MS);
		} catch (recordingError) {
			releaseCapture();
			setIsTranscribing(false);
			setError(errorMessageOf(recordingError));
		}
	}, [finishRecording, isRecording, isTranscribing, modelId, releaseCapture, stop]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			releaseCapture();
		};
	}, [releaseCapture]);

	return {
		isRecording,
		isTranscribing,
		error,
		start,
		stop,
		clearError: () => setError(undefined),
	};
};
