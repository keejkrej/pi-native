/**
 * Direct scriptc FFI ambient bindings matching packages/gui/ffi/*.json and the native backend factory.
 */

import { resolveTextStyle, type TextMetrics, type TextStyle } from "./backend.ts";
import { NativeBackend, NativeDriver } from "./native-backend.ts";
import { SGUI_TEXT_METRICS_SIZE } from "./protocol.ts";

declare function sguiInit(): number;
declare function sguiShutdown(): void;
declare function sguiWindowCreate(title: string, width: number, height: number, flags: number): number;
declare function sguiWindowDestroy(windowId: number): void;
declare function sguiWindowSetTitle(windowId: number, title: string): void;
declare function sguiWindowSetChrome(windowId: number, darkMode: number, sidebarWidth: number, vibrancyEnabled: number): void;
declare function sguiWindowAction(windowId: number, action: number): void;
declare function sguiWindowGetMetrics(windowId: number, outMetrics: Uint8Array): number;
declare function sguiMeasureText(
	fontFamily: number,
	fontSize: number,
	fontWeight: number,
	fontFlags: number,
	maxWidth: number,
	text: string,
	outMetrics: Uint8Array,
): number;
declare function sguiTextCaretX(
	fontFamily: number,
	fontSize: number,
	fontWeight: number,
	fontFlags: number,
	line: string,
	byteOffset: number,
): number;
declare function sguiTextHitIndex(
	fontFamily: number,
	fontSize: number,
	fontWeight: number,
	fontFlags: number,
	line: string,
	x: number,
): number;
declare function sguiPresent(windowId: number, commands: Uint8Array): number;
declare function sguiPollEvents(waitMs: number, outEvents: Uint8Array): number;
declare function sguiClipboardGetText(outUtf8: Uint8Array): number;
declare function sguiClipboardSetText(text: string): number;
declare function sguiSetCursor(windowId: number, cursorKind: number): void;
declare function sguiSetImeRect(windowId: number, x: number, y: number, width: number, height: number): void;
declare function sguiSetAppMenu(spec: Uint8Array): number;
declare function sguiSetA11yTree(windowId: number, nodes: Uint8Array): number;
declare function sguiRenderPng(
	width: number,
	height: number,
	scale: number,
	drawList: Uint8Array,
	outPath: string,
): number;

export function renderDrawListToPng(
	width: number,
	height: number,
	scale: number,
	drawList: Uint8Array,
	outPath: string,
): boolean {
	if (width <= 0 || height <= 0 || scale <= 0 || drawList.byteLength === 0 || outPath.length === 0) {
		return false;
	}
	try {
		return sguiRenderPng(width, height, scale, drawList, outPath) === 0;
	} catch {
		return false;
	}
}

const nativeMeasureBuf = new Uint8Array(SGUI_TEXT_METRICS_SIZE);
const nativeMeasureView = new DataView(nativeMeasureBuf.buffer);

/**
 * Measure text using the native CoreText/Pango driver (`sgui_measure_text`) when
 * compiled with FFI, returning `undefined` on non-FFI/Node runtimes.
 */
export function measureTextWithNative(
	style: TextStyle,
	maxWidth: number,
	text: string,
): TextMetrics | undefined {
	try {
		const resolved = resolveTextStyle(style);
		const rc = sguiMeasureText(
			resolved.fontFamily,
			resolved.fontSize,
			resolved.fontWeight,
			resolved.fontFlags,
			maxWidth,
			text,
			nativeMeasureBuf,
		);
		if (rc !== 0) {
			return undefined;
		}
		return {
			width: nativeMeasureView.getFloat64(0, true),
			height: nativeMeasureView.getFloat64(8, true),
			lineHeight: nativeMeasureView.getFloat64(16, true),
			baseline: nativeMeasureView.getFloat64(24, true),
			lineCount: nativeMeasureView.getUint32(32, true),
		};
	} catch {
		return undefined;
	}
}

export class FfiNativeDriver extends NativeDriver {
	init(): number {
		return sguiInit();
	}

	shutdown(): void {
		sguiShutdown();
	}

	windowCreate(title: string, width: number, height: number, flags: number): number {
		return sguiWindowCreate(title, width, height, flags);
	}

	windowDestroy(windowId: number): void {
		sguiWindowDestroy(windowId);
	}

	windowSetTitle(windowId: number, title: string): void {
		sguiWindowSetTitle(windowId, title);
	}

	windowSetChrome(windowId: number, darkMode: number, sidebarWidth: number, vibrancyEnabled: number): void {
		sguiWindowSetChrome(windowId, darkMode, sidebarWidth, vibrancyEnabled);
	}

	windowAction(windowId: number, action: number): void {
		sguiWindowAction(windowId, action);
	}

	windowGetMetrics(windowId: number, outMetrics: Uint8Array): number {
		return sguiWindowGetMetrics(windowId, outMetrics);
	}

	measureText(
		fontFamily: number,
		fontSize: number,
		fontWeight: number,
		fontFlags: number,
		maxWidth: number,
		text: string,
		outMetrics: Uint8Array,
	): number {
		return sguiMeasureText(fontFamily, fontSize, fontWeight, fontFlags, maxWidth, text, outMetrics);
	}

	textCaretX(
		fontFamily: number,
		fontSize: number,
		fontWeight: number,
		fontFlags: number,
		line: string,
		byteOffset: number,
	): number {
		return sguiTextCaretX(fontFamily, fontSize, fontWeight, fontFlags, line, byteOffset);
	}

	textHitIndex(
		fontFamily: number,
		fontSize: number,
		fontWeight: number,
		fontFlags: number,
		line: string,
		x: number,
	): number {
		return sguiTextHitIndex(fontFamily, fontSize, fontWeight, fontFlags, line, x);
	}

	present(windowId: number, commands: Uint8Array): number {
		return sguiPresent(windowId, commands);
	}

	pollEvents(waitMs: number, outEvents: Uint8Array): number {
		return sguiPollEvents(waitMs, outEvents);
	}

	clipboardGetText(outUtf8: Uint8Array): number {
		return sguiClipboardGetText(outUtf8);
	}

	clipboardSetText(text: string): number {
		return sguiClipboardSetText(text);
	}

	setCursor(windowId: number, cursorKind: number): void {
		sguiSetCursor(windowId, cursorKind);
	}

	setImeRect(windowId: number, x: number, y: number, width: number, height: number): void {
		sguiSetImeRect(windowId, x, y, width, height);
	}

	setAppMenu(spec: Uint8Array): number {
		return sguiSetAppMenu(spec);
	}

	setA11yTree(windowId: number, nodes: Uint8Array): number {
		return sguiSetA11yTree(windowId, nodes);
	}
}

export function createNativeBackend(platform: string = process.platform): NativeBackend {
	return new NativeBackend(new FfiNativeDriver(), platform);
}
