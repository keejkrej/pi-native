/**
 * RGBA bitmap image component with aspect-ratio containment and rounded clipping.
 */

import { GuiComponent, type GuiRenderContext, type Size } from "../component.ts";

export type ImageFitMode = "contain" | "stretch" | "none";

export interface ImageOptions {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
	readonly displayWidth?: number;
	readonly displayHeight?: number;
	readonly fit?: ImageFitMode;
	readonly radius?: number;
}

export class Image extends GuiComponent {
	private pixelWidth: number;
	private pixelHeight: number;
	private pixels: Uint8Array;
	private displayWidth: number | undefined;
	private displayHeight: number | undefined;
	private fit: ImageFitMode;
	private radius: number;

	constructor(options: ImageOptions) {
		super();
		const expected = options.width * options.height * 4;
		if (options.pixels.byteLength < expected) {
			throw new Error(`Image pixels buffer too small: expected ${expected}, got ${options.pixels.byteLength}`);
		}
		this.pixelWidth = Math.max(0, options.width);
		this.pixelHeight = Math.max(0, options.height);
		this.pixels = options.pixels;
		this.displayWidth = options.displayWidth;
		this.displayHeight = options.displayHeight;
		this.fit = options.fit ?? "contain";
		this.radius = options.radius ?? 0;
	}

	setPixels(width: number, height: number, pixels: Uint8Array): void {
		const expected = width * height * 4;
		if (pixels.byteLength < expected) {
			throw new Error(`Image pixels buffer too small: expected ${expected}, got ${pixels.byteLength}`);
		}
		this.pixelWidth = Math.max(0, width);
		this.pixelHeight = Math.max(0, height);
		this.pixels = pixels;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		if (this.pixelWidth === 0 || this.pixelHeight === 0) {
			return { width: 0, height: 0 };
		}
		let targetW = this.displayWidth ?? this.pixelWidth;
		let targetH = this.displayHeight ?? this.pixelHeight;

		if (this.fit === "contain") {
			const aspect = this.pixelWidth / this.pixelHeight;
			if (targetW > maxWidth && maxWidth > 0) {
				targetW = maxWidth;
				targetH = targetW / aspect;
			}
			if (maxHeight !== undefined && targetH > maxHeight && maxHeight > 0) {
				targetH = maxHeight;
				targetW = targetH * aspect;
			}
		} else {
			targetW = Math.min(targetW, maxWidth);
			if (maxHeight !== undefined) {
				targetH = Math.min(targetH, maxHeight);
			}
		}
		return { width: Math.max(0, targetW), height: Math.max(0, targetH) };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible || this.pixelWidth === 0 || this.pixelHeight === 0) {
			return;
		}
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		let drawW = r.width;
		let drawH = r.height;
		if (this.fit === "contain") {
			const aspect = this.pixelWidth / this.pixelHeight;
			if (drawW / drawH > aspect) {
				drawW = drawH * aspect;
			} else {
				drawH = drawW / aspect;
			}
		} else if (this.fit === "none") {
			drawW = Math.min(r.width, this.pixelWidth);
			drawH = Math.min(r.height, this.pixelHeight);
		}
		const drawX = r.x + (r.width - drawW) * 0.5;
		const drawY = r.y + (r.height - drawH) * 0.5;
		ctx.drawImageRgba(drawX, drawY, drawW, drawH, this.radius, this.pixelWidth, this.pixelHeight, this.pixels);
	}
}
