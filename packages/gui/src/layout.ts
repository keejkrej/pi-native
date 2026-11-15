/**
 * Composable layout containers: Spacer, Box, Container, VStack, and HStack with flex sizing.
 */

import { type Color, withAlpha } from "./colors.ts";
import {
	type BoxShadow,
	drawElevationShadow,
	type Edges,
	GuiComponent,
	type GuiHost,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	type ShadowLevel,
	type Size,
} from "./component.ts";
import type { GuiA11yNode } from "./protocol.ts";
import type { GuiTheme } from "./theme.ts";

export interface StackEntry {
	readonly child: GuiComponent;
	readonly basis?: number;
	readonly grow?: number;
	readonly shrink?: number;
	readonly minSize?: number;
	readonly maxSize?: number;
	readonly visible?: boolean;
}

export type StackChild = GuiComponent | StackEntry;

export type StackAlignment = "start" | "center" | "end" | "stretch";

export interface StackOptions {
	readonly gap?: number;
	readonly align?: StackAlignment;
	readonly padding?: PaddingInput;
	readonly background?: Color;
	readonly radius?: number;
	readonly children?: readonly StackChild[];
}

function toStackEntry(item: StackChild): StackEntry {
	return item instanceof GuiComponent ? { child: item } : item;
}

export class Spacer extends GuiComponent {
	private widthValue: number;
	private heightValue: number;

	constructor(width = 0, height = 0) {
		super();
		this.widthValue = Math.max(0, width);
		this.heightValue = Math.max(0, height);
	}

	setSize(width: number, height: number): void {
		this.widthValue = Math.max(0, width);
		this.heightValue = Math.max(0, height);
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const w = Math.min(this.widthValue, Math.max(0, maxWidth));
		const h = maxHeight !== undefined ? Math.min(this.heightValue, Math.max(0, maxHeight)) : this.heightValue;
		return { width: w, height: h };
	}

	render(_ctx: GuiRenderContext): void {}

	override hitTest(_x: number, _y: number): GuiComponent | undefined {
		return undefined;
	}
}

export interface CornerRadii {
	readonly tl: number;
	readonly tr: number;
	readonly br: number;
	readonly bl: number;
}

export interface BoxOptions {
	readonly child?: GuiComponent;
	readonly padding?: PaddingInput;
	readonly background?: Color;
	readonly borderColor?: Color;
	readonly borderWidth?: number;
	readonly radius?: number;
	readonly cornerRadii?: CornerRadii;
	readonly shadow?: BoxShadow;
	readonly width?: number;
	readonly height?: number;
	readonly minWidth?: number;
	readonly minHeight?: number;
	readonly maxWidth?: number;
	readonly maxHeight?: number;
	readonly fillWidth?: boolean;
	readonly alignHorizontal?: "start" | "center" | "end";
	readonly clip?: boolean;
}

export class Box extends GuiComponent {
	private child: GuiComponent | undefined;
	private padding: Edges;
	private background: Color | undefined;
	private borderColor: Color | undefined;
	private borderWidth: number;
	private radius: number;
	private cornerRadiiValue: CornerRadii | undefined;
	private shadow: BoxShadow | undefined;
	private fixedWidth: number | undefined;
	private fixedHeight: number | undefined;
	private minWidth: number;
	private minHeight: number;
	private maxWidthLimit: number | undefined;
	private maxHeightLimit: number | undefined;
	private fillWidthValue: boolean;
	private alignHorizontal: "start" | "center" | "end";
	private clipChildren: boolean;

	constructor(options: BoxOptions = {}) {
		super();
		this.child = options.child;
		this.padding = normalizeEdges(options.padding);
		this.background = options.background;
		this.borderColor = options.borderColor;
		this.borderWidth = options.borderWidth ?? (options.borderColor !== undefined ? 1 : 0);
		this.radius = options.radius ?? 0;
		this.cornerRadiiValue = options.cornerRadii;
		this.shadow = options.shadow;
		this.fixedWidth = options.width;
		this.fixedHeight = options.height;
		this.minWidth = options.minWidth ?? 0;
		this.minHeight = options.minHeight ?? 0;
		this.maxWidthLimit = options.maxWidth;
		this.maxHeightLimit = options.maxHeight;
		this.fillWidthValue = options.fillWidth ?? false;
		this.alignHorizontal = options.alignHorizontal ?? "start";
		this.clipChildren = options.clip ?? false;
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

	setPadding(padding: PaddingInput): void {
		this.padding = normalizeEdges(padding);
		this.invalidate();
	}

	setBackground(color: Color | undefined): void {
		this.background = color;
		this.invalidate();
	}

	setBorder(color: Color | undefined, width = 1, radius = this.radius): void {
		this.borderColor = color;
		this.borderWidth = width;
		this.radius = radius;
		this.invalidate();
	}

	setRadius(radius: number): void {
		this.radius = Math.max(0, radius);
		this.cornerRadiiValue = undefined;
		this.invalidate();
	}

	getRadius(): number {
		return this.radius;
	}

	setCornerRadii(radii: CornerRadii | undefined): void {
		this.cornerRadiiValue = radii;
		this.invalidate();
	}

	getCornerRadii(): CornerRadii | undefined {
		return this.cornerRadiiValue;
	}

	hasBackground(): boolean {
		return this.background !== undefined;
	}

	hasBorder(): boolean {
		return this.borderColor !== undefined && this.borderWidth > 0;
	}

	hasShadow(): boolean {
		return this.shadow !== undefined && this.shadow !== false;
	}

	setShadow(shadow: BoxShadow | undefined): void {
		this.shadow = shadow;
		this.invalidate();
	}

	private resolvedShadowLevel(): ShadowLevel | undefined {
		if (this.shadow === undefined || this.shadow === false) return undefined;
		return this.shadow === true ? "md" : this.shadow;
	}

	private effectiveMaxWidth(maxWidth: number): number {
		let bound = Math.max(0, maxWidth);
		if (this.maxWidthLimit !== undefined) {
			bound = Math.min(bound, this.maxWidthLimit);
		}
		if (this.fixedWidth !== undefined) {
			bound = Math.min(bound, this.fixedWidth);
		}
		return bound;
	}

	private effectiveMaxHeight(maxHeight: number | undefined): number | undefined {
		let bound = maxHeight;
		if (this.maxHeightLimit !== undefined) {
			bound = bound !== undefined ? Math.min(bound, this.maxHeightLimit) : this.maxHeightLimit;
		}
		if (this.fixedHeight !== undefined) {
			bound = bound !== undefined ? Math.min(bound, this.fixedHeight) : this.fixedHeight;
		}
		return bound;
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const bw = this.borderColor !== undefined ? this.borderWidth : 0;
		const insetX = this.padding.left + this.padding.right + bw * 2;
		const insetY = this.padding.top + this.padding.bottom + bw * 2;
		const outerMaxW = this.effectiveMaxWidth(maxWidth);
		const outerMaxH = this.effectiveMaxHeight(maxHeight);
		const innerMaxW = Math.max(0, outerMaxW - insetX);
		const innerMaxH = outerMaxH !== undefined ? Math.max(0, outerMaxH - insetY) : undefined;

		let childW = 0;
		let childH = 0;
		if (this.child?.visible) {
			const childSize = this.child.measure(ctx, innerMaxW, innerMaxH);
			childW = childSize.width;
			childH = childSize.height;
		}

		let totalW = this.fixedWidth ?? (this.fillWidthValue ? outerMaxW : Math.max(this.minWidth, childW + insetX));
		let totalH = this.fixedHeight ?? Math.max(this.minHeight, childH + insetY);
		totalW = Math.min(outerMaxW, Math.max(this.minWidth, totalW));
		if (outerMaxH !== undefined) {
			totalH = Math.min(outerMaxH, Math.max(this.minHeight, totalH));
		}
		return { width: totalW, height: totalH };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		const hasWidthConstraint = this.fixedWidth !== undefined || this.maxWidthLimit !== undefined;
		const boxW = hasWidthConstraint ? Math.min(rect.width, this.effectiveMaxWidth(rect.width)) : rect.width;
		let boxX = rect.x;
		if (boxW < rect.width) {
			if (this.alignHorizontal === "center") {
				boxX = rect.x + Math.max(0, (rect.width - boxW) * 0.5);
			} else if (this.alignHorizontal === "end") {
				boxX = rect.x + Math.max(0, rect.width - boxW);
			}
		}

		const hasHeightConstraint = this.fixedHeight !== undefined || this.maxHeightLimit !== undefined;
		const limitH = hasHeightConstraint ? this.effectiveMaxHeight(rect.height) : undefined;
		const boxH = limitH !== undefined ? Math.min(rect.height, limitH) : rect.height;

		const resolvedRect: Rect = { x: boxX, y: rect.y, width: boxW, height: boxH };
		super.layout(ctx, resolvedRect);
		if (this.child === undefined || !this.child.visible) {
			return;
		}
		const bw = this.borderColor !== undefined ? this.borderWidth : 0;
		const innerX = resolvedRect.x + this.padding.left + bw;
		const innerY = resolvedRect.y + this.padding.top + bw;
		const innerW = Math.max(0, resolvedRect.width - this.padding.left - this.padding.right - bw * 2);
		const innerH = Math.max(0, resolvedRect.height - this.padding.top - this.padding.bottom - bw * 2);
		this.child.layout(ctx, { x: innerX, y: innerY, width: innerW, height: innerH });
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const cr = this.cornerRadiiValue;
		const uniformCorner = cr !== undefined && cr.tl === cr.tr && cr.tr === cr.br && cr.br === cr.bl;
		const effectiveScalarRadius = cr !== undefined ? Math.max(0, Math.max(cr.tl, cr.tr, cr.br, cr.bl)) : this.radius;
		const usePerCorner = cr !== undefined && !uniformCorner;
		const shadowLevel = this.resolvedShadowLevel();
		if (shadowLevel !== undefined) {
			drawElevationShadow(ctx, r, effectiveScalarRadius, shadowLevel);
		}
		if (this.background !== undefined) {
			if (usePerCorner) {
				ctx.fillRectCorners(r.x, r.y, r.width, r.height, cr.tl, cr.tr, cr.br, cr.bl, this.background);
			} else {
				const scalar = cr !== undefined ? Math.max(0, cr.tl) : this.radius;
				ctx.fillRect(r.x, r.y, r.width, r.height, this.background, scalar);
			}
		}
		if (this.child?.visible) {
			if (this.clipChildren) {
				ctx.pushClip(r);
				this.child.render(ctx);
				ctx.popClip();
			} else {
				this.child.render(ctx);
			}
		}
		if (this.borderColor !== undefined && this.borderWidth > 0) {
			if (usePerCorner) {
				ctx.strokeRectCorners(
					r.x,
					r.y,
					r.width,
					r.height,
					cr.tl,
					cr.tr,
					cr.br,
					cr.bl,
					this.borderColor,
					this.borderWidth,
				);
			} else {
				const scalar = cr !== undefined ? Math.max(0, cr.tl) : this.radius;
				ctx.strokeRect(r.x, r.y, r.width, r.height, this.borderColor, this.borderWidth, scalar);
			}
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

	override handleScroll(event: GuiScrollEvent, ctx: GuiRenderContext): boolean {
		return this.child?.visible ? this.child.handleScroll(event, ctx) : false;
	}

	override onThemeChange(theme: GuiTheme): void {
		this.child?.onThemeChange(theme);
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		super.collectFocusables(out);
		this.child?.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.child?.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		const selfMatch = super.findComponentByA11yId(nodeId);
		if (selfMatch !== undefined) return selfMatch;
		return this.child?.findComponentByA11yId(nodeId);
	}
}

interface FlexSlot {
	readonly entry: StackEntry;
	size: number;
	min: number;
	max: number;
	grow: number;
	shrink: number;
	crossSize: number;
}

abstract class StackBase extends GuiComponent {
	private readonly direction: "vertical" | "horizontal";
	protected readonly entries: StackEntry[];
	protected gap: number;
	protected align: StackAlignment;
	protected padding: Edges;
	protected background: Color | undefined;
	protected radius: number;

	constructor(direction: "vertical" | "horizontal", options: StackOptions = {}) {
		super();
		this.direction = direction;
		this.entries = [];
		this.gap = options.gap ?? 0;
		this.align = options.align ?? "stretch";
		this.padding = normalizeEdges(options.padding);
		this.background = options.background;
		this.radius = options.radius ?? 0;
		if (options.children !== undefined) {
			for (let i = 0; i < options.children.length; i++) {
				const item = options.children[i];
				if (item !== undefined) {
					this.addChild(item);
				}
			}
		}
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined) {
				entry.child.attachHost(host);
			}
		}
	}

	addChild(item: StackChild): void {
		const entry = toStackEntry(item);
		entry.child.setParent(this);
		entry.child.attachHost(this.host);
		this.entries.push(entry);
		this.invalidate();
	}

	insertChild(index: number, item: StackChild): void {
		const entry = toStackEntry(item);
		entry.child.setParent(this);
		entry.child.attachHost(this.host);
		this.entries.splice(Math.max(0, Math.min(index, this.entries.length)), 0, entry);
		this.invalidate();
	}

	removeChild(child: GuiComponent): boolean {
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined && entry.child === child) {
				this.entries.splice(i, 1);
				child.setParent(undefined);
				child.attachHost(undefined);
				this.invalidate();
				return true;
			}
		}
		return false;
	}

	clear(): void {
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined) {
				entry.child.setParent(undefined);
				entry.child.attachHost(undefined);
			}
		}
		this.entries.length = 0;
		this.invalidate();
	}

	getChildren(): GuiComponent[] {
		const out: GuiComponent[] = [];
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined) {
				out.push(entry.child);
			}
		}
		return out;
	}

	setGap(gap: number): void {
		this.gap = Math.max(0, gap);
		this.invalidate();
	}

	setAlign(align: StackAlignment): void {
		this.align = align;
		this.invalidate();
	}

	setPadding(padding: PaddingInput): void {
		this.padding = normalizeEdges(padding);
		this.invalidate();
	}

	setBackground(color: Color | undefined): void {
		this.background = color;
		this.invalidate();
	}

	private visibleEntries(): StackEntry[] {
		const list: StackEntry[] = [];
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined && entry.visible !== false && entry.child.visible) {
				list.push(entry);
			}
		}
		return list;
	}

	private computeSlots(ctx: GuiRenderContext, innerW: number, innerH: number | undefined): FlexSlot[] {
		const active = this.visibleEntries();
		const slots: FlexSlot[] = [];

		for (let i = 0; i < active.length; i++) {
			const entry = active[i];
			if (entry === undefined) continue;
			const min = Math.max(0, entry.minSize ?? 0);
			const max = entry.maxSize !== undefined ? Math.max(min, entry.maxSize) : Number.POSITIVE_INFINITY;
			const grow = Math.max(0, entry.grow ?? 0);
			const measured =
				this.direction === "vertical"
					? entry.child.measure(ctx, innerW, innerH)
					: entry.child.measure(ctx, entry.basis ?? innerW, innerH);
			const rawMain = entry.basis ?? (grow > 0 ? 0 : this.direction === "vertical" ? measured.height : measured.width);
			const clampedMain = Math.min(max, Math.max(min, rawMain));
			const crossSize = this.direction === "vertical" ? measured.width : measured.height;
			slots.push({
				entry,
				size: clampedMain,
				min,
				max,
				grow,
				shrink: Math.max(0, entry.shrink ?? 1),
				crossSize,
			});
		}
		return slots;
	}

	private solveFlex(slots: FlexSlot[], targetMain: number): void {
		if (slots.length === 0) return;
		const totalGap = this.gap * Math.max(0, slots.length - 1);
		let usedMain = totalGap;
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i];
			if (slot !== undefined) {
				usedMain += slot.size;
			}
		}

		let remaining = targetMain - usedMain;
		if (remaining > 0.001) {
			for (let iter = 0; iter < slots.length && remaining > 0.001; iter++) {
				let totalGrow = 0;
				for (let i = 0; i < slots.length; i++) {
					const slot = slots[i];
					if (slot !== undefined && slot.grow > 0 && slot.size < slot.max) {
						totalGrow += slot.grow;
					}
				}
				if (totalGrow <= 0) break;
				let consumed = 0;
				for (let i = 0; i < slots.length; i++) {
					const slot = slots[i];
					if (slot === undefined || slot.grow <= 0 || slot.size >= slot.max) continue;
					const share = (remaining * slot.grow) / totalGrow;
					const next = Math.min(slot.max, slot.size + share);
					consumed += next - slot.size;
					slot.size = next;
				}
				if (consumed <= 0.0001) break;
				remaining -= consumed;
			}
		} else if (remaining < -0.001) {
			let deficit = -remaining;
			for (let iter = 0; iter < slots.length && deficit > 0.001; iter++) {
				let totalWeight = 0;
				for (let i = 0; i < slots.length; i++) {
					const slot = slots[i];
					if (slot !== undefined && slot.shrink > 0 && slot.size > slot.min) {
						totalWeight += slot.shrink * Math.max(1, slot.size);
					}
				}
				if (totalWeight <= 0) break;
				let reduced = 0;
				for (let i = 0; i < slots.length; i++) {
					const slot = slots[i];
					if (slot === undefined || slot.shrink <= 0 || slot.size <= slot.min) continue;
					const weight = slot.shrink * Math.max(1, slot.size);
					const share = (deficit * weight) / totalWeight;
					const next = Math.max(slot.min, slot.size - share);
					reduced += slot.size - next;
					slot.size = next;
				}
				if (reduced <= 0.0001) break;
				deficit -= reduced;
			}
		}
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right);
		const innerMaxH =
			maxHeight !== undefined ? Math.max(0, maxHeight - this.padding.top - this.padding.bottom) : undefined;
		const slots = this.computeSlots(ctx, innerMaxW, innerMaxH);
		const gapTotal = this.gap * Math.max(0, slots.length - 1);

		if (this.direction === "vertical") {
			let totalH = gapTotal;
			let maxCrossW = 0;
			for (let i = 0; i < slots.length; i++) {
				const slot = slots[i];
				if (slot === undefined) continue;
				const naturalMain =
					slot.entry.basis ??
					slot.entry.child.measure(ctx, innerMaxW, innerMaxH).height;
				totalH += Math.min(slot.max, Math.max(slot.min, naturalMain));
				if (slot.crossSize > maxCrossW) maxCrossW = slot.crossSize;
			}
			const width = Math.min(maxWidth, maxCrossW + this.padding.left + this.padding.right);
			const height =
				maxHeight !== undefined
					? Math.min(maxHeight, totalH + this.padding.top + this.padding.bottom)
					: totalH + this.padding.top + this.padding.bottom;
			return { width, height };
		}

		let totalW = gapTotal;
		let maxCrossH = 0;
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i];
			if (slot === undefined) continue;
			const naturalMain =
				slot.entry.basis ??
				slot.entry.child.measure(ctx, innerMaxW, innerMaxH).width;
			totalW += Math.min(slot.max, Math.max(slot.min, naturalMain));
			if (slot.crossSize > maxCrossH) maxCrossH = slot.crossSize;
		}
		const width = Math.min(maxWidth, totalW + this.padding.left + this.padding.right);
		const naturalH = maxCrossH + this.padding.top + this.padding.bottom;
		const height = maxHeight !== undefined ? Math.min(maxHeight, naturalH) : naturalH;
		return { width, height };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const innerX = rect.x + this.padding.left;
		const innerY = rect.y + this.padding.top;
		const innerW = Math.max(0, rect.width - this.padding.left - this.padding.right);
		const innerH = Math.max(0, rect.height - this.padding.top - this.padding.bottom);
		const slots = this.computeSlots(ctx, innerW, innerH);
		this.solveFlex(slots, this.direction === "vertical" ? innerH : innerW);

		let cursor = this.direction === "vertical" ? innerY : innerX;
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i];
			if (slot === undefined) continue;
			const child = slot.entry.child;
			if (this.direction === "vertical") {
				const w = this.align === "stretch" ? innerW : Math.min(innerW, child.measure(ctx, innerW, slot.size).width);
				let x = innerX;
				if (this.align === "center") x = innerX + (innerW - w) * 0.5;
				else if (this.align === "end") x = innerX + (innerW - w);
				child.layout(ctx, { x, y: cursor, width: w, height: slot.size });
			} else {
				const h =
					this.align === "stretch" ? innerH : Math.min(innerH, child.measure(ctx, slot.size, innerH).height);
				let y = innerY;
				if (this.align === "center") y = innerY + (innerH - h) * 0.5;
				else if (this.align === "end") y = innerY + (innerH - h);
				child.layout(ctx, { x: cursor, y, width: slot.size, height: h });
			}
			cursor += slot.size + this.gap;
		}
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		if (this.background !== undefined) {
			const r = this.layoutRect;
			ctx.fillRect(r.x, r.y, r.width, r.height, this.background, this.radius);
		}
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined && entry.visible !== false && entry.child.visible) {
				entry.child.render(ctx);
			}
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) {
			return undefined;
		}
		for (let i = this.entries.length - 1; i >= 0; i--) {
			const entry = this.entries[i];
			if (entry !== undefined && entry.visible !== false && entry.child.visible) {
				const hit = entry.child.hitTest(x, y);
				if (hit !== undefined) {
					return hit;
				}
			}
		}
		return this;
	}

	override handlePointer(_event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		return { handled: false };
	}

	override onThemeChange(theme: GuiTheme): void {
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined) {
				entry.child.onThemeChange(theme);
			}
		}
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined && entry.visible !== false && entry.child.visible) {
				entry.child.collectFocusables(out);
			}
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined && entry.visible !== false && entry.child.visible) {
				entry.child.collectAccessibilityNodes(out, ctx);
			}
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		const selfMatch = super.findComponentByA11yId(nodeId);
		if (selfMatch !== undefined) return selfMatch;
		for (let i = 0; i < this.entries.length; i++) {
			const entry = this.entries[i];
			if (entry !== undefined && entry.visible !== false && entry.child.visible) {
				const found = entry.child.findComponentByA11yId(nodeId);
				if (found !== undefined) return found;
			}
		}
		return undefined;
	}
}

export class Container extends StackBase {
	constructor(options: StackOptions = {}) {
		super("vertical", options);
	}
}

export class VStack extends StackBase {
	constructor(options: StackOptions = {}) {
		super("vertical", options);
	}
}

export class HStack extends StackBase {
	constructor(options: StackOptions = {}) {
		super("horizontal", options);
	}
}

export type DividerDirection = "horizontal" | "vertical";

export interface DividerOptions {
	readonly direction?: DividerDirection;
	readonly color?: Color;
	readonly thickness?: number;
	readonly inset?: number;
	readonly length?: number;
}

/** Crisp horizontal or vertical hairline separator. */
export class Divider extends GuiComponent {
	private direction: DividerDirection;
	private colorValue: Color | undefined;
	private thickness: number;
	private inset: number;
	private lengthValue: number | undefined;

	constructor(options: DividerOptions = {}) {
		super();
		this.direction = options.direction ?? "horizontal";
		this.colorValue = options.color;
		this.thickness = Math.max(0.5, options.thickness ?? 1);
		this.inset = Math.max(0, options.inset ?? 0);
		this.lengthValue = options.length;
	}

	setColor(color: Color | undefined): void {
		this.colorValue = color;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		if (this.direction === "vertical") {
			const desiredH = this.lengthValue ?? 16;
			return {
				width: this.thickness,
				height: maxHeight !== undefined ? Math.min(maxHeight, desiredH) : desiredH,
			};
		}
		const desiredW = this.lengthValue ?? Math.min(maxWidth, Math.max(16, this.inset * 2 + 16));
		return {
			width: Math.max(0, Math.min(maxWidth, desiredW)),
			height: this.thickness,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const color = this.colorValue ?? withAlpha(ctx.theme.border, ctx.theme.dark ? 0.65 : 0.85);
		if (this.direction === "vertical") {
			const y = r.y + this.inset;
			const h = Math.max(0, r.height - this.inset * 2);
			if (h <= 0) return;
			const x = r.x + Math.max(0, (r.width - this.thickness) * 0.5);
			ctx.fillRect(x, y, this.thickness, h, color);
		} else {
			const x = r.x + this.inset;
			const w = Math.max(0, r.width - this.inset * 2);
			if (w <= 0) return;
			const y = r.y + Math.max(0, (r.height - this.thickness) * 0.5);
			ctx.fillRect(x, y, w, this.thickness, color);
		}
	}
}
