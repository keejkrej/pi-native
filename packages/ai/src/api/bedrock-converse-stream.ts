import { calculateCost } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	ImageContent,
	JsonObject,
	JsonValue,
	Model,
	ProviderEnv,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingBudgets,
	ThinkingLevel,
	Tool,
	ToolResultMessage,
} from "../types.ts";
import { appendAssistantMessageDiagnostic } from "../utils/diagnostics.ts";
import { normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";
import { type ClientIdentity, formatUserAgent } from "../utils/identity.ts";
import { resolveHttpProxyUrlForTarget } from "../utils/node-http-proxy.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { ToolCallArgumentsStream } from "../utils/streaming-json.ts";
import { getSystemMessageText } from "../utils/text.ts";
import {
	collapseSystemMessages,
	getCurrentTools,
	getInitialSystemMessage,
	type TranscriptContext,
	withoutInitialSystemMessage,
} from "../utils/transcript.ts";
import {
	type BedrockCredentials,
	BedrockRuntimeServiceException,
	BedrockStopReason,
	type BedrockTool,
	CachePointType,
	CacheTTL,
	type ContentBlock,
	type ContentBlockDeltaEvent,
	type ContentBlockStartEvent,
	type ContentBlockStopEvent,
	ConversationRole,
	type ConverseStreamCommandInput,
	type ConverseStreamCommandOutput,
	type ConverseStreamMetadataEvent,
	type DocumentType,
	ImageFormat,
	type BedrockMessage as Message,
	resolveBedrockCredentials,
	resolveBedrockProfileRegion,
	sendBedrockConverseStream,
	type SystemContentBlock,
	type ToolChoice,
	type ToolConfiguration,
	type ToolResultContentBlock,
	ToolResultStatus,
} from "./bedrock-eventstream.ts";

export { BedrockRuntimeServiceException };
import {
	getJsonSchemaToolParameters,
	prefersJsonSchemaStrictSampling,
	resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import {
	adjustMaxTokensForThinking,
	buildBaseOptions,
	clampMaxTokensToContext,
	clampReasoning,
} from "./simple-options.ts";
import {
	hasExceededStrictToolLimits,
	isStrictToolLimitErrorMessage,
	markStrictToolLimitsExceeded,
} from "./strict-tool-limits.ts";
import { splitErrorToolResultImages, transformMessages } from "./transform-messages.ts";

export type BedrockThinkingDisplay = "summarized" | "omitted";

export interface BedrockOptions extends StreamOptions {
	region?: string;
	profile?: string;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	/* See https://docs.aws.amazon.com/bedrock/latest/userguide/inference-reasoning.html for supported models. */
	reasoning?: ThinkingLevel;
	/* Custom token budgets per thinking level. Overrides default budgets. */
	thinkingBudgets?: ThinkingBudgets;
	/* Only supported by Claude 4.x models, see https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html#claude-messages-extended-thinking-tool-use-interleaved */
	interleavedThinking?: boolean;
	/**
	 * Controls how Claude's thinking content is returned in responses.
	 * - "summarized": Thinking blocks contain summarized thinking text (default here).
	 * - "omitted": Thinking content is redacted but the signature still travels back
	 *   for multi-turn continuity, reducing time-to-first-text-token.
	 *
	 * Note: Anthropic's API default for Claude Opus 4.8 and Mythos Preview is
	 * "omitted". We default to "summarized" here to keep behavior consistent with
	 * older Claude 4 models. Only applies to Claude models on Bedrock.
	 */
	thinkingDisplay?: BedrockThinkingDisplay;
	/** Key-value pairs attached to the inference request for cost allocation tagging.
	 * Keys: max 64 chars, no `aws:` prefix. Values: max 256 chars. Max 50 pairs.
	 * Tags appear in AWS Cost Explorer split cost allocation data.
	 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html */
	requestMetadata?: Record<string, string>;
	/** Bearer token for Bedrock API key authentication.
	 * When set, bypasses SigV4 signing and sends Authorization: Bearer <token> instead.
	 * Requires `bedrock:CallWithBearerToken` IAM permission on the token's identity.
	 * Set via AWS_BEARER_TOKEN_BEDROCK env var or pass directly.
	 * @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html */
	bearerToken?: string;
}

/**
 * Stream state of one open Bedrock content block, keyed by `contentBlockIndex` and kept off the content block so it
 * never reaches partial messages.
 */
type OpenBlock = {
	readonly contentIndex: number;
	readonly arguments?: ToolCallArgumentsStream;
	/** Encrypted reasoning deltas, joined into `thinkingSignature` when the block ends. */
	redactedChunks?: Uint8Array[];
};

type OpenBlocks = Map<number, OpenBlock>;

const EMPTY_TEXT_PLACEHOLDER = "<empty>";

const THINKING_BINDING_CONTROLS_BETA = "thinking-binding-controls-2026-08-01";

/** Matches the placeholder the Anthropic API path uses for redacted thinking. */
const REDACTED_THINKING_PLACEHOLDER = "[Reasoning redacted]";

function buildDefaultBedrockEndpoint(region: string): string {
	return `https://bedrock-runtime.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`;
}

export const stream: StreamFunction<"bedrock-converse-stream", BedrockOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: TranscriptContext,
	options: BedrockOptions = {},
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	// Bedrock has no mid-conversation system messages; fold them into the leading prompt.
	const normalizedContext = collapseSystemMessages(context);

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "bedrock-converse-stream" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "pending",
			timestamp: Date.now(),
		};

		const openBlocks: OpenBlocks = new Map();

		// A profile explicitly configured through pi's auth flow (the `profile`
		// option or scoped `AWS_PROFILE` on the stored credential's env) must win
		// over ambient AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY. See #6957.
		const optionsProfile = options.profile || options.env?.AWS_PROFILE;
		const ambientProfile = getProviderEnvValue("AWS_PROFILE", options.env);
		const configuredRegion = getConfiguredBedrockRegion(options);
		const hasAmbientConfiguredProfile = Boolean(getProviderEnvValue("AWS_PROFILE"));
		const endpointRegion = getStandardBedrockEndpointRegion(model.baseUrl);
		const useExplicitEndpoint = shouldUseExplicitBedrockEndpoint(
			model.baseUrl,
			configuredRegion,
			hasAmbientConfiguredProfile,
		);

		// Resolve bearer token for Bedrock API key auth.
		const skipAuth = getProviderEnvValue("AWS_BEDROCK_SKIP_AUTH", options.env) === "1";
		const bearerToken =
			options.bearerToken ||
			options.apiKey ||
			getProviderEnvValue("AWS_BEARER_TOKEN_BEDROCK", options.env) ||
			undefined;
		const useBearerToken = bearerToken !== undefined && !skipAuth;

		const arnRegionMatch = model.id.match(/^arn:aws(?:-[a-z0-9-]+)?:bedrock:([a-z0-9-]+):/);
		const activeProfile = optionsProfile || ambientProfile;
		let region: string;
		if (arnRegionMatch) {
			region = arnRegionMatch[1];
		} else if (configuredRegion) {
			region = configuredRegion;
		} else if (endpointRegion && useExplicitEndpoint) {
			region = endpointRegion;
		} else if (activeProfile) {
			region = resolveBedrockProfileRegion(activeProfile, options.env) || "us-east-1";
		} else {
			region = "us-east-1";
		}

		// Only pin standard AWS Bedrock runtime endpoints when no region or ambient AWS_PROFILE is configured.
		// This preserves custom endpoints (VPC/proxy) from #3402 without forcing built-in
		// catalog defaults such as us-east-1 to override AWS_REGION/AWS_PROFILE.
		const endpoint = useExplicitEndpoint && model.baseUrl ? model.baseUrl : buildDefaultBedrockEndpoint(region);

		// Kept outside the try so the catch can still correlate a mid-stream failure:
		// exceptions delivered as stream events carry no HTTP metadata of their own.
		let responseRequestId: string | undefined;

		try {
			const credentials: BedrockCredentials | undefined = useBearerToken
				? undefined
				: resolveBedrockCredentials({
						optionsProfile,
						ambientProfile,
						envCredentials: getConfiguredBedrockCredentials(options.env),
						skipAuth,
						env: options.env,
					});
			const proxyUrl = resolveHttpProxyUrlForTarget(endpoint, options.env);
			const supportsStrictMode = model.compat?.supportsStrictMode ?? false;
			let observedRawResponse = false;
			const customHeaders = providerHeadersToRecord(model.headers, options.headers);
			const userAgent = formatUserAgent(options.identity);
			const cacheRetention = resolveCacheRetention(options.cacheRetention, options.env);
			const inferenceMaxTokens = options.maxTokens ?? (isAnthropicClaudeModel(model) ? model.maxTokens : undefined);
			const initialSystemMessage = getInitialSystemMessage(normalizedContext.messages);
			const initialSystemPrompt = initialSystemMessage ? getSystemMessageText(initialSystemMessage) : undefined;
			let disablePreferredStrictTools = hasExceededStrictToolLimits(options.sessionId);
			let response: ConverseStreamCommandOutput;
			for (;;) {
				const tools = convertToolConfig(
					getCurrentTools(normalizedContext.messages),
					options.toolChoice,
					supportsStrictMode,
					disablePreferredStrictTools,
				);
				let commandInput: ConverseStreamCommandInput = {
					modelId: model.id,
					messages: convertMessages(normalizedContext, model, cacheRetention, options.env),
					system: buildSystemPrompt(initialSystemPrompt, model, cacheRetention, options.env),
					inferenceConfig: {
						...(inferenceMaxTokens !== undefined && { maxTokens: inferenceMaxTokens }),
						...(options.temperature !== undefined && { temperature: options.temperature }),
					},
					toolConfig: tools.toolConfig,
					additionalModelRequestFields: buildAdditionalModelRequestFields(model, options),
					...(options.requestMetadata !== undefined && { requestMetadata: options.requestMetadata }),
				};
				const nextCommandInput = await options?.onPayload?.(commandInput, model);
				if (nextCommandInput !== undefined) {
					commandInput = nextCommandInput as ConverseStreamCommandInput;
				}
				try {
					response = await sendBedrockConverseStream({
						endpoint,
						region,
						commandInput,
						customHeaders,
						userAgent,
						bearerToken: useBearerToken ? bearerToken : undefined,
						credentials,
						proxyUrl,
						fetch: options.fetch,
						signal: options.signal,
						onRawResponse: options.onResponse
							? async (rawResponse) => {
									observedRawResponse = true;
									await options.onResponse?.(
										{ status: rawResponse.status, headers: headersToRecord(rawResponse.headers) },
										model,
									);
								}
							: undefined,
					});
					break;
				} catch (error) {
					// Bedrock checks the tool schemas before it starts the stream, so a retry never repeats streamed output.
					if (
						options.signal?.aborted ||
						disablePreferredStrictTools ||
						!tools.hasPreferredStrictTools ||
						!(error instanceof BedrockRuntimeServiceException) ||
						error.name !== "ValidationException" ||
						!isStrictToolLimitErrorMessage(error.message)
					) {
						throw error;
					}
					disablePreferredStrictTools = true;
					markStrictToolLimitsExceeded(options.sessionId);
					appendAssistantMessageDiagnostic(output, {
						type: "bedrock_strict_tools_fallback",
						timestamp: Date.now(),
						error: { message: error.message },
						details: { reason: "strict_tool_limits_exceeded" },
					});
				}
			}
			responseRequestId = normalizeDiagnosticValue(response.$metadata.requestId);
			if (!observedRawResponse && response.$metadata.httpStatusCode !== undefined) {
				const responseHeaders: Record<string, string> = {};
				if (response.$metadata.requestId) {
					responseHeaders["x-amzn-requestid"] = response.$metadata.requestId;
				}
				await options?.onResponse?.({ status: response.$metadata.httpStatusCode, headers: responseHeaders }, model);
			}

			for await (const item of response.stream) {
				await options.onProviderStreamEvent?.(item, model);
				if (item.messageStart) {
					if (item.messageStart.role !== ConversationRole.ASSISTANT) {
						throw new Error("Unexpected assistant message start but got user message start instead");
					}
					stream.push({ type: "start", partial: output });
				} else if (item.contentBlockStart) {
					handleContentBlockStart(item.contentBlockStart, openBlocks, output, stream);
				} else if (item.contentBlockDelta) {
					handleContentBlockDelta(item.contentBlockDelta, openBlocks, output, stream);
				} else if (item.contentBlockStop) {
					handleContentBlockStop(item.contentBlockStop, openBlocks, output, stream);
				} else if (item.messageStop) {
					output.rawStopReason = item.messageStop.stopReason;
					const { stopReason, errorMessage } = mapStopReason(item.messageStop.stopReason);
					output.stopReason = stopReason;
					if (errorMessage) {
						output.errorMessage = errorMessage;
					}
				} else if (item.metadata) {
					handleMetadata(item.metadata, model, output);
				} else if (item.internalServerException) {
					throw item.internalServerException;
				} else if (item.modelStreamErrorException) {
					throw item.modelStreamErrorException;
				} else if (item.validationException) {
					throw item.validationException;
				} else if (item.throttlingException) {
					throw item.throttlingException;
				} else if (item.serviceUnavailableException) {
					throw item.serviceUnavailableException;
				}
			}

			if (options.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "pending") {
				throw new Error("Bedrock stream ended without a stop reason");
			}
			if (output.stopReason === "error" || output.stopReason === "aborted") {
				throw new Error(output.errorMessage || "An unknown error occurred");
			}

			// A stream can settle without stopping every block, so finalize here too.
			flushOpenBlocks(openBlocks, output);
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			flushOpenBlocks(openBlocks, output);
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatBedrockError(error);
			if (output.stopReason === "error") {
				appendBedrockFailureDiagnostic(output, error, responseRequestId);
			}
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

/**
 * Human-readable prefixes for Bedrock SDK exception names.
 * The downstream retry logic in agent-session matches patterns like
 * `server.?error` and `service.?unavailable`, so we preserve the legacy
 * prefix format rather than using the raw SDK exception name.
 */
const BEDROCK_ERROR_PREFIXES: Record<string, string> = {
	InternalServerException: "Internal server error",
	ModelStreamErrorException: "Model stream error",
	ValidationException: "Validation error",
	ThrottlingException: "Throttling error",
	ServiceUnavailableException: "Service unavailable",
};

/**
 * Some models reject the account/profile's configured Bedrock data retention mode
 * (e.g. "data retention mode 'default' is not available for this model"). Point
 * users at the AWS docs explaining how to configure a supported mode.
 */
const BEDROCK_DATA_RETENTION_DOCS_URL = "https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html";

/**
 * Format a Bedrock error with a human-readable prefix.
 * AWS SDK exceptions (both from `client.send()` and from stream event items)
 * extend BedrockRuntimeServiceException. We map the `.name` to a stable
 * human-readable prefix so downstream consumers (retry logic, context-overflow
 * detection) can distinguish error categories via simple string matching.
 */
function formatBedrockError(error: unknown): string {
	const norm = normalizeProviderError(error);
	// Surface the raw HTTP body (with status) when the SDK did not fold it into
	// the message; otherwise fall back to the message. This is what stops a
	// gateway 403 from collapsing to `Unknown: UnknownError`.
	const core =
		!norm.messageCarriesBody && norm.status !== undefined && norm.body !== undefined
			? `${norm.status}: ${norm.body}`
			: norm.message;
	const dataRetentionHint = /data retention mode/i.test(core)
		? ` See ${BEDROCK_DATA_RETENTION_DOCS_URL} for supported data retention modes.`
		: "";
	if (error instanceof BedrockRuntimeServiceException) {
		const prefix = BEDROCK_ERROR_PREFIXES[error.name] ?? error.name;
		return `${prefix}: ${core}${dataRetentionHint}`;
	}
	return `${core}${dataRetentionHint}`;
}

type SdkErrorMetadata = { $metadata?: { httpStatusCode?: unknown; requestId?: unknown } };

/** Over-long header values are dropped rather than truncated: a truncated request id is not a request id. */
const MAX_BEDROCK_DIAGNOSTIC_VALUE_CHARS = 200;

function normalizeDiagnosticValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_BEDROCK_DIAGNOSTIC_VALUE_CHARS) return undefined;
	return trimmed;
}

/**
 * The SDK puts the modeled code on `error.name` for service exceptions and unmodeled stream errors alike, so
 * do not narrow to `BedrockRuntimeServiceException`. Modeled Bedrock errors all end in `Exception`, unlike
 * transport names such as `TimeoutError`.
 */
function extractBedrockErrorCode(error: unknown): string | undefined {
	if (!(error instanceof Error) || !error.name.endsWith("Exception")) return undefined;
	return normalizeDiagnosticValue(error.name);
}

/**
 * Structured metadata alongside `errorMessage`, which stays byte-identical because `isRetryableAssistantError`
 * matches against it. Unknown fields are omitted, never guessed: a modeled mid-stream exception reaches us as
 * a bare object literal, leaving only `fallbackRequestId`. `details` only, as the throw is not always `Error`.
 */
function appendBedrockFailureDiagnostic(
	output: AssistantMessage,
	error: unknown,
	fallbackRequestId: string | undefined,
): void {
	const metadata = (error as SdkErrorMetadata)?.$metadata;
	const details: JsonObject = {};

	if (typeof metadata?.httpStatusCode === "number") details.status = metadata.httpStatusCode;

	const errorCode = extractBedrockErrorCode(error);
	if (errorCode !== undefined) details.errorCode = errorCode;

	const requestId = normalizeDiagnosticValue(metadata?.requestId) ?? fallbackRequestId;
	if (requestId !== undefined) details.requestId = requestId;

	if (Object.keys(details).length === 0) return;

	appendAssistantMessageDiagnostic(output, { type: "bedrock_response_failure", timestamp: Date.now(), details });
}

// Unused middleware helpers removed: custom headers, User-Agent, and raw response observation live in bedrock-eventstream.ts.

export const streamSimple: StreamFunction<"bedrock-converse-stream", SimpleStreamOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const base = {
		...buildBaseOptions(model, context, options, undefined),
		toolChoice: options?.toolChoice,
	} satisfies BedrockOptions;
	if (!options?.reasoning) {
		return stream(model, context, { ...base, reasoning: undefined } satisfies BedrockOptions);
	}

	if (isAnthropicClaudeModel(model)) {
		if (supportsAdaptiveThinking(model.id, model.name)) {
			return stream(model, context, {
				...base,
				reasoning: options.reasoning,
				thinkingBudgets: options.thinkingBudgets,
			} satisfies BedrockOptions);
		}

		// Undefined means the caller did not request an output cap; let the helper use the model cap.
		// Do not coerce to 0 here, or the thinking budget would become the entire maxTokens value.
		const adjusted = adjustMaxTokensForThinking(
			base.maxTokens,
			model.maxTokens,
			options.reasoning,
			options.thinkingBudgets,
		);

		const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);

		return stream(model, context, {
			...base,
			maxTokens,
			reasoning: options.reasoning,
			thinkingBudgets: {
				...(options.thinkingBudgets || {}),
				[clampReasoning(options.reasoning)!]: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
			},
		} satisfies BedrockOptions);
	}

	return stream(model, context, {
		...base,
		reasoning: options.reasoning,
		thinkingBudgets: options.thinkingBudgets,
	} satisfies BedrockOptions);
};

function handleContentBlockStart(
	event: ContentBlockStartEvent,
	openBlocks: OpenBlocks,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const start = event.start;

	if (start?.toolUse) {
		output.content.push({
			type: "toolCall",
			id: start.toolUse.toolUseId || "",
			name: start.toolUse.name || "",
			arguments: {},
		});
		const contentIndex = output.content.length - 1;
		openBlocks.set(event.contentBlockIndex!, { contentIndex, arguments: new ToolCallArgumentsStream() });
		stream.push({ type: "toolcall_start", contentIndex, partial: output });
	}
}

function handleContentBlockDelta(
	event: ContentBlockDeltaEvent,
	openBlocks: OpenBlocks,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const contentBlockIndex = event.contentBlockIndex!;
	const delta = event.delta;
	let open = openBlocks.get(contentBlockIndex);
	let block = open === undefined ? undefined : output.content[open.contentIndex];

	if (delta?.text !== undefined) {
		// If no text block exists yet, create one, as `handleContentBlockStart` is not sent for text blocks
		if (!open) {
			output.content.push({ type: "text", text: "" });
			open = { contentIndex: output.content.length - 1 };
			openBlocks.set(contentBlockIndex, open);
			block = output.content[open.contentIndex];
			stream.push({ type: "text_start", contentIndex: open.contentIndex, partial: output });
		}
		if (block?.type === "text") {
			block.text += delta.text;
			stream.push({ type: "text_delta", contentIndex: open.contentIndex, delta: delta.text, partial: output });
		}
	} else if (delta?.toolUse && block?.type === "toolCall" && open?.arguments !== undefined) {
		block.arguments = open.arguments.append(delta.toolUse.input || "");
		stream.push({
			type: "toolcall_delta",
			contentIndex: open.contentIndex,
			delta: delta.toolUse.input || "",
			partial: output,
		});
	} else if (delta?.reasoningContent) {
		if (!open) {
			output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" });
			open = { contentIndex: output.content.length - 1 };
			openBlocks.set(contentBlockIndex, open);
			block = output.content[open.contentIndex];
			stream.push({ type: "thinking_start", contentIndex: open.contentIndex, partial: output });
		}

		if (block?.type === "thinking") {
			const thinkingIndex = open.contentIndex;
			if (delta.reasoningContent.text) {
				block.thinking += delta.reasoningContent.text;
				stream.push({
					type: "thinking_delta",
					contentIndex: thinkingIndex,
					delta: delta.reasoningContent.text,
					partial: output,
				});
			}
			// `thinkingSignature` holds either an Anthropic signature or an opaque redacted
			// payload, never both: mixing them would corrupt whichever arrived first.
			if (delta.reasoningContent.signature && !block.redacted) {
				block.thinkingSignature = (block.thinkingSignature || "") + delta.reasoningContent.signature;
			}
			if (delta.reasoningContent.redactedContent?.length) {
				// Encrypted reasoning from non-Anthropic models on Bedrock (e.g. OpenAI GPT-5.6).
				// The payload is opaque, so keep it verbatim in `thinkingSignature` the way the
				// Anthropic path stores redacted thinking, and replay it on the next turn.
				if (!block.redacted) {
					block.redacted = true;
					block.thinkingSignature = "";
					block.thinking += REDACTED_THINKING_PLACEHOLDER;
					stream.push({
						type: "thinking_delta",
						contentIndex: thinkingIndex,
						delta: REDACTED_THINKING_PLACEHOLDER,
						partial: output,
					});
				}
				open.redactedChunks ??= [];
				open.redactedChunks.push(delta.reasoningContent.redactedContent);
			}
		}
	}
}

/**
 * Encodes buffered encrypted reasoning into `thinkingSignature`. The chunks stay in the stream state, never on the
 * block: `Uint8Array` is not JSON and serializes to an index-keyed object roughly ten times the size of the base64
 * payload.
 */
function flushRedactedContent(open: OpenBlock, output: AssistantMessage): void {
	const block = output.content[open.contentIndex];
	if (block?.type !== "thinking" || !open.redactedChunks) return;
	block.thinkingSignature = bytesToBase64(open.redactedChunks);
	open.redactedChunks = undefined;
}

/** Ends the stream state of blocks a stream settled without stopping. */
function flushOpenBlocks(openBlocks: OpenBlocks, output: AssistantMessage): void {
	for (const open of openBlocks.values()) flushRedactedContent(open, output);
	openBlocks.clear();
}

function handleMetadata(
	event: ConverseStreamMetadataEvent,
	model: Model<"bedrock-converse-stream">,
	output: AssistantMessage,
): void {
	if (event.usage) {
		output.usage.input = event.usage.inputTokens || 0;
		output.usage.output = event.usage.outputTokens || 0;
		output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
		output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
		output.usage.cacheWrite1h = event.usage.cacheDetails?.reduce(
			(total, detail) => total + (detail.ttl === CacheTTL.ONE_HOUR ? (detail.inputTokens ?? 0) : 0),
			0,
		);
		output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
		calculateCost(model, output.usage);
	}
}

function handleContentBlockStop(
	event: ContentBlockStopEvent,
	openBlocks: OpenBlocks,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const open = openBlocks.get(event.contentBlockIndex!);
	if (!open) return;
	openBlocks.delete(event.contentBlockIndex!);
	const index = open.contentIndex;
	const block = output.content[index]!;

	switch (block.type) {
		case "text":
			stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
			break;
		case "thinking":
			flushRedactedContent(open, output);
			stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
			break;
		case "toolCall":
			if (open.arguments !== undefined) Object.assign(block, open.arguments.finish());
			stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
			break;
	}
}

/**
 * Check if the model supports adaptive thinking (Opus 4.6+, Sonnet 4.6).
 * Checks both model ID and model name to support application inference profiles
 * whose ARNs don't contain the model name.
 */
function getModelMatchCandidates(modelId: string, modelName?: string): string[] {
	const values = modelName ? [modelId, modelName] : [modelId];
	return values.flatMap((value) => {
		const lower = value.toLowerCase();
		return [lower, lower.replace(/[\s_.:]+/g, "-")];
	});
}

function supportsAdaptiveThinking(modelId: string, modelName?: string): boolean {
	const candidates = getModelMatchCandidates(modelId, modelName);
	return candidates.some(
		(s) =>
			s.includes("opus-4-6") ||
			s.includes("opus-4-7") ||
			s.includes("opus-4-8") ||
			s.includes("opus-5") ||
			s.includes("sonnet-4-6") ||
			s.includes("sonnet-5") ||
			s.includes("haiku-5") ||
			s.includes("fable-5"),
	);
}

function supportsNativeXhighEffort(model: Model<"bedrock-converse-stream">): boolean {
	const candidates = getModelMatchCandidates(model.id, model.name);
	return candidates.some(
		(s) =>
			s.includes("opus-4-7") ||
			s.includes("opus-4-8") ||
			s.includes("opus-5") ||
			s.includes("sonnet-5") ||
			s.includes("haiku-5") ||
			s.includes("fable-5"),
	);
}

/**
 * Check if the model accepts `thinking.block_binding`. Opus 4.6 and Sonnet 4.6 reject it with
 * "thinking.adaptive.block_binding: Extra inputs are not permitted".
 */
function supportsThinkingBlockBinding(model: Model<"bedrock-converse-stream">): boolean {
	const candidates = getModelMatchCandidates(model.id, model.name);
	return candidates.some(
		(s) =>
			s.includes("opus-4-7") ||
			s.includes("opus-4-8") ||
			s.includes("opus-5") ||
			s.includes("sonnet-5") ||
			s.includes("haiku-5") ||
			s.includes("fable-5"),
	);
}

function mapThinkingLevelToEffort(
	model: Model<"bedrock-converse-stream">,
	level: SimpleStreamOptions["reasoning"],
): "low" | "medium" | "high" | "xhigh" | "max" {
	if (level === "xhigh" && supportsNativeXhighEffort(model)) return "xhigh";

	const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
	if (typeof mapped === "string") return mapped as "low" | "medium" | "high" | "xhigh" | "max";

	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		default:
			return "high";
	}
}

/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention?: CacheRetention, env?: ProviderEnv): CacheRetention {
	if (cacheRetention) {
		return cacheRetention;
	}
	if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
		return "long";
	}
	return "short";
}

/**
 * Check if the model is an Anthropic Claude model on Bedrock.
 * Checks both model ID and model name to support application inference profiles
 * whose ARNs don't contain the model name.
 */
function isAnthropicClaudeModel(model: Model<"bedrock-converse-stream">): boolean {
	const id = model.id.toLowerCase();
	const name = model.name?.toLowerCase() ?? "";
	return (
		id.includes("anthropic.claude") ||
		id.includes("anthropic/claude") ||
		name.includes("anthropic.claude") ||
		name.includes("anthropic/claude") ||
		name.includes("claude")
	);
}

/**
 * Check if the model supports prompt caching.
 * Supported: Claude 3.5 Haiku, Claude 3.7 Sonnet, Claude 4.x models, Claude 5 models
 *
 * For base models and system-defined inference profiles the model ID / ARN
 * contains the model name, so we can decide locally.
 *
 * For application inference profiles (whose ARNs don't contain the model name),
 * also checks model.name which is user-controlled via models.json or registerProvider.
 * As a last resort, set AWS_BEDROCK_FORCE_CACHE=1 to enable cache points.
 * Amazon Nova models have automatic caching and don't need explicit cache points.
 */
function supportsPromptCaching(model: Model<"bedrock-converse-stream">, env?: ProviderEnv): boolean {
	const candidates = getModelMatchCandidates(model.id, model.name);

	const hasClaudeRef = candidates.some((s) => s.includes("claude"));
	if (!hasClaudeRef) {
		// Application inference profiles don't contain the model name in the ARN.
		// Allow users to force cache points via environment variable.
		if (getProviderEnvValue("AWS_BEDROCK_FORCE_CACHE", env) === "1") return true;
		return false;
	}
	// Claude 5 models (fable-5, opus-5, sonnet-5, haiku-5)
	if (
		candidates.some(
			(s) => s.includes("fable-5") || s.includes("opus-5") || s.includes("sonnet-5") || s.includes("haiku-5"),
		)
	)
		return true;
	// Claude 4.x models (opus-4, sonnet-4, haiku-4)
	if (candidates.some((s) => s.includes("-4-"))) return true;
	// Claude 3.7 Sonnet
	if (candidates.some((s) => s.includes("claude-3-7-sonnet"))) return true;
	// Claude 3.5 Haiku
	if (candidates.some((s) => s.includes("claude-3-5-haiku"))) return true;
	return false;
}

/**
 * Check if the model supports thinking signatures in reasoningContent.
 * Only Anthropic Claude models support the signature field.
 * Other models (OpenAI, Qwen, Minimax, Moonshot, etc.) reject it with:
 * "This model doesn't support the reasoningContent.reasoningText.signature field"
 *
 * Checks both model ID and model name to support application inference profiles.
 */
function supportsThinkingSignature(model: Model<"bedrock-converse-stream">): boolean {
	return isAnthropicClaudeModel(model);
}

function buildSystemPrompt(
	systemPrompt: string | undefined,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
	env?: ProviderEnv,
): SystemContentBlock[] | undefined {
	if (!systemPrompt) return undefined;

	const blocks: SystemContentBlock[] = [{ text: sanitizeSurrogates(systemPrompt) }];

	// Add cache point for supported Claude models when caching is enabled
	if (cacheRetention !== "none" && supportsPromptCaching(model, env)) {
		blocks.push({
			cachePoint: { type: CachePointType.DEFAULT, ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}) },
		});
	}

	return blocks;
}

function normalizeToolCallId(id: string): string {
	const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
}

function createNonBlankTextBlock(text: string): { text: string } | undefined {
	const sanitized = sanitizeSurrogates(text);
	return sanitized.trim().length === 0 ? undefined : { text: sanitized };
}

function createRequiredTextBlock(text: string): { text: string } {
	return createNonBlankTextBlock(text) ?? { text: EMPTY_TEXT_PLACEHOLDER };
}

function sanitizeBedrockDocument(value: JsonValue): DocumentType {
	if (Array.isArray(value)) {
		return value.map(sanitizeBedrockDocument);
	}
	if (value !== null && typeof value === "object") {
		const record = value as JsonObject;
		const sanitized: { [key: string]: DocumentType } = {};
		for (const key of Object.keys(record)) {
			if (key.length > 0) {
				sanitized[key] = sanitizeBedrockDocument(record[key]);
			}
		}
		return sanitized;
	}
	return value;
}

function convertToolResultContent(content: (TextContent | ImageContent)[]): ToolResultContentBlock[] {
	const result: ToolResultContentBlock[] = [];
	for (const c of content) {
		if (c.type === "image") {
			result.push({ image: createImageBlock(c.mimeType, c.data) });
		} else {
			const textBlock = createNonBlankTextBlock(c.text);
			if (textBlock) result.push(textBlock);
		}
	}
	if (result.length === 0) result.push({ text: EMPTY_TEXT_PLACEHOLDER });
	return result;
}

function convertMessages(
	context: TranscriptContext,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
	env?: ProviderEnv,
): Message[] {
	const result: Message[] = [];
	const transformedMessages = transformMessages(
		withoutInitialSystemMessage(context.messages),
		model,
		normalizeToolCallId,
	);

	for (let i = 0; i < transformedMessages.length; i++) {
		const m = transformedMessages[i];

		switch (m.role) {
			case "user": {
				const content: ContentBlock[] = [];
				if (typeof m.content === "string") {
					content.push(createRequiredTextBlock(m.content));
				} else {
					for (const c of m.content) {
						switch (c.type) {
							case "text": {
								const textBlock = createNonBlankTextBlock(c.text);
								if (textBlock) content.push(textBlock);
								break;
							}
							case "image":
								content.push({ image: createImageBlock(c.mimeType, c.data) });
								break;
							default:
								continue;
						}
					}
					if (content.length === 0) content.push({ text: EMPTY_TEXT_PLACEHOLDER });
				}
				result.push({ role: ConversationRole.USER, content });
				break;
			}
			case "assistant": {
				// Skip assistant messages with empty content (e.g., from aborted requests)
				// Bedrock rejects messages with empty content arrays
				if (m.content.length === 0) {
					continue;
				}
				const contentBlocks: ContentBlock[] = [];
				for (const c of m.content) {
					switch (c.type) {
						case "text": {
							// Skip empty text blocks
							const textBlock = createNonBlankTextBlock(c.text);
							if (!textBlock) continue;
							contentBlocks.push(textBlock);
							break;
						}
						case "toolCall":
							contentBlocks.push({
								toolUse: { toolUseId: c.id, name: c.name, input: sanitizeBedrockDocument(c.arguments) },
							});
							break;
						case "thinking": {
							// Encrypted reasoning is opaque: replay the stored payload as the
							// `redactedContent` member instead of lowering it to reasoning text.
							if (c.redacted) {
								const redactedContent = decodeRedactedContent(c.thinkingSignature);
								if (redactedContent?.length) {
									contentBlocks.push({ reasoningContent: { redactedContent } });
								}
								continue;
							}
							// Skip empty thinking blocks
							const thinking = sanitizeSurrogates(c.thinking);
							if (thinking.trim().length === 0) continue;
							// Only Anthropic models support the signature field in reasoningText.
							// For other models, we omit the signature to avoid errors like:
							// "This model doesn't support the reasoningContent.reasoningText.signature field"
							if (supportsThinkingSignature(model)) {
								// Signatures arrive after thinking deltas. If a partial or externally
								// persisted message lacks a signature, Bedrock rejects the replayed
								// reasoning block. Fall back to plain text, matching Anthropic.
								if (!c.thinkingSignature || c.thinkingSignature.trim().length === 0) {
									contentBlocks.push({ text: thinking });
								} else {
									contentBlocks.push({
										reasoningContent: {
											reasoningText: {
												text: thinking,
												signature: c.thinkingSignature,
											},
										},
									});
								}
							} else {
								contentBlocks.push({
									reasoningContent: {
										reasoningText: { text: thinking },
									},
								});
							}
							break;
						}
						default:
							continue;
					}
				}
				// Skip if all content blocks were filtered out
				if (contentBlocks.length === 0) {
					continue;
				}
				result.push({
					role: ConversationRole.ASSISTANT,
					content: contentBlocks,
				});
				break;
			}
			case "toolResult": {
				// Collect all consecutive toolResult messages into a single user message
				// Bedrock requires all tool results to be in one message
				const toolResults: ContentBlock[] = [];
				// Claude rejects error tool results that contain anything but text, so for Claude their
				// images follow all tool results of the turn (#10794). Other models keep them in place.
				const errorImages: ContentBlock[] = [];
				let j = i;
				while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
					const toolMsg = transformedMessages[j] as ToolResultMessage;
					const split = isAnthropicClaudeModel(model) ? splitErrorToolResultImages(toolMsg) : undefined;
					toolResults.push({
						toolResult: {
							toolUseId: toolMsg.toolCallId,
							content: split
								? convertToolResultContent(split.content.map((block): TextContent | ImageContent => block))
								: convertToolResultContent(toolMsg.content),
							status: toolMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
						},
					});
					if (split) {
						errorImages.push(
							{ text: split.caption },
							...split.images.map((image) => ({ image: createImageBlock(image.mimeType, image.data) })),
						);
					}
					j++;
				}

				// Skip the messages we've already processed
				i = j - 1;

				result.push({ role: ConversationRole.USER, content: [...toolResults, ...errorImages] });
				break;
			}
			default:
				continue;
		}
	}

	// Add cache point to the last user message for supported Claude models when caching is enabled
	if (cacheRetention !== "none" && supportsPromptCaching(model, env) && result.length > 0) {
		const lastMessage = result[result.length - 1];
		if (lastMessage.role === ConversationRole.USER && lastMessage.content) {
			(lastMessage.content as ContentBlock[]).push({
				cachePoint: {
					type: CachePointType.DEFAULT,
					...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
				},
			});
		}
	}

	return result;
}

function convertToolConfig(
	tools: Tool[] | undefined,
	toolChoice: BedrockOptions["toolChoice"],
	supportsStrictMode: boolean,
	disablePreferredStrictTools: boolean,
): { toolConfig: ToolConfiguration | undefined; hasPreferredStrictTools: boolean } {
	if (!tools?.length || toolChoice === "none") return { toolConfig: undefined, hasPreferredStrictTools: false };

	let hasPreferredStrictTools = false;
	const bedrockTools: BedrockTool[] = tools.map((tool) => {
		const preferred = prefersJsonSchemaStrictSampling(tool);
		const strict =
			disablePreferredStrictTools && preferred
				? undefined
				: resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
		if (strict === true && preferred) hasPreferredStrictTools = true;
		return {
			toolSpec: {
				name: tool.name,
				description: tool.description,
				inputSchema: { json: getJsonSchemaToolParameters(tool, strict) as unknown as DocumentType },
				...(strict === true ? { strict: true } : {}),
			},
		};
	});

	let bedrockToolChoice: ToolChoice | undefined;
	switch (toolChoice) {
		case "auto":
			bedrockToolChoice = { auto: {} };
			break;
		case "any":
			bedrockToolChoice = { any: {} };
			break;
		default:
			if (toolChoice?.type === "tool") {
				bedrockToolChoice = { tool: { name: toolChoice.name } };
			}
	}

	return { toolConfig: { tools: bedrockTools, toolChoice: bedrockToolChoice }, hasPreferredStrictTools };
}

function mapStopReason(reason: string | undefined): { stopReason: StopReason; errorMessage?: string } {
	switch (reason) {
		case BedrockStopReason.END_TURN:
		case BedrockStopReason.STOP_SEQUENCE:
			return { stopReason: "stop" };
		case BedrockStopReason.MAX_TOKENS:
		case BedrockStopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
			return { stopReason: "length" };
		case BedrockStopReason.TOOL_USE:
			return { stopReason: "toolUse" };
		default:
			return reason
				? { stopReason: "error", errorMessage: `Provider stopped with: ${reason}` }
				: { stopReason: "error" };
	}
}

function getConfiguredBedrockRegion(options: BedrockOptions): string | undefined {
	return (
		options.region ||
		getProviderEnvValue("AWS_REGION", options.env) ||
		getProviderEnvValue("AWS_DEFAULT_REGION", options.env) ||
		undefined
	);
}

function getConfiguredBedrockCredentials(env?: ProviderEnv): BedrockCredentials | undefined {
	const accessKeyId = getProviderEnvValue("AWS_ACCESS_KEY_ID", env);
	const secretAccessKey = getProviderEnvValue("AWS_SECRET_ACCESS_KEY", env);
	if (!accessKeyId || !secretAccessKey) {
		return undefined;
	}
	const sessionToken = getProviderEnvValue("AWS_SESSION_TOKEN", env);
	return {
		accessKeyId,
		secretAccessKey,
		...(sessionToken ? { sessionToken } : {}),
	};
}

function getStandardBedrockEndpointRegion(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) {
		return undefined;
	}

	try {
		const { hostname } = new URL(baseUrl);
		const match = hostname.toLowerCase().match(/^bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/);
		return match?.[1];
	} catch {
		return undefined;
	}
}

function shouldUseExplicitBedrockEndpoint(
	baseUrl: string,
	configuredRegion: string | undefined,
	hasAmbientConfiguredProfile: boolean,
): boolean {
	const endpointRegion = getStandardBedrockEndpointRegion(baseUrl);
	if (!endpointRegion) {
		return true;
	}

	return !configuredRegion && !hasAmbientConfiguredProfile;
}

function isGovCloudBedrockTarget(model: Model<"bedrock-converse-stream">, options: BedrockOptions): boolean {
	const region = getConfiguredBedrockRegion(options);
	if (region?.toLowerCase().startsWith("us-gov-")) {
		return true;
	}

	const modelId = model.id.toLowerCase();
	return modelId.startsWith("us-gov.") || modelId.startsWith("arn:aws-us-gov:");
}

function buildAdditionalModelRequestFields(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): Record<string, any> | undefined {
	if (!options.reasoning || !model.reasoning) {
		return undefined;
	}

	if (isAnthropicClaudeModel(model)) {
		// GovCloud Bedrock currently rejects the Claude thinking.display field.
		// Omit it there until the GovCloud Converse schema catches up.
		const isGovCloud = isGovCloudBedrockTarget(model, options);
		const display = isGovCloud ? undefined : (options.thinkingDisplay ?? "summarized");
		// Replayed signed thinking blocks are bound to the system prompt and tools they were
		// created with. Bedrock 400s on replay after either changes unless stale blocks are
		// dropped, matching the Anthropic provider. Skipped on GovCloud like display.
		const useBlockBinding = !isGovCloud && supportsThinkingBlockBinding(model);
		const result: Record<string, any> = supportsAdaptiveThinking(model.id, model.name)
			? {
					thinking: {
						type: "adaptive",
						...(display !== undefined ? { display } : {}),
						...(useBlockBinding ? { block_binding: { prefix_mismatch_behavior: "drop_block" } } : {}),
					},
					output_config: { effort: mapThinkingLevelToEffort(model, options.reasoning) },
					...(useBlockBinding ? { anthropic_beta: [THINKING_BINDING_CONTROLS_BETA] } : {}),
				}
			: (() => {
					const defaultBudgets: Record<ThinkingLevel, number> = {
						minimal: 1024,
						low: 2048,
						medium: 8192,
						high: 16384,
						xhigh: 16384, // Budget-based Claude clamps extended levels to high
						max: 16384,
					};

					// Custom budgets only cover token-based levels through high.
					const level = options.reasoning === "xhigh" || options.reasoning === "max" ? "high" : options.reasoning;
					const budget = options.thinkingBudgets?.[level] ?? defaultBudgets[options.reasoning];

					return {
						thinking: {
							type: "enabled",
							budget_tokens: budget,
							...(display !== undefined ? { display } : {}),
						},
					};
				})();

		if (!supportsAdaptiveThinking(model.id, model.name) && (options.interleavedThinking ?? true)) {
			result.anthropic_beta = ["interleaved-thinking-2025-05-14"];
		}

		return result;
	}

	const candidates = getModelMatchCandidates(model.id, model.name);

	if (candidates.some((s) => s.includes("gpt-oss"))) {
		return { reasoning_effort: OPENAI_GPT_OSS_EFFORT[options.reasoning] };
	}

	if (candidates.some((s) => s.includes("gpt-"))) {
		const mapped = model.thinkingLevelMap?.[options.reasoning];
		return {
			reasoning: { effort: typeof mapped === "string" ? mapped : OPENAI_GPT_EFFORT[options.reasoning] },
		};
	}

	return undefined;
}

type OpenAIGptEffort = "low" | "medium" | "high" | "xhigh" | "max";
type OpenAIGptOssEffort = "low" | "medium" | "high";

/** OpenAI GPT models (GPT-5.x, GPT-6) take a nested `reasoning.effort` and reject `minimal`. */
const OPENAI_GPT_EFFORT: Record<ThinkingLevel, OpenAIGptEffort> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

/** gpt-oss takes a flat `reasoning_effort` and only accepts low, medium and high. */
const OPENAI_GPT_OSS_EFFORT: Record<ThinkingLevel, OpenAIGptOssEffort> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "high",
	max: "high",
};

function createImageBlock(mimeType: string, data: string) {
	let format: ImageFormat;
	switch (mimeType) {
		case "image/jpeg":
		case "image/jpg":
			format = ImageFormat.JPEG;
			break;
		case "image/png":
			format = ImageFormat.PNG;
			break;
		case "image/gif":
			format = ImageFormat.GIF;
			break;
		case "image/webp":
			format = ImageFormat.WEBP;
			break;
		default:
			throw new Error(`Unknown image type: ${mimeType}`);
	}

	return { source: { bytes: base64ToBytes(data) }, format };
}

function base64ToBytes(data: string): Uint8Array {
	const binaryString = atob(data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

/**
 * Decodes a stored redacted payload. The AWS SDK hands the blob over as bytes, but a
 * persisted session carries it as base64. A hand-edited or externally produced session
 * can hold a signature that is not base64; drop that block instead of failing the
 * whole request.
 */
function decodeRedactedContent(signature: string | undefined): Uint8Array | undefined {
	if (!signature) return undefined;
	try {
		return base64ToBytes(signature);
	} catch {
		return undefined;
	}
}

function bytesToBase64(chunks: Uint8Array[]): string {
	// Encrypted reasoning runs to tens of KB, so build the binary string in slices
	// rather than one concatenation per byte. The window stays under the engine's
	// argument-count limit for spread calls.
	const WINDOW = 0x8000;
	let binary = "";
	for (const chunk of chunks) {
		for (let i = 0; i < chunk.length; i += WINDOW) {
			binary += String.fromCharCode(...chunk.subarray(i, i + WINDOW));
		}
	}
	return btoa(binary);
}
