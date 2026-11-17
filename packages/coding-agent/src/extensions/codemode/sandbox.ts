/**
 * In-process Apple JavaScriptCore sandbox and process-wide worker admission pool for codemode.
 */

import {
	isNativeDarwinAvailable,
	nativeJscCreate,
	nativeJscDestroy,
	nativeJscEval,
	type NativeJscEvalResult,
} from "@pi-ts/ffi";

export const DEFAULT_MAX_WORKERS = 2;
export const DEFAULT_QUEUE_WAIT_TIMEOUT_MS = 60_000;
export const MAX_OUTPUT_CHARS = 16_777_216;
export const MAX_OUTPUT_ITEMS = 100_000;
export const MAX_STORE_VALUE_CHARS = 262_144;
export const MAX_STORE_TOTAL_CHARS = 1_048_576;

export type SandboxOutputItem =
	| { kind: "text"; text: string }
	| { kind: "image"; data: string; mimeType: string };

export interface SandboxStoreDelta {
	hasWrites: boolean;
	set: Record<string, unknown>;
	delete: string[];
}

export interface SandboxToolDescriptor {
	name: string;
	scriptName: string;
	description: string;
}

export interface SandboxRpcHandlers {
	callTool: (name: string, args: unknown, signal: AbortSignal) => Promise<unknown>;
	searchTools: (query: string, options: unknown, signal: AbortSignal) => Promise<unknown>;
	describeTool: (name: string, signal: AbortSignal) => Promise<unknown>;
	describeNamespace: (name: string, signal: AbortSignal) => Promise<unknown>;
	modelGetModelsOfType?: (type: unknown, provider: unknown, signal: AbortSignal) => Promise<unknown>;
	modelGetAvailableOfType?: (type: unknown, provider: unknown, signal: AbortSignal) => Promise<unknown>;
	modelGetModelOfType?: (type: unknown, provider: unknown, id: unknown, signal: AbortSignal) => Promise<unknown>;
	modelClassify?: (
		hasModel: boolean,
		model: unknown,
		hasContext: boolean,
		context: unknown,
		signal: AbortSignal,
	) => Promise<unknown>;
	modelGenerateImages?: (
		hasModel: boolean,
		model: unknown,
		hasContext: boolean,
		context: unknown,
		signal: AbortSignal,
	) => Promise<unknown>;
}

export interface RunCodemodeSandboxOptions {
	code: string;
	tools: readonly SandboxToolDescriptor[];
	initialStore: Record<string, unknown>;
	timeoutMs?: number;
	signal?: AbortSignal;
	includeModels: boolean;
	handlers: SandboxRpcHandlers;
}

export interface SandboxRunResult {
	ok: boolean;
	error?: string;
	aborted?: boolean;
	timedOut?: boolean;
	didNotStart?: boolean;
	outputs: SandboxOutputItem[];
	consoleLines: string[];
	storeDelta: SandboxStoreDelta;
	wallTimeMs: number;
}

interface PendingRpcCall {
	id: number;
	kind: string;
	payload: unknown;
}

interface SettledRpcCall {
	id: number;
	ok: boolean;
	hasValue?: boolean;
	value?: unknown;
	error?: string;
}

interface SandboxSnapshot {
	status: "pending" | "resolved" | "rejected" | "exited";
	error?: string;
	outputs: SandboxOutputItem[];
	consoleLines: string[];
	pendingCalls: PendingRpcCall[];
	storeDelta: SandboxStoreDelta;
}

interface WorkerWaiter {
	grant: () => void;
	reject: (err: Error) => void;
}

class PreStartTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PreStartTimeoutError";
	}
}

class PreStartAbortError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PreStartAbortError";
	}
}

let activeWorkers = 0;
const workerQueue: WorkerWaiter[] = [];
let bridgeCounter = 0;

/** Convert any tool name into a valid JavaScript identifier using `_` for invalid characters. */
export function sanitizeToolIdentifier(name: string): string {
	const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_");
	if (cleaned.length === 0) return "_";
	return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function getMaxWorkers(): number {
	const raw = process.env.PI_CODEMODE_MAX_WORKERS;
	if (!raw) return DEFAULT_MAX_WORKERS;
	const trimmed = raw.trim();
	if (!/^[1-9]\d*$/.test(trimmed)) return DEFAULT_MAX_WORKERS;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_WORKERS;
}

function formatAbortReason(reason: unknown): string {
	if (reason === undefined || reason === null) return "";
	if (reason instanceof Error) {
		return reason.name === "AbortError" && reason.message === "This operation was aborted"
			? ""
			: reason.message || reason.name;
	}
	return String(reason);
}

function formatPreStartAbortMessage(reason: unknown): string {
	const detail = formatAbortReason(reason);
	return detail ? `Script aborted:\n${detail}\nThe script did not start.` : "Script aborted:\n\nThe script did not start.";
}

function pumpWorkerQueue(): void {
	const limit = getMaxWorkers();
	while (activeWorkers < limit && workerQueue.length > 0) {
		const next = workerQueue.shift();
		if (!next) break;
		activeWorkers += 1;
		next.grant();
	}
}

function releaseWorker(): void {
	if (activeWorkers > 0) activeWorkers -= 1;
	pumpWorkerQueue();
}

async function acquireWorker(waitTimeoutMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		throw new PreStartAbortError(formatPreStartAbortMessage(signal.reason));
	}
	if (activeWorkers < getMaxWorkers()) {
		activeWorkers += 1;
		return;
	}
	if (waitTimeoutMs <= 0) {
		throw new PreStartTimeoutError(
			`Execution timed out after ${Math.max(0, Math.round(waitTimeoutMs))} ms while waiting for a free codemode worker`,
		);
	}

	return await new Promise<void>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const cleanup = () => {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			signal?.removeEventListener("abort", onAbort);
		};

		const removeWaiter = (target: WorkerWaiter) => {
			const idx = workerQueue.indexOf(target);
			if (idx !== -1) workerQueue.splice(idx, 1);
		};

		const waiter: WorkerWaiter = {
			grant: () => {
				if (settled) {
					releaseWorker();
					return;
				}
				settled = true;
				cleanup();
				resolve();
			},
			reject: (err: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(err);
			},
		};

		const onAbort = () => {
			removeWaiter(waiter);
			waiter.reject(new PreStartAbortError(formatPreStartAbortMessage(signal?.reason)));
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		timer = setTimeout(() => {
			removeWaiter(waiter);
			waiter.reject(
				new PreStartTimeoutError(
					`Execution timed out after ${Math.round(waitTimeoutMs)} ms while waiting for a free codemode worker`,
				),
			);
		}, waitTimeoutMs);

		workerQueue.push(waiter);
	});
}

function toJsLiteral(value: unknown): string {
	const json = JSON.stringify(value) ?? "undefined";
	return json.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function buildBootstrapScript(
	bridgeKey: string,
	tools: readonly SandboxToolDescriptor[],
	initialStore: Record<string, unknown>,
	includeModels: boolean,
): string {
	const configLiteral = toJsLiteral({
		tools,
		initialStore,
		includeModels,
		maxOutputChars: MAX_OUTPUT_CHARS,
		maxOutputItems: MAX_OUTPUT_ITEMS,
		maxStoreValueChars: MAX_STORE_VALUE_CHARS,
		maxStoreTotalChars: MAX_STORE_TOTAL_CHARS,
	});

	return `(() => {
	"use strict";
	const cfg = ${configLiteral};
	const MAX_OUTPUT_CHARS = cfg.maxOutputChars;
	const MAX_OUTPUT_ITEMS = cfg.maxOutputItems;
	const MAX_STORE_VALUE_CHARS = cfg.maxStoreValueChars;
	const MAX_STORE_TOTAL_CHARS = cfg.maxStoreTotalChars;

	class CodemodeExitSignal extends Error {
		constructor() {
			super("__pi_codemode_exit__");
			this.name = "CodemodeExitSignal";
		}
	}

	let exited = false;
	let status = "pending";
	let scriptError = undefined;
	let nextCallId = 1;
	let outputItemCount = 0;
	let outputCharCount = 0;

	const outputs = [];
	const consoleLines = [];
	const pendingQueue = [];
	const resolvers = new Map();

	const storeData = Object.create(null);
	const storeLengths = Object.create(null);
	let storeTotalChars = 0;
	const pendingSet = Object.create(null);
	const pendingDelete = new Set();
	let storeHasWrites = false;

	for (const entry of Object.entries(cfg.initialStore || {})) {
		const k = entry[0];
		const serialized = JSON.stringify(entry[1]);
		if (serialized !== undefined) {
			storeData[k] = JSON.parse(serialized);
			storeLengths[k] = serialized.length;
			storeTotalChars += serialized.length;
		}
	}

	function checkOutputBudget(charsToAdd) {
		if (outputItemCount + 1 > MAX_OUTPUT_ITEMS) {
			throw new Error("Codemode output exceeded limit of " + MAX_OUTPUT_ITEMS + " items");
		}
		if (outputCharCount + charsToAdd > MAX_OUTPUT_CHARS) {
			throw new Error("Codemode output exceeded limit of " + MAX_OUTPUT_CHARS + " characters");
		}
		outputItemCount += 1;
		outputCharCount += charsToAdd;
	}

	function formatTextValue(value) {
		if (typeof value === "string") return value;
		if (value === undefined) return "undefined";
		try {
			const encoded = JSON.stringify(value);
			if (encoded !== undefined) return encoded;
		} catch {
			// Fall back to String() for non-JSON values like BigInt or circular refs.
		}
		return String(value);
	}

	function addText(value) {
		if (exited) return;
		const str = formatTextValue(value);
		checkOutputBudget(str.length);
		outputs.push({ kind: "text", text: str });
	}

	function parseDataUrl(url) {
		if (typeof url !== "string") {
			throw new Error("image() data URL must be a string");
		}
		const trimmed = url.trim();
		if (/^https?:\\/\\//i.test(trimmed)) {
			throw new Error("Remote URLs are not supported in image()");
		}
		const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\\s]+)$/i.exec(trimmed);
		if (!match) {
			throw new Error("image() expects a base64 data URL (PNG, JPEG, GIF, or WebP) or image block");
		}
		const rawMime = match[1].toLowerCase();
		const mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
		const data = match[2].replace(/\\s+/g, "");
		return { mimeType, data };
	}

	function normalizeImageInput(value) {
		let mimeType = "";
		let data = "";
		if (typeof value === "string") {
			const parsed = parseDataUrl(value);
			mimeType = parsed.mimeType;
			data = parsed.data;
		} else if (value && typeof value === "object") {
			if (typeof value.image_url === "string") {
				const parsed = parseDataUrl(value.image_url);
				mimeType = parsed.mimeType;
				data = parsed.data;
			} else if (value.image_url && typeof value.image_url === "object" && typeof value.image_url.url === "string") {
				const parsed = parseDataUrl(value.image_url.url);
				mimeType = parsed.mimeType;
				data = parsed.data;
			} else if (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
				const rawMime = value.mimeType.toLowerCase();
				mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
				data = value.data.replace(/\\s+/g, "");
			} else {
				throw new Error("image() expects a base64 data URL, { image_url }, or { type: 'image', data, mimeType }");
			}
		} else {
			throw new Error("image() expects a base64 data URL, { image_url }, or { type: 'image', data, mimeType }");
		}

		const allowed = mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/gif" || mimeType === "image/webp";
		if (!allowed) {
			throw new Error("Unsupported image MIME type: " + mimeType + " (accepted: PNG, JPEG, GIF, WebP)");
		}
		if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
			throw new Error("image() data must be valid non-empty base64");
		}
		return { mimeType, data };
	}

	function addImage(value) {
		if (exited) return;
		const img = normalizeImageInput(value);
		checkOutputBudget(img.data.length);
		outputs.push({ kind: "image", data: img.data, mimeType: img.mimeType });
	}

	function formatConsoleArg(arg) {
		if (typeof arg === "string") return arg;
		if (arg === null || typeof arg !== "object") return String(arg);
		if (arg instanceof Error) {
			return formatError(arg);
		}
		try {
			const encoded = JSON.stringify(arg);
			if (encoded !== undefined) return encoded;
		} catch {
			// Ignore circular references.
		}
		return String(arg);
	}

	function addConsoleLine(args) {
		if (exited) return;
		const line = args.map(formatConsoleArg).join(" ");
		checkOutputBudget(line.length);
		consoleLines.push(line);
	}

	function exitScript() {
		if (exited) {
			throw new CodemodeExitSignal();
		}
		exited = true;
		status = "exited";
		throw new CodemodeExitSignal();
	}

	function storeValue(key, value) {
		if (exited) return;
		if (typeof key !== "string") {
			throw new TypeError("store() key must be a string");
		}
		if (value === undefined) {
			if (Object.prototype.hasOwnProperty.call(storeData, key)) {
				storeTotalChars -= storeLengths[key] || 0;
				delete storeData[key];
				delete storeLengths[key];
			}
			delete pendingSet[key];
			pendingDelete.add(key);
			storeHasWrites = true;
			return;
		}
		const encoded = JSON.stringify(value);
		if (encoded === undefined) {
			throw new TypeError("store() value must be JSON-serializable");
		}
		if (encoded.length > MAX_STORE_VALUE_CHARS) {
			throw new Error(
				"store() value for key " + JSON.stringify(key) + " exceeds " + MAX_STORE_VALUE_CHARS + " character limit",
			);
		}
		const prevLen = storeLengths[key] || 0;
		const nextTotal = storeTotalChars - prevLen + encoded.length;
		if (nextTotal > MAX_STORE_TOTAL_CHARS) {
			throw new Error("store() total size exceeds " + MAX_STORE_TOTAL_CHARS + " character limit");
		}
		const cloned = JSON.parse(encoded);
		storeData[key] = cloned;
		storeLengths[key] = encoded.length;
		storeTotalChars = nextTotal;
		pendingSet[key] = JSON.parse(encoded);
		pendingDelete.delete(key);
		storeHasWrites = true;
	}

	function loadValue(key) {
		if (typeof key !== "string") {
			throw new TypeError("load() key must be a string");
		}
		if (!Object.prototype.hasOwnProperty.call(storeData, key)) {
			return undefined;
		}
		return JSON.parse(JSON.stringify(storeData[key]));
	}

	function formatError(err) {
		if (err && typeof err === "object") {
			const name = typeof err.name === "string" && err.name ? err.name : "Error";
			const msg = typeof err.message === "string" ? err.message : String(err);
			const header = msg ? name + ": " + msg : name;
			const rawStack = typeof err.stack === "string" ? err.stack : "";
			if (rawStack) {
				const frames = rawStack
					.split("\\n")
					.filter((line) => line && !line.includes("codemode-internal.js") && !line.includes("promiseReactionJob"))
					.map((line) => {
						const trimmed = line.trim();
						return trimmed.includes("codemode.js") && !trimmed.startsWith("at ") ? "    at " + trimmed : line;
					});
				if (frames.length > 0) {
					if (rawStack.startsWith(header)) return frames.join("\\n");
					return header + "\\n" + frames.join("\\n");
				}
			}
			return header;
		}
		return String(err);
	}

	function cloneJsonPayload(value) {
		if (value === undefined) return undefined;
		const text = JSON.stringify(value);
		return text === undefined ? undefined : JSON.parse(text);
	}

	function queueRpcCall(kind, payload) {
		if (exited) {
			return new Promise(() => {});
		}
		let safePayload;
		try {
			safePayload = payload === undefined ? null : JSON.parse(JSON.stringify(payload));
		} catch (err) {
			return Promise.reject(new TypeError("Script arguments must be JSON-serializable: " + (err && err.message ? err.message : String(err))));
		}
		const id = nextCallId++;
		return new Promise((resolve, reject) => {
			resolvers.set(id, { resolve, reject });
			pendingQueue.push({ id, kind, payload: safePayload });
		});
	}

	// Build tools object and Proxy for identifier + original name lookup.
	const nameMap = Object.create(null);
	const toolsTarget = Object.create(null);
	const allTools = [];

	for (const tool of cfg.tools) {
		allTools.push(Object.freeze({ name: tool.name, description: tool.description }));
		nameMap[tool.name] = tool.name;
		if (!(tool.scriptName in nameMap)) {
			nameMap[tool.scriptName] = tool.name;
		}
		const fn = (args) => queueRpcCall("tool", { name: tool.name, args: args === undefined ? {} : args });
		toolsTarget[tool.scriptName] = fn;
	}
	Object.freeze(allTools);

	const toolsProxy = new Proxy(toolsTarget, {
		get(target, prop) {
			if (typeof prop === "string") {
				if (Object.prototype.hasOwnProperty.call(nameMap, prop)) {
					const realName = nameMap[prop];
					return (args) => queueRpcCall("tool", { name: realName, args: args === undefined ? {} : args });
				}
				return target[prop];
			}
			return undefined;
		},
		has(target, prop) {
			if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(nameMap, prop)) return true;
			return prop in target;
		},
		ownKeys(target) {
			return Reflect.ownKeys(target);
		},
		getOwnPropertyDescriptor(target, prop) {
			if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(target, prop)) {
				return Object.getOwnPropertyDescriptor(target, prop);
			}
			return undefined;
		},
	});

	globalThis.tools = toolsProxy;
	globalThis.text = addText;
	globalThis.image = addImage;
	globalThis.console = Object.freeze({
		log: (...args) => addConsoleLine(args),
		info: (...args) => addConsoleLine(args),
		warn: (...args) => addConsoleLine(args),
		error: (...args) => addConsoleLine(args),
		debug: (...args) => addConsoleLine(args),
	});
	globalThis.exit = exitScript;
	globalThis.store = storeValue;
	globalThis.load = loadValue;
	globalThis.ALL_TOOLS = allTools;
	globalThis.searchTools = (query, options) => queueRpcCall("searchTools", {
		hasQuery: query !== undefined,
		query,
		options: options === undefined ? null : options,
	});
	globalThis.describeTool = (name) => queueRpcCall("describeTool", {
		hasName: name !== undefined,
		name,
	});
	globalThis.describeNamespace = (name) => queueRpcCall("describeNamespace", {
		hasName: name !== undefined,
		name,
	});

	if (cfg.includeModels) {
		globalThis.models = Object.freeze({
			getModelsOfType: (type, provider) =>
				queueRpcCall("models.getModelsOfType", {
					hasType: type !== undefined,
					type,
					hasProvider: provider !== undefined,
					provider,
				}),
			getAvailableOfType: (type, provider) =>
				queueRpcCall("models.getAvailableOfType", {
					hasType: type !== undefined,
					type,
					hasProvider: provider !== undefined,
					provider,
				}),
			getModelOfType: (type, provider, id) =>
				queueRpcCall("models.getModelOfType", {
					hasType: type !== undefined,
					type,
					hasProvider: provider !== undefined,
					provider,
					hasId: id !== undefined,
					id,
				}),
			classify: (model, context) =>
				queueRpcCall("models.classify", {
					hasModel: model !== undefined,
					model: model === undefined ? null : cloneJsonPayload(model),
					hasContext: context !== undefined,
					context: context === undefined ? null : cloneJsonPayload(context),
				}),
			generateImages: (model, context) =>
				queueRpcCall("models.generateImages", {
					hasModel: model !== undefined,
					model: model === undefined ? null : cloneJsonPayload(model),
					hasContext: context !== undefined,
					context: context === undefined ? null : cloneJsonPayload(context),
				}),
		});
	}

	const bridge = Object.freeze({
		track(promise) {
			Promise.resolve(promise).then(
				(value) => {
					if (exited) {
						status = "exited";
						return;
					}
					if (value !== undefined) {
						try {
							addText(value);
						} catch (err) {
							status = "rejected";
							scriptError = formatError(err);
							return;
						}
					}
					status = "resolved";
				},
				(err) => {
					if (exited || err instanceof CodemodeExitSignal) {
						exited = true;
						status = "exited";
						return;
					}
					status = "rejected";
					scriptError = formatError(err);
				},
			);
		},
		settle(batch) {
			for (const entry of batch) {
				const pending = resolvers.get(entry.id);
				if (!pending) continue;
				resolvers.delete(entry.id);
				if (exited) continue;
				if (entry.ok) {
					pending.resolve(entry.hasValue ? entry.value : undefined);
				} else {
					pending.reject(new Error(entry.error || "Host call failed"));
				}
			}
			return "ok";
		},
		snapshot() {
			const calls = pendingQueue.splice(0, pendingQueue.length);
			return JSON.stringify({
				status,
				error: scriptError,
				outputs,
				consoleLines,
				pendingCalls: calls,
				storeDelta: {
					hasWrites: storeHasWrites,
					set: pendingSet,
					delete: Array.from(pendingDelete),
				},
			});
		},
	});

	Object.defineProperty(globalThis, ${toJsLiteral(bridgeKey)}, {
		value: bridge,
		enumerable: false,
		writable: false,
		configurable: false,
	});
})();`;
}

async function dispatchRpcCall(
	call: PendingRpcCall,
	handlers: SandboxRpcHandlers,
	signal: AbortSignal,
): Promise<SettledRpcCall> {
	const p = (call.payload && typeof call.payload === "object" ? call.payload : {}) as Record<string, unknown>;
	try {
		let value: unknown;
		switch (call.kind) {
			case "tool": {
				value = await handlers.callTool(String(p.name ?? ""), p.args ?? {}, signal);
				break;
			}
			case "searchTools": {
				value = await handlers.searchTools(
					String(p.hasQuery ? p.query : ""),
					p.options ?? undefined,
					signal,
				);
				break;
			}
			case "describeTool": {
				value = await handlers.describeTool(p.hasName ? String(p.name) : "", signal);
				break;
			}
			case "describeNamespace": {
				value = await handlers.describeNamespace(p.hasName ? String(p.name) : "", signal);
				break;
			}
			case "models.getModelsOfType": {
				if (!handlers.modelGetModelsOfType) {
					throw new Error("models API is not available in this context");
				}
				value = await handlers.modelGetModelsOfType(
					p.hasType ? p.type : undefined,
					p.hasProvider ? p.provider : undefined,
					signal,
				);
				break;
			}
			case "models.getAvailableOfType": {
				if (!handlers.modelGetAvailableOfType) {
					throw new Error("models API is not available in this context");
				}
				value = await handlers.modelGetAvailableOfType(
					p.hasType ? p.type : undefined,
					p.hasProvider ? p.provider : undefined,
					signal,
				);
				break;
			}
			case "models.getModelOfType": {
				if (!handlers.modelGetModelOfType) {
					throw new Error("models API is not available in this context");
				}
				value = await handlers.modelGetModelOfType(
					p.hasType ? p.type : undefined,
					p.hasProvider ? p.provider : undefined,
					p.hasId ? p.id : undefined,
					signal,
				);
				break;
			}
			case "models.classify": {
				if (!handlers.modelClassify) {
					throw new Error("models API is not available in this context");
				}
				value = await handlers.modelClassify(
					Boolean(p.hasModel),
					p.hasModel ? p.model : undefined,
					Boolean(p.hasContext),
					p.hasContext ? p.context : undefined,
					signal,
				);
				break;
			}
			case "models.generateImages": {
				if (!handlers.modelGenerateImages) {
					throw new Error("models API is not available in this context");
				}
				value = await handlers.modelGenerateImages(
					Boolean(p.hasModel),
					p.hasModel ? p.model : undefined,
					Boolean(p.hasContext),
					p.hasContext ? p.context : undefined,
					signal,
				);
				break;
			}
			default:
				throw new Error(`Unknown sandbox call kind: ${call.kind}`);
		}
		return {
			id: call.id,
			ok: true,
			hasValue: value !== undefined,
			value,
		};
	} catch (err) {
		return {
			id: call.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

function emptyResult(wallTimeMs: number, overrides: Partial<SandboxRunResult>): SandboxRunResult {
	return {
		ok: false,
		outputs: [],
		consoleLines: [],
		storeDelta: { hasWrites: false, set: {}, delete: [] },
		wallTimeMs,
		...overrides,
	};
}

function evalJscWithDeadline(
	vmId: number,
	code: string,
	sourceUrl: string,
	deadlineMs: number | undefined,
	totalTimeoutMs: number | undefined,
): { ok: true; value: string } | { ok: false; timedOut: boolean; error: string } {
	let remainingMs: number | undefined;
	if (deadlineMs !== undefined) {
		const left = deadlineMs - Date.now();
		if (left <= 0) {
			return {
				ok: false,
				timedOut: true,
				error: `Script timed out: exceeded ${totalTimeoutMs ?? 0} ms`,
			};
		}
		remainingMs = left;
	}
	const res: NativeJscEvalResult = nativeJscEval(vmId, code, sourceUrl, remainingMs);
	if (res.ok) {
		return { ok: true, value: res.value };
	}
	if (res.timedOut) {
		return {
			ok: false,
			timedOut: true,
			error: `Script timed out: exceeded ${totalTimeoutMs ?? remainingMs ?? 0} ms`,
		};
	}
	return { ok: false, timedOut: false, error: res.error };
}

function readSnapshotBestEffort(vmId: number, bridgeKey: string): SandboxSnapshot | undefined {
	const res = nativeJscEval(vmId, `globalThis[${toJsLiteral(bridgeKey)}].snapshot()`, "codemode-internal.js", 500);
	if (!res.ok) return undefined;
	try {
		return JSON.parse(res.value) as SandboxSnapshot;
	} catch {
		return undefined;
	}
}

/**
 * Execute a raw JavaScript async function body inside an isolated Apple JavaScriptCore VM.
 */
export async function runCodemodeSandbox(options: RunCodemodeSandboxOptions): Promise<SandboxRunResult> {
	const startedAt = performance.now();
	const deadlineMs = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : undefined;
	const queueWaitTimeoutMs =
		options.timeoutMs !== undefined
			? Math.min(DEFAULT_QUEUE_WAIT_TIMEOUT_MS, options.timeoutMs)
			: DEFAULT_QUEUE_WAIT_TIMEOUT_MS;

	try {
		await acquireWorker(queueWaitTimeoutMs, options.signal);
	} catch (err) {
		const wallTimeMs = performance.now() - startedAt;
		if (err instanceof PreStartTimeoutError) {
			return emptyResult(wallTimeMs, {
				ok: false,
				timedOut: true,
				didNotStart: true,
				error: err.message,
			});
		}
		if (err instanceof PreStartAbortError) {
			return emptyResult(wallTimeMs, {
				ok: false,
				aborted: true,
				didNotStart: true,
				error: err.message,
			});
		}
		return emptyResult(wallTimeMs, {
			ok: false,
			didNotStart: true,
			error: err instanceof Error ? err.message : String(err),
		});
	}

	if (!isNativeDarwinAvailable()) {
		releaseWorker();
		return emptyResult(performance.now() - startedAt, {
			ok: false,
			didNotStart: true,
			error: "Codemode JavaScriptCore sandbox requires native Darwin FFI support.",
		});
	}

	const vmId = nativeJscCreate();
	const bridgeKey = `__pi_cm_${++bridgeCounter}_${Math.random().toString(36).slice(2)}`;
	const scriptAbort = new AbortController();
	let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

	const onExternalAbort = () => {
		scriptAbort.abort(options.signal?.reason);
	};
	options.signal?.addEventListener("abort", onExternalAbort, { once: true });
	if (options.signal?.aborted) {
		scriptAbort.abort(options.signal.reason);
	}

	if (deadlineMs !== undefined) {
		const left = Math.max(0, deadlineMs - Date.now());
		deadlineTimer = setTimeout(() => {
			scriptAbort.abort(new Error(`Script timed out: exceeded ${options.timeoutMs} ms`));
		}, left);
	}

	const inFlight = new Map<number, { settled?: SettledRpcCall; promise: Promise<void> }>();

	try {
		const bootstrapCode = buildBootstrapScript(
			bridgeKey,
			options.tools,
			options.initialStore,
			options.includeModels,
		);
		const bootRes = evalJscWithDeadline(vmId, bootstrapCode, "codemode-internal.js", deadlineMs, options.timeoutMs);
		if (!bootRes.ok) {
			return emptyResult(performance.now() - startedAt, {
				ok: false,
				timedOut: bootRes.timedOut,
				error: bootRes.error,
			});
		}

		// Keep line 1 of user code at line 1 of codemode.js so stack traces report exact line numbers.
		const bridgeExpr = `globalThis[${toJsLiteral(bridgeKey)}]`;
		const startCode = `${bridgeExpr}.track((async function() {${options.code}\n})());`;
		const startRes = evalJscWithDeadline(vmId, startCode, "codemode.js", deadlineMs, options.timeoutMs);
		if (!startRes.ok) {
			const partial = readSnapshotBestEffort(vmId, bridgeKey);
			return {
				ok: false,
				timedOut: startRes.timedOut,
				error: startRes.error,
				outputs: partial?.outputs ?? [],
				consoleLines: partial?.consoleLines ?? [],
				storeDelta: partial?.storeDelta ?? { hasWrites: false, set: {}, delete: [] },
				wallTimeMs: performance.now() - startedAt,
			};
		}

		while (true) {
			if (options.signal?.aborted) {
				const partial = readSnapshotBestEffort(vmId, bridgeKey);
				const reason = formatAbortReason(options.signal.reason);
				return {
					ok: false,
					aborted: true,
					error: reason ? `Script aborted: ${reason}` : "Script aborted:",
					outputs: partial?.outputs ?? [],
					consoleLines: partial?.consoleLines ?? [],
					storeDelta: partial?.storeDelta ?? { hasWrites: false, set: {}, delete: [] },
					wallTimeMs: performance.now() - startedAt,
				};
			}

			if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
				const partial = readSnapshotBestEffort(vmId, bridgeKey);
				return {
					ok: false,
					timedOut: true,
					error: `Script timed out: exceeded ${options.timeoutMs ?? 0} ms`,
					outputs: partial?.outputs ?? [],
					consoleLines: partial?.consoleLines ?? [],
					storeDelta: partial?.storeDelta ?? { hasWrites: false, set: {}, delete: [] },
					wallTimeMs: performance.now() - startedAt,
				};
			}

			const snapRes = evalJscWithDeadline(
				vmId,
				`${bridgeExpr}.snapshot()`,
				"codemode-internal.js",
				deadlineMs,
				options.timeoutMs,
			);
			if (!snapRes.ok) {
				const partial = readSnapshotBestEffort(vmId, bridgeKey);
				return {
					ok: false,
					timedOut: snapRes.timedOut,
					error: snapRes.error,
					outputs: partial?.outputs ?? [],
					consoleLines: partial?.consoleLines ?? [],
					storeDelta: partial?.storeDelta ?? { hasWrites: false, set: {}, delete: [] },
					wallTimeMs: performance.now() - startedAt,
				};
			}

			const snapshot = JSON.parse(snapRes.value) as SandboxSnapshot;

			if (snapshot.status === "resolved" || snapshot.status === "exited") {
				return {
					ok: true,
					outputs: snapshot.outputs,
					consoleLines: snapshot.consoleLines,
					storeDelta: snapshot.storeDelta,
					wallTimeMs: performance.now() - startedAt,
				};
			}

			if (snapshot.status === "rejected") {
				return {
					ok: false,
					error: snapshot.error ?? "Script failed",
					outputs: snapshot.outputs,
					consoleLines: snapshot.consoleLines,
					storeDelta: snapshot.storeDelta,
					wallTimeMs: performance.now() - startedAt,
				};
			}

			for (const call of snapshot.pendingCalls) {
				const entry: { settled?: SettledRpcCall; promise: Promise<void> } = {
					promise: Promise.resolve(),
				};
				entry.promise = dispatchRpcCall(call, options.handlers, scriptAbort.signal).then((settled) => {
					entry.settled = settled;
				});
				inFlight.set(call.id, entry);
			}

			if (inFlight.size === 0) {
				return {
					ok: false,
					error: "Script awaited a promise that can never settle",
					outputs: snapshot.outputs,
					consoleLines: snapshot.consoleLines,
					storeDelta: snapshot.storeDelta,
					wallTimeMs: performance.now() - startedAt,
				};
			}

			// Wait for at least one in-flight call or abort/deadline, then flush all settled calls together.
			const wakeReason = await new Promise<"aborted" | "settled">((resolve) => {
				let done = false;
				const finish = (reason: "aborted" | "settled") => {
					if (done) return;
					done = true;
					scriptAbort.signal.removeEventListener("abort", onAbort);
					resolve(reason);
				};
				const onAbort = () => finish("aborted");
				if (scriptAbort.signal.aborted) {
					finish("aborted");
					return;
				}
				scriptAbort.signal.addEventListener("abort", onAbort, { once: true });
				for (const entry of inFlight.values()) {
					if (entry.settled) {
						finish("settled");
						return;
					}
					void entry.promise.then(() => finish("settled"));
				}
			});

			if (wakeReason === "aborted") {
				if (options.signal?.aborted) {
					const reason = formatAbortReason(options.signal.reason);
					return {
						ok: false,
						aborted: true,
						error: reason ? `Script aborted: ${reason}` : "Script aborted:",
						outputs: snapshot.outputs,
						consoleLines: snapshot.consoleLines,
						storeDelta: snapshot.storeDelta,
						wallTimeMs: performance.now() - startedAt,
					};
				}
				return {
					ok: false,
					timedOut: true,
					error: `Script timed out: exceeded ${options.timeoutMs ?? 0} ms`,
					outputs: snapshot.outputs,
					consoleLines: snapshot.consoleLines,
					storeDelta: snapshot.storeDelta,
					wallTimeMs: performance.now() - startedAt,
				};
			}

			// Let any same-tick promises settle so a Promise.all batch drains cleanly in one eval.
			await Promise.resolve();

			const settledBatch: SettledRpcCall[] = [];
			for (const [id, entry] of inFlight) {
				if (entry.settled) {
					settledBatch.push(entry.settled);
					inFlight.delete(id);
				}
			}

			if (settledBatch.length > 0) {
				const settleCode = `${bridgeExpr}.settle(${toJsLiteral(settledBatch)})`;
				const settleRes = evalJscWithDeadline(vmId, settleCode, "codemode-internal.js", deadlineMs, options.timeoutMs);
				if (!settleRes.ok) {
					const partial = readSnapshotBestEffort(vmId, bridgeKey);
					return {
						ok: false,
						timedOut: settleRes.timedOut,
						error: settleRes.error,
						outputs: partial?.outputs ?? snapshot.outputs,
						consoleLines: partial?.consoleLines ?? snapshot.consoleLines,
						storeDelta: partial?.storeDelta ?? snapshot.storeDelta,
						wallTimeMs: performance.now() - startedAt,
					};
				}
			}
		}
	} finally {
		if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
		options.signal?.removeEventListener("abort", onExternalAbort);
		scriptAbort.abort();
		nativeJscDestroy(vmId);
		releaseWorker();
	}
}
