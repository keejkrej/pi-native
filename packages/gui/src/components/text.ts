/**
 * Single/multi-line wrapping Text and single-line ellipsis TruncatedText components.
 */

import type { TextStyle } from "../backend.ts";
import type { Color } from "../colors.ts";
import {
	type Edges,
	GuiComponent,
	type GuiRenderContext,
	normalizeEdges,
	type PaddingInput,
	type Size,
} from "../component.ts";
import { type FontFamilyId, type GuiA11yNode, SGUI_A11Y_STATE_ENABLED, SGUI_FONT_REGULAR } from "../protocol.ts";

export type TextAlignment = "left" | "center" | "right";

export interface TextOptions {
	readonly text?: string;
	readonly color?: Color;
	readonly background?: Color;
	readonly fontSize?: number;
	readonly fontFamily?: FontFamilyId;
	readonly fontWeight?: number;
	readonly italic?: boolean;
	readonly underline?: boolean;
	readonly strikethrough?: boolean;
	readonly padding?: PaddingInput;
	readonly align?: TextAlignment;
	readonly wrap?: boolean;
}

export class Text extends GuiComponent {
	private textValue: string;
	private color: Color | undefined;
	private background: Color | undefined;
	private fontSize: number | undefined;
	private fontFamily: FontFamilyId;
	private fontWeight: number;
	private italic: boolean;
	private underline: boolean;
	private strikethrough: boolean;
	private padding: Edges;
	private align: TextAlignment;
	private wrap: boolean;

	constructor(textOrOptions: string | TextOptions = "") {
		super();
		const opts: TextOptions = typeof textOrOptions === "string" ? { text: textOrOptions } : textOrOptions;
		this.textValue = opts.text ?? "";
		this.color = opts.color;
		this.background = opts.background;
		this.fontSize = opts.fontSize;
		this.fontFamily = opts.fontFamily ?? SGUI_FONT_REGULAR;
		this.fontWeight = opts.fontWeight ?? 400;
		this.italic = opts.italic ?? false;
		this.underline = opts.underline ?? false;
		this.strikethrough = opts.strikethrough ?? false;
		this.padding = normalizeEdges(opts.padding);
		this.align = opts.align ?? "left";
		this.wrap = opts.wrap ?? true;
	}

	getText(): string {
		return this.textValue;
	}

	setText(text: string): void {
		if (this.textValue === text) return;
		this.textValue = text;
		this.invalidate();
	}

	setColor(color: Color | undefined): void {
		this.color = color;
		this.invalidate();
	}

	setBackground(color: Color | undefined): void {
		this.background = color;
		this.invalidate();
	}

	setPadding(padding: PaddingInput): void {
		this.padding = normalizeEdges(padding);
		this.invalidate();
	}

	private buildStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: this.fontFamily,
			fontSize: this.fontSize ?? ctx.theme.fontSizeBody,
			fontWeight: this.fontWeight,
			italic: this.italic,
			underline: this.underline,
			strikethrough: this.strikethrough,
		};
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right);
		const metrics = ctx.measureText(this.buildStyle(ctx), this.wrap ? innerMaxW : 0, this.textValue);
		const width = Math.min(maxWidth, Math.ceil(metrics.width) + this.padding.left + this.padding.right);
		const height = Math.ceil(metrics.height) + this.padding.top + this.padding.bottom;
		return { width, height };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (this.background !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, this.background);
		}
		const innerW = Math.max(0, r.width - this.padding.left - this.padding.right);
		const innerH = Math.max(0, r.height - this.padding.top - this.padding.bottom);
		if (innerW <= 0 || innerH <= 0 || this.textValue.length === 0) {
			return;
		}
		const style = this.buildStyle(ctx);
		const naturalMetrics = ctx.measureText(style, 0, this.textValue);
		const shouldWrap = this.wrap && naturalMetrics.width > innerW + 0.5;
		const metrics = shouldWrap ? ctx.measureText(style, innerW, this.textValue) : naturalMetrics;
		let drawX = r.x + this.padding.left;
		if (this.align === "center" && metrics.width < innerW) {
			drawX += (innerW - metrics.width) * 0.5;
		} else if (this.align === "right" && metrics.width < innerW) {
			drawX += innerW - metrics.width;
		}
		const needsClip = !this.wrap && metrics.width > innerW;
		if (needsClip) {
			ctx.pushClip({ x: r.x + this.padding.left, y: r.y + this.padding.top, width: innerW, height: innerH });
		}
		ctx.drawStyledText(
			drawX,
			r.y + this.padding.top,
			shouldWrap ? innerW : 0,
			this.color ?? ctx.theme.text,
			style,
			this.textValue,
		);
		if (needsClip) {
			ctx.popClip();
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		if (this.textValue.trim().length === 0) return;
		out.push({
			id: this.a11yId,
			role: "staticText",
			stateFlags: SGUI_A11Y_STATE_ENABLED,
			rect: this.layoutRect,
			label: this.textValue,
			value: this.textValue,
		});
	}
}

export interface TruncatedTextOptions {
	readonly text?: string;
	readonly ellipsis?: string;
	readonly color?: Color;
	readonly fontSize?: number;
	readonly fontFamily?: FontFamilyId;
	readonly fontWeight?: number;
	readonly padding?: PaddingInput;
}

export class TruncatedText extends GuiComponent {
	private textValue: string;
	private ellipsis: string;
	private color: Color | undefined;
	private fontSize: number | undefined;
	private fontFamily: FontFamilyId;
	private fontWeight: number;
	private padding: Edges;

	constructor(textOrOptions: string | TruncatedTextOptions = "") {
		super();
		const opts: TruncatedTextOptions = typeof textOrOptions === "string" ? { text: textOrOptions } : textOrOptions;
		this.textValue = opts.text ?? "";
		this.ellipsis = opts.ellipsis ?? "...";
		this.color = opts.color;
		this.fontSize = opts.fontSize;
		this.fontFamily = opts.fontFamily ?? SGUI_FONT_REGULAR;
		this.fontWeight = opts.fontWeight ?? 400;
		this.padding = normalizeEdges(opts.padding);
	}

	getText(): string {
		return this.textValue;
	}

	setText(text: string): void {
		if (this.textValue === text) return;
		this.textValue = text;
		this.invalidate();
	}

	setColor(color: Color | undefined): void {
		this.color = color;
		this.invalidate();
	}

	private buildStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: this.fontFamily,
			fontSize: this.fontSize ?? ctx.theme.fontSizeBody,
			fontWeight: this.fontWeight,
		};
	}

	private fitText(ctx: GuiRenderContext, style: TextStyle, maxWidth: number): string {
		const singleLine = this.textValue.replace(/\r?\n/g, " ");
		if (maxWidth <= 0 || singleLine.length === 0) {
			return "";
		}
		if (ctx.measureText(style, 0, singleLine).width <= maxWidth + 0.5) {
			return singleLine;
		}
		const ellipsisW = ctx.measureText(style, 0, this.ellipsis).width;
		if (ellipsisW >= maxWidth) {
			return this.ellipsis;
		}
		const budget = maxWidth - ellipsisW;
		let lo = 0;
		let hi = singleLine.length;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			const w = ctx.measureText(style, 0, singleLine.slice(0, mid)).width;
			if (w <= budget) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return `${singleLine.slice(0, lo)}${this.ellipsis}`;
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right);
		const style = this.buildStyle(ctx);
		const fitted = this.fitText(ctx, style, innerMaxW);
		const metrics = ctx.measureText(style, 0, fitted.length > 0 ? fitted : " ");
		return {
			width: Math.min(maxWidth, Math.ceil(metrics.width) + this.padding.left + this.padding.right),
			height: Math.ceil(metrics.lineHeight) + this.padding.top + this.padding.bottom,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const innerW = Math.max(0, r.width - this.padding.left - this.padding.right);
		const innerH = Math.max(0, r.height - this.padding.top - this.padding.bottom);
		if (innerW <= 0 || innerH <= 0) return;
		const style = this.buildStyle(ctx);
		const fitted = this.fitText(ctx, style, innerW);
		if (fitted.length === 0) return;
		ctx.drawStyledText(
			r.x + this.padding.left,
			r.y + this.padding.top,
			0,
			this.color ?? ctx.theme.text,
			style,
			fitted,
		);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		if (this.textValue.trim().length === 0) return;
		out.push({
			id: this.a11yId,
			role: "staticText",
			stateFlags: SGUI_A11Y_STATE_ENABLED,
			rect: this.layoutRect,
			label: this.textValue,
			value: this.textValue,
		});
	}
}
