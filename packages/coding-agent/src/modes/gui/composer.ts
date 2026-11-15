import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	type A11yActionKind,
	type AutocompleteItem,
	AutocompleteProvider,
	type AutocompleteResult,
	Badge,
	Box,
	Button,
	type Color,
	CombinedAutocompleteProvider,
	type CornerRadii,
	clampNumber,
	DARK_THEME,
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
	Image,
	mixColors,
	type OverlayHandle,
	pointInRect,
	type RasterSurface,
	type Rect,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	type Size,
	type SlashCommand,
	Spacer,
	Text,
	TruncatedText,
	type VectorIconName,
	VectorCanvas,
	VectorIcon,
	VStack,
	withAlpha,
} from "scriptc-ui";
import {
	isNativeDarwinAvailable,
	nativeClipboardGetFilePaths,
	nativeClipboardGetImagePng,
	nativeClipboardGetText,
	nativeImageInspect,
} from "../../../../pi-native-ffi/src/index.ts";
import {
	ClickableContainer,
	createExtensionWidgetCard,
	type ExtensionWidgetCardHandle,
	type ThemedCard,
	WrappingPillRow,
} from "./cards.ts";
import type {
	GuiAttachmentItem,
	GuiChangedFile,
	GuiContextUsage,
	GuiControllerEvent,
	GuiExtensionStatusEntry,
	GuiExtensionWidgetEntry,
	GuiQueuedMessageItem,
	GuiSessionController,
	GuiSessionSnapshot,
	GuiSessionStatus,
	GuiWorkspaceFileEntry,
} from "./types.ts";

const COMPOSER_MAX_WIDTH = 760;
const COMPOSER_HORIZONTAL_INSET = 16;
const COMPOSER_CARD_RADIUS = 13;
const ACTION_CIRCLE_SIZE = 26;
const FOOTER_HEIGHT = 28;
const PASTED_TEXT_LINE_THRESHOLD = 15;
const PASTED_TEXT_BYTES_THRESHOLD = 2048;
const MAX_AUTOCOMPLETE_ITEMS = 10;

const DEFAULT_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

const DEFAULT_SLASH_COMMANDS: readonly SlashCommand[] = [
	{ name: "help", description: "Show shortcuts and commands" },
	{ name: "clear", description: "Clear the current transcript" },
	{ name: "new", description: "Start a fresh session" },
	{ name: "compact", description: "Compact conversation context" },
	{ name: "model", description: "Switch active model" },
	{ name: "thinking", description: "Change reasoning depth" },
	{ name: "fork", description: "Fork conversation from an entry" },
	{ name: "tree", description: "Navigate session branch tree" },
	{ name: "sessions", description: "Open session switcher" },
	{ name: "export", description: "Export transcript to HTML" },
	{ name: "exit", description: "Quit GUI session" },
];

/** Optional clipboard override bridge for deterministic testing or native customization. */
export interface WakuComposerClipboardBridge {
	readonly hasImage?: () => boolean;
	readonly readImagePng?: () => Uint8Array | null;
	readonly readFilePaths?: () => readonly string[];
	readonly readText?: () => string | null;
}

/** Configuration options for {@link createWakuComposer}. */
export interface WakuComposerOptions {
	readonly initialTheme?: GuiTheme;
	readonly slashCommands?: readonly SlashCommand[];
	readonly clipboard?: WakuComposerClipboardBridge;
	readonly onOpenModelPicker?: () => void;
	readonly onOpenAttachDialog?: () => void;
	readonly onToggleShellMode?: (active: boolean) => void;
	readonly onSlashCommand?: (command: string, args: string) => boolean | Promise<boolean>;
	readonly onSubmitPrompt?: (text: string, attachments: readonly GuiAttachmentItem[]) => void;
}

/** Handle returned by {@link createWakuComposer} for lifecycle, attachments, and test hooks. */
export interface WakuComposerHandle extends ThemedCard {
	readonly editor: Editor;
	readonly card: GuiComponent;
	applySnapshot(snapshot: GuiSessionSnapshot): void;
	handleEvent(event: GuiControllerEvent): void;
	getAttachments(): readonly GuiAttachmentItem[];
	addAttachment(item: GuiAttachmentItem): void;
	removeAttachment(id: string): void;
	clearAttachments(): void;
	pasteFromClipboard(overrideText?: string): boolean;
	getAutocompleteItems(): readonly AutocompleteItem[];
	selectAutocompleteIndex(index: number): void;
	acceptSelectedAutocomplete(): boolean;
	dismissAutocomplete(): void;
	submitCurrent(mode?: "auto" | "followUp" | "steer"): void;
	setText(text: string): void;
	focus(): void;
	dispose(): void;
}

/** Configuration options for {@link createWakuFooterBar}. */
export interface WakuFooterBarOptions {
	readonly initialTheme?: GuiTheme;
	readonly onWorkspaceClick?: () => void;
	readonly onGitBranchClick?: () => void;
	readonly onContextClick?: (usage: GuiContextUsage | undefined) => void;
}

/** Handle returned by {@link createWakuFooterBar}. */
export interface WakuFooterBarHandle extends ThemedCard {
	applySnapshot(snapshot: GuiSessionSnapshot): void;
	handleEvent(event: GuiControllerEvent): void;
	setContextUsage(usage: GuiContextUsage | undefined): void;
	getFormattedContextLabel(): string;
	dispose(): void;
}

function replaceStackChildren(stack: VStack | HStack, children: readonly GuiComponent[]): void {
	stack.clear();
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child !== undefined) {
			stack.addChild(child);
		}
	}
}

function mergeSlashCommands(custom: readonly SlashCommand[] | undefined): readonly SlashCommand[] {
	const merged: SlashCommand[] = [];
	const seen = new Set<string>();
	if (custom !== undefined) {
		for (let i = 0; i < custom.length; i++) {
			const cmd = custom[i];
			if (cmd === undefined || seen.has(cmd.name)) continue;
			seen.add(cmd.name);
			merged.push(cmd);
		}
	}
	for (let i = 0; i < DEFAULT_SLASH_COMMANDS.length; i++) {
		const cmd = DEFAULT_SLASH_COMMANDS[i];
		if (cmd === undefined || seen.has(cmd.name)) continue;
		seen.add(cmd.name);
		merged.push(cmd);
	}
	return merged;
}

function formatSizeBytes(bytes: number | undefined): string {
	if (bytes === undefined || bytes <= 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSnippet(text: string, maxChars = 64): string {
	const single = text.replace(/\s+/g, " ").trim();
	if (single.length <= maxChars) return single;
	return `${single.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatModelLabel(status: GuiSessionStatus): string {
	if (status.activeModel === undefined) return "Select model";
	const id = status.activeModel.id;
	return id.length > 28 ? `${id.slice(0, 27)}…` : id;
}

function mimeFromExtension(ext: string): string {
	const lower = ext.toLowerCase();
	if (lower === ".jpg" || lower === ".jpeg") return "image/jpeg";
	if (lower === ".gif") return "image/gif";
	if (lower === ".webp") return "image/webp";
	return "image/png";
}

function isImagePath(filePath: string): boolean {
	const ext = extname(filePath).toLowerCase();
	return IMAGE_EXTENSIONS.includes(ext);
}

function resolveFileCandidate(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed.includes("\n")) return undefined;
	if (trimmed.startsWith("file://")) {
		try {
			const url = new URL(trimmed);
			return decodeURIComponent(url.pathname);
		} catch {
			return undefined;
		}
	}
	if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../") || /^[A-Za-z]:\\/.test(trimmed)) {
		return trimmed;
	}
	return undefined;
}

function parsePngHeaderDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
	if (bytes.byteLength < 24) return undefined;
	// PNG magic: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes[0] !== 0x89 ||
		bytes[1] !== 0x50 ||
		bytes[2] !== 0x4e ||
		bytes[3] !== 0x47
	) {
		return undefined;
	}
	const w =
		(((bytes[16] ?? 0) << 24) |
			((bytes[17] ?? 0) << 16) |
			((bytes[18] ?? 0) << 8) |
			(bytes[19] ?? 0)) >>>
		0;
	const h =
		(((bytes[20] ?? 0) << 24) |
			((bytes[21] ?? 0) << 16) |
			((bytes[22] ?? 0) << 8) |
			(bytes[23] ?? 0)) >>>
		0;
	if (w === 0 || h === 0) return undefined;
	return { width: w, height: h };
}

function inspectImageDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
	if (isNativeDarwinAvailable()) {
		const info = nativeImageInspect(bytes);
		if (info !== null && info.width > 0 && info.height > 0) {
			return { width: info.width, height: info.height };
		}
	}
	return parsePngHeaderDimensions(bytes);
}

function createDefaultClipboardBridge(): WakuComposerClipboardBridge {
	return {
		readImagePng: () => {
			if (!isNativeDarwinAvailable()) return null;
			return nativeClipboardGetImagePng();
		},
		readFilePaths: () => {
			if (!isNativeDarwinAvailable()) return [];
			return nativeClipboardGetFilePaths() ?? [];
		},
		readText: () => {
			if (!isNativeDarwinAvailable()) return null;
			return nativeClipboardGetText();
		},
	};
}

class WakuAutocompleteProvider extends AutocompleteProvider {
	private slashCommands: readonly SlashCommand[];
	private basePath: string;
	private workspaceFiles: readonly GuiWorkspaceFileEntry[];
	private delegate: CombinedAutocompleteProvider;

	constructor(commands: readonly SlashCommand[], basePath: string) {
		super();
		this.slashCommands = commands;
		this.basePath = basePath;
		this.workspaceFiles = [];
		this.delegate = new CombinedAutocompleteProvider(this.slashCommands, this.basePath, true);
	}

	updateContext(basePath: string, workspaceFiles: readonly GuiWorkspaceFileEntry[]): void {
		const pathChanged = basePath.length > 0 && basePath !== this.basePath;
		if (pathChanged) {
			this.basePath = basePath;
			this.delegate = new CombinedAutocompleteProvider(this.slashCommands, this.basePath, true);
		}
		this.workspaceFiles = workspaceFiles;
	}

	getSuggestions(lines: readonly string[], cursorLine: number, cursorCol: number): AutocompleteResult | null {
		const currentLine = lines[cursorLine] ?? "";
		const beforeCursor = currentLine.slice(0, cursorCol);

		// Slash command suggestion on first line
		if (beforeCursor.startsWith("/") && cursorLine === 0) {
			return this.delegate.getSuggestions(lines, cursorLine, cursorCol);
		}

		// @file suggestion merging workspace snapshot index + fs directory scan
		const atMatch = /(?:^|\s)@([^\s]*)$/.exec(beforeCursor);
		if (atMatch === null) {
			return null;
		}
		const token = atMatch[1] ?? "";
		const prefix = `@${token}`;

		const items: AutocompleteItem[] = [];
		const seenValues = new Set<string>();

		if (this.workspaceFiles.length > 0) {
			const candidates: AutocompleteItem[] = [];
			for (let i = 0; i < this.workspaceFiles.length; i++) {
				const entry = this.workspaceFiles[i];
				if (entry === undefined) continue;
				const suffix = entry.isDir ? "/" : "";
				const relPath = entry.relativePath.endsWith("/") ? entry.relativePath : `${entry.relativePath}${suffix}`;
				candidates.push({
					value: `@${relPath}`,
					label: relPath,
					description: entry.isDir ? "dir" : "file",
				});
			}
			const matched = fuzzyFilter(candidates, token, (item) => item.label);
			for (let i = 0; i < matched.length && items.length < MAX_AUTOCOMPLETE_ITEMS; i++) {
				const item = matched[i];
				if (item === undefined || seenValues.has(item.value)) continue;
				seenValues.add(item.value);
				items.push(item);
			}
		}

		const fsResult = this.delegate.getSuggestions(lines, cursorLine, cursorCol);
		if (fsResult !== null) {
			for (let i = 0; i < fsResult.items.length && items.length < MAX_AUTOCOMPLETE_ITEMS; i++) {
				const item = fsResult.items[i];
				if (item === undefined || seenValues.has(item.value)) continue;
				seenValues.add(item.value);
				items.push(item);
			}
		}

		return items.length > 0 ? { items, prefix } : null;
	}

	applyCompletion(
		lines: readonly string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { readonly lines: string[]; readonly cursorLine: number; readonly cursorCol: number } {
		return this.delegate.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}
}

interface ComposerEditorHooks {
	readonly onSpecialKey: (event: GuiKeyEvent, ctx: GuiRenderContext) => boolean;
}

class ComposerEditor extends Editor {
	private hooks: ComposerEditorHooks | undefined;

	setKeyHooks(hooks: ComposerEditorHooks | undefined): void {
		this.hooks = hooks;
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase !== "up" && this.hooks !== undefined) {
			if (this.hooks.onSpecialKey(event, ctx)) {
				return true;
			}
		}
		return super.handleKey(event, ctx);
	}
}

interface ComposerActionCircleOptions {
	readonly onSend: () => void;
	readonly onStop: () => void;
}

class ComposerActionCircle extends GuiComponent {
	private modeValue: "send" | "stop" = "send";
	private activeDraftValue = false;
	private pressed = false;
	private readonly onSendFn: () => void;
	private readonly onStopFn: () => void;

	constructor(options: ComposerActionCircleOptions) {
		super();
		this.onSendFn = options.onSend;
		this.onStopFn = options.onStop;
		this.focusable = true;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	setState(mode: "send" | "stop", activeDraft: boolean): void {
		if (this.modeValue === mode && this.activeDraftValue === activeDraft) return;
		this.modeValue = mode;
		this.activeDraftValue = activeDraft;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const w = Math.min(maxWidth, ACTION_CIRCLE_SIZE);
		const h = maxHeight !== undefined ? Math.min(maxHeight, ACTION_CIRCLE_SIZE) : ACTION_CIRCLE_SIZE;
		return { width: w, height: h };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const t = ctx.theme;
		const radius = Math.min(r.width, r.height) * 0.5;
		const hovered = this.isHovered();
		const focused = ctx.isFocused(this);

		if (focused) {
			drawFocusHalo(ctx, r, radius, 0.28, 3);
		}

		let bg: Color;
		let border: Color | undefined;
		let iconColor: Color;
		let icon: VectorIconName;

		if (this.modeValue === "stop") {
			icon = "stop";
			const baseBg = t.textBright;
			bg = this.pressed ? mixColors(baseBg, t.background, 0.25) : hovered ? mixColors(baseBg, t.background, 0.12) : baseBg;
			iconColor = t.background;
		} else if (this.activeDraftValue) {
			icon = "arrow-up";
			bg = this.pressed ? mixColors(t.accent, t.background, 0.18) : hovered ? t.accentHover : t.accent;
			iconColor = t.textOnAccent;
		} else {
			icon = "arrow-up";
			bg = hovered ? t.surfaceHover : t.surfaceElevated;
			border = t.border;
			iconColor = t.textDisabled;
		}

		ctx.fillRect(r.x, r.y, r.width, r.height, bg, radius);
		if (border !== undefined) {
			ctx.strokeRect(r.x, r.y, r.width, r.height, border, 1, radius);
		}
		const iconSize = this.modeValue === "stop" ? 11 : 13;
		drawVectorIcon(
			ctx,
			icon,
			r.x + (r.width - iconSize) * 0.5,
			r.y + (r.height - iconSize) * 0.5,
			iconSize,
			iconColor,
		);
	}

	private activate(): void {
		if (this.modeValue === "stop") {
			this.onStopFn();
		} else {
			this.onSendFn();
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (event.phase === "down" && event.button === "left") {
			this.pressed = true;
			this.invalidate();
			return { handled: true, capture: this, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "drag") {
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left") {
			const inside = pointInRect(event.x, event.y, this.layoutRect);
			const wasPressed = this.pressed;
			this.pressed = false;
			this.invalidate();
			if (wasPressed && inside) {
				this.activate();
			}
			return { handled: true, releaseCapture: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: false };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (event.phase === "up") return false;
		if (ctx.keybindings.matches(event, "submit") || event.key === " ") {
			this.activate();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let stateFlags = SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) stateFlags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.modeValue === "stop" ? "Stop" : "Send",
			value: this.modeValue,
			rect: this.layoutRect,
			stateFlags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId || !this.visible) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press") {
			this.activate();
			return true;
		}
		return false;
	}
}

class ComposerCardContainer extends Box {
	private isFocusedCheck: (() => boolean) | undefined;

	setFocusPredicate(fn: () => boolean): void {
		this.isFocusedCheck = fn;
	}

	override render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const focused = this.isFocusedCheck !== undefined && this.isFocusedCheck();
		if (focused) {
			drawFocusHalo(ctx, r, COMPOSER_CARD_RADIUS, 0.2, 3);
		}
		super.render(ctx);
		if (focused) {
			const cr = this.getCornerRadii();
			if (cr !== undefined && (cr.tl !== cr.br || cr.tr !== cr.bl)) {
				const radius = Math.max(cr.tl, cr.br);
				ctx.strokeRect(r.x, r.y, r.width, r.height, ctx.theme.accent, 1, radius);
			} else {
				ctx.strokeRect(r.x, r.y, r.width, r.height, ctx.theme.accent, 1, COMPOSER_CARD_RADIUS);
			}
		}
	}
}

/** Centered Waku composer card wrapper with `maxWidth: 760` and horizontal viewport insets. */
class WakuComposerRoot extends GuiComponent {
	private readonly innerColumn: VStack;
	private onPostLayoutSync: (() => void) | undefined;

	constructor(innerColumn: VStack) {
		super();
		this.innerColumn = innerColumn;
		this.innerColumn.setParent(this);
	}

	setOnPostLayoutSync(fn: (() => void) | undefined): void {
		this.onPostLayoutSync = fn;
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.innerColumn.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		super.onThemeChange(theme);
		this.innerColumn.onThemeChange(theme);
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const availW = Math.max(0, maxWidth - COMPOSER_HORIZONTAL_INSET * 2);
		const targetW = Math.min(COMPOSER_MAX_WIDTH, availW);
		const innerSize = this.innerColumn.measure(ctx, targetW, maxHeight);
		return {
			width: maxWidth,
			height: maxHeight !== undefined ? Math.min(maxHeight, innerSize.height) : innerSize.height,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const availW = Math.max(0, rect.width - COMPOSER_HORIZONTAL_INSET * 2);
		const colW = Math.min(COMPOSER_MAX_WIDTH, availW);
		const colX = rect.x + Math.max(COMPOSER_HORIZONTAL_INSET, (rect.width - colW) * 0.5);
		this.innerColumn.layout(ctx, { x: colX, y: rect.y, width: colW, height: rect.height });
		if (this.onPostLayoutSync !== undefined) {
			this.onPostLayoutSync();
		}
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.innerColumn.render(ctx);
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		return this.innerColumn.hitTest(x, y) ?? this;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.innerColumn.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.innerColumn.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return this.innerColumn.findComponentByA11yId(nodeId);
	}
}

/** Create the floating Waku composer card, docked queue tray, attachment strip, and `/` / `@` autocomplete. */
export function createWakuComposer(
	app: GuiApp | undefined,
	controller: GuiSessionController,
	options?: WakuComposerOptions,
): WakuComposerHandle {
	const initialSnapshot = controller.getSnapshot();
	let theme: GuiTheme = options?.initialTheme ?? app?.getTheme() ?? DARK_THEME;

	let currentStatus: GuiSessionStatus = initialSnapshot.status;
	let attachments: GuiAttachmentItem[] = [];
	let queuedMessages: readonly GuiQueuedMessageItem[] = initialSnapshot.queuedMessages;
	let attachmentCounter = 0;

	const clipboardBridge: WakuComposerClipboardBridge = {
		...createDefaultClipboardBridge(),
		...(options?.clipboard ?? {}),
	};

	const autocompleteProvider = new WakuAutocompleteProvider(
		mergeSlashCommands(options?.slashCommands),
		initialSnapshot.status.cwd,
	);
	autocompleteProvider.updateContext(initialSnapshot.status.cwd, initialSnapshot.workspaceFiles);

	let activeSuggestions: readonly AutocompleteItem[] = [];
	let activePrefix = "";
	let selectedSuggestionIndex = 0;
	let activeOverlay: OverlayHandle | undefined;
	let lastOverlayAnchorX = -1;
	let lastOverlayAnchorY = -1;
	let lastOverlayWidth = -1;
	let editorHasFocus = false;

	const aboveWidgetCards: ExtensionWidgetCardHandle[] = [];
	const belowWidgetCards: ExtensionWidgetCardHandle[] = [];
	const aboveWidgetsBox = new VStack({ gap: 6, fillWidth: true });
	aboveWidgetsBox.visible = false;
	const belowWidgetsBox = new VStack({ gap: 6, fillWidth: true });
	belowWidgetsBox.visible = false;

	// Docked Queue Tray (top corners rounded, bottom square docked onto composerCard)
	const queueRowsStack = new VStack({ gap: 4, fillWidth: true });
	const queueRadii: CornerRadii = { tl: 10, tr: 10, br: 0, bl: 0 };
	const composerDockedRadii: CornerRadii = { tl: 0, tr: 0, br: COMPOSER_CARD_RADIUS, bl: COMPOSER_CARD_RADIUS };
	const queueTray = new Box({
		background: theme.surfaceMuted,
		borderColor: theme.border,
		borderWidth: 1,
		cornerRadii: queueRadii,
		padding: { top: 6, right: 10, bottom: 6, left: 10 },
		fillWidth: true,
		child: queueRowsStack,
	});
	queueTray.visible = false;

	// Attachment tiles row above editor inside composerCard
	const attachmentsRow = new WrappingPillRow([], 6, 6);
	attachmentsRow.visible = false;

	// Inline autocomplete fallback container when GuiApp isn't mounted or layout hasn't occurred
	const inlineAutocompleteSlot = new VStack({ gap: 0, fillWidth: true });
	inlineAutocompleteSlot.visible = false;

	// Popup card built cleanly with focusable: false items so Editor keeps focus
	const popupRowsStack = new VStack({ gap: 2, fillWidth: true });
	const popupCard = new Box({
		background: theme.surfaceElevated,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 10,
		padding: 6,
		shadow: "md",
		fillWidth: true,
		child: popupRowsStack,
	});
	popupCard.focusable = false;

	// Chromeless multi-line editor
	const editor = new ComposerEditor({
		variant: "chromeless",
		placeholder: "Ask anything, / for commands, @ for files, ! for bash...",
		minLines: 1,
		maxLines: 7,
		padding: { top: 2, right: 4, bottom: 2, left: 4 },
		submitOnEnter: true,
		clearOnSubmit: false,
	});

	// Bottom Control Bar components
	const modelButton = new Button({
		label: formatModelLabel(currentStatus),
		variant: "ghost",
		leadingIcon: "sparkles",
		iconSize: 12,
		fontSize: theme.fontSizeSmall,
		padding: { vertical: 4, horizontal: 8 },
		pill: true,
		onClick: () => {
			if (options?.onOpenModelPicker !== undefined) {
				options.onOpenModelPicker();
			}
		},
	});

	const thinkingButton = new Button({
		label: `Thinking: ${currentStatus.thinkingLevel}`,
		variant: "ghost",
		leadingIcon: "sliders",
		iconSize: 12,
		fontSize: theme.fontSizeSmall,
		padding: { vertical: 4, horizontal: 8 },
		pill: true,
		onClick: () => {
			const levels =
				currentStatus.availableThinkingLevels.length > 0
					? currentStatus.availableThinkingLevels
					: DEFAULT_THINKING_LEVELS;
			const curIdx = levels.indexOf(currentStatus.thinkingLevel);
			const next = levels[(curIdx + 1) % levels.length] ?? "off";
			controller.setThinkingLevel(next);
			currentStatus = { ...currentStatus, thinkingLevel: next };
			thinkingButton.setLabel(`Thinking: ${next}`);
			composerCard.invalidate();
		},
	});

	const attachButton = new IconButton({
		icon: "plus",
		size: 26,
		iconSize: 13,
		radius: 13,
		label: "Attach file or image",
		onClick: () => {
			if (options?.onOpenAttachDialog !== undefined) {
				options.onOpenAttachDialog();
			}
		},
	});

	const shellButton = new Button({
		label: "!",
		variant: "ghost",
		leadingIcon: "terminal",
		iconSize: 12,
		fontSize: theme.fontSizeSmall,
		padding: { vertical: 4, horizontal: 8 },
		pill: true,
		onClick: () => {
			const current = editor.getText();
			const trimmedStart = current.trimStart();
			if (trimmedStart.startsWith("!!")) {
				editor.setText(trimmedStart.slice(2).trimStart());
			} else if (trimmedStart.startsWith("!")) {
				editor.setText(trimmedStart.slice(1).trimStart());
			} else {
				editor.setText(`!${current}`);
			}
			const nowActive = editor.getText().trimStart().startsWith("!");
			if (options?.onToggleShellMode !== undefined) {
				options.onToggleShellMode(nowActive);
			}
			app?.setFocus(editor);
		},
	});

	const steerButton = new Button({
		label: "Steer",
		variant: "secondary",
		fontSize: theme.fontSizeSmall,
		padding: { vertical: 4, horizontal: 10 },
		pill: true,
		onClick: () => {
			submitCurrent("steer");
		},
	});
	steerButton.visible = false;

	const actionCircle = new ComposerActionCircle({
		onSend: () => submitCurrent("auto"),
		onStop: () => {
			void controller.abort();
		},
	});

	const controlsRow = new HStack({
		gap: 6,
		align: "center",
		fillWidth: true,
		children: [
			modelButton,
			thinkingButton,
			attachButton,
			shellButton,
			new Spacer({ flex: 1 }),
			steerButton,
			actionCircle,
		],
	});

	const cardStack = new VStack({
		gap: 8,
		fillWidth: true,
		children: [attachmentsRow, editor, controlsRow],
	});

	const composerCard = new ComposerCardContainer({
		background: theme.surfaceComposer,
		borderColor: theme.border,
		borderWidth: 1,
		radius: COMPOSER_CARD_RADIUS,
		padding: 12,
		shadow: "md",
		fillWidth: true,
		child: cardStack,
	});
	composerCard.setFocusPredicate(() => editorHasFocus || editor.isFocused());

	const innerColumn = new VStack({
		gap: 0,
		fillWidth: true,
		children: [
			aboveWidgetsBox,
			inlineAutocompleteSlot,
			queueTray,
			composerCard,
			belowWidgetsBox,
		],
	});

	const root = new WakuComposerRoot(innerColumn);

	const syncActionAndShellControls = () => {
		const text = editor.getText();
		const trimmed = text.trim();
		const hasDraft = trimmed.length > 0 || attachments.length > 0;
		const isShell = text.trimStart().startsWith("!");

		shellButton.setVariant(isShell ? "secondary" : "ghost");
		shellButton.setLabel(isShell ? "! Shell" : "!");

		const streaming = currentStatus.isStreaming;
		steerButton.visible = streaming && hasDraft;
		actionCircle.setState(streaming ? "stop" : "send", hasDraft);
		composerCard.invalidate();
	};

	const renderAttachmentTiles = () => {
		if (attachments.length === 0) {
			attachmentsRow.visible = false;
			attachmentsRow.setChildren([]);
			syncActionAndShellControls();
			return;
		}
		attachmentsRow.visible = true;
		const tiles: GuiComponent[] = [];
		for (let i = 0; i < attachments.length; i++) {
			const item = attachments[i];
			if (item === undefined) continue;

			let thumb: GuiComponent;
			if (
				item.kind === "image" &&
				item.previewRgba !== undefined &&
				item.previewWidth !== undefined &&
				item.previewHeight !== undefined &&
				item.previewWidth > 0 &&
				item.previewHeight > 0
			) {
				thumb = new Image({
					width: item.previewWidth,
					height: item.previewHeight,
					pixels: item.previewRgba,
					displayWidth: 24,
					displayHeight: 24,
					fit: "contain",
					radius: 4,
				});
			} else {
				const iconName: VectorIconName =
					item.kind === "image" ? "eye" : item.kind === "pasted-text" ? "compose" : "file-code";
				const iconColor =
					item.kind === "image" ? theme.accent : item.kind === "pasted-text" ? theme.warning : theme.info;
				thumb = new Box({
					width: 24,
					height: 24,
					radius: 4,
					background: withAlpha(iconColor, theme.dark ? 0.16 : 0.12),
					alignItems: "center",
					justifyContent: "center",
					child: new VectorIcon({
						icon: iconName,
						size: 13,
						color: iconColor,
					}),
				});
			}

			const sizeLabel = formatSizeBytes(item.sizeBytes);
			const kindTag = item.kind === "image" ? "Image" : item.kind === "pasted-text" ? "Paste" : "File";
			const metaText = sizeLabel.length > 0 ? `${kindTag} · ${sizeLabel}` : kindTag;

			const textCol = new VStack({
				gap: 1,
				children: [
					new Box({
						maxWidth: 160,
						child: new TruncatedText({
							text: item.name,
							fontSize: theme.fontSizeSmall,
							fontWeight: 500,
							color: theme.textBright,
						}),
					}),
					new Text({
						text: metaText,
						fontSize: Math.max(10, theme.fontSizeSmall - 2),
						color: theme.textMuted,
					}),
				],
			});

			const itemId = item.id;
			const removeBtn = new IconButton({
				icon: "close",
				size: 18,
				iconSize: 10,
				radius: 9,
				label: `Remove attachment ${item.name}`,
				onClick: () => removeAttachment(itemId),
			});

			const tile = new Box({
				background: theme.surfaceElevated,
				borderColor: theme.border,
				borderWidth: 1,
				radius: 8,
				padding: { top: 4, right: 6, bottom: 4, left: 6 },
				child: new HStack({
					gap: 6,
					align: "center",
					children: [thumb, textCol, removeBtn],
				}),
			});
			tiles.push(tile);
		}
		attachmentsRow.setChildren(tiles);
		syncActionAndShellControls();
	};

	const renderQueueTray = () => {
		if (queuedMessages.length === 0) {
			queueTray.visible = false;
			replaceStackChildren(queueRowsStack, []);
			composerCard.setCornerRadii(undefined);
			composerCard.setRadius(COMPOSER_CARD_RADIUS);
			composerCard.invalidate();
			return;
		}
		queueTray.visible = true;
		composerCard.setCornerRadii(composerDockedRadii);
		const rows: GuiComponent[] = [];
		for (let i = 0; i < queuedMessages.length; i++) {
			const msg = queuedMessages[i];
			if (msg === undefined) continue;
			const badge = new Badge({
				label: msg.kind === "steer" ? "Steer" : "Follow-up",
				variant: msg.kind === "steer" ? "warning" : "info",
				fontSize: Math.max(10, theme.fontSizeSmall - 1),
				padding: { vertical: 2, horizontal: 7 },
			});
			const attachSuffix =
				msg.attachments !== undefined && msg.attachments.length > 0
					? ` [+${msg.attachments.length}]`
					: "";
			const snippet = new TruncatedText({
				text: `${formatSnippet(msg.text)}${attachSuffix}`,
				fontSize: theme.fontSizeSmall,
				color: theme.textSecondary,
			});
			const msgId = msg.id;
			const cancelBtn = new IconButton({
				icon: "close",
				size: 18,
				iconSize: 10,
				radius: 5,
				label: "Remove queued message",
				onClick: () => {
					controller.removeQueuedMessage(msgId);
					app?.setFocus(editor);
				},
			});
			const row = new HStack({
				gap: 8,
				align: "center",
				fillWidth: true,
				children: [badge, snippet, new Spacer({ flex: 1 }), cancelBtn],
			});
			rows.push(row);
		}
		replaceStackChildren(queueRowsStack, rows);
		queueTray.invalidate();
	};

	const renderWidgets = (entries: readonly GuiExtensionWidgetEntry[]) => {
		aboveWidgetCards.length = 0;
		belowWidgetCards.length = 0;
		const aboveNodes: GuiComponent[] = [];
		const belowNodes: GuiComponent[] = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry === undefined) continue;
			const card = createExtensionWidgetCard(theme, entry);
			if (entry.placement === "belowEditor") {
				belowWidgetCards.push(card);
				belowNodes.push(card.root);
			} else {
				aboveWidgetCards.push(card);
				aboveNodes.push(card.root);
			}
		}
		aboveWidgetsBox.visible = aboveNodes.length > 0;
		replaceStackChildren(aboveWidgetsBox, aboveNodes);
		belowWidgetsBox.visible = belowNodes.length > 0;
		replaceStackChildren(belowWidgetsBox, belowNodes);
	};

	const closeOverlayOnly = () => {
		if (activeOverlay !== undefined) {
			const handle = activeOverlay;
			activeOverlay = undefined;
			handle.dispose();
		}
		lastOverlayAnchorX = -1;
		lastOverlayAnchorY = -1;
		lastOverlayWidth = -1;
	};

	const dismissAutocomplete = () => {
		if (activeSuggestions.length === 0 && activeOverlay === undefined && !inlineAutocompleteSlot.visible) return;
		activeSuggestions = [];
		activePrefix = "";
		selectedSuggestionIndex = 0;
		inlineAutocompleteSlot.visible = false;
		replaceStackChildren(inlineAutocompleteSlot, []);
		closeOverlayOnly();
		root.invalidate();
	};

	const acceptAutocompleteAt = (index: number): boolean => {
		if (activeSuggestions.length === 0) return false;
		const safeIdx = clampNumber(index, 0, activeSuggestions.length - 1);
		const item = activeSuggestions[safeIdx];
		if (item === undefined) return false;

		const lines = editor.getText().split("\n");
		const cursor = editor.getCursor();
		const applied = autocompleteProvider.applyCompletion(lines, cursor.line, cursor.col, item, activePrefix);
		const nextText = applied.lines.join("\n");
		dismissAutocomplete();
		editor.setText(nextText);
		app?.setFocus(editor);
		syncActionAndShellControls();
		return true;
	};

	const rebuildPopupRows = () => {
		const rows: GuiComponent[] = [];
		const count = Math.min(MAX_AUTOCOMPLETE_ITEMS, activeSuggestions.length);
		for (let i = 0; i < count; i++) {
			const item = activeSuggestions[i];
			if (item === undefined) continue;
			const isSelected = i === selectedSuggestionIndex;
			const rowChildren: GuiComponent[] = [
				new Text({
					text: item.label,
					fontSize: theme.fontSizeSmall,
					fontWeight: isSelected ? 600 : 500,
					color: isSelected ? theme.accent : theme.textBright,
				}),
			];
			if (item.description !== undefined && item.description.length > 0) {
				rowChildren.push(new Spacer({ flex: 1 }));
				rowChildren.push(
					new Box({
						maxWidth: 220,
						child: new TruncatedText({
							text: item.description,
							fontSize: Math.max(10, theme.fontSizeSmall - 1),
							color: theme.textMuted,
						}),
					}),
				);
			}
			const idx = i;
			const rowBtn = new ClickableContainer({
				label: item.label,
				background: isSelected ? theme.selection : undefined,
				hoverBackground: theme.surfaceHover,
				radius: 6,
				padding: { top: 5, right: 8, bottom: 5, left: 8 },
				fillWidth: true,
				focusable: false,
				child: new HStack({
					gap: 8,
					align: "center",
					fillWidth: true,
					children: rowChildren,
				}),
				onClick: () => {
					acceptAutocompleteAt(idx);
				},
			});
			rows.push(rowBtn);
		}
		replaceStackChildren(popupRowsStack, rows);
		popupCard.invalidate();
	};

	const syncAutocompleteOverlayAnchor = () => {
		if (activeSuggestions.length === 0) {
			inlineAutocompleteSlot.visible = false;
			closeOverlayOnly();
			return;
		}
		const cardRect = composerCard.layoutRect;
		if (app !== undefined && cardRect.width > 0) {
			inlineAutocompleteSlot.visible = false;
			replaceStackChildren(inlineAutocompleteSlot, []);
			const popupW = Math.min(480, Math.max(240, cardRect.width));
			const anchorMoved =
				activeOverlay === undefined ||
				Math.abs(lastOverlayAnchorX - cardRect.x) > 0.5 ||
				Math.abs(lastOverlayAnchorY - cardRect.y) > 0.5 ||
				Math.abs(lastOverlayWidth - popupW) > 0.5;
			if (anchorMoved) {
				closeOverlayOnly();
				lastOverlayAnchorX = cardRect.x;
				lastOverlayAnchorY = cardRect.y;
				lastOverlayWidth = popupW;
				activeOverlay = app.showOverlay(popupCard, {
					// Large anchor height forces GuiApp to position popupCard directly ABOVE composerCard
					anchorRect: { x: cardRect.x, y: cardRect.y, width: popupW, height: 10000 },
					width: popupW,
					maxHeight: 240,
					margin: 4,
					modal: false,
					dismissOnBackdropClick: true,
					dismissOnEscape: false,
				});
			}
		} else {
			closeOverlayOnly();
			inlineAutocompleteSlot.visible = true;
			replaceStackChildren(inlineAutocompleteSlot, [popupCard]);
		}
	};

	const refreshAutocomplete = () => {
		const lines = editor.getText().split("\n");
		const cursor = editor.getCursor();
		const res = autocompleteProvider.getSuggestions(lines, cursor.line, cursor.col);
		if (res === null || res.items.length === 0) {
			dismissAutocomplete();
			return;
		}
		activeSuggestions = res.items;
		activePrefix = res.prefix;
		selectedSuggestionIndex = clampNumber(selectedSuggestionIndex, 0, activeSuggestions.length - 1);
		rebuildPopupRows();
		syncAutocompleteOverlayAnchor();
		root.invalidate();
	};

	root.setOnPostLayoutSync(() => {
		if (activeSuggestions.length > 0) {
			syncAutocompleteOverlayAnchor();
		}
	});

	const addAttachment = (item: GuiAttachmentItem) => {
		attachments = [...attachments, item];
		renderAttachmentTiles();
		root.invalidate();
	};

	const removeAttachment = (id: string) => {
		attachments = attachments.filter((item) => item.id !== id);
		renderAttachmentTiles();
		app?.setFocus(editor);
		root.invalidate();
	};

	const clearAttachments = () => {
		if (attachments.length === 0) return;
		attachments = [];
		renderAttachmentTiles();
		root.invalidate();
	};

	const nextAttachmentId = (prefix: string): string => {
		attachmentCounter += 1;
		return `${prefix}-${Date.now()}-${attachmentCounter}`;
	};

	const interceptPaste = (clipboardText: string): boolean => {
		// 1. Check native image clipboard first
		const hasImg = clipboardBridge.hasImage !== undefined ? clipboardBridge.hasImage() : true;
		if (hasImg && clipboardBridge.readImagePng !== undefined) {
			const pngBytes = clipboardBridge.readImagePng();
			if (pngBytes !== null && pngBytes.byteLength > 0) {
				const dims = inspectImageDimensions(pngBytes);
				const name = dims !== undefined
					? `clipboard-${attachmentCounter + 1}-${dims.width}x${dims.height}.png`
					: `clipboard-image-${attachmentCounter + 1}.png`;
				addAttachment({
					id: nextAttachmentId("img"),
					kind: "image",
					name,
					mimeType: "image/png",
					sizeBytes: pngBytes.byteLength,
					base64Data: Buffer.from(pngBytes).toString("base64"),
				});
				return true;
			}
		}

		// 2. Check native clipboard file paths OR single image file path in clipboard text
		const nativePaths = clipboardBridge.readFilePaths !== undefined ? clipboardBridge.readFilePaths() : [];
		if (nativePaths.length > 0) {
			let attached = false;
			for (let i = 0; i < nativePaths.length; i++) {
				const rawPath = nativePaths[i];
				if (rawPath === undefined) continue;
				const resolved = resolveFileCandidate(rawPath) ?? rawPath;
				if (!existsSync(resolved)) continue;
				try {
					const st = statSync(resolved);
					if (!st.isFile()) continue;
					if (isImagePath(resolved)) {
						const bytes = readFileSync(resolved);
						addAttachment({
							id: nextAttachmentId("img"),
							kind: "image",
							name: basename(resolved),
							mimeType: mimeFromExtension(extname(resolved)),
							sizeBytes: bytes.byteLength,
							path: resolved,
							base64Data: Buffer.from(bytes).toString("base64"),
						});
					} else {
						addAttachment({
							id: nextAttachmentId("file"),
							kind: "file",
							name: basename(resolved),
							sizeBytes: st.size,
							path: resolved,
						});
					}
					attached = true;
				} catch {
					// Ignore unreadable clipboard file path
				}
			}
			if (attached) return true;
		}

		const candidatePath = resolveFileCandidate(clipboardText);
		if (candidatePath !== undefined && isImagePath(candidatePath) && existsSync(candidatePath)) {
			try {
				const st = statSync(candidatePath);
				if (st.isFile()) {
					const bytes = readFileSync(candidatePath);
					addAttachment({
						id: nextAttachmentId("img"),
						kind: "image",
						name: basename(candidatePath),
						mimeType: mimeFromExtension(extname(candidatePath)),
						sizeBytes: bytes.byteLength,
						path: candidatePath,
						base64Data: Buffer.from(bytes).toString("base64"),
					});
					return true;
				}
			} catch {
				// Fall through to text paste check
			}
		}

		// 3. Large or >15-line text pastes become "pasted-text" tile
		const textPayload =
			clipboardText.length > 0
				? clipboardText
				: clipboardBridge.readText !== undefined
					? (clipboardBridge.readText() ?? "")
					: "";
		if (textPayload.length > 0) {
			const normalized = textPayload.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
			const lineCount = normalized.split("\n").length;
			const byteLength = Buffer.byteLength(normalized, "utf8");
			if (lineCount > PASTED_TEXT_LINE_THRESHOLD || byteLength > PASTED_TEXT_BYTES_THRESHOLD) {
				addAttachment({
					id: nextAttachmentId("paste"),
					kind: "pasted-text",
					name: `Pasted text (${lineCount} lines)`,
					mimeType: "text/plain",
					sizeBytes: byteLength,
					textContent: normalized,
				});
				return true;
			}
		}

		return false;
	};

	const submitCurrent = (mode: "auto" | "followUp" | "steer" = "auto") => {
		const text = editor.getText();
		const trimmed = text.trim();
		const outgoingAttachments = attachments.slice();
		if (trimmed.length === 0 && outgoingAttachments.length === 0) return;

		dismissAutocomplete();

		if (trimmed.startsWith("!!")) {
			const cmd = trimmed.slice(2).trim();
			if (cmd.length > 0) {
				editor.addToHistory(text);
				editor.setText("");
				clearAttachments();
				void controller.executeBashCommand(cmd, true);
			}
			return;
		}
		if (trimmed.startsWith("!")) {
			const cmd = trimmed.slice(1).trim();
			if (cmd.length > 0) {
				editor.addToHistory(text);
				editor.setText("");
				clearAttachments();
				void controller.executeBashCommand(cmd, false);
			}
			return;
		}

		if (trimmed.startsWith("/") && options?.onSlashCommand !== undefined) {
			const spaceIdx = trimmed.indexOf(" ");
			const cmdName = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
			const cmdArgs = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
			const maybeHandled = options.onSlashCommand(cmdName, cmdArgs);
			if (maybeHandled === true) {
				editor.addToHistory(text);
				editor.setText("");
				clearAttachments();
				return;
			}
			if (typeof maybeHandled === "object" && maybeHandled !== null && "then" in maybeHandled) {
				editor.addToHistory(text);
				editor.setText("");
				clearAttachments();
				void maybeHandled.then((handled) => {
					if (!handled) {
						void controller.sendUserMessage(text, {
							attachments: outgoingAttachments.length > 0 ? outgoingAttachments : undefined,
							deliverAs: currentStatus.isStreaming ? (mode === "steer" ? "steer" : "followUp") : "auto",
						});
					}
				});
				return;
			}
		}

		editor.addToHistory(text);
		editor.setText("");
		attachments = [];
		renderAttachmentTiles();

		if (options?.onSubmitPrompt !== undefined) {
			options.onSubmitPrompt(text, outgoingAttachments);
			syncActionAndShellControls();
			return;
		}

		const sendAttachments = outgoingAttachments.length > 0 ? outgoingAttachments : undefined;
		if (currentStatus.isStreaming) {
			if (mode === "steer") {
				void controller.steerMessage(text, sendAttachments);
			} else {
				void controller.sendUserMessage(text, {
					attachments: sendAttachments,
					deliverAs: "followUp",
				});
			}
		} else {
			void controller.sendUserMessage(text, {
				attachments: sendAttachments,
				deliverAs: mode,
			});
		}
		syncActionAndShellControls();
	};

	editor.onChange = () => {
		syncActionAndShellControls();
		refreshAutocomplete();
	};

	editor.onSubmit = () => {
		submitCurrent("auto");
	};

	editor.onPaste = (clipboardText: string) => {
		const intercepted = interceptPaste(clipboardText);
		if (intercepted) {
			syncActionAndShellControls();
		}
		return intercepted;
	};

	editor.setKeyHooks({
		onSpecialKey: (event: GuiKeyEvent, ctx: GuiRenderContext) => {
			editorHasFocus = ctx.isFocused(editor);

			// Cmd+Enter / Ctrl+Enter steers while busy (or submits immediately when idle)
			if (
				(event.key === "Enter" || event.key === "Return") &&
				(event.modifiers.super || event.modifiers.ctrl) &&
				!event.modifiers.shift &&
				!event.modifiers.alt
			) {
				submitCurrent("steer");
				return true;
			}

			// Autocomplete navigation & acceptance
			if (activeSuggestions.length > 0) {
				if (ctx.keybindings.matches(event, "cursorUp")) {
					selectedSuggestionIndex =
						(selectedSuggestionIndex - 1 + activeSuggestions.length) % activeSuggestions.length;
					rebuildPopupRows();
					return true;
				}
				if (ctx.keybindings.matches(event, "cursorDown")) {
					selectedSuggestionIndex = (selectedSuggestionIndex + 1) % activeSuggestions.length;
					rebuildPopupRows();
					return true;
				}
				if (ctx.keybindings.matches(event, "tab")) {
					return acceptAutocompleteAt(selectedSuggestionIndex);
				}
				if (ctx.keybindings.matches(event, "submit") && !event.modifiers.shift) {
					return acceptAutocompleteAt(selectedSuggestionIndex);
				}
				if (ctx.keybindings.matches(event, "cancel")) {
					dismissAutocomplete();
					return true;
				}
			}

			return false;
		},
	});

	const updateStatus = (nextStatus: GuiSessionStatus) => {
		currentStatus = nextStatus;
		modelButton.setLabel(formatModelLabel(nextStatus));
		thinkingButton.setLabel(`Thinking: ${nextStatus.thinkingLevel}`);
		syncActionAndShellControls();
	};

	const applySnapshot = (snapshot: GuiSessionSnapshot) => {
		updateStatus(snapshot.status);
		autocompleteProvider.updateContext(snapshot.status.cwd, snapshot.workspaceFiles);
		queuedMessages = snapshot.queuedMessages;
		renderQueueTray();
		renderWidgets(snapshot.widgets);
		syncActionAndShellControls();
	};

	const handleEvent = (event: GuiControllerEvent) => {
		switch (event.type) {
			case "status_changed":
				if (event.status !== undefined) {
					updateStatus(event.status);
				}
				break;
			case "snapshot":
			case "session_reset":
				if (event.snapshot !== undefined) {
					applySnapshot(event.snapshot);
				}
				break;
			case "queue_changed":
				if (event.queuedMessages !== undefined) {
					queuedMessages = event.queuedMessages;
					renderQueueTray();
				} else {
					const snap = controller.getSnapshot();
					queuedMessages = snap.queuedMessages;
					renderQueueTray();
				}
				break;
			case "attachments_changed":
				if (event.attachments !== undefined) {
					attachments = event.attachments.slice();
					renderAttachmentTiles();
				}
				break;
			case "workspace_files":
				if (event.workspaceFiles !== undefined) {
					autocompleteProvider.updateContext(currentStatus.cwd, event.workspaceFiles);
				}
				break;
			case "editor_text":
				if (event.editorText !== undefined) {
					const nextText = event.appendEditorText ? `${editor.getText()}${event.editorText}` : event.editorText;
					editor.setText(nextText);
				}
				break;
			case "toast":
			case "widgets_changed":
			case "statuses_changed": {
				const snap = controller.getSnapshot();
				renderWidgets(snap.widgets);
				break;
			}
			default:
				break;
		}
	};

	const applyTheme = (nextTheme: GuiTheme) => {
		theme = nextTheme;
		queueTray.setBackground(theme.surfaceMuted);
		queueTray.setBorder(theme.border, 1);
		composerCard.setBackground(theme.surfaceComposer);
		composerCard.setBorder(theme.border, 1);
		popupCard.setBackground(theme.surfaceElevated);
		popupCard.setBorder(theme.borderStrong, 1);
		for (let i = 0; i < aboveWidgetCards.length; i++) {
			aboveWidgetCards[i]?.applyTheme(theme);
		}
		for (let i = 0; i < belowWidgetCards.length; i++) {
			belowWidgetCards[i]?.applyTheme(theme);
		}
		renderAttachmentTiles();
		renderQueueTray();
		if (activeSuggestions.length > 0) {
			rebuildPopupRows();
		}
		root.invalidate();
	};

	applySnapshot(initialSnapshot);
	const unsubscribe = controller.subscribe(handleEvent);

	return {
		root,
		editor,
		card: composerCard,
		applyTheme,
		applySnapshot,
		handleEvent,
		getAttachments: () => attachments.slice(),
		addAttachment,
		removeAttachment,
		clearAttachments,
		pasteFromClipboard: (overrideText?: string) => {
			const clip = overrideText ?? (clipboardBridge.readText !== undefined ? (clipboardBridge.readText() ?? "") : "");
			const intercepted = interceptPaste(clip);
			if (!intercepted && clip.length > 0) {
				editor.setText(`${editor.getText()}${clip}`);
			}
			syncActionAndShellControls();
			return intercepted;
		},
		getAutocompleteItems: () => activeSuggestions.slice(),
		selectAutocompleteIndex: (index: number) => {
			if (activeSuggestions.length === 0) return;
			selectedSuggestionIndex = clampNumber(index, 0, activeSuggestions.length - 1);
			rebuildPopupRows();
		},
		acceptSelectedAutocomplete: () => acceptAutocompleteAt(selectedSuggestionIndex),
		dismissAutocomplete,
		submitCurrent,
		setText: (text: string) => {
			editor.setText(text);
		},
		focus: () => {
			editorHasFocus = true;
			app?.setFocus(editor);
		},
		dispose: () => {
			unsubscribe();
			dismissAutocomplete();
		},
	};
}

function formatCompactTokens(tokens: number): string {
	if (tokens >= 1_000_000) {
		const m = tokens / 1_000_000;
		const fixed = m >= 10 ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, "");
		return `${fixed}M`;
	}
	if (tokens >= 10_000) {
		return `${Math.round(tokens / 1000)}k`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	}
	return `${Math.max(0, Math.round(tokens))}`;
}

function formatContextUsageSummary(usage: GuiContextUsage | undefined): {
	readonly label: string;
	readonly percent: number;
} {
	if (usage === undefined || usage.maxTokens <= 0) {
		return { label: "0 / 0 (0%)", percent: 0 };
	}
	const maxText = formatCompactTokens(usage.maxTokens);
	if (usage.usedTokens === null) {
		return { label: `? / ${maxText}`, percent: 0 };
	}
	const usedText = formatCompactTokens(usage.usedTokens);
	const rawPct = usage.percent !== null ? usage.percent : (usage.usedTokens / usage.maxTokens) * 100;
	const roundedPct = clampNumber(Math.round(rawPct), 0, 100);
	return {
		label: `${usedText} / ${maxText} (${roundedPct}%)`,
		percent: clampNumber(rawPct, 0, 100),
	};
}

function computeDirtyCounts(changedFiles: readonly GuiChangedFile[]): {
	readonly additions: number;
	readonly deletions: number;
} {
	let additions = 0;
	let deletions = 0;
	for (let i = 0; i < changedFiles.length; i++) {
		const f = changedFiles[i];
		if (f === undefined) continue;
		additions += Math.max(0, f.additions);
		deletions += Math.max(0, f.deletions);
	}
	return { additions, deletions };
}

class FooterBarContainer extends GuiComponent {
	private readonly row: HStack;

	constructor(row: HStack) {
		super();
		this.row = row;
		this.row.setParent(this);
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.row.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		super.onThemeChange(theme);
		this.row.onThemeChange(theme);
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const h = maxHeight !== undefined ? Math.min(maxHeight, FOOTER_HEIGHT) : FOOTER_HEIGHT;
		return { width: maxWidth, height: h };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const padX = 12;
		const innerW = Math.max(0, rect.width - padX * 2);
		const innerH = Math.max(0, rect.height - 2);
		this.row.layout(ctx, { x: rect.x + padX, y: rect.y + 1, width: innerW, height: innerH });
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		ctx.fillRect(r.x, r.y, r.width, r.height, ctx.theme.surface);
		ctx.fillRect(r.x, r.y, r.width, 1, ctx.theme.border);
		this.row.render(ctx);
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		return this.row.hitTest(x, y) ?? this;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.row.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.row.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return this.row.findComponentByA11yId(nodeId);
	}
}

/** Create the 28px Waku workspace status footer bar with git chip, extension statuses, and context ring gauge. */
export function createWakuFooterBar(
	controller: GuiSessionController,
	options?: WakuFooterBarOptions,
): WakuFooterBarHandle {
	const initialSnap = controller.getSnapshot();
	let theme: GuiTheme = options?.initialTheme ?? DARK_THEME;

	let currentUsage: GuiContextUsage | undefined = initialSnap.status.contextUsage ?? controller.getContextUsage();
	let currentPercent = 0;
	let formattedContextLabel = "0 / 0 (0%)";

	const folderIcon = new VectorIcon({ icon: "folder", size: 12, color: theme.textMuted });
	const workspaceLabel = new TruncatedText({
		text: basename(initialSnap.status.cwd) || initialSnap.status.cwd,
		fontSize: theme.fontSizeSmall,
	});
	const workspaceBtn = new ClickableContainer({
		label: `Workspace: ${initialSnap.status.cwd}`,
		hoverBackground: theme.surfaceHover,
		radius: 6,
		padding: { top: 2, right: 6, bottom: 2, left: 6 },
		focusable: options?.onWorkspaceClick !== undefined,
		child: new HStack({
			gap: 5,
			align: "center",
			children: [
				folderIcon,
				new Box({ maxWidth: 160, child: workspaceLabel }),
			],
		}),
		onClick: options?.onWorkspaceClick,
	});

	const gitBranchText = new Text({
		text: initialSnap.gitBranch || initialSnap.status.gitBranch || "",
		fontSize: theme.fontSizeSmall,
		fontWeight: 500,
		color: theme.textSecondary,
	});
	const gitDiffText = new Text({
		text: "",
		fontFamily: SGUI_FONT_MONO,
		fontSize: Math.max(10, theme.fontSizeSmall - 1),
		color: theme.textMuted,
	});
	gitDiffText.visible = false;

	const gitBranchBtn = new ClickableContainer({
		label: "Git branch",
		hoverBackground: theme.surfaceHover,
		radius: 6,
		padding: { top: 2, right: 6, bottom: 2, left: 6 },
		focusable: true,
		child: new HStack({
			gap: 5,
			align: "center",
			children: [
				new VectorIcon({ icon: "git-branch", size: 12, color: theme.textMuted }),
				gitBranchText,
				gitDiffText,
			],
		}),
		onClick: () => {
			if (options?.onGitBranchClick !== undefined) {
				options.onGitBranchClick();
			}
		},
	});

	const statusesRow = new HStack({ gap: 8, align: "center" });

	const ringCanvas = new VectorCanvas({
		width: 16,
		height: 16,
		minWidth: 16,
		minHeight: 16,
		scale: 2,
		render: (surface: RasterSurface, rect: Rect, ctx: GuiRenderContext) => {
			const cx = rect.width * 0.5;
			const cy = rect.height * 0.5;
			const radius = Math.min(rect.width, rect.height) * 0.5 - 2;
			const thickness = 2.2;
			const trackColor = withAlpha(ctx.theme.textMuted, ctx.theme.dark ? 0.28 : 0.22);
			surface.strokeCircle(cx, cy, radius, thickness, trackColor);
			if (currentPercent > 0) {
				const sweep = clampNumber(currentPercent / 100, 0, 1) * Math.PI * 2;
				const startAngle = -Math.PI * 0.5;
				const endAngle = startAngle + sweep;
				const ringColor =
					currentPercent >= 90
						? ctx.theme.danger
						: currentPercent >= 75
							? ctx.theme.warning
							: ctx.theme.accent;
				surface.drawRing(cx, cy, radius, startAngle, endAngle, thickness, ringColor, true);
			}
		},
	});

	const contextText = new Text({
		text: formattedContextLabel,
		fontFamily: SGUI_FONT_MONO,
		fontSize: theme.fontSizeSmall,
		color: theme.textSecondary,
	});

	const contextBtn = new ClickableContainer({
		label: `Context window: ${formattedContextLabel}`,
		hoverBackground: theme.surfaceHover,
		radius: 6,
		padding: { top: 2, right: 6, bottom: 2, left: 6 },
		focusable: true,
		child: new HStack({
			gap: 6,
			align: "center",
			children: [ringCanvas, contextText],
		}),
		onClick: () => {
			if (options?.onContextClick !== undefined) {
				options.onContextClick(currentUsage);
			}
		},
	});

	const footerRow = new HStack({
		gap: 8,
		align: "center",
		fillWidth: true,
		children: [workspaceBtn, gitBranchBtn, statusesRow, new Spacer({ flex: 1 }), contextBtn],
	});
	const root = new FooterBarContainer(footerRow);

	const updateContextUsage = (usage: GuiContextUsage | undefined) => {
		currentUsage = usage;
		const summary = formatContextUsageSummary(usage);
		currentPercent = summary.percent;
		formattedContextLabel = summary.label;
		contextText.setText(summary.label);
		const color =
			summary.percent >= 90
				? theme.danger
				: summary.percent >= 75
					? theme.warning
					: theme.textSecondary;
		contextText.setColor(color);
		contextBtn.setLabel(`Context window: ${summary.label}`);
		ringCanvas.invalidate();
		contextBtn.invalidate();
	};

	const renderStatuses = (entries: readonly GuiExtensionStatusEntry[]) => {
		if (entries.length === 0) {
			statusesRow.visible = false;
			replaceStackChildren(statusesRow, []);
			return;
		}
		statusesRow.visible = true;
		const pills: GuiComponent[] = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry === undefined) continue;
			pills.push(
				new Box({
					maxWidth: 180,
					child: new TruncatedText({
						text: `${entry.key}: ${entry.text}`,
						fontSize: Math.max(10, theme.fontSizeSmall - 1),
						color: theme.textMuted,
					}),
				}),
			);
		}
		replaceStackChildren(statusesRow, pills);
	};

	const updateGitAndWorkspace = (snapshot: GuiSessionSnapshot) => {
		const cwd = snapshot.status.cwd;
		workspaceLabel.setText(basename(cwd) || cwd);
		workspaceBtn.setLabel(`Workspace: ${cwd}`);

		const branch = snapshot.gitBranch || snapshot.status.gitBranch || "";
		const isGit = snapshot.isGitRepo || snapshot.status.isGitRepo === true || branch.length > 0;
		gitBranchBtn.visible = isGit;
		if (isGit) {
			const counts = computeDirtyCounts(snapshot.changedFiles);
			gitBranchText.setText(branch.length > 0 ? branch : "detached");
			const hasDirty = counts.additions > 0 || counts.deletions > 0;
			gitDiffText.visible = hasDirty;
			if (hasDirty) {
				gitDiffText.setText(`+${counts.additions} -${counts.deletions}`);
				gitBranchBtn.setLabel(`Git branch: ${branch || "detached"} (+${counts.additions} -${counts.deletions})`);
			} else {
				gitBranchBtn.setLabel(`Git branch: ${branch || "detached"}`);
			}
		}
	};

	const applySnapshot = (snapshot: GuiSessionSnapshot) => {
		updateGitAndWorkspace(snapshot);
		renderStatuses(snapshot.statuses);
		updateContextUsage(snapshot.status.contextUsage ?? controller.getContextUsage());
	};

	const handleEvent = (event: GuiControllerEvent) => {
		switch (event.type) {
			case "snapshot":
			case "session_reset":
				if (event.snapshot !== undefined) {
					applySnapshot(event.snapshot);
				}
				break;
			case "status_changed": {
				const snap = controller.getSnapshot();
				updateGitAndWorkspace(snap);
				if (event.status?.contextUsage !== undefined) {
					updateContextUsage(event.status.contextUsage);
				} else {
					updateContextUsage(controller.getContextUsage());
				}
				break;
			}
			case "changed_files":
				updateGitAndWorkspace(controller.getSnapshot());
				break;
			case "statuses_changed":
				renderStatuses(controller.getSnapshot().statuses);
				break;
			default:
				break;
		}
	};

	const applyTheme = (nextTheme: GuiTheme) => {
		theme = nextTheme;
		folderIcon.setColor(theme.textMuted);
		gitBranchText.setColor(theme.textSecondary);
		gitDiffText.setColor(theme.textMuted);
		updateContextUsage(currentUsage);
		renderStatuses(controller.getSnapshot().statuses);
		root.invalidate();
	};

	applySnapshot(initialSnap);
	const unsubscribe = controller.subscribe(handleEvent);

	return {
		root,
		applyTheme,
		applySnapshot,
		handleEvent,
		setContextUsage: updateContextUsage,
		getFormattedContextLabel: () => formattedContextLabel,
		dispose: () => {
			unsubscribe();
		},
	};
}
