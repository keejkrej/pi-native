/**
 * Clipped scroll container with smooth pixel scrolling, sticky follow-end, clickable indicator, and draggable scrollbar.
 */

import type { TextStyle } from "../backend.ts";
import type { Color } from "../colors.ts";
import {
	allocateA11yId,
	clampNumber,
	type Edges,
	GuiComponent,
	type GuiHost,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	intersectRect,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import type { GuiKeyEvent } from "../keys.ts";
import {
	type A11yActionKind,
	type GuiA11yNode,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_REGULAR,
} from "../protocol.ts";
import type { GuiTheme } from "../theme.ts";

export interface ScrollViewOptions {
	readonly child?: GuiComponent;
	readonly follow?: "none" | "end";
	readonly primary?: boolean;
	readonly overscroll?: "contain" | "chain";
	readonly showScrollbar?: boolean;
	readonly overlayScrollbar?: boolean;
	readonly scrollbarWidth?: number;
	readonly padding?: PaddingInput;
	readonly background?: Color;
	readonly scrollToEndLabel?: string;
}

export class ScrollView extends GuiComponent {
	private child: GuiComponent | undefined;
	private followMode: "none" | "end";
	private followingEnd: boolean;
	readonly primary: boolean;
	private overscroll: "contain" | "chain";
	private showScrollbar: boolean;
	private overlayScrollbar: boolean;
	private scrollbarWidth: number;
	private padding: Edges;
	private background: Color | undefined;
	private scrollToEndLabel: string;

	private scrollYValue: number;
	private maxScrollYValue: number;
	private contentHeightValue: number;
	private viewportHeightValue: number;

	private draggingThumb: boolean;
	private dragStartY: number;
	private dragStartScrollY: number;
	private readonly indicatorA11yId: number;

	constructor(options: ScrollViewOptions = {}) {
		super();
		this.child = options.child;
		if (this.child !== undefined) {
			this.child.setParent(this);
		}
		this.followMode = options.follow ?? "none";
		this.followingEnd = this.followMode === "end";
		this.primary = options.primary ?? false;
		this.overscroll = options.overscroll ?? "contain";
		this.showScrollbar = options.showScrollbar ?? true;
		this.overlayScrollbar = options.overlayScrollbar ?? false;
		this.scrollbarWidth = options.scrollbarWidth ?? 6;
		this.padding = normalizeEdges(options.padding);
		this.background = options.background;
		this.scrollToEndLabel = options.scrollToEndLabel ?? "Jump to bottom";

		this.scrollYValue = 0;
		this.maxScrollYValue = 0;
		this.contentHeightValue = 0;
		this.viewportHeightValue = 0;

		this.draggingThumb = false;
		this.dragStartY = 0;
		this.dragStartScrollY = 0;
		this.indicatorA11yId = allocateA11yId();
		this.focusable = false;
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

	getScrollY(): number {
		return this.scrollYValue;
	}

	getMaxScrollY(): number {
		return this.maxScrollYValue;
	}

	isFollowingEnd(): boolean {
		return this.followingEnd;
	}

	setFollowMode(mode: "none" | "end"): void {
		this.followMode = mode;
		this.followingEnd = mode === "end";
		if (this.followingEnd) {
			this.scrollYValue = this.maxScrollYValue;
		}
		this.invalidate();
	}

	scrollTo(y: number): void {
		const next = clampNumber(y, 0, this.maxScrollYValue);
		if (this.followMode === "end") {
			this.followingEnd = next >= this.maxScrollYValue - 1;
		}
		if (Math.abs(next - this.scrollYValue) > 0.01) {
			this.scrollYValue = next;
			this.invalidate();
		}
	}

	scrollBy(deltaY: number): boolean {
		const next = clampNumber(this.scrollYValue + deltaY, 0, this.maxScrollYValue);
		if (this.followMode === "end") {
			if (deltaY < 0 && next < this.maxScrollYValue - 1) {
				this.followingEnd = false;
			} else if (next >= this.maxScrollYValue - 1) {
				this.followingEnd = true;
			}
		}
		if (Math.abs(next - this.scrollYValue) <= 0.01) {
			return false;
		}
		this.scrollYValue = next;
		this.invalidate();
		return true;
	}

	scrollToEnd(): void {
		if (this.followMode === "end") {
			this.followingEnd = true;
		}
		this.scrollYValue = this.maxScrollYValue;
		this.invalidate();
	}

	private viewportRect(): Rect {
		const r = this.layoutRect;
		const reserve =
			this.showScrollbar && !this.overlayScrollbar && this.maxScrollYValue > 0 ? this.scrollbarWidth + 4 : 0;
		return {
			x: r.x + this.padding.left,
			y: r.y + this.padding.top,
			width: Math.max(0, r.width - this.padding.left - this.padding.right - reserve),
			height: Math.max(0, r.height - this.padding.top - this.padding.bottom),
		};
	}

	private scrollbarTrackRect(): Rect | undefined {
		if (!this.showScrollbar || this.maxScrollYValue <= 0) {
			return undefined;
		}
		const r = this.layoutRect;
		const trackH = Math.max(0, r.height - 8);
		if (trackH <= 0 || r.width < this.scrollbarWidth + 4) {
			return undefined;
		}
		return {
			x: r.x + r.width - this.scrollbarWidth - 3,
			y: r.y + 4,
			width: this.scrollbarWidth,
			height: trackH,
		};
	}

	private scrollbarThumbRect(): Rect | undefined {
		const track = this.scrollbarTrackRect();
		if (track === undefined || this.contentHeightValue <= 0) {
			return undefined;
		}
		const ratio = Math.min(1, this.viewportHeightValue / this.contentHeightValue);
		const thumbH = clampNumber(track.height * ratio, 24, track.height);
		const scrollableTrack = Math.max(0, track.height - thumbH);
		const progress = this.maxScrollYValue > 0 ? this.scrollYValue / this.maxScrollYValue : 0;
		return {
			x: track.x,
			y: track.y + scrollableTrack * progress,
			width: Math.max(2, track.width),
			height: thumbH,
		};
	}

	private indicatorRect(ctx: GuiRenderContext): Rect | undefined {
		if (this.followMode !== "end" || this.followingEnd || this.maxScrollYValue <= 0) {
			return undefined;
		}
		const r = this.layoutRect;
		const metrics = ctx.measureText(
			{ fontFamily: SGUI_FONT_REGULAR, fontSize: ctx.theme.fontSizeSmall, fontWeight: 600 },
			0,
			this.scrollToEndLabel,
		);
		const pillW = metrics.width + 20;
		const pillH = metrics.lineHeight + 10;
		const rightOffset = this.showScrollbar && this.maxScrollYValue > 0 ? this.scrollbarWidth + 12 : 12;
		const x = r.x + Math.max(8, r.width - rightOffset - pillW);
		const y = r.y + Math.max(8, r.height - 12 - pillH);
		return { x, y, width: Math.min(pillW, r.width - 16), height: Math.min(pillH, r.height - 16) };
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const reserve = this.showScrollbar && !this.overlayScrollbar ? this.scrollbarWidth + 4 : 0;
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right - reserve);
		let childSize: Size = { width: 0, height: 0 };
		if (this.child?.visible) {
			childSize = this.child.measure(ctx, innerMaxW, undefined);
		}
		const naturalW = childSize.width + this.padding.left + this.padding.right + reserve;
		const naturalH = childSize.height + this.padding.top + this.padding.bottom;
		return {
			width: Math.min(maxWidth, naturalW),
			height: maxHeight !== undefined ? Math.min(maxHeight, naturalH) : naturalH,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const innerWNoBar = Math.max(0, rect.width - this.padding.left - this.padding.right);
		const innerWWithBar = Math.max(
			0,
			innerWNoBar - (this.showScrollbar && !this.overlayScrollbar ? this.scrollbarWidth + 4 : 0),
		);
		const innerH = Math.max(0, rect.height - this.padding.top - this.padding.bottom);
		this.viewportHeightValue = innerH;

		if (this.child === undefined || !this.child.visible) {
			this.contentHeightValue = 0;
			this.maxScrollYValue = 0;
			this.scrollYValue = 0;
			return;
		}

		let measured = this.child.measure(ctx, innerWNoBar, undefined);
		const needsScrollbar = this.showScrollbar && !this.overlayScrollbar && measured.height > innerH;
		const childW = needsScrollbar ? innerWWithBar : innerWNoBar;
		if (needsScrollbar && childW !== innerWNoBar) {
			measured = this.child.measure(ctx, childW, undefined);
		}

		this.contentHeightValue = measured.height;
		this.maxScrollYValue = Math.max(0, this.contentHeightValue - innerH);

		if (this.followMode === "end" && this.followingEnd) {
			this.scrollYValue = this.maxScrollYValue;
		} else {
			this.scrollYValue = clampNumber(this.scrollYValue, 0, this.maxScrollYValue);
		}

		this.child.layout(ctx, {
			x: rect.x + this.padding.left,
			y: rect.y + this.padding.top - this.scrollYValue,
			width: childW,
			height: Math.max(innerH, measured.height),
		});
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (this.background !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, this.background);
		}
		const vp = this.viewportRect();
		if (this.child?.visible && vp.width > 0 && vp.height > 0) {
			ctx.pushClip(vp);
			this.child.render(ctx);
			ctx.popClip();
		}

		const track = this.scrollbarTrackRect();
		const thumb = this.scrollbarThumbRect();
		if (track !== undefined && thumb !== undefined) {
			if (this.draggingThumb) {
				ctx.fillRect(track.x, track.y, track.width, track.height, ctx.theme.scrollbarTrack, track.width * 0.5);
			}
			ctx.fillRect(thumb.x, thumb.y, thumb.width, thumb.height, ctx.theme.scrollbarThumb, thumb.width * 0.5);
		}

		const pill = this.indicatorRect(ctx);
		if (pill !== undefined && pill.width > 0 && pill.height > 0) {
			ctx.fillRect(pill.x, pill.y, pill.width, pill.height, ctx.theme.accent, pill.height * 0.5);
			ctx.strokeRect(pill.x, pill.y, pill.width, pill.height, ctx.theme.border, 1, pill.height * 0.5);
			const style: TextStyle = {
				fontFamily: SGUI_FONT_REGULAR,
				fontSize: ctx.theme.fontSizeSmall,
				fontWeight: 600,
			};
			const metrics = ctx.measureText(style, 0, this.scrollToEndLabel);
			const textX = pill.x + Math.max(0, (pill.width - metrics.width) * 0.5);
			const textY = pill.y + Math.max(0, (pill.height - metrics.lineHeight) * 0.5);
			ctx.drawStyledText(textX, textY, 0, ctx.theme.textOnAccent, style, this.scrollToEndLabel);
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) {
			return undefined;
		}
		const track = this.scrollbarTrackRect();
		if (track !== undefined && pointInRect(x, y, track)) {
			return this;
		}
		if (this.followMode === "end" && !this.followingEnd && this.maxScrollYValue > 0) {
			const r = this.layoutRect;
			if (x >= r.x + r.width - 160 && y >= r.y + r.height - 48) {
				// Allow handlePointer on indicator pill directly before falling through
				return this;
			}
		}
		const vp = this.viewportRect();
		if (pointInRect(x, y, vp) && this.child !== undefined && this.child.visible) {
			const childHit = this.child.hitTest(x, y);
			if (childHit !== undefined) {
				return childHit;
			}
		}
		return this;
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			const pill = this.indicatorRect(ctx);
			if (pill !== undefined && pointInRect(event.x, event.y, pill)) {
				this.scrollToEnd();
				return { handled: true, cursor: SGUI_CURSOR_POINTER };
			}
			const thumb = this.scrollbarThumbRect();
			const track = this.scrollbarTrackRect();
			if (thumb !== undefined && pointInRect(event.x, event.y, thumb)) {
				this.draggingThumb = true;
				this.dragStartY = event.y;
				this.dragStartScrollY = this.scrollYValue;
				return { handled: true, capture: this };
			}
			if (track !== undefined && thumb !== undefined && pointInRect(event.x, event.y, track)) {
				const scrollableTrack = Math.max(1, track.height - thumb.height);
				const targetRatio = clampNumber((event.y - track.y - thumb.height * 0.5) / scrollableTrack, 0, 1);
				this.scrollTo(targetRatio * this.maxScrollYValue);
				return { handled: true };
			}
			return { handled: false };
		}

		if (event.phase === "drag" && this.draggingThumb) {
			const track = this.scrollbarTrackRect();
			const thumb = this.scrollbarThumbRect();
			if (track !== undefined && thumb !== undefined) {
				const scrollableTrack = Math.max(1, track.height - thumb.height);
				const deltaRatio = (event.y - this.dragStartY) / scrollableTrack;
				this.scrollTo(this.dragStartScrollY + deltaRatio * this.maxScrollYValue);
			}
			return { handled: true };
		}

		if (event.phase === "up" && this.draggingThumb) {
			this.draggingThumb = false;
			return { handled: true, releaseCapture: true };
		}

		return { handled: false };
	}

	override handleScroll(event: GuiScrollEvent, _ctx: GuiRenderContext): boolean {
		if (event.deltaY === 0) {
			return false;
		}
		const moved = this.scrollBy(event.deltaY);
		if (moved) {
			return true;
		}
		return this.overscroll === "contain";
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase !== "down" && event.phase !== "repeat") {
			return false;
		}
		const pageStep = Math.max(40, this.viewportHeightValue * 0.85);
		const lineStep = 40;
		if (ctx.keybindings.matches(event, "scrollUp")) {
			return this.scrollBy(-lineStep);
		}
		if (ctx.keybindings.matches(event, "scrollDown")) {
			return this.scrollBy(lineStep);
		}
		if (ctx.keybindings.matches(event, "scrollPageUp")) {
			return this.scrollBy(-pageStep);
		}
		if (ctx.keybindings.matches(event, "scrollPageDown")) {
			return this.scrollBy(pageStep);
		}
		if (ctx.keybindings.matches(event, "scrollTop")) {
			this.scrollTo(0);
			return true;
		}
		if (ctx.keybindings.matches(event, "scrollBottom")) {
			this.scrollToEnd();
			return true;
		}
		return false;
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
		const vp = this.viewportRect();
		if (vp.width <= 0 || vp.height <= 0) return;
		if (this.child?.visible) {
			const childNodes: GuiA11yNode[] = [];
			this.child.collectAccessibilityNodes(childNodes, ctx);
			for (let i = 0; i < childNodes.length; i++) {
				const node = childNodes[i];
				if (node === undefined) continue;
				const clipped = intersectRect(node.rect, vp);
				if (clipped.width > 0 && clipped.height > 0) {
					out.push({
						id: node.id,
						role: node.role,
						stateFlags: node.stateFlags,
						rect: clipped,
						label: node.label,
						value: node.value,
					});
				}
			}
		}
		const pill = this.indicatorRect(ctx);
		if (pill !== undefined && pill.width > 0 && pill.height > 0) {
			out.push({
				id: this.indicatorA11yId,
				role: "button",
				stateFlags: SGUI_A11Y_STATE_ENABLED,
				rect: pill,
				label: this.scrollToEndLabel,
				value: "",
			});
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		const selfMatch = super.findComponentByA11yId(nodeId);
		if (selfMatch !== undefined) return selfMatch;
		if (nodeId === this.indicatorA11yId) return this;
		return this.child?.findComponentByA11yId(nodeId);
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		_ctx: GuiRenderContext,
	): boolean {
		if (nodeId === this.indicatorA11yId && action === "press") {
			this.scrollToEnd();
			return true;
		}
		return false;
	}
}
