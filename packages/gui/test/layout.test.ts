import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	Box,
	Button,
	GuiApp,
	HeadlessBackend,
	HStack,
	rgbColor,
	ScrollView,
	Spacer,
	Text,
	VirtualList,
	VStack,
} from "../src/index.ts";

describe("VStack, HStack, Box, and Spacer flex layout", () => {
	it("distributes flex grow, gaps, padding, and alignment cleanly", () => {
		const backend = new HeadlessBackend({ width: 800, height: 600 });
		const app = new GuiApp({ backend, window: { title: "Layout", width: 800, height: 600 } });

		const fixedBtn = new Button({ label: "Fixed", minWidth: 100 });
		const flexBox = new Box({ minHeight: 20 });
		const tailBtn = new Button({ label: "End", minWidth: 80 });

		const row = new HStack({
			gap: 10,
			padding: 10,
			align: "center",
			children: [fixedBtn, { child: flexBox, grow: 1 }, { child: tailBtn, basis: 120 }],
		});

		const topText = new Text("Header");
		const fillArea = new Box({ background: rgbColor(30, 35, 42), child: new Text("Body") });
		const footer = new Text("Footer");

		const root = new VStack({
			gap: 8,
			children: [row, { child: fillArea, grow: 1 }, new Spacer(0, 12), footer],
		});

		app.setRoot(root);
		app.renderFrame();

		assert.equal(topText.visible, true);
		assert.equal(row.layoutRect.x, 0);
		assert.equal(row.layoutRect.width, 800);
		assert.equal(fixedBtn.layoutRect.x, 10);
		assert.equal(fixedBtn.layoutRect.width, 100);
		assert.equal(tailBtn.layoutRect.width, 120);
		assert.equal(tailBtn.layoutRect.x, 800 - 10 - 120);
		assert.equal(flexBox.layoutRect.x, 120);
		assert.equal(flexBox.layoutRect.width, 800 - 20 - 100 - 120 - 20);
		assert.ok(fillArea.layoutRect.height > 400);
		assert.equal(footer.layoutRect.y + footer.layoutRect.height, 600);
		app.dispose();
	});

	it("respects maxSize cap during flex grow distribution", () => {
		const backend = new HeadlessBackend({ width: 500, height: 200 });
		const app = new GuiApp({ backend, window: { title: "Cap", width: 500, height: 200 } });

		const capped = new Box();
		const uncapped = new Box();
		const row = new HStack({
			gap: 0,
			children: [
				{ child: capped, grow: 1, maxSize: 100 },
				{ child: uncapped, grow: 1 },
			],
		});

		app.setRoot(row);
		app.renderFrame();

		assert.equal(capped.layoutRect.width, 100);
		assert.equal(uncapped.layoutRect.width, 400);
		app.dispose();
	});
});

describe("ScrollView behavior", () => {
	it("supports follow=end, scroll up pause, jump-to-bottom indicator click, and overscroll=chain", () => {
		const backend = new HeadlessBackend({ width: 400, height: 300 });
		const app = new GuiApp({ backend, window: { title: "Scroll", width: 400, height: 300 } });

		const innerStack = new VStack({ gap: 8 });
		for (let i = 0; i < 30; i++) {
			innerStack.addChild(new Text(`Inner item ${i}`));
		}
		const innerScroll = new ScrollView({
			child: innerStack,
			follow: "end",
			overscroll: "chain",
		});
		const innerBox = new Box({ height: 180, child: innerScroll });

		const outerStack = new VStack({
			gap: 10,
			children: [innerBox, ...Array.from({ length: 20 }, (_, i) => new Text(`Outer line ${i}`))],
		});
		const outerScroll = new ScrollView({
			child: outerStack,
			follow: "none",
			primary: true,
		});

		app.setRoot(outerScroll);
		app.renderFrame();

		assert.ok(innerScroll.getMaxScrollY() > 100);
		assert.equal(innerScroll.getScrollY(), innerScroll.getMaxScrollY());
		assert.equal(innerScroll.isFollowingEnd(), true);

		// Scroll up inside innerScroll: pauses follow-end
		backend.wheel(100, 80, 0, -60);
		app.step(0);
		assert.equal(innerScroll.isFollowingEnd(), false);
		assert.ok(innerScroll.getScrollY() < innerScroll.getMaxScrollY());
		assert.ok(backend.getRenderedTexts().includes("Jump to bottom"));

		// Click the floating indicator pill in bottom-right of innerScroll (width ~388, y ~155)
		backend.click(330, 155);
		app.step(0);
		assert.equal(innerScroll.isFollowingEnd(), true);
		assert.equal(innerScroll.getScrollY(), innerScroll.getMaxScrollY());

		// Scroll downward past innerScroll bottom -> chains to outerScroll
		assert.equal(outerScroll.getScrollY(), 0);
		backend.wheel(100, 80, 0, 80);
		app.step(0);
		assert.ok(outerScroll.getScrollY() > 0);
		app.dispose();
	});

	it("handles primary keyboard scrolling keys", () => {
		const backend = new HeadlessBackend({ width: 400, height: 200 });
		const app = new GuiApp({ backend, window: { title: "Keys", width: 400, height: 200 } });
		const stack = new VStack({ gap: 6 });
		for (let i = 0; i < 40; i++) {
			stack.addChild(new Text(`Row ${i}`));
		}
		const sv = new ScrollView({ child: stack, primary: true });
		app.setRoot(sv);
		app.renderFrame();

		backend.pressKey("pagedown");
		app.step(0);
		assert.ok(sv.getScrollY() > 0);

		backend.pressKey("end");
		app.step(0);
		assert.equal(sv.getScrollY(), sv.getMaxScrollY());

		backend.pressKey("home");
		app.step(0);
		assert.equal(sv.getScrollY(), 0);
		app.dispose();
	});
});

describe("VirtualList performance and visible windowing", () => {
	it("only renders visible items plus overscan out of 1,000 items", () => {
		const backend = new HeadlessBackend({ width: 500, height: 250 });
		const app = new GuiApp({ backend, window: { title: "Virtual", width: 500, height: 250 } });
		let renderInvocations = 0;

		const items = Array.from({ length: 1000 }, (_, i) => `Message #${i}`);
		const vlist = new VirtualList<string>({
			items,
			estimatedItemHeight: 40,
			overscan: 2,
			renderItem: (item, _idx, existing) => {
				renderInvocations += 1;
				if (existing instanceof Text) {
					existing.setText(item);
					return existing;
				}
				return new Text(item);
			},
		});

		app.setRoot(vlist);
		app.renderFrame();

		const range = vlist.getVisibleRange();
		assert.equal(range.startIndex, 0);
		assert.ok(vlist.getRenderedCount() <= 15);
		assert.ok(renderInvocations <= 15);

		vlist.scrollToIndex(500, "start");
		app.step(0);
		const midRange = vlist.getVisibleRange();
		assert.ok(midRange.startIndex >= 490 && midRange.startIndex <= 502);
		const texts = backend.getRenderedTexts();
		assert.ok(texts.includes("Message #500"));
		assert.ok(!texts.includes("Message #0"));
		app.dispose();
	});
});
