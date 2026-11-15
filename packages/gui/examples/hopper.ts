/**
 * Hopper Lab — Aerospace GNC Telemetry & Flight Planner showcase for scriptc-ui.
 * Run:
 *   ./dist/examples/hopper
 *   ./dist/examples/hopper --headless-smoke
 *   ./dist/examples/hopper --native-smoke
 */

import {
	type A11yActionKind,
	Badge,
	type BadgeVariant,
	Box,
	Button,
	type Color,
	clampNumber,
	Divider,
	darkGuiTheme,
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
	lightGuiTheme,
	mixColors,
	parseColor,
	pointInRect,
	type Rect,
	RasterSurface,
	type Size,
	ScrollView,
	SegmentedControl,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_ARROW,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
	Slider,
	type StackChild,
	Switch,
	Text,
	VectorIcon,
	type VectorIconName,
	type VectorPoint,
	VStack,
	withAlpha,
} from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

export type HopOutcome = "nominal" | "hard" | "abort";
export type HopperTab = "flights" | "plan" | "vehicle";
export type HopperRoute = "tabs" | "log";
export type LogFilter = "all" | HopOutcome;
export type FlightPhase = "ascent" | "hover" | "translate" | "descend";
export type EasingKind = "linear" | "bezier" | "outQuint" | "spring";

export interface HopRecord {
	readonly id: string;
	readonly num: number;
	readonly apogeeM: number;
	readonly peakTiltDeg: number;
	readonly durationS: number;
	readonly padOffsetM: number;
	readonly touchdownX: number;
	readonly touchdownY: number;
	readonly outcome: HopOutcome;
	readonly note: string;
	readonly ageLabel: string;
}

export interface DispersionDot {
	readonly xM: number;
	readonly yM: number;
	readonly outcome: HopOutcome;
	readonly hopNum: number;
}

export interface RcsQuadState {
	readonly id: string;
	readonly label: string;
	readonly axis: string;
	readonly angleRad: number;
	readonly healthPct: number;
	readonly degraded: boolean;
	armed: boolean;
}

export interface FlightPlanState {
	phase: FlightPhase;
	easing: EasingKind;
	ascentThrottle: number;
	hoverThrottle: number;
	translateThrottle: number;
	descendThrottle: number;
	hoverDurationS: number;
	gimbalLimitDeg: number;
	targetX: number;
	targetY: number;
	targetZ: number;
	autoLevelTrim: boolean;
	rcsRollHold: boolean;
	abortOnTilt: boolean;
}

export interface HopperPalette {
	readonly dark: boolean;
	readonly page: Color;
	readonly card: Color;
	readonly inset: Color;
	readonly raised: Color;
	readonly line: Color;
	readonly lineStrong: Color;
	readonly grid: Color;
	readonly ink: Color;
	readonly muted: Color;
	readonly dim: Color;
	readonly accent: Color;
	readonly onAccent: Color;
	readonly caution: Color;
	readonly alert: Color;
	readonly barNeutral: Color;
}

const DARK_PALETTE: HopperPalette = {
	dark: true,
	page: parseColor("#0d1014"),
	card: parseColor("#151a20"),
	inset: parseColor("#10141a"),
	raised: parseColor("#1d232b"),
	line: parseColor("#242b34"),
	lineStrong: parseColor("#323b46"),
	grid: parseColor("#1a2028"),
	ink: parseColor("#edf1f7"),
	muted: parseColor("#7c8796"),
	dim: parseColor("#4c5563"),
	accent: parseColor("#3dd6c6"),
	onAccent: parseColor("#081716"),
	caution: parseColor("#f5b041"),
	alert: parseColor("#f0607a"),
	barNeutral: parseColor("#3f4a57"),
};

const LIGHT_PALETTE: HopperPalette = {
	dark: false,
	page: parseColor("#f2f5f8"),
	card: parseColor("#ffffff"),
	inset: parseColor("#f6f8fb"),
	raised: parseColor("#eef2f6"),
	line: parseColor("#dde3ec"),
	lineStrong: parseColor("#c5cedc"),
	grid: parseColor("#e4ebf2"),
	ink: parseColor("#11161d"),
	muted: parseColor("#5c6776"),
	dim: parseColor("#8a94a3"),
	accent: parseColor("#0d9488"),
	onAccent: parseColor("#ffffff"),
	caution: parseColor("#d97706"),
	alert: parseColor("#e11d48"),
	barNeutral: parseColor("#cbd5e1"),
};

function getPalette(dark: boolean): HopperPalette {
	return dark ? DARK_PALETTE : LIGHT_PALETTE;
}

function makeHopperGuiTheme(dark: boolean): GuiTheme {
	const p = getPalette(dark);
	const base = dark ? darkGuiTheme : lightGuiTheme;
	return {
		dark,
		background: p.page,
		surface: p.card,
		surfaceElevated: p.raised,
		surfaceMuted: p.inset,
		border: p.line,
		borderFocus: p.accent,
		text: p.ink,
		textMuted: p.muted,
		textDisabled: p.dim,
		textOnAccent: p.onAccent,
		accent: p.accent,
		accentHover: mixColors(p.accent, p.ink, 0.16),
		danger: p.alert,
		dangerHover: mixColors(p.alert, p.ink, 0.14),
		success: p.accent,
		warning: p.caution,
		selection: withAlpha(p.accent, dark ? 0.24 : 0.16),
		codeBackground: p.inset,
		codeText: p.ink,
		link: p.accent,
		quoteBorder: p.lineStrong,
		scrollbarTrack: base.scrollbarTrack,
		scrollbarThumb: withAlpha(p.muted, dark ? 0.28 : 0.34),
		shadow: withAlpha(parseColor("#000000"), dark ? 0.52 : 0.14),
		fontSizeBody: 13,
		fontSizeSmall: 11,
		fontSizeCode: 12,
		fontSizeHeading: 18,
		radiusSmall: 8,
		radiusMedium: 12,
		radiusLarge: 20,
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

const TARGET_CEILING_M = 150;
const NOMINAL_TARGET_M = 100;
const HOVER_THROTTLE_FLOOR = 62;
const TILT_CORRIDOR_DEG = 5.0;
const MAX_TILT_PLOT_DEG = 9.0;
const MAX_TAKEOFF_MASS_KG = 720;

function nextSeeded(state: { seed: number }): number {
	let t = (state.seed + 0x6d2b79f5) | 0;
	state.seed = t;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function createInitialHops(): HopRecord[] {
	const rng = { seed: 4219 };
	const out: HopRecord[] = [];
	const notesNominal = [
		"Vertical hover & center capture",
		"Wind-compensated pad descent",
		"Nominal GNC closed-loop",
		"Crossrange step & capture",
	];
	for (let i = 1; i <= 40; i++) {
		const isAbort = i === 17 || i === 31;
		const isHard = i === 6 || i === 23;
		const outcome: HopOutcome = isAbort ? "abort" : isHard ? "hard" : "nominal";
		const u1 = nextSeeded(rng);
		const u2 = nextSeeded(rng);
		const u3 = nextSeeded(rng);
		const angle = u1 * Math.PI * 2;
		const radialBase = outcome === "abort" ? 2.6 + u2 * 0.9 : outcome === "hard" ? 1.85 + u2 * 0.75 : 0.25 + u2 * 1.15;
		const tx = Math.cos(angle) * radialBase;
		const ty = Math.sin(angle) * radialBase;
		const apogee =
			outcome === "abort"
				? 64 + u3 * 22
				: outcome === "hard"
					? 104 + u3 * 14
					: 93 + (u3 - 0.5) * 14 + (i > 28 ? 3 : 0);
		const tilt = outcome === "abort" ? 7.2 + u2 * 1.6 : outcome === "hard" ? 5.1 + u3 * 0.9 : 1.6 + u3 * 2.4;
		const dur = outcome === "abort" ? 14.2 + u2 * 4 : 22.8 + u3 * 2.4;
		const ageMins = (41 - i) * 6;
		const ageLabel = ageMins < 60 ? `${ageMins}m ago` : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m`;
		const note =
			outcome === "abort"
				? "Roll excursion FTS cutoff"
				: outcome === "hard"
					? "Downrange gust TD > 2.2 m/s"
					: (notesNominal[i % notesNominal.length] ?? "Nominal flight");
		out.push({
			id: i < 10 ? `H-0${i}` : `H-${i}`,
			num: i,
			apogeeM: Number(apogee.toFixed(1)),
			peakTiltDeg: Number(tilt.toFixed(1)),
			durationS: Number(dur.toFixed(1)),
			padOffsetM: Number(Math.hypot(tx, ty).toFixed(2)),
			touchdownX: Number(tx.toFixed(2)),
			touchdownY: Number(ty.toFixed(2)),
			outcome,
			note,
			ageLabel,
		});
	}
	return out;
}

function createInitialScatter(hops: readonly HopRecord[]): DispersionDot[] {
	const dots: DispersionDot[] = [];
	const rng = { seed: 9173 };
	for (let i = 0; i < hops.length; i++) {
		const h = hops[i];
		if (h !== undefined) {
			dots.push({ xM: h.touchdownX, yM: h.touchdownY, outcome: h.outcome, hopNum: h.num });
		}
	}
	for (let i = 0; i < 42; i++) {
		const u1 = Math.max(1e-6, nextSeeded(rng));
		const u2 = nextSeeded(rng);
		const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
		const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
		const xM = clampNumber(z0 * 0.85, -3.2, 3.2);
		const yM = clampNumber(z1 * 0.85, -3.2, 3.2);
		const r = Math.hypot(xM, yM);
		const outcome: HopOutcome = r > 2.65 ? "abort" : r > 1.75 ? "hard" : "nominal";
		dots.push({ xM, yM, outcome, hopNum: 0 });
	}
	return dots;
}

function sampleTiltAt(t: number): number {
	const base =
		Math.sin(t * 0.72) * 1.45 +
		Math.cos(t * 1.45 - 0.6) * 0.95 +
		Math.exp(-((t - 10.6) * (t - 10.6)) / 3.1) * 4.15 -
		Math.exp(-((t - 17.4) * (t - 17.4)) / 2.2) * 2.15;
	return Number(clampNumber(base, -8.2, 8.2).toFixed(2));
}

function buildGimbalTrace(): number[] {
	const bars: number[] = [];
	for (let i = 0; i < 48; i++) {
		const t = i * 0.5;
		const cmd = Math.sin(t * 0.88 + 0.4) * 3.1 + Math.exp(-((t - 10.6) * (t - 10.6)) / 3.2) * 3.4;
		bars.push(clampNumber(cmd, -7.5, 7.5));
	}
	return bars;
}

function evalEasing(mode: EasingKind, rawU: number): number {
	const u = clampNumber(rawU, 0, 1);
	switch (mode) {
		case "linear":
			return u;
		case "bezier":
			return u * u * (3 - 2 * u);
		case "outQuint": {
			const inv = 1 - u;
			return 1 - inv * inv * inv * inv * inv;
		}
		case "spring":
			return 1 - Math.exp(-5.4 * u) * Math.cos(u * Math.PI * 2.4);
	}
}

function evalThrottleAt(plan: FlightPlanState, tSec: number): number {
	const totalH = plan.hoverDurationS;
	const ascendEnd = 5.0;
	const hoverEnd = ascendEnd + Math.max(4, totalH);
	const transEnd = hoverEnd + 4.0;
	const descendEnd = 24.0;
	const e = plan.easing;

	if (tSec <= ascendEnd) {
		const u = evalEasing(e, tSec / ascendEnd);
		return 38 + (plan.ascentThrottle - 38) * u;
	}
	if (tSec <= hoverEnd) {
		const u = evalEasing(e, (tSec - ascendEnd) / Math.max(0.5, hoverEnd - ascendEnd));
		return plan.ascentThrottle + (plan.hoverThrottle - plan.ascentThrottle) * u;
	}
	if (tSec <= transEnd) {
		const u = evalEasing(e, (tSec - hoverEnd) / 4.0);
		return plan.hoverThrottle + (plan.translateThrottle - plan.hoverThrottle) * u;
	}
	const u = evalEasing(e, (tSec - transEnd) / Math.max(1, descendEnd - transEnd));
	return plan.translateThrottle + (plan.descendThrottle - plan.translateThrottle) * u;
}

function outcomeColor(outcome: HopOutcome, pal: HopperPalette): Color {
	if (outcome === "abort") return pal.alert;
	if (outcome === "hard") return pal.caution;
	return pal.accent;
}

function outcomeLabel(outcome: HopOutcome): string {
	if (outcome === "abort") return "ABORT";
	if (outcome === "hard") return "HARD";
	return "NOMINAL";
}

function outcomeBadgeVariant(outcome: HopOutcome): BadgeVariant {
	if (outcome === "abort") return "danger";
	if (outcome === "hard") return "warning";
	return "success";
}

function defaultFlightPlan(): FlightPlanState {
	return {
		phase: "ascent",
		easing: "bezier",
		ascentThrottle: 84,
		hoverThrottle: 64,
		translateThrottle: 71,
		descendThrottle: 48,
		hoverDurationS: 9,
		gimbalLimitDeg: 8,
		targetX: 4,
		targetY: -2,
		targetZ: 100,
		autoLevelTrim: true,
		rcsRollHold: true,
		abortOnTilt: true,
	};
}

function createInitialRcsQuads(): RcsQuadState[] {
	return [
		{ id: "Q1", label: "Q1 · FWD PITCH", axis: "+X PITCH", angleRad: -Math.PI * 0.5, healthPct: 98, degraded: false, armed: true },
		{ id: "Q2", label: "Q2 · STBD ROLL", axis: "+Y ROLL", angleRad: 0, healthPct: 96, degraded: false, armed: true },
		{ id: "Q3", label: "Q3 · AFT PITCH", axis: "-X PITCH", angleRad: Math.PI * 0.5, healthPct: 72, degraded: true, armed: true },
		{ id: "Q4", label: "Q4 · PORT ROLL", axis: "-Y ROLL", angleRad: Math.PI, healthPct: 97, degraded: false, armed: true },
	];
}

/**
 * Custom 2x Retina Vector view with post-blit CoreText annotations and interactive pointer handlers.
 */
class TelemetryChartView extends GuiComponent {
	private heightValue: number;
	private backgroundColor: Color | undefined;
	private borderColorValue: Color | undefined;
	private radiusValue: number;
	private labelText: string;
	private valueText: string;
	private surface: RasterSurface | undefined;
	private onDraw: (surface: RasterSurface, localRect: Rect, ctx: GuiRenderContext) => void;
	private onPostBlit: ((rect: Rect, ctx: GuiRenderContext) => void) | undefined;
	private onPointerHandler: ((event: GuiPointerEvent, rect: Rect) => boolean) | undefined;
	private onIncrementHandler: (() => void) | undefined;
	private onDecrementHandler: (() => void) | undefined;

	constructor(options: {
		readonly height: number;
		readonly background?: Color;
		readonly borderColor?: Color;
		readonly radius?: number;
		readonly label: string;
		readonly value?: string;
		readonly focusable?: boolean;
		readonly cursor?: typeof SGUI_CURSOR_ARROW | typeof SGUI_CURSOR_POINTER;
		readonly onDraw: (surface: RasterSurface, localRect: Rect, ctx: GuiRenderContext) => void;
		readonly onPostBlit?: (rect: Rect, ctx: GuiRenderContext) => void;
		readonly onPointer?: (event: GuiPointerEvent, rect: Rect) => boolean;
		readonly onIncrement?: () => void;
		readonly onDecrement?: () => void;
	}) {
		super();
		this.heightValue = options.height;
		this.backgroundColor = options.background;
		this.borderColorValue = options.borderColor;
		this.radiusValue = options.radius ?? 10;
		this.labelText = options.label;
		this.valueText = options.value ?? "";
		this.focusable = options.focusable ?? false;
		this.cursor = options.cursor ?? SGUI_CURSOR_ARROW;
		this.onDraw = options.onDraw;
		this.onPostBlit = options.onPostBlit;
		this.onPointerHandler = options.onPointer;
		this.onIncrementHandler = options.onIncrement;
		this.onDecrementHandler = options.onDecrement;
		this.surface = undefined;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const h = maxHeight !== undefined ? Math.min(maxHeight, this.heightValue) : this.heightValue;
		return { width: Math.max(80, maxWidth), height: Math.max(40, h) };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		if (this.backgroundColor !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, this.backgroundColor, this.radiusValue);
		}
		const targetW = Math.max(1, Math.round(r.width));
		const targetH = Math.max(1, Math.round(r.height));
		if (this.surface === undefined || this.surface.width !== targetW || this.surface.height !== targetH) {
			this.surface = new RasterSurface(targetW, targetH, 2);
		}
		this.surface.clear();
		this.onDraw(this.surface, { x: 0, y: 0, width: r.width, height: r.height }, ctx);
		this.surface.blit(ctx, r.x, r.y, this.radiusValue, r.width, r.height);

		if (this.onPostBlit !== undefined) {
			this.onPostBlit(r, ctx);
		}
		if (this.borderColorValue !== undefined) {
			ctx.strokeRect(r.x, r.y, r.width, r.height, this.borderColorValue, 1, this.radiusValue);
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (!this.visible || !pointInRect(event.x, event.y, this.layoutRect)) {
			return { handled: false };
		}
		if (this.onPointerHandler !== undefined) {
			const handled = this.onPointerHandler(event, this.layoutRect);
			return {
				handled,
				focus: handled && this.focusable ? this : undefined,
				cursor: this.cursor,
			};
		}
		return { handled: false };
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.focusable && this.isFocused()) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "group",
			label: this.labelText,
			value: this.valueText,
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
		if (nodeId !== this.a11yId || !this.visible) return false;
		if (action === "focus" && this.focusable) {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "increment" && this.onIncrementHandler !== undefined) {
			this.onIncrementHandler();
			return true;
		}
		if (action === "decrement" && this.onDecrementHandler !== undefined) {
			this.onDecrementHandler();
			return true;
		}
		return false;
	}
}

/**
 * Hairline-separated interactive flight log row component with accessibility support.
 */
class LogTableRow extends GuiComponent {
	private hop: HopRecord;
	private selected: boolean;
	private pal: HopperPalette;
	private onSelect: (num: number) => void;
	private hovered: boolean;

	constructor(hop: HopRecord, selected: boolean, pal: HopperPalette, onSelect: (num: number) => void) {
		super();
		this.hop = hop;
		this.selected = selected;
		this.pal = pal;
		this.onSelect = onSelect;
		this.hovered = false;
		this.focusable = true;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		return { width: Math.max(200, maxWidth), height: 42 };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		if (this.selected) {
			ctx.fillRect(r.x, r.y, r.width, r.height, withAlpha(this.pal.accent, this.pal.dark ? 0.14 : 0.1), 8);
			ctx.strokeRect(r.x, r.y, r.width, r.height, withAlpha(this.pal.accent, 0.35), 1, 8);
		} else if (this.hovered) {
			ctx.fillRect(r.x, r.y, r.width, r.height, withAlpha(this.pal.ink, 0.04), 8);
		}

		const cy = r.y + r.height * 0.5;
		const monoIdStyle = { fontFamily: SGUI_FONT_MONO, fontSize: 12, fontWeight: 700 };
		const bodyStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: 12.5, fontWeight: 500 };
		const monoNumStyle = { fontFamily: SGUI_FONT_MONO, fontSize: 12, fontWeight: 600 };
		const dimStyle = { fontFamily: SGUI_FONT_MONO, fontSize: 10.5, fontWeight: 500 };

		const padX = 12;
		const idColor = this.selected ? this.pal.accent : this.pal.ink;
		const idM = ctx.measureText(monoIdStyle, 0, this.hop.id);
		ctx.drawStyledText(r.x + padX, cy - idM.lineHeight * 0.5, 56, idColor, monoIdStyle, this.hop.id);

		const badgeW = 76;
		const ageW = 58;
		const colOffsetW = 64;
		const colTiltW = 56;
		const colApogeeW = 68;
		const rightStart = r.x + r.width - padX - badgeW - ageW - colOffsetW - colTiltW - colApogeeW - 16;
		const noteX = r.x + padX + 58;
		const noteW = Math.max(60, rightStart - noteX - 10);
		const noteM = ctx.measureText(bodyStyle, 0, this.hop.note);
		ctx.drawStyledText(noteX, cy - noteM.lineHeight * 0.5, noteW, this.pal.muted, bodyStyle, this.hop.note);

		let cx = Math.max(noteX + 70, rightStart);
		const apogeeStr = `${this.hop.apogeeM.toFixed(1)} m`;
		const apogeeM = ctx.measureText(monoNumStyle, 0, apogeeStr);
		ctx.drawStyledText(cx, cy - apogeeM.lineHeight * 0.5, colApogeeW, this.pal.ink, monoNumStyle, apogeeStr);
		cx += colApogeeW;

		const tiltStr = `${this.hop.peakTiltDeg.toFixed(1)}°`;
		const tiltColor = this.hop.peakTiltDeg > TILT_CORRIDOR_DEG ? this.pal.alert : this.pal.ink;
		const tiltM = ctx.measureText(monoNumStyle, 0, tiltStr);
		ctx.drawStyledText(cx, cy - tiltM.lineHeight * 0.5, colTiltW, tiltColor, monoNumStyle, tiltStr);
		cx += colTiltW;

		const offStr = `${this.hop.padOffsetM.toFixed(2)} m`;
		const offM = ctx.measureText(monoNumStyle, 0, offStr);
		ctx.drawStyledText(cx, cy - offM.lineHeight * 0.5, colOffsetW, this.pal.ink, monoNumStyle, offStr);
		cx += colOffsetW;

		const ageM = ctx.measureText(dimStyle, 0, this.hop.ageLabel);
		ctx.drawStyledText(cx, cy - ageM.lineHeight * 0.5, ageW, this.pal.dim, dimStyle, this.hop.ageLabel);

		const tone = outcomeColor(this.hop.outcome, this.pal);
		const pillW = badgeW - 6;
		const pillH = 22;
		const pillX = r.x + r.width - padX - pillW;
		const pillY = cy - pillH * 0.5;
		ctx.fillRect(pillX, pillY, pillW, pillH, withAlpha(tone, this.pal.dark ? 0.16 : 0.11), pillH * 0.5);
		ctx.strokeRect(pillX, pillY, pillW, pillH, withAlpha(tone, this.pal.dark ? 0.35 : 0.25), 1, pillH * 0.5);
		const statusStr = outcomeLabel(this.hop.outcome);
		const pillStyle = { fontFamily: SGUI_FONT_MONO, fontSize: 10, fontWeight: 700 };
		const pillM = ctx.measureText(pillStyle, 0, statusStr);
		ctx.drawStyledText(
			pillX + Math.max(4, (pillW - pillM.width) * 0.5),
			cy - pillM.lineHeight * 0.5,
			pillW - 8,
			tone,
			pillStyle,
			statusStr,
		);
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
			this.onSelect(this.hop.num);
			return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: false };
	}

	override handleKey(event: GuiKeyEvent, _ctx: GuiRenderContext): boolean {
		if (event.phase !== "down") return false;
		if (event.key === "enter" || event.key === "space") {
			this.onSelect(this.hop.num);
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let flags = SGUI_A11Y_STATE_ENABLED;
		if (this.isFocused()) flags |= SGUI_A11Y_STATE_FOCUSED;
		if (this.selected) flags |= SGUI_A11Y_STATE_SELECTED;
		out.push({
			id: this.a11yId,
			role: "button",
			label: `${this.hop.id} ${outcomeLabel(this.hop.outcome)} ${this.hop.apogeeM.toFixed(1)}m`,
			value: this.hop.note,
			rect: this.layoutRect,
			stateFlags: flags,
		});
	}

	override handleAccessibilityAction(nodeId: number, action: A11yActionKind, _v: string, ctx: GuiRenderContext): boolean {
		if (nodeId !== this.a11yId) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press") {
			this.onSelect(this.hop.num);
			return true;
		}
		return false;
	}
}

export interface HopperAppStateSnapshot {
	readonly dark: boolean;
	readonly route: HopperRoute;
	readonly activeTab: HopperTab;
	readonly hopCount: number;
	readonly selectedHopNum: number;
	readonly latestHopId: string;
	readonly selectedQuad: string;
	readonly dryMassKg: number;
	readonly propMassKg: number;
	readonly lastLaunchSummary: string;
}

export interface HopperController {
	readonly app: GuiApp;
	readonly windowTitle: string;
	getState(): HopperAppStateSnapshot;
	selectTab(tab: HopperTab): void;
	openLog(): void;
	goBack(): void;
	flyHop(): void;
	toggleTheme(): void;
	resetPlan(): void;
}

function drawDashedLine(
	surface: RasterSurface,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	dashLen: number,
	gapLen: number,
	lw: number,
	color: Color,
): void {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const dist = Math.hypot(dx, dy);
	if (dist <= 0.5) return;
	const ux = dx / dist;
	const uy = dy / dist;
	let pos = 0;
	while (pos < dist) {
		const end = Math.min(dist, pos + dashLen);
		surface.drawLineAA(x1 + ux * pos, y1 + uy * pos, x1 + ux * end, y1 + uy * end, lw, color, true);
		pos += dashLen + gapLen;
	}
}

function drawDashedCircle(
	surface: RasterSurface,
	cx: number,
	cy: number,
	radius: number,
	segments: number,
	lw: number,
	color: Color,
): void {
	const step = (Math.PI * 2) / segments;
	for (let i = 0; i < segments; i++) {
		const a0 = i * step;
		const a1 = a0 + step * 0.54;
		surface.drawArc(cx, cy, radius, a0, a1, lw, color, true);
	}
}

export function createHopperApp(backendArg?: HeadlessBackend | ReturnType<typeof createNativeBackend>): HopperController {
	const hops = createInitialHops();
	let scatterDots = createInitialScatter(hops);
	const gimbalBars = buildGimbalTrace();
	const rcsQuads = createInitialRcsQuads();
	let plan = defaultFlightPlan();

	let dark = true;
	let route: HopperRoute = "tabs";
	let activeTab: HopperTab = "flights";
	let logFilter: LogFilter = "all";
	let selectedHopNum = hops[hops.length - 1]?.num ?? 40;
	let padSafeRadiusM = 2.0;
	let scrubTimeS = 10.6;
	let dryMassKg = 412;
	let propMassKg = 216;
	let selectedQuadId = "Q3";
	let lastLaunchSummary = "Standby · GNC loop locked for H-41";

	const backend = backendArg ?? createNativeBackend();

	const rootBox = new Box({
		fillWidth: true,
		background: DARK_PALETTE.page,
	});
	const app = new GuiApp({
		backend,
		window: {
			title: "Hopper Lab · GNC Telemetry",
			width: 1040,
			height: 780,
			resizable: true,
			titlebarHidden: true,
			unifiedTitlebar: true,
		},
		theme: makeHopperGuiTheme(dark),
		root: rootBox,
	});

	function getSelectedHop(): HopRecord {
		for (let i = 0; i < hops.length; i++) {
			const h = hops[i];
			if (h !== undefined && h.num === selectedHopNum) return h;
		}
		return hops[hops.length - 1] as HopRecord;
	}

	function latestHop(): HopRecord {
		return hops[hops.length - 1] as HopRecord;
	}

	function makeBadge(label: string, variant: BadgeVariant): Badge {
		return new Badge({
			label,
			variant,
			fontSize: 10,
			fontWeight: 700,
			padding: { vertical: 3, horizontal: 9 },
			radius: 999,
		});
	}

	function makeDoubleBezelCard(options: {
		readonly pal: HopperPalette;
		readonly icon: VectorIconName;
		readonly iconColor?: Color;
		readonly title: string;
		readonly subtitle: string;
		readonly badgeLabel: string;
		readonly badgeVariant: BadgeVariant;
		readonly trailingAction?: GuiComponent;
		readonly body: GuiComponent;
	}): Box {
		const p = options.pal;
		const iconTile = new Box({
			width: 38,
			height: 38,
			radius: 11,
			background: p.raised,
			borderColor: p.lineStrong,
			borderWidth: 1,
			padding: 9,
			child: new VectorIcon({
				name: options.icon,
				size: 18,
				color: options.iconColor ?? p.accent,
				label: options.title,
			}),
		});

		const titleStack = new VStack({
			gap: 2,
			children: [
				makeText(options.title, 15, p.ink, 700),
				makeText(options.subtitle, 12, p.muted, 400),
			],
		});

		const headerChildren: StackChild[] = [
			{ child: iconTile, shrink: 0 },
			{ child: titleStack, grow: 1 },
			{ child: makeBadge(options.badgeLabel, options.badgeVariant), shrink: 0 },
		];
		if (options.trailingAction !== undefined) {
			headerChildren.push({ child: options.trailingAction, shrink: 0 });
		}

		const headerRow = new Box({
			fillWidth: true,
			padding: { horizontal: 13, top: 11, bottom: 9 },
			child: new HStack({
				gap: 12,
				align: "center",
				children: headerChildren,
			}),
		});

		const insetWell = new Box({
			fillWidth: true,
			background: p.inset,
			borderColor: p.line,
			borderWidth: 1,
			radius: 15,
			padding: 16,
			child: options.body,
		});

		return new Box({
			fillWidth: true,
			background: p.card,
			borderColor: p.line,
			borderWidth: 1,
			radius: 20,
			padding: 5,
			shadow: "sm",
			child: new VStack({
				gap: 0,
				children: [headerRow, insetWell],
			}),
		});
	}

	function makeMetricTile(label: string, value: string, pal: HopperPalette, tone?: Color): Box {
		return new Box({
			fillWidth: true,
			background: pal.raised,
			borderColor: pal.line,
			borderWidth: 1,
			radius: 10,
			padding: { horizontal: 12, vertical: 9 },
			child: new VStack({
				gap: 3,
				children: [
					makeText(label, 10, pal.muted, 600, SGUI_FONT_MONO),
					makeText(value, 16, tone ?? pal.ink, 700, SGUI_FONT_MONO),
				],
			}),
		});
	}

	function makeSafeguardRow(
		title: string,
		desc: string,
		checked: boolean,
		pal: HopperPalette,
		onChange: (next: boolean) => void,
		badgeText?: string,
		badgeVariant?: BadgeVariant,
	): HStack {
		const left = new VStack({
			gap: 2,
			children: [
				makeText(title, 13, pal.ink, 600),
				makeText(desc, 11.5, pal.muted, 400),
			],
		});
		const items: StackChild[] = [{ child: left, grow: 1 }];
		if (badgeText !== undefined) {
			items.push({ child: makeBadge(badgeText, badgeVariant ?? "neutral"), shrink: 0 });
		}
		items.push({
			child: new Switch({
				checked,
				label: title,
				onChange,
			}),
			shrink: 0,
		});
		return new HStack({
			gap: 12,
			align: "center",
			padding: { vertical: 8, horizontal: 2 },
			children: items,
		});
	}

	function buildApogeeCard(pal: HopperPalette): Box {
		const recentCount = Math.min(16, hops.length);
		const slice = hops.slice(hops.length - recentCount);
		const picked = getSelectedHop();
		const maxApogeeScale = 165;

		const apogeePlot = new TelemetryChartView({
			height: 192,
			background: pal.card,
			borderColor: pal.line,
			radius: 12,
			label: "Apogee profile chart for last 16 hops",
			value: `${picked.id} ${picked.apogeeM.toFixed(1)}m`,
			focusable: true,
			cursor: SGUI_CURSOR_POINTER,
			onDraw: (surface, rect) => {
				const padL = 46;
				const padR = 16;
				const padT = 18;
				const padB = 26;
				const plotW = Math.max(40, rect.width - padL - padR);
				const plotH = Math.max(40, rect.height - padT - padB);
				const mapY = (m: number): number => padT + plotH * (1 - clampNumber(m / maxApogeeScale, 0, 1));

				const y50 = mapY(50);
				const y100 = mapY(NOMINAL_TARGET_M);
				const y150 = mapY(TARGET_CEILING_M);
				const y0 = mapY(0);

				surface.drawLineAA(padL, y0, padL + plotW, y0, 1, pal.lineStrong, false);
				surface.drawLineAA(padL, y50, padL + plotW, y50, 1, pal.grid, false);
				drawDashedLine(surface, padL, y100, padL + plotW, y100, 5, 4, 1.2, withAlpha(pal.accent, 0.6));
				drawDashedLine(surface, padL, y150, padL + plotW, y150, 3, 5, 1.0, withAlpha(pal.caution, 0.45));

				const slotW = plotW / Math.max(1, slice.length);
				const barW = Math.max(8, Math.min(24, slotW * 0.56));
				for (let i = 0; i < slice.length; i++) {
					const h = slice[i];
					if (h === undefined) continue;
					const bx = padL + i * slotW + (slotW - barW) * 0.5;
					const topY = mapY(h.apogeeM);
					const bh = Math.max(4, y0 - topY);
					const isSel = h.num === selectedHopNum;
					const tone = outcomeColor(h.outcome, pal);
					const barFill = isSel ? tone : withAlpha(tone, pal.dark ? 0.62 : 0.72);
					surface.fillRoundedRect(bx, topY, barW, bh, 4, barFill);
					if (isSel) {
						surface.fillCircle(bx + barW * 0.5, topY - 6, 3.2, tone);
						surface.strokeCircle(bx + barW * 0.5, topY - 6, 6.2, 1.25, withAlpha(tone, 0.45));
					}
				}
			},
			onPostBlit: (rect, ctx) => {
				const padL = 46;
				const padR = 16;
				const padT = 18;
				const padB = 26;
				const plotW = Math.max(40, rect.width - padL - padR);
				const plotH = Math.max(40, rect.height - padT - padB);
				const mapY = (m: number): number => rect.y + padT + plotH * (1 - clampNumber(m / maxApogeeScale, 0, 1));
				const lblStyle = { fontFamily: SGUI_FONT_MONO, fontSize: 9.5, fontWeight: 600 };

				const drawYLbl = (m: number, text: string, color: Color): void => {
					const ly = mapY(m);
					const tm = ctx.measureText(lblStyle, 0, text);
					ctx.drawStyledText(rect.x + 8, ly - tm.lineHeight * 0.5, 34, color, lblStyle, text);
				};
				drawYLbl(150, "150m", pal.caution);
				drawYLbl(100, "100m", pal.accent);
				drawYLbl(50, "50m", pal.dim);

				const slotW = plotW / Math.max(1, slice.length);
				for (let i = 0; i < slice.length; i++) {
					const h = slice[i];
					if (h === undefined) continue;
					if (i % 3 !== 0 && i !== slice.length - 1 && h.num !== selectedHopNum) continue;
					const cx = rect.x + padL + i * slotW + slotW * 0.5;
					const tx = cx - 14;
					const ty = rect.y + rect.height - 19;
					const c = h.num === selectedHopNum ? pal.ink : pal.dim;
					ctx.drawStyledText(tx, ty, 30, c, lblStyle, h.id);
				}
			},
			onPointer: (ev, rect) => {
				if (ev.phase !== "down" && ev.phase !== "drag") return false;
				const padL = 46;
				const padR = 16;
				const plotW = Math.max(40, rect.width - padL - padR);
				const rel = clampNumber((ev.x - (rect.x + padL)) / plotW, 0, 0.9999);
				const idx = clampNumber(Math.floor(rel * slice.length), 0, slice.length - 1);
				const target = slice[idx];
				if (target !== undefined && target.num !== selectedHopNum) {
					selectedHopNum = target.num;
					rebuildUi();
				}
				return true;
			},
		});

		const latest = latestHop();
		const resetBtn =
			picked.num !== latest.num
				? new Button({
						label: "Latest",
						variant: "ghost",
						fontSize: 11,
						padding: { vertical: 4, horizontal: 9 },
						onClick: () => {
							selectedHopNum = latest.num;
							rebuildUi();
						},
					})
				: undefined;

		const inspectionItems: StackChild[] = [
			{
				child: makeText(`${picked.id} · ${picked.note} (${picked.ageLabel})`, 12, pal.muted, 500),
				grow: 1,
			},
		];
		if (resetBtn !== undefined) {
			inspectionItems.push({ child: resetBtn, shrink: 0 });
		}
		const inspectionBar = new HStack({ gap: 10, align: "center", children: inspectionItems });

		const metricsRow = new HStack({
			gap: 10,
			align: "stretch",
			children: [
				{ child: makeMetricTile("APOGEE", `${picked.apogeeM.toFixed(1)} m`, pal), grow: 1 },
				{
					child: makeMetricTile(
						"PEAK TILT",
						`${picked.peakTiltDeg.toFixed(1)} deg`,
						pal,
						picked.peakTiltDeg > TILT_CORRIDOR_DEG ? pal.alert : pal.ink,
					),
					grow: 1,
				},
				{ child: makeMetricTile("DURATION", `${picked.durationS.toFixed(1)} s`, pal), grow: 1 },
				{
					child: makeMetricTile(
						"PAD OFFSET",
						`${picked.padOffsetM.toFixed(2)} m`,
						pal,
						picked.padOffsetM > padSafeRadiusM ? pal.caution : pal.accent,
					),
					grow: 1,
				},
			],
		});

		return makeDoubleBezelCard({
			pal,
			icon: "activity",
			title: "Apogee profile",
			subtitle: `Last ${recentCount} hops · Click bar to inspect flight`,
			badgeLabel: `${picked.id} ${outcomeLabel(picked.outcome)}`,
			badgeVariant: outcomeBadgeVariant(picked.outcome),
			body: new VStack({
				gap: 12,
				children: [apogeePlot, inspectionBar, metricsRow],
			}),
		});
	}

	function buildDispersionCard(pal: HopperPalette): Box {
		let insideCount = 0;
		for (let i = 0; i < scatterDots.length; i++) {
			const d = scatterDots[i];
			if (d !== undefined && Math.hypot(d.xM, d.yM) <= padSafeRadiusM) {
				insideCount += 1;
			}
		}
		const insidePct = Math.round((insideCount / Math.max(1, scatterDots.length)) * 100);
		const picked = getSelectedHop();

		const radarPlot = new TelemetryChartView({
			height: 248,
			background: pal.card,
			borderColor: pal.line,
			radius: 12,
			label: "Touchdown dispersion polar radar",
			value: `${insidePct}% within ${padSafeRadiusM.toFixed(2)}m`,
			cursor: SGUI_CURSOR_POINTER,
			onDraw: (surface, rect) => {
				const cx = rect.width * 0.5;
				const cy = rect.height * 0.5;
				const maxR = Math.min(rect.width, rect.height) * 0.42;
				const pxPerM = maxR / 3.2;

				const safeR = padSafeRadiusM * pxPerM;
				surface.fillCircle(cx, cy, safeR, withAlpha(pal.accent, pal.dark ? 0.1 : 0.08));
				drawDashedCircle(surface, cx, cy, safeR, 44, 1.4, withAlpha(pal.accent, 0.72));

				surface.strokeCircle(cx, cy, 1.0 * pxPerM, 1, pal.lineStrong);
				surface.strokeCircle(cx, cy, 2.0 * pxPerM, 1, pal.lineStrong);
				surface.strokeCircle(cx, cy, 3.0 * pxPerM, 1.15, pal.lineStrong);

				surface.drawLineAA(cx - maxR - 8, cy, cx + maxR + 8, cy, 1, pal.grid, false);
				surface.drawLineAA(cx, cy - maxR - 8, cx, cy + maxR + 8, 1, pal.grid, false);
				surface.fillRoundedRect(cx - 4, cy - 4, 8, 8, 2, withAlpha(pal.ink, 0.45));

				for (let i = 0; i < scatterDots.length; i++) {
					const d = scatterDots[i];
					if (d === undefined) continue;
					const px = cx + d.xM * pxPerM;
					const py = cy - d.yM * pxPerM;
					const inSafe = Math.hypot(d.xM, d.yM) <= padSafeRadiusM;
					const dotColor =
						d.outcome === "abort" ? pal.alert : !inSafe || d.outcome === "hard" ? pal.caution : pal.accent;
					const isSelected = d.hopNum === picked.num;
					if (isSelected) {
						surface.fillCircle(px, py, 6.2, dotColor);
						surface.strokeCircle(px, py, 10.5, 1.5, withAlpha(dotColor, 0.7));
					} else {
						surface.fillCircle(px, py, d.hopNum > 0 ? 4.0 : 2.8, withAlpha(dotColor, d.hopNum > 0 ? 0.92 : 0.56));
					}
				}
			},
			onPostBlit: (rect, ctx) => {
				const cx = rect.x + rect.width * 0.5;
				const cy = rect.y + rect.height * 0.5;
				const maxR = Math.min(rect.width, rect.height) * 0.42;
				const pxPerM = maxR / 3.2;
				const mono = { fontFamily: SGUI_FONT_MONO, fontSize: 9.5, fontWeight: 600 };
				ctx.drawStyledText(cx + 1.0 * pxPerM + 3, cy - 12, 26, pal.dim, mono, "1m");
				ctx.drawStyledText(cx + 2.0 * pxPerM + 3, cy - 12, 26, pal.dim, mono, "2m");
				ctx.drawStyledText(cx + 3.0 * pxPerM + 3, cy - 12, 26, pal.dim, mono, "3m");
				ctx.drawStyledText(rect.x + 12, rect.y + 10, 120, pal.muted, mono, "PAD BRAVO // ENU");
				ctx.drawStyledText(
					rect.x + rect.width - 134,
					rect.y + 10,
					124,
					pal.accent,
					mono,
					`SEL ${picked.id} (${picked.padOffsetM.toFixed(2)}m)`,
				);
			},
			onPointer: (ev, rect) => {
				if (ev.phase !== "down" && ev.phase !== "drag") return false;
				const cx = rect.x + rect.width * 0.5;
				const cy = rect.y + rect.height * 0.5;
				const maxR = Math.min(rect.width, rect.height) * 0.42;
				const pxPerM = maxR / 3.2;
				const rM = Math.hypot(ev.x - cx, ev.y - cy) / Math.max(1, pxPerM);
				padSafeRadiusM = Number(clampNumber(Math.round(rM * 4) / 4, 1.0, 3.5).toFixed(2));
				rebuildUi();
				return true;
			},
		});

		const radiusRow = new HStack({
			gap: 14,
			align: "center",
			children: [
				{ child: makeText("Safe zone radius", 12.5, pal.ink, 600), shrink: 0 },
				{
					child: new Slider({
						min: 1.0,
						max: 3.5,
						step: 0.25,
						value: padSafeRadiusM,
						label: "Safe zone radius",
						showValue: false,
						width: 240,
						onChange: (val) => {
							padSafeRadiusM = Number(val.toFixed(2));
							rebuildUi();
						},
					}),
					grow: 1,
				},
				{
					child: makeText(`${padSafeRadiusM.toFixed(2)} m · ${insideCount}/${scatterDots.length} inside`, 11.5, pal.accent, 600, SGUI_FONT_MONO),
					shrink: 0,
				},
			],
		});

		return makeDoubleBezelCard({
			pal,
			icon: "crosshair",
			title: "Touchdown dispersion",
			subtitle: "Concentric 1 m / 2 m / 3 m pad envelope",
			badgeLabel: `${insidePct}% IN ZONE`,
			badgeVariant: insidePct >= 80 ? "success" : "warning",
			body: new VStack({
				gap: 12,
				children: [radarPlot, radiusRow],
			}),
		});
	}

	function buildTiltCard(pal: HopperPalette): Box {
		const liveTilt = sampleTiltAt(scrubTimeS);
		let peak = 0;
		let excursions = 0;
		let wasOut = false;
		for (let i = 0; i <= 96; i++) {
			const val = Math.abs(sampleTiltAt(i * 0.25));
			if (val > peak) peak = val;
			const out = val > TILT_CORRIDOR_DEG;
			if (out && !wasOut) excursions += 1;
			wasOut = out;
		}
		const breached = Math.abs(liveTilt) > TILT_CORRIDOR_DEG;

		const liveHeader = new HStack({
			gap: 12,
			align: "center",
			children: [
				{
					child: new VStack({
						gap: 2,
						children: [
							makeText("CURSOR ATTITUDE", 10, pal.muted, 600, SGUI_FONT_MONO),
							new HStack({
								gap: 10,
								align: "center",
								children: [
									makeText(`${liveTilt >= 0 ? "+" : ""}${liveTilt.toFixed(2)}°`, 24, breached ? pal.alert : pal.ink, 700, SGUI_FONT_MONO),
									makeBadge(`T+${scrubTimeS.toFixed(1)}s`, breached ? "danger" : "accent"),
								],
							}),
						],
					}),
					grow: 1,
				},
				{
					child: new VStack({
						gap: 2,
						align: "end",
						children: [
							makeText(`PEAK ${peak.toFixed(1)}°`, 12, pal.alert, 700, SGUI_FONT_MONO),
							makeText(`${excursions} excursions past ±${TILT_CORRIDOR_DEG.toFixed(1)}°`, 11.5, pal.muted, 400),
						],
					}),
					shrink: 0,
				},
			],
		});

		const tiltChart = new TelemetryChartView({
			height: 186,
			background: pal.card,
			borderColor: pal.line,
			radius: 12,
			label: "Attitude tilt telemetry curve",
			value: `T+${scrubTimeS.toFixed(1)}s ${liveTilt.toFixed(2)} deg`,
			cursor: SGUI_CURSOR_POINTER,
			onDraw: (surface, rect) => {
				const padL = 44;
				const padR = 14;
				const padT = 14;
				const gimbalH = 32;
				const padB = 12 + gimbalH;
				const plotW = Math.max(40, rect.width - padL - padR);
				const plotH = Math.max(40, rect.height - padT - padB);
				const mapY = (deg: number): number =>
					padT + plotH * (0.5 - clampNumber(deg, -MAX_TILT_PLOT_DEG, MAX_TILT_PLOT_DEG) / (MAX_TILT_PLOT_DEG * 2));
				const mapX = (t: number): number => padL + (clampNumber(t, 0, 24) / 24) * plotW;

				const yZero = mapY(0);
				const yTopBand = mapY(TILT_CORRIDOR_DEG);
				const yBotBand = mapY(-TILT_CORRIDOR_DEG);

				surface.fillRoundedRect(padL, yTopBand, plotW, yBotBand - yTopBand, 0, withAlpha(pal.accent, pal.dark ? 0.08 : 0.07));
				drawDashedLine(surface, padL, yTopBand, padL + plotW, yTopBand, 4, 4, 1, withAlpha(pal.accent, 0.55));
				drawDashedLine(surface, padL, yBotBand, padL + plotW, yBotBand, 4, 4, 1, withAlpha(pal.accent, 0.55));
				surface.drawLineAA(padL, yZero, padL + plotW, yZero, 1, pal.lineStrong, false);

				const curvePts: VectorPoint[] = [];
				const steps = 96;
				for (let i = 0; i <= steps; i++) {
					const t = (i / steps) * 24;
					curvePts.push({ x: mapX(t), y: mapY(sampleTiltAt(t)) });
				}
				surface.fillAreaCurve(
					curvePts,
					yZero,
					withAlpha(pal.accent, pal.dark ? 0.24 : 0.18),
					withAlpha(pal.accent, 0.01),
				);
				surface.drawPolylineAA(curvePts, 2.2, pal.accent, false);

				const hotSeg: VectorPoint[] = [];
				for (let i = 0; i < curvePts.length; i++) {
					const t = (i / steps) * 24;
					const val = sampleTiltAt(t);
					const pt = curvePts[i];
					if (pt !== undefined && Math.abs(val) > TILT_CORRIDOR_DEG) {
						hotSeg.push(pt);
					} else if (hotSeg.length > 1) {
						surface.drawPolylineAA(hotSeg, 2.4, pal.alert, false);
						hotSeg.length = 0;
					} else {
						hotSeg.length = 0;
					}
				}
				if (hotSeg.length > 1) {
					surface.drawPolylineAA(hotSeg, 2.4, pal.alert, false);
				}

				const sx = mapX(scrubTimeS);
				const sy = mapY(liveTilt);
				const dotColor = breached ? pal.alert : pal.accent;
				surface.drawLineAA(sx, padT, sx, padT + plotH, 1.2, withAlpha(pal.ink, 0.55), false);
				surface.fillCircle(sx, sy, 8.5, withAlpha(dotColor, 0.25));
				surface.fillCircle(sx, sy, 4.4, dotColor);
				surface.strokeCircle(sx, sy, 4.4, 1.4, pal.card);

				const gBaseY = rect.height - 14;
				const barSlotW = plotW / gimbalBars.length;
				const gw = Math.max(2, barSlotW * 0.6);
				surface.drawLineAA(padL, gBaseY, padL + plotW, gBaseY, 1, pal.line, false);
				for (let i = 0; i < gimbalBars.length; i++) {
					const cmd = gimbalBars[i] ?? 0;
					const bh = (Math.abs(cmd) / 8) * 14;
					const gx = padL + i * barSlotW + (barSlotW - gw) * 0.5;
					const gy = cmd >= 0 ? gBaseY - bh : gBaseY;
					const gc = Math.abs(cmd) > 5.2 ? pal.caution : withAlpha(pal.accent, 0.65);
					surface.fillRoundedRect(gx, gy, gw, Math.max(2, bh), 1, gc);
				}
			},
			onPostBlit: (rect, ctx) => {
				const padT = 14;
				const plotH = Math.max(40, rect.height - padT - 44);
				const mapY = (deg: number): number =>
					rect.y + padT + plotH * (0.5 - clampNumber(deg, -MAX_TILT_PLOT_DEG, MAX_TILT_PLOT_DEG) / (MAX_TILT_PLOT_DEG * 2));
				const lbl = { fontFamily: SGUI_FONT_MONO, fontSize: 9.5, fontWeight: 600 };
				ctx.drawStyledText(rect.x + 8, mapY(TILT_CORRIDOR_DEG) - 6, 34, pal.accent, lbl, "+5.0°");
				ctx.drawStyledText(rect.x + 8, mapY(0) - 6, 34, pal.dim, lbl, " 0.0°");
				ctx.drawStyledText(rect.x + 8, mapY(-TILT_CORRIDOR_DEG) - 6, 34, pal.accent, lbl, "-5.0°");
				ctx.drawStyledText(rect.x + 8, rect.y + rect.height - 22, 36, pal.dim, lbl, "GIMB");
			},
			onPointer: (ev, rect) => {
				if (ev.phase !== "down" && ev.phase !== "drag") return false;
				const padL = 44;
				const padR = 14;
				const plotW = Math.max(40, rect.width - padL - padR);
				const norm = clampNumber((ev.x - (rect.x + padL)) / plotW, 0, 1);
				scrubTimeS = Number((Math.round(norm * 48) * 0.5).toFixed(1));
				rebuildUi();
				return true;
			},
		});

		const scrubRow = new HStack({
			gap: 14,
			align: "center",
			children: [
				{ child: makeText("Time scrub", 12.5, pal.ink, 600), shrink: 0 },
				{
					child: new Slider({
						min: 0,
						max: 24,
						step: 0.5,
						value: scrubTimeS,
						label: "Time scrub",
						showValue: false,
						width: 240,
						onChange: (val) => {
							scrubTimeS = Number(val.toFixed(1));
							rebuildUi();
						},
					}),
					grow: 1,
				},
				{
					child: makeText(`T+${scrubTimeS.toFixed(1)}s / 24.0s`, 11.5, pal.muted, 600, SGUI_FONT_MONO),
					shrink: 0,
				},
			],
		});

		return makeDoubleBezelCard({
			pal,
			icon: "compass",
			title: "Attitude & tilt timeline",
			subtitle: "Closed-loop body tilt inside ±5.0° nominal corridor",
			badgeLabel: breached ? "EXCURSION" : "CORRIDOR ±5.0°",
			badgeVariant: breached ? "danger" : "accent",
			body: new VStack({
				gap: 12,
				children: [liveHeader, tiltChart, scrubRow],
			}),
		});
	}

	function activePhaseThrottle(): number {
		switch (plan.phase) {
			case "ascent":
				return plan.ascentThrottle;
			case "hover":
				return plan.hoverThrottle;
			case "translate":
				return plan.translateThrottle;
			case "descend":
				return plan.descendThrottle;
		}
	}

	function setActivePhaseThrottle(val: number): void {
		const rounded = Math.round(clampNumber(val, 25, 100));
		switch (plan.phase) {
			case "ascent":
				plan.ascentThrottle = rounded;
				break;
			case "hover":
				plan.hoverThrottle = rounded;
				break;
			case "translate":
				plan.translateThrottle = rounded;
				break;
			case "descend":
				plan.descendThrottle = rounded;
				break;
		}
	}

	function buildPlanTab(pal: HopperPalette): VStack {
		const phaseSegment = new SegmentedControl({
			items: [
				{ id: "ascent", label: "Ascent" },
				{ id: "hover", label: "Hover" },
				{ id: "translate", label: "Translate" },
				{ id: "descend", label: "Descend" },
			],
			selectedId: plan.phase,
			label: "Flight phase",
			onChange: (id) => {
				if (id === "ascent" || id === "hover" || id === "translate" || id === "descend") {
					plan.phase = id;
					rebuildUi();
				}
			},
		});

		const easingSegment = new SegmentedControl({
			items: [
				{ id: "linear", label: "Linear" },
				{ id: "bezier", label: "Bezier" },
				{ id: "outQuint", label: "OutQuint" },
				{ id: "spring", label: "Spring" },
			],
			selectedId: plan.easing,
			label: "Throttle easing curve",
			onChange: (id) => {
				if (id === "linear" || id === "bezier" || id === "outQuint" || id === "spring") {
					plan.easing = id;
					rebuildUi();
				}
			},
		});

		const throttlePreview = new TelemetryChartView({
			height: 176,
			background: pal.card,
			borderColor: pal.line,
			radius: 12,
			label: "Throttle command profile preview",
			value: `${plan.phase} ${activePhaseThrottle()}% (${plan.easing})`,
			onDraw: (surface, rect) => {
				const padL = 42;
				const padR = 14;
				const padT = 16;
				const padB = 24;
				const plotW = Math.max(40, rect.width - padL - padR);
				const plotH = Math.max(40, rect.height - padT - padB);
				const mapX = (t: number): number => padL + (clampNumber(t, 0, 24) / 24) * plotW;
				const mapY = (pct: number): number => padT + plotH * (1 - clampNumber(pct, 20, 105) / 105);

				const hoverEnd = 5 + Math.max(4, plan.hoverDurationS);
				let winStart = 0;
				let winEnd = 5;
				if (plan.phase === "hover") {
					winStart = 5;
					winEnd = hoverEnd;
				} else if (plan.phase === "translate") {
					winStart = hoverEnd;
					winEnd = hoverEnd + 4;
				} else if (plan.phase === "descend") {
					winStart = hoverEnd + 4;
					winEnd = 24;
				}
				const wx0 = mapX(winStart);
				const wx1 = mapX(winEnd);
				surface.fillRoundedRect(wx0, padT, Math.max(4, wx1 - wx0), plotH, 4, withAlpha(pal.accent, pal.dark ? 0.08 : 0.07));

				const yHover = mapY(HOVER_THROTTLE_FLOOR);
				const y50 = mapY(50);
				const y100 = mapY(100);
				const yBase = padT + plotH;
				surface.drawLineAA(padL, y50, padL + plotW, y50, 1, pal.grid, false);
				surface.drawLineAA(padL, y100, padL + plotW, y100, 1, pal.grid, false);
				drawDashedLine(surface, padL, yHover, padL + plotW, yHover, 4, 4, 1.1, withAlpha(pal.caution, 0.55));
				surface.drawLineAA(padL, yBase, padL + plotW, yBase, 1, pal.lineStrong, false);

				const pts: VectorPoint[] = [];
				const steps = 96;
				for (let i = 0; i <= steps; i++) {
					const t = (i / steps) * 24;
					pts.push({ x: mapX(t), y: mapY(evalThrottleAt(plan, t)) });
				}
				surface.fillAreaCurve(
					pts,
					yBase,
					withAlpha(pal.accent, pal.dark ? 0.28 : 0.2),
					withAlpha(pal.accent, 0.01),
				);
				surface.drawPolylineAA(pts, 2.3, pal.accent, false);

				const knots = [0, 5, hoverEnd, hoverEnd + 4, 24];
				for (let i = 0; i < knots.length; i++) {
					const kt = knots[i] ?? 0;
					const kx = mapX(kt);
					const ky = mapY(evalThrottleAt(plan, kt));
					surface.fillCircle(kx, ky, 4.0, pal.accent);
					surface.strokeCircle(kx, ky, 4.0, 1.3, pal.card);
				}
			},
			onPostBlit: (rect, ctx) => {
				const padT = 16;
				const padB = 24;
				const plotH = Math.max(40, rect.height - padT - padB);
				const mapY = (pct: number): number => rect.y + padT + plotH * (1 - clampNumber(pct, 20, 105) / 105);
				const lbl = { fontFamily: SGUI_FONT_MONO, fontSize: 9.5, fontWeight: 600 };
				ctx.drawStyledText(rect.x + 8, mapY(100) - 6, 32, pal.dim, lbl, "100%");
				ctx.drawStyledText(rect.x + 8, mapY(HOVER_THROTTLE_FLOOR) - 6, 32, pal.caution, lbl, "62%");
				ctx.drawStyledText(rect.x + 8, mapY(30) - 6, 32, pal.dim, lbl, "30%");
				ctx.drawStyledText(rect.x + 44, rect.y + rect.height - 17, 170, pal.muted, lbl, "T+0s -> T+24s PHASE PROFILE");
			},
		});

		const throttleRow = new HStack({
			gap: 14,
			align: "center",
			children: [
				{
					child: makeText(`${plan.phase.toUpperCase()} THROTTLE`, 11.5, pal.ink, 600, SGUI_FONT_MONO),
					shrink: 0,
				},
				{
					child: new Slider({
						min: 25,
						max: 100,
						step: 1,
						value: activePhaseThrottle(),
						label: "Phase throttle",
						showValue: false,
						width: 240,
						onChange: (val) => {
							setActivePhaseThrottle(val);
							rebuildUi();
						},
					}),
					grow: 1,
				},
				{
					child: makeText(
						`${activePhaseThrottle()}%`,
						13,
						activePhaseThrottle() < HOVER_THROTTLE_FLOOR && plan.phase === "hover" ? pal.caution : pal.accent,
						700,
						SGUI_FONT_MONO,
					),
					shrink: 0,
				},
			],
		});

		const steppersRow = new HStack({
			gap: 12,
			align: "center",
			children: [
				{
					child: new HStack({
						gap: 8,
						align: "center",
						children: [
							makeText("Hover hold", 12.5, pal.ink, 600),
							new Button({
								label: "-",
								leadingIcon: "minus",
								variant: "secondary",
								padding: { vertical: 4, horizontal: 8 },
								onClick: () => {
									plan.hoverDurationS = Math.max(4, plan.hoverDurationS - 1);
									rebuildUi();
								},
							}),
							makeText(`${plan.hoverDurationS} s`, 12.5, pal.ink, 700, SGUI_FONT_MONO),
							new Button({
								label: "+",
								leadingIcon: "plus",
								variant: "secondary",
								padding: { vertical: 4, horizontal: 8 },
								onClick: () => {
									plan.hoverDurationS = Math.min(14, plan.hoverDurationS + 1);
									rebuildUi();
								},
							}),
						],
					}),
					grow: 1,
				},
				{
					child: new HStack({
						gap: 8,
						align: "center",
						children: [
							makeText("Gimbal limit", 12.5, pal.ink, 600),
							new Button({
								label: "-",
								leadingIcon: "minus",
								variant: "secondary",
								padding: { vertical: 4, horizontal: 8 },
								onClick: () => {
									plan.gimbalLimitDeg = Math.max(4, plan.gimbalLimitDeg - 1);
									rebuildUi();
								},
							}),
							makeText(`${plan.gimbalLimitDeg}°`, 12.5, pal.ink, 700, SGUI_FONT_MONO),
							new Button({
								label: "+",
								leadingIcon: "plus",
								variant: "secondary",
								padding: { vertical: 4, horizontal: 8 },
								onClick: () => {
									plan.gimbalLimitDeg = Math.min(12, plan.gimbalLimitDeg + 1);
									rebuildUi();
								},
							}),
						],
					}),
					grow: 1,
				},
			],
		});

		const profileCard = makeDoubleBezelCard({
			pal,
			icon: "sliders",
			title: "Thrust profile & phase easing",
			subtitle: "Configure per-phase throttle floor and GNC interpolation curve",
			badgeLabel: plan.easing.toUpperCase(),
			badgeVariant: "accent",
			body: new VStack({
				gap: 12,
				children: [
					new HStack({
						gap: 10,
						align: "center",
						children: [
							{ child: phaseSegment, grow: 1 },
							{ child: easingSegment, shrink: 0 },
						],
					}),
					throttlePreview,
					throttleRow,
					new Divider({ color: pal.line }),
					steppersRow,
				],
			}),
		});

		const overCeiling = plan.targetZ > TARGET_CEILING_M;
		const slantRangeM = Math.hypot(plan.targetX, plan.targetY, plan.targetZ);

		const makeCoordField = (label: string, val: number, unit: string, onUpdate: (n: number) => void, danger = false): VStack =>
			new VStack({
				gap: 5,
				children: [
					makeText(`${label} (${unit})`, 10.5, danger ? pal.alert : pal.muted, 600, SGUI_FONT_MONO),
					new Input({
						value: String(val),
						placeholder: "0",
						fontFamily: SGUI_FONT_MONO,
						fontSize: 13,
						onChange: (raw) => {
							const parsed = Number.parseFloat(raw);
							if (Number.isFinite(parsed)) {
								onUpdate(parsed);
							}
						},
						onSubmit: () => rebuildUi(),
					}),
				],
			});

		const coordRow1 = new HStack({
			gap: 14,
			align: "start",
			children: [
				{
					child: makeCoordField("X · EAST OFFSET", plan.targetX, "m", (n) => {
						plan.targetX = clampNumber(n, -40, 40);
					}),
					grow: 1,
				},
				{
					child: makeCoordField("Y · NORTH OFFSET", plan.targetY, "m", (n) => {
						plan.targetY = clampNumber(n, -40, 40);
					}),
					grow: 1,
				},
			],
		});

		const coordRow2 = new HStack({
			gap: 14,
			align: "end",
			children: [
				{
					child: makeCoordField(
						"Z · TARGET APOGEE",
						plan.targetZ,
						"m",
						(n) => {
							plan.targetZ = clampNumber(n, 20, 220);
							rebuildUi();
						},
						overCeiling,
					),
					grow: 1,
				},
				{
					child: makeMetricTile(
						"SLANT RANGE",
						`${slantRangeM.toFixed(1)} m`,
						pal,
						overCeiling ? pal.alert : pal.accent,
					),
					grow: 1,
				},
			],
		});

		const safeguardsItems: StackChild[] = [coordRow1, coordRow2];
		if (overCeiling) {
			safeguardsItems.push(
				new Box({
					fillWidth: true,
					radius: 8,
					padding: { horizontal: 12, vertical: 8 },
					background: withAlpha(pal.alert, 0.14),
					borderColor: withAlpha(pal.alert, 0.35),
					borderWidth: 1,
					child: new HStack({
						gap: 8,
						align: "center",
						children: [
							new VectorIcon({ name: "alert", size: 15, color: pal.alert }),
							makeText(
								`Target altitude ${plan.targetZ} m exceeds range ceiling (${TARGET_CEILING_M} m).`,
								12,
								pal.alert,
								600,
							),
						],
					}),
				}),
			);
		}
		safeguardsItems.push(new Divider({ color: pal.line }));
		safeguardsItems.push(
			new VStack({
				gap: 0,
				children: [
					makeSafeguardRow(
						"Auto-level trim",
						"Zero body roll bias above 8 m AGL prior to lateral hover",
						plan.autoLevelTrim,
						pal,
						(next) => {
							plan.autoLevelTrim = next;
							rebuildUi();
						},
					),
					new Divider({ color: pal.line }),
					makeSafeguardRow(
						"RCS roll hold",
						"Active nitrogen cold-gas attitude damping during descend phase",
						plan.rcsRollHold,
						pal,
						(next) => {
							plan.rcsRollHold = next;
							rebuildUi();
						},
					),
					new Divider({ color: pal.line }),
					makeSafeguardRow(
						"Abort > 10° tilt",
						"Command FTS engine cutoff & drogue deploy on corridor breach",
						plan.abortOnTilt,
						pal,
						(next) => {
							plan.abortOnTilt = next;
							rebuildUi();
						},
					),
				],
			}),
		);

		const coordCard = makeDoubleBezelCard({
			pal,
			icon: "shield",
			iconColor: overCeiling ? pal.alert : pal.accent,
			title: "Target coordinates & GNC safeguards",
			subtitle: "Pad-relative waypoint ENU + flight termination limits",
			badgeLabel: overCeiling ? "CEILING ALERT" : "ALT OK",
			badgeVariant: overCeiling ? "danger" : "success",
			body: new VStack({ gap: 12, children: safeguardsItems }),
		});

		return new VStack({
			gap: 16,
			children: [profileCard, coordCard],
		});
	}

	function buildPlanFooterBar(pal: HopperPalette): Box {
		const nextNum = (hops[hops.length - 1]?.num ?? 40) + 1;
		const nextId = nextNum < 10 ? `H-0${nextNum}` : `H-${nextNum}`;
		const overCeiling = plan.targetZ > TARGET_CEILING_M;
		const ctaCard = new Box({
			fillWidth: true,
			background: pal.inset,
			borderColor: overCeiling ? withAlpha(pal.alert, 0.5) : withAlpha(pal.accent, 0.45),
			borderWidth: 1,
			radius: 14,
			padding: { horizontal: 16, vertical: 11 },
			child: new HStack({
				gap: 14,
				align: "center",
				children: [
					{
						child: new VStack({
							gap: 3,
							children: [
								makeText(
									overCeiling ? `CEILING ALERT · ${nextId}` : `READY FOR LAUNCH · ${nextId}`,
									11,
									overCeiling ? pal.alert : pal.accent,
									700,
									SGUI_FONT_MONO,
								),
								makeText(lastLaunchSummary, 13, pal.ink, 500),
							],
						}),
						grow: 1,
					},
					{
						child: new Button({
							label: "Defaults",
							leadingIcon: "reset",
							variant: "secondary",
							onClick: () => resetPlan(),
						}),
						shrink: 0,
					},
					{
						child: new Button({
							label: "Fly Hop",
							leadingIcon: "rocket",
							variant: "primary",
							fontWeight: 600,
							padding: { vertical: 8, horizontal: 18 },
							onClick: () => flyHop(),
						}),
						shrink: 0,
					},
				],
			}),
		});

		const centeredFooter = new Box({
			maxWidth: 880,
			fillWidth: true,
			alignHorizontal: "center",
			padding: { horizontal: 20, vertical: 12 },
			child: ctaCard,
		});

		return new Box({
			fillWidth: true,
			background: pal.card,
			child: new VStack({
				gap: 0,
				children: [new Divider({ color: pal.line }), centeredFooter],
			}),
		});
	}

	function buildVehicleTab(pal: HopperPalette): VStack {
		const wetMass = dryMassKg + propMassKg + 12;
		const maxThrustN = 8850;
		const twr = maxThrustN / (wetMass * 9.80665);
		const isp = 238;
		const deltaV = isp * 9.80665 * Math.log(wetMass / Math.max(100, dryMassKg + 12));
		const overWeight = wetMass > MAX_TAKEOFF_MASS_KG;

		const mtowBar = new TelemetryChartView({
			height: 44,
			background: pal.card,
			borderColor: pal.line,
			radius: 10,
			label: "Takeoff wet mass vs MTOW budget",
			value: `${wetMass} / ${MAX_TAKEOFF_MASS_KG} kg`,
			onDraw: (surface, rect) => {
				const barX = 12;
				const barW = Math.max(40, rect.width - 24);
				const barY = 22;
				const barH = 10;
				const ratio = clampNumber(wetMass / MAX_TAKEOFF_MASS_KG, 0, 1);
				const fillTone = overWeight ? pal.alert : ratio > 0.9 ? pal.caution : pal.accent;
				surface.fillRoundedRect(barX, barY, barW, barH, 5, pal.raised);
				surface.fillRoundedRect(barX, barY, Math.max(8, barW * ratio), barH, 5, fillTone);
			},
			onPostBlit: (rect, ctx) => {
				const lbl = { fontFamily: SGUI_FONT_MONO, fontSize: 10, fontWeight: 600 };
				ctx.drawStyledText(rect.x + 12, rect.y + 6, 180, pal.muted, lbl, `WET MASS ${wetMass} KG`);
				ctx.drawStyledText(
					rect.x + rect.width - 130,
					rect.y + 6,
					118,
					overWeight ? pal.alert : pal.accent,
					lbl,
					`MTOW ${MAX_TAKEOFF_MASS_KG} KG`,
				);
			},
		});

		const massCard = makeDoubleBezelCard({
			pal,
			icon: "cpu",
			title: "Mass & propulsion budget",
			subtitle: "Dry airframe, LOX/CH4 propellant load, and thrust-to-weight",
			badgeLabel: overWeight ? "OVER MTOW" : "100% READY",
			badgeVariant: overWeight ? "danger" : "success",
			body: new VStack({
				gap: 12,
				children: [
					new HStack({
						gap: 10,
						align: "stretch",
						children: [
							{ child: makeMetricTile("DRY", `${dryMassKg} kg`, pal), grow: 1 },
							{ child: makeMetricTile("PROP", `${propMassKg} kg`, pal), grow: 1 },
							{
								child: makeMetricTile("TWR", `${twr.toFixed(2)} g`, pal, twr < 1.25 ? pal.caution : pal.accent),
								grow: 1,
							},
							{ child: makeMetricTile("ΔV", `${deltaV.toFixed(0)} m/s`, pal), grow: 1 },
						],
					}),
					mtowBar,
					new HStack({
						gap: 14,
						align: "center",
						children: [
							{ child: makeText("Propellant load", 12.5, pal.ink, 600), shrink: 0 },
							{
								child: new Slider({
									min: 80,
									max: 320,
									step: 4,
									value: propMassKg,
									label: "Propellant load",
									showValue: false,
									width: 240,
									onChange: (val) => {
										propMassKg = Math.round(val);
										rebuildUi();
									},
								}),
								grow: 1,
							},
							{ child: makeText(`${propMassKg} kg`, 12, pal.accent, 700, SGUI_FONT_MONO), shrink: 0 },
						],
					}),
				],
			}),
		});

		const rcsDiagram = new TelemetryChartView({
			height: 262,
			background: pal.card,
			borderColor: pal.line,
			radius: 12,
			label: "RCS Quad Polar Hull Diagram",
			value: `Selected ${selectedQuadId}`,
			cursor: SGUI_CURSOR_POINTER,
			onDraw: (surface, rect) => {
				const cx = rect.width * 0.5;
				const cy = rect.height * 0.5;
				const ringRadii = [44, 78, 108];

				for (let i = 0; i < ringRadii.length; i++) {
					const rr = ringRadii[i] ?? 44;
					surface.strokeCircle(cx, cy, rr, 1, pal.line);
				}

				for (let k = 0; k < 4; k++) {
					const ang = Math.PI * 0.25 + k * Math.PI * 0.5;
					const lx1 = cx + Math.cos(ang) * 32;
					const ly1 = cy + Math.sin(ang) * 32;
					const lx2 = cx + Math.cos(ang) * 68;
					const ly2 = cy + Math.sin(ang) * 68;
					surface.drawLineAA(lx1, ly1, lx2, ly2, 3, pal.lineStrong, true);
					surface.fillCircle(lx2, ly2, 5.5, pal.raised);
					surface.strokeCircle(lx2, ly2, 5.5, 1.4, pal.lineStrong);
				}

				surface.fillCircle(cx, cy, 34, pal.raised);
				surface.strokeCircle(cx, cy, 34, 1.5, pal.lineStrong);
				surface.fillCircle(cx, cy, 17, pal.inset);
				surface.strokeCircle(cx, cy, 17, 1.4, withAlpha(pal.accent, 0.55));
				surface.fillCircle(cx, cy, 6, pal.accent);

				for (let i = 0; i < rcsQuads.length; i++) {
					const q = rcsQuads[i];
					if (q === undefined) continue;
					const podDist = 82;
					const px = cx + Math.cos(q.angleRad) * podDist;
					const py = cy + Math.sin(q.angleRad) * podDist;
					const ux = Math.cos(q.angleRad);
					const uy = Math.sin(q.angleRad);

					surface.drawLineAA(cx + ux * 34, cy + uy * 34, px - ux * 11, py - uy * 11, 2, pal.lineStrong, true);

					const tone = !q.armed ? pal.dim : q.degraded ? pal.caution : pal.accent;
					const isSel = q.id === selectedQuadId;

					if (q.armed) {
						const plumeLen = q.degraded ? 16 : 24;
						for (let f = -1; f <= 1; f++) {
							const fa = q.angleRad + f * 0.26;
							surface.drawLineAA(
								px + Math.cos(fa) * 14,
								py + Math.sin(fa) * 14,
								px + Math.cos(fa) * (14 + plumeLen),
								py + Math.sin(fa) * (14 + plumeLen),
								1.6,
								withAlpha(tone, 0.72),
								true,
							);
						}
					}

					surface.fillCircle(px, py, 13, pal.inset);
					surface.strokeCircle(px, py, 13, 1.3, isSel ? tone : pal.lineStrong);
					const arcSweep = (q.healthPct / 100) * Math.PI * 2;
					surface.drawArc(px, py, 16, -Math.PI * 0.5, -Math.PI * 0.5 + arcSweep, 2.2, tone, true);
					if (isSel) {
						surface.strokeCircle(px, py, 21, 1.2, withAlpha(tone, 0.55));
					}
				}
			},
			onPostBlit: (rect, ctx) => {
				const cx = rect.x + rect.width * 0.5;
				const cy = rect.y + rect.height * 0.5;
				const mono = { fontFamily: SGUI_FONT_MONO, fontSize: 10, fontWeight: 700 };
				ctx.drawStyledText(cx - 12, rect.y + 8, 32, pal.accent, mono, "FWD");
				for (let i = 0; i < rcsQuads.length; i++) {
					const q = rcsQuads[i];
					if (q === undefined) continue;
					const podDist = 82;
					const px = cx + Math.cos(q.angleRad) * podDist;
					const py = cy + Math.sin(q.angleRad) * podDist;
					const tone = !q.armed ? pal.dim : q.degraded ? pal.caution : pal.ink;
					ctx.drawStyledText(px - 8, py - 6, 20, tone, mono, q.id);
				}
			},
			onPointer: (ev, rect) => {
				if (ev.phase !== "down") return false;
				const cx = rect.x + rect.width * 0.5;
				const cy = rect.y + rect.height * 0.5;
				let bestId = selectedQuadId;
				let bestDist = 42;
				for (let i = 0; i < rcsQuads.length; i++) {
					const q = rcsQuads[i];
					if (q === undefined) continue;
					const px = cx + Math.cos(q.angleRad) * 82;
					const py = cy + Math.sin(q.angleRad) * 82;
					const d = Math.hypot(ev.x - px, ev.y - py);
					if (d < bestDist) {
						bestDist = d;
						bestId = q.id;
					}
				}
				if (bestId !== selectedQuadId) {
					selectedQuadId = bestId;
					rebuildUi();
				}
				return true;
			},
		});

		const quadSegment = new SegmentedControl({
			items: [
				{ id: "Q1", label: "Q1" },
				{ id: "Q2", label: "Q2" },
				{ id: "Q3", label: "Q3" },
				{ id: "Q4", label: "Q4" },
			],
			selectedId: selectedQuadId,
			label: "Select RCS quad",
			onChange: (id) => {
				selectedQuadId = id;
				rebuildUi();
			},
		});

		const quadRows: StackChild[] = [];
		for (let i = 0; i < rcsQuads.length; i++) {
			const q = rcsQuads[i];
			if (q === undefined) continue;
			if (i > 0) quadRows.push(new Divider({ color: pal.line }));
			const desc = `${q.axis} · Valve flow ${q.healthPct}%${q.degraded ? " (sticky solenoid)" : ""}`;
			const badgeStr = !q.armed ? "SAFE" : q.degraded ? "DEGRADED" : "NOMINAL";
			const badgeVar: BadgeVariant = !q.armed ? "neutral" : q.degraded ? "warning" : "success";
			quadRows.push(
				makeSafeguardRow(
					q.label,
					desc,
					q.armed,
					pal,
					(next) => {
						q.armed = next;
						rebuildUi();
					},
					badgeStr,
					badgeVar,
				),
			);
		}

		const rcsCard = makeDoubleBezelCard({
			pal,
			icon: "compass",
			iconColor: pal.caution,
			title: "RCS quad thruster pods",
			subtitle: "Nitrogen cold-gas manifold · Click a pod or toggle arm state",
			badgeLabel: rcsQuads[2]?.degraded ? "Q3 DEGRADED" : "ALL NOMINAL",
			badgeVariant: "warning",
			body: new VStack({
				gap: 12,
				children: [
					rcsDiagram,
					new HStack({
						gap: 12,
						align: "center",
						children: [
							{ child: makeText("Inspect quad", 12.5, pal.ink, 600), shrink: 0 },
							{ child: quadSegment, shrink: 0 },
						],
					}),
					new Divider({ color: pal.line }),
					new VStack({ gap: 0, children: quadRows }),
				],
			}),
		});

		return new VStack({
			gap: 16,
			children: [massCard, rcsCard],
		});
	}

	function buildLogRoute(pal: HopperPalette): Box {
		const filtered: HopRecord[] = [];
		for (let i = hops.length - 1; i >= 0; i--) {
			const h = hops[i];
			if (h === undefined) continue;
			if (logFilter === "all" || h.outcome === logFilter) {
				filtered.push(h);
			}
		}

		const filterBar = new SegmentedControl({
			items: [
				{ id: "all", label: "All" },
				{ id: "nominal", label: "Nominal" },
				{ id: "hard", label: "Hard" },
				{ id: "abort", label: "Abort" },
			],
			selectedId: logFilter,
			label: "Log outcome filter",
			onChange: (id) => {
				if (id === "all" || id === "nominal" || id === "hard" || id === "abort") {
					logFilter = id;
					rebuildUi();
				}
			},
		});

		const rows: StackChild[] = [
			new Box({
				fillWidth: true,
				padding: { horizontal: 12, vertical: 6 },
				child: new HStack({
					gap: 10,
					align: "center",
					children: [
						{ child: makeText("HOP   EVENT NOTE", 10, pal.dim, 700, SGUI_FONT_MONO), grow: 1 },
						{ child: makeText("APOGEE     TILT     OFFSET    AGE       STATUS", 10, pal.dim, 700, SGUI_FONT_MONO), shrink: 0 },
					],
				}),
			}),
		];

		for (let i = 0; i < filtered.length; i++) {
			const h = filtered[i];
			if (h === undefined) continue;
			rows.push(new Divider({ color: pal.line }));
			rows.push(
				new LogTableRow(h, h.num === selectedHopNum, pal, (num) => {
					selectedHopNum = num;
					rebuildUi();
				}),
			);
		}

		return makeDoubleBezelCard({
			pal,
			icon: "list",
			title: "Mission flight log",
			subtitle: `${filtered.length} matching flights · Click row to select for telemetry inspection`,
			badgeLabel: `${filtered.length} SHOWN`,
			badgeVariant: "accent",
			trailingAction: new Button({
				label: "Inspect Selected",
				variant: "secondary",
				fontSize: 11,
				padding: { vertical: 4, horizontal: 10 },
				onClick: () => {
					route = "tabs";
					activeTab = "flights";
					rebuildUi();
				},
			}),
			body: new VStack({
				gap: 10,
				children: [
					new HStack({
						gap: 12,
						align: "center",
						children: [
							{ child: filterBar, shrink: 0 },
							{ child: makeText(`Selected: ${getSelectedHop().id}`, 11.5, pal.accent, 600, SGUI_FONT_MONO), grow: 1 },
						],
					}),
					new VStack({ gap: 0, children: rows }),
				],
			}),
		});
	}

	function buildHeader(pal: HopperPalette): Box {
		let nominalCount = 0;
		for (let i = 0; i < hops.length; i++) {
			if (hops[i]?.outcome === "nominal") nominalCount += 1;
		}
		const passPct = Math.round((nominalCount / Math.max(1, hops.length)) * 100);

		const topBar = new HStack({
			gap: 12,
			align: "center",
			children: [
				{
					child: new VStack({
						gap: 2,
						children: [
							makeText("HOPPER LAB // GNC TELEMETRY", 11, pal.accent, 700, SGUI_FONT_MONO),
							makeText("Vehicle H-04 · Pad Bravo Flight Deck", 15, pal.ink, 700),
						],
					}),
					grow: 1,
				},
				{
					child: makeBadge(`PASS ${passPct}%`, passPct >= 85 ? "success" : "warning"),
					shrink: 0,
				},
				{
					child:
						route === "log"
							? new Button({
									label: "Back",
									leadingIcon: "chevron-left",
									variant: "secondary",
									onClick: () => goBack(),
								})
							: new Button({
									label: "Hop log",
									leadingIcon: "list",
									variant: "secondary",
									onClick: () => openLog(),
								}),
					shrink: 0,
				},
				{
					child: new Button({
						label: dark ? "Light Theme" : "Dark Theme",
						leadingIcon: dark ? "sun" : "moon",
						variant: "ghost",
						onClick: () => toggleTheme(),
					}),
					shrink: 0,
				},
			],
		});

		const headerRows: StackChild[] = [topBar];
		if (route === "tabs") {
			headerRows.push(
				new HStack({
					gap: 14,
					align: "center",
					children: [
						{
							child: new SegmentedControl({
								items: [
									{ id: "flights", label: "Flights" },
									{ id: "plan", label: "Plan" },
									{ id: "vehicle", label: "Vehicle" },
								],
								selectedId: activeTab,
								label: "Hopper telemetry views",
								onChange: (id) => {
									if (id === "flights" || id === "plan" || id === "vehicle") {
										activeTab = id;
										rebuildUi();
									}
								},
							}),
							shrink: 0,
						},
						{
							child: makeText(
								`HOPS ${hops.length}  ·  LATEST ${latestHop().id} (${latestHop().apogeeM.toFixed(1)} m)  ·  Q3 DEGRADED`,
								11,
								pal.muted,
								600,
								SGUI_FONT_MONO,
							),
							grow: 1,
						},
					],
				}),
			);
		}

		const headerContent = new Box({
			maxWidth: 880,
			fillWidth: true,
			alignHorizontal: "center",
			padding: { horizontal: 20, top: 14, bottom: 12 },
			child: new VStack({
				gap: 12,
				children: headerRows,
			}),
		});

		return new Box({
			fillWidth: true,
			background: pal.card,
			child: new VStack({
				gap: 0,
				children: [headerContent, new Divider({ color: pal.line })],
			}),
		});
	}

	function rebuildUi(): void {
		const pal = getPalette(dark);
		app.setTheme(makeHopperGuiTheme(dark));
		rootBox.setBackground(pal.page);

		let stageChild: GuiComponent;
		if (route === "log") {
			stageChild = buildLogRoute(pal);
		} else if (activeTab === "plan") {
			stageChild = buildPlanTab(pal);
		} else if (activeTab === "vehicle") {
			stageChild = buildVehicleTab(pal);
		} else {
			stageChild = new VStack({
				gap: 16,
				children: [buildApogeeCard(pal), buildDispersionCard(pal), buildTiltCard(pal)],
			});
		}

		const centeredColumn = new Box({
			maxWidth: 880,
			fillWidth: true,
			alignHorizontal: "center",
			padding: { horizontal: 20, top: 18, bottom: 28 },
			child: stageChild,
		});

		const scroll = new ScrollView({
			primary: true,
			overscroll: "contain",
			padding: 0,
			child: centeredColumn,
		});

		const shellChildren: StackChild[] = [
			{ child: buildHeader(pal), shrink: 0 },
			{ child: scroll, grow: 1 },
		];
		if (route === "tabs" && activeTab === "plan") {
			shellChildren.push({ child: buildPlanFooterBar(pal), shrink: 0 });
		}

		const shell = new VStack({
			gap: 0,
			children: shellChildren,
		});

		rootBox.setChild(shell);
		app.invalidate();
	}

	function selectTab(tab: HopperTab): void {
		route = "tabs";
		activeTab = tab;
		rebuildUi();
	}

	function openLog(): void {
		route = "log";
		rebuildUi();
	}

	function goBack(): void {
		route = "tabs";
		rebuildUi();
	}

	function toggleTheme(): void {
		dark = !dark;
		rebuildUi();
	}

	function resetPlan(): void {
		plan = defaultFlightPlan();
		rebuildUi();
	}

	function flyHop(): void {
		const prevNum = hops[hops.length - 1]?.num ?? 40;
		const num = prevNum + 1;
		const id = num < 10 ? `H-0${num}` : `H-${num}`;
		const safeguardPenalty = (plan.autoLevelTrim ? 0 : 0.65) + (plan.rcsRollHold ? 0 : 0.72);
		const jitterX = (((num * 37) % 19) - 9) * 0.08 + safeguardPenalty * 0.4;
		const jitterY = (((num * 53) % 17) - 8) * 0.08 - safeguardPenalty * 0.3;
		const tx = Number(clampNumber(plan.targetX * 0.08 + jitterX, -3.1, 3.1).toFixed(2));
		const ty = Number(clampNumber(plan.targetY * 0.08 + jitterY, -3.1, 3.1).toFixed(2));
		const offset = Number(Math.hypot(tx, ty).toFixed(2));
		const overCeiling = plan.targetZ > TARGET_CEILING_M;
		const tilt = Number((2.2 + safeguardPenalty * 2.1 + (overCeiling ? 2.4 : 0)).toFixed(1));
		const outcome: HopOutcome = overCeiling || tilt > 7.5 ? "abort" : offset > 1.85 ? "hard" : "nominal";
		const apogee = Number((plan.targetZ + (((num * 13) % 7) - 3) * 0.4).toFixed(1));
		const dur = Number((15.0 + plan.hoverDurationS).toFixed(1));

		const record: HopRecord = {
			id,
			num,
			apogeeM: apogee,
			peakTiltDeg: tilt,
			durationS: dur,
			padOffsetM: offset,
			touchdownX: tx,
			touchdownY: ty,
			outcome,
			note: `${plan.easing} · ${outcome === "nominal" ? "Closed-loop touchdown" : "Envelope limit event"}`,
			ageLabel: "just now",
		};
		hops.push(record);
		scatterDots = [...scatterDots, { xM: tx, yM: ty, outcome, hopNum: num }];
		selectedHopNum = num;
		propMassKg = Math.max(80, propMassKg - 14);
		lastLaunchSummary = `${id} ${outcomeLabel(outcome)} · ${apogee.toFixed(1)} m apogee · ${offset.toFixed(2)} m pad offset`;
		rebuildUi();
	}

	rebuildUi();

	return {
		app,
		windowTitle: "Hopper Lab · GNC Telemetry",
		getState: (): HopperAppStateSnapshot => ({
			dark,
			route,
			activeTab,
			hopCount: hops.length,
			selectedHopNum,
			latestHopId: latestHop().id,
			selectedQuad: selectedQuadId,
			dryMassKg,
			propMassKg,
			lastLaunchSummary,
		}),
		selectTab,
		openLog,
		goBack,
		flyHop,
		toggleTheme,
		resetPlan,
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
	const backend = new HeadlessBackend({ width: 1040, height: 780 });
	const ctrl = createHopperApp(backend);
	const winId = ctrl.app.windowId;
	try {
		ctrl.app.renderFrame();
		const initial = ctrl.getState();

		const hopLogBtn = findBtn(backend, winId, "Hop log");
		if (hopLogBtn === undefined) {
			console.log("Hopper headless smoke FAILED: missing Hop log button");
			return 1;
		}
		backend.triggerA11yPress(hopLogBtn.id, winId);
		ctrl.app.step();
		const onLog = ctrl.getState().route === "log";

		const backBtn = findBtn(backend, winId, "Back");
		if (backBtn === undefined) {
			console.log("Hopper headless smoke FAILED: missing Back button on log route");
			return 1;
		}
		backend.triggerA11yPress(backBtn.id, winId);
		ctrl.app.step();

		const planBtn = findBtn(backend, winId, "Plan");
		if (planBtn === undefined) {
			console.log("Hopper headless smoke FAILED: missing Plan tab button");
			return 1;
		}
		backend.triggerA11yPress(planBtn.id, winId);
		ctrl.app.step();

		const flyBtn = findBtn(backend, winId, "Fly Hop");
		if (flyBtn === undefined) {
			console.log("Hopper headless smoke FAILED: missing Fly Hop CTA button");
			return 1;
		}
		backend.triggerA11yPress(flyBtn.id, winId);
		ctrl.app.step();
		const afterFly = ctrl.getState();

		const vehicleBtn = findBtn(backend, winId, "Vehicle");
		if (vehicleBtn === undefined) {
			console.log("Hopper headless smoke FAILED: missing Vehicle tab button");
			return 1;
		}
		backend.triggerA11yPress(vehicleBtn.id, winId);
		ctrl.app.step();
		const onVehicle = ctrl.getState().activeTab === "vehicle";

		const themeBtn = findBtn(backend, winId, "Light Theme");
		if (themeBtn !== undefined) {
			backend.triggerA11yPress(themeBtn.id, winId);
			ctrl.app.step();
		}
		const switchedLight = !ctrl.getState().dark;

		const ok =
			onLog &&
			afterFly.hopCount === initial.hopCount + 1 &&
			afterFly.latestHopId === "H-41" &&
			onVehicle &&
			switchedLight;

		console.log(
			`Hopper headless smoke ok=${String(ok)} hops=${String(afterFly.hopCount)} latest=${afterFly.latestHopId} light=${String(switchedLight)} a11y=${String(backend.getAccessibilityTree(winId).length)}`,
		);
		return ok ? 0 : 1;
	} finally {
		ctrl.app.dispose();
	}
}

function runNativeSmoke(): number {
	const ctrl = createHopperApp();
	try {
		ctrl.app.renderFrame();
		ctrl.selectTab("plan");
		ctrl.app.renderFrame();
		ctrl.flyHop();
		ctrl.app.renderFrame();
		ctrl.selectTab("vehicle");
		ctrl.app.renderFrame();
		ctrl.openLog();
		ctrl.app.renderFrame();
		ctrl.goBack();
		ctrl.app.renderFrame();
		ctrl.toggleTheme();
		const frame = ctrl.app.renderFrame();

		const metrics = ctrl.app.getWindowMetrics();
		const state = ctrl.getState();
		const ok =
			frame.byteLength > 0 &&
			metrics.width > 0 &&
			metrics.height > 0 &&
			state.hopCount === 41 &&
			state.route === "tabs" &&
			!state.dark;
		console.log(
			`Hopper native smoke ok=${String(ok)} window=${String(metrics.width)}x${String(metrics.height)} hops=${String(state.hopCount)} frameBytes=${String(frame.byteLength)}`,
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

	const ctrl = createHopperApp();
	try {
		await ctrl.app.run();
	} finally {
		ctrl.app.dispose();
	}
}

void main();
