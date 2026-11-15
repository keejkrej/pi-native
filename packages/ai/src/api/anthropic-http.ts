import { readFile } from "node:fs/promises";
import type { AnthropicFederationConfig, MessageCreateParamsStreaming } from "./anthropic-wire-types.ts";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 600_000;
const OIDC_FEDERATION_BETA = "oauth-2025-04-20,oidc-federation-2026-04-01";
const MAX_ASSERTION_BYTES = 16 * 1024;
const TOKEN_REFRESH_LEEWAY_MS = 60_000;

export type AnthropicHeaderMap = Record<string, string | null | undefined>;

export interface AnthropicClientOptions {
	apiKey?: string | null;
	authToken?: string | null;
	baseURL?: string | null;
	timeout?: number;
	maxRetries?: number;
	dangerouslyAllowBrowser?: boolean;
	fetch?: typeof globalThis.fetch;
	defaultHeaders?: AnthropicHeaderMap;
	config?: AnthropicFederationConfig;
}

export interface AnthropicRequestOptions {
	signal?: AbortSignal;
	timeout?: number;
	maxRetries?: number;
	headers?: AnthropicHeaderMap;
}

export interface AnthropicBetaMessagesResource {
	create(
		params: MessageCreateParamsStreaming,
		options?: AnthropicRequestOptions,
	): { asResponse(): Promise<Response> };
}

export interface AnthropicClientLike {
	beta: {
		messages: AnthropicBetaMessagesResource;
	};
}

interface FederationTokenState {
	accessToken: string;
	expiresAtMs: number;
}

class FederationTokenCache {
	private cached: FederationTokenState | undefined;
	private inFlight: Promise<string> | undefined;
	private readonly config: AnthropicFederationConfig;
	private readonly baseURL: string;
	private readonly fetchFn: typeof globalThis.fetch;

	constructor(
		config: AnthropicFederationConfig,
		baseURL: string,
		fetchFn: typeof globalThis.fetch,
	) {
		this.config = config;
		this.baseURL = baseURL;
		this.fetchFn = fetchFn;
	}

	invalidate(): void {
		this.cached = undefined;
	}

	async getToken(signal?: AbortSignal): Promise<string> {
		const now = Date.now();
		if (this.cached && now < this.cached.expiresAtMs - TOKEN_REFRESH_LEEWAY_MS) {
			return this.cached.accessToken;
		}
		if (!this.inFlight) {
			this.inFlight = this.exchangeToken(signal).finally(() => {
				this.inFlight = undefined;
			});
		}
		return await this.inFlight;
	}

	private async exchangeToken(signal?: AbortSignal): Promise<string> {
		const tokenUrl = resolveFederationTokenUrl(this.baseURL);
		const assertion = await readFederationAssertion(this.config.authentication.identity_token.path);
		const body: Record<string, string> = {
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion,
			federation_rule_id: this.config.authentication.federation_rule_id,
			organization_id: this.config.organization_id,
		};
		if (this.config.authentication.service_account_id) {
			body.service_account_id = this.config.authentication.service_account_id;
		}
		if (this.config.workspace_id) {
			body.workspace_id = this.config.workspace_id;
		}

		const response = await this.fetchFn.call(undefined, tokenUrl, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"anthropic-beta": OIDC_FEDERATION_BETA,
			},
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const errorBody = await readResponseBodySafe(response);
			const parsed = parseJsonSafe(errorBody);
			throw AnthropicAPIError.generate(
				response.status,
				parsed,
				parsed !== undefined ? undefined : errorBody,
				response.headers,
			);
		}

		const payload = (await response.json()) as {
			access_token?: unknown;
			expires_in?: unknown;
		};
		if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
			throw new AnthropicAPIError(
				undefined,
				payload,
				"OIDC federation token exchange did not return an access_token.",
				response.headers,
			);
		}
		const expiresInSec = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 3600;
		this.cached = {
			accessToken: payload.access_token,
			expiresAtMs: Date.now() + expiresInSec * 1000,
		};
		return payload.access_token;
	}
}

export class AnthropicAPIError extends Error {
	readonly status: number | undefined;
	readonly headers: Headers | undefined;
	readonly error: unknown;
	readonly type: string | null;
	readonly requestID: string | null | undefined;
	readonly workspaceID: string | null | undefined;
	override readonly cause?: unknown;

	constructor(
		status: number | undefined,
		error: unknown,
		message: string | undefined,
		headers: Headers | undefined,
		type?: string | null,
		cause?: unknown,
	) {
		super(AnthropicAPIError.makeMessage(status, error, message));
		this.name = "AnthropicAPIError";
		this.status = status;
		this.headers = headers;
		this.error = error;
		this.type = type ?? extractAnthropicErrorType(error) ?? null;
		this.requestID = headers?.get("request-id");
		this.workspaceID = headers?.get("anthropic-workspace-id");
		if (cause !== undefined) {
			this.cause = cause;
		}
	}

	static makeMessage(status: number | undefined, error: unknown, message: string | undefined): string {
		let msg: string | undefined;
		if (error && typeof error === "object" && "message" in error && (error as { message?: unknown }).message != null) {
			const raw = (error as { message: unknown }).message;
			msg = typeof raw === "string" ? raw : JSON.stringify(raw);
		} else if (error !== undefined && error !== null) {
			msg = JSON.stringify(error);
		} else {
			msg = message;
		}
		if (status && msg) {
			return `${status} ${msg}`;
		}
		if (status) {
			return `${status} status code (no body)`;
		}
		if (msg) {
			return msg;
		}
		return "(no status code or body)";
	}

	static generate(
		status: number | undefined,
		errorResponse: unknown,
		message: string | undefined,
		headers: Headers | undefined,
	): AnthropicAPIError {
		if (!status || !headers) {
			const cause = errorResponse instanceof Error ? errorResponse : undefined;
			return new AnthropicAPIError(undefined, undefined, message || "Connection error.", undefined, null, cause);
		}
		const type = extractAnthropicErrorType(errorResponse);
		return new AnthropicAPIError(status, errorResponse, message, headers, type);
	}
}

export class AnthropicHttpClient implements AnthropicClientLike {
	readonly apiKey: string | null;
	readonly authToken: string | null;
	readonly baseURL: string;
	readonly timeout: number;
	readonly maxRetries: number;
	readonly dangerouslyAllowBrowser: boolean;
	readonly defaultHeaders: AnthropicHeaderMap | undefined;
	readonly config: AnthropicFederationConfig | undefined;
	readonly beta: { messages: AnthropicBetaMessagesResource };

	private readonly fetchFn: typeof globalThis.fetch;
	private readonly tokenCache: FederationTokenCache | undefined;

	constructor(options: AnthropicClientOptions = {}, sharedTokenCache?: FederationTokenCache) {
		this.apiKey = options.apiKey ?? null;
		this.authToken = options.authToken ?? null;
		this.baseURL = normalizeBaseUrl(options.baseURL);
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
		this.maxRetries = options.maxRetries ?? 0;
		this.dangerouslyAllowBrowser = options.dangerouslyAllowBrowser ?? false;
		this.defaultHeaders = options.defaultHeaders;
		this.config = options.config;
		this.fetchFn = options.fetch ?? globalThis.fetch;
		if (this.config) {
			this.tokenCache =
				sharedTokenCache ?? new FederationTokenCache(this.config, this.baseURL, this.fetchFn);
		}
		this.beta = {
			messages: {
				create: (params, requestOptions) => ({
					asResponse: () => this.createBetaMessageResponse(params, requestOptions),
				}),
			},
		};
	}

	withOptions(overrides: Partial<AnthropicClientOptions>): AnthropicHttpClient {
		const overridesAuth = "apiKey" in overrides || "authToken" in overrides || "config" in overrides;
		const nextOptions: AnthropicClientOptions = {
			apiKey: this.apiKey,
			authToken: this.authToken,
			baseURL: this.baseURL,
			timeout: this.timeout,
			maxRetries: this.maxRetries,
			dangerouslyAllowBrowser: this.dangerouslyAllowBrowser,
			fetch: this.fetchFn,
			defaultHeaders: this.defaultHeaders,
			config: this.config,
			...overrides,
		};
		return new AnthropicHttpClient(nextOptions, overridesAuth ? undefined : this.tokenCache);
	}

	private async createBetaMessageResponse(
		params: MessageCreateParamsStreaming,
		requestOptions?: AnthropicRequestOptions,
	): Promise<Response> {
		const rawRecord = params as unknown as Record<string, unknown>;
		const betas = Array.isArray(rawRecord.betas)
			? rawRecord.betas.filter((item): item is string => typeof item === "string")
			: undefined;

		const wireBody: Record<string, unknown> = {};
		for (const key of Object.keys(rawRecord)) {
			if (key === "betas" || key === "user_profile_id" || key === "workspace_id") {
				continue;
			}
			const val = rawRecord[key];
			if (val !== undefined) {
				wireBody[key] = val;
			}
		}

		const url = buildEndpointUrl(this.baseURL, "/v1/messages?beta=true");
		const timeoutMs = requestOptions?.timeout ?? this.timeout;
		const maxAttempts = Math.max(1, (requestOptions?.maxRetries ?? this.maxRetries) + 1);
		let didRefreshToken = false;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			let bearerToken = this.authToken;
			let usedTokenCache = false;
			if (!bearerToken && this.tokenCache) {
				bearerToken = await this.tokenCache.getToken(requestOptions?.signal);
				usedTokenCache = true;
			}

			const headers = buildAnthropicHeaders({
				dangerouslyAllowBrowser: this.dangerouslyAllowBrowser,
				apiKey: this.apiKey,
				authToken: bearerToken,
				defaultHeaders: this.defaultHeaders,
				betas,
				requestHeaders: requestOptions?.headers,
			});

			const response = await executeFetch(
				this.fetchFn,
				url,
				{
					method: "POST",
					headers,
					body: JSON.stringify(wireBody),
				},
				timeoutMs,
				requestOptions?.signal,
			);

			if (response.ok) {
				return response;
			}

			if (response.status === 401 && usedTokenCache && this.tokenCache && !didRefreshToken) {
				didRefreshToken = true;
				this.tokenCache.invalidate();
				await cancelResponseBodySafe(response);
				attempt -= 1;
				continue;
			}

			if (attempt + 1 < maxAttempts && shouldRetryStatus(response)) {
				await cancelResponseBodySafe(response);
				continue;
			}

			const errText = await readResponseBodySafe(response);
			const errJSON = parseJsonSafe(errText);
			const errMessage = errJSON !== undefined ? undefined : errText;
			throw AnthropicAPIError.generate(response.status, errJSON, errMessage, response.headers);
		}

		throw new AnthropicAPIError(undefined, undefined, "Request exhausted all retry attempts.", undefined);
	}
}

function extractAnthropicErrorType(error: unknown): string | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	const record = error as { type?: unknown; error?: { type?: unknown } };
	if (record.error && typeof record.error === "object" && typeof record.error.type === "string") {
		return record.error.type;
	}
	return typeof record.type === "string" && record.type !== "error" ? record.type : undefined;
}

function normalizeBaseUrl(baseURL: string | null | undefined): string {
	const trimmed = typeof baseURL === "string" ? baseURL.trim() : "";
	return trimmed.length > 0 ? trimmed : DEFAULT_ANTHROPIC_BASE_URL;
}

function buildEndpointUrl(baseURL: string, path: string): string {
	const joined = baseURL + (baseURL.endsWith("/") && path.startsWith("/") ? path.slice(1) : path);
	return new URL(joined).toString();
}

function resolveFederationTokenUrl(baseURL: string): string {
	const urlStr = buildEndpointUrl(baseURL, "/v1/oauth/token");
	const parsed = new URL(urlStr);
	const isLoopback =
		parsed.hostname === "localhost" ||
		parsed.hostname === "127.0.0.1" ||
		parsed.hostname === "::1" ||
		parsed.hostname === "[::1]";
	if (parsed.protocol !== "https:" && !isLoopback) {
		throw new AnthropicAPIError(
			undefined,
			undefined,
			`OIDC federation token exchange requires HTTPS (or loopback), got ${parsed.protocol}`,
			undefined,
		);
	}
	return urlStr;
}

async function readFederationAssertion(filePath: string): Promise<string> {
	const raw = await readFile(filePath, "utf8");
	if (Buffer.byteLength(raw, "utf8") > MAX_ASSERTION_BYTES) {
		throw new AnthropicAPIError(
			undefined,
			undefined,
			`OIDC identity token file exceeds ${MAX_ASSERTION_BYTES} bytes: ${filePath}`,
			undefined,
		);
	}
	const token = raw.trim();
	if (token.length === 0) {
		throw new AnthropicAPIError(
			undefined,
			undefined,
			`OIDC identity token file is empty: ${filePath}`,
			undefined,
		);
	}
	return token;
}

function mergeHeaderSource(target: Map<string, [string, string]>, source: AnthropicHeaderMap | undefined): void {
	if (!source) {
		return;
	}
	for (const key of Object.keys(source)) {
		const value = source[key];
		if (value === undefined) {
			continue;
		}
		const lower = key.toLowerCase();
		target.delete(lower);
		if (value !== null) {
			target.set(lower, [key, value]);
		}
	}
}

function buildAnthropicHeaders(options: {
	dangerouslyAllowBrowser: boolean;
	apiKey: string | null;
	authToken: string | null;
	defaultHeaders: AnthropicHeaderMap | undefined;
	betas: string[] | undefined;
	requestHeaders: AnthropicHeaderMap | undefined;
}): Headers {
	const merged = new Map<string, [string, string]>();

	mergeHeaderSource(merged, {
		accept: "application/json",
		"anthropic-version": DEFAULT_ANTHROPIC_VERSION,
		"content-type": "application/json",
		...(options.dangerouslyAllowBrowser ? { "anthropic-dangerous-direct-browser-access": "true" } : {}),
	});

	if (options.apiKey) {
		mergeHeaderSource(merged, { "x-api-key": options.apiKey });
	}
	if (options.authToken) {
		mergeHeaderSource(merged, { authorization: `Bearer ${options.authToken}` });
	}

	mergeHeaderSource(merged, options.defaultHeaders);

	if (options.betas && options.betas.length > 0) {
		mergeHeaderSource(merged, { "anthropic-beta": options.betas.join(",") });
	}

	mergeHeaderSource(merged, options.requestHeaders);

	const headers = new Headers();
	for (const [name, value] of merged.values()) {
		headers.set(name, value);
	}
	return headers;
}

async function executeFetch(
	fetchFn: typeof globalThis.fetch,
	url: string,
	init: { method: string; headers: Headers; body: string },
	timeoutMs: number,
	callerSignal?: AbortSignal,
): Promise<Response> {
	if (callerSignal?.aborted) {
		throw makeAbortError(callerSignal.reason);
	}

	const controller = new AbortController();
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
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
			body: init.body,
			signal: controller.signal,
		});
	} catch (error) {
		if (callerSignal?.aborted) {
			throw makeAbortError(callerSignal.reason);
		}
		if (timedOut) {
			throw new AnthropicAPIError(undefined, undefined, "Request timed out.", undefined, null, error);
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new AnthropicAPIError(undefined, undefined, message || "Connection error.", undefined, null, error);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		callerSignal?.removeEventListener("abort", onAbort);
	}
}

function makeAbortError(reason?: unknown): Error {
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

function shouldRetryStatus(response: Response): boolean {
	const explicit = response.headers.get("x-should-retry");
	if (explicit === "true") {
		return true;
	}
	if (explicit === "false") {
		return false;
	}
	return (
		response.status === 408 ||
		response.status === 409 ||
		response.status === 429 ||
		response.status >= 500
	);
}

async function readResponseBodySafe(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

async function cancelResponseBodySafe(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Ignore stream cancel errors on retry cleanup
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
