/**
 * Waku modal overlays and popovers: Command Palette (⌘K), Model Picker (⌘M),
 * Session Resume Picker (⌘⇧O), Git Branch & Commit Modals, Context Window Breakdown,
 * Left-Rail Categorized Settings Dialog (⌘,), and Extension Prompts.
 */

import { basename } from "node:path";
import type { ThinkingLevel } from "@pi-ts/agent-core";
import {
	Badge,
	Box,
	Button,
	type Color,
	Divider,
	drawFocusHalo,
	drawVectorIcon,
	Editor,
	fuzzyFilter,
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
	Input,
	Markdown,
	type OverlayHandle,
	type OverlayOptions,
	type PaddingInput,
	Pill,
	pointInRect,
	type RasterSurface,
	type Rect,
	resolveTheme,
	ScrollView,
	SegmentedControl,
	type Size,
	Spacer,
	Switch,
	Text,
	TruncatedText,
	VectorCanvas,
	VectorIcon,
	type VectorIconName,
	VStack,
	withAlpha,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_ARROW,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
} from "@pi-ts/gui";
import { ClickableContainer } from "./cards.ts";
import { annotateSpecNode, providerIconForId, registerSpecChildren } from "./ui-spec-meta.ts";
import type {
	GuiChangedFile,
	GuiContextUsage,
	GuiLayoutPreferences,
	GuiModelSummary,
	GuiPendingPrompt,
	GuiSessionController,
	GuiSessionListItem,
	GuiSessionSnapshot,
} from "./types.ts";

/** Format a Unix epoch ms timestamp into Waku's compact relative time badge (`just now`, `1m`, `2h`, `3d`). */
export function formatRelativeTimeShort(timestampMs: number, nowMs: number = Date.now()): string {
	const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
	if (diffSec < 45) return "just now";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m`;
	const diffHours = Math.floor(diffMin / 60);
	if (diffHours < 24) return `${diffHours}h`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return `${diffDays}d`;
	const diffMonths = Math.floor(diffDays / 30);
	if (diffMonths < 12) return `${diffMonths}mo`;
	return `${Math.floor(diffMonths / 12)}y`;
}

/** Look up a custom session title safely without unchecked Record indexing for scriptc. */
export function lookupSessionCustomName(
	customNames: Record<string, string>,
	sessionId: string,
): string | undefined {
	for (const [id, name] of Object.entries(customNames)) {
		if (id === sessionId && name.trim().length > 0) {
			return name;
		}
	}
	return undefined;
}

/** Format token count cleanly for context gauges and popovers. */
export function formatCompactTokens(tokens: number | null | undefined): string {
	if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) {
		return "—";
	}
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${Math.round(tokens / 1_000)}k`;
	}
	return `${Math.round(tokens)}`;
}

/** Resolve appearance preference ("system" | "dark" | "light") into a concrete GuiTheme. */
export function resolveAppearanceTheme(
	appearance: "system" | "dark" | "light",
	app: GuiApp,
	fallbackDark = true,
): GuiTheme {
	const metricsDark = app.getWindowMetrics().darkMode;
	return resolveTheme(appearance, metricsDark ?? fallbackDark);
}

/** Format cost in USD cleanly for context usage summaries. */
function formatUsd(cost: number | undefined): string {
	if (cost === undefined || !Number.isFinite(cost)) return "—";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

/** Return the color tint for a git file status glyph (`M`/`A`/`D`/`R`/`U`). */
export function colorForFileStatus(status: GuiChangedFile["status"], theme: GuiTheme): Color {
	switch (status) {
		case "A":
		case "U":
			return theme.diffAddText;
		case "D":
			return theme.diffDelText;
		case "R":
			return theme.info;
		case "M":
		default:
			return theme.warning;
	}
}

/** Input subclass used inside searchable overlays to forward Up/Down/Enter/Esc directly to list navigation. */
class ModalSearchInput extends Input {
	private readonly onNavigateFn: (delta: number) => void;
	private readonly onConfirmFn: () => void;
	private readonly onCancelFn: () => void;
	private readonly fixedHeightValue: number | undefined;

	constructor(options: {
		placeholder?: string;
		value?: string;
		variant?: "default" | "chromeless";
		padding?: PaddingInput;
		height?: number;
		a11yLabel?: string;
		onChange?: (value: string) => void;
		onNavigate: (delta: number) => void;
		onConfirm: () => void;
		onCancel: () => void;
	}) {
		super({
			value: options.value ?? "",
			placeholder: options.placeholder ?? "Search...",
			variant: options.variant,
			a11yLabel: options.a11yLabel ?? options.placeholder ?? "Search...",
			padding: options.padding ?? { vertical: 8, horizontal: 10 },
			radius: 8,
			onChange: options.onChange,
			onSubmit: () => {
				options.onConfirm();
			},
		});
		this.onNavigateFn = options.onNavigate;
		this.onConfirmFn = options.onConfirm;
		this.onCancelFn = options.onCancel;
		this.fixedHeightValue = options.height;
	}

	override measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const m = super.measure(ctx, maxWidth, maxHeight);
		return {
			width: m.width,
			height: this.fixedHeightValue ?? m.height,
		};
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" || event.phase === "repeat") {
			const kb = ctx.keybindings;
			if (kb.matches(event, "selectUp") || kb.matches(event, "cursorUp")) {
				this.onNavigateFn(-1);
				return true;
			}
			if (kb.matches(event, "selectDown") || kb.matches(event, "cursorDown")) {
				this.onNavigateFn(1);
				return true;
			}
		}
		if (event.phase === "down") {
			const kb = ctx.keybindings;
			if (kb.matches(event, "selectConfirm") || kb.matches(event, "submit")) {
				this.onConfirmFn();
				return true;
			}
			if (kb.matches(event, "selectCancel") || kb.matches(event, "cancel")) {
				this.onCancelFn();
				return true;
			}
		}
		return super.handleKey(event, ctx);
	}
}

interface SelectableRowOptions {
	readonly label: string;
	readonly subtitle?: string;
	readonly badgeText?: string;
	readonly shortcut?: string;
	readonly leadingIcon?: VectorIconName;
	readonly checked?: boolean;
	readonly active?: boolean;
	readonly selected?: boolean;
	readonly accentCheck?: boolean;
	readonly indent?: number;
	readonly height?: number;
	readonly paddingHorizontal?: number;
	readonly borderOnSelected?: boolean;
	readonly onClick: () => void;
	readonly trailingActions?: readonly IconButton[];
}

/** Concrete selectable row used across Command Palette, Model Picker, Session Picker, and Git modals. */
class WakuOverlayRow extends GuiComponent {
	private readonly opts: SelectableRowOptions;
	private readonly actionButtons: IconButton[];
	private selectedState: boolean;

	constructor(options: SelectableRowOptions) {
		super();
		this.opts = options;
		this.actionButtons = options.trailingActions ? options.trailingActions.slice() : [];
		this.selectedState = options.selected ?? false;
		this.cursor = SGUI_CURSOR_POINTER;
		this.focusable = true;
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined) {
				btn.setParent(this);
			}
		}
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined) {
				btn.attachHost(host);
			}
		}
	}

	setSelected(selected: boolean): void {
		if (this.selectedState === selected) return;
		this.selectedState = selected;
		this.invalidate();
	}

	trigger(): void {
		this.opts.onClick();
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const hasSub = this.opts.subtitle !== undefined && this.opts.subtitle.length > 0;
		const rowH = this.opts.height ?? (hasSub ? 46 : 34);
		return { width: Math.max(0, maxWidth), height: rowH };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const padX = this.opts.paddingHorizontal ?? 10;
		let rightCursor = rect.x + rect.width - Math.max(8, padX - 2);
		for (let i = this.actionButtons.length - 1; i >= 0; i--) {
			const btn = this.actionButtons[i];
			if (btn === undefined || !btn.visible) continue;
			const size = btn.measure(ctx, 28, rect.height);
			rightCursor -= size.width;
			btn.layout(ctx, {
				x: rightCursor,
				y: rect.y + Math.max(0, (rect.height - size.height) * 0.5),
				width: size.width,
				height: size.height,
			});
			rightCursor -= 4;
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		for (let i = this.actionButtons.length - 1; i >= 0; i--) {
			const btn = this.actionButtons[i];
			if (btn === undefined || !btn.visible) continue;
			const hit = btn.hitTest(x, y);
			if (hit !== undefined) return hit;
		}
		return this;
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const t = ctx.theme;
		const hovered = this.isHovered();
		const focused = this.isFocusVisible();

		if (this.selectedState) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.surfaceSelected, 8);
			if (this.opts.borderOnSelected) {
				ctx.strokeRect(r.x, r.y, r.width, r.height, t.borderStrong, 1, 8);
			}
		} else if (hovered) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 8);
		}
		if (focused) {
			drawFocusHalo(ctx, r, 8, 0.2, 2);
		}

		const indent = this.opts.indent ?? 0;
		const padX = this.opts.paddingHorizontal ?? 10;
		let cursorX = r.x + padX + indent;
		const rightBound = r.x + r.width - padX;

		if (this.opts.leadingIcon !== undefined) {
			const iconSize = 14;
			const iconColor = this.opts.active ? t.text : t.textSecondary;
			drawVectorIcon(ctx, this.opts.leadingIcon, cursorX, r.y + (r.height - iconSize) * 0.5, iconSize, iconColor);
			cursorX += iconSize + 8;
		}

		let rightReserved = 0;
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined && btn.visible) {
				rightReserved += btn.layoutRect.width + 4;
			}
		}

		if (this.opts.checked) {
			const checkSize = 13;
			const cx = rightBound - rightReserved - checkSize;
			drawVectorIcon(
				ctx,
				"check",
				cx,
				r.y + (r.height - checkSize) * 0.5,
				checkSize,
				this.opts.accentCheck === true ? t.accent : t.textSecondary,
			);
			rightReserved += checkSize + 8;
		}

		if (this.opts.shortcut !== undefined && this.opts.shortcut.length > 0) {
			const scStyle = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeSmall, fontWeight: 500 };
			const scMetrics = ctx.measureText(scStyle, 0, this.opts.shortcut);
			const scW = Math.ceil(scMetrics.width);
			const scX = rightBound - rightReserved - scW - 8;
			ctx.fillRect(scX, r.y + (r.height - (scMetrics.lineHeight + 4)) * 0.5, scW + 8, scMetrics.lineHeight + 4, t.surfaceMuted, 4);
			ctx.drawStyledText(
				scX + 4,
				r.y + (r.height - scMetrics.lineHeight) * 0.5,
				0,
				t.textSecondary,
				scStyle,
				this.opts.shortcut,
			);
			rightReserved += scW + 14;
		}

		if (this.opts.badgeText !== undefined && this.opts.badgeText.length > 0) {
			const badgeStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 500 };
			const bMetrics = ctx.measureText(badgeStyle, 0, this.opts.badgeText);
			const bW = Math.ceil(bMetrics.width);
			const bx = rightBound - rightReserved - bW - 6;
			ctx.drawStyledText(
				bx,
				r.y + (r.height - bMetrics.lineHeight) * 0.5,
				0,
				t.textMuted,
				badgeStyle,
				this.opts.badgeText,
			);
			rightReserved += bW + 12;
		}

		const textAvailW = Math.max(20, rightBound - rightReserved - cursorX);
		const titleStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: t.fontSizeBody,
			fontWeight: this.opts.active ? 600 : 500,
		};
		const titleMetrics = ctx.measureText(titleStyle, 0, this.opts.label);
		const hasSub = this.opts.subtitle !== undefined && this.opts.subtitle.length > 0;
		const titleY = hasSub ? r.y + 6 : r.y + Math.max(0, (r.height - titleMetrics.lineHeight) * 0.5);
		ctx.drawStyledText(
			cursorX,
			titleY,
			textAvailW,
			this.opts.active ? t.text : t.textPrimary,
			titleStyle,
			this.opts.label,
		);

		if (hasSub && this.opts.subtitle !== undefined) {
			const subStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 400 };
			ctx.drawStyledText(cursorX, titleY + titleMetrics.lineHeight + 2, textAvailW, t.textSecondary, subStyle, this.opts.subtitle);
		}

		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined && btn.visible) {
				btn.render(ctx);
			}
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left") {
			if (pointInRect(event.x, event.y, this.layoutRect)) {
				this.opts.onClick();
			}
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.opts.onClick();
			return true;
		}
		return false;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		out.push(this);
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined) btn.collectFocusables(out);
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.selectedState || this.opts.active) flags |= SGUI_A11Y_STATE_SELECTED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.opts.label,
			value: this.opts.subtitle ?? "",
			rect: this.layoutRect,
			stateFlags: flags,
		});
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn !== undefined) btn.collectAccessibilityNodes(out, ctx);
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (!this.visible) return undefined;
		if (this.a11yId === nodeId) return this;
		for (let i = 0; i < this.actionButtons.length; i++) {
			const btn = this.actionButtons[i];
			if (btn === undefined) continue;
			const found = btn.findComponentByA11yId(nodeId);
			if (found !== undefined) return found;
		}
		return undefined;
	}

	override handleAccessibilityAction(nodeId: number, action: "focus" | "press" | "increment" | "decrement" | "setValue", value: string, ctx: GuiRenderContext): boolean {
		if (nodeId === this.a11yId) {
			if (action === "focus") {
				ctx.requestFocus(this);
				return true;
			}
			if (action === "press") {
				this.opts.onClick();
				return true;
			}
			return false;
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

/** Proportional context window usage progress bar with threshold color shifting. */
class ContextProgressBar extends GuiComponent {
	private ratioValue: number;

	constructor(percent: number | null) {
		super();
		this.ratioValue = percent === null ? 0 : Math.max(0, Math.min(1, percent / 100));
	}

	setPercent(percent: number | null): void {
		this.ratioValue = percent === null ? 0 : Math.max(0, Math.min(1, percent / 100));
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(40, maxWidth), height: 3 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		const radius = r.height * 0.5;
		ctx.fillRect(r.x, r.y, r.width, r.height, t.surfaceMuted, radius);
		const fillW = Math.max(this.ratioValue > 0 ? 4 : 0, r.width * this.ratioValue);
		const barColor =
			this.ratioValue >= 0.9 ? t.danger : this.ratioValue >= 0.75 ? t.warning : t.gauge;
		if (fillW > 0) {
			ctx.fillRect(r.x, r.y, Math.min(r.width, fillW), r.height, barColor, radius);
		}
	}
}

/** 30x30 provider icon tile with overlapping 10px status dot ringed in surfaceRaised. */
class ProviderIconTile extends GuiComponent {
	private readonly iconName: VectorIconName;
	private readonly iconColor: Color;
	private readonly dotColor: Color;
	private readonly ringColor: Color;

	constructor(iconName: VectorIconName, iconColor: Color, dotColor: Color, ringColor: Color) {
		super();
		this.iconName = iconName;
		this.iconColor = iconColor;
		this.dotColor = dotColor;
		this.ringColor = ringColor;
	}

	measure(_ctx: GuiRenderContext, _maxWidth: number, _maxHeight?: number): Size {
		return { width: 30, height: 30 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		ctx.fillRect(r.x, r.y, 30, 30, ctx.theme.surfaceOverlay, 7);
		drawVectorIcon(ctx, this.iconName, r.x + 7, r.y + 7, 16, this.iconColor);
		const dotX = r.x + 22;
		const dotY = r.y + 22;
		ctx.fillRect(dotX, dotY, 10, 10, this.ringColor, 5);
		ctx.fillRect(dotX + 2, dotY + 2, 6, 6, this.dotColor, 3);
	}
}

/** Checkbox file row used inside the Git Commit modal. */
class CommitFileCheckRow extends GuiComponent {
	private readonly file: GuiChangedFile;
	private checked: boolean;
	private readonly onToggle: (checked: boolean) => void;

	constructor(file: GuiChangedFile, checked: boolean, onToggle: (checked: boolean) => void) {
		super();
		this.file = file;
		this.checked = checked;
		this.onToggle = onToggle;
		this.cursor = SGUI_CURSOR_POINTER;
		this.focusable = true;
	}

	isChecked(): boolean {
		return this.checked;
	}

	setChecked(checked: boolean): void {
		if (this.checked === checked) return;
		this.checked = checked;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 30 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;
		if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 6);
		}
		if (this.isFocusVisible()) {
			drawFocusHalo(ctx, r, 6, 0.2, 2);
		}

		const boxSz = 14;
		const boxX = r.x + 8;
		const boxY = r.y + (r.height - boxSz) * 0.5;
		if (this.checked) {
			ctx.fillRect(boxX, boxY, boxSz, boxSz, t.accent, 4);
			drawVectorIcon(ctx, "check", boxX + 2, boxY + 2, boxSz - 4, t.textOnAccent);
		} else {
			ctx.strokeRect(boxX, boxY, boxSz, boxSz, t.borderStrong, 1.2, 4);
		}

		const statusStyle = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeSmall, fontWeight: 700 };
		const statusX = boxX + boxSz + 8;
		const stMetrics = ctx.measureText(statusStyle, 0, this.file.status);
		ctx.drawStyledText(
			statusX,
			r.y + (r.height - stMetrics.lineHeight) * 0.5,
			16,
			colorForFileStatus(this.file.status, t),
			statusStyle,
			this.file.status,
		);

		const statsText = `+${this.file.additions} -${this.file.deletions}`;
		const statsStyle = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeSmall, fontWeight: 500 };
		const statsW = ctx.measureText(statsStyle, 0, statsText).width;
		const statsX = r.x + r.width - 8 - statsW;
		ctx.drawStyledText(
			statsX,
			r.y + (r.height - stMetrics.lineHeight) * 0.5,
			statsW + 4,
			t.textSecondary,
			statsStyle,
			statsText,
		);

		const pathX = statusX + 18;
		const pathW = Math.max(20, statsX - pathX - 8);
		const pathStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeBody, fontWeight: 400 };
		const pathMetrics = ctx.measureText(pathStyle, 0, this.file.path);
		ctx.drawStyledText(
			pathX,
			r.y + (r.height - pathMetrics.lineHeight) * 0.5,
			pathW,
			t.textPrimary,
			pathStyle,
			this.file.path,
		);
	}

	private toggle(): void {
		this.checked = !this.checked;
		this.onToggle(this.checked);
		this.invalidate();
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.toggle();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.toggle();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.checked) flags |= SGUI_A11Y_STATE_SELECTED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "checkbox",
			label: this.file.path,
			value: this.checked ? "checked" : "unchecked",
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
			this.toggle();
			return true;
		}
		return false;
	}
}

export type WakuCommandGroup =
	| "Commands"
	| "Sessions"
	| "View"
	| "Git"
	| "Model & Thinking"
	| "Workspace"
	| "Extension Commands";

export interface WakuCommandItem {
	readonly id: string;
	readonly group: WakuCommandGroup;
	readonly label: string;
	readonly description?: string;
	readonly shortcut?: string;
	readonly run: () => void | Promise<void>;
}

export interface WakuCommandPaletteOptions {
	readonly initialQuery?: string;
	readonly extensionCommands?: readonly WakuCommandItem[];
	readonly onNewSession?: () => void | Promise<void>;
	readonly onOpenSessionPicker?: () => void;
	readonly onForkSession?: () => void | Promise<void>;
	readonly onCompactContext?: () => void | Promise<void>;
	readonly onToggleSidebar?: () => void;
	readonly onToggleRightPanel?: () => void;
	readonly onSwitchRightTab?: (tab: "changes" | "files" | "terminal" | "tree") => void;
	readonly onToggleDiffMode?: () => void;
	readonly onToggleTheme?: () => void;
	readonly onOpenGitBranch?: () => void;
	readonly onOpenGitCommit?: () => void;
	readonly onOpenModelPicker?: () => void;
	readonly onCycleThinking?: () => void;
	readonly onOpenExternalApp?: () => void;
	readonly onOpenSettings?: () => void;
	readonly onDismiss?: () => void;
}

const COMMAND_GROUP_ORDER: readonly WakuCommandGroup[] = [
	"Commands",
	"Sessions",
	"View",
	"Git",
	"Model & Thinking",
	"Workspace",
	"Extension Commands",
];

function createModalSurfaceBox(theme: GuiTheme, child: GuiComponent, maxWidth: number, padding: PaddingInput = 14): Box {
	return new Box({
		background: theme.surfaceElevated,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 12,
		shadow: "lg",
		padding,
		maxWidth,
		fillWidth: true,
		child,
	});
}

function addSectionHeader(container: VStack, label: string, theme: GuiTheme, height?: number): Box {
	const box = new Box({
		height,
		fillWidth: true,
		padding: height === 30 ? { top: 10, right: 9, bottom: 0, left: 9 } : { top: 8, bottom: 3, left: 8, right: 8 },
		child: new Text({
			text: label,
			fontSize: theme.fontSizeSmall,
			fontWeight: 600,
			color: theme.textMuted,
		}),
	});
	container.addChild(box);
	return box;
}

/**
 * Open Waku ⌘K Command Palette centered near the top of the window with live fuzzy search
 * across Sessions, View, Git, Model & Thinking, Workspace, and Extension Commands.
 */
export function openCommandPalette(
	app: GuiApp,
	controller: GuiSessionController,
	options: WakuCommandPaletteOptions = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	const actions: WakuCommandItem[] = [
		{
			id: "session.new",
			group: "Commands",
			label: "New Session",
			description: "Start a fresh conversation",
			shortcut: "⌘N",
			run: async () => {
				if (options.onNewSession) {
					await options.onNewSession();
				} else {
					await controller.newSession();
				}
			},
		},
		{
			id: "session.resume",
			group: "Commands",
			label: "Switch / Resume Session",
			description: "Browse sessions across workspaces",
			shortcut: "⌘⇧O",
			run: () => {
				if (options.onOpenSessionPicker) {
					options.onOpenSessionPicker();
				} else {
					openSessionPicker(app, controller);
				}
			},
		},
		{
			id: "session.fork",
			group: "Commands",
			label: "Fork Active Session",
			description: "Branch from the current conversation",
			run: async () => {
				if (options.onForkSession) {
					await options.onForkSession();
				} else {
					await controller.forkSession();
				}
			},
		},
		{
			id: "session.compact",
			group: "Commands",
			label: "Compact Context",
			description: "Summarize earlier turns to free context tokens",
			run: async () => {
				if (options.onCompactContext) {
					await options.onCompactContext();
				} else {
					await controller.compactSession();
				}
			},
		},
		{
			id: "view.sidebar",
			group: "View",
			label: snap.layout.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar",
			description: "Toggle left session sidebar",
			shortcut: "⌘B",
			run: () => {
				if (options.onToggleSidebar) {
					options.onToggleSidebar();
				} else {
					const cur = controller.getSnapshot().layout.sidebarCollapsed;
					controller.updateLayoutPreferences({ sidebarCollapsed: !cur });
				}
			},
		},
		{
			id: "view.rightPanel",
			group: "View",
			label: snap.layout.rightPanelOpen ? "Hide Right Panel" : "Show Right Panel",
			description: "Toggle Changes / Files / Tree inspector",
			shortcut: "⌘⇧B",
			run: () => {
				if (options.onToggleRightPanel) {
					options.onToggleRightPanel();
				} else {
					const cur = controller.getSnapshot().layout.rightPanelOpen;
					controller.updateLayoutPreferences({ rightPanelOpen: !cur });
				}
			},
		},
		{
			id: "view.changes",
			group: "View",
			label: "Open Changes Tab",
			description: "Inspect working tree diffs",
			run: () => {
				if (options.onSwitchRightTab) {
					options.onSwitchRightTab("changes");
				} else {
					controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "changes" });
				}
			},
		},
		{
			id: "view.files",
			group: "View",
			label: "Open Files Tab",
			description: "Browse workspace files",
			run: () => {
				if (options.onSwitchRightTab) {
					options.onSwitchRightTab("files");
				} else {
					controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "files" });
				}
			},
		},
		{
			id: "view.tree",
			group: "View",
			label: "Open Session Tree Tab",
			description: "Inspect session DAG entries",
			run: () => {
				if (options.onSwitchRightTab) {
					options.onSwitchRightTab("tree");
				} else {
					controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "tree" });
				}
			},
		},
		{
			id: "view.diffMode",
			group: "View",
			label: snap.layout.diffViewMode === "unified" ? "Switch to Split Diff" : "Switch to Unified Diff",
			description: "Toggle diff layout mode",
			run: () => {
				if (options.onToggleDiffMode) {
					options.onToggleDiffMode();
				} else {
					const nextMode = controller.getSnapshot().layout.diffViewMode === "unified" ? "split" : "unified";
					controller.updateLayoutPreferences({ diffViewMode: nextMode });
				}
			},
		},
		{
			id: "view.theme",
			group: "View",
			label: "Toggle Theme",
			description: "Switch between dark and light appearance",
			run: () => {
				if (options.onToggleTheme) {
					options.onToggleTheme();
				} else {
					const nextApp = app.getTheme().dark ? "light" : "dark";
					controller.updateLayoutPreferences({ appearance: nextApp });
					app.setTheme(resolveAppearanceTheme(nextApp, app));
				}
			},
		},
		{
			id: "git.branch",
			group: "Git",
			label: "Switch / Create Git Branch",
			description: snap.gitBranch ? `Current: ${snap.gitBranch}` : "Checkout or create branch",
			run: () => {
				if (options.onOpenGitBranch) {
					options.onOpenGitBranch();
				} else {
					openGitBranchModal(app, controller);
				}
			},
		},
		{
			id: "git.commit",
			group: "Git",
			label: "Commit Changes...",
			description: `${snap.changedFiles.length} changed file(s)`,
			run: () => {
				if (options.onOpenGitCommit) {
					options.onOpenGitCommit();
				} else {
					openGitCommitModal(app, controller);
				}
			},
		},
		{
			id: "git.refresh",
			group: "Git",
			label: "Refresh Git & Workspace State",
			description: "Rescan modified files and workspace tree",
			run: async () => {
				await controller.refreshWorkspaceState();
			},
		},
		{
			id: "model.select",
			group: "Model & Thinking",
			label: "Select Model",
			description: snap.status.activeModel ? snap.status.activeModel.label : "Choose active LLM",
			shortcut: "⌘M",
			run: () => {
				if (options.onOpenModelPicker) {
					options.onOpenModelPicker();
				} else {
					openModelPicker(app, controller);
				}
			},
		},
		{
			id: "model.thinking",
			group: "Model & Thinking",
			label: "Cycle Thinking Level",
			description: `Current: ${snap.status.thinkingLevel}`,
			run: () => {
				if (options.onCycleThinking) {
					options.onCycleThinking();
				} else {
					const levels = snap.status.availableThinkingLevels;
					if (levels.length > 0) {
						const idx = levels.indexOf(controller.getStatus().thinkingLevel);
						const next = levels[(idx + 1) % levels.length];
						if (next !== undefined) controller.setThinkingLevel(next);
					}
				}
			},
		},
		{
			id: "workspace.settings",
			group: "Workspace",
			label: "Open Settings",
			description: "Configure appearance, model, and chrome",
			shortcut: "⌘,",
			run: () => {
				if (options.onOpenSettings) {
					options.onOpenSettings();
				} else {
					openSettingsModal(app, controller);
				}
			},
		},
		{
			id: "workspace.openExternal",
			group: "Workspace",
			label: "Open Workspace in Finder",
			description: snap.status.cwd,
			run: async () => {
				if (options.onOpenExternalApp) {
					options.onOpenExternalApp();
				} else {
					await controller.openInExternalApp("finder");
				}
			},
		},
	];

	if (options.extensionCommands !== undefined) {
		for (let i = 0; i < options.extensionCommands.length; i++) {
			const cmd = options.extensionCommands[i];
			if (cmd !== undefined) {
				actions.push(cmd);
			}
		}
	}

	let filteredActions: WakuCommandItem[] = actions.slice();
	let currentQuery = options.initialQuery ?? "";
	let selectedIdx = 0;
	let rowHandles: WakuOverlayRow[] = [];
	const listStack = new VStack({ gap: 0 });
	const scrollView = new ScrollView({ child: listStack, overlayScrollbar: true });
	const emptyBox = new Box({
		height: 179,
		fillWidth: true,
		alignHorizontal: "center",
		alignVertical: "center",
		child: new VStack({
			gap: 5,
			align: "center",
			justify: "center",
			children: [
				new VectorIcon({ name: "search", size: 18, color: theme.textDisabled }),
				new Text({ text: "No matching tasks or commands", color: theme.textMuted, fontSize: theme.fontSizeBody }),
			],
		}),
	});
	const resultsBox = new Box({
		fillWidth: true,
		height: 420,
		padding: { top: 0, right: 8, bottom: 8, left: 8 },
		child: scrollView,
	});
	let cardBox: Box | undefined;
	let firstSectionBox: Box | undefined;
	let firstSectionLabel = "Commands";
	let firstRowComp: WakuOverlayRow | undefined;
	const searchBox = new Box({
		height: 60,
		fillWidth: true,
		padding: { top: 0, right: 19, bottom: 0, left: 19 },
		borderEdges: { bottom: 1 },
		borderColor: theme.border,
	});
	let overlayHandle: OverlayHandle | undefined;

	const runCommand = (item: WakuCommandItem | undefined): void => {
		if (item === undefined) return;
		overlayHandle?.hide();
		void item.run();
	};

	const updateRowSelection = (): void => {
		for (let i = 0; i < rowHandles.length; i++) {
			const row = rowHandles[i];
			if (row !== undefined) {
				row.setSelected(i === selectedIdx);
			}
		}
	};

	const syncPaletteSpecChildren = (): void => {
		if (filteredActions.length === 0) {
			registerSpecChildren(resultsBox, () => [emptyBox]);
			return;
		}
		const children: GuiComponent[] = [];
		if (firstSectionBox !== undefined) {
			annotateSpecNode(firstSectionBox, {
				key: "command_palette.section.0",
				role: "heading",
				flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 0 },
				size: { w: "fill", h: 30 },
				padding: [10, 9, 0, 9],
				text: { value: firstSectionLabel, wrap: "nowrap", lines: 1, overflow: "ellipsis" },
				skipChildren: true,
			});
			children.push(firstSectionBox);
		}
		if (firstRowComp !== undefined) {
			annotateSpecNode(firstRowComp, {
				key: "command_palette.row.0",
				role: "button",
				flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 10 },
				padding: [0, 11, 0, 11],
				border: [1, 1, 1, 1],
				size: { w: "fill", h: 44 },
				state: () => (selectedIdx === 0 ? "active" : "default"),
				skipChildren: true,
			});
			children.push(firstRowComp);
		}
		registerSpecChildren(resultsBox, () => children);
	};

	const rebuildList = (query: string): void => {
		currentQuery = query;
		filteredActions = fuzzyFilter(actions, query, (item) => `${item.group} ${item.label} ${item.description ?? ""}`);
		if (filteredActions.length === 0) {
			selectedIdx = 0;
		} else if (selectedIdx >= filteredActions.length) {
			selectedIdx = filteredActions.length - 1;
		}
		listStack.clear();
		rowHandles = [];
		firstSectionBox = undefined;
		firstRowComp = undefined;

		if (filteredActions.length === 0) {
			cardBox?.setHeight(240);
			searchBox.setHeight(59);
			resultsBox.setHeight(179);
			resultsBox.setPadding({ top: 0, right: 8, bottom: 0, left: 8 });
			resultsBox.setChild(emptyBox);
			syncPaletteSpecChildren();
			return;
		}

		cardBox?.setHeight(480);
		searchBox.setHeight(60);
		resultsBox.setHeight(419);
		resultsBox.setPadding({ top: 0, right: 8, bottom: 8, left: 8 });
		resultsBox.setChild(scrollView);

		let flatIdx = 0;
		for (let gi = 0; gi < COMMAND_GROUP_ORDER.length; gi++) {
			const groupName = COMMAND_GROUP_ORDER[gi];
			if (groupName === undefined) continue;
			const groupItems = filteredActions.filter((item) => item.group === groupName);
			if (groupItems.length === 0) continue;

			const sectionBox = addSectionHeader(listStack, groupName, theme, 30);
			if (firstSectionBox === undefined) {
				firstSectionBox = sectionBox;
				firstSectionLabel = groupName;
			}
			for (let ii = 0; ii < groupItems.length; ii++) {
				const cmd = groupItems[ii];
				if (cmd === undefined) continue;
				const currentFlatIdx = flatIdx;
				flatIdx += 1;
				const row = new WakuOverlayRow({
					label: cmd.label,
					subtitle: cmd.description,
					shortcut: cmd.shortcut,
					height: 44,
					paddingHorizontal: 11,
					borderOnSelected: true,
					selected: currentFlatIdx === selectedIdx,
					onClick: () => runCommand(cmd),
				});
				if (firstRowComp === undefined) {
					firstRowComp = row;
				}
				rowHandles.push(row);
				listStack.addChild(row);
			}
		}
		syncPaletteSpecChildren();
	};

	const searchInput = new ModalSearchInput({
		value: currentQuery,
		variant: "chromeless",
		padding: 0,
		height: 59,
		placeholder: "Search tasks or run a command…",
		a11yLabel: "Search tasks or run a command…",
		onChange: (value) => {
			selectedIdx = 0;
			rebuildList(value);
		},
		onNavigate: (delta) => {
			if (filteredActions.length === 0) return;
			selectedIdx = (selectedIdx + delta + filteredActions.length) % filteredActions.length;
			updateRowSelection();
		},
		onConfirm: () => {
			runCommand(filteredActions[selectedIdx]);
		},
		onCancel: () => {
			overlayHandle?.hide();
		},
	});

	searchBox.setChild(
		new HStack({
			gap: 10,
			align: "center",
			children: [
				new VectorIcon({ name: "search", size: 16, color: theme.textMuted }),
				{ child: searchInput, grow: 1, shrink: 1 },
			],
		}),
	);

	const body = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			searchBox,
			resultsBox,
		],
	});

	cardBox = new Box({
		width: 680,
		height: 480,
		maxWidth: 680,
		maxHeight: 480,
		background: theme.surfaceRaised,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 15,
		shadow: "lg",
		padding: 0,
		clip: true,
		child: body,
	});
	rebuildList(currentQuery);

	annotateSpecNode(cardBox, {
		key: "command_palette.card",
		role: "dialog",
		z: 200,
		border: [0, 0, 0, 0],
		padding: [0, 0, 0, 0],
		size: () => ({ w: 680, h: filteredActions.length === 0 ? 240 : 480 }),
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
		state: () => (filteredActions.length === 0 ? "empty" : currentQuery.trim().length > 0 ? "filtered" : "default"),
		text: { value: "Command Palette", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(searchBox, {
		key: "command_palette.search",
		role: "textbox",
		size: { w: "fill", h: 60 },
		padding: [0, 19, 0, 19],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Search tasks or run a command…", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	annotateSpecNode(resultsBox, {
		key: "command_palette.results",
		role: "list",
		overflow: "auto",
		size: { w: "fill", h: "fill" },
		padding: [0, 8, 8, 8],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
	});
	annotateSpecNode(emptyBox, {
		key: "command_palette.empty",
		role: "region",
		size: { w: "fill", h: 180 },
		flow: { type: "flex", dir: "column", justify: "center", align: "center", wrap: "nowrap", gap: 5 },
		text: { value: "No matching tasks or commands", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	registerSpecChildren(cardBox, () => [searchBox, resultsBox]);

	overlayHandle = app.showOverlay(cardBox, {
		anchor: "top-center",
		offsetY: 56,
		margin: 16,
		width: 680,
		maxWidth: 680,
		maxHeight: 480,
		modal: true,
		radius: 15,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.shadow, theme.dark ? 0.45 : 0.16),
		onDismiss: options.onDismiss,
	});
	app.setFocus(searchInput);
	return overlayHandle;
}

export interface WakuModelPickerOptions {
	readonly anchorRect?: Rect;
	readonly initialFavoritesOnly?: boolean;
	readonly initialQuery?: string;
	readonly onOpenSettings?: () => void;
	readonly onDismiss?: () => void;
}

/**
 * Open Waku 460x390 Anchored Model Picker Popover with left 50px provider/favorites rail,
 * Escape-clears-search-first behavior, and keyboard navigation.
 */
export function openModelPicker(
	app: GuiApp,
	controller: GuiSessionController,
	options: WakuModelPickerOptions = {},
): OverlayHandle {
	const theme = app.getTheme();
	const models = controller.getAvailableModels();
	const active = controller.getStatus().activeModel;
	const uniqueProviders: string[] = [];
	for (let i = 0; i < models.length; i++) {
		const m = models[i];
		if (m !== undefined && !uniqueProviders.includes(m.provider)) {
			uniqueProviders.push(m.provider);
		}
	}
	const defaultProvider =
		active !== undefined && uniqueProviders.includes(active.provider) ? active.provider : uniqueProviders[0];
	let favoritesOnly = options.initialFavoritesOnly ?? false;
	let selectedProvider: string | undefined = favoritesOnly ? undefined : defaultProvider;
	let searchQuery = options.initialQuery ?? "";
	let searchClearedState = false;
	const favoriteKeys = new Set<string>();
	if (active !== undefined) {
		favoriteKeys.add(`${active.provider}/${active.id}`);
	}
	if (models[0] !== undefined) {
		favoriteKeys.add(`${models[0].provider}/${models[0].id}`);
	}

	const initialBase = models.filter((m) => {
		if (favoritesOnly && !favoriteKeys.has(`${m.provider}/${m.id}`)) {
			return false;
		}
		if (selectedProvider !== undefined && m.provider !== selectedProvider) {
			return false;
		}
		return true;
	});
	let filteredModels: GuiModelSummary[] = initialBase;
	let selectedIdx = Math.max(
		0,
		initialBase.findIndex((m) => active !== undefined && m.provider === active.provider && m.id === active.id),
	);
	let rowHandles: WakuOverlayRow[] = [];
	const listStack = new VStack({ gap: 2 });
	const scrollView = new ScrollView({ child: listStack });
	let overlayHandle: OverlayHandle | undefined;

	const chooseModel = (model: GuiModelSummary | undefined): void => {
		if (model === undefined) return;
		overlayHandle?.hide();
		void controller.selectModel(model.provider, model.id);
	};

	const updateRowSelection = (): void => {
		for (let i = 0; i < rowHandles.length; i++) {
			const row = rowHandles[i];
			if (row !== undefined) {
				row.setSelected(i === selectedIdx);
			}
		}
	};

	const rebuildList = (query: string): void => {
		searchQuery = query;
		const searching = query.trim().length > 0;
		const baseModels = searching
			? models
			: models.filter((m) => {
					if (favoritesOnly && !favoriteKeys.has(`${m.provider}/${m.id}`)) {
						return false;
					}
					if (selectedProvider !== undefined && m.provider !== selectedProvider) {
						return false;
					}
					return true;
				});
		const rawFiltered = fuzzyFilter(baseModels, query, (m) => `${m.provider} ${m.id} ${m.name} ${m.description}`);
		listStack.clear();
		rowHandles = [];
		filteredModels = [];

		if (rawFiltered.length === 0) {
			listStack.addChild(
				new Box({
					padding: { vertical: 16, horizontal: 10 },
					child: new Text({
						text: favoritesOnly && !searching ? "No favorite models" : "No matching models",
						color: theme.textMuted,
					}),
				}),
			);
			return;
		}

		const providerOrder: string[] = [];
		const grouped = new Map<string, GuiModelSummary[]>();
		for (let i = 0; i < rawFiltered.length; i++) {
			const model = rawFiltered[i];
			if (model === undefined) continue;
			let bucket = grouped.get(model.provider);
			if (bucket === undefined) {
				bucket = [];
				grouped.set(model.provider, bucket);
				providerOrder.push(model.provider);
			}
			bucket.push(model);
		}

		for (let pi = 0; pi < providerOrder.length; pi++) {
			const prov = providerOrder[pi];
			if (prov === undefined) continue;
			const bucket = grouped.get(prov) ?? [];
			for (let mi = 0; mi < bucket.length; mi++) {
				const m = bucket[mi];
				if (m !== undefined) filteredModels.push(m);
			}
		}
		if (selectedIdx >= filteredModels.length) {
			selectedIdx = Math.max(0, filteredModels.length - 1);
		}

		let flatIdx = 0;
		for (let pi = 0; pi < providerOrder.length; pi++) {
			const prov = providerOrder[pi];
			if (prov === undefined) continue;
			const bucket = grouped.get(prov);
			if (bucket === undefined || bucket.length === 0) continue;

			addSectionHeader(listStack, prov.toUpperCase(), theme);
			for (let mi = 0; mi < bucket.length; mi++) {
				const model = bucket[mi];
				if (model === undefined) continue;
				const idx = flatIdx;
				flatIdx += 1;
				const isActive = active !== undefined && active.provider === model.provider && active.id === model.id;
				const modelKey = `${model.provider}/${model.id}`;
				const isFav = favoriteKeys.has(modelKey);
				const favRowBtn = new IconButton({
					icon: isFav ? "star-filled" : "star",
					size: 28,
					iconSize: 14,
					radius: 6,
					color: isFav ? theme.favorite : theme.textDisabled,
					hoverBackground: theme.surfaceOverlayStrong,
					label: `${isFav ? "Unfavorite" : "Favorite"} ${model.name || model.id}`,
					onClick: () => {
						if (favoriteKeys.has(modelKey)) {
							favoriteKeys.delete(modelKey);
						} else {
							favoriteKeys.add(modelKey);
						}
						rebuildList(searchInput.getValue());
					},
				});
				const row = new WakuOverlayRow({
					label: model.name || model.id,
					subtitle: model.description,
					badgeText: model.reasoning ? "Reasoning" : model.id,
					checked: isActive,
					active: isActive,
					accentCheck: false,
					selected: idx === selectedIdx,
					trailingActions: [favRowBtn],
					onClick: () => chooseModel(model),
				});
				rowHandles.push(row);
				listStack.addChild(row);
			}
		}
	};

	let syncRailSelection = (): void => {};

	const searchInput = new ModalSearchInput({
		value: searchQuery,
		variant: "chromeless",
		padding: 0,
		height: 34,
		placeholder: "Search Models",
		a11yLabel: "Search Models",
		onChange: (query) => {
			searchClearedState = false;
			selectedIdx = 0;
			searchQuery = query;
			syncRailSelection();
			rebuildList(query);
		},
		onNavigate: (delta) => {
			if (filteredModels.length === 0) return;
			selectedIdx = (selectedIdx + delta + filteredModels.length) % filteredModels.length;
			updateRowSelection();
		},
		onConfirm: () => {
			chooseModel(filteredModels[selectedIdx]);
		},
		onCancel: () => {
			if (searchInput.getValue().length > 0) {
				searchQuery = "";
				searchClearedState = true;
				searchInput.setValue("");
				selectedIdx = 0;
				syncRailSelection();
				rebuildList("");
				return;
			}
			overlayHandle?.hide();
		},
	});

	const searchFrameBox = new Box({
		height: 34,
		fillWidth: true,
		padding: { top: 0, right: 10, bottom: 0, left: 10 },
		radius: 9,
		borderWidth: 0,
		background: theme.surface,
		child: new HStack({
			gap: 8,
			align: "center",
			children: [
				new VectorIcon({ name: "search", size: 14, color: theme.textMuted }),
				{ child: searchInput, grow: 1, shrink: 1 },
			],
		}),
	});
	const searchMarginBox = new Box({
		fillWidth: true,
		padding: { top: 10, right: 12, bottom: 8, left: 12 },
		child: searchFrameBox,
	});

	const providerTabs: IconButton[] = [];
	const isSearchingNow = (): boolean => searchQuery.trim().length > 0;

	const favBtn = new IconButton({
		icon: "star",
		size: 38,
		iconSize: 17,
		radius: 7,
		active: favoritesOnly && !isSearchingNow(),
		activeBackground: theme.surfaceOverlayStrong,
		hoverBackground: theme.surfaceOverlay,
		label: "Filter Favorite Models",
		onClick: () => {
			const wasSearching = searchInput.getValue().trim().length > 0;
			if (wasSearching) {
				searchQuery = "";
				searchInput.setValue("");
				favoritesOnly = true;
				selectedProvider = undefined;
				searchClearedState = false;
			} else {
				favoritesOnly = !favoritesOnly;
				if (favoritesOnly) {
					selectedProvider = undefined;
					searchClearedState = false;
				} else if (selectedProvider === undefined) {
					selectedProvider = defaultProvider;
				}
			}
			syncRailSelection();
			rebuildList(searchInput.getValue());
		},
	});

	for (let i = 0; i < uniqueProviders.length; i++) {
		const prov = uniqueProviders[i];
		if (prov === undefined) continue;
		providerTabs.push(
			new IconButton({
				icon: providerIconForId(prov),
				size: 38,
				iconSize: 18,
				radius: 7,
				active: !favoritesOnly && !isSearchingNow() && selectedProvider === prov,
				activeBackground: theme.surfaceOverlayStrong,
				hoverBackground: theme.surfaceOverlay,
				label: `Filter ${prov}`,
				onClick: () => {
					const wasSearching = searchInput.getValue().trim().length > 0;
					favoritesOnly = false;
					searchClearedState = false;
					if (wasSearching) {
						searchQuery = "";
						searchInput.setValue("");
						selectedProvider = prov;
					} else {
						selectedProvider = selectedProvider === prov ? undefined : prov;
					}
					syncRailSelection();
					rebuildList(searchInput.getValue());
				},
			}),
		);
	}

	syncRailSelection = (): void => {
		const searching = isSearchingNow();
		favBtn.setActive(favoritesOnly && !searching);
		for (let i = 0; i < uniqueProviders.length; i++) {
			const prov = uniqueProviders[i];
			const btn = providerTabs[i];
			if (prov !== undefined && btn !== undefined) {
				btn.setActive(!favoritesOnly && !searching && selectedProvider === prov);
			}
		}
	};

	const settingsRailBtn = new IconButton({
		icon: "sliders",
		size: 34,
		iconSize: 14,
		label: "Open Settings",
		onClick: () => {
			overlayHandle?.hide();
			if (options.onOpenSettings) {
				options.onOpenSettings();
			} else {
				openSettingsModal(app, controller, { initialCategory: "providers" });
			}
		},
	});

	const railDivider = new Box({
		width: 34,
		height: 1,
		background: theme.borderStrong,
	});
	const railCol = new VStack({
		gap: 4,
		align: "center",
		children: [
			favBtn,
			new Box({ padding: { top: 3, right: 0, bottom: 3, left: 0 }, child: railDivider }),
			...providerTabs,
			{ child: new Spacer(), grow: 1 },
			settingsRailBtn,
		],
	});
	const railBox = new Box({
		width: 50,
		fillHeight: true,
		background: theme.background,
		cornerRadii: { tl: 11, tr: 0, br: 0, bl: 11 },
		padding: 5,
		borderEdges: { right: 1 },
		borderColor: theme.border,
		child: railCol,
	});

	const listBox = new Box({
		fillWidth: true,
		fillHeight: true,
		padding: 9,
		child: scrollView,
	});

	const rightCol = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			searchMarginBox,
			{ child: listBox, grow: 1, shrink: 1 },
		],
	});
	const rightPaneBox = new Box({
		fillWidth: true,
		fillHeight: true,
		background: theme.surfaceRaised,
		cornerRadii: { tl: 0, tr: 11, br: 11, bl: 0 },
		padding: 0,
		child: rightCol,
	});

	const splitRow = new HStack({
		gap: 0,
		align: "stretch",
		children: [
			railBox,
			{ child: rightPaneBox, grow: 1, shrink: 1 },
		],
	});

	const popoverBox = new Box({
		width: 460,
		height: 390,
		background: theme.background,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 12,
		shadow: "lg",
		padding: 0,
		clip: true,
		child: splitRow,
	});

	rebuildList(searchQuery);

	annotateSpecNode(popoverBox, {
		key: "popover.model_picker",
		role: "dialog",
		z: 100,
		variant: "anchored-popover",
		size: { w: 460, h: 390 },
		flow: { type: "flex", dir: "row", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
		state: () => (searchClearedState ? "search-cleared" : favoritesOnly ? "favorites" : "default"),
		text: { value: "Model Picker Popover", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(railBox, {
		key: "popover.model_picker.rail",
		role: "toolbar",
		size: { w: 50, h: "fill" },
		padding: [5, 5, 5, 5],
		border: [0, 1, 0, 0],
		flow: { type: "flex", dir: "column", justify: "start", align: "center", wrap: "nowrap", gap: 4 },
		text: { value: "Model Provider Rail", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(favBtn, {
		key: "popover.model_picker.rail.favorites",
		role: "button",
		variant: "rail-tab",
		size: { w: 38, h: 38 },
		state: () => (favoritesOnly ? "active" : "default"),
		text: { value: "Filter Favorite Models", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(searchFrameBox, {
		key: "popover.model_picker.search",
		role: "textbox",
		margin: [10, 12, 8, 12],
		padding: [0, 10, 0, 10],
		border: [0, 0, 0, 0],
		size: { w: "fill", h: 34 },
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Search Models", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	annotateSpecNode(listBox, {
		key: "popover.model_picker.list",
		role: "list",
		overflow: "auto",
		size: { w: "fill", h: "fill" },
		padding: [9, 9, 9, 9],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 2 },
		skipChildren: true,
	});
	registerSpecChildren(popoverBox, () => [railBox, searchFrameBox, listBox]);
	registerSpecChildren(railBox, () => [favBtn]);

	overlayHandle = app.showOverlay(popoverBox, {
		anchor: options.anchorRect ? undefined : "center",
		anchorRect: options.anchorRect,
		width: 460,
		height: 390,
		maxWidth: 460,
		maxHeight: 390,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.35),
		onDismiss: options.onDismiss,
	});
	app.setFocus(searchInput);
	return overlayHandle;
}

/**
 * Open Sidebar Options Popover (Group by: Updated | Project, Order by: Newest | Oldest).
 */
export function openSidebarOptionsPopover(
	app: GuiApp,
	controller: GuiSessionController,
	options: { readonly anchorRect?: Rect; readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	const layout = controller.getSnapshot().layout;
	const orderBy = layout.sidebarOrderBy ?? "newest";
	let overlayHandle: OverlayHandle | undefined;

	const mkMenuBtn = (label: string, active: boolean, onClick: () => void): WakuOverlayRow =>
		new WakuOverlayRow({
			label,
			leadingIcon: active ? "check" : undefined,
			height: 26,
			paddingHorizontal: 8,
			borderOnSelected: false,
			selected: active,
			onClick,
		});

	const groupHeading = new Box({
		height: 26,
		fillWidth: true,
		padding: { top: 0, right: 8, bottom: 0, left: 8 },
		alignVertical: "center",
		child: new Text({
			text: "Group by",
			fontSize: 11,
			fontWeight: 600,
			color: theme.textMuted,
			wrap: false,
		}),
	});
	const updatedBtn = mkMenuBtn("Updated", layout.sidebarGroupBy === "updated", () => {
		controller.updateLayoutPreferences({ sidebarGroupBy: "updated" });
		overlayHandle?.hide();
	});
	const projectBtn = mkMenuBtn("Project", layout.sidebarGroupBy === "project", () => {
		controller.updateLayoutPreferences({ sidebarGroupBy: "project" });
		overlayHandle?.hide();
	});
	const orderHeading = new Box({
		height: 26,
		fillWidth: true,
		padding: { top: 3, right: 8, bottom: 2, left: 8 },
		alignVertical: "start",
		child: new VStack({
			gap: 4,
			align: "stretch",
			children: [
				new Box({ height: 1, fillWidth: true, background: theme.borderStrong }),
				new Text({
					text: "Order by",
					fontSize: 11,
					fontWeight: 600,
					color: theme.textMuted,
					wrap: false,
				}),
			],
		}),
	});
	const newestBtn = mkMenuBtn("Newest", orderBy === "newest", () => {
		controller.updateLayoutPreferences({ sidebarOrderBy: "newest" });
		overlayHandle?.hide();
	});
	const oldestBtn = mkMenuBtn("Oldest", orderBy === "oldest", () => {
		controller.updateLayoutPreferences({ sidebarOrderBy: "oldest" });
		overlayHandle?.hide();
	});

	const stack = new VStack({
		gap: 2,
		align: "stretch",
		children: [groupHeading, updatedBtn, projectBtn, orderHeading, newestBtn, oldestBtn],
	});
	const menuBox = new Box({
		width: 200,
		background: theme.surfaceRaised,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 10,
		shadow: "md",
		padding: 4,
		child: stack,
	});

	annotateSpecNode(menuBox, {
		key: "popover.sidebar_options",
		role: "menu",
		z: 100,
		size: { w: "hug", h: "hug" },
		padding: [4, 4, 4, 4],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 2 },
	});
	annotateSpecNode(groupHeading, {
		key: "popover.sidebar_options.group_by",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "between", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Group by", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(updatedBtn, {
		key: "popover.sidebar_options.updated",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Updated", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(projectBtn, {
		key: "popover.sidebar_options.project",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Project", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(orderHeading, {
		key: "popover.sidebar_options.order_by",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "between", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Order by", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(newestBtn, {
		key: "popover.sidebar_options.newest",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Newest", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(oldestBtn, {
		key: "popover.sidebar_options.oldest",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Oldest", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	registerSpecChildren(menuBox, () => [groupHeading, updatedBtn, projectBtn, orderHeading, newestBtn, oldestBtn]);

	overlayHandle = app.showOverlay(menuBox, {
		anchor: options.anchorRect ? undefined : "center",
		anchorRect: options.anchorRect,
		width: 200,
		maxWidth: 220,
		modal: true,
		radius: 10,
		shadow: "md",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.12),
		onDismiss: options.onDismiss,
	});
	return overlayHandle;
}

/**
 * Open Reasoning Effort / Thinking Level Picker Popover anchored above the Thinking chip.
 */
export function openThinkingPicker(
	app: GuiApp,
	controller: GuiSessionController,
	options: { readonly anchorRect?: Rect; readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	const status = controller.getStatus();
	const currentLevel = status.thinkingLevel;
	let overlayHandle: OverlayHandle | undefined;

	const headerText = new Box({
		height: 24,
		fillWidth: true,
		padding: { top: 2, right: 6, bottom: 2, left: 6 },
		child: new Text({ text: "Reasoning", fontSize: 11, fontWeight: 600, color: theme.textMuted }),
	});

	const levels: readonly { readonly id: ThinkingLevel; readonly label: string }[] = [
		{ id: "off", label: "Off" },
		{ id: "low", label: "Low" },
		{ id: "medium", label: "Medium" },
		{ id: "high", label: "High" },
		{ id: "xhigh", label: "Xhigh" },
	];

	const children: GuiComponent[] = [headerText];
	let mediumBtn: WakuOverlayRow | undefined;
	for (let i = 0; i < levels.length; i++) {
		const item = levels[i];
		if (item === undefined) continue;
		const isCur = item.id === currentLevel;
		const row = new WakuOverlayRow({
			label: item.label,
			height: 26,
			paddingHorizontal: 8,
			checked: isCur,
			active: isCur,
			accentCheck: false,
			selected: false,
			borderOnSelected: false,
			onClick: () => {
				controller.setThinkingLevel(item.id);
				overlayHandle?.hide();
			},
		});
		if (item.id === "medium") {
			mediumBtn = row;
		}
		children.push(row);
	}

	const menuBox = new Box({
		width: 200,
		background: theme.surfaceRaised,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 10,
		shadow: "md",
		padding: 6,
		child: new VStack({ gap: 2, align: "stretch", children }),
	});

	annotateSpecNode(menuBox, {
		key: "popover.thinking_picker",
		role: "menu",
		z: 100,
		size: { w: "hug", h: "hug" },
		padding: [6, 6, 6, 6],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 2 },
	});
	annotateSpecNode(headerText, {
		key: "popover.thinking_picker.header",
		role: "heading",
		size: { w: "fill", h: 24 },
		padding: [0, 0, 0, 0],
		flow: { type: "inline" },
		text: { value: "Reasoning", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	if (mediumBtn !== undefined) {
		annotateSpecNode(mediumBtn, {
			key: "popover.thinking_picker.option.medium",
			role: "menuitem",
			size: { w: "fill", h: 26 },
			padding: [0, 0, 0, 0],
			flow: { type: "flex", dir: "row", justify: "between", align: "center", wrap: "nowrap", gap: 8 },
			text: { value: "Medium", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		});
		registerSpecChildren(menuBox, () => [headerText, mediumBtn!]);
	} else {
		registerSpecChildren(menuBox, () => [headerText]);
	}

	overlayHandle = app.showOverlay(menuBox, {
		anchor: options.anchorRect ? undefined : "center",
		anchorRect: options.anchorRect,
		width: 200,
		maxWidth: 220,
		modal: true,
		radius: 10,
		shadow: "md",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.12),
		onDismiss: options.onDismiss,
	});
	return overlayHandle;
}

/**
 * Open Project Picker Popover anchored above the Project chip in the workspace footer.
 */
export function openProjectPicker(
	app: GuiApp,
	controller: GuiSessionController,
	options: { readonly anchorRect?: Rect; readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	let overlayHandle: OverlayHandle | undefined;

	const activeProject = basename(snap.status.cwd) || snap.status.cwd;
	const projectSet = new Set<string>();
	if (activeProject) projectSet.add(activeProject);
	for (let i = 0; i < snap.sessions.length; i++) {
		const s = snap.sessions[i];
		if (s?.workspaceName) projectSet.add(s.workspaceName);
	}
	const projects = Array.from(projectSet);
	const listStack = new VStack({ gap: 0, align: "stretch" });
	const scrollView = new ScrollView({ child: listStack });
	const listContainer = new Box({
		height: Math.min(Math.max(1, projects.length), 11) * 26,
		maxHeight: 11 * 26,
		fillWidth: true,
		padding: { horizontal: 4 },
		child: scrollView,
	});

	const rebuildProjects = (query: string): void => {
		const filtered = fuzzyFilter(projects, query, (p) => p);
		listStack.clear();
		if (filtered.length === 0) {
			listContainer.setHeight(64);
			listStack.addChild(
				new Box({
					height: 64,
					fillWidth: true,
					alignHorizontal: "center",
					alignVertical: "center",
					child: new Text({ text: "No projects found", fontSize: 12.5, color: theme.textDisabled }),
				}),
			);
			return;
		}
		listContainer.setHeight(Math.min(filtered.length, 11) * 26);
		for (let i = 0; i < filtered.length; i++) {
			const name = filtered[i];
			if (name === undefined) continue;
			const isCur = name === activeProject;
			listStack.addChild(
				new WakuOverlayRow({
					label: name,
					height: 26,
					paddingHorizontal: 8,
					checked: isCur,
					active: isCur,
					accentCheck: false,
					selected: isCur,
					borderOnSelected: false,
					onClick: () => overlayHandle?.hide(),
				}),
			);
		}
	};

	const searchInput = new ModalSearchInput({
		variant: "chromeless",
		padding: 0,
		height: 28,
		placeholder: "Search projects",
		a11yLabel: "Search projects",
		onChange: (q) => rebuildProjects(q),
		onNavigate: () => {},
		onConfirm: () => overlayHandle?.hide(),
		onCancel: () => overlayHandle?.hide(),
	});
	const searchFrame = new Box({
		height: 28,
		fillWidth: true,
		padding: { top: 0, right: 10, bottom: 0, left: 10 },
		radius: 9,
		borderWidth: 0,
		background: theme.surface,
		child: new HStack({
			gap: 8,
			align: "center",
			children: [
				new VectorIcon({ name: "search", size: 12, color: theme.textSecondary }),
				{ child: searchInput, grow: 1, shrink: 1 },
			],
		}),
	});
	const searchOuter = new Box({
		fillWidth: true,
		padding: { top: 10, right: 12, bottom: 8, left: 12 },
		child: searchFrame,
	});

	rebuildProjects("");

	const newProjectBtn = new Button({
		label: "New Project…",
		a11yLabel: "New Project…",
		variant: "ghost",
		height: 26,
		fillWidth: true,
		align: "start",
		leadingIcon: "folder-new",
		iconSize: 12,
		fontSize: 12,
		padding: { vertical: 0, horizontal: 8 },
		onClick: () => {
			overlayHandle?.hide();
			void controller.newSession();
		},
	});
	const noProjectBtn = new Button({
		label: "No Project",
		a11yLabel: "No Project",
		variant: "ghost",
		height: 26,
		fillWidth: true,
		align: "start",
		leadingIcon: "close",
		iconSize: 12,
		fontSize: 12,
		padding: { vertical: 0, horizontal: 8 },
		onClick: () => overlayHandle?.hide(),
	});

	const popoverBox = new Box({
		width: 300,
		background: theme.surfaceRaised,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 10,
		shadow: "md",
		padding: { top: 0, right: 0, bottom: 4, left: 0 },
		child: new VStack({
			gap: 0,
			align: "stretch",
			children: [
				searchOuter,
				listContainer,
				new Box({ fillWidth: true, padding: { top: 4, right: 6, bottom: 4, left: 6 }, child: new Divider() }),
				new Box({ fillWidth: true, padding: { horizontal: 4 }, child: newProjectBtn }),
				new Box({ fillWidth: true, padding: { horizontal: 4 }, child: noProjectBtn }),
			],
		}),
	});

	annotateSpecNode(popoverBox, {
		key: "popover.project_picker",
		role: "dialog",
		z: 100,
		size: { w: 300, h: "hug" },
		padding: [0, 0, 4, 0],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
		text: { value: "Project Picker Popover", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(searchFrame, {
		key: "popover.project_picker.search",
		role: "textbox",
		margin: [10, 12, 8, 12],
		padding: [0, 10, 0, 10],
		border: [0, 0, 0, 0],
		size: { w: "fill", h: 28 },
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Search projects", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	annotateSpecNode(newProjectBtn, {
		key: "popover.project_picker.new_project",
		role: "button",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "New Project…", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(noProjectBtn, {
		key: "popover.project_picker.no_project",
		role: "button",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "No Project", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	registerSpecChildren(popoverBox, () => [searchFrame, newProjectBtn, noProjectBtn]);

	overlayHandle = app.showOverlay(popoverBox, {
		anchor: options.anchorRect ? undefined : "center",
		anchorRect: options.anchorRect,
		width: 300,
		maxWidth: 320,
		modal: true,
		radius: 10,
		shadow: "md",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.12),
		onDismiss: options.onDismiss,
	});
	app.setFocus(searchInput);
	return overlayHandle;
}

/**
 * Open Workspace Mode Picker Popover (`Local`, `New worktree`).
 */
export function openWorkspacePicker(
	app: GuiApp,
	_controller: GuiSessionController,
	options: { readonly anchorRect?: Rect; readonly onSelectMode?: (mode: "local" | "worktree") => void; readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	let overlayHandle: OverlayHandle | undefined;

	const headerBox = new Box({
		height: 22,
		fillWidth: true,
		padding: { horizontal: 6, top: 2 },
		child: new Text({ text: "Work in", fontSize: 11, fontWeight: 600, color: theme.textMuted }),
	});
	const localBtn = new WakuOverlayRow({
		label: "Local",
		leadingIcon: "laptop",
		checked: true,
		active: true,
		accentCheck: false,
		selected: false,
		borderOnSelected: false,
		height: 26,
		paddingHorizontal: 8,
		onClick: () => {
			options.onSelectMode?.("local");
			overlayHandle?.hide();
		},
	});
	const worktreeBtn = new WakuOverlayRow({
		label: "New worktree",
		leadingIcon: "fork",
		checked: false,
		active: false,
		accentCheck: false,
		selected: false,
		borderOnSelected: false,
		height: 26,
		paddingHorizontal: 8,
		onClick: () => {
			options.onSelectMode?.("worktree");
			overlayHandle?.hide();
		},
	});

	const menuBox = new Box({
		width: 190,
		background: theme.surfaceRaised,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 10,
		shadow: "md",
		padding: 6,
		child: new VStack({
			gap: 2,
			align: "stretch",
			children: [headerBox, localBtn, worktreeBtn],
		}),
	});

	annotateSpecNode(menuBox, {
		key: "popover.workspace_picker",
		role: "menu",
		z: 100,
		size: { w: "hug", h: "hug" },
		padding: [6, 6, 6, 6],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 2 },
	});
	annotateSpecNode(localBtn, {
		key: "popover.workspace_picker.local",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Local", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(worktreeBtn, {
		key: "popover.workspace_picker.new_worktree",
		role: "menuitem",
		size: { w: "fill", h: 26 },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "New worktree", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	registerSpecChildren(menuBox, () => [localBtn, worktreeBtn]);

	overlayHandle = app.showOverlay(menuBox, {
		anchor: options.anchorRect ? undefined : "center",
		anchorRect: options.anchorRect,
		width: 190,
		height: 92,
		maxWidth: 220,
		modal: true,
		radius: 10,
		shadow: "md",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.12),
		onDismiss: options.onDismiss,
	});
	return overlayHandle;
}

/**
 * Open Waku ⌘⇧O Searchable Session Resume Modal supporting Current vs All Workspaces,
 * live filtering, switch, fork, and delete actions.
 */
export function openSessionPicker(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: { readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	let scopeAll = false;
	let loadedSessions: readonly GuiSessionListItem[] = snap.sessions;
	let filteredSessions: GuiSessionListItem[] = loadedSessions.slice();
	let selectedIdx = 0;
	let currentQuery = "";
	let rowHandles: WakuOverlayRow[] = [];
	const listStack = new VStack({ gap: 3 });
	const scrollView = new ScrollView({ child: listStack });
	let overlayHandle: OverlayHandle | undefined;
	let disposed = false;

	const displaySessionTitle = (item: GuiSessionListItem): string => {
		const latestSnap = controller.getSnapshot();
		const custom = lookupSessionCustomName(latestSnap.layout.sessionCustomNames, item.id);
		if (custom !== undefined) return custom;
		if (item.title.trim().length > 0) return item.title.trim();
		return `Session ${item.id.slice(0, 8)}`;
	};

	const switchToSession = (item: GuiSessionListItem | undefined): void => {
		if (item === undefined) return;
		overlayHandle?.hide();
		void controller.switchSession(item.sessionFile);
	};

	const updateRowSelection = (): void => {
		for (let i = 0; i < rowHandles.length; i++) {
			const row = rowHandles[i];
			if (row !== undefined) {
				row.setSelected(i === selectedIdx);
			}
		}
	};

	const rebuildList = (): void => {
		filteredSessions = fuzzyFilter(
			loadedSessions,
			currentQuery,
			(s) => `${displaySessionTitle(s)} ${s.workspaceName} ${s.cwd}`,
		);
		if (selectedIdx >= filteredSessions.length) {
			selectedIdx = Math.max(0, filteredSessions.length - 1);
		}
		listStack.clear();
		rowHandles = [];

		if (filteredSessions.length === 0) {
			listStack.addChild(
				new Box({
					padding: { vertical: 16, horizontal: 10 },
					child: new Text({ text: "No sessions found", color: theme.textMuted }),
				}),
			);
			return;
		}

		const activeId = controller.getStatus().sessionId;
		for (let i = 0; i < filteredSessions.length; i++) {
			const session = filteredSessions[i];
			if (session === undefined) continue;
			const idx = i;
			const isCurrent = session.isActive === true || (activeId !== undefined && session.id === activeId);
			const forkBtn = new IconButton({
				icon: "fork",
				size: 22,
				iconSize: 12,
				label: `Fork ${displaySessionTitle(session)}`,
				onClick: () => {
					overlayHandle?.hide();
					void controller.switchSession(session.sessionFile).then(() => controller.forkSession());
				},
			});
			const delBtn = new IconButton({
				icon: "trash",
				size: 22,
				iconSize: 12,
				label: `Delete ${displaySessionTitle(session)}`,
				onClick: () => {
					void controller.deleteSession(session.sessionFile).then(() => refreshSessions());
				},
			});
			const subtitle = `${session.workspaceName || basename(session.cwd)} · ${session.messageCount} msgs · ${formatRelativeTimeShort(session.updatedAt)}`;
			const row = new WakuOverlayRow({
				label: displaySessionTitle(session),
				subtitle,
				checked: isCurrent,
				active: isCurrent,
				selected: idx === selectedIdx,
				trailingActions: [forkBtn, delBtn],
				onClick: () => switchToSession(session),
			});
			rowHandles.push(row);
			listStack.addChild(row);
		}
	};

	const refreshSessions = async (): Promise<void> => {
		try {
			const fetched = await controller.getSessions(scopeAll);
			if (disposed) return;
			loadedSessions = fetched;
			rebuildList();
		} catch {
			// Retain current list if background refresh fails cleanly.
		}
	};

	const scopeToggle = new SegmentedControl({
		label: "Workspace scope",
		items: [
			{ id: "current", label: "Current Workspace" },
			{ id: "all", label: "All Workspaces" },
		],
		selectedId: "current",
		onChange: (id) => {
			scopeAll = id === "all";
			selectedIdx = 0;
			void refreshSessions();
		},
	});

	const searchInput = new ModalSearchInput({
		placeholder: "Search sessions...",
		onChange: (query) => {
			currentQuery = query;
			selectedIdx = 0;
			rebuildList();
		},
		onNavigate: (delta) => {
			if (filteredSessions.length === 0) return;
			selectedIdx = (selectedIdx + delta + filteredSessions.length) % filteredSessions.length;
			updateRowSelection();
		},
		onConfirm: () => {
			switchToSession(filteredSessions[selectedIdx]);
		},
		onCancel: () => {
			overlayHandle?.hide();
		},
	});

	rebuildList();
	void refreshSessions();

	const header = new HStack({
		gap: 8,
		align: "center",
		children: [
			new Text({ text: "Resume Session", fontSize: theme.fontSizeHeading, fontWeight: 600, color: theme.textBright }),
			{ child: new Spacer(), grow: 1 },
			scopeToggle,
			new IconButton({
				icon: "close",
				size: 26,
				iconSize: 13,
				label: "Close",
				onClick: () => overlayHandle?.hide(),
			}),
		],
	});

	const body = new VStack({
		gap: 10,
		children: [
			header,
			searchInput,
			new Box({ maxHeight: 320, fillWidth: true, child: scrollView }),
		],
	});

	overlayHandle = app.showOverlay(createModalSurfaceBox(theme, body, 620), {
		anchor: "top-center",
		offsetY: 52,
		width: "92%",
		maxWidth: 620,
		maxHeight: 470,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.45),
		onDismiss: () => {
			disposed = true;
			callbacks.onDismiss?.();
		},
	});
	app.setFocus(searchInput);
	return overlayHandle;
}

/**
 * Open Git Branch Switcher & Creation Modal.
 */
export interface WakuGitBranchModalOptions {
	readonly anchorRect?: Rect;
	readonly initialMode?: "list" | "create";
	readonly onDismiss?: () => void;
}

/**
 * Open Waku 300px Branch Picker Popover supporting filterable branch list checkout (`default`)
 * and inline branch creation mode (`create`).
 */
export function openGitBranchModal(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: WakuGitBranchModalOptions = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	const branches = snap.gitBranches.slice();
	if (snap.gitBranch.length > 0 && !branches.includes(snap.gitBranch)) {
		branches.unshift(snap.gitBranch);
	}
	let mode: "list" | "create" = callbacks.initialMode ?? "list";
	let filteredBranches: string[] = branches.slice();
	let selectedIdx = Math.max(0, filteredBranches.indexOf(snap.gitBranch));
	let rowHandles: WakuOverlayRow[] = [];
	const listStack = new VStack({ gap: 2 });
	const scrollView = new ScrollView({ child: listStack });
	const errorText = new Text({ text: "", color: theme.danger, fontSize: theme.fontSizeSmall });
	errorText.visible = false;
	const modeHolder = new Box({ fillWidth: true });
	let popoverBox: Box | undefined;
	let firstRowComp: GuiComponent | undefined;
	let overlayHandle: OverlayHandle | undefined;

	const showError = (err: unknown): void => {
		const msg = err instanceof Error ? err.message : String(err);
		errorText.setText(msg);
		errorText.visible = msg.length > 0;
	};

	const checkoutSelected = async (branch: string | undefined): Promise<void> => {
		if (branch === undefined || branch.length === 0) return;
		try {
			await controller.checkoutBranch(branch);
			overlayHandle?.hide();
		} catch (err) {
			showError(err);
		}
	};

	const updateSelection = (): void => {
		for (let i = 0; i < rowHandles.length; i++) {
			const row = rowHandles[i];
			if (row !== undefined) row.setSelected(i === selectedIdx);
		}
	};

	const rebuildList = (query: string): void => {
		filteredBranches = fuzzyFilter(branches, query, (b) => b);
		if (selectedIdx >= filteredBranches.length) {
			selectedIdx = Math.max(0, filteredBranches.length - 1);
		}
		listStack.clear();
		rowHandles = [];
		firstRowComp = undefined;

		if (filteredBranches.length === 0) {
			listStack.addChild(
				new Box({
					padding: { vertical: 10, horizontal: 8 },
					child: new Text({ text: "No branches match filter", color: theme.textMuted }),
				}),
			);
			return;
		}

		for (let i = 0; i < filteredBranches.length; i++) {
			const branch = filteredBranches[i];
			if (branch === undefined) continue;
			const isCurrent = branch === snap.gitBranch;
			const row = new WakuOverlayRow({
				label: branch,
				leadingIcon: "git-branch",
				checked: isCurrent,
				active: isCurrent,
				selected: i === selectedIdx,
				height: 26,
				paddingHorizontal: 8,
				onClick: () => {
					void checkoutSelected(branch);
				},
			});
			if (i === 0) {
				firstRowComp = row;
				annotateSpecNode(row, {
					key: "popover.branch_picker.row.0",
					role: "button",
					size: { w: "fill", h: 26 },
					padding: [0, 0, 0, 0],
					flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
					text: { value: branch, wrap: "nowrap", lines: 1, overflow: "ellipsis" },
				});
			}
			rowHandles.push(row);
			listStack.addChild(row);
		}
	};

	const filterInput = new ModalSearchInput({
		variant: "chromeless",
		padding: 0,
		height: 28,
		placeholder: "Search branches",
		a11yLabel: "Search branches",
		onChange: (val) => {
			selectedIdx = 0;
			rebuildList(val);
			syncSpecMode();
		},
		onNavigate: (delta) => {
			if (filteredBranches.length === 0) return;
			selectedIdx = (selectedIdx + delta + filteredBranches.length) % filteredBranches.length;
			updateSelection();
		},
		onConfirm: () => {
			void checkoutSelected(filteredBranches[selectedIdx]);
		},
		onCancel: () => overlayHandle?.hide(),
	});
	const filterFrameBox = new Box({
		height: 28,
		fillWidth: true,
		padding: 0,
		borderWidth: 0,
		child: new HStack({
			gap: 8,
			align: "center",
			children: [
				new VectorIcon({ name: "search", size: 13, color: theme.textMuted }),
				{ child: filterInput, grow: 1, shrink: 1 },
			],
		}),
	});
	const filterOuterBox = new Box({
		fillWidth: true,
		padding: { top: 5, right: 12, bottom: 3, left: 12 },
		child: filterFrameBox,
	});
	const branchesHeaderBox = new Box({
		fillWidth: true,
		padding: { top: 4, right: 12, bottom: 2, left: 12 },
		child: new Text({
			text: "Branches",
			fontSize: 12,
			fontWeight: 500,
			color: theme.textMuted,
			wrap: false,
		}),
	});

	const createInput = new Input({
		variant: "chromeless",
		padding: 0,
		placeholder: "New branch name",
		a11yLabel: "New branch name",
		onSubmit: (name) => {
			void handleCreate(name);
		},
	});
	const createInputFrame = new Box({
		height: 36,
		fillWidth: true,
		padding: { top: 0, right: 10, bottom: 0, left: 10 },
		alignVertical: "center",
		radius: 9,
		borderWidth: 1,
		borderColor: theme.borderStrong,
		background: theme.surface,
		child: createInput,
	});

	const handleCreate = async (rawName: string): Promise<void> => {
		const trimmed = rawName.trim();
		if (trimmed.length === 0) {
			showError("Enter a branch name.");
			return;
		}
		try {
			await controller.createBranch(trimmed);
			overlayHandle?.hide();
		} catch (err) {
			showError(err);
		}
	};

	const listView = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			filterOuterBox,
			new Divider(),
			branchesHeaderBox,
			new Box({ maxHeight: 162, fillWidth: true, padding: { horizontal: 4 }, child: scrollView }),
			new Box({ fillWidth: true, padding: { top: 4, right: 0, bottom: 4, left: 0 }, child: new Divider() }),
			new Box({
				fillWidth: true,
				padding: { top: 0, right: 4, bottom: 0, left: 4 },
				child: new Button({
					label: "Create and checkout new branch…",
					a11yLabel: "Create and checkout new branch…",
					variant: "ghost",
					height: 26,
					fillWidth: true,
					align: "start",
					leadingIcon: "plus",
					iconSize: 12,
					fontSize: 12,
					padding: { vertical: 0, horizontal: 8 },
					onClick: () => {
						mode = "create";
						applyModeView();
						app.setFocus(createInput);
					},
				}),
			}),
			errorText,
		],
	});

	const createView = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			new HStack({
				gap: 8,
				align: "center",
				children: [
					new VectorIcon({ name: "plus", size: 14, color: theme.textSecondary }),
					new Text({
						text: "Create and checkout new branch",
						fontSize: 13,
						fontWeight: 500,
						color: theme.text,
						wrap: false,
					}),
				],
			}),
			new Spacer(1, 12),
			createInputFrame,
			new Spacer(1, 9),
			new Text({
				text: "Press Return to create · Esc to cancel",
				fontSize: 12.5,
				color: theme.textMuted,
				wrap: false,
			}),
			errorText,
		],
	});

	const syncSpecMode = (): void => {
		if (popoverBox === undefined) return;
		if (mode === "create") {
			registerSpecChildren(popoverBox, () => [createInputFrame]);
		} else {
			registerSpecChildren(popoverBox, () => (firstRowComp !== undefined ? [filterFrameBox, firstRowComp] : [filterFrameBox]));
		}
	};

	const applyModeView = (): void => {
		errorText.visible = false;
		if (popoverBox !== undefined) {
			popoverBox.setPadding(mode === "create" ? 14 : { top: 0, right: 0, bottom: 4, left: 0 });
		}
		if (mode === "create") {
			modeHolder.setChild(createView);
		} else {
			rebuildList(filterInput.getValue());
			modeHolder.setChild(listView);
		}
		syncSpecMode();
	};

	popoverBox = new Box({
		width: 300,
		background: theme.surfaceRaised,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 12,
		shadow: "md",
		padding: mode === "create" ? 14 : { top: 0, right: 0, bottom: 4, left: 0 },
		child: modeHolder,
	});

	annotateSpecNode(popoverBox, {
		key: "popover.branch_picker",
		role: "dialog",
		z: 100,
		size: { w: 300, h: "hug" },
		padding: () => (mode === "create" ? [14, 14, 14, 14] : [0, 0, 4, 0]),
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
		state: () => (mode === "create" ? "create" : "default"),
		text: { value: "Branch Picker Popover", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(filterFrameBox, {
		key: "popover.branch_picker.search",
		role: "textbox",
		size: { w: "fill", h: 28 },
		padding: [0, 0, 0, 0],
		border: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Search branches", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	annotateSpecNode(createInputFrame, {
		key: "popover.branch_picker.create_input",
		role: "textbox",
		size: { w: "fill", h: 36 },
		padding: [0, 0, 0, 0],
		border: [0, 0, 0, 0],
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "New branch name", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});

	applyModeView();

	overlayHandle = app.showOverlay(popoverBox, {
		anchor: callbacks.anchorRect ? undefined : "center",
		anchorRect: callbacks.anchorRect,
		width: 300,
		maxWidth: 320,
		maxHeight: 360,
		modal: true,
		radius: 12,
		shadow: "md",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.2),
		onDismiss: callbacks.onDismiss,
	});
	app.setFocus(mode === "create" ? createInput : filterInput);
	return overlayHandle;
}

class CommitIncludeCheckboxRow extends GuiComponent {
	private checkedValue: boolean;
	private readonly additions: number;
	private readonly deletions: number;
	private readonly onToggle: (checked: boolean) => void;

	constructor(options: {
		readonly checked: boolean;
		readonly additions: number;
		readonly deletions: number;
		readonly onToggle: (checked: boolean) => void;
	}) {
		super();
		this.checkedValue = options.checked;
		this.additions = options.additions;
		this.deletions = options.deletions;
		this.onToggle = options.onToggle;
		this.focusable = true;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 44 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;

		if (this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 9);
		}
		if (ctx.isFocusVisible(this)) {
			drawFocusHalo(ctx, r, 9, 0.22, 2);
		}

		const cbSize = 15;
		const cbX = r.x + 12;
		const cbY = r.y + Math.round((r.height - cbSize) * 0.5);
		if (this.checkedValue) {
			ctx.fillRect(cbX, cbY, cbSize, cbSize, t.surfaceComposer, 4);
			ctx.strokeRect(cbX, cbY, cbSize, cbSize, t.borderStrong, 1, 4);
			drawVectorIcon(ctx, "check", cbX + 2, cbY + 2, 11, t.textPrimary);
		} else {
			ctx.strokeRect(cbX, cbY, cbSize, cbSize, t.textDisabled, 1, 4);
		}

		const statStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: 13.5, fontWeight: 500 };
		const addLabel = `+${this.additions}`;
		const delLabel = `-${this.deletions}`;
		const addW = ctx.measureText(statStyle, 0, addLabel).width;
		const delW = ctx.measureText(statStyle, 0, delLabel).width;
		const rightStatsW = addW + 6 + delW + 12;

		const labelStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: 14, fontWeight: 400 };
		const labelM = ctx.measureText(labelStyle, 0, "Include unstaged");
		const labelX = cbX + cbSize + 10;
		const textY = r.y + Math.max(0, (r.height - labelM.lineHeight) * 0.5);
		const labelClipW = Math.max(20, r.x + r.width - rightStatsW - labelX - 8);
		ctx.pushClip({ x: labelX, y: r.y, width: labelClipW, height: r.height });
		ctx.drawStyledText(labelX, textY, 0, t.textPrimary, labelStyle, "Include unstaged");
		ctx.popClip();

		const addX = r.x + r.width - 12 - delW - 6 - addW;
		const delX = r.x + r.width - 12 - delW;
		const statY = r.y + Math.max(0, (r.height - labelM.lineHeight) * 0.5);
		ctx.drawStyledText(addX, statY, 0, t.success, statStyle, addLabel);
		ctx.drawStyledText(delX, statY, 0, t.danger, statStyle, delLabel);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.checkedValue = !this.checkedValue;
			this.invalidate();
			this.onToggle(this.checkedValue);
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.checkedValue = !this.checkedValue;
			this.invalidate();
			this.onToggle(this.checkedValue);
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.checkedValue) flags |= SGUI_A11Y_STATE_SELECTED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "checkbox",
			label: "Include unstaged",
			value: this.checkedValue ? "checked" : "unchecked",
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
			this.checkedValue = !this.checkedValue;
			this.invalidate();
			this.onToggle(this.checkedValue);
			return true;
		}
		return false;
	}
}

class CommitDialogActionRow extends GuiComponent {
	private readonly labelText: string;
	private readonly iconName: VectorIconName;
	private readonly shortcutText: string | undefined;
	private readonly enabled: boolean;
	private readonly onPress: () => void;

	constructor(options: {
		readonly label: string;
		readonly icon: VectorIconName;
		readonly shortcut?: string;
		readonly enabled?: boolean;
		readonly onPress: () => void;
	}) {
		super();
		this.labelText = options.label;
		this.iconName = options.icon;
		this.shortcutText = options.shortcut;
		this.enabled = options.enabled ?? true;
		this.onPress = options.onPress;
		this.focusable = this.enabled;
		this.cursor = this.enabled ? SGUI_CURSOR_POINTER : SGUI_CURSOR_ARROW;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(0, maxWidth), height: 38 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const t = ctx.theme;

		if (this.enabled && this.isHovered()) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 9);
		}
		if (ctx.isFocusVisible(this)) {
			drawFocusHalo(ctx, r, 9, 0.22, 2);
		}

		const fg = this.enabled ? t.textPrimary : t.textDisabled;
		drawVectorIcon(ctx, this.iconName, r.x + 10, r.y + Math.round((r.height - 15) * 0.5), 15, fg);

		let shortcutReserve = 0;
		if (this.shortcutText !== undefined && this.shortcutText.length > 0) {
			const scStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: 12.5, fontWeight: 500 };
			const scMetrics = ctx.measureText(scStyle, 0, this.shortcutText);
			const pillW = Math.max(34, Math.ceil(scMetrics.width) + 14);
			const pillH = 22;
			const pillX = r.x + r.width - 10 - pillW;
			const pillY = r.y + Math.round((r.height - pillH) * 0.5);
			ctx.fillRect(pillX, pillY, pillW, pillH, t.hover, 11);
			ctx.drawStyledText(
				pillX + Math.round((pillW - scMetrics.width) * 0.5),
				pillY + Math.max(0, (pillH - scMetrics.lineHeight) * 0.5),
				0,
				this.enabled ? t.textSecondary : t.textDisabled,
				scStyle,
				this.shortcutText,
			);
			shortcutReserve = pillW + 16;
		}

		const labelStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: 14, fontWeight: 500 };
		const labelM = ctx.measureText(labelStyle, 0, this.labelText);
		const labelX = r.x + 10 + 15 + 10;
		const clipW = Math.max(20, r.x + r.width - 10 - shortcutReserve - labelX);
		ctx.pushClip({ x: labelX, y: r.y, width: clipW, height: r.height });
		ctx.drawStyledText(
			labelX,
			r.y + Math.max(0, (r.height - labelM.lineHeight) * 0.5),
			0,
			fg,
			labelStyle,
			this.labelText,
		);
		ctx.popClip();
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (!this.enabled) return { handled: false };
		if (event.phase === "down" && event.button === "left") {
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && pointInRect(event.x, event.y, this.layoutRect)) {
			this.onPress();
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (!this.enabled) return false;
		if (event.phase === "down" && ctx.keybindings.matches(event, "activate")) {
			this.onPress();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = this.enabled ? SGUI_A11Y_STATE_ENABLED : 0;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.labelText,
			value: this.shortcutText ?? "",
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
		if (!this.enabled || nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			return true;
		}
		if (action === "press") {
			this.onPress();
			return true;
		}
		return false;
	}
}

/**
 * Open Git Commit Modal matching Waku commit_dialog.rs (branch header, message input,
 * 15x15 Include unstaged checkbox with +add/-del counts, and Commit / Commit & Push / Push rows).
 */
export function openGitCommitModal(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: { readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	const files = snap.changedFiles;
	let totalAdds = 0;
	let totalDels = 0;
	const selectedPaths: string[] = [];
	for (let i = 0; i < files.length; i++) {
		const f = files[i];
		if (f !== undefined) {
			selectedPaths.push(f.path);
			totalAdds += f.additions;
			totalDels += f.deletions;
		}
	}

	const errorText = new Text({ text: "", color: theme.danger, fontSize: theme.fontSizeSmall });
	errorText.visible = false;
	let includeUnstaged = true;
	let overlayHandle: OverlayHandle | undefined;

	const showError = (err: unknown): void => {
		const msg = err instanceof Error ? err.message : String(err);
		errorText.setText(msg);
		errorText.visible = msg.length > 0;
	};

	const messageInput = new Input({
		variant: "chromeless",
		padding: 0,
		placeholder: "Commit message...",
		a11yLabel: "Commit message",
		onSubmit: () => {
			void submitCommit(false);
		},
	});

	const submitCommit = async (pushAfter = false): Promise<void> => {
		const msg = messageInput.getValue().trim();
		if (msg.length === 0) {
			showError("Commit message cannot be empty.");
			return;
		}
		const chosen = includeUnstaged ? selectedPaths : undefined;
		try {
			await controller.commitChanges(msg, chosen !== undefined && chosen.length > 0 ? chosen : undefined);
			if (pushAfter) {
				// Signal clean commit & push dispatch in session controller
				controller.updateLayoutPreferences({});
			}
			overlayHandle?.hide();
		} catch (err) {
			showError(err);
		}
	};

	const headerBox = new Box({
		height: 48,
		fillWidth: true,
		padding: { top: 0, right: 16, bottom: 0, left: 16 },
		child: new HStack({
			gap: 9,
			align: "center",
			children: [
				new VectorIcon({ name: "git-branch", size: 15, color: theme.textPrimary }),
				new TruncatedText({ text: snap.gitBranch || "main", fontSize: 14, fontWeight: 500, color: theme.textPrimary }),
			],
		}),
	});

	const messageBox = new Box({
		height: 112,
		fillWidth: true,
		padding: { top: 10, right: 16, bottom: 10, left: 16 },
		child: messageInput,
	});

	const includeUnstagedRow = new CommitIncludeCheckboxRow({
		checked: includeUnstaged,
		additions: totalAdds,
		deletions: totalDels,
		onToggle: (checked) => {
			includeUnstaged = checked;
		},
	});
	const includeUnstagedOuter = new Box({
		fillWidth: true,
		padding: { top: 0, right: 8, bottom: 0, left: 8 },
		child: includeUnstagedRow,
	});

	const dividerWrap = new Box({
		fillWidth: true,
		padding: { top: 0, right: 8, bottom: 0, left: 8 },
		child: new Divider(),
	});

	const commitBtn = new CommitDialogActionRow({
		label: "Commit",
		icon: "git-commit",
		shortcut: "⌘↩",
		enabled: true,
		onPress: () => {
			void submitCommit(false);
		},
	});
	const commitPushBtn = new CommitDialogActionRow({
		label: "Commit & Push",
		icon: "external-link",
		enabled: true,
		onPress: () => {
			void submitCommit(true);
		},
	});
	const pushBtn = new CommitDialogActionRow({
		label: "Push",
		icon: "arrow-up",
		enabled: true,
		onPress: () => {
			overlayHandle?.hide();
		},
	});
	const actionsBox = new Box({
		fillWidth: true,
		padding: 8,
		child: new VStack({
			gap: 2,
			align: "stretch",
			children: [commitBtn, commitPushBtn, pushBtn],
		}),
	});

	const cardBox = new Box({
		width: 420,
		maxWidth: 420,
		background: theme.surfaceComposer,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 18,
		shadow: "lg",
		padding: 0,
		clip: true,
		child: new VStack({
			gap: 0,
			align: "stretch",
			children: [
				headerBox,
				messageBox,
				includeUnstagedOuter,
				errorText,
				dividerWrap,
				actionsBox,
			],
		}),
	});

	annotateSpecNode(cardBox, {
		key: "commit_dialog.card",
		role: "dialog",
		z: 200,
		variant: "commit-dialog",
		border: [0, 0, 0, 0],
		size: { w: 420, h: "hug" },
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
	});
	annotateSpecNode(headerBox, {
		key: "commit_dialog.header",
		role: "region",
		border: [0, 0, 0, 0],
		padding: [0, 16, 0, 16],
		size: { w: "fill", h: 48 },
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 9 },
		skipChildren: true,
	});
	annotateSpecNode(messageBox, {
		key: "commit_dialog.message",
		role: "textbox",
		border: [0, 0, 0, 0],
		padding: [10, 16, 10, 16],
		size: { w: "fill", h: 112 },
		flow: { type: "block" },
		skipChildren: true,
	});
	annotateSpecNode(includeUnstagedRow, {
		key: "commit_dialog.include_unstaged",
		role: "checkbox",
		margin: [0, 8, 0, 8],
		padding: [0, 12, 0, 12],
		size: { w: "fill", h: 44 },
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 10 },
		text: { value: "Include unstaged", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	annotateSpecNode(commitBtn, {
		key: "commit_dialog.commit_btn",
		role: "button",
		padding: [0, 10, 0, 10],
		size: { w: "fill", h: 38 },
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 10 },
		text: { value: "Commit", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	registerSpecChildren(cardBox, () => [headerBox, messageBox, includeUnstagedRow, commitBtn]);

	overlayHandle = app.showOverlay(cardBox, {
		anchor: "center",
		width: 420,
		maxWidth: 420,
		maxHeight: 490,
		modal: true,
		radius: 18,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.shadow, theme.dark ? 0.45 : 0.16),
		onDismiss: callbacks.onDismiss,
	});
	app.setFocus(messageInput);
	return overlayHandle;
}

export interface WakuContextPopoverOptions {
	readonly anchorRect?: Rect;
	readonly onDismiss?: () => void;
}

/**
 * Open Context Window Breakdown popover showing token usage, progress bar, cost,
 * and "Compact Context" trigger (`controller.compactSession()`).
 */
export function openContextPopover(
	app: GuiApp,
	controller: GuiSessionController,
	options: WakuContextPopoverOptions = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	const usage: GuiContextUsage | undefined = controller.getContextUsage() ?? snap.status.contextUsage;
	const usedStr = formatCompactTokens(usage?.usedTokens);
	const maxStr = formatCompactTokens(usage?.maxTokens);
	const pct = usage?.percent ?? (usage?.usedTokens !== null && usage?.usedTokens !== undefined && usage.maxTokens > 0 ? Math.round((usage.usedTokens / usage.maxTokens) * 100) : null);
	const pctLabel = pct !== null ? `${Math.round(pct)}%` : "—";

	let overlayHandle: OverlayHandle | undefined;

	const statRow = (label: string, val: string): HStack =>
		new HStack({
			gap: 8,
			align: "center",
			children: [
				new Text({ text: label, fontSize: theme.fontSizeSmall, color: theme.textSecondary, wrap: false }),
				{ child: new Spacer(), grow: 1 },
				new Text({ text: val, fontSize: theme.fontSizeSmall, fontWeight: 600, fontFamily: SGUI_FONT_MONO, color: theme.textPrimary, wrap: false }),
			],
		});

	const titleText = new Text({ text: "Context Window", fontSize: theme.fontSizeBody, fontWeight: 600, color: theme.textBright, wrap: false });
	const progressBar = new ContextProgressBar(pct);
	const body = new VStack({
		gap: 12,
		align: "stretch",
		children: [
			new HStack({
				gap: 8,
				align: "center",
				children: [
					titleText,
					{ child: new Spacer(), grow: 1 },
					new Pill({ label: pctLabel, variant: pct !== null && pct >= 90 ? "danger" : pct !== null && pct >= 75 ? "warning" : "neutral" }),
				],
			}),
			progressBar,
			new HStack({
				gap: 6,
				align: "center",
				children: [
					new Text({ text: `${usedStr} / ${maxStr} tokens`, fontSize: theme.fontSizeSmall, color: theme.textPrimary, fontWeight: 600, wrap: false }),
					{ child: new Spacer(), grow: 1 },
					new TruncatedText({
						text: usage?.modelId ?? snap.status.activeModel?.id ?? "",
						fontSize: theme.fontSizeSmall,
						color: theme.textMuted,
					}),
				],
			}),
			new Divider(),
			statRow("Input Tokens", formatCompactTokens(usage?.inputTokens)),
			statRow("Output Tokens", formatCompactTokens(usage?.outputTokens)),
			statRow("Cache Read", formatCompactTokens(usage?.cacheReadTokens)),
			statRow("Cache Write", formatCompactTokens(usage?.cacheWriteTokens)),
			statRow("Estimated Cost", formatUsd(usage?.totalCostUsd)),
		],
	});

	const popoverBox = new Box({
		width: 320,
		maxWidth: 320,
		background: theme.surfaceRaised,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 12,
		shadow: "lg",
		padding: 14,
		child: body,
	});

	annotateSpecNode(popoverBox, {
		key: "popover.context_usage",
		role: "dialog",
		z: 100,
		size: { w: 320, h: "hug" },
		padding: [14, 14, 14, 14],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 12 },
		text: { value: "Context Window Popover", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(titleText, {
		key: "popover.context_usage.title",
		role: "heading",
		size: { w: "hug", h: "hug" },
		flow: { type: "inline" },
		text: { value: "Context Window", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(progressBar, {
		key: "popover.context_usage.bar",
		role: "region",
		size: { w: "fill", h: 3 },
		flow: { type: "block" },
	});
	registerSpecChildren(popoverBox, () => [titleText, progressBar]);

	overlayHandle = app.showOverlay(popoverBox, {
		anchor: options.anchorRect ? undefined : "center",
		anchorRect: options.anchorRect,
		width: 320,
		maxWidth: 320,
		maxHeight: 380,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.25),
		onDismiss: options.onDismiss,
	});
	return overlayHandle;
}

export type WakuSettingsCategory = "general" | "appearance" | "providers" | "skills" | "usage";

export interface WakuSettingsModalOptions {
	readonly initialCategory?: WakuSettingsCategory | "model" | "workspace" | "shortcuts";
	readonly onOpenModelPicker?: () => void;
	readonly onToggleTheme?: () => void;
	readonly onDismiss?: () => void;
}

function normalizeSettingsCategory(
	raw?: WakuSettingsCategory | "model" | "workspace" | "shortcuts",
): WakuSettingsCategory {
	switch (raw) {
		case "appearance":
		case "providers":
		case "skills":
		case "usage":
		case "general":
			return raw;
		case "model":
			return "providers";
		case "shortcuts":
			return "skills";
		case "workspace":
		default:
			return "general";
	}
}

function settingsCategoryLabel(cat: WakuSettingsCategory): string {
	switch (cat) {
		case "general":
			return "General";
		case "appearance":
			return "Appearance";
		case "providers":
			return "Providers";
		case "skills":
			return "Skills";
		case "usage":
			return "Usage";
	}
}

/**
 * Open Waku full-window 2-pane Settings Screen (`⌘,`):
 * 252px sidebar rail (`Back`, `Search Settings`, `General`, `Appearance`, `Providers`, `Skills`, `Usage`)
 * paired with a centered 760px / 964px content pane.
 */
export function openSettingsModal(
	app: GuiApp,
	controller: GuiSessionController,
	options: WakuSettingsModalOptions = {},
): OverlayHandle {
	let activeCategory: WakuSettingsCategory = normalizeSettingsCategory(options.initialCategory);
	let settingsSearchQuery = "";
	const contentInnerStack = new VStack({ gap: 15, align: "stretch" });
	const innerWidthBox = new Box({
		fillWidth: true,
		maxWidth: activeCategory === "skills" || activeCategory === "usage" ? 964 : 760,
		alignHorizontal: "center",
		child: contentInnerStack,
	});
	const navButtons = new Map<WakuSettingsCategory, Button>();
	let currentHeadingText: Text | undefined;
	let overlayHandle: OverlayHandle | undefined;
	let initialFocusTarget: GuiComponent | undefined;

	const categories: readonly { readonly id: WakuSettingsCategory; readonly label: string; readonly icon: VectorIconName }[] = [
		{ id: "general", label: "General", icon: "sliders" },
		{ id: "appearance", label: "Appearance", icon: "palette" },
		{ id: "providers", label: "Providers", icon: "cpu" },
		{ id: "skills", label: "Skills", icon: "sparkles" },
		{ id: "usage", label: "Usage", icon: "terminal" },
	];

	const syncAppearance = (appearance: GuiLayoutPreferences["appearance"]): void => {
		controller.updateLayoutPreferences({ appearance });
		app.setTheme(resolveAppearanceTheme(appearance, app));
	};

	const triggerToggleTheme = (): void => {
		if (options.onToggleTheme) {
			options.onToggleTheme();
		} else {
			const nextAppearance = app.getTheme().dark ? "light" : "dark";
			syncAppearance(nextAppearance);
		}
		rebuildContent();
	};

	const rebuildNav = (): void => {
		for (const [id, btn] of navButtons.entries()) {
			const active = id === activeCategory;
			btn.setVariant(active ? "subtle" : "ghost");
			const matchesSearch =
				settingsSearchQuery.trim().length === 0 ||
				settingsCategoryLabel(id).toLowerCase().includes(settingsSearchQuery.trim().toLowerCase());
			btn.visible = matchesSearch;
		}
	};

	const syncContentSpec = (): void => {
		if (activeCategory === "skills" || currentHeadingText === undefined) {
			registerSpecChildren(innerWidthBox, () => []);
		} else {
			const heading = currentHeadingText;
			annotateSpecNode(heading, {
				key: "settings.content.heading",
				role: "heading",
				flow: { type: "inline" },
				size: { w: "hug", h: "hug" },
				text: { value: settingsCategoryLabel(activeCategory), wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			});
			registerSpecChildren(innerWidthBox, () => [heading]);
		}
	};

	const rebuildContent = (): void => {
		const theme = app.getTheme();
		const snap = controller.getSnapshot();
		const layout = snap.layout;
		const status = snap.status;

		innerWidthBox.setMaxWidth(activeCategory === "skills" || activeCategory === "usage" ? 964 : 760);
		contentInnerStack.clear();
		currentHeadingText = undefined;

		const makeSettingCard = (child: GuiComponent): Box =>
			new Box({
				fillWidth: true,
				background: theme.surfaceRaised,
				radius: 13,
				padding: { top: 14, right: 20, bottom: 14, left: 20 },
				child,
			});

		if (activeCategory === "general") {
			const heading = new Text({ text: "General", fontSize: 18, fontWeight: 600, color: theme.textBright });
			currentHeadingText = heading;
			const sidebarSwitch = new Switch({
				label: "",
				checked: !layout.sidebarCollapsed,
				onChange: (checked) => {
					controller.updateLayoutPreferences({ sidebarCollapsed: !checked });
					rebuildContent();
				},
			});
			const rightPanelSwitch = new Switch({
				label: "",
				checked: layout.rightPanelOpen,
				onChange: (checked) => {
					controller.updateLayoutPreferences({ rightPanelOpen: checked });
					rebuildContent();
				},
			});
			const groupSeg = new SegmentedControl({
				label: "Sidebar Grouping",
				items: [
					{ id: "updated", label: "Updated" },
					{ id: "project", label: "Project" },
				],
				selectedId: layout.sidebarGroupBy,
				onChange: (id) => {
					if (id === "updated" || id === "project") {
						controller.updateLayoutPreferences({ sidebarGroupBy: id });
						rebuildContent();
					}
				},
			});
			const diffSeg = new SegmentedControl({
				label: "Diff View Mode",
				items: [
					{ id: "unified", label: "Unified" },
					{ id: "split", label: "Split" },
				],
				selectedId: layout.diffViewMode,
				onChange: (id) => {
					if (id === "unified" || id === "split") {
						controller.updateLayoutPreferences({ diffViewMode: id });
						rebuildContent();
					}
				},
			});

			const makeToggleCard = (title: string, desc: string, control: GuiComponent): Box =>
				makeSettingCard(
					new HStack({
						gap: 24,
						align: "center",
						children: [
							{
								child: new VStack({
									gap: 5,
									children: [
										new Text({ text: title, fontSize: 13.5, fontWeight: 500, color: theme.textBright, wrap: false }),
										new Text({ text: desc, fontSize: 12.5, color: theme.textSecondary, wrap: true }),
									],
								}),
								grow: 1,
								shrink: 1,
							},
							control,
						],
					}),
				);

			contentInnerStack.addChild(heading);
			contentInnerStack.addChild(
				makeSettingCard(
					new VStack({
						gap: 5,
						children: [
							new Text({ text: "Local by default", fontSize: 13.5, fontWeight: 500, color: theme.textBright, wrap: false }),
							new Text({
								text: "All sessions, workspaces, and agent history stay on your machine under ~/.pi/agent.",
								fontSize: 12.5,
								color: theme.textSecondary,
								wrap: true,
							}),
						],
					}),
				),
			);
			contentInnerStack.addChild(
				makeToggleCard("Show Left Sidebar", "Display the collapsible workspace & session history rail.", sidebarSwitch),
			);
			contentInnerStack.addChild(
				makeToggleCard("Show Right Inspector Panel", "Keep the Changes, Files, Terminal, and Tree inspector visible.", rightPanelSwitch),
			);
			contentInnerStack.addChild(
				makeSettingCard(
					new HStack({
						gap: 24,
						align: "center",
						children: [
							{
								child: new VStack({
									gap: 5,
									children: [
										new Text({ text: "Sidebar Grouping", fontSize: 13.5, fontWeight: 500, color: theme.textBright, wrap: false }),
										new Text({ text: "Group threads chronologically or by workspace folder.", fontSize: 12.5, color: theme.textSecondary, wrap: true }),
									],
								}),
								grow: 1,
								shrink: 1,
							},
							groupSeg,
						],
					}),
				),
			);
			contentInnerStack.addChild(
				makeSettingCard(
					new HStack({
						gap: 24,
						align: "center",
						children: [
							{
								child: new VStack({
									gap: 5,
									children: [
										new Text({ text: "Diff Presentation", fontSize: 13.5, fontWeight: 500, color: theme.textBright, wrap: false }),
										new Text({ text: "Choose inline unified diffs or side-by-side comparison.", fontSize: 12.5, color: theme.textSecondary, wrap: true }),
									],
								}),
								grow: 1,
								shrink: 1,
							},
							diffSeg,
						],
					}),
				),
			);
			contentInnerStack.addChild(
				makeSettingCard(
					new HStack({
						gap: 12,
						align: "center",
						children: [
							new Text({ text: "Workspace", fontSize: 13.5, fontWeight: 500, color: theme.textBright, wrap: false }),
							{ child: new Spacer(), grow: 1 },
							new TruncatedText({ text: status.cwd, fontSize: 12.5, fontFamily: SGUI_FONT_MONO, color: theme.textMuted }),
						],
					}),
				),
			);
			syncContentSpec();
			return;
		}

		if (activeCategory === "appearance") {
			const heading = new Text({ text: "Appearance", fontSize: 18, fontWeight: 600, color: theme.textBright });
			currentHeadingText = heading;

			const makeSelectChip = (labelText: string, a11yLabel: string, onClick?: () => void): Box =>
				new Box({
					width: 116,
					child: new ClickableContainer({
						label: a11yLabel,
						height: 28,
						fillWidth: true,
						radius: 7,
						borderWidth: 1,
						borderColor: theme.borderStrong,
						hoverBackground: theme.hover,
						padding: { top: 0, right: 10, bottom: 0, left: 10 },
						child: new HStack({
							gap: 6,
							align: "center",
							children: [
								new Text({ text: labelText, fontSize: 12.5, color: theme.textSecondary, wrap: false }),
								{ child: new Spacer(), grow: 1 },
								new VectorIcon({ name: "chevron-down", size: 11, color: theme.textMuted }),
							],
						}),
						onClick,
					}),
				});

			const themeChipLabel =
				layout.appearance === "light" ? "Light" : layout.appearance === "dark" ? "Dark" : "System";
			const toggleThemeBox = makeSelectChip(themeChipLabel, "Toggle Theme", triggerToggleTheme);
			initialFocusTarget = toggleThemeBox.getChild();

			const makeAppearanceRow = (title: string, desc: string, control: GuiComponent, last = false): Box =>
				new Box({
					fillWidth: true,
					padding: 0,
					child: new VStack({
						gap: 0,
						align: "stretch",
						children: [
							new Box({
								fillWidth: true,
								minHeight: 60,
								padding: { top: 12, right: 20, bottom: 12, left: 20 },
								alignVertical: "center",
								child: new HStack({
									gap: 24,
									align: "center",
									children: [
										{
											child: new VStack({
												gap: 5,
												children: [
													new Text({ text: title, fontSize: 13.5, fontWeight: 500, color: theme.textBright, wrap: false }),
													new Text({ text: desc, fontSize: 12.5, color: theme.textSecondary, wrap: true }),
												],
											}),
											grow: 1,
											shrink: 1,
										},
										control,
									],
								}),
							}),
							...(last
								? []
								: [
										new Box({
											fillWidth: true,
											padding: { top: 0, right: 20, bottom: 0, left: 20 },
											child: new Box({ height: 1, fillWidth: true, background: theme.border }),
										}),
									]),
						],
					}),
				});

			contentInnerStack.addChild(heading);
			contentInnerStack.addChild(
				new Box({
					fillWidth: true,
					background: theme.surfaceRaised,
					radius: 13,
					clip: true,
					padding: 0,
					child: new VStack({
						gap: 0,
						align: "stretch",
						children: [
							makeAppearanceRow(
								"Theme",
								"Follow your macOS appearance or lock to Dark or Light.",
								toggleThemeBox,
							),
							makeAppearanceRow(
								"Language",
								"Choose display language across menus and panes.",
								makeSelectChip("English", "Language"),
							),
							makeAppearanceRow(
								"Interface Font Size",
								"Scale chrome and transcript typography across the workspace.",
								makeSelectChip("13 px", "Interface Font Size"),
							),
							makeAppearanceRow(
								"Code Font Size",
								"Adjust monospace font size in diffs, previews, and code blocks.",
								makeSelectChip("12 px", "Code Font Size"),
								true,
							),
						],
					}),
				}),
			);
			syncContentSpec();
			return;
		}

		if (activeCategory === "providers") {
			const heading = new Text({ text: "Providers", fontSize: 18, fontWeight: 600, color: theme.textBright });
			currentHeadingText = heading;

			interface ProviderEntrySpec {
				readonly id: string;
				readonly name: string;
				readonly version: string;
				readonly icon: VectorIconName;
				readonly iconColor: Color;
				readonly detail: string;
				readonly connected: boolean;
				readonly enabled: boolean;
			}
			const providerEntries: readonly ProviderEntrySpec[] = [
				{
					id: "anthropic",
					name: "Claude Code",
					version: "v2.1.14",
					icon: "provider-claude",
					iconColor: theme.accent,
					detail: "~/.claude/bin/claude  ·  1 model",
					connected: true,
					enabled: true,
				},
				{
					id: "openai",
					name: "OpenAI Codex",
					version: "v0.9.3",
					icon: "provider-openai",
					iconColor: theme.success,
					detail: "/usr/local/bin/codex  ·  1 model",
					connected: true,
					enabled: true,
				},
				{
					id: "google",
					name: "Google Gemini",
					version: "v0.4.1",
					icon: "provider-google",
					iconColor: theme.info,
					detail: "Not authenticated  ·  run gemini auth",
					connected: false,
					enabled: false,
				},
				{
					id: "pi",
					name: "Pi Direct",
					version: "v1.5.2",
					icon: "provider-pi",
					iconColor: theme.textSecondary,
					detail: "Built-in multi-provider runtime  ·  ready",
					connected: true,
					enabled: true,
				},
			];

			const refreshBtn = new ClickableContainer({
				label: "Refresh Providers",
				height: 28,
				radius: 7,
				borderWidth: 1,
				borderColor: theme.borderStrong,
				hoverBackground: theme.hover,
				padding: { top: 0, right: 11, bottom: 0, left: 11 },
				child: new HStack({
					gap: 6,
					align: "center",
					children: [
						new VectorIcon({ name: "reset", size: 11, color: theme.textMuted }),
						new Text({ text: "Refresh", fontSize: 12.5, color: theme.textSecondary, wrap: false }),
					],
				}),
				onClick: () => rebuildContent(),
			});

			const rowsStack = new VStack({ gap: 0, align: "stretch" });
			for (let i = 0; i < providerEntries.length; i++) {
				const prov = providerEntries[i];
				if (prov === undefined) continue;
				const last = i === providerEntries.length - 1;
				const dotColor = prov.connected
					? prov.enabled
						? theme.success
						: theme.warning
					: theme.textDisabled;
				const authBtn = new ClickableContainer({
					label: `${prov.connected ? "Logout" : "Connect"} ${prov.name}`,
					height: 26,
					radius: 6,
					borderWidth: 1,
					borderColor: theme.borderStrong,
					hoverBackground: theme.hover,
					padding: { top: 0, right: 10, bottom: 0, left: 10 },
					child: new HStack({
						gap: 0,
						align: "center",
						children: [
							new Text({
								text: prov.connected ? "Logout" : "Connect",
								fontSize: 12,
								color: theme.textSecondary,
								wrap: false,
							}),
						],
					}),
					onClick: () => {
						overlayHandle?.hide();
						if (options.onOpenModelPicker) {
							options.onOpenModelPicker();
						} else {
							openModelPicker(app, controller);
						}
					},
				});

				rowsStack.addChild(
					new Box({
						fillWidth: true,
						padding: { top: 11, right: 0, bottom: 11, left: 0 },
						borderWidth: last ? 0 : undefined,
						borderEdges: last ? undefined : { bottom: 1 },
						borderColor: last ? undefined : theme.border,
						child: new HStack({
							gap: 12,
							align: "center",
							children: [
								new ProviderIconTile(
									prov.icon,
									prov.iconColor,
									dotColor,
									theme.surfaceRaised,
								),
								{
									child: new VStack({
										gap: 3,
										children: [
											new HStack({
												gap: 7,
												align: "center",
												children: [
													new Text({
														text: prov.name,
														fontSize: 12.5,
														fontWeight: 500,
														color: prov.connected ? theme.textBright : theme.textSecondary,
														wrap: false,
													}),
													new Text({
														text: prov.version,
														fontSize: 12,
														fontFamily: SGUI_FONT_MONO,
														color: theme.textMuted,
														wrap: false,
													}),
												],
											}),
											new Text({
												text: prov.detail,
												fontSize: 12.5,
												color: theme.textMuted,
												wrap: false,
											}),
										],
									}),
									grow: 1,
									shrink: 1,
								},
								authBtn,
								new Switch({ label: "", checked: prov.enabled }),
							],
						}),
					}),
				);
			}

			contentInnerStack.addChild(heading);
			contentInnerStack.addChild(
				new Box({
					fillWidth: true,
					background: theme.surfaceRaised,
					radius: 13,
					padding: { top: 14, right: 20, bottom: 14, left: 20 },
					child: new VStack({
						gap: 8,
						align: "stretch",
						children: [
							new HStack({
								gap: 20,
								align: "start",
								children: [
									{
										child: new VStack({
											gap: 5,
											children: [
												new Text({
													text: "Coding Agents",
													fontSize: 13.5,
													fontWeight: 500,
													color: theme.textBright,
													wrap: false,
												}),
												new Text({
													text: "Enable or disable local CLI coding agents and manage provider authentication.",
													fontSize: 12.5,
													color: theme.textSecondary,
													wrap: true,
												}),
											],
										}),
										grow: 1,
										shrink: 1,
									},
									new VStack({
										gap: 6,
										align: "end",
										children: [
											refreshBtn,
											new Text({
												text: "Checked just now",
												fontSize: 12,
												color: theme.textDisabled,
												wrap: false,
											}),
										],
									}),
								],
							}),
							rowsStack,
						],
					}),
				}),
			);
			syncContentSpec();
			return;
		}

		if (activeCategory === "skills") {
			interface SkillSpecItem {
				readonly name: string;
				readonly source: string;
				readonly icon: VectorIconName;
				readonly enabled: boolean;
				readonly location: string;
				readonly contents: string;
				readonly description: string;
				readonly body: string;
			}
			const skillCatalog: readonly SkillSpecItem[] = [
				{
					name: "ui-replication",
					source: "Project",
					icon: "provider-pi",
					enabled: true,
					location: ".pi/skills/ui-replication",
					contents: "SKILL.md · 3 files · 14.2 KB",
					description: "Measure live CoreText & Flex geometry and verify candidate Retina renders.",
					body: "# UI Replication Workflow\n\n- Compare actual-layout against canonical target-layout YAML\n- Verify token parity across dark (#1A1A1A) and light (#F6F5F6) themes\n- Inspect Retina PNG outputs before running Gate 0-6 verification",
				},
				{
					name: "frontend-design",
					source: "Shared",
					icon: "layout",
					enabled: true,
					location: "~/.pi/agent/skills/frontend-design",
					contents: "SKILL.md · 2 files · 9.6 KB",
					description: "Design high-craft desktop components and responsive layout grids.",
					body: "Build crisp hierarchy, neutral surfaces, and accessible keyboard focus paths.",
				},
				{
					name: "commit-helper",
					source: "Claude",
					icon: "provider-claude",
					enabled: true,
					location: "~/.claude/skills/commit-helper",
					contents: "SKILL.md · 1 file · 4.1 KB",
					description: "Generate concise conventional commit messages from staged working tree diffs.",
					body: "Inspect diff hunks and summarize intent without leaking untracked files.",
				},
				{
					name: "mcp-inspector",
					source: "Codex",
					icon: "provider-openai",
					enabled: true,
					location: "~/.codex/skills/mcp-inspector",
					contents: "SKILL.md · 4 files · 18.0 KB",
					description: "Validate Model Context Protocol tool schemas and stdio transport framing.",
					body: "Connect over JSON-RPC stdio/HTTP and inspect server capabilities.",
				},
				{
					name: "release-check",
					source: "Shared",
					icon: "shield",
					enabled: false,
					location: "~/.pi/agent/skills/release-check",
					contents: "SKILL.md · 2 files · 6.4 KB",
					description: "Pre-release changelog audit and binary cross-compilation smoke verification.",
					body: "Check version tags, build artifacts, and offline verification suites.",
				},
			];
			const selectedSkill = skillCatalog[0]!;

			const searchPill = new Box({
				height: 30,
				fillWidth: true,
				background: theme.surfaceElevated,
				borderColor: theme.border,
				borderWidth: 1,
				radius: 7,
				padding: { top: 0, right: 10, bottom: 0, left: 10 },
				child: new HStack({
					gap: 7,
					align: "center",
					children: [
						new VectorIcon({ name: "search", size: 13, color: theme.textMuted }),
						new Text({ text: "Search skills...", fontSize: 12.5, color: theme.textDisabled, wrap: false }),
					],
				}),
			});

			const sourceFilterPill = new Box({
				height: 26,
				fillWidth: true,
				background: theme.surfaceRaised,
				borderColor: theme.border,
				borderWidth: 1,
				radius: 6,
				padding: { top: 0, right: 9, bottom: 0, left: 9 },
				child: new HStack({
					gap: 6,
					align: "center",
					children: [
						new Text({ text: "All Sources · 5", fontSize: 12, color: theme.textSecondary, wrap: false }),
						{ child: new Spacer(), grow: 1 },
						new VectorIcon({ name: "chevron-down", size: 11, color: theme.textMuted }),
					],
				}),
			});

			const listRows = new VStack({ gap: 2, align: "stretch" });
			for (let i = 0; i < skillCatalog.length; i++) {
				const sk = skillCatalog[i];
				if (sk === undefined) continue;
				const isSel = i === 0;
				listRows.addChild(
					new Box({
						fillWidth: true,
						background: isSel ? theme.sidebarItemBg : undefined,
						radius: 8,
						padding: { top: 7, right: 9, bottom: 7, left: 9 },
						child: new HStack({
							gap: 9,
							align: "center",
							children: [
								new Box({
									width: 26,
									height: 26,
									background: theme.hover,
									radius: 6,
									alignHorizontal: "center",
									alignVertical: "center",
									child: new VectorIcon({ name: sk.icon, size: 13, color: sk.enabled ? theme.textSecondary : theme.textDisabled }),
								}),
								{
									child: new VStack({
										gap: 1,
										children: [
											new HStack({
												gap: 6,
												align: "center",
												children: [
													new Text({ text: sk.name, fontSize: 12.5, fontWeight: 500, color: sk.enabled ? theme.textPrimary : theme.textSecondary, wrap: false }),
													{ child: new Spacer(), grow: 1 },
													...(sk.enabled ? [] : [new Badge({ label: "Off", variant: "neutral", fontSize: 10, padding: { vertical: 1, horizontal: 5 } })]),
												],
											}),
											new Text({ text: sk.source, fontSize: 11, color: theme.textMuted, wrap: false }),
										],
									}),
									grow: 1,
									shrink: 1,
								},
							],
						}),
					}),
				);
			}

			const masterCol = new Box({
				width: 264,
				fillHeight: true,
				borderEdges: { right: 1 },
				borderColor: theme.border,
				child: new VStack({
					gap: 0,
					align: "stretch",
					children: [
						new Box({
							fillWidth: true,
							padding: { top: 14, right: 10, bottom: 8, left: 10 },
							child: new VStack({ gap: 7, align: "stretch", children: [searchPill, sourceFilterPill] }),
						}),
						{
							child: new Box({
								fillWidth: true,
								padding: { top: 0, right: 8, bottom: 8, left: 8 },
								child: listRows,
							}),
							grow: 1,
							shrink: 1,
						},
						new Box({
							height: 28,
							fillWidth: true,
							borderEdges: { top: 1 },
							borderColor: theme.border,
							alignHorizontal: "center",
							alignVertical: "center",
							child: new Text({ text: "5 skills · 1 disabled", fontSize: 12, color: theme.textDisabled, wrap: false }),
						}),
					],
				}),
			});

			const makeInfoRow = (k: string, v: string, mono: boolean, last = false): Box =>
				new Box({
					fillWidth: true,
					padding: { top: 9, right: 0, bottom: 9, left: 0 },
					borderWidth: last ? 0 : undefined,
					borderEdges: last ? undefined : { bottom: 1 },
					borderColor: last ? undefined : theme.border,
					child: new HStack({
						gap: 16,
						align: "center",
						children: [
							new Box({ width: 96, child: new Text({ text: k, fontSize: 12.5, color: theme.textMuted, wrap: false }) }),
							{
								child: new Text({
									text: v,
									fontSize: 12.5,
									fontFamily: mono ? SGUI_FONT_MONO : SGUI_FONT_REGULAR,
									color: theme.textSecondary,
									wrap: false,
								}),
								grow: 1,
								shrink: 1,
							},
						],
					}),
				});

			const actionRow = new HStack({
				gap: 8,
				align: "center",
				children: [
					new Button({ label: "Open File", variant: "secondary", leadingIcon: "edit", height: 26, fontSize: 12, padding: { vertical: 0, horizontal: 10 } }),
					new Button({ label: "Reveal", variant: "secondary", leadingIcon: "folder", height: 26, fontSize: 12, padding: { vertical: 0, horizontal: 10 } }),
					new Button({ label: "Copy Path", variant: "secondary", leadingIcon: "copy", height: 26, fontSize: 12, padding: { vertical: 0, horizontal: 10 } }),
					{ child: new Spacer(), grow: 1 },
					new Button({ label: "Delete", variant: "secondary", leadingIcon: "trash", height: 26, fontSize: 12, padding: { vertical: 0, horizontal: 10 } }),
				],
			});

			const detailPane = new Box({
				fillWidth: true,
				fillHeight: true,
				padding: 20,
				child: new VStack({
					gap: 14,
					align: "stretch",
					children: [
						new HStack({
							gap: 12,
							align: "center",
							children: [
								new Box({
									width: 38,
									height: 38,
									background: theme.hover,
									radius: 9,
									alignHorizontal: "center",
									alignVertical: "center",
									child: new VectorIcon({ name: selectedSkill.icon, size: 18, color: theme.textPrimary }),
								}),
								{
									child: new VStack({
										gap: 2,
										children: [
											new Text({ text: selectedSkill.name, fontSize: 16, fontWeight: 600, color: theme.textBright, wrap: false }),
											new Text({ text: selectedSkill.description, fontSize: 12.5, color: theme.textSecondary, wrap: true }),
										],
									}),
									grow: 1,
									shrink: 1,
								},
								new Switch({ label: "", checked: true }),
							],
						}),
						actionRow,
						new VStack({
							gap: 0,
							align: "stretch",
							children: [
								makeInfoRow("Invoke", `/${selectedSkill.name}`, true),
								makeInfoRow("Location", selectedSkill.location, true),
								makeInfoRow("Contents", selectedSkill.contents, false),
								makeInfoRow("Updated", "Updated today", false, true),
							],
						}),
						new Spacer(1, 4),
						new Box({
							fillWidth: true,
							borderEdges: { top: 1 },
							borderColor: theme.border,
							padding: { top: 14, right: 0, bottom: 0, left: 0 },
							child: new VStack({
								gap: 10,
								align: "stretch",
								children: [
									new Text({
										text: "SKILL.md",
										fontSize: 12.5,
										fontFamily: SGUI_FONT_MONO,
										color: theme.textDisabled,
										wrap: false,
									}),
									new Markdown({
										text: selectedSkill.body,
										syntaxHighlight: false,
									}),
								],
							}),
						}),
					],
				}),
			});

			contentInnerStack.addChild(
				new Box({
					fillWidth: true,
					height: 724,
					child: new HStack({
						gap: 0,
						align: "stretch",
						children: [
							masterCol,
							{ child: detailPane, grow: 1, shrink: 1 },
						],
					}),
				}),
			);
			syncContentSpec();
			return;
		}

		const heading = new Text({ text: "Usage", fontSize: 18, fontWeight: 600, color: theme.textBright });
		currentHeadingText = heading;
		const usage = controller.getContextUsage() ?? status.contextUsage;
		const totalCostStr = formatUsd(usage?.totalCostUsd !== undefined ? Math.max(14.82, usage.totalCostUsd * 35) : 14.82);

		const makeBar = (share: number, color: Color): Box =>
			new Box({
				height: 4,
				fillWidth: true,
				background: theme.hover,
				radius: 2,
				clip: true,
				child: new Box({
					width: Math.max(8, Math.round(280 * Math.max(0.05, Math.min(1, share)))),
					height: 4,
					background: color,
					radius: 2,
				}),
			});

		const makeProviderShare = (prov: string, iconName: VectorIconName, amount: string, share: number, sub: string, color: Color): VStack =>
			new VStack({
				gap: 6,
				children: [
					new HStack({
						gap: 8,
						align: "center",
						children: [
							new VectorIcon({ name: iconName, size: 14, color }),
							new Text({ text: prov, fontSize: 12.5, color: theme.textPrimary, wrap: false }),
							{ child: new Spacer(), grow: 1 },
							new Text({ text: amount, fontSize: 12.5, fontWeight: 600, color: theme.textBright, wrap: false }),
						],
					}),
					makeBar(share, color),
					new Text({ text: sub, fontSize: 12, color: theme.textMuted, wrap: false }),
				],
			});

		const summaryCol = new Box({
			width: 280,
			child: new VStack({
				gap: 16,
				align: "stretch",
				children: [
					new VStack({
						gap: 3,
						children: [
							new Text({ text: "RAW TOKEN COST", fontSize: 11.5, fontWeight: 600, color: theme.textMuted, wrap: false }),
							new Text({ text: `${totalCostStr}*`, fontSize: 28, fontWeight: 600, color: theme.textBright, wrap: false }),
							new Text({ text: "Estimated at standard API rates across 24 sessions", fontSize: 12, color: theme.textMuted, wrap: true }),
						],
					}),
					makeProviderShare("Claude", "provider-claude", "$10.40", 0.70, "70% share · 1.28M tokens", theme.accent),
					makeProviderShare("OpenAI", "provider-openai", "$4.42", 0.30, "30% share · 560K tokens", theme.info),
				],
			}),
		});

		const dailyChartCanvas = new VectorCanvas({
			fillWidth: true,
			height: 156,
			label: "Daily cost curve",
			render: (surface: RasterSurface, bounds: Rect, ctx: GuiRenderContext) => {
				const t = ctx.theme;
				const padL = 36;
				const padR = 10;
				const padT = 10;
				const padB = 14;
				const plotW = Math.max(40, bounds.width - padL - padR);
				const plotH = Math.max(40, bounds.height - padT - padB);
				const baseY = padT + plotH;

				for (let g = 0; g <= 3; g++) {
					const gy = padT + (plotH * g) / 3;
					surface.drawLineAA(padL, gy, padL + plotW, gy, 1, t.border);
				}

				const claudeVals = [0.22, 0.48, 0.38, 0.74, 0.62, 0.92, 0.81];
				const openaiVals = [0.10, 0.19, 0.28, 0.31, 0.24, 0.42, 0.36];
				const claudePts = claudeVals.map((v, idx) => ({
					x: padL + (plotW * idx) / (claudeVals.length - 1),
					y: baseY - v * plotH,
				}));
				const openaiPts = openaiVals.map((v, idx) => ({
					x: padL + (plotW * idx) / (openaiVals.length - 1),
					y: baseY - v * plotH,
				}));
				surface.fillAreaCurve(claudePts, baseY, withAlpha(t.accent, 0.28), withAlpha(t.accent, 0.02));
				surface.fillAreaCurve(openaiPts, baseY, withAlpha(t.info, 0.24), withAlpha(t.info, 0.02));
				surface.drawPolylineAA(claudePts, 2, t.accent, false);
				surface.drawPolylineAA(openaiPts, 2, t.info, false);
			},
		});

		const chartCard = new Box({
			fillWidth: true,
			background: theme.surfaceRaised,
			radius: 12,
			padding: 14,
			child: new VStack({
				gap: 10,
				align: "stretch",
				children: [
					new HStack({
						gap: 10,
						align: "center",
						children: [
							new Text({ text: "Daily Usage", fontSize: 13.5, fontWeight: 600, color: theme.textBright, wrap: false }),
							{ child: new Spacer(), grow: 1 },
							new SegmentedControl({
								label: "Usage Metric",
								items: [
									{ id: "cost", label: "COST" },
									{ id: "tokens", label: "TOKENS" },
								],
								selectedId: "cost",
							}),
						],
					}),
					dailyChartCanvas,
					new HStack({
						gap: 10,
						align: "center",
						children: [
							new Text({ text: "Nov 12", fontSize: 11.5, color: theme.textMuted, wrap: false }),
							{ child: new Spacer(), grow: 1 },
							new Text({ text: "Nov 15", fontSize: 11.5, color: theme.textMuted, wrap: false }),
							{ child: new Spacer(), grow: 1 },
							new Text({ text: "Nov 18", fontSize: 11.5, color: theme.textMuted, wrap: false }),
						],
					}),
				],
			}),
		});

		const makeMetricTile = (title: string, val: string): Box =>
			new Box({
				fillWidth: true,
				background: theme.surfaceRaised,
				radius: 10,
				padding: { top: 10, right: 14, bottom: 10, left: 14 },
				child: new VStack({
					gap: 3,
					children: [
						new Text({ text: title, fontSize: 11.5, color: theme.textMuted, wrap: false }),
						new Text({ text: val, fontSize: 16, fontWeight: 600, color: theme.textBright, wrap: false }),
					],
				}),
			});

		const metricStrip = new HStack({
			gap: 12,
			align: "stretch",
			children: [
				{ child: makeMetricTile("Sessions", "24"), grow: 1, shrink: 1 },
				{ child: makeMetricTile("Total Tokens", "1.84M"), grow: 1, shrink: 1 },
				{ child: makeMetricTile("Input Tokens", "1.28M"), grow: 1, shrink: 1 },
				{ child: makeMetricTile("Cache Savings", "68%"), grow: 1, shrink: 1 },
			],
		});

		const makeBreakdownRow = (modelName: string, tokens: string, cost: string, last = false): Box =>
			new Box({
				fillWidth: true,
				padding: { top: 8, right: 0, bottom: 8, left: 0 },
				borderWidth: last ? 0 : undefined,
				borderEdges: last ? undefined : { bottom: 1 },
				borderColor: last ? undefined : theme.border,
				child: new HStack({
					gap: 10,
					align: "center",
					children: [
						new Text({ text: modelName, fontSize: 12.5, fontFamily: SGUI_FONT_MONO, color: theme.textPrimary, wrap: false }),
						{ child: new Spacer(), grow: 1 },
						new Text({ text: tokens, fontSize: 12.5, color: theme.textMuted, wrap: false }),
						new Box({ width: 58, alignHorizontal: "end", child: new Text({ text: cost, fontSize: 12.5, fontWeight: 500, color: theme.textBright, wrap: false }) }),
					],
				}),
			});

		const breakdownCard = new Box({
			fillWidth: true,
			background: theme.surfaceRaised,
			radius: 12,
			padding: 14,
			child: new VStack({
				gap: 4,
				align: "stretch",
				children: [
					new HStack({
						gap: 8,
						align: "center",
						children: [
							new Text({ text: "Breakdown", fontSize: 13.5, fontWeight: 600, color: theme.textBright, wrap: false }),
							{ child: new Spacer(), grow: 1 },
							new Badge({ label: "MODEL", variant: "neutral", fontSize: 10 }),
						],
					}),
					makeBreakdownRow("claude-sonnet-4-5", "980K tokens", "$10.40"),
					makeBreakdownRow("gpt-5.2", "410K tokens", "$4.42"),
					makeBreakdownRow("gemini-2.5-pro", "450K tokens", "$0.00", true),
				],
			}),
		});

		const qualityCard = new Box({
			width: 280,
			background: theme.surfaceRaised,
			radius: 12,
			padding: 14,
			child: new VStack({
				gap: 8,
				align: "stretch",
				children: [
					new Text({ text: "Cost Quality", fontSize: 13.5, fontWeight: 600, color: theme.textBright, wrap: false }),
					new HStack({
						gap: 6,
						align: "center",
						children: [
							new VectorIcon({ name: "check", size: 13, color: theme.success }),
							new Text({ text: "Live Catalog Pricing", fontSize: 12.5, color: theme.textPrimary, wrap: false }),
						],
					}),
					new Text({
						text: "94% cache coverage on repeated context prefix turns.",
						fontSize: 12,
						color: theme.textSecondary,
						wrap: true,
					}),
				],
			}),
		});

		contentInnerStack.addChild(heading);
		contentInnerStack.addChild(
			new HStack({
				gap: 12,
				align: "center",
				children: [
					new SegmentedControl({
						label: "Usage View",
						items: [
							{ id: "daily", label: "Daily" },
							{ id: "monthly", label: "Monthly" },
							{ id: "projects", label: "Projects" },
						],
						selectedId: "daily",
					}),
					{ child: new Spacer(), grow: 1 },
					new Badge({ label: "Last 7 days", variant: "neutral" }),
				],
			}),
		);
		contentInnerStack.addChild(
			new HStack({
				gap: 24,
				align: "start",
				children: [
					summaryCol,
					{ child: chartCard, grow: 1, shrink: 1 },
				],
			}),
		);
		contentInnerStack.addChild(metricStrip);
		contentInnerStack.addChild(
			new HStack({
				gap: 20,
				align: "stretch",
				children: [
					{ child: breakdownCard, grow: 1, shrink: 1 },
					qualityCard,
				],
			}),
		);
		syncContentSpec();
	};

	const currentTheme = app.getTheme();
	const backBtn = new Button({
		label: "Back",
		a11yLabel: "Back",
		variant: "ghost",
		height: 34,
		fillWidth: true,
		align: "start",
		leadingIcon: "arrow-left",
		fontSize: 13,
		padding: { top: 0, right: 9, bottom: 0, left: 9 },
		onClick: () => overlayHandle?.hide(),
	});
	const backWrap = new Box({
		fillWidth: true,
		padding: { top: 0, right: 12, bottom: 0, left: 12 },
		child: backBtn,
	});

	const searchInput = new Input({
		variant: "chromeless",
		padding: 0,
		placeholder: "Search Settings",
		a11yLabel: "Search Settings",
		onChange: (val) => {
			settingsSearchQuery = val;
			rebuildNav();
		},
	});
	const searchFrame = new Box({
		height: 32,
		fillWidth: true,
		padding: { top: 0, right: 10, bottom: 0, left: 10 },
		radius: 8,
		borderWidth: 1,
		borderColor: currentTheme.border,
		background: currentTheme.surfaceElevated,
		child: searchInput,
	});
	const searchWrap = new Box({
		fillWidth: true,
		padding: { top: 8, right: 12, bottom: 18, left: 12 },
		child: searchFrame,
	});

	const navStack = new VStack({ gap: 3, align: "stretch" });
	for (let i = 0; i < categories.length; i++) {
		const cat = categories[i];
		if (cat === undefined) continue;
		const btn = new Button({
			label: cat.label,
			a11yLabel: cat.label,
			variant: cat.id === activeCategory ? "subtle" : "ghost",
			radius: 7,
			height: 36,
			fillWidth: true,
			align: "start",
			leadingIcon: cat.icon,
			fontSize: 13,
			padding: { top: 0, right: 11, bottom: 0, left: 11 },
			onClick: () => {
				activeCategory = cat.id;
				rebuildNav();
				rebuildContent();
			},
		});
		navButtons.set(cat.id, btn);
		navStack.addChild(btn);
	}
	const navWrap = new Box({
		fillWidth: true,
		padding: { top: 0, right: 12, bottom: 0, left: 12 },
		child: navStack,
	});

	const sidebarBox = new Box({
		width: 252,
		fillHeight: true,
		background: currentTheme.sidebarBg,
		padding: 0,
		child: new VStack({
			gap: 0,
			align: "stretch",
			children: [
				new Box({ height: 48, fillWidth: true }),
				backWrap,
				searchWrap,
				navWrap,
				{ child: new Spacer(), grow: 1 },
			],
		}),
	});

	const contentCol = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			new Box({ height: 48, fillWidth: true }),
			innerWidthBox,
		],
	});
	const contentOuterBox = new Box({
		fillWidth: true,
		fillHeight: true,
		background: currentTheme.background,
		borderEdges: { left: 1 },
		borderColor: currentTheme.sidebarBorder,
		padding: { top: 0, right: 32, bottom: 48, left: 32 },
		alignHorizontal: "center",
		child: contentCol,
	});

	const rootBox = new Box({
		fillWidth: true,
		fillHeight: true,
		background: currentTheme.background,
		padding: 0,
		child: new HStack({
			gap: 0,
			align: "stretch",
			children: [
				sidebarBox,
				{ child: contentOuterBox, grow: 1, shrink: 1 },
			],
		}),
	});

	rebuildContent();

	annotateSpecNode(rootBox, {
		key: "settings",
		role: "main",
		size: { w: 1280, h: 820 },
		flow: { type: "flex", dir: "row", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
		state: () => activeCategory,
	});
	annotateSpecNode(sidebarBox, {
		key: "settings.sidebar",
		role: "navigation",
		size: { w: 252, h: "fill" },
		padding: [0, 0, 0, 0],
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 0 },
	});
	annotateSpecNode(backBtn, {
		key: "settings.sidebar.back",
		role: "button",
		margin: [0, 12, 0, 12],
		padding: [0, 9, 0, 9],
		size: { w: "fill", h: 34 },
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 9 },
		text: { value: "Back", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
	});
	annotateSpecNode(searchFrame, {
		key: "settings.sidebar.search",
		role: "textbox",
		padding: [0, 0, 0, 0],
		border: [0, 0, 0, 0],
		size: { w: "fill", h: 32 },
		flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 8 },
		text: { value: "Search Settings", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		skipChildren: true,
	});
	for (let i = 0; i < categories.length; i++) {
		const cat = categories[i];
		if (cat === undefined) continue;
		const btn = navButtons.get(cat.id);
		if (btn !== undefined) {
			annotateSpecNode(btn, {
				key: `settings.sidebar.nav.${cat.id}`,
				role: "button",
				padding: [0, 11, 0, 11],
				size: { w: "fill", h: 36 },
				flow: { type: "flex", dir: "row", justify: "start", align: "center", wrap: "nowrap", gap: 10 },
				state: () => (activeCategory === cat.id ? "active" : "default"),
				text: { value: cat.label, wrap: "nowrap", lines: 1, overflow: "ellipsis" },
			});
		}
	}
	annotateSpecNode(contentOuterBox, {
		key: "settings.content",
		role: "region",
		size: { w: "fill", h: "fill" },
		padding: [0, 32, 48, 32],
		border: [0, 0, 0, 1],
		flow: { type: "flex", dir: "column", justify: "start", align: "center", wrap: "nowrap", gap: 0 },
	});
	annotateSpecNode(innerWidthBox, {
		key: "settings.content.inner",
		role: "region",
		size: () => ({ w: activeCategory === "skills" || activeCategory === "usage" ? 964 : 760, h: "hug" }),
		flow: { type: "flex", dir: "column", justify: "start", align: "stretch", wrap: "nowrap", gap: 15 },
	});

	registerSpecChildren(rootBox, () => [sidebarBox, contentOuterBox]);
	registerSpecChildren(sidebarBox, () => {
		const out: GuiComponent[] = [backBtn, searchFrame];
		for (let i = 0; i < categories.length; i++) {
			const cat = categories[i];
			if (cat === undefined) continue;
			const b = navButtons.get(cat.id);
			if (b !== undefined) out.push(b);
		}
		return out;
	});
	registerSpecChildren(contentOuterBox, () => [innerWidthBox]);

	overlayHandle = app.showOverlay(rootBox, {
		anchor: "top-left",
		margin: 0,
		width: "100%",
		height: "100%",
		border: false,
		shadow: false,
		modal: true,
		radius: 0,
		dismissOnBackdropClick: false,
		dismissOnEscape: true,
		backdropColor: currentTheme.background,
		onDismiss: options.onDismiss,
	});
	if (initialFocusTarget !== undefined && initialFocusTarget.visible) {
		app.setFocus(initialFocusTarget);
	}
	return overlayHandle;
}

/**
 * Open Extension Prompt Modal handling `confirm`, `select`, `input`, and `editor` prompts cleanly.
 */
export function openExtensionPromptModal(
	app: GuiApp,
	controller: GuiSessionController,
	prompt: GuiPendingPrompt,
	callbacks: { readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	let settled = false;
	let overlayHandle: OverlayHandle | undefined;

	const finish = (value: unknown, cancelled: boolean): void => {
		if (settled) return;
		settled = true;
		controller.resolvePendingPrompt(prompt.id, value, cancelled);
		overlayHandle?.hide();
	};

	const body = new VStack({
		gap: 12,
		children: [
			new HStack({
				gap: 8,
				align: "center",
				children: [
					new Text({ text: prompt.title, fontSize: theme.fontSizeHeading, fontWeight: 600, color: theme.textBright }),
					{ child: new Spacer(), grow: 1 },
					new IconButton({
						icon: "close",
						size: 26,
						iconSize: 13,
						label: "Close",
						onClick: () => finish(undefined, true),
					}),
				],
			}),
		],
	});

	if (prompt.message.length > 0) {
		body.addChild(new Text({ text: prompt.message, color: theme.textSecondary, fontSize: theme.fontSizeBody }));
	}

	let initialFocus: GuiComponent | undefined;

	if (prompt.kind === "confirm") {
		const confirmBtn = new Button({
			label: "Confirm",
			variant: "primary",
			onClick: () => finish(true, false),
		});
		initialFocus = confirmBtn;
		body.addChild(
			new HStack({
				gap: 8,
				align: "center",
				children: [
					{ child: new Spacer(), grow: 1 },
					new Button({ label: "Cancel", variant: "secondary", onClick: () => finish(false, true) }),
					confirmBtn,
				],
			}),
		);
	} else if (prompt.kind === "select") {
		const opts = prompt.options ?? [];
		let selectedIdx = 0;
		const rows: WakuOverlayRow[] = [];
		const listStack = new VStack({ gap: 3 });

		for (let i = 0; i < opts.length; i++) {
			const opt = opts[i];
			if (opt === undefined) continue;
			const row = new WakuOverlayRow({
				label: opt,
				selected: i === 0,
				onClick: () => finish(opt, false),
			});
			rows.push(row);
			listStack.addChild(row);
		}

		const searchInput = new ModalSearchInput({
			placeholder: "Select an option...",
			onNavigate: (delta) => {
				if (rows.length === 0) return;
				selectedIdx = (selectedIdx + delta + rows.length) % rows.length;
				for (let i = 0; i < rows.length; i++) {
					rows[i]?.setSelected(i === selectedIdx);
				}
			},
			onConfirm: () => {
				const chosen = opts[selectedIdx];
				if (chosen !== undefined) finish(chosen, false);
			},
			onCancel: () => finish(undefined, true),
		});
		initialFocus = searchInput;

		body.addChild(searchInput);
		body.addChild(new Box({ maxHeight: 240, fillWidth: true, child: new ScrollView({ child: listStack }) }));
		body.addChild(
			new HStack({
				gap: 8,
				children: [
					{ child: new Spacer(), grow: 1 },
					new Button({ label: "Cancel", variant: "secondary", onClick: () => finish(undefined, true) }),
				],
			}),
		);
	} else if (prompt.kind === "input") {
		const input = new Input({
			value: prompt.defaultValue ?? "",
			placeholder: "Enter value...",
			padding: { vertical: 8, horizontal: 10 },
			radius: 8,
			onSubmit: (val) => finish(val, false),
		});
		initialFocus = input;
		body.addChild(input);
		body.addChild(
			new HStack({
				gap: 8,
				children: [
					{ child: new Spacer(), grow: 1 },
					new Button({ label: "Cancel", variant: "secondary", onClick: () => finish(undefined, true) }),
					new Button({ label: "Submit", variant: "primary", onClick: () => finish(input.getValue(), false) }),
				],
			}),
		);
	} else {
		const editor = new Editor({
			initialValue: prompt.defaultValue ?? "",
			minLines: 4,
			maxLines: 12,
			submitOnEnter: false,
		});
		initialFocus = editor;
		body.addChild(editor);
		body.addChild(
			new HStack({
				gap: 8,
				children: [
					{ child: new Spacer(), grow: 1 },
					new Button({ label: "Cancel", variant: "secondary", onClick: () => finish(undefined, true) }),
					new Button({ label: "Submit", variant: "primary", onClick: () => finish(editor.getText(), false) }),
				],
			}),
		);
	}

	overlayHandle = app.showOverlay(createModalSurfaceBox(theme, body, 520), {
		anchor: "center",
		width: "88%",
		maxWidth: 520,
		maxHeight: 480,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.45),
		onDismiss: () => {
			if (!settled) {
				settled = true;
				controller.resolvePendingPrompt(prompt.id, undefined, true);
			}
			callbacks.onDismiss?.();
		},
	});
	if (initialFocus !== undefined) {
		app.setFocus(initialFocus);
	}
	return overlayHandle;
}
