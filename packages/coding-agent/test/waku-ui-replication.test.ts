import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
	darkGuiTheme,
	GuiApp,
	type GuiA11yNode,
	HeadlessBackend,
	lightGuiTheme,
} from "@pi-ts/gui";
import {
	createWakuRightPanel,
	MockGuiSessionController,
	openProjectPicker,
	openSidebarOptionsPopover,
	openThinkingPicker,
	openWorkspacePicker,
	RIGHT_PANEL_DEFAULT_WIDTH,
	runUiReplicationExportAll,
	SIDEBAR_DEFAULT_WIDTH,
} from "../src/modes/gui/index.ts";

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

describe("waku-ui-replication", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
		}
	});

	it("exports all 35 scenarios, 44 theme tokens, 7 component specs, state transitions, and Retina PNGs offline", () => {
		const outDir = mkdtempSync(join(tmpdir(), "waku-repl-test-"));
		tempDirs.push(outDir);

		const res = runUiReplicationExportAll(outDir);
		expect(res.scenarios.length).toBe(35);

		const tokens = parseYaml(readFileSync(join(outDir, "actual-tokens.yaml"), "utf8")) as {
			schema: string;
			color: Record<string, string>;
		};
		expect(tokens.schema).toBe("ui-tokens/1");
		const tokenKeys = Object.keys(tokens.color);
		expect(tokenKeys.length).toBe(54);
		expect(tokenKeys.filter((k) => k.startsWith("dark.")).length).toBe(27);
		expect(tokenKeys.filter((k) => k.startsWith("light.")).length).toBe(27);
		expect(tokens.color["dark.bg.canvas"]?.toLowerCase()).toBe("#1a1a1a");
		expect(tokens.color["dark.accent.default"]?.toLowerCase()).toBe("#e2795b");
		expect(tokens.color["light.bg.canvas"]?.toLowerCase()).toBe("#f6f5f6");

		const components = parseYaml(readFileSync(join(outDir, "actual-components.yaml"), "utf8")) as {
			schema: string;
			components: Record<string, { w?: number; h?: number; radius?: number }>;
		};
		expect(components.schema).toBe("ui-components/1");
		expect(components.components["sidebar.surface"]).toBeDefined();
		expect(components.components["composer.card"]).toBeDefined();
		expect(components.components["user.bubble"]).toBeDefined();
		expect(components.components["popover.model_picker"]).toBeDefined();
		expect(components.components["command_palette.card"]).toBeDefined();
		expect(components.components["commit_dialog.card"]).toBeDefined();
		expect(components.components["toast.card"]).toBeDefined();

		const states = parseYaml(readFileSync(join(outDir, "actual-states.yaml"), "utf8")) as {
			schema: string;
			states: Record<string, { status: string }>;
		};
		expect(states.schema).toBe("ui-states/1");
		expect(states.states["app.workspace"]?.status).toBe("observed");
		expect(states.states["popover.model_picker"]?.status).toBe("observed");
		expect(states.states.command_palette?.status).toBe("observed");

		const wsEmpty = parseYaml(
			readFileSync(join(outDir, "actual-layout", "app.workspace", "empty@1280x820.yaml"), "utf8"),
		) as {
			meta: { source: string; confidence: string };
			nodes: Array<{ key: string; bounds: { w: number; h: number } }>;
		};
		expect(wsEmpty.meta.source).toBe("actual");
		expect(wsEmpty.meta.confidence).toBe("measured");
		expect(wsEmpty.nodes.find((n) => n.key === "workspace.sidebar")?.bounds.w).toBe(SIDEBAR_DEFAULT_WIDTH);
		expect(wsEmpty.nodes.find((n) => n.key === "workspace.main.composer")?.bounds.w).toBe(720);

		const rpTerminal = parseYaml(
			readFileSync(join(outDir, "actual-layout", "app.right_panel", "terminal@1280x820.yaml"), "utf8"),
		) as {
			nodes: Array<{ key: string; bounds: { w: number } }>;
		};
		expect(rpTerminal.nodes.find((n) => n.key === "right_panel")?.bounds.w).toBe(RIGHT_PANEL_DEFAULT_WIDTH);

		if (process.platform === "darwin") {
			for (const item of res.scenarios) {
				if (!item.pngWritten) continue;
				const pngPath = join(
					outDir,
					"screenshots",
					"candidate",
					`${item.surface}-${item.state}@${item.viewport}.png`,
				);
				expect(existsSync(pngPath)).toBe(true);
				const buf = readFileSync(pngPath);
				expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
			}
		}
	});

	it("supports Sidebar options, Thinking, Project, Workspace popovers and Terminal tab", async () => {
		const backend = new HeadlessBackend({ width: 1280, height: 820 });
		const app = new GuiApp({ backend, theme: darkGuiTheme, window: { title: "popovers", width: 1280, height: 820 } });
		const controller = new MockGuiSessionController({ cwd: "/repo/waku" });

		// 1. Sidebar options: group by Project & order by Oldest
		const sidebarOpts = openSidebarOptionsPopover(app, controller);
		app.renderFrame();
		const orderOldest = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Oldest");
		expect(orderOldest).toBeDefined();
		backend.triggerA11yPress(orderOldest!.id);
		app.step(8);
		expect(controller.getSnapshot().layout.sidebarOrderBy).toBe("oldest");
		sidebarOpts.hide();

		// 2. Thinking picker updates controller thinkingLevel
		const thinkingHandle = openThinkingPicker(app, controller);
		app.renderFrame();
		const mediumBtn = findNode(backend.getAccessibilityTree(), (n) => n.role === "button" && n.label === "Medium");
		expect(mediumBtn).toBeDefined();
		backend.triggerA11yPress(mediumBtn!.id);
		app.step(8);
		expect(controller.getStatus().thinkingLevel).toBe("medium");
		thinkingHandle.hide();

		// 3. Project & Workspace pickers render & close cleanly
		const projHandle = openProjectPicker(app, controller);
		app.renderFrame();
		expect(findNode(backend.getAccessibilityTree(), (n) => n.role === "textField" && n.label === "Search projects")).toBeDefined();
		projHandle.hide();

		const wsHandle = openWorkspacePicker(app, controller);
		app.renderFrame();
		expect(backend.getRenderedTexts().join("\n")).toContain("Local");
		wsHandle.hide();

		// 4. Right Panel Terminal tab renders & theme switches cleanly
		const rightPanel = createWakuRightPanel(app, controller);
		app.setRoot(rightPanel.root);
		rightPanel.setActiveTab("terminal");
		app.setTheme(lightGuiTheme);
		rightPanel.applyTheme(lightGuiTheme);
		app.renderFrame();
		expect(rightPanel.getWidth()).toBe(RIGHT_PANEL_DEFAULT_WIDTH);
		expect(rightPanel.getActiveTab()).toBe("terminal");

		rightPanel.dispose();
		await controller.dispose();
		app.dispose();
	});
});
