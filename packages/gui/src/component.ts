/**
 * Core GUI geometry, render context, host adapter, focus/pointer contracts, and base GuiComponent class.
 */

import type { GuiBackend, TextMetrics, TextStyle } from "./backend.ts";
import { type Color, packRgba, withAlpha } from "./colors.ts";
import type { KeybindingsManager } from "./keybindings.ts";
import type { GuiKeyEvent, GuiModifiers } from "./keys.ts";
import {
	type A11yActionKind,
	type CursorKindId,
	type DrawCommandWriter,
	type FontFamilyId,
	type GuiA11yNode,
	SGUI_CURSOR_ARROW,
	SGUI_FONT_FLAG_ITALIC,
	SGUI_FONT_FLAG_STRIKETHROUGH,
	SGUI_FONT_FLAG_UNDERLINE,
	SGUI_FONT_REGULAR,
} from "./protocol.ts";
import type { GuiTheme } from "./theme.ts";

export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface Size {
	readonly width: number;
	readonly height: number;
}

export interface Edges {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
}

export interface PaddingSpec {
	readonly vertical?: number;
	readonly horizontal?: number;
	readonly top?: number;
	readonly right?: number;
	readonly bottom?: number;
	readonly left?: number;
}

export type PaddingInput = number | PaddingSpec;

export function normalizeEdges(input: PaddingInput | undefined): Edges {
	if (input === undefined) {
		return { top: 0, right: 0, bottom: 0, left: 0 };
	}
	if (typeof input === "number") {
		return { top: input, right: input, bottom: input, left: input };
	}
	const vert = input.vertical ?? 0;
	const horiz = input.horizontal ?? 0;
	return {
		top: input.top ?? vert,
		right: input.right ?? horiz,
		bottom: input.bottom ?? vert,
		left: input.left ?? horiz,
	};
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function intersectRect(a: Rect, b: Rect): Rect {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.width, b.x + b.width);
	const y2 = Math.min(a.y + a.height, b.y + b.height);
	return {
		x: x1,
		y: y1,
		width: Math.max(0, x2 - x1),
		height: Math.max(0, y2 - y1),
	};
}

export function clampNumber(value: number, min: number, max: number): number {
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

export interface GuiPointerEvent {
	readonly phase: "move" | "down" | "up" | "drag" | "leave" | "enter";
	readonly button: "none" | "left" | "middle" | "right";
	readonly clickCount: number;
	readonly x: number;
	readonly y: number;
	readonly modifiers: GuiModifiers;
}

export interface GuiScrollEvent {
	readonly x: number;
	readonly y: number;
	readonly deltaX: number;
	readonly deltaY: number;
	readonly modifiers: GuiModifiers;
}

export interface GuiPointerResult {
	readonly handled: boolean;
	readonly capture?: GuiComponent;
	readonly releaseCapture?: boolean;
	readonly cursor?: CursorKindId;
	readonly focus?: GuiComponent;
}

export abstract class GuiHost {
	abstract invalidate(component?: GuiComponent): void;
	abstract requestFocus(component: GuiComponent | undefined): void;
	abstract isFocused(component: GuiComponent): boolean;
	isFocusVisible(_component: GuiComponent): boolean {
		return false;
	}
	abstract isHovered(component: GuiComponent): boolean;
	abstract getClipboardText(): string;
	abstract setClipboardText(text: string): void;
	abstract setImeRect(x: number, y: number, width: number, height: number): void;
	abstract windowAction(action: number): void;
}

export class GuiRenderContext {
	readonly backend: GuiBackend;
	readonly theme: GuiTheme;
	readonly keybindings: KeybindingsManager;
	readonly writer: DrawCommandWriter;
	readonly scale: number;
	readonly windowFocused: boolean;
	readonly nowMs: number;
	private readonly host: GuiHost;

	constructor(params: {
		backend: GuiBackend;
		theme: GuiTheme;
		keybindings: KeybindingsManager;
		writer: DrawCommandWriter;
		scale: number;
		windowFocused: boolean;
		nowMs: number;
		host: GuiHost;
	}) {
		this.backend = params.backend;
		this.theme = params.theme;
		this.keybindings = params.keybindings;
		this.writer = params.writer;
		this.scale = params.scale;
		this.windowFocused = params.windowFocused;
		this.nowMs = params.nowMs;
		this.host = params.host;
	}

	invalidate(component?: GuiComponent): void {
		this.host.invalidate(component);
	}

	requestFocus(component: GuiComponent | undefined): void {
		this.host.requestFocus(component);
	}

	isFocused(component: GuiComponent): boolean {
		return this.host.isFocused(component);
	}

	isFocusVisible(component: GuiComponent): boolean {
		return this.host.isFocusVisible(component);
	}

	isHovered(component: GuiComponent): boolean {
		return this.host.isHovered(component);
	}

	getClipboardText(): string {
		return this.host.getClipboardText();
	}

	setClipboardText(text: string): void {
		this.host.setClipboardText(text);
	}

	setImeRect(x: number, y: number, width: number, height: number): void {
		this.host.setImeRect(x, y, width, height);
	}

	windowAction(action: number): void {
		this.host.windowAction(action);
	}

	measureText(style: TextStyle, maxWidth: number, text: string): TextMetrics {
		return this.backend.measureText(style, maxWidth, text);
	}

	getTextCaretX(style: TextStyle, line: string, charIndex: number): number {
		return this.backend.getTextCaretX(style, line, charIndex);
	}

	hitTestText(style: TextStyle, line: string, x: number): number {
		return this.backend.hitTestText(style, line, x);
	}

	fillRect(x: number, y: number, w: number, h: number, color: Color, radius = 0): void {
		if (w <= 0 || h <= 0) return;
		this.writer.fillRect(x, y, w, h, radius, packRgba(color));
	}

	strokeRect(x: number, y: number, w: number, h: number, color: Color, strokeWidth = 1, radius = 0): void {
		if (w <= 0 || h <= 0 || strokeWidth <= 0) return;
		this.writer.strokeRect(x, y, w, h, radius, strokeWidth, packRgba(color));
	}

	fillRectCorners(
		x: number,
		y: number,
		w: number,
		h: number,
		tl: number,
		tr: number,
		br: number,
		bl: number,
		color: Color,
	): void {
		if (w <= 0 || h <= 0) return;
		this.writer.fillRectCorners(x, y, w, h, tl, tr, br, bl, packRgba(color));
	}

	strokeRectCorners(
		x: number,
		y: number,
		w: number,
		h: number,
		tl: number,
		tr: number,
		br: number,
		bl: number,
		color: Color,
		strokeWidth = 1,
	): void {
		if (w <= 0 || h <= 0 || strokeWidth <= 0) return;
		this.writer.strokeRectCorners(x, y, w, h, tl, tr, br, bl, strokeWidth, packRgba(color));
	}

	drawLine(x1: number, y1: number, x2: number, y2: number, color: Color, strokeWidth = 1): void {
		if (strokeWidth <= 0) return;
		this.writer.drawLine(x1, y1, x2, y2, strokeWidth, packRgba(color));
	}

	pushClip(rect: Rect): void {
		this.writer.pushClip(rect.x, rect.y, rect.width, rect.height);
	}

	popClip(): void {
		this.writer.popClip();
	}

	drawText(
		x: number,
		y: number,
		maxWidth: number,
		fontSize: number,
		color: Color,
		fontFamily: FontFamilyId,
		fontWeight: number,
		fontFlags: number,
		text: string,
	): void {
		this.writer.drawText(x, y, maxWidth, fontSize, packRgba(color), fontFamily, fontWeight, fontFlags, text);
	}

	drawStyledText(
		x: number,
		y: number,
		maxWidth: number,
		color: Color,
		style: TextStyle,
		text: string,
		defaultFontSize = this.theme.fontSizeBody,
	): void {
		let flags = 0;
		if (style.italic) flags |= SGUI_FONT_FLAG_ITALIC;
		if (style.underline) flags |= SGUI_FONT_FLAG_UNDERLINE;
		if (style.strikethrough) flags |= SGUI_FONT_FLAG_STRIKETHROUGH;
		this.writer.drawText(
			x,
			y,
			maxWidth,
			style.fontSize ?? defaultFontSize,
			packRgba(color),
			style.fontFamily ?? SGUI_FONT_REGULAR,
			style.fontWeight ?? 400,
			flags,
			text,
		);
	}

	drawImageRgba(
		x: number,
		y: number,
		w: number,
		h: number,
		radius: number,
		pxW: number,
		pxH: number,
		pixels: Uint8Array,
	): void {
		this.writer.drawImageRgba(x, y, w, h, radius, pxW, pxH, pixels);
	}
}

export type ShadowLevel = "sm" | "md" | "lg";
export type BoxShadow = ShadowLevel | boolean;

/** Draw multi-layer ambient + downward key drop shadow around a rounded rectangle. */
export function drawElevationShadow(
	ctx: GuiRenderContext,
	rect: Rect,
	radius: number,
	level: ShadowLevel = "md",
): void {
	if (rect.width <= 0 || rect.height <= 0) return;
	const shadowColor = ctx.theme.shadow;
	const dark = ctx.theme.dark;
	let offsetsY: number[];
	let spreads: number[];
	let alphas: number[];
	switch (level) {
		case "sm":
			offsetsY = [1, 2, 4];
			spreads = [0, 1, 2];
			alphas = dark ? [0.2, 0.13, 0.06] : [0.07, 0.04, 0.02];
			break;
		case "lg":
			offsetsY = [1, 4, 10, 18];
			spreads = [0, 2, 5, 9];
			alphas = dark ? [0.28, 0.2, 0.12, 0.06] : [0.1, 0.07, 0.04, 0.02];
			break;
		case "md":
		default:
			offsetsY = [1, 3, 6, 10];
			spreads = [0, 1, 3, 5];
			alphas = dark ? [0.22, 0.15, 0.09, 0.05] : [0.08, 0.05, 0.03, 0.015];
			break;
	}
	for (let i = offsetsY.length - 1; i >= 0; i--) {
		const spread = spreads[i] ?? 0;
		const dy = offsetsY[i] ?? 0;
		const alpha = alphas[i] ?? 0;
		if (alpha <= 0) continue;
		const r = radius > 0 ? radius + spread : 0;
		ctx.fillRect(
			rect.x - spread,
			rect.y + dy - spread * 0.3,
			rect.width + spread * 2,
			rect.height + spread * 2,
			withAlpha(shadowColor, alpha),
			r,
		);
	}
}

/** Draw a soft translucent outer focus halo around a rounded control. */
export function drawFocusHalo(
	ctx: GuiRenderContext,
	rect: Rect,
	radius: number,
	alpha = 0.24,
	spread = 3,
	color?: Color,
): void {
	if (rect.width <= 0 || rect.height <= 0 || alpha <= 0 || spread <= 0) return;
	const haloColor = color ?? ctx.theme.borderFocus;
	const expand = spread * 0.5;
	ctx.strokeRect(
		rect.x - expand,
		rect.y - expand,
		rect.width + spread,
		rect.height + spread,
		withAlpha(haloColor, alpha),
		spread,
		radius > 0 ? radius + expand : 0,
	);
}

let nextA11yNodeId = 1;

export function allocateA11yId(): number {
	const id = nextA11yNodeId;
	nextA11yNodeId += 1;
	return id;
}

export abstract class GuiComponent {
	readonly a11yId: number;
	layoutRect: Rect;
	visible: boolean;
	focusable: boolean;
	cursor: CursorKindId;
	parent: GuiComponent | undefined;
	protected host: GuiHost | undefined;

	constructor() {
		this.a11yId = allocateA11yId();
		this.layoutRect = { x: 0, y: 0, width: 0, height: 0 };
		this.visible = true;
		this.focusable = false;
		this.cursor = SGUI_CURSOR_ARROW;
		this.parent = undefined;
		this.host = undefined;
	}

	attachHost(host: GuiHost | undefined): void {
		this.host = host;
	}

	setParent(parent: GuiComponent | undefined): void {
		this.parent = parent;
	}

	invalidate(): void {
		this.host?.invalidate(this);
	}

	requestFocus(): void {
		this.host?.requestFocus(this);
	}

	isFocused(): boolean {
		return this.host?.isFocused(this) ?? false;
	}

	isFocusVisible(): boolean {
		return this.host?.isFocusVisible(this) ?? false;
	}

	isHovered(): boolean {
		return this.host?.isHovered(this) ?? false;
	}

	abstract measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size;

	layout(_ctx: GuiRenderContext, rect: Rect): void {
		this.layoutRect = rect;
	}

	abstract render(ctx: GuiRenderContext): void;

	hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible) {
			return undefined;
		}
		return pointInRect(x, y, this.layoutRect) ? this : undefined;
	}

	handlePointer(_event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		return { handled: false };
	}

	handleScroll(_event: GuiScrollEvent, _ctx: GuiRenderContext): boolean {
		return false;
	}

	handleKey(_event: GuiKeyEvent, _ctx: GuiRenderContext): boolean {
		return false;
	}

	handleText(_text: string, _ctx: GuiRenderContext): boolean {
		return false;
	}

	handleImePreedit(_text: string, _cursorStart: number, _cursorEnd: number, _ctx: GuiRenderContext): boolean {
		return false;
	}

	onFocusChange(_focused: boolean): void {}

	onHoverChange(_hovered: boolean): void {}

	onThemeChange(_theme: GuiTheme): void {}

	collectFocusables(out: GuiComponent[]): void {
		if (this.visible && this.focusable) {
			out.push(this);
		}
	}

	collectAccessibilityNodes(_out: GuiA11yNode[], _ctx: GuiRenderContext): void {}

	findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return this.a11yId === nodeId ? this : undefined;
	}

	handleAccessibilityAction(
		_nodeId: number,
		_action: A11yActionKind,
		_value: string,
		_ctx: GuiRenderContext,
	): boolean {
		return false;
	}
}
