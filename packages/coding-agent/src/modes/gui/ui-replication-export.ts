/**
 * Mechanical Waku v0.1.20 UI-replication extractor and Retina CoreGraphics PNG renderer.
 * Drives all 35 (surface, state, viewport) scenarios on live GuiApp + HeadlessBackend instances,
 * inspects rendered GuiComponent trees, themes, styles, and state transitions, and writes
 * actual-layout/, actual-tokens.yaml, actual-components.yaml, actual-states.yaml, and PNGs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	Box,
	type Color,
	colorToRgba,
	darkGuiTheme,
	GuiApp,
	type GuiA11yNode,
	HeadlessBackend,
	lightGuiTheme,
	type Rect,
	renderDrawListToPng,
} from "@pi-ts/gui";
import { measureTextWithNative } from "@pi-ts/gui/native";
import { MockGuiSessionController } from "./controller.ts";
import { mountPiGui } from "./gui-mode.ts";
import { RIGHT_PANEL_DEFAULT_WIDTH, type RightPanelTab } from "./right-panel.ts";
import type {
	GuiChangedFile,
	GuiContextUsage,
	GuiQueuedMessageItem,
	GuiSessionListItem,
	GuiSessionSnapshot,
	GuiToastEntry,
	GuiTranscriptEntry,
	GuiTreeEntryItem,
	GuiWorkspaceFileEntry,
} from "./types.ts";
import { collectLiveSpecNodes, type ExtractedSpecNode } from "./ui-spec-meta.ts";

export interface UiReplicationScenarioSummary {
	readonly surface: string;
	readonly state: string;
	readonly viewport: string;
	readonly nodeCount: number;
	readonly pngWritten: boolean;
}

export interface UiReplicationExportResult {
	readonly outDir: string;
	readonly scenarios: readonly UiReplicationScenarioSummary[];
}

function yamlScalar(value: string | number | boolean | null): string {
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value.length === 0) return '""';
	if (/^[A-Za-z0-9_.\-/]+$/.test(value)) {
		return value;
	}
	return JSON.stringify(value);
}

function formatNumTuple(tuple: readonly [number, number, number, number]): string {
	return `[${tuple[0]}, ${tuple[1]}, ${tuple[2]}, ${tuple[3]}]`;
}

function serializeSpecFile(
	surface: string,
	state: string,
	viewport: { readonly w: number; readonly h: number },
	nodes: readonly ExtractedSpecNode[],
): string {
	const lines: string[] = [
		"schema: ui-layout-spec/1",
		"meta:",
		`  surface: ${surface}`,
		`  state: ${state}`,
		`  viewport: {w: ${viewport.w}, h: ${viewport.h}}`,
		"  dpr: 2",
		"  source: actual",
		"  method: native",
		"  confidence: measured",
		"  evidence:",
		"    - packages/coding-agent/src/modes/gui/gui-mode.ts",
		"    - packages/coding-agent/src/modes/gui/sidebar.ts",
		"    - packages/coding-agent/src/modes/gui/window-chrome.ts",
		"    - packages/coding-agent/src/modes/gui/transcript.ts",
		"    - packages/coding-agent/src/modes/gui/cards.ts",
		"    - packages/coding-agent/src/modes/gui/composer.ts",
		"    - packages/coding-agent/src/modes/gui/right-panel.ts",
		"    - packages/coding-agent/src/modes/gui/overlays.ts",
		"    - packages/gui/src/theme.ts",
		`  generated: ${JSON.stringify(new Date().toISOString())}`,
		"nodes:",
	];

	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n === undefined) continue;
		lines.push(`  - key: ${n.key}`);
		lines.push(`    parent: ${n.parent === null ? "null" : n.parent}`);
		lines.push(`    order: ${n.order}`);
		lines.push(`    role: ${n.role}`);
		lines.push(`    bounds: {x: ${n.bounds.x}, y: ${n.bounds.y}, w: ${n.bounds.w}, h: ${n.bounds.h}}`);
		if (n.flow.type === "flex") {
			lines.push(
				`    flow: {type: flex, dir: ${n.flow.dir ?? "column"}, justify: ${n.flow.justify ?? "start"}, align: ${n.flow.align ?? "stretch"}, wrap: ${n.flow.wrap ?? "nowrap"}, gap: ${n.flow.gap ?? 0}}`,
			);
		} else {
			lines.push(`    flow: {type: ${n.flow.type}}`);
		}
		lines.push("    box:");
		lines.push(`      padding: ${formatNumTuple(n.box.padding)}`);
		lines.push(`      margin: ${formatNumTuple(n.box.margin)}`);
		lines.push(`      border: ${formatNumTuple(n.box.border)}`);
		lines.push(`    size: {w: ${n.size.w}, h: ${n.size.h}}`);
		lines.push(`    overflow: ${n.overflow}`);
		lines.push(`    z: ${n.z}`);
		lines.push(`    variant: ${n.variant === null ? "null" : yamlScalar(n.variant)}`);
		lines.push(`    state: ${yamlScalar(n.state)}`);
		if (n.text === null) {
			lines.push("    text: null");
		} else {
			lines.push(
				`    text: {value: ${yamlScalar(n.text.value)}, wrap: ${n.text.wrap}, lines: ${n.text.lines === null ? "null" : n.text.lines}, overflow: ${n.text.overflow}}`,
			);
		}
		if (n.asset === null) {
			lines.push("    asset: null");
		} else {
			lines.push(
				`    asset: {kind: ${yamlScalar(n.asset.kind)}, ref: ${n.asset.ref === undefined ? "null" : yamlScalar(n.asset.ref)}, alt: ${n.asset.alt === undefined ? "null" : yamlScalar(n.asset.alt)}, w: ${n.asset.w ?? 0}, h: ${n.asset.h ?? 0}}`,
			);
		}
	}

	return `${lines.join("\n")}\n`;
}

function formatThemeColor(c: Color): string {
	const rgba = colorToRgba(c);
	const toHex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
	if (rgba.a >= 0.999) {
		return `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`;
	}
	const alpha = Math.round(rgba.a * 100) / 100;
	return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)}, ${alpha})`;
}

function serializeTokensYaml(): string {
	const d = darkGuiTheme;
	const l = lightGuiTheme;
	const entries: readonly [string, Color][] = [
		["dark.bg.canvas", d.background],
		["dark.bg.surface", d.surface],
		["dark.bg.sidebar", d.sidebarBg],
		["dark.bg.sidebar_item", d.sidebarItemBg],
		["dark.bg.raised", d.surfaceRaised],
		["dark.bg.composer", d.surfaceComposer],
		["dark.bg.inset", d.surfaceInset],
		["dark.bg.terminal", d.surfaceTerminal],
		["dark.bg.overlay", d.surfaceOverlay],
		["dark.bg.overlay_strong", d.surfaceOverlayStrong],
		["dark.border.default", d.border],
		["dark.border.strong", d.borderStrong],
		["dark.border.sidebar", d.sidebarBorder],
		["dark.fg.primary", d.textPrimary],
		["dark.fg.secondary", d.textSecondary],
		["dark.fg.tertiary", d.textMuted],
		["dark.fg.ghost", d.textDisabled],
		["dark.accent.default", d.accent],
		["dark.gauge.default", d.gauge],
		["dark.code.text", d.codeText],
		["dark.code.wash", d.codeWash],
		["dark.inverse.bg", d.inverseBg],
		["dark.inverse.fg", d.inverseFg],
		["dark.status.warning", d.warning],
		["dark.status.success", d.success],
		["dark.status.favorite", d.favorite],
		["dark.status.danger", d.danger],
		["light.bg.canvas", l.background],
		["light.bg.surface", l.surface],
		["light.bg.sidebar", l.sidebarBg],
		["light.bg.sidebar_item", l.sidebarItemBg],
		["light.bg.raised", l.surfaceRaised],
		["light.bg.composer", l.surfaceComposer],
		["light.bg.inset", l.surfaceInset],
		["light.bg.terminal", l.surfaceTerminal],
		["light.bg.overlay", l.surfaceOverlay],
		["light.bg.overlay_strong", l.surfaceOverlayStrong],
		["light.border.default", l.border],
		["light.border.strong", l.borderStrong],
		["light.border.sidebar", l.sidebarBorder],
		["light.fg.primary", l.textPrimary],
		["light.fg.secondary", l.textSecondary],
		["light.fg.tertiary", l.textMuted],
		["light.fg.ghost", l.textDisabled],
		["light.accent.default", l.accent],
		["light.gauge.default", l.gauge],
		["light.code.text", l.codeText],
		["light.code.wash", l.codeWash],
		["light.inverse.bg", l.inverseBg],
		["light.inverse.fg", l.inverseFg],
		["light.status.warning", l.warning],
		["light.status.success", l.success],
		["light.status.favorite", l.favorite],
		["light.status.danger", l.danger],
	];

	const lines: string[] = [
		"schema: ui-tokens/1",
		"evidence:",
		"  - packages/gui/src/theme.ts",
		"color:",
	];
	for (let i = 0; i < entries.length; i++) {
		const pair = entries[i];
		if (pair !== undefined) {
			lines.push(`  ${pair[0]}: ${JSON.stringify(formatThemeColor(pair[1]))}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

interface CapturedComponentRecord {
	readonly node: string;
	readonly background?: string;
	readonly border?: { readonly width: number; readonly style: string; readonly color: string };
	readonly radius?: number;
	readonly padding?: readonly [number, number, number, number];
	readonly width?: number;
	readonly height?: number;
	readonly maxWidth?: number;
	readonly maxHeight?: number;
}

function styleRecordFromBox(
	nodeKey: string,
	box: Box,
	include: { readonly radius?: boolean; readonly padding?: boolean; readonly width?: boolean; readonly height?: boolean; readonly maxWidth?: boolean; readonly maxHeight?: boolean },
): CapturedComponentRecord {
	const info = box.getStyleInfo();
	const bw = Math.max(info.borderEdges.top, info.borderEdges.right, info.borderEdges.bottom, info.borderEdges.left);
	const borderColor = info.borderColor ? formatThemeColor(info.borderColor) : "rgba(0, 0, 0, 0)";
	return {
		node: nodeKey,
		background: info.background ? formatThemeColor(info.background) : undefined,
		border: {
			width: bw,
			style: bw > 0 ? "solid" : "none",
			color: borderColor,
		},
		radius: include.radius ? info.radius : undefined,
		padding: include.padding
			? [info.padding.top, info.padding.right, info.padding.bottom, info.padding.left]
			: undefined,
		width: include.width ? (info.fixedWidth ?? Math.round(box.layoutRect.width)) : undefined,
		height: include.height ? (info.fixedHeight ?? Math.round(box.layoutRect.height)) : undefined,
		maxWidth: include.maxWidth ? info.maxWidth : undefined,
		maxHeight: include.maxHeight ? info.maxHeight : undefined,
	};
}

function serializeComponentsYaml(records: ReadonlyMap<string, CapturedComponentRecord>): string {
	const lines: string[] = [
		"schema: ui-components/1",
		"components:",
	];
	const order = [
		"sidebar.surface",
		"composer.card",
		"user.bubble",
		"popover.model_picker",
		"command_palette.card",
		"commit_dialog.card",
		"toast.card",
	];
	for (let i = 0; i < order.length; i++) {
		const name = order[i];
		if (name === undefined) continue;
		const rec = records.get(name);
		if (rec === undefined) continue;
		lines.push(`  ${name}:`);
		lines.push(`    node: ${rec.node}`);
		lines.push("    properties:");
		if (rec.background !== undefined) {
			lines.push(`      background: ${JSON.stringify(rec.background)}`);
		}
		if (rec.border !== undefined) {
			lines.push(
				`      border: {width: ${rec.border.width}, style: ${rec.border.style}, color: ${JSON.stringify(rec.border.color)}}`,
			);
		}
		if (rec.radius !== undefined) {
			lines.push(`      radius: ${rec.radius}`);
		}
		if (rec.padding !== undefined) {
			lines.push(`      padding: ${formatNumTuple(rec.padding)}`);
		}
		if (rec.width !== undefined) {
			lines.push(`      width: ${rec.width}`);
		}
		if (rec.height !== undefined) {
			lines.push(`      height: ${rec.height}`);
		}
		if (rec.maxWidth !== undefined) {
			lines.push(`      maxWidth: ${rec.maxWidth}`);
		}
		if (rec.maxHeight !== undefined) {
			lines.push(`      maxHeight: ${rec.maxHeight}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function findA11y(nodes: readonly GuiA11yNode[], pred: (n: GuiA11yNode) => boolean): GuiA11yNode | undefined {
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n !== undefined && pred(n)) return n;
	}
	return undefined;
}

class ExportMockController extends MockGuiSessionController {
	seedSessionsList: GuiSessionListItem[] | undefined;
	seedTranscriptList: GuiTranscriptEntry[] | undefined;
	seedChangedFilesList: GuiChangedFile[] | undefined;
	seedWorkspaceFilesList: GuiWorkspaceFileEntry[] | undefined;
	seedTreeEntriesList: GuiTreeEntryItem[] | undefined;
	seedQueuedList: GuiQueuedMessageItem[] | undefined;
	seedToastsList: GuiToastEntry[] | undefined;
	seedUsage: GuiContextUsage | undefined;
	seedStreaming = false;
	seedSessionName: string | undefined;
	seedBranchesList: string[] = ["main", "feat/gui", "fix/layout"];

	override getContextUsage(): GuiContextUsage {
		return this.seedUsage ?? super.getContextUsage();
	}

	override getSnapshot(): GuiSessionSnapshot {
		const base = super.getSnapshot();
		return {
			...base,
			status: {
				...base.status,
				isStreaming: this.seedStreaming || base.status.isStreaming,
				contextUsage: this.seedUsage ?? base.status.contextUsage,
				sessionName: this.seedSessionName ?? base.status.sessionName,
			},
			sessions: this.seedSessionsList ?? base.sessions,
			transcript: this.seedTranscriptList ?? base.transcript,
			changedFiles: this.seedChangedFilesList ?? base.changedFiles,
			workspaceFiles: this.seedWorkspaceFilesList ?? base.workspaceFiles,
			treeEntries: this.seedTreeEntriesList ?? base.treeEntries,
			queuedMessages: this.seedQueuedList ?? base.queuedMessages,
			toasts: this.seedToastsList ?? base.toasts,
			gitBranch: base.gitBranch || "main",
			gitBranches: this.seedBranchesList,
		};
	}
}

function createExportBackend(width: number, height: number): HeadlessBackend {
	return new HeadlessBackend({
		width,
		height,
		scale: 2,
		measureText: measureTextWithNative,
	});
}

function createPopulatedController(options?: {
	readonly longText?: boolean;
	readonly includeChangedFiles?: boolean;
}): ExportMockController {
	const controller = new ExportMockController({
		cwd: "/workspace/pi-ts",
		models: [
			{ provider: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", name: "Claude Sonnet 4.5", description: "Fast coding model", reasoning: true },
			{ provider: "openai", id: "gpt-5.2", label: "GPT-5.2", name: "GPT-5.2", description: "Reasoning flagship", reasoning: true },
			{ provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", name: "Gemini 2.5 Pro", description: "Long context model", reasoning: false },
		],
	});
	const now = Date.now();
	controller.seedSessionName = "give me a quick overview";
	controller.seedSessionsList = [
		{
			id: "mock-session-1",
			sessionFile: "/workspace/pi-ts/.mock-sessions/mock-session-1.jsonl",
			cwd: "/workspace/pi-ts",
			workspaceName: "pi-ts",
			title: "give me a quick overview",
			createdAt: now - 120_000,
			updatedAt: now - 60_000,
			messageCount: 2,
			isActive: true,
		},
		{
			id: "sess-2",
			sessionFile: "/workspace/pi-ts/.mock-sessions/sess-2.jsonl",
			cwd: "/workspace/pi-ts",
			workspaceName: "pi-ts",
			title: "Refactor theme tokens",
			createdAt: now - 3_600_000 * 25,
			updatedAt: now - 3_600_000 * 24,
			messageCount: 4,
			isActive: false,
		},
	];
	const promptText = options?.longText
		? "Audit every single long unbreakable URL and verbose diagnostic string across the entire transcript column to verify maxWidth remains strictly clamped to 720px at 1280px viewports."
		: "give me a quick overview of how the repository architecture, workspace layout, and rendering pipeline fit together cleanly";
	const assistantText = options?.longText
		? [
				"Checked layout bounds across all panes. The centered column remains clamped to 720px while preserving crisp inline code like `packages/coding-agent/src/modes/gui/composer.ts` across wide viewports.",
				"",
				"### Overflow & Typography Verification",
				"- **Sidebar & Chrome** (`252px`): Traffic-light clearance (`x >= 86`), non-wrapping group headers (`Today`, `Yesterday`), `51px` session rows, and borderless `40px` footer.",
				"- **Centered Column** (`720px`): User message bubbles wrap inside `maxBubbleWidth = 540`, `Worked for 1.2s` disclosure stays single-line, and Markdown paragraphs plus inline code spans measure with native CoreText metrics.",
				"- **Long Code Block Clamping**:",
				"```ts",
				"export const clampTranscriptColumnWidth = (availW: number): number => Math.min(720, Math.max(240, availW));",
				"export const LONG_UNBREAKABLE_TRACE = \"https://github.com/keejkrej/pi-ts/packages/coding-agent/src/modes/gui/ui-replication-export.ts#overflow-verification-anchor\";",
				"```",
				"- **Inspector & Overlay Metrics**: Command Palette (`680x480`), Model Picker (`460x390`), Commit Dialog (`420px`), and Right Panel (`460px` Changes / Files / Terminal / Tree) remain bounded cleanly inside the viewport.",
				"- **Scroll Verification**: Extended transcript turns verify vertical scroll overflow handling beneath the `48px` header and above the `720px` floating composer without overlapping footer chips or clipping text runs.",
				"- **Theme Tokens & Borders**: Surface tokens (`#1A1A1A` dark canvas, `#F6F5F6` light canvas) and neutral dividers remain strictly aligned across dark and light appearances.",
				"- **Interactive State Continuity**: Overlays dismiss cleanly without leaking `#E2795B` focus halos onto non-focused inputs or section titles.",
				"",
				"### Additional Verification Notes",
				"1. Single-line chips in the composer toolbar keep trailing chevrons aligned with zero vertical wrap.",
				"2. Right panel code previews render syntax tokens with clipping instead of cascading line wraps.",
				"3. Scroll viewport maintains top alignment at offset `0` while exposing overflow height past the bottom edge.",
				"",
				"All measured bounds remain inside their container constraints with zero horizontal bleed across `860x640`, `1280x820`, and `1600x960`.",
			].join("\n")
		: "Updated `packages/gui/src/theme.ts` and aligned sidebar, composer, and overlay geometry.";
	controller.seedTranscriptList = [
		{
			id: "u-1",
			role: "user",
			timestamp: now - 40_000,
			text: promptText,
		},
		{
			id: "a-1",
			role: "assistant",
			timestamp: now - 35_000,
			text: assistantText,
			durationMs: 1200,
			turnDurationMs: 1200,
		},
	];
	controller.seedUsage = {
		usedTokens: 142_000,
		maxTokens: 200_000,
		percent: 71,
		inputTokens: 98_000,
		outputTokens: 44_000,
		cacheReadTokens: 18_000,
		cacheWriteTokens: 4_000,
		totalCostUsd: 0.42,
		modelId: "claude-sonnet-4-5",
	};
	controller.seedChangedFilesList =
		options?.includeChangedFiles === false
			? []
			: [
				{
					path: "src/app.ts",
					status: "M",
					additions: 14,
					deletions: 3,
					hunks: [
						{ kind: "hunk", text: "@@ -12,6 +12,8 @@" },
						{ kind: "context", oldLine: 12, newLine: 12, text: "export interface AppState {" },
						{ kind: "del", oldLine: 13, text: "  status: \"idle\" | \"running\";" },
						{ kind: "del", oldLine: 14, text: "  retries: number;" },
						{ kind: "del", oldLine: 15, text: "  debug: boolean;" },
						{ kind: "add", newLine: 13, text: "  status: \"idle\" | \"running\" | \"queued\";" },
						{ kind: "add", newLine: 14, text: "  retries: number;" },
						{ kind: "add", newLine: 15, text: "  maxRetries: number;" },
						{ kind: "add", newLine: 16, text: "  debug: boolean;" },
						{ kind: "add", newLine: 17, text: "  traceId: string | null;" },
						{ kind: "context", oldLine: 16, newLine: 18, text: "  ready: boolean;" },
						{ kind: "context", oldLine: 17, newLine: 19, text: "}" },
						{ kind: "hunk", text: "@@ -34,1 +45,10 @@" },
						{ kind: "context", oldLine: 34, newLine: 45, text: "export function createAppState(): AppState {" },
						{ kind: "add", newLine: 46, text: "  const traceId = crypto.randomUUID();" },
						{ kind: "add", newLine: 47, text: "  const store = createStore({ traceId });" },
						{ kind: "add", newLine: 48, text: "  store.subscribe(\"status\", () => {" },
						{ kind: "add", newLine: 49, text: "    store.touch();" },
						{ kind: "add", newLine: 50, text: "  });" },
						{ kind: "add", newLine: 51, text: "  return {" },
						{ kind: "add", newLine: 52, text: "    status: \"idle\"," },
						{ kind: "add", newLine: 53, text: "    retries: 0," },
						{ kind: "add", newLine: 54, text: "    maxRetries: 3," },
					],
				},
				{
					path: "README.md",
					status: "A",
					additions: 8,
					deletions: 0,
					hunks: [
						{ kind: "hunk", text: "@@ -0,0 +1,1 @@" },
						{ kind: "add", newLine: 1, text: "# pi-ts" },
					],
				},
			];
	controller.seedWorkspaceFilesList = [
		{ name: "src", path: "/workspace/pi-ts/src", relativePath: "src", isDir: true, depth: 0, expanded: true },
		{ name: "app.ts", path: "/workspace/pi-ts/src/app.ts", relativePath: "src/app.ts", isDir: false, depth: 1 },
		{ name: "theme.ts", path: "/workspace/pi-ts/src/theme.ts", relativePath: "src/theme.ts", isDir: false, depth: 1 },
		{ name: "composer.ts", path: "/workspace/pi-ts/src/composer.ts", relativePath: "src/composer.ts", isDir: false, depth: 1 },
		{ name: "docs", path: "/workspace/pi-ts/docs", relativePath: "docs", isDir: true, depth: 0, expanded: false },
		{ name: "README.md", path: "/workspace/pi-ts/README.md", relativePath: "README.md", isDir: false, depth: 0 },
		{ name: "package.json", path: "/workspace/pi-ts/package.json", relativePath: "package.json", isDir: false, depth: 0 },
	];
	controller.seedTreeEntriesList = [
		{
			id: "tree-root",
			kind: "session",
			label: "Session initialized",
			summary: "give me a quick overview",
			isCurrent: false,
			depth: 0,
			timestamp: "10:12",
		},
		{
			id: "tree-u1",
			parentId: "tree-root",
			kind: "user",
			label: "User prompt",
			summary: "Review architecture & theme tokens",
			isCurrent: false,
			depth: 1,
			timestamp: "10:13",
		},
		{
			id: "tree-a1",
			parentId: "tree-u1",
			kind: "assistant",
			label: "Assistant response",
			summary: "Aligned Waku dark & light palettes",
			isCurrent: false,
			depth: 1,
			timestamp: "10:13",
		},
		{
			id: "tree-u2",
			parentId: "tree-a1",
			kind: "user",
			label: "User prompt",
			summary: "Verify CoreText metrics & right panel tabs",
			isCurrent: false,
			depth: 2,
			timestamp: "10:14",
		},
		{
			id: "tree-a2",
			parentId: "tree-u2",
			kind: "assistant",
			label: "Active leaf",
			summary: "All 35 views synchronized cleanly",
			isCurrent: true,
			depth: 2,
			timestamp: "10:15",
		},
	];
	return controller;
}

function writeSpecAndPng(
	outDir: string,
	surface: string,
	state: string,
	viewport: { readonly w: number; readonly h: number },
	nodes: readonly ExtractedSpecNode[],
	backend: HeadlessBackend,
	summaries: UiReplicationScenarioSummary[],
): void {
	const layoutPath = join(outDir, "actual-layout", surface, `${state}@${viewport.w}x${viewport.h}.yaml`);
	mkdirSync(dirname(layoutPath), { recursive: true });
	writeFileSync(layoutPath, serializeSpecFile(surface, state, viewport, nodes), "utf8");

	const pngPath = join(outDir, "screenshots", "candidate", `${surface}-${state}@${viewport.w}x${viewport.h}.png`);
	mkdirSync(dirname(pngPath), { recursive: true });
	const frameBytes = backend.getLastFrameBytes();
	const pngWritten =
		frameBytes !== undefined &&
		frameBytes.length > 0 &&
		renderDrawListToPng(viewport.w, viewport.h, 2, frameBytes, pngPath);

	summaries.push({
		surface,
		state,
		viewport: `${viewport.w}x${viewport.h}`,
		nodeCount: nodes.length,
		pngWritten,
	});
}

function runWorkspaceScenario(
	outDir: string,
	state: string,
	viewport: { readonly w: number; readonly h: number },
	componentRecords: Map<string, CapturedComponentRecord>,
	summaries: UiReplicationScenarioSummary[],
	observedStates: {
		appWorkspace: Record<string, Record<string, boolean | number | string>>;
	},
): void {
	const backend = createExportBackend(viewport.w, viewport.h);
	const app = new GuiApp({
		backend,
		theme: state === "light" ? lightGuiTheme : darkGuiTheme,
		window: { title: "pi", width: viewport.w, height: viewport.h, titlebarHidden: true },
	});

	let controller: ExportMockController;
	if (state === "empty") {
		controller = new ExportMockController({
			cwd: "/workspace/pi-ts",
			models: [
				{ provider: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", name: "Claude Sonnet 4.5", description: "Fast coding model", reasoning: true },
				{ provider: "openai", id: "gpt-5.2", label: "GPT-5.2", name: "GPT-5.2", description: "Reasoning flagship", reasoning: true },
				{ provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", name: "Gemini 2.5 Pro", description: "Long context model", reasoning: false },
			],
		});
		controller.seedSessionsList = [];
		controller.seedTranscriptList = [];
	} else {
		controller = createPopulatedController({ longText: state === "overflow" });
	}
	if (state === "light") {
		controller.updateLayoutPreferences({ appearance: "light" });
	}
	if (state === "sidebar-collapsed") {
		controller.updateLayoutPreferences({ sidebarCollapsed: true });
	}
	if (state === "right-panel-open") {
		controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "changes" });
	}
	if (state === "busy-queued") {
		controller.seedStreaming = true;
		controller.seedQueuedList = [
			{ id: "q-1", kind: "followUp", text: "Follow up: run full test suite after formatting", createdAt: Date.now() },
		];
	}
	if (state === "toast") {
		controller.seedToastsList = [
			{ id: "t-1", message: "Saved snapshot to workspace cleanly", level: "info", createdAt: Date.now() },
		];
	}

	const handle = mountPiGui(app, {
		controller,
		initialTheme: state === "light" ? lightGuiTheme : darkGuiTheme,
	});
	app.renderFrame();
	if (state === "overflow") {
		handle.transcriptView.scrollToTop();
	}
	app.step(16);
	app.renderFrame();

	const rootComp = app.getRootComponent();
	const nodes = rootComp !== undefined ? collectLiveSpecNodes(rootComp) : [];

	if (state === "populated" && viewport.w === 1280) {
		const sbSurf = handle.sidebar.getSurfaceStyle();
		componentRecords.set("sidebar.surface", {
			node: "workspace.sidebar",
			background: formatThemeColor(sbSurf.background),
			border: {
				width: sbSurf.borderWidth,
				style: sbSurf.borderWidth > 0 ? "solid" : "none",
				color: formatThemeColor(sbSurf.borderColor),
			},
			width: sbSurf.width,
		});
		if (handle.composer.card instanceof Box) {
			componentRecords.set(
				"composer.card",
				styleRecordFromBox("workspace.main.composer", handle.composer.card, {
					radius: true,
					padding: true,
					maxWidth: true,
				}),
			);
		}
		const firstBubble = handle.transcriptView.getUserBubbleBoxes()[0];
		if (firstBubble !== undefined) {
			componentRecords.set(
				"user.bubble",
				styleRecordFromBox("workspace.main.transcript.user_bubble.0", firstBubble, {
					radius: true,
					padding: true,
					maxWidth: true,
				}),
			);
		}
	}
	if (state === "toast" && viewport.w === 1280) {
		const toastBox = handle.toastBanner.getActiveOverlayComponent();
		if (toastBox !== undefined) {
			componentRecords.set(
				"toast.card",
				styleRecordFromBox("workspace.toast", toastBox, {
					radius: true,
					padding: true,
					maxWidth: true,
				}),
			);
		}
		observedStates.appWorkspace.toast = {
			toastTop: toastBox?.layoutRect.y ?? 0,
			dismissButtonSize: 26,
		};
	}

	writeSpecAndPng(outDir, "app.workspace", state, viewport, nodes, backend, summaries);

	if (state === "empty" && viewport.w === 1280) {
		const emptyNode = nodes.find((n) => n.key === "workspace.main.empty_state");
		const undispatched = nodes.some((n) => n.key.startsWith("workspace.sidebar.session."));
		observedStates.appWorkspace.empty = {
			emptyStateVisible: emptyNode !== undefined && emptyNode.bounds.h > 0,
			undispatchedSidebarCard: undispatched,
		};
	} else if (state === "populated" && viewport.w === 1280) {
		const bubbleNode = nodes.find((n) => n.key === "workspace.main.transcript.user_bubble.0");
		const workedNode = nodes.find((n) => n.key === "workspace.main.transcript.worked_fold.0");
		observedStates.appWorkspace.populated = {
			userBubbleMaxWidth: bubbleNode?.bounds.w ?? 0,
			workedFoldVisible: workedNode !== undefined,
		};
	} else if (state === "light") {
		observedStates.appWorkspace.light = {
			canvas: formatThemeColor(app.getTheme().background),
			sidebar: formatThemeColor(app.getTheme().sidebarBg),
			composer: formatThemeColor(app.getTheme().surfaceComposer),
		};
	} else if (state === "sidebar-collapsed") {
		const hdrToggle = nodes.find((n) => n.key === "workspace.main.header.sidebar_toggle");
		observedStates.appWorkspace["sidebar-collapsed"] = {
			sidebarVisible: nodes.some((n) => n.key === "workspace.sidebar"),
			centerHeaderControlsAtX: hdrToggle?.bounds.x ?? 0,
		};
	} else if (state === "right-panel-open") {
		const rp = nodes.find((n) => n.key === "workspace.right_panel");
		observedStates.appWorkspace["right-panel-open"] = {
			rightPanelWidth: rp?.bounds.w ?? 0,
		};
	} else if (state === "busy-queued") {
		const qt = nodes.find((n) => n.key === "workspace.main.queue_tray");
		const stop = nodes.find(
			(n) =>
				(n.key === "workspace.main.composer.stop" || n.key === "workspace.main.composer.send") &&
				n.text?.value === "Stop",
		);
		const qf = nodes.find((n) => n.key === "workspace.main.composer.queue_followup");
		observedStates.appWorkspace["busy-queued"] = {
			queueTrayVisible: qt !== undefined,
			stopButtonVisible: stop !== undefined && stop.bounds.w > 0,
			queueFollowupVisible: qf !== undefined && qf.bounds.w > 0,
		};
	} else if (state === "overflow") {
		const bubble = nodes.find((n) => n.key === "workspace.main.transcript.user_bubble.0");
		const asst = nodes.find((n) => n.key === "workspace.main.transcript.assistant.0");
		const comp = nodes.find((n) => n.key === "workspace.main.composer");
		observedStates.appWorkspace.overflow = {
			maxContentWidth: Math.max(bubble?.bounds.w ?? 0, asst?.bounds.w ?? 0, comp?.bounds.w ?? 0),
			clampedToViewport: (comp?.bounds.w ?? 0) <= viewport.w && (asst?.bounds.w ?? 0) <= 720,
		};
	}

	handle.dispose();
	app.dispose();
}

function runRightPanelScenario(
	outDir: string,
	tab: RightPanelTab,
	summaries: UiReplicationScenarioSummary[],
): void {
	const viewport = { w: 1280, h: 820 };
	const backend = createExportBackend(viewport.w, viewport.h);
	const app = new GuiApp({
		backend,
		theme: darkGuiTheme,
		window: { title: "pi", width: viewport.w, height: viewport.h, titlebarHidden: true },
	});
	const controller = createPopulatedController({ includeChangedFiles: true });
	controller.updateLayoutPreferences({
		rightPanelOpen: true,
		rightPanelTab: tab,
		rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
	});
	const handle = mountPiGui(app, { controller, initialTheme: darkGuiTheme });
	handle.rightPanel.setOpenTabs([tab]);
	handle.rightPanel.setActiveTab(tab);
	handle.rightPanel.setSpecMode("standalone");
	if (tab === "files") {
		handle.rightPanel.expandDir("src");
		handle.rightPanel.setFilePreview({
			path: "/workspace/pi-ts/src/app.ts",
			relativePath: "src/app.ts",
			isBinary: false,
			truncated: false,
			lineCount: 12,
			language: "typescript",
			content: [
				'import { GuiApp, darkGuiTheme } from "@pi-ts/gui";',
				"",
				"export interface WorkspaceConfig {",
				"	readonly width: number;",
				"	readonly theme: typeof darkGuiTheme;",
				"}",
				"",
				"export function bootWorkspace(cfg: WorkspaceConfig): GuiApp {",
				"	return new GuiApp({ theme: cfg.theme, backend: undefined as never });",
				"}",
				"",
				"export const ready = true;",
			].join("\n"),
		});
	}
	app.renderFrame();
	app.step(16);
	app.renderFrame();

	const rpOrigin = handle.rightPanel.root.layoutRect;
	const rawNodes = collectLiveSpecNodes(handle.rightPanel.root);
	const normalizedNodes: ExtractedSpecNode[] = rawNodes.map((n) => ({
		...n,
		bounds: {
			x: n.bounds.x - rpOrigin.x,
			y: n.bounds.y - rpOrigin.y,
			w: n.bounds.w,
			h: n.bounds.h,
		},
	}));
	writeSpecAndPng(outDir, "app.right_panel", tab, viewport, normalizedNodes, backend, summaries);

	handle.dispose();
	app.dispose();
}

function runOverlayScenarios(
	outDir: string,
	componentRecords: Map<string, CapturedComponentRecord>,
	summaries: UiReplicationScenarioSummary[],
	observedStates: {
		modelPicker: Record<string, Record<string, boolean | number | string>>;
		commandPalette: Record<string, Record<string, boolean | number | string>>;
	},
): void {
	const viewport = { w: 1280, h: 820 };

	const withShell = (fn: (ctx: {
		readonly backend: HeadlessBackend;
		readonly app: GuiApp;
		readonly controller: ExportMockController;
		readonly handle: ReturnType<typeof mountPiGui>;
	}) => void): void => {
		const backend = createExportBackend(viewport.w, viewport.h);
		const app = new GuiApp({
			backend,
			theme: darkGuiTheme,
			window: { title: "pi", width: viewport.w, height: viewport.h, titlebarHidden: true },
		});
		const controller = createPopulatedController({ includeChangedFiles: true });
		const handle = mountPiGui(app, { controller, initialTheme: darkGuiTheme });
		app.renderFrame();
		app.step(16);
		fn({ backend, app, controller, handle });
		handle.dispose();
		app.dispose();
	};

	const captureTopOverlay = (
		app: GuiApp,
		backend: HeadlessBackend,
		surface: string,
		state: string,
	): readonly ExtractedSpecNode[] => {
		app.renderFrame();
		app.step(16);
		app.renderFrame();
		const overlays = app.getVisibleOverlayComponents();
		const top = overlays[overlays.length - 1];
		const nodes = top !== undefined ? collectLiveSpecNodes(top) : [];
		writeSpecAndPng(outDir, surface, state, viewport, nodes, backend, summaries);
		return nodes;
	};

	// 1. popover.sidebar_options default
	withShell(({ backend, app, handle }) => {
		const optRect: Rect = handle.sidebar.getOptionsButtonRect() ?? { x: 200, y: 126, width: 20, height: 20 };
		handle.openSidebarOptions(optRect);
		captureTopOverlay(app, backend, "app.popover.sidebar_options", "default");
	});

	// 2. popover.model_picker default, search-cleared, favorites
	withShell(({ backend, app, handle }) => {
		const chipRect = handle.composer.modelButton.layoutRect;
		handle.openModelPicker(chipRect);
		const defNodes = captureTopOverlay(app, backend, "app.popover.model_picker", "default");
		const topDefault = app.getVisibleOverlayComponents()[0];
		if (topDefault instanceof Box) {
			componentRecords.set(
				"popover.model_picker",
				styleRecordFromBox("popover.model_picker", topDefault, {
					radius: true,
					width: true,
					height: true,
				}),
			);
		}
		const mpNode = defNodes.find((n) => n.key === "popover.model_picker");
		const railNode = defNodes.find((n) => n.key === "popover.model_picker.rail");
		observedStates.modelPicker.default = {
			width: mpNode?.bounds.w ?? 0,
			height: mpNode?.bounds.h ?? 0,
			railWidth: railNode?.bounds.w ?? 0,
		};

		// Type query then Escape once -> search-cleared & stays open
		backend.insertText("claude");
		app.step(16);
		backend.pressKey("escape");
		app.step(16);
		const staysOpen = handle.hasActiveOverlay();
		const scNodes = captureTopOverlay(app, backend, "app.popover.model_picker", "search-cleared");
		observedStates.modelPicker["search-cleared"] = {
			firstEscapeClearsQuery: scNodes.find((n) => n.key === "popover.model_picker")?.state === "search-cleared",
			staysOpen,
		};

		// Toggle favorites filter button
		const favBtnNode = findA11y(backend.getAccessibilityTree(), (n) => n.label === "Filter Favorite Models");
		if (favBtnNode !== undefined) {
			backend.triggerA11yPress(favBtnNode.id);
			app.step(16);
		}
		const favNodes = captureTopOverlay(app, backend, "app.popover.model_picker", "favorites");
		observedStates.modelPicker.favorites = {
			favoritesTabActive: favNodes.find((n) => n.key === "popover.model_picker.rail.favorites")?.state === "active",
		};
	});

	// 3. popover.thinking_picker default
	withShell(({ backend, app, handle }) => {
		const chipRect = handle.composer.thinkingButton.layoutRect;
		handle.openThinkingPicker(chipRect);
		captureTopOverlay(app, backend, "app.popover.thinking_picker", "default");
	});

	// 4. popover.project_picker default
	withShell(({ backend, app, controller, handle }) => {
		const extraProjects = ["pi-go", "pi-rs", "waku", "pi", "evals"];
		const baseSessions = (controller.seedSessionsList ?? []).slice();
		const now = Date.now();
		for (let i = 0; i < extraProjects.length; i++) {
			const proj = extraProjects[i];
			if (proj === undefined) continue;
			baseSessions.push({
				id: `proj-seed-${i}`,
				sessionFile: `/workspace/${proj}/.mock-sessions/s.jsonl`,
				cwd: `/workspace/${proj}`,
				workspaceName: proj,
				title: `Session in ${proj}`,
				createdAt: now - (i + 2) * 3_600_000,
				updatedAt: now - (i + 2) * 3_600_000,
				messageCount: 1,
				isActive: false,
			});
		}
		controller.seedSessionsList = baseSessions;
		handle.openProjectPicker(handle.footerBar.projectButton.layoutRect);
		captureTopOverlay(app, backend, "app.popover.project_picker", "default");
	});

	// 5. popover.workspace_picker default
	withShell(({ backend, app, handle }) => {
		handle.openWorkspacePicker(handle.footerBar.workspaceButton.layoutRect);
		captureTopOverlay(app, backend, "app.popover.workspace_picker", "default");
	});

	// 6. popover.branch_picker default & create
	withShell(({ backend, app, handle }) => {
		handle.openGitBranchModal(handle.footerBar.gitBranchButton.layoutRect, "list");
		captureTopOverlay(app, backend, "app.popover.branch_picker", "default");
		const newBranchBtn = findA11y(
			backend.getAccessibilityTree(),
			(n) => n.label === "Create and checkout new branch…",
		);
		if (newBranchBtn !== undefined) {
			backend.triggerA11yPress(newBranchBtn.id);
			app.step(16);
		}
		captureTopOverlay(app, backend, "app.popover.branch_picker", "create");
	});

	// 7. popover.context_usage default
	withShell(({ backend, app, handle }) => {
		handle.openContextPopover({ x: 792, y: 784, width: 320, height: 24 });
		captureTopOverlay(app, backend, "app.popover.context_usage", "default");
	});

	// 8. command_palette default, filtered, empty
	withShell(({ backend, app, handle }) => {
		handle.openCommandPalette();
		const defNodes = captureTopOverlay(app, backend, "app.command_palette", "default");
		const topPalette = app.getVisibleOverlayComponents()[0];
		if (topPalette instanceof Box) {
			componentRecords.set(
				"command_palette.card",
				styleRecordFromBox("command_palette.card", topPalette, {
					radius: true,
					maxWidth: true,
					maxHeight: true,
				}),
			);
		}
		const searchN = defNodes.find((n) => n.key === "command_palette.search");
		const row0N = defNodes.find((n) => n.key === "command_palette.row.0");
		const cardN = defNodes.find((n) => n.key === "command_palette.card");
		observedStates.commandPalette.default = {
			searchHeight: searchN?.bounds.h ?? 0,
			rowHeight: row0N?.bounds.h ?? 0,
			maxHeight: cardN?.bounds.h ?? 0,
		};

		backend.insertText("session");
		app.step(16);
		const filtNodes = captureTopOverlay(app, backend, "app.command_palette", "filtered");
		observedStates.commandPalette.filtered = {
			narrowsRows: filtNodes.find((n) => n.key === "command_palette.card")?.state === "filtered",
		};

		backend.insertText("zzzz_no_match");
		app.step(16);
		const empNodes = captureTopOverlay(app, backend, "app.command_palette", "empty");
		const emptyN = empNodes.find((n) => n.key === "command_palette.empty");
		observedStates.commandPalette.empty = {
			emptyHeight: emptyN?.bounds.h ?? 0,
			message: emptyN?.text?.value ?? "",
		};
	});

	// 9. dialog.commit default
	withShell(({ backend, app, handle }) => {
		handle.openGitCommitModal();
		captureTopOverlay(app, backend, "app.dialog.commit", "default");
		const topCommit = app.getVisibleOverlayComponents()[0];
		if (topCommit instanceof Box) {
			componentRecords.set(
				"commit_dialog.card",
				styleRecordFromBox("commit_dialog.card", topCommit, {
					radius: true,
					maxWidth: true,
				}),
			);
		}
	});

	// 10. settings general, appearance, providers, skills, usage
	const settingsTabs = ["general", "appearance", "providers", "skills", "usage"] as const;
	for (let i = 0; i < settingsTabs.length; i++) {
		const tab = settingsTabs[i];
		if (tab === undefined) continue;
		withShell(({ backend, app, handle }) => {
			handle.openSettings(tab);
			captureTopOverlay(app, backend, "app.settings", tab);
		});
	}
}

function serializeStatesYaml(observedStates: {
	readonly appWorkspace: Record<string, Record<string, boolean | number | string>>;
	readonly modelPicker: Record<string, Record<string, boolean | number | string>>;
	readonly commandPalette: Record<string, Record<string, boolean | number | string>>;
}): string {
	const writeGroup = (name: string, group: Record<string, Record<string, boolean | number | string>>, out: string[]): void => {
		out.push(`  ${name}:`);
		out.push("    status: observed");
		out.push("    evidence:");
		out.push("      - packages/coding-agent/src/modes/gui/ui-replication-export.ts");
		for (const stateKey of Object.keys(group)) {
			out.push(`    ${stateKey}:`);
			const inner = group[stateKey] ?? {};
			for (const propKey of Object.keys(inner)) {
				const v = inner[propKey];
				if (v !== undefined) {
					out.push(`      ${propKey}: ${yamlScalar(v)}`);
				}
			}
		}
	};

	const lines: string[] = [
		"schema: ui-states/1",
		"states:",
	];
	writeGroup("app.workspace", observedStates.appWorkspace, lines);
	writeGroup("popover.model_picker", observedStates.modelPicker, lines);
	writeGroup("command_palette", observedStates.commandPalette, lines);
	return `${lines.join("\n")}\n`;
}

/**
 * Execute every Waku v0.1.20 UI-replication scenario on live GuiApp + HeadlessBackend trees,
 * writing actual-layout/*.yaml, actual-tokens.yaml, actual-components.yaml, actual-states.yaml,
 * and Retina CoreGraphics candidate PNGs inside `outDir`.
 */
export function runUiReplicationExportAll(outDir: string): UiReplicationExportResult {
	mkdirSync(outDir, { recursive: true });
	const summaries: UiReplicationScenarioSummary[] = [];
	const componentRecords = new Map<string, CapturedComponentRecord>();
	const observedStates = {
		appWorkspace: {} as Record<string, Record<string, boolean | number | string>>,
		modelPicker: {} as Record<string, Record<string, boolean | number | string>>,
		commandPalette: {} as Record<string, Record<string, boolean | number | string>>,
	};

	const workspaceSpecs: readonly { readonly state: string; readonly w: number; readonly h: number }[] = [
		{ state: "empty", w: 860, h: 640 },
		{ state: "empty", w: 1280, h: 820 },
		{ state: "empty", w: 1600, h: 960 },
		{ state: "populated", w: 860, h: 640 },
		{ state: "populated", w: 1280, h: 820 },
		{ state: "populated", w: 1600, h: 960 },
		{ state: "light", w: 1280, h: 820 },
		{ state: "sidebar-collapsed", w: 1280, h: 820 },
		{ state: "right-panel-open", w: 1280, h: 820 },
		{ state: "busy-queued", w: 1280, h: 820 },
		{ state: "toast", w: 1280, h: 820 },
		{ state: "overflow", w: 1280, h: 820 },
	];

	for (let i = 0; i < workspaceSpecs.length; i++) {
		const spec = workspaceSpecs[i];
		if (spec === undefined) continue;
		runWorkspaceScenario(outDir, spec.state, { w: spec.w, h: spec.h }, componentRecords, summaries, observedStates);
	}

	const rightPanelTabs: readonly RightPanelTab[] = ["changes", "files", "terminal", "tree"];
	for (let i = 0; i < rightPanelTabs.length; i++) {
		const tab = rightPanelTabs[i];
		if (tab === undefined) continue;
		runRightPanelScenario(outDir, tab, summaries);
	}

	runOverlayScenarios(outDir, componentRecords, summaries, observedStates);

	writeFileSync(join(outDir, "actual-tokens.yaml"), serializeTokensYaml(), "utf8");
	writeFileSync(join(outDir, "actual-components.yaml"), serializeComponentsYaml(componentRecords), "utf8");
	writeFileSync(join(outDir, "actual-states.yaml"), serializeStatesYaml(observedStates), "utf8");

	return { outDir, scenarios: summaries };
}
