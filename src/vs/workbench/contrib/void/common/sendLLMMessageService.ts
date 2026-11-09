/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, EventLLMMessageOnToolParams, EventLLMMessageOnCompactionParams, EventLLMMessageOnServeSessionParams, EventLLMMessageOnPermissionParams, EventLLMMessageOnUsageParams, ServiceSendLLMMessageParams, MainSendLLMMessageParams, MainLLMMessageAbortParams, ServiceModelListParams, EventModelListOnSuccessParams, EventModelListOnErrorParams, MainModelListParams, OllamaModelResponse, OpenaiCompatibleModelResponse, } from './sendLLMMessageTypes.js';
import { ModelSelection } from './voidSettingsTypes.js';

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { IMCPService } from './mcpService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

// calls channel to implement features
export const ILLMMessageService = createDecorator<ILLMMessageService>('llmMessageService');

export interface ILLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: ServiceSendLLMMessageParams) => string | null;
	abort: (requestId: string) => void;
	ollamaList: (params: ServiceModelListParams<OllamaModelResponse>) => void;
	openAICompatibleList: (params: ServiceModelListParams<OpenaiCompatibleModelResponse>) => void;
}


// open this file side by side with llmMessageChannel
export class LLMMessageService extends Disposable implements ILLMMessageService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel // LLMMessageChannel

	// sendLLMMessage
	private readonly llmMessageHooks = {
		onText: {} as { [eventId: string]: ((params: EventLLMMessageOnTextParams) => void) },
		onFinalMessage: {} as { [eventId: string]: ((params: EventLLMMessageOnFinalMessageParams) => void) },
		onError: {} as { [eventId: string]: ((params: EventLLMMessageOnErrorParams) => void) },
		onTool: {} as { [eventId: string]: ((params: EventLLMMessageOnToolParams) => void) },
		onCompaction: {} as { [eventId: string]: ((params: EventLLMMessageOnCompactionParams) => void) },
		onServeSession: {} as { [eventId: string]: ((params: EventLLMMessageOnServeSessionParams) => void) },
		onPermission: {} as { [eventId: string]: ((params: EventLLMMessageOnPermissionParams) => void) },
		onUsage: {} as { [eventId: string]: ((params: EventLLMMessageOnUsageParams) => void) },
		onAbort: {} as { [eventId: string]: (() => void) }, // NOT sent over the channel, result is instant when we call .abort()
	}

	// requestId -> which provider/model the request was for, kept only for readable error logging
	private readonly requestModelSelection: { [requestId: string]: ModelSelection } = {}

	// list hooks
	private readonly listHooks = {
		ollama: {
			success: {} as { [eventId: string]: ((params: EventModelListOnSuccessParams<OllamaModelResponse>) => void) },
			error: {} as { [eventId: string]: ((params: EventModelListOnErrorParams<OllamaModelResponse>) => void) },
		},
		openAICompat: {
			success: {} as { [eventId: string]: ((params: EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>) => void) },
			error: {} as { [eventId: string]: ((params: EventModelListOnErrorParams<OpenaiCompatibleModelResponse>) => void) },
		}
	} satisfies {
		[providerName in 'ollama' | 'openAICompat']: {
			success: { [eventId: string]: ((params: EventModelListOnSuccessParams<any>) => void) },
			error: { [eventId: string]: ((params: EventModelListOnErrorParams<any>) => void) },
		}
	}

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService, // used as a renderer (only usable on client side)
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		// @INotificationService private readonly notificationService: INotificationService,
		@IMCPService private readonly mcpService: IMCPService,
		@IConfigurationService private readonly configService: IConfigurationService,
	) {
		super()

		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service
		// see llmMessageChannel.ts
		this.channel = this.mainProcessService.getChannel('void-channel-llmMessage')

		// .listen sets up an IPC channel and takes a few ms, so we set up listeners immediately and add hooks to them instead
		// llm
		this._register((this.channel.listen('onText_sendLLMMessage') satisfies Event<EventLLMMessageOnTextParams>)(e => {
			this.llmMessageHooks.onText[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onFinalMessage_sendLLMMessage') satisfies Event<EventLLMMessageOnFinalMessageParams>)(e => {
			this.llmMessageHooks.onFinalMessage[e.requestId]?.(e);
			this._clearChannelHooks(e.requestId)
		}))
		this._register((this.channel.listen('onError_sendLLMMessage') satisfies Event<EventLLMMessageOnErrorParams>)(e => {
			const modelSelection = this.requestModelSelection[e.requestId]
			const source = modelSelection ? `${modelSelection.providerName}/${modelSelection.modelName}` : 'unknown provider/model'
			console.error(`[LLMMessageService] ${source} request ${e.requestId} failed: ${e.message}`, e.fullError ?? '')

			this.llmMessageHooks.onError[e.requestId]?.(e);
			this._clearChannelHooks(e.requestId);
		}))
		this._register((this.channel.listen('onTool_sendLLMMessage') satisfies Event<EventLLMMessageOnToolParams>)(e => {
			this.llmMessageHooks.onTool[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onCompaction_sendLLMMessage') satisfies Event<EventLLMMessageOnCompactionParams>)(e => {
			this.llmMessageHooks.onCompaction[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onServeSession_sendLLMMessage') satisfies Event<EventLLMMessageOnServeSessionParams>)(e => {
			this.llmMessageHooks.onServeSession[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onPermission_sendLLMMessage') satisfies Event<EventLLMMessageOnPermissionParams>)(e => {
			this.llmMessageHooks.onPermission[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onUsage_sendLLMMessage') satisfies Event<EventLLMMessageOnUsageParams>)(e => {
			this.llmMessageHooks.onUsage[e.requestId]?.(e)
		}))
		// .list()
		this._register((this.channel.listen('onSuccess_list_ollama') satisfies Event<EventModelListOnSuccessParams<OllamaModelResponse>>)(e => {
			this.listHooks.ollama.success[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onError_list_ollama') satisfies Event<EventModelListOnErrorParams<OllamaModelResponse>>)(e => {
			this.listHooks.ollama.error[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onSuccess_list_openAICompatible') satisfies Event<EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>>)(e => {
			this.listHooks.openAICompat.success[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onError_list_openAICompatible') satisfies Event<EventModelListOnErrorParams<OpenaiCompatibleModelResponse>>)(e => {
			this.listHooks.openAICompat.error[e.requestId]?.(e)
		}))

	}

	sendLLMMessage(params: ServiceSendLLMMessageParams) {
		const { onText, onFinalMessage, onError, onTool, onCompaction, onServeSession, onPermission, onUsage, onAbort, modelSelection, serveSessionId, ...proxyParams } = params;

		// Phase 2: Loophole Serve (server owns providers/models) — modelSelection may be null.
		const serveEnabled = this.configService.getValue<boolean>('loophole.serve.enabled') === true;
		const serveModelParam = this.configService.getValue<string>('loophole.serve.model') ?? '';
		const serveModelSlash = serveModelParam.indexOf('/');
		const serve = serveEnabled ? {
			enabled: true,
			model: serveModelSlash > 0 ? { providerID: serveModelParam.slice(0, serveModelSlash), modelID: serveModelParam.slice(serveModelSlash + 1) } : null,
		} : undefined;

		// throw an error if no model/provider selected (this should usually never be reached, the UI should check this first, but might happen in cases like Apply where we haven't built much UI/checks yet, good practice to have check logic on backend)
		if (modelSelection === null && !serveEnabled) {
			const message = `Please add a provider in Loophole's Settings.`
			onError({ message, fullError: null })
			return null
		}

		if (params.messagesType === 'chatMessages' && (params.messages?.length ?? 0) === 0) {
			const message = `No messages detected.`
			onError({ message, fullError: null })
			return null
		}

		const { settingsOfProvider, } = this.voidSettingsService.state

		const mcpTools = this.mcpService.getMCPTools()

		// add state for request id
		const requestId = generateUuid();
		this.llmMessageHooks.onText[requestId] = onText
		this.llmMessageHooks.onFinalMessage[requestId] = onFinalMessage
		this.llmMessageHooks.onError[requestId] = onError
		if (onTool) this.llmMessageHooks.onTool[requestId] = onTool
		if (onCompaction) this.llmMessageHooks.onCompaction[requestId] = onCompaction
		if (onServeSession) this.llmMessageHooks.onServeSession[requestId] = onServeSession
		if (onPermission) this.llmMessageHooks.onPermission[requestId] = onPermission
		if (onUsage) this.llmMessageHooks.onUsage[requestId] = onUsage
		this.llmMessageHooks.onAbort[requestId] = onAbort // used internally only
		if (modelSelection) this.requestModelSelection[requestId] = modelSelection

		// params will be stripped of all its functions over the IPC channel
		this.channel.call('sendLLMMessage', {
			...proxyParams,
			requestId,
			settingsOfProvider,
			modelSelection,
			mcpTools,
			...(serveSessionId ? { serveSessionId } : {}),
			...(serve ? { serve } : {}),
		} satisfies MainSendLLMMessageParams);

		return requestId
	}

	abort(requestId: string) {
		this.llmMessageHooks.onAbort[requestId]?.() // calling the abort hook here is instant (doesn't go over a channel)
		this.channel.call('abort', { requestId } satisfies MainLLMMessageAbortParams);
		this._clearChannelHooks(requestId)
	}


	ollamaList = (params: ServiceModelListParams<OllamaModelResponse>) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidSettingsService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.listHooks.ollama.success[requestId_] = onSuccess
		this.listHooks.ollama.error[requestId_] = onError

		this.channel.call('ollamaList', {
			...proxyParams,
			settingsOfProvider,
			providerName: 'ollama',
			requestId: requestId_,
		} satisfies MainModelListParams<OllamaModelResponse>)
	}


	openAICompatibleList = (params: ServiceModelListParams<OpenaiCompatibleModelResponse>) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidSettingsService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.listHooks.openAICompat.success[requestId_] = onSuccess
		this.listHooks.openAICompat.error[requestId_] = onError

		this.channel.call('openAICompatibleList', {
			...proxyParams,
			settingsOfProvider,
			requestId: requestId_,
		} satisfies MainModelListParams<OpenaiCompatibleModelResponse>)
	}

	private _clearChannelHooks(requestId: string) {
		delete this.llmMessageHooks.onText[requestId]
		delete this.llmMessageHooks.onFinalMessage[requestId]
		delete this.llmMessageHooks.onError[requestId]
		delete this.llmMessageHooks.onTool[requestId]
		delete this.llmMessageHooks.onCompaction[requestId]
		delete this.llmMessageHooks.onServeSession[requestId]
		delete this.llmMessageHooks.onPermission[requestId]
		delete this.llmMessageHooks.onUsage[requestId]
		delete this.requestModelSelection[requestId]

		delete this.listHooks.ollama.success[requestId]
		delete this.listHooks.ollama.error[requestId]

		delete this.listHooks.openAICompat.success[requestId]
		delete this.listHooks.openAICompat.error[requestId]
	}
}

registerSingleton(ILLMMessageService, LLMMessageService, InstantiationType.Eager);

