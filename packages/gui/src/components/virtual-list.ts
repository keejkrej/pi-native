/**
 * Virtualized scrollable list: measures, lays out, and renders only visible items plus overscan.
 */

import type { Color } from "../colors.ts";
import {
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
import type { GuiA11yNode } from "../protocol.ts";
import type { GuiTheme } from "../theme.ts";

export interface VirtualListOptions<T> {
	readonly items?: readonly T[];
	readonly estimatedItemHeight?: number;
	readonly gap?: number;
	readonly overscan?: number;
	readonly follow?: "none" | "end";
	readonly showScrollbar?: boolean;
	readonly scrollbarWidth?: number;
	readonly padding?: PaddingInput;
	readonly background?: Color;
	readonly renderItem: (item: T, index: number, existing?: GuiComponent) => GuiComponent;
	readonly keyFn?: (item: T, index: number) => string;
}

export interface VirtualRange {
	readonly startIndex: number;
	readonly endIndex: number;
}

class VirtualListImpl extends GuiComponent {
	private items: unknown[];
	private readonly estimatedItemHeight: number;
	private readonly gap: number;
	private readonly overscan: number;
	private followMode: "none" | "end";
	private followingEnd: boolean;
	private readonly showScrollbar: boolean;
	private readonly scrollbarWidth: number;
	private readonly padding: Edges;
	private readonly background: Color | undefined;
	private readonly renderItem: (item: unknown, index: number, existing?: GuiComponent) => GuiComponent;
	private readonly keyFn: ((item: unknown, index: number) => string) | undefined;

	private heightCache: number[];
	private prefixOffsets: number[];
	private measuredWidth: number;
	private totalHeightValue: number;
	private viewportHeightValue: number;
	private scrollYValue: number;
	private maxScrollYValue: number;

	private activeComponents: Map<string, GuiComponent>;
	private visibleStartIndex: number;
	private visibleEndIndex: number;
	private draggingThumb: boolean;
	private dragStartY: number;
	private dragStartScrollY: number;

	constructor(options: VirtualListOptions<unknown>) {
		super();
		this.items = options.items ? options.items.slice() : [];
		this.estimatedItemHeight = Math.max(8, options.estimatedItemHeight ?? 48);
		this.gap = Math.max(0, options.gap ?? 0);
		this.overscan = Math.max(0, options.overscan ?? 3);
		this.followMode = options.follow ?? "none";
		this.followingEnd = this.followMode === "end";
		this.showScrollbar = options.showScrollbar ?? true;
		this.scrollbarWidth = options.scrollbarWidth ?? 6;
		this.padding = normalizeEdges(options.padding);
		this.background = options.background;
		this.renderItem = options.renderItem;
		this.keyFn = options.keyFn;

		this.heightCache = [];
		this.prefixOffsets = [];
		this.measuredWidth = -1;
		this.totalHeightValue = 0;
		this.viewportHeightValue = 0;
		this.scrollYValue = 0;
		this.maxScrollYValue = 0;
		this.activeComponents = new Map<string, GuiComponent>();
		this.visibleStartIndex = 0;
		this.visibleEndIndex = -1;
		this.draggingThumb = false;
		this.dragStartY = 0;
		this.dragStartScrollY = 0;

		this.resetHeightCache();
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		for (const child of this.activeComponents.values()) {
			child.attachHost(host);
		}
	}

	private itemKey(item: unknown, index: number): string {
		return this.keyFn !== undefined ? this.keyFn(item, index) : String(index);
	}

	private resetHeightCache(): void {
		this.heightCache = new Array<number>(this.items.length);
		for (let i = 0; i < this.items.length; i++) {
			this.heightCache[i] = this.estimatedItemHeight;
		}
		this.rebuildOffsets();
	}

	private rebuildOffsets(): void {
		this.prefixOffsets = new Array<number>(this.items.length);
		let y = 0;
		for (let i = 0; i < this.items.length; i++) {
			this.prefixOffsets[i] = y;
			const h = this.heightCache[i] ?? this.estimatedItemHeight;
			y += h + (i + 1 < this.items.length ? this.gap : 0);
		}
		this.totalHeightValue = y;
	}

	setItems(items: readonly unknown[]): void {
		const prevLen = this.items.length;
		const nextItems = items.slice();
		const nextHeights = new Array<number>(nextItems.length);
		for (let i = 0; i < nextItems.length; i++) {
			if (i < prevLen) {
				nextHeights[i] = this.heightCache[i] ?? this.estimatedItemHeight;
			} else {
				nextHeights[i] = this.estimatedItemHeight;
			}
		}
		this.items = nextItems;
		this.heightCache = nextHeights;
		this.rebuildOffsets();

		// Drop cached components for removed keys when using index keys
		if (this.keyFn === undefined) {
			for (const [k, comp] of this.activeComponents) {
				const idx = Number.parseInt(k, 10);
				if (idx >= nextItems.length) {
					comp.setParent(undefined);
					comp.attachHost(undefined);
					this.activeComponents.delete(k);
				}
			}
		}
		this.invalidate();
	}

	getItemCount(): number {
		return this.items.length;
	}

	getVisibleRange(): VirtualRange {
		return { startIndex: this.visibleStartIndex, endIndex: this.visibleEndIndex };
	}

	getRenderedCount(): number {
		return this.visibleEndIndex >= this.visibleStartIndex ? this.visibleEndIndex - this.visibleStartIndex + 1 : 0;
	}

	getScrollY(): number {
		return this.scrollYValue;
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

	scrollToIndex(index: number, align: "start" | "center" | "end" = "start"): void {
		if (this.items.length === 0) return;
		const clamped = Math.max(0, Math.min(index, this.items.length - 1));
		const top = this.prefixOffsets[clamped] ?? 0;
		const itemH = this.heightCache[clamped] ?? this.estimatedItemHeight;
		let target = top;
		if (align === "center") {
			target = top - Math.max(0, (this.viewportHeightValue - itemH) * 0.5);
		} else if (align === "end") {
			target = top + itemH - this.viewportHeightValue;
		}
		this.scrollTo(target);
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

	private findFirstIndexAtOffset(y: number): number {
		if (this.items.length === 0) return 0;
		let lo = 0;
		let hi = this.items.length - 1;
		while (lo < hi) {
			const mid = Math.floor((lo + hi + 1) / 2);
			const offset = this.prefixOffsets[mid] ?? 0;
			if (offset <= y) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return lo;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const reserve = this.showScrollbar ? this.scrollbarWidth + 4 : 0;
		const naturalW = 240 + this.padding.left + this.padding.right + reserve;
		const naturalH = this.totalHeightValue + this.padding.top + this.padding.bottom;
		return {
			width: Math.min(maxWidth, naturalW),
			height: maxHeight !== undefined ? Math.min(maxHeight, naturalH) : naturalH,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const reserve = this.showScrollbar ? this.scrollbarWidth + 4 : 0;
		const innerW = Math.max(0, rect.width - this.padding.left - this.padding.right - reserve);
		const innerH = Math.max(0, rect.height - this.padding.top - this.padding.bottom);
		this.viewportHeightValue = innerH;

		if (this.items.length === 0 || innerW <= 0 || innerH <= 0) {
			this.visibleStartIndex = 0;
			this.visibleEndIndex = -1;
			this.maxScrollYValue = 0;
			this.scrollYValue = 0;
			return;
		}

		if (this.measuredWidth > 0 && Math.abs(this.measuredWidth - innerW) > 1) {
			// Width changed: clear active widths will re-measure visible items dynamically
		}
		this.measuredWidth = innerW;

		this.maxScrollYValue = Math.max(0, this.totalHeightValue - innerH);
		if (this.followMode === "end" && this.followingEnd) {
			this.scrollYValue = this.maxScrollYValue;
		} else {
			this.scrollYValue = clampNumber(this.scrollYValue, 0, this.maxScrollYValue);
		}

		const firstVisible = this.findFirstIndexAtOffset(this.scrollYValue);
		const start = Math.max(0, firstVisible - this.overscan);
		let end = firstVisible;
		const bottomLimit = this.scrollYValue + innerH;
		while (end + 1 < this.items.length) {
			const nextOffset = this.prefixOffsets[end + 1] ?? this.totalHeightValue;
			if (nextOffset > bottomLimit) {
				break;
			}
			end += 1;
		}
		end = Math.min(this.items.length - 1, end + this.overscan);

		let heightChanged = false;
		const activeKeys = new Set<string>();
		for (let i = start; i <= end; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const key = this.itemKey(item, i);
			activeKeys.add(key);
			const existing = this.activeComponents.get(key);
			const comp = this.renderItem(item, i, existing);
			if (comp !== existing) {
				if (existing !== undefined) {
					existing.setParent(undefined);
					existing.attachHost(undefined);
				}
				comp.setParent(this);
				comp.attachHost(this.host);
				this.activeComponents.set(key, comp);
			}
			const measured = comp.measure(ctx, innerW, undefined);
			const prevH = this.heightCache[i] ?? this.estimatedItemHeight;
			if (Math.abs(measured.height - prevH) > 0.5) {
				this.heightCache[i] = measured.height;
				heightChanged = true;
			}
		}

		// Clean up components outside visible + overscan window to keep tree small
		for (const [key, comp] of this.activeComponents) {
			if (!activeKeys.has(key)) {
				comp.setParent(undefined);
				comp.attachHost(undefined);
				this.activeComponents.delete(key);
			}
		}

		if (heightChanged) {
			const prevMax = this.maxScrollYValue;
			this.rebuildOffsets();
			this.maxScrollYValue = Math.max(0, this.totalHeightValue - innerH);
			if (this.followMode === "end" && this.followingEnd) {
				this.scrollYValue = this.maxScrollYValue;
			} else {
				const deltaMax = this.maxScrollYValue - prevMax;
				if (deltaMax !== 0 && start > 0) {
					// Preserve scroll anchor slightly when earlier estimated items shift
					this.scrollYValue = clampNumber(this.scrollYValue, 0, this.maxScrollYValue);
				}
			}
		}

		this.visibleStartIndex = start;
		this.visibleEndIndex = end;

		for (let i = start; i <= end; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const key = this.itemKey(item, i);
			const comp = this.activeComponents.get(key);
			if (comp === undefined) continue;
			const itemTop = this.prefixOffsets[i] ?? 0;
			const itemH = this.heightCache[i] ?? this.estimatedItemHeight;
			comp.layout(ctx, {
				x: rect.x + this.padding.left,
				y: rect.y + this.padding.top + itemTop - this.scrollYValue,
				width: innerW,
				height: itemH,
			});
		}
	}

	private scrollbarTrackRect(): Rect | undefined {
		if (!this.showScrollbar || this.maxScrollYValue <= 0) {
			return undefined;
		}
		const r = this.layoutRect;
		return {
			x: r.x + r.width - this.scrollbarWidth - 3,
			y: r.y + 4,
			width: this.scrollbarWidth,
			height: Math.max(0, r.height - 8),
		};
	}

	private scrollbarThumbRect(): Rect | undefined {
		const track = this.scrollbarTrackRect();
		if (track === undefined || this.totalHeightValue <= 0) return undefined;
		const ratio = Math.min(1, this.viewportHeightValue / this.totalHeightValue);
		const thumbH = clampNumber(track.height * ratio, 24, track.height);
		const scrollable = Math.max(0, track.height - thumbH);
		const progress = this.maxScrollYValue > 0 ? this.scrollYValue / this.maxScrollYValue : 0;
		return {
			x: track.x,
			y: track.y + scrollable * progress,
			width: Math.max(2, track.width),
			height: thumbH,
		};
	}

	private viewportRect(): Rect {
		const r = this.layoutRect;
		const reserve = this.showScrollbar && this.maxScrollYValue > 0 ? this.scrollbarWidth + 4 : 0;
		return {
			x: r.x + this.padding.left,
			y: r.y + this.padding.top,
			width: Math.max(0, r.width - this.padding.left - this.padding.right - reserve),
			height: Math.max(0, r.height - this.padding.top - this.padding.bottom),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (this.background !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, this.background);
		}
		const vp = this.viewportRect();
		if (vp.width > 0 && vp.height > 0) {
			ctx.pushClip(vp);
			for (let i = this.visibleStartIndex; i <= this.visibleEndIndex; i++) {
				const item = this.items[i];
				if (item === undefined) continue;
				const comp = this.activeComponents.get(this.itemKey(item, i));
				if (comp?.visible) {
					comp.render(ctx);
				}
			}
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
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) {
			return undefined;
		}
		const track = this.scrollbarTrackRect();
		if (track !== undefined && pointInRect(x, y, track)) {
			return this;
		}
		for (let i = this.visibleEndIndex; i >= this.visibleStartIndex; i--) {
			const item = this.items[i];
			if (item === undefined) continue;
			const comp = this.activeComponents.get(this.itemKey(item, i));
			if (comp?.visible) {
				const hit = comp.hitTest(x, y);
				if (hit !== undefined) {
					return hit;
				}
			}
		}
		return this;
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			const thumb = this.scrollbarThumbRect();
			const track = this.scrollbarTrackRect();
			if (thumb !== undefined && pointInRect(event.x, event.y, thumb)) {
				this.draggingThumb = true;
				this.dragStartY = event.y;
				this.dragStartScrollY = this.scrollYValue;
				return { handled: true, capture: this };
			}
			if (track !== undefined && thumb !== undefined && pointInRect(event.x, event.y, track)) {
				const scrollable = Math.max(1, track.height - thumb.height);
				const ratio = clampNumber((event.y - track.y - thumb.height * 0.5) / scrollable, 0, 1);
				this.scrollTo(ratio * this.maxScrollYValue);
				return { handled: true };
			}
			return { handled: false };
		}
		if (event.phase === "drag" && this.draggingThumb) {
			const track = this.scrollbarTrackRect();
			const thumb = this.scrollbarThumbRect();
			if (track !== undefined && thumb !== undefined) {
				const scrollable = Math.max(1, track.height - thumb.height);
				const deltaRatio = (event.y - this.dragStartY) / scrollable;
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
		if (event.deltaY === 0) return false;
		return this.scrollBy(event.deltaY);
	}

	override onThemeChange(theme: GuiTheme): void {
		for (const comp of this.activeComponents.values()) {
			comp.onThemeChange(theme);
		}
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		for (let i = this.visibleStartIndex; i <= this.visibleEndIndex; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const comp = this.activeComponents.get(this.itemKey(item, i));
			comp?.collectFocusables(out);
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const vp = this.viewportRect();
		if (vp.width <= 0 || vp.height <= 0) return;
		const itemNodes: GuiA11yNode[] = [];
		for (let i = this.visibleStartIndex; i <= this.visibleEndIndex; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const comp = this.activeComponents.get(this.itemKey(item, i));
			comp?.collectAccessibilityNodes(itemNodes, ctx);
		}
		for (let i = 0; i < itemNodes.length; i++) {
			const node = itemNodes[i];
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

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		const selfMatch = super.findComponentByA11yId(nodeId);
		if (selfMatch !== undefined) return selfMatch;
		for (let i = this.visibleStartIndex; i <= this.visibleEndIndex; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const comp = this.activeComponents.get(this.itemKey(item, i));
			const found = comp?.findComponentByA11yId(nodeId);
			if (found !== undefined) return found;
		}
		return undefined;
	}
}

export interface VirtualList<T = unknown> extends GuiComponent {
	setItems(items: readonly T[]): void;
	getItemCount(): number;
	getVisibleRange(): VirtualRange;
	getRenderedCount(): number;
	getScrollY(): number;
	scrollTo(y: number): void;
	scrollToIndex(index: number, align?: "start" | "center" | "end"): void;
	scrollBy(deltaY: number): boolean;
}

export interface VirtualListConstructor {
	new <T = unknown>(options: VirtualListOptions<T>): VirtualList<T>;
	readonly prototype: VirtualList<unknown>;
}

// Keep the GuiComponent subclass non-generic so scriptc retains virtual/dynamic dispatch on upcasts.
export const VirtualList: VirtualListConstructor = VirtualListImpl as unknown as VirtualListConstructor;
