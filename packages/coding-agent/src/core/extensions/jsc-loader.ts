/**
 * JavaScriptCore external JS/TS extension host for pi-native.
 *
 * Executes bundled extension modules inside isolated JavaScriptCore VMs via
 * @earendil-works/pi-native-ffi (with zero Node islands) and bridges the full
 * ExtensionAPI, virtual host modules, and async host-call pump loop.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Provider } from "@earendil-works/pi-ai";
import type { ComponentLike, KeyId } from "@earendil-works/pi-tui";
import {
	nativeJscCreate,
	nativeJscDestroy,
	nativeJscEval,
	type NativeJscEvalResult,
} from "../../../../pi-native-ffi/src/index.ts";
import {
	APP_NAME,
	CONFIG_DIR_NAME,
	getAgentDir,
	getDocsPath,
	getExamplesPath,
	getPackageDir,
	getReadmePath,
	VERSION,
} from "../../config.ts";
import type { EventBus } from "../event-bus.ts";
import { execCommand, type ExecOptions } from "../exec.ts";
import { bundleExtensionEntry, type BundledExtensionGraph } from "./ts-strip.ts";
import type {
	EntryRenderer,
	Extension,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionRuntime,
	ExtensionToolContext,
	MessageRenderer,
	ToolDefinition,
	ToolRenderContext,
} from "./types.ts";

export interface ExtensionLoaderHooks {
	createExtension: (extensionPath: string, resolvedPath: string) => Extension;
	createExtensionAPI: (
		extension: Extension,
		runtime: ExtensionRuntime,
		cwd: string,
		eventBus: EventBus,
	) => { api: ExtensionAPI; commit: () => void; discard: () => void };
}

interface JscOp {
	op: string;
	args: unknown[];
}

interface JscHostCall {
	callId: number;
	method: string;
	args: unknown[];
}

interface JscStepResult {
	done: boolean;
	ok: boolean;
	value?: unknown;
	error?: { message: string; stack?: string };
	ops: JscOp[];
	hostCalls: JscHostCall[];
	microtaskTick?: number;
}

interface JscHostCallResult {
	callId: number;
	ok: boolean;
	value?: unknown;
	error?: string;
}

interface ContextEntry {
	id: number;
	ctx: ExtensionContext;
	isCommand: boolean;
	isTool: boolean;
	onUpdate?: (partial: unknown) => void;
}

interface SeededFsEntry {
	exists: boolean;
	isFile: boolean;
	isDir: boolean;
	content?: string;
	entries?: string[];
}

const activeVmIds = new Set<number>();

/** Destroy all active JSC extension VMs (called on cache clear / reload). */
export function disposeAllExtensionJscVms(): void {
	for (const vmId of Array.from(activeVmIds)) {
		activeVmIds.delete(vmId);
		try {
			nativeJscDestroy(vmId);
		} catch {
			// Ignore shutdown errors on stale VM handles
		}
	}
}

function evalJscRaw(vmId: number, code: string, sourceUrl: string, timeoutMs = 15_000): string {
	const result: NativeJscEvalResult = nativeJscEval(vmId, code, sourceUrl, timeoutMs);
	if (!result.ok) {
		const prefix = result.timedOut ? "Extension VM timed out: " : "";
		throw new Error(`${prefix}${result.error}`);
	}
	return result.value;
}

function evalJscJson<T>(vmId: number, code: string, sourceUrl: string, timeoutMs = 15_000): T {
	const raw = evalJscRaw(vmId, code, sourceUrl, timeoutMs);
	if (raw.length === 0 || raw === "undefined") {
		return undefined as T;
	}
	return JSON.parse(raw) as T;
}

function toJsonSafe(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
		return value;
	}
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "function" || typeof value === "symbol") return undefined;
	if (depth > 8) return undefined;
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array) return Array.from(value);
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		for (let i = 0; i < value.length; i++) {
			out.push(toJsonSafe(value[i], depth + 1));
		}
		return out;
	}
	if (typeof value === "object") {
		if (value instanceof Map) {
			const out: Record<string, unknown> = {};
			for (const [k, v] of value.entries()) {
				out[String(k)] = toJsonSafe(v, depth + 1);
			}
			return out;
		}
		if (value instanceof Set) {
			return Array.from(value.values()).map((v) => toJsonSafe(v, depth + 1));
		}
		const obj = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(obj)) {
			const converted = toJsonSafe(obj[key], depth + 1);
			if (converted !== undefined) {
				out[key] = converted;
			}
		}
		return out;
	}
	return String(value);
}

function seedFsEntryForPath(targetPath: string, cache: Record<string, SeededFsEntry>, maxReadBytes = 256 * 1024): void {
	const resolved = path.resolve(targetPath);
	if (Object.prototype.hasOwnProperty.call(cache, resolved)) return;
	try {
		const stat = fs.statSync(resolved);
		if (stat.isDirectory()) {
			const entries = fs.readdirSync(resolved);
			cache[resolved] = { exists: true, isFile: false, isDir: true, entries };
			return;
		}
		if (stat.isFile()) {
			const content = stat.size <= maxReadBytes ? fs.readFileSync(resolved, "utf8") : undefined;
			cache[resolved] = { exists: true, isFile: true, isDir: false, content };
			return;
		}
	} catch {
		cache[resolved] = { exists: false, isFile: false, isDir: false };
	}
}

function seedDirectoryTree(dirPath: string, cache: Record<string, SeededFsEntry>, maxFiles = 64): void {
	const count = { n: 0 };
	const visit = (dir: string, depth: number) => {
		if (depth > 2 || count.n >= maxFiles) return;
		const resolved = path.resolve(dir);
		try {
			const entries = fs.readdirSync(resolved);
			cache[resolved] = { exists: true, isFile: false, isDir: true, entries };
			for (const entry of entries) {
				if (entry === "node_modules" || entry === ".git" || entry === ".scriptc") continue;
				if (count.n >= maxFiles) break;
				const child = path.join(resolved, entry);
				try {
					const st = fs.statSync(child);
					if (st.isDirectory()) {
						visit(child, depth + 1);
					} else if (st.isFile()) {
						count.n++;
						seedFsEntryForPath(child, cache);
					}
				} catch {
					// Ignore unreadable child
				}
			}
		} catch {
			// Ignore unreadable dir
		}
	};
	visit(dirPath, 0);
}

/**
 * Pure-JS JSC bootstrap implementing virtual host modules, Node sandbox shims,
 * ExtensionAPI & ExtensionContext wrappers, and step-based async host pump.
 */
function buildJscBootstrapSource(): string {
	return `
(function() {
  if (globalThis.__piBootstrapped) return;
  globalThis.__piBootstrapped = true;
  globalThis.global = globalThis;

  // --- Module Interop & Loader ---
  globalThis.__piImportDefault = function(m) {
    return m && m.__esModule ? m.default : m;
  };
  globalThis.__piImportStar = function(m) {
    if (m && m.__esModule) return m;
    const r = { default: m };
    if (m != null && typeof m === "object") {
      for (const k of Object.keys(m)) {
        if (k !== "default") r[k] = m[k];
      }
    }
    return r;
  };
  globalThis.__piExportStar = function(m, exp) {
    if (m != null && typeof m === "object") {
      for (const k of Object.keys(m)) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(exp, k)) {
          exp[k] = m[k];
        }
      }
    }
  };

  // --- Shared State, Task & Outbox ---
  const state = {
    cwd: "/",
    env: {},
    os: { homedir: "/", tmpdir: "/tmp", platform: "darwin", arch: "arm64", hostname: "localhost", eol: "\\n", type: "Darwin", release: "24.0.0", user: "pi" },
    constants: { version: "0.0.0", appName: "pi", configDirName: ".pi", agentDir: "", packageDir: "", docsPath: "", examplesPath: "", readmePath: "", modelsPath: "", settingsPath: "", sessionsDir: "" },
    runtimeInitialized: false,
    runtime: { activeTools: [], allTools: [], commands: [], settings: {}, sessionName: undefined, thinkingLevel: "off", flagValues: {}, mcpServers: [] },
    aiModels: [],
    fsCache: {},
    contexts: {},
  };

  let nextFnId = 1;
  const fnTable = new Map();
  let nextCompId = 1;
  const compTable = new Map();
  let nextSubId = 1;
  let nextCallId = 1;
  let nextTaskId = 1;
  let microtaskCounter = 0;
  const tasks = new Map();
  const callResolvers = new Map();
  const pendingOps = [];
  const pendingHostCalls = [];
  const registeredFlags = new Map();
  const timerTable = new Map();
  let nextTimerId = 1;

  function registerFn(fn) {
    const id = nextFnId++;
    fnTable.set(id, fn);
    return id;
  }

  function emitOp(op, args) {
    pendingOps.push({ op, args });
  }

  function hostAsync(method, args) {
    return new Promise((resolve, reject) => {
      const callId = nextCallId++;
      callResolvers.set(callId, { resolve, reject });
      pendingHostCalls.push({ callId, method, args });
    });
  }

  function updateState(patch) {
    if (!patch || typeof patch !== "object") return;
    if (typeof patch.cwd === "string") state.cwd = patch.cwd;
    if (patch.env && typeof patch.env === "object") state.env = patch.env;
    if (patch.os && typeof patch.os === "object") state.os = patch.os;
    if (patch.constants && typeof patch.constants === "object") state.constants = patch.constants;
    if (typeof patch.runtimeInitialized === "boolean") state.runtimeInitialized = patch.runtimeInitialized;
    if (patch.runtime && typeof patch.runtime === "object") {
      state.runtime = Object.assign({}, state.runtime, patch.runtime);
    }
    if (Array.isArray(patch.aiModels)) state.aiModels = patch.aiModels;
    if (patch.fsCache && typeof patch.fsCache === "object") {
      for (const k of Object.keys(patch.fsCache)) {
        state.fsCache[k] = patch.fsCache[k];
      }
    }
    if (patch.contexts && typeof patch.contexts === "object") {
      for (const k of Object.keys(patch.contexts)) {
        state.contexts[k] = patch.contexts[k];
      }
    }
  }

  // --- Globals: console, timers, TextEncoder/Decoder, Buffer, AbortController, structuredClone, fetch, process ---
  function formatLogArgs(args) {
    return args.map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack || (a.name + ": " + a.message);
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(" ");
  }

  globalThis.console = {
    log: (...args) => emitOp("console", ["log", formatLogArgs(args)]),
    info: (...args) => emitOp("console", ["info", formatLogArgs(args)]),
    warn: (...args) => emitOp("console", ["warn", formatLogArgs(args)]),
    error: (...args) => emitOp("console", ["error", formatLogArgs(args)]),
    debug: (...args) => emitOp("console", ["debug", formatLogArgs(args)]),
  };

  if (typeof globalThis.queueMicrotask !== "function") {
    globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
  }

  globalThis.setTimeout = function(fn, delay = 0, ...args) {
    if (typeof fn !== "function") throw new TypeError("setTimeout expects a function");
    const id = nextTimerId++;
    const ms = Math.max(0, Number(delay) || 0);
    const entry = { active: true, interval: false };
    timerTable.set(id, entry);
    hostAsync("timer", [ms]).then(() => {
      if (!entry.active) return;
      timerTable.delete(id);
      fn(...args);
    });
    return id;
  };
  globalThis.clearTimeout = function(id) {
    const entry = timerTable.get(id);
    if (entry) {
      entry.active = false;
      timerTable.delete(id);
    }
  };
  globalThis.setInterval = function(fn, delay = 10, ...args) {
    if (typeof fn !== "function") throw new TypeError("setInterval expects a function");
    const id = nextTimerId++;
    const ms = Math.max(1, Number(delay) || 1);
    const entry = { active: true, interval: true };
    timerTable.set(id, entry);
    const tick = () => {
      hostAsync("timer", [ms]).then(() => {
        if (!entry.active) return;
        try { fn(...args); } finally { if (entry.active) tick(); }
      });
    };
    tick();
    return id;
  };
  globalThis.clearInterval = globalThis.clearTimeout;

  if (typeof globalThis.TextEncoder !== "function") {
    globalThis.TextEncoder = class TextEncoder {
      constructor() { this.encoding = "utf-8"; }
      encode(input = "") {
        const s = String(input ?? "");
        const bytes = [];
        for (let i = 0; i < s.length; i++) {
          let c = s.charCodeAt(i);
          if (c < 0x80) bytes.push(c);
          else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
          else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            const c2 = s.charCodeAt(++i);
            const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
            bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          } else {
            bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
          }
        }
        return new Uint8Array(bytes);
      }
      encodeInto(src, dst) {
        const bytes = this.encode(src);
        const n = Math.min(bytes.length, dst.length);
        dst.set(bytes.subarray(0, n));
        return { read: String(src).length, written: n };
      }
    };
  }
  if (typeof globalThis.TextDecoder !== "function") {
    globalThis.TextDecoder = class TextDecoder {
      constructor(label = "utf-8") { this.encoding = String(label || "utf-8").toLowerCase(); }
      decode(input) {
        if (input == null) return "";
        const u8 = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
        let out = "";
        for (let i = 0; i < u8.length;) {
          const b0 = u8[i++];
          if (b0 < 0x80) out += String.fromCharCode(b0);
          else if (b0 < 0xe0) { out += String.fromCharCode(((b0 & 0x1f) << 6) | (u8[i++] & 0x3f)); }
          else if (b0 < 0xf0) { out += String.fromCharCode(((b0 & 0x0f) << 12) | ((u8[i++] & 0x3f) << 6) | (u8[i++] & 0x3f)); }
          else {
            const cp = (((b0 & 0x07) << 18) | ((u8[i++] & 0x3f) << 12) | ((u8[i++] & 0x3f) << 6) | (u8[i++] & 0x3f)) - 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
          }
        }
        return out;
      }
    };
  }

  if (typeof globalThis.btoa !== "function") {
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    globalThis.btoa = function(input) {
      const str = String(input ?? "");
      let out = "";
      for (let i = 0; i < str.length; i += 3) {
        const a = str.charCodeAt(i) & 0xff;
        const b = i + 1 < str.length ? (str.charCodeAt(i + 1) & 0xff) : 0;
        const c = i + 2 < str.length ? (str.charCodeAt(i + 2) & 0xff) : 0;
        const triple = (a << 16) | (b << 8) | c;
        out += B64[(triple >> 18) & 63];
        out += B64[(triple >> 12) & 63];
        out += i + 1 < str.length ? B64[(triple >> 6) & 63] : "=";
        out += i + 2 < str.length ? B64[triple & 63] : "=";
      }
      return out;
    };
  }
  if (typeof globalThis.atob !== "function") {
    const B64_REV = new Int16Array(256).fill(-1);
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let i = 0; i < B64.length; i++) B64_REV[B64.charCodeAt(i)] = i;
    globalThis.atob = function(input) {
      const clean = String(input ?? "").replace(/[^A-Za-z0-9+/=]/g, "");
      let out = "";
      for (let i = 0; i < clean.length; i += 4) {
        const c1 = B64_REV[clean.charCodeAt(i)] ?? -1;
        const c2 = B64_REV[clean.charCodeAt(i + 1)] ?? -1;
        const eq3 = clean[i + 2] === "=";
        const eq4 = clean[i + 3] === "=";
        const c3 = eq3 ? 0 : (B64_REV[clean.charCodeAt(i + 2)] ?? 0);
        const c4 = eq4 ? 0 : (B64_REV[clean.charCodeAt(i + 3)] ?? 0);
        if (c1 < 0 || c2 < 0) continue;
        const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
        out += String.fromCharCode((triple >> 16) & 0xff);
        if (!eq3 && i + 2 < clean.length) out += String.fromCharCode((triple >> 8) & 0xff);
        if (!eq4 && i + 3 < clean.length) out += String.fromCharCode(triple & 0xff);
      }
      return out;
    };
  }

  class PiBuffer extends Uint8Array {
    static from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        const enc = (typeof encodingOrOffset === "string" ? encodingOrOffset : "utf8").toLowerCase();
        if (enc === "base64") {
          const bin = typeof atob === "function" ? atob(value) : "";
          const out = new PiBuffer(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        }
        if (enc === "hex") {
          const out = new PiBuffer(Math.floor(value.length / 2));
          for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16) || 0;
          return out;
        }
        const bytes = new globalThis.TextEncoder().encode(value);
        const out = new PiBuffer(bytes.length);
        out.set(bytes);
        return out;
      }
      if (value instanceof ArrayBuffer) {
        const u8 = new Uint8Array(value, encodingOrOffset || 0, length);
        const out = new PiBuffer(u8.length);
        out.set(u8);
        return out;
      }
      const arr = Array.from(value || []);
      const out = new PiBuffer(arr.length);
      out.set(arr);
      return out;
    }
    static alloc(size, fill = 0) {
      const b = new PiBuffer(Math.max(0, Number(size) || 0));
      if (fill) b.fill(typeof fill === "number" ? fill : 0);
      return b;
    }
    static allocUnsafe(size) { return new PiBuffer(Math.max(0, Number(size) || 0)); }
    static isBuffer(obj) { return obj instanceof PiBuffer || obj instanceof Uint8Array; }
    static byteLength(input) { return typeof input === "string" ? new globalThis.TextEncoder().encode(input).length : (input && input.byteLength) || 0; }
    static concat(list, totalLength) {
      const items = Array.from(list || []);
      const len = totalLength !== undefined ? totalLength : items.reduce((s, b) => s + b.length, 0);
      const out = new PiBuffer(len);
      let off = 0;
      for (const item of items) {
        if (off >= len) break;
        const slice = item.subarray(0, Math.max(0, len - off));
        out.set(slice, off);
        off += slice.length;
      }
      return out;
    }
    toString(encoding = "utf8", start = 0, end = this.length) {
      const slice = this.subarray(start, end);
      const enc = String(encoding || "utf8").toLowerCase();
      if (enc === "hex") {
        let hex = "";
        for (let i = 0; i < slice.length; i++) hex += slice[i].toString(16).padStart(2, "0");
        return hex;
      }
      if (enc === "base64") {
        let bin = "";
        for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]);
        return typeof btoa === "function" ? btoa(bin) : bin;
      }
      return new globalThis.TextDecoder().decode(slice);
    }
  }
  if (typeof globalThis.Buffer === "undefined") {
    globalThis.Buffer = PiBuffer;
  }

  if (typeof globalThis.AbortSignal !== "function") {
    class AbortSignal {
      constructor() { this.aborted = false; this.reason = undefined; this._listeners = []; this.onabort = null; }
      addEventListener(type, fn, opts) {
        if (type !== "abort" || typeof fn !== "function") return;
        if (this.aborted) { fn({ type: "abort" }); return; }
        this._listeners.push({ fn, once: Boolean(opts && opts.once) });
      }
      removeEventListener(type, fn) {
        if (type !== "abort") return;
        this._listeners = this._listeners.filter((x) => x.fn !== fn);
      }
      throwIfAborted() { if (this.aborted) throw this.reason; }
      _trigger(reason) {
        if (this.aborted) return;
        this.aborted = true;
        this.reason = reason !== undefined ? reason : new Error("Aborted");
        if (typeof this.onabort === "function") this.onabort({ type: "abort" });
        const copy = this._listeners.slice();
        this._listeners = this._listeners.filter((x) => !x.once);
        for (const item of copy) item.fn({ type: "abort" });
      }
      static abort(reason) { const s = new AbortSignal(); s._trigger(reason); return s; }
      static timeout(ms) {
        const s = new AbortSignal();
        globalThis.setTimeout(() => s._trigger(new Error("TimeoutError")), ms);
        return s;
      }
    }
    class AbortController {
      constructor() { this.signal = new AbortSignal(); }
      abort(reason) { this.signal._trigger(reason); }
    }
    globalThis.AbortSignal = AbortSignal;
    globalThis.AbortController = AbortController;
  }

  if (typeof globalThis.structuredClone !== "function") {
    globalThis.structuredClone = function(val) {
      return val === undefined ? undefined : JSON.parse(JSON.stringify(val));
    };
  }

  globalThis.fetch = async function(input, init) {
    const url = typeof input === "string" ? input : (input && input.url ? String(input.url) : String(input));
    const reqInit = init ? {
      method: init.method,
      headers: init.headers,
      body: typeof init.body === "string" ? init.body : (init.body != null ? String(init.body) : undefined),
    } : undefined;
    const res = await hostAsync("fetch", [url, reqInit]);
    const bodyStr = String(res.body ?? "");
    const headersObj = res.headers || {};
    const headersMap = new Map(Object.entries(headersObj).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return {
      ok: Boolean(res.ok),
      status: Number(res.status || 200),
      statusText: String(res.statusText || ""),
      url: String(res.url || url),
      redirected: Boolean(res.redirected),
      headers: {
        get: (name) => headersMap.get(String(name).toLowerCase()) ?? null,
        has: (name) => headersMap.has(String(name).toLowerCase()),
        entries: () => headersMap.entries(),
        forEach: (cb) => headersMap.forEach((v, k) => cb(v, k)),
      },
      text: async () => bodyStr,
      json: async () => JSON.parse(bodyStr),
      arrayBuffer: async () => new globalThis.TextEncoder().encode(bodyStr).buffer,
    };
  };

  globalThis.process = {
    get env() { return state.env; },
    argv: ["pi"],
    cwd: () => state.cwd,
    chdir: (d) => { state.cwd = posixPath.resolve(state.cwd, String(d)); },
    get platform() { return state.os.platform || "darwin"; },
    get arch() { return state.os.arch || "arm64"; },
    version: "v24.0.0",
    versions: {},
    pid: 1,
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
    hrtime: (prev) => {
      const now = Date.now();
      const s = Math.floor(now / 1000);
      const ns = (now % 1000) * 1e6;
      if (prev) return [s - prev[0], ns - prev[1]];
      return [s, ns];
    },
    stdout: { isTTY: false, write: (s) => { emitOp("console", ["log", String(s)]); return true; } },
    stderr: { isTTY: false, write: (s) => { emitOp("console", ["error", String(s)]); return true; } },
    stdin: { isTTY: false },
    exit: () => {},
  };

  // --- Pure-JS Node Shims ---
  const posixPath = {
    sep: "/",
    delimiter: ":",
    normalize(p) {
      p = String(p || "");
      if (p.length === 0) return ".";
      const abs = p.startsWith("/");
      const trailing = p.endsWith("/") && p.length > 1;
      const parts = [];
      for (const seg of p.split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") {
          if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
          else if (!abs) parts.push("..");
        } else {
          parts.push(seg);
        }
      }
      let res = (abs ? "/" : "") + parts.join("/");
      if (res.length === 0) return abs ? "/" : ".";
      if (trailing && res !== "/") res += "/";
      return res;
    },
    isAbsolute(p) { return String(p || "").startsWith("/"); },
    join(...args) {
      const joined = args.filter((a) => typeof a === "string" && a.length > 0).join("/");
      return joined.length === 0 ? "." : posixPath.normalize(joined);
    },
    resolve(...args) {
      let resolved = "";
      let abs = false;
      for (let i = args.length - 1; i >= -1 && !abs; i--) {
        const p = i >= 0 ? String(args[i] ?? "") : state.cwd;
        if (!p) continue;
        resolved = resolved ? p + "/" + resolved : p;
        abs = p.startsWith("/");
      }
      const norm = posixPath.normalize(resolved);
      return norm.length > 1 && norm.endsWith("/") ? norm.slice(0, -1) : norm;
    },
    dirname(p) {
      p = String(p || "");
      if (!p) return ".";
      let end = p.length - 1;
      while (end > 0 && p[end] === "/") end--;
      const slash = p.lastIndexOf("/", end);
      if (slash === -1) return ".";
      if (slash === 0) return "/";
      return p.slice(0, slash);
    },
    basename(p, ext) {
      p = String(p || "");
      let end = p.length;
      while (end > 1 && p[end - 1] === "/") end--;
      const start = p.lastIndexOf("/", end - 1) + 1;
      let base = p.slice(start, end);
      if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);
      return base;
    },
    extname(p) {
      const base = posixPath.basename(p);
      const dot = base.lastIndexOf(".");
      return dot <= 0 ? "" : base.slice(dot);
    },
    relative(from, to) {
      const a = posixPath.resolve(from).split("/").filter(Boolean);
      const b = posixPath.resolve(to).split("/").filter(Boolean);
      let common = 0;
      while (common < a.length && common < b.length && a[common] === b[common]) common++;
      return [...Array(a.length - common).fill(".."), ...b.slice(common)].join("/") || "";
    },
    parse(p) {
      p = String(p || "");
      const root = p.startsWith("/") ? "/" : "";
      const dir = posixPath.dirname(p);
      const base = posixPath.basename(p);
      const ext = posixPath.extname(base);
      const name = ext ? base.slice(0, -ext.length) : base;
      return { root, dir: dir === "." && root ? "/" : dir, base, ext, name };
    },
    format(obj) {
      const dir = obj.dir || obj.root || "";
      const base = obj.base || ((obj.name || "") + (obj.ext || ""));
      return dir ? (dir === "/" ? "/" + base : dir + "/" + base) : base;
    },
  };
  posixPath.posix = posixPath;
  posixPath.win32 = posixPath;

  function resolveFsPath(raw) {
    const s = String(raw || "");
    if (s.startsWith("file://")) return urlShim.fileURLToPath(s);
    return posixPath.resolve(state.cwd, s);
  }

  const fsShim = {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
    existsSync(p) {
      const rp = resolveFsPath(p);
      return Boolean(state.fsCache[rp] && state.fsCache[rp].exists);
    },
    readFileSync(p, opts) {
      const rp = resolveFsPath(p);
      const entry = state.fsCache[rp];
      if (!entry || !entry.exists || !entry.isFile || entry.content === undefined) {
        const err = new Error("ENOENT: no such file or directory, open '" + rp + "'");
        err.code = "ENOENT";
        throw err;
      }
      if (opts && (opts === "utf8" || opts === "utf-8" || opts.encoding === "utf8" || opts.encoding === "utf-8")) {
        return entry.content;
      }
      return PiBuffer.from(entry.content, "utf8");
    },
    writeFileSync(p, data) {
      const rp = resolveFsPath(p);
      const str = typeof data === "string" ? data : new globalThis.TextDecoder().decode(data);
      state.fsCache[rp] = { exists: true, isFile: true, isDir: false, content: str };
      emitOp("fs.writeFileSync", [rp, str]);
    },
    appendFileSync(p, data) {
      const rp = resolveFsPath(p);
      const str = typeof data === "string" ? data : new globalThis.TextDecoder().decode(data);
      const prev = state.fsCache[rp] && state.fsCache[rp].content ? state.fsCache[rp].content : "";
      state.fsCache[rp] = { exists: true, isFile: true, isDir: false, content: prev + str };
      emitOp("fs.appendFileSync", [rp, str]);
    },
    mkdirSync(p, opts) {
      const rp = resolveFsPath(p);
      state.fsCache[rp] = { exists: true, isFile: false, isDir: true, entries: [] };
      emitOp("fs.mkdirSync", [rp, Boolean(opts && opts.recursive)]);
    },
    readdirSync(p, opts) {
      const rp = resolveFsPath(p);
      const entry = state.fsCache[rp];
      if (!entry || !entry.exists || !entry.isDir) {
        const err = new Error("ENOENT: no such directory, scandir '" + rp + "'");
        err.code = "ENOENT";
        throw err;
      }
      const names = entry.entries || [];
      if (opts && opts.withFileTypes) {
        return names.map((name) => {
          const child = state.fsCache[posixPath.join(rp, name)];
          const isD = Boolean(child && child.isDir);
          const isF = !isD;
          return { name, isDirectory: () => isD, isFile: () => isF, isSymbolicLink: () => false };
        });
      }
      return names.slice();
    },
    statSync(p) {
      const rp = resolveFsPath(p);
      const entry = state.fsCache[rp];
      if (!entry || !entry.exists) {
        const err = new Error("ENOENT: no such file or directory, stat '" + rp + "'");
        err.code = "ENOENT";
        throw err;
      }
      const sz = entry.content ? entry.content.length : 0;
      return { size: sz, isFile: () => entry.isFile, isDirectory: () => entry.isDir, isSymbolicLink: () => false, mtimeMs: Date.now() };
    },
    lstatSync(p) { return fsShim.statSync(p); },
    unlinkSync(p) {
      const rp = resolveFsPath(p);
      state.fsCache[rp] = { exists: false, isFile: false, isDir: false };
      emitOp("fs.unlinkSync", [rp]);
    },
    rmSync(p, opts) {
      const rp = resolveFsPath(p);
      state.fsCache[rp] = { exists: false, isFile: false, isDir: false };
      emitOp("fs.rmSync", [rp, opts || {}]);
    },
    rmdirSync(p) { fsShim.rmSync(p, { recursive: false }); },
    renameSync(src, dst) {
      const rs = resolveFsPath(src);
      const rd = resolveFsPath(dst);
      if (state.fsCache[rs]) {
        state.fsCache[rd] = state.fsCache[rs];
        state.fsCache[rs] = { exists: false, isFile: false, isDir: false };
      }
      emitOp("fs.renameSync", [rs, rd]);
    },
    copyFileSync(src, dst) {
      const rs = resolveFsPath(src);
      const rd = resolveFsPath(dst);
      if (state.fsCache[rs] && state.fsCache[rs].isFile) {
        state.fsCache[rd] = Object.assign({}, state.fsCache[rs]);
      }
      emitOp("fs.copyFileSync", [rs, rd]);
    },
    realpathSync(p) { return resolveFsPath(p); },
    chmodSync() {},
    accessSync(p) {
      if (!fsShim.existsSync(p)) {
        const err = new Error("ENOENT: no such file or directory, access '" + p + "'");
        err.code = "ENOENT";
        throw err;
      }
    },
    watch() { return { close() {}, on() { return this; } }; },
    promises: {
      readFile: (p, opts) => hostAsync("fs.readFile", [resolveFsPath(p), opts ?? null]),
      writeFile: (p, data, opts) => hostAsync("fs.writeFile", [resolveFsPath(p), typeof data === "string" ? data : new globalThis.TextDecoder().decode(data), opts ?? null]),
      appendFile: (p, data) => hostAsync("fs.appendFile", [resolveFsPath(p), typeof data === "string" ? data : new globalThis.TextDecoder().decode(data)]),
      mkdir: (p, opts) => hostAsync("fs.mkdir", [resolveFsPath(p), opts ?? null]),
      readdir: (p, opts) => hostAsync("fs.readdir", [resolveFsPath(p), opts ?? null]),
      stat: (p) => hostAsync("fs.stat", [resolveFsPath(p)]).then((s) => ({ ...s, isFile: () => s.isFile, isDirectory: () => s.isDir, isSymbolicLink: () => false })),
      lstat: (p) => hostAsync("fs.stat", [resolveFsPath(p)]).then((s) => ({ ...s, isFile: () => s.isFile, isDirectory: () => s.isDir, isSymbolicLink: () => false })),
      unlink: (p) => hostAsync("fs.unlink", [resolveFsPath(p)]),
      rm: (p, opts) => hostAsync("fs.rm", [resolveFsPath(p), opts ?? null]),
      rmdir: (p) => hostAsync("fs.rm", [resolveFsPath(p), { recursive: false }]),
      rename: (s, d) => hostAsync("fs.rename", [resolveFsPath(s), resolveFsPath(d)]),
      copyFile: (s, d) => hostAsync("fs.copyFile", [resolveFsPath(s), resolveFsPath(d)]),
      realpath: (p) => hostAsync("fs.realpath", [resolveFsPath(p)]),
      access: (p) => hostAsync("fs.access", [resolveFsPath(p)]),
      mkdtemp: (prefix) => hostAsync("fs.mkdtemp", [String(prefix || "/tmp/pi-")]),
      chmod: async () => {},
      constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
    },
  };

  const urlShim = {
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    fileURLToPath(u) {
      const str = typeof u === "string" ? u : String(u);
      return str.startsWith("file://") ? decodeURIComponent(str.slice(7)) : str;
    },
    pathToFileURL(p) {
      const rp = resolveFsPath(p);
      return new globalThis.URL("file://" + encodeURI(rp));
    },
  };

  class EventEmitter {
    constructor() { this._events = new Map(); this._max = 10; }
    setMaxListeners(n) { this._max = n; return this; }
    on(ev, fn) {
      const arr = this._events.get(ev) || [];
      arr.push(fn);
      this._events.set(ev, arr);
      return this;
    }
    addListener(ev, fn) { return this.on(ev, fn); }
    once(ev, fn) {
      const wrapper = (...args) => { this.off(ev, wrapper); return fn.apply(this, args); };
      wrapper._orig = fn;
      return this.on(ev, wrapper);
    }
    off(ev, fn) {
      const arr = this._events.get(ev);
      if (!arr) return this;
      this._events.set(ev, arr.filter((x) => x !== fn && x._orig !== fn));
      return this;
    }
    removeListener(ev, fn) { return this.off(ev, fn); }
    removeAllListeners(ev) {
      if (ev === undefined) this._events.clear();
      else this._events.delete(ev);
      return this;
    }
    listeners(ev) { return (this._events.get(ev) || []).slice(); }
    listenerCount(ev) { return (this._events.get(ev) || []).length; }
    emit(ev, ...args) {
      const arr = (this._events.get(ev) || []).slice();
      for (const fn of arr) fn.apply(this, args);
      return arr.length > 0;
    }
  }

  function sha256Bytes(msgBytes) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a;
    let H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;
    const rotr = (n, x) => (x >>> n) | (x << (32 - n));
    const len = msgBytes.length;
    const bitLen = len * 8;
    const paddedLen = Math.ceil((len + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLen);
    padded.set(msgBytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(paddedLen - 4, bitLen >>> 0, false);
    const W = new Uint32Array(64);
    for (let off = 0; off < paddedLen; off += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4, false);
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
        const s1 = rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
      H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
    }
    const out = new PiBuffer(32);
    const outDv = new DataView(out.buffer);
    outDv.setUint32(0, H0, false); outDv.setUint32(4, H1, false); outDv.setUint32(8, H2, false); outDv.setUint32(12, H3, false);
    outDv.setUint32(16, H4, false); outDv.setUint32(20, H5, false); outDv.setUint32(24, H6, false); outDv.setUint32(28, H7, false);
    return out;
  }

  function randomBytes(n) {
    const out = new PiBuffer(Math.max(0, Number(n) || 0));
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
      globalThis.crypto.getRandomValues(out);
    } else {
      for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
    }
    return out;
  }

  function uuidv4() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    const b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString("hex");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function uuidv7() {
    const now = Date.now();
    const b = randomBytes(16);
    b[0] = (now / 0x10000000000) & 0xff;
    b[1] = (now / 0x100000000) & 0xff;
    b[2] = (now / 0x1000000) & 0xff;
    b[3] = (now / 0x10000) & 0xff;
    b[4] = (now / 0x100) & 0xff;
    b[5] = now & 0xff;
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString("hex");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  const cryptoShim = {
    randomBytes,
    randomUUID: uuidv4,
    randomInt(min, max) {
      if (max === undefined) { max = min; min = 0; }
      return min + Math.floor(Math.random() * (max - min));
    },
    createHash(_alg) {
      const chunks = [];
      return {
        update(data) {
          chunks.push(typeof data === "string" ? PiBuffer.from(data, "utf8") : PiBuffer.from(data));
          return this;
        },
        digest(enc) {
          const buf = sha256Bytes(PiBuffer.concat(chunks));
          return enc ? buf.toString(enc) : buf;
        },
      };
    },
    createHmac(alg, _key) { return cryptoShim.createHash(alg); },
    webcrypto: globalThis.crypto,
  };

  const osShim = {
    homedir: () => state.os.homedir || "/",
    tmpdir: () => state.os.tmpdir || "/tmp",
    platform: () => state.os.platform || "darwin",
    arch: () => state.os.arch || "arm64",
    hostname: () => state.os.hostname || "localhost",
    cpus: () => [],
    EOL: "\\n",
    type: () => state.os.type || "Darwin",
    release: () => state.os.release || "24.0.0",
    userInfo: () => ({ username: state.os.user || "pi", homedir: state.os.homedir || "/", shell: "/bin/zsh", uid: 501, gid: 20 }),
  };

  const utilShim = {
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    promisify(fn) {
      return (...args) => new Promise((resolve, reject) => {
        fn(...args, (err, ...vals) => {
          if (err) reject(err);
          else resolve(vals.length <= 1 ? vals[0] : vals);
        });
      });
    },
    format(fmt, ...args) {
      if (typeof fmt !== "string") return [fmt, ...args].map((x) => String(x)).join(" ");
      let idx = 0;
      return fmt.replace(/%[sdjifoO%]/g, (m) => {
        if (m === "%%") return "%";
        if (idx >= args.length) return m;
        const val = args[idx++];
        if (m === "%j") { try { return JSON.stringify(val); } catch { return String(val); } }
        return String(val);
      }) + (idx < args.length ? " " + args.slice(idx).map((x) => String(x)).join(" ") : "");
    },
    inspect(val) { try { return typeof val === "string" ? val : JSON.stringify(val, null, 2); } catch { return String(val); } },
    inherits(ctor, superCtor) {
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    },
    types: {
      isArrayBuffer: (v) => v instanceof ArrayBuffer,
      isUint8Array: (v) => v instanceof Uint8Array,
      isPromise: (v) => Boolean(v && typeof v.then === "function"),
    },
  };

  const assertShim = {
    ok(v, msg) { if (!v) throw new Error(msg || "Assertion failed"); },
    strictEqual(a, b, msg) { if (!Object.is(a, b)) throw new Error(msg || ("Expected " + String(a) + " === " + String(b))); },
    notStrictEqual(a, b, msg) { if (Object.is(a, b)) throw new Error(msg || ("Expected values not strictly equal")); },
    deepStrictEqual(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || "Deep strict equal failed"); },
    equal(a, b, msg) { if (a != b) throw new Error(msg || "Expected equal"); },
    notEqual(a, b, msg) { if (a == b) throw new Error(msg || "Expected not equal"); },
    fail(msg) { throw new Error(msg || "Assertion failed"); },
    throws(fn, msg) {
      let threw = false;
      try { fn(); } catch { threw = true; }
      if (!threw) throw new Error(msg || "Expected function to throw");
    },
  };
  assertShim.strict = assertShim;

  class PassThroughStream extends EventEmitter {
    constructor() { super(); this._chunks = []; }
    write(chunk) { this._chunks.push(chunk); this.emit("data", chunk); return true; }
    end(chunk) { if (chunk !== undefined) this.write(chunk); this.emit("end"); return this; }
    pipe(dest) { this.on("data", (d) => dest.write(d)); this.on("end", () => dest.end && dest.end()); return dest; }
  }
  const streamShim = { EventEmitter, Readable: PassThroughStream, Writable: PassThroughStream, Transform: PassThroughStream, PassThrough: PassThroughStream, Stream: EventEmitter };

  // --- Virtual Modules ---
  const KindSym = Symbol.for("TypeBox.Kind");
  const OptionalSym = Symbol.for("TypeBox.Optional");
  const ReadonlySym = Symbol.for("TypeBox.Readonly");

  function cloneSchema(base, opts, kind) {
    const out = {};
    if (base && typeof base === "object") {
      for (const k of Object.keys(base)) {
        if (base[k] !== undefined) out[k] = base[k];
      }
    }
    if (opts && typeof opts === "object") {
      for (const k of Object.keys(opts)) {
        if (opts[k] !== undefined) out[k] = opts[k];
      }
    }
    if (kind !== undefined) {
      Object.defineProperty(out, KindSym, { value: kind, enumerable: false, configurable: true });
      Object.defineProperty(out, "~kind", { value: kind, enumerable: false, configurable: true });
    }
    return out;
  }

  const Type = {
    Object(properties = {}, options) {
      const props = {};
      const required = [];
      for (const key of Object.keys(properties || {})) {
        const s = properties[key];
        props[key] = s;
        if (s && !s[OptionalSym] && !s["~optional"]) required.push(key);
      }
      const res = cloneSchema({ type: "object", properties: props }, options, "Object");
      if (required.length > 0) res.required = required;
      return res;
    },
    String: (opts) => cloneSchema({ type: "string" }, opts, "String"),
    Number: (opts) => cloneSchema({ type: "number" }, opts, "Number"),
    Integer: (opts) => cloneSchema({ type: "integer" }, opts, "Integer"),
    Boolean: (opts) => cloneSchema({ type: "boolean" }, opts, "Boolean"),
    Null: (opts) => cloneSchema({ type: "null" }, opts, "Null"),
    Undefined: (opts) => cloneSchema({ type: "undefined" }, opts, "Undefined"),
    BigInt: (opts) => cloneSchema({ type: "bigint" }, opts, "BigInt"),
    Any: (opts) => cloneSchema({}, opts, "Any"),
    Unknown: (opts) => cloneSchema({}, opts, "Unknown"),
    Never: (opts) => cloneSchema({ not: {} }, opts, "Never"),
    Void: (opts) => cloneSchema({ type: "void" }, opts, "Void"),
    Symbol: (opts) => cloneSchema({}, opts, "Symbol"),
    Array: (items, opts) => cloneSchema({ type: "array", items }, opts, "Array"),
    Tuple: (items = [], opts) => cloneSchema({ type: "array", items: [...items], minItems: items.length, maxItems: items.length }, opts, "Tuple"),
    Optional(schema) {
      const cloned = cloneSchema(schema, undefined, schema && schema[KindSym]);
      if (schema && schema[ReadonlySym]) {
        Object.defineProperty(cloned, ReadonlySym, { value: "Readonly", enumerable: false, configurable: true });
        Object.defineProperty(cloned, "~readonly", { value: true, enumerable: false, configurable: true });
      }
      Object.defineProperty(cloned, OptionalSym, { value: "Optional", enumerable: false, configurable: true });
      Object.defineProperty(cloned, "~optional", { value: true, enumerable: false, configurable: true });
      return cloned;
    },
    Readonly(schema) {
      const cloned = cloneSchema(schema, undefined, schema && schema[KindSym]);
      if (schema && schema[OptionalSym]) {
        Object.defineProperty(cloned, OptionalSym, { value: "Optional", enumerable: false, configurable: true });
        Object.defineProperty(cloned, "~optional", { value: true, enumerable: false, configurable: true });
      }
      Object.defineProperty(cloned, ReadonlySym, { value: "Readonly", enumerable: false, configurable: true });
      Object.defineProperty(cloned, "~readonly", { value: true, enumerable: false, configurable: true });
      return cloned;
    },
    ReadonlyOptional: (schema) => Type.Readonly(Type.Optional(schema)),
    Literal: (value, opts) => cloneSchema({ const: value, type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : typeof value === "string" ? "string" : undefined }, opts, "Literal"),
    Union: (anyOf = [], opts) => cloneSchema({ anyOf: [...anyOf] }, opts, "Union"),
    Intersect: (allOf = [], opts) => cloneSchema({ allOf: [...allOf] }, opts, "Intersect"),
    Enum(item, opts) {
      const vals = [];
      if (item && typeof item === "object") {
        for (const k of Object.keys(item)) {
          if (typeof item[item[k]] === "string" && typeof item[k] === "number") vals.push(item[k]);
          else if (typeof item[k] === "string" && !(Number(k) >= 0)) vals.push(item[k]);
        }
        if (vals.length === 0) for (const v of Object.values(item)) vals.push(v);
      }
      return cloneSchema({ anyOf: vals.map((v) => Type.Literal(v)) }, opts, "Union");
    },
    Record(keySchema, valSchema, opts) {
      const pat = (keySchema && keySchema.pattern) ? keySchema.pattern : "^.*$";
      return cloneSchema({ type: "object", patternProperties: { [pat]: valSchema }, additionalProperties: valSchema }, opts, "Record");
    },
    Ref: (ref, opts) => cloneSchema({ $ref: typeof ref === "string" ? ref : (ref && ref.$id) || "#" }, opts, "Ref"),
    Cyclic: (defs, rootId) => cloneSchema({ $defs: defs, $ref: "#/$defs/" + rootId }, undefined, "Cyclic"),
    Unsafe: (raw) => cloneSchema(raw, undefined, "Unsafe"),
    Partial(schema, opts) {
      if (!schema || !schema.properties) return cloneSchema(schema, opts, "Object");
      const props = {};
      for (const k of Object.keys(schema.properties)) props[k] = Type.Optional(schema.properties[k]);
      return Type.Object(props, opts);
    },
    Required(schema, opts) {
      if (!schema || !schema.properties) return cloneSchema(schema, opts, "Object");
      const out = cloneSchema(schema, opts, "Object");
      out.required = Object.keys(schema.properties);
      return out;
    },
    Pick(schema, keys, opts) {
      const list = Array.isArray(keys) ? keys : (keys && keys.anyOf ? keys.anyOf.map((x) => x.const) : []);
      const props = {};
      for (const k of list) if (schema && schema.properties && k in schema.properties) props[k] = schema.properties[k];
      return Type.Object(props, opts);
    },
    Omit(schema, keys, opts) {
      const skip = new Set(Array.isArray(keys) ? keys : (keys && keys.anyOf ? keys.anyOf.map((x) => x.const) : []));
      const props = {};
      if (schema && schema.properties) {
        for (const k of Object.keys(schema.properties)) if (!skip.has(k)) props[k] = schema.properties[k];
      }
      return Type.Object(props, opts);
    },
    Composite(schemas = [], opts) {
      const props = {};
      for (const s of schemas) {
        if (s && s.properties) Object.assign(props, s.properties);
      }
      return Type.Object(props, opts);
    },
    TemplateLiteral: (_parts, opts) => cloneSchema({ type: "string" }, opts, "TemplateLiteral"),
    RegExp: (re, opts) => cloneSchema({ type: "string", pattern: re instanceof RegExp ? re.source : String(re) }, opts, "RegExp"),
    Date: (opts) => cloneSchema({ type: "string", format: "date-time" }, opts, "Date"),
    Function: (_p, _r, opts) => cloneSchema({}, opts, "Function"),
    Promise: (_i, opts) => cloneSchema({}, opts, "Promise"),
    KeyOf: (schema, opts) => Type.Union(Object.keys((schema && schema.properties) || {}).map((k) => Type.Literal(k)), opts),
  };

  function validateSchema(schema, value, p = "") {
    const errors = [];
    if (!schema || typeof schema !== "object") return errors;
    if (Array.isArray(schema.anyOf)) {
      if (!schema.anyOf.some((sub) => validateSchema(sub, value, p).length === 0)) {
        errors.push({ path: p || "/", message: "Value does not match any union schema" });
      }
      return errors;
    }
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) errors.push(...validateSchema(sub, value, p));
      return errors;
    }
    if ("const" in schema && value !== schema.const) {
      errors.push({ path: p || "/", message: "Expected literal " + JSON.stringify(schema.const) });
      return errors;
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      errors.push({ path: p || "/", message: "Expected one of " + schema.enum.join(", ") });
      return errors;
    }
    if (schema.type === "string") {
      if (typeof value !== "string") errors.push({ path: p || "/", message: "Expected string" });
      else {
        if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path: p || "/", message: "String shorter than minLength" });
        if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path: p || "/", message: "String longer than maxLength" });
        if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push({ path: p || "/", message: "String failed pattern" });
      }
    } else if (schema.type === "number" || schema.type === "integer") {
      if (typeof value !== "number" || Number.isNaN(value) || (schema.type === "integer" && !Number.isInteger(value))) {
        errors.push({ path: p || "/", message: "Expected " + schema.type });
      } else {
        if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: p || "/", message: "Number < minimum" });
        if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: p || "/", message: "Number > maximum" });
      }
    } else if (schema.type === "boolean") {
      if (typeof value !== "boolean") errors.push({ path: p || "/", message: "Expected boolean" });
    } else if (schema.type === "null") {
      if (value !== null) errors.push({ path: p || "/", message: "Expected null" });
    } else if (schema.type === "array") {
      if (!Array.isArray(value)) errors.push({ path: p || "/", message: "Expected array" });
      else if (schema.items && !Array.isArray(schema.items)) {
        for (let idx = 0; idx < value.length; idx++) {
          errors.push(...validateSchema(schema.items, value[idx], p + "/" + idx));
        }
      }
    } else if (schema.type === "object") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        errors.push({ path: p || "/", message: "Expected object" });
      } else {
        if (Array.isArray(schema.required)) {
          for (const rk of schema.required) {
            if (!Object.prototype.hasOwnProperty.call(value, rk) || value[rk] === undefined) {
              errors.push({ path: p + "/" + rk, message: "Missing required property " + rk });
            }
          }
        }
        if (schema.properties) {
          for (const pk of Object.keys(schema.properties)) {
            if (Object.prototype.hasOwnProperty.call(value, pk) && value[pk] !== undefined) {
              errors.push(...validateSchema(schema.properties[pk], value[pk], p + "/" + pk));
            }
          }
        }
      }
    }
    return errors;
  }

  const TypeboxValue = {
    Check: (schema, value) => validateSchema(schema, value).length === 0,
    Errors: (schema, value) => validateSchema(schema, value),
    Convert(schema, value) {
      if (value === undefined && schema && "default" in schema) return schema.default;
      if (schema && (schema.type === "number" || schema.type === "integer") && typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (!Number.isNaN(n)) return schema.type === "integer" ? Math.trunc(n) : n;
      }
      if (schema && schema.type === "boolean" && typeof value === "string") {
        if (value === "true") return true;
        if (value === "false") return false;
      }
      return value;
    },
    Cast: (schema, value) => TypeboxValue.Convert(schema, value),
    Clone: (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
    Clean: (_schema, value) => value,
    Default: (schema, value) => value !== undefined ? value : (schema && "default" in schema ? schema.default : value),
    Equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  };

  const TypeboxMod = {
    Kind: KindSym,
    OptionalKind: OptionalSym,
    ReadonlyKind: ReadonlySym,
    Type,
    TypeRegistry: { _m: new Map(), Has(k) { return this._m.has(k); }, Set(k, v) { this._m.set(k, v); }, Get(k) { return this._m.get(k); }, Clear() { this._m.clear(); } },
    FormatRegistry: { _m: new Map(), Has(k) { return this._m.has(k); }, Set(k, v) { this._m.set(k, v); }, Get(k) { return this._m.get(k); }, Clear() { this._m.clear(); } },
    TypeGuard: {
      IsObject: (s) => Boolean(s && typeof s === "object" && s.type === "object" && s.properties),
      IsArray: (s) => Boolean(s && typeof s === "object" && s.type === "array"),
      IsString: (s) => Boolean(s && typeof s === "object" && s.type === "string"),
      IsNumber: (s) => Boolean(s && typeof s === "object" && s.type === "number"),
      IsInteger: (s) => Boolean(s && typeof s === "object" && s.type === "integer"),
      IsBoolean: (s) => Boolean(s && typeof s === "object" && s.type === "boolean"),
      IsOptional: (s) => Boolean(s && (s[OptionalSym] || s["~optional"])),
      IsUnion: (s) => Boolean(s && Array.isArray(s.anyOf)),
      IsLiteral: (s) => Boolean(s && Object.prototype.hasOwnProperty.call(s, "const")),
    },
    default: Type,
  };

  // --- Pure-JS TUI & Key Helpers ---
  const ANSI_RE = /\\x1b(?:\\[[0-9;?]*[ -/]*[@-~]|_pi:c\\x07|\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\))/g;
  function stripAnsi(s) { return String(s ?? "").replace(ANSI_RE, ""); }
  function visibleWidth(s) { return stripAnsi(s).length; }
  function truncateToWidth(str, maxWidth, ellipsis = "...", pad = false) {
    const plain = stripAnsi(str);
    const w = Math.max(0, Number(maxWidth) || 0);
    if (plain.length <= w) {
      return pad && plain.length < w ? str + " ".repeat(w - plain.length) : String(str ?? "");
    }
    const el = String(ellipsis ?? "...");
    if (w <= el.length) return plain.slice(0, w);
    return plain.slice(0, w - el.length) + el;
  }
  function wrapTextWithAnsi(str, width) {
    const w = Math.max(1, Number(width) || 80);
    const lines = [];
    for (const rawLine of String(str ?? "").split(/\\r?\\n/)) {
      if (visibleWidth(rawLine) <= w) {
        lines.push(rawLine);
      } else {
        let cur = "";
        for (const ch of stripAnsi(rawLine)) {
          if (cur.length >= w) { lines.push(cur); cur = ""; }
          cur += ch;
        }
        if (cur.length > 0 || lines.length === 0) lines.push(cur);
      }
    }
    return lines;
  }
  function parseKey(data) {
    const d = String(data ?? "");
    if (d === "\\r" || d === "\\n") return "enter";
    if (d === "\\x1b") return "escape";
    if (d === "\\t") return "tab";
    if (d === "\\x7f" || d === "\\b") return "backspace";
    if (d === " ") return "space";
    if (d === "\\x1b[A") return "up";
    if (d === "\\x1b[B") return "down";
    if (d === "\\x1b[C") return "right";
    if (d === "\\x1b[D") return "left";
    if (d === "\\x1b[H") return "home";
    if (d === "\\x1b[F") return "end";
    if (d === "\\x1b[3~") return "delete";
    if (d === "\\x1b[5~") return "pageUp";
    if (d === "\\x1b[6~") return "pageDown";
    if (d.length === 1 && d.charCodeAt(0) >= 1 && d.charCodeAt(0) <= 26) {
      return "ctrl+" + String.fromCharCode(d.charCodeAt(0) + 96);
    }
    if (d.length === 2 && d[0] === "\\x1b") {
      const ch = d.charCodeAt(1);
      if (ch >= 1 && ch <= 26) return "ctrl+alt+" + String.fromCharCode(ch + 96);
      return "alt+" + d[1].toLowerCase();
    }
    const kitty = /^\\x1b\\[(\\d+)(?:;(\\d+))?u$/.exec(d);
    if (kitty) {
      const code = Number(kitty[1]);
      const mod = kitty[2] ? Math.max(0, Number(kitty[2]) - 1) : 0;
      let name = code === 13 ? "enter" : code === 27 ? "escape" : code === 9 ? "tab" : code === 32 ? "space" : code === 127 ? "backspace" : String.fromCharCode(code).toLowerCase();
      const parts = [];
      if (mod & 4) parts.push("ctrl");
      if (mod & 1) parts.push("shift");
      if (mod & 2) parts.push("alt");
      if (mod & 8) parts.push("super");
      parts.push(name);
      return parts.join("+");
    }
    return d;
  }
  function matchesKey(data, keyId) {
    const norm = (k) => String(k ?? "").toLowerCase().replace("return", "enter").replace("esc", "escape");
    const parsed = norm(parseKey(data));
    const target = norm(keyId);
    if (parsed === target || norm(data) === target) return true;
    const pParts = parsed.split("+").sort().join("+");
    const tParts = target.split("+").sort().join("+");
    return pParts === tParts;
  }

  const Key = {
    escape: "escape", esc: "escape", enter: "enter", return: "return", tab: "tab", space: "space",
    backspace: "backspace", delete: "delete", insert: "insert", clear: "clear", home: "home", end: "end",
    pageUp: "pageUp", pageDown: "pageDown", up: "up", down: "down", left: "left", right: "right",
    f1: "f1", f2: "f2", f3: "f3", f4: "f4", f5: "f5", f6: "f6", f7: "f7", f8: "f8", f9: "f9", f10: "f10", f11: "f11", f12: "f12",
    backtick: "\`", hyphen: "-", equals: "=", leftbracket: "[", rightbracket: "]", backslash: "\\\\",
    semicolon: ";", quote: "'", comma: ",", period: ".", slash: "/", exclamation: "!", at: "@", hash: "#",
    dollar: "$", percent: "%", caret: "^", ampersand: "&", asterisk: "*", leftparen: "(", rightparen: ")",
    underscore: "_", plus: "+", pipe: "|", tilde: "~", leftbrace: "{", rightbrace: "}", colon: ":", lessthan: "<", greaterthan: ">", question: "?",
    ctrl: (k) => "ctrl+" + k, shift: (k) => "shift+" + k, alt: (k) => "alt+" + k, super: (k) => "super+" + k,
    ctrlShift: (k) => "ctrl+shift+" + k, shiftCtrl: (k) => "shift+ctrl+" + k,
    ctrlAlt: (k) => "ctrl+alt+" + k, altCtrl: (k) => "alt+ctrl+" + k,
    shiftAlt: (k) => "shift+alt+" + k, altShift: (k) => "alt+shift+" + k,
    ctrlShiftAlt: (k) => "ctrl+shift+alt+" + k,
  };

  class Text {
    constructor(text = "", paddingX = 1, paddingY = 1, customBgFn = undefined) {
      this.text = String(text ?? ""); this.paddingX = paddingX; this.paddingY = paddingY; this.customBgFn = customBgFn;
    }
    setText(t) { this.text = String(t ?? ""); }
    invalidate() {}
    render(width = 80) {
      const raw = this.text === "" ? [] : wrapTextWithAnsi(this.text, Math.max(1, (width || 80) - this.paddingX * 2));
      const pad = " ".repeat(Math.max(0, this.paddingX));
      const lines = raw.map((l) => pad + l);
      const empty = Array(Math.max(0, this.paddingY || 0)).fill("");
      return [...empty, ...lines, ...empty];
    }
  }
  class TruncatedText {
    constructor(text = "", paddingX = 0, paddingY = 0) { this.text = String(text ?? ""); this.paddingX = paddingX; this.paddingY = paddingY; }
    invalidate() {}
    render(width = 80) {
      const line = truncateToWidth(this.text.replace(/\\r?\\n/g, " "), Math.max(1, (width || 80) - this.paddingX * 2));
      const pad = " ".repeat(Math.max(0, this.paddingX));
      const empty = Array(Math.max(0, this.paddingY || 0)).fill("");
      return [...empty, pad + line, ...empty];
    }
  }
  class Spacer {
    constructor(lines = 1) { this.lines = lines; }
    invalidate() {}
    render() { return Array(Math.max(0, this.lines)).fill(""); }
  }
  class Container {
    constructor() { this.children = []; }
    addChild(c) { if (c) this.children.push(c); }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); }
    clear() { this.children = []; }
    invalidate() { for (const c of this.children) if (c && c.invalidate) c.invalidate(); }
    render(width = 80) {
      const lines = [];
      for (const c of this.children) if (c && c.render) lines.push(...c.render(width));
      return lines;
    }
  }
  class Box extends Container {
    constructor(paddingX = 1, paddingY = 1, bgFn = undefined) { super(); this.paddingX = paddingX; this.paddingY = paddingY; this.bgFn = bgFn; }
    setBgFn(fn) { this.bgFn = fn; }
    render(width = 80) {
      const innerWidth = Math.max(1, (width || 80) - this.paddingX * 2);
      const pad = " ".repeat(Math.max(0, this.paddingX));
      const out = Array(Math.max(0, this.paddingY || 0)).fill("");
      for (const c of this.children) {
        if (c && c.render) for (const l of c.render(innerWidth)) out.push(this.bgFn ? this.bgFn(pad + l) : pad + l);
      }
      for (let i = 0; i < (this.paddingY || 0); i++) out.push("");
      return out;
    }
  }
  class Markdown {
    constructor(text = "", paddingX = 1, paddingY = 0, theme = undefined) { this.text = String(text ?? ""); this.paddingX = paddingX; this.paddingY = paddingY; this.theme = theme; }
    setText(t) { this.text = String(t ?? ""); }
    invalidate() {}
    render(width = 80) { return new Text(this.text, this.paddingX, this.paddingY).render(width); }
  }
  class Input {
    constructor() { this.value = ""; this.focused = false; this.onSubmit = undefined; this.onEscape = undefined; }
    setValue(v) { this.value = String(v ?? ""); }
    getValue() { return this.value; }
    invalidate() {}
    handleInput(data) {
      if (data === "\\r" || data === "\\n") { if (this.onSubmit) this.onSubmit(this.value); return; }
      if (data === "\\x1b") { if (this.onEscape) this.onEscape(); return; }
      if (data === "\\x7f" || data === "\\b") { this.value = this.value.slice(0, -1); return; }
      if (data && !data.startsWith("\\x1b")) this.value += data;
    }
    render(width = 80) { return [truncateToWidth("> " + this.value, width || 80)]; }
  }
  class Editor extends Input {}
  class SelectList {
    constructor(items = [], maxVisible = 10) { this.items = items || []; this.maxVisible = maxVisible; this.selectedIndex = 0; this.onSelect = undefined; this.onCancel = undefined; }
    getSelectedItem() { return this.items[this.selectedIndex]; }
    invalidate() {}
    handleInput(data) {
      if (matchesKey(data, Key.up) && this.selectedIndex > 0) this.selectedIndex--;
      else if (matchesKey(data, Key.down) && this.selectedIndex + 1 < this.items.length) this.selectedIndex++;
      else if (matchesKey(data, Key.enter) && this.items[this.selectedIndex] && this.onSelect) this.onSelect(this.items[this.selectedIndex]);
      else if (matchesKey(data, Key.escape) && this.onCancel) this.onCancel();
    }
    render(width = 80) {
      return this.items.slice(0, this.maxVisible).map((it, i) => {
        const prefix = i === this.selectedIndex ? "> " : "  ";
        const label = typeof it === "string" ? it : (it.label || it.value || "");
        return truncateToWidth(prefix + label, width || 80);
      });
    }
  }
  class SettingsList extends SelectList {
    constructor(items = [], maxVisible = 10, theme = {}, onChange = undefined, onCancel = undefined) {
      super(items, maxVisible); this.theme = theme || {}; this.onChange = onChange; this.onCancel = onCancel;
    }
    handleInput(data) {
      if (matchesKey(data, Key.up) && this.selectedIndex > 0) this.selectedIndex--;
      else if (matchesKey(data, Key.down) && this.selectedIndex + 1 < this.items.length) this.selectedIndex++;
      else if ((matchesKey(data, Key.enter) || data === " ") && this.items[this.selectedIndex]) {
        const item = this.items[this.selectedIndex];
        if (Array.isArray(item.values) && item.values.length > 0) {
          const cur = item.values.indexOf(item.currentValue);
          const nextVal = item.values[(cur + 1) % item.values.length];
          item.currentValue = nextVal;
          if (this.onChange) this.onChange(item.id, nextVal);
        }
      } else if (matchesKey(data, Key.escape) && this.onCancel) this.onCancel();
    }
    render(width = 80) {
      return this.items.slice(0, this.maxVisible).map((it, i) => {
        const prefix = i === this.selectedIndex ? "> " : "  ";
        const val = it.currentValue !== undefined ? " [" + it.currentValue + "]" : "";
        return truncateToWidth(prefix + (it.label || it.id || "") + val, width || 80);
      });
    }
  }
  class Loader {
    constructor(_tui, _sc, _mc, message = "") { this.message = message; }
    setMessage(m) { this.message = m; }
    start() {}
    stop() {}
    invalidate() {}
    render(width = 80) { return [truncateToWidth(this.message || "Loading...", width || 80)]; }
  }
  class CancellableLoader extends Loader {
    constructor(tui, sc, mc, message = "") { super(tui, sc, mc, message); this._ctrl = new globalThis.AbortController(); this.signal = this._ctrl.signal; this.onAbort = undefined; }
    dispose() { this.stop(); }
    handleInput(data) { if (matchesKey(data, Key.escape)) { this._ctrl.abort(); if (this.onAbort) this.onAbort(); } }
  }

  const PiTuiMod = {
    CURSOR_MARKER: "\\x1b_pi:c\\x07",
    renderFakeCursor: (text = " ") => "\\x1b[7m" + (text || " ") + "\\x1b[27m",
    Key, visibleWidth, truncateToWidth, wrapTextWithAnsi, parseKey, matchesKey,
    Text, TruncatedText, Spacer, Container, Box, Markdown, Input, Editor, SelectList, SettingsList, Loader, CancellableLoader,
  };
  PiTuiMod.default = PiTuiMod;

  // --- pi-ai ---
  class AssistantMessageEventStream {
    constructor() { this._queue = []; this._waiters = []; this._ended = false; this._finalResult = undefined; this._resultWaiters = []; }
    push(event) {
      if (this._ended) return;
      if (event && event.type === "done") this._finalResult = event.message;
      if (event && event.type === "error") this._finalResult = event.error;
      if (this._waiters.length > 0) this._waiters.shift()({ value: event, done: false });
      else this._queue.push(event);
      if (event && (event.type === "done" || event.type === "error")) this.end(this._finalResult);
    }
    end(result) {
      if (this._ended) return;
      this._ended = true;
      if (result !== undefined) this._finalResult = result;
      while (this._waiters.length > 0) this._waiters.shift()({ value: undefined, done: true });
      while (this._resultWaiters.length > 0) this._resultWaiters.shift()(this._finalResult);
    }
    result() {
      if (this._ended) return Promise.resolve(this._finalResult);
      return new Promise((r) => this._resultWaiters.push(r));
    }
    [Symbol.asyncIterator]() {
      const self = this;
      return {
        next() {
          if (self._queue.length > 0) return Promise.resolve({ value: self._queue.shift(), done: false });
          if (self._ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((r) => self._waiters.push(r));
        },
      };
    }
  }
  const ENV_API_KEY_MAP = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GEMINI_API_KEY",
    gemini: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    xai: "XAI_API_KEY",
    mistral: "MISTRAL_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
  };
  const PiAiMod = {
    Type,
    StringEnum(values, options) {
      const schema = { type: "string", enum: Array.from(values || []) };
      if (options && options.description) schema.description = options.description;
      if (options && options.default !== undefined) schema.default = options.default;
      return Type.Unsafe(schema);
    },
    uuidv7,
    AssistantMessageEventStream,
    EventStream: AssistantMessageEventStream,
    createAssistantMessageEventStream: () => new AssistantMessageEventStream(),
    parseStreamingJson(raw) { if (!raw || typeof raw !== "string") return {}; try { return JSON.parse(raw); } catch { return {}; } },
    calculateCost: (_m, usage) => (usage && usage.cost ? usage.cost : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
    modelsAreEqual: (a, b) => Boolean(a && b && a.provider === b.provider && a.id === b.id),
    getEnvApiKey(provider) {
      const keyName = ENV_API_KEY_MAP[String(provider || "").toLowerCase()] || (String(provider || "").toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_API_KEY");
      return state.env[keyName];
    },
    getModels: (provider) => provider ? state.aiModels.filter((m) => m.provider === provider) : state.aiModels.slice(),
    getModel: (provider, id) => state.aiModels.find((m) => m.provider === provider && m.id === id),
    getProviders: () => Array.from(new Set(state.aiModels.map((m) => m.provider))),
    complete: () => Promise.reject(new Error("pi-ai complete() requires host model client")),
    completeSimple: () => Promise.reject(new Error("pi-ai completeSimple() requires host model client")),
    stream() { const s = new AssistantMessageEventStream(); s.end({ role: "assistant", content: [], stopReason: "error", errorMessage: "stream() unavailable outside host model registry", timestamp: Date.now() }); return s; },
    streamSimple() { return PiAiMod.stream(); },
    getOAuthApiKey(providerId, creds) {
      if (creds && creds[providerId] && creds[providerId].access) return Promise.resolve({ apiKey: creds[providerId].access, newCredentials: creds[providerId] });
      return Promise.resolve(null);
    },
    toToolDeclaration: (tool) => ({ name: tool.name, description: tool.description, parameters: JSON.parse(JSON.stringify(tool.parameters ?? {})) }),
  };
  PiAiMod.default = PiAiMod;

  // --- pi-coding-agent ---
  function makeBuiltinToolStub(name, cwd) {
    return {
      name,
      label: name,
      description: "Built-in " + name + " tool",
      parameters: { type: "object", properties: {} },
      execute(toolCallId, params) {
        return hostAsync("coding.execBuiltinTool", [name, cwd || state.cwd, String(toolCallId || ""), params || {}]);
      },
    };
  }
  function parseFrontmatter(content) {
    const str = String(content ?? "");
    const m = /^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)$/.exec(str);
    if (!m) return { frontmatter: {}, body: str };
    const frontmatter = {};
    for (const line of m[1].split(/\\r?\\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        let v = line.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        frontmatter[k] = v;
      }
    }
    return { frontmatter, body: m[2] };
  }
  function truncateHead(content, opts = {}) {
    const maxLines = opts.maxLines ?? 2000;
    const maxBytes = opts.maxBytes ?? 50 * 1024;
    const text = String(content ?? "");
    const lines = text.split("\\n");
    const totalLines = lines.length;
    const totalBytes = new globalThis.TextEncoder().encode(text).length;
    if (totalLines <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false, truncatedBy: null, totalLines, totalBytes, outputLines: totalLines, outputBytes: totalBytes, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
    }
    const kept = [];
    let bytes = 0;
    let truncatedBy = null;
    for (let i = 0; i < lines.length; i++) {
      if (i >= maxLines) { truncatedBy = "lines"; break; }
      const add = (i > 0 ? 1 : 0) + new globalThis.TextEncoder().encode(lines[i]).length;
      if (bytes + add > maxBytes) { truncatedBy = "bytes"; break; }
      kept.push(lines[i]);
      bytes += add;
    }
    return { content: kept.join("\\n"), truncated: true, truncatedBy, totalLines, totalBytes, outputLines: kept.length, outputBytes: bytes, lastLinePartial: false, firstLineExceedsLimit: kept.length === 0 && totalLines > 0, maxLines, maxBytes };
  }
  function truncateTail(content, opts = {}) {
    const maxLines = opts.maxLines ?? 2000;
    const maxBytes = opts.maxBytes ?? 50 * 1024;
    const text = String(content ?? "");
    const lines = text.split("\\n");
    const totalLines = lines.length;
    const totalBytes = new globalThis.TextEncoder().encode(text).length;
    if (totalLines <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false, truncatedBy: null, totalLines, totalBytes, outputLines: totalLines, outputBytes: totalBytes, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
    }
    const kept = [];
    let bytes = 0;
    let truncatedBy = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (kept.length >= maxLines) { truncatedBy = "lines"; break; }
      const add = (kept.length > 0 ? 1 : 0) + new globalThis.TextEncoder().encode(lines[i]).length;
      if (bytes + add > maxBytes) { truncatedBy = "bytes"; break; }
      kept.unshift(lines[i]);
      bytes += add;
    }
    return { content: kept.join("\\n"), truncated: true, truncatedBy, totalLines, totalBytes, outputLines: kept.length, outputBytes: bytes, lastLinePartial: false, firstLineExceedsLimit: false, maxLines, maxBytes };
  }

  class DynamicBorder {
    constructor(colorFn = (s) => s) { this.colorFn = colorFn; }
    invalidate() {}
    render(width = 80) { return [this.colorFn("─".repeat(Math.max(1, width)))]; }
  }
  class BorderedLoader {
    constructor(_tui, _theme, message = "Loading...") { this.message = message; this.signal = new globalThis.AbortController().signal; this.onAbort = undefined; }
    invalidate() {}
    render(width = 80) { return new Text(this.message).render(width); }
  }
  class CustomEditor {
    constructor(tui, theme, keybindings) { this.tui = tui; this.theme = theme; this.keybindings = keybindings; this.text = ""; this.onSubmit = undefined; }
    getText() { return this.text; }
    setText(t) { this.text = String(t ?? ""); }
    handleInput(_data) {}
    invalidate() {}
    render(width = 80) { return [this.text.slice(0, width)]; }
  }
  class KeybindingsManager {
    static create() { return new KeybindingsManager(); }
    matches() { return false; }
  }

  const PiCodingAgentMod = {
    get VERSION() { return state.constants.version; },
    get APP_NAME() { return state.constants.appName; },
    get CONFIG_DIR_NAME() { return state.constants.configDirName; },
    DEFAULT_MAX_BYTES: 50 * 1024,
    DEFAULT_MAX_LINES: 2000,
    getAgentDir: () => state.constants.agentDir,
    getPackageDir: () => state.constants.packageDir,
    getDocsPath: () => state.constants.docsPath,
    getExamplesPath: () => state.constants.examplesPath,
    getReadmePath: () => state.constants.readmePath,
    getModelsPath: () => state.constants.modelsPath,
    getSettingsPath: () => state.constants.settingsPath,
    getSessionsDir: () => state.constants.sessionsDir,
    formatSize: (bytes) => {
      const b = Number(bytes) || 0;
      if (b < 1024) return b + " B";
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
      return (b / (1024 * 1024)).toFixed(1) + " MB";
    },
    parseFrontmatter,
    defineTool: (tool) => tool,
    truncateLine: (line, maxWidth = 500) => {
      const s = String(line ?? "");
      return s.length <= maxWidth ? { text: s, wasTruncated: false } : { text: s.slice(0, maxWidth), wasTruncated: true };
    },
    truncateHead,
    truncateTail,
    createReadTool: (cwd) => makeBuiltinToolStub("read", cwd),
    createBashTool: (cwd) => makeBuiltinToolStub("bash", cwd),
    createEditTool: (cwd) => makeBuiltinToolStub("edit", cwd),
    createWriteTool: (cwd) => makeBuiltinToolStub("write", cwd),
    createGrepTool: (cwd) => makeBuiltinToolStub("grep", cwd),
    createFindTool: (cwd) => makeBuiltinToolStub("find", cwd),
    createLsTool: (cwd) => makeBuiltinToolStub("ls", cwd),
    createReadToolDefinition: (cwd) => makeBuiltinToolStub("read", cwd),
    createBashToolDefinition: (cwd) => makeBuiltinToolStub("bash", cwd),
    createEditToolDefinition: (cwd) => makeBuiltinToolStub("edit", cwd),
    createWriteToolDefinition: (cwd) => makeBuiltinToolStub("write", cwd),
    createGrepToolDefinition: (cwd) => makeBuiltinToolStub("grep", cwd),
    createFindToolDefinition: (cwd) => makeBuiltinToolStub("find", cwd),
    createLsToolDefinition: (cwd) => makeBuiltinToolStub("ls", cwd),
    createCodingTools: (cwd) => [makeBuiltinToolStub("read", cwd), makeBuiltinToolStub("bash", cwd), makeBuiltinToolStub("edit", cwd), makeBuiltinToolStub("write", cwd)],
    createReadOnlyTools: (cwd) => [makeBuiltinToolStub("read", cwd), makeBuiltinToolStub("grep", cwd), makeBuiltinToolStub("find", cwd), makeBuiltinToolStub("ls", cwd)],
    DynamicBorder,
    BorderedLoader,
    CustomEditor,
    KeybindingsManager,
    getMarkdownTheme: () => ({}),
    getSettingsListTheme: () => ({ label: (s) => s, value: (s) => s, description: (s) => s, hint: (s) => s }),
    highlightCode: (code) => String(code ?? "").split("\\n"),
    getLanguageFromPath: (p) => { const m = /\\.([a-zA-Z0-9]+)$/.exec(String(p || "")); return m ? m[1].toLowerCase() : undefined; },
    serializeConversation: (messages) => JSON.stringify(messages || []),
    convertToLlm: (messages) => (Array.isArray(messages) ? messages : []),
    isToolCallEventType: (toolName, event) => Boolean(event && event.toolName === toolName),
    isBashToolResult: (e) => Boolean(e && e.toolName === "bash"),
    isReadToolResult: (e) => Boolean(e && e.toolName === "read"),
    isWriteToolResult: (e) => Boolean(e && e.toolName === "write"),
    isEditToolResult: (e) => Boolean(e && e.toolName === "edit"),
  };
  PiCodingAgentMod.default = PiCodingAgentMod;

  function resolveVirtualModule(id) {
    const clean = id.startsWith("virtual:") ? id.slice(8) : id;
    switch (clean) {
      case "typebox":
      case "@sinclair/typebox":
        return TypeboxMod;
      case "typebox/value":
      case "@sinclair/typebox/value":
        return { Value: TypeboxValue, default: TypeboxValue };
      case "typebox/compile":
      case "@sinclair/typebox/compile": {
        const TypeCompiler = {
          Compile: (schema) => ({
            Check: (v) => TypeboxValue.Check(schema, v),
            Errors: (v) => TypeboxValue.Errors(schema, v),
            Decode: (v) => {
              const c = TypeboxValue.Convert(schema, v);
              const errs = TypeboxValue.Errors(schema, c);
              if (errs.length > 0) throw new Error(errs[0].message);
              return c;
            },
            Encode: (v) => v,
          }),
        };
        return { TypeCompiler, default: TypeCompiler };
      }
      case "@earendil-works/pi-agent-core":
      case "@mariozechner/pi-agent-core":
        return { default: {} };
      case "@earendil-works/pi-tui":
      case "@mariozechner/pi-tui":
        return PiTuiMod;
      case "@earendil-works/pi-ai":
      case "@mariozechner/pi-ai":
      case "@earendil-works/pi-ai/compat":
      case "@mariozechner/pi-ai/compat":
        return PiAiMod;
      case "@earendil-works/pi-ai/models":
      case "@mariozechner/pi-ai/models":
        return { getModels: PiAiMod.getModels, getModel: PiAiMod.getModel, getProviders: PiAiMod.getProviders, default: { getModels: PiAiMod.getModels, getModel: PiAiMod.getModel, getProviders: PiAiMod.getProviders } };
      case "@earendil-works/pi-ai/oauth":
      case "@mariozechner/pi-ai/oauth":
        return {
          loginAnthropic: () => Promise.reject(new Error("OAuth login must run in host UI")),
          loginOpenAICodex: () => Promise.reject(new Error("OAuth login must run in host UI")),
          default: {},
        };
      case "@earendil-works/pi-ai/providers/all":
      case "@mariozechner/pi-ai/providers/all":
        return { registerBuiltInApiProviders() {}, default: { registerBuiltInApiProviders() {} } };
      case "@earendil-works/pi-coding-agent":
      case "@mariozechner/pi-coding-agent":
        return PiCodingAgentMod;
      default:
        break;
    }

    const nodeName = clean.startsWith("node:") ? clean.slice(5) : clean;
    switch (nodeName) {
      case "path":
      case "path/posix":
      case "path/win32":
        return posixPath;
      case "os":
        return osShim;
      case "fs":
        return fsShim;
      case "fs/promises":
        return fsShim.promises;
      case "url":
        return urlShim;
      case "crypto":
        return cryptoShim;
      case "events": {
        const mod = { EventEmitter, default: EventEmitter };
        return mod;
      }
      case "buffer":
        return { Buffer: PiBuffer, kMaxLength: 0x7fffffff, default: { Buffer: PiBuffer } };
      case "process":
        return globalThis.process;
      case "util":
        return utilShim;
      case "assert":
      case "assert/strict":
        return assertShim;
      case "stream":
        return streamShim;
      case "tty":
        return { isatty: () => false, default: { isatty: () => false } };
      case "string_decoder": {
        class StringDecoder {
          constructor(enc = "utf8") { this.encoding = enc; this._dec = new globalThis.TextDecoder(); }
          write(buf) { return typeof buf === "string" ? buf : this._dec.decode(buf); }
          end(buf) { return buf ? (typeof buf === "string" ? buf : this._dec.decode(buf)) : ""; }
        }
        return { StringDecoder, default: { StringDecoder } };
      }
      case "querystring":
        return {
          parse(str) {
            const out = {};
            for (const [k, v] of new globalThis.URLSearchParams(String(str || ""))) {
              out[k] = k in out ? (Array.isArray(out[k]) ? [...out[k], v] : [out[k], v]) : v;
            }
            return out;
          },
          stringify(obj) {
            const p = new globalThis.URLSearchParams();
            if (obj && typeof obj === "object") {
              for (const [k, v] of Object.entries(obj)) {
                if (Array.isArray(v)) for (const x of v) p.append(k, String(x));
                else if (v !== undefined) p.append(k, String(v));
              }
            }
            return p.toString();
          },
        };
      case "zlib":
        return {
          gunzipSync() { throw new Error("zlib.gunzipSync is not supported in JSC sandbox"); },
          gzipSync() { throw new Error("zlib.gzipSync is not supported in JSC sandbox"); },
        };
      case "child_process": {
        const spawnChild = (command, args, opts) => {
          const cp = new EventEmitter();
          cp.stdout = new EventEmitter();
          cp.stderr = new EventEmitter();
          cp.stdin = { write() { return false; }, end() {}, destroy() {} };
          cp.pid = 0;
          cp.killed = false;
          cp.kill = () => { cp.killed = true; return true; };
          const execOpts = opts && typeof opts === "object" ? { cwd: opts.cwd, timeout: opts.timeout } : null;
          hostAsync("exec", [String(command), Array.from(args || [], String), execOpts]).then(
            (res) => {
              if (res && res.stdout) cp.stdout.emit("data", res.stdout);
              if (res && res.stderr) cp.stderr.emit("data", res.stderr);
              cp.stdout.emit("end");
              cp.stderr.emit("end");
              const code = res && typeof res.code === "number" ? res.code : 0;
              cp.emit("exit", code, null);
              cp.emit("close", code, null);
            },
            (err) => {
              cp.emit("error", err);
              cp.emit("close", 1, null);
            },
          );
          return cp;
        };
        const execFile = (file, argsOrOpts, optsOrCb, maybeCb) => {
          let cmdArgs = [];
          let opts = {};
          let cb = null;
          if (Array.isArray(argsOrOpts)) {
            cmdArgs = argsOrOpts;
            if (typeof optsOrCb === "function") cb = optsOrCb;
            else { opts = optsOrCb || {}; cb = typeof maybeCb === "function" ? maybeCb : null; }
          } else if (typeof argsOrOpts === "function") {
            cb = argsOrOpts;
          } else if (argsOrOpts && typeof argsOrOpts === "object") {
            opts = argsOrOpts;
            cb = typeof optsOrCb === "function" ? optsOrCb : null;
          }
          const cp = spawnChild(file, cmdArgs, opts);
          if (cb) {
            let out = "";
            let errOut = "";
            cp.stdout.on("data", (d) => { out += String(d); });
            cp.stderr.on("data", (d) => { errOut += String(d); });
            cp.on("close", (code) => {
              cb(code === 0 ? null : new Error("Command exited with code " + code), out, errOut);
            });
          }
          return cp;
        };
        const exec = (cmdLine, optsOrCb, maybeCb) => {
          const opts = typeof optsOrCb === "object" && optsOrCb !== null ? optsOrCb : {};
          const cb = typeof optsOrCb === "function" ? optsOrCb : (typeof maybeCb === "function" ? maybeCb : null);
          return execFile("sh", ["-c", String(cmdLine)], opts, cb);
        };
        const syncUnsupported = (name) => () => { throw new Error("child_process." + name + " is not supported synchronously in JSC sandbox; use pi.exec() or async spawn/exec"); };
        return {
          spawn: spawnChild,
          execFile,
          exec,
          fork: syncUnsupported("fork"),
          spawnSync: syncUnsupported("spawnSync"),
          execFileSync: syncUnsupported("execFileSync"),
          execSync: syncUnsupported("execSync"),
          default: { spawn: spawnChild, execFile, exec },
        };
      }
      case "readline": {
        const createInterface = () => {
          const rl = new EventEmitter();
          rl.close = () => { rl.emit("close"); };
          rl.question = (_q, cb) => { if (typeof cb === "function") cb(""); };
          rl.prompt = () => {};
          return rl;
        };
        return {
          createInterface,
          clearLine: () => {},
          clearScreenDown: () => {},
          cursorTo: () => {},
          moveCursor: () => {},
          default: { createInterface },
        };
      }
      case "timers":
        return {
          setTimeout: globalThis.setTimeout,
          clearTimeout: globalThis.clearTimeout,
          setInterval: globalThis.setInterval,
          clearInterval: globalThis.clearInterval,
          setImmediate: (fn, ...a) => globalThis.setTimeout(fn, 0, ...a),
          clearImmediate: globalThis.clearTimeout,
        };
      case "timers/promises":
        return {
          setTimeout: (ms = 0, value) => new Promise((resolve) => globalThis.setTimeout(() => resolve(value), ms)),
        };
      case "module":
        return { createRequire: () => globalThis.__piCurrentRequire, builtinModules: [] };
      default:
        return undefined;
    }
  }

  // --- Guest Context & ExtensionAPI Factories ---
  const themeObj = {
    fg: (_color, text) => String(text ?? ""),
    bg: (_color, text) => String(text ?? ""),
    bold: (text) => String(text ?? ""),
    italic: (text) => String(text ?? ""),
    underline: (text) => String(text ?? ""),
    inverse: (text) => String(text ?? ""),
    strikethrough: (text) => String(text ?? ""),
    dim: (text) => String(text ?? ""),
    style: (_style, text) => String(text ?? ""),
    getFgAnsi: () => "",
    getBgAnsi: () => "",
  };

  function makeGuestContext(ctxRef) {
    if (!ctxRef || typeof ctxRef !== "object") return undefined;
    const ctxId = ctxRef.id;
    const getSnap = () => state.contexts[String(ctxId)] || ctxRef;
    const sm = {
      getCwd: () => getSnap().sessionManager?.cwd ?? getSnap().cwd,
      getSessionDir: () => getSnap().sessionManager?.sessionDir ?? "",
      getSessionId: () => getSnap().sessionManager?.sessionId ?? "",
      getSessionFile: () => getSnap().sessionManager?.sessionFile,
      getSessionName: () => getSnap().sessionManager?.sessionName,
      getLeafId: () => getSnap().sessionManager?.leafId ?? null,
      getLeafEntry: () => getSnap().sessionManager?.leafEntry,
      getEntry: (id) => (getSnap().sessionManager?.entries || []).find((e) => e.id === id),
      getLabel: (id) => (getSnap().sessionManager?.labels || {})[id],
      getBranch: () => getSnap().sessionManager?.branch || [],
      getHeader: () => getSnap().sessionManager?.header ?? null,
      getEntries: () => getSnap().sessionManager?.entries || [],
      getTree: () => getSnap().sessionManager?.tree || [],
    };
    const mr = {
      find: (provider, id) => (getSnap().models || state.aiModels).find((m) => m.provider === provider && m.id === id),
      getAll: () => getSnap().models || state.aiModels,
      getAvailable: () => getSnap().availableModels || getSnap().models || state.aiModels,
      getApiKey: (model) => hostAsync("ctx.mr.getApiKey", [ctxId, model]),
      getApiKeyAndHeaders: (model) => hostAsync("ctx.mr.getApiKeyAndHeaders", [ctxId, model]),
      getApiKeyForProvider: (provider) => hostAsync("ctx.mr.getApiKeyForProvider", [ctxId, String(provider)]),
      isUsingOAuth: () => false,
    };
    const ui = {
      select: (title, options, opts) => hostAsync("ui.select", [ctxId, String(title), Array.from(options || [], String), opts || null]),
      confirm: (title, message, opts) => hostAsync("ui.confirm", [ctxId, String(title), String(message), opts || null]),
      input: (title, placeholder, opts) => hostAsync("ui.input", [ctxId, String(title), placeholder, opts || null]),
      editor: (title, prefill) => hostAsync("ui.editor", [ctxId, String(title), prefill]),
      notify: (message, type) => emitOp("ui.notify", [ctxId, String(message), type]),
      onTerminalInput: () => () => {},
      setStatus: (key, text) => emitOp("ui.setStatus", [ctxId, String(key), text]),
      setWorkingMessage: (msg) => emitOp("ui.setWorkingMessage", [ctxId, msg]),
      setWorkingVisible: (vis) => emitOp("ui.setWorkingVisible", [ctxId, Boolean(vis)]),
      setWorkingIndicator: (opts) => emitOp("ui.setWorkingIndicator", [ctxId, opts || null]),
      setHiddenThinkingLabel: (label) => emitOp("ui.setHiddenThinkingLabel", [ctxId, label]),
      setWidget: (key, content, opts) => {
        if (typeof content === "function") {
          const comp = content({ requestRender() {} }, themeObj);
          const lines = comp && comp.render ? comp.render(80) : [];
          emitOp("ui.setWidget", [ctxId, String(key), lines, opts || null]);
        } else {
          emitOp("ui.setWidget", [ctxId, String(key), content, opts || null]);
        }
      },
      setFooter: (factory) => {
        if (!factory) emitOp("ui.setFooter", [ctxId, null]);
        else emitOp("ui.setFooter", [ctxId, "custom"]);
      },
      setHeader: (factory) => {
        if (!factory) emitOp("ui.setHeader", [ctxId, null]);
        else emitOp("ui.setHeader", [ctxId, "custom"]);
      },
      setTitle: (title) => emitOp("ui.setTitle", [ctxId, String(title)]),
      custom: (factory, options) => {
        const snap = getSnap();
        if (!snap.hasUI) return Promise.resolve(undefined);
        return hostAsync("ui.custom", [ctxId, options || null]).then(() => {
          try {
            let resolved = undefined;
            const done = (v) => { resolved = v; };
            if (typeof factory === "function") {
              factory({ requestRender() {}, terminal: { columns: 80, rows: 24 } }, themeObj, KeybindingsManager.create(), done);
            }
            return resolved;
          } catch {
            return undefined;
          }
        });
      },
      pasteToEditor: (text) => emitOp("ui.pasteToEditor", [ctxId, String(text)]),
      setEditorText: (text) => emitOp("ui.setEditorText", [ctxId, String(text)]),
      getEditorText: () => getSnap().editorText || "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: themeObj,
      getAllThemes: () => getSnap().allThemes || [],
      getTheme: () => themeObj,
      setTheme: (theme) => {
        emitOp("ui.setTheme", [ctxId, typeof theme === "string" ? theme : "custom"]);
        return { success: true };
      },
      getToolsExpanded: () => Boolean(getSnap().toolsExpanded),
      setToolsExpanded: (expanded) => emitOp("ui.setToolsExpanded", [ctxId, Boolean(expanded)]),
    };

    const sig = new globalThis.AbortController().signal;
    if (getSnap().aborted) sig._trigger && sig._trigger(new Error("Aborted"));

    const ctxObj = {
      ui,
      get mode() { return getSnap().mode; },
      get hasUI() { return Boolean(getSnap().hasUI); },
      get cwd() { return getSnap().cwd; },
      get model() { return getSnap().model; },
      get scopedModels() { return getSnap().scopedModels || []; },
      get thinkingLevel() { return getSnap().thinkingLevel; },
      sessionManager: sm,
      modelRegistry: mr,
      signal: sig,
      isIdle: () => Boolean(getSnap().isIdle),
      isProjectTrusted: () => Boolean(getSnap().isProjectTrusted),
      hasPendingMessages: () => Boolean(getSnap().hasPendingMessages),
      abort: () => emitOp("ctx.abort", [ctxId]),
      shutdown: () => emitOp("ctx.shutdown", [ctxId]),
      getContextUsage: () => getSnap().contextUsage,
      compact: (opts) => emitOp("ctx.compact", [ctxId, opts ? { customInstructions: opts.customInstructions } : null]),
      getSystemPrompt: () => getSnap().systemPrompt || "",
    };

    if (ctxRef.isCommand) {
      ctxObj.getSystemPromptOptions = () => getSnap().systemPromptOptions || {};
      ctxObj.waitForIdle = () => hostAsync("cmd.waitForIdle", [ctxId]);
      ctxObj.newSession = (opts) => hostAsync("cmd.newSession", [ctxId, opts ? { parentSession: opts.parentSession } : null]);
      ctxObj.fork = (entryId, opts) => hostAsync("cmd.fork", [ctxId, String(entryId), opts ? { position: opts.position } : null]);
      ctxObj.navigateTree = (targetId, opts) => hostAsync("cmd.navigateTree", [ctxId, String(targetId), opts || null]);
      ctxObj.switchSession = (sessionPath) => hostAsync("cmd.switchSession", [ctxId, String(sessionPath)]);
      ctxObj.reload = () => hostAsync("cmd.reload", [ctxId]);
    }
    if (ctxRef.isTool) {
      ctxObj.tools = getSnap().tools || [];
      ctxObj.executeTool = (name, args) => hostAsync("tool.executeTool", [ctxId, String(name), args]);
    }
    return ctxObj;
  }

  function assertRuntimeReady() {
    if (!state.runtimeInitialized) {
      throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
    }
  }

  function createGuestApi() {
    let nextOpSeq = 1;
    const eventsObj = {
      on(channel, handler) {
        const subId = nextSubId++;
        const fnId = registerFn(handler);
        emitOp("events.on", [String(channel), fnId, subId]);
        return () => emitOp("events.off", [subId]);
      },
      emit(channel, data) {
        emitOp("events.emit", [String(channel), data]);
      },
    };

    return {
      on(event, handler) {
        if (typeof handler !== "function") throw new TypeError("pi.on handler must be a function");
        const fnId = registerFn(handler);
        const subId = nextSubId++;
        emitOp("on", [String(event), fnId, subId]);
        return () => emitOp("off", [subId]);
      },
      registerTool(tool) {
        if (!tool || typeof tool !== "object") throw new TypeError("registerTool expects an object");
        if (typeof tool.execute !== "function") throw new TypeError("Tool must define execute()");
        const execId = registerFn(tool.execute);
        const renderCallId = typeof tool.renderCall === "function" ? registerFn(tool.renderCall) : 0;
        const renderResultId = typeof tool.renderResult === "function" ? registerFn(tool.renderResult) : 0;
        const def = {
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: tool.parameters,
          promptSnippet: tool.promptSnippet,
          promptGuidelines: tool.promptGuidelines,
          reachesTools: tool.reachesTools,
          outputSchema: tool.outputSchema,
          exposure: tool.exposure,
          namespace: tool.namespace,
          annotations: tool.annotations,
        };
        emitOp("registerTool", [def, execId, renderCallId, renderResultId]);
      },
      registerCommand(name, opts) {
        if (!opts || typeof opts !== "object") {
          emitOp("registerCommand", [name, null, 0, 0]);
          return;
        }
        const handlerId = typeof opts.handler === "function" ? registerFn(opts.handler) : 0;
        const compId = typeof opts.getArgumentCompletions === "function" ? registerFn(opts.getArgumentCompletions) : 0;
        emitOp("registerCommand", [name, { description: opts.description }, handlerId, compId]);
      },
      registerShortcut(shortcut, opts) {
        const handlerId = opts && typeof opts.handler === "function" ? registerFn(opts.handler) : 0;
        emitOp("registerShortcut", [String(shortcut), { description: opts && opts.description }, handlerId]);
      },
      registerFlag(name, opts) {
        if (opts && opts.default !== undefined && opts.type !== undefined && typeof opts.default !== opts.type) {
          throw new Error('Invalid default for flag "' + name + '": expected ' + opts.type + ', got ' + typeof opts.default);
        }
        const cleanOpts = opts ? { description: opts.description, type: opts.type, default: opts.default } : {};
        registeredFlags.set(name, opts ? opts.default : undefined);
        emitOp("registerFlag", [name, cleanOpts]);
      },
      getFlag(name) {
        if (!registeredFlags.has(name)) return undefined;
        if (Object.prototype.hasOwnProperty.call(state.runtime.flagValues, name)) {
          return state.runtime.flagValues[name];
        }
        return registeredFlags.get(name);
      },
      registerMessageRenderer(customType, renderer) {
        const fnId = registerFn(renderer);
        emitOp("registerMessageRenderer", [String(customType), fnId]);
      },
      registerEntryRenderer(customType, renderer) {
        const fnId = registerFn(renderer);
        emitOp("registerEntryRenderer", [String(customType), fnId]);
      },
      registerMarkdownTransformer(transformer, opts) {
        const fnId = registerFn(transformer);
        emitOp("registerMarkdownTransformer", [fnId, opts || null]);
      },
      registerToolRenderer(resolver) {
        const fnId = registerFn(resolver);
        emitOp("registerToolRenderer", [fnId]);
      },
      sendMessage(message, opts) {
        assertRuntimeReady();
        emitOp("sendMessage", [message, opts || null]);
      },
      sendUserMessage(content, opts) {
        assertRuntimeReady();
        emitOp("sendUserMessage", [content, opts || null]);
      },
      appendEntry(customType, data) {
        assertRuntimeReady();
        emitOp("appendEntry", [String(customType), data]);
      },
      setSessionName(name) {
        assertRuntimeReady();
        state.runtime.sessionName = String(name);
        emitOp("setSessionName", [String(name)]);
      },
      getSessionName() {
        assertRuntimeReady();
        return state.runtime.sessionName;
      },
      setLabel(entryId, label) {
        assertRuntimeReady();
        emitOp("setLabel", [String(entryId), label]);
      },
      exec(command, args, opts) {
        return hostAsync("exec", [String(command), Array.from(args || [], String), opts || null]);
      },
      getActiveTools() {
        assertRuntimeReady();
        return (state.runtime.activeTools || []).slice();
      },
      getAllTools() {
        assertRuntimeReady();
        return (state.runtime.allTools || []).slice();
      },
      getSettings() {
        assertRuntimeReady();
        return state.runtime.settings || {};
      },
      setActiveTools(toolNames) {
        assertRuntimeReady();
        const names = Array.from(toolNames || [], String);
        state.runtime.activeTools = names;
        emitOp("setActiveTools", [names]);
      },
      getCommands() {
        assertRuntimeReady();
        return (state.runtime.commands || []).slice();
      },
      setModel(model) {
        assertRuntimeReady();
        return hostAsync("setModel", [model]);
      },
      getThinkingLevel() {
        assertRuntimeReady();
        return state.runtime.thinkingLevel;
      },
      setThinkingLevel(level) {
        assertRuntimeReady();
        state.runtime.thinkingLevel = String(level);
        emitOp("setThinkingLevel", [String(level)]);
      },
      registerProvider(providerOrName, config) {
        if (typeof providerOrName === "string") {
          emitOp("registerProvider", [providerOrName, config || null]);
        } else {
          emitOp("registerNativeProvider", [providerOrName || null]);
        }
      },
      unregisterProvider(name) {
        emitOp("unregisterProvider", [String(name)]);
      },
      registerMcpServer(name, config) {
        emitOp("registerMcpServer", [String(name), config]);
      },
      unregisterMcpServer(name) {
        emitOp("unregisterMcpServer", [String(name)]);
      },
      getMcpServers() {
        return state.runtime.mcpServers || [];
      },
      registerVirtualModel(model) {
        const routeId = model && typeof model.route === "function" ? registerFn(model.route) : 0;
        const copy = model && typeof model === "object" ? Object.assign({}, model) : {};
        delete copy.route;
        emitOp("registerVirtualModel", [copy, routeId]);
      },
      unregisterVirtualModel(provider, id) {
        emitOp("unregisterVirtualModel", [String(provider), String(id)]);
      },
      events: eventsObj,
    };
  }

  // --- Bundle Executor & Step Pump ---
  const moduleFactories = new Map();
  const jsonModuleData = new Map();
  const specifierMap = new Map();
  const moduleCache = new Map();

  function makeRequire(fromFile) {
    const req = function require(specifier) {
      const specsForFile = specifierMap.get(fromFile);
      const resolved = (specsForFile && specsForFile[specifier]) || specifier;

      const virt = resolveVirtualModule(resolved);
      if (virt !== undefined) return virt;
      if (resolved.startsWith("virtual:") || resolved.startsWith("node:")) {
        const v2 = resolveVirtualModule(resolved);
        if (v2 !== undefined) return v2;
      }

      if (jsonModuleData.has(resolved)) {
        if (moduleCache.has(resolved)) return moduleCache.get(resolved).exports;
        const parsed = JSON.parse(jsonModuleData.get(resolved));
        moduleCache.set(resolved, { exports: parsed });
        return parsed;
      }

      if (moduleCache.has(resolved)) {
        return moduleCache.get(resolved).exports;
      }

      const factory = moduleFactories.get(resolved);
      if (!factory) {
        const err = new Error("Cannot find module '" + specifier + "'");
        err.code = "MODULE_NOT_FOUND";
        throw err;
      }

      const mod = { exports: {} };
      moduleCache.set(resolved, mod);
      const childReq = makeRequire(resolved);
      const prevReq = globalThis.__piCurrentRequire;
      globalThis.__piCurrentRequire = childReq;
      try {
        const dir = posixPath.dirname(resolved);
        factory(mod.exports, childReq, mod, resolved, dir, resolved, dir);
      } finally {
        globalThis.__piCurrentRequire = prevReq;
      }
      return mod.exports;
    };
    return req;
  }

  function drainStep(taskId) {
    const task = tasks.get(taskId);
    const ops = pendingOps.splice(0, pendingOps.length);
    const hostCalls = pendingHostCalls.splice(0, pendingHostCalls.length);
    return JSON.stringify({
      done: task ? task.done : true,
      ok: task ? task.ok : true,
      value: task ? task.value : undefined,
      error: task ? task.error : undefined,
      ops,
      hostCalls,
      microtaskTick: microtaskCounter,
    });
  }

  function runPromiseTask(fn) {
    const taskId = nextTaskId++;
    const task = { done: false, ok: false, value: undefined, error: undefined };
    tasks.set(taskId, task);
    Promise.resolve().then(() => { microtaskCounter++; });
    try {
      const result = fn();
      if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") {
        result.then(
          (val) => {
            task.done = true;
            task.ok = true;
            task.value = val;
          },
          (err) => {
            task.done = true;
            task.ok = false;
            task.error = { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined };
          },
        );
      } else {
        task.done = true;
        task.ok = true;
        task.value = result;
      }
    } catch (err) {
      task.done = true;
      task.ok = false;
      task.error = { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined };
    }
    return { taskId, stepJson: drainStep(taskId) };
  }

  globalThis.__piLoadBundleAndRun = function(bundle, initialState) {
    updateState(initialState);
    for (const [mPath, code] of Object.entries(bundle.modules || {})) {
      const wrapped = "(function(exports, require, module, __filename, __dirname, __piFilename, __piDirname) { return (function(exports, require, module) {\\n" + code + "\\n})(exports, require, module); })";
      const factoryFn = (0, eval)(wrapped);
      moduleFactories.set(mPath, factoryFn);
    }
    for (const [jPath, raw] of Object.entries(bundle.jsonModules || {})) {
      jsonModuleData.set(jPath, raw);
    }
    for (const [fPath, map] of Object.entries(bundle.specifierMap || {})) {
      specifierMap.set(fPath, map);
    }

    const { taskId, stepJson } = runPromiseTask(() => {
      const entryExports = makeRequire(bundle.entry)(bundle.entry);
      let extFactory = null;
      if (typeof entryExports === "function") extFactory = entryExports;
      else if (entryExports && typeof entryExports.default === "function") extFactory = entryExports.default;
      else if (entryExports && entryExports.default && typeof entryExports.default.default === "function") extFactory = entryExports.default.default;
      if (typeof extFactory !== "function") {
        throw new Error('Extension "' + bundle.extensionPath + '" does not export a valid factory function');
      }
      const api = createGuestApi();
      return extFactory(api);
    });
    return JSON.stringify({ taskId, step: JSON.parse(stepJson) });
  };

  function reviveCallArg(arg) {
    if (arg && typeof arg === "object" && arg.__piType === "ctx") {
      return makeGuestContext(arg);
    }
    if (arg && typeof arg === "object" && arg.__piType === "onUpdate") {
      const token = arg.token;
      return (partial) => emitOp("tool.onUpdate", [token, partial]);
    }
    if (arg && typeof arg === "object" && arg.__piType === "signal") {
      const s = new globalThis.AbortController().signal;
      if (arg.aborted && s._trigger) s._trigger(new Error("Aborted"));
      return s;
    }
    if (arg && typeof arg === "object" && arg.__piType === "theme") {
      return themeObj;
    }
    return arg;
  }

  globalThis.__piStartFnCall = function(fnId, args, freshState) {
    updateState(freshState);
    const { taskId, stepJson } = runPromiseTask(() => {
      const fn = fnTable.get(fnId);
      if (typeof fn !== "function") {
        throw new Error("Extension callback " + fnId + " not found");
      }
      const revived = (args || []).map(reviveCallArg);
      return fn(...revived);
    });
    return JSON.stringify({ taskId, step: JSON.parse(stepJson) });
  };

  globalThis.__piResolveCalls = function(taskId, results, freshState) {
    updateState(freshState);
    for (const r of results || []) {
      const resolver = callResolvers.get(r.callId);
      if (!resolver) continue;
      callResolvers.delete(r.callId);
      if (r.ok) resolver.resolve(r.value);
      else resolver.reject(new Error(r.error || "Host call failed"));
    }
    return drainStep(taskId);
  };

  globalThis.__piCollectStep = function(taskId, freshState) {
    if (freshState) updateState(freshState);
    Promise.resolve().then(() => { microtaskCounter++; });
    return drainStep(taskId);
  };

  globalThis.__piRunSyncRender = function(fnId, args, width, freshState) {
    updateState(freshState);
    const fn = fnTable.get(fnId);
    if (typeof fn !== "function") return JSON.stringify({ ok: true, value: null, ops: pendingOps.splice(0) });
    try {
      const revived = (args || []).map(reviveCallArg);
      const res = fn(...revived);
      const ops = pendingOps.splice(0, pendingOps.length);
      if (res === null || res === undefined) return JSON.stringify({ ok: true, value: null, ops });
      if (typeof res === "string") return JSON.stringify({ ok: true, value: { lines: res.split("\\n") }, ops });
      if (typeof res.render === "function") {
        const compId = nextCompId++;
        compTable.set(compId, res);
        const lines = res.render(width || 80);
        return JSON.stringify({ ok: true, value: { compId, lines: Array.isArray(lines) ? lines : [] }, ops });
      }
      return JSON.stringify({ ok: true, value: res, ops });
    } catch (err) {
      const ops = pendingOps.splice(0, pendingOps.length);
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err), ops });
    }
  };

  globalThis.__piInvokeToolRendererResolver = function(fnId, toolName, freshState) {
    updateState(freshState);
    const fn = fnTable.get(fnId);
    if (typeof fn !== "function") return JSON.stringify({ ok: true, value: null, ops: pendingOps.splice(0) });
    try {
      let useNext = false;
      const res = fn(toolName, () => { useNext = true; return undefined; });
      const ops = pendingOps.splice(0, pendingOps.length);
      if (useNext || !res || typeof res !== "object") {
        return JSON.stringify({ ok: true, value: useNext ? { next: true } : null, ops });
      }
      const renderCallId = typeof res.renderCall === "function" ? registerFn(res.renderCall) : 0;
      const renderResultId = typeof res.renderResult === "function" ? registerFn(res.renderResult) : 0;
      return JSON.stringify({ ok: true, value: { renderCallId, renderResultId }, ops });
    } catch (err) {
      const ops = pendingOps.splice(0, pendingOps.length);
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err), ops });
    }
  };

  globalThis.__piCompRender = function(compId, width) {
    const comp = compTable.get(compId);
    if (!comp || typeof comp.render !== "function") return JSON.stringify([]);
    const lines = comp.render(width || 80);
    return JSON.stringify(Array.isArray(lines) ? lines : []);
  };
  globalThis.__piCompInvalidate = function(compId) {
    const comp = compTable.get(compId);
    if (comp && typeof comp.invalidate === "function") comp.invalidate();
  };
  globalThis.__piCompDelete = function(compId) {
    compTable.delete(compId);
  };
})();
`;
}

function serializeToolRenderContext(ctx: ToolRenderContext): Record<string, unknown> {
	return {
		args: toJsonSafe(ctx.args),
		toolCallId: ctx.toolCallId,
		state: toJsonSafe(ctx.state),
		cwd: ctx.cwd,
		executionStarted: ctx.executionStarted,
		argsComplete: ctx.argsComplete,
		isPartial: ctx.isPartial,
		expanded: ctx.expanded,
		showImages: ctx.showImages,
		isError: ctx.isError,
		durationMs: ctx.durationMs,
		outputPad: ctx.outputPad,
	};
}

function buildRenderedComponentShim(vmId: number, initialLines: string[], compId?: number): ComponentLike {
	let cachedLines = initialLines;
	let disposed = false;
	return {
		render(width: number): string[] {
			if (compId !== undefined && !disposed && activeVmIds.has(vmId)) {
				try {
					const lines = evalJscJson<string[]>(
						vmId,
						`globalThis.__piCompRender(${compId}, ${Math.max(1, Math.floor(width))})`,
						"pi-ext-render",
					);
					if (Array.isArray(lines)) {
						cachedLines = lines;
					}
				} catch {
					// Keep last valid lines if VM disposed
				}
			}
			return cachedLines;
		},
		invalidate(): void {
			if (compId !== undefined && !disposed && activeVmIds.has(vmId)) {
				try {
					evalJscRaw(vmId, `globalThis.__piCompInvalidate(${compId})`, "pi-ext-invalidate");
				} catch {
					// Ignore on teardown
				}
			}
		},
		dispose(): void {
			if (compId !== undefined && !disposed) {
				disposed = true;
				if (!activeVmIds.has(vmId)) return;
				try {
					evalJscRaw(vmId, `globalThis.__piCompDelete(${compId})`, "pi-ext-dispose");
				} catch {
					// Ignore
				}
			}
		},
	};
}

/**
 * Load an external JS/TS extension using an isolated JavaScriptCore VM via native FFI.
 */
export async function loadExternalExtensionViaJsc(
	extensionPath: string,
	cwd: string,
	eventBus: EventBus,
	runtime: ExtensionRuntime,
	hooks: ExtensionLoaderHooks,
): Promise<Extension> {
	const resolvedPath = path.resolve(extensionPath);
	const bundle: BundledExtensionGraph = bundleExtensionEntry(resolvedPath);

	const vmId = nativeJscCreate();
	activeVmIds.add(vmId);

	const extension = hooks.createExtension(extensionPath, bundle.entry);
	const { api, commit, discard } = hooks.createExtensionAPI(extension, runtime, cwd, eventBus);

	const contexts = new Map<number, ContextEntry>();
	let nextCtxId = 1;
	let nextUpdateToken = 1;
	const updateCallbacks = new Map<number, (partial: unknown) => void>();
	const eventUnsubscribers = new Map<number, () => void>();
	let runtimeInitialized = false;
	let vmDisposed = false;
	const isVmAlive = (): boolean => !vmDisposed && activeVmIds.has(vmId);

	const allocContext = (
		ctx: ExtensionContext,
		opts?: { isCommand?: boolean; isTool?: boolean; onUpdate?: (partial: unknown) => void },
	): { id: number; snapshot: Record<string, unknown> } => {
		const id = nextCtxId++;
		contexts.set(id, {
			id,
			ctx,
			isCommand: Boolean(opts?.isCommand),
			isTool: Boolean(opts?.isTool),
			onUpdate: opts?.onUpdate,
		});
		const sm = ctx.sessionManager;
		const entries = sm?.getEntries?.() ?? [];
		const branch = sm?.getBranch?.() ?? [];
		const labels: Record<string, string> = {};
		if (sm?.getLabel) {
			for (const e of entries) {
				const lbl = sm.getLabel(e.id);
				if (lbl !== undefined) labels[e.id] = lbl;
			}
		}
		let systemPromptOptions: unknown = undefined;
		if (opts?.isCommand) {
			try {
				systemPromptOptions = toJsonSafe((ctx as ExtensionCommandContext).getSystemPromptOptions?.());
			} catch {
				systemPromptOptions = undefined;
			}
		}
		const rawTools = opts?.isTool ? (ctx as ExtensionToolContext).tools : undefined;
		const toolsList = Array.isArray(rawTools)
			? rawTools.map((t) => ({
					name: t.name,
					label: t.label,
					description: t.description,
					parameters: toJsonSafe(t.parameters),
				}))
			: undefined;

		const snapshot: Record<string, unknown> = {
			id,
			mode: ctx.mode,
			hasUI: ctx.hasUI,
			cwd: ctx.cwd,
			model: toJsonSafe(ctx.model),
			scopedModels: toJsonSafe(ctx.scopedModels),
			thinkingLevel: ctx.thinkingLevel,
			isIdle: ctx.isIdle?.() ?? true,
			isProjectTrusted: ctx.isProjectTrusted?.() ?? true,
			hasPendingMessages: ctx.hasPendingMessages?.() ?? false,
			aborted: Boolean(ctx.signal?.aborted),
			contextUsage: toJsonSafe(ctx.getContextUsage?.()),
			systemPrompt: ctx.getSystemPrompt?.() ?? "",
			systemPromptOptions,
			tools: toolsList,
			editorText: ctx.ui?.getEditorText?.() ?? "",
			allThemes: ctx.ui?.getAllThemes?.() ?? [],
			toolsExpanded: ctx.ui?.getToolsExpanded?.() ?? false,
			models: toJsonSafe(ctx.modelRegistry?.getAll?.() ?? []),
			availableModels: toJsonSafe(ctx.modelRegistry?.getAvailable?.() ?? []),
			sessionManager: {
				cwd: sm?.getCwd?.() ?? ctx.cwd,
				sessionDir: sm?.getSessionDir?.() ?? "",
				sessionId: sm?.getSessionId?.() ?? "",
				sessionFile: sm?.getSessionFile?.(),
				sessionName: sm?.getSessionName?.(),
				leafId: sm?.getLeafId?.() ?? null,
				leafEntry: toJsonSafe(sm?.getLeafEntry?.()),
				header: toJsonSafe(sm?.getHeader?.() ?? null),
				entries: toJsonSafe(entries),
				branch: toJsonSafe(branch),
				tree: toJsonSafe(sm?.getTree?.() ?? []),
				labels,
			},
		};
		return { id, snapshot };
	};

	const buildStatePatch = (extraContexts?: Record<string, unknown>): Record<string, unknown> => {
		const flagValuesObj: Record<string, boolean | string> = {};
		for (const [k, v] of runtime.flagValues.entries()) {
			flagValuesObj[k] = v;
		}
		let activeTools: string[] = [];
		let allTools: unknown[] = [];
		let commands: unknown[] = [];
		let settings: unknown = {};
		let sessionName: string | undefined = undefined;
		let thinkingLevel: string = "off";
		let mcpServers: unknown = [];
		let runtimeReady = runtimeInitialized;
		try {
			activeTools = runtime.getActiveTools();
			allTools = toJsonSafe(runtime.getAllTools()) as unknown[];
			commands = toJsonSafe(runtime.getCommands()) as unknown[];
			settings = toJsonSafe(runtime.getSettings());
			sessionName = runtime.getSessionName();
			thinkingLevel = runtime.getThinkingLevel();
			mcpServers = toJsonSafe(api.getMcpServers());
			runtimeReady = true;
			runtimeInitialized = true;
		} catch {
			// Runtime not yet bound during initial extension load
		}

		const envCopy: Record<string, string> = {};
		for (const [k, v] of Object.entries(process.env)) {
			if (typeof v === "string") envCopy[k] = v;
		}
		const agentDir = getAgentDir();
		const patch: Record<string, unknown> = {
			cwd,
			env: envCopy,
			os: {
				homedir: os.homedir(),
				tmpdir: os.tmpdir(),
				platform: process.platform,
				arch: process.arch,
				hostname: os.hostname(),
				eol: os.EOL,
				type: os.type(),
				release: os.release(),
				user: os.userInfo().username,
			},
			constants: {
				version: VERSION,
				appName: APP_NAME,
				configDirName: CONFIG_DIR_NAME,
				agentDir,
				packageDir: getPackageDir(),
				docsPath: getDocsPath(),
				examplesPath: getExamplesPath(),
				readmePath: getReadmePath(),
				modelsPath: path.join(agentDir, "models.json"),
				settingsPath: path.join(agentDir, "settings.json"),
				sessionsDir: path.join(agentDir, "sessions"),
			},
			runtimeInitialized: runtimeReady,
			runtime: {
				activeTools,
				allTools,
				commands,
				settings,
				sessionName,
				thinkingLevel,
				flagValues: flagValuesObj,
				mcpServers,
			},
		};
		if (extraContexts !== undefined) {
			patch.contexts = extraContexts;
		}
		return patch;
	};

	const runSyncCallback = (fnId: number, args: unknown[], width = 80, extraCtx?: Record<string, unknown>): { lines: string[]; compId?: number } | null => {
		if (!isVmAlive()) return null;
		const patch = buildStatePatch(extraCtx);
		const res = evalJscJson<{
			ok: boolean;
			value?: { lines?: string[]; compId?: number } | string[] | null;
			error?: string;
			ops?: JscOp[];
		}>(
			vmId,
			`globalThis.__piRunSyncRender(${fnId}, ${JSON.stringify(args)}, ${Math.max(1, Math.floor(width))}, ${JSON.stringify(patch)})`,
			"pi-ext-sync",
		);
		if (res.ops && res.ops.length > 0) {
			applyOps(res.ops);
		}
		if (!res.ok) {
			throw new Error(res.error ?? "Synchronous extension callback failed");
		}
		if (res.value === null || res.value === undefined) return null;
		if (Array.isArray(res.value)) return { lines: res.value };
		return { lines: res.value.lines ?? [], compId: res.value.compId };
	};

	const applyOps = (ops: JscOp[]): void => {
		for (const item of ops) {
			const args = item.args ?? [];
			switch (item.op) {
				case "console": {
					const level = String(args[0] ?? "log");
					const msg = String(args[1] ?? "");
					if (level === "warn") console.warn(msg);
					else if (level === "error") console.error(msg);
					break;
				}
				case "on": {
					const event = String(args[0]);
					const fnId = Number(args[1]);
					const subId = Number(args[2]);
					const registerOn = api.on as (
						eventName: string,
						handler: (ev: unknown, ctx: ExtensionContext) => Promise<unknown>,
					) => () => void;
					const unsub = registerOn(event, async (ev: unknown, ctx: ExtensionContext) => {
						if (!isVmAlive()) return undefined;
						const { id, snapshot } = allocContext(ctx);
						try {
							return await runAsyncFnCall(
								fnId,
								[toJsonSafe(ev), { __piType: "ctx", id, isCommand: false, isTool: false }],
								{ [String(id)]: snapshot },
							);
						} finally {
							contexts.delete(id);
						}
					});
					eventUnsubscribers.set(subId, unsub);
					break;
				}
				case "off": {
					const subId = Number(args[0]);
					const unsub = eventUnsubscribers.get(subId);
					if (unsub) {
						eventUnsubscribers.delete(subId);
						unsub();
					}
					break;
				}
				case "registerTool": {
					const def = args[0] as Record<string, unknown>;
					const execId = Number(args[1]);
					const renderCallId = Number(args[2] ?? 0);
					const renderResultId = Number(args[3] ?? 0);
					const rawReaches = def.reachesTools;
					const reachesToolsFn: ToolDefinition["reachesTools"] =
						rawReaches === "all"
							? () => "all"
							: Array.isArray(rawReaches)
								? () => rawReaches.map(String)
								: undefined;
					const toolDef: ToolDefinition = {
						name: String(def.name ?? ""),
						label: String(def.label ?? def.name ?? ""),
						description: String(def.description ?? ""),
						parameters: def.parameters as ToolDefinition["parameters"],
						promptSnippet: def.promptSnippet as string | undefined,
						promptGuidelines: def.promptGuidelines as string[] | undefined,
						reachesTools: reachesToolsFn,
						outputSchema: def.outputSchema as ToolDefinition["outputSchema"],
						exposure: def.exposure as ToolDefinition["exposure"],
						namespace: def.namespace as ToolDefinition["namespace"],
						annotations: def.annotations as ToolDefinition["annotations"],
						execute: async (toolCallId, params, signal, onUpdate, ctx) => {
							const { id, snapshot } = allocContext(ctx, { isTool: true, onUpdate: onUpdate as ((p: unknown) => void) | undefined });
							const updToken = nextUpdateToken++;
							if (onUpdate) {
								updateCallbacks.set(updToken, onUpdate as (partial: unknown) => void);
							}
							try {
								const result = await runAsyncFnCall(
									execId,
									[
										toolCallId,
										toJsonSafe(params),
										{ __piType: "signal", aborted: Boolean(signal?.aborted) },
										onUpdate ? { __piType: "onUpdate", token: updToken } : undefined,
										{ __piType: "ctx", id, isTool: true, isCommand: false },
									],
									{ [String(id)]: snapshot },
								);
								return (result ?? { content: [{ type: "text", text: "" }], details: {} }) as Awaited<ReturnType<ToolDefinition["execute"]>>;
							} finally {
								contexts.delete(id);
								updateCallbacks.delete(updToken);
							}
						},
					};
					if (renderCallId > 0) {
						toolDef.renderCall = (callArgs, _theme, ctx) => {
							const rendered = runSyncCallback(
								renderCallId,
								[toJsonSafe(callArgs), { __piType: "theme" }, serializeToolRenderContext(ctx)],
								80,
							);
							return buildRenderedComponentShim(vmId, rendered?.lines ?? [], rendered?.compId);
						};
					}
					if (renderResultId > 0) {
						toolDef.renderResult = (result, options, _theme, ctx) => {
							const rendered = runSyncCallback(
								renderResultId,
								[toJsonSafe(result), toJsonSafe(options), { __piType: "theme" }, serializeToolRenderContext(ctx)],
								80,
							);
							return buildRenderedComponentShim(vmId, rendered?.lines ?? [], rendered?.compId);
						};
					}
					api.registerTool(toolDef);
					break;
				}
				case "tool.onUpdate": {
					const token = Number(args[0]);
					const cb = updateCallbacks.get(token);
					if (cb) cb(args[1]);
					break;
				}
				case "registerCommand": {
					const name = args[0] as string;
					const opts = args[1] as { description?: string } | null;
					const handlerId = Number(args[2] ?? 0);
					const compId = Number(args[3] ?? 0);
					if (opts === null || handlerId === 0) {
						api.registerCommand(name, opts as Parameters<ExtensionAPI["registerCommand"]>[1]);
						break;
					}
					api.registerCommand(name, {
						description: opts.description,
						handler: async (cmdArgs: string, ctx: ExtensionCommandContext) => {
							const { id, snapshot } = allocContext(ctx, { isCommand: true });
							try {
								await runAsyncFnCall(
									handlerId,
									[cmdArgs, { __piType: "ctx", id, isCommand: true, isTool: false }],
									{ [String(id)]: snapshot },
								);
							} finally {
								contexts.delete(id);
							}
						},
						...(compId > 0
							? {
									getArgumentCompletions: (prefix: string) => {
										try {
											const patch = buildStatePatch();
											const res = evalJscJson<{ ok: boolean; value?: unknown }>(
												vmId,
												`globalThis.__piRunSyncRender(${compId}, ${JSON.stringify([prefix])}, 80, ${JSON.stringify(patch)})`,
												"pi-ext-cmd-complete",
											);
											if (res.ok && Array.isArray(res.value)) {
												return res.value as ReturnType<NonNullable<Parameters<ExtensionAPI["registerCommand"]>[1]["getArgumentCompletions"]>>;
											}
										} catch {
											// Ignore completion failures
										}
										return null;
									},
								}
							: {}),
					});
					break;
				}
				case "registerShortcut": {
					const shortcut = String(args[0]) as KeyId;
					const opts = (args[1] as { description?: string } | null) ?? {};
					const handlerId = Number(args[2] ?? 0);
					api.registerShortcut(shortcut, {
						description: opts.description,
						handler: async (ctx: ExtensionContext) => {
							const { id, snapshot } = allocContext(ctx);
							try {
								await runAsyncFnCall(
									handlerId,
									[{ __piType: "ctx", id, isCommand: false, isTool: false }],
									{ [String(id)]: snapshot },
								);
							} finally {
								contexts.delete(id);
							}
						},
					});
					break;
				}
				case "registerFlag": {
					const name = String(args[0]);
					const opts = (args[1] ?? {}) as Parameters<ExtensionAPI["registerFlag"]>[1];
					api.registerFlag(name, opts);
					break;
				}
				case "registerMessageRenderer": {
					const customType = String(args[0]);
					const fnId = Number(args[1]);
					const renderer: MessageRenderer = (message, options) => {
						const rendered = runSyncCallback(fnId, [toJsonSafe(message), toJsonSafe(options), { __piType: "theme" }]);
						if (!rendered) return undefined;
						return buildRenderedComponentShim(vmId, rendered.lines, rendered.compId);
					};
					api.registerMessageRenderer(customType, renderer);
					break;
				}
				case "registerEntryRenderer": {
					const customType = String(args[0]);
					const fnId = Number(args[1]);
					const renderer: EntryRenderer = (entry, options) => {
						const rendered = runSyncCallback(fnId, [toJsonSafe(entry), toJsonSafe(options), { __piType: "theme" }]);
						if (!rendered) return undefined;
						return buildRenderedComponentShim(vmId, rendered.lines, rendered.compId);
					};
					api.registerEntryRenderer(customType, renderer);
					break;
				}
				case "registerMarkdownTransformer": {
					const fnId = Number(args[0]);
					const opts = (args[1] ?? undefined) as Parameters<ExtensionAPI["registerMarkdownTransformer"]>[1];
					api.registerMarkdownTransformer((markdown, meta) => {
						const patch = buildStatePatch();
						const res = evalJscJson<{ ok: boolean; value?: unknown; error?: string }>(
							vmId,
							`globalThis.__piRunSyncRender(${fnId}, ${JSON.stringify([markdown, toJsonSafe(meta)])}, 80, ${JSON.stringify(patch)})`,
							"pi-ext-md-transform",
						);
						if (!res.ok) throw new Error(res.error ?? "Markdown transformer failed");
						if (typeof res.value === "string") return res.value;
						if (res.value && typeof res.value === "object" && Array.isArray((res.value as { lines?: unknown[] }).lines)) {
							return ((res.value as { lines: string[] }).lines).join("\n");
						}
						return markdown;
					}, opts);
					break;
				}
				case "registerToolRenderer": {
					const fnId = Number(args[0]);
					api.registerToolRenderer((toolName, next) => {
						if (!isVmAlive()) return next();
						const patch = buildStatePatch();
						const res = evalJscJson<{
							ok: boolean;
							value?: { next?: boolean; renderCallId?: number; renderResultId?: number } | null;
							error?: string;
							ops?: JscOp[];
						}>(
							vmId,
							`globalThis.__piInvokeToolRendererResolver(${fnId}, ${JSON.stringify(toolName)}, ${JSON.stringify(patch)})`,
							"pi-ext-tool-renderer",
						);
						if (res.ops && res.ops.length > 0) {
							applyOps(res.ops);
						}
						if (!res.ok) {
							throw new Error(res.error ?? "Tool renderer resolver failed");
						}
						if (!res.value) return undefined;
						if (res.value.next) return next();
						const renderers: {
							renderCall?: ToolDefinition["renderCall"];
							renderResult?: ToolDefinition["renderResult"];
						} = {};
						const callId = res.value.renderCallId ?? 0;
						const resultId = res.value.renderResultId ?? 0;
						if (callId > 0) {
							renderers.renderCall = (callArgs, _theme, ctx) => {
								const rendered = runSyncCallback(
									callId,
									[toJsonSafe(callArgs), { __piType: "theme" }, serializeToolRenderContext(ctx)],
									80,
								);
								return buildRenderedComponentShim(vmId, rendered?.lines ?? [], rendered?.compId);
							};
						}
						if (resultId > 0) {
							renderers.renderResult = (result, options, _theme, ctx) => {
								const rendered = runSyncCallback(
									resultId,
									[toJsonSafe(result), toJsonSafe(options), { __piType: "theme" }, serializeToolRenderContext(ctx)],
									80,
								);
								return buildRenderedComponentShim(vmId, rendered?.lines ?? [], rendered?.compId);
							};
						}
						return renderers;
					});
					break;
				}
				case "sendMessage":
					api.sendMessage(
						args[0] as Parameters<ExtensionAPI["sendMessage"]>[0],
						(args[1] ?? undefined) as Parameters<ExtensionAPI["sendMessage"]>[1],
					);
					break;
				case "sendUserMessage":
					api.sendUserMessage(
						args[0] as Parameters<ExtensionAPI["sendUserMessage"]>[0],
						(args[1] ?? undefined) as Parameters<ExtensionAPI["sendUserMessage"]>[1],
					);
					break;
				case "appendEntry":
					api.appendEntry(String(args[0]), args[1]);
					break;
				case "setSessionName":
					api.setSessionName(String(args[0]));
					break;
				case "setLabel":
					api.setLabel(String(args[0]), (args[1] as string | undefined) ?? undefined);
					break;
				case "setActiveTools":
					api.setActiveTools(Array.isArray(args[0]) ? args[0].map(String) : []);
					break;
				case "setThinkingLevel":
					api.setThinkingLevel(String(args[0]) as Parameters<ExtensionAPI["setThinkingLevel"]>[0]);
					break;
				case "registerProvider":
					api.registerProvider(
						String(args[0]),
						(args[1] ?? {}) as Parameters<ExtensionAPI["registerProvider"]>[1],
					);
					break;
				case "registerNativeProvider":
					api.registerProvider(args[0] as Provider<Api>);
					break;
				case "unregisterProvider":
					api.unregisterProvider(String(args[0]));
					break;
				case "registerMcpServer":
					api.registerMcpServer(String(args[0]), args[1] as Parameters<ExtensionAPI["registerMcpServer"]>[1]);
					break;
				case "unregisterMcpServer":
					api.unregisterMcpServer(String(args[0]));
					break;
				case "registerVirtualModel": {
					const rawModel = (args[0] ?? {}) as Record<string, unknown>;
					const routeId = Number(args[1] ?? 0);
					const vmodel = {
						...rawModel,
						route: async (request: unknown, ctx: ExtensionContext) => {
							if (routeId <= 0) {
								throw new Error("Virtual model route() handler is missing");
							}
							const { id, snapshot } = allocContext(ctx);
							try {
								return await runAsyncFnCall(
									routeId,
									[toJsonSafe(request), { __piType: "ctx", id, isCommand: false, isTool: false }],
									{ [String(id)]: snapshot },
								);
							} finally {
								contexts.delete(id);
							}
						},
					} as Parameters<ExtensionAPI["registerVirtualModel"]>[0];
					api.registerVirtualModel(vmodel);
					break;
				}
				case "unregisterVirtualModel":
					api.unregisterVirtualModel(String(args[0]), String(args[1]));
					break;
				case "events.on": {
					const channel = String(args[0]);
					const fnId = Number(args[1]);
					const subId = Number(args[2]);
					const unsub = api.events.on(channel, (data: unknown) => {
						void runAsyncFnCall(fnId, [toJsonSafe(data)]).catch(() => {});
					});
					eventUnsubscribers.set(subId, unsub);
					break;
				}
				case "events.off": {
					const subId = Number(args[0]);
					const unsub = eventUnsubscribers.get(subId);
					if (unsub) {
						eventUnsubscribers.delete(subId);
						unsub();
					}
					break;
				}
				case "events.emit":
					api.events.emit(String(args[0]), args[1]);
					break;
				case "ui.notify": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.notify(String(args[1]), args[2] as "info" | "warning" | "error" | undefined);
					break;
				}
				case "ui.setStatus": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setStatus(String(args[1]), args[2] as string | undefined);
					break;
				}
				case "ui.setWorkingMessage": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setWorkingMessage(args[1] as string | undefined);
					break;
				}
				case "ui.setWorkingVisible": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setWorkingVisible(Boolean(args[1]));
					break;
				}
				case "ui.setWorkingIndicator": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setWorkingIndicator((args[1] ?? undefined) as Parameters<ExtensionContext["ui"]["setWorkingIndicator"]>[0]);
					break;
				}
				case "ui.setHiddenThinkingLabel": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setHiddenThinkingLabel(args[1] as string | undefined);
					break;
				}
				case "ui.setWidget": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setWidget(
						String(args[1]),
						args[2] as string[] | undefined,
						(args[3] ?? undefined) as Parameters<ExtensionContext["ui"]["setWidget"]>[2],
					);
					break;
				}
				case "ui.setFooter": {
					const entry = contexts.get(Number(args[0]));
					if (args[1] === null) entry?.ctx.ui.setFooter(undefined);
					break;
				}
				case "ui.setHeader": {
					const entry = contexts.get(Number(args[0]));
					if (args[1] === null) entry?.ctx.ui.setHeader(undefined);
					break;
				}
				case "ui.setTitle": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setTitle(String(args[1]));
					break;
				}
				case "ui.pasteToEditor": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.pasteToEditor(String(args[1]));
					break;
				}
				case "ui.setEditorText": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setEditorText(String(args[1]));
					break;
				}
				case "ui.setTheme": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setTheme(String(args[1]));
					break;
				}
				case "ui.setToolsExpanded": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.ui.setToolsExpanded(Boolean(args[1]));
					break;
				}
				case "ctx.abort": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.abort();
					break;
				}
				case "ctx.shutdown": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.shutdown();
					break;
				}
				case "ctx.compact": {
					const entry = contexts.get(Number(args[0]));
					entry?.ctx.compact((args[1] ?? undefined) as Parameters<ExtensionContext["compact"]>[0]);
					break;
				}
				case "fs.writeFileSync":
					fs.writeFileSync(String(args[0]), String(args[1] ?? ""), "utf8");
					break;
				case "fs.appendFileSync":
					fs.appendFileSync(String(args[0]), String(args[1] ?? ""), "utf8");
					break;
				case "fs.mkdirSync":
					if (Boolean(args[1])) {
						fs.mkdirSync(String(args[0]), { recursive: true });
					} else {
						fs.mkdirSync(String(args[0]));
					}
					break;
				case "fs.unlinkSync":
					fs.unlinkSync(String(args[0]));
					break;
				case "fs.rmSync": {
					const rmTarget = String(args[0]);
					const rmOpts = (args[1] ?? {}) as { recursive?: boolean; force?: boolean };
					if (rmOpts.recursive && rmOpts.force) {
						fs.rmSync(rmTarget, { recursive: true, force: true });
					} else if (rmOpts.recursive) {
						fs.rmSync(rmTarget, { recursive: true });
					} else if (rmOpts.force) {
						fs.rmSync(rmTarget, { force: true });
					} else {
						fs.rmSync(rmTarget);
					}
					break;
				}
				case "fs.renameSync":
					fs.renameSync(String(args[0]), String(args[1]));
					break;
				case "fs.copyFileSync":
					fs.copyFileSync(String(args[0]), String(args[1]));
					break;
				default:
					break;
			}
		}
	};

	const executeHostCall = async (call: JscHostCall): Promise<JscHostCallResult> => {
		const args = call.args ?? [];
		try {
			switch (call.method) {
				case "timer": {
					const ms = Math.max(0, Number(args[0] ?? 0));
					await new Promise<void>((resolve) => setTimeout(resolve, ms));
					return { callId: call.callId, ok: true, value: true };
				}
				case "exec": {
					const cmd = String(args[0] ?? "");
					const cmdArgs = Array.isArray(args[1]) ? args[1].map(String) : [];
					const opts = (args[2] ?? undefined) as ExecOptions | undefined;
					const result = await api.exec(cmd, cmdArgs, opts);
					return { callId: call.callId, ok: true, value: toJsonSafe(result) };
				}
				case "setModel": {
					const ok = await api.setModel(args[0] as Parameters<ExtensionAPI["setModel"]>[0]);
					return { callId: call.callId, ok: true, value: ok };
				}
				case "fetch": {
					const url = String(args[0]);
					const init = (args[1] ?? undefined) as RequestInit | undefined;
					const resp = await globalThis.fetch(url, init);
					const body = await resp.text();
					const headers: Record<string, string> = {};
					resp.headers.forEach((v, k) => {
						headers[k] = v;
					});
					return {
						callId: call.callId,
						ok: true,
						value: {
							ok: resp.ok,
							status: resp.status,
							statusText: resp.statusText,
							url: resp.url,
							redirected: resp.redirected,
							headers,
							body,
						},
					};
				}
				case "ui.select": {
					const entry = contexts.get(Number(args[0]));
					if (!entry) return { callId: call.callId, ok: true, value: undefined };
					const val = await entry.ctx.ui.select(
						String(args[1]),
						Array.isArray(args[2]) ? args[2].map(String) : [],
						(args[3] ?? undefined) as Parameters<ExtensionContext["ui"]["select"]>[2],
					);
					return { callId: call.callId, ok: true, value: val };
				}
				case "ui.confirm": {
					const entry = contexts.get(Number(args[0]));
					if (!entry) return { callId: call.callId, ok: true, value: false };
					const val = await entry.ctx.ui.confirm(
						String(args[1]),
						String(args[2]),
						(args[3] ?? undefined) as Parameters<ExtensionContext["ui"]["confirm"]>[2],
					);
					return { callId: call.callId, ok: true, value: val };
				}
				case "ui.input": {
					const entry = contexts.get(Number(args[0]));
					if (!entry) return { callId: call.callId, ok: true, value: undefined };
					const val = await entry.ctx.ui.input(
						String(args[1]),
						args[2] as string | undefined,
						(args[3] ?? undefined) as Parameters<ExtensionContext["ui"]["input"]>[2],
					);
					return { callId: call.callId, ok: true, value: val };
				}
				case "ui.editor": {
					const entry = contexts.get(Number(args[0]));
					if (!entry) return { callId: call.callId, ok: true, value: undefined };
					const val = await entry.ctx.ui.editor(String(args[1]), args[2] as string | undefined);
					return { callId: call.callId, ok: true, value: val };
				}
				case "ui.custom":
					return { callId: call.callId, ok: true, value: undefined };
				case "cmd.waitForIdle": {
					const entry = contexts.get(Number(args[0]));
					await (entry?.ctx as ExtensionCommandContext | undefined)?.waitForIdle();
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "cmd.newSession": {
					const entry = contexts.get(Number(args[0]));
					const res = await (entry?.ctx as ExtensionCommandContext | undefined)?.newSession(
						(args[1] ?? undefined) as Parameters<ExtensionCommandContext["newSession"]>[0],
					);
					return { callId: call.callId, ok: true, value: res ?? { cancelled: false } };
				}
				case "cmd.fork": {
					const entry = contexts.get(Number(args[0]));
					const res = await (entry?.ctx as ExtensionCommandContext | undefined)?.fork(
						String(args[1]),
						(args[2] ?? undefined) as Parameters<ExtensionCommandContext["fork"]>[1],
					);
					return { callId: call.callId, ok: true, value: res ?? { cancelled: false } };
				}
				case "cmd.navigateTree": {
					const entry = contexts.get(Number(args[0]));
					const res = await (entry?.ctx as ExtensionCommandContext | undefined)?.navigateTree(
						String(args[1]),
						(args[2] ?? undefined) as Parameters<ExtensionCommandContext["navigateTree"]>[1],
					);
					return { callId: call.callId, ok: true, value: res ?? { cancelled: false } };
				}
				case "cmd.switchSession": {
					const entry = contexts.get(Number(args[0]));
					const res = await (entry?.ctx as ExtensionCommandContext | undefined)?.switchSession(String(args[1]));
					return { callId: call.callId, ok: true, value: res ?? { cancelled: false } };
				}
				case "cmd.reload": {
					const entry = contexts.get(Number(args[0]));
					await (entry?.ctx as ExtensionCommandContext | undefined)?.reload();
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "tool.executeTool": {
					const entry = contexts.get(Number(args[0]));
					if (!entry || !entry.isTool) {
						return { callId: call.callId, ok: false, error: "executeTool is only valid inside tool execution" };
					}
					const res = await (entry.ctx as ExtensionToolContext).executeTool(String(args[1]), args[2]);
					return { callId: call.callId, ok: true, value: toJsonSafe(res) };
				}
				case "ctx.mr.getApiKey": {
					const entry = contexts.get(Number(args[0]));
					const auth = await entry?.ctx.modelRegistry.getApiKeyAndHeaders(args[1] as Parameters<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>[0]);
					return { callId: call.callId, ok: true, value: auth?.ok ? auth.apiKey : undefined };
				}
				case "ctx.mr.getApiKeyAndHeaders": {
					const entry = contexts.get(Number(args[0]));
					const res = await entry?.ctx.modelRegistry.getApiKeyAndHeaders(args[1] as Parameters<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>[0]);
					return { callId: call.callId, ok: true, value: toJsonSafe(res) };
				}
				case "ctx.mr.getApiKeyForProvider": {
					const entry = contexts.get(Number(args[0]));
					const res = await entry?.ctx.modelRegistry.getApiKeyForProvider(String(args[1]));
					return { callId: call.callId, ok: true, value: res };
				}
				case "fs.readFile": {
					const content = await fs.promises.readFile(String(args[0]), "utf8");
					return { callId: call.callId, ok: true, value: content };
				}
				case "fs.writeFile": {
					await fs.promises.writeFile(String(args[0]), String(args[1] ?? ""), "utf8");
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.appendFile": {
					await fs.promises.appendFile(String(args[0]), String(args[1] ?? ""));
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.mkdir": {
					const mkdirOpts = (args[1] ?? {}) as { recursive?: boolean };
					if (mkdirOpts.recursive) {
						await fs.promises.mkdir(String(args[0]), { recursive: true });
					} else {
						await fs.promises.mkdir(String(args[0]));
					}
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.readdir": {
					const items = await fs.promises.readdir(String(args[0]));
					return { callId: call.callId, ok: true, value: items };
				}
				case "fs.stat": {
					const st = await fs.promises.stat(String(args[0]));
					return { callId: call.callId, ok: true, value: { size: st.size, isFile: st.isFile(), isDir: st.isDirectory(), mtimeMs: st.mtimeMs } };
				}
				case "fs.unlink": {
					await fs.promises.unlink(String(args[0]));
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.rm": {
					const rmTarget = String(args[0]);
					const rmOpts = (args[1] ?? {}) as { recursive?: boolean; force?: boolean };
					if (rmOpts.recursive && rmOpts.force) {
						await fs.promises.rm(rmTarget, { recursive: true, force: true });
					} else if (rmOpts.recursive) {
						await fs.promises.rm(rmTarget, { recursive: true });
					} else if (rmOpts.force) {
						await fs.promises.rm(rmTarget, { force: true });
					} else {
						await fs.promises.rm(rmTarget);
					}
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.rename": {
					await fs.promises.rename(String(args[0]), String(args[1]));
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.copyFile": {
					await fs.promises.copyFile(String(args[0]), String(args[1]));
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.realpath": {
					const rp = await fs.promises.realpath(String(args[0]));
					return { callId: call.callId, ok: true, value: rp };
				}
				case "fs.access": {
					await fs.promises.access(String(args[0]));
					return { callId: call.callId, ok: true, value: undefined };
				}
				case "fs.mkdtemp": {
					const dir = await fs.promises.mkdtemp(String(args[0]));
					return { callId: call.callId, ok: true, value: dir };
				}
				case "coding.execBuiltinTool": {
					const toolName = String(args[0]);
					const toolCwd = String(args[1] || cwd);
					const params = (args[3] ?? {}) as Record<string, unknown>;
					if (toolName === "bash" && typeof params.command === "string") {
						const res = await execCommand("sh", ["-c", params.command], toolCwd);
						return {
							callId: call.callId,
							ok: true,
							value: {
								content: [{ type: "text", text: [res.stdout, res.stderr].filter(Boolean).join("\n") }],
								details: { exitCode: res.code },
							},
						};
					}
					return { callId: call.callId, ok: false, error: `Built-in tool "${toolName}" stub is only supported for bash or via ctx.executeTool` };
				}
				default:
					return { callId: call.callId, ok: false, error: `Unknown host call: ${call.method}` };
			}
		} catch (err) {
			return {
				callId: call.callId,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	};

	const pumpTask = async (taskId: number, initialStep: JscStepResult, sourceLabel: string): Promise<unknown> => {
		let step = initialStep;
		let emptyMicrotaskTurns = 0;
		const MAX_STEPS = 10_000;

		for (let iter = 0; iter < MAX_STEPS; iter++) {
			if (!isVmAlive()) {
				throw new Error(`Extension VM for "${extensionPath}" has been disposed`);
			}
			if (step.ops && step.ops.length > 0) {
				applyOps(step.ops);
			}

			if (step.done && (!step.hostCalls || step.hostCalls.length === 0)) {
				if (!step.ok) {
					const err = new Error(step.error?.message ?? "Extension execution error");
					if (step.error?.stack) {
						err.stack = step.error.stack;
					}
					throw err;
				}
				return step.value;
			}

			if (step.hostCalls && step.hostCalls.length > 0) {
				emptyMicrotaskTurns = 0;
				const results = await Promise.all(step.hostCalls.map((c) => executeHostCall(c)));
				const freshState = buildStatePatch();
				step = evalJscJson<JscStepResult>(
					vmId,
					`globalThis.__piResolveCalls(${taskId}, ${JSON.stringify(results)}, ${JSON.stringify(freshState)})`,
					sourceLabel,
				);
				continue;
			}

			// JSC drains queued microtasks on exit of JSEvaluateScript; collect one step if Promise hasn't settled yet.
			emptyMicrotaskTurns++;
			if (emptyMicrotaskTurns > 64) {
				throw new Error("Extension async operation did not settle (unresolved Promise with no pending host calls)");
			}
			const prevTick = step.microtaskTick ?? 0;
			step = evalJscJson<JscStepResult>(
				vmId,
				`globalThis.__piCollectStep(${taskId})`,
				sourceLabel,
			);
			if (!step.done && (!step.hostCalls || step.hostCalls.length === 0) && (step.microtaskTick ?? 0) === prevTick && emptyMicrotaskTurns >= 4) {
				throw new Error("Extension async operation did not settle (unresolved Promise with no pending host calls)");
			}
		}

		throw new Error("Extension async pump exceeded maximum step limit");
	};

	const runAsyncFnCall = async (
		fnId: number,
		args: unknown[],
		extraContexts?: Record<string, unknown>,
	): Promise<unknown> => {
		if (!isVmAlive()) {
			throw new Error(`Extension VM for "${extensionPath}" has been disposed`);
		}
		const patch = buildStatePatch(extraContexts);
		const started = evalJscJson<{ taskId: number; step: JscStepResult }>(
			vmId,
			`globalThis.__piStartFnCall(${fnId}, ${JSON.stringify(args)}, ${JSON.stringify(patch)})`,
			`pi-ext-call:${path.basename(resolvedPath)}`,
		);
		return pumpTask(started.taskId, started.step, `pi-ext-pump:${path.basename(resolvedPath)}`);
	};

	try {
		evalJscRaw(vmId, buildJscBootstrapSource(), "pi-ext-bootstrap.js");

		const fsCache: Record<string, SeededFsEntry> = {};
		seedDirectoryTree(path.dirname(bundle.entry), fsCache);
		seedFsEntryForPath(cwd, fsCache);
		seedFsEntryForPath(path.join(cwd, CONFIG_DIR_NAME), fsCache);
		seedFsEntryForPath(getAgentDir(), fsCache);
		seedFsEntryForPath(path.join(getAgentDir(), "settings.json"), fsCache);

		const initialPatch = buildStatePatch();
		initialPatch.fsCache = fsCache;

		const bundlePayload = {
			extensionPath,
			entry: bundle.entry,
			modules: bundle.modules,
			jsonModules: bundle.jsonModules,
			specifierMap: bundle.specifierMap,
		};

		const started = evalJscJson<{ taskId: number; step: JscStepResult }>(
			vmId,
			`globalThis.__piLoadBundleAndRun(${JSON.stringify(bundlePayload)}, ${JSON.stringify(initialPatch)})`,
			resolvedPath,
		);
		await pumpTask(started.taskId, started.step, resolvedPath);
		commit();
		return extension;
	} catch (error) {
		vmDisposed = true;
		activeVmIds.delete(vmId);
		try {
			nativeJscDestroy(vmId);
		} catch {
			// Ignore VM cleanup errors
		}
		discard();
		throw error;
	}
}
