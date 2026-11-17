/**
 * Window chrome primitives: native window drag/zoom titlebar region and interactive split resize handle.
 */

import type { Color } from "../colors.ts";
import {
	GuiComponent,
	type GuiHost,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import {
	type A11yActionKind,
	type GuiA11yNode,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_CURSOR_RESIZE_EW,
	SGUI_WIN_ACTION_DRAG,
	SGUI_WIN_ACTION_ZOOM,
} from "../protocol.ts";
import type { GuiTheme } from "../theme.ts";

export interface WindowDragAreaOptions {
	readonly child?: GuiComponent;
	readonly width?: number;
	readonly height?: number;
	readonly minWidth?: number;
	readonly minHeight?: number;
	readonly dragThreshold?: number;
	readonly onDragStart?: () => void;
	readonly onDoubleClick?: () => void;
}

/**
 * Transparent window drag & double-click-to-zoom area for unified macOS titlebar chrome.
 * Yields automatically to any child interactive controls that handle pointer down first.
 */
export class WindowDragArea extends GuiComponent {
	private child: GuiComponent | undefined;
	private fixedWidth: number | undefined;
	private fixedHeight: number | undefined;
	private minWidth: number;
	private minHeight: number;
	private dragThreshold: number;
	private onDragStart: (() => void) | undefined;
	private onDoubleClick: (() => void) | undefined;
	private armed = false;
	private dragTriggered = false;
	private pressX = 0;
	private pressY = 0;

	constructor(options: WindowDragAreaOptions = {}) {
		super();
		this.child = options.child;
		this.fixedWidth = options.width;
		this.fixedHeight = options.height;
		this.minWidth = options.minWidth ?? 0;
		this.minHeight = options.minHeight ?? 0;
		this.dragThreshold = Math.max(0, options.dragThreshold ?? 0);
		this.onDragStart = options.onDragStart;
		this.onDoubleClick = options.onDoubleClick;
		if (this.child !== undefined) {
			this.child.setParent(this);
		}
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.child?.attachHost(host);
	}

	getChild(): GuiComponent | undefined {
		return this.child;
	}

	setChild(child: GuiComponent | undefined): void {
		if (this.child !== undefined && this.child !== child) {
			this.child.setParent(undefined);
			this.child.attachHost(undefined);
		}
		this.child = child;
		if (this.child !== undefined) {
			this.child.setParent(this);
			this.child.attachHost(this.host);
		}
		this.invalidate();
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const targetW = this.fixedWidth !== undefined ? Math.min(maxWidth, this.fixedWidth) : maxWidth;
		const childSize = this.child?.visible ? this.child.measure(ctx, targetW, maxHeight) : { width: 0, height: 0 };
		const width = this.fixedWidth !== undefined ? Math.max(this.minWidth, this.fixedWidth) : Math.max(this.minWidth, childSize.width);
		const height =
			this.fixedHeight !== undefined ? Math.max(this.minHeight, this.fixedHeight) : Math.max(this.minHeight, childSize.height);
		return {
			width: Math.min(maxWidth, width),
			height: maxHeight !== undefined ? Math.min(maxHeight, height) : height,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		if (this.child?.visible) {
			this.child.layout(ctx, rect);
		}
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		if (this.child?.visible) {
			this.child.render(ctx);
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) {
			return undefined;
		}
		if (this.child?.visible) {
			const hit = this.child.hitTest(x, y);
			if (hit !== undefined) {
				return hit;
			}
		}
		return this;
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		if (!this.visible) {
			return { handled: false };
		}
		if (event.phase === "down" && event.button === "left") {
			if (event.clickCount >= 2) {
				this.armed = false;
				this.dragTriggered = false;
				this.onDoubleClick?.();
				ctx.windowAction(SGUI_WIN_ACTION_ZOOM);
				return { handled: true, releaseCapture: true };
			}
			this.armed = true;
			this.dragTriggered = false;
			this.pressX = event.x;
			this.pressY = event.y;
			return { handled: true, capture: this };
		}
		if (event.phase === "drag" && event.button === "left" && this.armed && !this.dragTriggered) {
			const dist = Math.hypot(event.x - this.pressX, event.y - this.pressY);
			if (dist >= this.dragThreshold) {
				this.dragTriggered = true;
				this.armed = false;
				this.onDragStart?.();
				ctx.windowAction(SGUI_WIN_ACTION_DRAG);
				return { handled: true, releaseCapture: true };
			}
			return { handled: true, capture: this };
		}
		if (event.phase === "up" && event.button === "left") {
			this.armed = false;
			this.dragTriggered = false;
			return { handled: true, releaseCapture: true };
		}
		return { handled: false };
	}

	override handleScroll(event: GuiScrollEvent, ctx: GuiRenderContext): boolean {
		return this.child?.visible ? this.child.handleScroll(event, ctx) : false;
	}

	override onThemeChange(theme: GuiTheme): void {
		this.child?.onThemeChange(theme);
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.child?.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.child?.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (!this.visible) return undefined;
		return this.child?.findComponentByA11yId(nodeId);
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		return this.child?.handleAccessibilityAction(nodeId, action, value, ctx) ?? false;
	}
}

export interface SplitResizeHandleOptions {
	readonly width?: number;
	readonly minWidth?: number;
	readonly maxWidth?: number;
	readonly initialWidth?: number;
	readonly getWidth?: () => number;
	readonly direction?: 1 | -1;
	readonly dividerColor?: Color;
	readonly hoverColor?: Color;
	readonly activeColor?: Color;
	readonly dividerThickness?: number;
	readonly a11yLabel?: string;
	readonly onResize?: (nextWidth: number) => void;
	readonly onResizeEnd?: (finalWidth: number) => void;
}

/**
 * Interactive 4-6px split-pane resize handle (`SGUI_CURSOR_RESIZE_EW`) drawing a crisp 1px divider line
 * that highlights in accent Coral on hover/drag and clamps width cleanly to `minWidth..maxWidth`.
 */
export class SplitResizeHandle extends GuiComponent {
	private hitWidth: number;
	private minWidth: number;
	private maxWidth: number;
	private currentWidth: number;
	private getWidth: (() => number) | undefined;
	private direction: 1 | -1;
	private dividerColor: Color | undefined;
	private hoverColor: Color | undefined;
	private activeColor: Color | undefined;
	private dividerThickness: number;
	private a11yLabel: string;
	private onResize: ((nextWidth: number) => void) | undefined;
	private onResizeEnd: ((finalWidth: number) => void) | undefined;

	private dragging = false;
	private dragStartX = 0;
	private dragStartWidth = 0;

	constructor(options: SplitResizeHandleOptions = {}) {
		super();
		this.cursor = SGUI_CURSOR_RESIZE_EW;
		this.hitWidth = Math.max(4, Math.min(8, options.width ?? 6));
		this.minWidth = options.minWidth ?? 160;
		this.maxWidth = Math.max(this.minWidth, options.maxWidth ?? 520);
		this.currentWidth = this.clampWidth(options.initialWidth ?? this.minWidth);
		this.getWidth = options.getWidth;
		this.direction = options.direction ?? 1;
		this.dividerColor = options.dividerColor;
		this.hoverColor = options.hoverColor;
		this.activeColor = options.activeColor;
		this.dividerThickness = Math.max(1, options.dividerThickness ?? 1);
		this.a11yLabel = options.a11yLabel ?? "Resize panel";
		this.onResize = options.onResize;
		this.onResizeEnd = options.onResizeEnd;
	}

	private clampWidth(value: number): number {
		return Math.max(this.minWidth, Math.min(this.maxWidth, value));
	}

	getCurrentWidth(): number {
		return this.currentWidth;
	}

	setCurrentWidth(width: number): void {
		this.currentWidth = this.clampWidth(width);
		this.invalidate();
	}

	setBounds(minWidth: number, maxWidth: number): void {
		this.minWidth = minWidth;
		this.maxWidth = Math.max(minWidth, maxWidth);
		this.currentWidth = this.clampWidth(this.currentWidth);
		this.invalidate();
	}

	isDragging(): boolean {
		return this.dragging;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		return {
			width: Math.min(maxWidth, this.hitWidth),
			height: maxHeight ?? 0,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const hovered = this.isHovered();
		const color = this.dragging
			? (this.activeColor ?? this.hoverColor ?? ctx.theme.accent)
			: hovered
				? (this.hoverColor ?? ctx.theme.accent)
				: (this.dividerColor ?? ctx.theme.border);
		const thickness = this.dividerThickness;
		const lineX = Math.round(r.x + (r.width - thickness) * 0.5);
		ctx.fillRect(lineX, r.y, thickness, r.height, color, 0);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (!this.visible) {
			return { handled: false };
		}
		if (event.phase === "down" && event.button === "left") {
			this.dragging = true;
			this.dragStartX = event.x;
			const base = this.getWidth !== undefined ? this.getWidth() : this.currentWidth;
			this.dragStartWidth = this.clampWidth(base);
			this.currentWidth = this.dragStartWidth;
			this.invalidate();
			return { handled: true, capture: this, cursor: SGUI_CURSOR_RESIZE_EW };
		}
		if (event.phase === "drag" && this.dragging) {
			const delta = (event.x - this.dragStartX) * this.direction;
			const next = this.clampWidth(this.dragStartWidth + delta);
			if (next !== this.currentWidth) {
				this.currentWidth = next;
				this.onResize?.(next);
			}
			this.invalidate();
			return { handled: true, capture: this, cursor: SGUI_CURSOR_RESIZE_EW };
		}
		if (event.phase === "up" && this.dragging) {
			this.dragging = false;
			this.onResizeEnd?.(this.currentWidth);
			this.invalidate();
			return { handled: true, releaseCapture: true, cursor: SGUI_CURSOR_RESIZE_EW };
		}
		return { handled: false, cursor: SGUI_CURSOR_RESIZE_EW };
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		out.push({
			id: this.a11yId,
			role: "group",
			stateFlags: SGUI_A11Y_STATE_ENABLED,
			rect: this.layoutRect,
			label: this.a11yLabel,
			value: `${Math.round(this.currentWidth)}px`,
		});
	}
}
