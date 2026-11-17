/**
 * Direct scriptc FFI ambient bindings matching packages/gui/ffi/*.json and the native backend factory.
 */

import { NativeBackend, NativeDriver } from "./native-backend.ts";

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
