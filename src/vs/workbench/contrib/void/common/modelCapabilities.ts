/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { FeatureName, ModelSelectionOptions, OverridesOfModel, ProviderName } from './voidSettingsTypes.js';

export const defaultProviderSettings = {
	anthropic: {
		apiKey: '',
	},
	openAI: {
		apiKey: '',
	},
	deepseek: {
		apiKey: '',
	},
	ollama: {
		endpoint: 'http://127.0.0.1:11434',
	},
	vLLM: {
		endpoint: 'http://localhost:8000',
	},
	openRouter: {
		apiKey: '',
	},
	openAICompatible: {
		endpoint: '',
		apiKey: '',
		headersJSON: '{}', // default to {}
	},
	gemini: {
		apiKey: '',
	},
	groq: {
		apiKey: '',
	},
	xAI: {
		apiKey: '',
	},
	mistral: {
		apiKey: '',
	},
	lmStudio: {
		endpoint: 'http://localhost:1234',
	},
	mlx: {
		endpoint: 'http://127.0.0.1:8080',
	},
	appleFoundationModels: {
		endpoint: 'http://127.0.0.1:9999',
	},
	liteLLM: {
		endpoint: '',
	},
	googleVertex: {
		region: 'us-west2',
		project: '',
	},
	microsoftAzure: {
		project: '',
		apiKey: '',
		azureApiVersion: '2024-05-01-preview',
	},
	awsBedrock: {
		apiKey: '',
		region: 'us-east-1',
		endpoint: '',
	},

	loophole: {},

} as const

export const defaultModelsOfProvider = {
	openAI: [],
	anthropic: [],
	xAI: [],
	gemini: [],
	deepseek: [],
	ollama: [],
	vLLM: [],
	lmStudio: [],
	mlx: [],
	appleFoundationModels: [],
	openRouter: [],
	groq: [],
	mistral: [],
	openAICompatible: [],
	googleVertex: [],
	microsoftAzure: [],
	awsBedrock: [],
	liteLLM: [],
	// Discovered at runtime from the engine's own catalogue; see engineAdapter.listModels.
	loophole: [],

} as const satisfies Record<ProviderName, string[]>

export type VoidStaticModelInfo = { // not stateful
	contextWindow: number; // input tokens
	reservedOutputTokenSpace: number | null; // reserve this much space in the context window for output, defaults to 4096 if null

	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated'; // typically you should use 'system-role'. 'separated' means the system message is passed as a separate field (e.g. anthropic)
	specialToolFormat?: 'openai-style' | 'anthropic-style' | 'gemini-style', // typically you should use 'openai-style'. null means "can't call tools by default", and asks the LLM to output XML in agent mode
	supportsFIM: boolean; // whether the model was specifically designed for autocomplete or "FIM" ("fill-in-middle" format)

	additionalOpenAIPayload?: { [key: string]: string } // additional payload in the message body for requests that are openai-compatible (ollama, vllm, openai, openrouter, etc)

	// reasoning options
	reasoningCapabilities: false | {
		readonly supportsReasoning: true; // for clarity, this must be true if anything below is specified
		readonly canTurnOffReasoning: boolean; // whether or not the user can disable reasoning mode (false if the model only supports reasoning)
		readonly canIOReasoning: boolean; // whether or not the model actually outputs reasoning (eg o1 lets us control reasoning but not output it)
		readonly reasoningReservedOutputTokenSpace?: number; // overrides normal reservedOutputTokenSpace
		readonly reasoningSlider?:
		| undefined
		| { type: 'budget_slider'; min: number; max: number; default: number } // anthropic supports this (reasoning budget)
		| { type: 'effort_slider'; values: string[]; default: string } // openai-compatible supports this (reasoning effort)
		| { type: 'adaptive' } // model decides how much to think (e.g. anthropic adaptive thinking); no user-facing budget/effort control

		// if it's open source and specifically outputs think tags, put the think tags here and we'll parse them out (e.g. ollama)
		readonly openSourceThinkTags?: [string, string];

		// the only other field related to reasoning is "providerReasoningIOSettings", which varies by provider.
	};


	// --- below is just informative, not used in sending / receiving, cannot be customized in settings ---
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	}
	downloadable: false | {
		sizeGb: number | 'not-known'
	}
}



export const modelOverrideKeys = [
	'contextWindow',
	'reservedOutputTokenSpace',
	'supportsSystemMessage',
	'specialToolFormat',
	'supportsFIM',
	'reasoningCapabilities',
	'additionalOpenAIPayload'
] as const

export type ModelOverrides = Pick<
	VoidStaticModelInfo,
	(typeof modelOverrideKeys)[number]
>




type ProviderReasoningIOSettings = {
	// include this in payload to get reasoning
	input?: { includeInPayload?: (reasoningState: SendableReasoningInfo) => null | { [key: string]: unknown }, };
	// nameOfFieldInDelta: reasoning output is in response.choices[0].delta[deltaReasoningField]
	// needsManualParse: whether we must manually parse out the <think> tags
	output?:
	| { nameOfFieldInDelta?: string, needsManualParse?: undefined, }
	| { nameOfFieldInDelta?: undefined, needsManualParse?: true, };
}

type VoidStaticProviderInfo = { // doesn't change (not stateful)
	providerReasoningIOSettings?: ProviderReasoningIOSettings; // input/output settings around thinking (allowed to be empty) - only applied if the model supports reasoning output
	modelOptions: { [key: string]: VoidStaticModelInfo };
	modelOptionsFallback: (modelName: string, fallbackKnownValues?: Partial<VoidStaticModelInfo>) => (VoidStaticModelInfo & { modelName: string, recognizedModelName: string }) | null;
}


const defaultModelOptions = {
	contextWindow: 4_096,
	reservedOutputTokenSpace: 4_096,
	cost: { input: 0, output: 0 },
	downloadable: false,
	supportsSystemMessage: false,
	supportsFIM: false,
	reasoningCapabilities: false,
} as const satisfies VoidStaticModelInfo

const openAICompatReasoningIO: ProviderReasoningIOSettings = {
	output: { nameOfFieldInDelta: 'reasoning_content' },
}

const fimModelPattern = /codestral|coder|fim|mercury/i

const genericProviderInfo: VoidStaticProviderInfo = {
	providerReasoningIOSettings: openAICompatReasoningIO,
	modelOptions: {},
	modelOptionsFallback: (modelName) => ({
		...defaultModelOptions,
		supportsFIM: fimModelPattern.test(modelName),
		supportsSystemMessage: 'system-role',
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
		modelName,
		recognizedModelName: 'other',
	}),
}

// The Loophole engine: reasoning is the engine's business, so nothing is injected here.
// The catalog is filled in at runtime from /api/model so context limits match the engine.
const loopholeModelOptions: { [key: string]: VoidStaticModelInfo } = {}

export type LoopholeModelCapabilities = {
	modelName: string;
	contextWindow?: number;
	outputTokens?: number;
	supportsTools?: boolean;
	cost?: { input: number; output: number };
}

export const setLoopholeModelCapabilities = (models: ReadonlyArray<LoopholeModelCapabilities>) => {
	for (const modelName of Object.keys(loopholeModelOptions)) {
		delete loopholeModelOptions[modelName]
	}
	for (const model of models) {
		const contextWindow = Math.max(model.contextWindow ?? 200_000, 1)
		const reservedOutputTokenSpace = Math.min(Math.max(model.outputTokens ?? 16_384, 1), contextWindow)
		loopholeModelOptions[model.modelName] = {
			...defaultModelOptions,
			contextWindow,
			reservedOutputTokenSpace,
			cost: model.cost ?? { input: 0, output: 0 },
		}
	}
}

const loopholeSettings: VoidStaticProviderInfo = {
	modelOptions: loopholeModelOptions,
	modelOptionsFallback: (modelName) => ({
		modelName,
		recognizedModelName: 'unknown',
		...defaultModelOptions,
		contextWindow: 200_000,
		reservedOutputTokenSpace: 16_384,
	}),
}

const modelSettingsOfProvider: { [providerName in ProviderName]: VoidStaticProviderInfo } = {
	openAI: genericProviderInfo,
	anthropic: genericProviderInfo,
	xAI: genericProviderInfo,
	gemini: genericProviderInfo,

	// open source models
	deepseek: genericProviderInfo,
	groq: genericProviderInfo,

	// open source models + providers (mixture of everything)
	openRouter: genericProviderInfo,
	vLLM: genericProviderInfo,
	ollama: genericProviderInfo,
	openAICompatible: genericProviderInfo,
	mistral: genericProviderInfo,

	liteLLM: genericProviderInfo,
	lmStudio: genericProviderInfo,
	mlx: genericProviderInfo,
	appleFoundationModels: genericProviderInfo,

	googleVertex: genericProviderInfo,
	microsoftAzure: genericProviderInfo,
	awsBedrock: genericProviderInfo,

	// The engine resolves its own model capabilities per request, so the IDE does not
	// second-guess context size or reasoning controls for this provider.
	loophole: loopholeSettings,
} as const


// ---------------- exports ----------------

// returns the capabilities and the adjusted modelName if it was a fallback
export const getModelCapabilities = (
	providerName: ProviderName,
	modelName: string,
	overridesOfModel: OverridesOfModel | undefined
): VoidStaticModelInfo & (
	| { modelName: string; recognizedModelName: string; isUnrecognizedModel: false }
	| { modelName: string; recognizedModelName?: undefined; isUnrecognizedModel: true }
) => {

	const lowercaseModelName = modelName.toLowerCase()

	const { modelOptions, modelOptionsFallback } = modelSettingsOfProvider[providerName]

	// Get any override settings for this model
	const overrides = overridesOfModel?.[providerName]?.[modelName];

	// search model options object directly first
	for (const modelName_ in modelOptions) {
		const lowercaseModelName_ = modelName_.toLowerCase()
		if (lowercaseModelName === lowercaseModelName_) {
			return { ...modelOptions[modelName], ...overrides, modelName, recognizedModelName: modelName, isUnrecognizedModel: false };
		}
	}

	const result = modelOptionsFallback(modelName)
	if (result) {
		return { ...result, ...overrides, modelName: result.modelName, isUnrecognizedModel: false };
	}

	return { modelName, ...defaultModelOptions, ...overrides, isUnrecognizedModel: true };
}

// non-model settings
export const getProviderCapabilities = (providerName: ProviderName) => {
	const { providerReasoningIOSettings } = modelSettingsOfProvider[providerName]
	return { providerReasoningIOSettings }
}


export type SendableReasoningInfo = {
	type: 'budget_slider_value',
	isReasoningEnabled: true,
	reasoningBudget: number,
} | {
	type: 'effort_slider_value',
	isReasoningEnabled: true,
	reasoningEffort: string,
} | {
	type: 'adaptive',
	isReasoningEnabled: true,
} | null



export const getIsReasoningEnabledState = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
) => {
	const { supportsReasoning, canTurnOffReasoning } = getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {}
	if (!supportsReasoning) return false

	// default to enabled if can't turn off, or if the featureName is Chat.
	const defaultEnabledVal = featureName === 'Chat' || !canTurnOffReasoning

	const isReasoningEnabled = modelSelectionOptions?.reasoningEnabled ?? defaultEnabledVal
	return isReasoningEnabled
}


export const getReservedOutputTokenSpace = (providerName: ProviderName, modelName: string, opts: { isReasoningEnabled: boolean, overridesOfModel: OverridesOfModel | undefined }) => {
	const {
		reasoningCapabilities,
		reservedOutputTokenSpace,
	} = getModelCapabilities(providerName, modelName, opts.overridesOfModel)
	return opts.isReasoningEnabled && reasoningCapabilities ? reasoningCapabilities.reasoningReservedOutputTokenSpace : reservedOutputTokenSpace
}

// used to force reasoning state (complex) into something simple we can just read from when sending a message
export const getSendableReasoningInfo = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
): SendableReasoningInfo => {

	const { reasoningSlider: reasoningBudgetSlider } = getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {}
	const isReasoningEnabled = getIsReasoningEnabledState(featureName, providerName, modelName, modelSelectionOptions, overridesOfModel)
	if (!isReasoningEnabled) return null

	// check for reasoning budget
	const reasoningBudget = reasoningBudgetSlider?.type === 'budget_slider' ? modelSelectionOptions?.reasoningBudget ?? reasoningBudgetSlider?.default : undefined
	if (reasoningBudget) {
		return { type: 'budget_slider_value', isReasoningEnabled: isReasoningEnabled, reasoningBudget: reasoningBudget }
	}

	// check for reasoning effort
	const reasoningEffort = reasoningBudgetSlider?.type === 'effort_slider' ? modelSelectionOptions?.reasoningEffort ?? reasoningBudgetSlider?.default : undefined
	if (reasoningEffort) {
		return { type: 'effort_slider_value', isReasoningEnabled: isReasoningEnabled, reasoningEffort: reasoningEffort }
	}

	// adaptive thinking — the model decides how much to think, no budget/effort value to send
	if (reasoningBudgetSlider?.type === 'adaptive') {
		return { type: 'adaptive', isReasoningEnabled: isReasoningEnabled }
	}

	return null
}
