/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { useAccessor } from '../util/services.js';
import type { TextAreaFns } from '../util/inputs.js';
import { Severity } from '../../../../../../../platform/notification/common/notification.js';
import type { LoopholeCliVoiceModel } from '../../../../common/loopholeCliTypes.js';

const VOICE_SAMPLE_RATE = 16_000;

type CliVoiceState = {
	isRecording: boolean;
	error: string | undefined;
	start: () => Promise<void>;
	stop: () => void;
	clearError: () => void;
};

const pickModel = (models: LoopholeCliVoiceModel[], fallback?: string): string | null => {
	const available = models.filter((m) => m.available && m.transports.includes('websocket'));
	if (fallback && available.some((m) => m.model === fallback)) return fallback;
	const preferred = ['gpt-realtime-2.1', 'gemini-3.8-live', 'grok-voice-3.0'];
	for (const p of preferred) {
		const found = available.find((m) => m.model === p || m.model.startsWith(`${p.split('-')[0]}-`));
		if (found) return found.model;
	}
	return available[0]?.model ?? null;
};

const toBase64 = (bytes: Uint8Array): string => {
	let binary = '';
	const CHUNK = 8192;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
};

const extractTranscript = (value: unknown): { interim?: string; final?: string } => {
	if (!value || typeof value !== 'object') return {};
	const v = value as Record<string, unknown>;
	const type = typeof v.type === 'string' ? v.type : '';
	// OpenAI Realtime transcription events.
	if (typeof v.transcript === 'string' && (type.includes('transcription') || type.includes('transcript'))) {
		return { final: v.transcript };
	}
	if (typeof v.delta === 'string' && type.includes('transcription')) {
		return { interim: v.delta };
	}
	// Some providers stream `text` deltas on transcription-ish events.
	if (typeof v.text === 'string' && (type.includes('transcription') || type.includes('transcript'))) {
		return { interim: v.text };
	}
	return {};
};

// CLI voice dictation over WebSocket.
// Flow: GET /api/experimental/voice/models -> POST /api/experimental/voice/session
// ({ transport: { type: 'websocket' } }) -> main-process WS proxy dials `url` with
// the ephemeral `token` (browser WebSocket cannot set Authorization headers) ->
// mic PCM16/base64 chunks flow renderer -> proxy -> provider; transcripts flow
// provider -> proxy -> renderer and are inserted into the composer live.
// WebRTC-only models (e.g. gpt-live-1) are skipped — no WebSocket transport.
export const useCliVoiceRecorder = (
	cliEnabled: boolean,
	textAreaFnsRef: { current: TextAreaFns | null },
	getBaseline: () => string,
): CliVoiceState => {
	const accessor = useAccessor()
	const cliService = accessor.get('ILoopholeCliService')
	const notificationService = accessor.get('INotificationService')
	const configService = accessor.get('IConfigurationService')
	const [isRecording, setIsRecording] = useState(false)
	const [error, setError] = useState<string | undefined>()
	const streamRef = useRef<MediaStream | null>(null)
	const audioCtxRef = useRef<AudioContext | null>(null)
	const nodeRef = useRef<{ source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode } | null>(null)
	const wsRequestIdRef = useRef<string | null>(null)
	const textRef = useRef('')
	const finalRef = useRef('')
	const baselineRef = useRef('')
	const mountedRef = useRef(true)
	const providerRef = useRef<string>('')
	const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const applyTranscript = useCallback(() => {
		const fns = textAreaFnsRef.current;
		if (!fns) return;
		const base = baselineRef.current;
		const combined = finalRef.current || textRef.current;
		fns.setValue(base ? `${base}${/\s$/.test(base) ? '' : ' '}${combined}` : combined);
	}, [textAreaFnsRef]);

	const release = useCallback(() => {
		if (stopTimerRef.current) {
			clearTimeout(stopTimerRef.current);
			stopTimerRef.current = null;
		}
		nodeRef.current?.processor.disconnect()
		nodeRef.current?.source.disconnect()
		nodeRef.current = null
		streamRef.current?.getTracks().forEach((t) => t.stop())
		streamRef.current = null
		const ctx = audioCtxRef.current;
		audioCtxRef.current = null
		void ctx?.close().catch(() => { /* best effort */ })
		const requestId = wsRequestIdRef.current;
		wsRequestIdRef.current = null
		if (requestId) cliService.voiceWsClose(requestId);
		if (mountedRef.current) setIsRecording(false)
	}, [cliService]);

	const stop = useCallback(() => { release(); }, [release]);

	const start = useCallback(async () => {
		if (isRecording) return;
		if (!navigator.mediaDevices?.getUserMedia) {
			setError('Microphone is not available in this environment.');
			return;
		}
		setError(undefined)
		try {
			const { models, default: fallback } = await cliService.voiceModels();
			const configured = configService.getValue<string>('loophole.cli.models.speechToText') ?? ''
			const preferred = configured.includes('/') ? configured.slice(configured.lastIndexOf('/') + 1) : configured
			const model = pickModel(Array.isArray(models) ? models : [], preferred || fallback);
			if (!model) {
				setError('No realtime voice model is available from the Loophole CLI. Add a provider API key in Settings > Providers.');
				return;
			}
			const voiceModel = models.find((m) => m.model === model);
			providerRef.current = voiceModel?.provider ?? '';
			const { transport } = await cliService.voiceSession({ model, transport: { type: 'websocket' } });
			if (transport.type !== 'websocket') {
				setError('The CLI returned a non-WebSocket voice transport.');
				return;
			}
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
			if (!mountedRef.current) {
				stream.getTracks().forEach((t) => t.stop())
				return;
			}
			baselineRef.current = getBaseline();
			textRef.current = '';
			finalRef.current = '';

			// Main-process WS proxy carries the ephemeral token (see loopholeCliChannel).
			const requestId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
			wsRequestIdRef.current = requestId;
			cliService.voiceWsConnect(requestId, transport.url, transport.token, providerRef.current, {
				onMessage: (text) => {
					let data: unknown;
					try {
						data = JSON.parse(text);
					} catch {
						return;
					}
					const t = extractTranscript(data);
					if (t.interim !== undefined) {
						textRef.current += t.interim;
						applyTranscript();
					} else if (t.final) {
						finalRef.current = t.final;
						textRef.current = t.final;
						applyTranscript();
					}
				},
				onError: (wsError) => {
					if (mountedRef.current) setError(`Voice connection failed: ${wsError}`);
				},
				onClose: () => { /* provider closed — mic keeps recording locally; stop() cleans up */ },
			});

			const AudioCtor: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioCtor) {
				setError('Audio capture is not supported in this environment.');
				release();
				return;
			}
			const ctx = new AudioCtor({ sampleRate: VOICE_SAMPLE_RATE });
			audioCtxRef.current = ctx;
			streamRef.current = stream;
			const source = ctx.createMediaStreamSource(stream);
			// ScriptProcessor for PCM capture (widely available; ~100ms chunks).
			const processor = ctx.createScriptProcessor(4096, 1, 1);
			const rate = ctx.sampleRate;
			processor.onaudioprocess = (e) => {
				const input = e.inputBuffer.getChannelData(0);
				const send = (samples: Float32Array) => {
					const pcm = new Int16Array(samples.length);
					for (let i = 0; i < samples.length; i++) {
						pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
					}
					const message = providerRef.current === 'google'
						? { audio: { data: toBase64(new Uint8Array(pcm.buffer)), mime_type: 'audio/pcm;rate=16000' } }
						: { type: 'input_audio_buffer.append', audio: toBase64(new Uint8Array(pcm.buffer)) };
					const id = wsRequestIdRef.current;
					if (id) cliService.voiceWsSend(id, JSON.stringify(message));
				};
				if (rate === VOICE_SAMPLE_RATE) {
					send(input);
				} else {
					// Linear downsample to 16kHz.
					const ratio = rate / VOICE_SAMPLE_RATE;
					const out = new Float32Array(Math.floor(input.length / ratio));
					for (let i = 0; i < out.length; i++) {
						out[i] = input[Math.floor(i * ratio)] ?? 0;
					}
					send(out);
				}
			};
			source.connect(processor);
			processor.connect(ctx.destination);
			nodeRef.current = { source, processor };
			setIsRecording(true);
			// Auto-stop after 2 minutes.
			stopTimerRef.current = setTimeout(() => { if (mountedRef.current) release(); }, 120_000);
		} catch (e) {
			release();
			const name = e instanceof Error ? e.name : '';
			const message = e instanceof Error ? e.message : String(e);
			if (name === 'NotAllowedError' || name === 'SecurityError' || /denied/i.test(message)) {
				const text = 'Microphone access denied. Enable the mic permission for Loophole (browser / OS privacy settings) to use voice input.';
				setError(text);
				try {
					if (configService.getValue<boolean>('loophole.notifications.voice') !== false) {
						notificationService.notify({ severity: Severity.Warning, message: text, source: 'Voice input', sticky: true });
					}
				} catch { /* best effort */ }
			} else {
				setError(message);
			}
		}
	}, [isRecording, cliService, release, applyTranscript, getBaseline, notificationService, configService]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			release();
		};
	}, [release]);

	// Voice is purely click-driven; nothing when the CLI is disabled.
	if (!cliEnabled) {
		return { isRecording, error, start: stop, stop: () => { }, clearError: () => setError(undefined) };
	}

	return { isRecording, error, start, stop, clearError: () => setError(undefined) };
};

export const CliMicButton = ({ voice }: { voice: CliVoiceState }) => {
	if (!navigator.mediaDevices?.getUserMedia) return null;
	return <button
		type='button'
		className={`flex items-center justify-center transition-colors ${voice.isRecording ? 'text-red-500' : 'text-loophole-fg-2 opacity-60 hover:opacity-100 cursor-pointer'}`}
		aria-label={voice.isRecording ? 'Stop dictation' : 'Start dictation'}
		aria-pressed={voice.isRecording}
		title={voice.error || (voice.isRecording ? 'Stop dictation' : 'Dictate with CLI voice')}
		onMouseDown={(event) => event.preventDefault()}
		onClick={() => {
			if (voice.isRecording) voice.stop();
			else void voice.start();
		}}
	>
		<Mic size={13} strokeWidth={2} />
	</button>
};
