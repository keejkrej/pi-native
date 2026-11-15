/**
 * Settings list component with value cycling/toggling and search filtering.
 */

import type { TextStyle } from "../backend.ts";
import {
	allocateA11yId,
	clampNumber,
	drawFocusHalo,
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
import type { GuiKeyEvent } from "../keys.ts";
import {
	type A11yActionKind,
	type GuiA11yNode,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_REGULAR,
} from "../protocol.ts";
import { fuzzyFilter } from "./autocomplete.ts";
import { Input } from "./input.ts";

export interface SettingItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	currentValue: string;
	readonly values?: readonly string[];
}

export interface SettingsListOptions {
	readonly items: readonly SettingItem[];
	readonly maxVisible?: number;
	readonly rowHeight?: number;
	readonly enableSearch?: boolean;
	readonly onChange?: (id: string, newValue: string) => void;
	readonly onCancel?: () => void;
}

export class SettingsList extends GuiComponent {
	private readonly items: SettingItem[];
	private filteredItems: SettingItem[];
	private selectedIndex: number;
	private scrollOffsetIndex: number;
	private readonly maxVisible: number;
	private readonly rowHeight: number;
	private readonly searchInput: Input | undefined;
	private readonly rowA11yIds: number[];

	onChange: ((id: string, newValue: string) => void) | undefined;
	onCancel: (() => void) | undefined;

	constructor(options: SettingsListOptions) {
		super();
		this.items = options.items.slice();
		this.filteredItems = this.items.slice();
		this.selectedIndex = 0;
		this.scrollOffsetIndex = 0;
		this.maxVisible = Math.max(1, options.maxVisible ?? 10);
		this.rowHeight = Math.max(28, options.rowHeight ?? 38);
		this.onChange = options.onChange;
		this.onCancel = options.onCancel;
		this.rowA11yIds = [];
		this.focusable = true;
		this.cursor = SGUI_CURSOR_POINTER;

		if (options.enableSearch) {
			this.searchInput = new Input({
				placeholder: "Filter settings...",
				onChange: (q) => this.applyFilter(q),
			});
			this.searchInput.setParent(this);
		} else {
			this.searchInput = undefined;
		}
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.searchInput?.attachHost(host);
	}

	updateValue(id: string, newValue: string): void {
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			if (item !== undefined && item.id === id) {
				item.currentValue = newValue;
				this.invalidate();
				return;
			}
		}
	}

	getSelectedItem(): SettingItem | undefined {
		return this.filteredItems[this.selectedIndex];
	}

	private applyFilter(query: string): void {
		this.filteredItems = fuzzyFilter(this.items, query, (item) => `${item.label} ${item.id} ${item.currentValue}`);
		this.selectedIndex = 0;
		this.scrollOffsetIndex = 0;
		this.invalidate();
	}

	private cycleItem(item: SettingItem): void {
		this.stepItem(item, 1);
	}

	private stepItem(item: SettingItem, delta: 1 | -1): void {
		if (item.values !== undefined && item.values.length > 0) {
			const idx = item.values.indexOf(item.currentValue);
			const baseIdx = idx >= 0 ? idx : 0;
			const next = item.values[(baseIdx + delta + item.values.length) % item.values.length];
			if (next !== undefined && next !== item.currentValue) {
				item.currentValue = next;
				this.onChange?.(item.id, next);
			}
		} else if (item.currentValue === "true" || item.currentValue === "false") {
			const next = item.currentValue === "true" ? "false" : "true";
			item.currentValue = next;
			this.onChange?.(item.id, next);
		}
		this.invalidate();
	}

	private listTopOffset(ctx: GuiRenderContext, width: number): number {
		if (this.searchInput === undefined) return 4;
		return this.searchInput.measure(ctx, Math.max(0, width - 16)).height + 12;
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const searchH = this.searchInput !== undefined ? this.listTopOffset(ctx, maxWidth) : 8;
		const rowsH = Math.min(this.maxVisible, Math.max(1, this.filteredItems.length)) * this.rowHeight;
		const desired = searchH + rowsH + 4;
		return {
			width: maxWidth,
			height: maxHeight !== undefined ? Math.min(maxHeight, desired) : desired,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		if (this.searchInput !== undefined) {
			const inputW = Math.max(0, rect.width - 16);
			const inputH = this.searchInput.measure(ctx, inputW).height;
			this.searchInput.layout(ctx, { x: rect.x + 8, y: rect.y + 8, width: inputW, height: inputH });
		}
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const focused = this.isFocused();
		if (focused) {
			drawFocusHalo(ctx, r, ctx.theme.radiusMedium, 0.22, 3);
		}
		ctx.fillRect(r.x, r.y, r.width, r.height, ctx.theme.surface, ctx.theme.radiusMedium);
		ctx.strokeRect(
			r.x,
			r.y,
			r.width,
			r.height,
			focused ? ctx.theme.borderFocus : ctx.theme.border,
			1,
			ctx.theme.radiusMedium,
		);

		this.searchInput?.render(ctx);

		const topOffset = this.listTopOffset(ctx, r.width);
		const listRect: Rect = {
			x: r.x + 4,
			y: r.y + topOffset,
			width: Math.max(0, r.width - 8),
			height: Math.max(0, r.height - topOffset - 4),
		};

		ctx.pushClip(listRect);
		const labelStyle: TextStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: ctx.theme.fontSizeBody,
			fontWeight: 500,
		};
		const valueStyle: TextStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: ctx.theme.fontSizeBody,
			fontWeight: 600,
		};
		const lineH = ctx.measureText(labelStyle, 0, "Mg").lineHeight;
		const visibleCount = Math.max(1, Math.floor(listRect.height / this.rowHeight));

		for (let v = 0; v < visibleCount; v++) {
			const idx = this.scrollOffsetIndex + v;
			const item = this.filteredItems[idx];
			if (item === undefined) break;

			const ry = listRect.y + v * this.rowHeight;
			const isSelected = idx === this.selectedIndex;
			if (isSelected) {
				ctx.fillRect(listRect.x, ry, listRect.width, this.rowHeight, ctx.theme.selection, ctx.theme.radiusSmall);
			}
			const textY = ry + Math.max(0, (this.rowHeight - lineH) * 0.5);
			ctx.drawStyledText(listRect.x + 10, textY, listRect.width * 0.6, ctx.theme.text, labelStyle, item.label);

			const valueW = ctx.measureText(valueStyle, 0, item.currentValue).width;
			const valueX = listRect.x + Math.max(listRect.width * 0.5, listRect.width - valueW - 12);
			ctx.drawStyledText(valueX, textY, valueW + 4, ctx.theme.accent, valueStyle, item.currentValue);
		}
		ctx.popClip();
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) {
			return undefined;
		}
		if (this.searchInput !== undefined) {
			const hit = this.searchInput.hitTest(x, y);
			if (hit !== undefined) return hit;
		}
		return this;
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		if (!pointInRect(event.x, event.y, this.layoutRect)) {
			return { handled: false };
		}
		const topOffset = this.listTopOffset(ctx, this.layoutRect.width);
		if (event.y >= this.layoutRect.y + topOffset) {
			const row = Math.floor((event.y - (this.layoutRect.y + topOffset)) / this.rowHeight);
			const idx = this.scrollOffsetIndex + row;
			if (idx >= 0 && idx < this.filteredItems.length) {
				this.selectedIndex = idx;
				if (event.phase === "down" && event.button === "left") {
					const item = this.filteredItems[idx];
					if (item !== undefined) {
						this.cycleItem(item);
					}
					return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
				}
				this.invalidate();
			}
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleScroll(event: GuiScrollEvent, _ctx: GuiRenderContext): boolean {
		const visible = Math.min(this.maxVisible, this.filteredItems.length);
		if (this.filteredItems.length <= visible || event.deltaY === 0) return false;
		const next = clampNumber(
			this.scrollOffsetIndex + (event.deltaY > 0 ? 1 : -1),
			0,
			Math.max(0, this.filteredItems.length - visible),
		);
		if (next === this.scrollOffsetIndex) return false;
		this.scrollOffsetIndex = next;
		this.invalidate();
		return true;
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "up") return false;
		const kb = ctx.keybindings;
		if (kb.matches(event, "selectUp")) {
			if (this.filteredItems.length > 0) {
				this.selectedIndex = clampNumber(this.selectedIndex - 1, 0, this.filteredItems.length - 1);
				if (this.selectedIndex < this.scrollOffsetIndex) this.scrollOffsetIndex = this.selectedIndex;
				this.invalidate();
			}
			return true;
		}
		if (kb.matches(event, "selectDown")) {
			if (this.filteredItems.length > 0) {
				this.selectedIndex = clampNumber(this.selectedIndex + 1, 0, this.filteredItems.length - 1);
				if (this.selectedIndex >= this.scrollOffsetIndex + this.maxVisible) {
					this.scrollOffsetIndex = this.selectedIndex - this.maxVisible + 1;
				}
				this.invalidate();
			}
			return true;
		}
		if (kb.matches(event, "toggle") || kb.matches(event, "selectConfirm")) {
			const selected = this.filteredItems[this.selectedIndex];
			if (selected !== undefined) {
				this.cycleItem(selected);
			}
			return true;
		}
		if (kb.matches(event, "selectCancel")) {
			this.onCancel?.();
			return true;
		}
		return false;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		if (this.searchInput !== undefined) {
			this.searchInput.collectFocusables(out);
		}
		super.collectFocusables(out);
	}

	private ensureRowA11yId(slot: number): number {
		while (this.rowA11yIds.length <= slot) {
			this.rowA11yIds.push(allocateA11yId());
		}
		return this.rowA11yIds[slot] ?? this.a11yId;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		const r = this.layoutRect;
		if (!this.visible || r.width <= 0 || r.height <= 0) return;
		this.searchInput?.collectAccessibilityNodes(out, ctx);
		const topOffset = this.listTopOffset(ctx, r.width);
		const listW = Math.max(0, r.width - 8);
		const listH = Math.max(0, r.height - topOffset - 4);
		if (listW <= 0 || listH <= 0) return;
		const listY = r.y + topOffset;
		const visibleCount = Math.max(1, Math.floor(listH / this.rowHeight));
		for (let v = 0; v < visibleCount; v++) {
			const idx = this.scrollOffsetIndex + v;
			const item = this.filteredItems[idx];
			if (item === undefined) break;
			const ry = listY + v * this.rowHeight;
			const rowH = Math.min(this.rowHeight, listY + listH - ry);
			if (rowH <= 0) break;
			let flags = SGUI_A11Y_STATE_ENABLED;
			if (idx === this.selectedIndex) {
				flags |= SGUI_A11Y_STATE_SELECTED;
				if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
			}
			out.push({
				id: this.ensureRowA11yId(v),
				role: "button",
				stateFlags: flags,
				rect: { x: r.x + 4, y: ry, width: listW, height: rowH },
				label: item.label,
				value: item.currentValue,
			});
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		const searchHit = this.searchInput?.findComponentByA11yId(nodeId);
		if (searchHit !== undefined) return searchHit;
		if (nodeId === this.a11yId || this.rowA11yIds.includes(nodeId)) {
			return this;
		}
		return undefined;
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		let targetIndex = -1;
		if (nodeId === this.a11yId) {
			targetIndex = this.selectedIndex;
		} else {
			const slot = this.rowA11yIds.indexOf(nodeId);
			if (slot < 0) return false;
			targetIndex = this.scrollOffsetIndex + slot;
		}
		if (action === "focus") {
			if (targetIndex >= 0 && targetIndex < this.filteredItems.length) {
				this.selectedIndex = targetIndex;
			}
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		const item = this.filteredItems[targetIndex];
		if (item === undefined) return false;
		if (action === "press" || action === "increment") {
			this.selectedIndex = targetIndex;
			ctx.requestFocus(this);
			this.stepItem(item, 1);
			return true;
		}
		if (action === "decrement") {
			this.selectedIndex = targetIndex;
			ctx.requestFocus(this);
			this.stepItem(item, -1);
			return true;
		}
		if (action === "setValue") {
			const canAssign =
				item.values?.includes(value) === true ||
				((item.currentValue === "true" || item.currentValue === "false") &&
					(value === "true" || value === "false"));
			if (!canAssign) return false;
			this.selectedIndex = targetIndex;
			ctx.requestFocus(this);
			if (item.currentValue !== value) {
				item.currentValue = value;
				this.onChange?.(item.id, value);
			}
			this.invalidate();
			return true;
		}
		return false;
	}
}
