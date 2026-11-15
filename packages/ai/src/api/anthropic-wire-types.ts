/**
 * Pure TypeScript structural wire types for the Anthropic Messages API.
 *
 * Kept independent of `@anthropic-ai/sdk` `.d.ts` declarations so native
 * `scriptc` code never treats locally built request payloads or parsed SSE
 * events as foreign Node-island values.
 */

export interface AnthropicFederationConfig {
	organization_id: string;
	workspace_id?: string | null;
	authentication: {
		type: "oidc_federation";
		federation_rule_id: string;
		service_account_id?: string | null;
		identity_token: {
			source: "file";
			path: string;
		};
	};
}

export interface CacheControlEphemeral {
	type: "ephemeral";
	ttl?: "5m" | "1h";
}

export interface AnthropicTextBlockParam {
	type: "text";
	text: string;
	cache_control?: CacheControlEphemeral | null;
}

export interface AnthropicImageBlockParam {
	type: "image";
	source: {
		type: "base64";
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | (string & {});
		data: string;
	};
	cache_control?: CacheControlEphemeral | null;
}

export interface AnthropicThinkingBlockParam {
	type: "thinking";
	thinking: string;
	signature: string;
}

export interface AnthropicRedactedThinkingBlockParam {
	type: "redacted_thinking";
	data: string;
}

export interface AnthropicToolUseBlockParam {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
	cache_control?: CacheControlEphemeral | null;
}

export interface AnthropicToolResultBlockParam {
	type: "tool_result";
	tool_use_id: string;
	content?: string | Array<AnthropicTextBlockParam | AnthropicImageBlockParam>;
	is_error?: boolean;
	cache_control?: CacheControlEphemeral | null;
}

export interface AnthropicToolAdditionBlockParam {
	type: "tool_addition";
	tool: {
		type: "tool_definition";
		definition: BetaTool;
	};
	cache_control?: CacheControlEphemeral | null;
}

export interface AnthropicToolRemovalBlockParam {
	type: "tool_removal";
	tool: {
		type: "tool_reference";
		name: string;
	};
	cache_control?: CacheControlEphemeral | null;
}

export type ContentBlockParam =
	| AnthropicTextBlockParam
	| AnthropicImageBlockParam
	| AnthropicThinkingBlockParam
	| AnthropicRedactedThinkingBlockParam
	| AnthropicToolUseBlockParam
	| AnthropicToolResultBlockParam
	| AnthropicToolAdditionBlockParam
	| AnthropicToolRemovalBlockParam;

export interface AnthropicOutputConfig {
	effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
}

export interface MessageParam {
	role: "user" | "assistant" | "system";
	content: string | ContentBlockParam[];
	output_config?: AnthropicOutputConfig;
}

export interface BetaTool {
	name: string;
	description?: string;
	input_schema: {
		type: "object";
		properties?: unknown | null;
		required?: string[] | null;
		[key: string]: unknown;
	};
	defer_loading?: boolean;
	strict?: boolean;
	cache_control?: CacheControlEphemeral | null;
}

export type BetaThinkingConfigParam =
	| { type: "disabled" }
	| {
			type: "enabled";
			budget_tokens: number;
			display?: "summarized" | "omitted";
			block_binding?: { prefix_mismatch_behavior?: "drop_block" | "fail" } | null;
	  }
	| {
			type: "adaptive";
			display?: "summarized" | "omitted";
			block_binding?: { prefix_mismatch_behavior?: "drop_block" | "fail" } | null;
	  };

export type BetaToolChoice = "auto" | "any" | "none" | { type: "auto" | "any" | "none" } | { type: "tool"; name: string };

export interface MessageCreateParamsStreaming {
	model: string;
	messages: MessageParam[];
	max_tokens: number;
	stream: true;
	betas?: string[];
	system?: AnthropicTextBlockParam[];
	temperature?: number;
	tools?: BetaTool[];
	thinking?: BetaThinkingConfigParam;
	output_config?: AnthropicOutputConfig;
	metadata?: { user_id?: string | null };
	tool_choice?: BetaToolChoice;
	fallbacks?: Array<{ model: string }>;
}

export type BetaStopReason =
	| "end_turn"
	| "max_tokens"
	| "stop_sequence"
	| "tool_use"
	| "pause_turn"
	| "compaction"
	| "refusal"
	| "model_context_window_exceeded";

export interface RefusalStopDetails {
	category?: string | null;
	explanation?: string | null;
}

export type BetaInputTransformation = {
	type: string;
	path: string;
	reason: string;
};

export interface AnthropicUsagePayload {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
	cache_creation?: {
		ephemeral_1h_input_tokens?: number | null;
		ephemeral_5m_input_tokens?: number | null;
	} | null;
	output_tokens_details?: {
		thinking_tokens?: number | null;
	} | null;
}

export type AnthropicStreamContentBlock =
	| { type: "text"; text?: string }
	| { type: "thinking"; thinking?: string; signature?: string }
	| { type: "redacted_thinking"; data: string }
	| { type: "tool_use"; id: string; name: string; input?: unknown }
	| { type: "fallback" };

export type AnthropicContentBlockDelta =
	| { type: "text_delta"; text: string }
	| { type: "thinking_delta"; thinking: string }
	| { type: "input_json_delta"; partial_json: string }
	| { type: "signature_delta"; signature: string };

export type RawMessageStreamEvent =
	| {
			type: "message_start";
			message: {
				id: string;
				model: string;
				usage: AnthropicUsagePayload;
				input_transformations?: BetaInputTransformation[] | null;
			};
	  }
	| {
			type: "content_block_start";
			index: number;
			content_block: AnthropicStreamContentBlock;
	  }
	| {
			type: "content_block_delta";
			index: number;
			delta: AnthropicContentBlockDelta;
	  }
	| {
			type: "content_block_stop";
			index: number;
	  }
	| {
			type: "message_delta";
			delta: {
				stop_reason?: BetaStopReason | string | null;
				stop_details?: RefusalStopDetails | null;
			};
			usage?: AnthropicUsagePayload | null;
			input_transformations?: BetaInputTransformation[] | null;
	  }
	| {
			type: "message_stop";
	  };
