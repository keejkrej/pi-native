import { createHash, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_GOOGLE_MLDEV_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_GOOGLE_MLDEV_API_VERSION = "v1beta";
const DEFAULT_GOOGLE_VERTEX_API_VERSION = "v1beta1";
const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_GOOGLE_STS_URL = "https://sts.googleapis.com/v1/token";
const GCE_METADATA_TOKEN_URL =
	"http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const MULTI_REGIONAL_LOCATIONS = new Set(["us", "eu"]);
const TOKEN_REFRESH_LEEWAY_MS = 60_000;
const MAX_VERTEX_CREDENTIAL_DEPTH = 8;

export const FinishReason = {
	FINISH_REASON_UNSPECIFIED: "FINISH_REASON_UNSPECIFIED",
	STOP: "STOP",
	MAX_TOKENS: "MAX_TOKENS",
	SAFETY: "SAFETY",
	RECITATION: "RECITATION",
	LANGUAGE: "LANGUAGE",
	OTHER: "OTHER",
	BLOCKLIST: "BLOCKLIST",
	PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
	SPII: "SPII",
	MALFORMED_FUNCTION_CALL: "MALFORMED_FUNCTION_CALL",
	IMAGE_SAFETY: "IMAGE_SAFETY",
	UNEXPECTED_TOOL_CALL: "UNEXPECTED_TOOL_CALL",
	TOO_MANY_TOOL_CALLS: "TOO_MANY_TOOL_CALLS",
	IMAGE_PROHIBITED_CONTENT: "IMAGE_PROHIBITED_CONTENT",
	NO_IMAGE: "NO_IMAGE",
	IMAGE_RECITATION: "IMAGE_RECITATION",
	IMAGE_OTHER: "IMAGE_OTHER",
	CONTINUATION: "CONTINUATION",
} as const;
export type FinishReason = (typeof FinishReason)[keyof typeof FinishReason];

export const FunctionCallingConfigMode = {
	MODE_UNSPECIFIED: "MODE_UNSPECIFIED",
	AUTO: "AUTO",
	ANY: "ANY",
	NONE: "NONE",
	VALIDATED: "VALIDATED",
} as const;
export type FunctionCallingConfigMode =
	(typeof FunctionCallingConfigMode)[keyof typeof FunctionCallingConfigMode];

export const ThinkingLevel = {
	THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
	MINIMAL: "MINIMAL",
	LOW: "LOW",
	MEDIUM: "MEDIUM",
	HIGH: "HIGH",
} as const;
export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];

export const ResourceScope = {
	COLLECTION: "COLLECTION",
} as const;
export type ResourceScope = (typeof ResourceScope)[keyof typeof ResourceScope];

export interface Blob {
	mimeType?: string;
	data?: string;
	displayName?: string;
}

export interface FunctionCall {
	id?: string;
	name?: string;
	args?: Record<string, unknown>;
}

export interface FunctionResponse {
	id?: string;
	name?: string;
	response?: Record<string, unknown>;
	parts?: Part[];
}

export interface Part {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	inlineData?: Blob;
	functionCall?: FunctionCall;
	functionResponse?: FunctionResponse;
}

export interface Content {
	role?: string;
	parts?: Part[];
}

export interface FunctionDeclaration {
	name?: string;
	description?: string;
	parameters?: Record<string, unknown>;
	parametersJsonSchema?: unknown;
}

export interface Tool {
	functionDeclarations?: FunctionDeclaration[];
}

export interface FunctionCallingConfig {
	mode?: FunctionCallingConfigMode;
	allowedFunctionNames?: string[];
}

export interface ToolConfig {
	functionCallingConfig?: FunctionCallingConfig;
}

export interface ThinkingConfig {
	includeThoughts?: boolean;
	thinkingBudget?: number;
	thinkingLevel?: ThinkingLevel;
}

export interface HttpOptions {
	baseUrl?: string;
	baseUrlResourceScope?: ResourceScope;
	apiVersion?: string;
	headers?: Record<string, string>;
	timeout?: number;
	fetch?: typeof globalThis.fetch;
}

export interface GenerateContentConfig {
	temperature?: number;
	topP?: number;
	topK?: number;
	candidateCount?: number;
	maxOutputTokens?: number;
	stopSequences?: string[];
	systemInstruction?: Content | string;
	tools?: Tool[];
	toolConfig?: ToolConfig;
	thinkingConfig?: ThinkingConfig;
	safetySettings?: unknown[];
	labels?: Record<string, string>;
	serviceTier?: string;
	cachedContent?: string;
	continuationToken?: string;
	store?: boolean;
	abortSignal?: AbortSignal;
	httpOptions?: HttpOptions;
	automaticContinuation?: boolean;
	[key: string]: unknown;
}

export interface GenerateContentParameters {
	model: string;
	contents: Content[] | Content | string;
	config?: GenerateContentConfig;
}

export interface Candidate {
	index?: number;
	content?: Content;
	finishReason?: FinishReason;
	finishMessage?: string;
}

export interface UsageMetadata {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	thoughtsTokenCount?: number;
	totalTokenCount?: number;
	cachedContentTokenCount?: number;
	trafficType?: string;
}

export interface GenerateContentResponse {
	candidates?: Candidate[];
	usageMetadata?: UsageMetadata;
	responseId?: string;
	modelVersion?: string;
}

export interface GoogleAuthOptions {
	keyFilename?: string;
}

export interface GoogleGenAIClientOptions {
	apiKey?: string;
	vertexai?: boolean;
	project?: string;
	location?: string;
	apiVersion?: string;
	googleAuthOptions?: GoogleAuthOptions;
	httpOptions?: HttpOptions;
}

export class GoogleAPIError extends Error {
	readonly status: number | undefined;
	readonly headers: Headers | undefined;
	readonly error: unknown;
	override readonly cause?: unknown;

	constructor(options: {
		message: string;
		status?: number;
		headers?: Headers;
		error?: unknown;
		cause?: unknown;
	}) {
		super(options.message);
		this.name = "GoogleAPIError";
		this.status = options.status;
		this.headers = options.headers;
		this.error = options.error;
		if (options.cause !== undefined) {
			this.cause = options.cause;
		}
	}
}

export interface CachedAccessToken {
	token: string;
	expiresAtMs: number;
}

export interface ServiceAccountCredentials {
	type: "service_account";
	client_email: string;
	private_key: string;
	private_key_id?: string;
	token_uri?: string;
}

export interface AuthorizedUserCredentials {
	type: "authorized_user";
	client_id: string;
	client_secret: string;
	refresh_token: string;
	token_uri?: string;
}

export interface ExternalAccountCredentialSourceFormat {
	type?: "text" | "json" | string;
	subject_token_field_name?: string;
}

export interface ExternalAccountCredentialSource {
	file?: string;
	url?: string;
	headers?: Record<string, string>;
	format?: ExternalAccountCredentialSourceFormat;
}

export interface ExternalAccountCredentials {
	type: "external_account";
	audience: string;
	subject_token_type: string;
	token_url?: string;
	credential_source: ExternalAccountCredentialSource;
	service_account_impersonation_url?: string;
	service_account_impersonation?: {
		token_lifetime_seconds?: number;
	};
}

export interface ImpersonatedServiceAccountCredentials {
	type: "impersonated_service_account";
	service_account_impersonation_url: string;
	source_credentials: ParsedVertexCredentials;
	delegates?: string[];
	service_account_impersonation?: {
		token_lifetime_seconds?: number;
	};
}

export interface ParsedVertexCredentials {
	type?: unknown;
	client_email?: string;
	private_key?: string;
	private_key_id?: string;
	client_id?: string;
	client_secret?: string;
	refresh_token?: string;
	token_uri?: string;
	service_account_impersonation_url?: string;
	source_credentials?: ParsedVertexCredentials;
	delegates?: string[];
	audience?: string;
	subject_token_type?: string;
	token_url?: string;
	credential_source?: ExternalAccountCredentialSource;
	service_account_impersonation?: {
		token_lifetime_seconds?: number;
	};
}

export interface ExchangeImpersonatedTokenParams {
	impersonationUrl: string;
	sourceToken: string;
	delegates?: string[];
	lifetimeSeconds?: number;
	fetchFn?: typeof globalThis.fetch;
	signal?: AbortSignal;
}

const vertexTokenCache = new Map<string, CachedAccessToken>();
const vertexTokenInFlight = new Map<string, Promise<string>>();

export class GoogleGenAI {
	readonly vertexai: boolean;
	readonly apiKey: string | undefined;
	readonly project: string | undefined;
	readonly location: string | undefined;
	readonly apiVersion: string | undefined;
	readonly googleAuthOptions: GoogleAuthOptions | undefined;
	readonly httpOptions: HttpOptions | undefined;
	readonly models: {
		generateContentStream: (
			params: GenerateContentParameters,
		) => Promise<AsyncGenerator<GenerateContentResponse>>;
	};

	constructor(options: GoogleGenAIClientOptions = {}) {
		this.vertexai = options.vertexai ?? false;
		this.apiKey = options.apiKey;
		this.project = options.project;
		this.location = options.location;
		this.apiVersion = options.apiVersion;
		this.googleAuthOptions = options.googleAuthOptions;
		this.httpOptions = options.httpOptions;
		this.models = {
			generateContentStream: (params) => this.generateContentStream(params),
		};
	}

	private async generateContentStream(
		params: GenerateContentParameters,
	): Promise<AsyncGenerator<GenerateContentResponse>> {
		const mergedHttp = mergeHttpOptions(this.httpOptions, params.config?.httpOptions);
		const fetchFn = mergedHttp.fetch ?? globalThis.fetch;
		const signal = params.config?.abortSignal;
		const url = this.vertexai
			? buildVertexStreamUrl(params.model, mergedHttp, this.apiVersion, this.project, this.location)
			: buildMldevStreamUrl(params.model, mergedHttp, this.apiVersion);
		const headers = await this.buildHeaders(mergedHttp, fetchFn, signal);
		const body = JSON.stringify(serializeGenerateContentRequest(params));

		const response = await executeGoogleFetch(fetchFn, url, { method: "POST", headers, body }, mergedHttp.timeout, signal);
		if (!response.ok) {
			const errorBody = await readResponseTextSafe(response);
			const statusText = response.statusText || "Error";
			const message = errorBody
				? `got status: ${response.status} ${statusText}. ${errorBody}`
				: `got status: ${response.status} ${statusText}.`;
			throw new GoogleAPIError({
				message,
				status: response.status,
				headers: response.headers,
				error: parseJsonSafe(errorBody),
			});
		}

		if (!response.body) {
			throw new GoogleAPIError({
				message: "Attempted to iterate over a Google AI response with no body",
				status: response.status,
				headers: response.headers,
			});
		}

		return iterateGoogleSse(response.body, signal);
	}

	private async buildHeaders(
		httpOptions: HttpOptions,
		fetchFn: typeof globalThis.fetch,
		signal?: AbortSignal,
	): Promise<Headers> {
		const headers = new Headers();
		headers.set("accept", "application/json, text/event-stream");
		headers.set("content-type", "application/json");

		if (httpOptions.headers) {
			for (const name of Object.keys(httpOptions.headers)) {
				const value = httpOptions.headers[name];
				if (value !== undefined) {
					headers.set(name, value);
				}
			}
		}

		const hasCallerAuth = headers.has("authorization") || headers.has("x-goog-api-key");
		if (!hasCallerAuth) {
			if (this.apiKey) {
				headers.set("x-goog-api-key", this.apiKey);
			} else if (this.vertexai) {
				const token = await resolveVertexAccessToken(this.googleAuthOptions?.keyFilename, fetchFn, signal);
				headers.set("authorization", `Bearer ${token}`);
			}
		}

		return headers;
	}
}

function mergeHttpOptions(base?: HttpOptions, override?: HttpOptions): HttpOptions {
	if (!base && !override) {
		return {};
	}
	const headers =
		base?.headers || override?.headers
			? { ...(base?.headers ?? {}), ...(override?.headers ?? {}) }
			: undefined;
	return {
		...base,
		...override,
		...(headers ? { headers } : {}),
	};
}

function trimTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 47) {
		end--;
	}
	return value.slice(0, end);
}

function transformModelPath(model: string, isVertex: boolean): string {
	if (!model || typeof model !== "string") {
		throw new Error("model is required and must be a string");
	}
	if (model.includes("..") || model.includes("?") || model.includes("&")) {
		throw new Error("invalid model parameter");
	}
	if (isVertex) {
		if (
			model.startsWith("publishers/") ||
			model.startsWith("projects/") ||
			model.startsWith("models/")
		) {
			return model;
		}
		const slashIdx = model.indexOf("/");
		if (slashIdx >= 0) {
			const publisher = model.slice(0, slashIdx);
			const name = model.slice(slashIdx + 1);
			return `publishers/${publisher}/models/${name}`;
		}
		return `publishers/google/models/${model}`;
	}
	if (model.startsWith("models/") || model.startsWith("tunedModels/")) {
		return model;
	}
	return `models/${model}`;
}

export function buildMldevStreamUrl(
	model: string,
	httpOptions?: HttpOptions,
	clientApiVersion?: string,
): string {
	const rawBaseUrl = httpOptions?.baseUrl?.trim() || DEFAULT_GOOGLE_MLDEV_BASE_URL;
	const baseUrl = trimTrailingSlashes(rawBaseUrl);
	const apiVersion =
		httpOptions?.apiVersion !== undefined
			? httpOptions.apiVersion
			: (clientApiVersion ?? DEFAULT_GOOGLE_MLDEV_API_VERSION);
	const modelPath = transformModelPath(model, false);
	const prefix = apiVersion ? `${baseUrl}/${apiVersion}` : baseUrl;
	return `${prefix}/${modelPath}:streamGenerateContent?alt=sse`;
}

export function buildVertexStreamUrl(
	model: string,
	httpOptions?: HttpOptions,
	clientApiVersion?: string,
	project?: string,
	location?: string,
): string {
	const rawBaseUrl = httpOptions?.baseUrl?.trim();
	let baseUrl: string;
	if (rawBaseUrl) {
		baseUrl = trimTrailingSlashes(rawBaseUrl);
	} else if (location === "global" || !project || !location) {
		baseUrl = "https://aiplatform.googleapis.com";
	} else if (MULTI_REGIONAL_LOCATIONS.has(location)) {
		baseUrl = `https://aiplatform.${location}.rep.googleapis.com`;
	} else {
		baseUrl = `https://${location}-aiplatform.googleapis.com`;
	}

	const apiVersion =
		httpOptions?.apiVersion !== undefined
			? httpOptions.apiVersion
			: (clientApiVersion ?? DEFAULT_GOOGLE_VERTEX_API_VERSION);
	const prefix = apiVersion ? `${baseUrl}/${apiVersion}` : baseUrl;
	const modelPath = transformModelPath(model, true);
	const shouldPrependProject =
		httpOptions?.baseUrlResourceScope !== ResourceScope.COLLECTION &&
		Boolean(project) &&
		Boolean(location) &&
		!modelPath.startsWith("projects/");
	const resourcePath = shouldPrependProject
		? `projects/${project}/locations/${location}/${modelPath}`
		: modelPath;
	return `${prefix}/${resourcePath}:streamGenerateContent?alt=sse`;
}

const TOP_LEVEL_CONFIG_FIELDS = new Set([
	"systemInstruction",
	"tools",
	"toolConfig",
	"safetySettings",
	"cachedContent",
	"labels",
	"serviceTier",
	"continuationToken",
	"store",
]);

const CLIENT_ONLY_CONFIG_FIELDS = new Set(["abortSignal", "httpOptions", "automaticContinuation"]);

function normalizeContentItem(item: Content | string): Content {
	if (typeof item === "string") {
		return { role: "user", parts: [{ text: item }] };
	}
	return item;
}

export function serializeGenerateContentRequest(params: GenerateContentParameters): Record<string, unknown> {
	const body: Record<string, unknown> = {};

	if (typeof params.contents === "string") {
		body.contents = [normalizeContentItem(params.contents)];
	} else if (Array.isArray(params.contents)) {
		body.contents = params.contents.map((item) => normalizeContentItem(item));
	} else {
		body.contents = [normalizeContentItem(params.contents)];
	}

	const config = params.config;
	if (config) {
		const generationConfig: Record<string, unknown> = {};
		for (const key of Object.keys(config)) {
			const value = config[key];
			if (value === undefined || value === null || CLIENT_ONLY_CONFIG_FIELDS.has(key)) {
				continue;
			}
			if (TOP_LEVEL_CONFIG_FIELDS.has(key)) {
				body[key] = key === "systemInstruction" ? normalizeContentItem(value as Content | string) : value;
			} else {
				generationConfig[key] = value;
			}
		}
		if (Object.keys(generationConfig).length > 0) {
			body.generationConfig = generationConfig;
		}
	}

	return body;
}

async function* iterateGoogleSse(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<GenerateContentResponse> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const onAbort = () => {
		if (reader.cancel) {
			void reader.cancel(signal?.reason).catch(() => {});
		}
	};
	if (signal) {
		if (signal.aborted) {
			onAbort();
			throw makeGoogleAbortError(signal.reason);
		}
		signal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		while (true) {
			if (signal?.aborted) {
				throw makeGoogleAbortError(signal.reason);
			}
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			if (!value) {
				continue;
			}
			buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
			let separatorIdx = buffer.indexOf("\n\n");
			while (separatorIdx !== -1) {
				const rawEvent = buffer.slice(0, separatorIdx);
				buffer = buffer.slice(separatorIdx + 2);
				const parsed = parseSseEvent(rawEvent);
				if (parsed === "DONE") {
					return;
				}
				if (parsed !== undefined) {
					yield parsed;
				}
				separatorIdx = buffer.indexOf("\n\n");
			}
		}

		buffer += decoder.decode().replace(/\r\n/g, "\n");
		if (buffer.trim().length > 0) {
			const parsed = parseSseEvent(buffer);
			if (parsed !== undefined && parsed !== "DONE") {
				yield parsed;
			}
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		reader.releaseLock();
	}
}

function parseSseEvent(rawEvent: string): GenerateContentResponse | "DONE" | undefined {
	const dataLines: string[] = [];
	for (const line of rawEvent.split("\n")) {
		if (!line || line.startsWith(":")) {
			continue;
		}
		if (line.startsWith("data:")) {
			const content = line.slice(5);
			dataLines.push(content.startsWith(" ") ? content.slice(1) : content);
		}
	}
	if (dataLines.length === 0) {
		return undefined;
	}
	const payload = dataLines.join("\n").trim();
	if (!payload) {
		return undefined;
	}
	if (payload === "[DONE]") {
		return "DONE";
	}
	return JSON.parse(payload) as GenerateContentResponse;
}

/** Clears the in-memory Google Vertex AI OAuth token cache (intended for tests). */
export function clearVertexTokenCache(): void {
	vertexTokenCache.clear();
}

function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

function extractSubjectToken(rawContent: string, format: ExternalAccountCredentialSourceFormat | undefined): string {
	const isJsonFormat = format?.type === "json" || (format?.type === undefined && Boolean(format?.subject_token_field_name));
	if (isJsonFormat) {
		const fieldName = format?.subject_token_field_name;
		if (!fieldName) {
			throw new Error("Vertex AI external_account JSON credential_source requires format.subject_token_field_name.");
		}
		const parsed = parseJsonSafe(rawContent);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Vertex AI external_account credential_source did not return a JSON object.");
		}
		const record = parsed as Record<string, unknown>;
		const tokenValue = record[fieldName];
		if (typeof tokenValue !== "string" || !tokenValue.trim()) {
			throw new Error(`Vertex AI external_account credential_source missing string field "${fieldName}".`);
		}
		return tokenValue.trim();
	}

	const trimmed = rawContent.trim();
	if (!trimmed) {
		throw new Error("Vertex AI external_account credential_source returned an empty subject token.");
	}
	return trimmed;
}

/** Exchanges an external Workload Identity subject token via Google STS (and optional IAM impersonation). */
export async function resolveExternalAccountToken(
	creds: ExternalAccountCredentials,
	fetchFn: typeof globalThis.fetch = globalThis.fetch,
	signal?: AbortSignal,
): Promise<CachedAccessToken> {
	const source = creds.credential_source;
	let rawSubject: string;
	if (source.file) {
		try {
			rawSubject = await readFile(source.file, "utf8");
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to read external_account subject token file at ${source.file}: ${msg}`, { cause: error });
		}
	} else if (source.url) {
		const headers = new Headers();
		if (source.headers) {
			for (const key of Object.keys(source.headers)) {
				const value = source.headers[key];
				if (typeof value === "string") {
					headers.set(key, value);
				}
			}
		}
		const response = await executeGoogleFetch(fetchFn, source.url, { method: "GET", headers }, 10_000, signal);
		if (!response.ok) {
			const text = await readResponseTextSafe(response);
			throw new GoogleAPIError({
				message: `Failed to fetch external_account subject token (${response.status}): ${text}`,
				status: response.status,
				headers: response.headers,
				error: parseJsonSafe(text),
			});
		}
		rawSubject = await response.text();
	} else {
		throw new Error("Vertex AI external_account credential_source must specify file or url.");
	}

	const subjectToken = extractSubjectToken(rawSubject, source.format);
	const tokenUrl = creds.token_url || DEFAULT_GOOGLE_STS_URL;
	const form = new URLSearchParams({
		grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
		audience: creds.audience,
		scope: VERTEX_SCOPE,
		requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
		subject_token: subjectToken,
		subject_token_type: creds.subject_token_type,
	});
	const stsToken = await requestOAuthToken(tokenUrl, form.toString(), fetchFn, signal);

	if (creds.service_account_impersonation_url) {
		return await exchangeImpersonatedToken({
			impersonationUrl: creds.service_account_impersonation_url,
			sourceToken: stsToken.token,
			lifetimeSeconds: creds.service_account_impersonation?.token_lifetime_seconds,
			fetchFn,
			signal,
		});
	}

	return stsToken;
}

/** Exchanges a source bearer token for an impersonated service account access token via IAM Credentials API. */
export async function exchangeImpersonatedToken(
	params: ExchangeImpersonatedTokenParams,
): Promise<CachedAccessToken> {
	const fetchFn = params.fetchFn ?? globalThis.fetch;
	const lifetimeSec =
		params.lifetimeSeconds !== undefined && params.lifetimeSeconds > 0 ? Math.floor(params.lifetimeSeconds) : 3600;
	const bodyPayload: Record<string, unknown> = {
		scope: [VERTEX_SCOPE],
		lifetime: `${lifetimeSec}s`,
	};
	if (params.delegates !== undefined) {
		bodyPayload.delegates = params.delegates;
	}

	const headers = new Headers({
		"content-type": "application/json",
		authorization: `Bearer ${params.sourceToken}`,
	});

	const response = await executeGoogleFetch(
		fetchFn,
		params.impersonationUrl,
		{
			method: "POST",
			headers,
			body: JSON.stringify(bodyPayload),
		},
		30_000,
		params.signal,
	);
	if (!response.ok) {
		const text = await readResponseTextSafe(response);
		throw new GoogleAPIError({
			message: `Failed to exchange impersonated service account token (${response.status}): ${text}`,
			status: response.status,
			headers: response.headers,
			error: parseJsonSafe(text),
		});
	}

	const payload = (await response.json()) as { accessToken?: unknown; expireTime?: unknown };
	if (typeof payload.accessToken !== "string" || !payload.accessToken) {
		throw new Error("Google IAM Credentials generateAccessToken endpoint did not return an accessToken.");
	}
	const parsedExpireMs = typeof payload.expireTime === "string" ? Date.parse(payload.expireTime) : Number.NaN;
	const expiresAtMs = Number.isFinite(parsedExpireMs) ? parsedExpireMs : Date.now() + lifetimeSec * 1000;
	return { token: payload.accessToken, expiresAtMs };
}

/** Resolves and caches an access token from a parsed Google ADC / credentials JSON object. */
export async function resolveVertexCredentialsObject(
	parsed: ParsedVertexCredentials,
	fetchFn: typeof globalThis.fetch = globalThis.fetch,
	signal?: AbortSignal,
	sourceLabel = "Vertex AI ADC",
	depth = 0,
): Promise<string> {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid Vertex AI credentials JSON object in ${sourceLabel}`);
	}
	if (depth > MAX_VERTEX_CREDENTIAL_DEPTH) {
		throw new Error(`Maximum Vertex AI credential delegation depth (${MAX_VERTEX_CREDENTIAL_DEPTH}) exceeded.`);
	}

	if (parsed.type === "service_account" && parsed.client_email && parsed.private_key) {
		const creds: ServiceAccountCredentials = {
			type: "service_account",
			client_email: parsed.client_email,
			private_key: parsed.private_key,
			private_key_id: parsed.private_key_id,
			token_uri: parsed.token_uri,
		};
		return await getCachedOrMintToken(
			`sa:${creds.client_email}:${creds.private_key_id ?? ""}:${creds.token_uri ?? ""}`,
			() => exchangeServiceAccountJwt(creds, fetchFn, signal),
		);
	}

	if (parsed.type === "authorized_user" && parsed.client_id && parsed.client_secret && parsed.refresh_token) {
		const creds: AuthorizedUserCredentials = {
			type: "authorized_user",
			client_id: parsed.client_id,
			client_secret: parsed.client_secret,
			refresh_token: parsed.refresh_token,
			token_uri: parsed.token_uri,
		};
		return await getCachedOrMintToken(
			`user:${creds.client_id}:${creds.refresh_token.slice(-12)}:${creds.token_uri ?? ""}`,
			() => exchangeRefreshToken(creds, fetchFn, signal),
		);
	}

	if (
		parsed.type === "impersonated_service_account" &&
		typeof parsed.service_account_impersonation_url === "string" &&
		parsed.service_account_impersonation_url.length > 0 &&
		parsed.source_credentials &&
		typeof parsed.source_credentials === "object" &&
		!Array.isArray(parsed.source_credentials)
	) {
		const impersonationUrl = parsed.service_account_impersonation_url;
		const sourceCredentials = parsed.source_credentials;
		const delegates = Array.isArray(parsed.delegates)
			? parsed.delegates.filter((item): item is string => typeof item === "string")
			: undefined;
		const lifetimeSeconds = parsed.service_account_impersonation?.token_lifetime_seconds;
		const cacheKey = `imp:${impersonationUrl}:${sha256Hex(JSON.stringify(parsed))}`;
		return await getCachedOrMintToken(cacheKey, async () => {
			const sourceToken = await resolveVertexCredentialsObject(
				sourceCredentials,
				fetchFn,
				signal,
				`${sourceLabel} > source_credentials`,
				depth + 1,
			);
			return await exchangeImpersonatedToken({
				impersonationUrl,
				sourceToken,
				delegates,
				lifetimeSeconds,
				fetchFn,
				signal,
			});
		});
	}

	if (
		parsed.type === "external_account" &&
		typeof parsed.audience === "string" &&
		parsed.audience.length > 0 &&
		typeof parsed.subject_token_type === "string" &&
		parsed.subject_token_type.length > 0 &&
		parsed.credential_source &&
		typeof parsed.credential_source === "object" &&
		!Array.isArray(parsed.credential_source)
	) {
		const creds: ExternalAccountCredentials = {
			type: "external_account",
			audience: parsed.audience,
			subject_token_type: parsed.subject_token_type,
			token_url: parsed.token_url,
			credential_source: parsed.credential_source,
			service_account_impersonation_url: parsed.service_account_impersonation_url,
			service_account_impersonation: parsed.service_account_impersonation,
		};
		const cacheKey = `ext:${creds.audience}:${sha256Hex(JSON.stringify(parsed))}`;
		return await getCachedOrMintToken(cacheKey, () => resolveExternalAccountToken(creds, fetchFn, signal));
	}

	throw new Error(`Unsupported Vertex AI credential type "${String(parsed.type)}" in ${sourceLabel}`);
}

export async function resolveVertexAccessToken(
	explicitKeyFilename: string | undefined,
	fetchFn: typeof globalThis.fetch = globalThis.fetch,
	signal?: AbortSignal,
): Promise<string> {
	const envKeyFilename = typeof process !== "undefined" ? process.env.GOOGLE_APPLICATION_CREDENTIALS : undefined;
	const configuredPath = explicitKeyFilename || envKeyFilename;
	const credPath = configuredPath || resolveWellKnownAdcPath();
	if (credPath) {
		let rawCreds: string | undefined;
		try {
			rawCreds = await readFile(credPath, "utf8");
		} catch (error) {
			if (configuredPath) {
				const msg = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to read Vertex AI credentials at ${credPath}: ${msg}`, { cause: error });
			}
		}
		if (rawCreds !== undefined) {
			const parsed = JSON.parse(rawCreds) as ParsedVertexCredentials;
			return await resolveVertexCredentialsObject(parsed, fetchFn, signal, credPath, 0);
		}
	}

	return await getCachedOrMintToken("gce-metadata", () => fetchMetadataServerToken(fetchFn, signal));
}

function resolveWellKnownAdcPath(): string | undefined {
	const configDir = typeof process !== "undefined" ? process.env.CLOUDSDK_CONFIG : undefined;
	if (configDir) {
		return join(configDir, "application_default_credentials.json");
	}
	if (typeof process !== "undefined" && process.platform === "win32" && process.env.APPDATA) {
		return join(process.env.APPDATA, "gcloud", "application_default_credentials.json");
	}
	const home = homedir();
	return home ? join(home, ".config", "gcloud", "application_default_credentials.json") : undefined;
}

async function getCachedOrMintToken(cacheKey: string, mint: () => Promise<CachedAccessToken>): Promise<string> {
	const cached = vertexTokenCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAtMs - TOKEN_REFRESH_LEEWAY_MS) {
		return cached.token;
	}
	const existing = vertexTokenInFlight.get(cacheKey);
	if (existing) {
		return await existing;
	}
	const pending = mint()
		.then((entry) => {
			vertexTokenCache.set(cacheKey, entry);
			return entry.token;
		})
		.finally(() => {
			vertexTokenInFlight.delete(cacheKey);
		});
	vertexTokenInFlight.set(cacheKey, pending);
	return await pending;
}

function toBase64Url(input: string | Buffer): string {
	const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

async function exchangeServiceAccountJwt(
	creds: ServiceAccountCredentials,
	fetchFn: typeof globalThis.fetch,
	signal?: AbortSignal,
): Promise<CachedAccessToken> {
	const nowSec = Math.floor(Date.now() / 1000);
	const tokenUri = creds.token_uri || DEFAULT_OAUTH_TOKEN_URI;
	const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
	if (creds.private_key_id) {
		header.kid = creds.private_key_id;
	}
	const payload = {
		iss: creds.client_email,
		scope: VERTEX_SCOPE,
		aud: tokenUri,
		iat: nowSec,
		exp: nowSec + 3600,
	};
	const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
	const signer = createSign("RSA-SHA256");
	signer.update(signingInput);
	signer.end();
	const signature = toBase64Url(signer.sign(creds.private_key));
	const assertion = `${signingInput}.${signature}`;

	const form = new URLSearchParams({
		grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
		assertion,
	});
	return await requestOAuthToken(tokenUri, form.toString(), fetchFn, signal);
}

async function exchangeRefreshToken(
	creds: AuthorizedUserCredentials,
	fetchFn: typeof globalThis.fetch,
	signal?: AbortSignal,
): Promise<CachedAccessToken> {
	const tokenUri = creds.token_uri || DEFAULT_OAUTH_TOKEN_URI;
	const form = new URLSearchParams({
		grant_type: "refresh_token",
		client_id: creds.client_id,
		client_secret: creds.client_secret,
		refresh_token: creds.refresh_token,
	});
	return await requestOAuthToken(tokenUri, form.toString(), fetchFn, signal);
}

async function requestOAuthToken(
	tokenUri: string,
	body: string,
	fetchFn: typeof globalThis.fetch,
	signal?: AbortSignal,
): Promise<CachedAccessToken> {
	const response = await executeGoogleFetch(
		fetchFn,
		tokenUri,
		{
			method: "POST",
			headers: new Headers({ "content-type": "application/x-www-form-urlencoded" }),
			body,
		},
		30_000,
		signal,
	);
	if (!response.ok) {
		const text = await readResponseTextSafe(response);
		throw new GoogleAPIError({
			message: `Failed to exchange Google Vertex OAuth token (${response.status}): ${text}`,
			status: response.status,
			headers: response.headers,
			error: parseJsonSafe(text),
		});
	}
	const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
	if (typeof payload.access_token !== "string" || !payload.access_token) {
		throw new Error("Google OAuth token endpoint did not return an access_token.");
	}
	const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 3600;
	return { token: payload.access_token, expiresAtMs: Date.now() + expiresIn * 1000 };
}

async function fetchMetadataServerToken(
	fetchFn: typeof globalThis.fetch,
	signal?: AbortSignal,
): Promise<CachedAccessToken> {
	let response: Response;
	try {
		response = await executeGoogleFetch(
			fetchFn,
			GCE_METADATA_TOKEN_URL,
			{
				method: "GET",
				headers: new Headers({ "Metadata-Flavor": "Google" }),
			},
			2_000,
			signal,
		);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Vertex AI Application Default Credentials not found (checked GOOGLE_APPLICATION_CREDENTIALS, gcloud ADC, and GCE metadata server: ${reason}).`,
			{ cause: error },
		);
	}
	if (!response.ok) {
		const text = await readResponseTextSafe(response);
		throw new Error(
			`Vertex AI metadata token request failed (${response.status}): ${text || response.statusText}`,
		);
	}
	const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
	if (typeof payload.access_token !== "string" || !payload.access_token) {
		throw new Error("GCE metadata token endpoint did not return an access_token.");
	}
	const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 3600;
	return { token: payload.access_token, expiresAtMs: Date.now() + expiresIn * 1000 };
}

async function executeGoogleFetch(
	fetchFn: typeof globalThis.fetch,
	url: string,
	init: { method: string; headers: Headers; body?: string },
	timeoutMs: number | undefined,
	callerSignal?: AbortSignal,
): Promise<Response> {
	if (callerSignal?.aborted) {
		throw makeGoogleAbortError(callerSignal.reason);
	}

	const controller = new AbortController();
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	if (timeoutMs !== undefined && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
	}

	const onAbort = () => controller.abort();
	if (callerSignal) {
		callerSignal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		return await fetchFn.call(undefined, url, {
			method: init.method,
			headers: init.headers,
			...(init.body !== undefined ? { body: init.body } : {}),
			signal: controller.signal,
		});
	} catch (error) {
		if (callerSignal?.aborted) {
			throw makeGoogleAbortError(callerSignal.reason);
		}
		const message = timedOut
			? "Request timed out."
			: error instanceof Error
				? error.message || "Connection error."
				: String(error);
		throw new GoogleAPIError({
			message,
			status: undefined,
			headers: undefined,
			cause: error,
		});
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		callerSignal?.removeEventListener("abort", onAbort);
	}
}

function makeGoogleAbortError(reason?: unknown): Error {
	if (reason instanceof Error && reason.name === "AbortError") {
		return reason;
	}
	const err = new Error("Request was aborted.");
	err.name = "AbortError";
	if (reason !== undefined) {
		(err as Error & { cause?: unknown }).cause = reason;
	}
	return err;
}

async function readResponseTextSafe(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function parseJsonSafe(text: string): unknown {
	if (!text) {
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
