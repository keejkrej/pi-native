/**
 * Filterable, keyboard- and mouse-interactive selection list component.
 */

import type { TextStyle } from "../backend.ts";
import {
	allocateA11yId,
	clampNumber,
	drawFocusHalo,
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	pointInRect,
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

export interface SelectItem {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

export interface SelectListOptions {
	readonly items?: readonly SelectItem[];
	readonly maxVisible?: number;
	readonly rowHeight?: number;
	readonly radius?: number;
	readonly onSelect?: (item: SelectItem) => void;
	readonly onCancel?: () => void;
	readonly onSelectionChange?: (item: SelectItem) => void;
}

export class SelectList extends GuiComponent {
	private items: SelectItem[];
	private filteredItems: SelectItem[];
	private selectedIndex: number;
	private scrollOffsetIndex: number;
	private filterQuery: string;
	private readonly maxVisible: number;
	private readonly rowHeight: number;
	private readonly radius: number | undefined;
	private readonly rowA11yIds: number[];

	onSelect: ((item: SelectItem) => void) | undefined;
	onCancel: (() => void) | undefined;
	onSelectionChange: ((item: SelectItem) => void) | undefined;

	constructor(options: SelectListOptions = {}) {
		super();
		this.items = options.items ? options.items.slice() : [];
		this.filteredItems = this.items.slice();
		this.selectedIndex = 0;
		this.scrollOffsetIndex = 0;
		this.filterQuery = "";
		this.maxVisible = Math.max(1, options.maxVisible ?? 8);
		this.rowHeight = Math.max(24, options.rowHeight ?? 34);
		this.radius = options.radius;
		this.rowA11yIds = [];
		this.onSelect = options.onSelect;
		this.onCancel = options.onCancel;
		this.onSelectionChange = options.onSelectionChange;
		this.focusable = true;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	setItems(items: readonly SelectItem[]): void {
		this.items = items.slice();
		this.applyFilter();
	}

	setFilter(query: string): void {
		this.filterQuery = query;
		this.applyFilter();
	}

	getFilteredItems(): readonly SelectItem[] {
		return this.filteredItems;
	}

	getSelectedIndex(): number {
		return this.selectedIndex;
	}

	getSelectedItem(): SelectItem | undefined {
		return this.filteredItems[this.selectedIndex];
	}

	private applyFilter(): void {
		this.filteredItems = fuzzyFilter(this.items, this.filterQuery, (item) =>
			item.description ? `${item.label} ${item.value} ${item.description}` : `${item.label} ${item.value}`,
		);
		this.selectedIndex = 0;
		this.scrollOffsetIndex = 0;
		this.invalidate();
	}

	private visibleRowsCount(): number {
		return Math.min(this.maxVisible, Math.max(1, this.filteredItems.length));
	}

	private ensureSelectionInView(): void {
		const visible = this.visibleRowsCount();
		if (this.selectedIndex < this.scrollOffsetIndex) {
			this.scrollOffsetIndex = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffsetIndex + visible) {
			this.scrollOffsetIndex = this.selectedIndex - visible + 1;
		}
		const maxStart = Math.max(0, this.filteredItems.length - visible);
		this.scrollOffsetIndex = clampNumber(this.scrollOffsetIndex, 0, maxStart);
	}

	private moveSelection(nextIndex: number): void {
		if (this.filteredItems.length === 0) return;
		this.selectedIndex = clampNumber(nextIndex, 0, this.filteredItems.length - 1);
		this.ensureSelectionInView();
		const selected = this.filteredItems[this.selectedIndex];
		if (selected !== undefined) {
			this.onSelectionChange?.(selected);
		}
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const desiredH = this.visibleRowsCount() * this.rowHeight + 8;
		return {
			width: maxWidth,
			height: maxHeight !== undefined ? Math.min(maxHeight, desiredH) : desiredH,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const radius = this.radius ?? ctx.theme.radiusMedium;
		const focused = this.isFocused();
		if (focused) {
			drawFocusHalo(ctx, r, radius, 0.22, 3);
		}
		ctx.fillRect(r.x, r.y, r.width, r.height, ctx.theme.surface, radius);
		ctx.strokeRect(
			r.x,
			r.y,
			r.width,
			r.height,
			focused ? ctx.theme.borderFocus : ctx.theme.border,
			1,
			radius,
		);

		if (this.filteredItems.length === 0) {
			const mutedStyle: TextStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: ctx.theme.fontSizeBody };
			ctx.drawStyledText(r.x + 12, r.y + 10, r.width - 24, ctx.theme.textMuted, mutedStyle, "No matching items");
			return;
		}

		ctx.pushClip(r);
		const labelStyle: TextStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: ctx.theme.fontSizeBody,
			fontWeight: 500,
		};
		const descStyle: TextStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: ctx.theme.fontSizeSmall };
		const lineH = ctx.measureText(labelStyle, 0, "Mg").lineHeight;
		const rowsVisible = Math.max(1, Math.floor((r.height - 8) / this.rowHeight));

		for (let v = 0; v < rowsVisible; v++) {
			const idx = this.scrollOffsetIndex + v;
			const item = this.filteredItems[idx];
			if (item === undefined) break;

			const ry = r.y + 4 + v * this.rowHeight;
			const isSelected = idx === this.selectedIndex;
			if (isSelected) {
				ctx.fillRect(
					r.x + 4,
					ry,
					Math.max(0, r.width - 8),
					this.rowHeight,
					ctx.theme.selection,
					ctx.theme.radiusSmall,
				);
			}
			const textY = ry + Math.max(0, (this.rowHeight - lineH) * 0.5);
			const textColor = isSelected ? ctx.theme.accent : ctx.theme.text;
			ctx.drawStyledText(r.x + 12, textY, Math.max(40, r.width - 24), textColor, labelStyle, item.label);

			if (item.description !== undefined) {
				const labelW = ctx.measureText(labelStyle, 0, item.label).width;
				const descX = r.x + 22 + labelW;
				const availDesc = r.x + r.width - 12 - descX;
				if (availDesc > 24) {
					const descLineH = ctx.measureText(descStyle, 0, "Mg").lineHeight;
					const descY = ry + Math.max(0, (this.rowHeight - descLineH) * 0.5);
					ctx.drawStyledText(descX, descY, availDesc, ctx.theme.textMuted, descStyle, item.description);
				}
			}
		}
		ctx.popClip();
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (!pointInRect(event.x, event.y, this.layoutRect)) {
			return { handled: false };
		}
		if (event.phase === "move" || (event.phase === "down" && event.button === "left")) {
			const relRow = Math.floor((event.y - (this.layoutRect.y + 4)) / this.rowHeight);
			const idx = this.scrollOffsetIndex + relRow;
			if (idx >= 0 && idx < this.filteredItems.length) {
				if (idx !== this.selectedIndex) {
					this.moveSelection(idx);
				}
				if (event.phase === "down") {
					const item = this.filteredItems[idx];
					if (item !== undefined) {
						this.onSelect?.(item);
					}
					return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
				}
			}
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleScroll(event: GuiScrollEvent, _ctx: GuiRenderContext): boolean {
		if (this.filteredItems.length <= this.visibleRowsCount() || event.deltaY === 0) {
			return false;
		}
		const step = event.deltaY > 0 ? 1 : -1;
		const maxOffset = Math.max(0, this.filteredItems.length - this.visibleRowsCount());
		const next = clampNumber(this.scrollOffsetIndex + step, 0, maxOffset);
		if (next === this.scrollOffsetIndex) return false;
		this.scrollOffsetIndex = next;
		this.invalidate();
		return true;
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "up") return false;
		const kb = ctx.keybindings;
		if (kb.matches(event, "selectUp")) {
			this.moveSelection(this.selectedIndex - 1);
			return true;
		}
		if (kb.matches(event, "selectDown")) {
			this.moveSelection(this.selectedIndex + 1);
			return true;
		}
		if (kb.matches(event, "selectPageUp")) {
			this.moveSelection(this.selectedIndex - this.visibleRowsCount());
			return true;
		}
		if (kb.matches(event, "selectPageDown")) {
			this.moveSelection(this.selectedIndex + this.visibleRowsCount());
			return true;
		}
		if (kb.matches(event, "selectConfirm")) {
			const selected = this.filteredItems[this.selectedIndex];
			if (selected !== undefined) {
				this.onSelect?.(selected);
			}
			return true;
		}
		if (kb.matches(event, "selectCancel")) {
			this.onCancel?.();
			return true;
		}
		return false;
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
		let listFlags = SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) listFlags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "list",
			stateFlags: listFlags,
			rect: r,
			label: "Select List",
			value: this.filterQuery,
		});
		const rowsVisible = Math.max(1, Math.floor((r.height - 8) / this.rowHeight));
		const rowW = Math.max(0, r.width - 8);
		if (rowW <= 0) return;
		for (let v = 0; v < rowsVisible; v++) {
			const idx = this.scrollOffsetIndex + v;
			const item = this.filteredItems[idx];
			if (item === undefined) break;
			const ry = r.y + 4 + v * this.rowHeight;
			const rowH = Math.min(this.rowHeight, r.y + r.height - ry);
			if (rowH <= 0) break;
			let rowFlags = SGUI_A11Y_STATE_ENABLED;
			if (idx === this.selectedIndex) rowFlags |= SGUI_A11Y_STATE_SELECTED;
			out.push({
				id: this.ensureRowA11yId(v),
				role: "button",
				stateFlags: rowFlags,
				rect: { x: r.x + 4, y: ry, width: rowW, height: rowH },
				label: item.label.length > 0 ? item.label : item.value,
				value: item.description ?? "",
			});
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
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
		const isSelf = nodeId === this.a11yId;
		const slot = isSelf ? -1 : this.rowA11yIds.indexOf(nodeId);
		if (!isSelf && slot < 0) return false;
		if (action === "focus") {
			if (!isSelf) {
				const idx = this.scrollOffsetIndex + slot;
				if (idx >= 0 && idx < this.filteredItems.length) {
					this.moveSelection(idx);
				}
			}
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "increment") {
			ctx.requestFocus(this);
			this.moveSelection(this.selectedIndex + 1);
			return true;
		}
		if (action === "decrement") {
			ctx.requestFocus(this);
			this.moveSelection(this.selectedIndex - 1);
			return true;
		}
		if (action === "setValue" && isSelf) {
			ctx.requestFocus(this);
			this.setFilter(value);
			return true;
		}
		if (action !== "press") {
			return false;
		}
		if (isSelf) {
			ctx.requestFocus(this);
			const selected = this.filteredItems[this.selectedIndex];
			if (selected !== undefined) {
				this.onSelect?.(selected);
			}
			this.invalidate();
			return true;
		}
		const idx = this.scrollOffsetIndex + slot;
		const item = this.filteredItems[idx];
		if (item === undefined) return false;
		this.moveSelection(idx);
		ctx.requestFocus(this);
		this.onSelect?.(item);
		this.invalidate();
		return true;
	}
}
