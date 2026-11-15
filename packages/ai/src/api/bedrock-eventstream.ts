import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
// INI Credentials, Region & Enterprise Credential Chain Resolution
// ============================================================================

export type IniSections = Map<string, Map<string, string>>;

export interface ParsedAwsIniFiles {
	credentials?: IniSections;
	config?: IniSections;
}

export interface ParseAwsIniFilesOptions {
	env?: ProviderEnv;
	credentialsFile?: string;
	configFile?: string;
	credentialsContent?: string;
	configContent?: string;
}

export interface StsCredentialsResult extends BedrockCredentials {
	expiration?: string;
}

export interface ResolveSsoCachedTokenOptions {
	ssoSession?: string;
	ssoStartUrl?: string;
	ssoRegion: string;
	ssoCacheDir?: string;
	env?: ProviderEnv;
	fetchFn?: typeof globalThis.fetch;
	signal?: AbortSignal;
	nowMs?: number;
}

export interface ResolveBedrockCredentialsParams {
	optionsProfile?: string;
	ambientProfile?: string;
	envCredentials?: BedrockCredentials;
	skipAuth: boolean;
	env?: ProviderEnv;
	region?: string;
	signal?: AbortSignal;
	fetchFn?: typeof globalThis.fetch;
}

interface CachedBedrockCredentials {
	credentials: BedrockCredentials;
	expiresAtMs: number;
}

const BEDROCK_CREDENTIAL_EXPIRY_LEEWAY_MS = 60_000;
const DEFAULT_STS_EXPIRY_MS = 900_000;
const AWS_CREDENTIAL_FETCH_TIMEOUT_MS = 15_000;
const AWS_IMDS_TIMEOUT_MS = 1_500;
const AWS_CREDENTIAL_PROCESS_TIMEOUT_MS = 30_000;

const bedrockCredentialsCache = new Map<string, CachedBedrockCredentials>();

/** Clears the in-memory Bedrock temporary credential cache (intended for tests). */
export function clearBedrockCredentialsCache(): void {
	bedrockCredentialsCache.clear();
}

function getAwsHomeDir(env?: ProviderEnv): string {
	return env?.HOME || env?.USERPROFILE || homedir();
}

function normalizeIniSectionName(raw: string): string {
	const trimmed = raw.trim();
	if (/^profile\s+/.test(trimmed)) {
		return `profile ${trimmed.replace(/^profile\s+/, "")}`;
	}
	if (/^sso-session\s+/.test(trimmed)) {
		return `sso-session ${trimmed.replace(/^sso-session\s+/, "")}`;
	}
	return trimmed;
}

/** Parses AWS INI file text (`~/.aws/credentials` or `~/.aws/config`) into a section map. */
export function parseAwsIniText(content: string): IniSections {
	const sections: IniSections = new Map();
	let current: Map<string, string> | undefined;
	let currentSubPrefix: string | undefined;

	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			const sectionName = normalizeIniSectionName(trimmed.slice(1, -1));
			current = sections.get(sectionName) ?? new Map<string, string>();
			sections.set(sectionName, current);
			currentSubPrefix = undefined;
			continue;
		}
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1 || !current) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim();
		const isIndented = rawLine.length > rawLine.trimStart().length;
		if (isIndented && currentSubPrefix) {
			current.set(`${currentSubPrefix}.${key}`, value);
			continue;
		}
		if (value === "") {
			currentSubPrefix = key;
		} else {
			currentSubPrefix = undefined;
			current.set(key, value);
		}
	}

	return sections;
}

function parseIniFile(path: string): IniSections | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return parseAwsIniText(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** Parses AWS shared credentials and config INI files from disk or explicit text inputs. */
export function parseAwsIniFiles(options?: ParseAwsIniFilesOptions): ParsedAwsIniFiles {
	let credentials: IniSections | undefined;
	if (options?.credentialsContent !== undefined) {
		credentials = parseAwsIniText(options.credentialsContent);
	} else if (typeof process !== "undefined") {
		const home = getAwsHomeDir(options?.env);
		const credsFile =
			options?.credentialsFile ||
			getProviderEnvValue("AWS_SHARED_CREDENTIALS_FILE", options?.env) ||
			join(home, ".aws", "credentials");
		credentials = parseIniFile(credsFile);
	}

	let config: IniSections | undefined;
	if (options?.configContent !== undefined) {
		config = parseAwsIniText(options.configContent);
	} else if (typeof process !== "undefined") {
		const home = getAwsHomeDir(options?.env);
		const configFile =
			options?.configFile || getProviderEnvValue("AWS_CONFIG_FILE", options?.env) || join(home, ".aws", "config");
		config = parseIniFile(configFile);
	}

	return { credentials, config };
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
	if (typeof process === "undefined") {
		return {};
	}
	const { credentials: credsSections, config: configSections } = parseAwsIniFiles({ env });
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

function toBedrockCredentials(creds: {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}): BedrockCredentials {
	return {
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
	};
}

function parseExpirationMs(expiration: unknown, nowMs = Date.now()): number | undefined {
	if (typeof expiration === "number" && Number.isFinite(expiration)) {
		// AWS SSO returns ms; some helpers emit epoch seconds (< 1e12).
		return expiration < 1e12 ? expiration * 1000 : expiration;
	}
	if (typeof expiration === "string") {
		const trimmed = expiration.trim();
		if (!trimmed) return undefined;
		if (/^\d+$/.test(trimmed)) {
			const num = Number.parseInt(trimmed, 10);
			if (Number.isFinite(num)) {
				return num < 1e12 ? num * 1000 : num;
			}
		}
		const normalized = trimmed.endsWith("UTC") ? `${trimmed.slice(0, -3)}Z` : trimmed;
		const parsed = Date.parse(normalized);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	void nowMs;
	return undefined;
}

function getCachedBedrockCredentials(cacheKey: string): BedrockCredentials | undefined {
	const cached = bedrockCredentialsCache.get(cacheKey);
	if (!cached) return undefined;
	if (Date.now() < cached.expiresAtMs - BEDROCK_CREDENTIAL_EXPIRY_LEEWAY_MS) {
		return cached.credentials;
	}
	bedrockCredentialsCache.delete(cacheKey);
	return undefined;
}

function setCachedBedrockCredentials(
	cacheKey: string,
	credentials: BedrockCredentials,
	expiresAtMs: number | undefined,
): BedrockCredentials {
	const clean = toBedrockCredentials(credentials);
	if (expiresAtMs !== undefined && Number.isFinite(expiresAtMs)) {
		bedrockCredentialsCache.set(cacheKey, { credentials: clean, expiresAtMs });
	}
	return clean;
}

function decodeXmlEntities(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_match, entity: string) => {
		switch (entity) {
			case "amp":
				return "&";
			case "lt":
				return "<";
			case "gt":
				return ">";
			case "quot":
				return '"';
			case "apos":
				return "'";
			default:
				if (entity.startsWith("#x")) {
					const code = Number.parseInt(entity.slice(2), 16);
					return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
				}
				if (entity.startsWith("#")) {
					const code = Number.parseInt(entity.slice(1), 10);
					return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
				}
				return _match;
		}
	});
}

function extractXmlTagText(xml: string, tagName: string): string | undefined {
	const pattern = new RegExp(
		`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}\\s*>`,
	);
	const match = pattern.exec(xml);
	if (!match || match.length < 2 || match[1] === undefined) {
		return undefined;
	}
	return decodeXmlEntities(match[1].trim());
}

/** Parses an AWS STS XML response (`AssumeRole` or `AssumeRoleWithWebIdentity`) into credentials. */
export function parseStsCredentialsXml(xml: string): StsCredentialsResult {
	const errorBlock = extractXmlTagText(xml, "Error");
	if (errorBlock !== undefined) {
		const code = extractXmlTagText(errorBlock, "Code") ?? "StsError";
		const message = extractXmlTagText(errorBlock, "Message") ?? "AWS STS returned an error";
		throw new Error(`AWS STS ${code}: ${message}`);
	}

	const credentialsScope = extractXmlTagText(xml, "Credentials") ?? xml;
	const accessKeyId = extractXmlTagText(credentialsScope, "AccessKeyId");
	const secretAccessKey = extractXmlTagText(credentialsScope, "SecretAccessKey");
	const sessionToken = extractXmlTagText(credentialsScope, "SessionToken");
	const expiration = extractXmlTagText(credentialsScope, "Expiration");

	if (!accessKeyId || !secretAccessKey) {
		throw new Error("Invalid AWS STS XML response: missing AccessKeyId or SecretAccessKey");
	}

	return {
		accessKeyId,
		secretAccessKey,
		...(sessionToken ? { sessionToken } : {}),
		...(expiration ? { expiration } : {}),
	};
}

function buildAwsRegionalHost(service: string, region: string): string {
	return `${service}.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`;
}

async function executeAwsCredentialFetch(
	fetchFn: typeof globalThis.fetch,
	url: string,
	init: { method: string; headers?: Record<string, string>; body?: string },
	timeoutMs: number,
	callerSignal?: AbortSignal,
): Promise<Response> {
	if (callerSignal?.aborted) {
		throw makeAbortError();
	}

	const controller = new AbortController();
	let timedOut = false;
	const timer =
		timeoutMs > 0 && Number.isFinite(timeoutMs)
			? setTimeout(() => {
					timedOut = true;
					controller.abort();
				}, timeoutMs)
			: undefined;

	const onAbort = () => controller.abort();
	callerSignal?.addEventListener("abort", onAbort, { once: true });

	try {
		return await fetchFn.call(undefined, url, {
			method: init.method,
			...(init.headers ? { headers: init.headers } : {}),
			...(init.body !== undefined ? { body: init.body } : {}),
			signal: controller.signal,
		});
	} catch (error) {
		if (callerSignal?.aborted) {
			throw makeAbortError();
		}
		if (timedOut) {
			throw new Error(`AWS credential request to ${url} timed out after ${timeoutMs}ms`);
		}
		throw error;
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		callerSignal?.removeEventListener("abort", onAbort);
	}
}

function formatStsHttpError(status: number, bodyText: string, action: string): Error {
	if (bodyText.trim().startsWith("<")) {
		try {
			parseStsCredentialsXml(bodyText);
		} catch (stsError) {
			if (stsError instanceof Error && stsError.message.startsWith("AWS STS ")) {
				return stsError;
			}
		}
	}
	return new Error(`AWS STS ${action} failed with HTTP ${status}: ${bodyText || "empty response"}`);
}

export async function assumeRoleWithWebIdentity(params: {
	roleArn: string;
	roleSessionName?: string;
	webIdentityTokenFile?: string;
	webIdentityToken?: string;
	region?: string;
	fetchFn?: typeof globalThis.fetch;
	signal?: AbortSignal;
}): Promise<StsCredentialsResult> {
	const region = params.region || "us-east-1";
	const fetchFn = params.fetchFn ?? globalThis.fetch;
	let token = params.webIdentityToken?.trim();
	if (!token) {
		if (!params.webIdentityTokenFile) {
			throw new Error("AWS WebIdentity authentication requires web_identity_token_file");
		}
		token = readFileSync(params.webIdentityTokenFile, "utf8").trim();
	}
	if (!token) {
		throw new Error("AWS WebIdentity token file is empty");
	}

	const sessionName = params.roleSessionName || "pi-bedrock-session";
	const stsUrl = `https://${buildAwsRegionalHost("sts", region)}/`;
	const form = new URLSearchParams({
		Action: "AssumeRoleWithWebIdentity",
		Version: "2011-06-15",
		RoleArn: params.roleArn,
		RoleSessionName: sessionName,
		WebIdentityToken: token,
	});

	const response = await executeAwsCredentialFetch(
		fetchFn,
		stsUrl,
		{
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded; charset=utf-8",
				accept: "application/xml",
			},
			body: form.toString(),
		},
		AWS_CREDENTIAL_FETCH_TIMEOUT_MS,
		params.signal,
	);
	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw formatStsHttpError(response.status, text, "AssumeRoleWithWebIdentity");
	}
	return parseStsCredentialsXml(text);
}

export async function assumeRole(params: {
	roleArn: string;
	roleSessionName?: string;
	externalId?: string;
	durationSeconds?: number;
	region?: string;
	sourceCredentials: BedrockCredentials;
	fetchFn?: typeof globalThis.fetch;
	signal?: AbortSignal;
}): Promise<StsCredentialsResult> {
	const region = params.region || "us-east-1";
	const fetchFn = params.fetchFn ?? globalThis.fetch;
	const stsUrl = new URL(`https://${buildAwsRegionalHost("sts", region)}/`);
	const form = new URLSearchParams({
		Action: "AssumeRole",
		Version: "2011-06-15",
		RoleArn: params.roleArn,
		RoleSessionName: params.roleSessionName || "pi-bedrock-session",
	});
	if (params.externalId) {
		form.set("ExternalId", params.externalId);
	}
	if (params.durationSeconds !== undefined && Number.isFinite(params.durationSeconds) && params.durationSeconds > 0) {
		form.set("DurationSeconds", String(Math.floor(params.durationSeconds)));
	}

	const bodyText = form.toString();
	const bodyBytes = new TextEncoder().encode(bodyText);
	const signedHeaders = signAwsSigV4({
		method: "POST",
		url: stsUrl,
		headers: {
			"content-type": "application/x-www-form-urlencoded; charset=utf-8",
			accept: "application/xml",
		},
		body: bodyBytes,
		region,
		service: "sts",
		credentials: params.sourceCredentials,
	});

	const response = await executeAwsCredentialFetch(
		fetchFn,
		stsUrl.toString(),
		{
			method: "POST",
			headers: signedHeaders,
			body: bodyText,
		},
		AWS_CREDENTIAL_FETCH_TIMEOUT_MS,
		params.signal,
	);
	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw formatStsHttpError(response.status, text, "AssumeRole");
	}
	return parseStsCredentialsXml(text);
}

function sha1Hex(value: string): string {
	return createHash("sha1").update(value, "utf8").digest("hex");
}

function readJsonRecord(text: string, label: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in ${label}: ${msg}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Expected JSON object in ${label}`);
	}
	return parsed as Record<string, unknown>;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Resolves and refreshes (if expired with refreshToken/clientId/clientSecret) an AWS SSO cached bearer token
 * from `~/.aws/sso/cache/<sha1(sso_session || sso_start_url)>.json`.
 */
export async function resolveSsoCachedToken(options: ResolveSsoCachedTokenOptions): Promise<string> {
	const cacheKeySource = options.ssoSession || options.ssoStartUrl;
	if (!cacheKeySource) {
		throw new Error("AWS SSO requires sso_session or sso_start_url");
	}
	const cacheDir = options.ssoCacheDir || join(getAwsHomeDir(options.env), ".aws", "sso", "cache");
	const primaryPath = join(cacheDir, `${sha1Hex(cacheKeySource)}.json`);
	const fallbackPath =
		options.ssoSession && options.ssoStartUrl ? join(cacheDir, `${sha1Hex(options.ssoStartUrl)}.json`) : undefined;

	let cachePath: string | undefined;
	if (existsSync(primaryPath)) {
		cachePath = primaryPath;
	} else if (fallbackPath && existsSync(fallbackPath)) {
		cachePath = fallbackPath;
	}

	if (!cachePath) {
		throw new Error(`AWS SSO cached token not found at ${primaryPath}. Run "aws sso login".`);
	}

	const cachedObj = readJsonRecord(readFileSync(cachePath, "utf8"), `AWS SSO cache ${cachePath}`);
	const accessToken = readOptionalString(cachedObj, "accessToken");
	const expiresAtRaw = cachedObj.expiresAt;
	const nowMs = options.nowMs ?? Date.now();
	const expiresAtMs = parseExpirationMs(expiresAtRaw, nowMs);

	const refreshToken = readOptionalString(cachedObj, "refreshToken");
	const clientId = readOptionalString(cachedObj, "clientId");
	const clientSecret = readOptionalString(cachedObj, "clientSecret");
	const hasRefreshCreds = Boolean(refreshToken && clientId && clientSecret);
	const leewayMs = hasRefreshCreds ? BEDROCK_CREDENTIAL_EXPIRY_LEEWAY_MS : 0;
	const isExpired = expiresAtMs === undefined || nowMs >= expiresAtMs - leewayMs;

	if (accessToken && !isExpired) {
		return accessToken;
	}

	if (!refreshToken || !clientId || !clientSecret) {
		throw new Error('AWS SSO token is missing or expired and cannot be refreshed. Run "aws sso login".');
	}

	const registrationExpiresAtMs = parseExpirationMs(cachedObj.registrationExpiresAt, nowMs);
	if (registrationExpiresAtMs !== undefined && nowMs >= registrationExpiresAtMs) {
		throw new Error('AWS SSO client registration is expired. Run "aws sso login".');
	}

	const fetchFn = options.fetchFn ?? globalThis.fetch;
	const oidcUrl = `https://${buildAwsRegionalHost("oidc", options.ssoRegion)}/token`;
	const response = await executeAwsCredentialFetch(
		fetchFn,
		oidcUrl,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify({
				clientId,
				clientSecret,
				grantType: "refresh_token",
				refreshToken,
			}),
		},
		AWS_CREDENTIAL_FETCH_TIMEOUT_MS,
		options.signal,
	);
	const responseText = await response.text().catch(() => "");
	if (!response.ok) {
		throw new Error(`AWS SSO OIDC token refresh failed (${response.status}): ${responseText}`);
	}

	const refreshedObj = readJsonRecord(responseText, "AWS SSO OIDC token response");
	const newAccessToken =
		readOptionalString(refreshedObj, "accessToken") ?? readOptionalString(refreshedObj, "access_token");
	if (!newAccessToken) {
		throw new Error("AWS SSO OIDC token response missing accessToken");
	}
	const expiresInRaw = refreshedObj.expiresIn ?? refreshedObj.expires_in;
	const expiresInSec = typeof expiresInRaw === "number" && expiresInRaw > 0 ? expiresInRaw : 3600;
	const newExpiresAt = new Date(nowMs + expiresInSec * 1000).toISOString();
	const newRefreshToken =
		readOptionalString(refreshedObj, "refreshToken") ??
		readOptionalString(refreshedObj, "refresh_token") ??
		refreshToken;

	const updatedObj: Record<string, unknown> = {
		...cachedObj,
		accessToken: newAccessToken,
		expiresAt: newExpiresAt,
		refreshToken: newRefreshToken,
	};
	try {
		writeFileSync(cachePath, JSON.stringify(updatedObj, null, 2), { encoding: "utf8", mode: 0o600 });
	} catch {
		// Best-effort cache update; ignore read-only filesystems.
	}

	return newAccessToken;
}

export async function fetchSsoRoleCredentials(params: {
	ssoRegion: string;
	accountId: string;
	roleName: string;
	accessToken: string;
	fetchFn?: typeof globalThis.fetch;
	signal?: AbortSignal;
}): Promise<{ credentials: BedrockCredentials; expiresAtMs?: number }> {
	const fetchFn = params.fetchFn ?? globalThis.fetch;
	const portalHost = buildAwsRegionalHost("portal.sso", params.ssoRegion);
	const url = `https://${portalHost}/federation/credentials?account_id=${encodeURIComponent(params.accountId)}&role_name=${encodeURIComponent(params.roleName)}`;
	const response = await executeAwsCredentialFetch(
		fetchFn,
		url,
		{
			method: "GET",
			headers: {
				"x-amz-sso_bearer_token": params.accessToken,
				accept: "application/json",
			},
		},
		AWS_CREDENTIAL_FETCH_TIMEOUT_MS,
		params.signal,
	);
	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw new Error(`AWS SSO federation credentials failed (${response.status}): ${text}`);
	}

	const payload = readJsonRecord(text, "AWS SSO federation response");
	const rawRoleCreds = payload.roleCredentials;
	if (!rawRoleCreds || typeof rawRoleCreds !== "object" || Array.isArray(rawRoleCreds)) {
		throw new Error("AWS SSO federation response missing roleCredentials");
	}
	const roleCreds = rawRoleCreds as Record<string, unknown>;
	const accessKeyId = readOptionalString(roleCreds, "accessKeyId");
	const secretAccessKey = readOptionalString(roleCreds, "secretAccessKey");
	const sessionToken = readOptionalString(roleCreds, "sessionToken");
	if (!accessKeyId || !secretAccessKey) {
		throw new Error("AWS SSO federation response missing accessKeyId or secretAccessKey");
	}
	const expiresAtMs = parseExpirationMs(roleCreds.expiration);
	return {
		credentials: toBedrockCredentials({ accessKeyId, secretAccessKey, sessionToken }),
		expiresAtMs,
	};
}

export async function executeCredentialProcess(
	command: string,
	options?: { env?: ProviderEnv; signal?: AbortSignal; timeoutMs?: number },
): Promise<StsCredentialsResult> {
	if (options?.signal?.aborted) {
		throw makeAbortError();
	}

	const timeoutMs = options?.timeoutMs ?? AWS_CREDENTIAL_PROCESS_TIMEOUT_MS;
	const mergedEnv: Record<string, string | undefined> =
		typeof process !== "undefined" ? { ...process.env, ...(options?.env ?? {}) } : { ...(options?.env ?? {}) };

	const stdout = await new Promise<string>((resolve, reject) => {
		const isWin = typeof process !== "undefined" && process.platform === "win32";
		const shellBin = isWin ? mergedEnv.ComSpec || "cmd.exe" : "/bin/sh";
		const shellArgs = isWin ? ["/d", "/s", "/c", command] : ["-c", command];
		const child = spawn(shellBin, shellArgs, {
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: mergedEnv,
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let settled = false;
		let timedOut = false;

		const cleanup = () => {
			if (timer !== undefined) clearTimeout(timer);
			options?.signal?.removeEventListener("abort", onAbort);
		};

		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			try {
				child.kill("SIGTERM");
			} catch {}
			reject(makeAbortError());
		};

		const timer =
			timeoutMs > 0 && Number.isFinite(timeoutMs)
				? setTimeout(() => {
						if (settled) return;
						settled = true;
						timedOut = true;
						cleanup();
						try {
							child.kill("SIGTERM");
						} catch {}
						reject(new Error(`AWS credential_process timed out after ${timeoutMs}ms`));
					}, timeoutMs)
				: undefined;

		options?.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
		});
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(err);
		});
		child.on("close", (code) => {
			if (settled || timedOut) return;
			settled = true;
			cleanup();
			if (code !== 0) {
				const errText = Buffer.concat(stderrChunks).toString("utf8").trim();
				reject(new Error(`AWS credential_process exited with code ${code ?? "unknown"}: ${errText}`));
				return;
			}
			resolve(Buffer.concat(stdoutChunks).toString("utf8"));
		});
	});

	const parsed = readJsonRecord(stdout, "AWS credential_process output");
	if (parsed.Version !== 1) {
		throw new Error(`Unsupported AWS credential_process Version: ${String(parsed.Version)}`);
	}
	const accessKeyId = readOptionalString(parsed, "AccessKeyId");
	const secretAccessKey = readOptionalString(parsed, "SecretAccessKey");
	if (!accessKeyId || !secretAccessKey) {
		throw new Error("AWS credential_process output missing AccessKeyId or SecretAccessKey");
	}
	const sessionToken = readOptionalString(parsed, "SessionToken");
	const expiration = readOptionalString(parsed, "Expiration");
	return {
		accessKeyId,
		secretAccessKey,
		...(sessionToken ? { sessionToken } : {}),
		...(expiration ? { expiration } : {}),
	};
}

export async function resolveEcsContainerCredentials(params: {
	env?: ProviderEnv;
	fetchFn?: typeof globalThis.fetch;
	signal?: AbortSignal;
}): Promise<BedrockCredentials | undefined> {
	const relUri = getProviderEnvValue("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", params.env);
	const fullUri = getProviderEnvValue("AWS_CONTAINER_CREDENTIALS_FULL_URI", params.env);
	if (!relUri && !fullUri) {
		return undefined;
	}

	let targetUrl: string;
	if (relUri) {
		targetUrl = new URL(relUri.startsWith("/") ? relUri : `/${relUri}`, "http://169.254.170.2").toString();
	} else {
		const parsedUrl = new URL(fullUri!);
		if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
			throw new Error(`Unsupported ECS credentials URI protocol: ${parsedUrl.protocol}`);
		}
		targetUrl = parsedUrl.toString();
	}

	const authTokenFile = getProviderEnvValue("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", params.env);
	let authToken = authTokenFile ? readFileSync(authTokenFile, "utf8").trim() : undefined;
	if (!authToken) {
		authToken = getProviderEnvValue("AWS_CONTAINER_AUTHORIZATION_TOKEN", params.env);
	}

	const cacheKey = `ecs:${targetUrl}:${authTokenFile ?? ""}:${authToken ? "auth" : "none"}`;
	const cached = getCachedBedrockCredentials(cacheKey);
	if (cached) {
		return cached;
	}

	const headers: Record<string, string> = { accept: "application/json" };
	if (authToken) {
		headers.Authorization = authToken;
	}

	const fetchFn = params.fetchFn ?? globalThis.fetch;
	const response = await executeAwsCredentialFetch(
		fetchFn,
		targetUrl,
		{ method: "GET", headers },
		AWS_CREDENTIAL_FETCH_TIMEOUT_MS,
		params.signal,
	);
	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw new Error(`AWS ECS container credentials request failed (${response.status}): ${text}`);
	}

	const payload = readJsonRecord(text, "AWS ECS container credentials response");
	const accessKeyId = readOptionalString(payload, "AccessKeyId");
	const secretAccessKey = readOptionalString(payload, "SecretAccessKey");
	const sessionToken = readOptionalString(payload, "Token") ?? readOptionalString(payload, "SessionToken");
	if (!accessKeyId || !secretAccessKey) {
		throw new Error("AWS ECS container credentials response missing AccessKeyId or SecretAccessKey");
	}
	const expiresAtMs = parseExpirationMs(payload.Expiration) ?? Date.now() + DEFAULT_STS_EXPIRY_MS;
	return setCachedBedrockCredentials(cacheKey, { accessKeyId, secretAccessKey, sessionToken }, expiresAtMs);
}

export async function resolveEc2ImdsV2Credentials(params: {
	env?: ProviderEnv;
	fetchFn?: typeof globalThis.fetch;
	signal?: AbortSignal;
}): Promise<BedrockCredentials> {
	const disabled = getProviderEnvValue("AWS_EC2_METADATA_DISABLED", params.env);
	if (disabled && disabled.toLowerCase() === "true") {
		throw new Error("EC2 instance metadata service is disabled via AWS_EC2_METADATA_DISABLED");
	}

	const rawEndpoint =
		getProviderEnvValue("AWS_EC2_METADATA_SERVICE_ENDPOINT", params.env) || "http://169.254.169.254";
	const baseEndpoint = rawEndpoint.replace(/\/+$/, "");
	const cacheKey = `imds:${baseEndpoint}`;
	const cached = getCachedBedrockCredentials(cacheKey);
	if (cached) {
		return cached;
	}

	const fetchFn = params.fetchFn ?? globalThis.fetch;
	const tokenRes = await executeAwsCredentialFetch(
		fetchFn,
		`${baseEndpoint}/latest/api/token`,
		{
			method: "PUT",
			headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
		},
		AWS_IMDS_TIMEOUT_MS,
		params.signal,
	);
	if (!tokenRes.ok) {
		throw new Error(`EC2 IMDSv2 token request failed with HTTP ${tokenRes.status}`);
	}
	const imdsToken = (await tokenRes.text()).trim();
	if (!imdsToken) {
		throw new Error("EC2 IMDSv2 token endpoint returned an empty token");
	}

	const rolesRes = await executeAwsCredentialFetch(
		fetchFn,
		`${baseEndpoint}/latest/meta-data/iam/security-credentials/`,
		{
			method: "GET",
			headers: { "X-aws-ec2-metadata-token": imdsToken },
		},
		AWS_IMDS_TIMEOUT_MS,
		params.signal,
	);
	if (!rolesRes.ok) {
		throw new Error(`EC2 IMDSv2 IAM role listing failed with HTTP ${rolesRes.status}`);
	}
	const rolesText = await rolesRes.text();
	const roleName = rolesText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (!roleName) {
		throw new Error("EC2 IMDSv2 returned no IAM role name");
	}

	const credsRes = await executeAwsCredentialFetch(
		fetchFn,
		`${baseEndpoint}/latest/meta-data/iam/security-credentials/${encodeURIComponent(roleName)}`,
		{
			method: "GET",
			headers: { "X-aws-ec2-metadata-token": imdsToken },
		},
		AWS_IMDS_TIMEOUT_MS,
		params.signal,
	);
	const credsText = await credsRes.text().catch(() => "");
	if (!credsRes.ok) {
		throw new Error(`EC2 IMDSv2 credentials request failed (${credsRes.status}): ${credsText}`);
	}

	const payload = readJsonRecord(credsText, "EC2 IMDSv2 credentials response");
	const code = readOptionalString(payload, "Code");
	if (code && code !== "Success") {
		throw new Error(`EC2 IMDSv2 credentials returned Code=${code}`);
	}
	const accessKeyId = readOptionalString(payload, "AccessKeyId");
	const secretAccessKey = readOptionalString(payload, "SecretAccessKey");
	const sessionToken = readOptionalString(payload, "Token") ?? readOptionalString(payload, "SessionToken");
	if (!accessKeyId || !secretAccessKey) {
		throw new Error("EC2 IMDSv2 credentials missing AccessKeyId or SecretAccessKey");
	}
	const expiresAtMs = parseExpirationMs(payload.Expiration) ?? Date.now() + DEFAULT_STS_EXPIRY_MS;
	return setCachedBedrockCredentials(cacheKey, { accessKeyId, secretAccessKey, sessionToken }, expiresAtMs);
}

function getEnvBedrockCredentials(env?: ProviderEnv): BedrockCredentials | undefined {
	const accessKeyId = getProviderEnvValue("AWS_ACCESS_KEY_ID", env);
	const secretAccessKey = getProviderEnvValue("AWS_SECRET_ACCESS_KEY", env);
	if (!accessKeyId || !secretAccessKey) {
		return undefined;
	}
	const sessionToken = getProviderEnvValue("AWS_SESSION_TOKEN", env);
	return toBedrockCredentials({ accessKeyId, secretAccessKey, sessionToken });
}

function getEffectiveAwsRegion(explicitRegion?: string, profileRegion?: string, env?: ProviderEnv): string {
	return (
		profileRegion ||
		explicitRegion ||
		getProviderEnvValue("AWS_REGION", env) ||
		getProviderEnvValue("AWS_DEFAULT_REGION", env) ||
		"us-east-1"
	);
}

async function resolveProfileCredentials(
	profileName: string,
	params: ResolveBedrockCredentialsParams,
	visited: Set<string>,
): Promise<BedrockCredentials | undefined> {
	if (typeof process === "undefined") {
		return undefined;
	}
	if (visited.has(profileName)) {
		throw new Error(`Circular AWS profile reference detected: ${[...visited, profileName].join(" -> ")}`);
	}
	const nextVisited = new Set(visited);
	nextVisited.add(profileName);

	const { credentials: credsSections, config: configSections } = parseAwsIniFiles({ env: params.env });
	const credsProfile = getIniProfileSection(credsSections, profileName, false);
	const configProfile = getIniProfileSection(configSections, profileName, true);
	if (!credsProfile && !configProfile) {
		return undefined;
	}

	const getAttr = (key: string): string | undefined => credsProfile?.get(key) ?? configProfile?.get(key);
	const profileRegion = configProfile?.get("region") ?? credsProfile?.get("region");
	const stsRegion = getEffectiveAwsRegion(params.region, profileRegion, params.env);
	const fetchFn = params.fetchFn ?? globalThis.fetch;

	// 1. Role assumption (`role_arn` with `web_identity_token_file`, `source_profile`, or `credential_source`)
	const roleArn = getAttr("role_arn");
	if (roleArn) {
		const roleSessionName = getAttr("role_session_name");
		const webIdentityTokenFile = getAttr("web_identity_token_file");
		if (webIdentityTokenFile) {
			const cacheKey = `profile-wi:${profileName}:${roleArn}:${webIdentityTokenFile}:${stsRegion}`;
			const cached = getCachedBedrockCredentials(cacheKey);
			if (cached) return cached;
			const stsCreds = await assumeRoleWithWebIdentity({
				roleArn,
				roleSessionName,
				webIdentityTokenFile,
				region: stsRegion,
				fetchFn,
				signal: params.signal,
			});
			return setCachedBedrockCredentials(
				cacheKey,
				stsCreds,
				parseExpirationMs(stsCreds.expiration) ?? Date.now() + DEFAULT_STS_EXPIRY_MS,
			);
		}

		const externalId = getAttr("external_id");
		const durationRaw = getAttr("duration_seconds");
		const durationSeconds = durationRaw ? Number.parseInt(durationRaw, 10) : undefined;
		const sourceProfile = getAttr("source_profile");
		const credentialSource = getAttr("credential_source");

		let sourceCredentials: BedrockCredentials | undefined;
		if (sourceProfile) {
			sourceCredentials = await resolveProfileCredentials(sourceProfile, params, nextVisited);
			if (!sourceCredentials) {
				throw new Error(
					`AWS profile "${profileName}" references source_profile "${sourceProfile}", which has no credentials`,
				);
			}
		} else if (credentialSource) {
			switch (credentialSource) {
				case "Environment":
					sourceCredentials = params.envCredentials ?? getEnvBedrockCredentials(params.env);
					if (!sourceCredentials) {
						throw new Error(
							`AWS profile "${profileName}" uses credential_source=Environment, but AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are not set`,
						);
					}
					break;
				case "EcsContainer":
					sourceCredentials = await resolveEcsContainerCredentials({
						env: params.env,
						fetchFn,
						signal: params.signal,
					});
					if (!sourceCredentials) {
						throw new Error(
							`AWS profile "${profileName}" uses credential_source=EcsContainer, but ECS container env vars are not set`,
						);
					}
					break;
				case "Ec2InstanceMetadata":
					sourceCredentials = await resolveEc2ImdsV2Credentials({
						env: params.env,
						fetchFn,
						signal: params.signal,
					});
					break;
				default:
					throw new Error(`Unsupported credential_source "${credentialSource}" in AWS profile "${profileName}"`);
			}
		} else {
			throw new Error(
				`AWS profile "${profileName}" specifies role_arn without source_profile, credential_source, or web_identity_token_file`,
			);
		}

		const cacheKey = `profile-role:${profileName}:${roleArn}:${sourceCredentials.accessKeyId}:${sourceProfile ?? credentialSource ?? ""}:${externalId ?? ""}:${stsRegion}`;
		const cached = getCachedBedrockCredentials(cacheKey);
		if (cached) return cached;

		const assumed = await assumeRole({
			roleArn,
			roleSessionName,
			externalId,
			durationSeconds: durationSeconds !== undefined && Number.isFinite(durationSeconds) ? durationSeconds : undefined,
			region: stsRegion,
			sourceCredentials,
			fetchFn,
			signal: params.signal,
		});
		return setCachedBedrockCredentials(
			cacheKey,
			assumed,
			parseExpirationMs(assumed.expiration) ?? Date.now() + DEFAULT_STS_EXPIRY_MS,
		);
	}

	// 2. Static credentials in INI section
	const accessKeyId = getAttr("aws_access_key_id");
	const secretAccessKey = getAttr("aws_secret_access_key");
	if (accessKeyId && secretAccessKey) {
		return toBedrockCredentials({
			accessKeyId,
			secretAccessKey,
			sessionToken: getAttr("aws_session_token"),
		});
	}

	// 3. `credential_process`
	const credentialProcess = getAttr("credential_process");
	if (credentialProcess) {
		const cacheKey = `profile-proc:${profileName}:${credentialProcess}:${getAwsHomeDir(params.env)}`;
		const cached = getCachedBedrockCredentials(cacheKey);
		if (cached) return cached;
		const procCreds = await executeCredentialProcess(credentialProcess, {
			env: params.env,
			signal: params.signal,
		});
		const expMs = parseExpirationMs(procCreds.expiration);
		return expMs !== undefined
			? setCachedBedrockCredentials(cacheKey, procCreds, expMs)
			: toBedrockCredentials(procCreds);
	}

	// 4. AWS SSO (`sso_session` section or legacy `sso_start_url`)
	const ssoSession = getAttr("sso_session");
	const ssoAccountId = getAttr("sso_account_id");
	const ssoRoleName = getAttr("sso_role_name");
	const ssoSection = ssoSession
		? (configSections?.get(`sso-session ${ssoSession}`) ?? credsSections?.get(`sso-session ${ssoSession}`))
		: undefined;
	const ssoStartUrl = ssoSection?.get("sso_start_url") ?? getAttr("sso_start_url");
	const ssoRegion = ssoSection?.get("sso_region") ?? getAttr("sso_region");

	if (ssoSession || ssoStartUrl || ssoAccountId || ssoRoleName) {
		if (!ssoRegion || !ssoAccountId || !ssoRoleName || (!ssoSession && !ssoStartUrl)) {
			throw new Error(
				`Incomplete AWS SSO configuration in profile "${profileName}": requires sso_region, sso_account_id, sso_role_name, and sso_session or sso_start_url`,
			);
		}
		const cacheKey = `profile-sso:${profileName}:${ssoSession ?? ""}:${ssoStartUrl ?? ""}:${ssoRegion}:${ssoAccountId}:${ssoRoleName}:${getAwsHomeDir(params.env)}`;
		const cached = getCachedBedrockCredentials(cacheKey);
		if (cached) return cached;

		const bearerToken = await resolveSsoCachedToken({
			ssoSession,
			ssoStartUrl,
			ssoRegion,
			env: params.env,
			fetchFn,
			signal: params.signal,
		});
		const ssoResult = await fetchSsoRoleCredentials({
			ssoRegion,
			accountId: ssoAccountId,
			roleName: ssoRoleName,
			accessToken: bearerToken,
			fetchFn,
			signal: params.signal,
		});
		return setCachedBedrockCredentials(
			cacheKey,
			ssoResult.credentials,
			ssoResult.expiresAtMs ?? Date.now() + DEFAULT_STS_EXPIRY_MS,
		);
	}

	return undefined;
}

export async function resolveBedrockCredentials(params: ResolveBedrockCredentialsParams): Promise<BedrockCredentials> {
	if (params.signal?.aborted) {
		throw makeAbortError();
	}

	// a) Skip-auth dummy credentials
	if (params.skipAuth) {
		return {
			accessKeyId: "dummy-access-key",
			secretAccessKey: "dummy-secret-key",
		};
	}

	const fetchFn = params.fetchFn ?? globalThis.fetch;

	// b) Explicit profile option / scoped AWS_PROFILE
	if (params.optionsProfile) {
		const fromProfile = await resolveProfileCredentials(params.optionsProfile, params, new Set());
		if (fromProfile) return fromProfile;
		throw new Error(`Could not load AWS credentials for profile "${params.optionsProfile}"`);
	}

	// c) Environment access keys (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)
	const envCreds = params.envCredentials ?? getEnvBedrockCredentials(params.env);
	if (envCreds) {
		return envCreds;
	}

	// d) Environment WebIdentity (AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN)
	const webIdentityTokenFile = getProviderEnvValue("AWS_WEB_IDENTITY_TOKEN_FILE", params.env);
	const webIdentityRoleArn = getProviderEnvValue("AWS_ROLE_ARN", params.env);
	if (webIdentityTokenFile && webIdentityRoleArn) {
		const sessionName = getProviderEnvValue("AWS_ROLE_SESSION_NAME", params.env);
		const stsRegion = getEffectiveAwsRegion(params.region, undefined, params.env);
		const cacheKey = `env-wi:${webIdentityRoleArn}:${webIdentityTokenFile}:${sessionName ?? ""}:${stsRegion}`;
		const cached = getCachedBedrockCredentials(cacheKey);
		if (cached) return cached;
		const stsCreds = await assumeRoleWithWebIdentity({
			roleArn: webIdentityRoleArn,
			roleSessionName: sessionName,
			webIdentityTokenFile,
			region: stsRegion,
			fetchFn,
			signal: params.signal,
		});
		return setCachedBedrockCredentials(
			cacheKey,
			stsCreds,
			parseExpirationMs(stsCreds.expiration) ?? Date.now() + DEFAULT_STS_EXPIRY_MS,
		);
	}

	// e) Active/default INI profile (`ambientProfile || "default"`)
	const profileName = params.ambientProfile || getProviderEnvValue("AWS_PROFILE", params.env) || "default";
	const fromIni = await resolveProfileCredentials(profileName, params, new Set());
	if (fromIni) {
		return fromIni;
	}

	// f) ECS Container Credentials
	const fromEcs = await resolveEcsContainerCredentials({
		env: params.env,
		fetchFn,
		signal: params.signal,
	});
	if (fromEcs) {
		return fromEcs;
	}

	// g) EC2 IMDSv2 (unless AWS_EC2_METADATA_DISABLED === "true")
	const imdsDisabled = getProviderEnvValue("AWS_EC2_METADATA_DISABLED", params.env);
	if (!imdsDisabled || imdsDisabled.toLowerCase() !== "true") {
		try {
			return await resolveEc2ImdsV2Credentials({
				env: params.env,
				fetchFn,
				signal: params.signal,
			});
		} catch (error) {
			if (params.signal?.aborted) {
				throw error;
			}
		}
	}

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
