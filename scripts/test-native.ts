import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

import { expand } from "brace-expansion";
import chalk, { Chalk } from "chalk";
import { sync as crossSpawnSync } from "cross-spawn";
import { applyPatch, diffArrays, diffJson, diffLines, diffWords, structuredPatch } from "diff";
import { eastAsianWidth, eastAsianWidthType } from "get-east-asian-width";
import hljs from "highlight.js";
import { fromUrl as hostedGitFromUrl } from "hosted-git-info";
import ignore from "ignore";
import { diagramKind, render as renderMermaid } from "lovely-mermaid";
import { Marked, marked } from "marked";
import markedCjkFriendly from "marked-cjk-friendly";
import { Minimatch, minimatch } from "minimatch";
import { Allow, parseJSON } from "partial-json";
import { check as lockCheck, checkSync as lockCheckSync, lock, lockSync, unlock, unlockSync } from "proper-lockfile";
import {
	coerce as semverCoerce,
	gt as semverGt,
	lt as semverLt,
	parse as semverParse,
	Range,
	satisfies,
	valid as semverValid,
} from "semver";
import { Type } from "typebox";
import { Compile as TypeboxCompile } from "typebox/compile";
import YAML, { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from "yaml";
import { balanced } from "../vendor/brace-expansion/balanced-match.ts";

import {
	arr,
	bool,
	compile as compileSchema,
	equal as schemaEqual,
	int,
	type JsonSchema,
	lit,
	num,
	obj,
	opt,
	str,
	union,
} from "@pi-ts/schema";

import {
	Box,
	Button,
	colorToHex,
	DrawCommandWriter,
	darkGuiTheme,
	decodeA11yTree,
	decodeDrawCommands,
	encodeA11yTree,
	encodeMenuSpec,
	GuiApp,
	type GuiComponent,
	HeadlessBackend,
	HStack,
	Input,
	lightGuiTheme,
	matchesKeyEvent,
	oklchColor,
	parseKeyChord,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_FONT_REGULAR,
	ScrollView,
	Text,
	VirtualList,
	VStack,
} from "@pi-ts/gui";
import { createNativeBackend } from "@pi-ts/gui/native";

import { AnthropicHttpClient } from "../packages/ai/src/api/anthropic-http.ts";
import { getJsonSchemaToolParameters } from "../packages/ai/src/api/constrained-sampling.ts";
import { stripSchemaMetaKeys } from "../packages/ai/src/utils/json-schema.ts";
import { toToolDeclaration } from "../packages/ai/src/utils/transcript.ts";
import { validateToolArguments } from "../packages/ai/src/utils/validation.ts";
import {
	isNativeDarwinAvailable,
	nativeClipboardGetText,
	nativeClipboardSetText,
	nativeImageInspect,
	nativeImageTransform,
	nativeIsModifierPressed,
	nativeWordSegment,
} from "@pi-ts/ffi";
import {
	assumeRole,
	buildBedrockConverseStreamUrl,
	clearBedrockCredentialsCache,
	fetchSsoRoleCredentials,
	parseAwsIniFiles,
	parseAwsIniText,
	parseBedrockEventStream,
	parseStsCredentialsXml,
	resolveBedrockCredentials,
	resolveBedrockProfileRegion,
	resolveEc2ImdsV2Credentials,
	resolveEcsContainerCredentials,
	resolveSsoCachedToken,
	serializeBedrockPayload,
	signAwsSigV4,
} from "../packages/ai/src/api/bedrock-eventstream.ts";
import {
	buildMldevStreamUrl,
	buildVertexStreamUrl,
	clearVertexTokenCache,
	exchangeImpersonatedToken,
	GoogleGenAI,
	resolveExternalAccountToken,
	resolveVertexCredentialsObject,
	serializeGenerateContentRequest,
} from "../packages/ai/src/api/google-wire-types.ts";
import { createOpenAIClient, parseOpenAISSE } from "../packages/ai/src/api/openai-http.ts";

import {
	createAssistantMessageCard,
	createBannerCard,
	createToolExecutionCard,
	createUserMessageCard,
	createWelcomeCard,
	extractAssistantContent,
	extractToolOutputSnippet,
	formatCompactToolArgs,
	loadGuiLayoutPreferences,
	MockGuiSessionController,
	mountPiGui,
	saveGuiLayoutPreferences,
} from "../packages/coding-agent/src/modes/gui/index.ts";
import { parseArgs } from "../packages/coding-agent/src/cli/args.ts";
import { resolveAppMode } from "../packages/coding-agent/src/main.ts";
import {
	Box as TuiBox,
	CombinedAutocompleteProvider,
	Component,
	type ComponentLike,
	Container as TuiContainer,
	dispatchMouseEvent,
	Editor,
	FunctionalComponent,
	FunctionalEditorComponent,
	getNativeClipboard,
	getWordSegmenter,
	Input as TuiInput,
	isViewportTUI,
	Markdown as TuiMarkdown,
	matchesKey,
	MouseRegion,
	ProcessTerminal,
	type ProgramStatus,
	parseKey,
	SettingsList,
	setKeybindings,
	Spacer as TuiSpacer,
	type Terminal,
	Text as TuiText,
	toComponent,
	toEditorComponent,
	TUI,
	type TuiMouseEvent,
	VStack as TuiVStack,
} from "@pi-ts/tui";
import { KeybindingsManager } from "../packages/coding-agent/src/core/keybindings.ts";
import { createChatViewport } from "../packages/coding-agent/src/modes/interactive/chat-viewport.ts";
import { CustomEditor } from "../packages/coding-agent/src/modes/interactive/components/custom-editor.ts";
import { WorkingStatusIndicator } from "../packages/coding-agent/src/modes/interactive/components/status-indicator.ts";
import { ThinkingSelectorComponent } from "../packages/coding-agent/src/modes/interactive/components/thinking-selector.ts";
import {
	getEditorTheme,
	getMarkdownTheme,
	getSettingsListTheme,
	initTheme,
} from "../packages/coding-agent/src/modes/interactive/theme/theme.ts";
import { createInteractiveTui, createInteractiveTuiReference } from "../packages/coding-agent/src/modes/interactive/tui-renderer.ts";
import { createEventBus } from "../packages/coding-agent/src/core/event-bus.ts";
import { AuthStorage } from "../packages/coding-agent/src/core/auth-storage.ts";
import {
	clearExtensionCache,
	createExtensionRuntime,
	loadExtensions,
} from "../packages/coding-agent/src/core/extensions/loader.ts";
import { ExtensionRunner } from "../packages/coding-agent/src/core/extensions/runner.ts";
import { bundleExtensionEntry, stripTypeScriptTypes } from "../packages/coding-agent/src/core/extensions/ts-strip.ts";
import type { ExtensionToolContext } from "../packages/coding-agent/src/core/extensions/types.ts";
import { ModelRegistry } from "../packages/coding-agent/src/core/model-registry.ts";
import { ModelRuntime } from "../packages/coding-agent/src/core/model-runtime.ts";
import { SessionManager } from "../packages/coding-agent/src/core/session-manager.ts";
import { executeCodemode, parseCodemodeOptions } from "../packages/coding-agent/src/extensions/codemode/execute.ts";
import { createCodemodeExtension } from "../packages/coding-agent/src/extensions/codemode/index.ts";
import { codemodeRenderers } from "../packages/coding-agent/src/extensions/codemode/renderer.ts";
import { runCodemodeSandbox } from "../packages/coding-agent/src/extensions/codemode/sandbox.ts";
import {
	CODEMODE_TOOL_NAME,
	createCodemodeDescription,
	createCodemodeTool,
} from "../packages/coding-agent/src/extensions/codemode/tool.ts";
import { ToolExecutionComponent } from "../packages/coding-agent/src/modes/interactive/components/tool-execution.ts";
import { copyToClipboard, readClipboardFilePaths, readClipboardText } from "../packages/coding-agent/src/utils/clipboard.ts";
import { readClipboardImage } from "../packages/coding-agent/src/utils/clipboard-image.ts";
import {
	convertImageBytesToPng,
	convertToPng,
	encodePngBytesSync,
	loadPngTranscoder,
} from "../packages/coding-agent/src/utils/image-convert.ts";
import {
	getExifOrientation,
	parseImageDimensions,
	stripPngOrientationChunks,
} from "../packages/coding-agent/src/utils/image-dimensions.ts";
import { formatDimensionNote, resizeImage } from "../packages/coding-agent/src/utils/image-resize.ts";
import { loadPhoton } from "../packages/coding-agent/src/utils/photon.ts";
import {
	getHighlightLanguageCount,
	highlight,
	loadAllHighlightLanguages,
	supportsLanguage,
} from "../packages/coding-agent/src/utils/syntax-highlight.ts";
import { renderLayoutFrame } from "../packages/tui/src/layout.ts";
import { getNativePlatformHelper } from "../packages/tui/src/native-platform.ts";
import { findWordBackward } from "../packages/tui/src/word-navigation.ts";

class MemoryTerminal implements Terminal {
	writes: string[] = [];
	started = false;
	stopped = false;
	onInput?: (data: string) => void;
	onResize?: () => void;

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.started = true;
		this.stopped = false;
		this.onInput = onInput;
		this.onResize = onResize;
	}

	stop(): void {
		this.stopped = true;
		this.onInput = undefined;
		this.onResize = undefined;
	}

	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

	write(data: string): void {
		this.writes.push(data);
	}

	get columns(): number {
		return 80;
	}

	get rows(): number {
		return 24;
	}

	get kittyProtocolActive(): boolean {
		return false;
	}

	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	setProgress(_active: boolean): void {}
	setProgramStatus(_status: ProgramStatus): void {}
}

interface TestResult {
	name: string;
	ok: boolean;
	error?: string;
}

function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEqual<T extends string | number | boolean | null | undefined>(
	actual: T,
	expected: T,
	message: string,
): void {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
	}
}

function getRequestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i += 1) {
		crc ^= bytes[i] ?? 0;
		for (let b = 0; b < 8; b += 1) {
			const mask = -(crc & 1);
			crc = (crc >>> 1) ^ (0xedb88320 & mask);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function encodeEventStreamStringHeader(name: string, value: string): Uint8Array {
	const enc = new TextEncoder();
	const nameBytes = enc.encode(name);
	const valueBytes = enc.encode(value);
	const out = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
	let offset = 0;
	out[offset++] = nameBytes.length;
	out.set(nameBytes, offset);
	offset += nameBytes.length;
	out[offset++] = 7; // string header type
	const view = new DataView(out.buffer);
	view.setUint16(offset, valueBytes.length, false);
	offset += 2;
	out.set(valueBytes, offset);
	return out;
}

function encodeEventStreamFrame(eventType: string, payloadJson: string): Uint8Array {
	const enc = new TextEncoder();
	const h1 = encodeEventStreamStringHeader(":message-type", "event");
	const h2 = encodeEventStreamStringHeader(":event-type", eventType);
	const h3 = encodeEventStreamStringHeader(":content-type", "application/json");
	const headersLen = h1.length + h2.length + h3.length;
	const payload = enc.encode(payloadJson);
	const totalLen = 12 + headersLen + payload.length + 4;

	const frame = new Uint8Array(totalLen);
	const view = new DataView(frame.buffer);
	view.setUint32(0, totalLen, false);
	view.setUint32(4, headersLen, false);
	view.setUint32(8, crc32(frame.subarray(0, 8)), false);

	let offset = 12;
	frame.set(h1, offset);
	offset += h1.length;
	frame.set(h2, offset);
	offset += h2.length;
	frame.set(h3, offset);
	offset += h3.length;
	frame.set(payload, offset);
	offset += payload.length;

	view.setUint32(offset, crc32(frame.subarray(0, offset)), false);
	return frame;
}

function buildSseResponse(chunks: readonly string[]): Response {
	const enc = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(enc.encode(chunk));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function buildBinaryResponse(chunks: readonly Uint8Array[]): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "content-type": "application/vnd.amazon.eventstream" },
	});
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length, false);
	for (let i = 0; i < 4; i++) {
		out[4 + i] = type.charCodeAt(i);
	}
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
	return out;
}

function makeSolidPng(width: number, height: number, r = 40, g = 140, b = 220, a = 255): Uint8Array {
	const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = new Uint8Array(13);
	const ihdrView = new DataView(ihdr.buffer);
	ihdrView.setUint32(0, width, false);
	ihdrView.setUint32(4, height, false);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA color type

	const stride = 1 + width * 4;
	const raw = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const rowStart = y * stride;
		raw[rowStart] = 0; // filter: None
		for (let x = 0; x < width; x++) {
			const px = rowStart + 1 + x * 4;
			raw[px] = r;
			raw[px + 1] = g;
			raw[px + 2] = b;
			raw[px + 3] = a;
		}
	}
	const compressed = new Uint8Array(deflateSync(raw));
	const chunks = [sig, makePngChunk("IHDR", ihdr), makePngChunk("IDAT", compressed), makePngChunk("IEND", new Uint8Array(0))];
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

function makeSolidBmp2x2(): Uint8Array {
	// 14-byte file header + 40-byte BITMAPINFOHEADER + 2 rows of (2 * 3 + 2 pad) = 70 bytes
	const out = new Uint8Array(70);
	const view = new DataView(out.buffer);
	out[0] = 0x42; // 'B'
	out[1] = 0x4d; // 'M'
	view.setUint32(2, out.length, true);
	view.setUint32(10, 54, true); // pixel data offset
	view.setUint32(14, 40, true); // DIB header size
	view.setInt32(18, 2, true); // width
	view.setInt32(22, 2, true); // height (positive = bottom-up)
	view.setUint16(26, 1, true); // planes
	view.setUint16(28, 24, true); // bpp
	view.setUint32(34, 16, true); // image size
	for (let row = 0; row < 2; row++) {
		const base = 54 + row * 8;
		out[base] = 200;
		out[base + 1] = 100;
		out[base + 2] = 50;
		out[base + 3] = 200;
		out[base + 4] = 100;
		out[base + 5] = 50;
	}
	return out;
}

function injectExifOrientation6(jpegBytes: Uint8Array): Uint8Array {
	if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
		throw new Error("Expected JPEG SOI header");
	}
	// APP1 marker + length(34) + "Exif\0\0" + little-endian TIFF IFD0 with tag 0x0112 = 6
	const app1 = new Uint8Array([
		0xff, 0xe1, 0x00, 0x22,
		0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
		0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
		0x01, 0x00,
		0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00,
	]);
	const out = new Uint8Array(2 + app1.length + (jpegBytes.length - 2));
	out[0] = 0xff;
	out[1] = 0xd8;
	out.set(app1, 2);
	out.set(jpegBytes.subarray(2), 2 + app1.length);
	return out;
}

function findRepoRoot(): string {
	let dir = resolve(process.cwd());
	for (let i = 0; i < 8; i++) {
		if (existsSync(join(dir, "packages/coding-agent/examples/extensions/hello.ts"))) {
			return dir;
		}
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`Could not locate repo root starting from ${process.cwd()}`);
}

function makeMockFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof globalThis.fetch {
	const fn: typeof globalThis.fetch = async (input, init) => handler(getRequestUrl(input), init);
	return fn;
}

function createMockExtensionToolContext(
	cwd: string,
	tools: ExtensionToolContext["tools"] = [],
	executeImpl?: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }>,
): ExtensionToolContext {
	return {
		hasUI: false,
		mode: "print",
		cwd,
		model: undefined,
		scopedModels: [],
		thinkingLevel: "off",
		signal: undefined,
		isIdle: () => true,
		isProjectTrusted: () => true,
		hasPendingMessages: () => false,
		abort: () => {},
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
		tools,
		async executeTool(name: string, args: unknown) {
			const rec = (args && typeof args === "object" && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
			const result = executeImpl
				? await executeImpl(name, rec)
				: { content: [{ type: "text" as const, text: "" }], details: {} };
			return {
				toolCall: { type: "toolCall" as const, id: "mock-tc-1", name, arguments: rec },
				result,
				isError: false,
				durationMs: 1,
			};
		},
	} as unknown as ExtensionToolContext;
}

const results: TestResult[] = [];

async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		results.push({ name, ok: false, error: msg });
	}
}

async function main(): Promise<void> {
	// 1. vendor/brace-expansion + balanced-match
	await runCase("vendor:brace-expansion+balanced-match", () => {
		const expanded = expand("a/{b,c}/{1..2}");
		assertEqual(expanded.join(","), "a/b/1,a/b/2,a/c/1,a/c/2", "brace-expansion mismatch");
		const m = balanced("{", "}", "x{y{z}}w");
		assert(m !== false && m !== undefined && m.body === "y{z}", "balanced-match body mismatch");
	});

	// 2. vendor/chalk
	await runCase("vendor:chalk", () => {
		const custom = new Chalk({ level: 3 });
		const red = custom.red("err");
		const bold = chalk.bold("ok");
		assert(red.includes("err") && red.includes("\x1b["), "Chalk(level:3) failed");
		assert(bold.includes("ok"), "default chalk failed");
	});

	// 3. vendor/cross-spawn
	await runCase("vendor:cross-spawn", () => {
		const res = crossSpawnSync("/bin/echo", ["pi-ts-spawn"], { encoding: "utf8" });
		assertEqual(res.status, 0, "cross-spawn status");
		assert(res.stdout.trim() === "pi-ts-spawn", `unexpected stdout: ${res.stdout}`);
	});

	// 4. vendor/diff
	await runCase("vendor:diff", () => {
		const lines = diffLines("a\nb\n", "a\nc\n");
		assert(lines.some((p) => p.added && p.value.includes("c")), "diffLines missing added line");
		const words = diffWords("hello world", "hello native");
		assert(words.some((p) => p.removed && p.value.includes("world")), "diffWords missing removal");
		const jsonParts = diffJson({ a: 1, b: 2 }, { a: 1, b: 3 });
		assert(jsonParts.some((p) => p.added && p.value.includes("3")), "diffJson failed");
		const arrParts = diffArrays([1, 2], [1, 3]);
		assert(arrParts.length > 0, "diffArrays empty");
		const patch = structuredPatch("a.txt", "a.txt", "line1\nline2\n", "line1\nline3\n");
		const patched = applyPatch("line1\nline2\n", patch);
		assertEqual(patched, "line1\nline3\n", "applyPatch mismatch");
	});

	// 5. vendor/get-east-asian-width
	await runCase("vendor:get-east-asian-width", () => {
		assertEqual(eastAsianWidth(0x41), 1, "ASCII width should be 1");
		assertEqual(eastAsianWidth(0x4e2d), 2, "CJK char width should be 2");
		assertEqual(eastAsianWidthType(0x4e2d), "wide", "CJK width type mismatch");
	});

	// 6. vendor/highlight-js
	await runCase("vendor:highlight.js", () => {
		const highlighted = hljs.highlight("const count: number = 42;", { language: "typescript" });
		assert(highlighted.value.includes("hljs-"), "highlight.js missing span class");
	});

	// 7. vendor/hosted-git-info
	await runCase("vendor:hosted-git-info", () => {
		const info = hostedGitFromUrl("https://github.com/keejkrej/pi-ts.git");
		assert(info !== undefined, "hosted-git-info returned undefined");
		if (info) {
			assertEqual(info.user, "keejkrej", "hosted-git-info user");
			assertEqual(info.project, "pi-ts", "hosted-git-info project");
		}
	});

	// 8. vendor/ignore
	await runCase("vendor:ignore", () => {
		const ig = ignore().add(["*.log", "dist/", "!keep.log"]);
		assert(ig.ignores("debug.log"), "ignore should match *.log");
		assert(!ig.ignores("keep.log"), "ignore should allow !keep.log");
		assertEqual(ignore.isPathValid("src/index.ts"), true, "ignore.isPathValid");
		assertEqual(ig.filter(["src/a.ts", "dist/bin", "app.log"]).join(","), "src/a.ts", "ignore.filter");
	});

	// 9. vendor/lovely-mermaid
	await runCase("vendor:lovely-mermaid", () => {
		const src = "flowchart TD\nA[Start] --> B[Done]\n";
		assertEqual(diagramKind(src), "flowchart", "diagramKind mismatch");
		const rendered = renderMermaid(src);
		assert(rendered !== null && rendered.plain.join("\n").includes("Start") && rendered.width > 0, "lovely-mermaid render failed");
	});

	// 10. vendor/marked + 11. vendor/marked-cjk-friendly
	await runCase("vendor:marked+marked-cjk-friendly", () => {
		const markedInst = new Marked();
		const tokens = markedInst.lexer("# Title\n\n- [x] task\n");
		const html = markedInst.parser(tokens);
		assert(html.includes("<h1>Title</h1>"), "marked HTML missing h1");
		const directHtml = marked("# Heading", { async: false });
		assert(directHtml.includes("<h1>Heading</h1>"), "marked() helper missing h1");

		const cjkMarked = new Marked().use(markedCjkFriendly());
		const cjkHtml = cjkMarked.parse("**中文(test)**你好", { async: false });
		assert(cjkHtml.includes("<strong>"), "marked-cjk-friendly failed");
	});

	// 12. vendor/minimatch
	await runCase("vendor:minimatch", () => {
		assert(minimatch("packages/gui/src/gui.ts", "packages/**/*.ts"), "minimatch failed");
		const mm = new Minimatch("*.md");
		assert(mm.match("README.md") && !mm.match("README.txt"), "Minimatch failed");
	});

	// 13. vendor/partial-json
	await runCase("vendor:partial-json", () => {
		const parsed = parseJSON('{"tool":"read","args":{"path":"package.js', Allow.ALL) as {
			tool?: string;
			args?: { path?: string };
		};
		assertEqual(parsed.tool, "read", "partial-json tool");
		assertEqual(parsed.args?.path, "package.js", "partial-json partial string");
	});

	// 14. vendor/proper-lockfile
	await runCase("vendor:proper-lockfile", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-ts-lock-"));
		const target = join(dir, "state.json");
		writeFileSync(target, "{}\n", "utf8");
		try {
			const releaseSync = lockSync(target, { realpath: false });
			assertEqual(lockCheckSync(target, { realpath: false }), true, "lockCheckSync should be true");
			releaseSync();
			assertEqual(lockCheckSync(target, { realpath: false }), false, "lockCheckSync should be false after release");

			const releaseAsync = await lock(target, { realpath: false });
			assertEqual(await lockCheck(target, { realpath: false }), true, "async lockCheck should be true");
			await releaseAsync();
			assertEqual(await lockCheck(target, { realpath: false }), false, "async lockCheck false after unlock");

			lockSync(target, { realpath: false });
			unlockSync(target, { realpath: false });
			await lock(target, { realpath: false });
			await unlock(target, { realpath: false });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// 15. vendor/semver
	await runCase("vendor:semver", () => {
		assertEqual(semverValid("1.2.3-beta.1"), "1.2.3-beta.1", "semverValid");
		assert(semverGt("2.0.0", "1.9.9") && semverLt("1.0.0", "1.0.1"), "semverGt/Lt");
		assert(satisfies("1.4.2", "^1.2.0"), "satisfies failed");
		const range = new Range(">=1.0.0 <2.0.0");
		const parsed = semverParse("1.5.0");
		assert(parsed !== null && range.test(parsed), "semver Range test failed");
		assertEqual(semverCoerce("v4.2")?.version, "4.2.0", "semverCoerce failed");
	});

	// 16. vendor/typebox + typebox/compile
	await runCase("vendor:typebox+compile", () => {
		const UserSchema = Type.Object({
			name: Type.String({ minLength: 1 }),
			count: Type.Number(),
		});
		const validator = TypeboxCompile(UserSchema);
		assertEqual(validator.Check({ name: "pi", count: 3 }), true, "typebox Check valid");
		assertEqual(validator.Check({ name: "", count: 3 }), false, "typebox Check invalid");
		const errors = [...validator.Errors({ name: "", count: "bad" })];
		assert(errors.length > 0, "typebox Errors should be non-empty");
		const parsed = validator.Parse({ name: "pi", count: 7 }) as { name: string; count: number };
		assertEqual(parsed.name, "pi", "typebox Parse failed");

		const ToolParamSchema = Type.Object({
			path: Type.String({ description: "file path" }),
			offset: Type.Optional(Type.Number()),
			ro: Type.Readonly(Type.Boolean()),
			roOpt: Type.ReadonlyOptional(Type.String()),
		});
		const paramReq = ToolParamSchema.required ?? [];
		assertEqual(paramReq.join(","), "path,ro", "typebox optional/readonly required fields");
		const allOptional = Type.Object({
			a: Type.Optional(Type.String()),
			b: Type.ReadonlyOptional(Type.Number()),
		});
		assertEqual(allOptional.required === undefined, true, "typebox all-optional object should have no required");
		const rec = Type.Record(Type.Union([Type.Literal("x"), Type.Literal("y")]), Type.Number());
		const recReq = (rec as { required?: readonly string[] }).required ?? [];
		assertEqual(recReq.join(","), "x,y", "typebox Record union literal keys");

		const strippedJson = JSON.stringify(stripSchemaMetaKeys(ToolParamSchema));
		assert(!strippedJson.includes("~kind"), "stripped schema must not include ~kind");
		assert(!strippedJson.includes("~optional"), "stripped schema must not include ~optional");
		assert(!strippedJson.includes("~readonly"), "stripped schema must not include ~readonly");

		const toolDecl = toToolDeclaration({
			name: "read",
			description: "Read file",
			parameters: ToolParamSchema,
		});
		const declJson = JSON.stringify(toolDecl.parameters);
		assert(!declJson.includes("~kind"), "toToolDeclaration must not include ~kind");
		assert(!declJson.includes("~optional"), "toToolDeclaration must not include ~optional");

		const apiParamsJson = JSON.stringify(getJsonSchemaToolParameters(toolDecl, undefined));
		assert(!apiParamsJson.includes("~kind"), "getJsonSchemaToolParameters must not include ~kind");
		assert(apiParamsJson.includes('"required":["path","ro"]'), "API parameters must keep required");

		const rawReadTool = {
			name: "read",
			description: "Read file",
			parameters: Type.Object({
				path: Type.String(),
				offset: Type.Optional(Type.Number()),
				limit: Type.Optional(Type.Number()),
			}),
		};
		const validated = validateToolArguments(rawReadTool, {
			type: "toolCall",
			id: "call_1",
			name: "read",
			arguments: { path: "package.json", offset: "1", limit: 5 },
		}) as { path: string; offset?: number; limit?: number };
		assertEqual(validated.path, "package.json", "validateToolArguments path");
		assertEqual(validated.offset, 1, "validateToolArguments coerced offset");
	});

	// 17. vendor/yaml
	await runCase("vendor:yaml", () => {
		const objVal = parseYaml("name: pi-ts\nitems:\n  - a\n  - b\n") as {
			name: string;
			items: string[];
		};
		assertEqual(objVal.name, "pi-ts", "yaml.parse name");
		assertEqual(objVal.items.length, 2, "yaml.parse items length");
		const dumped = stringifyYaml(objVal);
		assert(dumped.includes("pi-ts"), "yaml.stringify failed");
		const parsedViaDefault = YAML.parse("k: 1") as { k: number };
		assertEqual(parsedViaDefault.k, 1, "YAML.parse failed");
		assert(YAML.stringify({ k: 1 }).includes("k: 1"), "YAML.stringify failed");
		let caught = false;
		try {
			parseYaml("bad: [unterminated");
		} catch (e) {
			caught = e instanceof YAMLParseError;
		}
		assert(caught, "YAMLParseError should be thrown on malformed input");
	});

	// 18. @pi-ts/schema
	await runCase("package:pi-schema", () => {
		const ItemSchema = obj({
			id: str(),
			kind: union([lit("alpha"), lit("beta")]),
			count: int(),
			ratio: opt(num()),
			enabled: bool(),
			tags: arr(str()),
		});
		const validator = compileSchema(ItemSchema as JsonSchema);
		const validItem = { id: "x", kind: "alpha", count: 2, enabled: true, tags: ["fast"] };
		assertEqual(validator.check(validItem), true, "pi-schema check valid");
		assertEqual(validator.check({ id: 123 }), false, "pi-schema check invalid");
		assert(validator.errors({ id: 123 }).length > 0, "pi-schema errors missing");

		const coercer = compileSchema(ItemSchema as JsonSchema, { coerce: true });
		const coerced = coercer.parse({
			id: "y",
			kind: "beta",
			count: "5",
			ratio: "1.5",
			enabled: "true",
			tags: ["z"],
		});
		assert(coerced.ok, "pi-schema coerce parse failed");
		if (coerced.ok) {
			const val = coerced.value as { count?: unknown; enabled?: unknown };
			assertEqual(val.count === 5, true, "pi-schema coerce count");
			assertEqual(val.enabled === true, true, "pi-schema coerce enabled");
		}
		assertEqual(schemaEqual({ a: [1, 2] }, { a: [1, 2] }), true, "pi-schema equal");
	});

	// 19. @pi-ts/gui + packages/coding-agent/src/modes/gui
	await runCase("package:@pi-ts/gui+coding-agent-gui", async () => {
		const nativeBackend = createNativeBackend("darwin");
		assert(typeof nativeBackend.windowAction === "function", "createNativeBackend missing windowAction");

		const accent = oklchColor(0.68, 0.16, 250);
		const hex = colorToHex(accent);
		assert(hex.startsWith("#") && hex.length >= 7, `unexpected colorToHex: ${hex}`);

		const chord = parseKeyChord("mod+k", "darwin");
		assert(chord !== undefined, "parseKeyChord failed");
		assert(
			matchesKeyEvent(
				{
					phase: "down",
					keyCode: 0,
					key: "k",
					modifiers: { shift: false, ctrl: false, alt: false, super: true },
				},
				"mod+k",
				"darwin",
			),
			"matchesKeyEvent failed",
		);

		const writer = new DrawCommandWriter();
		writer.clear(0xff101218);
		writer.fillRect(0, 0, 120, 32, 6, 0xff224488);
		const drawCmds = decodeDrawCommands(writer.toUint8Array());
		assertEqual(drawCmds.length, 2, "decodeDrawCommands length");

		const a11yBytes = encodeA11yTree([
			{
				id: 1,
				role: "button",
				stateFlags: SGUI_A11Y_STATE_ENABLED,
				label: "Send",
				value: "",
				rect: { x: 0, y: 0, width: 80, height: 28 },
			},
		]);
		const a11yDecoded = decodeA11yTree(a11yBytes);
		assertEqual(a11yDecoded.length, 1, "decodeA11yTree length");
		const encodedMenus = encodeMenuSpec([{ title: "File", items: [{ kind: "action", label: "New", onSelect: () => {} }] }]);
		assert(encodedMenus.bytes.byteLength > 0, "encodeMenuSpec empty");

		const btn = new Button({ label: "Run", onClick: () => {} });
		const inp = new Input({ placeholder: "Type..." });
		const row = new HStack({
			gap: 6,
			children: [btn, inp],
		});
		const box = new Box({
			padding: 8,
			child: new Text({ text: "Sample", fontFamily: SGUI_FONT_REGULAR, fontSize: 13 }),
		});
		const vlist = new VirtualList<string>({
			items: ["one", "two"],
			estimatedItemHeight: 24,
			renderItem: (item) => new Text(item),
		});
		const guiVlist: GuiComponent = vlist;
		guiVlist.setParent(undefined);
		const scroll = new ScrollView({ child: new Text("Scrollable") });
		const cardColumn = new VStack({
			gap: 8,
			children: [row, box, vlist, scroll],
		});
		assert(cardColumn !== null && colorToHex(lightGuiTheme.text).startsWith("#"), "layout widgets check");

		const status = {
			cwd: "/tmp/pi-ts",
			thinkingLevel: "medium" as const,
			availableThinkingLevels: ["off", "low", "medium", "high"] as const,
			isStreaming: false,
			authSummary: {
				statusLabel: "Anthropic ready",
				providerAuthCount: 1,
				hasActiveAuth: true,
				activeAuthLabel: "api_key",
			},
		};
		const welcome = createWelcomeCard(darkGuiTheme, status);
		const userCard = createUserMessageCard(darkGuiTheme, "Hello GUI");
		const assistantCard = createAssistantMessageCard(darkGuiTheme);
		const toolCard = createToolExecutionCard(darkGuiTheme, "read", formatCompactToolArgs({ path: "package.json" }));
		const bannerCard = createBannerCard(darkGuiTheme, "Notice", "Running native checks", "notice");
		assert(
			welcome.root !== undefined &&
				userCard !== undefined &&
				assistantCard.root !== undefined &&
				toolCard.root !== undefined &&
				bannerCard !== undefined,
			"GUI card factories returned empty",
		);
		assert(
			extractToolOutputSnippet({ content: [{ type: "text", text: "line 1" }] }).includes("line 1"),
			"extractToolOutputSnippet",
		);
		const extracted = extractAssistantContent({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		assertEqual(extracted.text, "ok", "extractAssistantContent failed");

		const backend = new HeadlessBackend({ width: 1024, height: 720 });
		const app = new GuiApp({
			backend,
			theme: darkGuiTheme,
			window: { title: "pi-ts-test", width: 1024, height: 720 },
			frameIntervalMs: 8,
		});
		const controller = new MockGuiSessionController({
			cwd: "/tmp/pi-ts",
			stepDelayMs: 1,
			scenario: "with-tool",
		});
		const handle = mountPiGui(app, { controller });
		try {
			app.renderFrame();
			handle.editor.setText("ping");
			assertEqual(handle.hasActiveOverlay(), false, "overlay should initially be closed");
			assert(backend.getRenderedTexts().length > 0, "HeadlessBackend should capture rendered text");
		} finally {
			await handle.dispose();
			app.dispose();
		}
	});

	// 20. packages/ai: anthropic-http
	await runCase("ai:anthropic-http", async () => {
		let capturedUrl = "";
		const mockFetch: typeof fetch = async (input) => {
			capturedUrl = getRequestUrl(input);
			return buildSseResponse([
				'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			]);
		};
		const client = new AnthropicHttpClient({
			apiKey: "test-key",
			baseURL: "https://api.example.test",
			fetch: mockFetch,
		});
		const resp = await client.beta.messages
			.create({
				model: "claude-test",
				max_tokens: 64,
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			})
			.asResponse();
		assertEqual(resp.status, 200, "anthropic mock status");
		assert(capturedUrl.includes("/v1/messages"), `unexpected anthropic URL: ${capturedUrl}`);
		const text = await resp.text();
		assert(text.includes("message_stop"), "anthropic SSE payload mismatch");
	});

	// 21. packages/ai: openai-http
	await runCase("ai:openai-http", async () => {
		const mockFetch: typeof fetch = async (input, init) => {
			const url = getRequestUrl(input);
			const bodyText = typeof init?.body === "string" ? init.body : "";
			if (url.endsWith("/responses")) {
				return buildSseResponse([
					'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\n\n',
					"data: [DONE]\n\n",
				]);
			}
			if (bodyText.includes('"stream":false')) {
				return new Response(
					JSON.stringify({
						id: "chat_1",
						object: "chat.completion",
						created: 1,
						model: "gpt-test",
						choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return buildSseResponse([
				'data: {"id":"chat_2","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
				"data: [DONE]\n\n",
			]);
		};
		const client = createOpenAIClient({
			apiKey: "test-key",
			baseURL: "https://api.example.test/v1",
			fetch: mockFetch,
		});

		const { data: respEvents, response: respHttp } = await client.responses
			.create({
				model: "gpt-test",
				input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
				stream: true,
			})
			.withResponse();
		assertEqual(respHttp.status, 200, "openai responses status");
		const sseRespEvents: unknown[] = [];
		for await (const ev of respEvents) {
			sseRespEvents.push(ev);
		}
		assert(sseRespEvents.length >= 1, "openai responses SSE yielded no events");

		const { data: chatStream } = await client.chat.completions
			.create({
				model: "gpt-test",
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			})
			.withResponse();
		const chatChunks: unknown[] = [];
		for await (const ch of chatStream) {
			chatChunks.push(ch);
		}
		assertEqual(chatChunks.length, 1, "openai chat SSE chunk count");

		const { data: nonStream } = await client.chat.completions
			.createNonStreaming({
				model: "gpt-test",
				messages: [{ role: "user", content: "ping" }],
				stream: false,
			})
			.withResponse();
		const nonStreamContent = nonStream.choices[0]?.message?.content;
		assert(typeof nonStreamContent === "string", "openai non-streaming content is not string");
		if (typeof nonStreamContent === "string") {
			assertEqual(nonStreamContent, "pong", "openai non-streaming content mismatch");
		}

		const directSse: unknown[] = [];
		for await (const item of parseOpenAISSE(
			buildSseResponse(['data: {"type":"delta","text":"ok"}\n\n', "data: [DONE]\n\n"]),
		)) {
			directSse.push(item);
		}
		assertEqual(directSse.length, 1, "parseOpenAISSE count mismatch");
	});

	// 22. packages/ai: google-wire-types
	await runCase("ai:google-wire-types", async () => {
		const mldevUrl = buildMldevStreamUrl(
			"gemini-2.5-flash",
			{ baseUrl: "https://generativelanguage.googleapis.com" },
			"v1beta",
		);
		const vertexUrl = buildVertexStreamUrl(
			"gemini-2.5-flash",
			{ baseUrl: "https://us-central1-aiplatform.googleapis.com" },
			"v1beta1",
			"proj",
			"us-central1",
		);
		assert(mldevUrl.includes(":streamGenerateContent"), "mldev URL mismatch");
		assert(vertexUrl.includes("proj") && vertexUrl.includes(":streamGenerateContent"), "vertex URL mismatch");

		const serialized = JSON.stringify(
			serializeGenerateContentRequest({
				model: "gemini-2.5-flash",
				contents: [{ role: "user", parts: [{ text: "hello" }] }],
			}),
		);
		assert(serialized.includes("hello"), "serializeGenerateContentRequest failed");

		const mockFetch: typeof fetch = async () =>
			buildSseResponse([
				'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"gemini-ok"}]},"finishReason":"STOP"}]}\n\n',
			]);
		const ai = new GoogleGenAI({
			apiKey: "test-key",
			httpOptions: { fetch: mockFetch },
		});
		const stream = await ai.models.generateContentStream({
			model: "gemini-2.5-flash",
			contents: [{ role: "user", parts: [{ text: "hello" }] }],
		});
		let seenText = "";
		for await (const chunk of stream) {
			const partText = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
			if (typeof partText === "string") {
				seenText += partText;
			}
		}
		assertEqual(seenText, "gemini-ok", "GoogleGenAI stream text mismatch");
	});

	// 23. packages/ai: bedrock-eventstream
	await runCase("ai:bedrock-eventstream", async () => {
		const url = buildBedrockConverseStreamUrl(
			"https://bedrock-runtime.us-east-1.amazonaws.com",
			"anthropic.claude-3-5-sonnet",
		);
		assert(url.href.includes("converse-stream"), `unexpected bedrock URL: ${url.href}`);

		const payload = serializeBedrockPayload({
			modelId: "anthropic.claude-3-5-sonnet",
			messages: [{ role: "user", content: [{ text: "hi bedrock" }] }],
		});
		assert(payload.includes("hi bedrock"), "serializeBedrockPayload failed");

		const signedHeaders = await signAwsSigV4({
			method: "POST",
			url,
			headers: { "content-type": "application/json" },
			body: new TextEncoder().encode(payload),
			region: "us-east-1",
			service: "bedrock",
			credentials: {
				accessKeyId: "AKIAEXAMPLEKEY000001",
				secretAccessKey: "examplesecretkey000000000000000000000000",
			},
			now: new Date("2026-11-15T00:00:00Z"),
		});
		assert(
			typeof signedHeaders.authorization === "string" && signedHeaders.authorization.includes("AWS4-HMAC-SHA256"),
			"SigV4 authorization header missing",
		);

		const frame = encodeEventStreamFrame(
			"contentBlockDelta",
			'{"contentBlockIndex":0,"delta":{"text":"bedrock-ok"}}',
		);
		const decodedEvents: string[] = [];
		for await (const ev of parseBedrockEventStream(buildBinaryResponse([frame]))) {
			if (ev.contentBlockDelta?.delta?.text) {
				decodedEvents.push(ev.contentBlockDelta.delta.text);
			}
		}
		assertEqual(decodedEvents.join(""), "bedrock-ok", "parseBedrockEventStream text mismatch");
	});

	await runCase("tui:interactive-regression", async () => {
		const testDir = mkdtempSync(join(tmpdir(), "pi-ts-tui-test-"));
		const termMain = new MemoryTerminal();
		const termAlt = new MemoryTerminal();
		const mainTui = createInteractiveTui({
			tuiMode: "regular",
			terminal: termMain,
			showHardwareCursor: false,
			logDirectory: testDir,
		});
		const altTui = createInteractiveTui({
			tuiMode: "fullscreen",
			terminal: termAlt,
			showHardwareCursor: false,
			logDirectory: testDir,
		});
		let currentRenderer: TUI = mainTui;
		const uiRef = createInteractiveTuiReference(() => currentRenderer);
		let statusIndicator: WorkingStatusIndicator | undefined;
		try {
			assert(uiRef instanceof TUI && uiRef instanceof TuiContainer && uiRef instanceof Component, "uiRef class hierarchy broken");
			assertEqual(isViewportTUI(mainTui), false, "mainTui isViewportTUI");
			assertEqual(isViewportTUI(altTui), true, "altTui isViewportTUI");
			assertEqual(isViewportTUI(uiRef), false, "uiRef should track mainTui initially");

			const capturedRender = (width: number) => uiRef.render(width);
			const capturedRequestRender = (force?: boolean) => uiRef.requestRender(force);

			const kb = KeybindingsManager.create(testDir);
			setKeybindings(kb);
			initTheme("dark", false);
			const baseEditor = new Editor(uiRef, getEditorTheme(), { paddingX: 2 });
			const baseInitPad = baseEditor.getPaddingX();
			baseEditor.setPaddingX(1);
			const baseAfterPad = baseEditor.getPaddingX();

			const editor = new CustomEditor(uiRef, getEditorTheme(), kb, {
				paddingX: 2,
				autocompleteMaxVisible: 5,
				embedWorkingStatus: true,
			});
			const ceInitPad = editor.getPaddingX();
			// Regression for #104 crash: setPaddingX / actionHandlers / borderColor / onSubmit
			editor.setPaddingX(1);
			const ceAfterPad = editor.getPaddingX();
			const ceInitMax = editor.getAutocompleteMaxVisible();
			editor.setAutocompleteMaxVisible(6);
			const ceAfterMax = editor.getAutocompleteMaxVisible();
			editor.setText("probe");
			const ceText = editor.getText();
			editor.setText("");
			assertEqual(baseInitPad, 2, "Editor init paddingX");
			assertEqual(baseAfterPad, 1, "Editor setPaddingX");
			assertEqual(ceInitPad, 2, "CustomEditor init paddingX");
			assertEqual(ceAfterPad, 1, "CustomEditor setPaddingX");
			assertEqual(ceInitMax, 5, "CustomEditor init autocompleteMaxVisible");
			assertEqual(ceAfterMax, 6, "CustomEditor setAutocompleteMaxVisible");
			assertEqual(ceText, "probe", "CustomEditor setText/getText");
			assertEqual(editor.embedWorkingStatus, true, "CustomEditor embedWorkingStatus");

			let lastChange = "";
			let submitted = "";
			editor.onChange = (text) => {
				lastChange = text;
			};
			editor.onSubmit = (text) => {
				submitted = text;
			};
			let actionFired = 0;
			editor.actionHandlers.set("app.interrupt", () => {
				actionFired += 1;
			});
			const borderColorFn = editor.borderColor;
			assertEqual(typeof borderColorFn("x"), "string", "CustomEditor borderColor");

			statusIndicator = new WorkingStatusIndicator(uiRef, "Working");
			editor.setWorkingStatusIndicator(statusIndicator);
			const editorLines = editor.render(80);
			assert(editorLines.length >= 3, `expected >= 3 editor lines, got ${editorLines.length}`);
			editor.setWorkingStatusIndicator(undefined);

			editor.handleInput("h");
			editor.handleInput("i");
			assertEqual(lastChange, "hi", "CustomEditor onChange");
			editor.handleInput("\r");
			assertEqual(submitted, "hi", "CustomEditor onSubmit");
			assertEqual(lastChange, "", "CustomEditor cleared on submit");
			assertEqual(actionFired, 0, "unexpected action handler firing");

			const wrappedEditor = toEditorComponent({
				getText: () => "wrapped",
				setText: () => {},
				handleInput: () => {},
				render: () => ["wrapped"],
				invalidate: () => {},
			});
			assert(wrappedEditor instanceof FunctionalEditorComponent, "toEditorComponent wrapper check");
			wrappedEditor.setPaddingX(2);
			assertEqual(wrappedEditor.getText(), "wrapped", "FunctionalEditorComponent getText");

			let expandedState = false;
			let padState = -1;
			let inputSeen = "";
			const rawLike: ComponentLike = {
				render: () => ["functional-row"],
				handleInput: (data) => {
					inputSeen += data;
				},
				handleMouse: (_ev) => ({ handled: true, focus: true }),
				focused: false,
				setExpanded: (expanded) => {
					expandedState = expanded;
				},
				setOutputPad: (padding) => {
					padState = padding;
				},
				invalidate: () => {},
			};
			const wrappedComp = toComponent(rawLike);
			assert(wrappedComp instanceof FunctionalComponent, "toComponent wrapper check");
			assertEqual(wrappedComp.isExpandableComponent(), true, "FunctionalComponent expandable");
			wrappedComp.setExpanded(true);
			assertEqual(expandedState, true, "FunctionalComponent setExpanded");
			assertEqual(wrappedComp.hasOutputPad(), true, "FunctionalComponent outputPad");
			wrappedComp.setOutputPad(3);
			assertEqual(padState, 3, "FunctionalComponent setOutputPad");
			assertEqual(wrappedComp.isFocusableComponent(), true, "FunctionalComponent focusable");

			let debugCalls = 0;
			uiRef.onDebug = () => {
				debugCalls += 1;
			};
			const debugCb = uiRef.onDebug;
			debugCb?.();
			assertEqual(debugCalls, 1, "uiRef onDebug getter/setter");

			mainTui.addChild(editor);
			mainTui.addChild(rawLike);
			mainTui.setFocus(rawLike);
			assertEqual(rawLike.focused, true, "setFocus should update raw ComponentLike.focused");
			assert(mainTui.getFocusedComponent() === wrappedComp, "getFocusedComponent should return cached FunctionalComponent");
			wrappedComp.handleInput("x");
			assertEqual(inputSeen, "x", "FunctionalComponent handleInput");

			const box = new TuiBox(0, 0);
			const region = new MouseRegion(new TuiText("click-me", 0, 0), (ev: TuiMouseEvent) =>
				ev.type === "click" ? { handled: true, focus: true } : undefined,
			);
			box.addChild(region);
			const mouseRoot = new TuiContainer();
			mouseRoot.addChild(box);
			mouseRoot.render(40);
			const dispatchRes = dispatchMouseEvent(mouseRoot, {
				type: "click",
				button: "left",
				x: 1,
				y: 0,
				screenX: 1,
				screenY: 0,
				width: 40,
				height: 1,
				shift: false,
				alt: false,
				ctrl: false,
			});
			assert(dispatchRes !== undefined && dispatchRes.handled === true, "dispatchMouseEvent handled check");

			mainTui.start();
			mainTui.renderNow(true);
			assert(termMain.writes.length > 0, "TuiMainScreen should write rendered output");

			currentRenderer = altTui;
			assertEqual(isViewportTUI(uiRef), true, "uiRef should switch to altTui");
			altTui.addChild(new TuiText("alt-screen-line", 0, 0));
			altTui.start();
			altTui.renderNow(true);
			uiRef.requestRender(false);
			capturedRequestRender(false);
			assert(uiRef.render(80).length > 0, "uiRef.render should render active TUI");
			assert(capturedRender(80).length > 0, "captured uiRef.render should render active TUI");
			assert(termAlt.writes.join("").includes("\x1b[?1049h"), "TuiAltScreen should enter alternate screen");

			mainTui.stop();
			altTui.stop();
			new ProcessTerminal().stop();

			// Regression for #108/#109: autocomplete "/", "@", grapheme cursor render, Input empty/placeholder/word-nav, selectors in VStack/chat-viewport, Markdown + LaTeX, bounds guards
			editor.setText("hello world");
			editor.handleInput("\x1b[D");
			assert(editor.render(80).length >= 3, "Editor mid-line grapheme cursor render failed");
			editor.handleInput("\x7f");
			editor.setText("");

			writeFileSync(join(testDir, "readme.txt"), "autocomplete fixture\n", "utf8");
			const acProvider = new CombinedAutocompleteProvider(
				[
					{ name: "settings", description: "Open settings" },
					{ name: "model", description: "Select model" },
				],
				testDir,
				null,
			);
			editor.setAutocompleteProvider(acProvider);
			editor.handleInput("/");
			await new Promise((resolve) => setTimeout(resolve, 25));
			const slashAcLines = editor.render(80);
			assert(slashAcLines.length >= 4 && slashAcLines.join("\n").includes("settings"), "CombinedAutocompleteProvider '/' render failed");
			editor.handleInput("\x7f");
			await new Promise((resolve) => setTimeout(resolve, 25));
			assertEqual(editor.getText(), "", "Editor backspace after '/' failed");
			editor.handleInput("@");
			await new Promise((resolve) => setTimeout(resolve, 25));
			const atAcLines = editor.render(80);
			assert(atAcLines.length >= 3, "CombinedAutocompleteProvider '@' render failed");
			editor.setText("");

			const emptyInput = new TuiInput();
			emptyInput.focused = true;
			assertEqual(emptyInput.render(80).length, 1, "Empty Input.render(80) failed");
			const searchInput = new TuiInput({ placeholder: "Filter..." });
			searchInput.focused = true;
			assertEqual(searchInput.render(80).length, 1, "Placeholder Input.render(80) failed");
			searchInput.handleInput("a");
			searchInput.handleInput("b");
			searchInput.handleInput(" ");
			searchInput.handleInput("c");
			searchInput.handleInput("d");
			assertEqual(searchInput.getValue(), "ab cd", "Input typing failed");
			searchInput.handleInput("\x7f");
			assertEqual(searchInput.getValue(), "ab c", "Input backspace failed");
			searchInput.handleInput("\x1bb");
			searchInput.handleInput("x");
			assertEqual(searchInput.getValue(), "ab xc", "Input word nav + insert failed");
			assertEqual(searchInput.render(80).length, 1, "Typed Input.render(80) failed");

			const thinkingSelector = new ThinkingSelectorComponent(
				"medium",
				["off", "low", "medium", "high"],
				() => {},
				() => {},
			);
			assert(thinkingSelector.render(80).length >= 5, "ThinkingSelectorComponent render failed");
			thinkingSelector.handleInput("z");
			thinkingSelector.handleInput("z");
			assert(thinkingSelector.render(80).length >= 4, "ThinkingSelectorComponent 0-match filter render failed");

			const settingsList = new SettingsList(
				[
					{
						id: "theme",
						label: "Theme",
						description: "Color theme",
						currentValue: "dark",
						values: ["dark", "light"],
					},
				],
				5,
				getSettingsListTheme(),
				() => {},
				() => {},
				{ enableSearch: true },
			);
			assert(settingsList.render(80).length >= 3, "SettingsList render failed");

			const selectorVStack = new TuiVStack([
				{ component: thinkingSelector, shrink: 1, minSize: 0 },
				{ component: settingsList, shrink: 1, minSize: 0 },
			]);
			assert(selectorVStack.render(80).length >= 6, "VStack with selectors render failed");

			const viewport = createChatViewport({
				document: new TuiText("Transcript line", 0, 0),
				pendingMessages: new TuiSpacer(0),
				status: thinkingSelector,
				editor: settingsList,
				footer: new TuiText("footer", 0, 0),
			});
			assert(viewport.root.render(80).length > 0, "createChatViewport VStack.render(80) failed");
			const layoutFrame = renderLayoutFrame(viewport.root, 80, 24, () => {});
			assertEqual(layoutFrame.lines.length, 24, "renderLayoutFrame height mismatch");

			const md = new TuiMarkdown(
				"# Heading\n\n```ts\nconst x = 1;\n```\n\n> blockquote\n\n- item 1\n- item 2\n\nInline $x + \\unknown$",
				1,
				0,
				getMarkdownTheme(),
			);
			const mdLines = md.render(80);
			assert(mdLines.length >= 6 && mdLines.join("\n").includes("Heading"), "Markdown + LaTeX render failed");
			assert(md.render(2).length > 0, "Markdown narrow blockquote render failed");

			assertEqual(findWordBackward("", 0), 0, "findWordBackward empty string");
			assertEqual(findWordBackward("   ", 3), 0, "findWordBackward whitespace only");
			assertEqual(parseKey("\x1b[99~"), undefined, "parseKey unknown functional sequence");
			assertEqual(matchesKey("\x1b[200~", "enter"), false, "matchesKey unknown functional sequence");
		} finally {
			statusIndicator?.dispose();
			mainTui.stop();
			altTui.stop();
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	// 24. FFI Word Segmenter (Apple NLTokenizer)
	await runCase("ffi:word-segmenter", () => {
		assertEqual(isNativeDarwinAvailable(), true, "expected Darwin native FFI to be available");

		const mixed = "hello world 你好世界 日本語 สวัสดีfoo";
		const nativeSegments = nativeWordSegment(mixed);
		assert(nativeSegments !== null && nativeSegments.length >= 6, "expected native word segments");
		assertEqual(
			nativeSegments!.map((s) => s.segment).join(""),
			mixed,
			"native word segments must reconstruct input losslessly",
		);
		let expectedOffset = 0;
		for (const seg of nativeSegments!) {
			assertEqual(seg.index, expectedOffset, "native word segment index mismatch");
			expectedOffset += seg.segment.length;
		}
		assertEqual(nativeSegments![0]?.segment, "hello", "first word segment mismatch");
		assertEqual(nativeSegments![0]?.isWordLike, true, "first word isWordLike mismatch");
		assertEqual(nativeSegments![1]?.segment, " ", "space segment mismatch");
		assertEqual(nativeSegments![1]?.isWordLike, false, "space isWordLike mismatch");

		const seg = getWordSegmenter();
		const zhWords = [...seg.segment("你好世界")].filter((s) => s.isWordLike).map((s) => s.segment);
		assert(zhWords.length >= 2 && zhWords.join("") === "你好世界", "Chinese segmentation failed");

		const jaWords = [...seg.segment("東京都渋谷区")].filter((s) => s.isWordLike).map((s) => s.segment);
		assert(jaWords.length >= 2 && jaWords.join("") === "東京都渋谷区", "Japanese segmentation failed");

		const thWords = [...seg.segment("สวัสดีครับ")].filter((s) => s.isWordLike).map((s) => s.segment);
		assert(thWords.length >= 2 && thWords.join("") === "สวัสดีครับ", "Thai segmentation failed");

		const mixWords = [...seg.segment(mixed)].filter((s) => s.isWordLike).map((s) => s.segment);
		assert(mixWords.includes("hello") && mixWords.includes("world"), "mixed word segmentation missing Latin words");
		assertEqual(findWordBackward("hello world", 11), 6, "findWordBackward Latin");
		assert(findWordBackward("你好 世界", 5) < 5, "findWordBackward CJK should move left");
	});

	// 25. FFI Clipboard & Modifiers (AppKit NSPasteboard + NSEvent)
	await runCase("ffi:clipboard", async () => {
		const helper = getNativePlatformHelper();
		assert(helper !== undefined, "expected Darwin platform helper");
		assert(getNativeClipboard() === helper, "getNativeClipboard must share singleton helper");

		assertEqual(typeof nativeIsModifierPressed("shift"), "boolean", "shift modifier check must return boolean");
		assertEqual(typeof nativeIsModifierPressed("command"), "boolean", "command modifier check must return boolean");

		const savedClipboard = nativeClipboardGetText();
		try {
			const marker = `pi-ts-clipboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			assertEqual(nativeClipboardSetText(marker), true, "nativeClipboardSetText failed");
			assertEqual(nativeClipboardGetText(), marker, "nativeClipboardGetText roundtrip mismatch");
			assertEqual(await readClipboardText(), marker, "readClipboardText roundtrip mismatch");

			const marker2 = `${marker}-copy`;
			await copyToClipboard(marker2);
			assertEqual(await readClipboardText(), marker2, "copyToClipboard roundtrip mismatch");

			const paths = await readClipboardFilePaths();
			assert(paths === null || Array.isArray(paths), "readClipboardFilePaths must return null or string[]");

			const img = await readClipboardImage();
			assert(
				img === null || (img.bytes instanceof Uint8Array && typeof img.mimeType === "string"),
				"readClipboardImage must return null or valid ClipboardImage",
			);
		} finally {
			nativeClipboardSetText(savedClipboard ?? "");
		}
	});

	// 26. Media Image Resize & Convert (Apple ImageIO / CoreGraphics)
	await runCase("media:image-resize-and-convert", async () => {
		assert((await loadPhoton()) === null, "WASM photon stub must stay disabled");

		const smallPng = makeSolidPng(16, 8);
		const parsedPng = parseImageDimensions(smallPng);
		assert(parsedPng !== null, "parseImageDimensions failed on PNG");
		assertEqual(parsedPng!.width, 16, "PNG width mismatch");
		assertEqual(parsedPng!.height, 8, "PNG height mismatch");
		assertEqual(parsedPng!.format, "png", "PNG format mismatch");

		const inspectedPng = nativeImageInspect(smallPng);
		assert(inspectedPng !== null, "nativeImageInspect failed on PNG");
		assertEqual(inspectedPng!.width, 16, "native PNG width mismatch");
		assertEqual(inspectedPng!.height, 8, "native PNG height mismatch");

		const bmp2x2 = makeSolidBmp2x2();
		const parsedBmp = parseImageDimensions(bmp2x2);
		assert(parsedBmp !== null, "parseImageDimensions failed on BMP");
		assertEqual(parsedBmp!.width, 2, "BMP width mismatch");
		assertEqual(parsedBmp!.height, 2, "BMP height mismatch");
		assertEqual(parsedBmp!.format, "bmp", "BMP format mismatch");

		const encodedPng = encodePngBytesSync(bmp2x2);
		assert(encodedPng !== null, "encodePngBytesSync failed on BMP");
		const encodedDims = parseImageDimensions(encodedPng!);
		assertEqual(encodedDims?.format, "png", "encoded output must be PNG");
		assertEqual(encodedDims?.width, 2, "encoded PNG width mismatch");
		assertEqual(encodedDims?.height, 2, "encoded PNG height mismatch");

		const asyncPng = await convertImageBytesToPng(bmp2x2);
		assert(asyncPng !== null && parseImageDimensions(asyncPng)?.format === "png", "convertImageBytesToPng failed");

		const converted = await convertToPng(Buffer.from(bmp2x2).toString("base64"), "image/bmp");
		assert(converted !== null && converted.mimeType === "image/png", "convertToPng failed");

		const transcoder = await loadPngTranscoder();
		assert(transcoder !== undefined, "expected Darwin PNG transcoder");
		const transcodedB64 = transcoder!(Buffer.from(bmp2x2).toString("base64"), "image/bmp");
		assert(transcodedB64 !== null, "synchronous PNG transcoder returned null");
		assertEqual(
			parseImageDimensions(new Uint8Array(Buffer.from(transcodedB64!, "base64")))?.format,
			"png",
			"transcoded bytes must be PNG",
		);

		// EXIF orientation 6 (Rotate 90 CW): 16x8 JPEG must auto-orient to 8x16
		const rawJpeg = nativeImageTransform(smallPng, 0, 0, "jpeg", 85, false);
		assert(rawJpeg !== null, "nativeImageTransform failed to encode JPEG");
		const exifJpeg = injectExifOrientation6(rawJpeg!);
		assertEqual(getExifOrientation(exifJpeg), 6, "EXIF orientation 6 detection failed");
		const orientedPng = nativeImageTransform(exifJpeg, 0, 0, "png", 100, true);
		assert(orientedPng !== null, "nativeImageTransform failed on EXIF JPEG");
		const orientedDims = parseImageDimensions(orientedPng!);
		assertEqual(orientedDims?.width, 8, "EXIF orientation swap width mismatch");
		assertEqual(orientedDims?.height, 16, "EXIF orientation swap height mismatch");

		// Fast-path no-op resize preserves bytes & reports wasResized=false
		const fastRes = await resizeImage(smallPng, "image/png", { maxWidth: 64, maxHeight: 64 });
		assert(fastRes !== null && !fastRes.wasResized, "expected resizeImage fast-path");
		assertEqual(fastRes!.width, 16, "fast-path width mismatch");
		assertEqual(fastRes!.height, 8, "fast-path height mismatch");
		assertEqual(formatDimensionNote(fastRes!), undefined, "fast-path must omit dimension note");

		const strippedPng = stripPngOrientationChunks(smallPng);
		assertEqual(parseImageDimensions(strippedPng)?.format, "png", "stripPngOrientationChunks corrupted PNG");

		// Downscale resize preserves aspect ratio & emits dimension note
		const largePng = makeSolidPng(120, 60);
		const downscaled = await resizeImage(largePng, "image/png", { maxWidth: 40, maxHeight: 40 });
		assert(downscaled !== null && downscaled.wasResized, "expected resizeImage to shrink 120x60");
		assertEqual(downscaled!.originalWidth, 120, "originalWidth mismatch");
		assertEqual(downscaled!.originalHeight, 60, "originalHeight mismatch");
		assert(downscaled!.width <= 40 && downscaled!.height <= 40, "resized dimensions exceed 40x40 bounds");
		const note = formatDimensionNote(downscaled!);
		assert(note !== undefined && note.includes("120x60"), "missing dimension note for resized image");
	});

	// 27. AI Bedrock Enterprise Auth (INI, WebIdentity, SSO, RoleArn, ECS, IMDSv2)
	await runCase("ai:bedrock-enterprise-auth", async () => {
		const awsTmp = mkdtempSync(join(tmpdir(), "pi-bedrock-auth-"));
		clearBedrockCredentialsCache();
		try {
			const awsDir = join(awsTmp, ".aws");
			const ssoCacheDir = join(awsDir, "sso", "cache");
			mkdirSync(ssoCacheDir, { recursive: true });

			const iniSections = parseAwsIniText("[profile dev]\nregion = eu-west-1\nsso_session = corp\n");
			assertEqual(iniSections.get("profile dev")?.get("region"), "eu-west-1", "parseAwsIniText failed");

			const configContent = [
				"[profile sso-prof]",
				"region = us-west-2",
				"sso_session = corp-sso",
				"sso_account_id = 111122223333",
				"sso_role_name = DevRole",
				"",
				"[sso-session corp-sso]",
				"sso_region = us-west-2",
				"sso_start_url = https://corp.awsapps.com/start",
				"",
				"[profile assumed]",
				"region = us-east-1",
				"role_arn = arn:aws:iam::111122223333:role/AssumedRole",
				"source_profile = base",
				"",
			].join("\n");
			const credsContent = [
				"[base]",
				"aws_access_key_id = TESTACCESSKEY0001",
				"aws_secret_access_key = testsecretkey0001",
				"",
			].join("\n");
			writeFileSync(join(awsDir, "config"), configContent, "utf8");
			writeFileSync(join(awsDir, "credentials"), credsContent, "utf8");

			const parsedIni = parseAwsIniFiles({ env: { HOME: awsTmp } });
			assertEqual(parsedIni.config?.get("profile assumed")?.get("role_arn"), "arn:aws:iam::111122223333:role/AssumedRole", "parseAwsIniFiles missing role_arn");
			assertEqual(resolveBedrockProfileRegion("sso-prof", { HOME: awsTmp }), "us-west-2", "resolveBedrockProfileRegion mismatch");

			const sampleStsXml =
				"<AssumeRoleResponse><AssumeRoleResult><Credentials>" +
				"<AccessKeyId>TESTSTSKEY1</AccessKeyId>" +
				"<SecretAccessKey>teststssecret1</SecretAccessKey>" +
				"<SessionToken>test-sts-token-1</SessionToken>" +
				`<Expiration>${new Date(Date.now() + 3600_000).toISOString()}</Expiration>` +
				"</Credentials></AssumeRoleResult></AssumeRoleResponse>";
			const parsedSts = parseStsCredentialsXml(sampleStsXml);
			assertEqual(parsedSts.accessKeyId, "TESTSTSKEY1", "parseStsCredentialsXml accessKeyId mismatch");
			assertEqual(parsedSts.sessionToken, "test-sts-token-1", "parseStsCredentialsXml token mismatch");

			// 27a. WebIdentity via env + fetchFn
			const webTokenPath = join(awsTmp, "oidc-jwt");
			writeFileSync(webTokenPath, "jwt-token-value", "utf8");
			const webCreds = await resolveBedrockCredentials({
				skipAuth: false,
				env: {
					AWS_ROLE_ARN: "arn:aws:iam::111122223333:role/WebRole",
					AWS_WEB_IDENTITY_TOKEN_FILE: webTokenPath,
					AWS_ROLE_SESSION_NAME: "pi-web-test",
					AWS_REGION: "us-east-1",
				},
				fetchFn: makeMockFetch(async (_url, init) => {
					const body = String(init?.body ?? "");
					assert(body.includes("Action=AssumeRoleWithWebIdentity"), "expected AssumeRoleWithWebIdentity");
					assert(body.includes("WebIdentityToken=jwt-token-value"), "expected web identity token in body");
					return new Response(sampleStsXml.replace("TESTSTSKEY1", "TESTWEBKEY"), { status: 200 });
				}),
			});
			assertEqual(webCreds.accessKeyId, "TESTWEBKEY", "WebIdentity accessKeyId mismatch");

			// 27b. SSO expired token -> OIDC refresh -> federation credentials
			const ssoHash = createHash("sha1").update("corp-sso").digest("hex");
			writeFileSync(
				join(ssoCacheDir, `${ssoHash}.json`),
				JSON.stringify({
					startUrl: "https://corp.awsapps.com/start",
					region: "us-west-2",
					accessToken: "expired-sso-token",
					expiresAt: new Date(Date.now() - 60_000).toISOString(),
					clientId: "sso-client-1",
					clientSecret: "sso-secret-1",
					refreshToken: "sso-refresh-1",
					registrationExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
				}),
				"utf8",
			);
			const seenSsoUrls: string[] = [];
			const ssoFetch = makeMockFetch(async (url, init) => {
				seenSsoUrls.push(url);
				if (url.includes("/token")) {
					return new Response(
						JSON.stringify({ accessToken: "fresh-sso-token", expiresIn: 3600, refreshToken: "sso-refresh-2" }),
						{ status: 200 },
					);
				}
				if (url.includes("/federation/credentials")) {
					const hdrs = new Headers(init?.headers);
					assertEqual(hdrs.get("x-amz-sso_bearer_token"), "fresh-sso-token", "missing refreshed SSO bearer token");
					return new Response(
						JSON.stringify({
							roleCredentials: {
								accessKeyId: "TESTSSOKEY1",
								secretAccessKey: "testssosecret1",
								sessionToken: "testssotoken1",
								expiration: Date.now() + 3600_000,
							},
						}),
						{ status: 200 },
					);
				}
				return new Response("unexpected", { status: 404 });
			});
			const refreshedToken = await resolveSsoCachedToken({
				ssoSession: "corp-sso",
				ssoStartUrl: "https://corp.awsapps.com/start",
				ssoRegion: "us-west-2",
				ssoCacheDir,
				fetchFn: ssoFetch,
			});
			assertEqual(refreshedToken, "fresh-sso-token", "SSO refresh mismatch");
			const ssoFed = await fetchSsoRoleCredentials({
				ssoRegion: "us-west-2",
				accountId: "111122223333",
				roleName: "DevRole",
				accessToken: refreshedToken,
				fetchFn: ssoFetch,
			});
			assertEqual(ssoFed.credentials.accessKeyId, "TESTSSOKEY1", "SSO federation accessKeyId mismatch");
			const ssoCreds = await resolveBedrockCredentials({
				optionsProfile: "sso-prof",
				skipAuth: false,
				env: { HOME: awsTmp },
				fetchFn: ssoFetch,
			});
			assertEqual(ssoCreds.accessKeyId, "TESTSSOKEY1", "resolveBedrockCredentials SSO mismatch");

			// 27c. role_arn + source_profile SigV4 AssumeRole + credential cache hit
			let assumeCalls = 0;
			const assumeFetch = makeMockFetch(async (_url, init) => {
				assumeCalls += 1;
				const hdrs = new Headers(init?.headers);
				assert(
					(hdrs.get("authorization") ?? "").startsWith("AWS4-HMAC-SHA256 "),
					"AssumeRole request must be SigV4 signed",
				);
				return new Response(sampleStsXml.replace("TESTSTSKEY1", "TESTASSUMED1"), { status: 200 });
			});
			const assumed1 = await resolveBedrockCredentials({
				optionsProfile: "assumed",
				skipAuth: false,
				env: { HOME: awsTmp },
				fetchFn: assumeFetch,
			});
			const assumed2 = await resolveBedrockCredentials({
				optionsProfile: "assumed",
				skipAuth: false,
				env: { HOME: awsTmp },
				fetchFn: assumeFetch,
			});
			assertEqual(assumed1.accessKeyId, "TESTASSUMED1", "role_arn accessKeyId mismatch");
			assertEqual(assumed2.accessKeyId, "TESTASSUMED1", "cached role_arn mismatch");
			assertEqual(assumeCalls, 1, "expected second AssumeRole call to hit credential cache");

			// 27d. ECS container credentials + EC2 IMDSv2
			const ecsCreds = await resolveEcsContainerCredentials({
				env: {
					AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/test-ecs",
					AWS_CONTAINER_AUTHORIZATION_TOKEN: "ecs-secret-token",
				},
				fetchFn: makeMockFetch(async (_url, init) => {
					const hdrs = new Headers(init?.headers);
					assertEqual(hdrs.get("authorization"), "ecs-secret-token", "ECS authorization header mismatch");
					return new Response(
						JSON.stringify({
							AccessKeyId: "TESTECSKEY",
							SecretAccessKey: "testecssecret",
							Token: "testecstoken",
							Expiration: new Date(Date.now() + 3600_000).toISOString(),
						}),
						{ status: 200 },
					);
				}),
			});
			assertEqual(ecsCreds?.accessKeyId, "TESTECSKEY", "ECS accessKeyId mismatch");

			const imdsCreds = await resolveEc2ImdsV2Credentials({
				env: { AWS_EC2_METADATA_SERVICE_ENDPOINT: "http://169.254.169.254" },
				fetchFn: makeMockFetch(async (url, init) => {
					if (url.endsWith("/latest/api/token")) {
						assertEqual(init?.method, "PUT", "IMDSv2 token method must be PUT");
						return new Response("imds-v2-tok", { status: 200 });
					}
					const hdrs = new Headers(init?.headers);
					assertEqual(hdrs.get("x-aws-ec2-metadata-token"), "imds-v2-tok", "missing IMDSv2 token header");
					if (url.endsWith("/latest/meta-data/iam/security-credentials/")) {
						return new Response("pi-test-role\n", { status: 200 });
					}
					if (url.endsWith("/latest/meta-data/iam/security-credentials/pi-test-role")) {
						return new Response(
							JSON.stringify({
								Code: "Success",
								AccessKeyId: "TESTIMDSKEY",
								SecretAccessKey: "testimdssecret",
								Token: "testimdstoken",
								Expiration: new Date(Date.now() + 3600_000).toISOString(),
							}),
							{ status: 200 },
						);
					}
					return new Response("not found", { status: 404 });
				}),
			});
			assertEqual(imdsCreds.accessKeyId, "TESTIMDSKEY", "IMDSv2 accessKeyId mismatch");
		} finally {
			clearBedrockCredentialsCache();
			rmSync(awsTmp, { recursive: true, force: true });
		}
	});

	// 28. AI Vertex Enterprise Auth (impersonated_service_account + external_account WIF)
	await runCase("ai:vertex-enterprise-auth", async () => {
		const vertexTmp = mkdtempSync(join(tmpdir(), "pi-vertex-auth-"));
		clearVertexTokenCache();
		try {
			// 28a. Recursive impersonated_service_account -> authorized_user -> IAM generateAccessToken + cache hit
			let iamCalls = 0;
			const impFetch = makeMockFetch(async (url, init) => {
				if (url === "https://oauth2.googleapis.com/token") {
					return new Response(JSON.stringify({ access_token: "source-user-token", expires_in: 3600 }), {
						status: 200,
					});
				}
				if (url.includes(":generateAccessToken")) {
					iamCalls += 1;
					const hdrs = new Headers(init?.headers);
					assertEqual(hdrs.get("authorization"), "Bearer source-user-token", "IAM bearer token mismatch");
					return new Response(
						JSON.stringify({
							accessToken: "impersonated-sa-token",
							expireTime: new Date(Date.now() + 3600_000).toISOString(),
						}),
						{ status: 200 },
					);
				}
				return new Response("not found", { status: 404 });
			});

			const impCreds = {
				type: "impersonated_service_account",
				service_account_impersonation_url:
					"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/target@proj.iam.gserviceaccount.com:generateAccessToken",
				delegates: ["projects/-/serviceAccounts/delegate@proj.iam.gserviceaccount.com"],
				source_credentials: {
					type: "authorized_user",
					client_id: "test-client-id",
					client_secret: "test-client-secret",
					refresh_token: "test-refresh-token-1234",
				},
			};
			const tok1 = await resolveVertexCredentialsObject(impCreds, impFetch);
			const tok2 = await resolveVertexCredentialsObject(impCreds, impFetch);
			assertEqual(tok1, "impersonated-sa-token", "impersonated_service_account token mismatch");
			assertEqual(tok2, "impersonated-sa-token", "impersonated_service_account cached token mismatch");
			assertEqual(iamCalls, 1, "expected second impersonated_service_account call to hit token cache");

			// 28b. external_account (file JSON subject token + STS + IAM impersonation)
			const oidcFile = join(vertexTmp, "oidc-subject.json");
			writeFileSync(oidcFile, JSON.stringify({ id_token: "file-subject-jwt" }), "utf8");
			const wifFileCreds = {
				type: "external_account",
				audience: "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/pool/providers/prov",
				subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
				token_url: "https://sts.googleapis.com/v1/token",
				credential_source: {
					file: oidcFile,
					format: { type: "json", subject_token_field_name: "id_token" },
				},
				service_account_impersonation_url:
					"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/wif@proj.iam.gserviceaccount.com:generateAccessToken",
			};
			const wifTok = await resolveVertexCredentialsObject(
				wifFileCreds,
				makeMockFetch(async (url, init) => {
					if (url === "https://sts.googleapis.com/v1/token") {
						const body = String(init?.body ?? "");
						assert(body.includes("subject_token=file-subject-jwt"), "missing file subject token in STS body");
						return new Response(JSON.stringify({ access_token: "sts-federated-tok", expires_in: 3600 }), {
							status: 200,
						});
					}
					if (url.includes(":generateAccessToken")) {
						const hdrs = new Headers(init?.headers);
						assertEqual(hdrs.get("authorization"), "Bearer sts-federated-tok", "WIF IAM bearer mismatch");
						return new Response(
							JSON.stringify({
								accessToken: "wif-impersonated-tok",
								expireTime: new Date(Date.now() + 3600_000).toISOString(),
							}),
							{ status: 200 },
						);
					}
					return new Response("unexpected", { status: 404 });
				}),
			);
			assertEqual(wifTok, "wif-impersonated-tok", "external_account file WIF token mismatch");

			// 28c. resolveExternalAccountToken via HTTP url + custom header (without IAM impersonation)
			const directWif = await resolveExternalAccountToken(
				{
					type: "external_account",
					audience: "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/p/providers/urlp",
					subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
					credential_source: {
						url: "https://metadata.local/token",
						headers: { "Metadata-Flavor": "Google" },
					},
				},
				makeMockFetch(async (url, init) => {
					if (url === "https://metadata.local/token") {
						const hdrs = new Headers(init?.headers);
						assertEqual(hdrs.get("metadata-flavor"), "Google", "external_account custom header missing");
						return new Response("raw-url-jwt", { status: 200 });
					}
					if (url === "https://sts.googleapis.com/v1/token") {
						const body = String(init?.body ?? "");
						assert(body.includes("subject_token=raw-url-jwt"), "missing URL subject token in STS body");
						return new Response(JSON.stringify({ access_token: "direct-sts-tok", expires_in: 1800 }), {
							status: 200,
						});
					}
					return new Response("unexpected", { status: 404 });
				}),
			);
			assertEqual(directWif.token, "direct-sts-tok", "external_account url STS token mismatch");

			// 28d. Direct exchangeImpersonatedToken
			const impDirect = await exchangeImpersonatedToken({
				impersonationUrl: "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/x:generateAccessToken",
				sourceToken: "src-tok",
				lifetimeSeconds: 600,
				fetchFn: makeMockFetch(async () =>
					new Response(JSON.stringify({ accessToken: "direct-imp-tok", expireTime: new Date(Date.now() + 600_000).toISOString() }), {
						status: 200,
					}),
				),
			});
			assertEqual(impDirect.token, "direct-imp-tok", "exchangeImpersonatedToken mismatch");
		} finally {
			clearVertexTokenCache();
			rmSync(vertexTmp, { recursive: true, force: true });
		}
	});

	// 29. Syntax Highlight 67+ Languages & Fence Aliases
	await runCase("highlight:67-languages", async () => {
		await loadAllHighlightLanguages();
		const count = getHighlightLanguageCount();
		assert(count >= 67, `expected at least 67 highlight languages, got ${count}`);

		const addedLanguages = [
			"zig",
			"haskell",
			"elixir",
			"ocaml",
			"powershell",
			"toml",
			"graphql",
			"protobuf",
			"hcl",
			"cmake",
			"glsl",
			"wgsl",
			"hlsl",
			"svelte",
			"vue",
			"prisma",
			"clojure",
			"julia",
			"r",
			"solidity",
			"erlang",
			"fsharp",
			"nim",
			"crystal",
			"gleam",
			"odin",
			"v",
			"typst",
			"latex",
			"nginx",
			"llvm",
			"x86asm",
			"awk",
			"fish",
			"scheme",
		];
		for (const lang of addedLanguages) {
			assertEqual(supportsLanguage(lang), true, `missing highlight grammar: ${lang}`);
		}

		const requiredAliases = [
			"tsx",
			"jsx",
			"mts",
			"cts",
			"mjs",
			"cjs",
			"sh",
			"zsh",
			"shell",
			"console",
			"py",
			"rb",
			"rs",
			"ts",
			"js",
			"hs",
			"ex",
			"exs",
			"ml",
			"mli",
			"ps",
			"ps1",
			"pwsh",
			"gql",
			"proto",
			"terraform",
			"tf",
			"clj",
			"edn",
			"jl",
			"sol",
			"erl",
			"fs",
			"cr",
			"vlang",
			"typ",
			"tex",
			"nasm",
			"asm",
			"armasm",
			"lisp",
			"elisp",
			"jsonc",
			"jsonl",
			"yml",
			"md",
			"scss",
			"less",
			"html",
			"svg",
			"docker",
			"make",
			"gradle",
			"golang",
			"nixos",
			"patch",
		];
		assert(requiredAliases.length >= 40, "expected >= 40 aliases in test matrix");
		for (const alias of requiredAliases) {
			assertEqual(supportsLanguage(alias), true, `missing highlight alias: ${alias}`);
		}

		const ansiTheme = {
			keyword: (s: string) => `[KW:${s}]`,
			string: (s: string) => `[STR:${s}]`,
			number: (s: string) => `[NUM:${s}]`,
			title: (s: string) => `[TIT:${s}]`,
		};
		const tomlOut = highlight('[pkg]\nname = "pi"\nver = 1', { language: "toml", theme: ansiTheme });
		assert(tomlOut.includes("[STR:"), `toml highlight failed: ${tomlOut}`);
		const svelteOut = highlight("<script>let count = 1;</script><p>{count}</p>", { language: "svelte", theme: ansiTheme });
		assert(svelteOut.includes("[KW:") || svelteOut.includes("[NUM:"), `svelte highlight failed: ${svelteOut}`);
		const hclOut = highlight('resource "aws_s3_bucket" "b" { count = 1 }', { language: "hcl", theme: ansiTheme });
		assert(hclOut.includes("[KW:") || hclOut.includes("[STR:"), `hcl highlight failed: ${hclOut}`);
		const latexOut = highlight("\\section{Intro} $x + 1$", { language: "latex", theme: ansiTheme });
		assert(latexOut.includes("\\section"), `latex highlight failed: ${latexOut}`);
		const rustOut = highlight("fn main() { let x = 42; }", { language: "rs", theme: ansiTheme });
		assert(rustOut.includes("[KW:") && rustOut.includes("[NUM:"), `rust alias highlight failed: ${rustOut}`);
		const jsoncOut = highlight('{ "ok": true }', { language: "jsonc", theme: ansiTheme });
		assert(jsoncOut.includes("[STR:") || jsoncOut.includes("true"), `jsonc alias highlight failed: ${jsoncOut}`);
	});

	// 30. Codemode JavaScriptCore Sandbox, Tool RPC, Timeout, Store & Renderer
	await runCase("codemode:jsc-sandbox", async () => {
		const optsOk = parseCodemodeOptions('// @options: {"max_output_tokens": 500, "timeout_ms": 2000}\ntext("ok");');
		assertEqual(optsOk.ok, true, "parseCodemodeOptions valid header failed");
		if (optsOk.ok) {
			assertEqual(optsOk.value.maxOutputTokens, 500, "max_output_tokens mismatch");
			assertEqual(optsOk.value.timeoutMs, 2000, "timeout_ms mismatch");
		}
		const optsBad = parseCodemodeOptions('const x = 1;\n// @options: {"timeout_ms": 100}');
		assertEqual(optsBad.ok, false, "misplaced @options line should fail");

		const desc = createCodemodeDescription([
			{
				name: "echo",
				description: "Echo a message",
				parameters: Type.Object({ msg: Type.String() }),
			},
		]);
		assert(desc.includes("tools.") && desc.includes("store("), "codemode description missing globals docs");

		const cmTool = createCodemodeTool();
		assertEqual(cmTool.name, CODEMODE_TOOL_NAME, "codemode tool name mismatch");
		assertEqual(typeof createCodemodeExtension(), "function", "createCodemodeExtension must return factory");

		// 30a. Direct sandbox RPC + console + store + text output
		const rpcCalls: Array<{ name: string; args: unknown }> = [];
		const sandboxRes = await runCodemodeSandbox({
			code: `
				const reply = await tools.echo({ msg: "jsc-rpc" });
				console.log("trace", reply);
				store("lastReply", { reply });
				const loaded = load("lastReply");
				text("result:" + loaded.reply);
			`,
			tools: [{ name: "echo", scriptName: "echo", description: "Echo a message" }],
			initialStore: {},
			timeoutMs: 3000,
			includeModels: false,
			handlers: {
				async callTool(name, args) {
					rpcCalls.push({ name, args });
					const rec = args as { msg?: string };
					return `echo:${rec.msg ?? ""}`;
				},
				async searchTools() {
					return [];
				},
				async describeTool() {
					return undefined;
				},
				async describeNamespace() {
					return undefined;
				},
			},
		});
		assertEqual(sandboxRes.ok, true, `runCodemodeSandbox failed: ${sandboxRes.error ?? ""}`);
		assertEqual(rpcCalls.length, 1, "expected 1 sandbox RPC call");
		assertEqual(sandboxRes.consoleLines[0], "trace echo:jsc-rpc", "sandbox console line mismatch");
		assertEqual(sandboxRes.storeDelta.hasWrites, true, "expected storeDelta writes");
		assertEqual((sandboxRes.storeDelta.set.lastReply as { reply?: string } | undefined)?.reply, "echo:jsc-rpc", "storeDelta mismatch");
		const textOut = sandboxRes.outputs.find((o) => o.kind === "text");
		assertEqual(textOut?.kind === "text" ? textOut.text : "", "result:echo:jsc-rpc", "sandbox output text mismatch");

		// 30b. Infinite loop native JSC deadline enforcement
		const loopRes = await runCodemodeSandbox({
			code: "while (true) {}",
			tools: [],
			initialStore: {},
			timeoutMs: 80,
			includeModels: false,
			handlers: {
				async callTool() {
					return "";
				},
				async searchTools() {
					return [];
				},
				async describeTool() {
					return undefined;
				},
				async describeNamespace() {
					return undefined;
				},
			},
		});
		assertEqual(loopRes.ok, false, "infinite loop must fail");
		assertEqual(loopRes.timedOut, true, "infinite loop must set timedOut=true");

		// 30c. executeCodemode end-to-end with ExtensionToolContext + store append callback
		const storeEntries: Array<{ customType: string; data: { set: Record<string, unknown>; delete: string[] } }> = [];
		const mockToolCtx = createMockExtensionToolContext(
			process.cwd(),
			[
				{
					name: "echo",
					label: "Echo",
					description: "Echo message",
					parameters: Type.Object({ msg: Type.String() }),
					async execute(_id: string, params: unknown) {
						const msg =
							params && typeof params === "object" && !Array.isArray(params) && typeof (params as { msg?: unknown }).msg === "string"
								? (params as { msg: string }).msg
								: "";
						return { content: [{ type: "text", text: `hi:${msg}` }], details: {} };
					},
				},
			],
			async (name, rec) => ({
				content: [{ type: "text", text: `${name}:${typeof rec.msg === "string" ? rec.msg : ""}` }],
				details: {},
			}),
		);
		const execRes = await executeCodemode(
			"cm-exec-1",
			{ code: 'const v = await tools.echo({ msg: "native" }); store("seen", v); text(v);' },
			undefined,
			undefined,
			mockToolCtx,
			{
				appendStoreEntry(customType, data) {
					storeEntries.push({ customType, data });
				},
			},
		);
		const execText = execRes.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
		assert(!execRes.isError, `executeCodemode returned isError: ${execText}`);
		assertEqual(execRes.details?.calls.length, 1, "expected 1 recorded codemode call");
		assertEqual(storeEntries.length, 1, "expected 1 persisted codemode store entry");
		assert(execText.includes("echo:native"), `executeCodemode text missing output: ${execText}`);

		// 30d. codemodeRenderers inside ToolExecutionComponent (and clear timer cleanly)
		initTheme("dark", false);
		const cmTerm = new MemoryTerminal();
		const cmLogDir = mkdtempSync(join(tmpdir(), "pi-cm-ui-"));
		const cmTui = createInteractiveTui({
			tuiMode: "regular",
			terminal: cmTerm,
			showHardwareCursor: false,
			logDirectory: cmLogDir,
		});
		try {
			const comp = new ToolExecutionComponent(
				"codemode",
				"cm-ui-1",
				{ code: 'const x = await tools.echo({ msg: "ui" });\ntext(x);' },
				{},
				codemodeRenderers,
				cmTui,
				process.cwd(),
			);
			comp.markExecutionStarted();
			comp.updateResult(
				{
					content: [{ type: "text", text: "Script completed\nWall time 2ms\nOutput:\nui-ok" }],
					details: { calls: [{ id: "cm-ui-1/1", name: "echo", args: "{}", status: "ok", durationMs: 2 }] },
					isError: false,
					durationMs: 2,
				},
				true,
			);
			comp.updateResult(
				{
					content: [{ type: "text", text: "Script completed\nWall time 2ms\nOutput:\nui-ok" }],
					details: { calls: [{ id: "cm-ui-1/1", name: "echo", args: "{}", status: "ok", durationMs: 2 }] },
					isError: false,
					durationMs: 2,
				},
				false,
			);
			const rendered = comp.render(80).join("\n");
			assert(rendered.includes("ui-ok"), `codemode renderer output missing result: ${rendered}`);
		} finally {
			cmTui.stop();
			rmSync(cmLogDir, { recursive: true, force: true });
		}
	});

	// 31. External .ts Extension Loader (ts-strip, bundler, JSC VM + examples/extensions)
	await runCase("extensions:external-ts-loader", async () => {
		let phase = "init";
		try {
			const root = findRepoRoot();
			phase = "ts-strip";
			const stripped = stripTypeScriptTypes("export interface X { a: number }\nconst v: number = 1;\nexport default v;");
			assert(!stripped.includes("interface X") && /const v\s*=\s*1/.test(stripped), `ts-strip failed: ${stripped}`);

			phase = "bundle";
			const withDepsPath = join(root, "packages/coding-agent/examples/extensions/with-deps/index.ts");
			const bundled = bundleExtensionEntry(withDepsPath);
			assertEqual(bundled.missingSpecifiers.length, 0, "with-deps bundle had missing specifiers");
			assert(Object.keys(bundled.modules).length >= 2, "with-deps bundle should include duration.ts");

			const examplePaths = [
				"packages/coding-agent/examples/extensions/hello.ts",
				"packages/coding-agent/examples/extensions/with-deps/index.ts",
				"packages/coding-agent/examples/extensions/mac-system-theme.ts",
				"packages/coding-agent/examples/extensions/permission-gate.ts",
				"packages/coding-agent/examples/extensions/protected-paths.ts",
				"packages/coding-agent/examples/extensions/todo.ts",
				"packages/coding-agent/examples/extensions/custom-footer.ts",
				"packages/coding-agent/examples/extensions/plan-mode/index.ts",
				"packages/coding-agent/examples/extensions/commands.ts",
			].map((rel) => join(root, rel));

			clearExtensionCache();
			const authTmp = mkdtempSync(join(tmpdir(), "pi-ext-auth-"));
			try {
				phase = "loadExtensions";
				const bus = createEventBus();
				const runtime = createExtensionRuntime();
				const loaded = await loadExtensions(examplePaths, root, bus, runtime);
				assertEqual(
					loaded.errors.length,
					0,
					`extension load errors: ${loaded.errors.map((e) => `${e.path}: ${e.error}`).join("; ")}`,
				);
				assertEqual(loaded.extensions.length, examplePaths.length, "unexpected loaded extension count");

				const modelRuntime = await ModelRuntime.create({
					credentials: AuthStorage.create(join(authTmp, "auth.json")),
					modelsPath: null,
					allowModelNetwork: false,
					refreshOnCreate: false,
				});
				const runner = new ExtensionRunner(
					loaded.extensions,
					loaded.runtime,
					root,
					SessionManager.inMemory(root),
					new ModelRegistry(modelRuntime),
				);
				runner.bindCore(
					{
						sendMessage: () => {},
						sendUserMessage: () => {},
						appendEntry: () => {},
						setSessionName: () => {},
						getSessionName: () => undefined,
						setLabel: () => {},
						getActiveTools: () => [],
						getAllTools: () => [],
						getSettings: () => ({}),
						setActiveTools: () => {},
						refreshTools: () => {},
						getCommands: () => [],
						setModel: async () => false,
						getThinkingLevel: () => "off",
						setThinkingLevel: () => {},
					},
					{
						getModel: () => undefined,
						getScopedModels: () => [],
						isIdle: () => true,
						isProjectTrusted: () => true,
						getSignal: () => undefined,
						abort: () => {},
						hasPendingMessages: () => false,
						shutdown: () => {},
						getContextUsage: () => undefined,
						compact: () => {},
						getSystemPrompt: () => "",
					},
				);
				const extCtx = runner.createContext();
				const toolCtx = runner.createToolContext("ext-tc-1", undefined);

				phase = "exec:hello";
				const helloExt = loaded.extensions.find((ext) => ext.path.endsWith("/hello.ts"));
				const helloTool = helloExt?.tools.get("hello");
				assert(helloTool !== undefined, "hello extension missing 'hello' tool");
				const helloOut = await helloTool!.definition.execute("ext-tc-1", { name: "World" }, undefined, undefined, toolCtx);
				const helloText = helloOut.content.map((c) => (c.type === "text" ? c.text : "")).join("");
				assertEqual(helloText, "Hello, World!", "hello tool output mismatch");

				phase = "exec:parse_duration";
				const withDepsExt = loaded.extensions.find((ext) => ext.path.endsWith("/with-deps/index.ts"));
				const durTool = withDepsExt?.tools.get("parse_duration");
				assert(durTool !== undefined, "with-deps extension missing 'parse_duration' tool");
				const durOut = await durTool!.definition.execute("ext-tc-2", { duration: "1h" }, undefined, undefined, toolCtx);
				assertEqual((durOut.details as { milliseconds?: number } | undefined)?.milliseconds, 3600_000, "parse_duration 1h mismatch");

				phase = "handler:protected-paths";
				const protectedExt = loaded.extensions.find((ext) => ext.path.endsWith("/protected-paths.ts"));
				const toolCallHandlers = protectedExt?.handlers.get("tool_call") ?? [];
				assert(toolCallHandlers.length >= 1, "protected-paths missing tool_call handler");
				const blocked = await toolCallHandlers[0]!(
					{ type: "tool_call", toolCallId: "ext-tc-3", toolName: "write", input: { path: ".env" } },
					extCtx,
				);
				assertEqual((blocked as { block?: boolean } | undefined)?.block, true, "protected-paths did not block .env write");
				const allowed = await toolCallHandlers[0]!(
					{ type: "tool_call", toolCallId: "ext-tc-4", toolName: "write", input: { path: "README.md" } },
					extCtx,
				);
				assert(allowed === undefined, "protected-paths unexpectedly blocked README.md");
			} finally {
				clearExtensionCache();
				rmSync(authTmp, { recursive: true, force: true });
			}
		} catch (err) {
			throw new Error(`[${phase}] ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	// 32. Wave 2 CLI GUI flag parsing and mode resolution
	await runCase("cli:gui-flags", () => {
		const guiFlagArgs = parseArgs(["--gui"]);
		assertEqual(guiFlagArgs.gui, true, "--gui flag should be set");
		assertEqual(guiFlagArgs.diagnostics.length, 0, "--gui should emit zero diagnostics");
		assertEqual(resolveAppMode(guiFlagArgs, false, false), "gui", "non-TTY should preserve --gui mode");

		const modeGuiArgs = parseArgs(["--mode", "gui"]);
		assertEqual(modeGuiArgs.mode, "gui", "--mode gui should set mode='gui'");
		assertEqual(modeGuiArgs.diagnostics.length, 0, "--mode gui should emit zero diagnostics");
		assertEqual(resolveAppMode(modeGuiArgs, false, false), "gui", "non-TTY should preserve --mode gui");

		const missingModeArgs = parseArgs(["--mode"]);
		assert(
			missingModeArgs.diagnostics.some(
				(d) => d.type === "error" && d.message === "--mode requires text, json, rpc, or gui",
			),
			"missing --mode value should record '--mode requires text, json, rpc, or gui'",
		);

		const flagAfterModeArgs = parseArgs(["--mode", "--gui"]);
		assertEqual(flagAfterModeArgs.gui, true, "--mode before --gui should still parse --gui");
		assert(
			flagAfterModeArgs.diagnostics.some((d) => d.message === "--mode requires text, json, rpc, or gui"),
			"--mode before --gui should report missing --mode value",
		);
	});

	// 33. Wave 2 Waku theme palette and full 3-pane desktop GUI shell integration
	await runCase("gui:waku-theme-and-3pane-shell", async () => {
		assertEqual(colorToHex(darkGuiTheme.background).toLowerCase(), "#1a1a1a", "Waku dark background color");
		assertEqual(colorToHex(darkGuiTheme.sidebarBg).toLowerCase(), "#181818", "Waku dark sidebarBg color");
		assertEqual(colorToHex(darkGuiTheme.accent).toLowerCase(), "#e2795b", "Waku dark Coral accent color");
		assertEqual(colorToHex(lightGuiTheme.background).toLowerCase(), "#f6f5f6", "Waku light background color");

		const layoutTmp = mkdtempSync(join(tmpdir(), "pi-waku-layout-"));
		try {
			saveGuiLayoutPreferences(
				{
					appearance: "light",
					sidebarWidth: 312,
					sidebarCollapsed: false,
					rightPanelWidth: 420,
					rightPanelOpen: true,
					rightPanelTab: "files",
					diffViewMode: "split",
					sidebarGroupBy: "project",
					pinnedSessionIds: ["mock-session-1"],
					sessionCustomNames: { "mock-session-1": "Waku Smoke" },
				},
				layoutTmp,
			);
			const loadedLayout = loadGuiLayoutPreferences(layoutTmp);
			assertEqual(loadedLayout.appearance, "light", "persisted appearance");
			assertEqual(loadedLayout.sidebarWidth, 312, "persisted sidebarWidth");
			assertEqual(loadedLayout.rightPanelWidth, 420, "persisted rightPanelWidth");
			assertEqual(loadedLayout.rightPanelTab, "files", "persisted rightPanelTab");
			assertEqual(loadedLayout.diffViewMode, "split", "persisted diffViewMode");
			assertEqual(loadedLayout.sidebarGroupBy, "project", "persisted sidebarGroupBy");

			const backend = new HeadlessBackend({ width: 1280, height: 840, darkMode: true, platform: "darwin" });
			const app = new GuiApp({
				backend,
				theme: darkGuiTheme,
				window: { title: "waku-3pane-test", width: 1280, height: 840, titlebarHidden: true, unifiedTitlebar: true },
				frameIntervalMs: 8,
			});
			const controller = new MockGuiSessionController({
				cwd: "/tmp/pi-ts-waku",
				stepDelayMs: 25,
				scenario: "with-tool",
				thinkingText: "Checking repository files cleanly.",
			});
			const handle = mountPiGui(app, { controller });
			try {
				app.renderFrame();
				assert(handle.sidebar !== undefined && handle.rightPanel !== undefined, "3-pane handles missing");
				assertEqual(backend.getWindowChrome()?.darkMode, true, "window chrome darkMode");
				assertEqual(backend.getWindowChrome()?.vibrancyEnabled, true, "window chrome vibrancyEnabled");

				// Sidebar grouping, pin, rename, session switch, and header Back/Forward
				const firstSession = (await controller.getSessions())[0];
				assert(firstSession !== undefined, "expected initial session");
				if (firstSession !== undefined) {
					await controller.renameSession(firstSession.id, "Renamed Primary");
					await controller.togglePinSession(firstSession.id);
				}
				await controller.newSession();
				app.renderFrame();
				assert(backend.getRenderedTexts().some((t) => t.includes("Renamed Primary")), "sidebar rename missing");
				assert(controller.canGoBack(), "expected Back history after newSession");
				await controller.goBack();
				assert(controller.canGoForward(), "expected Forward history after goBack");
				await controller.goForward();

				// Pane toggles and resize
				handle.sidebar.setWidth(300);
				assertEqual(handle.sidebar.getWidth(), 300, "sidebar resize");
				handle.toggleSidebar();
				assertEqual(backend.getWindowChrome()?.sidebarWidth, 0, "collapsed sidebar clears vibrancy inset");
				handle.toggleSidebar();
				assert(backend.getWindowChrome()!.sidebarWidth >= 180, "expanded sidebar restores vibrancy inset");

				// Right panel tabs: Changes (unified & split), Files preview, Tree
				handle.toggleRightPanel("changes");
				controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "changes", diffViewMode: "split" });
				app.renderFrame();
				assert(backend.getRenderedTexts().some((t) => t.includes("package.json")), "Changes tab file missing");
				handle.rightPanel.setActiveTab("files");
				app.renderFrame();
				assertEqual(handle.rightPanel.getActiveTab(), "files", "Right Panel Files tab");
				handle.rightPanel.setActiveTab("tree");
				app.renderFrame();
				assertEqual(handle.rightPanel.getActiveTab(), "tree", "Right Panel Tree tab");

				// Composer attachment + streaming prompt + steer queue + Worked-for turn cluster
				handle.composer.addAttachment({
					id: "att-1",
					kind: "file",
					name: "notes.md",
					path: "/tmp/pi-ts-waku/notes.md",
					sizeBytes: 128,
				});
				assertEqual(handle.composer.getAttachments().length, 1, "composer attachment count");
				const sendPromise = controller.sendUserMessage("Inspect package.json", { deliverAs: "auto" });
				await new Promise((r) => setTimeout(r, 10));
				await controller.sendUserMessage("Queued steer note", { deliverAs: "steer" });
				app.renderFrame();
				assert(backend.getRenderedTexts().some((t) => t.includes("Queued steer note")), "queued steer tray missing");
				await sendPromise;
				await new Promise((r) => setTimeout(r, 30));
				app.renderFrame();
				assert(backend.getRenderedTexts().some((t) => t.includes("Worked for")), "turn cluster Worked-for header missing");
				assert(handle.footerBar.getFormattedContextLabel().includes("%"), "footer context usage gauge label missing");

				// Find bar + Command Palette + Settings overlay + theme toggle
				handle.transcriptView.openFindBar();
				assertEqual(handle.transcriptView.isFindBarOpen(), true, "find bar should open");
				handle.transcriptView.closeFindBar();
				assertEqual(handle.transcriptView.isFindBarOpen(), false, "find bar should close");

				handle.openCommandPalette();
				assertEqual(handle.hasActiveOverlay(), true, "command palette should open");
				app.renderFrame();
				assert(
					backend.getRenderedTexts().some((t) => t.includes("Switch / Resume Session")),
					"command palette action list missing",
				);
				handle.closeOverlay();
				assertEqual(handle.hasActiveOverlay(), false, "command palette should close");

				handle.openSettings();
				assertEqual(handle.hasActiveOverlay(), true, "settings modal should open");
				app.renderFrame();
				assert(backend.getRenderedTexts().some((t) => t.includes("Appearance")), "settings rail missing");
				handle.closeOverlay();

				handle.toggleTheme();
				app.renderFrame();
				assertEqual(app.getTheme().dark, false, "toggleTheme should switch to light Waku theme");
			} finally {
				await handle.dispose();
				app.dispose();
			}
		} finally {
			rmSync(layoutTmp, { recursive: true, force: true });
		}
	});

	// 34. Wave 2 single-binary dist/pi GUI native and headless smoke execution
	await runCase("gui:pi-single-binary-native-smoke", async () => {
		const legacyGuiBin = resolve("dist/pi-gui");
		assertEqual(existsSync(legacyGuiBin), false, "legacy dist/pi-gui must not exist");

		const piBin = resolve("dist/pi");
		assert(existsSync(piBin), `single binary not built yet: ${piBin}`);

		const runPiSmoke = (
			cliArgs: readonly string[],
			smokeMode: "headless" | "native",
		): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
			new Promise((resolvePromise) => {
				let settled = false;
				const stdoutChunks: Buffer[] = [];
				const stderrChunks: Buffer[] = [];
				const env: Record<string, string> = {
					PATH: process.env.PATH ?? "/usr/bin:/bin",
					HOME: process.env.HOME ?? "/tmp",
					USER: process.env.USER ?? "user",
					SCRIPTC_LIBNODE: "/nonexistent",
				};
				if (smokeMode === "headless") {
					env.PI_GUI_HEADLESS_SMOKE = "1";
				} else {
					env.PI_GUI_NATIVE_SMOKE = "1";
				}
				const child = spawn(piBin, [...cliArgs], {
					stdio: ["ignore", "pipe", "pipe"],
					env,
				});
				const finish = (exitCode: number, extraErr = ""): void => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					const stderrText = Buffer.concat(stderrChunks).toString("utf8");
					resolvePromise({
						exitCode,
						stdout: Buffer.concat(stdoutChunks).toString("utf8"),
						stderr: extraErr.length > 0 ? `${stderrText}\n${extraErr}`.trim() : stderrText,
					});
				};
				const timer = setTimeout(() => {
					try {
						child.kill("SIGTERM");
					} catch {}
					finish(124, `${piBin} timed out after 20000ms`);
				}, 20_000);
				if (child.stdout) {
					child.stdout.on("data", (chunk: Buffer | string) => {
						stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
					});
				}
				if (child.stderr) {
					child.stderr.on("data", (chunk: Buffer | string) => {
						stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
					});
				}
				child.on("error", (err) => {
					finish(1, err.message);
				});
				child.on("close", (code, signal) => {
					finish(code ?? (signal ? 128 : 1), signal ? `signal=${signal}` : "");
				});
			});

		const cases: ReadonlyArray<readonly string[]> = [
			["--gui", "--no-session"],
			["--mode", "gui", "--no-session"],
		];
		for (let i = 0; i < cases.length; i++) {
			const cliArgs = cases[i];
			if (cliArgs === undefined) continue;

			const headlessRes = await runPiSmoke(cliArgs, "headless");
			assertEqual(
				headlessRes.exitCode,
				0,
				`dist/pi ${cliArgs.join(" ")} headless smoke exited ${headlessRes.exitCode}: ${headlessRes.stderr}`,
			);

			if (process.platform === "darwin" && isNativeDarwinAvailable()) {
				const nativeRes = await runPiSmoke(cliArgs, "native");
				assertEqual(
					nativeRes.exitCode,
					0,
					`dist/pi ${cliArgs.join(" ")} native smoke exited ${nativeRes.exitCode}: ${nativeRes.stderr}`,
				);
			}
		}
	});

	let passed = 0;
	let failed = 0;
	for (const r of results) {
		if (r.ok) {
			passed += 1;
			console.log(`PASS ${r.name}`);
		} else {
			failed += 1;
			console.error(`FAIL ${r.name}: ${r.error ?? "unknown error"}`);
		}
	}
	console.log(`SUMMARY passed=${passed} failed=${failed} total=${results.length}`);
	if (failed > 0) {
		process.exit(1);
	}
}

void main();
