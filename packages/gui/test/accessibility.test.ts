import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	Button,
	Canvas,
	decodeA11yTree,
	Editor,
	encodeA11yTree,
	type GuiA11yNode,
	GuiApp,
	HeadlessBackend,
	Input,
	Loader,
	Markdown,
	SGUI_A11Y_STATE_CHECKED,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	ScrollView,
	SegmentedControl,
	SelectList,
	SettingsList,
	Slider,
	Switch,
	Text,
	VirtualList,
	VStack,
} from "../src/index.ts";

describe("Accessibility trees and actions", () => {
	it("exposes Markdown as staticText and updates cleanly on live streaming", () => {
		const backend = new HeadlessBackend({ width: 520, height: 360 });
		const app = new GuiApp({ backend, window: { title: "Markdown A11y", width: 520, height: 360 } });

		const md = new Markdown({
			text: [
				"# Title",
				"",
				"Hello **world** with `code` and [link](https://example.com).",
				"",
				"- First bullet",
				"1. Ordered item",
				"",
				"---",
				"",
				"```ts",
				"const x = 1;",
				"```",
			].join("\n"),
		});
		const hrOnly = new Markdown({ text: "---" });
		const hidden = new Markdown({ text: "Hidden paragraph" });
		hidden.visible = false;

		app.setRoot(new VStack({ padding: 12, gap: 8, children: [md, hrOnly, hidden] }));
		app.renderFrame();

		const initialNodes = backend.getAccessibilityTree();
		assert.equal(initialNodes.length, 1);
		const mdNode = initialNodes[0];
		assert.ok(mdNode !== undefined);
		assert.equal(mdNode.id, md.a11yId);
		assert.equal(mdNode.role, "staticText");
		assert.equal((mdNode.stateFlags & SGUI_A11Y_STATE_ENABLED) !== 0, true);
		assert.ok(mdNode.rect.width > 0 && mdNode.rect.height > 0);
		const expectedInitial = [
			"Title",
			"Hello world with code and link.",
			"- First bullet",
			"1. Ordered item",
			"const x = 1;",
		].join("\n");
		assert.equal(mdNode.label, expectedInitial);
		assert.equal(mdNode.value, expectedInitial);

		md.setText("Short");
		app.step(0);
		const heightBefore = md.layoutRect.height;
		md.setMarkdown("## Streamed Reply\n\nChunk one\n\nChunk two\n\nChunk three");
		app.step(0);

		assert.ok(md.layoutRect.height > heightBefore);
		const updatedNodes = backend.getAccessibilityTree();
		assert.equal(updatedNodes.length, 1);
		assert.equal(updatedNodes[0]?.value, "Streamed Reply\nChunk one\nChunk two\nChunk three");

		md.setText("   ");
		app.step(0);
		assert.equal(backend.getAccessibilityTree().length, 0);

		app.dispose();
	});

	it("exposes Loader message as staticText and handles message updates cleanly", () => {
		const backend = new HeadlessBackend({ width: 400, height: 200 });
		const app = new GuiApp({ backend, window: { title: "Loader A11y", width: 400, height: 200 } });

		const loader = new Loader({ message: "Thinking..." });
		app.setRoot(new VStack({ padding: 12, gap: 8, children: [loader] }));
		app.renderFrame();

		const nodes1 = backend.getAccessibilityTree();
		assert.equal(nodes1.length, 1);
		assert.equal(nodes1[0]?.id, loader.a11yId);
		assert.equal(nodes1[0]?.role, "staticText");
		assert.equal(nodes1[0]?.label, "Thinking...");
		assert.equal(nodes1[0]?.value, "Thinking...");
		assert.equal((nodes1[0]?.stateFlags ?? 0) & SGUI_A11Y_STATE_ENABLED, SGUI_A11Y_STATE_ENABLED);

		const framesBefore = backend.getFrameCount();
		loader.setMessage("Thinking...");
		app.step(0);
		assert.equal(backend.getFrameCount(), framesBefore);

		loader.setMessage("  Running tools...  ");
		app.step(0);
		const nodes2 = backend.getAccessibilityTree();
		assert.equal(nodes2[0]?.value, "Running tools...");
		assert.equal(nodes2[0]?.label, "Running tools...");

		loader.visible = false;
		loader.invalidate();
		app.step(0);
		assert.equal(backend.getAccessibilityTree().length, 0);

		app.dispose();
	});

	it("handles Editor and Input accessibility actions including setValue + Return submit", () => {
		const backend = new HeadlessBackend({ width: 520, height: 320 });
		const app = new GuiApp({ backend, window: { title: "Text Inputs A11y", width: 520, height: 320 } });

		const editorChanges: string[] = [];
		const editorSubmits: string[] = [];
		const inputChanges: string[] = [];
		const inputSubmits: string[] = [];

		const otherBtn = new Button({ label: "Idle" });
		const editor = new Editor({
			placeholder: "Message...",
			onChange: (text) => editorChanges.push(text),
			onSubmit: (text) => editorSubmits.push(text),
		});
		const input = new Input({
			placeholder: "Filter...",
			onChange: (val) => inputChanges.push(val),
			onSubmit: (val) => inputSubmits.push(val),
		});

		app.setRoot(new VStack({ padding: 12, gap: 8, children: [otherBtn, editor, input] }));
		app.setFocus(otherBtn);
		app.renderFrame();

		const findNode = (id: number): GuiA11yNode | undefined =>
			backend.getAccessibilityTree().find((n) => n.id === id);

		const editorNode0 = findNode(editor.a11yId);
		assert.equal(editorNode0?.role, "textArea");
		assert.equal(editorNode0?.label, "Message...");
		assert.equal((editorNode0?.stateFlags ?? 0) & SGUI_A11Y_STATE_FOCUSED, 0);

		// setValue should fire onChange, focus Editor, and invalidate cleanly
		backend.triggerA11ySetValue(editor.a11yId, "/status report");
		app.step(0);
		assert.equal(app.getFocus(), editor);
		assert.deepEqual(editorChanges, ["/status report"]);
		const editorNode1 = findNode(editor.a11yId);
		assert.equal(editorNode1?.value, "/status report");
		assert.equal((editorNode1?.stateFlags ?? 0) & SGUI_A11Y_STATE_FOCUSED, SGUI_A11Y_STATE_FOCUSED);

		// Return / Enter after setValue submits the editor value
		backend.pressKey("return");
		app.step(0);
		assert.deepEqual(editorSubmits, ["/status report"]);

		// Switch focus to Input via a11y setValue (with newline sanitized to space) and submit with Enter
		backend.triggerA11ySetValue(input.a11yId, "hello\nworld");
		app.step(0);
		assert.equal(app.getFocus(), input);
		assert.deepEqual(inputChanges, ["hello world"]);
		const inputNode = findNode(input.a11yId);
		assert.equal(inputNode?.role, "textField");
		assert.equal(inputNode?.value, "hello world");
		assert.equal((inputNode?.stateFlags ?? 0) & SGUI_A11Y_STATE_FOCUSED, SGUI_A11Y_STATE_FOCUSED);

		backend.pressKey("enter");
		app.step(0);
		assert.deepEqual(inputSubmits, ["hello world"]);

		// Focus and press actions route focus cleanly back to Editor
		backend.triggerA11yFocus(editor.a11yId);
		app.step(0);
		assert.equal(app.getFocus(), editor);
		app.setFocus(otherBtn);
		app.step(0);
		backend.triggerA11yPress(editor.a11yId);
		app.step(0);
		assert.equal(app.getFocus(), editor);

		app.dispose();
	});

	it("exposes Switch, Slider, SegmentedControl, and Button states and actions", () => {
		const backend = new HeadlessBackend({ width: 600, height: 400 });
		const app = new GuiApp({ backend, window: { title: "Controls A11y", width: 600, height: 400 } });

		let btnClicks = 0;
		const switchChanges: boolean[] = [];
		const sliderChanges: number[] = [];
		const segChanges: string[] = [];

		const button = new Button({
			label: "Apply",
			onClick: () => {
				btnClicks += 1;
			},
		});
		const toggle = new Switch({
			label: "Auto Save",
			checked: false,
			onChange: (checked) => switchChanges.push(checked),
		});
		const slider = new Slider({
			label: "Opacity",
			min: 0,
			max: 100,
			step: 5,
			value: 50,
			formatValue: (v) => `${Math.round(v)}%`,
			onChange: (v) => sliderChanges.push(v),
		});
		const segmented = new SegmentedControl({
			label: "Mode",
			items: [
				{ id: "fast", label: "Fast" },
				{ id: "balanced", label: "Balanced" },
				{ id: "deep", label: "Deep" },
			],
			selectedId: "fast",
			onChange: (id) => segChanges.push(id),
		});
		const plainSegmented = new SegmentedControl({
			items: [
				{ id: "a", label: "Alpha" },
				{ id: "b", label: "Beta" },
			],
		});

		app.setRoot(new VStack({ padding: 12, gap: 10, children: [button, toggle, slider, segmented, plainSegmented] }));
		app.renderFrame();

		const findNode = (id: number): GuiA11yNode | undefined =>
			backend.getAccessibilityTree().find((n) => n.id === id);

		// Button press + focus
		backend.triggerA11yFocus(button.a11yId);
		app.step(0);
		assert.equal((findNode(button.a11yId)?.stateFlags ?? 0) & SGUI_A11Y_STATE_FOCUSED, SGUI_A11Y_STATE_FOCUSED);
		backend.triggerA11yPress(button.a11yId);
		app.step(0);
		assert.equal(btnClicks, 1);

		// Switch press and setValue
		assert.equal((findNode(toggle.a11yId)?.stateFlags ?? 0) & SGUI_A11Y_STATE_CHECKED, 0);
		backend.triggerA11yPress(toggle.a11yId);
		app.step(0);
		assert.equal(toggle.isChecked(), true);
		assert.equal(findNode(toggle.a11yId)?.value, "1");
		assert.equal(
			(findNode(toggle.a11yId)?.stateFlags ?? 0) & SGUI_A11Y_STATE_CHECKED,
			SGUI_A11Y_STATE_CHECKED,
		);
		backend.triggerA11ySetValue(toggle.a11yId, "false");
		app.step(0);
		assert.equal(toggle.isChecked(), false);
		assert.deepEqual(switchChanges, [true, false]);

		// Slider increment / decrement / setValue
		assert.equal(findNode(slider.a11yId)?.role, "slider");
		assert.equal(findNode(slider.a11yId)?.value, "50%");
		backend.triggerA11yIncrement(slider.a11yId);
		backend.triggerA11ySetValue(slider.a11yId, "80%");
		backend.triggerA11yDecrement(slider.a11yId);
		app.step(0);
		assert.deepEqual(sliderChanges, [55, 80, 75]);
		assert.equal(findNode(slider.a11yId)?.value, "75%");

		// SegmentedControl with label emits radioGroup + segment buttons; plainSegmented omits radioGroup
		const tree = backend.getAccessibilityTree();
		const groupNode = tree.find((n) => n.id === segmented.a11yId);
		assert.equal(groupNode?.role, "radioGroup");
		assert.equal(groupNode?.label, "Mode");
		assert.equal(groupNode?.value, "Fast");
		assert.equal(tree.some((n) => n.id === plainSegmented.a11yId), false);

		const deepButton = tree.find((n) => n.label === "Deep");
		assert.ok(deepButton !== undefined);
		backend.triggerA11yPress(deepButton.id);
		app.step(0);
		assert.equal(segmented.getSelectedId(), "deep");
		assert.equal(findNode(segmented.a11yId)?.value, "Deep");
		assert.equal(
			(backend.getAccessibilityTree().find((n) => n.label === "Deep")?.stateFlags ?? 0) & SGUI_A11Y_STATE_SELECTED,
			SGUI_A11Y_STATE_SELECTED,
		);

		backend.triggerA11yDecrement(segmented.a11yId);
		app.step(0);
		assert.equal(segmented.getSelectedId(), "balanced");
		backend.triggerA11yIncrement(segmented.a11yId);
		app.step(0);
		assert.equal(segmented.getSelectedId(), "deep");
		assert.deepEqual(segChanges, ["deep", "balanced", "deep"]);

		app.dispose();
	});

	it("supports SelectList, SettingsList, ScrollView pill, and VirtualList accessibility", () => {
		const backend = new HeadlessBackend({ width: 560, height: 500 });
		const app = new GuiApp({ backend, window: { title: "Lists A11y", width: 560, height: 500 } });

		const selectedItems: string[] = [];
		const settingChanges: string[] = [];

		const select = new SelectList({
			items: [
				{ label: "Alpha", value: "alpha", description: "First choice" },
				{ label: "Beta", value: "beta", description: "Second choice" },
				{ label: "Gamma", value: "gamma" },
			],
			onSelect: (item) => selectedItems.push(item.value),
		});

		const settings = new SettingsList({
			items: [
				{ id: "theme", label: "Theme", currentValue: "dark", values: ["dark", "light", "system"] },
				{ id: "telemetry", label: "Telemetry", currentValue: "false" },
			],
			onChange: (id, val) => settingChanges.push(`${id}:${val}`),
		});

		const scrollContent = new VStack({
			gap: 8,
			children: Array.from({ length: 12 }, (_, idx) => new Text({ text: `Row ${idx + 1}` })),
		});
		const scrollView = new ScrollView({
			follow: "end",
			child: scrollContent,
			scrollToEndLabel: "Jump to bottom",
		});

		const vlist = new VirtualList<string>({
			items: Array.from({ length: 20 }, (_, i) => `Item ${i}`),
			estimatedItemHeight: 28,
			renderItem: (item) => new Text({ text: item }),
		});

		const root = new VStack({
			padding: 10,
			gap: 8,
			children: [
				{ child: select, basis: 120 },
				{ child: settings, basis: 96 },
				{ child: scrollView, basis: 110 },
				{ child: vlist, basis: 90 },
			],
		});
		app.setRoot(root);
		app.renderFrame();

		// SelectList increment / press / setValue(filter)
		backend.triggerA11yIncrement(select.a11yId);
		backend.triggerA11yPress(select.a11yId);
		app.step(0);
		assert.deepEqual(selectedItems, ["beta"]);

		const gammaRow = backend.getAccessibilityTree().find((n) => n.label === "Gamma");
		assert.ok(gammaRow !== undefined);
		backend.triggerA11yPress(gammaRow.id);
		app.step(0);
		assert.deepEqual(selectedItems, ["beta", "gamma"]);

		backend.triggerA11ySetValue(select.a11yId, "alp");
		app.step(0);
		assert.equal(select.getSelectedItem()?.value, "alpha");

		// SettingsList focus flag, press/increment/decrement, and setValue
		const themeRow0 = backend.getAccessibilityTree().find((n) => n.label === "Theme");
		assert.ok(themeRow0 !== undefined);
		backend.triggerA11yFocus(themeRow0.id);
		app.step(0);
		const themeRowFocused = backend.getAccessibilityTree().find((n) => n.label === "Theme");
		assert.equal((themeRowFocused?.stateFlags ?? 0) & SGUI_A11Y_STATE_FOCUSED, SGUI_A11Y_STATE_FOCUSED);
		assert.equal((themeRowFocused?.stateFlags ?? 0) & SGUI_A11Y_STATE_SELECTED, SGUI_A11Y_STATE_SELECTED);

		backend.triggerA11yIncrement(themeRow0.id);
		backend.triggerA11yDecrement(themeRow0.id);
		backend.triggerA11ySetValue(themeRow0.id, "system");
		app.step(0);
		assert.deepEqual(settingChanges, ["theme:light", "theme:dark", "theme:system"]);

		// ScrollView exposes Jump to bottom pill when scrolled away from end and pressing it jumps back
		assert.ok(scrollView.getMaxScrollY() > 0);
		scrollView.scrollTo(0);
		app.step(0);
		const jumpBtn = backend.getAccessibilityTree().find((n) => n.label === "Jump to bottom");
		assert.ok(jumpBtn !== undefined);
		assert.equal(jumpBtn.role, "button");
		backend.triggerA11yPress(jumpBtn.id);
		app.step(0);
		assert.equal(scrollView.isFollowingEnd(), true);
		assert.equal(backend.getAccessibilityTree().some((n) => n.label === "Jump to bottom"), false);

		// VirtualList exposes visible rows and updates when scrolled
		assert.equal(backend.getAccessibilityTree().some((n) => n.label === "Item 0"), true);
		assert.equal(backend.getAccessibilityTree().some((n) => n.label === "Item 19"), false);
		vlist.scrollToIndex(19, "end");
		app.step(0);
		assert.equal(backend.getAccessibilityTree().some((n) => n.label === "Item 19"), true);
		assert.equal(backend.getAccessibilityTree().some((n) => n.label === "Item 0"), false);

		app.dispose();
	});

	it("supports Canvas backward-compatible group mode and interactive slider role/actions", () => {
		const backend = new HeadlessBackend({ width: 420, height: 280 });
		const app = new GuiApp({ backend, window: { title: "Canvas A11y", width: 420, height: 280 } });

		const silent = new Canvas({ width: 80, height: 40 });
		const legacy = new Canvas({ width: 120, height: 60, label: "Legacy Plot" });

		let tilt = 10;
		let pressCount = 0;
		const chart = new Canvas({
			width: 240,
			height: 90,
			focusable: true,
			role: "slider",
			label: "Tilt Chart",
			value: `${tilt} deg`,
			onPress: () => {
				pressCount += 1;
			},
			onIncrement: () => {
				tilt += 5;
				chart.setValue(`${tilt} deg`);
			},
			onDecrement: () => {
				tilt -= 5;
				chart.setValue(`${tilt} deg`);
			},
			onSetValue: (raw) => {
				tilt = Number.parseFloat(raw) || 0;
				chart.setValue(`${tilt} deg`);
			},
		});

		app.setRoot(new VStack({ padding: 10, gap: 8, children: [silent, legacy, chart] }));
		app.renderFrame();

		const nodes = backend.getAccessibilityTree();
		assert.equal(nodes.some((n) => n.id === silent.a11yId), false);
		const legacyNode = nodes.find((n) => n.id === legacy.a11yId);
		assert.equal(legacyNode?.role, "group");
		assert.equal(legacyNode?.value, "");

		const chartNode0 = nodes.find((n) => n.id === chart.a11yId);
		assert.equal(chartNode0?.role, "slider");
		assert.equal(chartNode0?.label, "Tilt Chart");
		assert.equal(chartNode0?.value, "10 deg");

		backend.triggerA11yIncrement(chart.a11yId);
		backend.triggerA11yPress(chart.a11yId);
		app.step(0);
		assert.equal(app.getFocus(), chart);
		assert.equal(pressCount, 1);
		assert.equal(backend.getAccessibilityTree().find((n) => n.id === chart.a11yId)?.value, "15 deg");

		backend.triggerA11yDecrement(chart.a11yId);
		app.step(0);
		assert.equal(backend.getAccessibilityTree().find((n) => n.id === chart.a11yId)?.value, "10 deg");

		backend.triggerA11ySetValue(chart.a11yId, "42");
		app.step(0);
		assert.equal(backend.getAccessibilityTree().find((n) => n.id === chart.a11yId)?.value, "42 deg");

		// Round-trip binary protocol check for accessibility nodes
		const tree = backend.getAccessibilityTree();
		const encoded = encodeA11yTree(tree);
		const decoded = decodeA11yTree(encoded);
		assert.equal(decoded.length, tree.length);
		assert.equal(decoded.find((n) => n.id === chart.a11yId)?.role, "slider");
		assert.equal(decoded.find((n) => n.id === chart.a11yId)?.value, "42 deg");

		app.dispose();
	});
});
