import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	Box,
	Button,
	darkGuiTheme,
	GuiApp,
	HeadlessBackend,
	Image,
	Loader,
	lightGuiTheme,
	Markdown,
	parseInlineMarkdown,
	parseMarkdownBlocks,
	SelectList,
	SettingsList,
	Text,
	TruncatedText,
	VStack,
} from "../src/index.ts";

describe("Text, TruncatedText, Button, Loader, Image", () => {
	it("truncates single-line text with ellipsis and wraps multiline Text", () => {
		const backend = new HeadlessBackend({ width: 160, height: 200 });
		const app = new GuiApp({ backend, window: { title: "Text", width: 160, height: 200 } });

		const trunc = new TruncatedText({
			text: "This is a very long heading that definitely exceeds 140 pixels",
			fontSize: 14,
		});
		const wrap = new Text({
			text: "Word one two three four five six seven eight",
			fontSize: 14,
		});
		app.setRoot(new VStack({ padding: 10, gap: 8, children: [trunc, wrap] }));
		app.renderFrame();

		const texts = backend.getRenderedTexts();
		const truncLine = texts[0] ?? "";
		assert.ok(truncLine.endsWith("..."));
		assert.ok(truncLine.length < 40);
		assert.ok(wrap.layoutRect.height > trunc.layoutRect.height);
		app.dispose();
	});

	it("handles Button pointer hover, click, disabled guard, and keyboard activation", () => {
		const backend = new HeadlessBackend({ width: 400, height: 200 });
		const app = new GuiApp({ backend, window: { title: "Button", width: 400, height: 200 } });

		let clicks = 0;
		const btn = new Button({
			label: "Submit",
			variant: "primary",
			onClick: () => {
				clicks += 1;
			},
		});
		const disabledBtn = new Button({
			label: "Locked",
			disabled: true,
			onClick: () => {
				clicks += 100;
			},
		});

		app.setRoot(new VStack({ padding: 16, gap: 10, children: [btn, disabledBtn] }));
		app.renderFrame();

		const br = btn.layoutRect;
		backend.movePointer(br.x + 10, br.y + 10);
		app.step(0);
		assert.equal(btn.isHovered(), true);

		backend.click(br.x + 10, br.y + 10);
		app.step(0);
		assert.equal(clicks, 1);
		assert.equal(app.getFocus(), btn);

		backend.pressKey("enter");
		app.step(0);
		assert.equal(clicks, 2);

		const dr = disabledBtn.layoutRect;
		backend.click(dr.x + 10, dr.y + 10);
		app.step(0);
		assert.equal(clicks, 2);
		app.dispose();
	});

	it("renders Loader spokes and Image RGBA pixels", () => {
		const backend = new HeadlessBackend({ width: 400, height: 200 });
		const app = new GuiApp({ backend, window: { title: "Media", width: 400, height: 200 } });

		const loader = new Loader({ message: "Indexing...", running: true });
		const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
		const img = new Image({ width: 2, height: 2, displayWidth: 32, displayHeight: 32, pixels, radius: 4 });

		app.setRoot(new VStack({ padding: 12, gap: 10, children: [loader, img] }));
		app.renderFrame();

		const cmds = backend.getLastFrameCommands();
		assert.ok(cmds.some((c) => c.kind === "drawLine"));
		assert.ok(cmds.some((c) => c.kind === "drawImageRgba" && c.pxW === 2 && c.pxH === 2));
		assert.ok(backend.getRenderedTexts().includes("Indexing..."));
		loader.stop();
		app.dispose();
	});
});

describe("Markdown parsing and rendering", () => {
	it("parses headings, paragraphs, code blocks, quotes, lists, hr, and inline spans", () => {
		const md = [
			"# Heading",
			"",
			"Paragraph with **bold**, *italic*, `code`, ~~gone~~, and [link](https://example.com).",
			"",
			"> Quoted line",
			"",
			"- Item A",
			"1. Item B",
			"",
			"---",
			"",
			"```ts",
			"const x = 1;",
			"```",
		].join("\n");

		const blocks = parseMarkdownBlocks(md);
		assert.equal(blocks[0]?.kind, "heading");
		assert.equal(blocks[1]?.kind, "paragraph");
		assert.equal(blocks[2]?.kind, "blockquote");
		assert.equal(blocks[3]?.kind, "listItem");
		assert.equal(blocks[4]?.kind, "listItem");
		assert.equal(blocks[5]?.kind, "hr");
		assert.equal(blocks[6]?.kind, "code");

		const inline = parseInlineMarkdown("See **hi** and `x`");
		assert.equal(inline[1]?.kind, "bold");
		assert.equal(inline[3]?.kind, "code");

		const backend = new HeadlessBackend({ width: 600, height: 500 });
		const app = new GuiApp({ backend, window: { title: "MD", width: 600, height: 500 } });
		app.setRoot(new Markdown({ text: md, padding: 12 }));
		app.renderFrame();

		const rendered = backend.getRenderedTexts().join(" ");
		const joined = backend.getRenderedTexts().join("");
		assert.ok(rendered.includes("Heading"));
		assert.ok(joined.includes("const x = 1;"));
		app.dispose();
	});
});

describe("SelectList, SettingsList, GuiApp overlays, menus, focus, and theme", () => {
	it("filters and navigates SelectList and SettingsList via keyboard and mouse", () => {
		const backend = new HeadlessBackend({ width: 500, height: 400 });
		const app = new GuiApp({ backend, window: { title: "Lists", width: 500, height: 400 } });

		let selectedVal = "";
		const select = new SelectList({
			items: [
				{ value: "alpha", label: "Alpha", description: "First" },
				{ value: "beta", label: "Beta", description: "Second" },
				{ value: "gamma", label: "Gamma", description: "Third" },
			],
			onSelect: (item) => {
				selectedVal = item.value;
			},
		});

		let changedSetting = "";
		const settings = new SettingsList({
			items: [
				{ id: "mode", label: "Mode", currentValue: "fast", values: ["fast", "deep"] },
				{ id: "sound", label: "Sound", currentValue: "true" },
			],
			onChange: (id, val) => {
				changedSetting = `${id}:${val}`;
			},
		});

		app.setRoot(new VStack({ padding: 10, gap: 10, children: [select, settings] }));
		app.setFocus(select);
		app.renderFrame();

		backend.pressKey("down");
		backend.pressKey("enter");
		app.step(0);
		assert.equal(selectedVal, "beta");

		select.setFilter("gam");
		app.step(0);
		assert.equal(select.getFilteredItems().length, 1);
		assert.equal(select.getSelectedItem()?.value, "gamma");

		// Focus SettingsList with Tab and toggle current item
		backend.pressKey("tab");
		backend.pressKey("enter");
		app.step(0);
		assert.equal(changedSetting, "mode:deep");
		app.dispose();
	});

	it("manages modal overlay focus trap, escape dismiss, theme switching, and menu dispatch", () => {
		const backend = new HeadlessBackend({ width: 800, height: 600, darkMode: true, platform: "darwin" });
		let menuTriggered = false;
		const app = new GuiApp({
			backend,
			window: { title: "App", width: 800, height: 600 },
			menus: [
				{
					title: "App",
					items: [
						{
							kind: "action",
							label: "Ping",
							onSelect: () => {
								menuTriggered = true;
							},
						},
					],
				},
			],
		});

		const mainBtn = new Button({ label: "Main Button" });
		app.setRoot(new Box({ padding: 20, child: mainBtn }));
		app.setFocus(mainBtn);
		app.renderFrame();
		assert.equal(app.getTheme().dark, true);

		let dismissed = false;
		const okBtn = new Button({ label: "OK" });
		const cancelBtn = new Button({ label: "Cancel" });
		const handle = app.showOverlay(new VStack({ gap: 8, padding: 12, children: [okBtn, cancelBtn] }), {
			modal: true,
			anchor: "center",
			width: 300,
			onDismiss: () => {
				dismissed = true;
			},
		});
		app.renderFrame();

		// Focus starts inside modal and Tab cycles strictly within modal
		assert.equal(app.getFocus(), okBtn);
		backend.pressKey("tab");
		app.step(0);
		assert.equal(app.getFocus(), cancelBtn);
		backend.pressKey("tab");
		app.step(0);
		assert.equal(app.getFocus(), okBtn);

		// Escape dismisses modal and restores previous focus
		backend.pressKey("escape");
		app.step(0);
		assert.equal(dismissed, true);
		assert.equal(app.getFocus(), mainBtn);
		handle.dispose();

		// Dark mode focus event auto-updates theme
		backend.setDarkMode(false);
		app.step(0);
		assert.equal(app.getTheme(), lightGuiTheme);
		backend.setDarkMode(true);
		app.step(0);
		assert.equal(app.getTheme(), darkGuiTheme);

		// Native menu item dispatch
		backend.triggerMenu(1);
		app.step(0);
		assert.equal(menuTriggered, true);
		app.dispose();
	});
});
