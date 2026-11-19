import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { ThinkingLevel } from "@pi-ts/agent-core";
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
	Loader,
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
	type StackChild,
	Text,
	TruncatedText,
	type VectorIconName,
	VectorCanvas,
	VectorIcon,
	VStack,
	withAlpha,
} from "@pi-ts/gui";
import {
	isNativeDarwinAvailable,
	nativeClipboardGetFilePaths,
	nativeClipboardGetImagePng,
	nativeClipboardGetText,
	nativeImageInspect,
} from "@pi-ts/ffi";
import {
	ClickableContainer,
	createExtensionWidgetCard,
	type ExtensionWidgetCardHandle,
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
import { annotateSpecNode, providerIconForId, registerSpecChildren } from "./ui-spec-meta.ts";

const COMPOSER_MAX_WIDTH = 720;
const COMPOSER_HORIZONTAL_INSET = 20;
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
	readonly onOpenModelPicker?: (anchorRect?: Rect) => void;
	readonly onOpenThinkingPicker?: (anchorRect?: Rect) => void;
	readonly onOpenAttachDialog?: () => void;
	readonly onToggleShellMode?: (active: boolean) => void;
	readonly onSlashCommand?: (command: string, args: string) => boolean | Promise<boolean>;
	readonly onSubmitPrompt?: (text: string, attachments: readonly GuiAttachmentItem[]) => void;
}

/** Handle returned by {@link createWakuComposer} for lifecycle, attachments, and test hooks. */
export interface WakuComposerHandle {
	readonly root: GuiComponent;
	readonly editor: Editor;
	readonly card: GuiComponent;
	readonly modelButton: Button;
	readonly thinkingButton: Button;
	readonly stopButton: Button;
	applyTheme(theme: GuiTheme): void;
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
	readonly onProjectClick?: (anchorRect?: Rect) => void;
	readonly onWorkspaceClick?: (anchorRect?: Rect) => void;
	readonly onGitBranchClick?: (anchorRect?: Rect) => void;
	readonly onContextClick?: (usage: GuiContextUsage | undefined, anchorRect?: Rect) => void;
}

/** Handle returned by {@link createWakuFooterBar}. */
export interface WakuFooterBarHandle {
	readonly root: GuiComponent;
	readonly providerBadge: Badge;
	readonly statusLoader: Loader;
	readonly projectButton: GuiComponent;
	readonly workspaceButton: GuiComponent;
	readonly gitBranchButton: GuiComponent;
	readonly contextButton: GuiComponent;
	applyTheme(theme: GuiTheme): void;
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
	const raw = status.activeModel.label || `${status.activeModel.provider}/${status.activeModel.id}`;
	return raw.length > 34 ? `${raw.slice(0, 31)}…` : raw;
}

function formatThinkingChipLabel(level: ThinkingLevel): string {
	return level.length > 0 ? level[0]!.toUpperCase() + level.slice(1) : "Off";
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
	private externalSuggestions: readonly AutocompleteItem[] = [];

	setKeyHooks(hooks: ComposerEditorHooks | undefined): void {
		this.hooks = hooks;
	}

	setExternalSuggestions(items: readonly AutocompleteItem[]): void {
		this.externalSuggestions = items;
	}

	override getAutocompleteItems(): readonly AutocompleteItem[] {
		return this.externalSuggestions.length > 0 ? this.externalSuggestions : super.getAutocompleteItems();
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
		const focused = ctx.isFocusVisible(this);

		if (focused) {
			drawFocusHalo(ctx, r, radius, 0.28, 3);
		}

		let bg: Color;
		let border: Color | undefined;
		let iconColor: Color;
		let icon: VectorIconName;

		if (this.modeValue === "stop") {
			icon = "stop";
			bg = this.pressed
				? mixColors(t.surfaceOverlayStrong, t.background, 0.12)
				: hovered
					? withAlpha(t.danger, 0.18)
					: t.surfaceOverlayStrong;
			iconColor = t.text;
		} else if (this.activeDraftValue) {
			icon = "arrow-up";
			const baseBg = t.inverseBg ?? t.textBright;
			bg = this.pressed ? mixColors(baseBg, t.background, 0.18) : hovered ? mixColors(baseBg, t.background, 0.08) : baseBg;
			iconColor = t.inverseFg ?? t.background;
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
		const iconSize = this.modeValue === "stop" ? 16 : 13;
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
		super.render(ctx);
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
		registerSpecChildren(this, () => [this.innerColumn]);
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
	const aboveWidgetsBox = new VStack({ gap: 6 });
	aboveWidgetsBox.visible = false;
	const belowWidgetsBox = new VStack({ gap: 6 });
	belowWidgetsBox.visible = false;

	// Queued tray above the always-rounded 13px composer card
	const queueRowsStack = new VStack({ gap: 0 });
	const queueRadii: CornerRadii = { tl: 12, tr: 12, br: 0, bl: 0 };
	const queueTray = annotateSpecNode(
		new Box({
			background: theme.surfaceComposer,
			borderColor: theme.border,
			borderEdges: { top: 1, right: 1, bottom: 0, left: 1 },
			cornerRadii: queueRadii,
			padding: { top: 4, right: 0, bottom: 4, left: 0 },
			minHeight: 38,
			fillWidth: true,
			child: queueRowsStack,
		}),
		{
			key: "workspace.main.queue_tray",
			role: "region",
			flowComponent: queueRowsStack,
			margin: [0, 14, 0, 14],
			size: { w: "fill", h: "hug" },
			skipChildren: true,
		},
	);
	const queueTrayInset = new Box({
		padding: { horizontal: 14 },
		fillWidth: true,
		child: queueTray,
	});
	queueTrayInset.visible = false;

	// Attachment tiles row above editor inside composerCard
	const attachmentsRow = new WrappingPillRow([], 6, 6);
	attachmentsRow.visible = false;

	// Inline autocomplete fallback container when GuiApp isn't mounted or layout hasn't occurred
	const inlineAutocompleteSlot = new VStack({ gap: 0 });
	inlineAutocompleteSlot.visible = false;

	// Popup card built cleanly with focusable: false items so Editor keeps focus
	const popupRowsStack = new VStack({ gap: 2 });
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
	const editor = annotateSpecNode(
		new ComposerEditor({
			variant: "chromeless",
			placeholder: "Do anything…",
			a11yLabel: "Prompt editor",
			minHeight: 28,
			minLines: 1,
			maxLines: 7,
			padding: 0,
			submitOnEnter: true,
			clearOnSubmit: false,
		}),
		{
			key: "workspace.main.composer.editor",
			role: "textbox",
			flow: { type: "block" },
			padding: [0, 0, 0, 0],
			margin: [0, 0, 0, 0],
			border: [0, 0, 0, 0],
			size: { w: "fill", h: "hug" },
			text: { value: "Prompt editor", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const editorWrap = new Box({
		padding: { horizontal: 12 },
		fillWidth: true,
		child: editor,
	});

	// Bottom Control Bar components
	const modelButton = annotateSpecNode(
		new Button({
			label: formatModelLabel(currentStatus),
			a11yLabel: "Select Model Chip",
			variant: "ghost",
			leadingIcon: providerIconForId(currentStatus.activeModel?.provider),
			trailingIcon: "chevron-down",
			trailingIconSize: 10,
			iconSize: 13,
			height: 24,
			fontSize: theme.fontSizeSmall,
			padding: { vertical: 2, horizontal: 6 },
			radius: 6,
			onClick: () => {
				if (options?.onOpenModelPicker !== undefined) {
					options.onOpenModelPicker(modelButton.layoutRect);
				}
			},
		}),
		{
			key: "workspace.main.composer.model_chip",
			role: "button",
			size: { w: "hug", h: 24 },
			padding: [0, 0, 0, 0],
			variant: "menu-chip",
			text: { value: "Select Model Chip", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const thinkingButton = annotateSpecNode(
		new Button({
			label: formatThinkingChipLabel(currentStatus.thinkingLevel),
			a11yLabel: "Select Thinking Chip",
			variant: "ghost",
			leadingIcon: "sliders",
			trailingIcon: "chevron-down",
			trailingIconSize: 10,
			iconSize: 12,
			height: 24,
			fontSize: theme.fontSizeSmall,
			padding: { vertical: 2, horizontal: 6 },
			radius: 6,
			onClick: () => {
				if (options?.onOpenThinkingPicker !== undefined) {
					options.onOpenThinkingPicker(thinkingButton.layoutRect);
					return;
				}
				const levels =
					currentStatus.availableThinkingLevels.length > 0
						? currentStatus.availableThinkingLevels
						: DEFAULT_THINKING_LEVELS;
				const curIdx = levels.indexOf(currentStatus.thinkingLevel);
				const next = levels[(curIdx + 1) % levels.length] ?? "off";
				controller.setThinkingLevel(next);
				currentStatus = { ...currentStatus, thinkingLevel: next };
				thinkingButton.setLabel(formatThinkingChipLabel(next));
				composerCard.invalidate();
			},
		}),
		{
			key: "workspace.main.composer.thinking_chip",
			role: "button",
			size: { w: "hug", h: 24 },
			padding: [0, 0, 0, 0],
			variant: "menu-chip",
			text: { value: "Select Thinking Chip", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const attachButton = annotateSpecNode(
		new IconButton({
			icon: "plus",
			size: 24,
			iconSize: 13,
			radius: 12,
			label: "Attach clipboard image",
			onClick: () => {
				if (options?.onOpenAttachDialog !== undefined) {
					options.onOpenAttachDialog();
				}
			},
		}),
		{
			key: "workspace.main.composer.attach",
			role: "button",
			size: { w: 24, h: 24 },
			variant: "icon-button",
			text: { value: "Attach clipboard image", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const shellButton = annotateSpecNode(
		new Button({
			label: "! Shell",
			variant: "secondary",
			leadingIcon: "terminal",
			iconSize: 12,
			height: 24,
			fontSize: theme.fontSizeSmall,
			padding: { vertical: 2, horizontal: 8 },
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
		}),
		{
			key: "workspace.main.composer.bash_badge",
			role: "status",
			size: { w: "hug", h: 24 },
			variant: "bash-badge",
		},
	);
	shellButton.visible = false;

	const steerButton = new Button({
		label: "Steer",
		variant: "secondary",
		height: 24,
		fontSize: theme.fontSizeSmall,
		padding: { vertical: 2, horizontal: 10 },
		pill: true,
		onClick: () => {
			submitCurrent("steer");
		},
	});
	steerButton.visible = false;

	const stopButton = new Button({
		label: "Stop",
		variant: "ghost",
		disabled: !currentStatus.isStreaming,
		fontSize: theme.fontSizeSmall,
		padding: { vertical: 3, horizontal: 8 },
		pill: true,
		onClick: () => {
			void controller.abort();
		},
	});
	stopButton.visible = false;

	const queueFollowupBtn = annotateSpecNode(
		new IconButton({
			icon: "arrow-up",
			size: ACTION_CIRCLE_SIZE,
			iconSize: 13,
			radius: ACTION_CIRCLE_SIZE * 0.5,
			color: theme.inverseFg ?? theme.background,
			background: theme.inverseBg ?? theme.textBright,
			hoverBackground: mixColors(theme.inverseBg ?? theme.textBright, theme.background, 0.08),
			label: "Queue Follow-up",
			onClick: () => submitCurrent("followUp"),
		}),
		{
			key: "workspace.main.composer.queue_followup",
			role: "button",
			size: { w: ACTION_CIRCLE_SIZE, h: ACTION_CIRCLE_SIZE },
			variant: "circle-action-primary",
			text: { value: "Queue Follow-up", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);
	queueFollowupBtn.visible = currentStatus.isStreaming;

	const actionCircle = annotateSpecNode(
		new ComposerActionCircle({
			onSend: () => submitCurrent("auto"),
			onStop: () => {
				void controller.abort();
			},
		}),
		{
			key: "workspace.main.composer.send",
			role: "button",
			flow: { type: "flex", dir: "row", justify: "center", align: "center", wrap: "nowrap", gap: 0 },
			size: { w: ACTION_CIRCLE_SIZE, h: ACTION_CIRCLE_SIZE },
			variant: "circle-action",
			text: () => ({
				value: currentStatus.isStreaming ? "Stop" : "Send",
				wrap: "nowrap",
				lines: 1,
				overflow: "ellipsis",
			}),
		},
	);

	const rightActionsCluster = new HStack({
		gap: 6,
		align: "center",
		children: [steerButton, actionCircle, queueFollowupBtn],
	});

	const controlsRow = new HStack({
		gap: 4,
		align: "center",
		children: [
			modelButton,
			thinkingButton,
			attachButton,
			shellButton,
			{ child: new Spacer(), grow: 1 },
			rightActionsCluster,
		],
	});

	const controlsBox = annotateSpecNode(
		new Box({
			height: 26,
			fillWidth: true,
			child: controlsRow,
		}),
		{
			key: "workspace.main.composer.toolbar",
			role: "toolbar",
			flowComponent: controlsRow,
			padding: [0, 10, 0, 10],
			margin: [8, 0, 0, 0],
			size: { w: "fill", h: 26 },
		},
	);

	const toolbarInset = new Box({
		padding: { horizontal: 10 },
		fillWidth: true,
		child: controlsBox,
	});

	const attachmentsInset = new Box({
		padding: { horizontal: 12 },
		fillWidth: true,
		child: attachmentsRow,
	});
	attachmentsInset.visible = false;

	const cardStack = new VStack({
		gap: 8,
		children: [attachmentsInset, editorWrap, toolbarInset],
	});

	const composerCard = annotateSpecNode(
		new ComposerCardContainer({
			background: theme.surfaceComposer,
			borderColor: theme.border,
			borderWidth: 1,
			radius: COMPOSER_CARD_RADIUS,
			maxWidth: COMPOSER_MAX_WIDTH,
			padding: { top: 10, bottom: 10, left: 0, right: 0 },
			shadow: "md",
			fillWidth: true,
			child: cardStack,
		}),
		{
			key: "workspace.main.composer",
			role: "region",
			flowComponent: cardStack,
			margin: [0, 20, 0, 20],
			size: { w: COMPOSER_MAX_WIDTH, h: "hug" },
			variant: "composer-card",
		},
	);
	composerCard.setFocusPredicate(() => editorHasFocus || editor.isFocused());

	const innerColumn = new VStack({
		gap: 0,
		children: [
			aboveWidgetsBox,
			inlineAutocompleteSlot,
			queueTrayInset,
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

		shellButton.visible = isShell;
		shellButton.setLabel(text.trimStart().startsWith("!!") ? "!! Shell" : "! Shell");

		const streaming = currentStatus.isStreaming;
		steerButton.visible = streaming && hasDraft;
		queueFollowupBtn.visible = streaming;
		actionCircle.setState(streaming ? "stop" : "send", hasDraft);
		composerCard.invalidate();
	};

	const renderAttachmentTiles = () => {
		if (attachments.length === 0) {
			attachmentsRow.visible = false;
			attachmentsInset.visible = false;
			attachmentsRow.setChildren([]);
			syncActionAndShellControls();
			return;
		}
		attachmentsRow.visible = true;
		attachmentsInset.visible = true;
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
					padding: 5,
					alignHorizontal: "center",
					child: new VectorIcon({
						name: iconName,
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

	const editQueuedMessage = (msg: (typeof queuedMessages)[number]) => {
		controller.removeQueuedMessage(msg.id);
		editor.setText(msg.text);
		if (msg.attachments !== undefined) {
			attachments = msg.attachments.slice();
			renderAttachmentTiles();
		}
		syncActionAndShellControls();
		app?.setFocus(editor);
	};

	const renderQueueTray = () => {
		if (queuedMessages.length === 0) {
			queueTray.visible = false;
			queueTrayInset.visible = false;
			replaceStackChildren(queueRowsStack, []);
			queueTray.invalidate();
			return;
		}
		queueTray.visible = true;
		queueTrayInset.visible = true;
		const rows: GuiComponent[] = [];
		for (let i = 0; i < queuedMessages.length; i++) {
			const msg = queuedMessages[i];
			if (msg === undefined) continue;
			const leadingIcon = new VectorIcon({
				name: msg.kind === "steer" ? "arrow-right" : "queue",
				size: 12,
				color: theme.textMuted,
			});
			const attachSuffix =
				msg.attachments !== undefined && msg.attachments.length > 0
					? ` [+${msg.attachments.length}]`
					: "";
			const kindPrefix = msg.kind === "steer" ? "Steer: " : "";
			const snippet = new TruncatedText({
				text: `${kindPrefix}${formatSnippet(msg.text, 512)}${attachSuffix}`,
				fontSize: 12.5,
				color: theme.textPrimary,
			});
			const snippetTrigger = new ClickableContainer({
				label: "Edit queued message",
				fillWidth: true,
				borderWidth: 0,
				radius: 4,
				padding: 0,
				child: snippet,
				onClick: () => {
					editQueuedMessage(msg);
				},
			});
			const msgId = msg.id;
			const actionControls: StackChild[] = [];
			if (msg.kind !== "steer") {
				actionControls.push(
					new ClickableContainer({
						label: "Steer",
						height: 24,
						radius: 6,
						borderWidth: 0,
						hoverBackground: theme.surfaceOverlayStrong,
						padding: { top: 0, right: 7, bottom: 0, left: 7 },
						child: new HStack({
							gap: 5,
							align: "center",
							children: [
								new VectorIcon({ name: "corner-down-right", size: 11, color: theme.textSecondary }),
								new Text({ text: "Steer", fontSize: 12.5, color: theme.textSecondary, wrap: false }),
							],
						}),
						onClick: () => {
							controller.removeQueuedMessage(msgId);
							void controller.steerMessage(msg.text, msg.attachments);
							app?.setFocus(editor);
						},
					}),
				);
			}
			const cancelBtn = new IconButton({
				icon: "trash",
				size: 24,
				iconSize: 12,
				radius: 6,
				color: theme.textSecondary,
				hoverBackground: theme.surfaceOverlayStrong,
				label: "Remove queued message",
				onClick: () => {
					controller.removeQueuedMessage(msgId);
					app?.setFocus(editor);
				},
			});
			actionControls.push(cancelBtn);

			let queueMenuHandle: OverlayHandle | undefined;
			const moreBtn = new IconButton({
				icon: "ellipsis",
				size: 24,
				iconSize: 12.5,
				radius: 6,
				color: theme.textSecondary,
				hoverBackground: theme.surfaceOverlayStrong,
				label: "Queued message actions",
				onClick: () => {
					if (app === undefined) return;
					if (queueMenuHandle !== undefined) {
						queueMenuHandle.hide();
						queueMenuHandle = undefined;
						return;
					}
					const makeActionItem = (
						labelText: string,
						iconName: VectorIconName,
						onSelect: () => void,
					): ClickableContainer =>
						new ClickableContainer({
							label: labelText,
							height: 28,
							radius: 6,
							borderWidth: 0,
							fillWidth: true,
							hoverBackground: theme.surfaceOverlayStrong,
							padding: { top: 0, right: 8, bottom: 0, left: 8 },
							child: new HStack({
								gap: 8,
								align: "center",
								children: [
									new VectorIcon({ name: iconName, size: 12, color: theme.textSecondary }),
									new Text({ text: labelText, fontSize: 12.5, color: theme.text, wrap: false }),
								],
							}),
							onClick: () => {
								queueMenuHandle?.hide();
								queueMenuHandle = undefined;
								onSelect();
							},
						});
					const menuBox = new Box({
						width: 176,
						background: theme.surfaceRaised,
						borderColor: theme.borderStrong,
						borderWidth: 1,
						radius: 8,
						padding: 4,
						shadow: "md",
						child: new VStack({
							gap: 2,
							align: "stretch",
							children: [
								makeActionItem("Edit in composer", "edit", () => {
									editQueuedMessage(msg);
								}),
								makeActionItem("Remove follow-up", "trash", () => {
									controller.removeQueuedMessage(msgId);
									app?.setFocus(editor);
								}),
							],
						}),
					});
					queueMenuHandle = app.showOverlay(menuBox, {
						anchorRect: moreBtn.layoutRect,
						width: 176,
						radius: 8,
						shadow: "md",
						dismissOnBackdropClick: true,
						dismissOnEscape: true,
						onDismiss: () => {
							queueMenuHandle = undefined;
						},
					});
				},
			});
			actionControls.push(moreBtn);

			const rowContent = new Box({
				height: 30,
				fillWidth: true,
				padding: { top: 0, right: 6, bottom: 0, left: 12 },
				child: new HStack({
					gap: 9,
					align: "center",
					children: [
						leadingIcon,
						{ child: snippetTrigger, grow: 1, shrink: 1 },
						new HStack({ gap: 2, align: "center", children: actionControls }),
					],
				}),
			});
			rows.push(rowContent);
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
		editor.setExternalSuggestions([]);
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
			const rowChildren: StackChild[] = [
				new Text({
					text: item.label,
					fontSize: theme.fontSizeSmall,
					fontWeight: isSelected ? 600 : 500,
					color: isSelected ? theme.accent : theme.textBright,
				}),
			];
			if (item.description !== undefined && item.description.length > 0) {
				rowChildren.push({ child: new Spacer(), grow: 1 });
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
		editor.setExternalSuggestions(activeSuggestions);
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
			if (typeof maybeHandled !== "boolean") {
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
		modelButton.setLeadingIcon(providerIconForId(nextStatus.activeModel?.provider));
		modelButton.setLabel(formatModelLabel(nextStatus));
		thinkingButton.setLabel(formatThinkingChipLabel(nextStatus.thinkingLevel));
		stopButton.setDisabled(!nextStatus.isStreaming);
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
			case "workspace_changed":
				if (event.workspaceFiles !== undefined) {
					autocompleteProvider.updateContext(currentStatus.cwd, event.workspaceFiles);
				} else {
					autocompleteProvider.updateContext(currentStatus.cwd, controller.getSnapshot().workspaceFiles);
				}
				break;
			case "editor_text":
				if (event.editorText !== undefined) {
					const nextText = event.appendEditorText ? `${editor.getText()}${event.editorText}` : event.editorText;
					editor.setText(nextText);
				}
				break;
			case "extension_ui": {
				if (event.attachments !== undefined) {
					attachments = event.attachments.slice();
					renderAttachmentTiles();
				}
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
		queueTray.setBackground(theme.surfaceComposer);
		queueTray.setBorderEdges({ top: 1, right: 1, bottom: 0, left: 1 }, theme.border);
		queueFollowupBtn.setColors({
			color: theme.inverseFg ?? theme.background,
			background: theme.inverseBg ?? theme.textBright,
			hoverBackground: mixColors(theme.inverseBg ?? theme.textBright, theme.background, 0.08),
		});
		composerCard.setBackground(theme.surfaceComposer);
		composerCard.setBorder(theme.border, 1, COMPOSER_CARD_RADIUS);
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
		modelButton,
		thinkingButton,
		stopButton,
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
	private readonly box: Box;

	constructor(box: Box) {
		super();
		this.box = box;
		this.box.setParent(this);
		registerSpecChildren(this, () => [this.box]);
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.box.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		super.onThemeChange(theme);
		this.box.onThemeChange(theme);
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const outerH = 4 + FOOTER_HEIGHT + 8;
		const h = maxHeight !== undefined ? Math.min(maxHeight, outerH) : outerH;
		return { width: maxWidth, height: h };
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const availW = Math.max(0, rect.width - COMPOSER_HORIZONTAL_INSET * 2);
		const colW = Math.min(COMPOSER_MAX_WIDTH, availW);
		const colX = rect.x + Math.max(COMPOSER_HORIZONTAL_INSET, (rect.width - colW) * 0.5);
		this.box.layout(ctx, { x: colX, y: rect.y + 4, width: colW, height: FOOTER_HEIGHT });
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.box.render(ctx);
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		return this.box.hitTest(x, y) ?? this;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.box.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.box.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return this.box.findComponentByA11yId(nodeId);
	}
}

/** Create the 28px Waku workspace footer bar centered at 720px under the composer. */
export function createWakuFooterBar(
	controller: GuiSessionController,
	options?: WakuFooterBarOptions,
): WakuFooterBarHandle {
	const initialSnap = controller.getSnapshot();
	let theme: GuiTheme = options?.initialTheme ?? DARK_THEME;

	let currentUsage: GuiContextUsage | undefined = initialSnap.status.contextUsage ?? controller.getContextUsage();
	let currentPercent = 0;
	let formattedContextLabel = "0 / 0 (0%)";

	const projectBtn = annotateSpecNode(
		new Button({
			label: basename(initialSnap.status.cwd) || initialSnap.status.cwd || "Project",
			a11yLabel: "Select Project",
			variant: "ghost",
			leadingIcon: "folder",
			trailingIcon: "chevron-down",
			trailingIconSize: 10,
			iconSize: 12,
			height: 26,
			fontSize: theme.fontSizeSmall,
			padding: { vertical: 2, horizontal: 6 },
			radius: 6,
			onClick: () => options?.onProjectClick?.(projectBtn.layoutRect),
		}),
		{
			key: "workspace.main.footer.project_chip",
			role: "button",
			size: { w: "hug", h: 26 },
			padding: [0, 0, 0, 0],
			variant: "menu-chip",
			text: { value: "Select Project", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const workspaceBtn = annotateSpecNode(
		new Button({
			label: "Local",
			a11yLabel: "Select Workspace",
			variant: "ghost",
			leadingIcon: "laptop",
			trailingIcon: "chevron-down",
			trailingIconSize: 10,
			iconSize: 12,
			height: 26,
			fontSize: theme.fontSizeSmall,
			padding: { vertical: 2, horizontal: 6 },
			radius: 6,
			onClick: () => options?.onWorkspaceClick?.(workspaceBtn.layoutRect),
		}),
		{
			key: "workspace.main.footer.workspace_chip",
			role: "button",
			size: { w: "hug", h: 26 },
			padding: [0, 0, 0, 0],
			variant: "menu-chip",
			text: { value: "Select Workspace", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const gitBranchBtn = annotateSpecNode(
		new Button({
			label: initialSnap.gitBranch || initialSnap.status.gitBranch || "main",
			a11yLabel: "Switch Git Branch",
			variant: "ghost",
			leadingIcon: "git-branch",
			trailingIcon: "chevron-down",
			trailingIconSize: 10,
			iconSize: 12,
			height: 26,
			fontSize: theme.fontSizeSmall,
			padding: { vertical: 2, horizontal: 6 },
			radius: 6,
			onClick: () => options?.onGitBranchClick?.(gitBranchBtn.layoutRect),
		}),
		{
			key: "workspace.main.footer.branch_chip",
			role: "button",
			size: { w: "hug", h: 26 },
			padding: [0, 0, 0, 0],
			variant: "menu-chip",
			text: { value: "Switch Git Branch", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const providerBadge = new Badge({
		label: initialSnap.status.activeModel?.provider ?? "offline",
		variant: "neutral",
		fontSize: Math.max(10, theme.fontSizeSmall - 1),
		padding: { vertical: 2, horizontal: 6 },
	});

	const statusLoader = new Loader({
		message: initialSnap.status.isStreaming ? "Generating..." : "Ready",
		size: 12,
		running: initialSnap.status.isStreaming,
	});

	const statusesRow = annotateSpecNode(
		new HStack({ gap: 6, align: "center" }),
		{
			key: "workspace.main.footer.extension_status",
			role: "status",
			size: { w: "hug", h: 24 },
		},
	);
	statusesRow.visible = false;

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
							: ctx.theme.gauge;
				surface.drawRing(cx, cy, radius, startAngle, endAngle, thickness, ringColor, true);
			}
		},
	});

	const contextBtn = annotateSpecNode(
		new ClickableContainer({
			label: "Context Window Usage",
			hoverBackground: theme.surfaceHover,
			borderWidth: 0,
			radius: 6,
			padding: 4,
			height: 24,
			focusable: true,
			child: ringCanvas,
			onClick: () => {
				if (options?.onContextClick !== undefined) {
					options.onContextClick(currentUsage, contextBtn.layoutRect);
				}
			},
		}),
		{
			key: "workspace.main.footer.context_gauge",
			role: "button",
			flow: { type: "flex", dir: "row", justify: "center", align: "center", wrap: "nowrap", gap: 0 },
			padding: [0, 0, 0, 0],
			size: { w: 24, h: 24 },
			variant: "usage-gauge",
			text: { value: "Context Window Usage", wrap: "nowrap", lines: 1, overflow: "ellipsis" },
		},
	);

	const footerRow = new HStack({
		gap: 2,
		align: "center",
		children: [projectBtn, workspaceBtn, gitBranchBtn, statusesRow, { child: new Spacer(), grow: 1 }, contextBtn],
	});

	const footerBox = annotateSpecNode(
		new Box({
			maxWidth: COMPOSER_MAX_WIDTH,
			height: FOOTER_HEIGHT,
			fillWidth: true,
			padding: { horizontal: 10 },
			child: footerRow,
		}),
		{
			key: "workspace.main.footer",
			role: "region",
			flowComponent: footerRow,
			margin: [4, 20, 8, 20],
			size: { w: COMPOSER_MAX_WIDTH, h: FOOTER_HEIGHT },
			variant: "workspace-footer",
		},
	);

	const root = new FooterBarContainer(footerBox);

	const updateContextUsage = (usage: GuiContextUsage | undefined) => {
		currentUsage = usage;
		const summary = formatContextUsageSummary(usage);
		currentPercent = summary.percent;
		formattedContextLabel = summary.label;
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
					maxWidth: 160,
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
		projectBtn.setLabel(basename(cwd) || cwd || "Project");
		const branch = snapshot.gitBranch || snapshot.status.gitBranch || "main";
		const counts = computeDirtyCounts(snapshot.changedFiles);
		const dirtySuffix =
			counts.additions > 0 || counts.deletions > 0 ? ` (+${counts.additions} -${counts.deletions})` : "";
		gitBranchBtn.setLabel(`${branch}${dirtySuffix}`);
		gitBranchBtn.visible = true;
	};

	const updateStatusIndicators = (status: GuiSessionStatus) => {
		const providerName = status.activeModel?.provider ?? "offline";
		providerBadge.setLabel(providerName);
		if (status.isStreaming) {
			statusLoader.setMessage("Generating...");
			statusLoader.start();
		} else {
			statusLoader.stop();
			statusLoader.setMessage("Ready");
		}
	};

	const applySnapshot = (snapshot: GuiSessionSnapshot) => {
		updateGitAndWorkspace(snapshot);
		updateStatusIndicators(snapshot.status);
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
				updateStatusIndicators(event.status ?? snap.status);
				if (event.status?.contextUsage !== undefined) {
					updateContextUsage(event.status.contextUsage);
				} else {
					updateContextUsage(controller.getContextUsage());
				}
				break;
			}
			case "workspace_changed":
				updateGitAndWorkspace(controller.getSnapshot());
				break;
			case "extension_ui":
				renderStatuses(controller.getSnapshot().statuses);
				break;
			default:
				break;
		}
	};

	const applyTheme = (nextTheme: GuiTheme) => {
		theme = nextTheme;
		contextBtn.setHoverBackground(theme.surfaceHover);
		updateContextUsage(currentUsage);
		renderStatuses(controller.getSnapshot().statuses);
		root.invalidate();
	};

	applySnapshot(initialSnap);
	const unsubscribe = controller.subscribe(handleEvent);

	return {
		root,
		providerBadge,
		statusLoader,
		projectButton: projectBtn,
		workspaceButton: workspaceBtn,
		gitBranchButton: gitBranchBtn,
		contextButton: contextBtn,
		applyTheme,
		applySnapshot,
		handleEvent,
		setContextUsage: updateContextUsage,
		getFormattedContextLabel: () => formattedContextLabel,
		dispose: () => {
			statusLoader.stop();
			unsubscribe();
		},
	};
}
