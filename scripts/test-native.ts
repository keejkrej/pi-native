import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
} from "@earendil-works/pi-schema";

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
} from "scriptc-ui";

import { AnthropicHttpClient } from "../packages/ai/src/api/anthropic-http.ts";
import { getJsonSchemaToolParameters } from "../packages/ai/src/api/constrained-sampling.ts";
import { stripSchemaMetaKeys } from "../packages/ai/src/utils/json-schema.ts";
import { toToolDeclaration } from "../packages/ai/src/utils/transcript.ts";
import { validateToolArguments } from "../packages/ai/src/utils/validation.ts";
import {
	buildBedrockConverseStreamUrl,
	parseBedrockEventStream,
	serializeBedrockPayload,
	signAwsSigV4,
} from "../packages/ai/src/api/bedrock-eventstream.ts";
import {
	buildMldevStreamUrl,
	buildVertexStreamUrl,
	GoogleGenAI,
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
	MockGuiSessionController,
	mountPiGui,
} from "../packages/coding-agent/src/modes/gui/index.ts";

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
		const res = crossSpawnSync("/bin/echo", ["pi-native-spawn"], { encoding: "utf8" });
		assertEqual(res.status, 0, "cross-spawn status");
		assert(res.stdout.trim() === "pi-native-spawn", `unexpected stdout: ${res.stdout}`);
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
		const info = hostedGitFromUrl("https://github.com/earendil-works/pi-native.git");
		assert(info !== undefined, "hosted-git-info returned undefined");
		if (info) {
			assertEqual(info.user, "earendil-works", "hosted-git-info user");
			assertEqual(info.project, "pi-native", "hosted-git-info project");
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
		const dir = mkdtempSync(join(tmpdir(), "pi-native-lock-"));
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
		const objVal = parseYaml("name: pi-native\nitems:\n  - a\n  - b\n") as {
			name: string;
			items: string[];
		};
		assertEqual(objVal.name, "pi-native", "yaml.parse name");
		assertEqual(objVal.items.length, 2, "yaml.parse items length");
		const dumped = stringifyYaml(objVal);
		assert(dumped.includes("pi-native"), "yaml.stringify failed");
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

	// 18. @earendil-works/pi-schema
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

	// 19. scriptc-ui + packages/coding-agent/src/modes/gui
	await runCase("package:scriptc-ui+coding-agent-gui", async () => {
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
			cwd: "/tmp/pi-native",
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
			window: { title: "pi-native-test", width: 1024, height: 720 },
			frameIntervalMs: 8,
		});
		const controller = new MockGuiSessionController({
			cwd: "/tmp/pi-native",
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
			JSON.stringify({ contentBlockIndex: 0, delta: { text: "bedrock-ok" } }),
		);
		const decodedEvents: string[] = [];
		for await (const ev of parseBedrockEventStream(buildBinaryResponse([frame]))) {
			if (ev.contentBlockDelta?.delta?.text) {
				decodedEvents.push(ev.contentBlockDelta.delta.text);
			}
		}
		assertEqual(decodedEvents.join(""), "bedrock-ok", "parseBedrockEventStream text mismatch");
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
