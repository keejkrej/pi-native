import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	darkGuiTheme,
	GuiApp,
	type GuiA11yNode,
	HeadlessBackend,
	lightGuiTheme,
	SGUI_MOD_SHIFT,
	SGUI_MOD_SUPER,
	Spacer,
	VStack,
} from "@pi-ts/gui";
import {
	createBashCard,
	createBranchSummaryCard,
	createCompactionCard,
	createExtensionWidgetCard,
	createToolExecutionCard,
	createTurnClusterCard,
	createUserMessageCard,
	createWelcomeCard,
} from "../src/modes/gui/cards.ts";
import { createWakuComposer, createWakuFooterBar } from "../src/modes/gui/composer.ts";
import { MockGuiSessionController } from "../src/modes/gui/controller.ts";
import { createWakuTranscriptView } from "../src/modes/gui/transcript.ts";
import type { GuiSessionSnapshot } from "../src/modes/gui/types.ts";

// Minimal valid 2x2 PNG bytes (IHDR width=2, height=2)
const TINY_PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d,
	0x24, 0x00, 0x00, 0x00, 0x0e, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
	0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99,
	0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
	0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function findA11yNode(
	nodes: readonly GuiA11yNode[],
	predicate: (node: GuiA11yNode) => boolean,
): GuiA11yNode | undefined {
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n !== undefined && predicate(n)) return n;
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

describe("waku-transcript-composer", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir !== undefined) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("renders Waku cards with asymmetric user bubble, turn cluster, tool diff/open callbacks, and theme switching", () => {
		const backend = new HeadlessBackend({ width: 960, height: 800 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "cards", width: 960, height: 800 } });

		const controller = new MockGuiSessionController({ cwd: "/repo/waku-cards" });
		let copiedText = "";
		let forkedText = "";
		let openedPath = "";
		let viewedDiffTool = "";
		let jumpedChangedFile = "";

		const welcome = createWelcomeCard(darkGuiTheme, controller.getStatus());
		const userCard = createUserMessageCard(
			darkGuiTheme,
			"Inspect the failing tests and fix them.",
			{
				attachments: [
					{ id: "att-1", kind: "image", name: "screenshot.png", sizeBytes: 4096 },
					{ id: "att-2", kind: "pasted-text", name: "Pasted text (22 lines)", sizeBytes: 1200 },
				],
				onCopy: (text) => {
					copiedText = text;
				},
				onFork: (text) => {
					forkedText = text;
				},
			},
		);

		const cluster = createTurnClusterCard(darkGuiTheme, {
			onOpenFile: (path) => {
				openedPath = path;
			},
			onViewDiff: (toolName) => {
				viewedDiffTool = toolName;
			},
			onOpenChangedFile: (path) => {
				jumpedChangedFile = path;
			},
		});
		cluster.upsertTool("t1", {
			toolName: "edit",
			argsText: 'path: "src/index.ts"',
			outputText: "@@ -1,2 +1,3 @@\n export const ok = true;\n+export const fixed = true;\n-export const old = false;",
			ended: true,
			isError: false,
			durationMs: 185,
		});
		cluster.updateTurn({
			thinking: "Let's read packages/gui/src/index.ts first to trace exports.",
			text: "Updated `src/index.ts` and verified exports.",
			ended: true,
			durationMs: 2400,
			changedFiles: [
				{
					path: "src/index.ts",
					status: "M",
					additions: 1,
					deletions: 1,
					hunks: [],
				},
			],
		});

		const standaloneTool = createToolExecutionCard(darkGuiTheme, "read", 'path: "README.md"', {
			onOpenFile: (path) => {
				openedPath = path;
			},
		});
		standaloneTool.setExpanded(true);
		standaloneTool.update({ outputText: "# README\nDocs line", ended: true, isError: false, durationMs: 45 });

		const bashCard = createBashCard(darkGuiTheme, {
			command: "bun test",
			text: "bun test",
			outputText: "6 pass\n0 fail",
			exitCode: 0,
			isError: false,
			durationMs: 310,
		});
		const compactCard = createCompactionCard(darkGuiTheme, { text: "Compacted 18 earlier turns." });
		const branchCard = createBranchSummaryCard(darkGuiTheme, { text: "Branched from checkpoint 2A." });
		const widgetCard = createExtensionWidgetCard(darkGuiTheme, {
			key: "lint-status",
			lines: ["0 errors", "2 warnings"],
		});

		const stack = new VStack({
			gap: 10,
			fillWidth: true,
			children: [
				welcome.root,
				userCard.root,
				cluster.root,
				standaloneTool.root,
				bashCard.root,
				compactCard.root,
				branchCard.root,
				widgetCard.root,
			],
		});
		app.setRoot(stack);
		app.renderFrame();

		const texts = backend.getRenderedTexts().join("\n");
		expect(texts).toContain("screenshot.png");
		expect(texts).toContain("Worked for 2.4s · 1 tool");
		expect(texts).toContain("Modified files");
		expect(texts).toContain("src/index.ts");
		expect(texts).toContain("+1");
		expect(texts).toContain("-1");
		expect(texts).toContain("bun test");
		expect(texts).toContain("exit 0");
		expect(texts).toContain("Context compacted");
		expect(texts).toContain("Branch summary");
		expect(texts).toContain("lint-status");

		// Rounded rect command for Waku user bubble (radius 12) & capped bubble width <= 540
		const cmds = backend.getLastFrameCommands();
		const bubbleCmd = cmds.find((c) => c.kind === "fillRoundedRect" && c.radius === 12);
		expect(bubbleCmd).toBeDefined();
		if (bubbleCmd !== undefined && bubbleCmd.kind === "fillRoundedRect") {
			expect(bubbleCmd.w).toBeLessThanOrEqual(540);
			expect(bubbleCmd.radius).toBe(12);
		}

		// Expand turn cluster and exercise Fork, Copy, Open File, View Diff, Changed File callbacks
		const nodes = backend.getAccessibilityTree();
		const copyBtn = findA11yNode(nodes, (n) => n.role === "button" && n.label === "Copy");
		const forkBtn = findA11yNode(nodes, (n) => n.role === "button" && n.label === "Fork from here");
		const clusterToggle = findA11yNode(nodes, (n) => n.role === "button" && n.label.startsWith("Worked for 2.4s"));
		const changedFileBtn = findA11yNode(nodes, (n) => n.role === "button" && n.label === "src/index.ts +1 -1");
		expect(copyBtn).toBeDefined();
		expect(forkBtn).toBeDefined();
		expect(clusterToggle).toBeDefined();
		expect(changedFileBtn).toBeDefined();

		backend.triggerA11yPress(copyBtn!.id);
		backend.triggerA11yPress(forkBtn!.id);
		backend.triggerA11yPress(changedFileBtn!.id);
		backend.triggerA11yPress(clusterToggle!.id); // Expand cluster to expose thinking & tool rows
		app.step(8);

		const expandedJoined = backend.getRenderedTexts().join("");
		expect(expandedJoined).toContain("trace exports");
		expect(expandedJoined).toContain("Tool: edit");

		// Expand the nested edit tool row to reveal diff hunks + Open File / View Diff in Panel actions
		const editToolToggle = findA11yNode(
			backend.getAccessibilityTree(),
			(n) => n.role === "button" && n.label === "Tool: edit",
		);
		expect(editToolToggle).toBeDefined();
		backend.triggerA11yPress(editToolToggle!.id);
		app.step(8);

		const nodesExpanded = backend.getAccessibilityTree();
		const openFileBtn = findA11yNode(
			nodesExpanded,
			(n) => n.role === "button" && n.label === "Open File" && n.rect.y < standaloneTool.root.layoutRect.y,
		);
		const viewDiffBtn = findA11yNode(nodesExpanded, (n) => n.role === "button" && n.label === "View Diff in Panel");
		expect(openFileBtn).toBeDefined();
		expect(viewDiffBtn).toBeDefined();

		backend.triggerA11yPress(openFileBtn!.id);
		backend.triggerA11yPress(viewDiffBtn!.id);
		app.step(8);

		expect(copiedText).toBe("Inspect the failing tests and fix them.");
		expect(forkedText).toBe("Inspect the failing tests and fix them.");
		expect(jumpedChangedFile).toBe("src/index.ts");
		expect(openedPath).toBe("src/index.ts");
		expect(viewedDiffTool).toBe("edit");

		// Switch dark <-> light themes cleanly
		app.setTheme(lightGuiTheme);
		welcome.applyTheme(lightGuiTheme);
		userCard.applyTheme(lightGuiTheme);
		cluster.applyTheme(lightGuiTheme);
		standaloneTool.applyTheme(lightGuiTheme);
		bashCard.applyTheme(lightGuiTheme);
		compactCard.applyTheme(lightGuiTheme);
		branchCard.applyTheme(lightGuiTheme);
		widgetCard.applyTheme(lightGuiTheme);
		app.renderFrame();
		expect(backend.getRenderedTexts().join("\n")).toContain("Updated");
	});

	it("renders empty state hero, groups live streams, searches with Cmd+F, and toggles floating jump-to-bottom pill", async () => {
		const backend = new HeadlessBackend({ width: 1000, height: 640 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "transcript", width: 1000, height: 640 } });
		const controller = new MockGuiSessionController({
			cwd: "/repo/waku-app",
			stepDelayMs: 2,
			scenario: "with-tool",
			responseChunks: [
				"## Overview\nThe alpha token lives in `transcript.ts`.\n\n",
				"Another alpha token appears in `composer.ts`.\n\n".repeat(14),
			],
			thinkingText: "Scanning repository modules and checking alpha symbol references...",
		});

		const view = createWakuTranscriptView(app, controller);
		app.setRoot(view.root);
		app.renderFrame();

		// Waku v0.1.20 centered empty state visible with sparkle icon & project heading
		expect(view.isShowingEmptyState()).toBe(true);
		const heroTexts = backend.getRenderedTexts().join("\n");
		expect(heroTexts).toContain("What should we build in waku-app?");
		expect(backend.getLastFrameCommands().some((c) => c.kind === "drawText" && c.text.includes("What should we build in waku-app?"))).toBe(true);

		// Execute prompt & user bash command (bash should not duplicate)
		void controller.prompt("Check alpha references");
		await pumpUntil(app, () => !controller.getStatus().isStreaming && controller.getTranscript().length >= 2);
		await controller.executeBashCommand("git status");
		app.step(16);

		expect(view.isShowingEmptyState()).toBe(false);
		const transcriptTexts = backend.getRenderedTexts().join("\n");
		expect(transcriptTexts).toContain("Check alpha references");
		expect(transcriptTexts).toContain("Worked for");
		expect(transcriptTexts).toContain("git status");
		// Bash entry appears once as a bash card, not duplicated as an extra standalone tool card
		const bashMatches = transcriptTexts.match(/Mock bash output for: git status/g);
		expect(bashMatches === null ? 0 : bashMatches.length).toBeLessThanOrEqual(1);

		// Cmd+F Find Bar opens, counts matches across transcript, steps next/prev, and closes on Esc
		view.openFindBar();
		app.step(8);
		expect(view.isFindBarOpen()).toBe(true);
		view.setFindQuery("alpha");
		app.step(8);

		const matchInfo = view.getFindMatchInfo();
		expect(matchInfo.total).toBeGreaterThan(2);
		expect(matchInfo.current).toBe(1);
		expect(backend.getRenderedTexts().join("\n")).toContain(`1 / ${matchInfo.total}`);

		view.nextFindMatch();
		app.step(8);
		expect(view.getFindMatchInfo().current).toBe(2);

		view.prevFindMatch();
		app.step(8);
		expect(view.getFindMatchInfo().current).toBe(1);

		view.closeFindBar();
		app.step(8);
		expect(view.isFindBarOpen()).toBe(false);

		// Scroll up so !isFollowingEnd() makes floating Scroll to bottom pill appear, then click it
		const preMaxScroll = view.scrollView.getMaxScrollY();
		if (preMaxScroll > 20) {
			backend.wheel(400, 300, 0, -250);
			app.step(16);
			expect(view.scrollView.isFollowingEnd()).toBe(false);
			const scrollNodes = backend.getAccessibilityTree();
			const jumpBtn = findA11yNode(scrollNodes, (n) => n.role === "button" && n.label === "Scroll to bottom");
			expect(jumpBtn).toBeDefined();
			backend.triggerA11yPress(jumpBtn!.id);
			app.step(16);
			expect(view.scrollView.isFollowingEnd()).toBe(true);
		}

		// Snapshot rehydration restores transcript & clearMessages returns to empty state
		controller.clearMessages();
		app.step(16);
		expect(view.isShowingEmptyState()).toBe(true);

		const rehydratedSnap: GuiSessionSnapshot = {
			...controller.getSnapshot(),
			transcript: [
				{ id: "u1", role: "user", text: "Rehydrated prompt" },
				{ id: "a1", role: "assistant", text: "Rehydrated reply", thinking: "Checked branch", turnDurationMs: 900 },
			],
		};
		view.applySnapshot(rehydratedSnap);
		app.step(8);
		expect(view.isShowingEmptyState()).toBe(false);
		expect(backend.getRenderedTexts().join("\n")).toContain("Rehydrated prompt");

		view.dispose();
	});

	it("handles floating composer submission, !/!! bash prefixes, queue tray, Cmd+V image/pasted-text interception, and / & @ autocomplete", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "waku-composer-test-"));
		tempDirs.push(tmpDir);
		const tmpImgPath = join(tmpDir, "preview.png");
		writeFileSync(tmpImgPath, TINY_PNG_BYTES);

		const backend = new HeadlessBackend({ width: 960, height: 680 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "composer", width: 960, height: 680 } });
		const controller = new MockGuiSessionController({ cwd: tmpDir, stepDelayMs: 12 });

		let mockClipboardPng: Uint8Array | null = TINY_PNG_BYTES;
		let modelPickerOpened = 0;
		let attachDialogOpened = 0;

		const composer = createWakuComposer(app, controller, {
			clipboard: {
				hasImage: () => mockClipboardPng !== null,
				readImagePng: () => mockClipboardPng,
				readFilePaths: () => [],
			},
			onOpenModelPicker: () => {
				modelPickerOpened += 1;
			},
			onOpenAttachDialog: () => {
				attachDialogOpened += 1;
			},
		});

		const rootStack = new VStack({ gap: 8, fillWidth: true, children: [composer.root] });
		app.setRoot(rootStack);
		app.renderFrame();
		composer.focus();
		app.step(8);

		// 1. Slash command & @ workspace file autocomplete
		backend.insertText("/comp");
		app.step(8);
		const slashItems = composer.getAutocompleteItems();
		expect(slashItems.some((item) => item.value === "compact")).toBe(true);
		backend.pressKey("Tab");
		app.step(8);
		expect(composer.editor.getText()).toBe("/compact ");
		composer.setText("");

		backend.insertText("check @src");
		app.step(8);
		const atItems = composer.getAutocompleteItems();
		expect(atItems.some((item) => item.value.startsWith("@src"))).toBe(true);
		backend.pressKey("Enter");
		app.step(8);
		expect(composer.editor.getText()).toContain("@src/");
		composer.setText("");

		// 2. Cmd+V intercepts native image clipboard PNG bytes -> creates image tile
		backend.pressKey("v", SGUI_MOD_SUPER);
		app.step(8);
		expect(composer.getAttachments().length).toBe(1);
		expect(composer.getAttachments()[0]?.kind).toBe("image");
		expect(composer.getAttachments()[0]?.name).toContain("2x2.png");
		expect(composer.editor.getText()).toBe("");

		// 3. Cmd+V intercepts image file path on clipboard -> reads file and attaches tile
		mockClipboardPng = null;
		backend.setClipboardText(tmpImgPath);
		backend.pressKey("v", SGUI_MOD_SUPER);
		app.step(8);
		expect(composer.getAttachments().length).toBe(2);
		expect(composer.getAttachments()[1]?.kind).toBe("image");
		expect(composer.getAttachments()[1]?.name).toBe("preview.png");

		// 4. Cmd+V intercepts >15-line clipboard paste -> creates "pasted-text" tile
		const longLines = Array.from({ length: 18 }, (_, i) => `line ${i + 1}: payload`).join("\n");
		backend.setClipboardText(longLines);
		backend.pressKey("v", SGUI_MOD_SUPER);
		app.step(8);
		expect(composer.getAttachments().length).toBe(3);
		expect(composer.getAttachments()[2]?.kind).toBe("pasted-text");
		expect(composer.getAttachments()[2]?.name).toBe("Pasted text (18 lines)");

		// Remove one attachment via its × accessibility button
		const removeImgBtn = findA11yNode(
			backend.getAccessibilityTree(),
			(n) => n.role === "button" && n.label === "Remove attachment preview.png",
		);
		expect(removeImgBtn).toBeDefined();
		backend.triggerA11yPress(removeImgBtn!.id);
		app.step(8);
		expect(composer.getAttachments().length).toBe(2);

		// 5. Shift+Enter inserts newline; !/!! prefix executes bash without LLM prompt
		backend.insertText("echo line1");
		backend.pressKey("Enter", SGUI_MOD_SHIFT);
		backend.insertText("echo line2");
		app.step(8);
		expect(composer.editor.getText()).toContain("echo line1\necho line2");

		composer.setText("!git status");
		app.step(8);
		expect(backend.getRenderedTexts().join("\n")).toContain("! Shell");
		backend.pressKey("Enter");
		await pumpUntil(app, () => controller.getTranscript().some((e) => e.role === "bash" && e.command === "git status"));

		composer.setText("!!pwd");
		backend.pressKey("Enter");
		await pumpUntil(app, () => controller.getTranscript().some((e) => e.role === "bash" && e.command === "pwd"));

		// 6. Control bar pills: Model, Thinking cycle, Attach +
		const ctrlNodes = backend.getAccessibilityTree();
		const modelBtn = findA11yNode(ctrlNodes, (n) => n.role === "button" && n.label.includes("claude-sonnet-4-5"));
		const thinkingBtn = findA11yNode(ctrlNodes, (n) => n.role === "button" && n.label.startsWith("Thinking:"));
		const attachBtn = findA11yNode(ctrlNodes, (n) => n.role === "button" && n.label === "Attach clipboard image");
		expect(modelBtn).toBeDefined();
		expect(thinkingBtn).toBeDefined();
		expect(attachBtn).toBeDefined();

		backend.triggerA11yPress(modelBtn!.id);
		backend.triggerA11yPress(attachBtn!.id);
		const prevThinking = controller.getStatus().thinkingLevel;
		backend.triggerA11yPress(thinkingBtn!.id);
		app.step(8);
		expect(modelPickerOpened).toBe(1);
		expect(attachDialogOpened).toBe(1);
		expect(controller.getStatus().thinkingLevel).not.toBe(prevThinking);

		// 7. While streaming: Enter queues follow-up, Cmd+Enter queues steer, docked queue tray renders + removes, Stop aborts
		composer.clearAttachments();
		const longStreamingController = new MockGuiSessionController({
			cwd: tmpDir,
			stepDelayMs: 35,
			responseChunks: ["chunk1 ", "chunk2 ", "chunk3 ", "chunk4 ", "chunk5 "],
		});
		const streamComposer = createWakuComposer(app, longStreamingController);
		app.setRoot(new VStack({ gap: 8, fillWidth: true, children: [streamComposer.root] }));
		app.renderFrame();
		streamComposer.focus();
		app.step(8);

		void longStreamingController.prompt("Run long job");
		await pumpUntil(app, () => longStreamingController.getStatus().isStreaming);
		app.step(8);

		// Queue Follow-up with Enter
		streamComposer.setText("queued follow-up task");
		backend.pressKey("Enter");
		app.step(8);
		expect(longStreamingController.getSnapshot().queuedMessages[0]?.kind).toBe("followUp");

		// Queue Steer with Cmd+Enter
		streamComposer.setText("urgent steer task");
		app.step(8);
		expect(findA11yNode(backend.getAccessibilityTree(), (n) => n.label === "Steer")).toBeDefined();
		backend.pressKey("Enter", SGUI_MOD_SUPER);
		app.step(8);
		const queued = longStreamingController.getSnapshot().queuedMessages;
		expect(queued.some((m) => m.kind === "steer" && m.text === "urgent steer task")).toBe(true);
		expect(backend.getRenderedTexts().join("\n")).toContain("queued follow-up task");
		expect(backend.getRenderedTexts().join("\n")).toContain("Steer");

		// Remove one queued item via × button
		const removeQueueBtn = findA11yNode(
			backend.getAccessibilityTree(),
			(n) => n.role === "button" && n.label === "Remove queued message",
		);
		expect(removeQueueBtn).toBeDefined();
		backend.triggerA11yPress(removeQueueBtn!.id);
		app.step(8);
		expect(longStreamingController.getSnapshot().queuedMessages.length).toBe(1);

		// Click Stop circle button while still streaming
		const stopBtn = findA11yNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Stop");
		expect(stopBtn).toBeDefined();
		backend.triggerA11yPress(stopBtn!.id);
		await pumpUntil(app, () => !longStreamingController.getStatus().isStreaming);

		composer.dispose();
		streamComposer.dispose();
	});

	it("renders 28px footer bar with workspace, dirty git branch chip, extension statuses, and RasterSurface context ring gauge", () => {
		const backend = new HeadlessBackend({ width: 960, height: 120 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "footer", width: 960, height: 120 } });
		const controller = new MockGuiSessionController({ cwd: "/repo/waku-ui" });

		let gitClicks = 0;
		let contextClicks = 0;
		let clickedUsagePercent: number | null = null;

		const footer = createWakuFooterBar(controller, {
			initialTheme: darkGuiTheme,
			onGitBranchClick: () => {
				gitClicks += 1;
			},
			onContextClick: (usage) => {
				contextClicks += 1;
				clickedUsagePercent = usage?.percent ?? null;
			},
		});

		app.setRoot(new VStack({ fillWidth: true, children: [new Spacer({ flex: 1 }), footer.root] }));
		app.renderFrame();

		// Exact 28px height check
		expect(footer.root.layoutRect.height).toBe(28);

		const snap: GuiSessionSnapshot = {
			...controller.getSnapshot(),
			gitBranch: "feat/waku-transcript-composer",
			isGitRepo: true,
			changedFiles: [
				{ path: "cards.ts", status: "M", additions: 14, deletions: 3, hunks: [] },
				{ path: "composer.ts", status: "A", additions: 20, deletions: 0, hunks: [] },
			],
			statuses: [{ key: "lsp", text: "ts ok" }],
			status: {
				...controller.getStatus(),
				contextUsage: {
					usedTokens: 142000,
					maxTokens: 200000,
					percent: 71,
					inputTokens: 100000,
					outputTokens: 42000,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			},
		};
		footer.applySnapshot(snap);
		app.renderFrame();

		expect(footer.getFormattedContextLabel()).toBe("142k / 200k (71%)");
		const rendered = backend.getRenderedTexts().join("\n");
		expect(rendered).toContain("waku-ui");
		expect(rendered).toContain("feat/waku-transcript-composer");
		expect(rendered).toContain("+34 -3");
		expect(rendered).toContain("lsp: ts ok");
		expect(rendered).toContain("142k / 200k (71%)");

		// VectorCanvas RasterSurface draws RGBA ring command
		const imageCmds = backend.getLastFrameCommands().filter((c) => c.kind === "drawImageRgba");
		expect(imageCmds.length).toBeGreaterThan(0);

		const nodes = backend.getAccessibilityTree();
		const gitNode = findA11yNode(nodes, (n) => n.role === "button" && n.label.includes("feat/waku-transcript-composer"));
		const ctxNode = findA11yNode(nodes, (n) => n.role === "button" && n.label.includes("142k / 200k (71%)"));
		expect(gitNode).toBeDefined();
		expect(ctxNode).toBeDefined();

		backend.triggerA11yPress(gitNode!.id);
		backend.triggerA11yPress(ctxNode!.id);
		app.step(8);
		expect(gitClicks).toBe(1);
		expect(contextClicks).toBe(1);
		expect(clickedUsagePercent).toBe(71);

		// Amber (82%) & Red (94%) threshold states + Light theme transition
		footer.setContextUsage({
			usedTokens: 164000,
			maxTokens: 200000,
			percent: 82,
			inputTokens: 160000,
			outputTokens: 4000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		app.renderFrame();
		expect(footer.getFormattedContextLabel()).toBe("164k / 200k (82%)");

		footer.setContextUsage({
			usedTokens: 188000,
			maxTokens: 200000,
			percent: 94,
			inputTokens: 180000,
			outputTokens: 8000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		footer.applyTheme(lightGuiTheme);
		app.setTheme(lightGuiTheme);
		app.renderFrame();
		expect(footer.getFormattedContextLabel()).toBe("188k / 200k (94%)");

		footer.dispose();
	});
});
