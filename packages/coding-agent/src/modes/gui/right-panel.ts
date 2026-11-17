/**
 * Waku collapsible 3-tab Right Panel (Changes | Files | Tree) with left SplitResizeHandle,
 * Unified & Side-by-Side Split diff viewer (#21372A / #3B2424), collapsible workspace tree with
 * tokenizeCodeLines syntax-highlighted file preview, and interactive session DAG tree.
 */

import { basename } from "node:path";
import {
	Badge,
	Box,
	Button,
	type CodeToken,
	type Color,
	Divider,
	drawFocusHalo,
	drawVectorIcon,
	type GuiA11yNode,
	type GuiApp,
	GuiComponent,
	type GuiHost,
	type GuiKeyEvent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiTheme,
	HStack,
	IconButton,
	parseColor,
	Pill,
	pointInRect,
	type Rect,
	ScrollView,
	SegmentedControl,
	type Size,
	Spacer,
	SplitResizeHandle,
	Text,
	tokenColorForKind,
	tokenizeCodeLines,
	TruncatedText,
	VStack,
	withAlpha,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
} from "scriptc-ui";
import { openGitBranchModal, openGitCommitModal } from "./overlays.ts";
import type {
	GuiChangedFile,
	GuiDiffLine,
	GuiSessionController,
	GuiSessionSnapshot,
	GuiTreeEntryItem,
	GuiWorkspaceFileEntry,
	GuiWorkspaceFilePreview,
} from "./types.ts";

export const RIGHT_PANEL_DEFAULT_WIDTH = 380;
export const RIGHT_PANEL_MIN_WIDTH = 260;
export const RIGHT_PANEL_MAX_WIDTH = 640;

const DIFF_ADD_GREEN_TEXT = parseColor("#86C798");
const DIFF_DEL_RED_TEXT = parseColor("#EB8074");
const DIFF_ADD_DARK_BG = parseColor("#21372A");
const DIFF_DEL_DARK_BG = parseColor("#3B2424");
const DIFF_ADD_LIGHT_BG = parseColor("#E6F4EA");
const DIFF_DEL_LIGHT_BG = parseColor("#FCE8E6");
const CORAL_ACCENT = parseColor("#E2795B");

function clampRightPanelWidth(width: number): number {
	return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, Math.round(width)));
}

function statusBadgeColor(status: GuiChangedFile["status"], theme: GuiTheme): Color {
	switch (status) {
		case "A":
		case "U":
			return DIFF_ADD_GREEN_TEXT;
		case "D":
			return DIFF_DEL_RED_TEXT;
		case "R":
			return theme.info;
		case "M":
		default:
			return theme.warning;
	}
}

function inferLanguageFromPath(filePath: string, explicitLang?: string): string {
	if (explicitLang && explicitLang.length > 0) return explicitLang;
	const lower = filePath.toLowerCase();
	if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
	if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) return "javascript";
	if (lower.endsWith(".rs")) return "rust";
	if (lower.endsWith(".go")) return "go";
	if (lower.endsWith(".py")) return "python";
	if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
	if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
	if (lower.endsWith(".toml")) return "toml";
	if (lower.endsWith(".sh") || lower.endsWith(".zsh") || lower.endsWith(".bash")) return "bash";
	if (lower.endsWith(".md")) return "markdown";
	if (lower.endsWith(".css")) return "css";
	if (lower.endsWith(".html") || lower.endsWith(".xml") || lower.endsWith(".svg")) return "xml";
	return "plain";
}

interface SplitDiffRow {
	readonly kind: "hunk" | "pair";
	readonly hunkText?: string;
	readonly leftKind: "context" | "del" | "empty";
	readonly leftLine?: number;
	readonly leftText: string;
	readonly rightKind: "context" | "add" | "empty";
	readonly rightLine?: number;
	readonly rightText: string;
}

function buildSplitDiffRows(lines: readonly GuiDiffLine[]): SplitDiffRow[] {
	const out: SplitDiffRow[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) {
			i += 1;
			continue;
		}
		if (line.kind === "hunk") {
			out.push({
				kind: "hunk",
				hunkText: line.text,
				leftKind: "empty",
				leftText: "",
				rightKind: "empty",
				rightText: "",
			});
			i += 1;
			continue;
		}
		if (line.kind === "context") {
			out.push({
				kind: "pair",
				leftKind: "context",
				leftLine: line.oldLine,
				leftText: line.text,
				rightKind: "context",
				rightLine: line.newLine,
				rightText: line.text,
			});
			i += 1;
			continue;
		}

		// Collect contiguous del run followed by add run and zip side-by-side
		const dels: GuiDiffLine[] = [];
		while (i < lines.length && lines[i]?.kind === "del") {
			const d = lines[i];
			if (d !== undefined) dels.push(d);
			i += 1;
		}
		const adds: GuiDiffLine[] = [];
		while (i < lines.length && lines[i]?.kind === "add") {
			const a = lines[i];
			if (a !== undefined) adds.push(a);
			i += 1;
		}
		const pairCount = Math.max(dels.length, adds.length);
		for (let p = 0; p < pairCount; p++) {
			const d = dels[p];
			const a = adds[p];
			out.push({
				kind: "pair",
				leftKind: d !== undefined ? "del" : "empty",
				leftLine: d?.oldLine,
				leftText: d?.text ?? "",
				rightKind: a !== undefined ? "add" : "empty",
				rightLine: a?.newLine,
				rightText: a?.text ?? "",
			});
		}
	}
	return out;
}

/** Changed file selector row in Changes tab showing M/A/D/R/U badge and +add -del counts. */
class ChangedFileListRow extends GuiComponent {
	private readonly file: GuiChangedFile;
	private readonly selected: boolean;
	private readonly onPick: () => void;

	constructor(file: GuiChangedFile, selected: boolean, onPick: () => void) {
		super();
		this.file = file;
		this.selected = selected;
		this.onPick = onPick;
		this.cursor = SGUI_CURSOR_POINTER;
		this.focusable = true;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 28 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;

		if (this.selected) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.surfaceSelected, 6);
		} else if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 6);
		}
		if (this.isFocused()) {
			drawFocusHalo(ctx, r, 6, 0.2, 2);
		}

		const statusStyle = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeSmall, fontWeight: 700 };
		const stMetrics = ctx.measureText(statusStyle, 0, this.file.status);
		const centerY = r.y + Math.max(0, (r.height - stMetrics.lineHeight) * 0.5);
		ctx.drawStyledText(r.x + 8, centerY, 16, statusBadgeColor(this.file.status, t), statusStyle, this.file.status);

		const addStr = `+${this.file.additions}`;
		const delStr = `-${this.file.deletions}`;
		const countStyle = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeSmall, fontWeight: 500 };
		const delW = ctx.measureText(countStyle, 0, delStr).width;
		const addW = ctx.measureText(countStyle, 0, addStr).width;

		const delX = r.x + r.width - 8 - delW;
		const addX = delX - 6 - addW;
		ctx.drawStyledText(addX, centerY, addW + 2, DIFF_ADD_GREEN_TEXT, countStyle, addStr);
		ctx.drawStyledText(delX, centerY, delW + 2, DIFF_DEL_RED_TEXT, countStyle, delStr);

		const pathStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: t.fontSizeSmall,
			fontWeight: this.selected ? 600 : 400,
		};
		const pathX = r.x + 26;
		const pathAvailW = Math.max(20, addX - pathX - 8);
		ctx.drawStyledText(pathX, centerY, pathAvailW, this.selected ? t.textBright : t.textPrimary, pathStyle, this.file.path);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.onPick();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onPick();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.selected) flags |= SGUI_A11Y_STATE_SELECTED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.file.path,
			value: `${this.file.status} +${this.file.additions} -${this.file.deletions}`,
			rect: this.layoutRect,
			stateFlags: flags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onPick();
			return true;
		}
		return false;
	}
}

/** Monospace Unified and Side-by-Side Split diff content surface inside ScrollView. */
class DiffBodyView extends GuiComponent {
	private file: GuiChangedFile | undefined;
	private mode: "unified" | "split" = "unified";
	private splitRows: SplitDiffRow[] = [];

	setData(file: GuiChangedFile | undefined, mode: "unified" | "split"): void {
		this.file = file;
		this.mode = mode;
		this.splitRows = file !== undefined && mode === "split" ? buildSplitDiffRows(file.hunks) : [];
		this.invalidate();
	}

	private lineHeightFor(ctx: GuiRenderContext): number {
		const style = { fontFamily: SGUI_FONT_MONO, fontSize: ctx.theme.fontSizeCode, fontWeight: 400 };
		return Math.max(18, Math.ceil(ctx.measureText(style, 0, "M").lineHeight) + 4);
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const rowH = this.lineHeightFor(ctx);
		if (this.file === undefined || this.file.hunks.length === 0) {
			return { width: Math.max(0, maxWidth), height: rowH * 2 };
		}
		const count = this.mode === "split" ? this.splitRows.length : this.file.hunks.length;
		return {
			width: Math.max(0, maxWidth),
			height: Math.max(rowH * 2, count * rowH + 8),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const t = ctx.theme;
		const style = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeCode, fontWeight: 400 };
		const rowH = this.lineHeightFor(ctx);
		const addBg = t.dark ? DIFF_ADD_DARK_BG : DIFF_ADD_LIGHT_BG;
		const delBg = t.dark ? DIFF_DEL_DARK_BG : DIFF_DEL_LIGHT_BG;

		if (this.file === undefined) {
			ctx.drawStyledText(r.x + 12, r.y + 12, Math.max(20, r.width - 24), t.textMuted, style, "No file selected.");
			return;
		}
		if (this.file.hunks.length === 0) {
			ctx.drawStyledText(r.x + 12, r.y + 12, Math.max(20, r.width - 24), t.textMuted, style, "No diff hunks available.");
			return;
		}

		ctx.pushClip(r);
		if (this.mode === "unified") {
			let y = r.y + 4;
			for (let i = 0; i < this.file.hunks.length; i++) {
				const line = this.file.hunks[i];
				if (line === undefined) continue;
				if (line.kind === "hunk") {
					ctx.fillRect(r.x, y, r.width, rowH, t.surfaceElevated);
					ctx.drawStyledText(r.x + 10, y + 2, Math.max(20, r.width - 20), t.info, style, line.text);
					y += rowH;
					continue;
				}
				if (line.kind === "add") {
					ctx.fillRect(r.x, y, r.width, rowH, addBg);
				} else if (line.kind === "del") {
					ctx.fillRect(r.x, y, r.width, rowH, delBg);
				}

				const oldNum = line.oldLine !== undefined ? `${line.oldLine}` : "";
				const newNum = line.newLine !== undefined ? `${line.newLine}` : "";
				ctx.drawStyledText(r.x + 6, y + 2, 32, t.textMuted, style, oldNum.padStart(3, " "));
				ctx.drawStyledText(r.x + 42, y + 2, 32, t.textMuted, style, newNum.padStart(3, " "));

				const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
				const prefixColor =
					line.kind === "add" ? DIFF_ADD_GREEN_TEXT : line.kind === "del" ? DIFF_DEL_RED_TEXT : t.textMuted;
				ctx.drawStyledText(r.x + 78, y + 2, 12, prefixColor, style, prefix);

				const codeColor =
					line.kind === "add"
						? t.dark
							? t.textBright
							: DIFF_ADD_GREEN_TEXT
						: line.kind === "del"
							? t.dark
								? t.textBright
								: DIFF_DEL_RED_TEXT
							: t.textPrimary;
				ctx.drawStyledText(r.x + 92, y + 2, Math.max(20, r.width - 100), codeColor, style, line.text);
				y += rowH;
			}
		} else {
			const halfW = Math.floor((r.width - 1) * 0.5);
			const rightX = r.x + halfW + 1;
			let y = r.y + 4;
			for (let i = 0; i < this.splitRows.length; i++) {
				const row = this.splitRows[i];
				if (row === undefined) continue;
				if (row.kind === "hunk") {
					ctx.fillRect(r.x, y, r.width, rowH, t.surfaceElevated);
					ctx.drawStyledText(r.x + 10, y + 2, Math.max(20, r.width - 20), t.info, style, row.hunkText ?? "@@");
					y += rowH;
					continue;
				}
				if (row.leftKind === "del") {
					ctx.fillRect(r.x, y, halfW, rowH, delBg);
				} else if (row.leftKind === "empty") {
					ctx.fillRect(r.x, y, halfW, rowH, withAlpha(t.surfaceMuted, 0.35));
				}
				if (row.rightKind === "add") {
					ctx.fillRect(rightX, y, Math.max(0, r.width - halfW - 1), rowH, addBg);
				} else if (row.rightKind === "empty") {
					ctx.fillRect(rightX, y, Math.max(0, r.width - halfW - 1), rowH, withAlpha(t.surfaceMuted, 0.35));
				}

				const lNum = row.leftLine !== undefined ? `${row.leftLine}` : "";
				ctx.drawStyledText(r.x + 4, y + 2, 30, t.textMuted, style, lNum.padStart(3, " "));
				if (row.leftKind !== "empty") {
					const lPrefix = row.leftKind === "del" ? "-" : " ";
					ctx.drawStyledText(r.x + 36, y + 2, 10, row.leftKind === "del" ? DIFF_DEL_RED_TEXT : t.textMuted, style, lPrefix);
					ctx.drawStyledText(r.x + 48, y + 2, Math.max(10, halfW - 52), t.textPrimary, style, row.leftText);
				}

				ctx.fillRect(r.x + halfW, y, 1, rowH, t.border);

				const rNum = row.rightLine !== undefined ? `${row.rightLine}` : "";
				ctx.drawStyledText(rightX + 4, y + 2, 30, t.textMuted, style, rNum.padStart(3, " "));
				if (row.rightKind !== "empty") {
					const rPrefix = row.rightKind === "add" ? "+" : " ";
					ctx.drawStyledText(rightX + 36, y + 2, 10, row.rightKind === "add" ? DIFF_ADD_GREEN_TEXT : t.textMuted, style, rPrefix);
					ctx.drawStyledText(rightX + 48, y + 2, Math.max(10, halfW - 52), t.textPrimary, style, row.rightText);
				}
				y += rowH;
			}
		}
		ctx.popClip();
	}

	override collectAccessibilityNodes(out: GuiA11yNode[]): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0 || this.file === undefined) return;
		const summary = this.file.hunks.map((h) => h.text).join("\n");
		out.push({
			id: this.a11yId,
			role: "staticText",
			label: `${this.mode} diff: ${this.file.path}`,
			value: summary,
			rect: this.layoutRect,
			stateFlags: SGUI_A11Y_STATE_ENABLED,
		});
	}
}

/** Workspace tree directory/file row inside Files tab. */
class WorkspaceTreeRow extends GuiComponent {
	private readonly entry: GuiWorkspaceFileEntry;
	private readonly expanded: boolean;
	private readonly selected: boolean;
	private readonly onPress: () => void;

	constructor(entry: GuiWorkspaceFileEntry, expanded: boolean, selected: boolean, onPress: () => void) {
		super();
		this.entry = entry;
		this.expanded = expanded;
		this.selected = selected;
		this.onPress = onPress;
		this.cursor = SGUI_CURSOR_POINTER;
		this.focusable = true;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 26 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		if (this.selected) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.surfaceSelected, 6);
		} else if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 6);
		}
		if (this.isFocused()) {
			drawFocusHalo(ctx, r, 6, 0.2, 2);
		}

		let cursorX = r.x + 8 + this.entry.depth * 14;
		if (this.entry.isDir) {
			drawVectorIcon(
				ctx,
				this.expanded ? "chevron-down" : "chevron-right",
				cursorX,
				r.y + (r.height - 10) * 0.5,
				10,
				t.textMuted,
			);
			cursorX += 14;
			drawVectorIcon(ctx, "folder", cursorX, r.y + (r.height - 12) * 0.5, 12, t.accent);
			cursorX += 16;
		} else {
			cursorX += 14;
			drawVectorIcon(ctx, "file-code", cursorX, r.y + (r.height - 12) * 0.5, 12, t.textSecondary);
			cursorX += 16;
		}

		const style = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: t.fontSizeSmall,
			fontWeight: this.entry.isDir ? 600 : 400,
		};
		const tm = ctx.measureText(style, 0, this.entry.name);
		ctx.drawStyledText(
			cursorX,
			r.y + Math.max(0, (r.height - tm.lineHeight) * 0.5),
			Math.max(16, r.x + r.width - cursorX - 8),
			this.selected ? t.textBright : t.textPrimary,
			style,
			this.entry.name,
		);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.onPress();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onPress();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.selected) flags |= SGUI_A11Y_STATE_SELECTED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.entry.isDir ? `${this.entry.name}/` : this.entry.relativePath,
			value: this.entry.isDir ? (this.expanded ? "expanded" : "collapsed") : this.entry.language ?? "file",
			rect: this.layoutRect,
			stateFlags: flags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onPress();
			return true;
		}
		return false;
	}
}

/** Syntax-highlighted code viewer with line numbers using tokenizeCodeLines & tokenColorForKind. */
class SyntaxPreviewView extends GuiComponent {
	private preview: GuiWorkspaceFilePreview | undefined;
	private tokenizedLines: readonly (readonly CodeToken[])[] = [];
	private rawLines: string[] = [];

	setPreview(preview: GuiWorkspaceFilePreview | undefined): void {
		this.preview = preview;
		if (preview === undefined || preview.isBinary || preview.error !== undefined) {
			this.tokenizedLines = [];
			this.rawLines = [];
		} else {
			const lang = inferLanguageFromPath(preview.relativePath, preview.language);
			this.tokenizedLines = tokenizeCodeLines(preview.content, lang);
			this.rawLines = preview.content.split("\n");
		}
		this.invalidate();
	}

	private lineHeightFor(ctx: GuiRenderContext): number {
		const style = { fontFamily: SGUI_FONT_MONO, fontSize: ctx.theme.fontSizeCode, fontWeight: 400 };
		return Math.max(18, Math.ceil(ctx.measureText(style, 0, "M").lineHeight) + 4);
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const rowH = this.lineHeightFor(ctx);
		if (this.preview === undefined || this.preview.isBinary || this.preview.error !== undefined) {
			return { width: Math.max(0, maxWidth), height: rowH * 3 };
		}
		return {
			width: Math.max(0, maxWidth),
			height: Math.max(rowH * 2, this.tokenizedLines.length * rowH + 10),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		const style = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeCode, fontWeight: 400 };

		if (this.preview === undefined) {
			ctx.drawStyledText(r.x + 12, r.y + 12, Math.max(20, r.width - 24), t.textMuted, style, "Select a file to preview.");
			return;
		}
		if (this.preview.error !== undefined) {
			ctx.drawStyledText(r.x + 12, r.y + 12, Math.max(20, r.width - 24), t.danger, style, this.preview.error);
			return;
		}
		if (this.preview.isBinary) {
			ctx.drawStyledText(r.x + 12, r.y + 12, Math.max(20, r.width - 24), t.textMuted, style, "Binary file preview unavailable.");
			return;
		}

		ctx.pushClip(r);
		const rowH = this.lineHeightFor(ctx);
		const gutterW = 42;
		ctx.fillRect(r.x, r.y, gutterW, r.height, withAlpha(t.surfaceMuted, 0.35));

		let y = r.y + 4;
		for (let i = 0; i < this.tokenizedLines.length; i++) {
			const lineTokens = this.tokenizedLines[i];
			if (lineTokens === undefined) continue;
			const lineNo = `${i + 1}`;
			ctx.drawStyledText(r.x + 6, y + 2, gutterW - 10, t.textMuted, style, lineNo.padStart(4, " "));

			let xCursor = r.x + gutterW + 8;
			const maxX = r.x + r.width - 8;
			for (let ti = 0; ti < lineTokens.length && xCursor < maxX; ti++) {
				const tok = lineTokens[ti];
				if (tok === undefined || tok.text.length === 0) continue;
				const color = tokenColorForKind(tok.kind, t);
				const tokWidth = ctx.measureText(style, 0, tok.text).width;
				ctx.drawStyledText(xCursor, y + 2, Math.max(4, maxX - xCursor), color, style, tok.text);
				xCursor += tokWidth;
			}
			y += rowH;
		}
		ctx.popClip();
	}

	override collectAccessibilityNodes(out: GuiA11yNode[]): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0 || this.preview === undefined) return;
		out.push({
			id: this.a11yId,
			role: "staticText",
			label: `Preview: ${this.preview.relativePath}`,
			value: this.rawLines.slice(0, 20).join("\n"),
			rect: this.layoutRect,
			stateFlags: SGUI_A11Y_STATE_ENABLED,
		});
	}
}

/** Indented interactive session DAG entry row in Tree tab with Coral current highlight. */
class SessionTreeEntryRow extends GuiComponent {
	private readonly entry: GuiTreeEntryItem;
	private readonly selected: boolean;
	private readonly onPick: () => void;

	constructor(entry: GuiTreeEntryItem, selected: boolean, onPick: () => void) {
		super();
		this.entry = entry;
		this.selected = selected;
		this.onPick = onPick;
		this.cursor = SGUI_CURSOR_POINTER;
		this.focusable = true;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 42 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;

		if (this.entry.isCurrent) {
			ctx.fillRect(r.x, r.y, r.width, r.height, withAlpha(CORAL_ACCENT, 0.14), 7);
			ctx.strokeRect(r.x, r.y, r.width, r.height, withAlpha(CORAL_ACCENT, 0.5), 1, 7);
		} else if (this.selected) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.surfaceSelected, 7);
		} else if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 7);
		}
		if (this.isFocused()) {
			drawFocusHalo(ctx, r, 7, 0.2, 2);
		}

		const indentX = r.x + 10 + Math.min(8, this.entry.depth) * 14;
		const dotSz = this.entry.isCurrent ? 8 : 6;
		const dotY = r.y + 11;
		ctx.fillRect(indentX, dotY, dotSz, dotSz, this.entry.isCurrent ? CORAL_ACCENT : t.textMuted, dotSz * 0.5);

		const textX = indentX + dotSz + 8;
		const availW = Math.max(20, r.x + r.width - textX - 10);
		const titleStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: t.fontSizeBody,
			fontWeight: this.entry.isCurrent ? 600 : 500,
		};
		const headline = this.entry.summary.trim().length > 0 ? this.entry.summary.trim() : this.entry.label;
		ctx.drawStyledText(textX, r.y + 6, availW, this.entry.isCurrent ? CORAL_ACCENT : t.textPrimary, titleStyle, headline);

		const metaText = this.entry.timestamp ? `${this.entry.kind} · ${this.entry.timestamp}` : this.entry.kind;
		const subStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 400 };
		ctx.drawStyledText(textX, r.y + 24, availW, t.textSecondary, subStyle, metaText);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.onPick();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onPick();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.entry.isCurrent || this.selected) flags |= SGUI_A11Y_STATE_SELECTED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		const headline = this.entry.summary.trim().length > 0 ? this.entry.summary.trim() : this.entry.label;
		out.push({
			id: this.a11yId,
			role: "button",
			label: headline,
			value: this.entry.isCurrent ? "current" : this.entry.kind,
			rect: this.layoutRect,
			stateFlags: flags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onPick();
			return true;
		}
		return false;
	}
}

/** Resizable Right Panel frame with left SplitResizeHandle and surfaceRaised background. */
class RightPanelContainer extends GuiComponent {
	private readonly content: GuiComponent;
	private readonly resizeHandle: SplitResizeHandle;
	private widthValue: number;

	constructor(content: GuiComponent, resizeHandle: SplitResizeHandle, initialWidth: number) {
		super();
		this.content = content;
		this.resizeHandle = resizeHandle;
		this.widthValue = clampRightPanelWidth(initialWidth);
		this.content.setParent(this);
		this.resizeHandle.setParent(this);
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.content.attachHost(host);
		this.resizeHandle.attachHost(host);
	}

	getWidth(): number {
		return this.widthValue;
	}

	setWidth(width: number): void {
		const clamped = clampRightPanelWidth(width);
		if (this.widthValue === clamped) return;
		this.widthValue = clamped;
		this.resizeHandle.setCurrentWidth(clamped);
		this.invalidate();
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const w = Math.min(maxWidth, this.widthValue);
		const childSize = this.content.measure(ctx, Math.max(0, w - 1), maxHeight);
		return { width: w, height: maxHeight ?? childSize.height };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const handleSize = this.resizeHandle.measure(ctx, 8, rect.height);
		const hw = Math.max(4, handleSize.width);
		this.resizeHandle.layout(ctx, { x: rect.x, y: rect.y, width: hw, height: rect.height });
		this.content.layout(ctx, { x: rect.x + 1, y: rect.y, width: Math.max(0, rect.width - 1), height: rect.height });
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		const hitHandle = this.resizeHandle.hitTest(x, y);
		if (hitHandle !== undefined) return hitHandle;
		return this.content.hitTest(x, y) ?? this;
	}

	override handleScroll(
		event: { x: number; y: number; deltaX: number; deltaY: number; modifiers: { shift: boolean; ctrl: boolean; alt: boolean; super: boolean } },
		ctx: GuiRenderContext,
	): boolean {
		return this.content.handleScroll(event, ctx);
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		ctx.fillRect(r.x, r.y, r.width, r.height, ctx.theme.surfaceRaised);
		this.content.render(ctx);
		this.resizeHandle.render(ctx);
	}

	override onThemeChange(theme: GuiTheme): void {
		this.content.onThemeChange(theme);
		this.resizeHandle.onThemeChange(theme);
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.resizeHandle.collectFocusables(out);
		this.content.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		this.resizeHandle.collectAccessibilityNodes(out, ctx);
		this.content.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (!this.visible) return undefined;
		return this.resizeHandle.findComponentByA11yId(nodeId) ?? this.content.findComponentByA11yId(nodeId);
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		return (
			this.resizeHandle.handleAccessibilityAction(nodeId, action, value, ctx) ||
			this.content.handleAccessibilityAction(nodeId, action, value, ctx)
		);
	}
}

export interface WakuRightPanelCallbacks {
	readonly onClose?: () => void;
	readonly onOpenCommitModal?: () => void;
	readonly onOpenBranchModal?: () => void;
	readonly onResize?: (width: number) => void;
	readonly onResizeEnd?: (width: number) => void;
}

export interface WakuRightPanelHandle {
	readonly root: GuiComponent;
	getWidth(): number;
	setWidth(width: number): void;
	setActiveTab(tab: "changes" | "files" | "tree"): void;
	getActiveTab(): "changes" | "files" | "tree";
	selectFile(path: string): void;
	update(snapshot: GuiSessionSnapshot): void;
	applyTheme(theme: GuiTheme): void;
	dispose(): void;
}

/**
 * Create Waku's collapsible 3-tab right panel (Changes | Files | Tree).
 */
export function createWakuRightPanel(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: WakuRightPanelCallbacks = {},
): WakuRightPanelHandle {
	let currentTheme = app.getTheme();
	let latestSnapshot = controller.getSnapshot();
	let activeTab: "changes" | "files" | "tree" = latestSnapshot.layout.rightPanelTab;
	let selectedDiffPath: string | undefined;
	let selectedWorkspacePath: string | undefined;
	let currentPreview: GuiWorkspaceFilePreview | undefined;
	let previewRequestToken = 0;
	const dirExpandedState = new Map<string, boolean>();
	let selectedTreeEntryId: string | undefined;
	let treePromptOpen = false;
	let frameContainer: RightPanelContainer | undefined;

	const changedCountBadge = new Badge({
		label: "0",
		variant: "accent",
		fontSize: 10,
		padding: { vertical: 2, horizontal: 6 },
	});
	changedCountBadge.visible = false;

	const tabControl = new SegmentedControl({
		label: "Right Panel Tabs",
		items: [
			{ id: "changes", label: "Changes" },
			{ id: "files", label: "Files" },
			{ id: "tree", label: "Tree" },
		],
		selectedId: activeTab,
		onChange: (id) => {
			if (id === "changes" || id === "files" || id === "tree") {
				activeTab = id;
				const nextLayout = controller.updateLayoutPreferences({ rightPanelTab: id });
				latestSnapshot = { ...controller.getSnapshot(), layout: nextLayout };
				rebuildTabBody();
			}
		},
	});

	const closeBtn = new IconButton({
		icon: "close",
		size: 26,
		iconSize: 13,
		label: "Close Right Panel",
		onClick: () => {
			if (callbacks.onClose) {
				callbacks.onClose();
			} else {
				controller.updateLayoutPreferences({ rightPanelOpen: false });
			}
		},
	});

	const topBar = new Box({
		height: 44,
		fillWidth: true,
		padding: { horizontal: 10, vertical: 8 },
		child: new HStack({
			gap: 6,
			align: "center",
			children: [
				tabControl,
				changedCountBadge,
				{ child: new Spacer(), grow: 1 },
				closeBtn,
			],
		}),
	});
	const topDivider = new Divider({ direction: "horizontal" });

	// --- Changes Tab controls ---
	const branchBtn = new Button({
		label: latestSnapshot.gitBranch || "detached",
		leadingIcon: "git-branch",
		variant: "ghost",
		fontSize: 11,
		padding: { vertical: 3, horizontal: 8 },
		onClick: () => {
			if (callbacks.onOpenBranchModal) callbacks.onOpenBranchModal();
			else openGitBranchModal(app, controller);
		},
	});
	const diffModeSeg = new SegmentedControl({
		label: "Diff View Mode",
		items: [
			{ id: "unified", label: "Unified" },
			{ id: "split", label: "Split" },
		],
		selectedId: latestSnapshot.layout.diffViewMode,
		onChange: (id) => {
			if (id === "unified" || id === "split") {
				const nextLayout = controller.updateLayoutPreferences({ diffViewMode: id });
				latestSnapshot = { ...controller.getSnapshot(), layout: nextLayout };
				rebuildChangesTab();
			}
		},
	});
	const commitBtn = new Button({
		label: "Commit...",
		leadingIcon: "git-commit",
		variant: "secondary",
		fontSize: 11,
		padding: { vertical: 4, horizontal: 8 },
		onClick: () => {
			if (callbacks.onOpenCommitModal) callbacks.onOpenCommitModal();
			else openGitCommitModal(app, controller);
		},
	});
	const changedFileListStack = new VStack({ gap: 2 });
	const diffBodyView = new DiffBodyView();
	const diffScroll = new ScrollView({ child: diffBodyView });
	const changesContainer = new VStack({
		gap: 8,
		padding: { horizontal: 10, vertical: 8 },
		children: [
			new HStack({
				gap: 6,
				align: "center",
				children: [
					branchBtn,
					{ child: new Spacer(), grow: 1 },
					diffModeSeg,
					commitBtn,
				],
			}),
			new Box({
				maxHeight: 150,
				fillWidth: true,
				child: new ScrollView({ child: changedFileListStack }),
			}),
			new Divider({ direction: "horizontal" }),
			{ child: diffScroll, grow: 1, shrink: 1 },
		],
	});

	// --- Files Tab controls ---
	const fileTreeStack = new VStack({ gap: 1 });
	const previewHeaderLabel = new TruncatedText({
		text: "No file selected",
		fontSize: currentTheme.fontSizeSmall,
		fontWeight: 600,
		color: currentTheme.textSecondary,
	});
	const previewLangBadge = new Pill({ label: "text", variant: "neutral", fontSize: 10 });
	previewLangBadge.visible = false;
	const syntaxPreview = new SyntaxPreviewView();
	const previewScroll = new ScrollView({ child: syntaxPreview });
	const filesContainer = new VStack({
		gap: 6,
		padding: { horizontal: 10, vertical: 8 },
		children: [
			new Box({
				maxHeight: 220,
				fillWidth: true,
				child: new ScrollView({ child: fileTreeStack }),
			}),
			new Divider({ direction: "horizontal" }),
			new HStack({
				gap: 6,
				align: "center",
				children: [
					{ child: previewHeaderLabel, grow: 1 },
					previewLangBadge,
				],
			}),
			{ child: previewScroll, grow: 1, shrink: 1 },
		],
	});

	// --- Tree Tab controls ---
	const treeStack = new VStack({ gap: 4 });
	const treeActionBanner = new Box({
		fillWidth: true,
		padding: 10,
		background: currentTheme.surfaceElevated,
		borderColor: currentTheme.border,
		borderWidth: 1,
		radius: 8,
	});
	const treeContainer = new VStack({
		gap: 8,
		padding: { horizontal: 10, vertical: 8 },
		children: [
			{ child: new ScrollView({ child: treeStack }), grow: 1, shrink: 1 },
			treeActionBanner,
		],
	});

	const tabBodyHolder = new Box({ fillWidth: true, child: changesContainer });

	const loadFilePreview = async (entry: GuiWorkspaceFileEntry): Promise<void> => {
		const token = ++previewRequestToken;
		selectedWorkspacePath = entry.relativePath;
		previewHeaderLabel.setText(`${entry.relativePath} (loading...)`);
		previewLangBadge.visible = false;
		rebuildFilesTree();

		try {
			const preview = await controller.readWorkspaceFile(entry.path);
			if (token !== previewRequestToken) return;
			currentPreview = preview;
			const metaSuffix = preview.truncated ? ` · ${preview.lineCount}+ lines (truncated)` : ` · ${preview.lineCount} lines`;
			previewHeaderLabel.setText(`${preview.relativePath}${metaSuffix}`);
			const lang = inferLanguageFromPath(preview.relativePath, preview.language);
			previewLangBadge.setLabel(preview.isBinary ? "binary" : lang);
			previewLangBadge.visible = true;
			syntaxPreview.setPreview(preview);
		} catch (err) {
			if (token !== previewRequestToken) return;
			const msg = err instanceof Error ? err.message : String(err);
			currentPreview = {
				path: entry.path,
				relativePath: entry.relativePath,
				isBinary: false,
				truncated: false,
				lineCount: 0,
				content: "",
				error: msg,
			};
			previewHeaderLabel.setText(entry.relativePath);
			syntaxPreview.setPreview(currentPreview);
		}
	};

	const rebuildChangesTab = (): void => {
		const files = latestSnapshot.changedFiles;
		branchBtn.setLabel(latestSnapshot.gitBranch || "detached");
		diffModeSeg.setSelectedId(latestSnapshot.layout.diffViewMode);
		commitBtn.setDisabled(files.length === 0);

		changedFileListStack.clear();
		if (files.length === 0) {
			changedFileListStack.addChild(
				new Box({
					padding: { vertical: 10, horizontal: 6 },
					child: new Text({ text: "Working tree clean — no uncommitted changes.", color: currentTheme.textMuted, fontSize: currentTheme.fontSizeSmall }),
				}),
			);
			diffBodyView.setData(undefined, latestSnapshot.layout.diffViewMode);
			return;
		}

		let chosen: GuiChangedFile | undefined;
		if (selectedDiffPath !== undefined) {
			for (let i = 0; i < files.length; i++) {
				const f = files[i];
				if (f !== undefined && (f.path === selectedDiffPath || basename(f.path) === selectedDiffPath)) {
					chosen = f;
					selectedDiffPath = f.path;
					break;
				}
			}
		}
		if (chosen === undefined) {
			chosen = files[0];
			selectedDiffPath = chosen?.path;
		}

		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			if (f === undefined) continue;
			const isSelected = chosen !== undefined && f.path === chosen.path;
			changedFileListStack.addChild(
				new ChangedFileListRow(f, isSelected, () => {
					selectedDiffPath = f.path;
					rebuildChangesTab();
				}),
			);
		}

		diffBodyView.setData(chosen, latestSnapshot.layout.diffViewMode);
	};

	const rebuildFilesTree = (): void => {
		const entries = latestSnapshot.workspaceFiles;
		fileTreeStack.clear();

		if (entries.length === 0) {
			fileTreeStack.addChild(
				new Box({
					padding: { vertical: 12, horizontal: 6 },
					child: new Text({ text: "No workspace files scanned.", color: currentTheme.textMuted, fontSize: currentTheme.fontSizeSmall }),
				}),
			);
			return;
		}

		let hiddenBelowDepth: number | undefined;
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry === undefined) continue;

			if (entry.isDir && !dirExpandedState.has(entry.relativePath)) {
				dirExpandedState.set(entry.relativePath, entry.expanded ?? false);
			}

			if (hiddenBelowDepth !== undefined && entry.depth > hiddenBelowDepth) {
				continue;
			}
			hiddenBelowDepth = undefined;

			const isDirExpanded = entry.isDir ? (dirExpandedState.get(entry.relativePath) ?? false) : false;
			if (entry.isDir && !isDirExpanded) {
				hiddenBelowDepth = entry.depth;
			}

			const isSelected = !entry.isDir && selectedWorkspacePath === entry.relativePath;
			fileTreeStack.addChild(
				new WorkspaceTreeRow(entry, isDirExpanded, isSelected, () => {
					if (entry.isDir) {
						dirExpandedState.set(entry.relativePath, !isDirExpanded);
						rebuildFilesTree();
					} else {
						void loadFilePreview(entry);
					}
				}),
			);
		}
	};

	const rebuildTreeActionBanner = (): void => {
		const entries = latestSnapshot.treeEntries;
		if (entries.length === 0) {
			treeActionBanner.visible = false;
			return;
		}

		let target: GuiTreeEntryItem | undefined;
		if (selectedTreeEntryId !== undefined) {
			for (let i = 0; i < entries.length; i++) {
				if (entries[i]?.id === selectedTreeEntryId) {
					target = entries[i];
					break;
				}
			}
		}
		if (target === undefined) {
			for (let i = 0; i < entries.length; i++) {
				if (entries[i]?.isCurrent) {
					target = entries[i];
					break;
				}
			}
		}
		if (target === undefined) {
			target = entries[0];
		}
		if (target === undefined) {
			treeActionBanner.visible = false;
			return;
		}

		treeActionBanner.visible = true;
		const chosen = target;
		const titleText = chosen.summary.trim().length > 0 ? chosen.summary.trim() : chosen.label;
		const actions = new HStack({
			gap: 6,
			align: "center",
			children: [
				new Button({
					label: "Fork from here",
					leadingIcon: "fork",
					variant: "secondary",
					fontSize: 11,
					padding: { vertical: 4, horizontal: 8 },
					onClick: () => {
						void controller.forkSession(chosen.id);
					},
				}),
			],
		});

		if (treePromptOpen) {
			actions.insertChild(
				0,
				new Button({
					label: "Navigate",
					variant: "primary",
					fontSize: 11,
					padding: { vertical: 4, horizontal: 8 },
					onClick: () => {
						treePromptOpen = false;
						void controller.navigateTreeEntry(chosen.id, false);
						rebuildTreeTab();
					},
				}),
			);
			actions.insertChild(
				1,
				new Button({
					label: "Summarize",
					variant: "secondary",
					fontSize: 11,
					padding: { vertical: 4, horizontal: 8 },
					onClick: () => {
						treePromptOpen = false;
						void controller.navigateTreeEntry(chosen.id, true);
						rebuildTreeTab();
					},
				}),
			);
		}

		treeActionBanner.setChild(
			new VStack({
				gap: 8,
				children: [
					new TruncatedText({
						text: treePromptOpen ? `Navigate or summarize at "${titleText}"?` : `Selected: ${titleText}`,
						fontSize: currentTheme.fontSizeSmall,
						fontWeight: 600,
						color: currentTheme.textPrimary,
					}),
					actions,
				],
			}),
		);
	};

	const rebuildTreeTab = (): void => {
		const entries = latestSnapshot.treeEntries;
		treeStack.clear();

		if (entries.length === 0) {
			treeStack.addChild(
				new Box({
					padding: { vertical: 16, horizontal: 8 },
					child: new Text({ text: "Session history tree is empty.", color: currentTheme.textMuted, fontSize: currentTheme.fontSizeSmall }),
				}),
			);
			rebuildTreeActionBanner();
			return;
		}

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry === undefined) continue;
			const isSelected = selectedTreeEntryId === entry.id;
			treeStack.addChild(
				new SessionTreeEntryRow(entry, isSelected, () => {
					selectedTreeEntryId = entry.id;
					treePromptOpen = true;
					rebuildTreeTab();
				}),
			);
		}
		rebuildTreeActionBanner();
	};

	const rebuildTabBody = (): void => {
		tabControl.setSelectedId(activeTab);
		if (activeTab === "changes") {
			tabBodyHolder.setChild(changesContainer);
			rebuildChangesTab();
		} else if (activeTab === "files") {
			tabBodyHolder.setChild(filesContainer);
			rebuildFilesTree();
			syntaxPreview.setPreview(currentPreview);
		} else {
			tabBodyHolder.setChild(treeContainer);
			rebuildTreeTab();
		}
	};

	const mainColumn = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			topBar,
			topDivider,
			{ child: tabBodyHolder, grow: 1, shrink: 1 },
		],
	});

	const resizeHandle = new SplitResizeHandle({
		width: 6,
		minWidth: RIGHT_PANEL_MIN_WIDTH,
		maxWidth: RIGHT_PANEL_MAX_WIDTH,
		initialWidth: clampRightPanelWidth(latestSnapshot.layout.rightPanelWidth),
		direction: -1,
		dividerColor: currentTheme.border,
		hoverColor: currentTheme.accent,
		activeColor: currentTheme.accent,
		a11yLabel: "Resize right panel",
		onResize: (nextWidth) => {
			frameContainer?.setWidth(nextWidth);
			callbacks.onResize?.(nextWidth);
		},
		onResizeEnd: (finalWidth) => {
			const clamped = clampRightPanelWidth(finalWidth);
			frameContainer?.setWidth(clamped);
			controller.updateLayoutPreferences({ rightPanelWidth: clamped });
			callbacks.onResizeEnd?.(clamped);
		},
	});

	frameContainer = new RightPanelContainer(
		mainColumn,
		resizeHandle,
		latestSnapshot.layout.rightPanelWidth || RIGHT_PANEL_DEFAULT_WIDTH,
	);

	const update = (snapshot: GuiSessionSnapshot): void => {
		latestSnapshot = snapshot;
		activeTab = snapshot.layout.rightPanelTab;
		if (frameContainer !== undefined) {
			frameContainer.visible = snapshot.layout.rightPanelOpen;
			frameContainer.setWidth(snapshot.layout.rightPanelWidth || RIGHT_PANEL_DEFAULT_WIDTH);
		}
		const count = snapshot.changedFiles.length;
		changedCountBadge.visible = count > 0;
		changedCountBadge.setLabel(`${count}`);
		rebuildTabBody();
	};

	update(latestSnapshot);

	return {
		root: frameContainer,
		getWidth: () => frameContainer.getWidth(),
		setWidth: (width: number) => frameContainer.setWidth(width),
		setActiveTab: (tab: "changes" | "files" | "tree") => {
			activeTab = tab;
			controller.updateLayoutPreferences({ rightPanelTab: tab });
			rebuildTabBody();
		},
		getActiveTab: () => activeTab,
		selectFile: (path: string) => {
			selectedDiffPath = path;
			activeTab = "changes";
			if (!latestSnapshot.layout.rightPanelOpen) {
				controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "changes" });
			} else if (latestSnapshot.layout.rightPanelTab !== "changes") {
				controller.updateLayoutPreferences({ rightPanelTab: "changes" });
			}
			if (frameContainer !== undefined) {
				frameContainer.visible = true;
			}
			rebuildTabBody();
		},
		update,
		applyTheme: (theme: GuiTheme) => {
			currentTheme = theme;
			topDivider.setColor(theme.border);
			treeActionBanner.setBackground(theme.surfaceElevated);
			treeActionBanner.setBorder(theme.border, 1, 8);
			frameContainer.onThemeChange(theme);
			rebuildTabBody();
		},
		dispose: () => {
			previewRequestToken += 1;
			dirExpandedState.clear();
		},
	};
}
