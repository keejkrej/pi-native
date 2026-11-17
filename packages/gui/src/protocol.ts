/**
 * Binary wire protocol matching native/include/sgui.h: draw commands, events, metrics, and menu encoding.
 */

export type FontFamilyId = 0 | 1;
export type CursorKindId = 0 | 1 | 2 | 3 | 4;

export const SGUI_WIN_TITLEBAR_HIDDEN = 1;
export const SGUI_WIN_RESIZABLE = 2;
export const SGUI_WIN_UNIFIED_TITLEBAR = 4;

export const SGUI_WIN_ACTION_DRAG = 1;
export const SGUI_WIN_ACTION_ZOOM = 2;
export const SGUI_WIN_ACTION_MINIATURIZE = 3;

export const SGUI_FONT_REGULAR: FontFamilyId = 0;
export const SGUI_FONT_MONO: FontFamilyId = 1;

export const SGUI_FONT_FLAG_ITALIC = 1;
export const SGUI_FONT_FLAG_UNDERLINE = 2;
export const SGUI_FONT_FLAG_STRIKETHROUGH = 4;

export const SGUI_CURSOR_ARROW: CursorKindId = 0;
export const SGUI_CURSOR_IBEAM: CursorKindId = 1;
export const SGUI_CURSOR_POINTER: CursorKindId = 2;
export const SGUI_CURSOR_RESIZE_EW: CursorKindId = 3;
export const SGUI_CURSOR_RESIZE_NS: CursorKindId = 4;

export const SGUI_MOD_SHIFT = 1;
export const SGUI_MOD_CTRL = 2;
export const SGUI_MOD_ALT = 4;
export const SGUI_MOD_SUPER = 8;

export const SGUI_CMD_CLEAR = 1;
export const SGUI_CMD_FILL_RECT = 2;
export const SGUI_CMD_STROKE_RECT = 3;
export const SGUI_CMD_PUSH_CLIP = 4;
export const SGUI_CMD_POP_CLIP = 5;
export const SGUI_CMD_DRAW_TEXT = 6;
export const SGUI_CMD_DRAW_LINE = 7;
export const SGUI_CMD_DRAW_IMAGE_RGBA = 8;
export const SGUI_CMD_FILL_RECT_CORNERS = 9;
export const SGUI_CMD_STROKE_RECT_CORNERS = 10;

export const SGUI_WINDOW_METRICS_SIZE = 48;
export const SGUI_TEXT_METRICS_SIZE = 36;

export const SGUI_EVT_CLOSE = 1;
export const SGUI_EVT_RESIZE = 2;
export const SGUI_EVT_FOCUS = 3;
export const SGUI_EVT_POINTER = 4;
export const SGUI_EVT_SCROLL = 5;
export const SGUI_EVT_KEY = 6;
export const SGUI_EVT_TEXT = 7;
export const SGUI_EVT_IME_PREEDIT = 8;
export const SGUI_EVT_MENU = 9;
export const SGUI_EVT_A11Y_ACTION = 10;

export const SGUI_A11Y_ROLE_GROUP = 0;
export const SGUI_A11Y_ROLE_BUTTON = 1;
export const SGUI_A11Y_ROLE_TEXT_FIELD = 2;
export const SGUI_A11Y_ROLE_TEXT_AREA = 3;
export const SGUI_A11Y_ROLE_CHECKBOX = 4;
export const SGUI_A11Y_ROLE_SLIDER = 5;
export const SGUI_A11Y_ROLE_RADIO_GROUP = 6;
export const SGUI_A11Y_ROLE_LIST = 7;
export const SGUI_A11Y_ROLE_STATIC_TEXT = 8;

export const SGUI_A11Y_STATE_ENABLED = 1;
export const SGUI_A11Y_STATE_FOCUSED = 2;
export const SGUI_A11Y_STATE_CHECKED = 4;
export const SGUI_A11Y_STATE_SELECTED = 8;

export const SGUI_A11Y_ACT_PRESS = 1;
export const SGUI_A11Y_ACT_FOCUS = 2;
export const SGUI_A11Y_ACT_SET_VALUE = 3;
export const SGUI_A11Y_ACT_INCREMENT = 4;
export const SGUI_A11Y_ACT_DECREMENT = 5;

export const SGUI_POINTER_MOVE = 0;
export const SGUI_POINTER_DOWN = 1;
export const SGUI_POINTER_UP = 2;
export const SGUI_POINTER_DRAG = 3;
export const SGUI_POINTER_LEAVE = 4;

export const SGUI_BUTTON_NONE = 0;
export const SGUI_BUTTON_LEFT = 1;
export const SGUI_BUTTON_MIDDLE = 2;
export const SGUI_BUTTON_RIGHT = 3;

export const SGUI_KEY_DOWN = 1;
export const SGUI_KEY_UP = 2;
export const SGUI_KEY_REPEAT = 3;

export const SGUI_MENU_ITEM_ACTION = 0;
export const SGUI_MENU_ITEM_SEPARATOR = 1;
export const SGUI_MENU_ITEM_SUBMENU = 2;

export const SGUI_MENU_FLAG_DISABLED = 1;
export const SGUI_MENU_FLAG_CHECKED = 2;

export const SGUI_MENU_ROLE_NONE = 0;
export const SGUI_MENU_ROLE_ABOUT = 1;
export const SGUI_MENU_ROLE_HIDE = 2;
export const SGUI_MENU_ROLE_QUIT = 3;
export const SGUI_MENU_ROLE_UNDO = 4;
export const SGUI_MENU_ROLE_REDO = 5;
export const SGUI_MENU_ROLE_CUT = 6;
export const SGUI_MENU_ROLE_COPY = 7;
export const SGUI_MENU_ROLE_PASTE = 8;
export const SGUI_MENU_ROLE_SELECT_ALL = 9;
export const SGUI_MENU_ROLE_MINIMIZE = 10;
export const SGUI_MENU_ROLE_ZOOM = 11;
export const SGUI_MENU_ROLE_CLOSE = 12;
export const SGUI_MENU_ROLE_FULLSCREEN = 13;

export type MenuRole =
	| "none"
	| "about"
	| "quit"
	| "hide"
	| "hideOthers"
	| "showAll"
	| "undo"
	| "redo"
	| "cut"
	| "copy"
	| "paste"
	| "selectAll"
	| "minimize"
	| "zoom"
	| "close"
	| "fullscreen";

export type A11yRole =
	| "group"
	| "button"
	| "textField"
	| "textArea"
	| "checkbox"
	| "slider"
	| "radioGroup"
	| "list"
	| "staticText";

export type A11yActionKind = "press" | "focus" | "setValue" | "increment" | "decrement";

export interface GuiA11yRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface GuiA11yNode {
	readonly id: number;
	readonly role: A11yRole;
	readonly stateFlags: number;
	readonly rect: GuiA11yRect;
	readonly label: string;
	readonly value?: string;
}

export interface MenuActionItem {
	readonly kind: "action";
	readonly label: string;
	readonly shortcut?: string;
	readonly disabled?: boolean;
	readonly checked?: boolean;
	readonly role?: MenuRole;
	readonly onSelect?: () => void;
}

export interface MenuSeparatorItem {
	readonly kind: "separator";
}

export interface MenuSubmenuItem {
	readonly kind: "submenu";
	readonly label: string;
	readonly disabled?: boolean;
	readonly items: readonly MenuItemSpec[];
}

export type MenuItemSpec = MenuActionItem | MenuSeparatorItem | MenuSubmenuItem;

export interface MenuSpec {
	readonly title: string;
	readonly items: readonly MenuItemSpec[];
}

export interface EncodedMenuSpec {
	readonly bytes: Uint8Array;
	readonly handlers: Map<number, () => void>;
}

export type DrawCommand =
	| { readonly kind: "clear"; readonly rgba: number }
	| {
			readonly kind: "fillRect";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly radius: number;
			readonly rgba: number;
	  }
	| {
			readonly kind: "strokeRect";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly radius: number;
			readonly strokeWidth: number;
			readonly rgba: number;
	  }
	| {
			readonly kind: "pushClip";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
	  }
	| { readonly kind: "popClip" }
	| {
			readonly kind: "drawText";
			readonly x: number;
			readonly y: number;
			readonly maxWidth: number;
			readonly fontSize: number;
			readonly rgba: number;
			readonly fontFamily: number;
			readonly fontWeight: number;
			readonly fontFlags: number;
			readonly text: string;
	  }
	| {
			readonly kind: "drawLine";
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly strokeWidth: number;
			readonly rgba: number;
	  }
	| {
			readonly kind: "drawImageRgba";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly radius: number;
			readonly pxW: number;
			readonly pxH: number;
			readonly pixels: Uint8Array;
	  }
	| {
			readonly kind: "fillRectCorners";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly tl: number;
			readonly tr: number;
			readonly br: number;
			readonly bl: number;
			readonly rgba: number;
	  }
	| {
			readonly kind: "strokeRectCorners";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly tl: number;
			readonly tr: number;
			readonly br: number;
			readonly bl: number;
			readonly strokeWidth: number;
			readonly rgba: number;
	  };

export type GuiNativeEvent =
	| { readonly kind: "close"; readonly windowId: number; readonly modifiers: number }
	| {
			readonly kind: "resize";
			readonly windowId: number;
			readonly modifiers: number;
			readonly width: number;
			readonly height: number;
			readonly scale: number;
	  }
	| {
			readonly kind: "focus";
			readonly windowId: number;
			readonly modifiers: number;
			readonly focused: boolean;
			readonly darkMode: boolean;
	  }
	| {
			readonly kind: "pointer";
			readonly windowId: number;
			readonly modifiers: number;
			readonly phase: "move" | "down" | "up" | "drag" | "leave";
			readonly button: "none" | "left" | "middle" | "right";
			readonly clickCount: number;
			readonly x: number;
			readonly y: number;
	  }
	| {
			readonly kind: "scroll";
			readonly windowId: number;
			readonly modifiers: number;
			readonly x: number;
			readonly y: number;
			readonly deltaX: number;
			readonly deltaY: number;
	  }
	| {
			readonly kind: "key";
			readonly windowId: number;
			readonly modifiers: number;
			readonly phase: "down" | "up" | "repeat";
			readonly keyCode: number;
			readonly name: string;
	  }
	| { readonly kind: "text"; readonly windowId: number; readonly modifiers: number; readonly text: string }
	| {
			readonly kind: "imePreedit";
			readonly windowId: number;
			readonly modifiers: number;
			readonly cursorStart: number;
			readonly cursorEnd: number;
			readonly text: string;
	  }
	| { readonly kind: "menu"; readonly windowId: number; readonly modifiers: number; readonly itemId: number }
	| {
			readonly kind: "a11yAction";
			readonly windowId: number;
			readonly modifiers: number;
			readonly nodeId: number;
			readonly action: A11yActionKind;
			readonly value: string;
	  };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function align8(value: number): number {
	return (value + 7) & ~7;
}

class ByteBufferBuilder {
	private buf: Uint8Array;
	private view: DataView;
	private length: number;

	constructor(initialCapacity = 4096) {
		this.buf = new Uint8Array(initialCapacity);
		this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
		this.length = 0;
	}

	reset(): void {
		this.length = 0;
	}

	ensure(additionalBytes: number): number {
		const required = this.length + additionalBytes;
		if (required <= this.buf.byteLength) {
			const start = this.length;
			this.length = required;
			return start;
		}
		let nextCap = this.buf.byteLength * 2;
		while (nextCap < required) {
			nextCap *= 2;
		}
		const grown = new Uint8Array(nextCap);
		grown.set(this.buf.subarray(0, this.length), 0);
		this.buf = grown;
		this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
		const start = this.length;
		this.length = required;
		return start;
	}

	writeU32At(offset: number, value: number): void {
		this.view.setUint32(offset, value >>> 0, true);
	}

	writeU16At(offset: number, value: number): void {
		this.view.setUint16(offset, value & 0xffff, true);
	}

	writeF64At(offset: number, value: number): void {
		this.view.setFloat64(offset, value, true);
	}

	writeBytesAt(offset: number, src: Uint8Array): void {
		this.buf.set(src, offset);
	}

	zeroRange(offset: number, count: number): void {
		this.buf.fill(0, offset, offset + count);
	}

	pushU32(value: number): void {
		const offset = this.ensure(4);
		this.view.setUint32(offset, value >>> 0, true);
	}

	pushF64(value: number): void {
		const offset = this.ensure(8);
		this.view.setFloat64(offset, value, true);
	}

	pushLenString(str: string): void {
		const utf8 = textEncoder.encode(str);
		const offset = this.ensure(4 + utf8.byteLength);
		this.view.setUint32(offset, utf8.byteLength >>> 0, true);
		if (utf8.byteLength > 0) {
			this.buf.set(utf8, offset + 4);
		}
	}

	subarray(): Uint8Array {
		return this.buf.subarray(0, this.length);
	}

	toUint8Array(): Uint8Array {
		return this.buf.slice(0, this.length);
	}
}

export class DrawCommandWriter {
	private readonly writer: ByteBufferBuilder;

	constructor(initialCapacity = 8192) {
		this.writer = new ByteBufferBuilder(initialCapacity);
	}

	reset(): void {
		this.writer.reset();
	}

	clear(rgba: number): void {
		const o = this.writer.ensure(16);
		this.writer.writeU32At(o, SGUI_CMD_CLEAR);
		this.writer.writeU32At(o + 4, 16);
		this.writer.writeU32At(o + 8, rgba);
		this.writer.writeU32At(o + 12, 0);
	}

	fillRect(x: number, y: number, w: number, h: number, radius: number, rgba: number): void {
		const o = this.writer.ensure(56);
		this.writer.writeU32At(o, SGUI_CMD_FILL_RECT);
		this.writer.writeU32At(o + 4, 56);
		this.writer.writeF64At(o + 8, x);
		this.writer.writeF64At(o + 16, y);
		this.writer.writeF64At(o + 24, w);
		this.writer.writeF64At(o + 32, h);
		this.writer.writeF64At(o + 40, radius);
		this.writer.writeU32At(o + 48, rgba);
		this.writer.writeU32At(o + 52, 0);
	}

	strokeRect(x: number, y: number, w: number, h: number, radius: number, strokeWidth: number, rgba: number): void {
		const o = this.writer.ensure(64);
		this.writer.writeU32At(o, SGUI_CMD_STROKE_RECT);
		this.writer.writeU32At(o + 4, 64);
		this.writer.writeF64At(o + 8, x);
		this.writer.writeF64At(o + 16, y);
		this.writer.writeF64At(o + 24, w);
		this.writer.writeF64At(o + 32, h);
		this.writer.writeF64At(o + 40, radius);
		this.writer.writeF64At(o + 48, strokeWidth);
		this.writer.writeU32At(o + 56, rgba);
		this.writer.writeU32At(o + 60, 0);
	}

	fillRectCorners(
		x: number,
		y: number,
		w: number,
		h: number,
		tl: number,
		tr: number,
		br: number,
		bl: number,
		rgba: number,
	): void {
		const o = this.writer.ensure(80);
		this.writer.writeU32At(o, SGUI_CMD_FILL_RECT_CORNERS);
		this.writer.writeU32At(o + 4, 80);
		this.writer.writeF64At(o + 8, x);
		this.writer.writeF64At(o + 16, y);
		this.writer.writeF64At(o + 24, w);
		this.writer.writeF64At(o + 32, h);
		this.writer.writeF64At(o + 40, tl);
		this.writer.writeF64At(o + 48, tr);
		this.writer.writeF64At(o + 56, br);
		this.writer.writeF64At(o + 64, bl);
		this.writer.writeU32At(o + 72, rgba);
		this.writer.writeU32At(o + 76, 0);
	}

	strokeRectCorners(
		x: number,
		y: number,
		w: number,
		h: number,
		tl: number,
		tr: number,
		br: number,
		bl: number,
		strokeWidth: number,
		rgba: number,
	): void {
		const o = this.writer.ensure(88);
		this.writer.writeU32At(o, SGUI_CMD_STROKE_RECT_CORNERS);
		this.writer.writeU32At(o + 4, 88);
		this.writer.writeF64At(o + 8, x);
		this.writer.writeF64At(o + 16, y);
		this.writer.writeF64At(o + 24, w);
		this.writer.writeF64At(o + 32, h);
		this.writer.writeF64At(o + 40, tl);
		this.writer.writeF64At(o + 48, tr);
		this.writer.writeF64At(o + 56, br);
		this.writer.writeF64At(o + 64, bl);
		this.writer.writeF64At(o + 72, strokeWidth);
		this.writer.writeU32At(o + 80, rgba);
		this.writer.writeU32At(o + 84, 0);
	}

	pushClip(x: number, y: number, w: number, h: number): void {
		const o = this.writer.ensure(40);
		this.writer.writeU32At(o, SGUI_CMD_PUSH_CLIP);
		this.writer.writeU32At(o + 4, 40);
		this.writer.writeF64At(o + 8, x);
		this.writer.writeF64At(o + 16, y);
		this.writer.writeF64At(o + 24, w);
		this.writer.writeF64At(o + 32, h);
	}

	popClip(): void {
		const o = this.writer.ensure(8);
		this.writer.writeU32At(o, SGUI_CMD_POP_CLIP);
		this.writer.writeU32At(o + 4, 8);
	}

	drawText(
		x: number,
		y: number,
		maxWidth: number,
		fontSize: number,
		rgba: number,
		fontFamily: FontFamilyId,
		fontWeight: number,
		fontFlags: number,
		text: string,
	): void {
		const utf8 = textEncoder.encode(text);
		const byteLen = align8(56 + utf8.byteLength);
		const o = this.writer.ensure(byteLen);
		this.writer.writeU32At(o, SGUI_CMD_DRAW_TEXT);
		this.writer.writeU32At(o + 4, byteLen);
		this.writer.writeF64At(o + 8, x);
		this.writer.writeF64At(o + 16, y);
		this.writer.writeF64At(o + 24, maxWidth);
		this.writer.writeF64At(o + 32, fontSize);
		this.writer.writeU32At(o + 40, rgba);
		this.writer.writeU16At(o + 44, fontFamily);
		this.writer.writeU16At(o + 46, fontWeight);
		this.writer.writeU32At(o + 48, fontFlags);
		this.writer.writeU32At(o + 52, utf8.byteLength);
		if (utf8.byteLength > 0) {
			this.writer.writeBytesAt(o + 56, utf8);
		}
		const tail = byteLen - (56 + utf8.byteLength);
		if (tail > 0) {
			this.writer.zeroRange(o + 56 + utf8.byteLength, tail);
		}
	}

	drawLine(x1: number, y1: number, x2: number, y2: number, strokeWidth: number, rgba: number): void {
		const o = this.writer.ensure(56);
		this.writer.writeU32At(o, SGUI_CMD_DRAW_LINE);
		this.writer.writeU32At(o + 4, 56);
		this.writer.writeF64At(o + 8, x1);
		this.writer.writeF64At(o + 16, y1);
		this.writer.writeF64At(o + 24, x2);
		this.writer.writeF64At(o + 32, y2);
		this.writer.writeF64At(o + 40, strokeWidth);
		this.writer.writeU32At(o + 48, rgba);
		this.writer.writeU32At(o + 52, 0);
	}

	drawImageRgba(
		x: number,
		y: number,
		w: number,
		h: number,
		radius: number,
		pxW: number,
		pxH: number,
		pixels: Uint8Array,
	): void {
		const expectedBytes = pxW * pxH * 4;
		if (pixels.byteLength < expectedBytes) {
			throw new Error(`Expected at least ${expectedBytes} RGBA bytes, got ${pixels.byteLength}`);
		}
		const byteLen = align8(56 + expectedBytes);
		const o = this.writer.ensure(byteLen);
		this.writer.writeU32At(o, SGUI_CMD_DRAW_IMAGE_RGBA);
		this.writer.writeU32At(o + 4, byteLen);
		this.writer.writeF64At(o + 8, x);
		this.writer.writeF64At(o + 16, y);
		this.writer.writeF64At(o + 24, w);
		this.writer.writeF64At(o + 32, h);
		this.writer.writeF64At(o + 40, radius);
		this.writer.writeU32At(o + 48, pxW);
		this.writer.writeU32At(o + 52, pxH);
		if (expectedBytes > 0) {
			this.writer.writeBytesAt(o + 56, pixels.subarray(0, expectedBytes));
		}
		const tail = byteLen - (56 + expectedBytes);
		if (tail > 0) {
			this.writer.zeroRange(o + 56 + expectedBytes, tail);
		}
	}

	finish(): Uint8Array {
		return this.writer.subarray();
	}

	toUint8Array(): Uint8Array {
		return this.writer.toUint8Array();
	}
}

export function decodeDrawCommands(bytes: Uint8Array): DrawCommand[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: DrawCommand[] = [];
	let offset = 0;

	while (offset + 8 <= bytes.byteLength) {
		const op = view.getUint32(offset, true);
		const byteLen = view.getUint32(offset + 4, true);
		if (byteLen < 8 || offset + byteLen > bytes.byteLength) {
			break;
		}
		switch (op) {
			case SGUI_CMD_CLEAR:
				out.push({ kind: "clear", rgba: view.getUint32(offset + 8, true) });
				break;
			case SGUI_CMD_FILL_RECT:
				out.push({
					kind: "fillRect",
					x: view.getFloat64(offset + 8, true),
					y: view.getFloat64(offset + 16, true),
					w: view.getFloat64(offset + 24, true),
					h: view.getFloat64(offset + 32, true),
					radius: view.getFloat64(offset + 40, true),
					rgba: view.getUint32(offset + 48, true),
				});
				break;
			case SGUI_CMD_STROKE_RECT:
				out.push({
					kind: "strokeRect",
					x: view.getFloat64(offset + 8, true),
					y: view.getFloat64(offset + 16, true),
					w: view.getFloat64(offset + 24, true),
					h: view.getFloat64(offset + 32, true),
					radius: view.getFloat64(offset + 40, true),
					strokeWidth: view.getFloat64(offset + 48, true),
					rgba: view.getUint32(offset + 56, true),
				});
				break;
			case SGUI_CMD_FILL_RECT_CORNERS:
				out.push({
					kind: "fillRectCorners",
					x: view.getFloat64(offset + 8, true),
					y: view.getFloat64(offset + 16, true),
					w: view.getFloat64(offset + 24, true),
					h: view.getFloat64(offset + 32, true),
					tl: view.getFloat64(offset + 40, true),
					tr: view.getFloat64(offset + 48, true),
					br: view.getFloat64(offset + 56, true),
					bl: view.getFloat64(offset + 64, true),
					rgba: view.getUint32(offset + 72, true),
				});
				break;
			case SGUI_CMD_STROKE_RECT_CORNERS:
				out.push({
					kind: "strokeRectCorners",
					x: view.getFloat64(offset + 8, true),
					y: view.getFloat64(offset + 16, true),
					w: view.getFloat64(offset + 24, true),
					h: view.getFloat64(offset + 32, true),
					tl: view.getFloat64(offset + 40, true),
					tr: view.getFloat64(offset + 48, true),
					br: view.getFloat64(offset + 56, true),
					bl: view.getFloat64(offset + 64, true),
					strokeWidth: view.getFloat64(offset + 72, true),
					rgba: view.getUint32(offset + 80, true),
				});
				break;
			case SGUI_CMD_PUSH_CLIP:
				out.push({
					kind: "pushClip",
					x: view.getFloat64(offset + 8, true),
					y: view.getFloat64(offset + 16, true),
					w: view.getFloat64(offset + 24, true),
					h: view.getFloat64(offset + 32, true),
				});
				break;
			case SGUI_CMD_POP_CLIP:
				out.push({ kind: "popClip" });
				break;
			case SGUI_CMD_DRAW_TEXT: {
				const utf8Len = view.getUint32(offset + 52, true);
				const text = textDecoder.decode(bytes.subarray(offset + 56, offset + 56 + utf8Len));
				out.push({
					kind: "drawText",
					x: view.getFloat64(offset + 8, true),
					y: view.getFloat64(offset + 16, true),
					maxWidth: view.getFloat64(offset + 24, true),
					fontSize: view.getFloat64(offset + 32, true),
					rgba: view.getUint32(offset + 40, true),
					fontFamily: view.getUint16(offset + 44, true),
					fontWeight: view.getUint16(offset + 46, true),
					fontFlags: view.getUint32(offset + 48, true),
					text,
				});
				break;
			}
			case SGUI_CMD_DRAW_LINE:
				out.push({
					kind: "drawLine",
					x1: view.getFloat64(offset + 8, true),
					y1: view.getFloat64(offset + 16, true),
					x2: view.getFloat64(offset + 24, true),
					y2: view.getFloat64(offset + 32, true),
					strokeWidth: view.getFloat64(offset + 40, true),
					rgba: view.getUint32(offset + 48, true),
				});
				break;
			case SGUI_CMD_DRAW_IMAGE_RGBA: {
				const pxW = view.getUint32(offset + 48, true);
				const pxH = view.getUint32(offset + 52, true);
				const pixelLen = pxW * pxH * 4;
				out.push({
					kind: "drawImageRgba",
					x: view.getFloat64(offset + 8, true),
					y: view.getFloat64(offset + 16, true),
					w: view.getFloat64(offset + 24, true),
					h: view.getFloat64(offset + 32, true),
					radius: view.getFloat64(offset + 40, true),
					pxW,
					pxH,
					pixels: bytes.slice(offset + 56, offset + 56 + pixelLen),
				});
				break;
			}
		}
		offset += byteLen;
	}
	return out;
}

function decodePointerPhase(code: number): "move" | "down" | "up" | "drag" | "leave" {
	switch (code) {
		case SGUI_POINTER_DOWN:
			return "down";
		case SGUI_POINTER_UP:
			return "up";
		case SGUI_POINTER_DRAG:
			return "drag";
		case SGUI_POINTER_LEAVE:
			return "leave";
		default:
			return "move";
	}
}

function decodeButton(code: number): "none" | "left" | "middle" | "right" {
	switch (code) {
		case SGUI_BUTTON_LEFT:
			return "left";
		case SGUI_BUTTON_MIDDLE:
			return "middle";
		case SGUI_BUTTON_RIGHT:
			return "right";
		default:
			return "none";
	}
}

function decodeKeyPhase(code: number): "down" | "up" | "repeat" {
	switch (code) {
		case SGUI_KEY_UP:
			return "up";
		case SGUI_KEY_REPEAT:
			return "repeat";
		default:
			return "down";
	}
}

export function decodeEvents(bytes: Uint8Array, byteLength: number): GuiNativeEvent[] {
	const limit = Math.min(byteLength, bytes.byteLength);
	const view = new DataView(bytes.buffer, bytes.byteOffset, limit);
	const out: GuiNativeEvent[] = [];
	let offset = 0;

	while (offset + 16 <= limit) {
		const kind = view.getUint32(offset, true);
		const recordLen = view.getUint32(offset + 4, true);
		const windowId = view.getUint32(offset + 8, true);
		const modifiers = view.getUint32(offset + 12, true);
		if (recordLen < 16 || offset + recordLen > limit) {
			break;
		}
		switch (kind) {
			case SGUI_EVT_CLOSE:
				out.push({ kind: "close", windowId, modifiers });
				break;
			case SGUI_EVT_RESIZE:
				out.push({
					kind: "resize",
					windowId,
					modifiers,
					width: view.getFloat64(offset + 16, true),
					height: view.getFloat64(offset + 24, true),
					scale: view.getFloat64(offset + 32, true),
				});
				break;
			case SGUI_EVT_FOCUS:
				out.push({
					kind: "focus",
					windowId,
					modifiers,
					focused: view.getUint32(offset + 16, true) !== 0,
					darkMode: view.getUint32(offset + 20, true) !== 0,
				});
				break;
			case SGUI_EVT_POINTER:
				out.push({
					kind: "pointer",
					windowId,
					modifiers,
					phase: decodePointerPhase(view.getUint32(offset + 16, true)),
					button: decodeButton(view.getUint32(offset + 20, true)),
					clickCount: view.getUint32(offset + 24, true),
					x: view.getFloat64(offset + 32, true),
					y: view.getFloat64(offset + 40, true),
				});
				break;
			case SGUI_EVT_SCROLL:
				out.push({
					kind: "scroll",
					windowId,
					modifiers,
					x: view.getFloat64(offset + 16, true),
					y: view.getFloat64(offset + 24, true),
					deltaX: view.getFloat64(offset + 32, true),
					deltaY: view.getFloat64(offset + 40, true),
				});
				break;
			case SGUI_EVT_KEY: {
				const phase = decodeKeyPhase(view.getUint32(offset + 16, true));
				const keyCode = view.getUint32(offset + 20, true);
				const nameLen = view.getUint32(offset + 24, true);
				const name = textDecoder.decode(bytes.subarray(offset + 32, offset + 32 + nameLen));
				out.push({ kind: "key", windowId, modifiers, phase, keyCode, name });
				break;
			}
			case SGUI_EVT_TEXT: {
				const utf8Len = view.getUint32(offset + 16, true);
				const text = textDecoder.decode(bytes.subarray(offset + 24, offset + 24 + utf8Len));
				out.push({ kind: "text", windowId, modifiers, text });
				break;
			}
			case SGUI_EVT_IME_PREEDIT: {
				const cursorStart = view.getUint32(offset + 16, true);
				const cursorEnd = view.getUint32(offset + 20, true);
				const utf8Len = view.getUint32(offset + 24, true);
				const text = textDecoder.decode(bytes.subarray(offset + 32, offset + 32 + utf8Len));
				out.push({ kind: "imePreedit", windowId, modifiers, cursorStart, cursorEnd, text });
				break;
			}
			case SGUI_EVT_MENU:
				out.push({
					kind: "menu",
					windowId,
					modifiers,
					itemId: view.getUint32(offset + 16, true),
				});
				break;
			case SGUI_EVT_A11Y_ACTION: {
				const nodeId = view.getUint32(offset + 16, true);
				const action = decodeA11yAction(view.getUint32(offset + 20, true));
				const utf8Len = view.getUint32(offset + 24, true);
				const value = utf8Len > 0 ? textDecoder.decode(bytes.subarray(offset + 32, offset + 32 + utf8Len)) : "";
				out.push({ kind: "a11yAction", windowId, modifiers, nodeId, action, value });
				break;
			}
		}
		offset += recordLen;
	}

	return out;
}

function decodeA11yAction(code: number): A11yActionKind {
	switch (code) {
		case SGUI_A11Y_ACT_FOCUS:
			return "focus";
		case SGUI_A11Y_ACT_SET_VALUE:
			return "setValue";
		case SGUI_A11Y_ACT_INCREMENT:
			return "increment";
		case SGUI_A11Y_ACT_DECREMENT:
			return "decrement";
		default:
			return "press";
	}
}

function a11yRoleToCode(role: A11yRole): number {
	switch (role) {
		case "button":
			return SGUI_A11Y_ROLE_BUTTON;
		case "textField":
			return SGUI_A11Y_ROLE_TEXT_FIELD;
		case "textArea":
			return SGUI_A11Y_ROLE_TEXT_AREA;
		case "checkbox":
			return SGUI_A11Y_ROLE_CHECKBOX;
		case "slider":
			return SGUI_A11Y_ROLE_SLIDER;
		case "radioGroup":
			return SGUI_A11Y_ROLE_RADIO_GROUP;
		case "list":
			return SGUI_A11Y_ROLE_LIST;
		case "staticText":
			return SGUI_A11Y_ROLE_STATIC_TEXT;
		default:
			return SGUI_A11Y_ROLE_GROUP;
	}
}

function a11yCodeToRole(code: number): A11yRole {
	switch (code) {
		case SGUI_A11Y_ROLE_BUTTON:
			return "button";
		case SGUI_A11Y_ROLE_TEXT_FIELD:
			return "textField";
		case SGUI_A11Y_ROLE_TEXT_AREA:
			return "textArea";
		case SGUI_A11Y_ROLE_CHECKBOX:
			return "checkbox";
		case SGUI_A11Y_ROLE_SLIDER:
			return "slider";
		case SGUI_A11Y_ROLE_RADIO_GROUP:
			return "radioGroup";
		case SGUI_A11Y_ROLE_LIST:
			return "list";
		case SGUI_A11Y_ROLE_STATIC_TEXT:
			return "staticText";
		default:
			return "group";
	}
}

export function encodeA11yTree(nodes: readonly GuiA11yNode[]): Uint8Array {
	const writer = new ByteBufferBuilder(Math.max(256, nodes.length * 96));
	writer.pushU32(nodes.length);
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (node === undefined) continue;
		writer.pushU32(node.id);
		writer.pushU32(a11yRoleToCode(node.role));
		writer.pushU32(node.stateFlags);
		writer.pushF64(node.rect.x);
		writer.pushF64(node.rect.y);
		writer.pushF64(node.rect.width);
		writer.pushF64(node.rect.height);
		writer.pushLenString(node.label);
		writer.pushLenString(node.value ?? "");
	}
	return writer.toUint8Array();
}

export function decodeA11yTree(bytes: Uint8Array): GuiA11yNode[] {
	if (bytes.byteLength < 4) {
		return [];
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint32(0, true);
	const out: GuiA11yNode[] = [];
	let pos = 4;

	for (let i = 0; i < count; i++) {
		if (pos + 44 > bytes.byteLength) break;
		const id = view.getUint32(pos, true);
		const roleCode = view.getUint32(pos + 4, true);
		const stateFlags = view.getUint32(pos + 8, true);
		const x = view.getFloat64(pos + 12, true);
		const y = view.getFloat64(pos + 20, true);
		const width = view.getFloat64(pos + 28, true);
		const height = view.getFloat64(pos + 36, true);
		pos += 44;

		if (pos + 4 > bytes.byteLength) break;
		const labelLen = view.getUint32(pos, true);
		pos += 4;
		if (pos + labelLen > bytes.byteLength) break;
		const label = textDecoder.decode(bytes.subarray(pos, pos + labelLen));
		pos += labelLen;

		if (pos + 4 > bytes.byteLength) break;
		const valueLen = view.getUint32(pos, true);
		pos += 4;
		if (pos + valueLen > bytes.byteLength) break;
		const value = textDecoder.decode(bytes.subarray(pos, pos + valueLen));
		pos += valueLen;

		out.push({
			id,
			role: a11yCodeToRole(roleCode),
			stateFlags,
			rect: { x, y, width, height },
			label,
			value,
		});
	}
	return out;
}

function menuRoleToCode(role: MenuRole | undefined): number {
	switch (role) {
		case "about":
			return SGUI_MENU_ROLE_ABOUT;
		case "quit":
			return SGUI_MENU_ROLE_QUIT;
		case "hide":
			return SGUI_MENU_ROLE_HIDE;
		case "undo":
			return SGUI_MENU_ROLE_UNDO;
		case "redo":
			return SGUI_MENU_ROLE_REDO;
		case "cut":
			return SGUI_MENU_ROLE_CUT;
		case "copy":
			return SGUI_MENU_ROLE_COPY;
		case "paste":
			return SGUI_MENU_ROLE_PASTE;
		case "selectAll":
			return SGUI_MENU_ROLE_SELECT_ALL;
		case "minimize":
			return SGUI_MENU_ROLE_MINIMIZE;
		case "zoom":
			return SGUI_MENU_ROLE_ZOOM;
		case "close":
			return SGUI_MENU_ROLE_CLOSE;
		case "fullscreen":
			return SGUI_MENU_ROLE_FULLSCREEN;
		default:
			return SGUI_MENU_ROLE_NONE;
	}
}

function writeMenuItems(
	writer: ByteBufferBuilder,
	items: readonly MenuItemSpec[],
	handlers: Map<number, () => void>,
	nextIdBox: { value: number },
): void {
	writer.pushU32(items.length);
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item === undefined) continue;
		if (item.kind === "separator") {
			writer.pushU32(SGUI_MENU_ITEM_SEPARATOR);
			writer.pushU32(0);
			writer.pushU32(0);
			writer.pushU32(SGUI_MENU_ROLE_NONE);
			writer.pushLenString("");
			writer.pushLenString("");
		} else if (item.kind === "submenu") {
			const flags = item.disabled ? SGUI_MENU_FLAG_DISABLED : 0;
			writer.pushU32(SGUI_MENU_ITEM_SUBMENU);
			writer.pushU32(0);
			writer.pushU32(flags);
			writer.pushU32(SGUI_MENU_ROLE_NONE);
			writer.pushLenString(item.label);
			writer.pushLenString("");
			writeMenuItems(writer, item.items, handlers, nextIdBox);
		} else {
			const itemId = nextIdBox.value;
			nextIdBox.value += 1;
			if (item.onSelect !== undefined) {
				handlers.set(itemId, item.onSelect);
			}
			let flags = 0;
			if (item.disabled) flags |= SGUI_MENU_FLAG_DISABLED;
			if (item.checked) flags |= SGUI_MENU_FLAG_CHECKED;
			writer.pushU32(SGUI_MENU_ITEM_ACTION);
			writer.pushU32(itemId);
			writer.pushU32(flags);
			writer.pushU32(menuRoleToCode(item.role));
			writer.pushLenString(item.label);
			writer.pushLenString(item.shortcut ?? "");
		}
	}
}

export function encodeMenuSpec(menus: readonly MenuSpec[]): EncodedMenuSpec {
	const writer = new ByteBufferBuilder(1024);
	const handlers = new Map<number, () => void>();
	const nextIdBox = { value: 1 };
	writer.pushU32(menus.length);
	for (let i = 0; i < menus.length; i++) {
		const menu = menus[i];
		if (menu === undefined) continue;
		writer.pushLenString(menu.title);
		writeMenuItems(writer, menu.items, handlers, nextIdBox);
	}
	return { bytes: writer.toUint8Array(), handlers };
}
