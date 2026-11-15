/**
 * Animated vector activity spinner with message label.
 */

import type { TextStyle } from "../backend.ts";
import { mixColors } from "../colors.ts";
import { GuiComponent, type GuiRenderContext, type Size } from "../component.ts";
import { type GuiA11yNode, SGUI_A11Y_STATE_ENABLED, SGUI_FONT_REGULAR } from "../protocol.ts";

export interface LoaderOptions {
	readonly message?: string;
	readonly size?: number;
	readonly running?: boolean;
}

export class Loader extends GuiComponent {
	private message: string;
	private spinnerSize: number;
	private running: boolean;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(options: LoaderOptions = {}) {
		super();
		this.message = options.message ?? "Working...";
		this.spinnerSize = options.size ?? 16;
		this.running = options.running ?? false;
		this.timer = undefined;
	}

	getMessage(): string {
		return this.message;
	}

	setMessage(message: string): void {
		if (this.message === message) return;
		this.message = message;
		this.invalidate();
	}

	isRunning(): boolean {
		return this.running;
	}

	start(intervalMs = 80): void {
		if (this.running) return;
		this.running = true;
		this.timer = setInterval(() => {
			if (this.running) {
				this.invalidate();
			}
		}, intervalMs);
		this.invalidate();
	}

	stop(): void {
		this.running = false;
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.invalidate();
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const style: TextStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: ctx.theme.fontSizeBody };
		const msgW =
			this.message.length > 0 ? ctx.measureText(style, maxWidth - this.spinnerSize - 10, this.message).width : 0;
		const lineH = ctx.measureText(style, 0, "Mg").lineHeight;
		return {
			width: Math.min(maxWidth, this.spinnerSize + (msgW > 0 ? 10 + msgW : 0)),
			height: Math.max(this.spinnerSize, lineH),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const cx = r.x + this.spinnerSize * 0.5;
		const cy = r.y + r.height * 0.5;
		const spokeCount = 8;
		const activeStep = this.running ? Math.floor(ctx.nowMs / 90) % spokeCount : 0;
		const innerRadius = this.spinnerSize * 0.24;
		const outerRadius = this.spinnerSize * 0.46;

		for (let i = 0; i < spokeCount; i++) {
			const angle = (i * Math.PI * 2) / spokeCount;
			const dist = (spokeCount - ((i - activeStep + spokeCount) % spokeCount)) / spokeCount;
			const color = mixColors(ctx.theme.textMuted, ctx.theme.accent, this.running ? dist : 0.3);
			const x1 = cx + Math.cos(angle) * innerRadius;
			const y1 = cy + Math.sin(angle) * innerRadius;
			const x2 = cx + Math.cos(angle) * outerRadius;
			const y2 = cy + Math.sin(angle) * outerRadius;
			ctx.drawLine(x1, y1, x2, y2, color, 2);
		}

		if (this.message.length > 0) {
			const style: TextStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: ctx.theme.fontSizeBody };
			const lineH = ctx.measureText(style, 0, "Mg").lineHeight;
			const textX = r.x + this.spinnerSize + 10;
			const textY = r.y + Math.max(0, (r.height - lineH) * 0.5);
			const availW = Math.max(0, r.width - (this.spinnerSize + 10));
			if (availW > 0) {
				ctx.drawStyledText(textX, textY, availW, ctx.theme.textMuted, style, this.message);
			}
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		const r = this.layoutRect;
		if (!this.visible || r.width <= 0 || r.height <= 0) return;
		const text = this.message.trim();
		if (text.length === 0) return;
		out.push({
			id: this.a11yId,
			role: "staticText",
			stateFlags: SGUI_A11Y_STATE_ENABLED,
			rect: r,
			label: text,
			value: text,
		});
	}
}
