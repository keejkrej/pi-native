/**
 * Waku unified 48px window chrome header bar with WindowDragArea, traffic-light clearance,
 * navigation controls, workspace/branch chips, "Open in..." external app popover,
 * Right Panel toggle badge, and top-center floating toast banner.
 */

import { basename } from "node:path";
import {
	Box,
	type Color,
	drawFocusHalo,
	drawVectorIcon,
	type GuiA11yNode,
	type GuiApp,
	GuiComponent,
	type GuiHost,
	type GuiKeyEvent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiTheme,
	HStack,
	IconButton,
	type OverlayHandle,
	pointInRect,
	type Rect,
	type Size,
	Spacer,
	Text,
	TruncatedText,
	VectorIcon,
	type VectorIconName,
	WindowDragArea,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_CURSOR_ARROW,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_REGULAR,
} from "@pi-ts/gui";
import { lookupSessionCustomName } from "./overlays.ts";
import type {
	GuiExternalOpener,
	GuiSessionController,
	GuiSessionSnapshot,
	GuiToastEntry,
} from "./types.ts";
import { annotateSpecNode, registerSpecChildren } from "./ui-spec-meta.ts";

export const TRAFFIC_LIGHT_CLEARANCE = 86;
export const HEADER_BAR_HEIGHT = 48;
export const DEFAULT_TOAST_AUTO_DISMISS_MS = 4500;

/** Interactive rounded pill chip used for clickable branch indicators and toolbar popovers. */
class WakuHeaderChip extends GuiComponent {
	private labelText: string;
	private iconName: VectorIconName | undefined;
	private trailingIconName: VectorIconName | undefined;
	private disabledValue: boolean;
	private accentTone: boolean;
	private pressed = false;
	private onClickFn: (() => void) | undefined;

	constructor(options: {
		label: string;
		leadingIcon?: VectorIconName;
		trailingIcon?: VectorIconName;
		disabled?: boolean;
		accentTone?: boolean;
		onClick?: () => void;
	}) {
		super();
		this.labelText = options.label;
		this.iconName = options.leadingIcon;
		this.trailingIconName = options.trailingIcon;
		this.disabledValue = options.disabled ?? false;
		this.accentTone = options.accentTone ?? false;
		this.onClickFn = options.onClick;
		this.focusable = !this.disabledValue;
		this.cursor = this.disabledValue ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
	}

	getLabel(): string {
		return this.labelText;
	}

	setLabel(label: string): void {
		if (this.labelText === label) return;
		this.labelText = label;
		this.invalidate();
	}

	setDisabled(disabled: boolean): void {
		if (this.disabledValue === disabled) return;
		this.disabledValue = disabled;
		this.focusable = !disabled;
		this.cursor = disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
		this.invalidate();
	}

	private buildStyle(ctx: GuiRenderContext) {
		return { fontFamily: SGUI_FONT_REGULAR, fontSize: ctx.theme.fontSizeSmall, fontWeight: 500 };
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const style = this.buildStyle(ctx);
		const textMetrics = ctx.measureText(style, 0, this.labelText);
		const iconSz = 12;
		const leadW = this.iconName !== undefined ? iconSz + 5 : 0;
		const trailW = this.trailingIconName !== undefined ? iconSz + 4 : 0;
		const naturalW = leadW + textMetrics.width + trailW + 16;
		return {
			width: Math.max(0, Math.min(maxWidth, naturalW)),
			height: Math.max(24, textMetrics.lineHeight + 8),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const t = ctx.theme;
		const hovered = this.isHovered();
		const focused = this.isFocused();
		const radius = 6;

		let bg: Color = t.surfaceElevated;
		let fg: Color = this.accentTone ? t.accent : t.textPrimary;
		let border: Color = t.border;

		if (this.disabledValue) {
			bg = t.surfaceMuted;
			fg = t.textDisabled;
		} else if (this.pressed) {
			bg = t.surfaceActive;
		} else if (hovered) {
			bg = t.surfaceHover;
			border = t.borderStrong;
		}

		if (focused) {
			drawFocusHalo(ctx, r, radius, 0.22, 2);
		}
		ctx.fillRect(r.x, r.y, r.width, r.height, bg, radius);
		ctx.strokeRect(r.x, r.y, r.width, r.height, border, 1, radius);

		let cursorX = r.x + 8;
		const iconSz = 12;
		if (this.iconName !== undefined) {
			drawVectorIcon(ctx, this.iconName, cursorX, r.y + (r.height - iconSz) * 0.5, iconSz, fg);
			cursorX += iconSz + 5;
		}

		const trailW = this.trailingIconName !== undefined ? iconSz + 4 : 0;
		const availTextW = Math.max(12, r.x + r.width - 8 - trailW - cursorX);
		const style = this.buildStyle(ctx);
		const tm = ctx.measureText(style, 0, this.labelText);
		ctx.drawStyledText(cursorX, r.y + (r.height - tm.lineHeight) * 0.5, availTextW, fg, style, this.labelText);

		if (this.trailingIconName !== undefined) {
			drawVectorIcon(
				ctx,
				this.trailingIconName,
				r.x + r.width - 8 - iconSz,
				r.y + (r.height - iconSz) * 0.5,
				iconSz,
				t.textSecondary,
			);
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (this.disabledValue) return { handled: false };
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
				this.onClickFn?.();
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
		if (this.disabledValue) return false;
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onClickFn?.();
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
			label: this.labelText,
			value: "",
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
		if (nodeId !== this.a11yId || this.disabledValue) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onClickFn?.();
			return true;
		}
		return false;
	}
}

/** Concrete clickable row for detected external openers inside the "Open in..." dropdown popover. */
class OpenerMenuRow extends GuiComponent {
	private readonly opener: GuiExternalOpener;
	private readonly onPick: () => void;

	constructor(opener: GuiExternalOpener, onPick: () => void) {
		super();
		this.opener = opener;
		this.onPick = onPick;
		this.focusable = opener.available;
		this.cursor = opener.available ? SGUI_CURSOR_POINTER : SGUI_CURSOR_ARROW;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 32 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		if (this.opener.available && this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 6);
		}
		if (this.isFocused()) {
			drawFocusHalo(ctx, r, 6, 0.2, 2);
		}

		const fg = this.opener.available ? t.textPrimary : t.textDisabled;
		const iconName: VectorIconName =
			this.opener.id === "finder"
				? "folder"
				: this.opener.id === "terminal" || this.opener.id === "iterm" || this.opener.id === "ghostty"
					? "terminal"
					: "laptop";
		drawVectorIcon(ctx, iconName, r.x + 8, r.y + (r.height - 13) * 0.5, 13, this.opener.available ? t.textSecondary : t.textDisabled);

		const style = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeBody, fontWeight: 500 };
		const tm = ctx.measureText(style, 0, this.opener.name);
		ctx.drawStyledText(r.x + 28, r.y + (r.height - tm.lineHeight) * 0.5, Math.max(16, r.width - 96), fg, style, this.opener.name);

		const badge = this.opener.available ? "Open" : "Not installed";
		const bStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 400 };
		const bm = ctx.measureText(bStyle, 0, badge);
		ctx.drawStyledText(
			r.x + r.width - bm.width - 8,
			r.y + (r.height - bm.lineHeight) * 0.5,
			bm.width + 2,
			this.opener.available ? t.accent : t.textMuted,
			bStyle,
			badge,
		);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (!this.opener.available) return { handled: false };
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.onPick();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (!this.opener.available) return false;
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onPick();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = this.opener.available ? SGUI_A11Y_STATE_ENABLED : 0;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.opener.name,
			value: this.opener.available ? "available" : "unavailable",
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
		if (nodeId !== this.a11yId || !this.opener.available) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onPick();
			return true;
		}
		return false;
	}
}

export interface WakuHeaderBarCallbacks {
	readonly onToggleSidebar?: () => void;
	readonly onNewSession?: () => void;
	readonly onGoBack?: () => void;
	readonly onGoForward?: () => void;
	readonly onOpenGitBranch?: () => void;
	readonly onToggleRightPanel?: () => void;
}

export interface WakuHeaderBarHandle {
	readonly root: GuiComponent;
	update(snapshot: GuiSessionSnapshot): void;
	applyTheme(theme: GuiTheme): void;
	dispose(): void;
}

/**
 * Create Waku's unified 48px window header chrome wrapped in WindowDragArea.
 */
export function createWakuHeaderBar(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: WakuHeaderBarCallbacks = {},
): WakuHeaderBarHandle {
	let currentTheme = app.getTheme();
	let latestSnapshot = controller.getSnapshot();

	const sidebarToggleBtn = annotateSpecNode(
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
			key: "workspace.main.header.sidebar_toggle",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Toggle Sidebar", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/panel-left.svg", alt: "Toggle Sidebar", w: 14, h: 14 },
		},
	);

	const backBtn = annotateSpecNode(
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
			key: "workspace.main.header.nav_back",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Previous Session", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/arrow-left.svg", alt: "Previous Session", w: 14, h: 14 },
		},
	);

	const forwardBtn = annotateSpecNode(
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
			key: "workspace.main.header.nav_forward",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Next Session", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/arrow-right.svg", alt: "Next Session", w: 14, h: 14 },
		},
	);

	const sessionTitleText = new TruncatedText({
		text: "New task",
		fontSize: currentTheme.fontSizeBody,
		fontWeight: 500,
		color: currentTheme.textPrimary,
	});
	annotateSpecNode(sessionTitleText, {
		key: "workspace.main.header.title",
		role: "heading",
		flow: { type: "inline" },
		size: { w: "hug", h: "hug" },
		text: () => ({
			value: sessionTitleText.getText(),
			wrap: "nowrap",
			lines: 1,
			overflow: "ellipsis",
		}),
	});

	const rightPanelToggleBtn = annotateSpecNode(
		new IconButton({
			icon: "panel-right",
			size: 26,
			iconSize: 14,
			label: "Toggle Right Panel",
			active: latestSnapshot.layout.rightPanelOpen,
			onClick: () => {
				if (callbacks.onToggleRightPanel) {
					callbacks.onToggleRightPanel();
				} else {
					const cur = controller.getSnapshot().layout.rightPanelOpen;
					controller.updateLayoutPreferences({ rightPanelOpen: !cur });
				}
			},
		}),
		{
			key: "workspace.main.header.right_panel_toggle",
			role: "button",
			size: { w: 26, h: 26 },
			variant: "icon-button",
			text: { value: "Toggle Right Panel", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			asset: { kind: "icon", ref: "icons/panel-right.svg", alt: "Toggle Right Panel", w: 14, h: 14 },
		},
	);

	const navCluster = new HStack({
		gap: 2,
		align: "center",
		children: [backBtn, forwardBtn],
	});

	const collapsedControlsCluster = new HStack({
		gap: 6,
		align: "center",
		children: [sidebarToggleBtn, navCluster],
	});

	const leftGroup = new HStack({
		gap: 8,
		align: "center",
		children: [collapsedControlsCluster, { child: sessionTitleText, shrink: 1 }],
	});

	const row = new HStack({
		gap: 8,
		align: "center",
		justify: "space-between",
		children: [{ child: leftGroup, grow: 1, shrink: 1 }, rightPanelToggleBtn],
	});

	const dragArea = new WindowDragArea({
		height: HEADER_BAR_HEIGHT,
		child: row,
	});

	const rootBox = annotateSpecNode(
		new Box({
			height: HEADER_BAR_HEIGHT,
			fillWidth: true,
			padding: { horizontal: 14 },
			background: currentTheme.background,
			child: dragArea,
		}),
		{
			key: "workspace.main.header",
			role: "region",
			flowComponent: row,
			size: { w: "fill", h: HEADER_BAR_HEIGHT },
			variant: "borderless-header",
		},
	);

	const resolveSessionTitle = (snapshot: GuiSessionSnapshot): string => {
		const activeId = snapshot.status.sessionId;
		if (activeId !== undefined) {
			const custom = lookupSessionCustomName(snapshot.layout.sessionCustomNames, activeId);
			if (custom !== undefined && custom.trim().length > 0) return custom.trim();
		}
		if (snapshot.status.sessionName && snapshot.status.sessionName.trim().length > 0) {
			const trimmed = snapshot.status.sessionName.trim();
			if (trimmed !== "New Session") return trimmed;
		}
		if (activeId !== undefined) {
			for (let i = 0; i < snapshot.sessions.length; i++) {
				const item = snapshot.sessions[i];
				if (item !== undefined && item.id === activeId && item.title.trim().length > 0) {
					const trimmed = item.title.trim();
					if (trimmed !== "New Session") return trimmed;
				}
			}
		}
		return "New task";
	};

	const syncFromSnapshot = (snapshot: GuiSessionSnapshot): void => {
		latestSnapshot = snapshot;
		const collapsed = snapshot.layout.sidebarCollapsed;
		const metricsInset = app.getWindowMetrics().insetLeft;
		const clearance = metricsInset > 0 ? Math.max(TRAFFIC_LIGHT_CLEARANCE, metricsInset) : TRAFFIC_LIGHT_CLEARANCE;
		rootBox.setPadding({ top: 0, bottom: 0, right: 14, left: collapsed ? clearance : 14 });
		collapsedControlsCluster.visible = collapsed;
		sidebarToggleBtn.visible = collapsed;
		backBtn.visible = collapsed;
		forwardBtn.visible = collapsed;

		const canBack = snapshot.status.canGoBack ?? controller.canGoBack();
		const canForward = snapshot.status.canGoForward ?? controller.canGoForward();
		backBtn.setDisabled(!canBack);
		forwardBtn.setDisabled(!canForward);

		sessionTitleText.setText(resolveSessionTitle(snapshot));
		rightPanelToggleBtn.visible = !snapshot.layout.rightPanelOpen;
		rightPanelToggleBtn.setActive(snapshot.layout.rightPanelOpen);
	};

	syncFromSnapshot(latestSnapshot);

	return {
		root: rootBox,
		update: syncFromSnapshot,
		applyTheme: (theme: GuiTheme) => {
			currentTheme = theme;
			rootBox.setBackground(theme.background);
			sessionTitleText.setColor(theme.textPrimary);
		},
		dispose: () => {},
	};
}

function toastStatusStyle(level: GuiToastEntry["level"], theme: GuiTheme): { readonly icon: VectorIconName; readonly color: Color } {
	switch (level) {
		case "error":
			return { icon: "alert", color: theme.danger };
		case "warning":
			return { icon: "alert", color: theme.warning };
		default:
			return { icon: "check", color: theme.success };
	}
}

/** Clickable pill surface wrapping floating toast notification content. */
class WakuToastPill extends GuiComponent {
	private toast: GuiToastEntry;
	private currentTheme: GuiTheme;
	private readonly statusIcon: VectorIcon;
	private readonly closeBtn: IconButton;
	private readonly cardBox: Box;
	private readonly row: HStack;
	private readonly msgText: Text;
	private readonly onDismiss: (id: string) => void;

	constructor(theme: GuiTheme, toast: GuiToastEntry, onDismiss: (id: string) => void) {
		super();
		this.toast = toast;
		this.currentTheme = theme;
		this.onDismiss = onDismiss;
		this.cursor = SGUI_CURSOR_POINTER;
		const st = toastStatusStyle(toast.level, theme);
		this.statusIcon = new VectorIcon({
			name: st.icon,
			size: 14,
			color: st.color,
		});
		this.closeBtn = annotateSpecNode(
			new IconButton({
				icon: "close",
				size: 26,
				iconSize: 12,
				label: "Dismiss notification",
				onClick: () => this.onDismiss(this.toast.id),
			}),
			{
				key: "workspace.toast.dismiss",
				role: "button",
				size: { w: 26, h: 26 },
				variant: "icon-button",
				text: { value: "Dismiss notification", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
				asset: { kind: "icon", ref: "icons/x.svg", alt: "Dismiss notification", w: 12, h: 12 },
			},
		);
		this.msgText = new Text({
			text: toast.message,
			fontSize: theme.fontSizeBody,
			fontWeight: 500,
			color: theme.textPrimary,
			wrap: true,
		});
		this.row = new HStack({
			gap: 8,
			align: "center",
			children: [
				this.statusIcon,
				{ child: this.msgText, grow: 1, shrink: 1 },
				this.closeBtn,
			],
		});
		this.cardBox = annotateSpecNode(
			new Box({
				width: 560,
				maxWidth: 560,
				background: theme.surfaceElevated,
				borderColor: theme.borderStrong,
				borderWidth: 1,
				radius: 10,
				padding: { top: 7, right: 10, bottom: 7, left: 10 },
				child: this.row,
			}),
			{
				key: "workspace.toast",
				role: "status",
				flowComponent: this.row,
				size: { w: "hug", h: "hug" },
				variant: "toast-card",
				text: null,
			},
		);
		this.cardBox.setParent(this);
		registerSpecChildren(this, () => [this.cardBox]);
	}

	getCardBox(): Box {
		return this.cardBox;
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.cardBox.attachHost(host);
	}

	setToast(toast: GuiToastEntry): void {
		this.toast = toast;
		this.msgText.setText(toast.message);
		const st = toastStatusStyle(toast.level, this.currentTheme);
		this.statusIcon.setName(st.icon);
		this.statusIcon.setColor(st.color);
		this.invalidate();
	}

	override onThemeChange(theme: GuiTheme): void {
		this.currentTheme = theme;
		this.cardBox.setBackground(theme.surfaceElevated);
		this.cardBox.setBorder(theme.borderStrong, 1, 10);
		this.msgText.setColor(theme.textPrimary);
		const st = toastStatusStyle(this.toast.level, theme);
		this.statusIcon.setName(st.icon);
		this.statusIcon.setColor(st.color);
		this.cardBox.onThemeChange(theme);
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		return this.cardBox.measure(ctx, Math.min(maxWidth, 560), maxHeight);
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		this.cardBox.layout(ctx, rect);
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		return this.cardBox.hitTest(x, y) ?? this;
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.cardBox.render(ctx);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.onDismiss(this.toast.id);
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.cardBox.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		out.push({
			id: this.a11yId,
			role: "group",
			label: this.toast.message,
			value: this.toast.level,
			rect: this.layoutRect,
			stateFlags: SGUI_A11Y_STATE_ENABLED,
		});
		this.cardBox.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (!this.visible) return undefined;
		if (this.a11yId === nodeId) return this;
		return this.cardBox.findComponentByA11yId(nodeId);
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		return this.cardBox.handleAccessibilityAction(nodeId, action, value, ctx);
	}
}

export interface WakuToastBannerOptions {
	readonly autoDismissMs?: number;
}

export interface WakuToastBannerHandle {
	readonly root: GuiComponent;
	update(snapshotOrToasts: GuiSessionSnapshot | readonly GuiToastEntry[]): void;
	applyTheme(theme: GuiTheme): void;
	hasActiveToast(): boolean;
	getActiveOverlayComponent(): Box | undefined;
	dispose(): void;
}

/**
 * Create Waku's top-center floating rounded pill toast banner controller.
 * Automatically mounts a non-modal top-center overlay when active toasts exist and
 * auto-dismisses or click-dismisses cleanly via `controller.dismissToast(...)`.
 */
export function createWakuToastBanner(
	app: GuiApp,
	controller: GuiSessionController,
	options: WakuToastBannerOptions = {},
): WakuToastBannerHandle {
	const placeholder = new Spacer(0, 0);
	placeholder.visible = false;

	const autoDismissMs = options.autoDismissMs ?? DEFAULT_TOAST_AUTO_DISMISS_MS;
	let activeToastId: string | undefined;
	let toastPill: WakuToastPill | undefined;
	let overlayHandle: OverlayHandle | undefined;
	let dismissTimer: ReturnType<typeof setTimeout> | undefined;

	const clearTimer = (): void => {
		if (dismissTimer !== undefined) {
			clearTimeout(dismissTimer);
			dismissTimer = undefined;
		}
	};

	const dismissId = (id: string): void => {
		clearTimer();
		controller.dismissToast(id);
	};

	const hideToast = (): void => {
		clearTimer();
		activeToastId = undefined;
		toastPill = undefined;
		if (overlayHandle !== undefined) {
			const h = overlayHandle;
			overlayHandle = undefined;
			h.hide();
		}
	};

	const computeMainOffsetX = (): number => {
		const metrics = app.getWindowMetrics();
		const layout = controller.getSnapshot().layout;
		const leftW = layout.sidebarCollapsed ? 0 : layout.sidebarWidth || 252;
		const rightW = layout.rightPanelOpen ? layout.rightPanelWidth || 460 : 0;
		const mainCenter = leftW + Math.max(0, metrics.width - leftW - rightW) * 0.5;
		return Math.round(mainCenter - metrics.width * 0.5);
	};

	const showToast = (toast: GuiToastEntry): void => {
		clearTimer();
		activeToastId = toast.id;
		if (toastPill !== undefined && overlayHandle !== undefined) {
			toastPill.setToast(toast);
		} else {
			toastPill = new WakuToastPill(app.getTheme(), toast, dismissId);
			overlayHandle = app.showOverlay(toastPill, {
				anchor: "top-center",
				margin: 0,
				offsetX: computeMainOffsetX(),
				offsetY: 56,
				maxWidth: 560,
				modal: false,
				radius: 10,
				border: false,
				shadow: "md",
				dismissOnBackdropClick: false,
				dismissOnEscape: false,
			});
		}

		if (autoDismissMs > 0) {
			const delay = toast.level === "error" && options.autoDismissMs === undefined ? autoDismissMs * 2 : autoDismissMs;
			dismissTimer = setTimeout(() => {
				if (activeToastId === toast.id) {
					controller.dismissToast(toast.id);
				}
			}, delay);
		}
	};

	const update = (snapshotOrToasts: GuiSessionSnapshot | readonly GuiToastEntry[]): void => {
		const toasts = Array.isArray(snapshotOrToasts)
			? snapshotOrToasts
			: "toasts" in snapshotOrToasts
				? snapshotOrToasts.toasts
				: [];
		const latest = toasts.length > 0 ? toasts[toasts.length - 1] : undefined;
		if (latest === undefined) {
			hideToast();
			return;
		}
		if (latest.id !== activeToastId || overlayHandle === undefined) {
			showToast(latest);
		} else {
			toastPill?.setToast(latest);
		}
	};

	update(controller.getSnapshot());

	return {
		root: placeholder,
		update,
		applyTheme: (theme: GuiTheme) => {
			toastPill?.onThemeChange(theme);
			toastPill?.invalidate();
		},
		hasActiveToast: () => activeToastId !== undefined && overlayHandle !== undefined,
		getActiveOverlayComponent: () => toastPill?.getCardBox(),
		dispose: () => {
			hideToast();
		},
	};
}
