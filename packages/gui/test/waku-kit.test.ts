import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	Box,
	colorToHex,
	DARK_THEME,
	darkGuiTheme,
	decodeDrawCommands,
	DrawCommandWriter,
	Editor,
	GuiApp,
	GuiHost,
	GuiRenderContext,
	HeadlessBackend,
	HStack,
	IconButton,
	KeybindingsManager,
	LIGHT_THEME,
	lightGuiTheme,
	Markdown,
	packRgba,
	resolveTheme,
	SGUI_CURSOR_POINTER,
	SGUI_CURSOR_RESIZE_EW,
	SGUI_MOD_CTRL,
	SGUI_MOD_SUPER,
	SGUI_WIN_ACTION_DRAG,
	SGUI_WIN_ACTION_MINIATURIZE,
	SGUI_WIN_ACTION_ZOOM,
	SplitResizeHandle,
	Text,
	tokenColorForKind,
	tokenizeCodeLines,
	VStack,
	WindowDragArea,
} from "../src/index.ts";
import { NativeBackend, NativeDriver } from "../src/native-backend.ts";

class RecordingNativeDriver extends NativeDriver {
	readonly chromeCalls: Array<{ windowId: number; darkMode: number; sidebarWidth: number; vibrancyEnabled: number }> =
		[];
	readonly actions: Array<{ windowId: number; action: number }> = [];

	init(): number {
		return 0;
	}
	shutdown(): void {}
	windowCreate(): number {
		return 1;
	}
	windowDestroy(): void {}
	windowSetTitle(): void {}
	windowSetChrome(windowId: number, darkMode: number, sidebarWidth: number, vibrancyEnabled: number): void {
		this.chromeCalls.push({ windowId, darkMode, sidebarWidth, vibrancyEnabled });
	}
	windowAction(windowId: number, action: number): void {
		this.actions.push({ windowId, action });
	}
	windowGetMetrics(_windowId: number, outMetrics: Uint8Array): number {
		const view = new DataView(outMetrics.buffer, outMetrics.byteOffset, outMetrics.byteLength);
		view.setFloat64(0, 1280, true);
		view.setFloat64(8, 800, true);
		view.setFloat64(16, 2, true);
		view.setFloat64(56, 28, true);
		view.setUint32(64, 1, true);
		view.setUint32(68, 1, true);
		return 0;
	}
	measureText(
		_fontFamily: number,
		_fontSize: number,
		_fontWeight: number,
		_fontFlags: number,
		_maxWidth: number,
		text: string,
		outMetrics: Uint8Array,
	): number {
		const view = new DataView(outMetrics.buffer, outMetrics.byteOffset, outMetrics.byteLength);
		view.setFloat64(0, text.length * 8, true);
		view.setFloat64(8, 18, true);
		view.setFloat64(16, 14, true);
		view.setFloat64(24, 18, true);
		return 0;
	}
	textCaretX(): number {
		return 0;
	}
	textHitIndex(): number {
		return 0;
	}
	present(): number {
		return 0;
	}
	pollEvents(): number {
		return 0;
	}
	clipboardGetText(): number {
		return 0;
	}
	clipboardSetText(): number {
		return 0;
	}
	setCursor(): void {}
	setImeRect(): void {}
	setAppMenu(): number {
		return 0;
	}
	setA11yTree(): number {
		return 0;
	}
}

describe("Waku theme tokens and palette resolution", () => {
	it("matches exact Waku Dark & Light Neutral Graphite + Coral palettes while keeping legacy fields", () => {
		assert.equal(DARK_THEME, darkGuiTheme);
		assert.equal(LIGHT_THEME, lightGuiTheme);
		assert.equal(resolveTheme("dark"), DARK_THEME);
		assert.equal(resolveTheme("light"), LIGHT_THEME);
		assert.equal(resolveTheme("system", false), LIGHT_THEME);
		assert.equal(resolveTheme("system", true), DARK_THEME);

		assert.equal(colorToHex(DARK_THEME.background), "#1a1a1a");
		assert.equal(colorToHex(DARK_THEME.sidebarBg), "#181818");
		assert.equal(colorToHex(DARK_THEME.surfaceRaised), "#232323");
		assert.equal(colorToHex(DARK_THEME.surfaceComposer), "#212121");
		assert.equal(colorToHex(DARK_THEME.codeBlockBg), "#151515");
		assert.equal(colorToHex(DARK_THEME.hover), "#2f2e2f");
		assert.equal(colorToHex(DARK_THEME.surfaceActive), "#2d2d2e");
		assert.equal(colorToHex(DARK_THEME.inputBg), "#4b4b4b");
		assert.equal(colorToHex(DARK_THEME.textPrimary), "#ecebed");
		assert.equal(colorToHex(DARK_THEME.textBright), "#f3f2f4");
		assert.equal(colorToHex(DARK_THEME.textSecondary), "#a0a0a0");
		assert.equal(colorToHex(DARK_THEME.textMuted), "#737272");
		assert.equal(colorToHex(DARK_THEME.accent), "#e2795b");
		assert.equal(colorToHex(DARK_THEME.diffAddText), "#86c798");
		assert.equal(colorToHex(DARK_THEME.diffAddBg), "#21372a");
		assert.equal(colorToHex(DARK_THEME.diffDelText), "#eb8074");
		assert.equal(colorToHex(DARK_THEME.diffDelBg), "#3b2424");
		assert.equal(colorToHex(DARK_THEME.warn), "#e4b65e");
		assert.equal(colorToHex(DARK_THEME.info), "#78b2df");

		assert.equal(colorToHex(LIGHT_THEME.background), "#f6f5f6");
		assert.equal(colorToHex(LIGHT_THEME.sidebarBg), "#f3f3f3");
		assert.equal(colorToHex(LIGHT_THEME.surfaceRaised), "#ececec");
		assert.equal(colorToHex(LIGHT_THEME.surfaceComposer), "#ffffff");
		assert.equal(colorToHex(LIGHT_THEME.codeBlockBg), "#f0f0f0");
		assert.equal(colorToHex(LIGHT_THEME.accent), "#c85f44");

		// Legacy aliases stay consistent for downstream callers
		assert.deepEqual(DARK_THEME.surface, DARK_THEME.sidebarBg);
		assert.deepEqual(DARK_THEME.text, DARK_THEME.textPrimary);
		assert.deepEqual(DARK_THEME.codeBackground, DARK_THEME.codeBlockBg);
	});
});

class NoopHost extends GuiHost {
	invalidate(): void {}
	requestFocus(): void {}
	isFocused(): boolean {
		return false;
	}
	isHovered(): boolean {
		return false;
	}
	getClipboardText(): string {
		return "";
	}
	setClipboardText(): void {}
	setImeRect(): void {}
	windowAction(): void {}
}

describe("Native & headless window chrome vibrancy and drag/zoom actions", () => {
	it("records setWindowChrome, windowAction, and unified titlebar height in HeadlessBackend & NativeBackend", () => {
		const headless = new HeadlessBackend({
			width: 900,
			height: 600,
			darkMode: true,
			platform: "darwin",
			titlebarHeight: 28,
		});
		const app = new GuiApp({
			backend: headless,
			window: { title: "Waku", width: 900, height: 600, unifiedTitlebar: true },
		});
		assert.equal(headless.getWindowMetrics(app.windowId).titlebarHeight, 28);

		app.setWindowChrome(true, 240, true);
		app.windowAction(SGUI_WIN_ACTION_DRAG);
		app.windowAction(SGUI_WIN_ACTION_ZOOM);
		app.windowAction(SGUI_WIN_ACTION_MINIATURIZE);

		assert.deepEqual(headless.getWindowChrome(app.windowId), {
			darkMode: true,
			sidebarWidth: 240,
			vibrancyEnabled: true,
		});
		assert.deepEqual(headless.getWindowActions(app.windowId), [
			SGUI_WIN_ACTION_DRAG,
			SGUI_WIN_ACTION_ZOOM,
			SGUI_WIN_ACTION_MINIATURIZE,
		]);
		app.dispose();

		const driver = new RecordingNativeDriver();
		const nativeBackend = new NativeBackend(driver, "darwin");
		nativeBackend.init();
		const winId = nativeBackend.createWindow({ title: "Native", width: 1280, height: 800 });
		nativeBackend.setWindowChrome(winId, true, 260, true);
		nativeBackend.windowAction(winId, SGUI_WIN_ACTION_DRAG);
		assert.deepEqual(driver.chromeCalls, [{ windowId: 1, darkMode: 1, sidebarWidth: 260, vibrancyEnabled: 1 }]);
		assert.deepEqual(driver.actions, [{ windowId: 1, action: SGUI_WIN_ACTION_DRAG }]);
		nativeBackend.shutdown();
	});
});

describe("Per-corner Box radii & wire protocol", () => {
	it("encodes/decodes fillRectCorners & strokeRectCorners and emits them from Box.cornerRadii", () => {
		const writer = new DrawCommandWriter();
		writer.fillRectCorners(10, 20, 120, 48, 12, 12, 4, 12, 0xffffffff);
		writer.strokeRectCorners(10, 20, 120, 48, 12, 12, 4, 12, 1, 0xff424242);
		const decoded = decodeDrawCommands(writer.finish());
		assert.equal(decoded.length, 2);
		assert.deepEqual(decoded[0], {
			kind: "fillRectCorners",
			x: 10,
			y: 20,
			w: 120,
			h: 48,
			tl: 12,
			tr: 12,
			br: 4,
			bl: 12,
			rgba: 0xffffffff,
		});
		assert.deepEqual(decoded[1], {
			kind: "strokeRectCorners",
			x: 10,
			y: 20,
			w: 120,
			h: 48,
			tl: 12,
			tr: 12,
			br: 4,
			bl: 12,
			strokeWidth: 1,
			rgba: 0xff424242,
		});

		const backend = new HeadlessBackend({ width: 400, height: 200 });
		const app = new GuiApp({ backend, window: { title: "Corners", width: 400, height: 200 } });
		const bubble = new Box({
			width: 180,
			padding: 10,
			background: DARK_THEME.surfaceRaised,
			borderColor: DARK_THEME.border,
			cornerRadii: { tl: 12, tr: 12, br: 4, bl: 12 },
			child: new Text("User bubble"),
		});
		app.setRoot(bubble);
		app.renderFrame();
		const cmds = backend.getLastFrameCommands();
		const fillCmd = cmds.find((c) => c.kind === "fillRectCorners");
		const strokeCmd = cmds.find((c) => c.kind === "strokeRectCorners");
		if (fillCmd === undefined || fillCmd.kind !== "fillRectCorners") {
			assert.fail("expected fillRectCorners draw command");
		}
		assert.equal(fillCmd.tl, 12);
		assert.equal(fillCmd.tr, 12);
		assert.equal(fillCmd.br, 4);
		assert.equal(fillCmd.bl, 12);
		if (strokeCmd === undefined || strokeCmd.kind !== "strokeRectCorners") {
			assert.fail("expected strokeRectCorners draw command");
		}
		assert.equal(strokeCmd.br, 4);
		app.dispose();
	});
});

describe("WindowDragArea, SplitResizeHandle, and IconButton", () => {
	it("triggers window drag on primary drag, zoom on double-click, and yields to child IconButton", () => {
		const backend = new HeadlessBackend({ width: 600, height: 120 });
		const app = new GuiApp({ backend, window: { title: "Titlebar", width: 600, height: 120 } });

		let toggleClicks = 0;
		let dragCount = 0;
		let zoomCount = 0;
		const toggleBtn = new IconButton({
			icon: "panel-left",
			label: "Toggle Sidebar",
			onClick: () => {
				toggleClicks += 1;
			},
		});
		const dragArea = new WindowDragArea({
			height: 44,
			dragThreshold: 4,
			onDragStart: () => {
				dragCount += 1;
			},
			onDoubleClick: () => {
				zoomCount += 1;
			},
			child: new HStack({
				padding: { top: 8, bottom: 8, left: 12, right: 12 },
				children: [toggleBtn],
			}),
		});
		app.setRoot(dragArea);
		app.renderFrame();

		// Interactive child button absorbs clicks and triggers zero window actions
		const br = toggleBtn.layoutRect;
		backend.click(br.x + br.width * 0.5, br.y + br.height * 0.5);
		app.step(0);
		assert.equal(toggleClicks, 1);
		assert.deepEqual(backend.getWindowActions(), []);

		// Simple click without drag > threshold triggers neither drag nor zoom
		const emptyX = br.x + br.width + 60;
		const emptyY = 20;
		backend.click(emptyX, emptyY);
		app.step(0);
		assert.equal(dragCount, 0);
		assert.deepEqual(backend.getWindowActions(), []);

		// Drag beyond threshold starts native window drag
		backend.pointerDown(emptyX, emptyY, "left", 1);
		backend.dragPointer(emptyX + 12, emptyY + 2, "left");
		backend.pointerUp(emptyX + 12, emptyY + 2, "left", 1);
		app.step(0);
		assert.equal(dragCount, 1);
		assert.equal(backend.getWindowActions()[0], SGUI_WIN_ACTION_DRAG);

		// Double-click triggers native window zoom
		backend.pointerDown(emptyX, emptyY, "left", 2);
		backend.pointerUp(emptyX, emptyY, "left", 2);
		app.step(0);
		assert.equal(zoomCount, 1);
		assert.equal(backend.getWindowActions()[1], SGUI_WIN_ACTION_ZOOM);
		app.dispose();
	});

	it("resizes panes cleanly within clamped minWidth..maxWidth and highlights divider line on hover", () => {
		const backend = new HeadlessBackend({ width: 800, height: 400 });
		const app = new GuiApp({ backend, window: { title: "Split", width: 800, height: 400 } });

		let sidebarWidth = 240;
		const handle = new SplitResizeHandle({
			width: 6,
			minWidth: 180,
			maxWidth: 360,
			direction: 1,
			getWidth: () => sidebarWidth,
			onResize: (w) => {
				sidebarWidth = w;
			},
		});
		app.setRoot(new HStack({ children: [new Box({ width: 240, height: 400 }), handle] }));
		app.renderFrame();

		// Divider resting color is border
		const restColor = packRgba(DARK_THEME.border);
		const accentColor = packRgba(DARK_THEME.accent);
		assert.ok(backend.getLastFrameCommands().some((c) => c.kind === "fillRect" && c.w === 1 && c.rgba === restColor));

		// Hover highlights hairline to accent and sets EW cursor
		const hr = handle.layoutRect;
		backend.movePointer(hr.x + 2, hr.y + 50);
		app.step(0);
		assert.equal(backend.getCursor(), SGUI_CURSOR_RESIZE_EW);
		assert.ok(backend.getLastFrameCommands().some((c) => c.kind === "fillRect" && c.w === 1 && c.rgba === accentColor));

		// Drag right beyond maxWidth -> clamps at 360; drag left beyond minWidth -> clamps at 180
		backend.pointerDown(hr.x + 2, hr.y + 50, "left", 1);
		backend.dragPointer(hr.x + 300, hr.y + 50, "left");
		app.step(0);
		assert.equal(sidebarWidth, 360);
		backend.dragPointer(hr.x - 300, hr.y + 50, "left");
		backend.pointerUp(hr.x - 300, hr.y + 50, "left", 1);
		app.step(0);
		assert.equal(sidebarWidth, 180);
		app.dispose();
	});
});

describe("Editor chromeless variant, auto-grow height, and onPaste hook", () => {
	it("omits border/fill in chromeless mode, computes bounded auto-grow height, and intercepts paste", () => {
		const backend = new HeadlessBackend({ width: 420, height: 300, platform: "darwin" });
		const app = new GuiApp({ backend, window: { title: "Composer", width: 420, height: 300 } });

		const intercepted: string[] = [];
		let blockPaste = true;
		const editor = new Editor({
			variant: "chromeless",
			minLines: 1,
			maxLines: 3,
			placeholder: "Ask anything...",
			onPaste: (text) => {
				intercepted.push(text);
				return blockPaste;
			},
		});
		app.setRoot(new Box({ width: 320, child: new VStack({ children: [editor] }) }));
		app.setFocus(editor);
		app.renderFrame();

		assert.equal(editor.getVariant(), "chromeless");
		const cmds = backend.getLastFrameCommands();
		assert.equal(cmds.some((c) => c.kind === "strokeRect"), false);

		// Auto-grow height grows up to maxLines = 3 and clamps beyond
		const ctx = new GuiRenderContext({
			backend,
			theme: DARK_THEME,
			keybindings: new KeybindingsManager(),
			writer: new DrawCommandWriter(),
			scale: 2,
			windowFocused: true,
			nowMs: 0,
			host: new NoopHost(),
		});
		const hMin = editor.measure(ctx, 280).height;
		assert.equal(editor.getVisualLineCount(ctx, 280), 1);

		// Intercepted Cmd+V suppresses insertion
		backend.setClipboardText("image-payload.png");
		backend.pressKey("v", SGUI_MOD_SUPER);
		app.step(0);
		assert.deepEqual(intercepted, ["image-payload.png"]);
		assert.equal(editor.getText(), "");

		// Falling through inserts clipboard text
		blockPaste = false;
		backend.setClipboardText("hello\nworld\nthree");
		backend.pressKey("v", SGUI_MOD_SUPER);
		app.step(0);
		assert.equal(editor.getText(), "hello\nworld\nthree");
		assert.equal(editor.getLineCount(), 3);
		const hThree = editor.measure(ctx, 280).height;
		assert.ok(hThree > hMin);

		editor.setText("a\nb\nc\nd\ne\nf");
		assert.equal(editor.getAutoGrowHeight(ctx, 280), hThree);
		assert.equal(editor.measure(ctx, 280).height, hThree);
		app.dispose();
	});

	it("also intercepts Ctrl+V on non-Darwin platforms", () => {
		const backend = new HeadlessBackend({ width: 400, height: 200, platform: "linux" });
		const app = new GuiApp({ backend, window: { title: "Linux Editor", width: 400, height: 200 } });
		let pasted = "";
		const editor = new Editor({
			onPaste: (text) => {
				pasted = text;
				return true;
			},
		});
		app.setRoot(editor);
		app.setFocus(editor);
		app.renderFrame();

		backend.setClipboardText("clipboard item");
		backend.pressKey("v", SGUI_MOD_CTRL);
		app.step(0);
		assert.equal(pasted, "clipboard item");
		assert.equal(editor.getText(), "");
		app.dispose();
	});
});

describe("Markdown Waku code blocks, syntax highlighting, Copy button, inline code wash, and search highlights", () => {
	it("tokenizes multi-language code blocks cleanly with distinct Waku token colors", () => {
		const tokens = tokenizeCodeLines("const answer = 42;\n// done", "ts");
		assert.equal(tokens.length, 2);
		assert.equal(tokens[0]?.[0]?.kind, "keyword");
		assert.equal(tokens[0]?.[0]?.text, "const");
		assert.ok(tokens[0]?.some((t) => t.kind === "number" && t.text === "42"));
		assert.equal(tokens[1]?.[0]?.kind, "comment");
		assert.notEqual(
			packRgba(tokenColorForKind("keyword", DARK_THEME)),
			packRgba(tokenColorForKind("number", DARK_THEME)),
		);
	});

	it("renders code block header + Copy button, inline codeWash, bold/italic contrast, and search highlight spans", () => {
		const backend = new HeadlessBackend({ width: 560, height: 420, darkMode: true });
		const app = new GuiApp({ backend, window: { title: "Markdown", width: 560, height: 420 } });

		const copiedEvents: Array<{ code: string; language: string }> = [];
		const md = new Markdown({
			padding: 12,
			searchQuery: "alpha",
			activeSearchMatch: 1,
			text: 'Find **alpha** and *italic* plus `alpha()` inline.\n\n```ts\nconst alpha = "beta"; // alpha\n```',
			onCopyCode: (code, language) => {
				copiedEvents.push({ code, language });
			},
		});
		app.setRoot(md);
		app.renderFrame();

		const cmds = backend.getLastFrameCommands();
		const codeBgColor = packRgba(DARK_THEME.codeBlockBg);
		const codeWashColor = packRgba(DARK_THEME.codeWash);
		const brightColor = packRgba(DARK_THEME.textBright);
		const secondaryColor = packRgba(DARK_THEME.textSecondary);
		const kwColor = packRgba(DARK_THEME.syntaxKeyword);
		const strColor = packRgba(DARK_THEME.syntaxString);
		const searchBg = packRgba(DARK_THEME.searchMatchBg);
		const activeSearchBg = packRgba(DARK_THEME.activeSearchMatchBg);

		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.rgba === codeBgColor));
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.rgba === codeWashColor));
		assert.ok(cmds.some((c) => c.kind === "drawText" && c.text === "alpha" && c.rgba === brightColor));
		assert.ok(cmds.some((c) => c.kind === "drawText" && c.text === "italic" && c.rgba === secondaryColor));
		assert.ok(cmds.some((c) => c.kind === "drawText" && c.text === "const" && c.rgba === kwColor));
		assert.ok(cmds.some((c) => c.kind === "drawText" && c.text === '"beta"' && c.rgba === strColor));
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.rgba === searchBg));
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.rgba === activeSearchBg));

		// Locate code block rect & click top-right Copy button (`originX + innerW - 30`, `by + 3`, `24x22`)
		const codeBox = cmds.find((c) => c.kind === "fillRect" && c.rgba === codeBgColor && c.h > 40);
		if (codeBox === undefined || codeBox.kind !== "fillRect") {
			assert.fail("expected code block fillRect command");
		}
		const copyBtnX = codeBox.x + codeBox.w - 18;
		const copyBtnY = codeBox.y + 14;
		backend.movePointer(copyBtnX, copyBtnY);
		app.step(0);
		assert.equal(backend.getCursor(), SGUI_CURSOR_POINTER);

		backend.click(copyBtnX, copyBtnY);
		app.step(0);
		assert.deepEqual(copiedEvents, [{ code: 'const alpha = "beta"; // alpha', language: "ts" }]);
		assert.equal(backend.getClipboardText(), 'const alpha = "beta"; // alpha');
		app.dispose();
	});
});
