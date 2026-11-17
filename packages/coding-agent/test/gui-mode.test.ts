import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { darkGuiTheme, GuiApp, type GuiA11yNode, HeadlessBackend, lightGuiTheme } from "@pi-ts/gui";
import { parseGuiCliArgs, runHeadlessSmoke } from "../src/gui-cli.ts";
import {
	extractAssistantContent,
	extractToolOutputSnippet,
	formatCompactToolArgs,
	MockGuiSessionController,
	mountPiGui,
} from "../src/modes/gui/index.ts";

function findNode(nodes: readonly GuiA11yNode[], predicate: (node: GuiA11yNode) => boolean): GuiA11yNode | undefined {
	for (const node of nodes) {
		if (predicate(node)) return node;
	}
	return undefined;
}

async function pumpUntil(app: GuiApp, predicate: () => boolean, timeoutMs = 1500): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		app.step(8);
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 3));
	}
	app.step(16);
	if (!predicate()) {
		throw new Error(`Timed out after ${timeoutMs}ms waiting for GUI condition`);
	}
}

describe("gui-mode", () => {
	it("parses GUI CLI flags cleanly", () => {
		const args = parseGuiCliArgs(
			["--headless-smoke", "--cwd", "/tmp/demo", "--provider", "anthropic", "--model", "claude-sonnet-4-5", "--prompt", "hi"],
			"/work",
		);
		expect(args.headlessSmoke).toBe(true);
		expect(args.nativeSmoke).toBe(false);
		expect(args.cwd).toBe("/tmp/demo");
		expect(args.provider).toBe("anthropic");
		expect(args.model).toBe("claude-sonnet-4-5");
		expect(args.prompt).toBe("hi");

		expect(() => parseGuiCliArgs(["--cwd"], "/work")).toThrow(/requires a path/);
		expect(() => parseGuiCliArgs(["--unknown"], "/work")).toThrow(/Unknown argument/);
	});

	it("formats compact tool args, tool output snippets, and assistant blocks", () => {
		expect(formatCompactToolArgs({ path: "src/index.ts", limit: 20 })).toBe('path: "src/index.ts", limit: 20');
		expect(extractToolOutputSnippet({ content: [{ type: "text", text: "line1\nline2" }] })).toBe("line1\nline2");

		const parsed = extractAssistantContent({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Step 1" },
				{ type: "text", text: "Answer body" },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
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
		expect(parsed.thinking).toBe("Step 1");
		expect(parsed.text).toBe("Answer body");
		expect(parsed.stopReason).toBe("stop");
	});

	it("runs deterministic headless-smoke end to end", async () => {
		const report = await runHeadlessSmoke(resolve(import.meta.dirname, "../../.."));
		expect(report.ok).toBe(true);
		expect(report.mode).toBe("headless-smoke");
		expect(report.frames).toBeGreaterThan(2);
		expect(report.a11yNodes).toBeGreaterThanOrEqual(6);
		expect(report.menuCount).toBe(4);
	});

	it("renders header controls, native menus, slash autocomplete, and slash commands", async () => {
		const backend = new HeadlessBackend({ width: 1120, height: 760 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "pi-ts", width: 1120, height: 760 } });
		const controller = new MockGuiSessionController({ cwd: "/repo/app", stepDelayMs: 1 });
		const handle = mountPiGui(app, { controller });

		try {
			app.renderFrame();

			const tree = backend.getAccessibilityTree();
			expect(findNode(tree, (n) => n.role === "button" && n.label === "New Session")).toBeDefined();
			expect(findNode(tree, (n) => n.role === "button" && n.label === "Toggle Theme")).toBeDefined();
			expect(findNode(tree, (n) => n.role === "button" && n.label === "Settings")).toBeDefined();
			expect(findNode(tree, (n) => n.role === "button" && n.label === "Send")).toBeDefined();
			expect(findNode(tree, (n) => n.role === "button" && n.label === "Stop")).toBeDefined();
			expect(findNode(tree, (n) => n.role === "textArea")).toBeDefined();
			expect(handle.stopButton.isDisabled()).toBe(true);

			// Verify Markdown & Loader & Badge accessibility nodes emitted by @pi-ts/gui
			expect(findNode(tree, (n) => n.role === "staticText" && n.label === "Ready")).toBeDefined();
			expect(findNode(tree, (n) => n.role === "staticText" && n.label === "app")).toBeDefined();
			expect(findNode(tree, (n) => n.role === "staticText" && n.label === "anthropic")).toBeDefined();
			expect(handle.workspaceBadge.getLabel()).toBe("app");
			expect(handle.providerBadge.getLabel()).toBe("anthropic");

			// Verify macOS menu structure
			const menus = backend.getMenus();
			expect(menus.map((m) => m.title)).toEqual(["App", "Session", "Edit", "Window"]);
			const sessionItems = menus[1]?.items.filter((i) => i.kind === "action") ?? [];
			expect(sessionItems.some((i) => i.label === "New Session" && i.shortcut === "mod+n")).toBe(true);
			expect(sessionItems.some((i) => i.label === "Switch Model" && i.shortcut === "mod+k")).toBe(true);
			expect(sessionItems.some((i) => i.label === "Clear Messages" && i.shortcut === "mod+l")).toBe(true);

			// Slash autocomplete
			app.setFocus(handle.editor);
			backend.insertText("/th");
			app.step(16);
			const items = handle.editor.getAutocompleteItems();
			expect(items.map((i) => i.value)).toEqual(expect.arrayContaining(["thinking", "theme"]));

			// Execute /theme light and /thinking high
			handle.editor.setText("");
			await handle.submitText("/theme light");
			app.step(16);
			expect(app.getTheme().dark).toBe(false);

			await handle.submitText("/thinking high");
			app.step(16);
			expect(controller.getStatus().thinkingLevel).toBe("high");
			expect(handle.thinkingButton.getLabel()).toBe("Thinking: high");
		} finally {
			await handle.dispose();
			app.dispose();
		}
	});

	it("opens and updates model picker and settings modals and closes on Escape", async () => {
		const backend = new HeadlessBackend({ width: 1120, height: 760 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "pi-ts", width: 1120, height: 760 } });
		const controller = new MockGuiSessionController({ cwd: "/repo/app", stepDelayMs: 1 });
		const handle = mountPiGui(app, { controller });

		try {
			app.renderFrame();

			// Model picker: open -> select second item -> updates header
			const modelBtn = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label.startsWith("Model:"));
			expect(modelBtn).toBeDefined();
			backend.triggerA11yPress(modelBtn!.id);
			app.step(16);
			expect(handle.hasActiveOverlay()).toBe(true);
			backend.pressKey("down");
			backend.pressKey("enter");
			await pumpUntil(app, () => !handle.hasActiveOverlay() && controller.getStatus().activeModel?.id === "gpt-4o");
			expect(handle.modelButton.getLabel()).toBe("Model: openai/gpt-4o");
			expect(handle.providerBadge.getLabel()).toBe("openai");

			// Settings modal: toggle Appearance + Escape close
			const settingsBtn = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Settings");
			expect(settingsBtn).toBeDefined();
			backend.triggerA11yPress(settingsBtn!.id);
			app.step(16);
			expect(handle.hasActiveOverlay()).toBe(true);
			backend.pressKey("enter"); // toggles Appearance dark -> light
			app.step(16);
			expect(app.getTheme()).toBe(lightGuiTheme);
			backend.pressKey("escape");
			app.step(16);
			expect(handle.hasActiveOverlay()).toBe(false);
		} finally {
			await handle.dispose();
			app.dispose();
		}
	});

	it("streams assistant markdown, tool execution cards, errors, and stop abort", async () => {
		const backend = new HeadlessBackend({ width: 1120, height: 760 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "pi-ts", width: 1120, height: 760 } });
		const controller = new MockGuiSessionController({
			cwd: "/repo/app",
			stepDelayMs: 15,
			scenario: "with-tool",
		});
		const handle = mountPiGui(app, { controller });

		try {
			app.renderFrame();

			// Trigger streaming prompt with tool
			const promptPromise = handle.submitText("Run [tool]");
			await pumpUntil(app, () => controller.getStatus().isStreaming);
			expect(handle.stopButton.isDisabled()).toBe(false);
			expect(handle.statusLoader.isRunning()).toBe(true);

			await promptPromise;
			await pumpUntil(app, () => !controller.getStatus().isStreaming && backend.getRenderedTexts().some((t) => t.includes("Complete")));
			expect(handle.stopButton.isDisabled()).toBe(true);
			expect(backend.getRenderedTexts().some((t) => t.includes("Tool: read"))).toBe(true);
			expect(backend.getRenderedTexts().some((t) => t.includes("Summary"))).toBe(true);
			expect(
				findNode(
					backend.getAccessibilityTree(),
					(n) => n.role === "staticText" && n.label.includes("Summary"),
				),
			).toBeDefined();

			// Error scenario
			await handle.submitText("__error__");
			await pumpUntil(app, () => backend.getRenderedTexts().some((t) => t.includes("upstream request failed")));
			expect(backend.getRenderedTexts().some((t) => t.includes("Error"))).toBe(true);

			// Abort while streaming via Stop button press
			const slowPrompt = handle.submitText("Long task");
			await pumpUntil(app, () => controller.getStatus().isStreaming);
			const stopNode = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Stop");
			expect(stopNode).toBeDefined();
			backend.triggerA11yPress(stopNode!.id);
			app.step(16);
			await slowPrompt;
			app.step(16);
			expect(backend.getRenderedTexts().some((t) => t.includes("Stopped") || t.includes("Generation stopped."))).toBe(true);
		} finally {
			await handle.dispose();
			app.dispose();
		}
	});
});
