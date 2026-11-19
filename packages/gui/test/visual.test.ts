import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	Badge,
	Box,
	Button,
	Divider,
	darkGuiTheme,
	Editor,
	GuiApp,
	type GuiTheme,
	HeadlessBackend,
	HStack,
	Input,
	lightGuiTheme,
	packRgba,
	Pill,
	RasterSurface,
	renderVectorIcon,
	rgbColor,
	ScrollView,
	SegmentedControl,
	Slider,
	Switch,
	Text,
	VectorCanvas,
	VectorIcon,
	type VectorIconName,
	VirtualList,
	VStack,
	withAlpha,
} from "../src/index.ts";

const ALL_VECTOR_ICONS: readonly VectorIconName[] = [
	"plus",
	"minus",
	"reset",
	"sun",
	"moon",
	"check",
	"trash",
	"chevron-right",
	"chevron-left",
	"chevron-down",
	"chevron-up",
	"search",
	"sliders",
	"palette",
	"layout",
	"list",
	"activity",
	"star",
	"star-filled",
	"rocket",
	"compass",
	"crosshair",
	"cpu",
	"shield",
	"sparkles",
	"terminal",
	"folder",
	"folder-new",
	"corner-down-right",
	"ellipsis",
	"send",
	"stop",
	"menu",
	"info",
	"alert",
	"panel-left",
	"panel-right",
	"compose",
	"arrow-left",
	"arrow-right",
	"arrow-up",
	"arrow-down",
	"git-branch",
	"git-commit",
	"file-diff",
	"file-code",
	"laptop",
	"copy",
	"edit",
	"pin",
	"fork",
	"close",
	"external-link",
	"eye",
	"monitor",
	"waku-mark",
];

describe("Visual craft, responsive Box layout, Divider, and overlay shadows", () => {
	it("clamps Box maxWidth/width inside stretched parents, honors alignHorizontal, and emits shadow layers", () => {
		const backend = new HeadlessBackend({ width: 800, height: 400 });
		const app = new GuiApp({ backend, window: { title: "Box Studio", width: 800, height: 400 } });

		const centeredCard = new Box({
			maxWidth: 400,
			fillWidth: true,
			alignHorizontal: "center",
			shadow: "md",
			radius: 10,
			background: darkGuiTheme.surface,
			borderColor: darkGuiTheme.border,
			padding: 12,
			child: new Text("Studio Column"),
		});
		const endBox = new Box({
			width: 240,
			alignHorizontal: "end",
			borderColor: darkGuiTheme.border,
			radius: 8,
			child: new Text("Right Aligned"),
		});
		const root = new VStack({
			gap: 12,
			children: [centeredCard, endBox],
		});

		app.setRoot(root);
		app.renderFrame();

		assert.equal(centeredCard.layoutRect.width, 400);
		assert.equal(centeredCard.layoutRect.x, 200);
		assert.equal(endBox.layoutRect.width, 240);
		assert.equal(endBox.layoutRect.x, 560);

		const cmds = backend.getLastFrameCommands();
		const cardBgRgba = packRgba(darkGuiTheme.surface);
		const cardBgIdx = cmds.findIndex(
			(c) => c.kind === "fillRect" && c.rgba === cardBgRgba && c.w === 400 && c.x === 200,
		);
		assert.ok(cardBgIdx > 0);
		// Multi-layer shadow rects are emitted before the background fillRect
		const shadowBeforeCard = cmds
			.slice(0, cardBgIdx)
			.filter((c) => c.kind === "fillRect" && c.y > centeredCard.layoutRect.y - 2 && c.w >= 400);
		assert.ok(shadowBeforeCard.length >= 3);

		// Auto borderWidth = 1 when borderColor is passed without explicit borderWidth
		const borderStrokes = cmds.filter(
			(c) => c.kind === "strokeRect" && c.rgba === packRgba(darkGuiTheme.border) && c.strokeWidth === 1,
		);
		assert.ok(borderStrokes.length >= 2);

		// Shrink window below maxWidth -> Box shrinks fluidly to 300px without overflowing
		backend.resize(300, 400);
		app.step(0);
		assert.equal(centeredCard.layoutRect.width, 300);
		assert.equal(centeredCard.layoutRect.x, 0);
		app.dispose();
	});

	it("renders horizontal and vertical Dividers cleanly without inflating narrow containers", () => {
		const backend = new HeadlessBackend({ width: 500, height: 300 });
		const app = new GuiApp({ backend, window: { title: "Divider", width: 500, height: 300 } });

		const hDiv = new Divider({ direction: "horizontal" });
		const vDiv = new Divider({ direction: "vertical", inset: 2, length: 18 });
		const narrowMenu = new VStack({
			gap: 4,
			children: [new Text("Item"), new Divider({ direction: "horizontal" }), new Text("Next")],
		});
		app.setRoot(new Box({ padding: 8, child: new Text("Host") }));
		const overlayHandle = app.showOverlay(narrowMenu, { anchor: "center" });
		app.renderFrame();
		assert.ok(narrowMenu.layoutRect.width < 120, `expected tight auto-size < 120, got ${narrowMenu.layoutRect.width}`);
		overlayHandle.dispose();

		const row = new HStack({
			align: "center",
			gap: 8,
			children: [new Button({ label: "Left" }), vDiv, new Button({ label: "Right" })],
		});
		app.setRoot(new VStack({ gap: 8, padding: 12, children: [hDiv, row] }));
		app.renderFrame();

		assert.equal(hDiv.layoutRect.width, 476);
		assert.equal(hDiv.layoutRect.height, 1);
		assert.equal(vDiv.layoutRect.width, 1);
		assert.equal(vDiv.layoutRect.height, 18);

		const cmds = backend.getLastFrameCommands();
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.w === 476 && c.h === 1));
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.w === 1 && c.h === 14));
		app.dispose();
	});

	it("draws overlay backdrop, multi-layer drop shadow, and crisp hairline border cleanly", () => {
		const backend = new HeadlessBackend({ width: 640, height: 480 });
		const app = new GuiApp({ backend, window: { title: "Overlays", width: 640, height: 480 } });
		app.setRoot(new Box({ padding: 20, child: new Text("Workspace") }));

		app.showOverlay(
			new VStack({
				padding: 16,
				gap: 8,
				children: [new Text("Confirm Action"), new Button({ label: "OK", variant: "primary" })],
			}),
			{ modal: true, width: 280 },
		);
		app.renderFrame();

		const cmds = backend.getLastFrameCommands();
		// Dimmed full-screen modal backdrop
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.x === 0 && c.y === 0 && c.w === 640 && c.h === 480));
		// Large elevation shadow layers (>280px wide around modal rect) + hairline border + large modal radius
		const lgShadows = cmds.filter((c) => c.kind === "fillRect" && c.w > 280 && c.w < 310);
		assert.ok(lgShadows.length >= 2);
		assert.ok(
			cmds.some(
				(c) =>
					c.kind === "strokeRect" &&
					c.w === 280 &&
					c.strokeWidth === 1 &&
					c.radius === darkGuiTheme.radiusLarge,
			),
		);
		app.dispose();
	});
});

describe("Pure-TS RasterSurface, VectorIcon, VectorCanvas, and Badge/Pill", () => {
	it("preserves straight unpremultiplied RGBA colors across anti-aliased RasterSurface primitives", () => {
		const surface = new RasterSurface(48, 48, 2);
		assert.equal(surface.pixelWidth, 96);
		assert.equal(surface.pixelHeight, 96);

		surface.fillCircle(24, 24, 16, rgbColor(255, 255, 255));
		// Center pixel is fully opaque white
		const centerIdx = (48 * surface.pixelWidth + 48) * 4;
		assert.equal(surface.pixels[centerIdx], 255);
		assert.equal(surface.pixels[centerIdx + 1], 255);
		assert.equal(surface.pixels[centerIdx + 2], 255);
		assert.equal(surface.pixels[centerIdx + 3], 255);

		// Edge pixels keep pure straight RGB (255,255,255) with fractional alpha (no dark fringes!)
		let aaEdgeCount = 0;
		for (let i = 0; i < surface.pixels.length; i += 4) {
			const a = surface.pixels[i + 3] ?? 0;
			if (a > 0 && a < 255) {
				aaEdgeCount += 1;
				assert.equal(surface.pixels[i], 255);
				assert.equal(surface.pixels[i + 1], 255);
				assert.equal(surface.pixels[i + 2], 255);
			}
		}
		assert.ok(aaEdgeCount > 20, `expected >20 AA edge pixels, got ${aaEdgeCount}`);

		// Exercise all other AA vector primitives on fresh surfaces
		surface.clear();
		surface.fillRoundedRect(4, 4, 40, 20, 6, rgbColor(80, 140, 255));
		surface.strokeCircle(24, 24, 18, 2, rgbColor(240, 240, 240));
		surface.drawArc(24, 24, 14, -Math.PI * 0.5, Math.PI * 0.75, 3, rgbColor(50, 220, 130), true);
		surface.drawRing(24, 24, 10, 0, Math.PI, 2, rgbColor(250, 200, 70), false);
		surface.drawLineAA(4, 40, 44, 8, 2, rgbColor(255, 90, 90), true);
		surface.fillAreaCurve(
			[
				{ x: 4, y: 34 },
				{ x: 18, y: 18 },
				{ x: 32, y: 26 },
				{ x: 44, y: 12 },
			],
			42,
			withAlpha(rgbColor(80, 160, 255), 0.5),
			withAlpha(rgbColor(80, 160, 255), 0),
		);

		// Translucent polyline joint does not exceed source alpha due to double-blending at vertex
		const jointSurface = new RasterSurface(40, 40, 2);
		jointSurface.drawPolylineAA(
			[
				{ x: 6, y: 20 },
				{ x: 20, y: 20 },
				{ x: 20, y: 34 },
			],
			4,
			withAlpha(rgbColor(100, 200, 255), 0.5),
			false,
		);
		let maxAlpha = 0;
		for (let i = 3; i < jointSurface.pixels.length; i += 4) {
			const a = jointSurface.pixels[i] ?? 0;
			if (a > maxAlpha) maxAlpha = a;
		}
		assert.ok(maxAlpha <= 130, `expected vertex alpha <= ~128 (0.5), got ${maxAlpha}`);
	});

	it("renders every named VectorIcon cleanly and drives VectorCanvas & Badge/Pill components", () => {
		for (let i = 0; i < ALL_VECTOR_ICONS.length; i++) {
			const name = ALL_VECTOR_ICONS[i];
			if (name === undefined) continue;
			const s = new RasterSurface(24, 24, 2);
			renderVectorIcon(s, name, 2, 2, 20, rgbColor(220, 230, 245));
			let nonZero = 0;
			for (let p = 3; p < s.pixels.length; p += 4) {
				if ((s.pixels[p] ?? 0) > 0) nonZero += 1;
			}
			assert.ok(nonZero > 10, `VectorIcon "${name}" produced insufficient coverage (${nonZero})`);
		}

		const backend = new HeadlessBackend({ width: 520, height: 320 });
		const app = new GuiApp({ backend, window: { title: "Vector UI", width: 520, height: 320 } });

		let incCount = 0;
		const icon = new VectorIcon({ name: "sparkles", size: 18, label: "Sparkles Icon" });
		const badge = new Badge({ label: "READY", variant: "success", leadingIcon: "check" });
		const pill = new Pill({ label: "BETA", variant: "accent" });
		const canvas = new VectorCanvas({
			width: 140,
			height: 90,
			radius: 10,
			borderColor: darkGuiTheme.border,
			focusable: true,
			role: "slider",
			label: "Fuel Gauge",
			value: "65%",
			render: (surface, rect, ctx) => {
				surface.drawArc(rect.width * 0.5, rect.height * 0.5, 28, -Math.PI, 0, 6, ctx.theme.accent, true);
			},
			onIncrement: () => {
				incCount += 1;
				canvas.setValue("70%");
			},
		});

		app.setRoot(
			new VStack({
				padding: 12,
				gap: 10,
				children: [new HStack({ gap: 8, align: "center", children: [icon, badge, pill] }), canvas],
			}),
		);
		app.renderFrame();

		const cmds = backend.getLastFrameCommands();
		const images = cmds.filter((c) => c.kind === "drawImageRgba");
		// VectorIcon + Badge leadingIcon + VectorCanvas = 3 Retina RGBA blits
		assert.equal(images.length, 3);

		const snapshot = backend.getAccessibilityTree();
		const gaugeNode = snapshot.find((n) => n.label === "Fuel Gauge");
		assert.ok(gaugeNode !== undefined);
		assert.equal(gaugeNode.role, "slider");
		assert.equal(gaugeNode.value, "65%");
		backend.triggerA11yIncrement(gaugeNode.id);
		app.step(0);
		assert.equal(incCount, 1);
		assert.equal(canvas.getValue(), "70%");
		app.dispose();
	});
});

describe("Modernized widget craft: Button, Switch, Slider, SegmentedControl, ScrollView", () => {
	it("renders Button leadingIcon/pill, Switch white thumb, 4px Slider, and SegmentedControl card pill", () => {
		const darkInkTheme: GuiTheme = {
			...lightGuiTheme,
			textOnAccent: rgbColor(12, 14, 18),
		};
		const backend = new HeadlessBackend({ width: 520, height: 360 });
		const app = new GuiApp({
			backend,
			theme: darkInkTheme,
			window: { title: "Controls", width: 520, height: 360 },
		});

		const iconBtn = new Button({
			label: "Launch",
			variant: "primary",
			leadingIcon: "rocket",
			pill: true,
		});
		const toggle = new Switch({ label: "Autopilot", checked: true });
		const slider = new Slider({ label: "Throttle", min: 0, max: 100, value: 50 });
		const seg = new SegmentedControl({
			items: [
				{ id: "manual", label: "Manual" },
				{ id: "assist", label: "Assist" },
				{ id: "auto", label: "Auto" },
			],
			selectedId: "manual",
		});

		app.setRoot(new VStack({ padding: 14, gap: 12, children: [iconBtn, toggle, slider, seg] }));
		app.renderFrame();

		const cmds = backend.getLastFrameCommands();
		// Button leading icon emitted via drawImageRgba + pill radius = height / 2
		assert.ok(cmds.some((c) => c.kind === "drawImageRgba"));
		assert.ok(
			cmds.some(
				(c) =>
					c.kind === "fillRect" &&
					c.w === iconBtn.layoutRect.width &&
					c.h === iconBtn.layoutRect.height &&
					Math.abs(c.radius - iconBtn.layoutRect.height * 0.5) < 0.01,
			),
		);

		// Switch track 36x20 + Waku inverseBg track and 14x14 inverseFg knob
		const pureWhite = packRgba(rgbColor(255, 255, 255));
		const inverseBgRgba = packRgba(darkInkTheme.inverseBg);
		const inverseFgRgba = packRgba(darkInkTheme.inverseFg);
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.w === 36 && c.h === 20 && c.rgba === inverseBgRgba));
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.w === 14 && c.h === 14 && c.rgba === inverseFgRgba));

		// Slider 4px track (radius 2) + 16x16 white thumb
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.h === 4 && c.radius === 2));

		// SegmentedControl has radius=9 track and radius=6 selected card pill (not accent fill)
		const accentRgba = packRgba(darkInkTheme.accent);
		assert.ok(cmds.some((c) => c.kind === "fillRect" && c.radius === 9 && c.w === seg.layoutRect.width));
		const pillCard = cmds.find(
			(c) =>
				c.kind === "fillRect" &&
				c.radius === 6 &&
				Math.abs(c.y - (seg.layoutRect.y + 3)) < 0.01 &&
				c.rgba !== accentRgba &&
				c.rgba === pureWhite,
		);
		assert.ok(pillCard !== undefined);

		// Hovering an inactive segment ("Auto" at right third) transitions its text color from textMuted to text
		const textMutedRgba = packRgba(darkInkTheme.textMuted);
		const textRgba = packRgba(darkInkTheme.text);
		const findTextCmd = (list: ReturnType<typeof backend.getLastFrameCommands>, label: string) => {
			for (let i = 0; i < list.length; i++) {
				const c = list[i];
				if (c !== undefined && c.kind === "drawText" && c.text === label) {
					return c;
				}
			}
			return undefined;
		};
		assert.equal(findTextCmd(cmds, "Auto")?.rgba, textMutedRgba);

		backend.movePointer(seg.layoutRect.x + seg.layoutRect.width * 0.85, seg.layoutRect.y + seg.layoutRect.height * 0.5);
		app.step(0);
		assert.equal(findTextCmd(backend.getLastFrameCommands(), "Auto")?.rgba, textRgba);

		backend.pointerLeave();
		app.step(0);
		assert.equal(findTextCmd(backend.getLastFrameCommands(), "Auto")?.rgba, textMutedRgba);

		// Input and Editor draw soft outer focus halo (3px stroke expanded outside rect) when focused
		const input = new Input({ placeholder: "Filter..." });
		const editor = new Editor({ placeholder: "Write prompt..." });
		app.setRoot(new VStack({ padding: 12, gap: 8, children: [input, editor] }));
		app.renderFrame();
		backend.triggerA11yFocus(input.a11yId);
		app.step(0);
		const haloRgba = packRgba(withAlpha(darkInkTheme.borderFocus, 0.22));
		assert.ok(
			backend
				.getLastFrameCommands()
				.some(
					(c) =>
						c.kind === "strokeRect" &&
						c.rgba === haloRgba &&
						c.strokeWidth === 3 &&
						c.w > input.layoutRect.width,
				),
		);
		backend.triggerA11yFocus(editor.a11yId);
		app.step(0);
		assert.ok(
			backend
				.getLastFrameCommands()
				.some(
					(c) =>
						c.kind === "strokeRect" &&
						c.rgba === haloRgba &&
						c.strokeWidth === 3 &&
						c.w > editor.layoutRect.width,
				),
		);

		// Thin 6px scrollbar thumb on ScrollView & VirtualList
		const items = Array.from({ length: 40 }, (_, idx) => `Row ${idx}`);
		const longStack = new VStack({ gap: 4, children: items.map((s) => new Text(s)) });
		const sv = new ScrollView({ child: longStack });
		const vl = new VirtualList<string>({
			items,
			estimatedItemHeight: 24,
			renderItem: (txt) => new Text(txt),
		});
		app.setRoot(
			new VStack({
				padding: 8,
				gap: 8,
				children: [
					{ child: sv, basis: 140 },
					{ child: vl, basis: 140 },
				],
			}),
		);
		app.renderFrame();
		const scrollCmds = backend.getLastFrameCommands();
		const slimThumbs = scrollCmds.filter(
			(c) => c.kind === "fillRect" && c.w === 6 && c.radius === 3 && c.rgba === packRgba(darkInkTheme.scrollbarThumb),
		);
		assert.equal(slimThumbs.length, 2);
		app.dispose();
	});
});
