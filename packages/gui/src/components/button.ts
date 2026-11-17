/**
 * Push button with primary, secondary, ghost, and danger variants, pointer capture, and keybinding activation.
 */

import type { TextStyle } from "../backend.ts";
import { type Color, mixColors, rgbColor, withAlpha } from "../colors.ts";
import {
	drawFocusHalo,
	type Edges,
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Size,
} from "../component.ts";
import type { GuiKeyEvent } from "../keys.ts";
import { type A11yActionKind, type GuiA11yNode, SGUI_A11Y_STATE_ENABLED, SGUI_A11Y_STATE_FOCUSED, SGUI_CURSOR_ARROW, SGUI_CURSOR_POINTER, SGUI_FONT_REGULAR } from "../protocol.ts";
import { drawVectorIcon, type VectorIconName } from "./vector.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonOptions {
	readonly label: string;
	readonly variant?: ButtonVariant;
	readonly disabled?: boolean;
	readonly fontSize?: number;
	readonly fontWeight?: number;
	readonly padding?: PaddingInput;
	readonly radius?: number;
	readonly minWidth?: number;
	readonly leadingIcon?: VectorIconName;
	readonly iconSize?: number;
	readonly pill?: boolean;
	readonly onClick?: () => void;
}

export class Button extends GuiComponent {
	private labelValue: string;
	private variant: ButtonVariant;
	private disabled: boolean;
	private fontSize: number | undefined;
	private fontWeight: number;
	private padding: Edges;
	private radius: number | undefined;
	private minWidth: number;
	private leadingIcon: VectorIconName | undefined;
	private iconSize: number | undefined;
	private pill: boolean;
	private pressed: boolean;
	onClick: (() => void) | undefined;

	constructor(options: ButtonOptions) {
		super();
		this.labelValue = options.label;
		this.variant = options.variant ?? "secondary";
		this.disabled = options.disabled ?? false;
		this.fontSize = options.fontSize;
		this.fontWeight = options.fontWeight ?? 500;
		this.padding = normalizeEdges(options.padding ?? { vertical: 6, horizontal: 12 });
		this.radius = options.radius;
		this.minWidth = options.minWidth ?? 0;
		this.leadingIcon = options.leadingIcon;
		this.iconSize = options.iconSize;
		this.pill = options.pill ?? false;
		this.onClick = options.onClick;
		this.pressed = false;
		this.focusable = !this.disabled;
		this.cursor = this.disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
	}

	getLabel(): string {
		return this.labelValue;
	}

	setLabel(label: string): void {
		if (this.labelValue === label) return;
		this.labelValue = label;
		this.invalidate();
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.focusable = !disabled;
		this.cursor = disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
		if (disabled) this.pressed = false;
		this.invalidate();
	}

	isDisabled(): boolean {
		return this.disabled;
	}

	setVariant(variant: ButtonVariant): void {
		this.variant = variant;
		this.invalidate();
	}

	setLeadingIcon(icon: VectorIconName | undefined): void {
		if (this.leadingIcon === icon) return;
		this.leadingIcon = icon;
		this.invalidate();
	}

	private textStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: this.fontSize ?? ctx.theme.fontSizeBody,
			fontWeight: this.fontWeight,
		};
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const metrics = ctx.measureText(this.textStyle(ctx), 0, this.labelValue);
		const iconSz = this.leadingIcon !== undefined ? (this.iconSize ?? Math.max(12, this.fontSize ?? ctx.theme.fontSizeBody)) : 0;
		const iconGap = this.leadingIcon !== undefined && this.labelValue.length > 0 ? 6 : 0;
		const contentW = iconSz + iconGap + metrics.width;
		const contentH = Math.max(metrics.lineHeight, iconSz);
		const naturalW = Math.max(this.minWidth, contentW + this.padding.left + this.padding.right);
		return {
			width: Math.min(maxWidth, naturalW),
			height: contentH + this.padding.top + this.padding.bottom,
		};
	}

	private resolveColors(ctx: GuiRenderContext): {
		fill: Color | undefined;
		border: Color | undefined;
		text: Color;
	} {
		const t = ctx.theme;
		if (this.disabled) {
			return {
				fill: this.variant === "ghost" ? undefined : t.surfaceMuted,
				border: this.variant === "ghost" ? undefined : t.border,
				text: t.textDisabled,
			};
		}

		const hovered = this.isHovered();
		const focused = this.isFocused();

		let fill: Color | undefined;
		let border: Color | undefined;
		let text: Color = t.text;

		switch (this.variant) {
			case "primary":
				fill = this.pressed ? mixColors(t.accent, t.background, 0.2) : hovered ? t.accentHover : t.accent;
				border = focused ? t.textOnAccent : fill;
				text = t.textOnAccent;
				break;
			case "danger":
				fill = this.pressed ? mixColors(t.danger, t.background, 0.2) : hovered ? t.dangerHover : t.danger;
				border = focused ? t.textOnAccent : fill;
				text = t.textOnAccent;
				break;
			case "ghost":
				fill = this.pressed
					? mixColors(t.surfaceElevated, t.accent, 0.16)
					: hovered
						? t.surfaceElevated
						: undefined;
				border = focused ? t.borderFocus : undefined;
				text = t.text;
				break;
			case "secondary":
				fill = this.pressed ? t.surfaceMuted : hovered ? t.surfaceElevated : t.surface;
				border = focused ? t.borderFocus : t.border;
				text = t.text;
				break;
		}
		return { fill, border, text };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const radius = this.pill ? r.height * 0.5 : (this.radius ?? ctx.theme.radiusMedium);
		const colors = this.resolveColors(ctx);
		const focused = this.isFocused();

		if (!this.disabled && !this.pressed && this.variant !== "ghost") {
			ctx.fillRect(
				r.x,
				r.y + 1,
				r.width,
				r.height,
				withAlpha(ctx.theme.shadow, ctx.theme.dark ? 0.24 : 0.08),
				radius,
			);
		}
		if (focused) {
			drawFocusHalo(ctx, r, radius, 0.24, 3);
		}
		if (colors.fill !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, colors.fill, radius);
			if (!this.disabled && !this.pressed && this.variant !== "ghost" && r.width > 8 && r.height > 4) {
				const hlInset = Math.min(radius, 6);
				const hlAlpha =
					this.variant === "secondary" ? (ctx.theme.dark ? 0.06 : 0.45) : 0.16;
				ctx.fillRect(
					r.x + hlInset,
					r.y + 1,
					Math.max(0, r.width - hlInset * 2),
					1,
					withAlpha(rgbColor(255, 255, 255), hlAlpha),
				);
			}
		}
		if (colors.border !== undefined) {
			ctx.strokeRect(r.x, r.y, r.width, r.height, colors.border, 1, radius);
		}

		const style = this.textStyle(ctx);
		const metrics = ctx.measureText(style, 0, this.labelValue);
		const iconSz = this.leadingIcon !== undefined ? (this.iconSize ?? Math.max(12, this.fontSize ?? ctx.theme.fontSizeBody)) : 0;
		const iconGap = this.leadingIcon !== undefined && this.labelValue.length > 0 ? 6 : 0;
		const contentW = iconSz + iconGap + metrics.width;
		const innerW = Math.max(0, r.width - this.padding.left - this.padding.right);
		let cursorX = r.x + this.padding.left + Math.max(0, (innerW - contentW) * 0.5);

		ctx.pushClip(r);
		if (this.leadingIcon !== undefined) {
			const iconY = r.y + Math.max(0, (r.height - iconSz) * 0.5);
			drawVectorIcon(ctx, this.leadingIcon, cursorX, iconY, iconSz, colors.text);
			cursorX += iconSz + iconGap;
		}
		if (this.labelValue.length > 0) {
			const textY = r.y + Math.max(0, (r.height - metrics.lineHeight) * 0.5);
			ctx.drawStyledText(cursorX, textY, 0, colors.text, style, this.labelValue);
		}
		ctx.popClip();
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (this.disabled) {
			return { handled: false };
		}
		if (event.phase === "down" && event.button === "left") {
			this.pressed = true;
			this.invalidate();
			return { handled: true, capture: this, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "drag") {
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left") {
			const wasPressed = this.pressed;
			this.pressed = false;
			this.invalidate();
			if (wasPressed && pointInRect(event.x, event.y, this.layoutRect)) {
				this.onClick?.();
			}
			return { handled: true, releaseCapture: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "leave" && this.pressed) {
			this.pressed = false;
			this.invalidate();
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.disabled) {
			return false;
		}
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onClick?.();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = this.disabled ? 0 : SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			stateFlags: flags,
			rect: this.layoutRect,
			label: this.labelValue,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId || this.disabled) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press") {
			ctx.requestFocus(this);
			this.onClick?.();
			this.invalidate();
			return true;
		}
		return false;
	}
}

export interface IconButtonOptions {
	readonly icon: VectorIconName;
	readonly size?: number;
	readonly iconSize?: number;
	readonly radius?: number;
	readonly color?: Color;
	readonly hoverColor?: Color;
	readonly activeColor?: Color;
	readonly background?: Color;
	readonly hoverBackground?: Color;
	readonly activeBackground?: Color;
	readonly borderColor?: Color;
	readonly active?: boolean;
	readonly disabled?: boolean;
	readonly label?: string;
	readonly tooltip?: string;
	readonly onClick?: () => void;
}

/** Hoverable square icon button for toolbars, panels, headers, and inline actions. */
export class IconButton extends GuiComponent {
	private iconValue: VectorIconName;
	private sizeValue: number;
	private iconSizeValue: number;
	private radiusValue: number | undefined;
	private colorValue: Color | undefined;
	private hoverColorValue: Color | undefined;
	private activeColorValue: Color | undefined;
	private backgroundValue: Color | undefined;
	private hoverBackgroundValue: Color | undefined;
	private activeBackgroundValue: Color | undefined;
	private borderColorValue: Color | undefined;
	private activeValue: boolean;
	private disabledValue: boolean;
	private labelText: string;
	private pressed = false;
	onClick: (() => void) | undefined;

	constructor(options: IconButtonOptions) {
		super();
		this.iconValue = options.icon;
		this.sizeValue = Math.max(16, options.size ?? 28);
		this.iconSizeValue = Math.max(8, options.iconSize ?? 14);
		this.radiusValue = options.radius;
		this.colorValue = options.color;
		this.hoverColorValue = options.hoverColor;
		this.activeColorValue = options.activeColor;
		this.backgroundValue = options.background;
		this.hoverBackgroundValue = options.hoverBackground;
		this.activeBackgroundValue = options.activeBackground;
		this.borderColorValue = options.borderColor;
		this.activeValue = options.active ?? false;
		this.disabledValue = options.disabled ?? false;
		this.labelText = options.label ?? options.tooltip ?? options.icon;
		this.onClick = options.onClick;
		this.focusable = !this.disabledValue;
		this.cursor = this.disabledValue ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
	}

	setIcon(icon: VectorIconName): void {
		if (this.iconValue === icon) return;
		this.iconValue = icon;
		this.invalidate();
	}

	getIcon(): VectorIconName {
		return this.iconValue;
	}

	setActive(active: boolean): void {
		if (this.activeValue === active) return;
		this.activeValue = active;
		this.invalidate();
	}

	isActive(): boolean {
		return this.activeValue;
	}

	setDisabled(disabled: boolean): void {
		this.disabledValue = disabled;
		this.focusable = !disabled;
		this.cursor = disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
		this.pressed = false;
		this.invalidate();
	}

	setLabel(label: string): void {
		this.labelText = label;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		return {
			width: Math.min(maxWidth, this.sizeValue),
			height: maxHeight !== undefined ? Math.min(maxHeight, this.sizeValue) : this.sizeValue,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const t = ctx.theme;
		const hovered = !this.disabledValue && this.isHovered();
		const focused = !this.disabledValue && ctx.isFocused(this);
		const radius = this.radiusValue ?? t.radiusSmall;

		let bg = this.backgroundValue;
		if (this.activeValue) {
			bg = this.activeBackgroundValue ?? t.surfaceActive;
		} else if (this.pressed && !this.disabledValue) {
			bg = this.activeBackgroundValue ?? mixColors(t.surfaceHover, t.text, t.dark ? 0.12 : 0.08);
		} else if (hovered) {
			bg = this.hoverBackgroundValue ?? t.hover;
		}

		let fg = this.colorValue ?? t.textSecondary;
		if (this.disabledValue) {
			fg = t.textDisabled;
		} else if (this.activeValue) {
			fg = this.activeColorValue ?? t.textBright;
		} else if (hovered || this.pressed) {
			fg = this.hoverColorValue ?? t.textPrimary;
		}

		if (focused) {
			drawFocusHalo(ctx, r, radius, 0.24, 3);
		}
		if (bg !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, bg, radius);
		}
		if (this.borderColorValue !== undefined) {
			ctx.strokeRect(r.x, r.y, r.width, r.height, this.borderColorValue, 1, radius);
		}

		const iconSize = Math.min(this.iconSizeValue, Math.max(8, Math.min(r.width, r.height) - 4));
		const ix = r.x + (r.width - iconSize) * 0.5;
		const iy = r.y + (r.height - iconSize) * 0.5;
		drawVectorIcon(ctx, this.iconValue, ix, iy, iconSize, fg);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (this.disabledValue) {
			return { handled: false };
		}
		if (event.phase === "down" && event.button === "left") {
			this.pressed = true;
			this.invalidate();
			return { handled: true, capture: this, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "drag") {
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left") {
			const wasPressed = this.pressed;
			this.pressed = false;
			this.invalidate();
			if (wasPressed && pointInRect(event.x, event.y, this.layoutRect)) {
				this.onClick?.();
			}
			return { handled: true, releaseCapture: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "leave" && this.pressed) {
			this.pressed = false;
			this.invalidate();
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.disabledValue) {
			return false;
		}
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onClick?.();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = this.disabledValue ? 0 : SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			stateFlags: flags,
			rect: this.layoutRect,
			label: this.labelText,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId || this.disabledValue) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press") {
			ctx.requestFocus(this);
			this.onClick?.();
			this.invalidate();
			return true;
		}
		return false;
	}
}
