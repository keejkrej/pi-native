/**
 * Waku resizable left sidebar with native macOS vibrancy fallback, traffic-light top toolbar,
 * Updated/Project grouping, collapsible date/project/pinned sections, 51px session cards with
 * inline rename & hover actions, empty state, Appearance switcher, and Settings button.
 */

import { basename } from "node:path";
import {
	Box,
	Button,
	type Color,
	Divider,
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
	HStack,
	IconButton,
	Input,
	parseColor,
	pointInRect,
	type Rect,
	rgbaColor,
	ScrollView,
	SegmentedControl,
	type Size,
	Spacer,
	SplitResizeHandle,
	Text,
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
	resolveAppearanceTheme,
} from "./overlays.ts";
import { TRAFFIC_LIGHT_CLEARANCE } from "./window-chrome.ts";
import type { GuiLayoutPreferences, GuiSessionController, GuiSessionListItem, GuiSessionSnapshot } from "./types.ts";

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_CARD_HEIGHT = 51;
export const SIDEBAR_CARD_RADIUS = 8;

const SELECTED_CARD_DARK = parseColor("#2D2D2E");
const SELECTED_CARD_LIGHT = parseColor("#E4E3E5");
const STREAMING_DOT_CORAL = parseColor("#E2795B");

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
			const selectedBg = t.dark ? SELECTED_CARD_DARK : SELECTED_CARD_LIGHT;
			ctx.fillRect(r.x, r.y, r.width, r.height, selectedBg, SIDEBAR_CARD_RADIUS);
		} else if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, SIDEBAR_CARD_RADIUS);
		}

		if (this.isFocused()) {
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
			const rightReserved = showActions ? this.actionButtons.length * 20 + 10 : timeW + 14;
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
			} else {
				ctx.drawStyledText(
					r.x + r.width - 10 - timeW,
					topRowY + 1,
					timeW + 2,
					t.textMuted,
					timeStyle,
					timeLabel,
				);
			}
		}

		// Bottom subtitle row: workspace + message count (+ pin icon when pinned & not showing action icons)
		const subY = r.y + 29;
		const subStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 400 };
		const wsName = this.item.workspaceName || basename(this.item.cwd) || this.item.cwd;
		const metaText = `${wsName} · ${this.item.messageCount}m`;
		const pinSpace = this.isPinned && !showActions ? 18 : 0;
		ctx.drawStyledText(
			r.x + 10,
			subY,
			Math.max(20, r.width - 20 - pinSpace),
			t.textSecondary,
			subStyle,
			metaText,
		);

		if (this.isPinned && !showActions) {
			drawVectorIcon(ctx, "pin", r.x + r.width - 20, subY + 1, 11, t.accent);
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
		const childSize = this.content.measure(ctx, Math.max(0, w - 1), maxHeight);
		return { width: w, height: maxHeight ?? childSize.height };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const contentW = Math.max(0, rect.width - 1);
		this.content.layout(ctx, { x: rect.x, y: rect.y, width: contentW, height: rect.height });
		const handleSize = this.resizeHandle.measure(ctx, 8, rect.height);
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

		const bg = this.vibrancy ? rgbaColor(0, 0, 0, 0) : ctx.theme.sidebarBg;
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
	readonly onOpenSettings?: () => void;
	readonly onToggleTheme?: () => void;
	readonly onResize?: (width: number) => void;
	readonly onResizeEnd?: (width: number) => void;
}

export interface WakuSidebarHandle {
	readonly root: GuiComponent;
	getWidth(): number;
	setWidth(width: number): void;
	setVibrancyEnabled(enabled: boolean): void;
	update(snapshot: GuiSessionSnapshot): void;
	applyTheme(theme: GuiTheme): void;
	dispose(): void;
}

/**
 * Create Waku's left session sidebar with native vibrancy support, traffic-light clearance,
 * Updated/Project grouping, collapsible sections, 51px session cards, empty state,
 * Appearance toggle, and Settings button.
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

	const searchToggleBtn = new IconButton({
		icon: "search",
		size: 26,
		iconSize: 13,
		label: "Search Sessions",
		onClick: () => {
			searchOpen = !searchOpen;
			searchBox.visible = searchOpen;
			searchToggleBtn.setActive(searchOpen);
			if (!searchOpen && searchQuery.length > 0) {
				searchQuery = "";
				searchInput.setValue("");
			}
			rebuildSessionList();
			if (searchOpen) {
				app.setFocus(searchInput);
			}
		},
	});

	const newSessionBtn = new IconButton({
		icon: "compose",
		size: 26,
		iconSize: 14,
		label: "New Session",
		onClick: () => {
			if (callbacks.onNewSession) {
				callbacks.onNewSession();
			} else {
				void controller.newSession();
			}
		},
	});

	const toggleSidebarBtn = new IconButton({
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
	});

	const topRow = new WindowDragArea({
		height: 48,
		child: new HStack({
			gap: 4,
			align: "center",
			padding: { horizontal: 10 },
			children: [
				new Spacer(TRAFFIC_LIGHT_CLEARANCE, 1),
				{ child: new Spacer(), grow: 1 },
				searchToggleBtn,
				newSessionBtn,
				toggleSidebarBtn,
			],
		}),
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
		padding: { horizontal: 10, bottom: 6 },
		fillWidth: true,
		child: searchInput,
	});
	searchBox.visible = false;

	const groupSegmented = new SegmentedControl({
		label: "Group Sessions",
		items: [
			{ id: "updated", label: "Updated" },
			{ id: "project", label: "Project" },
		],
		selectedId: latestSnapshot.layout.sidebarGroupBy,
		onChange: (id) => {
			if (id === "updated" || id === "project") {
				const nextLayout = controller.updateLayoutPreferences({ sidebarGroupBy: id });
				latestSnapshot = { ...controller.getSnapshot(), layout: nextLayout };
				rebuildSessionList();
			}
		},
	});

	const groupBar = new Box({
		padding: { horizontal: 10, bottom: 8 },
		fillWidth: true,
		child: groupSegmented,
	});

	const listStack = new VStack({ gap: 2, padding: { horizontal: 8, bottom: 10 } });
	const scrollArea = new ScrollView({ child: listStack });

	const appearanceSeg = new SegmentedControl({
		label: "Appearance",
		items: [
			{ id: "system", label: "System" },
			{ id: "dark", label: "Dark" },
			{ id: "light", label: "Light" },
		],
		selectedId: latestSnapshot.layout.appearance,
		onChange: (id) => {
			if (id === "system" || id === "dark" || id === "light") {
				const nextLayout = controller.updateLayoutPreferences({ appearance: id });
				latestSnapshot = { ...controller.getSnapshot(), layout: nextLayout };
				app.setTheme(resolveAppearanceTheme(id, app));
			}
		},
	});

	const toggleThemeBtn = new IconButton({
		icon: currentTheme.dark ? "sun" : "moon",
		size: 26,
		iconSize: 13,
		label: "Toggle Theme",
		onClick: () => {
			if (callbacks.onToggleTheme) {
				callbacks.onToggleTheme();
			} else {
				const next: GuiLayoutPreferences["appearance"] = app.getTheme().dark ? "light" : "dark";
				controller.updateLayoutPreferences({ appearance: next });
				app.setTheme(resolveAppearanceTheme(next, app));
			}
		},
	});

	const settingsBtn = new Button({
		label: "Settings",
		variant: "ghost",
		leadingIcon: "sliders",
		fontSize: 12,
		padding: { vertical: 4, horizontal: 8 },
		onClick: () => {
			if (callbacks.onOpenSettings) {
				callbacks.onOpenSettings();
			} else {
				openSettingsModal(app, controller);
			}
		},
	});

	const footerShortcutHint = new Text({
		text: "⌘,",
		fontSize: currentTheme.fontSizeSmall,
		color: currentTheme.textMuted,
	});

	const footerDivider = new Divider({ direction: "horizontal" });
	const footer = new VStack({
		gap: 8,
		padding: { horizontal: 10, vertical: 10 },
		children: [
			appearanceSeg,
			new HStack({
				gap: 6,
				align: "center",
				children: [
					toggleThemeBtn,
					{ child: new Spacer(), grow: 1 },
					settingsBtn,
					footerShortcutHint,
				],
			}),
		],
	});

	const paneLayout = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			topRow,
			searchBox,
			groupBar,
			{ child: scrollArea, grow: 1, shrink: 1 },
			footerDivider,
			footer,
		],
	});

	let frameContainer: SidebarPaneContainer | undefined;
	const resizeHandle = new SplitResizeHandle({
		width: 6,
		minWidth: SIDEBAR_MIN_WIDTH,
		maxWidth: SIDEBAR_MAX_WIDTH,
		initialWidth: clampSidebarWidth(latestSnapshot.layout.sidebarWidth),
		direction: 1,
		dividerColor: currentTheme.sidebarBorder,
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
			if (q.length === 0) {
				matching.push(s);
			} else {
				const text = `${resolveTitle(s, snapshot)} ${s.workspaceName} ${s.cwd}`;
				if (fuzzyMatch(q, text).matches) {
					matching.push(s);
				}
			}
		}

		if (matching.length === 0) {
			listStack.addChild(
				new Box({
					padding: { vertical: 24, horizontal: 10 },
					child: new VStack({
						gap: 8,
						align: "center",
						children: [
							new Text({
								text: q.length > 0 ? "No matching sessions" : "No sessions yet",
								color: theme.textSecondary,
								fontWeight: 500,
								align: "center",
							}),
							new Text({
								text: q.length > 0 ? "Try another search query." : "Start a conversation to save your session history.",
								color: theme.textMuted,
								fontSize: theme.fontSizeSmall,
								align: "center",
							}),
							new Button({
								label: "Start New Session",
								variant: "secondary",
								leadingIcon: "compose",
								fontSize: 12,
								onClick: () => {
									if (callbacks.onNewSession) callbacks.onNewSession();
									else void controller.newSession();
								},
							}),
						],
					}),
				}),
			);
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

		const renderSection = (sectionKey: string, title: string, items: readonly GuiSessionListItem[]): void => {
			if (items.length === 0) return;
			const isCollapsed = collapsedSections.has(sectionKey);
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
			if (isCollapsed) return;
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (item === undefined) continue;
				listStack.addChild(buildSessionCard(item, snapshot, pinnedSet));
			}
		};

		pinnedItems.sort((a, b) => b.updatedAt - a.updatedAt);
		regularItems.sort((a, b) => b.updatedAt - a.updatedAt);

		renderSection("pinned", "Pinned", pinnedItems);

		if (snapshot.layout.sidebarGroupBy === "project") {
			const projectOrder: string[] = [];
			const byProject = new Map<string, GuiSessionListItem[]>();
			for (let i = 0; i < regularItems.length; i++) {
				const item = regularItems[i];
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
			for (let i = 0; i < projectOrder.length; i++) {
				const name = projectOrder[i];
				if (name === undefined) continue;
				renderSection(`project:${name}`, name, byProject.get(name) ?? []);
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
			renderSection("date:Today", "Today", todayItems);
			renderSection("date:Yesterday", "Yesterday", yesterdayItems);
			renderSection("date:This Week", "This Week", weekItems);
			renderSection("date:Older", "Older", olderItems);
		}
	};

	const update = (snapshot: GuiSessionSnapshot): void => {
		latestSnapshot = snapshot;
		const collapsed = snapshot.layout.sidebarCollapsed;
		if (frameContainer !== undefined) {
			frameContainer.visible = !collapsed;
			frameContainer.setWidth(snapshot.layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH);
		}
		groupSegmented.setSelectedId(snapshot.layout.sidebarGroupBy);
		appearanceSeg.setSelectedId(snapshot.layout.appearance);
		rebuildSessionList();
	};

	update(latestSnapshot);

	return {
		root: frameContainer,
		getWidth: () => frameContainer.getWidth(),
		setWidth: (width: number) => frameContainer.setWidth(width),
		setVibrancyEnabled: (enabled: boolean) => {
			vibrancyActive = enabled;
			frameContainer.setVibrancy(enabled);
		},
		update,
		applyTheme: (theme: GuiTheme) => {
			currentTheme = theme;
			toggleThemeBtn.setIcon(theme.dark ? "sun" : "moon");
			footerShortcutHint.setColor(theme.textMuted);
			footerDivider.setColor(theme.sidebarBorder);
			frameContainer.onThemeChange(theme);
			rebuildSessionList();
		},
		dispose: () => {
			collapsedSections.clear();
		},
	};
}
