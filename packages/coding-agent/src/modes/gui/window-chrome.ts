/**
 * Waku unified 48px window chrome header bar with WindowDragArea, traffic-light clearance,
 * navigation controls, workspace/branch chips, "Open in..." external app popover,
 * Right Panel toggle badge, and top-center floating toast banner.
 */

import { basename } from "node:path";
import {
	Badge,
	Box,
	type Color,
	Divider,
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
	ScrollView,
	type Size,
	Spacer,
	Text,
	TruncatedText,
	type VectorIconName,
	VStack,
	WindowDragArea,
	withAlpha,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_CURSOR_ARROW,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_REGULAR,
} from "@pi-ts/gui";
import { lookupSessionCustomName, openGitBranchModal } from "./overlays.ts";
import type {
	GuiExternalOpener,
	GuiSessionController,
	GuiSessionSnapshot,
	GuiToastEntry,
} from "./types.ts";

export const TRAFFIC_LIGHT_CLEARANCE = 76;
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
	let openersPopover: OverlayHandle | undefined;

	const trafficLightSpacer = new Spacer(TRAFFIC_LIGHT_CLEARANCE, 1);

	const sidebarToggleBtn = new IconButton({
		icon: "panel-left",
		size: 28,
		iconSize: 15,
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

	const newSessionBtn = new IconButton({
		icon: "compose",
		size: 28,
		iconSize: 15,
		label: "New Session",
		onClick: () => {
			if (callbacks.onNewSession) {
				callbacks.onNewSession();
			} else {
				void controller.newSession();
			}
		},
	});

	const backBtn = new IconButton({
		icon: "arrow-left",
		size: 28,
		iconSize: 14,
		label: "Back",
		disabled: !controller.canGoBack(),
		onClick: () => {
			if (callbacks.onGoBack) {
				callbacks.onGoBack();
			} else {
				void controller.goBack();
			}
		},
	});

	const forwardBtn = new IconButton({
		icon: "arrow-right",
		size: 28,
		iconSize: 14,
		label: "Forward",
		disabled: !controller.canGoForward(),
		onClick: () => {
			if (callbacks.onGoForward) {
				callbacks.onGoForward();
			} else {
				void controller.goForward();
			}
		},
	});

	const sessionTitleText = new TruncatedText({
		text: "New Session",
		fontSize: currentTheme.fontSizeBody,
		fontWeight: 600,
		color: currentTheme.textBright,
	});

	const workspacePill = new Badge({
		label: basename(latestSnapshot.status.cwd) || latestSnapshot.status.cwd,
		leadingIcon: "folder",
		variant: "neutral",
		fontSize: currentTheme.fontSizeSmall,
	});

	const branchChip = new WakuHeaderChip({
		label: latestSnapshot.gitBranch || "No branch",
		leadingIcon: "git-branch",
		disabled: !latestSnapshot.isGitRepo && latestSnapshot.gitBranch.length === 0,
		onClick: () => {
			if (callbacks.onOpenGitBranch) {
				callbacks.onOpenGitBranch();
			} else {
				openGitBranchModal(app, controller);
			}
		},
	});

	const openExternalPopover = (): void => {
		if (openersPopover !== undefined) {
			openersPopover.hide();
			openersPopover = undefined;
			return;
		}
		const theme = app.getTheme();
		const openers =
			latestSnapshot.openers.length > 0 ? latestSnapshot.openers : controller.getExternalOpeners();
		const list = new VStack({ gap: 3 });

		if (openers.length === 0) {
			list.addChild(
				new Box({
					padding: { vertical: 10, horizontal: 8 },
					child: new Text({ text: "No external openers detected", color: theme.textMuted, fontSize: theme.fontSizeSmall }),
				}),
			);
		} else {
			for (let i = 0; i < openers.length; i++) {
				const opener = openers[i];
				if (opener === undefined) continue;
				list.addChild(
					new OpenerMenuRow(opener, () => {
						openersPopover?.hide();
						openersPopover = undefined;
						void controller.openInExternalApp(opener.id);
					}),
				);
			}
		}

		const card = new Box({
			background: theme.surfaceElevated,
			borderColor: theme.borderStrong,
			borderWidth: 1,
			radius: 10,
			shadow: "lg",
			padding: 8,
			width: 240,
			child: new VStack({
				gap: 6,
				children: [
					new Text({
						text: "Open Workspace In...",
						fontSize: theme.fontSizeSmall,
						fontWeight: 600,
						color: theme.textMuted,
						padding: { horizontal: 6, vertical: 2 },
					}),
					new Box({ maxHeight: 280, fillWidth: true, child: new ScrollView({ child: list }) }),
				],
			}),
		});

		openersPopover = app.showOverlay(card, {
			anchorRect: openInButton.layoutRect,
			width: 240,
			maxWidth: 260,
			maxHeight: 340,
			modal: true,
			radius: 10,
			shadow: "lg",
			dismissOnBackdropClick: true,
			dismissOnEscape: true,
			backdropColor: withAlpha(theme.background, 0.05),
			onDismiss: () => {
				openersPopover = undefined;
			},
		});
	};

	const openInButton = new WakuHeaderChip({
		label: "Open in...",
		leadingIcon: "external-link",
		trailingIcon: "chevron-down",
		onClick: openExternalPopover,
	});

	const changedCountBadge = new Badge({
		label: "0",
		variant: "accent",
		fontSize: 10,
		padding: { vertical: 2, horizontal: 6 },
	});
	changedCountBadge.visible = false;

	const rightPanelToggleBtn = new IconButton({
		icon: "panel-right",
		size: 28,
		iconSize: 15,
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
	});

	const row = new HStack({
		gap: 8,
		align: "center",
		padding: { horizontal: 12, vertical: 8 },
		children: [
			trafficLightSpacer,
			sidebarToggleBtn,
			newSessionBtn,
			backBtn,
			forwardBtn,
			{ child: new Spacer(), grow: 1 },
			sessionTitleText,
			workspacePill,
			branchChip,
			{ child: new Spacer(), grow: 1 },
			openInButton,
			changedCountBadge,
			rightPanelToggleBtn,
		],
	});

	const dragArea = new WindowDragArea({
		height: HEADER_BAR_HEIGHT - 1,
		child: row,
	});

	const bottomDivider = new Divider({ direction: "horizontal" });
	const headerContainer = new VStack({
		gap: 0,
		align: "stretch",
		children: [dragArea, bottomDivider],
	});

	const rootBox = new Box({
		height: HEADER_BAR_HEIGHT,
		fillWidth: true,
		background: currentTheme.background,
		child: headerContainer,
	});

	const resolveSessionTitle = (snapshot: GuiSessionSnapshot): string => {
		const activeId = snapshot.status.sessionId;
		if (activeId !== undefined) {
			const custom = lookupSessionCustomName(snapshot.layout.sessionCustomNames, activeId);
			if (custom !== undefined) return custom;
		}
		if (snapshot.status.sessionName && snapshot.status.sessionName.trim().length > 0) {
			return snapshot.status.sessionName.trim();
		}
		if (activeId !== undefined) {
			for (let i = 0; i < snapshot.sessions.length; i++) {
				const item = snapshot.sessions[i];
				if (item !== undefined && item.id === activeId && item.title.trim().length > 0) {
					return item.title.trim();
				}
			}
		}
		return "New Session";
	};

	const syncFromSnapshot = (snapshot: GuiSessionSnapshot): void => {
		latestSnapshot = snapshot;
		const collapsed = snapshot.layout.sidebarCollapsed;
		const metricsInset = app.getWindowMetrics().insetLeft;
		const clearance = metricsInset > 0 ? Math.max(TRAFFIC_LIGHT_CLEARANCE, metricsInset) : TRAFFIC_LIGHT_CLEARANCE;
		trafficLightSpacer.setSize(clearance, 1);
		trafficLightSpacer.visible = collapsed;
		sidebarToggleBtn.visible = collapsed;
		newSessionBtn.visible = collapsed;

		const canBack = snapshot.status.canGoBack ?? controller.canGoBack();
		const canForward = snapshot.status.canGoForward ?? controller.canGoForward();
		backBtn.setDisabled(!canBack);
		forwardBtn.setDisabled(!canForward);

		sessionTitleText.setText(resolveSessionTitle(snapshot));
		workspacePill.setLabel(basename(snapshot.status.cwd) || snapshot.status.cwd || "workspace");

		const hasBranch = snapshot.gitBranch.length > 0 || snapshot.isGitRepo;
		branchChip.visible = hasBranch;
		branchChip.setLabel(snapshot.gitBranch || "detached");
		branchChip.setDisabled(!hasBranch);

		const changedCount = snapshot.changedFiles.length;
		changedCountBadge.visible = changedCount > 0;
		changedCountBadge.setLabel(`${changedCount}`);
		rightPanelToggleBtn.setActive(snapshot.layout.rightPanelOpen);
	};

	syncFromSnapshot(latestSnapshot);

	return {
		root: rootBox,
		update: syncFromSnapshot,
		applyTheme: (theme: GuiTheme) => {
			currentTheme = theme;
			rootBox.setBackground(theme.background);
			sessionTitleText.setColor(theme.textBright);
			bottomDivider.setColor(theme.border);
		},
		dispose: () => {
			openersPopover?.hide();
			openersPopover = undefined;
		},
	};
}

/** Clickable pill surface wrapping floating toast notification content. */
class WakuToastPill extends GuiComponent {
	private toast: GuiToastEntry;
	private readonly closeBtn: IconButton;
	private readonly onDismiss: (id: string) => void;

	constructor(toast: GuiToastEntry, onDismiss: (id: string) => void) {
		super();
		this.toast = toast;
		this.onDismiss = onDismiss;
		this.cursor = SGUI_CURSOR_POINTER;
		this.closeBtn = new IconButton({
			icon: "close",
			size: 22,
			iconSize: 11,
			label: "Dismiss notification",
			onClick: () => this.onDismiss(this.toast.id),
		});
		this.closeBtn.setParent(this);
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.closeBtn.attachHost(host);
	}

	setToast(toast: GuiToastEntry): void {
		this.toast = toast;
		this.invalidate();
	}

	private iconForLevel(level: GuiToastEntry["level"]): VectorIconName {
		return level === "info" ? "info" : "alert";
	}

	private colorForLevel(level: GuiToastEntry["level"], theme: GuiTheme): Color {
		switch (level) {
			case "error":
				return theme.danger;
			case "warning":
				return theme.warning;
			case "info":
			default:
				return theme.info;
		}
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const style = { fontFamily: SGUI_FONT_REGULAR, fontSize: ctx.theme.fontSizeBody, fontWeight: 500 };
		const textAvail = Math.max(40, Math.min(maxWidth, 560) - 68);
		const metrics = ctx.measureText(style, textAvail, this.toast.message);
		const w = Math.min(maxWidth, Math.max(180, Math.min(560, metrics.width + 72)));
		const h = Math.max(36, metrics.height + 16);
		return { width: w, height: h };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const btnSize = this.closeBtn.measure(ctx, 24, rect.height);
		this.closeBtn.layout(ctx, {
			x: rect.x + rect.width - btnSize.width - 8,
			y: rect.y + Math.max(0, (rect.height - btnSize.height) * 0.5),
			width: btnSize.width,
			height: btnSize.height,
		});
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		const hitBtn = this.closeBtn.hitTest(x, y);
		if (hitBtn !== undefined) return hitBtn;
		return this;
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		const tone = this.colorForLevel(this.toast.level, t);
		const radius = 10;

		ctx.fillRect(r.x, r.y, r.width, r.height, t.surfaceElevated, radius);
		ctx.strokeRect(r.x, r.y, r.width, r.height, withAlpha(tone, 0.5), 1, radius);

		const iconSz = 14;
		drawVectorIcon(ctx, this.iconForLevel(this.toast.level), r.x + 12, r.y + (r.height - iconSz) * 0.5, iconSz, tone);

		const style = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeBody, fontWeight: 500 };
		const textX = r.x + 34;
		const textW = Math.max(20, this.closeBtn.layoutRect.x - textX - 8);
		const metrics = ctx.measureText(style, textW, this.toast.message);
		ctx.drawStyledText(textX, r.y + Math.max(0, (r.height - metrics.height) * 0.5), textW, t.textPrimary, style, this.toast.message);

		this.closeBtn.render(ctx);
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
		this.closeBtn.collectFocusables(out);
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
		this.closeBtn.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (!this.visible) return undefined;
		if (this.a11yId === nodeId) return this;
		return this.closeBtn.findComponentByA11yId(nodeId);
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: "focus" | "press" | "increment" | "decrement" | "setValue",
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		return this.closeBtn.handleAccessibilityAction(nodeId, action, value, ctx);
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

	const showToast = (toast: GuiToastEntry): void => {
		clearTimer();
		activeToastId = toast.id;
		if (toastPill !== undefined && overlayHandle !== undefined) {
			toastPill.setToast(toast);
		} else {
			toastPill = new WakuToastPill(toast, dismissId);
			overlayHandle = app.showOverlay(toastPill, {
				anchor: "top-center",
				offsetY: 54,
				maxWidth: 560,
				modal: false,
				radius: 10,
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
		const toasts = Array.isArray(snapshotOrToasts) ? snapshotOrToasts : ("toasts" in snapshotOrToasts ? snapshotOrToasts.toasts : []);
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
		applyTheme: () => {
			toastPill?.invalidate();
		},
		hasActiveToast: () => activeToastId !== undefined && overlayHandle !== undefined,
		dispose: () => {
			hideToast();
		},
	};
}
