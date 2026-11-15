import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import * as tls from "node:tls";
import type { JsonValue, ProviderEnv, ProviderHeaders } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import type { ClientIdentity } from "../utils/identity.ts";

// ============================================================================
// Bedrock wire enums & types (erasableSyntaxOnly: `as const`, zero `enum`)
// ============================================================================

export const BedrockStopReason = {
	END_TURN: "end_turn",
	STOP_SEQUENCE: "stop_sequence",
	MAX_TOKENS: "max_tokens",
	MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
	TOOL_USE: "tool_use",
	CONTENT_FILTERED: "content_filtered",
	GUARDRAIL_INTERVENED: "guardrail_intervened",
} as const;
export type BedrockStopReason = (typeof BedrockStopReason)[keyof typeof BedrockStopReason];

export const CachePointType = {
	DEFAULT: "default",
} as const;
export type CachePointType = (typeof CachePointType)[keyof typeof CachePointType];

export const CacheTTL = {
	FIVE_MINUTES: "5m",
	ONE_HOUR: "1h",
} as const;
export type CacheTTL = (typeof CacheTTL)[keyof typeof CacheTTL];

export const ConversationRole = {
	USER: "user",
	ASSISTANT: "assistant",
} as const;
export type ConversationRole = (typeof ConversationRole)[keyof typeof ConversationRole];

export const ImageFormat = {
	PNG: "png",
	JPEG: "jpeg",
	GIF: "gif",
	WEBP: "webp",
} as const;
export type ImageFormat = (typeof ImageFormat)[keyof typeof ImageFormat];

export const ToolResultStatus = {
	SUCCESS: "success",
	ERROR: "error",
} as const;
export type ToolResultStatus = (typeof ToolResultStatus)[keyof typeof ToolResultStatus];

export type DocumentType = JsonValue | Uint8Array | Record<string, unknown> | unknown[];

export interface BedrockCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

export interface CachePointBlock {
	type: CachePointType | string;
	ttl?: CacheTTL | string;
}

export interface ImageBlock {
	format: ImageFormat | string;
	source: {
		bytes: Uint8Array;
	};
}

export interface ToolUseBlock {
	toolUseId: string;
	name: string;
	input: DocumentType;
}

export type ToolResultContentBlock = { text: string } | { image: ImageBlock } | { json: DocumentType };

export interface ToolResultBlock {
	toolUseId: string;
	content: ToolResultContentBlock[];
	status?: ToolResultStatus | string;
}

export interface ReasoningTextBlock {
	text: string;
	signature?: string;
}

export type ReasoningContentBlock = { reasoningText: ReasoningTextBlock } | { redactedContent: Uint8Array };

export type ContentBlock =
	| { text: string }
	| { image: ImageBlock }
	| { toolUse: ToolUseBlock }
	| { toolResult: ToolResultBlock }
	| { reasoningContent: ReasoningContentBlock }
	| { cachePoint: CachePointBlock };

export type SystemContentBlock = { text: string } | { cachePoint: CachePointBlock };

export interface BedrockMessage {
	role: ConversationRole | string;
	content: ContentBlock[];
}

export interface BedrockTool {
	toolSpec?: {
		name: string;
		description?: string;
		inputSchema: {
			json: DocumentType;
		};
		strict?: boolean;
	};
	cachePoint?: CachePointBlock;
}

export type ToolChoice = { auto: Record<string, never> } | { any: Record<string, never> } | { tool: { name: string } };

export interface ToolConfiguration {
	tools: BedrockTool[];
	toolChoice?: ToolChoice;
}

export interface ConverseStreamCommandInput {
	modelId: string;
	messages?: BedrockMessage[];
	system?: SystemContentBlock[];
	inferenceConfig?: {
		maxTokens?: number;
		temperature?: number;
		topP?: number;
		stopSequences?: string[];
	};
	toolConfig?: ToolConfiguration;
	additionalModelRequestFields?: Record<string, unknown>;
	requestMetadata?: Record<string, string>;
}

export interface ContentBlockStartEvent {
	contentBlockIndex?: number;
	start?: {
		toolUse?: {
			toolUseId?: string;
			name?: string;
		};
	};
}

export interface ContentBlockDeltaEvent {
	contentBlockIndex?: number;
	delta?: {
		text?: string;
		toolUse?: {
			input?: string;
		};
		reasoningContent?: {
			text?: string;
			signature?: string;
			redactedContent?: Uint8Array;
		};
	};
}

export interface ContentBlockStopEvent {
	contentBlockIndex?: number;
}

export interface ConverseStreamMetadataEvent {
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
		cacheReadInputTokens?: number;
		cacheWriteInputTokens?: number;
		cacheDetails?: Array<{
			ttl?: string;
			inputTokens?: number;
		}>;
	};
	metrics?: {
		latencyMs?: number;
	};
}

export interface ConverseStreamOutputEvent {
	messageStart?: { role?: string };
	contentBlockStart?: ContentBlockStartEvent;
	contentBlockDelta?: ContentBlockDeltaEvent;
	contentBlockStop?: ContentBlockStopEvent;
	messageStop?: { stopReason?: string };
	metadata?: ConverseStreamMetadataEvent;
	internalServerException?: BedrockRuntimeServiceException;
	modelStreamErrorException?: BedrockRuntimeServiceException;
	validationException?: BedrockRuntimeServiceException;
	throttlingException?: BedrockRuntimeServiceException;
	serviceUnavailableException?: BedrockRuntimeServiceException;
}

export interface ConverseStreamCommandOutput {
	$metadata: {
		httpStatusCode?: number;
		requestId?: string;
	};
	stream: AsyncIterable<ConverseStreamOutputEvent>;
}

// ============================================================================
// Service Exception
// ============================================================================

export interface BedrockServiceExceptionOptions {
	name: string;
	message?: string;
	$fault?: "client" | "server";
	$metadata?: {
		httpStatusCode?: number;
		requestId?: string;
		extendedRequestId?: string;
		cfId?: string;
		attempts?: number;
		totalRetryDelay?: number;
	};
	$response?: {
		statusCode?: number;
		body?: unknown;
		headers?: Record<string, string>;
	};
}

export class BedrockRuntimeServiceException extends Error {
	readonly $fault: "client" | "server";
	readonly $metadata: {
		httpStatusCode?: number;
		requestId?: string;
		extendedRequestId?: string;
		cfId?: string;
		attempts?: number;
		totalRetryDelay?: number;
	};
	readonly $response?: {
		statusCode?: number;
		body?: unknown;
		headers?: Record<string, string>;
	};

	constructor(options: BedrockServiceExceptionOptions) {
		super(options.message ?? options.name);
		this.name = options.name;
		this.$fault = options.$fault ?? "client";
		this.$metadata = options.$metadata ?? {};
		this.$response = options.$response;
	}
}

// ============================================================================
// INI Credentials & Region Resolution (Node runtime)
// ============================================================================

type IniSections = Map<string, Map<string, string>>;

function parseIniFile(path: string): IniSections | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const content = readFileSync(path, "utf8");
		const sections: IniSections = new Map();
		let current: Map<string, string> | undefined;
		for (const rawLine of content.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#") || line.startsWith(";")) continue;
			if (line.startsWith("[") && line.endsWith("]")) {
				const sectionName = line.slice(1, -1).trim();
				current = sections.get(sectionName) ?? new Map<string, string>();
				sections.set(sectionName, current);
				continue;
			}
			const eqIdx = line.indexOf("=");
			if (eqIdx === -1 || !current) continue;
			const key = line.slice(0, eqIdx).trim();
			const value = line.slice(eqIdx + 1).trim();
			current.set(key, value);
		}
		return sections;
	} catch {
		return undefined;
	}
}

function getIniProfileSection(
	sections: IniSections | undefined,
	profileName: string,
	preferProfilePrefix: boolean,
): Map<string, string> | undefined {
	if (!sections) return undefined;
	if (profileName === "default") {
		return sections.get("default") ?? sections.get("profile default");
	}
	return preferProfilePrefix
		? (sections.get(`profile ${profileName}`) ?? sections.get(profileName))
		: (sections.get(profileName) ?? sections.get(`profile ${profileName}`));
}

function readAwsProfileConfig(
	profileName: string,
	env?: ProviderEnv,
): { credentials?: BedrockCredentials; region?: string } {
	if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) {
		return {};
	}
	const home = homedir();
	const credsFile = getProviderEnvValue("AWS_SHARED_CREDENTIALS_FILE", env) || join(home, ".aws", "credentials");
	const configFile = getProviderEnvValue("AWS_CONFIG_FILE", env) || join(home, ".aws", "config");

	const credsSections = parseIniFile(credsFile);
	const configSections = parseIniFile(configFile);
	const credsProfile = getIniProfileSection(credsSections, profileName, false);
	const configProfile = getIniProfileSection(configSections, profileName, true);

	const accessKeyId = credsProfile?.get("aws_access_key_id") ?? configProfile?.get("aws_access_key_id");
	const secretAccessKey = credsProfile?.get("aws_secret_access_key") ?? configProfile?.get("aws_secret_access_key");
	const sessionToken = credsProfile?.get("aws_session_token") ?? configProfile?.get("aws_session_token");
	const region = configProfile?.get("region") ?? credsProfile?.get("region");

	return {
		credentials:
			accessKeyId && secretAccessKey
				? {
						accessKeyId,
						secretAccessKey,
						...(sessionToken ? { sessionToken } : {}),
					}
				: undefined,
		region,
	};
}

export function resolveBedrockProfileRegion(profileName: string | undefined, env?: ProviderEnv): string | undefined {
	if (!profileName) return undefined;
	return readAwsProfileConfig(profileName, env).region;
}

export function resolveBedrockCredentials(params: {
	optionsProfile?: string;
	ambientProfile?: string;
	envCredentials?: BedrockCredentials;
	skipAuth: boolean;
	env?: ProviderEnv;
}): BedrockCredentials {
	if (params.skipAuth) {
		return {
			accessKeyId: "dummy-access-key",
			secretAccessKey: "dummy-secret-key",
		};
	}

	if (params.optionsProfile) {
		const fromProfile = readAwsProfileConfig(params.optionsProfile, params.env).credentials;
		if (fromProfile) return fromProfile;
		throw new Error(`Could not load AWS credentials for profile "${params.optionsProfile}"`);
	}

	if (params.envCredentials) {
		return params.envCredentials;
	}

	const profileName = params.ambientProfile || "default";
	const fromIni = readAwsProfileConfig(profileName, params.env).credentials;
	if (fromIni) return fromIni;

	throw new Error(
		"Could not load AWS credentials for Amazon Bedrock. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, AWS_BEARER_TOKEN_BEDROCK, or configure AWS_PROFILE.",
	);
}

// ============================================================================
// AWS SigV4 Request Signing (node:crypto)
// ============================================================================

function sha256Hex(data: Uint8Array | string): string {
	return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
	return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeRfc3986(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalizePath(pathname: string): string {
	const segments: string[] = [];
	for (const seg of pathname.split("/")) {
		if (!seg || seg === ".") continue;
		if (seg === "..") {
			segments.pop();
		} else {
			segments.push(seg);
		}
	}
	const leading = pathname.startsWith("/") ? "/" : "";
	const trailing = segments.length > 0 && pathname.endsWith("/") ? "/" : "";
	const normalized = `${leading}${segments.join("/")}${trailing}`;
	return encodeRfc3986(normalized).replace(/%2F/g, "/");
}

function canonicalizeQuery(searchParams: URLSearchParams): string {
	const pairs: Array<[string, string]> = [];
	for (const [k, v] of searchParams.entries()) {
		pairs.push([encodeRfc3986(k), encodeRfc3986(v)]);
	}
	pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
	return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function formatAmzDate(now: Date): { longDate: string; shortDate: string } {
	const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
	return {
		longDate: iso,
		shortDate: iso.slice(0, 8),
	};
}

const ALWAYS_UNSIGNABLE_HEADERS = new Set([
	"authorization",
	"cache-control",
	"connection",
	"expect",
	"from",
	"keep-alive",
	"max-forwards",
	"pragma",
	"referer",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"user-agent",
	"x-amzn-trace-id",
]);

function isUnsignableHeader(lowerName: string): boolean {
	return ALWAYS_UNSIGNABLE_HEADERS.has(lowerName) || lowerName.startsWith("proxy-") || lowerName.startsWith("sec-");
}

function normalizeHeaderValue(value: string): string {
	return value
		.replace(/[\r\n]/g, " ")
		.replace(/[ \t]+/g, " ")
		.trim();
}

export function signAwsSigV4(params: {
	method: string;
	url: URL;
	headers: Record<string, string>;
	body: Uint8Array;
	region: string;
	service: string;
	credentials: BedrockCredentials;
	now?: Date;
}): Record<string, string> {
	const { longDate, shortDate } = formatAmzDate(params.now ?? new Date());
	const payloadHash = sha256Hex(params.body);

	const outgoingHeaders = new Map<string, { originalKey: string; value: string }>();
	const signedHeaders = new Map<string, string>();
	for (const key of Object.keys(params.headers)) {
		const lower = key.toLowerCase();
		const normalizedValue = normalizeHeaderValue(params.headers[key]);
		if (lower !== "host" && lower !== "authorization") {
			outgoingHeaders.set(lower, { originalKey: key, value: normalizedValue });
		}
		if (!isUnsignableHeader(lower)) {
			signedHeaders.set(lower, normalizedValue);
		}
	}

	signedHeaders.set("host", params.url.host);
	signedHeaders.set("x-amz-date", longDate);
	signedHeaders.set("x-amz-content-sha256", payloadHash);
	outgoingHeaders.set("x-amz-date", { originalKey: "x-amz-date", value: longDate });
	outgoingHeaders.set("x-amz-content-sha256", { originalKey: "x-amz-content-sha256", value: payloadHash });
	if (params.credentials.sessionToken) {
		signedHeaders.set("x-amz-security-token", params.credentials.sessionToken);
		outgoingHeaders.set("x-amz-security-token", {
			originalKey: "x-amz-security-token",
			value: params.credentials.sessionToken,
		});
	} else {
		signedHeaders.delete("x-amz-security-token");
		outgoingHeaders.delete("x-amz-security-token");
	}

	const signedHeaderKeys = Array.from(signedHeaders.keys()).sort();
	const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${signedHeaders.get(k)!}\n`).join("");
	const signedHeadersList = signedHeaderKeys.join(";");

	const canonicalRequest = [
		params.method.toUpperCase(),
		canonicalizePath(params.url.pathname),
		canonicalizeQuery(params.url.searchParams),
		canonicalHeaders,
		signedHeadersList,
		payloadHash,
	].join("\n");

	const credentialScope = `${shortDate}/${params.region}/${params.service}/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		longDate,
		credentialScope,
		sha256Hex(canonicalRequest),
	].join("\n");

	const kDate = hmac(`AWS4${params.credentials.secretAccessKey}`, shortDate);
	const kRegion = hmac(kDate, params.region);
	const kService = hmac(kRegion, params.service);
	const kSigning = hmac(kService, "aws4_request");
	const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

	const result: Record<string, string> = {};
	for (const entry of outgoingHeaders.values()) {
		result[entry.originalKey] = entry.value;
	}
	result.authorization = `AWS4-HMAC-SHA256 Credential=${params.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
	return result;
}

// ============================================================================
// Amazon EventStream Binary Protocol Decoder (`application/vnd.amazon.eventstream`)
// ============================================================================

const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) {
			c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

type EventStreamHeaderValue = string | number | boolean | Uint8Array;

type Utf8Decoder = InstanceType<typeof TextDecoder>;

function decodeEventStreamHeaders(bytes: Uint8Array, decoder: Utf8Decoder): Map<string, EventStreamHeaderValue> {
	const headers = new Map<string, EventStreamHeaderValue>();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 0;
	while (offset < bytes.byteLength) {
		const nameLength = view.getUint8(offset);
		offset += 1;
		const name = decoder.decode(bytes.subarray(offset, offset + nameLength));
		offset += nameLength;
		const valueType = view.getUint8(offset);
		offset += 1;

		switch (valueType) {
			case 0:
				headers.set(name, true);
				break;
			case 1:
				headers.set(name, false);
				break;
			case 2:
				headers.set(name, view.getInt8(offset));
				offset += 1;
				break;
			case 3:
				headers.set(name, view.getInt16(offset, false));
				offset += 2;
				break;
			case 4:
				headers.set(name, view.getInt32(offset, false));
				offset += 4;
				break;
			case 5: {
				const hi = view.getInt32(offset, false);
				const lo = view.getUint32(offset + 4, false);
				headers.set(name, hi * 0x100000000 + lo);
				offset += 8;
				break;
			}
			case 6: {
				const len = view.getUint16(offset, false);
				offset += 2;
				headers.set(name, bytes.slice(offset, offset + len));
				offset += len;
				break;
			}
			case 7: {
				const len = view.getUint16(offset, false);
				offset += 2;
				headers.set(name, decoder.decode(bytes.subarray(offset, offset + len)));
				offset += len;
				break;
			}
			case 8: {
				const hi = view.getInt32(offset, false);
				const lo = view.getUint32(offset + 4, false);
				headers.set(name, hi * 0x100000000 + lo);
				offset += 8;
				break;
			}
			case 9:
				headers.set(name, bytes.slice(offset, offset + 16));
				offset += 16;
				break;
			default:
				throw new Error(`Unsupported AWS EventStream header value type: ${valueType}`);
		}
	}
	return headers;
}

function base64ToUint8Array(base64: string): Uint8Array {
	const bin = atob(base64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		out[i] = bin.charCodeAt(i);
	}
	return out;
}

function normalizeCamelCase(name: string): string {
	return name.length > 0 ? name[0].toLowerCase() + name.slice(1) : name;
}

function normalizePascalCase(name: string): string {
	return name.length > 0 ? name[0].toUpperCase() + name.slice(1) : name;
}

function mapEventFrameToConverseStreamEvent(
	headers: Map<string, EventStreamHeaderValue>,
	payloadBytes: Uint8Array,
	decoder: Utf8Decoder,
	requestId: string | undefined,
): ConverseStreamOutputEvent | undefined {
	const messageType = headers.get(":message-type");
	const payloadText = payloadBytes.byteLength > 0 ? decoder.decode(payloadBytes).trim() : "";
	let parsedPayload: Record<string, unknown> = {};
	if (payloadText.length > 0) {
		try {
			const parsed = JSON.parse(payloadText) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				parsedPayload = parsed as Record<string, unknown>;
			}
		} catch {
			parsedPayload = { message: payloadText };
		}
	}

	if (messageType === "event") {
		const rawEventType = headers.get(":event-type");
		if (typeof rawEventType !== "string") return undefined;
		if (rawEventType === "contentBlockDelta") {
			const delta = parsedPayload.delta as Record<string, unknown> | undefined;
			const reasoningContent = delta?.reasoningContent as Record<string, unknown> | undefined;
			if (reasoningContent && typeof reasoningContent.redactedContent === "string") {
				reasoningContent.redactedContent = base64ToUint8Array(reasoningContent.redactedContent);
			}
		}
		return { [rawEventType]: parsedPayload } as ConverseStreamOutputEvent;
	}

	if (messageType === "exception" || messageType === "error") {
		const rawCode = headers.get(":exception-type") ?? headers.get(":error-code");
		const codeStr = typeof rawCode === "string" && rawCode.length > 0 ? rawCode : "InternalServerException";
		const exceptionName = normalizePascalCase(codeStr);
		const msgHeader = headers.get(":error-message");
		const message =
			typeof parsedPayload.message === "string"
				? parsedPayload.message
				: typeof parsedPayload.Message === "string"
					? parsedPayload.Message
					: typeof msgHeader === "string"
						? msgHeader
						: payloadText || exceptionName;

		const fault =
			exceptionName === "ValidationException" || exceptionName === "AccessDeniedException" ? "client" : "server";
		const ex = new BedrockRuntimeServiceException({
			name: exceptionName,
			message,
			$fault: fault,
			$metadata: requestId ? { requestId } : {},
		});

		const fieldName = normalizeCamelCase(exceptionName);
		switch (fieldName) {
			case "internalServerException":
			case "modelStreamErrorException":
			case "validationException":
			case "throttlingException":
			case "serviceUnavailableException":
				return { [fieldName]: ex };
			default:
				throw ex;
		}
	}

	return undefined;
}

export async function* parseBedrockEventStream(
	response: Response,
	signal?: AbortSignal,
	requestId?: string,
): AsyncGenerator<ConverseStreamOutputEvent, void, unknown> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = new Uint8Array(0);

	const onAbort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			const { done, value } = await reader.read();
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (value && value.byteLength > 0) {
				const combined = new Uint8Array(buffer.byteLength + value.byteLength);
				combined.set(buffer, 0);
				combined.set(value, buffer.byteLength);
				buffer = combined;
			}

			while (buffer.byteLength >= 12) {
				const preludeView = new DataView(buffer.buffer, buffer.byteOffset, 12);
				const totalLength = preludeView.getUint32(0, false);
				const headersLength = preludeView.getUint32(4, false);
				const expectedPreludeCrc = preludeView.getUint32(8, false);

				if (totalLength < 16 || headersLength > totalLength - 16) {
					throw new Error(`Invalid AWS EventStream frame sizes: total=${totalLength}, headers=${headersLength}`);
				}
				const actualPreludeCrc = crc32(buffer.subarray(0, 8));
				if (actualPreludeCrc !== expectedPreludeCrc) {
					throw new Error("AWS EventStream prelude CRC mismatch");
				}

				if (buffer.byteLength < totalLength) {
					break;
				}

				const frame = buffer.subarray(0, totalLength);
				const messageView = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
				const expectedMessageCrc = messageView.getUint32(totalLength - 4, false);
				const actualMessageCrc = crc32(frame.subarray(0, totalLength - 4));
				if (actualMessageCrc !== expectedMessageCrc) {
					throw new Error("AWS EventStream message CRC mismatch");
				}

				const headerBytes = frame.subarray(12, 12 + headersLength);
				const payloadBytes = frame.subarray(12 + headersLength, totalLength - 4);
				const frameHeaders = decodeEventStreamHeaders(headerBytes, decoder);
				buffer = buffer.subarray(totalLength);

				const event = mapEventFrameToConverseStreamEvent(frameHeaders, payloadBytes, decoder, requestId);
				if (event) {
					yield event;
				}
			}

			if (done) {
				if (buffer.byteLength > 0) {
					throw new Error(`Truncated AWS EventStream frame (${buffer.byteLength} trailing bytes)`);
				}
				break;
			}
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		try {
			await reader.cancel();
		} catch {}
		try {
			reader.releaseLock();
		} catch {}
	}
}

// ============================================================================
// HTTP Request & Node Proxy Support
// ============================================================================

function bytesToBase64Single(bytes: Uint8Array): string {
	const WINDOW = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += WINDOW) {
		binary += String.fromCharCode(...bytes.subarray(i, i + WINDOW));
	}
	return btoa(binary);
}

export function serializeBedrockPayload(input: ConverseStreamCommandInput): string {
	const wireBody: Record<string, unknown> = {};
	if (input.messages !== undefined) wireBody.messages = input.messages;
	if (input.system !== undefined) wireBody.system = input.system;
	if (input.inferenceConfig !== undefined) wireBody.inferenceConfig = input.inferenceConfig;
	if (input.toolConfig !== undefined) wireBody.toolConfig = input.toolConfig;
	if (input.additionalModelRequestFields !== undefined) {
		wireBody.additionalModelRequestFields = input.additionalModelRequestFields;
	}
	if (input.requestMetadata !== undefined) wireBody.requestMetadata = input.requestMetadata;

	return JSON.stringify(wireBody, (_key, value: unknown) =>
		value instanceof Uint8Array ? bytesToBase64Single(value) : value,
	);
}

export function formatBedrockUserAgent(identity: ClientIdentity | undefined, defaultUserAgent: string): string {
	const mode = identity?.userAgent ?? "detailed";
	if (typeof mode === "object") return mode.custom;
	return defaultUserAgent;
}

export function buildBedrockConverseStreamUrl(endpoint: string, modelId: string): URL {
	const url = new URL(endpoint);
	const cleanPath = url.pathname.replace(/\/+$/, "");
	const encodedModelId = encodeRfc3986(modelId);
	url.pathname = `${cleanPath}/model/${encodedModelId}/converse-stream`;
	return url;
}

function makeAbortError(): Error {
	const error = new Error("Request was aborted");
	error.name = "AbortError";
	return error;
}

function fetchViaNodeProxy(
	proxyUrl: URL,
	targetUrl: URL,
	headers: Record<string, string>,
	body: Uint8Array,
	signal?: AbortSignal,
): Promise<Response> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(makeAbortError());
			return;
		}

		const targetPort = Number.parseInt(targetUrl.port, 10) || (targetUrl.protocol === "https:" ? 443 : 80);
		const proxyPort = Number.parseInt(proxyUrl.port, 10) || (proxyUrl.protocol === "https:" ? 443 : 80);
		const proxyAuth =
			proxyUrl.username || proxyUrl.password
				? `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64")}`
				: undefined;

		let activeReq: http.ClientRequest | undefined;
		let connectReq: http.ClientRequest | undefined;
		const cleanupSignal = () => signal?.removeEventListener("abort", onAbort);
		const onAbort = () => {
			cleanupSignal();
			connectReq?.destroy();
			activeReq?.destroy();
			reject(makeAbortError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		const sendRequest = (createConnection?: () => tls.TLSSocket) => {
			const reqOptions: https.RequestOptions =
				targetUrl.protocol === "https:"
					? {
							hostname: targetUrl.hostname,
							port: targetPort,
							path: `${targetUrl.pathname}${targetUrl.search}`,
							method: "POST",
							headers: {
								...headers,
								host: targetUrl.host,
								"content-length": String(body.byteLength),
							},
							...(createConnection ? { createConnection } : {}),
						}
					: {
							hostname: proxyUrl.hostname,
							port: proxyPort,
							path: targetUrl.toString(),
							method: "POST",
							headers: {
								...headers,
								host: targetUrl.host,
								"content-length": String(body.byteLength),
								...(proxyAuth ? { "proxy-authorization": proxyAuth } : {}),
							},
						};

			const handleResponse = (res: http.IncomingMessage) => {
				const webHeaders = new Headers();
				const rawHeaders = res.headers as Record<string, string | string[] | undefined>;
				for (const key of Object.keys(rawHeaders)) {
					const val = rawHeaders[key];
					if (typeof val === "string") {
						webHeaders.append(key, val);
					} else if (Array.isArray(val)) {
						for (const item of val) webHeaders.append(key, item);
					}
				}
				const webStream = new ReadableStream<Uint8Array>({
					start(controller) {
						res.on("data", (chunk: Buffer) => {
							controller.enqueue(new Uint8Array(chunk));
						});
						res.on("end", () => {
							cleanupSignal();
							controller.close();
						});
						res.on("error", (err) => {
							cleanupSignal();
							controller.error(err);
						});
					},
					cancel() {
						cleanupSignal();
						res.destroy();
					},
				});
				resolve(new Response(webStream, { status: res.statusCode ?? 500, headers: webHeaders }));
			};

			const req = targetUrl.protocol === "https:" ? https.request(reqOptions, handleResponse) : http.request(reqOptions, handleResponse);
			activeReq = req;

			req.on("error", (err) => {
				cleanupSignal();
				if (signal?.aborted) {
					reject(makeAbortError());
				} else {
					reject(err);
				}
			});

			req.write(body);
			req.end();
		};

		if (targetUrl.protocol === "http:") {
			sendRequest();
			return;
		}

		const connectOptions = {
			hostname: proxyUrl.hostname,
			port: proxyPort,
			method: "CONNECT",
			path: `${targetUrl.hostname}:${targetPort}`,
			headers: {
				host: `${targetUrl.hostname}:${targetPort}`,
				...(proxyAuth ? { "proxy-authorization": proxyAuth } : {}),
			},
		};
		const reqConnect = proxyUrl.protocol === "https:" ? https.request(connectOptions) : http.request(connectOptions);
		connectReq = reqConnect;

		reqConnect.on("connect", (proxyRes, socket) => {
			if (proxyRes.statusCode !== 200) {
				socket.destroy();
				cleanupSignal();
				reject(new Error(`HTTP proxy CONNECT failed with status ${proxyRes.statusCode}`));
				return;
			}
			const tlsSocket = tls.connect({
				socket,
				servername: targetUrl.hostname,
			});
			tlsSocket.once("error", (err) => {
				cleanupSignal();
				reject(err);
			});
			sendRequest(() => tlsSocket);
		});

		connectReq.on("error", (err) => {
			cleanupSignal();
			if (signal?.aborted) {
				reject(makeAbortError());
			} else {
				reject(err);
			}
		});

		connectReq.end();
	});
}

function isReservedHeader(key: string): boolean {
	const lower = key.toLowerCase();
	return lower === "authorization" || lower === "host" || lower.startsWith("x-amz-");
}

function parseHttpErrorResponse(status: number, rawBody: string, headers: Headers): BedrockRuntimeServiceException {
	const requestId = headers.get("x-amzn-requestid") ?? headers.get("x-amz-request-id") ?? undefined;
	const headerRecord: Record<string, string> = {};
	for (const [k, v] of headers.entries()) {
		headerRecord[k] = v;
	}

	const rawErrType = headers.get("x-amzn-errortype") ?? undefined;
	let errorName = rawErrType ? rawErrType.split(":")[0]!.split("#").pop()!.trim() : undefined;

	let parsedJson: Record<string, unknown> | undefined;
	const trimmed = rawBody.trim();
	if (trimmed.length > 0) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				parsedJson = parsed as Record<string, unknown>;
			}
		} catch {
			// Non-JSON response
		}
	}

	if (!errorName && parsedJson) {
		const rawType = typeof parsedJson.__type === "string" ? parsedJson.__type : parsedJson.code;
		if (typeof rawType === "string" && rawType.length > 0) {
			errorName = rawType.split("#").pop()!.split(":")[0]!.trim();
		}
	}

	const parsedMessage =
		parsedJson && typeof parsedJson.message === "string" && parsedJson.message.length > 0
			? parsedJson.message
			: parsedJson && typeof parsedJson.Message === "string" && parsedJson.Message.length > 0
				? parsedJson.Message
				: undefined;

	const fault: "client" | "server" = status >= 500 ? "server" : "client";
	const $metadata = {
		httpStatusCode: status,
		...(requestId ? { requestId } : {}),
	};

	if (errorName && parsedMessage) {
		return new BedrockRuntimeServiceException({
			name: normalizePascalCase(errorName),
			message: parsedMessage,
			$fault: fault,
			$metadata,
			$response: { statusCode: status, headers: headerRecord },
		});
	}

	return new BedrockRuntimeServiceException({
		name: errorName ? normalizePascalCase(errorName) : "UnknownError",
		message: parsedMessage || errorName || `HTTP ${status}`,
		$fault: fault,
		$metadata,
		$response: {
			statusCode: status,
			body: trimmed.length > 0 ? rawBody : undefined,
			headers: headerRecord,
		},
	});
}

export interface SendBedrockConverseStreamParams {
	endpoint: string;
	region: string;
	commandInput: ConverseStreamCommandInput;
	customHeaders?: ProviderHeaders;
	userAgent: string;
	bearerToken?: string;
	credentials?: BedrockCredentials;
	proxyUrl?: URL;
	fetch?: typeof globalThis.fetch;
	signal?: AbortSignal;
	onRawResponse?: (response: Response) => Promise<void> | void;
}

export async function sendBedrockConverseStream(
	params: SendBedrockConverseStreamParams,
): Promise<ConverseStreamCommandOutput> {
	const url = buildBedrockConverseStreamUrl(params.endpoint, params.commandInput.modelId);
	const bodyText = serializeBedrockPayload(params.commandInput);
	const bodyBytes = new TextEncoder().encode(bodyText);

	const baseHeaders: Record<string, string> = {
		"content-type": "application/json",
		accept: "application/vnd.amazon.eventstream",
		"user-agent": params.userAgent,
	};

	if (params.customHeaders) {
		for (const key of Object.keys(params.customHeaders)) {
			const val = params.customHeaders[key];
			if (val !== null && val !== undefined && !isReservedHeader(key)) {
				baseHeaders[key] = val;
			}
		}
	}

	let finalHeaders: Record<string, string>;
	if (params.bearerToken !== undefined) {
		finalHeaders = {
			...baseHeaders,
			authorization: `Bearer ${params.bearerToken}`,
		};
	} else {
		if (!params.credentials) {
			throw new Error("Missing AWS credentials for Amazon Bedrock request");
		}
		finalHeaders = signAwsSigV4({
			method: "POST",
			url,
			headers: baseHeaders,
			body: bodyBytes,
			region: params.region,
			service: "bedrock",
			credentials: params.credentials,
		});
	}

	const response =
		!params.fetch && params.proxyUrl
			? await fetchViaNodeProxy(params.proxyUrl, url, finalHeaders, bodyBytes, params.signal)
			: await (params.fetch ?? globalThis.fetch)(url.toString(), {
					method: "POST",
					headers: finalHeaders,
					body: bodyText,
					...(params.signal ? { signal: params.signal } : {}),
				});

	await params.onRawResponse?.(response);

	const requestId =
		response.headers.get("x-amzn-requestid") ?? response.headers.get("x-amz-request-id") ?? undefined;

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw parseHttpErrorResponse(response.status, errorText, response.headers);
	}

	const eventStream: AsyncIterable<ConverseStreamOutputEvent> = parseBedrockEventStream(
		response,
		params.signal,
		requestId,
	);
	return {
		$metadata: {
			httpStatusCode: response.status,
			...(requestId ? { requestId } : {}),
		},
		stream: eventStream,
	};
}
