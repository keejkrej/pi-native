/**
 * Widget Studio — Comprehensive UI component & perceptual color showcase for @pi-ts/gui.
 * Run:
 *   ./dist/examples/gallery
 *   ./dist/examples/gallery --headless-smoke
 *   ./dist/examples/gallery --native-smoke
 */

import {
	type A11yActionKind,
	Badge,
	Box,
	Button,
	type Color,
	CombinedAutocompleteProvider,
	clampNumber,
	colorToHex,
	Divider,
	darkGuiTheme,
	drawFocusHalo,
	drawVectorIcon,
	Editor,
	type FontFamilyId,
	GuiApp,
	type GuiA11yNode,
	GuiComponent,
	type GuiKeyEvent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiTheme,
	HStack,
	HeadlessBackend,
	Input,
	Loader,
	lightGuiTheme,
	Markdown,
	mixColors,
	okhslColor,
	oklchColor,
	type OverlayHandle,
	parseColor,
	pointInRect,
	type Rect,
	type Size,
	ScrollView,
	SegmentedControl,
	type SettingItem,
	SettingsList,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_ARROW,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
	Slider,
	Spacer,
	type StackChild,
	Switch,
	Text,
	TruncatedText,
	VectorCanvas,
	VectorIcon,
	type VectorIconName,
	type VectorPoint,
	VirtualList,
	VStack,
	withAlpha,
} from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

export type GallerySectionId =
	| "layout"
	| "text-input"
	| "buttons"
	| "selection"
	| "feedback"
	| "color-canvas"
	| "lists-data";

export interface GallerySectionSpec {
	readonly id: GallerySectionId;
	readonly title: string;
	readonly icon: VectorIconName;
	readonly eyebrow: string;
	readonly subtitle: string;
}

export const SECTIONS: readonly GallerySectionSpec[] = [
	{
		id: "layout",
		title: "Layout",
		icon: "layout",
		eyebrow: "01 · PRIMITIVES & METRICS",
		subtitle: "Single-layer surfaces, hairline dividers, elevation steps, and window telemetry.",
	},
	{
		id: "text-input",
		title: "Text & Input",
		icon: "terminal",
		eyebrow: "02 · TYPOGRAPHY & EDITING",
		subtitle: "Modular type ramp, monospace alignment, markdown rendering, and slash-command editor.",
	},
	{
		id: "buttons",
		title: "Buttons",
		icon: "send",
		eyebrow: "03 · ACTIONS & AFFORDANCE",
		subtitle: "Semantic button hierarchy, leading vector glyphs, pill geometry, and pointer focus rings.",
	},
	{
		id: "selection",
		title: "Selection",
		icon: "sliders",
		eyebrow: "04 · FORM CONTROLS",
		subtitle: "Hairline-separated switches, segmented pills, continuous sliders, and settings lists.",
	},
	{
		id: "feedback",
		title: "Feedback",
		icon: "activity",
		eyebrow: "05 · STATUS & OVERLAYS",
		subtitle: "Semantic pill badges, native vector loader animation, modal dialogs, and anchored popovers.",
	},
	{
		id: "color-canvas",
		title: "Color & Canvas",
		icon: "palette",
		eyebrow: "06 · PERCEPTUAL COLOR & 2X AA",
		subtitle: "Oklch & Okhsl uniform perceptual lightness/chroma ramps paired with 2x Retina vector rendering.",
	},
	{
		id: "lists-data",
		title: "Lists & Data",
		icon: "list",
		eyebrow: "07 · VIRTUALIZED TABLES",
		subtitle: "1,000-row virtualized viewport with alternating surface washes, monospace indices, and status pills.",
	},
];

export interface GalleryPalette {
	readonly dark: boolean;
	readonly background: Color;
	readonly sidebar: Color;
	readonly surface: Color;
	readonly surfaceElevated: Color;
	readonly inset: Color;
	readonly border: Color;
	readonly borderStrong: Color;
	readonly text: Color;
	readonly textMuted: Color;
	readonly textDim: Color;
	readonly brand: Color;
	readonly onBrand: Color;
	readonly success: Color;
	readonly warning: Color;
	readonly danger: Color;
}

const DARK_STUDIO: GalleryPalette = {
	dark: true,
	background: parseColor("#16191f"),
	sidebar: parseColor("#13161b"),
	surface: parseColor("#1f2228"),
	surfaceElevated: parseColor("#262a32"),
	inset: parseColor("#181b21"),
	border: parseColor("#2c313a"),
	borderStrong: parseColor("#3a404c"),
	text: parseColor("#f3f4f6"),
	textMuted: parseColor("#9ca3af"),
	textDim: parseColor("#6b7280"),
	brand: parseColor("#c4ec6a"),
	onBrand: parseColor("#13160c"),
	success: parseColor("#3dd6c6"),
	warning: parseColor("#f5b041"),
	danger: parseColor("#f0607a"),
};

const LIGHT_STUDIO: GalleryPalette = {
	dark: false,
	background: parseColor("#f6f6f9"),
	sidebar: parseColor("#ecedf0"),
	surface: parseColor("#ffffff"),
	surfaceElevated: parseColor("#ffffff"),
	inset: parseColor("#f0f1f5"),
	border: parseColor("#e4e4e7"),
	borderStrong: parseColor("#d4d4d8"),
	text: parseColor("#09090b"),
	textMuted: parseColor("#71717a"),
	textDim: parseColor("#a1a1aa"),
	brand: parseColor("#18181b"),
	onBrand: parseColor("#fafafa"),
	success: parseColor("#0d9488"),
	warning: parseColor("#d97706"),
	danger: parseColor("#e11d48"),
};

function getGalleryPalette(dark: boolean): GalleryPalette {
	return dark ? DARK_STUDIO : LIGHT_STUDIO;
}

function makeGalleryGuiTheme(dark: boolean): GuiTheme {
	const p = getGalleryPalette(dark);
	const base = dark ? darkGuiTheme : lightGuiTheme;
	return {
		...base,
		dark,
		background: p.background,
		surface: p.surface,
		surfaceElevated: p.surfaceElevated,
		surfaceMuted: p.inset,
		border: p.border,
		borderFocus: p.brand,
		text: p.text,
		textMuted: p.textMuted,
		textDisabled: p.textDim,
		textOnAccent: p.onBrand,
		accent: p.brand,
		accentHover: dark ? mixColors(p.brand, p.text, 0.14) : parseColor("#27272a"),
		danger: p.danger,
		dangerHover: mixColors(p.danger, p.text, 0.14),
		success: p.success,
		warning: p.warning,
		selection: withAlpha(p.brand, dark ? 0.24 : 0.14),
		codeBackground: p.inset,
		codeText: p.text,
		link: dark ? p.brand : parseColor("#2563eb"),
		quoteBorder: p.borderStrong,
		scrollbarTrack: base.scrollbarTrack,
		scrollbarThumb: withAlpha(p.textMuted, dark ? 0.24 : 0.3),
		shadow: withAlpha(parseColor("#000000"), dark ? 0.48 : 0.12),
		fontSizeBody: 13,
		fontSizeSmall: 11,
		fontSizeCode: 12,
		fontSizeHeading: 22,
		radiusSmall: 6,
		radiusMedium: 8,
		radiusLarge: 14,
	};
}

function makeText(
	text: string,
	fontSize: number,
	color: Color,
	fontWeight = 400,
	fontFamily: FontFamilyId = SGUI_FONT_REGULAR,
): Text {
	return new Text({ text, fontSize, color, fontWeight, fontFamily });
}

export interface GalleryVirtualItem {
	readonly index: number;
	readonly node: string;
	readonly region: string;
	readonly latencyMs: number;
	readonly status: "ACTIVE" | "SYNC" | "IDLE";
}

function createVirtualItems(count: number): GalleryVirtualItem[] {
	const regions = ["us-west-2", "eu-central-1", "ap-northeast-1", "us-east-1"];
	const items: GalleryVirtualItem[] = [];
	for (let i = 0; i < count; i++) {
		const mod = i % 7;
		const status: "ACTIVE" | "SYNC" | "IDLE" = mod === 0 ? "IDLE" : mod === 2 ? "SYNC" : "ACTIVE";
		const region = regions[i % regions.length] ?? "us-west-2";
		const latencyMs = 11 + ((i * 19) % 42);
		const numStr = String(i + 1).padStart(4, "0");
		items.push({
			index: i,
			node: `node-${numStr}.telemetry.mesh`,
			region,
			latencyMs,
			status,
		});
	}
	return items;
}

/**
 * Borderless desktop sidebar navigation item with active pill wash and subtle accent rail.
 */
class SidebarNavItem extends GuiComponent {
	private spec: GallerySectionSpec;
	private active: boolean;
	private pal: GalleryPalette;
	private onSelect: (id: GallerySectionId) => void;
	private hovered: boolean;

	constructor(
		spec: GallerySectionSpec,
		active: boolean,
		pal: GalleryPalette,
		onSelect: (id: GallerySectionId) => void,
	) {
		super();
		this.spec = spec;
		this.active = active;
		this.pal = pal;
		this.onSelect = onSelect;
		this.hovered = false;
		this.focusable = true;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(120, maxWidth), height: 30 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		if (this.active) {
			const pillBg = this.pal.dark ? withAlpha(this.pal.brand, 0.13) : withAlpha(this.pal.brand, 0.08);
			ctx.fillRect(r.x, r.y, r.width, r.height, pillBg, 6);
			ctx.fillRect(r.x + 2, r.y + 7, 2.5, Math.max(4, r.height - 14), this.pal.brand, 1.5);
		} else if (this.hovered) {
			ctx.fillRect(r.x, r.y, r.width, r.height, withAlpha(this.pal.text, 0.05), 6);
		}

		if (this.isFocused()) {
			drawFocusHalo(ctx, r, 6);
		}

		const iconSize = 15;
		const iconX = r.x + 11;
		const iconY = r.y + (r.height - iconSize) * 0.5;
		const iconColor = this.active
			? this.pal.dark
				? this.pal.brand
				: this.pal.text
			: this.pal.textMuted;
		drawVectorIcon(ctx, this.spec.icon, iconX, iconY, iconSize, iconColor);

		const labelStyle = {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: 13,
			fontWeight: this.active ? 600 : 500,
		};
		const tm = ctx.measureText(labelStyle, 0, this.spec.title);
		const textX = iconX + iconSize + 9;
		const textY = r.y + (r.height - tm.lineHeight) * 0.5;
		const textColor = this.active
			? this.pal.dark
				? this.pal.brand
				: this.pal.text
			: this.hovered
				? this.pal.text
				: this.pal.textMuted;
		ctx.drawStyledText(textX, textY, Math.max(10, r.x + r.width - textX - 8), textColor, labelStyle, this.spec.title);
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		const inside = this.visible && pointInRect(event.x, event.y, this.layoutRect);
		if (event.phase === "move" || event.phase === "leave") {
			const nextHover = inside && event.phase !== "leave";
			if (nextHover !== this.hovered) {
				this.hovered = nextHover;
				this.invalidate();
			}
			return { handled: false, cursor: inside ? SGUI_CURSOR_POINTER : SGUI_CURSOR_ARROW };
		}
		if (!inside) return { handled: false };
		if (event.phase === "down") {
			ctx.requestFocus(this);
			this.onSelect(this.spec.id);
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: false };
	}

	override handleKey(event: GuiKeyEvent, _ctx: GuiRenderContext): boolean {
		if (event.phase !== "down") return false;
		if (event.key === "enter" || event.key === "space") {
			this.onSelect(this.spec.id);
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.isFocused()) flags |= SGUI_A11Y_STATE_FOCUSED;
		if (this.active) flags |= SGUI_A11Y_STATE_SELECTED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: this.spec.title,
			value: this.active ? "selected" : "",
			rect: this.layoutRect,
			stateFlags: flags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press") {
			this.onSelect(this.spec.id);
			return true;
		}
		return false;
	}
}

/**
 * Clean virtualized data-table row with alternating tint, monospace index badge, and semantic status pill.
 */
class VirtualTableRow extends GuiComponent {
	private item: GalleryVirtualItem;
	private selected: boolean;
	private pal: GalleryPalette;
	private onSelect: (index: number) => void;
	private hovered: boolean;

	constructor(
		item: GalleryVirtualItem,
		selected: boolean,
		pal: GalleryPalette,
		onSelect: (index: number) => void,
	) {
		super();
		this.item = item;
		this.selected = selected;
		this.pal = pal;
		this.onSelect = onSelect;
		this.hovered = false;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	updateRow(item: GalleryVirtualItem, selected: boolean, pal: GalleryPalette): void {
		this.item = item;
		this.selected = selected;
		this.pal = pal;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(200, maxWidth), height: 34 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		if (this.selected) {
			ctx.fillRect(r.x, r.y, r.width, r.height, withAlpha(this.pal.brand, this.pal.dark ? 0.14 : 0.08), 0);
		} else if (this.hovered) {
			ctx.fillRect(r.x, r.y, r.width, r.height, withAlpha(this.pal.text, 0.045), 0);
		} else if (this.item.index % 2 === 1) {
			ctx.fillRect(r.x, r.y, r.width, r.height, withAlpha(this.pal.border, this.pal.dark ? 0.28 : 0.35), 0);
		}
		ctx.fillRect(r.x, r.y + r.height - 1, r.width, 1, withAlpha(this.pal.border, 0.55));

		const cy = r.y + r.height * 0.5;
		const monoStyle = { fontFamily: SGUI_FONT_MONO, fontSize: 11, fontWeight: 600 };
		const bodyStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: 12.5, fontWeight: this.selected ? 600 : 500 };

		const idxStr = `#${String(this.item.index + 1).padStart(4, "0")}`;
		const idxW = 54;
		const idxH = 20;
		const idxX = r.x + 12;
		const idxY = cy - idxH * 0.5;
		ctx.fillRect(idxX, idxY, idxW, idxH, this.pal.inset, 5);
		ctx.strokeRect(idxX, idxY, idxW, idxH, this.pal.border, 1, 5);
		const idxM = ctx.measureText(monoStyle, 0, idxStr);
		ctx.drawStyledText(
			idxX + Math.max(4, (idxW - idxM.width) * 0.5),
			cy - idxM.lineHeight * 0.5,
			idxW - 6,
			this.selected ? (this.pal.dark ? this.pal.brand : this.pal.text) : this.pal.textMuted,
			monoStyle,
			idxStr,
		);

		const badgeW = 66;
		const latW = 64;
		const zoneW = 114;
		const rightStart = r.x + r.width - 14 - badgeW - latW - zoneW - 12;
		const nodeX = idxX + idxW + 12;
		const nodeW = Math.max(60, rightStart - nodeX - 8);
		const nodeM = ctx.measureText(bodyStyle, 0, this.item.node);
		ctx.drawStyledText(nodeX, cy - nodeM.lineHeight * 0.5, nodeW, this.pal.text, bodyStyle, this.item.node);

		const zoneM = ctx.measureText(monoStyle, 0, this.item.region);
		ctx.drawStyledText(rightStart, cy - zoneM.lineHeight * 0.5, zoneW, this.pal.textMuted, monoStyle, this.item.region);

		const latStr = `${this.item.latencyMs} ms`;
		const latM = ctx.measureText(monoStyle, 0, latStr);
		ctx.drawStyledText(rightStart + zoneW, cy - latM.lineHeight * 0.5, latW, this.pal.text, monoStyle, latStr);

		const tone =
			this.item.status === "ACTIVE"
				? this.pal.success
				: this.item.status === "SYNC"
					? this.pal.warning
					: this.pal.textMuted;
		const pillW = badgeW - 6;
		const pillH = 20;
		const pillX = r.x + r.width - 14 - pillW;
		const pillY = cy - pillH * 0.5;
		ctx.fillRect(pillX, pillY, pillW, pillH, withAlpha(tone, this.pal.dark ? 0.16 : 0.11), pillH * 0.5);
		ctx.strokeRect(pillX, pillY, pillW, pillH, withAlpha(tone, this.pal.dark ? 0.34 : 0.24), 1, pillH * 0.5);
		const stStyle = { fontFamily: SGUI_FONT_MONO, fontSize: 9.5, fontWeight: 700 };
		const stM = ctx.measureText(stStyle, 0, this.item.status);
		ctx.drawStyledText(
			pillX + Math.max(4, (pillW - stM.width) * 0.5),
			cy - stM.lineHeight * 0.5,
			pillW - 6,
			tone,
			stStyle,
			this.item.status,
		);
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		const inside = this.visible && pointInRect(event.x, event.y, this.layoutRect);
		if (event.phase === "move" || event.phase === "leave") {
			const nextHover = inside && event.phase !== "leave";
			if (nextHover !== this.hovered) {
				this.hovered = nextHover;
				this.invalidate();
			}
			return { handled: false, cursor: inside ? SGUI_CURSOR_POINTER : SGUI_CURSOR_ARROW };
		}
		if (inside && event.phase === "down") {
			this.onSelect(this.item.index);
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: false };
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		out.push({
			id: this.a11yId,
			role: "button",
			label: `${this.item.node} ${this.item.status}`,
			value: `${this.item.region} ${this.item.latencyMs}ms`,
			rect: this.layoutRect,
			stateFlags: SGUI_A11Y_STATE_ENABLED | (this.selected ? SGUI_A11Y_STATE_SELECTED : 0),
		});
	}

	override handleAccessibilityAction(nodeId: number, action: A11yActionKind, _v: string, _ctx: GuiRenderContext): boolean {
		if (nodeId !== this.a11yId || action !== "press") return false;
		this.onSelect(this.item.index);
		return true;
	}
}

export interface GalleryStateSnapshot {
	readonly dark: boolean;
	readonly activeSection: GallerySectionId;
	readonly sidebarQuery: string;
	readonly clickCount: number;
	readonly switchTelemetry: boolean;
	readonly switchMotion: boolean;
	readonly density: string;
	readonly opacityPct: number;
	readonly loaderRunning: boolean;
	readonly overlayStatus: string;
	readonly hueDeg: number;
	readonly chroma: number;
	readonly selectedRow: number;
	readonly virtualCount: number;
	readonly clipboardStatus: string;
}

export interface GalleryController {
	readonly app: GuiApp;
	readonly windowTitle: string;
	getState(): GalleryStateSnapshot;
	selectSection(id: GallerySectionId): void;
	toggleTheme(): void;
}

export function createGalleryApp(backendArg?: HeadlessBackend | ReturnType<typeof createNativeBackend>): GalleryController {
	let dark = true;
	let activeSection: GallerySectionId = "layout";
	let sidebarQuery = "";
	let clickCount = 0;
	let inputSample = "studio.token.accent";
	let editorSample = "Type /theme or /layout to test autocomplete\n";
	let switchTelemetry = true;
	let switchMotion = true;
	let density = "balanced";
	let opacityPct = 82;
	let loaderRunning = true;
	let overlayStatus = "No active overlay";
	let activeOverlay: OverlayHandle | undefined = undefined;
	let hueDeg = 98;
	let chroma = 0.16;
	let selectedRow = 0;
	let clipboardStatus = "Idle";

	const virtualItems = createVirtualItems(1000);
	const settingItems: SettingItem[] = [
		{ id: "aa", label: "2x Retina AA Rasterizer", description: "Porter-Duff straight-alpha upsampling", currentValue: "Enabled", values: ["Enabled", "Disabled"] },
		{ id: "snap", label: "Pixel Spine Alignment", description: "Snap section columns to integer grid", currentValue: "Strict", values: ["Strict", "Fluid"] },
		{ id: "telemetry", label: "Focus Halo Contrast", description: "Outer 3px ring alpha intensity", currentValue: "Standard", values: ["Subtle", "Standard", "High"] },
	];

	const slashProvider = new CombinedAutocompleteProvider([
		{ name: "theme", description: "Toggle studio dark or light theme" },
		{ name: "layout", description: "Jump to Layout showcase" },
		{ name: "color", description: "Inspect Oklch & Okhsl swatches" },
		{ name: "help", description: "List keyboard shortcuts" },
	]);

	const backend = backendArg ?? createNativeBackend();

	const rootBox = new Box({
		fillWidth: true,
		background: DARK_STUDIO.background,
	});
	const app = new GuiApp({
		backend,
		window: {
			title: "Widget Studio · @pi-ts/gui",
			width: 1080,
			height: 760,
			resizable: true,
			titlebarHidden: true,
			unifiedTitlebar: true,
		},
		theme: makeGalleryGuiTheme(dark),
		root: rootBox,
	});

	let popoverAnchorBtn: Button | undefined = undefined;
	let virtualListRef: VirtualList<GalleryVirtualItem> | undefined = undefined;

	function findSectionSpec(id: GallerySectionId): GallerySectionSpec {
		for (let i = 0; i < SECTIONS.length; i++) {
			const s = SECTIONS[i];
			if (s !== undefined && s.id === id) return s;
		}
		return SECTIONS[0] as GallerySectionSpec;
	}

	function makeSpecimenCard(
		title: string,
		caption: string,
		pal: GalleryPalette,
		body: GuiComponent,
		rightControl?: GuiComponent,
	): Box {
		const headerLeft = new VStack({
			gap: 2,
			children: [
				makeText(title, 14, pal.text, 600),
				makeText(caption, 12, pal.textMuted, 400),
			],
		});
		const headerChildren: StackChild[] = [{ child: headerLeft, grow: 1 }];
		if (rightControl !== undefined) {
			headerChildren.push({ child: rightControl, shrink: 0 });
		}
		return new Box({
			fillWidth: true,
			background: pal.surface,
			borderColor: pal.border,
			borderWidth: 1,
			radius: 14,
			padding: 20,
			shadow: pal.dark ? false : "sm",
			child: new VStack({
				gap: 14,
				children: [
					new HStack({ gap: 12, align: "center", children: headerChildren }),
					new Divider({ color: pal.border }),
					body,
				],
			}),
		});
	}

	function makeKeyValueRow(label: string, value: string, pal: GalleryPalette, tone?: Color): HStack {
		return new HStack({
			gap: 12,
			align: "center",
			padding: { vertical: 7, horizontal: 2 },
			children: [
				{ child: makeText(label, 12.5, pal.textMuted, 500), grow: 1 },
				{ child: makeText(value, 12, tone ?? pal.text, 600, SGUI_FONT_MONO), shrink: 0 },
			],
		});
	}

	function buildLayoutSection(pal: GalleryPalette): StackChild[] {
		const elevationTile = (name: string, detail: string, shadow: "sm" | "md" | "lg", bg: Color): Box =>
			new Box({
				fillWidth: true,
				background: bg,
				borderColor: pal.border,
				borderWidth: 1,
				radius: 10,
				padding: 14,
				shadow,
				child: new VStack({
					gap: 4,
					children: [
						makeText(name, 11.5, pal.text, 700, SGUI_FONT_MONO),
						makeText(detail, 12, pal.textMuted, 400),
					],
				}),
			});

		const surfaceCard = makeSpecimenCard(
			"Surface elevation & hairline dividers",
			"Flat architectural cards using surface contrast and 1px hairlines rather than nested boxes",
			pal,
			new VStack({
				gap: 16,
				children: [
					new HStack({
						gap: 12,
						align: "stretch",
						children: [
							{ child: elevationTile("shadow: \"sm\"", "Primary studio card", "sm", pal.inset), grow: 1 },
							{ child: elevationTile("shadow: \"md\"", "Floating popover layer", "md", pal.surfaceElevated), grow: 1 },
							{ child: elevationTile("shadow: \"lg\"", "Modal sheet elevation", "lg", pal.surfaceElevated), grow: 1 },
						],
					}),
					new Divider({ color: pal.border }),
					new HStack({
						gap: 14,
						align: "center",
						children: [
							{ child: makeText("Left spine", 11, pal.textMuted, 400, SGUI_FONT_MONO), shrink: 0 },
							{ child: new Divider({ direction: "vertical", length: 18, color: pal.borderStrong }), shrink: 0 },
							{ child: makeText("Center column", 11, pal.textMuted, 400, SGUI_FONT_MONO), grow: 1 },
							{ child: new Divider({ direction: "vertical", length: 18, color: pal.borderStrong }), shrink: 0 },
							{ child: new Badge({ label: "780px MAX COLUMN", variant: "accent", fontSize: 10 }), shrink: 0 },
						],
					}),
				],
			}),
		);

		const m = app.getWindowMetrics();
		const metricsCard = makeSpecimenCard(
			"Window telemetry & clipboard bridge",
			"Live Cocoa backing-store metrics and native NSPasteboard copy/read test",
			pal,
			new VStack({
				gap: 0,
				children: [
					makeKeyValueRow("Runtime Platform", `${process.platform} (${process.arch})`, pal),
					new Divider({ color: pal.border }),
					makeKeyValueRow("Window Viewport", `${m.width} x ${m.height} pt`, pal),
					new Divider({ color: pal.border }),
					makeKeyValueRow("Display Scale Factor", `${m.scale.toFixed(1)}x Retina`, pal, pal.brand),
					new Divider({ color: pal.border }),
					makeKeyValueRow("Clipboard Status", clipboardStatus, pal),
					new Divider({ color: pal.border }),
					new Box({
						fillWidth: true,
						padding: { top: 12 },
						child: new HStack({
							gap: 10,
							align: "center",
							children: [
								new Button({
									label: "Copy Sample",
									leadingIcon: "folder",
									variant: "primary",
									onClick: () => {
										app.backend.setClipboardText("@pi-ts/gui-gallery-clipboard");
										clipboardStatus = "Copied sample text";
										rebuildUi();
									},
								}),
								new Button({
									label: "Read Clipboard",
									leadingIcon: "terminal",
									variant: "secondary",
									onClick: () => {
										const clip = app.backend.getClipboardText();
										clipboardStatus = clip.length > 0 ? `Read (${clip.length} chars): ${clip}` : "Clipboard empty";
										rebuildUi();
									},
								}),
							],
						}),
					}),
				],
			}),
		);

		return [surfaceCard, metricsCard];
	}

	function buildTextInputSection(pal: GalleryPalette): StackChild[] {
		const typeCard = makeSpecimenCard(
			"Modular type scale & truncation",
			"Native CoreText fonts with tabular monospace numerals and explicit middle/end ellipsis",
			pal,
			new VStack({
				gap: 10,
				children: [
					makeText("Display Title · 22px Semibold", 22, pal.text, 700),
					makeText("Section Heading · 18px Medium", 18, pal.text, 600),
					makeText("Body Copy · 13px crisp optical spacing for dense desktop reading.", 13, pal.textMuted, 400),
					makeText(
						"MONOSPACE TABULAR · 0123456789 · #C4EC6A · 1920x1080@2x",
						12,
						pal.dark ? pal.brand : pal.text,
						600,
						SGUI_FONT_MONO,
					),
					new Divider({ color: pal.border }),
					new Box({
						width: 280,
						padding: { horizontal: 10, vertical: 8 },
						background: pal.inset,
						borderColor: pal.border,
						borderWidth: 1,
						radius: 8,
						child: new TruncatedText({
							text: "Very long workspace telemetry identifier string that truncates gracefully with ellipsis",
							fontSize: 12.5,
							color: pal.text,
						}),
					}),
				],
			}),
		);

		const markdownCard = makeSpecimenCard(
			"Markdown document renderer",
			"Structured headings, inline code spans, and list blocks inside a single studio card",
			pal,
			new Markdown({
				text: "### Studio Specification\nUse **clear hierarchy** and `1px` hairlines for dense desktop inspectors.\n- Consistent alignment spines\n- Concentric corner radii (`outer - padding = inner`)\n- Tabular figures for live telemetry",
			}),
		);

		const inputCard = makeSpecimenCard(
			"Single-line input & slash-command editor",
			"Recessed well styling with brand focus halo, undo/redo, and slash command suggestions",
			pal,
			new VStack({
				gap: 12,
				children: [
					new HStack({
						gap: 12,
						align: "center",
						children: [
							{
								child: new Input({
									value: inputSample,
									placeholder: "Enter design token path...",
									fontFamily: SGUI_FONT_MONO,
									onChange: (val) => {
										inputSample = val;
									},
									onSubmit: () => rebuildUi(),
								}),
								grow: 1,
							},
							{
								child: new Badge({
									label: `${inputSample.length} chars`,
									variant: "neutral",
								}),
								shrink: 0,
							},
						],
					}),
					new Divider({ color: pal.border }),
					new Editor({
						initialValue: editorSample,
						minHeight: 88,
						autocompleteProvider: slashProvider,
						onChange: (val) => {
							editorSample = val;
						},
					}),
				],
			}),
		);

		return [typeCard, markdownCard, inputCard];
	}

	function buildButtonsSection(pal: GalleryPalette): StackChild[] {
		const countBadge = new Badge({
			label: `${clickCount} ${clickCount === 1 ? "press" : "presses"}`,
			variant: clickCount > 0 ? "accent" : "neutral",
		});

		const buttonsCard = makeSpecimenCard(
			"Semantic button hierarchy",
			"Restrained brand primary fill paired with secondary, borderless ghost, danger, and pill controls",
			pal,
			new VStack({
				gap: 14,
				children: [
					new HStack({
						gap: 10,
						align: "center",
						children: [
							new Button({
								label: "Primary Action",
								leadingIcon: "sparkles",
								variant: "primary",
								fontWeight: 600,
								onClick: () => {
									clickCount += 1;
									rebuildUi();
								},
							}),
							new Button({
								label: "Secondary",
								variant: "secondary",
								onClick: () => {
									clickCount += 1;
									rebuildUi();
								},
							}),
							new Button({
								label: "Ghost",
								leadingIcon: "sliders",
								variant: "ghost",
								onClick: () => {
									clickCount += 1;
									rebuildUi();
								},
							}),
							new Button({
								label: "Destructive",
								leadingIcon: "trash",
								variant: "danger",
								onClick: () => {
									clickCount = 0;
									rebuildUi();
								},
							}),
						],
					}),
					new Divider({ color: pal.border }),
					new HStack({
						gap: 10,
						align: "center",
						children: [
							new Button({
								label: "Pill CTA",
								leadingIcon: "rocket",
								variant: "primary",
								pill: true,
								onClick: () => {
									clickCount += 1;
									rebuildUi();
								},
							}),
							new Button({
								label: "Disabled State",
								variant: "secondary",
								disabled: true,
							}),
							new Button({
								label: "Reset Counter",
								leadingIcon: "reset",
								variant: "ghost",
								onClick: () => {
									clickCount = 0;
									rebuildUi();
								},
							}),
						],
					}),
				],
			}),
			countBadge,
		);

		return [buttonsCard];
	}

	function buildSelectionSection(pal: GalleryPalette): StackChild[] {
		const rowSwitch = (
			title: string,
			desc: string,
			checked: boolean,
			onChange?: (b: boolean) => void,
			disabled = false,
		): HStack =>
			new HStack({
				gap: 12,
				align: "center",
				padding: { vertical: 8, horizontal: 2 },
				children: [
					{
						child: new VStack({
							gap: 2,
							children: [
								makeText(title, 13, disabled ? pal.textDim : pal.text, 600),
								makeText(desc, 12, pal.textMuted, 400),
							],
						}),
						grow: 1,
					},
					{
						child: new Switch({
							checked,
							disabled,
							label: title,
							onChange,
						}),
						shrink: 0,
					},
				],
			});

		const controlsCard = makeSpecimenCard(
			"Switches, segmented pills & continuous sliders",
			"Clean flat rows separated by 1px dividers — zero cards nested inside cards",
			pal,
			new VStack({
				gap: 0,
				children: [
					rowSwitch(
						"Telemetry capture",
						"Record frame latency and CoreText cache hit counters",
						switchTelemetry,
						(val) => {
							switchTelemetry = val;
							rebuildUi();
						},
					),
					new Divider({ color: pal.border }),
					rowSwitch(
						"Smooth animations",
						"Enable spring curves for overlays and state transitions",
						switchMotion,
						(val) => {
							switchMotion = val;
							rebuildUi();
						},
					),
					new Divider({ color: pal.border }),
					rowSwitch("Locked studio invariant", "Hardware-backed 2x Retina backing surface", true, undefined, true),
					new Divider({ color: pal.border }),
					new HStack({
						gap: 12,
						align: "center",
						padding: { vertical: 10, horizontal: 2 },
						children: [
							{ child: makeText("Interface density", 13, pal.text, 600), grow: 1 },
							{
								child: new SegmentedControl({
									items: [
										{ id: "compact", label: "Compact" },
										{ id: "balanced", label: "Balanced" },
										{ id: "spacious", label: "Spacious" },
									],
									selectedId: density,
									label: "Interface density",
									onChange: (id) => {
										density = id;
										rebuildUi();
									},
								}),
								shrink: 0,
							},
						],
					}),
					new Divider({ color: pal.border }),
					new HStack({
						gap: 12,
						align: "center",
						padding: { vertical: 10, horizontal: 2 },
						children: [
							{ child: makeText("Layer opacity", 13, pal.text, 600), shrink: 0 },
							{
								child: new Slider({
									min: 10,
									max: 100,
									step: 1,
									value: opacityPct,
									label: "Layer opacity",
									showValue: false,
									width: 240,
									onChange: (v) => {
										opacityPct = Math.round(v);
										rebuildUi();
									},
								}),
								grow: 1,
							},
							{
								child: makeText(`${opacityPct}%`, 12, pal.dark ? pal.brand : pal.text, 700, SGUI_FONT_MONO),
								shrink: 0,
							},
						],
					}),
				],
			}),
		);

		const settingsCard = makeSpecimenCard(
			"Keyboard-navigable settings list",
			"Up/Down arrow selection and Space/Enter cycling across discrete option arrays",
			pal,
			new SettingsList({
				items: settingItems,
				maxVisible: 4,
				rowHeight: 42,
				enableSearch: false,
				onChange: (_id, _val) => rebuildUi(),
			}),
		);

		return [controlsCard, settingsCard];
	}

	function closeActiveOverlay(): void {
		if (activeOverlay !== undefined) {
			activeOverlay.hide();
			activeOverlay = undefined;
		}
	}

	function openModalOverlay(): void {
		closeActiveOverlay();
		const pal = getGalleryPalette(dark);
		const content = new Box({
			background: pal.surfaceElevated,
			borderColor: pal.borderStrong,
			borderWidth: 1,
			radius: 14,
			padding: 20,
			child: new VStack({
				gap: 14,
				children: [
					new HStack({
						gap: 10,
						align: "center",
						children: [
							new VectorIcon({ name: "info", size: 18, color: pal.brand }),
							makeText("Publish Studio Token Snapshot?", 15, pal.text, 700),
						],
					}),
					makeText(
						"Dialog layers render above a subtle backdrop scrim with multi-layer CoreGraphics drop shadows.",
						13,
						pal.textMuted,
						400,
					),
					new HStack({
						gap: 10,
						align: "center",
						children: [
							{ child: new Spacer(0, 0), grow: 1 },
							{
								child: new Button({
									label: "Cancel",
									variant: "ghost",
									onClick: () => {
										overlayStatus = "Modal cancelled";
										closeActiveOverlay();
										rebuildUi();
									},
								}),
								shrink: 0,
							},
							{
								child: new Button({
									label: "Confirm Snapshot",
									variant: "primary",
									onClick: () => {
										overlayStatus = "Modal confirmed";
										closeActiveOverlay();
										rebuildUi();
									},
								}),
								shrink: 0,
							},
						],
					}),
				],
			}),
		});

		activeOverlay = app.showOverlay(content, {
			anchor: "center",
			width: 380,
			modal: true,
			radius: 14,
			shadow: "lg",
			onDismiss: () => {
				activeOverlay = undefined;
			},
		});
		overlayStatus = "Modal open";
		rebuildUi();
	}

	function openPopoverOverlay(): void {
		closeActiveOverlay();
		const pal = getGalleryPalette(dark);
		const anchorRect = popoverAnchorBtn?.layoutRect;
		const menu = new Box({
			background: pal.surfaceElevated,
			borderColor: pal.borderStrong,
			borderWidth: 1,
			radius: 10,
			padding: 8,
			child: new VStack({
				gap: 4,
				children: [
					new Button({
						label: "Inspect Accessibility Tree",
						leadingIcon: "search",
						variant: "ghost",
						onClick: () => {
							overlayStatus = "Selected: Inspect A11y";
							closeActiveOverlay();
							rebuildUi();
						},
					}),
					new Button({
						label: "Export 2x PNG Asset…",
						leadingIcon: "sparkles",
						variant: "ghost",
						onClick: () => {
							overlayStatus = "Selected: Export 2x PNG";
							closeActiveOverlay();
							rebuildUi();
						},
					}),
				],
			}),
		});

		activeOverlay = app.showOverlay(menu, {
			anchor: anchorRect !== undefined ? "bottom-left" : "top-center",
			anchorRect,
			offsetY: 6,
			width: 240,
			modal: false,
			radius: 10,
			shadow: "md",
			onDismiss: () => {
				activeOverlay = undefined;
			},
		});
		overlayStatus = "Popover open";
		rebuildUi();
	}

	function buildFeedbackSection(pal: GalleryPalette): StackChild[] {
		const badgesCard = makeSpecimenCard(
			"Semantic pill badges & vector loader",
			"Compact 999px status pills paired with live vector spinner animation",
			pal,
			new VStack({
				gap: 14,
				children: [
					new HStack({
						gap: 8,
						align: "center",
						children: [
							new Badge({ label: "NEUTRAL", variant: "neutral" }),
							new Badge({ label: "BRAND ACCENT", variant: "accent", leadingIcon: "sparkles" }),
							new Badge({ label: "NOMINAL", variant: "success", leadingIcon: "check" }),
							new Badge({ label: "CAUTION", variant: "warning", leadingIcon: "info" }),
							new Badge({ label: "CRITICAL", variant: "danger", leadingIcon: "alert" }),
						],
					}),
					new Divider({ color: pal.border }),
					new HStack({
						gap: 12,
						align: "center",
						children: [
							new Loader({
								running: loaderRunning,
								message: loaderRunning ? "Streaming 2x Retina telemetry..." : "Telemetry paused",
							}),
							new Spacer(0, 0),
							new Button({
								label: loaderRunning ? "Pause Loader" : "Resume Loader",
								leadingIcon: loaderRunning ? "stop" : "activity",
								variant: "secondary",
								onClick: () => {
									loaderRunning = !loaderRunning;
									rebuildUi();
								},
							}),
						],
					}),
				],
			}),
		);

		popoverAnchorBtn = new Button({
			label: "Show Popover…",
			leadingIcon: "menu",
			variant: "secondary",
			onClick: () => openPopoverOverlay(),
		});

		const overlaysCard = makeSpecimenCard(
			"Modal dialog & anchored popover overlays",
			"Focused backdrop sheet and anchor-relative menu layers managed by GuiApp",
			pal,
			new HStack({
				gap: 12,
				align: "center",
				children: [
					new Button({
						label: "Open Modal…",
						leadingIcon: "sparkles",
						variant: "primary",
						onClick: () => openModalOverlay(),
					}),
					popoverAnchorBtn,
					new Badge({ label: overlayStatus, variant: "neutral" }),
				],
			}),
		);

		return [badgesCard, overlaysCard];
	}

	function buildColorCanvasSection(pal: GalleryPalette): StackChild[] {
		const activeOklch = oklchColor(0.74, chroma, hueDeg);
		const hexReadout = colorToHex(activeOklch);

		const oklchRampCanvas = new VectorCanvas({
			fillWidth: true,
			height: 62,
			radius: 10,
			background: pal.inset,
			borderColor: pal.border,
			label: "Oklch perceptual lightness ramp",
			value: hexReadout,
			render: (surface, rect) => {
				const steps = 10;
				const pad = 8;
				const gap = 6;
				const cellW = Math.max(12, (rect.width - pad * 2 - gap * (steps - 1)) / steps);
				const cellH = Math.max(20, rect.height - pad * 2);
				for (let i = 0; i < steps; i++) {
					const l = 0.28 + (i / (steps - 1)) * 0.64;
					const c = oklchColor(l, chroma, hueDeg);
					const x = pad + i * (cellW + gap);
					surface.fillRoundedRect(x, pad, cellW, cellH, 6, c);
				}
			},
		});

		const okhslRampCanvas = new VectorCanvas({
			fillWidth: true,
			height: 62,
			radius: 10,
			background: pal.inset,
			borderColor: pal.border,
			label: "Okhsl uniform saturation ramp",
			value: `Hue ${hueDeg} deg`,
			render: (surface, rect) => {
				const steps = 10;
				const pad = 8;
				const gap = 6;
				const cellW = Math.max(12, (rect.width - pad * 2 - gap * (steps - 1)) / steps);
				const cellH = Math.max(20, rect.height - pad * 2);
				for (let i = 0; i < steps; i++) {
					const s = 0.08 + (i / (steps - 1)) * 0.88;
					const c = okhslColor(hueDeg, s, 0.64);
					const x = pad + i * (cellW + gap);
					surface.fillRoundedRect(x, pad, cellW, cellH, 6, c);
				}
			},
		});

		const paletteCard = makeSpecimenCard(
			"Perceptual Oklch & Okhsl spectrum ramps",
			"Uniform perceptual lightness (Oklch) and saturation (Okhsl) swatches updated live",
			pal,
			new VStack({
				gap: 12,
				children: [
					new HStack({
						gap: 14,
						align: "center",
						children: [
							{ child: makeText("Hue", 12.5, pal.text, 600), shrink: 0 },
							{
								child: new Slider({
									min: 0,
									max: 360,
									step: 2,
									value: hueDeg,
									label: "Perceptual hue degrees",
									showValue: false,
									width: 190,
									onChange: (v) => {
										hueDeg = Math.round(v);
										rebuildUi();
									},
								}),
								grow: 1,
							},
							{ child: makeText("Chroma", 12.5, pal.text, 600), shrink: 0 },
							{
								child: new Slider({
									min: 0.04,
									max: 0.24,
									step: 0.01,
									value: chroma,
									label: "Perceptual chroma",
									showValue: false,
									width: 150,
									onChange: (v) => {
										chroma = Number(v.toFixed(2));
										rebuildUi();
									},
								}),
								grow: 1,
							},
						],
					}),
					makeText("OKLCH · PERCEPTUAL LIGHTNESS STEP (L = 0.28 -> 0.92)", 10.5, pal.textMuted, 600, SGUI_FONT_MONO),
					oklchRampCanvas,
					makeText("OKHSL · UNIFORM CHROMA & HUE RAMP (S = 0.08 -> 0.96)", 10.5, pal.textMuted, 600, SGUI_FONT_MONO),
					okhslRampCanvas,
				],
			}),
			new Badge({
				label: `${hueDeg}° · ${hexReadout.toUpperCase()}`,
				background: withAlpha(activeOklch, 0.2),
				textColor: pal.text,
				borderColor: withAlpha(activeOklch, 0.5),
			}),
		);

		const vectorArtCanvas = new VectorCanvas({
			fillWidth: true,
			height: 214,
			radius: 10,
			background: pal.inset,
			borderColor: pal.border,
			label: "2x Retina anti-aliased vector studio artwork",
			value: `Hue ${hueDeg}°`,
			render: (surface, rect) => {
				const dialCx = Math.min(130, rect.width * 0.23);
				const dialCy = rect.height * 0.5;
				const ringSpecs: { r: number; w: number; sweep: number; hueShift: number; l: number }[] = [
					{ r: 72, w: 9, sweep: Math.PI * 1.48, hueShift: 0, l: 0.78 },
					{ r: 54, w: 9, sweep: Math.PI * 1.18, hueShift: 38, l: 0.72 },
					{ r: 36, w: 9, sweep: Math.PI * 1.66, hueShift: -36, l: 0.8 },
				];
				for (let i = 0; i < ringSpecs.length; i++) {
					const spec = ringSpecs[i];
					if (spec === undefined) continue;
					surface.strokeCircle(dialCx, dialCy, spec.r, spec.w, withAlpha(pal.borderStrong, 0.45));
					const col = oklchColor(spec.l, chroma + 0.03, (hueDeg + spec.hueShift + 360) % 360);
					const startA = -Math.PI * 0.72 + i * 0.3;
					surface.drawArc(dialCx, dialCy, spec.r, startA, startA + spec.sweep, spec.w, col, true);
				}
				surface.fillCircle(dialCx, dialCy, 11, activeOklch);
				surface.strokeCircle(dialCx, dialCy, 15, 1.5, withAlpha(pal.text, 0.25));

				const chartX = dialCx + 104;
				const chartW = Math.max(120, rect.width - chartX - 24);
				const chartTop = 26;
				const chartH = rect.height - 52;
				const baseY = chartTop + chartH;

				for (let g = 0; g <= 4; g++) {
					const gy = chartTop + (g / 4) * chartH;
					surface.drawLineAA(chartX, gy, chartX + chartW, gy, 1, withAlpha(pal.borderStrong, 0.45), false);
				}

				const pts: VectorPoint[] = [];
				const samples = 80;
				const phaseRad = (hueDeg / 360) * Math.PI * 2;
				for (let i = 0; i <= samples; i++) {
					const u = i / samples;
					const px = chartX + u * chartW;
					const yNorm =
						0.48 +
						Math.sin(u * Math.PI * 3.1 + phaseRad) * 0.24 +
						Math.cos(u * Math.PI * 5.6 - phaseRad * 0.5) * 0.12;
					const py = chartTop + chartH * (1 - clampNumber(yNorm, 0.08, 0.94));
					pts.push({ x: px, y: py });
				}
				surface.fillAreaCurve(pts, baseY, withAlpha(activeOklch, 0.34), withAlpha(activeOklch, 0.02));
				surface.drawPolylineAA(pts, 2.4, activeOklch, false);

				const peakPt = pts[Math.floor(samples * 0.62)];
				if (peakPt !== undefined) {
					surface.drawLineAA(peakPt.x, chartTop, peakPt.x, baseY, 1, withAlpha(pal.text, 0.3), false);
					surface.fillCircle(peakPt.x, peakPt.y, 7.5, withAlpha(activeOklch, 0.28));
					surface.fillCircle(peakPt.x, peakPt.y, 4.2, activeOklch);
					surface.strokeCircle(peakPt.x, peakPt.y, 4.2, 1.4, pal.surface);
				}
			},
		});

		const canvasCard = makeSpecimenCard(
			"2x Retina anti-aliased vector canvas",
			"Porter-Duff straight-alpha arcs, rotated-grid MSAA area curves, and distance-field strokes",
			pal,
			vectorArtCanvas,
		);

		return [paletteCard, canvasCard];
	}

	function buildListsDataSection(pal: GalleryPalette): StackChild[] {
		const jumpTo = (idx: number): void => {
			selectedRow = clampNumber(idx, 0, virtualItems.length - 1);
			virtualListRef?.scrollToIndex(selectedRow, "center");
			rebuildUi();
		};

		const selectedItem = virtualItems[selectedRow] ?? virtualItems[0];
		const list = new VirtualList<GalleryVirtualItem>({
			items: virtualItems,
			estimatedItemHeight: 34,
			gap: 0,
			overscan: 6,
			renderItem: (item, _idx, existing) => {
				if (existing instanceof VirtualTableRow) {
					existing.updateRow(item, item.index === selectedRow, pal);
					return existing;
				}
				return new VirtualTableRow(item, item.index === selectedRow, pal, (picked) => {
					selectedRow = picked;
					rebuildUi();
				});
			},
			keyFn: (item) => String(item.index),
		});
		virtualListRef = list;

		const colHeader = new Box({
			fillWidth: true,
			background: pal.inset,
			padding: { horizontal: 14, vertical: 8 },
			child: new HStack({
				gap: 10,
				align: "center",
				children: [
					{ child: makeText("INDEX    NODE IDENTIFIER", 10, pal.textDim, 700, SGUI_FONT_MONO), grow: 1 },
					{ child: makeText("ZONE           LATENCY     STATE", 10, pal.textDim, 700, SGUI_FONT_MONO), shrink: 0 },
				],
			}),
		});

		const tableFrame = new Box({
			fillWidth: true,
			height: 356,
			background: pal.surface,
			borderColor: pal.border,
			borderWidth: 1,
			radius: 10,
			clip: true,
			child: new VStack({
				gap: 0,
				children: [
					{ child: colHeader, shrink: 0 },
					{ child: new Divider({ color: pal.border }), shrink: 0 },
					{ child: list, grow: 1 },
				],
			}),
		});

		const listCard = makeSpecimenCard(
			"Virtualized 1,000-row telemetry table",
			"O(1) viewport layout measuring only visible rows plus 6-row overscan buffer",
			pal,
			new VStack({
				gap: 12,
				children: [
					new HStack({
						gap: 8,
						align: "center",
						children: [
							new Button({ label: "Jump Top", variant: "secondary", onClick: () => jumpTo(0) }),
							new Button({ label: "Jump #500", variant: "secondary", onClick: () => jumpTo(499) }),
							new Button({ label: "Jump #1000", variant: "secondary", onClick: () => jumpTo(999) }),
							new Spacer(0, 0),
							new Badge({
								label: selectedItem !== undefined ? `Selected #${selectedItem.index + 1}` : "None",
								variant: "accent",
							}),
						],
					}),
					tableFrame,
				],
			}),
			new Badge({ label: `${virtualItems.length} ROWS`, variant: "neutral" }),
		);

		return [listCard];
	}

	function buildSidebar(pal: GalleryPalette): Box {
		const brandIconBox = new Box({
			width: 28,
			height: 28,
			radius: 7,
			background: pal.brand,
			padding: 6,
			child: new VectorIcon({ name: "sparkles", size: 16, color: pal.onBrand }),
		});

		const brandHeader = new HStack({
			gap: 10,
			align: "center",
			padding: { horizontal: 4, bottom: 4 },
			children: [
				{ child: brandIconBox, shrink: 0 },
				{
					child: new VStack({
						gap: 1,
						children: [
							makeText("Widget Studio", 13.5, pal.text, 700),
							makeText("@pi-ts/gui · native", 10.5, pal.textMuted, 400, SGUI_FONT_MONO),
						],
					}),
					grow: 1,
				},
			],
		});

		const filterInput = new Input({
			value: sidebarQuery,
			placeholder: "Filter categories...",
			fontSize: 12,
			padding: { vertical: 6, horizontal: 9 },
			onChange: (val) => {
				sidebarQuery = val;
				rebuildUi();
			},
		});

		const q = sidebarQuery.trim().toLowerCase();
		const navChildren: StackChild[] = [];
		for (let i = 0; i < SECTIONS.length; i++) {
			const spec = SECTIONS[i];
			if (spec === undefined) continue;
			if (q.length > 0 && !spec.title.toLowerCase().includes(q) && !spec.eyebrow.toLowerCase().includes(q)) {
				continue;
			}
			navChildren.push(
				new SidebarNavItem(spec, spec.id === activeSection, pal, (id) => {
					activeSection = id;
					rebuildUi();
				}),
			);
		}

		const footer = new VStack({
			gap: 8,
			children: [
				new Divider({ color: pal.border }),
				new Button({
					label: "Toggle Theme",
					leadingIcon: dark ? "sun" : "moon",
					variant: "ghost",
					onClick: () => toggleTheme(),
				}),
				makeText(dark ? "Appearance: Studio Dark" : "Appearance: Studio Light", 10.5, pal.textDim, 400, SGUI_FONT_MONO),
			],
		});

		return new Box({
			width: 216,
			background: pal.sidebar,
			padding: { horizontal: 12, vertical: 16 },
			child: new VStack({
				gap: 10,
				children: [
					{ child: brandHeader, shrink: 0 },
					{ child: filterInput, shrink: 0 },
					{ child: makeText("SECTIONS", 10, pal.textDim, 700, SGUI_FONT_MONO), shrink: 0 },
					{ child: new VStack({ gap: 2, children: navChildren }), shrink: 0 },
					{ child: new Spacer(0, 0), grow: 1 },
					{ child: footer, shrink: 0 },
				],
			}),
		});
	}

	function buildStageContent(pal: GalleryPalette): GuiComponent {
		const spec = findSectionSpec(activeSection);
		let specimens: StackChild[];
		switch (activeSection) {
			case "layout":
				specimens = buildLayoutSection(pal);
				break;
			case "text-input":
				specimens = buildTextInputSection(pal);
				break;
			case "buttons":
				specimens = buildButtonsSection(pal);
				break;
			case "selection":
				specimens = buildSelectionSection(pal);
				break;
			case "feedback":
				specimens = buildFeedbackSection(pal);
				break;
			case "color-canvas":
				specimens = buildColorCanvasSection(pal);
				break;
			case "lists-data":
				specimens = buildListsDataSection(pal);
				break;
		}

		const headerBlock = new VStack({
			gap: 8,
			children: [
				new HStack({
					gap: 10,
					align: "center",
					children: [
						new Badge({ label: spec.eyebrow, variant: "accent", fontSize: 10 }),
						new Spacer(0, 0),
						makeText(dark ? "DARK" : "LIGHT", 10, pal.textDim, 600, SGUI_FONT_MONO),
					],
				}),
				makeText(spec.title, 22, pal.text, 700),
				makeText(spec.subtitle, 13, pal.textMuted, 400),
				new Box({ fillWidth: true, padding: { top: 4 }, child: new Divider({ color: pal.border }) }),
			],
		});

		const stackChildren: StackChild[] = [headerBlock];
		for (let i = 0; i < specimens.length; i++) {
			const item = specimens[i];
			if (item !== undefined) stackChildren.push(item);
		}
		return new Box({
			maxWidth: 780,
			fillWidth: true,
			alignHorizontal: "center",
			padding: { horizontal: 30, vertical: 26 },
			child: new VStack({
				gap: 18,
				children: stackChildren,
			}),
		});
	}

	function rebuildUi(): void {
		const pal = getGalleryPalette(dark);
		app.setTheme(makeGalleryGuiTheme(dark));
		rootBox.setBackground(pal.background);

		const stageScroll = new ScrollView({
			primary: true,
			background: pal.background,
			overscroll: "contain",
			padding: 0,
			child: buildStageContent(pal),
		});

		const shell = new HStack({
			gap: 0,
			align: "stretch",
			children: [
				{ child: buildSidebar(pal), shrink: 0 },
				{ child: new Divider({ direction: "vertical", color: pal.border }), shrink: 0 },
				{ child: stageScroll, grow: 1 },
			],
		});

		rootBox.setChild(shell);
		app.invalidate();
	}

	function selectSection(id: GallerySectionId): void {
		activeSection = id;
		rebuildUi();
	}

	function toggleTheme(): void {
		dark = !dark;
		rebuildUi();
	}

	rebuildUi();

	return {
		app,
		windowTitle: "Widget Studio · @pi-ts/gui",
		getState: (): GalleryStateSnapshot => ({
			dark,
			activeSection,
			sidebarQuery,
			clickCount,
			switchTelemetry,
			switchMotion,
			density,
			opacityPct,
			loaderRunning,
			overlayStatus,
			hueDeg,
			chroma,
			selectedRow,
			virtualCount: virtualItems.length,
			clipboardStatus,
		}),
		selectSection,
		toggleTheme,
	};
}

function findBtn(backend: HeadlessBackend, windowId: number, label: string): { id: number; rect: Rect } | undefined {
	const tree = backend.getAccessibilityTree(windowId);
	for (let i = 0; i < tree.length; i++) {
		const entry = tree[i];
		if (entry !== undefined && entry.role === "button" && entry.label === label) {
			return { id: entry.id, rect: entry.rect };
		}
	}
	return undefined;
}

function runHeadlessSmoke(): number {
	const backend = new HeadlessBackend({ width: 1080, height: 760 });
	const ctrl = createGalleryApp(backend);
	const winId = ctrl.app.windowId;
	try {
		ctrl.app.renderFrame();

		for (let i = 0; i < SECTIONS.length; i++) {
			const spec = SECTIONS[i];
			if (spec === undefined) continue;
			const navBtn = findBtn(backend, winId, spec.title);
			if (navBtn === undefined) {
				console.log(`Gallery headless smoke FAILED: missing sidebar nav "${spec.title}"`);
				return 1;
			}
			backend.triggerA11yPress(navBtn.id, winId);
			ctrl.app.step();
			if (ctrl.getState().activeSection !== spec.id) {
				console.log(`Gallery headless smoke FAILED: did not activate "${spec.id}"`);
				return 1;
			}
		}

		const buttonsNav = findBtn(backend, winId, "Buttons");
		if (buttonsNav !== undefined) {
			backend.triggerA11yPress(buttonsNav.id, winId);
			ctrl.app.step();
		}
		const primaryBtn = findBtn(backend, winId, "Primary Action");
		if (primaryBtn === undefined) {
			console.log("Gallery headless smoke FAILED: missing Primary Action button");
			return 1;
		}
		backend.triggerA11yPress(primaryBtn.id, winId);
		ctrl.app.step();

		const layoutNav = findBtn(backend, winId, "Layout");
		if (layoutNav !== undefined) {
			backend.triggerA11yPress(layoutNav.id, winId);
			ctrl.app.step();
		}
		const copyBtn = findBtn(backend, winId, "Copy Sample");
		if (copyBtn === undefined) {
			console.log("Gallery headless smoke FAILED: missing Copy Sample button");
			return 1;
		}
		backend.triggerA11yPress(copyBtn.id, winId);
		ctrl.app.step();

		const themeBtn = findBtn(backend, winId, "Toggle Theme");
		if (themeBtn === undefined) {
			console.log("Gallery headless smoke FAILED: missing Toggle Theme button");
			return 1;
		}
		backend.triggerA11yPress(themeBtn.id, winId);
		ctrl.app.step();

		const s = ctrl.getState();
		const clip = ctrl.app.backend.getClipboardText();
		const ok =
			s.activeSection === "layout" &&
			!s.dark &&
			s.clickCount === 1 &&
			s.virtualCount === 1000 &&
			clip === "@pi-ts/gui-gallery-clipboard";

		console.log(
			`Gallery headless smoke ok=${String(ok)} clicks=${String(s.clickCount)} dark=${String(s.dark)} clip=${clip} a11y=${String(backend.getAccessibilityTree(winId).length)}`,
		);
		return ok ? 0 : 1;
	} finally {
		ctrl.app.dispose();
	}
}

function runNativeSmoke(): number {
	const ctrl = createGalleryApp();
	try {
		ctrl.app.renderFrame();
		for (let i = 0; i < SECTIONS.length; i++) {
			const spec = SECTIONS[i];
			if (spec !== undefined) {
				ctrl.selectSection(spec.id);
				ctrl.app.renderFrame();
			}
		}
		ctrl.toggleTheme();
		const frame = ctrl.app.renderFrame();

		const metrics = ctrl.app.getWindowMetrics();
		const state = ctrl.getState();
		const ok = frame.byteLength > 0 && metrics.width > 0 && metrics.height > 0 && state.virtualCount === 1000 && !state.dark;
		console.log(
			`Gallery native smoke ok=${String(ok)} window=${String(metrics.width)}x${String(metrics.height)} frameBytes=${String(frame.byteLength)}`,
		);
		return ok ? 0 : 1;
	} finally {
		ctrl.app.dispose();
	}
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.includes("--headless-smoke")) {
		process.exitCode = runHeadlessSmoke();
		return;
	}
	if (argv.includes("--native-smoke")) {
		process.exitCode = runNativeSmoke();
		return;
	}

	const ctrl = createGalleryApp();
	try {
		await ctrl.app.run();
	} finally {
		ctrl.app.dispose();
	}
}

void main();
