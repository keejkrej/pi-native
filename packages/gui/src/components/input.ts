/**
 * Single-line desktop text Input with pixel-exact caret/selection, scrolling, IME preedit, clipboard, and undo/redo.
 */

import type { TextStyle } from "../backend.ts";
import {
	clampNumber,
	drawFocusHalo,
	type Edges,
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import type { GuiKeyEvent } from "../keys.ts";
import { type FontFamilyId, type GuiA11yNode, SGUI_A11Y_STATE_ENABLED, SGUI_A11Y_STATE_FOCUSED, SGUI_CURSOR_IBEAM, SGUI_FONT_REGULAR, type A11yActionKind } from "../protocol.ts";
import { KillRing } from "./kill-ring.ts";
import { UndoStack } from "./undo-stack.ts";

export interface InputOptions {
	readonly value?: string;
	readonly placeholder?: string;
	readonly fontFamily?: FontFamilyId;
	readonly fontSize?: number;
	readonly padding?: PaddingInput;
	readonly radius?: number;
	readonly onChange?: (value: string) => void;
	readonly onSubmit?: (value: string) => void;
}

interface InputSnapshot {
	readonly value: string;
	readonly cursor: number;
	readonly anchor: number;
}

function cloneSnapshot(s: InputSnapshot): InputSnapshot {
	return { value: s.value, cursor: s.cursor, anchor: s.anchor };
}

function isWordChar(ch: string): boolean {
	return /[A-Za-z0-9_$]/.test(ch);
}

function prevWordIndex(text: string, from: number): number {
	let i = Math.max(0, Math.min(from, text.length));
	while (i > 0 && /\s/.test(text.charAt(i - 1))) {
		i -= 1;
	}
	if (i > 0 && isWordChar(text.charAt(i - 1))) {
		while (i > 0 && isWordChar(text.charAt(i - 1))) {
			i -= 1;
		}
	} else {
		while (i > 0 && !/\s/.test(text.charAt(i - 1)) && !isWordChar(text.charAt(i - 1))) {
			i -= 1;
		}
	}
	return i;
}

function nextWordIndex(text: string, from: number): number {
	let i = Math.max(0, Math.min(from, text.length));
	while (i < text.length && /\s/.test(text.charAt(i))) {
		i += 1;
	}
	if (i < text.length && isWordChar(text.charAt(i))) {
		while (i < text.length && isWordChar(text.charAt(i))) {
			i += 1;
		}
	} else {
		while (i < text.length && !/\s/.test(text.charAt(i)) && !isWordChar(text.charAt(i))) {
			i += 1;
		}
	}
	return i;
}

export class Input extends GuiComponent {
	private value: string;
	private placeholder: string;
	private fontFamily: FontFamilyId;
	private fontSize: number | undefined;
	private padding: Edges;
	private radius: number | undefined;

	private cursorIndex: number;
	private anchorIndex: number;
	private scrollX: number;
	private dragging: boolean;

	private preeditText: string;
	private preeditCursorStart: number;

	private readonly undoStack: UndoStack<InputSnapshot>;
	private readonly killRing: KillRing;
	private lastActionWasKill: boolean;
	private lastActionWasYank: boolean;
	private lastYankStart: number;
	private lastYankLength: number;

	onChange: ((value: string) => void) | undefined;
	onSubmit: ((value: string) => void) | undefined;

	constructor(options: InputOptions = {}) {
		super();
		this.value = options.value ?? "";
		this.placeholder = options.placeholder ?? "";
		this.fontFamily = options.fontFamily ?? SGUI_FONT_REGULAR;
		this.fontSize = options.fontSize;
		this.padding = normalizeEdges(options.padding ?? { vertical: 8, horizontal: 10 });
		this.radius = options.radius;
		this.onChange = options.onChange;
		this.onSubmit = options.onSubmit;

		this.cursorIndex = this.value.length;
		this.anchorIndex = this.cursorIndex;
		this.scrollX = 0;
		this.dragging = false;

		this.preeditText = "";
		this.preeditCursorStart = 0;

		this.undoStack = new UndoStack<InputSnapshot>(cloneSnapshot);
		this.killRing = new KillRing();
		this.lastActionWasKill = false;
		this.lastActionWasYank = false;
		this.lastYankStart = 0;
		this.lastYankLength = 0;

		this.focusable = true;
		this.cursor = SGUI_CURSOR_IBEAM;
	}

	getValue(): string {
		return this.value;
	}

	setValue(value: string): void {
		const single = value.replace(/\r?\n/g, " ");
		if (this.value === single) return;
		this.value = single;
		this.cursorIndex = single.length;
		this.anchorIndex = single.length;
		this.scrollX = 0;
		this.preeditText = "";
		this.invalidate();
	}

	getCursor(): number {
		return this.cursorIndex;
	}

	getSelection(): { start: number; end: number } {
		return {
			start: Math.min(this.cursorIndex, this.anchorIndex),
			end: Math.max(this.cursorIndex, this.anchorIndex),
		};
	}

	setSelection(start: number, end: number): void {
		this.anchorIndex = clampNumber(start, 0, this.value.length);
		this.cursorIndex = clampNumber(end, 0, this.value.length);
		this.invalidate();
	}

	private hasSelection(): boolean {
		return this.cursorIndex !== this.anchorIndex;
	}

	private clearResetFlags(): void {
		this.lastActionWasKill = false;
		this.lastActionWasYank = false;
	}

	private snapshot(): InputSnapshot {
		return { value: this.value, cursor: this.cursorIndex, anchor: this.anchorIndex };
	}

	private applySnapshot(snap: InputSnapshot): void {
		this.value = snap.value;
		this.cursorIndex = clampNumber(snap.cursor, 0, snap.value.length);
		this.anchorIndex = clampNumber(snap.anchor, 0, snap.value.length);
		this.onChange?.(this.value);
		this.invalidate();
	}

	private replaceRange(start: number, end: number, replacement: string, recordUndo = true): void {
		if (recordUndo) {
			this.undoStack.push(this.snapshot());
		}
		const s = Math.max(0, Math.min(start, this.value.length));
		const e = Math.max(s, Math.min(end, this.value.length));
		this.value = this.value.slice(0, s) + replacement + this.value.slice(e);
		this.cursorIndex = s + replacement.length;
		this.anchorIndex = this.cursorIndex;
		this.onChange?.(this.value);
		this.invalidate();
	}

	private deleteSelectionIfAny(recordUndo = true): boolean {
		if (!this.hasSelection()) return false;
		const sel = this.getSelection();
		this.replaceRange(sel.start, sel.end, "", recordUndo);
		return true;
	}

	private moveCursorTo(nextIndex: number, keepAnchor: boolean): void {
		const clamped = clampNumber(nextIndex, 0, this.value.length);
		this.cursorIndex = clamped;
		if (!keepAnchor) {
			this.anchorIndex = clamped;
		}
		this.clearResetFlags();
		this.invalidate();
	}

	private textStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: this.fontFamily,
			fontSize: this.fontSize ?? ctx.theme.fontSizeBody,
			fontWeight: 400,
		};
	}

	private innerRect(): Rect {
		const r = this.layoutRect;
		return {
			x: r.x + this.padding.left,
			y: r.y + this.padding.top,
			width: Math.max(0, r.width - this.padding.left - this.padding.right),
			height: Math.max(0, r.height - this.padding.top - this.padding.bottom),
		};
	}

	private displayLineAndCaret(): { text: string; caretIndex: number; preeditStart: number; preeditEnd: number } {
		if (this.preeditText.length === 0) {
			return { text: this.value, caretIndex: this.cursorIndex, preeditStart: 0, preeditEnd: 0 };
		}
		const sel = this.getSelection();
		const text = this.value.slice(0, sel.start) + this.preeditText + this.value.slice(sel.end);
		return {
			text,
			caretIndex: sel.start + clampNumber(this.preeditCursorStart, 0, this.preeditText.length),
			preeditStart: sel.start,
			preeditEnd: sel.start + this.preeditText.length,
		};
	}

	private ensureCaretVisible(ctx: GuiRenderContext, innerW: number): number {
		const style = this.textStyle(ctx);
		const display = this.displayLineAndCaret();
		const caretX = ctx.getTextCaretX(style, display.text, display.caretIndex);
		if (innerW <= 0) {
			this.scrollX = 0;
			return caretX;
		}
		if (caretX < this.scrollX) {
			this.scrollX = caretX;
		} else if (caretX > this.scrollX + innerW - 2) {
			this.scrollX = Math.max(0, caretX - (innerW - 2));
		}
		return caretX;
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const style = this.textStyle(ctx);
		const metrics = ctx.measureText(style, 0, "Mg");
		const sample = this.value.length > 0 ? this.value : this.placeholder;
		const sampleW = sample.length > 0 ? ctx.measureText(style, 0, sample).width : 0;
		const naturalW = Math.max(160, sampleW + this.padding.left + this.padding.right + 8);
		return {
			width: Math.min(maxWidth, naturalW),
			height: metrics.lineHeight + this.padding.top + this.padding.bottom,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const focused = this.isFocused();
		const radius = this.radius ?? ctx.theme.radiusMedium;
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

		const inner = this.innerRect();
		if (inner.width <= 0 || inner.height <= 0) return;

		const style = this.textStyle(ctx);
		const metrics = ctx.measureText(style, 0, "Mg");
		const textY = inner.y + Math.max(0, (inner.height - metrics.lineHeight) * 0.5);
		const display = this.displayLineAndCaret();
		const caretX = this.ensureCaretVisible(ctx, inner.width);

		ctx.pushClip(inner);

		// Selection highlight
		if (focused && this.hasSelection() && this.preeditText.length === 0) {
			const sel = this.getSelection();
			const startX = inner.x + ctx.getTextCaretX(style, display.text, sel.start) - this.scrollX;
			const endX = inner.x + ctx.getTextCaretX(style, display.text, sel.end) - this.scrollX;
			ctx.fillRect(startX, textY, Math.max(2, endX - startX), metrics.lineHeight, ctx.theme.selection);
		}

		if (display.text.length === 0) {
			if (this.placeholder.length > 0) {
				ctx.drawStyledText(inner.x, textY, 0, ctx.theme.textMuted, style, this.placeholder);
			}
		} else {
			ctx.drawStyledText(inner.x - this.scrollX, textY, 0, ctx.theme.text, style, display.text);
		}

		// IME preedit underline
		if (this.preeditText.length > 0) {
			const preX = inner.x + ctx.getTextCaretX(style, display.text, display.preeditStart) - this.scrollX;
			const preEndX = inner.x + ctx.getTextCaretX(style, display.text, display.preeditEnd) - this.scrollX;
			const underlineY = textY + metrics.lineHeight - 1;
			ctx.drawLine(preX, underlineY, preEndX, underlineY, ctx.theme.accent, 2);
		}

		// Caret & IME anchor rect
		if (focused) {
			const screenCaretX = inner.x + caretX - this.scrollX;
			ctx.fillRect(screenCaretX, textY, 1.5, metrics.lineHeight, ctx.theme.accent);
			ctx.setImeRect(screenCaretX, textY, 2, metrics.lineHeight);
		}

		ctx.popClip();
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		const inner = this.innerRect();
		const style = this.textStyle(ctx);

		if (event.phase === "down" && event.button === "left") {
			if (!pointInRect(event.x, event.y, this.layoutRect)) {
				return { handled: false };
			}
			const localX = Math.max(0, event.x - inner.x + this.scrollX);
			const hitIdx = ctx.hitTestText(style, this.value, localX);

			if (event.clickCount >= 3) {
				this.anchorIndex = 0;
				this.cursorIndex = this.value.length;
			} else if (event.clickCount === 2) {
				this.anchorIndex = prevWordIndex(this.value, hitIdx);
				this.cursorIndex = nextWordIndex(this.value, hitIdx);
			} else {
				this.cursorIndex = hitIdx;
				if (!event.modifiers.shift) {
					this.anchorIndex = hitIdx;
				}
			}
			this.dragging = true;
			this.clearResetFlags();
			this.invalidate();
			return { handled: true, capture: this, focus: this, cursor: SGUI_CURSOR_IBEAM };
		}

		if (event.phase === "drag" && this.dragging) {
			const localX = event.x - inner.x + this.scrollX;
			this.cursorIndex = ctx.hitTestText(style, this.value, localX);
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
			role: "textField",
			stateFlags: flags,
			rect: this.layoutRect,
			label: this.placeholder.length > 0 ? this.placeholder : "Text Input",
			value: this.value,
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
			const single = value.replace(/\r?\n/g, " ");
			this.value = single;
			this.cursorIndex = single.length;
			this.anchorIndex = single.length;
			this.preeditText = "";
			this.clearResetFlags();
			this.onChange?.(this.value);
			this.invalidate();
			return true;
		}
		return false;
	}

	override handleText(text: string, _ctx: GuiRenderContext): boolean {
		const sanitized = text.replace(/\r?\n/g, " ");
		if (sanitized.length === 0) return false;
		this.preeditText = "";
		this.clearResetFlags();
		const sel = this.getSelection();
		this.replaceRange(sel.start, sel.end, sanitized, true);
		return true;
	}

	override handleImePreedit(text: string, cursorStart: number, _cursorEnd: number, _ctx: GuiRenderContext): boolean {
		this.preeditText = text;
		this.preeditCursorStart = cursorStart;
		this.invalidate();
		return true;
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "up") return false;
		const kb = ctx.keybindings;

		if (kb.matches(event, "selectAll")) {
			this.anchorIndex = 0;
			this.cursorIndex = this.value.length;
			this.clearResetFlags();
			this.invalidate();
			return true;
		}
		if (kb.matches(event, "copy")) {
			if (this.hasSelection()) {
				const sel = this.getSelection();
				ctx.setClipboardText(this.value.slice(sel.start, sel.end));
			}
			return true;
		}
		if (kb.matches(event, "cut")) {
			if (this.hasSelection()) {
				const sel = this.getSelection();
				ctx.setClipboardText(this.value.slice(sel.start, sel.end));
				this.replaceRange(sel.start, sel.end, "", true);
				this.clearResetFlags();
			}
			return true;
		}
		if (kb.matches(event, "paste")) {
			const clip = ctx.getClipboardText().replace(/\r?\n/g, " ");
			if (clip.length > 0) {
				const sel = this.getSelection();
				this.replaceRange(sel.start, sel.end, clip, true);
				this.clearResetFlags();
			}
			return true;
		}
		if (kb.matches(event, "undo")) {
			const prev = this.undoStack.undo(this.snapshot());
			if (prev !== undefined) {
				this.applySnapshot(prev);
			}
			this.clearResetFlags();
			return true;
		}
		if (kb.matches(event, "redo")) {
			const next = this.undoStack.redo(this.snapshot());
			if (next !== undefined) {
				this.applySnapshot(next);
			}
			this.clearResetFlags();
			return true;
		}
		if (kb.matches(event, "submit")) {
			this.onSubmit?.(this.value);
			return true;
		}

		// Caret & selection movement
		if (kb.matches(event, "cursorLeft")) {
			if (this.hasSelection()) {
				const sel = this.getSelection();
				this.moveCursorTo(sel.start, false);
			} else {
				this.moveCursorTo(this.cursorIndex - 1, false);
			}
			return true;
		}
		if (kb.matches(event, "cursorRight")) {
			if (this.hasSelection()) {
				const sel = this.getSelection();
				this.moveCursorTo(sel.end, false);
			} else {
				this.moveCursorTo(this.cursorIndex + 1, false);
			}
			return true;
		}
		if (kb.matches(event, "extendLeft")) {
			this.moveCursorTo(this.cursorIndex - 1, true);
			return true;
		}
		if (kb.matches(event, "extendRight")) {
			this.moveCursorTo(this.cursorIndex + 1, true);
			return true;
		}
		if (kb.matches(event, "cursorWordLeft")) {
			this.moveCursorTo(prevWordIndex(this.value, this.cursorIndex), false);
			return true;
		}
		if (kb.matches(event, "cursorWordRight")) {
			this.moveCursorTo(nextWordIndex(this.value, this.cursorIndex), false);
			return true;
		}
		if (kb.matches(event, "extendWordLeft")) {
			this.moveCursorTo(prevWordIndex(this.value, this.cursorIndex), true);
			return true;
		}
		if (kb.matches(event, "extendWordRight")) {
			this.moveCursorTo(nextWordIndex(this.value, this.cursorIndex), true);
			return true;
		}
		if (kb.matches(event, "cursorLineStart") || kb.matches(event, "cursorDocStart")) {
			this.moveCursorTo(0, false);
			return true;
		}
		if (kb.matches(event, "cursorLineEnd") || kb.matches(event, "cursorDocEnd")) {
			this.moveCursorTo(this.value.length, false);
			return true;
		}
		if (kb.matches(event, "extendLineStart") || kb.matches(event, "extendDocStart")) {
			this.moveCursorTo(0, true);
			return true;
		}
		if (kb.matches(event, "extendLineEnd") || kb.matches(event, "extendDocEnd")) {
			this.moveCursorTo(this.value.length, true);
			return true;
		}

		// Deletion & Kill Ring
		if (kb.matches(event, "deleteCharBackward")) {
			this.clearResetFlags();
			if (!this.deleteSelectionIfAny(true) && this.cursorIndex > 0) {
				this.replaceRange(this.cursorIndex - 1, this.cursorIndex, "", true);
			}
			return true;
		}
		if (kb.matches(event, "deleteCharForward")) {
			this.clearResetFlags();
			if (!this.deleteSelectionIfAny(true) && this.cursorIndex < this.value.length) {
				this.replaceRange(this.cursorIndex, this.cursorIndex + 1, "", true);
			}
			return true;
		}
		if (kb.matches(event, "deleteWordBackward")) {
			if (!this.deleteSelectionIfAny(true) && this.cursorIndex > 0) {
				const start = prevWordIndex(this.value, this.cursorIndex);
				const killed = this.value.slice(start, this.cursorIndex);
				this.killRing.push(killed, { prepend: true, accumulate: this.lastActionWasKill });
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(start, this.cursorIndex, "", true);
			}
			return true;
		}
		if (kb.matches(event, "deleteWordForward")) {
			if (!this.deleteSelectionIfAny(true) && this.cursorIndex < this.value.length) {
				const end = nextWordIndex(this.value, this.cursorIndex);
				const killed = this.value.slice(this.cursorIndex, end);
				this.killRing.push(killed, { prepend: false, accumulate: this.lastActionWasKill });
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(this.cursorIndex, end, "", true);
			}
			return true;
		}
		if (kb.matches(event, "deleteToLineStart")) {
			if (this.cursorIndex > 0) {
				const killed = this.value.slice(0, this.cursorIndex);
				this.killRing.push(killed, { prepend: true, accumulate: this.lastActionWasKill });
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(0, this.cursorIndex, "", true);
			}
			return true;
		}
		if (kb.matches(event, "deleteToLineEnd")) {
			if (this.cursorIndex < this.value.length) {
				const killed = this.value.slice(this.cursorIndex);
				this.killRing.push(killed, { prepend: false, accumulate: this.lastActionWasKill });
				this.lastActionWasKill = true;
				this.lastActionWasYank = false;
				this.replaceRange(this.cursorIndex, this.value.length, "", true);
			}
			return true;
		}
		if (kb.matches(event, "yank")) {
			const top = this.killRing.peek();
			if (top !== undefined && top.length > 0) {
				const sel = this.getSelection();
				this.lastYankStart = sel.start;
				this.lastYankLength = top.length;
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
					this.replaceRange(this.lastYankStart, this.lastYankStart + this.lastYankLength, next, true);
					this.lastYankLength = next.length;
				}
			}
			return true;
		}

		return false;
	}
}
