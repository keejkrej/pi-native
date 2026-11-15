import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CombinedAutocompleteProvider,
	Editor,
	GuiApp,
	HeadlessBackend,
	Input,
	KeybindingsManager,
	SGUI_MOD_ALT,
	SGUI_MOD_CTRL,
	SGUI_MOD_SHIFT,
	SGUI_MOD_SUPER,
	VStack,
} from "../src/index.ts";

describe("Input component", () => {
	it("supports typing, caret placement, selection, copy/cut/paste, undo/redo, kill ring, and IME", () => {
		const backend = new HeadlessBackend({ width: 500, height: 200, platform: "darwin" });
		const app = new GuiApp({ backend, window: { title: "Input", width: 500, height: 200 } });

		let submitted = "";
		const input = new Input({
			placeholder: "Type here",
			onSubmit: (v) => {
				submitted = v;
			},
		});
		app.setRoot(new VStack({ padding: 12, children: [input] }));
		app.setFocus(input);
		app.renderFrame();

		backend.insertText("hello world");
		app.step(0);
		assert.equal(input.getValue(), "hello world");

		// Select all + copy
		backend.pressKey("a", SGUI_MOD_SUPER);
		backend.pressKey("c", SGUI_MOD_SUPER);
		app.step(0);
		assert.equal(backend.getClipboardText(), "hello world");

		// Kill word backward -> kill ring -> yank
		backend.pressKey("right");
		backend.pressKey("backspace", SGUI_MOD_ALT);
		app.step(0);
		assert.equal(input.getValue(), "hello ");

		backend.pressKey("y", SGUI_MOD_CTRL);
		app.step(0);
		assert.equal(input.getValue(), "hello world");

		// Undo + redo
		backend.pressKey("z", SGUI_MOD_SUPER);
		app.step(0);
		assert.equal(input.getValue(), "hello ");
		backend.pressKey("z", SGUI_MOD_SUPER | SGUI_MOD_SHIFT);
		app.step(0);
		assert.equal(input.getValue(), "hello world");

		// IME preedit updates underline and reports IME rect
		backend.setImePreedit("ni", 2, 2);
		app.step(0);
		assert.ok(backend.getRenderedTexts().some((t) => t.includes("hello worldni")));
		const imeRect = backend.getImeRect(app.windowId);
		assert.ok(imeRect !== undefined && imeRect.height > 0);

		// Commit text clears preedit
		backend.insertText("!");
		app.step(0);
		assert.equal(input.getValue(), "hello world!");

		// Submit
		backend.pressKey("enter");
		app.step(0);
		assert.equal(submitted, "hello world!");
		app.dispose();
	});

	it("handles mouse click and drag selection inside Input", () => {
		const backend = new HeadlessBackend({ width: 400, height: 120, platform: "darwin" });
		const app = new GuiApp({ backend, window: { title: "Select", width: 400, height: 120 } });
		const input = new Input({ value: "abcdef" });
		app.setRoot(new VStack({ padding: 10, children: [input] }));
		app.renderFrame();

		const r = input.layoutRect;
		const y = r.y + r.height * 0.5;
		backend.pointerDown(r.x + 10, y, "left", 1);
		backend.dragPointer(r.x + 120, y, "left");
		backend.pointerUp(r.x + 120, y, "left", 1);
		app.step(0);

		const sel = input.getSelection();
		assert.equal(sel.start, 0);
		assert.equal(sel.end, 6);
		app.dispose();
	});
});

describe("Editor component", () => {
	it("supports multiline editing, wrapping navigation, mouse selection, autocomplete, and configurable keybindings", () => {
		const backend = new HeadlessBackend({ width: 500, height: 320, platform: "linux" });
		const kb = new KeybindingsManager({ submit: "ctrl+enter", newLine: "enter" }, "linux");
		const app = new GuiApp({
			backend,
			window: { title: "Editor", width: 500, height: 320 },
			keybindings: kb,
		});

		let submittedText = "";
		const provider = new CombinedAutocompleteProvider(
			[
				{ name: "model", description: "Switch active model" },
				{ name: "clear", description: "Clear buffer" },
			],
			process.cwd(),
			false,
		);
		const editor = new Editor({
			autocompleteProvider: provider,
			onSubmit: (text) => {
				submittedText = text;
			},
		});

		app.setRoot(new VStack({ padding: 10, children: [editor] }));
		app.setFocus(editor);
		app.renderFrame();

		// Trigger slash autocomplete & accept with Tab
		backend.insertText("/mo");
		app.step(0);
		assert.equal(editor.getAutocompleteItems()[0]?.value, "model");
		backend.pressKey("tab");
		app.step(0);
		assert.equal(editor.getText(), "/model ");

		// Custom keybinding: Enter inserts newline, Ctrl+Enter submits
		backend.pressKey("enter");
		backend.insertText("second line");
		app.step(0);
		assert.equal(editor.getText(), "/model \nsecond line");

		backend.pressKey("up");
		app.step(0);
		assert.equal(editor.getCursor().line, 0);

		// Ctrl+A copies full multiline buffer
		backend.pressKey("a", SGUI_MOD_CTRL);
		backend.pressKey("c", SGUI_MOD_CTRL);
		app.step(0);
		assert.equal(backend.getClipboardText(), "/model \nsecond line");

		backend.pressKey("enter", SGUI_MOD_CTRL);
		app.step(0);
		assert.equal(submittedText, "/model \nsecond line");
		app.dispose();
	});
});
