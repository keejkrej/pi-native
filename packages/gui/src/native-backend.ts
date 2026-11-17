/**
 * Native backend adapter driving C/ObjC sgui_* functions through a monomorphic NativeDriver abstract class.
 */

import {
	GuiBackend,
	resolveTextStyle,
	TextMeasureCache,
	type TextMetrics,
	type TextStyle,
	utf8ToUtf16Offset,
	utf16ToUtf8Offset,
	type WindowMetrics,
	type WindowOptions,
} from "./backend.ts";
import {
	type CursorKindId,
	decodeEvents,
	encodeA11yTree,
	encodeMenuSpec,
	type GuiA11yNode,
	type GuiNativeEvent,
	type MenuSpec,
	SGUI_TEXT_METRICS_SIZE,
	SGUI_WIN_RESIZABLE,
	SGUI_WIN_TITLEBAR_HIDDEN,
	SGUI_WIN_UNIFIED_TITLEBAR,
	SGUI_WINDOW_METRICS_SIZE,
} from "./protocol.ts";

export abstract class NativeDriver {
	abstract init(): number;
	abstract shutdown(): void;
	abstract windowCreate(title: string, width: number, height: number, flags: number): number;
	abstract windowDestroy(windowId: number): void;
	abstract windowSetTitle(windowId: number, title: string): void;
	abstract windowSetChrome(windowId: number, darkMode: number, sidebarWidth: number, vibrancyEnabled: number): void;
	abstract windowAction(windowId: number, action: number): void;
	abstract windowGetMetrics(windowId: number, outMetrics: Uint8Array): number;
	abstract measureText(
		fontFamily: number,
		fontSize: number,
		fontWeight: number,
		fontFlags: number,
		maxWidth: number,
		text: string,
		outMetrics: Uint8Array,
	): number;
	abstract textCaretX(
		fontFamily: number,
		fontSize: number,
		fontWeight: number,
		fontFlags: number,
		line: string,
		byteOffset: number,
	): number;
	abstract textHitIndex(
		fontFamily: number,
		fontSize: number,
		fontWeight: number,
		fontFlags: number,
		line: string,
		x: number,
	): number;
	abstract present(windowId: number, commands: Uint8Array): number;
	abstract pollEvents(waitMs: number, outEvents: Uint8Array): number;
	abstract clipboardGetText(outUtf8: Uint8Array): number;
	abstract clipboardSetText(text: string): number;
	abstract setCursor(windowId: number, cursorKind: number): void;
	abstract setImeRect(windowId: number, x: number, y: number, width: number, height: number): void;
	abstract setAppMenu(spec: Uint8Array): number;
	abstract setA11yTree(windowId: number, nodes: Uint8Array): number;
}

const textDecoder = new TextDecoder();

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export class NativeBackend extends GuiBackend {
	readonly platform: string;
	private readonly driver: NativeDriver;
	private readonly windowMetricsBuf: Uint8Array;
	private readonly windowMetricsView: DataView;
	private readonly textMetricsBuf: Uint8Array;
	private readonly textMetricsView: DataView;
	private readonly eventsBuf: Uint8Array;
	private clipboardBuf: Uint8Array;
	private readonly measureCache: TextMeasureCache;
	private readonly lastA11yBytes: Map<number, Uint8Array>;

	constructor(driver: NativeDriver, platform: string = process.platform) {
		super();
		this.driver = driver;
		this.platform = platform;
		this.windowMetricsBuf = new Uint8Array(SGUI_WINDOW_METRICS_SIZE);
		this.windowMetricsView = new DataView(this.windowMetricsBuf.buffer);
		this.textMetricsBuf = new Uint8Array(SGUI_TEXT_METRICS_SIZE);
		this.textMetricsView = new DataView(this.textMetricsBuf.buffer);
		this.eventsBuf = new Uint8Array(65536);
		this.clipboardBuf = new Uint8Array(8192);
		this.measureCache = new TextMeasureCache();
		this.lastA11yBytes = new Map<number, Uint8Array>();
	}

	init(): void {
		const rc = this.driver.init();
		if (rc < 0) {
			throw new Error(`sgui_init failed with code ${rc}`);
		}
	}

	shutdown(): void {
		this.driver.shutdown();
	}

	createWindow(options: WindowOptions): number {
		let flags = 0;
		if (options.titlebarHidden) flags |= SGUI_WIN_TITLEBAR_HIDDEN;
		if (options.resizable !== false) flags |= SGUI_WIN_RESIZABLE;
		if (options.unifiedTitlebar) flags |= SGUI_WIN_UNIFIED_TITLEBAR;
		const id = this.driver.windowCreate(options.title, options.width, options.height, flags);
		if (id === 0) {
			throw new Error("sgui_window_create failed");
		}
		return id;
	}

	destroyWindow(windowId: number): void {
		this.lastA11yBytes.delete(windowId);
		this.driver.windowDestroy(windowId);
	}

	setWindowTitle(windowId: number, title: string): void {
		this.driver.windowSetTitle(windowId, title);
	}

	setWindowChrome(windowId: number, darkMode: boolean, sidebarWidth: number, vibrancyEnabled: boolean): void {
		this.driver.windowSetChrome(windowId, darkMode ? 1 : 0, sidebarWidth, vibrancyEnabled ? 1 : 0);
	}

	windowAction(windowId: number, action: number): void {
		this.driver.windowAction(windowId, action);
	}

	getWindowMetrics(windowId: number): WindowMetrics {
		const rc = this.driver.windowGetMetrics(windowId, this.windowMetricsBuf);
		if (rc !== 0) {
			throw new Error(`sgui_window_get_metrics failed for window ${windowId}`);
		}
		return {
			width: this.windowMetricsView.getFloat64(0, true),
			height: this.windowMetricsView.getFloat64(8, true),
			scale: this.windowMetricsView.getFloat64(16, true),
			insetLeft: this.windowMetricsView.getFloat64(24, true),
			titlebarHeight: this.windowMetricsView.getFloat64(32, true),
			darkMode: this.windowMetricsView.getUint32(40, true) !== 0,
			focused: this.windowMetricsView.getUint32(44, true) !== 0,
		};
	}

	measureText(style: TextStyle, maxWidth: number, text: string): TextMetrics {
		const resolved = resolveTextStyle(style);
		const cached = this.measureCache.get(resolved, maxWidth, text);
		if (cached !== undefined) {
			return cached;
		}
		const rc = this.driver.measureText(
			resolved.fontFamily,
			resolved.fontSize,
			resolved.fontWeight,
			resolved.fontFlags,
			maxWidth,
			text,
			this.textMetricsBuf,
		);
		if (rc !== 0) {
			throw new Error("sgui_measure_text failed");
		}
		const metrics: TextMetrics = {
			width: this.textMetricsView.getFloat64(0, true),
			height: this.textMetricsView.getFloat64(8, true),
			lineHeight: this.textMetricsView.getFloat64(16, true),
			baseline: this.textMetricsView.getFloat64(24, true),
			lineCount: this.textMetricsView.getUint32(32, true),
		};
		this.measureCache.set(resolved, maxWidth, text, metrics);
		return metrics;
	}

	getTextCaretX(style: TextStyle, line: string, charIndex: number): number {
		const resolved = resolveTextStyle(style);
		const byteOffset = utf16ToUtf8Offset(line, charIndex);
		return this.driver.textCaretX(
			resolved.fontFamily,
			resolved.fontSize,
			resolved.fontWeight,
			resolved.fontFlags,
			line,
			byteOffset,
		);
	}

	hitTestText(style: TextStyle, line: string, x: number): number {
		const resolved = resolveTextStyle(style);
		const byteOffset = this.driver.textHitIndex(
			resolved.fontFamily,
			resolved.fontSize,
			resolved.fontWeight,
			resolved.fontFlags,
			line,
			x,
		);
		return utf8ToUtf16Offset(line, byteOffset);
	}

	present(windowId: number, commands: Uint8Array): void {
		const rc = this.driver.present(windowId, commands);
		if (rc < 0) {
			throw new Error(`sgui_present failed with code ${rc}`);
		}
	}

	pollEvents(waitMs: number): GuiNativeEvent[] {
		const bytesWritten = this.driver.pollEvents(waitMs, this.eventsBuf);
		if (bytesWritten <= 0) {
			return [];
		}
		return decodeEvents(this.eventsBuf, bytesWritten);
	}

	getClipboardText(): string {
		let needed = this.driver.clipboardGetText(this.clipboardBuf);
		if (needed <= 0) {
			return "";
		}
		if (needed > this.clipboardBuf.byteLength) {
			this.clipboardBuf = new Uint8Array(needed + 1024);
			needed = this.driver.clipboardGetText(this.clipboardBuf);
			if (needed <= 0) {
				return "";
			}
		}
		const count = Math.min(needed, this.clipboardBuf.byteLength);
		return textDecoder.decode(this.clipboardBuf.subarray(0, count));
	}

	setClipboardText(text: string): void {
		this.driver.clipboardSetText(text);
	}

	setCursor(windowId: number, cursor: CursorKindId): void {
		this.driver.setCursor(windowId, cursor);
	}

	setImeRect(windowId: number, x: number, y: number, width: number, height: number): void {
		this.driver.setImeRect(windowId, x, y, width, height);
	}

	setAppMenu(menus: readonly MenuSpec[]): void {
		const encoded = encodeMenuSpec(menus);
		this.menuHandlers = encoded.handlers;
		const rc = this.driver.setAppMenu(encoded.bytes);
		if (rc < 0) {
			throw new Error(`sgui_set_app_menu failed with code ${rc}`);
		}
	}

	setAccessibilityTree(windowId: number, nodes: readonly GuiA11yNode[]): void {
		const encoded = encodeA11yTree(nodes);
		const prev = this.lastA11yBytes.get(windowId);
		if (prev !== undefined && bytesEqual(prev, encoded)) {
			return;
		}
		this.lastA11yBytes.set(windowId, encoded);
		this.driver.setA11yTree(windowId, encoded);
	}
}
