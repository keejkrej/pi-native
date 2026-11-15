/**
 * Pure TypeScript headless GUI backend for deterministic unit, layout, and UI tests without a display server.
 */

import {
	GuiBackend,
	resolveTextStyle,
	TextMeasureCache,
	type TextMetrics,
	type TextStyle,
	type WindowMetrics,
	type WindowOptions,
} from "./backend.ts";
import {
	type A11yActionKind,
	type CursorKindId,
	type DrawCommand,
	decodeDrawCommands,
	encodeMenuSpec,
	type GuiA11yNode,
	type GuiNativeEvent,
	type MenuSpec,
	SGUI_CURSOR_ARROW,
	SGUI_FONT_MONO,
} from "./protocol.ts";

export interface HeadlessBackendOptions {
	readonly width?: number;
	readonly height?: number;
	readonly scale?: number;
	readonly darkMode?: boolean;
	readonly focused?: boolean;
	readonly insetLeft?: number;
	readonly titlebarHeight?: number;
	readonly platform?: string;
}

interface HeadlessWindowState {
	id: number;
	title: string;
	width: number;
	height: number;
	scale: number;
	insetLeft: number;
	titlebarHeight: number;
	darkMode: boolean;
	focused: boolean;
	cursor: CursorKindId;
	imeRect: { x: number; y: number; width: number; height: number } | undefined;
	frameCount: number;
	lastFrame: Uint8Array | undefined;
	a11yNodes: GuiA11yNode[];
}

function charAdvance(ch: string, fontFamily: number, fontSize: number, fontWeight: number): number {
	if (fontFamily === SGUI_FONT_MONO) {
		return fontSize * 0.6;
	}
	const weightScale = fontWeight >= 600 ? 1.05 : 1.0;
	const code = ch.charCodeAt(0);
	if (code > 0x2e80 || (code >= 0xd800 && code <= 0xdbff)) {
		return fontSize * 1.0 * weightScale;
	}
	switch (ch) {
		case "i":
		case "l":
		case "I":
		case "|":
		case ".":
		case ",":
		case ":":
		case ";":
		case "!":
		case "'":
			return fontSize * 0.3 * weightScale;
		case "f":
		case "j":
		case "r":
		case "t":
		case " ":
			return fontSize * 0.35 * weightScale;
		case "m":
		case "w":
		case "M":
		case "W":
		case "@":
		case "#":
		case "%":
		case "&":
			return fontSize * 0.85 * weightScale;
		default:
			return fontSize * 0.56 * weightScale;
	}
}

function measureLineWidth(text: string, fontFamily: number, fontSize: number, fontWeight: number): number {
	let width = 0;
	let i = 0;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		const ch = text.charAt(i);
		width += charAdvance(ch, fontFamily, fontSize, fontWeight);
		if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			i += 2;
		} else {
			i += 1;
		}
	}
	return width;
}

function wrapSingleParagraph(
	paragraph: string,
	maxWidth: number,
	fontFamily: number,
	fontSize: number,
	fontWeight: number,
): string[] {
	if (paragraph.length === 0) {
		return [""];
	}
	if (maxWidth <= 0 || measureLineWidth(paragraph, fontFamily, fontSize, fontWeight) <= maxWidth) {
		return [paragraph];
	}

	const lines: string[] = [];
	const words = paragraph.split(" ");
	let current = "";

	for (let w = 0; w < words.length; w++) {
		const word = words[w];
		if (word === undefined) continue;
		const candidate = current.length === 0 ? word : `${current} ${word}`;
		if (measureLineWidth(candidate, fontFamily, fontSize, fontWeight) <= maxWidth) {
			current = candidate;
			continue;
		}
		if (current.length > 0) {
			lines.push(current);
			current = "";
		}
		if (measureLineWidth(word, fontFamily, fontSize, fontWeight) <= maxWidth) {
			current = word;
			continue;
		}
		// Break oversized word by character
		let chunk = "";
		let ci = 0;
		while (ci < word.length) {
			const code = word.charCodeAt(ci);
			const step = code >= 0xd800 && code <= 0xdbff && ci + 1 < word.length ? 2 : 1;
			const glyph = word.slice(ci, ci + step);
			const nextChunk = chunk + glyph;
			if (chunk.length > 0 && measureLineWidth(nextChunk, fontFamily, fontSize, fontWeight) > maxWidth) {
				lines.push(chunk);
				chunk = glyph;
			} else {
				chunk = nextChunk;
			}
			ci += step;
		}
		current = chunk;
	}

	if (current.length > 0 || lines.length === 0) {
		lines.push(current);
	}
	return lines;
}

export class HeadlessBackend extends GuiBackend {
	readonly platform: string;
	private readonly defaultOpts: {
		width: number;
		height: number;
		scale: number;
		darkMode: boolean;
		focused: boolean;
		insetLeft: number;
		titlebarHeight: number;
	};
	private readonly windows: Map<number, HeadlessWindowState>;
	private readonly measureCache: TextMeasureCache;
	private readonly eventQueue: GuiNativeEvent[];
	private nextWindowId: number;
	private initialized: boolean;
	private clipboardText: string;
	private menus: readonly MenuSpec[];

	constructor(options: HeadlessBackendOptions = {}) {
		super();
		this.platform = options.platform ?? "darwin";
		this.defaultOpts = {
			width: options.width ?? 1024,
			height: options.height ?? 720,
			scale: options.scale ?? 2,
			darkMode: options.darkMode ?? true,
			focused: options.focused ?? true,
			insetLeft: options.insetLeft ?? 0,
			titlebarHeight: options.titlebarHeight ?? 0,
		};
		this.windows = new Map<number, HeadlessWindowState>();
		this.measureCache = new TextMeasureCache();
		this.eventQueue = [];
		this.nextWindowId = 1;
		this.initialized = false;
		this.clipboardText = "";
		this.menus = [];
	}

	init(): void {
		this.initialized = true;
	}

	shutdown(): void {
		this.initialized = false;
		this.windows.clear();
		this.eventQueue.length = 0;
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	createWindow(options: WindowOptions): number {
		const id = this.nextWindowId;
		this.nextWindowId += 1;
		this.windows.set(id, {
			id,
			title: options.title,
			width: options.width > 0 ? options.width : this.defaultOpts.width,
			height: options.height > 0 ? options.height : this.defaultOpts.height,
			scale: this.defaultOpts.scale,
			insetLeft: this.defaultOpts.insetLeft,
			titlebarHeight: options.titlebarHidden ? this.defaultOpts.titlebarHeight : 0,
			darkMode: this.defaultOpts.darkMode,
			focused: this.defaultOpts.focused,
			cursor: SGUI_CURSOR_ARROW,
			imeRect: undefined,
			frameCount: 0,
			lastFrame: undefined,
			a11yNodes: [],
		});
		return id;
	}

	destroyWindow(windowId: number): void {
		this.windows.delete(windowId);
	}

	setWindowTitle(windowId: number, title: string): void {
		const win = this.windows.get(windowId);
		if (win !== undefined) {
			win.title = title;
		}
	}

	getWindowTitle(windowId: number): string | undefined {
		return this.windows.get(windowId)?.title;
	}

	getWindowMetrics(windowId: number): WindowMetrics {
		const win = this.windows.get(windowId);
		if (win === undefined) {
			return {
				width: this.defaultOpts.width,
				height: this.defaultOpts.height,
				scale: this.defaultOpts.scale,
				insetLeft: this.defaultOpts.insetLeft,
				titlebarHeight: this.defaultOpts.titlebarHeight,
				darkMode: this.defaultOpts.darkMode,
				focused: this.defaultOpts.focused,
			};
		}
		return {
			width: win.width,
			height: win.height,
			scale: win.scale,
			insetLeft: win.insetLeft,
			titlebarHeight: win.titlebarHeight,
			darkMode: win.darkMode,
			focused: win.focused,
		};
	}

	measureText(style: TextStyle, maxWidth: number, text: string): TextMetrics {
		const resolved = resolveTextStyle(style);
		const cached = this.measureCache.get(resolved, maxWidth, text);
		if (cached !== undefined) {
			return cached;
		}
		const lineHeight = Math.max(1, Math.ceil(resolved.fontSize * 1.35));
		const baseline = Math.max(1, Math.ceil(resolved.fontSize * 0.85));
		const paragraphs = text.split("\n");
		let maxLineW = 0;
		let lineCount = 0;

		for (let i = 0; i < paragraphs.length; i++) {
			const para = paragraphs[i];
			if (para === undefined) continue;
			const wrapped = wrapSingleParagraph(
				para,
				maxWidth,
				resolved.fontFamily,
				resolved.fontSize,
				resolved.fontWeight,
			);
			for (let j = 0; j < wrapped.length; j++) {
				const line = wrapped[j];
				if (line === undefined) continue;
				const w = measureLineWidth(line, resolved.fontFamily, resolved.fontSize, resolved.fontWeight);
				if (w > maxLineW) maxLineW = w;
				lineCount += 1;
			}
		}

		if (lineCount === 0) lineCount = 1;
		const metrics: TextMetrics = {
			width: maxLineW,
			height: lineCount * lineHeight,
			lineHeight,
			baseline,
			lineCount,
		};
		this.measureCache.set(resolved, maxWidth, text, metrics);
		return metrics;
	}

	getTextCaretX(style: TextStyle, line: string, charIndex: number): number {
		const resolved = resolveTextStyle(style);
		const limit = Math.max(0, Math.min(charIndex, line.length));
		return measureLineWidth(line.slice(0, limit), resolved.fontFamily, resolved.fontSize, resolved.fontWeight);
	}

	hitTestText(style: TextStyle, line: string, x: number): number {
		if (x <= 0 || line.length === 0) {
			return 0;
		}
		const resolved = resolveTextStyle(style);
		let acc = 0;
		let i = 0;
		while (i < line.length) {
			const code = line.charCodeAt(i);
			const step = code >= 0xd800 && code <= 0xdbff && i + 1 < line.length ? 2 : 1;
			const adv = charAdvance(line.charAt(i), resolved.fontFamily, resolved.fontSize, resolved.fontWeight);
			if (x < acc + adv * 0.5) {
				return i;
			}
			acc += adv;
			i += step;
		}
		return line.length;
	}

	present(windowId: number, commands: Uint8Array): void {
		const win = this.windows.get(windowId);
		if (win === undefined) {
			return;
		}
		win.frameCount += 1;
		win.lastFrame = commands.slice();
	}

	pollEvents(_waitMs: number): GuiNativeEvent[] {
		if (this.eventQueue.length === 0) {
			return [];
		}
		const batch = this.eventQueue.slice();
		this.eventQueue.length = 0;
		return batch;
	}

	getClipboardText(): string {
		return this.clipboardText;
	}

	setClipboardText(text: string): void {
		this.clipboardText = text;
	}

	setCursor(windowId: number, cursor: CursorKindId): void {
		const win = this.windows.get(windowId);
		if (win !== undefined) {
			win.cursor = cursor;
		}
	}

	setImeRect(windowId: number, x: number, y: number, width: number, height: number): void {
		const win = this.windows.get(windowId);
		if (win !== undefined) {
			win.imeRect = { x, y, width, height };
		}
	}

	setAppMenu(menus: readonly MenuSpec[]): void {
		const encoded = encodeMenuSpec(menus);
		this.menuHandlers = encoded.handlers;
		this.menus = menus;
	}

	setAccessibilityTree(windowId: number, nodes: readonly GuiA11yNode[]): void {
		const win = this.windows.get(windowId);
		if (win === undefined) {
			return;
		}
		win.a11yNodes = nodes.slice();
	}

	getAccessibilityTree(windowId = 1): readonly GuiA11yNode[] {
		return this.windows.get(windowId)?.a11yNodes ?? [];
	}

	triggerA11yAction(nodeId: number, action: A11yActionKind, value = "", windowId = 1): void {
		this.eventQueue.push({
			kind: "a11yAction",
			windowId,
			modifiers: 0,
			nodeId,
			action,
			value,
		});
	}

	triggerA11yPress(nodeId: number, windowId = 1): void {
		this.triggerA11yAction(nodeId, "press", "", windowId);
	}

	triggerA11yFocus(nodeId: number, windowId = 1): void {
		this.triggerA11yAction(nodeId, "focus", "", windowId);
	}

	triggerA11ySetValue(nodeId: number, value: string, windowId = 1): void {
		this.triggerA11yAction(nodeId, "setValue", value, windowId);
	}

	triggerA11yIncrement(nodeId: number, windowId = 1): void {
		this.triggerA11yAction(nodeId, "increment", "", windowId);
	}

	triggerA11yDecrement(nodeId: number, windowId = 1): void {
		this.triggerA11yAction(nodeId, "decrement", "", windowId);
	}

	getMenus(): readonly MenuSpec[] {
		return this.menus;
	}

	getFrameCount(windowId = 1): number {
		return this.windows.get(windowId)?.frameCount ?? 0;
	}

	getLastFrameBytes(windowId = 1): Uint8Array | undefined {
		return this.windows.get(windowId)?.lastFrame;
	}

	getLastFrameCommands(windowId = 1): DrawCommand[] {
		const bytes = this.getLastFrameBytes(windowId);
		return bytes === undefined ? [] : decodeDrawCommands(bytes);
	}

	getRenderedTexts(windowId = 1): string[] {
		const cmds = this.getLastFrameCommands(windowId);
		const texts: string[] = [];
		for (let i = 0; i < cmds.length; i++) {
			const cmd = cmds[i];
			if (cmd !== undefined && cmd.kind === "drawText") {
				texts.push(cmd.text);
			}
		}
		return texts;
	}

	getCursor(windowId = 1): CursorKindId {
		return this.windows.get(windowId)?.cursor ?? SGUI_CURSOR_ARROW;
	}

	getImeRect(windowId = 1): { x: number; y: number; width: number; height: number } | undefined {
		return this.windows.get(windowId)?.imeRect;
	}

	pushEvent(event: GuiNativeEvent): void {
		this.eventQueue.push(event);
	}

	pushClose(windowId = 1): void {
		this.eventQueue.push({ kind: "close", windowId, modifiers: 0 });
	}

	resize(width: number, height: number, scale?: number, windowId = 1): void {
		const win = this.windows.get(windowId);
		const nextScale = scale ?? win?.scale ?? this.defaultOpts.scale;
		if (win !== undefined) {
			win.width = width;
			win.height = height;
			win.scale = nextScale;
		}
		this.eventQueue.push({
			kind: "resize",
			windowId,
			modifiers: 0,
			width,
			height,
			scale: nextScale,
		});
	}

	setFocus(focused: boolean, darkMode?: boolean, windowId = 1): void {
		const win = this.windows.get(windowId);
		const nextDark = darkMode ?? win?.darkMode ?? this.defaultOpts.darkMode;
		if (win !== undefined) {
			win.focused = focused;
			win.darkMode = nextDark;
		}
		this.eventQueue.push({
			kind: "focus",
			windowId,
			modifiers: 0,
			focused,
			darkMode: nextDark,
		});
	}

	setDarkMode(darkMode: boolean, windowId = 1): void {
		const focused = this.windows.get(windowId)?.focused ?? true;
		this.setFocus(focused, darkMode, windowId);
	}

	movePointer(x: number, y: number, modifiers = 0, windowId = 1): void {
		this.eventQueue.push({
			kind: "pointer",
			windowId,
			modifiers,
			phase: "move",
			button: "none",
			clickCount: 0,
			x,
			y,
		});
	}

	pointerDown(
		x: number,
		y: number,
		button: "none" | "left" | "middle" | "right" = "left",
		clickCount = 1,
		modifiers = 0,
		windowId = 1,
	): void {
		this.eventQueue.push({
			kind: "pointer",
			windowId,
			modifiers,
			phase: "down",
			button,
			clickCount,
			x,
			y,
		});
	}

	dragPointer(
		x: number,
		y: number,
		button: "none" | "left" | "middle" | "right" = "left",
		modifiers = 0,
		windowId = 1,
	): void {
		this.eventQueue.push({
			kind: "pointer",
			windowId,
			modifiers,
			phase: "drag",
			button,
			clickCount: 1,
			x,
			y,
		});
	}

	pointerUp(
		x: number,
		y: number,
		button: "none" | "left" | "middle" | "right" = "left",
		clickCount = 1,
		modifiers = 0,
		windowId = 1,
	): void {
		this.eventQueue.push({
			kind: "pointer",
			windowId,
			modifiers,
			phase: "up",
			button,
			clickCount,
			x,
			y,
		});
	}

	pointerLeave(windowId = 1): void {
		this.eventQueue.push({
			kind: "pointer",
			windowId,
			modifiers: 0,
			phase: "leave",
			button: "none",
			clickCount: 0,
			x: -1,
			y: -1,
		});
	}

	click(
		x: number,
		y: number,
		button: "none" | "left" | "middle" | "right" = "left",
		modifiers = 0,
		windowId = 1,
	): void {
		this.movePointer(x, y, modifiers, windowId);
		this.pointerDown(x, y, button, 1, modifiers, windowId);
		this.pointerUp(x, y, button, 1, modifiers, windowId);
	}

	wheel(x: number, y: number, deltaX: number, deltaY: number, modifiers = 0, windowId = 1): void {
		this.eventQueue.push({
			kind: "scroll",
			windowId,
			modifiers,
			x,
			y,
			deltaX,
			deltaY,
		});
	}

	pressKey(key: string, modifiers = 0, phase: "down" | "up" | "repeat" = "down", keyCode = 0, windowId = 1): void {
		this.eventQueue.push({
			kind: "key",
			windowId,
			modifiers,
			phase,
			keyCode,
			name: key,
		});
	}

	insertText(text: string, windowId = 1): void {
		this.eventQueue.push({ kind: "text", windowId, modifiers: 0, text });
	}

	setImePreedit(text: string, cursorStart: number, cursorEnd: number, windowId = 1): void {
		this.eventQueue.push({
			kind: "imePreedit",
			windowId,
			modifiers: 0,
			cursorStart,
			cursorEnd,
			text,
		});
	}

	triggerMenu(itemId: number, windowId = 1): void {
		this.eventQueue.push({ kind: "menu", windowId, modifiers: 0, itemId });
	}
}
