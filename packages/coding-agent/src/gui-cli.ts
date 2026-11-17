#!/usr/bin/env node
import { resolve } from "node:path";
import { darkGuiTheme, GuiApp, type GuiA11yNode, HeadlessBackend } from "scriptc-ui";
import { createNativeBackend } from "scriptc-ui/native";
import { setupCli } from "./cli/setup.ts";
import {
	createRealGuiSessionController,
	type GuiCliArgs,
	MockGuiSessionController,
	mountPiGui,
} from "./modes/gui/index.ts";

/**
 * Parse CLI flags for the pi-native desktop GUI entrypoint.
 */
export function parseGuiCliArgs(argv: readonly string[], baseCwd = process.cwd()): GuiCliArgs {
	let headlessSmoke = false;
	let nativeSmoke = false;
	let cwd = baseCwd;
	let provider: string | undefined;
	let model: string | undefined;
	let prompt: string | undefined;
	let help = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === undefined) continue;

		if (arg === "--headless-smoke") {
			headlessSmoke = true;
		} else if (arg === "--native-smoke") {
			nativeSmoke = true;
		} else if (arg === "--help" || arg === "-h") {
			help = true;
		} else if (arg === "--cwd") {
			const val = argv[++i];
			if (!val) throw new Error("--cwd requires a path argument");
			cwd = resolve(baseCwd, val);
		} else if (arg.startsWith("--cwd=")) {
			const val = arg.slice("--cwd=".length);
			if (!val) throw new Error("--cwd requires a path argument");
			cwd = resolve(baseCwd, val);
		} else if (arg === "--provider") {
			const val = argv[++i];
			if (!val) throw new Error("--provider requires a provider id");
			provider = val;
		} else if (arg.startsWith("--provider=")) {
			const val = arg.slice("--provider=".length);
			if (!val) throw new Error("--provider requires a provider id");
			provider = val;
		} else if (arg === "--model") {
			const val = argv[++i];
			if (!val) throw new Error("--model requires a model id");
			model = val;
		} else if (arg.startsWith("--model=")) {
			const val = arg.slice("--model=".length);
			if (!val) throw new Error("--model requires a model id");
			model = val;
		} else if (arg === "--prompt") {
			const val = argv[++i];
			if (val === undefined) throw new Error("--prompt requires text");
			prompt = val;
		} else if (arg.startsWith("--prompt=")) {
			prompt = arg.slice("--prompt=".length);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return {
		headlessSmoke,
		nativeSmoke,
		cwd,
		provider,
		model,
		prompt,
		help,
	};
}

function printGuiHelp(): void {
	console.log(`Usage: pi-gui [options]

Options:
  --cwd <path>         Workspace directory (defaults to current working directory)
  --provider <id>      Initial model provider override
  --model <id>         Initial model id or pattern override
  --prompt <text>      Optional initial prompt to submit automatically
  --headless-smoke     Run deterministic HeadlessBackend verification and print JSON
  --native-smoke       Run real native macOS window creation smoke check and print JSON
  -h, --help           Show this help output`);
}

function findA11yNode(
	nodes: readonly GuiA11yNode[],
	predicate: (node: GuiA11yNode) => boolean,
): GuiA11yNode | undefined {
	for (const node of nodes) {
		if (predicate(node)) return node;
	}
	return undefined;
}

function assertCondition(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(`Smoke verification failed: ${message}`);
	}
}

export interface HeadlessSmokeReport {
	readonly ok: true;
	readonly mode: "headless-smoke";
	readonly frames: number;
	readonly a11yNodes: number;
	readonly menuCount: number;
	readonly renderedTextCount: number;
	readonly autocompleteMatches: number;
}

/**
 * Run deterministic end-to-end GUI smoke verification against HeadlessBackend.
 */
export async function runHeadlessSmoke(cwd: string): Promise<HeadlessSmokeReport> {
	const backend = new HeadlessBackend({ width: 1120, height: 760 });
	const app = new GuiApp({
		backend,
		theme: darkGuiTheme,
		window: { title: "pi-native", width: 1120, height: 760 },
		frameIntervalMs: 8,
	});
	const controller = new MockGuiSessionController({
		cwd,
		stepDelayMs: 2,
		scenario: "with-tool",
	});
	const handle = mountPiGui(app, { controller });

	try {
		app.renderFrame();

		// 1. Slash autocomplete check
		app.setFocus(handle.editor);
		backend.insertText("/th");
		app.step(16);
		const autocompleteItems = handle.editor.getAutocompleteItems();
		assertCondition(
			autocompleteItems.some((item) => item.value === "theme") &&
				autocompleteItems.some((item) => item.value === "thinking"),
			"Expected /th autocomplete suggestions to include theme and thinking",
		);
		handle.editor.setText("");
		app.step(16);

		// 2. Settings modal open + Escape close via accessibility tree
		const settingsNode = findA11yNode(
			backend.getAccessibilityTree(),
			(n) => n.role === "button" && n.label === "Settings",
		);
		assertCondition(settingsNode !== undefined, "Missing Settings button accessibility node");
		backend.triggerA11yPress(settingsNode!.id);
		app.step(16);
		assertCondition(handle.hasActiveOverlay(), "Settings modal should open on button press");
		assertCondition(
			backend.getRenderedTexts().some((t) => t.includes("Appearance")),
			"Settings modal should render Appearance item",
		);
		backend.pressKey("escape");
		app.step(16);
		assertCondition(!handle.hasActiveOverlay(), "Settings modal should close on Escape");

		// 3. Model picker modal open + Escape close
		const modelNode = findA11yNode(
			backend.getAccessibilityTree(),
			(n) => n.role === "button" && n.label.startsWith("Model:"),
		);
		assertCondition(modelNode !== undefined, "Missing Model picker button accessibility node");
		backend.triggerA11yPress(modelNode!.id);
		app.step(16);
		assertCondition(handle.hasActiveOverlay(), "Model picker modal should open on button press");
		assertCondition(
			backend.getRenderedTexts().some((t) => t.includes("Select Model") || t.includes("Switch Model")),
			"Model picker modal should render Select Model header",
		);
		backend.pressKey("escape");
		app.step(16);
		assertCondition(!handle.hasActiveOverlay(), "Model picker modal should close on Escape");

		// 4. Prompt submission + streaming assistant markdown + tool execution card render
		app.setFocus(handle.editor);
		backend.insertText("Verify workspace status");
		app.step(16);
		const sendNode = findA11yNode(
			backend.getAccessibilityTree(),
			(n) => n.role === "button" && n.label === "Send",
		);
		assertCondition(sendNode !== undefined, "Missing Send button accessibility node");
		backend.triggerA11yPress(sendNode!.id);
		app.step(8);

		const deadline = Date.now() + 2500;
		while (Date.now() < deadline) {
			app.step(8);
			if (!controller.getStatus().isStreaming && backend.getRenderedTexts().some((t) => t.includes("Complete"))) {
				break;
			}
			await new Promise((r) => setTimeout(r, 4));
		}
		app.step(16);

		const renderedTexts = backend.getRenderedTexts();
		assertCondition(
			renderedTexts.some((t) => t.includes("Verify workspace status")),
			"User prompt text should render in conversation viewport",
		);
		assertCondition(
			renderedTexts.some((t) => t.includes("Tool: read")),
			"Tool execution card should render",
		);
		assertCondition(
			renderedTexts.some((t) => t.includes("Summary")),
			"Assistant streamed markdown heading should render",
		);

		const a11yTree = backend.getAccessibilityTree();
		assertCondition(a11yTree.length >= 6, "Expected accessibility nodes in tree");
		assertCondition(
			findA11yNode(a11yTree, (n) => n.role === "textArea") !== undefined,
			"Expected editor textArea accessibility node",
		);
		assertCondition(backend.getMenus().length === 4, "Expected 4 top-level native menus");

		return {
			ok: true,
			mode: "headless-smoke",
			frames: backend.getFrameCount(),
			a11yNodes: a11yTree.length,
			menuCount: backend.getMenus().length,
			renderedTextCount: renderedTexts.length,
			autocompleteMatches: autocompleteItems.length,
		};
	} finally {
		await handle.dispose();
		app.dispose();
	}
}

export interface NativeSmokeReport {
	readonly ok: true;
	readonly mode: "native-smoke";
	readonly width: number;
	readonly height: number;
	readonly scale: number;
	readonly menuCount: number;
}

/**
 * Create a real native macOS window, render initial frames, validate metrics, and dispose cleanly.
 */
export async function runNativeSmoke(cwd: string): Promise<NativeSmokeReport> {
	const backend = createNativeBackend();
	const app = new GuiApp({
		backend,
		theme: darkGuiTheme,
		window: {
			title: "pi-native (smoke)",
			width: 1120,
			height: 760,
			resizable: true,
		},
		frameIntervalMs: 16,
	});
	const controller = new MockGuiSessionController({ cwd });
	const handle = mountPiGui(app, { controller });

	try {
		app.renderFrame();
		app.step(16);
		app.renderFrame();

		const metrics = app.getWindowMetrics();
		assertCondition(metrics.width > 0 && metrics.height > 0, "Expected positive native window metrics");
		assertCondition(handle.menus.length === 4, "Expected 4 top-level native menus");

		return {
			ok: true,
			mode: "native-smoke",
			width: metrics.width,
			height: metrics.height,
			scale: metrics.scale,
			menuCount: handle.menus.length,
		};
	} finally {
		await handle.dispose();
		app.dispose();
	}
}

/**
 * Launch interactive desktop GUI backed by live AgentSessionRuntime and ~/.pi/agent/auth.json.
 */
export async function runInteractiveGui(args: GuiCliArgs): Promise<void> {
	setupCli();

	const controller = await createRealGuiSessionController({
		cwd: args.cwd,
		provider: args.provider,
		model: args.model,
	});

	const backend = createNativeBackend();
	const app = new GuiApp({
		backend,
		theme: darkGuiTheme,
		window: {
			title: `pi-native — ${args.cwd}`,
			width: 1120,
			height: 760,
			resizable: true,
		},
		frameIntervalMs: 8,
	});
	const handle = mountPiGui(app, {
		controller,
		initialPrompt: args.prompt,
	});

	try {
		await app.run();
	} finally {
		await handle.dispose();
		app.dispose();
	}
}

export async function main(argv: readonly string[]): Promise<number> {
	const args = parseGuiCliArgs(argv);

	if (args.help) {
		printGuiHelp();
		return 0;
	}
	if (args.headlessSmoke) {
		const report = await runHeadlessSmoke(args.cwd);
		console.log(JSON.stringify(report));
		return 0;
	}
	if (args.nativeSmoke) {
		const report = await runNativeSmoke(args.cwd);
		console.log(JSON.stringify(report));
		return 0;
	}

	await runInteractiveGui(args);
	return 0;
}

if (!process.env.VITEST) {
	main(process.argv.slice(2))
		.then((code) => {
			if (code !== 0) process.exit(code);
		})
		.catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
}
