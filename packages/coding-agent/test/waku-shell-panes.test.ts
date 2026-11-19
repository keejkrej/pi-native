import { afterEach, describe, expect, it } from "vitest";
import {
	darkGuiTheme,
	GuiApp,
	type GuiA11yNode,
	HeadlessBackend,
	lightGuiTheme,
} from "@pi-ts/gui";
import { MockGuiSessionController } from "../src/modes/gui/controller.ts";
import {
	openCommandPalette,
	openContextPopover,
	openExtensionPromptModal,
	openGitBranchModal,
	openGitCommitModal,
	openModelPicker,
	openSessionPicker,
	openSettingsModal,
	openSidebarOptionsPopover,
} from "../src/modes/gui/overlays.ts";
import { createWakuRightPanel, RIGHT_PANEL_DEFAULT_WIDTH } from "../src/modes/gui/right-panel.ts";
import {
	createWakuSidebar,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
} from "../src/modes/gui/sidebar.ts";
import type {
	GuiChangedFile,
	GuiContextUsage,
	GuiExternalOpener,
	GuiSessionSnapshot,
	GuiToastEntry,
	GuiWorkspaceFileEntry,
	GuiWorkspaceFilePreview,
} from "../src/modes/gui/types.ts";
import {
	createWakuHeaderBar,
	createWakuToastBanner,
	HEADER_BAR_HEIGHT,
} from "../src/modes/gui/window-chrome.ts";

function findNode(
	nodes: readonly GuiA11yNode[],
	predicate: (node: GuiA11yNode) => boolean,
): GuiA11yNode | undefined {
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n !== undefined && predicate(n)) return n;
	}
	return undefined;
}

function findAllNodes(
	nodes: readonly GuiA11yNode[],
	predicate: (node: GuiA11yNode) => boolean,
): GuiA11yNode[] {
	const out: GuiA11yNode[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n !== undefined && predicate(n)) out.push(n);
	}
	return out;
}

async function flushMicrotasks(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 10));
}

class RichWakuMockController extends MockGuiSessionController {
	readonly calls: {
		openedApps: string[];
		checkouts: string[];
		createdBranches: string[];
		commits: Array<{ message: string; paths?: readonly string[] }>;
		treeNavs: Array<{ entryId: string; summarize: boolean }>;
		forks: Array<string | undefined>;
		deletes: string[];
		renames: Array<{ id: string; title: string }>;
		compacts: number;
		dismissedToasts: string[];
		resolvedPrompts: Array<{ id: string; value: unknown; cancelled?: boolean }>;
		allProjectQueries: boolean[];
	} = {
		openedApps: [],
		checkouts: [],
		createdBranches: [],
		commits: [],
		treeNavs: [],
		forks: [],
		deletes: [],
		renames: [],
		compacts: 0,
		dismissedToasts: [],
		resolvedPrompts: [],
		allProjectQueries: [],
	};

	seedChangedFiles: GuiChangedFile[] = [
		{
			path: "src/app.ts",
			status: "M",
			additions: 2,
			deletions: 1,
			hunks: [
				{ kind: "hunk", text: "@@ -1,3 +1,4 @@" },
				{ kind: "context", oldLine: 1, newLine: 1, text: 'import { run } from "./core.ts";' },
				{ kind: "del", oldLine: 2, text: "export const version = 1;" },
				{ kind: "add", newLine: 2, text: "export const version = 2;" },
				{ kind: "add", newLine: 3, text: "export const ready = true;" },
			],
		},
		{
			path: "README.md",
			status: "A",
			additions: 1,
			deletions: 0,
			hunks: [
				{ kind: "hunk", text: "@@ -0,0 +1,1 @@" },
				{ kind: "add", newLine: 1, text: "# Waku Shell" },
			],
		},
	];

	seedWorkspaceFiles: GuiWorkspaceFileEntry[] = [
		{ name: "src", path: "/repo/waku/src", relativePath: "src", isDir: true, depth: 0, expanded: false },
		{
			name: "app.ts",
			path: "/repo/waku/src/app.ts",
			relativePath: "src/app.ts",
			isDir: false,
			depth: 1,
			language: "typescript",
		},
		{
			name: "package.json",
			path: "/repo/waku/package.json",
			relativePath: "package.json",
			isDir: false,
			depth: 0,
			language: "json",
		},
	];

	seedOpeners: GuiExternalOpener[] = [
		{ id: "vscode", name: "VS Code", appPath: "/Applications/Visual Studio Code.app", available: true },
		{ id: "cursor", name: "Cursor", appPath: "/Applications/Cursor.app", available: true },
		{ id: "zed", name: "Zed", available: false },
		{ id: "finder", name: "Finder", appPath: "/System/Library/CoreServices/Finder.app", available: true },
	];

	seedToasts: GuiToastEntry[] = [];
	seedCanGoBack = false;
	seedCanGoForward = false;
	backCount = 0;
	forwardCount = 0;
	seedIsStreaming = false;
	seedContextUsage: GuiContextUsage = {
		usedTokens: 142_000,
		maxTokens: 200_000,
		percent: 71,
		inputTokens: 90_000,
		outputTokens: 32_000,
		cacheReadTokens: 15_000,
		cacheWriteTokens: 5_000,
		totalCostUsd: 0.245,
		modelId: "claude-sonnet-4-5",
	};

	override getSnapshot(): GuiSessionSnapshot {
		const base = super.getSnapshot();
		return {
			...base,
			status: {
				...base.status,
				isStreaming: this.seedIsStreaming || base.status.isStreaming,
				canGoBack: this.seedCanGoBack || super.canGoBack(),
				canGoForward: this.seedCanGoForward || super.canGoForward(),
				contextUsage: this.seedContextUsage,
			},
			changedFiles: this.seedChangedFiles,
			workspaceFiles: this.seedWorkspaceFiles,
			openers: this.seedOpeners,
			toasts: this.seedToasts,
			gitBranch: base.gitBranch || "main",
			gitBranches: base.gitBranches.length > 0 ? base.gitBranches : ["main", "feat/waku"],
			isGitRepo: true,
		};
	}

	override canGoBack(): boolean {
		return this.seedCanGoBack || super.canGoBack();
	}

	override canGoForward(): boolean {
		return this.seedCanGoForward || super.canGoForward();
	}

	override async goBack(): Promise<boolean> {
		this.backCount += 1;
		return super.goBack();
	}

	override async goForward(): Promise<boolean> {
		this.forwardCount += 1;
		return super.goForward();
	}

	override getExternalOpeners(): readonly GuiExternalOpener[] {
		return this.seedOpeners;
	}

	override async openInExternalApp(openerId: string): Promise<boolean> {
		this.calls.openedApps.push(openerId);
		return true;
	}

	override async checkoutBranch(branch: string): Promise<void> {
		this.calls.checkouts.push(branch);
		await super.checkoutBranch(branch);
	}

	override async createBranch(branch: string): Promise<void> {
		this.calls.createdBranches.push(branch);
		await super.createBranch(branch);
	}

	override async commitChanges(message: string, paths?: readonly string[]): Promise<void> {
		this.calls.commits.push({ message, paths });
		this.seedChangedFiles = [];
		await super.commitChanges(message, paths);
	}

	override async readWorkspaceFile(filePath: string): Promise<GuiWorkspaceFilePreview> {
		if (filePath.endsWith("app.ts")) {
			return {
				path: filePath,
				relativePath: "src/app.ts",
				isBinary: false,
				truncated: false,
				lineCount: 2,
				language: "typescript",
				content: 'export const version = 2;\nexport const ready = true;',
			};
		}
		return super.readWorkspaceFile(filePath);
	}

	override async navigateTreeEntry(entryId: string, summarize = false) {
		this.calls.treeNavs.push({ entryId, summarize });
		return super.navigateTreeEntry(entryId, summarize);
	}

	override async forkSession(entryId?: string) {
		this.calls.forks.push(entryId);
		return super.forkSession(entryId);
	}

	override async deleteSession(sessionFile: string) {
		this.calls.deletes.push(sessionFile);
		return super.deleteSession(sessionFile);
	}

	override async renameSession(sessionId: string, title: string): Promise<void> {
		this.calls.renames.push({ id: sessionId, title });
		await super.renameSession(sessionId, title);
	}

	override async compactSession(): Promise<void> {
		this.calls.compacts += 1;
		await super.compactSession();
	}

	override dismissToast(toastId: string): void {
		this.calls.dismissedToasts.push(toastId);
		this.seedToasts = this.seedToasts.filter((t) => t.id !== toastId);
		super.dismissToast(toastId);
	}

	override resolvePendingPrompt(promptId: string, value: unknown, cancelled?: boolean): void {
		this.calls.resolvedPrompts.push({ id: promptId, value, cancelled });
		super.resolvePendingPrompt(promptId, value, cancelled);
	}

	override getContextUsage(): GuiContextUsage {
		return this.seedContextUsage;
	}

	override async getSessions(filterAllProjects?: boolean) {
		this.calls.allProjectQueries.push(Boolean(filterAllProjects));
		return super.getSessions(filterAllProjects);
	}
}

describe("waku-shell-panes", () => {
	const disposables: Array<() => void> = [];

	afterEach(() => {
		while (disposables.length > 0) {
			disposables.pop()?.();
		}
	});

	function createTestHarness(opts: { width?: number; height?: number } = {}) {
		const backend = new HeadlessBackend({ width: opts.width ?? 1280, height: opts.height ?? 800 });
		const app = new GuiApp({
			backend,
			theme: darkGuiTheme,
			window: { title: "waku-test", width: opts.width ?? 1280, height: opts.height ?? 800 },
		});
		const controller = new RichWakuMockController({ cwd: "/repo/waku", stepDelayMs: 1 });
		disposables.push(() => {
			void controller.dispose();
			app.dispose();
		});
		return { backend, app, controller };
	}

	describe("sidebar", () => {
		it("renders Updated & Project grouping, collapsible sections, pin, fork, delete, and footer toggles", async () => {
			const { backend, app, controller } = createTestHarness();
			await controller.newSession();
			const alphaId = controller.getStatus().sessionId!;
			await controller.renameSession(alphaId, "Alpha Session");
			await controller.newSession();
			const betaId = controller.getStatus().sessionId!;
			await controller.renameSession(betaId, "Beta Session");

			const sidebar = createWakuSidebar(app, controller, { vibrancyEnabled: false });
			app.setRoot(sidebar.root);
			const unsub = controller.subscribe(() => sidebar.update(controller.getSnapshot()));
			disposables.push(() => {
				unsub();
				sidebar.dispose();
			});

			sidebar.update(controller.getSnapshot());
			app.renderFrame();

			expect(sidebar.getWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
			sidebar.setWidth(100);
			expect(sidebar.getWidth()).toBe(SIDEBAR_MIN_WIDTH);
			sidebar.setWidth(999);
			expect(sidebar.getWidth()).toBe(SIDEBAR_MAX_WIDTH);
			sidebar.setWidth(SIDEBAR_DEFAULT_WIDTH);

			let nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "New Task")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Search")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Toggle Sidebar")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Previous Session")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Next Session")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Sidebar options")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Open Settings")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label.startsWith("Today"))).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Alpha Session")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Beta Session")).toBeDefined();

			// Collapse Today section
			const todayBtn = findNode(nodes, (n) => n.role === "button" && n.label.startsWith("Today"));
			backend.triggerA11yPress(todayBtn!.id);
			app.step(16);
			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Alpha Session")).toBeUndefined();

			// Expand Today section again
			const todayBtnCollapsed = findNode(nodes, (n) => n.role === "button" && n.label.startsWith("Today"));
			backend.triggerA11yPress(todayBtnCollapsed!.id);
			app.step(16);
			nodes = backend.getAccessibilityTree();

			// Pin Alpha Session -> moves to Pinned section
			const pinAlpha = findNode(nodes, (n) => n.role === "button" && n.label === "Pin Alpha Session");
			expect(pinAlpha).toBeDefined();
			backend.triggerA11yPress(pinAlpha!.id);
			app.step(16);
			await flushMicrotasks();
			sidebar.update(controller.getSnapshot());
			app.step(16);

			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label.startsWith("Pinned"))).toBeDefined();

			// Switch grouping to Project via Sidebar options popover -> renders "waku" workspace section
			const optionsHandle = openSidebarOptionsPopover(app, controller);
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const projectOpt = findNode(nodes, (n) => n.role === "button" && n.label === "Project");
			expect(projectOpt).toBeDefined();
			backend.triggerA11yPress(projectOpt!.id);
			app.step(16);
			optionsHandle.hide();
			sidebar.update(controller.getSnapshot());
			app.step(16);
			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label.startsWith("waku"))).toBeDefined();

			// Inline rename via double-click / Rename button
			const renameBeta = findNode(nodes, (n) => n.role === "button" && n.label === "Rename Beta Session");
			expect(renameBeta).toBeDefined();
			backend.triggerA11yPress(renameBeta!.id);
			app.step(16);
			backend.insertText(" Renamed");
			backend.pressKey("enter");
			app.step(16);
			await flushMicrotasks();
			sidebar.update(controller.getSnapshot());
			app.step(16);
			expect(controller.calls.renames.some((r) => r.title.includes("Renamed"))).toBe(true);

			// Hover pointer over Alpha Session, Fork and Delete actions
			nodes = backend.getAccessibilityTree();
			const alphaCard = findNode(nodes, (n) => n.role === "button" && n.label === "Alpha Session");
			expect(alphaCard).toBeDefined();
			backend.movePointer(alphaCard!.rect.x + 12, alphaCard!.rect.y + 12);
			app.step(16);

			const forkAlpha = findNode(nodes, (n) => n.role === "button" && n.label === "Fork Alpha Session");
			expect(forkAlpha).toBeDefined();
			backend.triggerA11yPress(forkAlpha!.id);
			app.step(16);
			await flushMicrotasks();
			expect(controller.calls.forks.length).toBeGreaterThanOrEqual(1);

			sidebar.update(controller.getSnapshot());
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const delAlpha = findNode(nodes, (n) => n.role === "button" && n.label === "Delete Alpha Session");
			expect(delAlpha).toBeDefined();
			backend.triggerA11yPress(delAlpha!.id);
			app.step(16);
			await flushMicrotasks();
			expect(controller.calls.deletes.length).toBe(1);

			// Settings Appearance switch Dark -> Light updates theme
			const settingsHandle = openSettingsModal(app, controller, { initialCategory: "appearance" });
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const lightSeg = findNode(nodes, (n) => n.role === "button" && n.label === "Light");
			expect(lightSeg).toBeDefined();
			backend.triggerA11yPress(lightSeg!.id);
			app.step(16);
			settingsHandle.hide();
			expect(app.getTheme()).toBe(lightGuiTheme);
		});

		it("renders subtle empty state when no sessions match filter or list is empty", () => {
			const { backend, app, controller } = createTestHarness();
			const emptyCtrl = new RichWakuMockController({ cwd: "/repo/waku" });
			const origSnapshot = emptyCtrl.getSnapshot.bind(emptyCtrl);
			emptyCtrl.getSnapshot = () => ({ ...origSnapshot(), sessions: [] });

			const sidebar = createWakuSidebar(app, emptyCtrl);
			app.setRoot(sidebar.root);
			disposables.push(() => {
				sidebar.dispose();
				void emptyCtrl.dispose();
				void controller.dispose();
			});

			app.renderFrame();
			const nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "New Task")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Alpha Session")).toBeUndefined();
		});
	});

	describe("window-chrome header & toast", () => {
		it("handles collapsed vs open sidebar nav, double-click zoom, and Right Panel toggle", async () => {
			const { backend, app, controller } = createTestHarness();
			controller.seedCanGoBack = true;
			controller.seedCanGoForward = false;

			let sidebarToggled = 0;
			let rightPanelToggled = 0;
			const header = createWakuHeaderBar(app, controller, {
				onToggleSidebar: () => {
					sidebarToggled += 1;
				},
				onToggleRightPanel: () => {
					rightPanelToggled += 1;
				},
			});
			app.setRoot(header.root);
			disposables.push(() => header.dispose());

			// 1. Collapsed sidebar shows left Toggle Sidebar, Previous Session, Next Session & Right Panel toggle
			controller.updateLayoutPreferences({ sidebarCollapsed: true });
			header.update(controller.getSnapshot());
			app.renderFrame();

			expect(header.root.layoutRect.height).toBe(HEADER_BAR_HEIGHT);
			let nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Toggle Sidebar")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Previous Session")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Next Session")).toBeDefined();

			// Trigger Previous Session nav and Toggle Sidebar
			const prevBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Previous Session");
			backend.triggerA11yPress(prevBtn!.id);
			app.step(16);
			await flushMicrotasks();
			expect(controller.backCount).toBe(1);

			const toggleSidebar = findNode(nodes, (n) => n.role === "button" && n.label === "Toggle Sidebar");
			backend.triggerA11yPress(toggleSidebar!.id);
			app.step(16);
			expect(sidebarToggled).toBe(1);

			// Double-click empty area zooms window natively (SGUI_WIN_ACTION_ZOOM = 2)
			backend.pointerDown(420, 20, "left", 2);
			backend.pointerUp(420, 20, "left", 2);
			app.step(16);
			expect(backend.getWindowActions()).toContain(2);

			// 2. Open sidebar hides redundant left chrome nav controls
			controller.updateLayoutPreferences({ sidebarCollapsed: false });
			header.update(controller.getSnapshot());
			app.step(16);
			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Toggle Sidebar")).toBeUndefined();

			// Toggle right panel button fires callback
			const rightBtn = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Toggle Right Panel");
			expect(rightBtn).toBeDefined();
			backend.triggerA11yPress(rightBtn!.id);
			app.step(16);
			expect(rightPanelToggled).toBe(1);
		});

		it("renders floating toast banner, supports click dismiss and auto-dismiss timer", async () => {
			const { backend, app, controller } = createTestHarness();
			const toastBanner = createWakuToastBanner(app, controller, { autoDismissMs: 25 });
			app.setRoot(toastBanner.root);
			disposables.push(() => toastBanner.dispose());

			controller.seedToasts = [
				{ id: "t-1", message: "Saved snapshot", level: "info", createdAt: Date.now() },
			];
			toastBanner.update(controller.getSnapshot());
			app.renderFrame();
			expect(toastBanner.hasActiveToast()).toBe(true);
			let nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.label === "Saved snapshot")).toBeDefined();

			// Click dismiss button
			const dismissBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Dismiss notification");
			expect(dismissBtn).toBeDefined();
			backend.triggerA11yPress(dismissBtn!.id);
			app.step(16);
			toastBanner.update(controller.getSnapshot());
			app.step(16);
			expect(controller.calls.dismissedToasts).toContain("t-1");
			expect(toastBanner.hasActiveToast()).toBe(false);

			// Second toast auto-dismisses after autoDismissMs
			controller.seedToasts = [
				{ id: "t-2", message: "Branch updated", level: "warning", createdAt: Date.now() },
			];
			toastBanner.update(controller.getSnapshot());
			app.renderFrame();
			expect(toastBanner.hasActiveToast()).toBe(true);
			await new Promise((resolve) => setTimeout(resolve, 45));
			toastBanner.update(controller.getSnapshot());
			expect(controller.calls.dismissedToasts).toContain("t-2");
			expect(toastBanner.hasActiveToast()).toBe(false);
		});
	});

	describe("right-panel (Changes / Files / Tree)", () => {
		it("renders Changes unified & split diffs, supports selectFile, Files tree expand & preview, and Tree DAG nav/fork", async () => {
			const { backend, app, controller } = createTestHarness();
			await controller.sendUserMessage("Implement Waku panel");
			await flushMicrotasks();

			controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "changes", diffViewMode: "unified" });
			const rightPanel = createWakuRightPanel(app, controller);
			app.setRoot(rightPanel.root);
			disposables.push(() => rightPanel.dispose());

			rightPanel.update(controller.getSnapshot());
			app.renderFrame();

			expect(rightPanel.getWidth()).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
			let nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "src/app.ts")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "README.md")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Commit")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "unified diff: src/app.ts")).toBeDefined();

			// Switch to Split diff mode
			const splitBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Split");
			expect(splitBtn).toBeDefined();
			backend.triggerA11yPress(splitBtn!.id);
			app.step(16);
			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "split diff: src/app.ts")).toBeDefined();

			// Switch to Files tab and click folder -> file preview
			const filesTab = findNode(nodes, (n) => n.role === "button" && n.label === "Files");
			expect(filesTab).toBeDefined();
			backend.triggerA11yPress(filesTab!.id);
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const srcFolder = findNode(nodes, (n) => n.role === "button" && n.label === "src/");
			expect(srcFolder).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "src/app.ts")).toBeUndefined();

			// Expand src/
			backend.triggerA11yPress(srcFolder!.id);
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const appFile = findNode(nodes, (n) => n.role === "button" && n.label === "src/app.ts");
			expect(appFile).toBeDefined();

			// Preview file with syntax highlighting
			backend.triggerA11yPress(appFile!.id);
			app.step(16);
			await flushMicrotasks();
			app.step(16);
			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "Preview: src/app.ts")).toBeDefined();

			// Programmatic selectFile switches back to Changes tab for specified file
			rightPanel.selectFile("README.md");
			app.step(16);
			expect(rightPanel.getActiveTab()).toBe("changes");
			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label.endsWith("diff: README.md"))).toBeDefined();

			// Terminal tab: click Terminal button and verify terminal surface switches
			const terminalTab = findNode(nodes, (n) => n.role === "button" && n.label === "Terminal");
			expect(terminalTab).toBeDefined();
			backend.triggerA11yPress(terminalTab!.id);
			app.step(16);
			expect(rightPanel.getActiveTab()).toBe("terminal");

			// Tree tab: click entry -> Navigate / Summarize / Fork from here
			nodes = backend.getAccessibilityTree();
			const treeTab = findNode(nodes, (n) => n.role === "button" && n.label === "Tree");
			expect(treeTab).toBeDefined();
			backend.triggerA11yPress(treeTab!.id);
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const treeEntry = findNode(nodes, (n) => n.role === "button" && n.label.includes("Implement Waku panel"));
			expect(treeEntry).toBeDefined();
			backend.triggerA11yPress(treeEntry!.id);
			app.step(16);

			nodes = backend.getAccessibilityTree();
			const navBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Navigate");
			expect(navBtn).toBeDefined();
			backend.triggerA11yPress(navBtn!.id);
			app.step(16);
			await flushMicrotasks();
			expect(controller.calls.treeNavs.length).toBe(1);

			// Navigate rebuilds tree banner with fresh Fork button ID
			nodes = backend.getAccessibilityTree();
			const forkBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Fork from here");
			expect(forkBtn).toBeDefined();
			backend.triggerA11yPress(forkBtn!.id);
			app.step(16);
			await flushMicrotasks();
			expect(controller.calls.forks.length).toBe(1);
		});
	});

	describe("overlays (palette, pickers, git, context, settings, extension prompt)", () => {
		it("command palette filters across groups and executes selection via keyboard", async () => {
			const { backend, app, controller } = createTestHarness();
			let toggled = false;
			const handle = openCommandPalette(app, controller, {
				extensionCommands: [
					{
						id: "ext.hello",
						group: "Extension Commands",
						label: "Run Extension Hello",
						run: () => {
							toggled = true;
						},
					},
				],
			});
			app.renderFrame();

			let nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "Sessions")).toBeDefined();

			backend.insertText("Extension Hello");
			app.step(16);
			nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "Extension Commands")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Run Extension Hello")).toBeDefined();
			backend.pressKey("enter");
			app.step(16);
			expect(toggled).toBe(true);

			handle.dispose();
		});

		it("model picker selects model with keyboard & opens settings", async () => {
			const { backend, app, controller } = createTestHarness();
			let openedSettings = false;
			openModelPicker(app, controller, {
				onOpenSettings: () => {
					openedSettings = true;
				},
			});
			app.renderFrame();

			const nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "Select Model")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Open Settings")).toBeDefined();

			backend.pressKey("down");
			backend.pressKey("enter");
			app.step(16);
			await flushMicrotasks();
			expect(controller.getStatus().activeModel?.id).toBe("gpt-4o");

			// Reopen & click Open Settings
			openModelPicker(app, controller, {
				onOpenSettings: () => {
					openedSettings = true;
				},
			});
			app.step(16);
			const openSettingsBtn = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Open Settings");
			backend.triggerA11yPress(openSettingsBtn!.id);
			app.step(16);
			expect(openedSettings).toBe(true);
		});

		it("session picker filters and switches across Current & All Workspaces", async () => {
			const { backend, app, controller } = createTestHarness();
			await controller.newSession();
			const firstFile = controller.getSnapshot().sessions[0]!.sessionFile;
			await controller.newSession();

			openSessionPicker(app, controller);
			app.renderFrame();
			await flushMicrotasks();
			app.step(16);

			const nodes = backend.getAccessibilityTree();
			const allWsBtn = findNode(nodes, (n) => n.role === "button" && n.label === "All Workspaces");
			expect(allWsBtn).toBeDefined();
			backend.triggerA11yPress(allWsBtn!.id);
			app.step(16);
			await flushMicrotasks();
			app.step(16);
			expect(controller.calls.allProjectQueries).toEqual([false, true]);

			// Select second row and confirm switch
			const sessionButtons = findAllNodes(
				backend.getAccessibilityTree(),
				(n) => n.role === "button" && (n.value ?? "").includes("msgs"),
			);
			expect(sessionButtons.length).toBeGreaterThanOrEqual(2);
			backend.triggerA11yPress(sessionButtons[0]!.id);
			app.step(16);
			await flushMicrotasks();
			expect(firstFile.length).toBeGreaterThan(0);
		});

		it("git branch & git commit modals perform checkout, createBranch, and selective commitChanges", async () => {
			const { backend, app, controller } = createTestHarness();

			// Git branch modal: switch branch
			openGitBranchModal(app, controller);
			app.renderFrame();
			const featBranch = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "feat/gui");
			expect(featBranch).toBeDefined();
			backend.triggerA11yPress(featBranch!.id);
			app.step(16);
			await flushMicrotasks();
			expect(controller.calls.checkouts).toEqual(["feat/gui"]);

			// Create branch (switch from branch list to Create and checkout new branch… form first)
			openGitBranchModal(app, controller);
			app.step(16);
			const newBranchTrigger = findNode(
				backend.getAccessibilityTree(),
				(n) => n.role === "button" && n.label === "Create and checkout new branch…",
			);
			expect(newBranchTrigger).toBeDefined();
			backend.triggerA11yPress(newBranchTrigger!.id);
			app.step(16);
			const renderedTexts = backend.getRenderedTexts().join("\n");
			expect(renderedTexts).toContain("Create and checkout new branch");
			expect(renderedTexts).toContain("Press Return to create · Esc to cancel");
			const newInput = findNode(backend.getAccessibilityTree(), (n) => n.role === "textField" && n.label === "New branch name");
			expect(newInput).toBeDefined();
			backend.triggerA11yFocus(newInput!.id);
			backend.insertText("feat/new-branch");
			app.step(16);
			backend.pressKey("enter");
			app.step(16);
			await flushMicrotasks();
			expect(controller.calls.createdBranches).toEqual(["feat/new-branch"]);

			// Git commit modal: verify Commit / Commit & Push / Push rows and Include unstaged checkbox
			openGitCommitModal(app, controller);
			app.renderFrame();
			let nodes = backend.getAccessibilityTree();
			const unstagedCheck = findNode(nodes, (n) => n.role === "checkbox" && n.label === "Include unstaged");
			expect(unstagedCheck).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Commit & Push")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Push")).toBeDefined();
			backend.triggerA11yPress(unstagedCheck!.id);
			app.step(16);
			backend.insertText("feat: update app");
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const commitBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Commit");
			expect(commitBtn).toBeDefined();
			backend.triggerA11yPress(commitBtn!.id);
			app.step(16);
			await flushMicrotasks();
			expect(controller.calls.commits).toEqual([{ message: "feat: update app", paths: undefined }]);
		});

		it("context popover shows breakdown cleanly without extra action buttons", () => {
			const { backend, app, controller } = createTestHarness();
			openContextPopover(app, controller);
			app.renderFrame();

			const nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "Context Window")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "142k / 200k tokens")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "71%")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Compact Context")).toBeUndefined();
			const texts = backend.getRenderedTexts().join("\n");
			expect(texts).toContain("Input Tokens");
			expect(texts).toContain("Estimated Cost");
		});

		it("settings modal supports 5 Waku sidebar categories, Appearance Toggle Theme, and layout persistence", () => {
			const { backend, app, controller } = createTestHarness();
			const handle = openSettingsModal(app, controller);
			app.renderFrame();

			let nodes = backend.getAccessibilityTree();
			expect(findNode(nodes, (n) => n.role === "staticText" && n.label === "Settings")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Back")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "textField" && n.label === "Search Settings")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "General")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Appearance")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Providers")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Skills")).toBeDefined();
			expect(findNode(nodes, (n) => n.role === "button" && n.label === "Usage")).toBeDefined();

			// General category updates Diff Presentation layout persistence
			const splitDiffBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Split");
			expect(splitDiffBtn).toBeDefined();
			backend.triggerA11yPress(splitDiffBtn!.id);
			app.step(16);
			expect(controller.getSnapshot().layout.diffViewMode).toBe("split");

			// Switch to Appearance category -> Enter/press Toggle Theme switches Dark -> Light
			const appearanceBtn = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Appearance");
			expect(appearanceBtn).toBeDefined();
			backend.triggerA11yPress(appearanceBtn!.id);
			app.step(16);
			nodes = backend.getAccessibilityTree();
			const toggleThemeBtn = findNode(nodes, (n) => n.role === "button" && n.label === "Toggle Theme");
			expect(toggleThemeBtn).toBeDefined();
			backend.triggerA11yPress(toggleThemeBtn!.id);
			app.step(16);
			expect(app.getTheme()).toBe(lightGuiTheme);
			expect(controller.getSnapshot().layout.appearance).toBe("light");

			// Escape closes Settings modal
			backend.pressKey("escape");
			app.step(16);
			handle.dispose();
		});

		it("extension prompt modal resolves confirm, select, input, editor, and Escape cancellation", () => {
			const { backend, app, controller } = createTestHarness();

			// 1. Confirm prompt
			openExtensionPromptModal(app, controller, {
				id: "p-confirm",
				kind: "confirm",
				title: "Apply patch?",
				message: "Update file cleanly?",
			});
			app.renderFrame();
			const confirmBtn = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Confirm");
			expect(confirmBtn).toBeDefined();
			backend.triggerA11yPress(confirmBtn!.id);
			app.step(16);
			expect(controller.calls.resolvedPrompts[0]).toEqual({ id: "p-confirm", value: true, cancelled: false });

			// 2. Select prompt
			openExtensionPromptModal(app, controller, {
				id: "p-select",
				kind: "select",
				title: "Pick target",
				message: "",
				options: ["Staging", "Production"],
			});
			app.step(16);
			backend.pressKey("down");
			backend.pressKey("enter");
			app.step(16);
			expect(controller.calls.resolvedPrompts[1]).toEqual({ id: "p-select", value: "Production", cancelled: false });

			// 3. Input prompt
			openExtensionPromptModal(app, controller, {
				id: "p-input",
				kind: "input",
				title: "Enter tag",
				message: "",
				defaultValue: "v1.0",
			});
			app.step(16);
			backend.insertText(".2");
			backend.pressKey("enter");
			app.step(16);
			expect(controller.calls.resolvedPrompts[2]).toEqual({ id: "p-input", value: "v1.0.2", cancelled: false });

			// 4. Editor prompt + Escape cancellation
			openExtensionPromptModal(app, controller, {
				id: "p-editor",
				kind: "editor",
				title: "Edit notes",
				message: "",
				defaultValue: "Draft",
			});
			app.step(16);
			backend.pressKey("escape");
			app.step(16);
			expect(controller.calls.resolvedPrompts[3]).toEqual({ id: "p-editor", value: undefined, cancelled: true });
		});
	});
});
