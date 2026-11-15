/**
 * Custom vector/procedural 2D drawing canvas component with pointer, scroll, key, and accessibility support.
 */

import type { Color } from "../colors.ts";
import {
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import type { GuiKeyEvent } from "../keys.ts";
import {
	type A11yActionKind,
	type A11yRole,
	type CursorKindId,
	type GuiA11yNode,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_CURSOR_ARROW,
} from "../protocol.ts";

export interface CanvasOptions {
	readonly width?: number;
	readonly height?: number;
	readonly focusable?: boolean;
	readonly label?: string;
	readonly role?: A11yRole;
	readonly value?: string;
	readonly cursor?: CursorKindId;
	readonly background?: Color;
	readonly borderColor?: Color;
	readonly radius?: number;
	readonly onDraw?: (ctx: GuiRenderContext, bounds: Rect) => void;
	readonly onPointer?: (event: GuiPointerEvent, bounds: Rect, ctx: GuiRenderContext) => GuiPointerResult;
	readonly onScroll?: (event: GuiScrollEvent, bounds: Rect, ctx: GuiRenderContext) => boolean;
	readonly onKey?: (event: GuiKeyEvent, ctx: GuiRenderContext) => boolean;
	readonly onPress?: () => void;
	readonly onIncrement?: () => void;
	readonly onDecrement?: () => void;
	readonly onSetValue?: (value: string) => void;
}

export class Canvas extends GuiComponent {
	private preferredWidth: number;
	private preferredHeight: number;
	private labelValue: string;
	private roleValue: A11yRole;
	private valueText: string;
	private background: Color | undefined;
	private borderColor: Color | undefined;
	private radius: number;

	onDraw: ((ctx: GuiRenderContext, bounds: Rect) => void) | undefined;
	onPointer: ((event: GuiPointerEvent, bounds: Rect, ctx: GuiRenderContext) => GuiPointerResult) | undefined;
	onScroll: ((event: GuiScrollEvent, bounds: Rect, ctx: GuiRenderContext) => boolean) | undefined;
	onKey: ((event: GuiKeyEvent, ctx: GuiRenderContext) => boolean) | undefined;
	onPress: (() => void) | undefined;
	onIncrement: (() => void) | undefined;
	onDecrement: (() => void) | undefined;
	onSetValue: ((value: string) => void) | undefined;

	constructor(options: CanvasOptions = {}) {
		super();
		this.preferredWidth = Math.max(0, options.width ?? 320);
		this.preferredHeight = Math.max(0, options.height ?? 200);
		this.focusable = options.focusable ?? false;
		this.labelValue = options.label ?? "";
		this.roleValue = options.role ?? "group";
		this.valueText = options.value ?? "";
		this.cursor = options.cursor ?? SGUI_CURSOR_ARROW;
		this.background = options.background;
		this.borderColor = options.borderColor;
		this.radius = options.radius ?? 0;
		this.onDraw = options.onDraw;
		this.onPointer = options.onPointer;
		this.onScroll = options.onScroll;
		this.onKey = options.onKey;
		this.onPress = options.onPress;
		this.onIncrement = options.onIncrement;
		this.onDecrement = options.onDecrement;
		this.onSetValue = options.onSetValue;
	}

	setPreferredSize(width: number, height: number): void {
		this.preferredWidth = Math.max(0, width);
		this.preferredHeight = Math.max(0, height);
		this.invalidate();
	}

	getLabel(): string {
		return this.labelValue;
	}

	setLabel(label: string): void {
		if (this.labelValue === label) return;
		this.labelValue = label;
		this.invalidate();
	}

	getRole(): A11yRole {
		return this.roleValue;
	}

	setRole(role: A11yRole): void {
		if (this.roleValue === role) return;
		this.roleValue = role;
		this.invalidate();
	}

	getValue(): string {
		return this.valueText;
	}

	setValue(value: string): void {
		if (this.valueText === value) return;
		this.valueText = value;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		return {
			width: Math.min(maxWidth, this.preferredWidth),
			height: maxHeight !== undefined ? Math.min(maxHeight, this.preferredHeight) : this.preferredHeight,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		if (this.background !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, this.background, this.radius);
		}
		ctx.pushClip(r);
		this.onDraw?.(ctx, r);
		ctx.popClip();

		if (this.borderColor !== undefined || (this.focusable && ctx.isFocused(this))) {
			const border = this.focusable && ctx.isFocused(this) ? ctx.theme.borderFocus : (this.borderColor ?? ctx.theme.border);
			ctx.strokeRect(r.x, r.y, r.width, r.height, border, 1, this.radius);
		}
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		const inside = pointInRect(event.x, event.y, this.layoutRect);
		if (!inside && event.phase !== "drag" && event.phase !== "up" && event.phase !== "leave") {
			return { handled: false };
		}
		if (this.onPointer !== undefined) {
			const res = this.onPointer(event, this.layoutRect, ctx);
			if (res.handled) {
				const focusTarget = res.focus ?? (event.phase === "down" && this.focusable ? this : undefined);
				return {
					handled: true,
					capture: res.capture,
					releaseCapture: res.releaseCapture ?? (event.phase === "up"),
					cursor: res.cursor ?? this.cursor,
					focus: focusTarget,
				};
			}
			return res;
		}
		if (event.phase === "down" && event.button === "left" && inside && this.focusable) {
			return { handled: true, focus: this, cursor: this.cursor };
		}
		return { handled: false };
	}

	override handleScroll(event: GuiScrollEvent, ctx: GuiRenderContext): boolean {
		if (this.onScroll === undefined) return false;
		return this.onScroll(event, this.layoutRect, ctx);
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.onKey === undefined) return false;
		return this.onKey(event, ctx);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		const r = this.layoutRect;
		if (!this.visible || r.width <= 0 || r.height <= 0) return;
		if (this.labelValue.length === 0 && this.roleValue === "group") return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.focusable && ctx.isFocused(this)) {
			flags |= SGUI_A11Y_STATE_FOCUSED;
		}
		out.push({
			id: this.a11yId,
			role: this.roleValue,
			stateFlags: flags,
			rect: r,
			label: this.labelValue.length > 0 ? this.labelValue : "Canvas",
			value: this.valueText,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			if (!this.focusable) return false;
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press") {
			if (!this.focusable && this.onPress === undefined) return false;
			if (this.focusable) ctx.requestFocus(this);
			this.onPress?.();
			this.invalidate();
			return true;
		}
		if (action === "increment") {
			if (this.onIncrement === undefined) return false;
			if (this.focusable) ctx.requestFocus(this);
			this.onIncrement();
			this.invalidate();
			return true;
		}
		if (action === "decrement") {
			if (this.onDecrement === undefined) return false;
			if (this.focusable) ctx.requestFocus(this);
			this.onDecrement();
			this.invalidate();
			return true;
		}
		if (action === "setValue") {
			if (this.onSetValue === undefined) return false;
			if (this.focusable) ctx.requestFocus(this);
			this.onSetValue(value);
			this.invalidate();
			return true;
		}
		return false;
	}
}
