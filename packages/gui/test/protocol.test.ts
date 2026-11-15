import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	align8,
	DrawCommandWriter,
	decodeDrawCommands,
	decodeEvents,
	encodeMenuSpec,
	type MenuSpec,
	packRgba,
	rgbaColor,
	SGUI_BUTTON_LEFT,
	SGUI_EVT_CLOSE,
	SGUI_EVT_FOCUS,
	SGUI_EVT_IME_PREEDIT,
	SGUI_EVT_KEY,
	SGUI_EVT_MENU,
	SGUI_EVT_POINTER,
	SGUI_EVT_RESIZE,
	SGUI_EVT_SCROLL,
	SGUI_EVT_TEXT,
	SGUI_FONT_FLAG_ITALIC,
	SGUI_FONT_FLAG_UNDERLINE,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
	SGUI_KEY_DOWN,
	SGUI_MOD_CTRL,
	SGUI_MOD_SHIFT,
	SGUI_MOD_SUPER,
	SGUI_POINTER_DOWN,
	utf8ToUtf16Offset,
	utf16ToUtf8Offset,
} from "../src/index.ts";

const encoder = new TextEncoder();

describe("DrawCommandWriter & decodeDrawCommands", () => {
	it("round-trips all 8 draw command kinds with 8-byte alignment and UTF-8 text", () => {
		const writer = new DrawCommandWriter(64);
		const clearRgba = packRgba(rgbaColor(20, 22, 26, 1));
		const rectRgba = packRgba(rgbaColor(76, 141, 255, 0.5));
		const lineRgba = packRgba(rgbaColor(255, 100, 50, 1));
		const text = "Hello \u4e16\u754c \ud83d\ude80";
		const imgPixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);

		writer.clear(clearRgba);
		writer.fillRect(10.5, 20.25, 120, 40, 8, rectRgba);
		writer.strokeRect(10.5, 20.25, 120, 40, 8, 2, lineRgba);
		writer.pushClip(0, 0, 500, 400);
		writer.drawText(
			16,
			28,
			300,
			14,
			clearRgba,
			SGUI_FONT_MONO,
			700,
			SGUI_FONT_FLAG_ITALIC | SGUI_FONT_FLAG_UNDERLINE,
			text,
		);
		writer.drawLine(1, 2, 99, 100, 1.5, lineRgba);
		writer.drawImageRgba(30, 40, 64, 32, 6, 2, 1, imgPixels);
		writer.popClip();

		const bytes = writer.toUint8Array();
		assert.equal(bytes.byteLength % 8, 0);
		assert.ok(bytes.byteLength > 64);

		const cmds = decodeDrawCommands(bytes);
		assert.equal(cmds.length, 8);
		assert.deepEqual(cmds[0], { kind: "clear", rgba: clearRgba });
		assert.deepEqual(cmds[1], { kind: "fillRect", x: 10.5, y: 20.25, w: 120, h: 40, radius: 8, rgba: rectRgba });
		assert.deepEqual(cmds[2], {
			kind: "strokeRect",
			x: 10.5,
			y: 20.25,
			w: 120,
			h: 40,
			radius: 8,
			strokeWidth: 2,
			rgba: lineRgba,
		});
		assert.deepEqual(cmds[3], { kind: "pushClip", x: 0, y: 0, w: 500, h: 400 });
		assert.deepEqual(cmds[4], {
			kind: "drawText",
			x: 16,
			y: 28,
			maxWidth: 300,
			fontSize: 14,
			rgba: clearRgba,
			fontFamily: SGUI_FONT_MONO,
			fontWeight: 700,
			fontFlags: SGUI_FONT_FLAG_ITALIC | SGUI_FONT_FLAG_UNDERLINE,
			text,
		});
		assert.deepEqual(cmds[5], { kind: "drawLine", x1: 1, y1: 2, x2: 99, y2: 100, strokeWidth: 1.5, rgba: lineRgba });
		assert.equal(cmds[6]?.kind, "drawImageRgba");
		if (cmds[6]?.kind === "drawImageRgba") {
			assert.equal(cmds[6].pxW, 2);
			assert.equal(cmds[6].pxH, 1);
			assert.deepEqual(cmds[6].pixels, imgPixels);
		}
		assert.deepEqual(cmds[7], { kind: "popClip" });

		writer.reset();
		writer.drawText(0, 0, 0, 12, clearRgba, SGUI_FONT_REGULAR, 400, 0, "second frame");
		const second = decodeDrawCommands(writer.finish());
		assert.equal(second.length, 1);
	});
});

describe("decodeEvents", () => {
	it("decodes binary records for all 9 event kinds", () => {
		const buf = new Uint8Array(512);
		const view = new DataView(buf.buffer);
		let off = 0;

		const writeHdr = (kind: number, len: number, win: number, mods: number): number => {
			view.setUint32(off, kind, true);
			view.setUint32(off + 4, len, true);
			view.setUint32(off + 8, win, true);
			view.setUint32(off + 12, mods, true);
			const start = off;
			off += len;
			return start;
		};

		writeHdr(SGUI_EVT_CLOSE, 16, 1, 0);

		const r = writeHdr(SGUI_EVT_RESIZE, 40, 1, 0);
		view.setFloat64(r + 16, 1280, true);
		view.setFloat64(r + 24, 800, true);
		view.setFloat64(r + 32, 2, true);

		const f = writeHdr(SGUI_EVT_FOCUS, 24, 1, 0);
		view.setUint32(f + 16, 1, true);
		view.setUint32(f + 20, 1, true);

		const p = writeHdr(SGUI_EVT_POINTER, 48, 1, SGUI_MOD_SHIFT);
		view.setUint32(p + 16, SGUI_POINTER_DOWN, true);
		view.setUint32(p + 20, SGUI_BUTTON_LEFT, true);
		view.setUint32(p + 24, 2, true);
		view.setFloat64(p + 32, 42.5, true);
		view.setFloat64(p + 40, 99.25, true);

		const sc = writeHdr(SGUI_EVT_SCROLL, 48, 1, SGUI_MOD_CTRL);
		view.setFloat64(sc + 16, 100, true);
		view.setFloat64(sc + 24, 200, true);
		view.setFloat64(sc + 32, -4, true);
		view.setFloat64(sc + 40, 36, true);

		const keyName = encoder.encode("enter");
		const keyLen = align8(32 + keyName.byteLength);
		const k = writeHdr(SGUI_EVT_KEY, keyLen, 1, SGUI_MOD_SUPER);
		view.setUint32(k + 16, SGUI_KEY_DOWN, true);
		view.setUint32(k + 20, 36, true);
		view.setUint32(k + 24, keyName.byteLength, true);
		buf.set(keyName, k + 32);

		const txtBytes = encoder.encode("\u3042");
		const txtLen = align8(24 + txtBytes.byteLength);
		const t = writeHdr(SGUI_EVT_TEXT, txtLen, 1, 0);
		view.setUint32(t + 16, txtBytes.byteLength, true);
		buf.set(txtBytes, t + 24);

		const preBytes = encoder.encode("ka");
		const preLen = align8(32 + preBytes.byteLength);
		const im = writeHdr(SGUI_EVT_IME_PREEDIT, preLen, 1, 0);
		view.setUint32(im + 16, 1, true);
		view.setUint32(im + 20, 2, true);
		view.setUint32(im + 24, preBytes.byteLength, true);
		buf.set(preBytes, im + 32);

		const mn = writeHdr(SGUI_EVT_MENU, 24, 1, 0);
		view.setUint32(mn + 16, 7, true);

		const events = decodeEvents(buf, off);
		assert.equal(events.length, 9);
		assert.deepEqual(events[0], { kind: "close", windowId: 1, modifiers: 0 });
		assert.deepEqual(events[1], { kind: "resize", windowId: 1, modifiers: 0, width: 1280, height: 800, scale: 2 });
		assert.deepEqual(events[2], { kind: "focus", windowId: 1, modifiers: 0, focused: true, darkMode: true });
		assert.deepEqual(events[3], {
			kind: "pointer",
			windowId: 1,
			modifiers: SGUI_MOD_SHIFT,
			phase: "down",
			button: "left",
			clickCount: 2,
			x: 42.5,
			y: 99.25,
		});
		assert.deepEqual(events[4], {
			kind: "scroll",
			windowId: 1,
			modifiers: SGUI_MOD_CTRL,
			x: 100,
			y: 200,
			deltaX: -4,
			deltaY: 36,
		});
		assert.deepEqual(events[5], {
			kind: "key",
			windowId: 1,
			modifiers: SGUI_MOD_SUPER,
			phase: "down",
			keyCode: 36,
			name: "enter",
		});
		assert.deepEqual(events[6], { kind: "text", windowId: 1, modifiers: 0, text: "\u3042" });
		assert.deepEqual(events[7], {
			kind: "imePreedit",
			windowId: 1,
			modifiers: 0,
			cursorStart: 1,
			cursorEnd: 2,
			text: "ka",
		});
		assert.deepEqual(events[8], { kind: "menu", windowId: 1, modifiers: 0, itemId: 7 });
	});
});

describe("encodeMenuSpec & UTF-8 offset helpers", () => {
	it("assigns sequential itemIds and preserves handlers across submenus", () => {
		const calls: string[] = [];
		const menus: readonly MenuSpec[] = [
			{
				title: "File",
				items: [
					{ kind: "action", label: "New", shortcut: "mod+n", onSelect: () => calls.push("new") },
					{ kind: "separator" },
					{
						kind: "submenu",
						label: "Recent",
						items: [{ kind: "action", label: "Doc A", checked: true, onSelect: () => calls.push("docA") }],
					},
				],
			},
		];
		const encoded = encodeMenuSpec(menus);
		assert.ok(encoded.bytes.byteLength > 20);
		assert.equal(encoded.handlers.size, 2);
		encoded.handlers.get(1)?.();
		encoded.handlers.get(2)?.();
		assert.deepEqual(calls, ["new", "docA"]);
	});

	it("converts UTF-16 code unit indices to UTF-8 byte offsets and back cleanly", () => {
		const sample = "a\u00e9\u4e2d\ud83d\ude80z";
		for (let i = 0; i <= sample.length; i++) {
			// Skip middle of surrogate pair
			if (i === 4) continue;
			const utf8Off = utf16ToUtf8Offset(sample, i);
			const roundTrip = utf8ToUtf16Offset(sample, utf8Off);
			assert.equal(roundTrip, i);
		}
		assert.equal(utf16ToUtf8Offset(sample, 1), 1);
		assert.equal(utf16ToUtf8Offset(sample, 2), 3);
		assert.equal(utf16ToUtf8Offset(sample, 3), 6);
		assert.equal(utf16ToUtf8Offset(sample, 5), 10);
		assert.equal(utf16ToUtf8Offset(sample, 6), 11);
	});
});
