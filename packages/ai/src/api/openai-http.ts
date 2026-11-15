import type { ProviderHeaders } from "../types.ts";
import { combineAbortSignals } from "../utils/abort-signals.ts";
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from "./openai-chat-types.ts";
import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from "./openai-responses-types.ts";

export interface OpenAIRequestOptions {
	signal?: AbortSignal;
	timeout?: number;
	maxRetries?: number;
	headers?: ProviderHeaders;
}

export interface OpenAIClientConfig {
	apiKey: string;
	baseURL: string;
	fetch?: typeof globalThis.fetch;
	defaultHeaders?: ProviderHeaders;
	defaultQuery?: Record<string, string>;
}

export interface AzureOpenAIClientConfig extends OpenAIClientConfig {
	apiVersion: string;
}

export interface OpenAIResponseWithMeta<T> {
	data: T;
	response: Response;
}

export class OpenAIAPIError extends Error {
	status: number | undefined;
	headers: Headers | undefined;
	error: unknown;
	code: string | null | undefined;
	type: string | null | undefined;
	param: string | null | undefined;
	request_id: string | null | undefined;
	body: string | undefined;

	constructor(
		status: number | undefined,
		error: unknown,
		message: string,
		headers: Headers | undefined,
		body?: string,
	) {
		super(message);
		this.name = "APIError";
		this.status = status;
		this.headers = headers;
		this.error = error;
		this.body = body;
		this.request_id = headers?.get("x-request-id") ?? undefined;
		if (isPlainRecord(error)) {
			this.code = typeof error.code === "string" ? error.code : error.code === null ? null : undefined;
			this.type = typeof error.type === "string" ? error.type : error.type === null ? null : undefined;
			this.param = typeof error.param === "string" ? error.param : error.param === null ? null : undefined;
		}
	}
}

export class OpenAIConnectionError extends OpenAIAPIError {
	constructor(options?: { cause?: unknown; message?: string }) {
		super(undefined, undefined, options?.message ?? "Connection error.", undefined);
		this.name = "APIConnectionError";
		if (options?.cause !== undefined) {
			this.cause = options.cause;
		}
	}
}

export class OpenAIConnectionTimeoutError extends OpenAIConnectionError {
	constructor(message = "Request timed out.") {
		super({ message });
		this.name = "APIConnectionTimeoutError";
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function isAbortLike(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === "AbortError" || error.name === "APIUserAbortError";
}

function makeAbortError(): Error {
	const error = new Error("Request was aborted.");
	error.name = "AbortError";
	return error;
}

function makeOpenAIAPIError(status: number, rawBody: string, headers: Headers): OpenAIAPIError {
	const trimmed = rawBody.trim();
	if (trimmed.length > 0) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (isPlainRecord(parsed)) {
				const errObj = isPlainRecord(parsed.error) ? parsed.error : parsed;
				const errMsg =
					typeof errObj.message === "string" && errObj.message.length > 0 ? errObj.message : undefined;
				const message = errMsg ? `${status} ${errMsg}` : `${status} status code (no body)`;
				return new OpenAIAPIError(status, errObj, message, headers);
			}
		} catch {
			// Fall back to raw text error below
		}
		return new OpenAIAPIError(status, undefined, `${status} ${trimmed}`, headers, trimmed);
	}
	return new OpenAIAPIError(status, undefined, `${status} status code (no body)`, headers);
}

function buildRequestUrl(baseURL: string, path: string, defaultQuery?: Record<string, string>): string {
	const url = new URL(baseURL);
	const cleanBasePath = url.pathname.replace(/\/+$/, "");
	const cleanEndpointPath = path.startsWith("/") ? path : `/${path}`;
	url.pathname = `${cleanBasePath}${cleanEndpointPath}`;
	if (defaultQuery) {
		for (const key of Object.keys(defaultQuery)) {
			if (!url.searchParams.has(key)) {
				url.searchParams.set(key, defaultQuery[key]);
			}
		}
	}
	return url.toString();
}

function buildRequestHeaders(
	authHeaders: Record<string, string>,
	defaultHeaders: ProviderHeaders | undefined,
	requestHeaders: ProviderHeaders | undefined,
	accept: string,
): Record<string, string> {
	const merged = new Map<string, [string, string]>();
	const apply = (source: ProviderHeaders | Record<string, string> | undefined) => {
		if (!source) return;
		for (const key of Object.keys(source)) {
			const value = source[key];
			const lower = key.toLowerCase();
			merged.delete(lower);
			if (value !== null && value !== undefined) {
				merged.set(lower, [key, value]);
			}
		}
	};

	apply({
		Accept: accept,
		"Content-Type": "application/json",
		...authHeaders,
	});
	apply(defaultHeaders);
	apply(requestHeaders);

	return Object.fromEntries(merged.values());
}

export async function* parseOpenAISSE<T>(
	response: Response,
	signal?: AbortSignal,
): AsyncGenerator<T> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const onAbort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		while (true) {
			if (signal?.aborted) {
				throw makeAbortError();
			}
			const { done, value } = await reader.read();
			if (signal?.aborted) {
				throw makeAbortError();
			}
			const decoded = done ? decoder.decode() : decoder.decode(value, { stream: true });
			if (decoded) {
				buffer += decoded.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
			}
			if (done && buffer.trim().length > 0) {
				buffer += "\n\n";
			}

			let frameEnd = buffer.indexOf("\n\n");
			while (frameEnd !== -1) {
				const frame = buffer.slice(0, frameEnd);
				buffer = buffer.slice(frameEnd + 2);

				let eventName: string | undefined;
				const dataLines: string[] = [];
				for (const line of frame.split("\n")) {
					if (!line || line.startsWith(":")) continue;
					if (line.startsWith("event:")) {
						eventName = line.slice(6).trim();
					} else if (line.startsWith("data:")) {
						dataLines.push(line.startsWith("data: ") ? line.slice(6) : line.slice(5));
					}
				}

				if (dataLines.length > 0) {
					const payload = dataLines.join("\n").trim();
					if (payload === "[DONE]") {
						return;
					}
					if (payload.length > 0) {
						const parsed = JSON.parse(payload) as unknown;
						if (isPlainRecord(parsed) && isPlainRecord(parsed.error) && parsed.type !== "error" && !("choices" in parsed)) {
							const errObj = parsed.error;
							const message =
								typeof errObj.message === "string" && errObj.message.length > 0
									? errObj.message
									: eventName === "error"
										? "Stream error"
										: JSON.stringify(errObj);
							throw new OpenAIAPIError(undefined, errObj, message, response.headers);
						}
						yield parsed as T;
					}
				}

				frameEnd = buffer.indexOf("\n\n");
			}

			if (done) break;
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

async function performPostRequest(
	config: {
		baseURL: string;
		authHeaders: Record<string, string>;
		fetch?: typeof globalThis.fetch;
		defaultHeaders?: ProviderHeaders;
		defaultQuery?: Record<string, string>;
		preventApiKeyRedirect?: boolean;
	},
	path: string,
	body: unknown,
	options: OpenAIRequestOptions | undefined,
	accept: string,
): Promise<Response> {
	const url = buildRequestUrl(config.baseURL, path, config.defaultQuery);
	const headers = buildRequestHeaders(config.authHeaders, config.defaultHeaders, options?.headers, accept);
	const hasApiKeyHeader = Object.keys(headers).some((key) => key.toLowerCase() === "api-key");

	let timedOut = false;
	const timeoutController = options?.timeout !== undefined ? new AbortController() : undefined;
	const timeoutId =
		timeoutController && options?.timeout !== undefined
			? setTimeout(() => {
					timedOut = true;
					timeoutController.abort();
				}, Math.max(0, options.timeout))
			: undefined;

	const combined = combineAbortSignals([options?.signal, timeoutController?.signal]);
	const requestFetch = config.fetch ?? globalThis.fetch;

	let response: Response;
	try {
		response = await requestFetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			...(combined.signal ? { signal: combined.signal } : {}),
			...(config.preventApiKeyRedirect && hasApiKeyHeader ? { redirect: "manual" } : {}),
		});
	} catch (error) {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
		combined.cleanup();
		if (timedOut) {
			throw new OpenAIConnectionTimeoutError();
		}
		if (options?.signal?.aborted || isAbortLike(error)) {
			throw makeAbortError();
		}
		throw new OpenAIConnectionError({ cause: error });
	}

	if (timeoutId !== undefined) clearTimeout(timeoutId);
	combined.cleanup();

	if (!response.ok) {
		const rawBody = await response.text().catch(() => "");
		throw makeOpenAIAPIError(response.status, rawBody, response.headers);
	}

	return response;
}

export interface OpenAIHttpClient {
	responses: {
		create: (
			params: ResponseCreateParamsStreaming,
			options?: OpenAIRequestOptions,
		) => {
			withResponse: () => Promise<OpenAIResponseWithMeta<AsyncIterable<ResponseStreamEvent>>>;
		};
	};
	chat: {
		completions: {
			create: (
				params: ChatCompletionCreateParamsStreaming,
				options?: OpenAIRequestOptions,
			) => {
				withResponse: () => Promise<OpenAIResponseWithMeta<AsyncIterable<ChatCompletionChunk>>>;
			};
			createNonStreaming: (
				params: ChatCompletionCreateParamsNonStreaming,
				options?: OpenAIRequestOptions,
			) => {
				withResponse: () => Promise<OpenAIResponseWithMeta<ChatCompletion>>;
			};
		};
	};
}

function createHttpClient(
	config: OpenAIClientConfig & {
		authHeaders: Record<string, string>;
		preventApiKeyRedirect?: boolean;
	},
): OpenAIHttpClient {
	const responsesCreate = (
		params: ResponseCreateParamsStreaming,
		options?: OpenAIRequestOptions,
	): {
		withResponse: () => Promise<OpenAIResponseWithMeta<AsyncIterable<ResponseStreamEvent>>>;
	} => {
		const promise: Promise<OpenAIResponseWithMeta<AsyncIterable<ResponseStreamEvent>>> = performPostRequest(
			config,
			"/responses",
			params,
			options,
			"text/event-stream",
		).then(
			(response): OpenAIResponseWithMeta<AsyncIterable<ResponseStreamEvent>> => {
				const data: AsyncIterable<ResponseStreamEvent> = parseOpenAISSE<ResponseStreamEvent>(
					response,
					options?.signal,
				);
				return {
					data,
					response,
				};
			},
		);
		return {
			withResponse: (): Promise<OpenAIResponseWithMeta<AsyncIterable<ResponseStreamEvent>>> => promise,
		};
	};

	const chatCompletionsCreate = (
		params: ChatCompletionCreateParamsStreaming,
		options?: OpenAIRequestOptions,
	): {
		withResponse: () => Promise<OpenAIResponseWithMeta<AsyncIterable<ChatCompletionChunk>>>;
	} => {
		const promise: Promise<OpenAIResponseWithMeta<AsyncIterable<ChatCompletionChunk>>> = performPostRequest(
			config,
			"/chat/completions",
			params,
			options,
			"text/event-stream",
		).then(
			(response): OpenAIResponseWithMeta<AsyncIterable<ChatCompletionChunk>> => {
				const data: AsyncIterable<ChatCompletionChunk> = parseOpenAISSE<ChatCompletionChunk>(
					response,
					options?.signal,
				);
				return {
					data,
					response,
				};
			},
		);
		return {
			withResponse: (): Promise<OpenAIResponseWithMeta<AsyncIterable<ChatCompletionChunk>>> => promise,
		};
	};

	const chatCompletionsCreateNonStreaming = (
		params: ChatCompletionCreateParamsNonStreaming,
		options?: OpenAIRequestOptions,
	): {
		withResponse: () => Promise<OpenAIResponseWithMeta<ChatCompletion>>;
	} => {
		const promise: Promise<OpenAIResponseWithMeta<ChatCompletion>> = performPostRequest(
			config,
			"/chat/completions",
			params,
			options,
			"application/json",
		).then(
			async (response): Promise<OpenAIResponseWithMeta<ChatCompletion>> => ({
				data: (await response.json()) as ChatCompletion,
				response,
			}),
		);
		return {
			withResponse: (): Promise<OpenAIResponseWithMeta<ChatCompletion>> => promise,
		};
	};

	return {
		responses: {
			create: responsesCreate,
		},
		chat: {
			completions: {
				create: chatCompletionsCreate,
				createNonStreaming: chatCompletionsCreateNonStreaming,
			},
		},
	};
}

export function createOpenAIClient(config: OpenAIClientConfig): OpenAIHttpClient {
	return createHttpClient({
		...config,
		authHeaders: {
			Authorization: `Bearer ${config.apiKey}`,
		},
	});
}

export function createAzureOpenAIClient(config: AzureOpenAIClientConfig): OpenAIHttpClient {
	return createHttpClient({
		...config,
		defaultQuery: {
			"api-version": config.apiVersion,
			...config.defaultQuery,
		},
		authHeaders: {
			"api-key": config.apiKey,
		},
		preventApiKeyRedirect: true,
	});
}
