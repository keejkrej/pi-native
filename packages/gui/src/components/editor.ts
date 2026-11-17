/**
 * Multi-line wrapping GUI text editor with mouse selection, undo/redo, kill ring, history, IME, and autocomplete.
 */

import type { TextStyle } from "../backend.ts";
import {
	clampNumber,
	drawElevationShadow,
	drawFocusHalo,
	type Edges,
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import type { GuiKeyEvent } from "../keys.ts";
import { type A11yActionKind, type FontFamilyId, type GuiA11yNode, SGUI_A11Y_STATE_ENABLED, SGUI_A11Y_STATE_FOCUSED, SGUI_CURSOR_IBEAM, SGUI_FONT_REGULAR } from "../protocol.ts";
import type { AutocompleteItem, AutocompleteProvider } from "./autocomplete.ts";
import { KillRing } from "./kill-ring.ts";
import { UndoStack } from "./undo-stack.ts";

export interface EditorPosition {
	readonly line: number;
	readonly col: number;
}

export type EditorVariant = "default" | "chromeless";

export interface EditorOptions {
	readonly initialValue?: string;
	readonly placeholder?: string;
	readonly variant?: EditorVariant;
	readonly fontFamily?: FontFamilyId;
	readonly fontSize?: number;
	readonly padding?: PaddingInput;
	readonly radius?: number;
	readonly minHeight?: number;
	readonly maxHeight?: number;
	readonly minLines?: number;
	readonly maxLines?: number;
	readonly submitOnEnter?: boolean;
	readonly clearOnSubmit?: boolean;
	readonly autocompleteProvider?: AutocompleteProvider;
	readonly onChange?: (text: string) => void;
	readonly onSubmit?: (text: string) => void;
	readonly onPaste?: (clipboardText: string, ctx: GuiRenderContext) => boolean | void;
}

interface EditorSnapshot {
	readonly lines: string[];
	readonly cursorLine: number;
	readonly cursorCol: number;
	readonly anchorLine: number;
	readonly anchorCol: number;
}

interface VisualLine {
	readonly logicalLine: number;
	readonly startCol: number;
	readonly endCol: number;
	readonly text: string;
	readonly hasPreedit: boolean;
	readonly preeditStart: number;
	readonly preeditEnd: number;
}

function cloneEditorSnapshot(snap: EditorSnapshot): EditorSnapshot {
	return {
		lines: snap.lines.slice(),
		cursorLine: snap.cursorLine,
		cursorCol: snap.cursorCol,
		anchorLine: snap.anchorLine,
		anchorCol: snap.anchorCol,
	};
}

function comparePositions(a: EditorPosition, b: EditorPosition): number {
	if (a.line !== b.line) return a.line - b.line;
	return a.col - b.col;
}

function isWordChar(ch: string): boolean {
	return /[A-Za-z0-9_$]/.test(ch);
}

function prevWordInLine(line: string, col: number): number {
	let i = Math.max(0, Math.min(col, line.length));
	while (i > 0 && /\s/.test(line.charAt(i - 1))) i -= 1;
	if (i > 0 && isWordChar(line.charAt(i - 1))) {
		while (i > 0 && isWordChar(line.charAt(i - 1))) i -= 1;
	} else {
		while (i > 0 && !/\s/.test(line.charAt(i - 1)) && !isWordChar(line.charAt(i - 1))) i -= 1;
	}
	return i;
}

function nextWordInLine(line: string, col: number): number {
	let i = Math.max(0, Math.min(col, line.length));
	while (i < line.length && /\s/.test(line.charAt(i))) i += 1;
	if (i < line.length && isWordChar(line.charAt(i))) {
		while (i < line.length && isWordChar(line.charAt(i))) i += 1;
	} else {
		while (i < line.length && !/\s/.test(line.charAt(i)) && !isWordChar(line.charAt(i))) i += 1;
	}
	return i;
}

export class Editor extends GuiComponent {
	private lines: string[];
	private cursorLine: number;
	private cursorCol: number;
	private anchorLine: number;
	private anchorCol: number;
	private preferredX: number | undefined;

	private placeholder: string;
	private variant: EditorVariant;
	private fontFamily: FontFamilyId;
	private fontSize: number | undefined;
	private padding: Edges;
	private radius: number | undefined;
	private minHeight: number;
	private maxHeight: number;
	private minLines: number | undefined;
	private maxLines: number | undefined;
	private submitOnEnter: boolean;
	private clearOnSubmit: boolean;
	private autocompleteProvider: AutocompleteProvider | undefined;

	private preeditText: string;
	private preeditCursorStart: number;

	private scrollY: number;
	private maxScrollY: number;
	private dragging: boolean;

	private readonly undoStack: UndoStack<EditorSnapshot>;
	private readonly killRing: KillRing;
	private lastActionWasKill: boolean;
	private lastActionWasYank: boolean;
	private lastYankStart: EditorPosition;

	private readonly history: string[];
	private historyIndex: number;

	private suggestions: readonly AutocompleteItem[];
	private suggestionPrefix: string;
	private suggestionSelected: number;

	onChange: ((text: string) => void) | undefined;
	onSubmit: ((text: string) => void) | undefined;
	onPaste: ((clipboardText: string, ctx: GuiRenderContext) => boolean | void) | undefined;

	constructor(options: EditorOptions = {}) {
		super();
		const initial = options.initialValue ?? "";
		this.lines = initial.split(/\r?\n/);
		if (this.lines.length === 0) this.lines = [""];
		this.cursorLine = this.lines.length - 1;
		this.cursorCol = (this.lines[this.cursorLine] ?? "").length;
		this.anchorLine = this.cursorLine;
		this.anchorCol = this.cursorCol;
		this.preferredX = undefined;

		this.placeholder = options.placeholder ?? "";
		this.variant = options.variant ?? "default";
		this.fontFamily = options.fontFamily ?? SGUI_FONT_REGULAR;
		this.fontSize = options.fontSize;
		this.padding = normalizeEdges(options.padding ?? (this.variant === "chromeless" ? 0 : 10));
		this.radius = options.radius;
		this.minHeight = options.minHeight ?? 42;
		this.maxHeight = options.maxHeight ?? 240;
		this.minLines = options.minLines;
		this.maxLines = options.maxLines;
		this.submitOnEnter = options.submitOnEnter ?? true;
		this.clearOnSubmit = options.clearOnSubmit ?? false;
		this.autocompleteProvider = options.autocompleteProvider;

		this.preeditText = "";
		this.preeditCursorStart = 0;

		this.scrollY = 0;
		this.maxScrollY = 0;
		this.dragging = false;

		this.undoStack = new UndoStack<EditorSnapshot>(cloneEditorSnapshot);
		this.killRing = new KillRing();
		this.lastActionWasKill = false;
		this.lastActionWasYank = false;
		this.lastYankStart = { line: 0, col: 0 };

		this.history = [];
		this.historyIndex = -1;

		this.suggestions = [];
		this.suggestionPrefix = "";
		this.suggestionSelected = 0;

		this.onChange = options.onChange;
		this.onSubmit = options.onSubmit;
		this.onPaste = options.onPaste;
		this.focusable = true;
		this.cursor = SGUI_CURSOR_IBEAM;
	}

	getVariant(): EditorVariant {
		return this.variant;
	}

	setVariant(variant: EditorVariant): void {
		if (this.variant === variant) return;
		this.variant = variant;
		this.invalidate();
	}

	setHeightBounds(minHeight: number, maxHeight: number): void {
		this.minHeight = Math.max(0, minHeight);
		this.maxHeight = Math.max(this.minHeight, maxHeight);
		this.invalidate();
	}

	getLineCount(): number {
		return this.lines.length;
	}

	getVisualLineCount(ctx: GuiRenderContext, maxWidth: number): number {
		const style = this.textStyle(ctx);
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right);
		return this.buildVisualLines(ctx, style, innerMaxW).length;
	}

	getAutoGrowHeight(ctx: GuiRenderContext, maxWidth: number, maxLinesOverride?: number): number {
		const style = this.textStyle(ctx);
		const lineHeight = ctx.measureText(style, 0, "Mg").lineHeight;
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right);
		const vCount = this.buildVisualLines(ctx, style, innerMaxW).length;
		const padY = this.padding.top + this.padding.bottom;
		const effectiveMinH =
			this.minLines !== undefined ? Math.max(this.minHeight, this.minLines * lineHeight + padY) : this.minHeight;
		const capLines = maxLinesOverride ?? this.maxLines;
		const effectiveMaxH =
			capLines !== undefined ? Math.min(this.maxHeight, capLines * lineHeight + padY) : this.maxHeight;
		const contentH = vCount * lineHeight + padY;
		return clampNumber(contentH, effectiveMinH, Math.max(effectiveMinH, effectiveMaxH));
	}

	getText(): string {
		return this.lines.join("\n");
	}

	setText(text: string): void {
		const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		this.lines = normalized.split("\n");
		if (this.lines.length === 0) this.lines = [""];
		this.cursorLine = this.lines.length - 1;
		this.cursorCol = (this.lines[this.cursorLine] ?? "").length;
		this.anchorLine = this.cursorLine;
		this.anchorCol = this.cursorCol;
		this.scrollY = 0;
		this.preeditText = "";
		this.dismissAutocomplete();
		this.onChange?.(this.getText());
		this.invalidate();
	}

	getCursor(): EditorPosition {
		return { line: this.cursorLine, col: this.cursorCol };
	}

	hasSelection(): boolean {
		return this.cursorLine !== this.anchorLine || this.cursorCol !== this.anchorCol;
	}

	getSelectionRange(): { start: EditorPosition; end: EditorPosition } {
		const c: EditorPosition = { line: this.cursorLine, col: this.cursorCol };
		const a: EditorPosition = { line: this.anchorLine, col: this.anchorCol };
		return comparePositions(c, a) <= 0 ? { start: c, end: a } : { start: a, end: c };
	}

	getSelectedText(): string {
		if (!this.hasSelection()) return "";
		const { start, end } = this.getSelectionRange();
		if (start.line === end.line) {
			return (this.lines[start.line] ?? "").slice(start.col, end.col);
		}
		const parts: string[] = [];
		parts.push((this.lines[start.line] ?? "").slice(start.col));
		for (let i = start.line + 1; i < end.line; i++) {
			parts.push(this.lines[i] ?? "");
		}
		parts.push((this.lines[end.line] ?? "").slice(0, end.col));
		return parts.join("\n");
	}

	setAutocompleteProvider(provider: AutocompleteProvider | undefined): void {
		this.autocompleteProvider = provider;
		this.refreshAutocomplete();
	}

	addToHistory(entry: string): void {
		const trimmed = entry.trim();
		if (trimmed.length === 0) return;
		if (this.history[0] === trimmed) return;
		this.history.unshift(trimmed);
		if (this.history.length > 100) {
			this.history.pop();
		}
		this.historyIndex = -1;
	}

	getAutocompleteItems(): readonly AutocompleteItem[] {
		return this.suggestions;
	}

	private dismissAutocomplete(): void {
		this.suggestions = [];
		this.suggestionPrefix = "";
		this.suggestionSelected = 0;
	}

	private refreshAutocomplete(): void {
		if (this.autocompleteProvider === undefined || this.hasSelection()) {
			this.dismissAutocomplete();
			return;
		}
		const result = this.autocompleteProvider.getSuggestions(this.lines, this.cursorLine, this.cursorCol);
		if (result === null || result.items.length === 0) {
			this.dismissAutocomplete();
			return;
		}
		this.suggestions = result.items;
		this.suggestionPrefix = result.prefix;
		this.suggestionSelected = Math.min(this.suggestionSelected, result.items.length - 1);
	}

	private applySelectedAutocomplete(): boolean {
		if (this.autocompleteProvider === undefined || this.suggestions.length === 0) {
			return false;
		}
		const item = this.suggestions[this.suggestionSelected];
		if (item === undefined) return false;
		this.undoStack.push(this.snapshot());
		const applied = this.autocompleteProvider.applyCompletion(
			this.lines,
			this.cursorLine,
			this.cursorCol,
			item,
			this.suggestionPrefix,
		);
		this.lines = applied.lines.length > 0 ? applied.lines : [""];
		this.cursorLine = clampNumber(applied.cursorLine, 0, this.lines.length - 1);
		this.cursorCol = clampNumber(applied.cursorCol, 0, (this.lines[this.cursorLine] ?? "").length);
		this.anchorLine = this.cursorLine;
		this.anchorCol = this.cursorCol;
		this.dismissAutocomplete();
		this.onChange?.(this.getText());
		this.invalidate();
		return true;
	}

	private textStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: this.fontFamily,
			fontSize: this.fontSize ?? ctx.theme.fontSizeBody,
			fontWeight: 400,
		};
	}

	private snapshot(): EditorSnapshot {
		return {
			lines: this.lines.slice(),
			cursorLine: this.cursorLine,
			cursorCol: this.cursorCol,
			anchorLine: this.anchorLine,
			anchorCol: this.anchorCol,
		};
	}

	private applySnapshot(snap: EditorSnapshot): void {
		this.lines = snap.lines.length > 0 ? snap.lines.slice() : [""];
		this.cursorLine = clampNumber(snap.cursorLine, 0, this.lines.length - 1);
		this.cursorCol = clampNumber(snap.cursorCol, 0, (this.lines[this.cursorLine] ?? "").length);
		this.anchorLine = clampNumber(snap.anchorLine, 0, this.lines.length - 1);
		this.anchorCol = clampNumber(snap.anchorCol, 0, (this.lines[this.anchorLine] ?? "").length);
		this.preferredX = undefined;
		this.refreshAutocomplete();
		this.onChange?.(this.getText());
		this.invalidate();
	}

	private clearActionFlags(): void {
		this.lastActionWasKill = false;
		this.lastActionWasYank = false;
	}

	private replaceRange(start: EditorPosition, end: EditorPosition, text: string, recordUndo = true): void {
		if (recordUndo) {
			this.undoStack.push(this.snapshot());
		}
		const s = comparePositions(start, end) <= 0 ? start : end;
		const e = comparePositions(start, end) <= 0 ? end : start;

		const headLine = (this.lines[s.line] ?? "").slice(0, s.col);
		const tailLine = (this.lines[e.line] ?? "").slice(e.col);
		const inserted = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

		let nextCursorLine = s.line;
		let nextCursorCol = s.col;
		const replacementLines: string[] = [];

		if (inserted.length === 1) {
			const chunk = inserted[0] ?? "";
			replacementLines.push(headLine + chunk + tailLine);
			nextCursorCol = headLine.length + chunk.length;
		} else {
			const first = inserted[0] ?? "";
			replacementLines.push(headLine + first);
			for (let i = 1; i < inserted.length - 1; i++) {
				replacementLines.push(inserted[i] ?? "");
			}
			const last = inserted[inserted.length - 1] ?? "";
			replacementLines.push(last + tailLine);
			nextCursorLine = s.line + inserted.length - 1;
			nextCursorCol = last.length;
		}

		this.lines.splice(s.line, e.line - s.line + 1, ...replacementLines);
		if (this.lines.length === 0) this.lines = [""];
		this.cursorLine = nextCursorLine;
		this.cursorCol = nextCursorCol;
		this.anchorLine = nextCursorLine;
		this.anchorCol = nextCursorCol;
		this.preferredX = undefined;
		this.refreshAutocomplete();
		this.onChange?.(this.getText());
		this.invalidate();
	}

	private buildVisualLines(ctx: GuiRenderContext, style: TextStyle, contentWidth: number): VisualLine[] {
		const out: VisualLine[] = [];
		const widthBudget = Math.max(24, contentWidth);

		for (let li = 0; li < this.lines.length; li++) {
			let raw = this.lines[li] ?? "";
			let hasPreedit = false;
			let preStart = 0;
			let preEnd = 0;

			if (this.preeditText.length > 0 && li === this.cursorLine) {
				preStart = this.cursorCol;
				preEnd = this.cursorCol + this.preeditText.length;
				raw = raw.slice(0, this.cursorCol) + this.preeditText + raw.slice(this.cursorCol);
				hasPreedit = true;
			}

			if (raw.length === 0) {
				out.push({
					logicalLine: li,
					startCol: 0,
					endCol: 0,
					text: "",
					hasPreedit,
					preeditStart: preStart,
					preeditEnd: preEnd,
				});
				continue;
			}

			let pos = 0;
			while (pos < raw.length) {
				const slice = raw.slice(pos);
				const fullW = ctx.getTextCaretX(style, slice, slice.length);
				if (fullW <= widthBudget) {
					out.push({
						logicalLine: li,
						startCol: pos,
						endCol: pos + slice.length,
						text: slice,
						hasPreedit,
						preeditStart: preStart,
						preeditEnd: preEnd,
					});
					break;
				}
				let fit = ctx.hitTestText(style, slice, widthBudget);
				if (fit <= 0) fit = 1;
				// Try snapping back to whitespace boundary for clean word wrap
				if (fit < slice.length && !/\s/.test(slice.charAt(fit))) {
					let spaceIdx = fit;
					while (spaceIdx > 1 && !/\s/.test(slice.charAt(spaceIdx - 1))) {
						spaceIdx -= 1;
					}
					if (spaceIdx > 1) {
						fit = spaceIdx;
					}
				}
				const chunk = slice.slice(0, fit);
				out.push({
					logicalLine: li,
					startCol: pos,
					endCol: pos + fit,
					text: chunk,
					hasPreedit,
					preeditStart: preStart,
					preeditEnd: preEnd,
				});
				pos += fit;
			}
		}
		return out;
	}

	private findCaretVisualPosition(
		ctx: GuiRenderContext,
		style: TextStyle,
		visualLines: readonly VisualLine[],
	): { row: number; colInRow: number; xOffset: number } {
		const targetCol =
			this.preeditText.length > 0
				? this.cursorCol + clampNumber(this.preeditCursorStart, 0, this.preeditText.length)
				: this.cursorCol;

		for (let i = 0; i < visualLines.length; i++) {
			const vl = visualLines[i];
			if (vl === undefined || vl.logicalLine !== this.cursorLine) continue;
			const nextIsSameLogical = i + 1 < visualLines.length && visualLines[i + 1]?.logicalLine === this.cursorLine;
			const matchesEnd = nextIsSameLogical ? targetCol < vl.endCol : targetCol <= vl.endCol;
			if (targetCol >= vl.startCol && matchesEnd) {
				const colInRow = targetCol - vl.startCol;
				return {
					row: i,
					colInRow,
					xOffset: ctx.getTextCaretX(style, vl.text, colInRow),
				};
			}
		}
		const fallbackRow = Math.max(0, visualLines.length - 1);
		const last = fallbackRow < visualLines.length ? visualLines[fallbackRow] : undefined;
		const text = last ? last.text : "";
		return {
			row: fallbackRow,
			colInRow: text.length,
			xOffset: ctx.getTextCaretX(style, text, text.length),
		};
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const style = this.textStyle(ctx);
		const lineMetrics = ctx.measureText(style, 0, "Mg");
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right);
		let maxLineW = this.placeholder.length > 0 ? ctx.measureText(style, 0, this.placeholder).width : 0;
		for (let i = 0; i < this.lines.length; i++) {
			const line = this.lines[i];
			if (line !== undefined && line.length > 0) {
				const w = ctx.measureText(style, 0, line).width;
				if (w > maxLineW) maxLineW = w;
			}
		}
		const naturalW = Math.max(220, maxLineW + this.padding.left + this.padding.right + 8);
		const padY = this.padding.top + this.padding.bottom;
		const vLines = this.buildVisualLines(ctx, style, innerMaxW);
		const contentH = vLines.length * lineMetrics.lineHeight + padY;
		const effectiveMinH =
			this.minLines !== undefined
				? Math.max(this.minHeight, this.minLines * lineMetrics.lineHeight + padY)
				: this.minHeight;
		const maxFromLines =
			this.maxLines !== undefined ? Math.min(this.maxHeight, this.maxLines * lineMetrics.lineHeight + padY) : this.maxHeight;
		const limitH = maxHeight !== undefined ? Math.min(maxFromLines, maxHeight) : maxFromLines;
		const h = clampNumber(contentH, effectiveMinH, Math.max(effectiveMinH, limitH));
		return { width: Math.min(maxWidth, naturalW), height: h };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const focused = this.isFocused();
		const radius = this.radius ?? ctx.theme.radiusMedium;

		if (this.variant !== "chromeless") {
			const wellBg = ctx.theme.dark ? ctx.theme.surfaceMuted : ctx.theme.surface;
			if (focused) {
				drawFocusHalo(ctx, r, radius, 0.22, 3);
			}
			ctx.fillRect(r.x, r.y, r.width, r.height, wellBg, radius);
			ctx.strokeRect(
				r.x,
				r.y,
				r.width,
				r.height,
				focused ? ctx.theme.borderFocus : ctx.theme.border,
				1,
				radius,
			);
		}

		const inner: Rect = {
			x: r.x + this.padding.left,
			y: r.y + this.padding.top,
			width: Math.max(0, r.width - this.padding.left - this.padding.right),
			height: Math.max(0, r.height - this.padding.top - this.padding.bottom),
		};
		if (inner.width <= 0 || inner.height <= 0) return;

		const style = this.textStyle(ctx);
		const lineHeight = ctx.measureText(style, 0, "Mg").lineHeight;
		const visualLines = this.buildVisualLines(ctx, style, inner.width);
		const totalTextH = visualLines.length * lineHeight;
		this.maxScrollY = Math.max(0, totalTextH - inner.height);

		const caretPos = this.findCaretVisualPosition(ctx, style, visualLines);
		const caretTop = caretPos.row * lineHeight;
		if (caretTop < this.scrollY) {
			this.scrollY = caretTop;
		} else if (caretTop + lineHeight > this.scrollY + inner.height) {
			this.scrollY = clampNumber(caretTop + lineHeight - inner.height, 0, this.maxScrollY);
		}
		this.scrollY = clampNumber(this.scrollY, 0, this.maxScrollY);

		ctx.pushClip(inner);

		const selRange = this.hasSelection() && this.preeditText.length === 0 ? this.getSelectionRange() : undefined;
		const isEmpty = this.lines.length === 1 && (this.lines[0] ?? "").length === 0 && this.preeditText.length === 0;

		if (isEmpty && this.placeholder.length > 0) {
			ctx.drawStyledText(inner.x, inner.y, inner.width, ctx.theme.textMuted, style, this.placeholder);
		} else {
			for (let i = 0; i < visualLines.length; i++) {
				const vl = visualLines[i];
				if (vl === undefined) continue;
				const y = inner.y + i * lineHeight - this.scrollY;
				if (y + lineHeight < inner.y || y > inner.y + inner.height) {
					continue;
				}

				// Selection highlight for this visual segment
				if (selRange !== undefined) {
					const afterStart =
						vl.logicalLine > selRange.start.line ||
						(vl.logicalLine === selRange.start.line && vl.endCol > selRange.start.col) ||
						(vl.logicalLine === selRange.start.line &&
							vl.startCol === selRange.start.col &&
							selRange.start.line !== selRange.end.line);
					const beforeEnd =
						vl.logicalLine < selRange.end.line ||
						(vl.logicalLine === selRange.end.line && vl.startCol < selRange.end.col);
					if (afterStart && beforeEnd) {
						const localStart =
							vl.logicalLine === selRange.start.line
								? clampNumber(selRange.start.col - vl.startCol, 0, vl.text.length)
								: 0;
						const localEnd =
							vl.logicalLine === selRange.end.line
								? clampNumber(selRange.end.col - vl.startCol, 0, vl.text.length)
								: vl.text.length;
						const sx = inner.x + ctx.getTextCaretX(style, vl.text, localStart);
						let ex = inner.x + ctx.getTextCaretX(style, vl.text, localEnd);
						if (vl.logicalLine < selRange.end.line && localEnd === vl.text.length) {
							ex += 6;
						}
						if (ex > sx) {
							ctx.fillRect(sx, y, ex - sx, lineHeight, ctx.theme.selection);
						}
					}
				}

				if (vl.text.length > 0) {
					ctx.drawStyledText(inner.x, y, 0, ctx.theme.text, style, vl.text);
				}

				// IME preedit underline
				if (vl.hasPreedit) {
					const localPreStart = clampNumber(vl.preeditStart - vl.startCol, 0, vl.text.length);
					const localPreEnd = clampNumber(vl.preeditEnd - vl.startCol, 0, vl.text.length);
					if (localPreEnd > localPreStart) {
						const ux1 = inner.x + ctx.getTextCaretX(style, vl.text, localPreStart);
						const ux2 = inner.x + ctx.getTextCaretX(style, vl.text, localPreEnd);
						ctx.drawLine(ux1, y + lineHeight - 1, ux2, y + lineHeight - 1, ctx.theme.accent, 2);
					}
				}
			}
		}

		if (focused) {
			const screenCaretX = inner.x + caretPos.xOffset;
			const screenCaretY = inner.y + caretPos.row * lineHeight - this.scrollY;
			ctx.fillRect(screenCaretX, screenCaretY, 1.5, lineHeight, ctx.theme.accent);
			ctx.setImeRect(screenCaretX, screenCaretY, 2, lineHeight);
		}

		ctx.popClip();

		// Render floating autocomplete menu when open
		if (focused && this.suggestions.length > 0) {
			this.renderAutocompletePopup(ctx, inner, caretPos.row * lineHeight - this.scrollY, lineHeight);
		}
	}

	private renderAutocompletePopup(ctx: GuiRenderContext, inner: Rect, caretRelY: number, lineHeight: number): void {
		const maxVisible = Math.min(6, this.suggestions.length);
		const rowH = lineHeight + 8;
		const popupH = maxVisible * rowH + 8;
		const popupW = Math.min(360, Math.max(220, inner.width));
		const placeAbove = inner.y + caretRelY + lineHeight + popupH > this.layoutRect.y + this.layoutRect.height + 140;
		const popupY = placeAbove ? inner.y + caretRelY - popupH - 4 : inner.y + caretRelY + lineHeight + 4;
		const popupX = inner.x;

		drawElevationShadow(
			ctx,
			{ x: popupX, y: popupY, width: popupW, height: popupH },
			ctx.theme.radiusMedium,
			"md",
		);
		ctx.fillRect(popupX, popupY, popupW, popupH, ctx.theme.surfaceElevated, ctx.theme.radiusMedium);
		ctx.strokeRect(popupX, popupY, popupW, popupH, ctx.theme.border, 1, ctx.theme.radiusMedium);

		const smallStyle: TextStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: ctx.theme.fontSizeSmall,
			fontWeight: 500,
		};
		for (let i = 0; i < maxVisible; i++) {
			const item = this.suggestions[i];
			if (item === undefined) continue;
			const ry = popupY + 4 + i * rowH;
			const selected = i === this.suggestionSelected;
			if (selected) {
				ctx.fillRect(popupX + 4, ry, popupW - 8, rowH, ctx.theme.selection, ctx.theme.radiusSmall);
			}
			const labelColor = selected ? ctx.theme.accent : ctx.theme.text;
			ctx.drawStyledText(popupX + 10, ry + 4, popupW - 20, labelColor, smallStyle, item.label);
			if (item.description !== undefined) {
				const labelW = ctx.measureText(smallStyle, 0, item.label).width;
				const descX = popupX + 18 + labelW;
				if (descX + 20 < popupX + popupW) {
					ctx.drawStyledText(
						descX,
						ry + 4,
						popupX + popupW - descX - 10,
						ctx.theme.textMuted,
						smallStyle,
						item.description,
					);
				}
			}
		}
	}

	private positionFromPoint(ctx: GuiRenderContext, x: number, y: number): EditorPosition {
		const innerW = Math.max(0, this.layoutRect.width - this.padding.left - this.padding.right);
		const innerX = this.layoutRect.x + this.padding.left;
		const innerY = this.layoutRect.y + this.padding.top;
		const style = this.textStyle(ctx);
		const lineHeight = ctx.measureText(style, 0, "Mg").lineHeight;
		const visualLines = this.buildVisualLines(ctx, style, innerW);
		if (visualLines.length === 0) return { line: 0, col: 0 };

		const relY = y - innerY + this.scrollY;
		const rowIdx = clampNumber(Math.floor(relY / lineHeight), 0, visualLines.length - 1);
		const vl = visualLines[rowIdx];
		if (vl === undefined) return { line: 0, col: 0 };
		const localCol = ctx.hitTestText(style, vl.text, Math.max(0, x - innerX));
		const lineLen = (this.lines[vl.logicalLine] ?? "").length;
		return {
			line: vl.logicalLine,
			col: clampNumber(vl.startCol + localCol, 0, lineLen),
		};
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			if (!pointInRect(event.x, event.y, this.layoutRect)) {
				return { handled: false };
			}
			const pos = this.positionFromPoint(ctx, event.x, event.y);
			const line = this.lines[pos.line] ?? "";
			if (event.clickCount >= 3) {
				this.anchorLine = pos.line;
				this.anchorCol = 0;
				this.cursorLine = pos.line;
				this.cursorCol = line.length;
			} else if (event.clickCount === 2) {
				this.anchorLine = pos.line;
				this.anchorCol = prevWordInLine(line, pos.col);
				this.cursorLine = pos.line;
				this.cursorCol = nextWordInLine(line, pos.col);
			} else {
				this.cursorLine = pos.line;
				this.cursorCol = pos.col;
				if (!event.modifiers.shift) {
					this.anchorLine = pos.line;
					this.anchorCol = pos.col;
				}
			}
			this.preferredX = undefined;
			this.dragging = true;
			this.clearActionFlags();
			this.refreshAutocomplete();
			this.invalidate();
			return { handled: true, capture: this, focus: this, cursor: SGUI_CURSOR_IBEAM };
		}

		if (event.phase === "drag" && this.dragging) {
			const pos = this.positionFromPoint(ctx, event.x, event.y);
			this.cursorLine = pos.line;
			this.cursorCol = pos.col;
			this.preferredX = undefined;
			this.invalidate();
			return { handled: true, cursor: SGUI_CURSOR_IBEAM };
		}

		if (event.phase === "up") {
			this.dragging = false;
			return { handled: true, releaseCapture: true, cursor: SGUI_CURSOR_IBEAM };
		}

		return { handled: true, cursor: SGUI_CURSOR_IBEAM };
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "textArea",
			stateFlags: flags,
			rect: this.layoutRect,
			label: this.placeholder.length > 0 ? this.placeholder : "Text Editor",
			value: this.getText(),
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus" || action === "press") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "setValue") {
			ctx.requestFocus(this);
			this.undoStack.push(this.snapshot());
			this.setText(value);
			return true;
		}
		return false;
	}

	override handleScroll(event: GuiScrollEvent, _ctx: GuiRenderContext): boolean {
		if (this.maxScrollY <= 0 || event.deltaY === 0) {
			return false;
		}
		const next = clampNumber(this.scrollY + event.deltaY, 0, this.maxScrollY);
		if (Math.abs(next - this.scrollY) <= 0.01) {
			return false;
		}
		this.scrollY = next;
		this.invalidate();
		return true;
	}

	override handleText(text: string, _ctx: GuiRenderContext): boolean {
		if (text.length === 0) return false;
		this.preeditText = "";
		this.clearActionFlags();
		this.historyIndex = -1;
		const sel = this.getSelectionRange();
		this.replaceRange(sel.start, sel.end, text, true);
		return true;
	}

	override handleImePreedit(text: string, cursorStart: number, _cursorEnd: number, _ctx: GuiRenderContext): boolean {
		this.preeditText = text;
		this.preeditCursorStart = cursorStart;
		this.invalidate();
		return true;
	}

	private moveHorizontal(delta: number, keepAnchor: boolean): void {
		let line = this.cursorLine;
		let col = this.cursorCol + delta;
		while (col < 0 && line > 0) {
			line -= 1;
			col = (this.lines[line] ?? "").length + col + 1;
		}
		while (col > (this.lines[line] ?? "").length && line + 1 < this.lines.length) {
			col -= (this.lines[line] ?? "").length + 1;
			line += 1;
		}
		this.cursorLine = clampNumber(line, 0, this.lines.length - 1);
		this.cursorCol = clampNumber(col, 0, (this.lines[this.cursorLine] ?? "").length);
		if (!keepAnchor) {
			this.anchorLine = this.cursorLine;
			this.anchorCol = this.cursorCol;
		}
		this.preferredX = undefined;
		this.clearActionFlags();
		this.refreshAutocomplete();
		this.invalidate();
	}

	private moveVertical(ctx: GuiRenderContext, rowDelta: number, keepAnchor: boolean): void {
		const innerW = Math.max(0, this.layoutRect.width - this.padding.left - this.padding.right);
		const style = this.textStyle(ctx);
		const visualLines = this.buildVisualLines(ctx, style, innerW);
		if (visualLines.length === 0) return;

		const current = this.findCaretVisualPosition(ctx, style, visualLines);
		if (this.preferredX === undefined) {
			this.preferredX = current.xOffset;
		}

		// History navigation on boundary vertical move when non-multiline prompt
		if (!keepAnchor && this.history.length > 0 && rowDelta < 0 && current.row === 0 && this.getText().trim() === "") {
			const nextHist = Math.min(this.historyIndex + 1, this.history.length - 1);
			const entry = this.history[nextHist];
			if (entry !== undefined) {
				this.historyIndex = nextHist;
				this.setText(entry);
				return;
			}
		}

		const targetRow = clampNumber(current.row + rowDelta, 0, visualLines.length - 1);
		const vl = visualLines[targetRow];
		if (vl === undefined) return;
		const hitLocal = ctx.hitTestText(style, vl.text, this.preferredX);
		this.cursorLine = vl.logicalLine;
		this.cursorCol = clampNumber(vl.startCol + hitLocal, 0, (this.lines[vl.logicalLine] ?? "").length);
		if (!keepAnchor) {
			this.anchorLine = this.cursorLine;
			this.anchorCol = this.cursorCol;
		}
		this.clearActionFlags();
		this.refreshAutocomplete();
		this.invalidate();
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "up") return false;
		const kb = ctx.keybindings;

		// Autocomplete popup intercepts navigation/confirm/cancel when visible
		if (this.suggestions.length > 0) {
			if (kb.matches(event, "cursorUp")) {
				this.suggestionSelected = (this.suggestionSelected - 1 + this.suggestions.length) % this.suggestions.length;
				this.invalidate();
				return true;
			}
			if (kb.matches(event, "cursorDown")) {
				this.suggestionSelected = (this.suggestionSelected + 1) % this.suggestions.length;
				this.invalidate();
				return true;
			}
			if (kb.matches(event, "tab") || kb.matches(event, "submit")) {
				return this.applySelectedAutocomplete();
			}
			if (kb.matches(event, "cancel")) {
				this.dismissAutocomplete();
				this.invalidate();
				return true;
			}
		}

		if (kb.matches(event, "selectAll")) {
			this.anchorLine = 0;
			this.anchorCol = 0;
			this.cursorLine = this.lines.length - 1;
			this.cursorCol = (this.lines[this.cursorLine] ?? "").length;
			this.preferredX = undefined;
			this.invalidate();
			return true;
		}
		if (kb.matches(event, "copy")) {
			const selected = this.getSelectedText();
			if (selected.length > 0) {
				ctx.setClipboardText(selected);
			}
			return true;
		}
		if (kb.matches(event, "cut")) {
			const selected = this.getSelectedText();
			if (selected.length > 0) {
				ctx.setClipboardText(selected);
				const sel = this.getSelectionRange();
				this.replaceRange(sel.start, sel.end, "", true);
			}
			return true;
		}
		if (kb.matches(event, "paste")) {
			const clip = ctx.getClipboardText();
			if (this.onPaste !== undefined && this.onPaste(clip, ctx) === true) {
				return true;
			}
			if (clip.length > 0) {
				const sel = this.getSelectionRange();
				this.replaceRange(sel.start, sel.end, clip, true);
			}
			return true;
		}
		if (kb.matches(event, "undo")) {
			const prev = this.undoStack.undo(this.snapshot());
			if (prev !== undefined) this.applySnapshot(prev);
			return true;
		}
		if (kb.matches(event, "redo")) {
			const next = this.undoStack.redo(this.snapshot());
			if (next !== undefined) this.applySnapshot(next);
			return true;
		}

		if (kb.matches(event, "newLine")) {
			const sel = this.getSelectionRange();
			this.replaceRange(sel.start, sel.end, "\n", true);
			return true;
		}
		if (kb.matches(event, "submit")) {
			if (!this.submitOnEnter) {
				const sel = this.getSelectionRange();
				this.replaceRange(sel.start, sel.end, "\n", true);
				return true;
			}
			const text = this.getText();
			this.addToHistory(text);
			if (this.clearOnSubmit) {
				this.setText("");
			}
			this.onSubmit?.(text);
			return true;
		}
		if (kb.matches(event, "tab")) {
			const sel = this.getSelectionRange();
			this.replaceRange(sel.start, sel.end, "\t", true);
			return true;
		}

		// Movement & selection
		if (kb.matches(event, "cursorLeft")) {
			if (this.hasSelection()) {
				const sel = this.getSelectionRange();
				this.cursorLine = sel.start.line;
				this.cursorCol = sel.start.col;
				this.anchorLine = sel.start.line;
				this.anchorCol = sel.start.col;
				this.invalidate();
			} else {
				this.moveHorizontal(-1, false);
			}
			return true;
		}
		if (kb.matches(event, "cursorRight")) {
			if (this.hasSelection()) {
				const sel = this.getSelectionRange();
				this.cursorLine = sel.end.line;
				this.cursorCol = sel.end.col;
				this.anchorLine = sel.end.line;
				this.anchorCol = sel.end.col;
				this.invalidate();
			} else {
				this.moveHorizontal(1, false);
			}
			return true;
		}
		if (kb.matches(event, "extendLeft")) {
			this.moveHorizontal(-1, true);
			return true;
		}
		if (kb.matches(event, "extendRight")) {
			this.moveHorizontal(1, true);
			return true;
		}
		if (kb.matches(event, "cursorUp")) {
			this.moveVertical(ctx, -1, false);
			return true;
		}
		if (kb.matches(event, "cursorDown")) {
			this.moveVertical(ctx, 1, false);
			return true;
		}
		if (kb.matches(event, "extendUp")) {
			this.moveVertical(ctx, -1, true);
			return true;
		}
		if (kb.matches(event, "extendDown")) {
			this.moveVertical(ctx, 1, true);
			return true;
		}
		if (kb.matches(event, "pageUp")) {
			this.moveVertical(ctx, -6, false);
			return true;
		}
		if (kb.matches(event, "pageDown")) {
			this.moveVertical(ctx, 6, false);
			return true;
		}
		if (kb.matches(event, "cursorWordLeft") || kb.matches(event, "extendWordLeft")) {
			const keepAnchor = kb.matches(event, "extendWordLeft");
			const line = this.lines[this.cursorLine] ?? "";
			if (this.cursorCol === 0 && this.cursorLine > 0) {
				this.moveHorizontal(-1, keepAnchor);
			} else {
				this.cursorCol = prevWordInLine(line, this.cursorCol);
				if (!keepAnchor) {
					this.anchorLine = this.cursorLine;
					this.anchorCol = this.cursorCol;
				}
				this.invalidate();
			}
			return true;
		}
		if (kb.matches(event, "cursorWordRight") || kb.matches(event, "extendWordRight")) {
			const keepAnchor = kb.matches(event, "extendWordRight");
			const line = this.lines[this.cursorLine] ?? "";
			if (this.cursorCol >= line.length && this.cursorLine + 1 < this.lines.length) {
				this.moveHorizontal(1, keepAnchor);
			} else {
				this.cursorCol = nextWordInLine(line, this.cursorCol);
				if (!keepAnchor) {
					this.anchorLine = this.cursorLine;
					this.anchorCol = this.cursorCol;
				}
				this.invalidate();
			}
			return true;
		}
		if (kb.matches(event, "cursorLineStart") || kb.matches(event, "extendLineStart")) {
			this.cursorCol = 0;
			if (!kb.matches(event, "extendLineStart")) {
				this.anchorLine = this.cursorLine;
				this.anchorCol = 0;
			}
			this.preferredX = undefined;
			this.invalidate();
			return true;
		}
		if (kb.matches(event, "cursorLineEnd") || kb.matches(event, "extendLineEnd")) {
			this.cursorCol = (this.lines[this.cursorLine] ?? "").length;
			if (!kb.matches(event, "extendLineEnd")) {
				this.anchorLine = this.cursorLine;
				this.anchorCol = this.cursorCol;
			}
			this.preferredX = undefined;
			this.invalidate();
			return true;
		}
		if (kb.matches(event, "cursorDocStart") || kb.matches(event, "extendDocStart")) {
			this.cursorLine = 0;
			this.cursorCol = 0;
			if (!kb.matches(event, "extendDocStart")) {
				this.anchorLine = 0;
				this.anchorCol = 0;
			}
			this.preferredX = undefined;
			this.invalidate();
			return true;
		}
		if (kb.matches(event, "cursorDocEnd") || kb.matches(event, "extendDocEnd")) {
			this.cursorLine = this.lines.length - 1;
			this.cursorCol = (this.lines[this.cursorLine] ?? "").length;
			if (!kb.matches(event, "extendDocEnd")) {
				this.anchorLine = this.cursorLine;
				this.anchorCol = this.cursorCol;
			}
			this.preferredX = undefined;
			this.invalidate();
			return true;
		}

		// Deletion & Kill Ring
		if (kb.matches(event, "deleteCharBackward")) {
			this.clearActionFlags();
			if (this.hasSelection()) {
				const sel = this.getSelectionRange();
				this.replaceRange(sel.start, sel.end, "", true);
			} else if (this.cursorCol > 0) {
				this.replaceRange(
					{ line: this.cursorLine, col: this.cursorCol - 1 },
					{ line: this.cursorLine, col: this.cursorCol },
					"",
					true,
				);
			} else if (this.cursorLine > 0) {
				const prevLen = (this.lines[this.cursorLine - 1] ?? "").length;
				this.replaceRange({ line: this.cursorLine - 1, col: prevLen }, { line: this.cursorLine, col: 0 }, "", true);
			}
			return true;
		}
		if (kb.matches(event, "deleteCharForward")) {
			this.clearActionFlags();
			const curLine = this.lines[this.cursorLine] ?? "";
			if (this.hasSelection()) {
				const sel = this.getSelectionRange();
				this.replaceRange(sel.start, sel.end, "", true);
			} else if (this.cursorCol < curLine.length) {
				this.replaceRange(
					{ line: this.cursorLine, col: this.cursorCol },
					{ line: this.cursorLine, col: this.cursorCol + 1 },
					"",
					true,
				);
			} else if (this.cursorLine + 1 < this.lines.length) {
				this.replaceRange(
					{ line: this.cursorLine, col: curLine.length },
					{ line: this.cursorLine + 1, col: 0 },
					"",
					true,
				);
			}
			return true;
		}
		if (kb.matches(event, "deleteWordBackward")) {
			if (this.hasSelection()) {
				const sel = this.getSelectionRange();
				this.replaceRange(sel.start, sel.end, "", true);
			} else if (this.cursorCol > 0) {
				const line = this.lines[this.cursorLine] ?? "";
				const startCol = prevWordInLine(line, this.cursorCol);
				this.killRing.push(line.slice(startCol, this.cursorCol), {
					prepend: true,
					accumulate: this.lastActionWasKill,
				});
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(
					{ line: this.cursorLine, col: startCol },
					{ line: this.cursorLine, col: this.cursorCol },
					"",
					true,
				);
			} else if (this.cursorLine > 0) {
				const prevLen = (this.lines[this.cursorLine - 1] ?? "").length;
				this.killRing.push("\n", { prepend: true, accumulate: this.lastActionWasKill });
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange({ line: this.cursorLine - 1, col: prevLen }, { line: this.cursorLine, col: 0 }, "", true);
			}
			return true;
		}
		if (kb.matches(event, "deleteWordForward")) {
			const line = this.lines[this.cursorLine] ?? "";
			if (this.hasSelection()) {
				const sel = this.getSelectionRange();
				this.replaceRange(sel.start, sel.end, "", true);
			} else if (this.cursorCol < line.length) {
				const endCol = nextWordInLine(line, this.cursorCol);
				this.killRing.push(line.slice(this.cursorCol, endCol), {
					prepend: false,
					accumulate: this.lastActionWasKill,
				});
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(
					{ line: this.cursorLine, col: this.cursorCol },
					{ line: this.cursorLine, col: endCol },
					"",
					true,
				);
			}
			return true;
		}
		if (kb.matches(event, "deleteToLineStart")) {
			const line = this.lines[this.cursorLine] ?? "";
			if (this.cursorCol > 0) {
				this.killRing.push(line.slice(0, this.cursorCol), {
					prepend: true,
					accumulate: this.lastActionWasKill,
				});
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(
					{ line: this.cursorLine, col: 0 },
					{ line: this.cursorLine, col: this.cursorCol },
					"",
					true,
				);
			}
			return true;
		}
		if (kb.matches(event, "deleteToLineEnd")) {
			const line = this.lines[this.cursorLine] ?? "";
			if (this.cursorCol < line.length) {
				this.killRing.push(line.slice(this.cursorCol), {
					prepend: false,
					accumulate: this.lastActionWasKill,
				});
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(
					{ line: this.cursorLine, col: this.cursorCol },
					{ line: this.cursorLine, col: line.length },
					"",
					true,
				);
			} else if (this.cursorLine + 1 < this.lines.length) {
				this.killRing.push("\n", { prepend: false, accumulate: this.lastActionWasKill });
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(
					{ line: this.cursorLine, col: line.length },
					{ line: this.cursorLine + 1, col: 0 },
					"",
					true,
				);
			}
			return true;
		}
		if (kb.matches(event, "yank")) {
			const top = this.killRing.peek();
			if (top !== undefined && top.length > 0) {
				const sel = this.getSelectionRange();
				this.lastYankStart = sel.start;
				this.replaceRange(sel.start, sel.end, top, true);
				this.lastActionWasYank = true;
				this.lastActionWasKill = false;
			}
			return true;
		}
		if (kb.matches(event, "yankPop")) {
			if (this.lastActionWasYank && this.killRing.length > 1) {
				this.killRing.rotate();
				const next = this.killRing.peek();
				if (next !== undefined) {
					const endPos: EditorPosition = { line: this.cursorLine, col: this.cursorCol };
					this.replaceRange(this.lastYankStart, endPos, next, true);
				}
			}
			return true;
		}

		return false;
	}
}
