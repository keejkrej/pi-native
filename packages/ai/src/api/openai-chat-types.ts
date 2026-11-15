/**
 * Pure TypeScript wire types for the OpenAI Chat Completions API and compatible
 * endpoints (OpenRouter, Groq, DeepSeek, Mistral, vLLM, llama.cpp, etc.).
 *
 * Kept independent of `openai` `.d.ts` declarations and free of non-erasable
 * TypeScript syntax so native `scriptc` builds compile cleanly.
 */

export interface ChatCompletionContentPartText {
	type: "text";
	text: string;
	cache_control?: {
		type: "ephemeral";
		ttl?: string;
	};
}

export interface ChatCompletionContentPartImage {
	type: "image_url";
	image_url: {
		url: string;
		detail?: "auto" | "low" | "high";
	};
}

export type ChatCompletionContentPart = ChatCompletionContentPartText | ChatCompletionContentPartImage;

export interface ChatCompletionDeveloperMessageParam {
	role: "developer";
	content: string | ChatCompletionContentPartText[];
	name?: string;
}

export interface ChatCompletionSystemMessageParam {
	role: "system";
	content: string | ChatCompletionContentPartText[];
	name?: string;
}

export interface ChatCompletionUserMessageParam {
	role: "user";
	content: string | ChatCompletionContentPart[];
	name?: string;
}

export interface ChatCompletionMessageFunctionToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatCompletionMessageCustomToolCall {
	id: string;
	type: "custom";
	custom: {
		name: string;
		input: string;
	};
}

export type ChatCompletionMessageToolCall =
	| ChatCompletionMessageFunctionToolCall
	| ChatCompletionMessageCustomToolCall;

export interface ChatCompletionAssistantMessageParam {
	role: "assistant";
	content?: string | ChatCompletionContentPartText[] | null;
	tool_calls?: ChatCompletionMessageToolCall[];
	name?: string;
	refusal?: string | null;
}

export interface ChatCompletionToolMessageParam {
	role: "tool";
	content: string | ChatCompletionContentPartText[];
	tool_call_id: string;
	name?: string;
}

export type ChatCompletionMessageParam =
	| ChatCompletionDeveloperMessageParam
	| ChatCompletionSystemMessageParam
	| ChatCompletionUserMessageParam
	| ChatCompletionAssistantMessageParam
	| ChatCompletionToolMessageParam;

export interface ChatCompletionFunctionTool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
		strict?: boolean | null;
	};
}

export interface ChatCompletionCustomTool {
	type: "custom";
	custom: {
		name: string;
		description?: string;
		format?:
			| { type: "text" }
			| {
					type: "grammar";
					grammar: {
						syntax: string;
						definition: string;
					};
			  };
	};
}

export type ChatCompletionTool = ChatCompletionFunctionTool | ChatCompletionCustomTool;

export type ChatCompletionToolChoiceOption =
	| "none"
	| "auto"
	| "required"
	| { type: "function"; function: { name: string } }
	| { type: "custom"; custom: { name: string } }
	| { type: "allowed_tools"; allowed_tools: { mode: "auto" | "required"; tools: Array<Record<string, unknown>> } };

export interface ChatCompletionUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	cached_tokens?: number;
	prompt_cache_hit_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
		cache_write_tokens?: number;
	};
	completion_tokens_details?: {
		reasoning_tokens?: number;
	};
	reasoning_tokens?: number;
}

export type ChatCompletionFinishReason =
	| "stop"
	| "length"
	| "tool_calls"
	| "content_filter"
	| "function_call"
	| null;

export interface ChatCompletionChunkToolCallDelta {
	index?: number;
	id?: string;
	type?: "function" | "custom" | string;
	function?: {
		name?: string;
		arguments?: string;
	};
	custom?: {
		name?: string;
		input?: string;
	};
}

export interface ChatCompletionChunkChoice {
	index: number;
	finish_reason: ChatCompletionFinishReason;
	delta: {
		role?: "developer" | "system" | "user" | "assistant" | "tool";
		content?: string | null;
		refusal?: string | null;
		tool_calls?: ChatCompletionChunkToolCallDelta[];
		reasoning?: string | null;
		reasoning_content?: string | null;
		reasoning_text?: string | null;
		reasoning_details?: unknown[];
	};
	usage?: ChatCompletionUsage;
}

export interface ChatCompletionChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: ChatCompletionChunkChoice[];
	usage?: ChatCompletionUsage | null;
	system_fingerprint?: string;
	service_tier?: string | null;
}

export interface ChatCompletion {
	id: string;
	object?: string;
	created?: number;
	model?: string;
	choices: Array<{
		index?: number;
		finish_reason?: string | null;
		message: {
			role: string;
			content?: string | null | Array<{ type?: string; text?: string }>;
			images?: Array<{ image_url?: { url?: string } }>;
		};
	}>;
	usage?: ChatCompletionUsage | null;
}

export interface ChatCompletionCreateParamsBase {
	model: string;
	messages: ChatCompletionMessageParam[];
	store?: boolean | null;
	max_tokens?: number | null;
	max_completion_tokens?: number | null;
	temperature?: number | null;
	tools?: ChatCompletionTool[];
	tool_choice?: ChatCompletionToolChoiceOption;
	reasoning_effort?: string | null;
	prompt_cache_key?: string;
	prompt_cache_retention?: "in_memory" | "24h" | string;
	modalities?: Array<"text" | "audio" | "image">;
	tool_stream?: boolean;
	priority?: number;
	enable_thinking?: boolean;
	thinking?: { type?: string; clear_thinking?: boolean } | string;
	reasoning?: { effort?: string; enabled?: boolean };
	chat_template_kwargs?: Record<string, string | number | boolean | null>;
	chat_template_args?: Record<string, string | number | boolean | null>;
	provider?: unknown;
	providerOptions?: {
		gateway?: {
			only?: string[];
			order?: string[];
		};
	};
	[key: string]: unknown;
}

export interface ChatCompletionCreateParamsStreaming extends ChatCompletionCreateParamsBase {
	stream: true;
	stream_options?: {
		include_usage?: boolean;
	} | null;
}

export interface ChatCompletionCreateParamsNonStreaming extends ChatCompletionCreateParamsBase {
	stream?: false | null;
}
