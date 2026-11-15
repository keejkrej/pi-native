/**
 * Interactive GUI form controls: Switch, Slider, and SegmentedControl.
 */

import type { TextStyle } from "../backend.ts";
import { mixColors, rgbColor, withAlpha } from "../colors.ts";
import {
	allocateA11yId,
	clampNumber,
	drawFocusHalo,
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import type { GuiKeyEvent } from "../keys.ts";
import {
	type A11yActionKind,
	type GuiA11yNode,
	SGUI_A11Y_STATE_CHECKED,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_A11Y_STATE_SELECTED,
	SGUI_CURSOR_ARROW,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_REGULAR,
} from "../protocol.ts";

export interface SwitchOptions {
	readonly checked?: boolean;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly onChange?: (checked: boolean) => void;
}

const SWITCH_TRACK_W = 36;
const SWITCH_TRACK_H = 20;
const SWITCH_KNOB_SIZE = 16;
const SWITCH_GAP = 10;

export class Switch extends GuiComponent {
	private checkedValue: boolean;
	private labelValue: string;
	private disabled: boolean;
	private pressed: boolean;

	onChange: ((checked: boolean) => void) | undefined;

	constructor(options: SwitchOptions = {}) {
		super();
		this.checkedValue = options.checked ?? false;
		this.labelValue = options.label ?? "";
		this.disabled = options.disabled ?? false;
		this.pressed = false;
		this.onChange = options.onChange;
		this.focusable = !this.disabled;
		this.cursor = this.disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
	}

	isChecked(): boolean {
		return this.checkedValue;
	}

	setChecked(checked: boolean): void {
		if (this.checkedValue === checked) return;
		this.checkedValue = checked;
		this.invalidate();
	}

	getLabel(): string {
		return this.labelValue;
	}

	setLabel(label: string): void {
		if (this.labelValue === label) return;
		this.labelValue = label;
		this.invalidate();
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.focusable = !disabled;
		this.cursor = disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
		if (disabled) this.pressed = false;
		this.invalidate();
	}

	isDisabled(): boolean {
		return this.disabled;
	}

	private toggleInternal(): void {
		if (this.disabled) return;
		this.checkedValue = !this.checkedValue;
		this.onChange?.(this.checkedValue);
		this.invalidate();
	}

	private labelStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: ctx.theme.fontSizeBody,
			fontWeight: 500,
		};
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const style = this.labelStyle(ctx);
		const lineH = ctx.measureText(style, 0, "Mg").lineHeight;
		const labelW = this.labelValue.length > 0 ? ctx.measureText(style, 0, this.labelValue).width + SWITCH_GAP : 0;
		return {
			width: Math.min(maxWidth, SWITCH_TRACK_W + labelW + 4),
			height: Math.max(SWITCH_TRACK_H + 4, lineH + 4),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const trackY = r.y + Math.max(0, (r.height - SWITCH_TRACK_H) * 0.5);
		const trackRadius = SWITCH_TRACK_H * 0.5;
		const trackRect: Rect = { x: r.x, y: trackY, width: SWITCH_TRACK_W, height: SWITCH_TRACK_H };
		const neutralTrack = ctx.theme.dark
			? mixColors(ctx.theme.surfaceElevated, ctx.theme.border, 0.55)
			: mixColors(ctx.theme.surfaceMuted, ctx.theme.border, 0.45);

		let trackColor = this.checkedValue ? ctx.theme.accent : neutralTrack;
		if (this.disabled) {
			trackColor = ctx.theme.surfaceMuted;
		} else if (ctx.isHovered(this) || this.pressed) {
			trackColor = this.checkedValue ? ctx.theme.accentHover : mixColors(neutralTrack, ctx.theme.text, 0.1);
		}
		const focused = ctx.isFocused(this);
		if (focused) {
			drawFocusHalo(ctx, trackRect, trackRadius, 0.24, 3);
		}
		ctx.fillRect(r.x, trackY, SWITCH_TRACK_W, SWITCH_TRACK_H, trackColor, trackRadius);

		const borderColor = focused
			? ctx.theme.borderFocus
			: this.checkedValue
				? withAlpha(trackColor, 0.9)
				: withAlpha(ctx.theme.border, 0.85);
		ctx.strokeRect(r.x, trackY, SWITCH_TRACK_W, SWITCH_TRACK_H, borderColor, 1, trackRadius);

		const knobOffset = this.checkedValue ? SWITCH_TRACK_W - SWITCH_KNOB_SIZE - 2 : 2;
		const knobY = trackY + 2;
		if (!this.disabled) {
			ctx.fillRect(
				r.x + knobOffset,
				knobY + 1,
				SWITCH_KNOB_SIZE,
				SWITCH_KNOB_SIZE,
				withAlpha(ctx.theme.shadow, ctx.theme.dark ? 0.36 : 0.16),
				SWITCH_KNOB_SIZE * 0.5,
			);
		}
		const knobColor = this.disabled ? ctx.theme.textDisabled : rgbColor(255, 255, 255);
		ctx.fillRect(r.x + knobOffset, knobY, SWITCH_KNOB_SIZE, SWITCH_KNOB_SIZE, knobColor, SWITCH_KNOB_SIZE * 0.5);

		if (this.labelValue.length > 0) {
			const style = this.labelStyle(ctx);
			const lineH = ctx.measureText(style, 0, "Mg").lineHeight;
			const labelX = r.x + SWITCH_TRACK_W + SWITCH_GAP;
			const availW = Math.max(0, r.x + r.width - labelX);
			if (availW > 0) {
				const textY = r.y + Math.max(0, (r.height - lineH) * 0.5);
				ctx.drawStyledText(
					labelX,
					textY,
					availW,
					this.disabled ? ctx.theme.textDisabled : ctx.theme.text,
					style,
					this.labelValue,
				);
			}
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (this.disabled) {
			if (event.phase === "up") {
				this.pressed = false;
				return { handled: false, releaseCapture: true };
			}
			return { handled: false };
		}
		const inside = pointInRect(event.x, event.y, this.layoutRect);
		if (event.phase === "down" && event.button === "left" && inside) {
			this.pressed = true;
			this.invalidate();
			return { handled: true, focus: this, capture: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "drag" && this.pressed) {
			return { handled: true, capture: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up") {
			const wasPressed = this.pressed;
			this.pressed = false;
			if (wasPressed && inside) {
				this.toggleInternal();
			} else {
				this.invalidate();
			}
			return { handled: wasPressed || inside, releaseCapture: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (inside) {
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: false };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.disabled || event.phase === "up") return false;
		if (ctx.keybindings.matches(event, "activate") || ctx.keybindings.matches(event, "toggle")) {
			this.toggleInternal();
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		const r = this.layoutRect;
		if (!this.visible || r.width <= 0 || r.height <= 0) return;
		let flags = this.disabled ? 0 : SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		if (this.checkedValue) flags |= SGUI_A11Y_STATE_CHECKED;
		out.push({
			id: this.a11yId,
			role: "checkbox",
			stateFlags: flags,
			rect: r,
			label: this.labelValue.length > 0 ? this.labelValue : "Switch",
			value: this.checkedValue ? "1" : "0",
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId || this.disabled) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press") {
			ctx.requestFocus(this);
			this.toggleInternal();
			return true;
		}
		if (action === "setValue") {
			const normalized = value.trim().toLowerCase();
			let nextChecked: boolean;
			if (normalized === "1" || normalized === "true" || normalized === "on") {
				nextChecked = true;
			} else if (normalized === "0" || normalized === "false" || normalized === "off") {
				nextChecked = false;
			} else {
				return false;
			}
			ctx.requestFocus(this);
			if (this.checkedValue !== nextChecked) {
				this.checkedValue = nextChecked;
				this.onChange?.(this.checkedValue);
			}
			this.invalidate();
			return true;
		}
		return false;
	}
}

export interface SliderOptions {
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly value?: number;
	readonly label?: string;
	readonly showValue?: boolean;
	readonly width?: number;
	readonly disabled?: boolean;
	readonly formatValue?: (value: number) => string;
	readonly onChange?: (value: number) => void;
}

const SLIDER_TRACK_H = 4;
const SLIDER_THUMB_R = 8;

export class Slider extends GuiComponent {
	private min: number;
	private max: number;
	private step: number;
	private valueValue: number;
	private labelValue: string;
	private readonly showValue: boolean;
	private readonly preferredWidth: number;
	private disabled: boolean;
	private dragging: boolean;
	private readonly formatValue: ((value: number) => string) | undefined;

	onChange: ((value: number) => void) | undefined;

	constructor(options: SliderOptions = {}) {
		super();
		const min = options.min ?? 0;
		const max = options.max ?? 100;
		this.min = min;
		this.max = max >= min ? max : min;
		this.step = options.step !== undefined && options.step > 0 ? options.step : 0;
		this.labelValue = options.label ?? "";
		this.showValue = options.showValue ?? true;
		this.preferredWidth = Math.max(120, options.width ?? 220);
		this.disabled = options.disabled ?? false;
		this.dragging = false;
		this.formatValue = options.formatValue;
		this.onChange = options.onChange;
		this.valueValue = this.normalizeValue(options.value ?? this.min);
		this.focusable = !this.disabled;
		this.cursor = this.disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
	}

	getValue(): number {
		return this.valueValue;
	}

	setValue(value: number): void {
		const next = this.normalizeValue(value);
		if (next === this.valueValue) return;
		this.valueValue = next;
		this.invalidate();
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.focusable = !disabled;
		this.cursor = disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
		if (disabled) this.dragging = false;
		this.invalidate();
	}

	isDisabled(): boolean {
		return this.disabled;
	}

	private normalizeValue(raw: number): number {
		const clamped = clampNumber(raw, this.min, this.max);
		if (this.step <= 0 || this.max <= this.min) {
			return clamped;
		}
		const steps = Math.round((clamped - this.min) / this.step);
		const snapped = this.min + steps * this.step;
		const cleaned = Math.round(snapped * 1_000_000) / 1_000_000;
		return clampNumber(cleaned, this.min, this.max);
	}

	private commitValue(raw: number): void {
		const next = this.normalizeValue(raw);
		if (next === this.valueValue) return;
		this.valueValue = next;
		this.onChange?.(this.valueValue);
		this.invalidate();
	}

	private keyStepAmount(): number {
		if (this.step > 0) return this.step;
		const span = this.max - this.min;
		return span > 0 ? span / 20 : 1;
	}

	private formattedValue(): string {
		if (this.formatValue !== undefined) {
			return this.formatValue(this.valueValue);
		}
		if (Math.abs(this.valueValue - Math.round(this.valueValue)) < 1e-6) {
			return `${Math.round(this.valueValue)}`;
		}
		return this.valueValue.toFixed(2);
	}

	private headerStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: ctx.theme.fontSizeSmall,
			fontWeight: 500,
		};
	}

	private trackGeometry(ctx: GuiRenderContext, rect: Rect): {
		readonly headerH: number;
		readonly trackX: number;
		readonly trackY: number;
		readonly trackW: number;
	} {
		const hasHeader = this.labelValue.length > 0 || this.showValue;
		const lineH = hasHeader ? ctx.measureText(this.headerStyle(ctx), 0, "Mg").lineHeight : 0;
		const headerH = hasHeader ? lineH + 6 : 0;
		const trackX = rect.x + SLIDER_THUMB_R;
		const trackW = Math.max(16, rect.width - SLIDER_THUMB_R * 2);
		const trackY = rect.y + headerH + 8;
		return { headerH, trackX, trackY, trackW };
	}

	private updateFromPointerX(pointerX: number, ctx: GuiRenderContext): void {
		const geom = this.trackGeometry(ctx, this.layoutRect);
		const t = clampNumber((pointerX - geom.trackX) / geom.trackW, 0, 1);
		const raw = this.min + t * (this.max - this.min);
		this.commitValue(raw);
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const hasHeader = this.labelValue.length > 0 || this.showValue;
		const lineH = hasHeader ? ctx.measureText(this.headerStyle(ctx), 0, "Mg").lineHeight : 0;
		const headerH = hasHeader ? lineH + 6 : 0;
		return {
			width: Math.min(maxWidth, this.preferredWidth),
			height: headerH + 22,
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const geom = this.trackGeometry(ctx, r);
		const style = this.headerStyle(ctx);

		if (this.labelValue.length > 0) {
			ctx.drawStyledText(
				r.x,
				r.y,
				r.width * 0.7,
				this.disabled ? ctx.theme.textDisabled : ctx.theme.text,
				style,
				this.labelValue,
			);
		}
		if (this.showValue) {
			const valStr = this.formattedValue();
			const valW = ctx.measureText(style, 0, valStr).width;
			ctx.drawStyledText(
				Math.max(r.x, r.x + r.width - valW),
				r.y,
				valW + 2,
				this.disabled ? ctx.theme.textDisabled : ctx.theme.textMuted,
				style,
				valStr,
			);
		}

		const trackFill = mixColors(ctx.theme.surfaceMuted, ctx.theme.border, 0.4);
		ctx.fillRect(geom.trackX, geom.trackY, geom.trackW, SLIDER_TRACK_H, trackFill, SLIDER_TRACK_H * 0.5);
		ctx.strokeRect(
			geom.trackX,
			geom.trackY,
			geom.trackW,
			SLIDER_TRACK_H,
			withAlpha(ctx.theme.border, 0.7),
			1,
			SLIDER_TRACK_H * 0.5,
		);

		const span = this.max - this.min;
		const ratio = span > 0 ? clampNumber((this.valueValue - this.min) / span, 0, 1) : 0;
		const fillW = geom.trackW * ratio;
		const fillColor = this.disabled ? ctx.theme.textDisabled : ctx.theme.accent;
		if (fillW > 0) {
			ctx.fillRect(geom.trackX, geom.trackY, fillW, SLIDER_TRACK_H, fillColor, SLIDER_TRACK_H * 0.5);
		}

		const thumbCenterX = geom.trackX + fillW;
		const thumbCenterY = geom.trackY + SLIDER_TRACK_H * 0.5;
		const focused = ctx.isFocused(this);
		const thumbSize = SLIDER_THUMB_R * 2;
		const thumbX = thumbCenterX - SLIDER_THUMB_R;
		const thumbY = thumbCenterY - SLIDER_THUMB_R;
		const thumbRect: Rect = { x: thumbX, y: thumbY, width: thumbSize, height: thumbSize };
		if (focused) {
			drawFocusHalo(ctx, thumbRect, SLIDER_THUMB_R, 0.24, 3);
		}
		if (!this.disabled) {
			ctx.fillRect(
				thumbX,
				thumbY + 1,
				thumbSize,
				thumbSize,
				withAlpha(ctx.theme.shadow, ctx.theme.dark ? 0.36 : 0.16),
				SLIDER_THUMB_R,
			);
		}
		ctx.fillRect(
			thumbX,
			thumbY,
			thumbSize,
			thumbSize,
			this.disabled ? ctx.theme.surfaceMuted : rgbColor(255, 255, 255),
			SLIDER_THUMB_R,
		);
		ctx.strokeRect(
			thumbX,
			thumbY,
			thumbSize,
			thumbSize,
			focused ? ctx.theme.borderFocus : fillColor,
			1.5,
			SLIDER_THUMB_R,
		);
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		if (this.disabled) {
			if (event.phase === "up") {
				this.dragging = false;
				return { handled: false, releaseCapture: true };
			}
			return { handled: false };
		}
		const inside = pointInRect(event.x, event.y, this.layoutRect);
		if (event.phase === "down" && event.button === "left" && inside) {
			this.dragging = true;
			this.updateFromPointerX(event.x, ctx);
			return { handled: true, focus: this, capture: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "drag" && this.dragging) {
			this.updateFromPointerX(event.x, ctx);
			return { handled: true, capture: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up") {
			const wasDragging = this.dragging;
			this.dragging = false;
			if (wasDragging) {
				this.updateFromPointerX(event.x, ctx);
			}
			return { handled: wasDragging || inside, releaseCapture: true, cursor: SGUI_CURSOR_POINTER };
		}
		if (inside) {
			return { handled: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: false };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.disabled || event.phase === "up") return false;
		const delta = this.keyStepAmount();
		if (ctx.keybindings.matches(event, "stepDecrement")) {
			this.commitValue(this.valueValue - delta);
			return true;
		}
		if (ctx.keybindings.matches(event, "stepIncrement")) {
			this.commitValue(this.valueValue + delta);
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		const r = this.layoutRect;
		if (!this.visible || r.width <= 0 || r.height <= 0) return;
		let flags = this.disabled ? 0 : SGUI_A11Y_STATE_ENABLED;
		if (ctx.isFocused(this)) flags |= SGUI_A11Y_STATE_FOCUSED;
		out.push({
			id: this.a11yId,
			role: "slider",
			stateFlags: flags,
			rect: r,
			label: this.labelValue.length > 0 ? this.labelValue : "Slider",
			value: this.formattedValue(),
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId || this.disabled) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		const delta = this.keyStepAmount();
		if (action === "increment") {
			ctx.requestFocus(this);
			this.commitValue(this.valueValue + delta);
			return true;
		}
		if (action === "decrement") {
			ctx.requestFocus(this);
			this.commitValue(this.valueValue - delta);
			return true;
		}
		if (action === "setValue") {
			const parsed = Number.parseFloat(value);
			if (!Number.isFinite(parsed)) return false;
			ctx.requestFocus(this);
			this.commitValue(parsed);
			return true;
		}
		return false;
	}
}

export interface SegmentedItem {
	readonly id: string;
	readonly label: string;
}

export interface SegmentedControlOptions {
	readonly items: readonly SegmentedItem[];
	readonly selectedId?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly onChange?: (id: string) => void;
}

export class SegmentedControl extends GuiComponent {
	private items: SegmentedItem[];
	private selectedIdValue: string;
	private labelValue: string;
	private disabled: boolean;
	private hoverIndex: number;
	private readonly segmentA11yIds: number[];

	onChange: ((id: string) => void) | undefined;

	constructor(options: SegmentedControlOptions) {
		super();
		this.items = options.items.slice();
		const first = this.items[0];
		this.selectedIdValue = options.selectedId ?? (first !== undefined ? first.id : "");
		this.labelValue = options.label ?? "";
		this.disabled = options.disabled ?? false;
		this.hoverIndex = -1;
		this.segmentA11yIds = [];
		this.onChange = options.onChange;
		this.focusable = !this.disabled;
		this.cursor = this.disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
	}

	getSelectedId(): string {
		return this.selectedIdValue;
	}

	setSelectedId(id: string): void {
		if (this.selectedIdValue === id) return;
		this.selectedIdValue = id;
		this.invalidate();
	}

	setItems(items: readonly SegmentedItem[]): void {
		this.items = items.slice();
		const stillPresent = this.items.some((item) => item.id === this.selectedIdValue);
		if (!stillPresent) {
			const first = this.items[0];
			this.selectedIdValue = first !== undefined ? first.id : "";
		}
		this.invalidate();
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.focusable = !disabled;
		this.cursor = disabled ? SGUI_CURSOR_ARROW : SGUI_CURSOR_POINTER;
		this.invalidate();
	}

	private ensureSegmentA11yId(index: number): number {
		while (this.segmentA11yIds.length <= index) {
			this.segmentA11yIds.push(allocateA11yId());
		}
		return this.segmentA11yIds[index] ?? this.a11yId;
	}

	private commitSelection(id: string): void {
		if (this.disabled || this.selectedIdValue === id) return;
		this.selectedIdValue = id;
		this.onChange?.(id);
		this.invalidate();
	}

	private stepSelection(delta: number): void {
		if (this.items.length === 0) return;
		const currentIdx = Math.max(
			0,
			this.items.findIndex((item) => item.id === this.selectedIdValue),
		);
		const nextIdx = (currentIdx + delta + this.items.length) % this.items.length;
		const next = this.items[nextIdx];
		if (next !== undefined) {
			this.commitSelection(next.id);
		}
	}

	private labelStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: ctx.theme.fontSizeSmall,
			fontWeight: 600,
		};
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const style = this.labelStyle(ctx);
		const lineH = ctx.measureText(style, 0, "Mg").lineHeight;
		let maxSegW = 56;
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const w = ctx.measureText(style, 0, item.label).width + 24;
			if (w > maxSegW) maxSegW = w;
		}
		const naturalW = Math.max(80, this.items.length * maxSegW + 6);
		return {
			width: Math.min(maxWidth, naturalW),
			height: Math.max(30, lineH + 14),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const trackRadius = 9;
		const pillRadius = 6;
		const focused = ctx.isFocused(this);
		if (focused) {
			drawFocusHalo(ctx, r, trackRadius, 0.22, 3);
		}
		ctx.fillRect(r.x, r.y, r.width, r.height, ctx.theme.surfaceMuted, trackRadius);
		ctx.strokeRect(
			r.x,
			r.y,
			r.width,
			r.height,
			focused ? ctx.theme.borderFocus : withAlpha(ctx.theme.border, 0.85),
			1,
			trackRadius,
		);

		const count = this.items.length;
		if (count === 0) return;
		const innerW = Math.max(1, r.width - 6);
		const segW = innerW / count;
		const segH = Math.max(1, r.height - 6);
		const segY = r.y + 3;
		const hovered = ctx.isHovered(this);
		const baseStyle = this.labelStyle(ctx);
		const selectedStyle: TextStyle = {
			fontFamily: baseStyle.fontFamily,
			fontSize: baseStyle.fontSize,
			fontWeight: 600,
		};
		const lineH = ctx.measureText(baseStyle, 0, "Mg").lineHeight;

		for (let i = 0; i < count; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const segX = r.x + 3 + i * segW;
			const selected = item.id === this.selectedIdValue;
			if (selected) {
				const activeBg = this.disabled
					? ctx.theme.surfaceElevated
					: ctx.theme.dark
						? ctx.theme.surfaceElevated
						: rgbColor(255, 255, 255);
				if (!this.disabled) {
					ctx.fillRect(
						segX,
						segY + 1,
						segW,
						segH,
						withAlpha(ctx.theme.shadow, ctx.theme.dark ? 0.3 : 0.1),
						pillRadius,
					);
				}
				ctx.fillRect(segX, segY, segW, segH, activeBg, pillRadius);
				ctx.strokeRect(
					segX,
					segY,
					segW,
					segH,
					withAlpha(ctx.theme.border, ctx.theme.dark ? 0.9 : 0.65),
					1,
					pillRadius,
				);
			}
			const style = selected ? selectedStyle : baseStyle;
			const textW = ctx.measureText(style, 0, item.label).width;
			const textX = segX + Math.max(4, (segW - textW) * 0.5);
			const textY = segY + Math.max(0, (segH - lineH) * 0.5);
			let textColor = hovered && this.hoverIndex === i ? ctx.theme.text : ctx.theme.textMuted;
			if (this.disabled) {
				textColor = ctx.theme.textDisabled;
			} else if (selected) {
				textColor = ctx.theme.text;
			}
			ctx.drawStyledText(textX, textY, Math.max(8, segW - 8), textColor, style, item.label);
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (this.disabled) {
			if (event.phase === "up") {
				return { handled: false, releaseCapture: true };
			}
			return { handled: false };
		}
		if (event.phase === "leave") {
			if (this.hoverIndex !== -1) {
				this.hoverIndex = -1;
				this.invalidate();
			}
			return { handled: false };
		}
		if (!pointInRect(event.x, event.y, this.layoutRect)) {
			if (this.hoverIndex !== -1) {
				this.hoverIndex = -1;
				this.invalidate();
			}
			if (event.phase === "up") {
				return { handled: false, releaseCapture: true };
			}
			return { handled: false };
		}
		if (this.items.length > 0) {
			const innerW = Math.max(1, this.layoutRect.width - 6);
			const segW = innerW / this.items.length;
			const rawIdx = Math.floor((event.x - (this.layoutRect.x + 3)) / segW);
			const idx = clampNumber(rawIdx, 0, this.items.length - 1);
			if (this.hoverIndex !== idx) {
				this.hoverIndex = idx;
				this.invalidate();
			}
			if (event.phase === "down" && event.button === "left") {
				const item = this.items[idx];
				if (item !== undefined) {
					this.commitSelection(item.id);
				}
				return { handled: true, focus: this, cursor: SGUI_CURSOR_POINTER };
			}
		}
		if (event.phase === "up") {
			return { handled: true, releaseCapture: true, cursor: SGUI_CURSOR_POINTER };
		}
		return { handled: true, cursor: SGUI_CURSOR_POINTER };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.disabled || event.phase === "up" || this.items.length === 0) return false;
		if (ctx.keybindings.matches(event, "stepDecrement")) {
			this.stepSelection(-1);
			return true;
		}
		if (ctx.keybindings.matches(event, "stepIncrement")) {
			this.stepSelection(1);
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		const r = this.layoutRect;
		if (!this.visible || r.width <= 0 || r.height <= 0 || this.items.length === 0) return;
		const count = this.items.length;
		const innerW = Math.max(1, r.width - 6);
		const segW = innerW / count;
		const segH = Math.max(1, r.height - 6);
		const segY = r.y + 3;
		const focused = ctx.isFocused(this);
		if (this.labelValue.length > 0) {
			let groupFlags = this.disabled ? 0 : SGUI_A11Y_STATE_ENABLED;
			if (focused) groupFlags |= SGUI_A11Y_STATE_FOCUSED;
			const activeItem = this.items.find((item) => item.id === this.selectedIdValue);
			out.push({
				id: this.a11yId,
				role: "radioGroup",
				stateFlags: groupFlags,
				rect: r,
				label: this.labelValue,
				value: activeItem !== undefined ? activeItem.label : this.selectedIdValue,
			});
		}
		for (let i = 0; i < count; i++) {
			const item = this.items[i];
			if (item === undefined) continue;
			const selected = item.id === this.selectedIdValue;
			let flags = this.disabled ? 0 : SGUI_A11Y_STATE_ENABLED;
			if (selected) flags |= SGUI_A11Y_STATE_SELECTED;
			if (selected && focused) flags |= SGUI_A11Y_STATE_FOCUSED;
			out.push({
				id: this.ensureSegmentA11yId(i),
				role: "button",
				stateFlags: flags,
				rect: { x: r.x + 3 + i * segW, y: segY, width: segW, height: segH },
				label: item.label,
				value: selected ? "1" : "0",
			});
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (nodeId === this.a11yId || this.segmentA11yIds.includes(nodeId)) {
			return this;
		}
		return undefined;
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		ctx: GuiRenderContext,
	): boolean {
		if (this.disabled) return false;
		const isSelf = nodeId === this.a11yId;
		const segIdx = this.segmentA11yIds.indexOf(nodeId);
		if (!isSelf && segIdx < 0) return false;
		if (action === "focus") {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "increment") {
			ctx.requestFocus(this);
			this.stepSelection(1);
			return true;
		}
		if (action === "decrement") {
			ctx.requestFocus(this);
			this.stepSelection(-1);
			return true;
		}
		if (action !== "press") return false;
		if (isSelf && this.items.length > 0) {
			ctx.requestFocus(this);
			this.stepSelection(1);
			return true;
		}
		const item = this.items[segIdx];
		if (item === undefined) return false;
		ctx.requestFocus(this);
		this.commitSelection(item.id);
		return true;
	}
}
