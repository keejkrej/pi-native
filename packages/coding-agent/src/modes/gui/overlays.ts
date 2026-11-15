/**
 * Waku modal overlays and popovers: Command Palette (⌘K), Model Picker (⌘M),
 * Session Resume Picker (⌘⇧O), Git Branch & Commit Modals, Context Window Breakdown,
 * Left-Rail Categorized Settings Dialog (⌘,), and Extension Prompts.
 */

import { basename } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
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
	type OverlayHandle,
	Pill,
	pointInRect,
	type Rect,
	resolveTheme,
	ScrollView,
	SegmentedControl,
	type SegmentedItem,
	type Size,
	Spacer,
	Switch,
	Text,
	TruncatedText,
	type VectorIconName,
	VStack,
	withAlpha,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
} from "scriptc-ui";
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

	constructor(options: {
		placeholder?: string;
		value?: string;
		onChange?: (value: string) => void;
		onNavigate: (delta: number) => void;
		onConfirm: () => void;
		onCancel: () => void;
	}) {
		super({
			value: options.value ?? "",
			placeholder: options.placeholder ?? "Search...",
			padding: { vertical: 8, horizontal: 10 },
			radius: 8,
			onChange: options.onChange,
			onSubmit: () => {
				options.onConfirm();
			},
		});
		this.onNavigateFn = options.onNavigate;
		this.onConfirmFn = options.onConfirm;
		this.onCancelFn = options.onCancel;
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
		const rowH = hasSub ? 46 : 34;
		return { width: Math.max(0, maxWidth), height: rowH };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		let rightCursor = rect.x + rect.width - 8;
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
		const focused = this.isFocused();

		if (this.selectedState) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.surfaceSelected, 8);
		} else if (hovered) {
			ctx.fillRect(r.x, r.y, r.width, r.height, t.hover, 8);
		}
		if (focused) {
			drawFocusHalo(ctx, r, 8, 0.2, 2);
		}

		const indent = this.opts.indent ?? 0;
		let cursorX = r.x + 10 + indent;
		const rightBound = r.x + r.width - 10;

		if (this.opts.leadingIcon !== undefined) {
			const iconSize = 14;
			const iconColor = this.opts.active ? t.accent : t.textSecondary;
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
				this.opts.accentCheck !== false ? t.accent : t.textPrimary,
			);
			rightReserved += checkSize + 8;
		}

		if (this.opts.shortcut !== undefined && this.opts.shortcut.length > 0) {
			const scStyle = { fontFamily: SGUI_FONT_MONO, fontSize: t.fontSizeSmall, fontWeight: 500 };
			const scMetrics = ctx.measureText(scStyle, 0, this.opts.shortcut);
			const scX = rightBound - rightReserved - scMetrics.width - 8;
			ctx.fillRect(scX, r.y + (r.height - (scMetrics.lineHeight + 4)) * 0.5, scMetrics.width + 8, scMetrics.lineHeight + 4, t.surfaceMuted, 4);
			ctx.drawStyledText(
				scX + 4,
				r.y + (r.height - scMetrics.lineHeight) * 0.5,
				scMetrics.width,
				t.textSecondary,
				scStyle,
				this.opts.shortcut,
			);
			rightReserved += scMetrics.width + 14;
		}

		if (this.opts.badgeText !== undefined && this.opts.badgeText.length > 0) {
			const badgeStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: t.fontSizeSmall, fontWeight: 500 };
			const bMetrics = ctx.measureText(badgeStyle, 0, this.opts.badgeText);
			const bx = rightBound - rightReserved - bMetrics.width - 6;
			ctx.drawStyledText(
				bx,
				r.y + (r.height - bMetrics.lineHeight) * 0.5,
				bMetrics.width + 4,
				t.textMuted,
				badgeStyle,
				this.opts.badgeText,
			);
			rightReserved += bMetrics.width + 12;
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
			this.opts.active ? t.accent : t.textPrimary,
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

	measure(_ctx: GuiRenderContext, maxWidth: number): Size {
		return { width: Math.max(40, maxWidth), height: 8 };
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
			this.ratioValue >= 0.9 ? t.danger : this.ratioValue >= 0.75 ? t.warning : t.accent;
		if (fillW > 0) {
			ctx.fillRect(r.x, r.y, Math.min(r.width, fillW), r.height, barColor, radius);
		}
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

	measure(_ctx: GuiRenderContext, maxWidth: number): Size {
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
		if (this.isFocused()) {
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

	override handlePointer(event: GuiPointerEvent): GuiPointerResult {
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
	readonly extensionCommands?: readonly WakuCommandItem[];
	readonly onNewSession?: () => void | Promise<void>;
	readonly onOpenSessionPicker?: () => void;
	readonly onForkSession?: () => void | Promise<void>;
	readonly onCompactContext?: () => void | Promise<void>;
	readonly onToggleSidebar?: () => void;
	readonly onToggleRightPanel?: () => void;
	readonly onSwitchRightTab?: (tab: "changes" | "files" | "tree") => void;
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

function addSectionHeader(container: VStack, label: string, theme: GuiTheme): void {
	container.addChild(
		new Box({
			padding: { top: 8, bottom: 3, left: 8, right: 8 },
			child: new Text({
				text: label,
				fontSize: theme.fontSizeSmall,
				fontWeight: 600,
				color: theme.textMuted,
			}),
		}),
	);
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
			group: "Sessions",
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
			group: "Sessions",
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
			group: "Sessions",
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
			group: "Sessions",
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
	let selectedIdx = 0;
	let rowHandles: WakuOverlayRow[] = [];
	const listStack = new VStack({ gap: 2 });
	const scrollView = new ScrollView({ child: listStack });
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

	const rebuildList = (query: string): void => {
		filteredActions = fuzzyFilter(actions, query, (item) => `${item.group} ${item.label} ${item.description ?? ""}`);
		if (filteredActions.length === 0) {
			selectedIdx = 0;
		} else if (selectedIdx >= filteredActions.length) {
			selectedIdx = filteredActions.length - 1;
		}
		listStack.clear();
		rowHandles = [];

		if (filteredActions.length === 0) {
			listStack.addChild(
				new Box({
					padding: { vertical: 16, horizontal: 10 },
					child: new Text({ text: "No matching commands", color: theme.textMuted, fontSize: theme.fontSizeBody }),
				}),
			);
			return;
		}

		let flatIdx = 0;
		for (let gi = 0; gi < COMMAND_GROUP_ORDER.length; gi++) {
			const groupName = COMMAND_GROUP_ORDER[gi];
			if (groupName === undefined) continue;
			const groupItems = filteredActions.filter((item) => item.group === groupName);
			if (groupItems.length === 0) continue;

			addSectionHeader(listStack, groupName, theme);
			for (let ii = 0; ii < groupItems.length; ii++) {
				const cmd = groupItems[ii];
				if (cmd === undefined) continue;
				const currentFlatIdx = flatIdx;
				flatIdx += 1;
				const row = new WakuOverlayRow({
					label: cmd.label,
					subtitle: cmd.description,
					shortcut: cmd.shortcut,
					selected: currentFlatIdx === selectedIdx,
					onClick: () => runCommand(cmd),
				});
				rowHandles.push(row);
				listStack.addChild(row);
			}
		}
	};

	const searchInput = new ModalSearchInput({
		placeholder: "Type a command or search...",
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

	rebuildList("");

	const headerRow = new HStack({
		gap: 8,
		align: "center",
		children: [
			new Text({ text: "Command Palette", fontSize: theme.fontSizeSmall, fontWeight: 600, color: theme.textMuted }),
			{ child: new Spacer(), grow: 1 },
			new IconButton({
				icon: "close",
				size: 24,
				iconSize: 12,
				label: "Close",
				onClick: () => overlayHandle?.hide(),
			}),
		],
	});

	const body = new VStack({
		gap: 10,
		children: [
			headerRow,
			searchInput,
			new Divider(),
			new Box({ maxHeight: 340, fillWidth: true, child: scrollView }),
		],
	});

	overlayHandle = app.showOverlay(createModalSurfaceBox(theme, body, 560), {
		anchor: "top-center",
		offsetY: 42,
		width: "90%",
		maxWidth: 560,
		maxHeight: 460,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.42),
		onDismiss: options.onDismiss,
	});
	app.setFocus(searchInput);
	return overlayHandle;
}

export interface WakuModelPickerOptions {
	readonly onOpenSettings?: () => void;
	readonly onDismiss?: () => void;
}

/**
 * Open Waku ⌘M Searchable Model Picker grouped by provider with Coral active checkmark,
 * keyboard ↑/↓/Enter/Esc navigation, and "Open Settings" action.
 */
export function openModelPicker(
	app: GuiApp,
	controller: GuiSessionController,
	options: WakuModelPickerOptions = {},
): OverlayHandle {
	const theme = app.getTheme();
	const models = controller.getAvailableModels();
	const active = controller.getStatus().activeModel;
	let filteredModels: GuiModelSummary[] = models.slice();
	let selectedIdx = Math.max(
		0,
		filteredModels.findIndex((m) => active !== undefined && m.provider === active.provider && m.id === active.id),
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
		const rawFiltered = fuzzyFilter(models, query, (m) => `${m.provider} ${m.id} ${m.name} ${m.description}`);
		listStack.clear();
		rowHandles = [];
		filteredModels = [];

		if (rawFiltered.length === 0) {
			listStack.addChild(
				new Box({
					padding: { vertical: 16, horizontal: 10 },
					child: new Text({ text: "No matching models", color: theme.textMuted }),
				}),
			);
			return;
		}

		// Group stably by provider order
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
				const row = new WakuOverlayRow({
					label: model.name || model.id,
					subtitle: model.description,
					badgeText: model.reasoning ? "Reasoning" : model.id,
					checked: isActive,
					active: isActive,
					accentCheck: true,
					selected: idx === selectedIdx,
					onClick: () => chooseModel(model),
				});
				rowHandles.push(row);
				listStack.addChild(row);
			}
		}
	};

	const searchInput = new ModalSearchInput({
		placeholder: "Search models by provider or name...",
		onChange: (query) => {
			selectedIdx = 0;
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
			overlayHandle?.hide();
		},
	});

	rebuildList("");

	const header = new HStack({
		gap: 8,
		align: "center",
		children: [
			new Text({ text: "Select Model", fontSize: theme.fontSizeHeading, fontWeight: 600, color: theme.textBright }),
			{ child: new Spacer(), grow: 1 },
			new IconButton({
				icon: "close",
				size: 26,
				iconSize: 13,
				label: "Close",
				onClick: () => overlayHandle?.hide(),
			}),
		],
	});

	const footer = new HStack({
		gap: 8,
		align: "center",
		children: [
			new Button({
				label: "Open Settings",
				variant: "ghost",
				leadingIcon: "sliders",
				onClick: () => {
					overlayHandle?.hide();
					if (options.onOpenSettings) {
						options.onOpenSettings();
					} else {
						openSettingsModal(app, controller);
					}
				},
			}),
			{ child: new Spacer(), grow: 1 },
			new Button({
				label: "Close",
				variant: "secondary",
				onClick: () => overlayHandle?.hide(),
			}),
		],
	});

	const body = new VStack({
		gap: 10,
		children: [
			header,
			searchInput,
			new Box({ maxHeight: 310, fillWidth: true, child: scrollView }),
			new Divider(),
			footer,
		],
	});

	overlayHandle = app.showOverlay(createModalSurfaceBox(theme, body, 560), {
		anchor: "top-center",
		offsetY: 56,
		width: "88%",
		maxWidth: 560,
		maxHeight: 490,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.45),
		onDismiss: options.onDismiss,
	});
	app.setFocus(searchInput);
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
export function openGitBranchModal(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: { readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	const branches = snap.gitBranches.slice();
	if (snap.gitBranch.length > 0 && !branches.includes(snap.gitBranch)) {
		branches.unshift(snap.gitBranch);
	}
	let filteredBranches: string[] = branches.slice();
	let selectedIdx = Math.max(0, filteredBranches.indexOf(snap.gitBranch));
	let rowHandles: WakuOverlayRow[] = [];
	const listStack = new VStack({ gap: 2 });
	const scrollView = new ScrollView({ child: listStack });
	const errorText = new Text({ text: "", color: theme.danger, fontSize: theme.fontSizeSmall });
	errorText.visible = false;
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

		if (filteredBranches.length === 0) {
			listStack.addChild(
				new Box({
					padding: { vertical: 12, horizontal: 8 },
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
				onClick: () => {
					void checkoutSelected(branch);
				},
			});
			rowHandles.push(row);
			listStack.addChild(row);
		}
	};

	const filterInput = new ModalSearchInput({
		placeholder: "Filter branches...",
		onChange: (val) => {
			selectedIdx = 0;
			rebuildList(val);
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

	const createInput = new Input({
		placeholder: "New branch name...",
		padding: { vertical: 7, horizontal: 10 },
		radius: 8,
		onSubmit: (name) => {
			void handleCreate(name);
		},
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

	rebuildList("");

	const body = new VStack({
		gap: 10,
		children: [
			new HStack({
				gap: 8,
				align: "center",
				children: [
					new Text({ text: "Git Branches", fontSize: theme.fontSizeHeading, fontWeight: 600, color: theme.textBright }),
					{ child: new Spacer(), grow: 1 },
					new Pill({ label: snap.gitBranch || "detached", leadingIcon: "git-branch", variant: "accent" }),
					new IconButton({
						icon: "close",
						size: 26,
						iconSize: 13,
						label: "Close",
						onClick: () => overlayHandle?.hide(),
					}),
				],
			}),
			filterInput,
			new Box({ maxHeight: 210, fillWidth: true, child: scrollView }),
			new Divider(),
			new Text({ text: "Create new branch", fontSize: theme.fontSizeSmall, fontWeight: 600, color: theme.textSecondary }),
			new HStack({
				gap: 8,
				align: "center",
				children: [
					{ child: createInput, grow: 1 },
					new Button({
						label: "Create Branch",
						variant: "primary",
						leadingIcon: "plus",
						onClick: () => {
							void handleCreate(createInput.getValue());
						},
					}),
				],
			}),
			errorText,
		],
	});

	overlayHandle = app.showOverlay(createModalSurfaceBox(theme, body, 500), {
		anchor: "center",
		width: "88%",
		maxWidth: 500,
		maxHeight: 460,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.45),
		onDismiss: callbacks.onDismiss,
	});
	app.setFocus(filterInput);
	return overlayHandle;
}

/**
 * Open Git Commit Modal with file selection checkboxes and commit message input.
 */
export function openGitCommitModal(
	app: GuiApp,
	controller: GuiSessionController,
	callbacks: { readonly onDismiss?: () => void } = {},
): OverlayHandle {
	const theme = app.getTheme();
	const snap = controller.getSnapshot();
	const files = snap.changedFiles;
	const selectedPaths = new Set<string>();
	for (let i = 0; i < files.length; i++) {
		const f = files[i];
		if (f !== undefined) selectedPaths.add(f.path);
	}

	const checkRows: CommitFileCheckRow[] = [];
	const fileStack = new VStack({ gap: 2 });
	const errorText = new Text({ text: "", color: theme.danger, fontSize: theme.fontSizeSmall });
	errorText.visible = false;
	let overlayHandle: OverlayHandle | undefined;

	const showError = (err: unknown): void => {
		const msg = err instanceof Error ? err.message : String(err);
		errorText.setText(msg);
		errorText.visible = msg.length > 0;
	};

	for (let i = 0; i < files.length; i++) {
		const f = files[i];
		if (f === undefined) continue;
		const row = new CommitFileCheckRow(f, true, (checked) => {
			if (checked) {
				selectedPaths.add(f.path);
			} else {
				selectedPaths.delete(f.path);
			}
		});
		checkRows.push(row);
		fileStack.addChild(row);
	}
	if (files.length === 0) {
		fileStack.addChild(
			new Box({
				padding: { vertical: 14, horizontal: 8 },
				child: new Text({ text: "No modified files in working tree.", color: theme.textMuted }),
			}),
		);
	}

	const messageInput = new Input({
		placeholder: "Commit message...",
		padding: { vertical: 8, horizontal: 10 },
		radius: 8,
		onSubmit: () => {
			void submitCommit();
		},
	});

	const submitCommit = async (): Promise<void> => {
		const msg = messageInput.getValue().trim();
		if (msg.length === 0) {
			showError("Commit message cannot be empty.");
			return;
		}
		if (files.length > 0 && selectedPaths.size === 0) {
			showError("Select at least one file to commit.");
			return;
		}
		const chosen = Array.from(selectedPaths);
		try {
			await controller.commitChanges(msg, chosen.length > 0 ? chosen : undefined);
			overlayHandle?.hide();
		} catch (err) {
			showError(err);
		}
	};

	const setAllChecked = (checked: boolean): void => {
		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			const row = checkRows[i];
			if (f !== undefined && row !== undefined) {
				row.setChecked(checked);
				if (checked) selectedPaths.add(f.path);
				else selectedPaths.delete(f.path);
			}
		}
	};

	const body = new VStack({
		gap: 10,
		children: [
			new HStack({
				gap: 8,
				align: "center",
				children: [
					new Text({ text: "Commit Changes", fontSize: theme.fontSizeHeading, fontWeight: 600, color: theme.textBright }),
					{ child: new Spacer(), grow: 1 },
					new Pill({ label: snap.gitBranch || "HEAD", leadingIcon: "git-branch", variant: "neutral" }),
					new IconButton({
						icon: "close",
						size: 26,
						iconSize: 13,
						label: "Close",
						onClick: () => overlayHandle?.hide(),
					}),
				],
			}),
			new HStack({
				gap: 8,
				align: "center",
				children: [
					new Text({ text: `${files.length} changed file(s)`, fontSize: theme.fontSizeSmall, color: theme.textSecondary }),
					{ child: new Spacer(), grow: 1 },
					new Button({ label: "Select All", variant: "ghost", fontSize: 11, padding: { vertical: 3, horizontal: 8 }, onClick: () => setAllChecked(true) }),
					new Button({ label: "Clear", variant: "ghost", fontSize: 11, padding: { vertical: 3, horizontal: 8 }, onClick: () => setAllChecked(false) }),
				],
			}),
			new Box({
				maxHeight: 200,
				fillWidth: true,
				borderColor: theme.border,
				borderWidth: 1,
				radius: 8,
				padding: 4,
				child: new ScrollView({ child: fileStack }),
			}),
			messageInput,
			errorText,
			new HStack({
				gap: 8,
				align: "center",
				children: [
					{ child: new Spacer(), grow: 1 },
					new Button({ label: "Cancel", variant: "secondary", onClick: () => overlayHandle?.hide() }),
					new Button({
						label: "Commit",
						variant: "primary",
						leadingIcon: "git-commit",
						onClick: () => {
							void submitCommit();
						},
					}),
				],
			}),
		],
	});

	overlayHandle = app.showOverlay(createModalSurfaceBox(theme, body, 540), {
		anchor: "center",
		width: "90%",
		maxWidth: 540,
		maxHeight: 490,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.45),
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
				new Text({ text: label, fontSize: theme.fontSizeSmall, color: theme.textSecondary }),
				{ child: new Spacer(), grow: 1 },
				new Text({ text: val, fontSize: theme.fontSizeSmall, fontWeight: 600, fontFamily: SGUI_FONT_MONO, color: theme.textPrimary }),
			],
		});

	const progressBar = new ContextProgressBar(pct);
	const body = new VStack({
		gap: 10,
		children: [
			new HStack({
				gap: 8,
				align: "center",
				children: [
					new Text({ text: "Context Window", fontSize: theme.fontSizeBody, fontWeight: 600, color: theme.textBright }),
					{ child: new Spacer(), grow: 1 },
					new Pill({ label: pctLabel, variant: pct !== null && pct >= 90 ? "danger" : pct !== null && pct >= 75 ? "warning" : "accent" }),
					new IconButton({
						icon: "close",
						size: 22,
						iconSize: 12,
						label: "Close",
						onClick: () => overlayHandle?.hide(),
					}),
				],
			}),
			new HStack({
				gap: 6,
				align: "center",
				children: [
					new Text({ text: `${usedStr} / ${maxStr} tokens`, fontSize: theme.fontSizeSmall, color: theme.textPrimary, fontWeight: 600 }),
					{ child: new Spacer(), grow: 1 },
					new TruncatedText({
						text: usage?.modelId ?? snap.status.activeModel?.id ?? "",
						fontSize: theme.fontSizeSmall,
						color: theme.textMuted,
					}),
				],
			}),
			progressBar,
			new Divider(),
			statRow("Input Tokens", formatCompactTokens(usage?.inputTokens)),
			statRow("Output Tokens", formatCompactTokens(usage?.outputTokens)),
			statRow("Cache Read", formatCompactTokens(usage?.cacheReadTokens)),
			statRow("Cache Write", formatCompactTokens(usage?.cacheWriteTokens)),
			statRow("Estimated Cost", formatUsd(usage?.totalCostUsd)),
			new Divider(),
			new HStack({
				gap: 8,
				align: "center",
				children: [
					new Button({
						label: "Compact Context",
						variant: "primary",
						leadingIcon: "sparkles",
						onClick: () => {
							overlayHandle?.hide();
							void controller.compactSession();
						},
					}),
					{ child: new Spacer(), grow: 1 },
					new Button({
						label: "Close",
						variant: "ghost",
						onClick: () => overlayHandle?.hide(),
					}),
				],
			}),
		],
	});

	const overlayOpts: OverlayOptions = {
		anchor: options.anchorRect ? undefined : "center",
		anchorRect: options.anchorRect,
		width: 340,
		maxWidth: 360,
		maxHeight: 380,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(theme.background, 0.25),
		onDismiss: options.onDismiss,
	};

	overlayHandle = app.showOverlay(createModalSurfaceBox(theme, body, 360, 14), overlayOpts);
	return overlayHandle;
}

export interface WakuSettingsModalOptions {
	readonly initialCategory?: "appearance" | "model" | "workspace" | "shortcuts";
	readonly onOpenModelPicker?: () => void;
	readonly onToggleTheme?: () => void;
	readonly onDismiss?: () => void;
}

type SettingsCategoryId = "appearance" | "model" | "workspace" | "shortcuts";

/**
 * Open Waku Left-Rail Categorized Settings Dialog (`⌘,`):
 * Appearance & Theme, Model & Thinking, Workspace & Chrome, Shortcuts & Info.
 * Persists changes immediately via `controller.updateLayoutPreferences(...)`.
 */
export function openSettingsModal(
	app: GuiApp,
	controller: GuiSessionController,
	options: WakuSettingsModalOptions = {},
): OverlayHandle {
	let activeCategory: SettingsCategoryId = options.initialCategory ?? "appearance";
	const contentHolder = new Box({ fillWidth: true });
	const navRows = new Map<SettingsCategoryId, WakuOverlayRow>();
	let overlayHandle: OverlayHandle | undefined;
	let initialFocusTarget: GuiComponent | undefined;

	const categories: readonly { readonly id: SettingsCategoryId; readonly label: string; readonly icon: VectorIconName }[] = [
		{ id: "appearance", label: "Appearance & Theme", icon: "palette" },
		{ id: "model", label: "Model & Thinking", icon: "cpu" },
		{ id: "workspace", label: "Workspace & Chrome", icon: "layout" },
		{ id: "shortcuts", label: "Shortcuts & Info", icon: "info" },
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
		for (const [id, row] of navRows.entries()) {
			row.setSelected(id === activeCategory);
		}
	};

	const rebuildContent = (): void => {
		const theme = app.getTheme();
		const snap = controller.getSnapshot();
		const layout = snap.layout;
		const status = snap.status;

		if (activeCategory === "appearance") {
			const toggleThemeBtn = new Button({
				label: "Toggle Theme",
				variant: "primary",
				leadingIcon: theme.dark ? "sun" : "moon",
				onClick: triggerToggleTheme,
			});
			initialFocusTarget = toggleThemeBtn;

			const appearanceSeg = new SegmentedControl({
				label: "Appearance",
				items: [
					{ id: "system", label: "System" },
					{ id: "dark", label: "Dark" },
					{ id: "light", label: "Light" },
				],
				selectedId: layout.appearance,
				onChange: (id) => {
					if (id === "system" || id === "dark" || id === "light") {
						syncAppearance(id);
						rebuildContent();
					}
				},
			});

			contentHolder.setChild(
				new VStack({
					gap: 14,
					children: [
						new Text({ text: "Appearance & Theme", fontSize: 15, fontWeight: 600, color: theme.textBright }),
						new Text({
							text: "Choose System, Dark, or Light mode matching native macOS window chrome and vibrancy.",
							fontSize: theme.fontSizeSmall,
							color: theme.textSecondary,
						}),
						appearanceSeg,
						new HStack({
							gap: 10,
							align: "center",
							children: [
								toggleThemeBtn,
								new Pill({ label: theme.dark ? "Dark Active" : "Light Active", variant: "neutral" }),
							],
						}),
					],
				}),
			);
			return;
		}

		if (activeCategory === "model") {
			const thinkingItems: SegmentedItem[] = status.availableThinkingLevels.map((lvl) => ({
				id: lvl,
				label: lvl,
			}));
			const thinkingSeg = new SegmentedControl({
				label: "Thinking Level",
				items: thinkingItems.length > 0 ? thinkingItems : [{ id: status.thinkingLevel, label: status.thinkingLevel }],
				selectedId: status.thinkingLevel,
				onChange: (id) => {
					controller.setThinkingLevel(id as ThinkingLevel);
					rebuildContent();
				},
			});
			contentHolder.setChild(
				new VStack({
					gap: 14,
					children: [
						new Text({ text: "Model & Thinking", fontSize: 15, fontWeight: 600, color: theme.textBright }),
						new HStack({
							gap: 8,
							align: "center",
							children: [
								new Text({
									text: status.activeModel ? status.activeModel.label : "No active model",
									fontSize: theme.fontSizeBody,
									fontWeight: 500,
									color: theme.textPrimary,
								}),
								{ child: new Spacer(), grow: 1 },
								new Button({
									label: "Switch Model",
									variant: "secondary",
									onClick: () => {
										overlayHandle?.hide();
										if (options.onOpenModelPicker) {
											options.onOpenModelPicker();
										} else {
											openModelPicker(app, controller);
										}
									},
								}),
							],
						}),
						new Text({ text: "Reasoning Effort", fontSize: theme.fontSizeSmall, fontWeight: 600, color: theme.textSecondary }),
						thinkingSeg,
					],
				}),
			);
			return;
		}

		if (activeCategory === "workspace") {
			const sidebarSwitch = new Switch({
				label: "Show Left Sidebar",
				checked: !layout.sidebarCollapsed,
				onChange: (checked) => {
					controller.updateLayoutPreferences({ sidebarCollapsed: !checked });
					rebuildContent();
				},
			});
			const rightPanelSwitch = new Switch({
				label: "Show Right Inspector Panel",
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

			contentHolder.setChild(
				new VStack({
					gap: 12,
					children: [
						new Text({ text: "Workspace & Chrome", fontSize: 15, fontWeight: 600, color: theme.textBright }),
						sidebarSwitch,
						rightPanelSwitch,
						new Text({ text: "Sidebar Grouping", fontSize: theme.fontSizeSmall, color: theme.textSecondary }),
						groupSeg,
						new Text({ text: "Diff Presentation", fontSize: theme.fontSizeSmall, color: theme.textSecondary }),
						diffSeg,
					],
				}),
			);
			return;
		}

		const shortcuts: readonly [string, string][] = [
			["⌘K", "Open Command Palette"],
			["⌘M", "Switch Model"],
			["⌘⇧O", "Resume Session Picker"],
			["⌘N", "New Session"],
			["⌘,", "Open Settings"],
			["⌘B", "Toggle Left Sidebar"],
			["⌘F", "Find in Transcript"],
		];
		const shortcutList = new VStack({ gap: 6 });
		for (let i = 0; i < shortcuts.length; i++) {
			const pair = shortcuts[i];
			if (pair === undefined) continue;
			shortcutList.addChild(
				new HStack({
					gap: 10,
					align: "center",
					children: [
						new Pill({ label: pair[0], variant: "neutral" }),
						new Text({ text: pair[1], fontSize: theme.fontSizeSmall, color: theme.textPrimary }),
					],
				}),
			);
		}
		contentHolder.setChild(
			new VStack({
				gap: 12,
				children: [
					new Text({ text: "Shortcuts & Info", fontSize: 15, fontWeight: 600, color: theme.textBright }),
					shortcutList,
					new Divider(),
					new TruncatedText({ text: `Workspace: ${status.cwd}`, fontSize: theme.fontSizeSmall, color: theme.textSecondary }),
				],
			}),
		);
	};

	const railStack = new VStack({ gap: 4 });
	for (let i = 0; i < categories.length; i++) {
		const cat = categories[i];
		if (cat === undefined) continue;
		const row = new WakuOverlayRow({
			label: cat.label,
			leadingIcon: cat.icon,
			selected: cat.id === activeCategory,
			onClick: () => {
				activeCategory = cat.id;
				rebuildNav();
				rebuildContent();
			},
		});
		navRows.set(cat.id, row);
		railStack.addChild(row);
	}

	rebuildContent();
	const currentTheme = app.getTheme();

	const header = new HStack({
		gap: 8,
		align: "center",
		children: [
			new Text({ text: "Settings", fontSize: currentTheme.fontSizeHeading, fontWeight: 600, color: currentTheme.textBright }),
			{ child: new Spacer(), grow: 1 },
			new IconButton({
				icon: "close",
				size: 26,
				iconSize: 13,
				label: "Close",
				onClick: () => overlayHandle?.hide(),
			}),
		],
	});

	const mainRow = new HStack({
		gap: 14,
		align: "stretch",
		children: [
			{ child: new Box({ width: 196, padding: { right: 6 }, child: railStack }), basis: 196, shrink: 0 },
			{ child: new Divider({ direction: "vertical" }), basis: 1, shrink: 0 },
			{ child: new Box({ padding: { horizontal: 4 }, fillWidth: true, child: contentHolder }), grow: 1 },
		],
	});

	const footer = new HStack({
		gap: 8,
		align: "center",
		children: [
			{ child: new Spacer(), grow: 1 },
			new Button({
				label: "Close",
				variant: "secondary",
				onClick: () => overlayHandle?.hide(),
			}),
		],
	});

	const root = createModalSurfaceBox(
		currentTheme,
		new VStack({
			gap: 12,
			children: [
				header,
				new Divider(),
				new Box({ minHeight: 230, fillWidth: true, child: mainRow }),
				new Divider(),
				footer,
			],
		}),
		740,
		16,
	);

	overlayHandle = app.showOverlay(root, {
		anchor: "center",
		width: "90%",
		maxWidth: 740,
		maxHeight: 520,
		modal: true,
		radius: 12,
		shadow: "lg",
		dismissOnBackdropClick: true,
		dismissOnEscape: true,
		backdropColor: withAlpha(currentTheme.background, 0.45),
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
