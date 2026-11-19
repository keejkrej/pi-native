/**
 * Waku resizable left sidebar with native macOS vibrancy fallback, traffic-light top toolbar,
 * Updated/Project grouping, collapsible date/project/pinned sections, 51px session cards with
 * inline rename & hover actions, empty state, Appearance switcher, and Settings button.
 */

import { basename } from "node:path";
import {
	Box,
	type Color,
	drawFocusHalo,
	drawVectorIcon,
	fuzzyMatch,
	type GuiA11yNode,
	type GuiApp,
	GuiComponent,
	type GuiHost,
	type GuiKeyEvent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	type GuiTheme,
	HeadlessBackend,
	HStack,
	IconButton,
	Input,
	pointInRect,
	type Rect,
	rgbaColor,
	ScrollView,
	type Size,
	Spacer,
	SplitResizeHandle,
	Text,
	type VectorIconName,
	VStack,
	WindowDragArea,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_REGULAR,
} from "@pi-ts/gui";
import {
	formatRelativeTimeShort,
	lookupSessionCustomName,
	openSettingsModal,
	openSidebarOptionsPopover,
} from "./overlays.ts";
import { TRAFFIC_LIGHT_CLEARANCE } from "./window-chrome.ts";
import type { GuiSessionController, GuiSessionListItem, GuiSessionSnapshot } from "./types.ts";
import { annotateSpecNode, registerSpecChildren } from "./ui-spec-meta.ts";

export const SIDEBAR_DEFAULT_WIDTH = 252;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_CARD_HEIGHT = 51;
export const SIDEBAR_CARD_RADIUS = 8;

const STREAMING_DOT_CORAL = rgbaColor(226, 121, 91, 1);

function isBlankUntitledSession(item: GuiSessionListItem): boolean {
	const t = item.title.trim();
	return item.messageCount === 0 && (t.length === 0 || t === "New Session" || t === "New task");
}

/** Sidebar 32px action row (New Task / Search). */
class SidebarActionRow extends GuiComponent {
	private readonly iconName: VectorIconName;
	private labelText: string;
	private activeValue = false;
	private pressed = false;
	private readonly onClickFn: () => void;

	constructor(icon: VectorIconName, label: string, onClick: () => void) {
		super();
		this.iconName = icon;
		this.labelText = label;
		this.onClickFn = onClick;
		this.focusable = true;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	setActive(active: boolean): void {
		if (this.activeValue === active) return;
		this.activeValue = active;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 32 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		if (this.activeValue || this.pressed) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.sidebarItemBg, 6);
		} else if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 6);
		}
		if (this.isFocusVisible()) {
			drawFocusHalo(ctx, r, 6, 0.2, 2);
		}
		const fg = this.activeValue || this.isHovered() ? t.textPrimary : t.textSecondary;
		drawVectorIcon(ctx, this.iconName, r.x + 6, r.y + 9, 14, fg);
		const style = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeBody, fontWeight: 400 };
		const tm = ctx.measureText(style, 0, this.labelText);
		ctx.drawStyledText(
			r.x + 30,
			r.y + Math.max(0, (r.height - tm.lineHeight) * 0.5),
			Math.max(12, r.width - 36),
			fg,
			style,
			this.labelText,
		);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			this.pressed = true;
			this.invalidate();
			return { handled: true, capture: this, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left") {
			const hit = this.pressed && pointInRect(event.x, event.y, this.layoutRect);
			this.pressed = false;
			this.invalidate();
			if (hit) this.onClickFn();
			return { handled: true, releaseCapture: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onClickFn();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		if (this.activeValue) flags |= SGUI_A11Y_STATE_SELECTED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.labelText,
			rect: this.layoutRect,
			stateFlags: flags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onClickFn();
			return true;
		}
		return false;
	}
}

/** Inline rename input inside a session card supporting Enter commit and Escape cancel. */
class InlineRenameInput extends Input {
	private readonly onCancelFn: () => void;

	constructor(initialValue: string, onCommit: (val: string) => void, onCancel: () => void) {
		super({
			value: initialValue,
			placeholder: "Session title...",
			padding: { vertical: 3, horizontal: 6 },
			radius: 5,
			onSubmit: onCommit,
		});
		this.onCancelFn = onCancel;
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "cancel")) {
			this.onCancelFn();
			return true;
		}
		return super.handleKey(event, ctx);
	}
}

/** Collapsible group header row (Pinned, Today, Yesterday, This Week, Older, or Project name). */
class SidebarSectionHeader extends GuiComponent {
	private readonly title: string;
	private readonly count: number;
	private readonly collapsed: boolean;
	private readonly onToggle: () => void;

	constructor(title: string, count: number, collapsed: boolean, onToggle: () => void) {
		super();
		this.title = title;
		this.count = count;
		this.collapsed = collapsed;
		this.onToggle = onToggle;
		this.cursor = SGUI_CURSOR_POINTER;
		this.focusable = true;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 26 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		if (this.isHovered()) {
			ctx.fillRect(r.x + 2, r.y + 1, Math.max(0, r.width - 4), r.height - 2, t.hover, 5);
		}
		const chevron = this.collapsed ? "chevron-right" : "chevron-down";
		drawVectorIcon(ctx, chevron, r.x + 8, r.y + (r.height - 11) * 0.5, 11, t.textMuted);

		const style = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 600 };
		const tm = ctx.measureText(style, 0, this.title);
		const textY = r.y + (r.height - tm.lineHeight) * 0.5;
		const countText = `${this.count}`;
		const cm = ctx.measureText(style, 0, countText);
		ctx.drawStyledText(r.x + 24, textY, Math.max(10, r.width - 42 - cm.width), t.textSecondary, style, this.title);
		ctx.drawStyledText(r.x + r.width - 10 - cm.width, textY, cm.width + 2, t.textMuted, style, countText);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.onToggle();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onToggle();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: `${this.title} (${this.count})`,
			value: this.collapsed ? "collapsed" : "expanded",
			rect: this.layoutRect,
			stateFlags: flags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onToggle();
			return true;
		}
		return false;
	}
}

interface SessionCardCallbacks {
	readonly onSelect: () => void;
	readonly onStartRename: () => void;
	readonly onCommitRename: (nextTitle: string) => void;
	readonly onCancelRename: () => void;
	readonly onTogglePin: () => void;
	readonly onFork: () => void;
	readonly onDelete: () => void;
}

/**
 * 51px Waku session card with 8px radius, active selection tone, streaming dot (#E2795B),
 * inline double-click / button rename Input, and hover actions (Pin / Rename / Fork / Delete).
 */
class SidebarSessionCard extends GuiComponent {
	private readonly item: GuiSessionListItem;
	private readonly displayTitle: string;
	private readonly isSelected: boolean;
	private readonly isPinned: boolean;
	private readonly isStreaming: boolean;
	private readonly isRenaming: boolean;
	private readonly callbacks: SessionCardCallbacks;
	private readonly actionButtons: IconButton[];
	private readonly renameInput: InlineRenameInput | undefined;
	private actionsHovered = false;

	constructor(params: {
		item: GuiSessionListItem;
		displayTitle: string;
		isSelected: boolean;
		isPinned: boolean;
		isStreaming: boolean;
		isRenaming: boolean;
		callbacks: SessionCardCallbacks;
	}) {
		super();
		this.item = params.item;
		this.displayTitle = params.displayTitle;
		this.isSelected = params.isSelected;
		this.isPinned = params.isPinned;
		this.isStreaming = params.isStreaming;
		this.isRenaming = params.isRenaming;
		this.callbacks = params.callbacks;
		this.cursor = SGUI_CURSOR_POINTER;
		this.focusable = !params.isRenaming;

		const pinBtn = new IconButton({
			icon: "pin",
			size: 18,
			iconSize: 11,
			active: params.isPinned,
			label: params.isPinned ? `Unpin ${params.displayTitle}` : `Pin ${params.displayTitle}`,
			onClick: () => params.callbacks.onTogglePin(),
		});
		const editBtn = new IconButton({
			icon: "edit",
			size: 18,
			iconSize: 11,
			label: `Rename ${params.displayTitle}`,
			onClick: () => params.callbacks.onStartRename(),
		});
		const forkBtn = new IconButton({
			icon: "fork",
			size: 18,
			iconSize: 11,
			label: `Fork ${params.displayTitle}`,
			onClick: () => params.callbacks.onFork(),
		});
		const delBtn = new IconButton({
			icon: "trash",
			size: 18,
			iconSize: 11,
			label: `Delete ${params.displayTitle}`,
			onClick: () => params.callbacks.onDelete(),
		});

		this.actionButtons = [pinBtn, editBtn, forkBtn, delBtn];
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined) btn.setParent(this);
		}

		if (params.isRenaming) {
			this.renameInput = new InlineRenameInput(
				params.displayTitle,
				(next) => params.callbacks.onCommitRename(next),
				() => params.callbacks.onCancelRename(),
			);
			this.renameInput.setParent(this);
		}
	}

	getRenameInput(): Input | undefined {
		return this.renameInput;
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined) btn.attachHost(host);
		}
		this.renameInput?.attachHost(host);
	}

	private shouldShowActions(): boolean {
		if (this.isRenaming) return false;
		if (this.isHovered() || this.actionsHovered) return true;
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined && (btn.isHovered() || btn.isFocused())) {
				return true;
			}
		}
		return false;
	}

	override onHoverChange(hovered: boolean): void {
		this.actionsHovered = hovered;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: SIDEBAR_CARD_HEIGHT };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		if (this.renameInput !== undefined) {
			const inputH = Math.min(26, Math.max(22, rect.height - 24));
			this.renameInput.layout(ctx, {
				x: rect.x + 8,
				y: rect.y + 4,
				width: Math.max(24, rect.width - 16),
				height: inputH,
			});
		}

		let rightX = rect.x + rect.width - 6;
		for (let i = this.actionButtons.length - 1; i >= 0; i--) {
			const btn = this.actionButtons[i];
			if (btn === undefined) continue;
			const size = btn.measure(ctx, 20, 20);
			rightX -= size.width;
			btn.layout(ctx, {
				x: rightX,
				y: rect.y + 6,
				width: size.width,
				height: size.height,
			});
			rightX -= 2;
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		if (this.renameInput !== undefined) {
			const hitInput = this.renameInput.hitTest(x, y);
			if (hitInput !== undefined) return hitInput;
		}
		if (this.shouldShowActions()) {
			for (let i = this.actionButtons.length - 1; i >= 0; i--) {
				const btn = this.actionButtons[i];
				if (btn === undefined) continue;
				const hitBtn = btn.hitTest(x, y);
				if (hitBtn !== undefined) return hitBtn;
			}
		}
		return this;
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const t = ctx.theme;
		const showActions = this.shouldShowActions();
		if (this.isSelected) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.sidebarItemBg, SIDEBAR_CARD_RADIUS);
		} else if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, SIDEBAR_CARD_RADIUS);
		}

		if (this.isFocusVisible()) {
			drawFocusHalo(ctx, r, SIDEBAR_CARD_RADIUS, 0.2, 2);
		}

		let titleX = r.x + 10;
		const topRowY = r.y + 8;

		if (this.isSelected && this.isStreaming) {
			const dotSize = 7;
			ctx.fillRect(titleX, topRowY + 4, dotSize, dotSize, STREAMING_DOT_CORAL, dotSize * 0.5);
			titleX += dotSize + 7;
		}

		const timeLabel = formatRelativeTimeShort(this.item.updatedAt);
		const timeStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 400 };
		const timeW = ctx.measureText(timeStyle, 0, timeLabel).width;

		if (this.renameInput !== undefined) {
			this.renameInput.render(ctx);
		} else {
			const rightReserved = showActions ? this.actionButtons.length * 20 + 10 : 10;
			const availTitleW = Math.max(20, r.x + r.width - rightReserved - titleX);
			const titleStyle = {
				fontFamily: SGUI_FONT_REGULAR,
				fontSize: t.fontSizeBody,
				fontWeight: this.isSelected ? 600 : 500,
			};
			ctx.drawStyledText(
				titleX,
				topRowY,
				availTitleW,
				this.isSelected ? t.textBright : t.textPrimary,
				titleStyle,
				this.displayTitle,
			);

			if (showActions) {
				for (let i = 0; i < this.actionButtons.length; i++) {
					this.actionButtons[i]?.render(ctx);
				}
			}
		}

		// Bottom subtitle row: [folder] <project> on left + relative age (and pin) on right
		const subY = r.y + 29;
		const subStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 400 };
		const wsName = this.item.workspaceName || basename(this.item.cwd) || this.item.cwd;
		const folderIconSize = 12;
		const folderIconX = r.x + 10;
		const projectTextX = folderIconX + folderIconSize + 5;
		const pinSpace = this.isPinned && !showActions ? 16 : 0;
		const rightEdgeW = timeW + 10 + pinSpace;
		const availWsW = Math.max(20, r.x + r.width - rightEdgeW - 8 - projectTextX);

		drawVectorIcon(ctx, "folder", folderIconX, subY + 1, folderIconSize, t.textMuted);
		ctx.drawStyledText(
			projectTextX,
			subY,
			availWsW,
			t.textSecondary,
			subStyle,
			wsName,
		);
		ctx.drawStyledText(
			r.x + r.width - 10 - timeW,
			subY,
			timeW + 2,
			t.textMuted,
			timeStyle,
			timeLabel,
		);

		if (this.isPinned && !showActions) {
			drawVectorIcon(ctx, "pin", r.x + r.width - 10 - timeW - 15, subY + 1, 11, t.accent);
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			if (event.clickCount >= 2) {
				this.callbacks.onStartRename();
				return { handled: true, cursor: SGUI_CURSOR_POINTER };
			}
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.callbacks.onSelect();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.callbacks.onSelect();
			return true;
		}
		return false;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		if (this.renameInput !== undefined) {
			out.push(this.renameInput);
			return;
		}
		out.push(this);
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined) btn.collectFocusables(out);
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.isSelected) flags |= SGUI_A11Y_STATE_SELECTED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.displayTitle,
			value: this.isSelected ? "selected" : "",
			rect: this.layoutRect,
			stateFlags: flags,
		});
		if (this.renameInput !== undefined) {
			this.renameInput.collectAccessibilityNodes(out, ctx);
		} else {
			for (let i = 0; i < this.actionButtons.length; i++) {
				this.actionButtons[i]?.collectAccessibilityNodes(out, ctx);
			}
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (!this.visible) return undefined;
		if (this.a11yId === nodeId) return this;
		if (this.renameInput !== undefined) {
			const foundInput = this.renameInput.findComponentByA11yId(nodeId);
			if (foundInput !== undefined) return foundInput;
		}
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn === undefined) continue;
			const found = btn.findComponentByA11yId(nodeId);
			if (found !== undefined) return found;
		}
		return undefined;
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId === this.a11yId) {
			if (action === "focus") {
				ctx.requestFocus(this);
				return true;
			}
			if (action === "press") {
				this.callbacks.onSelect();
				return true;
			}
			return false;
		}
		if (this.renameInput !== undefined && this.renameInput.handleAccessibilityAction(nodeId, action, value, ctx)) {
			return true;
		}
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined && btn.handleAccessibilityAction(nodeId, action, value, ctx)) {
				return true;
			}
		}
		return false;
	}
}

/** Outer resizable container managing fixed/drag width, vibrancy transparency, and 1px hairline border. */
class SidebarPaneContainer extends GuiComponent {
	private readonly content: GuiComponent;
	private readonly resizeHandle: SplitResizeHandle;
	private widthValue: number;
	private vibrancy: boolean;

	constructor(content: GuiComponent, resizeHandle: SplitResizeHandle, initialWidth: number, vibrancy: boolean) {
		super();
		this.content = content;
		this.resizeHandle = resizeHandle;
		this.widthValue = clampSidebarWidth(initialWidth);
		this.vibrancy = vibrancy;
		this.content.setParent(this);
		this.resizeHandle.setParent(this);
		registerSpecChildren(this, () => [this.content]);
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.content.attachHost(host);
		this.resizeHandle.attachHost(host);
	}

	getWidth(): number {
		return this.widthValue;
	}

	setWidth(width: number): void {
		const clamped = clampSidebarWidth(width);
		if (this.widthValue === clamped) return;
		this.widthValue = clamped;
		this.resizeHandle.setCurrentWidth(clamped);
		this.invalidate();
	}

	setVibrancy(enabled: boolean): void {
		if (this.vibrancy === enabled) return;
		this.vibrancy = enabled;
		this.invalidate();
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const w = Math.min(maxWidth, this.widthValue);
		const childSize = this.content.measure(ctx, w, maxHeight);
		return { width: w, height: maxHeight ?? childSize.height };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		this.content.layout(ctx, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
		const handleSize = this.resizeHandle.measure(ctx, 6, rect.height);
		const hw = Math.max(4, handleSize.width);
		this.resizeHandle.layout(ctx, {
			x: rect.x + rect.width - hw,
			y: rect.y,
			width: hw,
			height: rect.height,
		});
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		const hitHandle = this.resizeHandle.hitTest(x, y);
		if (hitHandle !== undefined) return hitHandle;
		return this.content.hitTest(x, y) ?? this;
	}

	override handleScroll(event: GuiScrollEvent, ctx: GuiRenderContext): boolean {
		return this.content.handleScroll(event, ctx);
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const headless = ctx.backend instanceof HeadlessBackend;
		const bg = this.vibrancy && !headless ? rgbaColor(0, 0, 0, 0) : ctx.theme.sidebarBg;
		ctx.fillRect(r.x, r.y, r.width, r.height, bg);

		this.content.render(ctx);
		this.resizeHandle.render(ctx);
	}

	override onThemeChange(theme: GuiTheme): void {
		this.content.onThemeChange(theme);
		this.resizeHandle.onThemeChange(theme);
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.content.collectFocusables(out);
		this.resizeHandle.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		this.content.collectAccessibilityNodes(out, ctx);
		this.resizeHandle.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (!this.visible) return undefined;
		return this.content.findComponentByA11yId(nodeId) ?? this.resizeHandle.findComponentByA11yId(nodeId);
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		return (
			this.content.handleAccessibilityAction(nodeId, action, value, ctx) ||
			this.resizeHandle.handleAccessibilityAction(nodeId, action, value, ctx)
		);
	}
}

function clampSidebarWidth(width: number): number {
	return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)));
}

function dateBucketForTimestamp(updatedAt: number, nowMs: number): "Today" | "Yesterday" | "This Week" | "Older" {
	const d = new Date(nowMs);
	const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const oneDay = 86_400_000;
	if (updatedAt >= startOfToday) return "Today";
	if (updatedAt >= startOfToday - oneDay) return "Yesterday";
	if (updatedAt >= startOfToday - 6 * oneDay) return "This Week";
	return "Older";
}

export interface WakuSidebarCallbacks {
	readonly vibrancyEnabled?: boolean;
	readonly onNewSession?: () => void;
	readonly onToggleSidebar?: () => void;
	readonly onGoBack?: () => void;
	readonly onGoForward?: () => void;
	readonly onOpenSettings?: () => void;
	readonly onOpenSidebarOptions?: (anchorRect: Rect) => void;
	readonly onToggleTheme?: () => void;
	readonly onResize?: (width: number) => void;
	readonly onResizeEnd?: (width: number) => void;
}

export interface WakuSidebarHandle {
	readonly root: GuiComponent;
	getWidth(): number;
	setWidth(width: number): void;
	setVibrancyEnabled(enabled: boolean): void;
	getSurfaceStyle(): {
		readonly background: Color;
		readonly borderWidth: number;
		readonly borderColor: Color;
		readonly width: number;
	};
	getOptionsButtonRect(): Rect;
	update(snapshot: GuiSessionSnapshot): void;
	applyTheme(theme: GuiTheme): void;
	dispose(): void;
}

/**
 * Create Waku's left session sidebar matching v0.1.20 layout:
 * 48px traffic-light header (Toggle Sidebar / Previous / Next), New Task & Search rows,
 * group header with Sidebar options button, 51px session cards, and borderless 40px Settings footer.
 */
export function createWakuSidebar(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: WakuSidebarCallbacks = {},
): WakuSidebarHandle {
	let currentTheme = app.getTheme();
	let latestSnapshot = controller.getSnapshot();
	let vibrancyActive = callbacks.vibrancyEnabled ?? app.getWindowMetrics().insetLeft > 0;
	const collapsedSections = new Set<string>();
	let searchOpen = false;
	let searchQuery = "";
	let renamingSessionId: string | undefined;

	const toggleSidebarBtn = annotateSpecNode(
		new IconButton({
			icon: "panel-left",
			size: 26,
			iconSize: 14,
			label: "Toggle Sidebar",
			onClick: () => {
				if (callbacks.onToggleSidebar) {
					callbacks.onToggleSidebar();
				} else {
					const cur = controller.getSnapshot().layout.sidebarCollapsed;
					controller.updateLayoutPreferences({ sidebarCollapsed: !cur });
				}
			},
		}),
		{
			key: "workspace.sidebar.toggle",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Toggle Sidebar", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/panel-left.svg", alt: "Toggle Sidebar", w: 14, h: 14 },
		},
	);

	const navBackBtn = annotateSpecNode(
		new IconButton({
			icon: "arrow-left",
			size: 26,
			iconSize: 14,
			label: "Previous Session",
			disabled: !controller.canGoBack(),
			onClick: () => {
				if (callbacks.onGoBack) {
					callbacks.onGoBack();
				} else {
					void controller.goBack();
				}
			},
		}),
		{
			key: "workspace.sidebar.nav_back",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Previous Session", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/arrow-left.svg", alt: "Previous Session", w: 14, h: 14 },
		},
	);

	const navForwardBtn = annotateSpecNode(
		new IconButton({
			icon: "arrow-right",
			size: 26,
			iconSize: 14,
			label: "Next Session",
			disabled: !controller.canGoForward(),
			onClick: () => {
				if (callbacks.onGoForward) {
					callbacks.onGoForward();
				} else {
					void controller.goForward();
				}
			},
		}),
		{
			key: "workspace.sidebar.nav_forward",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Next Session", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/arrow-right.svg", alt: "Next Session", w: 14, h: 14 },
		},
	);

	const navCluster = new HStack({
		gap: 2,
		align: "center",
		children: [navBackBtn, navForwardBtn],
	});

	const headerRow = new HStack({
		gap: 6,
		align: "center",
		children: [toggleSidebarBtn, navCluster],
	});

	const topRow = annotateSpecNode(
		new WindowDragArea({
			height: 48,
			child: new Box({
				height: 48,
				fillWidth: true,
				padding: { left: TRAFFIC_LIGHT_CLEARANCE },
				child: headerRow,
			}),
		}),
		{
			key: "workspace.sidebar.header",
			role: "region",
			flowComponent: headerRow,
			padding: [0, 0, 0, TRAFFIC_LIGHT_CLEARANCE],
			size: { w: "fill", h: 48 },
		},
	);

	const newTaskBtn = annotateSpecNode(
		new SidebarActionRow("compose", "New Task", () => {
			if (callbacks.onNewSession) {
				callbacks.onNewSession();
			} else {
				void controller.newSession();
			}
		}),
		{
			key: "workspace.sidebar.new_task",
			role: "button",
			flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 10 },
			padding: [0, 4, 0, 4],
			margin: [0, 10, 0, 10],
			size: { w: "fill", h: 32 },
			variant: "sidebar-action",
			text: { value: "New Task", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/compose.svg", alt: "New Task", w: 14, h: 14 },
		},
	);

	const newTaskWrap = new Box({
		padding: { horizontal: 10 },
		fillWidth: true,
		child: newTaskBtn,
	});

	const searchInput = new Input({
		placeholder: "Filter sessions...",
		padding: { vertical: 6, horizontal: 8 },
		radius: 6,
		onChange: (val) => {
			searchQuery = val;
			rebuildSessionList();
		},
	});
	const searchBox = new Box({
		padding: { left: 10, right: 10, bottom: 8 },
		fillWidth: true,
		child: searchInput,
	});
	searchBox.visible = false;

	const searchBtn = annotateSpecNode(
		new SidebarActionRow("search", "Search", () => {
			searchOpen = !searchOpen;
			searchBox.visible = searchOpen;
			searchBtn.setActive(searchOpen);
			if (!searchOpen && searchQuery.length > 0) {
				searchQuery = "";
				searchInput.setValue("");
			}
			rebuildSessionList();
			if (searchOpen) {
				app.setFocus(searchInput);
			}
		}),
		{
			key: "workspace.sidebar.search",
			role: "button",
			flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 10 },
			padding: [0, 4, 0, 4],
			margin: [0, 10, 10, 10],
			size: { w: "fill", h: 32 },
			variant: "sidebar-action",
			text: { value: "Search", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/search.svg", alt: "Search", w: 14, h: 14 },
		},
	);

	const searchWrap = new Box({
		padding: { left: 10, right: 10, bottom: 10 },
		fillWidth: true,
		child: searchBtn,
	});

	const groupHeaderTitle = new Text({
		text: "Today",
		fontSize: currentTheme.fontSizeSmall,
		fontWeight: 500,
		color: currentTheme.textSecondary,
		wrap: false,
	});

	const sidebarOptionsBtn = annotateSpecNode(
		new IconButton({
			icon: "list-filter",
			size: 20,
			iconSize: 13,
			label: "Sidebar options",
			onClick: () => {
				if (callbacks.onOpenSidebarOptions) {
					callbacks.onOpenSidebarOptions(sidebarOptionsBtn.layoutRect);
				} else {
					openSidebarOptionsPopover(app, controller, { anchorRect: sidebarOptionsBtn.layoutRect });
				}
			},
		}),
		{
			key: "workspace.sidebar.options",
			role: "button",
			size: { w: 20, h: 20 },
			variant: "icon-button",
			text: { value: "Sidebar options", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/list-filter.svg", alt: "Sidebar options", w: 14, h: 14 },
		},
	);

	const groupHeaderRow = new HStack({
		gap: 4,
		align: "center",
		justify: "space-between",
		children: [
			groupHeaderTitle,
			new HStack({
				gap: 0,
				align: "center",
				children: [sidebarOptionsBtn, new Spacer(14, 1)],
			}),
		],
	});

	const groupHeaderBox = annotateSpecNode(
		new Box({
			height: 28,
			fillWidth: true,
			padding: { horizontal: 8 },
			child: groupHeaderRow,
		}),
		{
			key: "workspace.sidebar.group_header",
			role: "region",
			flowComponent: groupHeaderRow,
			margin: [0, 10, 2, 10],
			size: { w: "fill", h: 28 },
			variant: "sidebar-group-header",
			text: () => ({ value: groupHeaderTitle.getText(), wrap: "nowrap", lines: 1, overflow: "ellipsis" }),
		},
	);

	const groupHeaderWrap = new Box({
		padding: { left: 10, right: 10, bottom: 2 },
		fillWidth: true,
		child: groupHeaderBox,
	});

	const listStack = new VStack({ gap: 1, padding: { horizontal: 10, bottom: 8 } });
	const scrollArea = new ScrollView({ child: listStack });

	const settingsBtn = annotateSpecNode(
		new IconButton({
			icon: "settings",
			size: 26,
			iconSize: 14,
			label: "Open Settings",
			onClick: () => {
				if (callbacks.onOpenSettings) {
					callbacks.onOpenSettings();
				} else {
					openSettingsModal(app, controller);
				}
			},
		}),
		{
			key: "workspace.sidebar.settings",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Open Settings", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/settings.svg", alt: "Open Settings", w: 14, h: 14 },
		},
	);

	const footerRow = new HStack({
		gap: 0,
		align: "center",
		justify: "start",
		children: [settingsBtn],
	});

	const footerBox = annotateSpecNode(
		new Box({
			height: 40,
			fillWidth: true,
			padding: { horizontal: 10 },
			child: footerRow,
		}),
		{
			key: "workspace.sidebar.footer",
			role: "region",
			flowComponent: footerRow,
			size: { w: "fill", h: 40 },
			variant: "borderless-footer",
		},
	);

	const paneLayout = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			topRow,
			newTaskWrap,
			searchWrap,
			searchBox,
			groupHeaderWrap,
			{ child: scrollArea, grow: 1, shrink: 1 },
			footerBox,
		],
	});

	let frameContainer: SidebarPaneContainer | undefined;
	const resizeHandle = new SplitResizeHandle({
		width: 6,
		minWidth: SIDEBAR_MIN_WIDTH,
		maxWidth: SIDEBAR_MAX_WIDTH,
		initialWidth: clampSidebarWidth(latestSnapshot.layout.sidebarWidth),
		direction: 1,
		dividerColor: rgbaColor(0, 0, 0, 0),
		hoverColor: currentTheme.accent,
		activeColor: currentTheme.accent,
		a11yLabel: "Resize sidebar",
		onResize: (nextWidth) => {
			frameContainer?.setWidth(nextWidth);
			callbacks.onResize?.(nextWidth);
		},
		onResizeEnd: (finalWidth) => {
			const clamped = clampSidebarWidth(finalWidth);
			frameContainer?.setWidth(clamped);
			controller.updateLayoutPreferences({ sidebarWidth: clamped });
			callbacks.onResizeEnd?.(clamped);
		},
	});

	frameContainer = new SidebarPaneContainer(
		paneLayout,
		resizeHandle,
		latestSnapshot.layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
		vibrancyActive,
	);

	const applySidebarSpecAnnotation = (theme: GuiTheme): void => {
		if (frameContainer === undefined) return;
		annotateSpecNode(frameContainer, {
			key: "workspace.sidebar",
			role: "navigation",
			flowComponent: paneLayout,
			padding: [0, 0, 0, 0],
			margin: [0, 0, 0, 0],
			border: [0, 0, 0, 0],
			size: { w: clampSidebarWidth(frameContainer.getWidth()), h: "fill" },
			variant: theme.dark ? "sidebar-dark" : "sidebar-light",
		});
	};
	applySidebarSpecAnnotation(currentTheme);

	const resolveTitle = (item: GuiSessionListItem, snapshot: GuiSessionSnapshot): string => {
		const custom = lookupSessionCustomName(snapshot.layout.sessionCustomNames, item.id);
		if (custom !== undefined) return custom;
		if (item.title.trim().length > 0) return item.title.trim();
		return "New Session";
	};

	const buildSessionCard = (
		item: GuiSessionListItem,
		snapshot: GuiSessionSnapshot,
		pinnedSet: Set<string>,
	): SidebarSessionCard => {
		const activeId = snapshot.status.sessionId;
		const isSelected = item.isActive === true || (activeId !== undefined && item.id === activeId);
		const isPinned = item.pinned === true || pinnedSet.has(item.id);
		const title = resolveTitle(item, snapshot);
		const isRenaming = renamingSessionId === item.id;

		return new SidebarSessionCard({
			item,
			displayTitle: title,
			isSelected,
			isPinned,
			isStreaming: snapshot.status.isStreaming,
			isRenaming,
			callbacks: {
				onSelect: () => {
					void controller.switchSession(item.sessionFile);
				},
				onStartRename: () => {
					renamingSessionId = item.id;
					rebuildSessionList();
					const input = findRenameInput(listStack);
					if (input !== undefined) {
						app.setFocus(input);
					}
				},
				onCommitRename: (nextTitle) => {
					renamingSessionId = undefined;
					const trimmed = nextTitle.trim();
					if (trimmed.length > 0) {
						void controller.renameSession(item.id, trimmed);
					}
					rebuildSessionList();
				},
				onCancelRename: () => {
					renamingSessionId = undefined;
					rebuildSessionList();
				},
				onTogglePin: () => {
					void controller.togglePinSession(item.id);
				},
				onFork: () => {
					void controller.switchSession(item.sessionFile).then(() => controller.forkSession());
				},
				onDelete: () => {
					void controller.deleteSession(item.sessionFile);
				},
			},
		});
	};

	function findRenameInput(stack: VStack): Input | undefined {
		const children = stack.getChildren();
		for (let i = 0; i < children.length; i++) {
			const c = children[i];
			if (c instanceof SidebarSessionCard) {
				const inp = c.getRenameInput();
				if (inp !== undefined) return inp;
			}
		}
		return undefined;
	}

	const rebuildSessionList = (): void => {
		const snapshot = latestSnapshot;
		const theme = currentTheme;
		listStack.clear();

		const pinnedSet = new Set<string>(snapshot.layout.pinnedSessionIds);
		const q = searchQuery.trim();
		const matching: GuiSessionListItem[] = [];
		for (let i = 0; i < snapshot.sessions.length; i++) {
			const s = snapshot.sessions[i];
			if (s === undefined) continue;
			if (isBlankUntitledSession(s)) continue;
			if (q.length === 0) {
				matching.push(s);
			} else {
				const text = `${resolveTitle(s, snapshot)} ${s.workspaceName} ${s.cwd}`;
				if (fuzzyMatch(q, text).matches) {
					matching.push(s);
				}
			}
		}

		const oldestFirst = snapshot.layout.sidebarOrderBy === "oldest";
		const compareItems = (a: GuiSessionListItem, b: GuiSessionListItem): number =>
			oldestFirst ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt;

		if (matching.length === 0) {
			groupHeaderTitle.setText(snapshot.layout.sidebarGroupBy === "project" ? "Workspace" : "Today");
			return;
		}

		const pinnedItems: GuiSessionListItem[] = [];
		const regularItems: GuiSessionListItem[] = [];
		for (let i = 0; i < matching.length; i++) {
			const s = matching[i];
			if (s === undefined) continue;
			if (s.pinned === true || pinnedSet.has(s.id)) {
				pinnedItems.push(s);
			} else {
				regularItems.push(s);
			}
		}

		let annotatedFirstCard = false;
		const addCard = (item: GuiSessionListItem, projectIndented: boolean): void => {
			const card = buildSessionCard(item, snapshot, pinnedSet);
			const activeId = snapshot.status.sessionId;
			const isSelected = item.isActive === true || (activeId !== undefined && item.id === activeId);
			const target: GuiComponent = projectIndented
				? new Box({ padding: { left: 18 }, fillWidth: true, child: card })
				: card;
			if (!annotatedFirstCard) {
				annotatedFirstCard = true;
				annotateSpecNode(card, {
					key: "workspace.sidebar.session.0",
					role: "button",
					flow: { type: "flex", dir: "column", justify: "center", align: "stretch", wrap: "nowrap", gap: 4 },
					padding: [7, 8, 7, 8],
					margin: [0, 10, 1, 10],
					size: { w: "fill", h: SIDEBAR_CARD_HEIGHT },
					state: () => (isSelected ? "active" : "default"),
					text: null,
					skipChildren: true,
				});
			}
			listStack.addChild(target);
		};

		const renderSection = (
			sectionKey: string,
			title: string,
			items: readonly GuiSessionListItem[],
			omitHeaderIfPrimary: boolean,
			projectIndented: boolean,
		): void => {
			if (items.length === 0) return;
			const isCollapsed = collapsedSections.has(sectionKey);
			if (!omitHeaderIfPrimary) {
				listStack.addChild(
					new SidebarSectionHeader(title, items.length, isCollapsed, () => {
						if (collapsedSections.has(sectionKey)) {
							collapsedSections.delete(sectionKey);
						} else {
							collapsedSections.add(sectionKey);
						}
						rebuildSessionList();
					}),
				);
			}
			if (isCollapsed) return;
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (item === undefined) continue;
				addCard(item, projectIndented);
			}
		};

		pinnedItems.sort(compareItems);
		regularItems.sort(compareItems);

		if (snapshot.layout.sidebarGroupBy === "project") {
			const projectOrder: string[] = [];
			const byProject = new Map<string, GuiSessionListItem[]>();
			for (let i = 0; i < matching.length; i++) {
				const item = matching[i];
				if (item === undefined) continue;
				const projectName = item.workspaceName || basename(item.cwd) || item.cwd || "Workspace";
				let group = byProject.get(projectName);
				if (group === undefined) {
					group = [];
					byProject.set(projectName, group);
					projectOrder.push(projectName);
				}
				group.push(item);
			}
			groupHeaderTitle.setText(projectOrder[0] ?? "Workspace");
			for (let i = 0; i < projectOrder.length; i++) {
				const name = projectOrder[i];
				if (name === undefined) continue;
				const items = byProject.get(name) ?? [];
				items.sort(compareItems);
				renderSection(`project:${name}`, name, items, i === 0, true);
			}
		} else {
			const nowMs = Date.now();
			const todayItems: GuiSessionListItem[] = [];
			const yesterdayItems: GuiSessionListItem[] = [];
			const weekItems: GuiSessionListItem[] = [];
			const olderItems: GuiSessionListItem[] = [];
			for (let i = 0; i < regularItems.length; i++) {
				const item = regularItems[i];
				if (item === undefined) continue;
				switch (dateBucketForTimestamp(item.updatedAt, nowMs)) {
					case "Today":
						todayItems.push(item);
						break;
					case "Yesterday":
						yesterdayItems.push(item);
						break;
					case "This Week":
						weekItems.push(item);
						break;
					case "Older":
						olderItems.push(item);
						break;
				}
			}
			const primaryLabel =
				pinnedItems.length > 0
					? "Pinned"
					: todayItems.length > 0
						? "Today"
						: yesterdayItems.length > 0
							? "Yesterday"
							: weekItems.length > 0
								? "This Week"
								: "Older";
			groupHeaderTitle.setText(primaryLabel);
			renderSection("pinned", "Pinned", pinnedItems, primaryLabel === "Pinned", false);
			renderSection("date:Today", "Today", todayItems, primaryLabel === "Today", false);
			renderSection("date:Yesterday", "Yesterday", yesterdayItems, primaryLabel === "Yesterday", false);
			renderSection("date:This Week", "This Week", weekItems, primaryLabel === "This Week", false);
			renderSection("date:Older", "Older", olderItems, primaryLabel === "Older", false);
		}
	};

	const update = (snapshot: GuiSessionSnapshot): void => {
		latestSnapshot = snapshot;
		const collapsed = snapshot.layout.sidebarCollapsed;
		if (frameContainer !== undefined) {
			frameContainer.visible = !collapsed;
			frameContainer.setWidth(snapshot.layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH);
			applySidebarSpecAnnotation(currentTheme);
		}
		navBackBtn.setDisabled(!(snapshot.status.canGoBack ?? controller.canGoBack()));
		navForwardBtn.setDisabled(!(snapshot.status.canGoForward ?? controller.canGoForward()));
		rebuildSessionList();
	};

	update(latestSnapshot);

	return {
		root: frameContainer,
		getWidth: () => frameContainer.getWidth(),
		setWidth: (width: number) => {
			frameContainer.setWidth(width);
			applySidebarSpecAnnotation(currentTheme);
		},
		setVibrancyEnabled: (enabled: boolean) => {
			vibrancyActive = enabled;
			frameContainer.setVibrancy(enabled);
		},
		getSurfaceStyle: () => ({
			background: currentTheme.sidebarBg,
			borderWidth: 0,
			borderColor: rgbaColor(0, 0, 0, 0),
			width: frameContainer.getWidth(),
		}),
		getOptionsButtonRect: () => sidebarOptionsBtn.layoutRect,
		update,
		applyTheme: (theme: GuiTheme) => {
			currentTheme = theme;
			groupHeaderTitle.setColor(theme.textSecondary);
			applySidebarSpecAnnotation(theme);
			frameContainer.onThemeChange(theme);
			rebuildSessionList();
		},
		dispose: () => {
			collapsedSections.clear();
		},
	};
}
