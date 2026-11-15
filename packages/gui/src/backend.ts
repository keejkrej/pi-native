/**
 * Abstract GUI backend contract, window/text metrics, UTF-16 <-> UTF-8 offset conversion, and measurement caching.
 */

import {
	type CursorKindId,
	type FontFamilyId,
	type GuiA11yNode,
	type GuiNativeEvent,
	type MenuSpec,
	SGUI_FONT_FLAG_ITALIC,
	SGUI_FONT_FLAG_STRIKETHROUGH,
	SGUI_FONT_FLAG_UNDERLINE,
	SGUI_FONT_REGULAR,
} from "./protocol.ts";

export interface WindowOptions {
	readonly title: string;
	readonly width: number;
	readonly height: number;
	readonly resizable?: boolean;
	readonly titlebarHidden?: boolean;
	readonly unifiedTitlebar?: boolean;
}

export interface WindowMetrics {
	readonly width: number;
	readonly height: number;
	readonly scale: number;
	readonly insetLeft: number;
	readonly titlebarHeight: number;
	readonly darkMode: boolean;
	readonly focused: boolean;
}

export interface TextMetrics {
	readonly width: number;
	readonly height: number;
	readonly lineHeight: number;
	readonly baseline: number;
	readonly lineCount: number;
}

export interface TextStyle {
	readonly fontFamily?: FontFamilyId;
	readonly fontSize?: number;
	readonly fontWeight?: number;
	readonly italic?: boolean;
	readonly underline?: boolean;
	readonly strikethrough?: boolean;
}

export interface ResolvedTextStyle {
	readonly fontFamily: FontFamilyId;
	readonly fontSize: number;
	readonly fontWeight: number;
	readonly fontFlags: number;
}

export function resolveTextStyle(style: TextStyle, defaultFontSize = 14): ResolvedTextStyle {
	let fontFlags = 0;
	if (style.italic) fontFlags |= SGUI_FONT_FLAG_ITALIC;
	if (style.underline) fontFlags |= SGUI_FONT_FLAG_UNDERLINE;
	if (style.strikethrough) fontFlags |= SGUI_FONT_FLAG_STRIKETHROUGH;
	return {
		fontFamily: style.fontFamily ?? SGUI_FONT_REGULAR,
		fontSize: style.fontSize ?? defaultFontSize,
		fontWeight: style.fontWeight ?? 400,
		fontFlags,
	};
}

/**
 * Convert a UTF-16 code unit index in a JS string to a UTF-8 byte offset.
 */
export function utf16ToUtf8Offset(text: string, utf16Index: number): number {
	const limit = Math.max(0, Math.min(utf16Index, text.length));
	let bytes = 0;
	let i = 0;
	while (i < limit) {
		const code = text.charCodeAt(i);
		if (code < 0x80) {
			bytes += 1;
			i += 1;
		} else if (code < 0x800) {
			bytes += 2;
			i += 1;
		} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				i += 2;
				continue;
			}
			bytes += 3;
			i += 1;
		} else {
			bytes += 3;
			i += 1;
		}
	}
	return bytes;
}

/**
 * Convert a UTF-8 byte offset to a UTF-16 code unit index in a JS string.
 */
export function utf8ToUtf16Offset(text: string, utf8Offset: number): number {
	if (utf8Offset <= 0) {
		return 0;
	}
	let bytes = 0;
	let i = 0;
	while (i < text.length && bytes < utf8Offset) {
		const code = text.charCodeAt(i);
		let charBytes = 1;
		let step = 1;
		if (code < 0x80) {
			charBytes = 1;
		} else if (code < 0x800) {
			charBytes = 2;
		} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				charBytes = 4;
				step = 2;
			} else {
				charBytes = 3;
			}
		} else {
			charBytes = 3;
		}
		if (bytes + charBytes > utf8Offset) {
			break;
		}
		bytes += charBytes;
		i += step;
	}
	return i;
}

export class TextMeasureCache {
	private readonly entries: Map<string, TextMetrics>;
	private readonly maxEntries: number;

	constructor(maxEntries = 4096) {
		this.entries = new Map<string, TextMetrics>();
		this.maxEntries = maxEntries;
	}

	private makeKey(style: ResolvedTextStyle, maxWidth: number, text: string): string {
		const widthKey = maxWidth > 0 ? Math.round(maxWidth * 4) : 0;
		return `${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.fontFlags}|${widthKey}|${text}`;
	}

	get(style: ResolvedTextStyle, maxWidth: number, text: string): TextMetrics | undefined {
		return this.entries.get(this.makeKey(style, maxWidth, text));
	}

	set(style: ResolvedTextStyle, maxWidth: number, text: string, metrics: TextMetrics): void {
		if (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next();
			if (!oldest.done) {
				this.entries.delete(oldest.value);
			}
		}
		this.entries.set(this.makeKey(style, maxWidth, text), metrics);
	}

	clear(): void {
		this.entries.clear();
	}

	get size(): number {
		return this.entries.size;
	}
}

export abstract class GuiBackend {
	protected menuHandlers: Map<number, () => void>;

	constructor() {
		this.menuHandlers = new Map<number, () => void>();
	}

	abstract readonly platform: string;

	abstract init(): void;
	abstract shutdown(): void;
	abstract createWindow(options: WindowOptions): number;
	abstract destroyWindow(windowId: number): void;
	abstract setWindowTitle(windowId: number, title: string): void;
	abstract setWindowChrome(windowId: number, darkMode: boolean, sidebarWidth: number, vibrancyEnabled: boolean): void;
	abstract windowAction(windowId: number, action: number): void;
	abstract getWindowMetrics(windowId: number): WindowMetrics;
	abstract measureText(style: TextStyle, maxWidth: number, text: string): TextMetrics;
	abstract getTextCaretX(style: TextStyle, line: string, charIndex: number): number;
	abstract hitTestText(style: TextStyle, line: string, x: number): number;
	abstract present(windowId: number, commands: Uint8Array): void;
	abstract pollEvents(waitMs: number): GuiNativeEvent[];
	abstract getClipboardText(): string;
	abstract setClipboardText(text: string): void;
	abstract setCursor(windowId: number, cursor: CursorKindId): void;
	abstract setImeRect(windowId: number, x: number, y: number, width: number, height: number): void;
	abstract setAppMenu(menus: readonly MenuSpec[]): void;
	abstract setAccessibilityTree(windowId: number, nodes: readonly GuiA11yNode[]): void;

	dispatchMenuItem(itemId: number): boolean {
		const handler = this.menuHandlers.get(itemId);
		if (handler === undefined) {
			return false;
		}
		handler();
		return true;
	}
}
