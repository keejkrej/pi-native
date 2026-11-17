/**
 * Anti-aliased 2x Retina pure-TypeScript vector rasterizer, geometric icon primitives,
 * vector canvas component, and compact status badge/pill widget.
 */

import { type Color, colorToRgba, packRgba, withAlpha } from "../colors.ts";
import {
	clampNumber,
	drawFocusHalo,
	type Edges,
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import type { GuiKeyEvent } from "../keys.ts";
import { clamp01 } from "../oklab.ts";
import {
	type A11yActionKind,
	type A11yRole,
	type CursorKindId,
	type GuiA11yNode,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_CURSOR_ARROW,
	SGUI_FONT_REGULAR,
} from "../protocol.ts";

export interface VectorPoint {
	readonly x: number;
	readonly y: number;
}

export type VectorIconName =
	| "plus"
	| "minus"
	| "reset"
	| "sun"
	| "moon"
	| "check"
	| "trash"
	| "chevron-right"
	| "chevron-left"
	| "chevron-down"
	| "chevron-up"
	| "arrow-left"
	| "arrow-right"
	| "arrow-up"
	| "arrow-down"
	| "search"
	| "sliders"
	| "palette"
	| "layout"
	| "list"
	| "activity"
	| "rocket"
	| "compass"
	| "crosshair"
	| "cpu"
	| "shield"
	| "sparkles"
	| "terminal"
	| "folder"
	| "send"
	| "stop"
	| "menu"
	| "info"
	| "alert"
	| "panel-left"
	| "panel-right"
	| "compose"
	| "git-branch"
	| "git-commit"
	| "file-diff"
	| "file-code"
	| "laptop"
	| "copy"
	| "edit"
	| "pin"
	| "fork"
	| "close"
	| "external-link"
	| "eye"
	| "monitor"
	| "waku-mark";

/**
 * Pure-TypeScript anti-aliased RGBA pixel surface (default 2x Retina scale)
 * compatible with straight-alpha CoreGraphics / SGUI_CMD_DRAW_IMAGE_RGBA blitting.
 */
export class RasterSurface {
	readonly width: number;
	readonly height: number;
	readonly scale: number;
	readonly pixelWidth: number;
	readonly pixelHeight: number;
	readonly pixels: Uint8Array;

	constructor(width: number, height: number, scale = 2) {
		this.width = Math.max(0, width);
		this.height = Math.max(0, height);
		this.scale = Math.max(1, scale);
		this.pixelWidth = Math.max(0, Math.round(this.width * this.scale));
		this.pixelHeight = Math.max(0, Math.round(this.height * this.scale));
		this.pixels = new Uint8Array(this.pixelWidth * this.pixelHeight * 4);
	}

	/** Clear the entire surface to transparent or a solid/translucent color. */
	clear(color?: Color): void {
		if (color === undefined) {
			this.pixels.fill(0);
			return;
		}
		const rgba = colorToRgba(color);
		const r = clampByteInt(rgba.r);
		const g = clampByteInt(rgba.g);
		const b = clampByteInt(rgba.b);
		const a = clampByteInt(clamp01(rgba.a) * 255);
		const buf = this.pixels;
		for (let i = 0; i < buf.length; i += 4) {
			buf[i] = r;
			buf[i + 1] = g;
			buf[i + 2] = b;
			buf[i + 3] = a;
		}
	}

	/**
	 * Straight-alpha Porter-Duff source-over composite onto pixel (px, py).
	 * darwin.m uploads RGBA with kCGImageAlphaLast (unpremultiplied), so keeping
	 * straight RGB avoids dark fringes on semi-transparent anti-aliased edges.
	 */
	private blendPixel(px: number, py: number, sr: number, sg: number, sb: number, sa: number): void {
		if (px < 0 || px >= this.pixelWidth || py < 0 || py >= this.pixelHeight || sa <= 0) {
			return;
		}
		const clampedSa = sa > 1 ? 1 : sa;
		const idx = (py * this.pixelWidth + px) * 4;
		const buf = this.pixels;
		if (clampedSa >= 0.9999) {
			buf[idx] = sr;
			buf[idx + 1] = sg;
			buf[idx + 2] = sb;
			buf[idx + 3] = 255;
			return;
		}
		const da = (buf[idx + 3] ?? 0) / 255;
		if (da <= 0.0001) {
			buf[idx] = sr;
			buf[idx + 1] = sg;
			buf[idx + 2] = sb;
			buf[idx + 3] = clampByteInt(clampedSa * 255);
			return;
		}
		const invSa = 1 - clampedSa;
		const outA = clampedSa + da * invSa;
		if (outA <= 0) return;
		const invOutA = 1 / outA;
		const dr = buf[idx] ?? 0;
		const dg = buf[idx + 1] ?? 0;
		const db = buf[idx + 2] ?? 0;
		buf[idx] = clampByteInt((sr * clampedSa + dr * da * invSa) * invOutA);
		buf[idx + 1] = clampByteInt((sg * clampedSa + dg * da * invSa) * invOutA);
		buf[idx + 2] = clampByteInt((sb * clampedSa + db * da * invSa) * invOutA);
		buf[idx + 3] = clampByteInt(outA * 255);
	}

	/** Fill an anti-aliased rounded rectangle in logical surface coordinates. */
	fillRoundedRect(x: number, y: number, w: number, h: number, radius: number, color: Color): void {
		const rgba = colorToRgba(color);
		if (rgba.a <= 0 || w <= 0 || h <= 0 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
		const s = this.scale;
		const sx = x * s;
		const sy = y * s;
		const sw = w * s;
		const sh = h * s;
		const sr = Math.min(Math.max(0, radius * s), sw * 0.5, sh * 0.5);
		const hx = sw * 0.5;
		const hy = sh * 0.5;
		const cx = sx + hx;
		const cy = sy + hy;
		const bx = hx - sr;
		const by = hy - sr;

		const minX = Math.max(0, Math.floor(sx - 1));
		const maxX = Math.min(this.pixelWidth - 1, Math.ceil(sx + sw + 1));
		const minY = Math.max(0, Math.floor(sy - 1));
		const maxY = Math.min(this.pixelHeight - 1, Math.ceil(sy + sh + 1));

		const r = clampByteInt(rgba.r);
		const g = clampByteInt(rgba.g);
		const b = clampByteInt(rgba.b);
		const baseA = clamp01(rgba.a);

		for (let py = minY; py <= maxY; py++) {
			const qy = Math.abs(py + 0.5 - cy) - by;
			const clippedQy = qy > 0 ? qy : 0;
			for (let px = minX; px <= maxX; px++) {
				const qx = Math.abs(px + 0.5 - cx) - bx;
				const clippedQx = qx > 0 ? qx : 0;
				const outside = Math.hypot(clippedQx, clippedQy);
				const inside = Math.min(Math.max(qx, qy), 0);
				const sd = outside + inside - sr;
				const cov = clamp01(0.5 - sd);
				if (cov > 0) {
					this.blendPixel(px, py, r, g, b, baseA * cov);
				}
			}
		}
	}

	/** Fill an anti-aliased circle in logical surface coordinates. */
	fillCircle(cx: number, cy: number, radius: number, color: Color): void {
		const rgba = colorToRgba(color);
		if (rgba.a <= 0 || radius <= 0 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
		const s = this.scale;
		const scx = cx * s;
		const scy = cy * s;
		const sr = radius * s;

		const minX = Math.max(0, Math.floor(scx - sr - 1.5));
		const maxX = Math.min(this.pixelWidth - 1, Math.ceil(scx + sr + 1.5));
		const minY = Math.max(0, Math.floor(scy - sr - 1.5));
		const maxY = Math.min(this.pixelHeight - 1, Math.ceil(scy + sr + 1.5));

		const r = clampByteInt(rgba.r);
		const g = clampByteInt(rgba.g);
		const b = clampByteInt(rgba.b);
		const baseA = clamp01(rgba.a);

		for (let py = minY; py <= maxY; py++) {
			const dy = py + 0.5 - scy;
			for (let px = minX; px <= maxX; px++) {
				const dx = px + 0.5 - scx;
				const dist = Math.hypot(dx, dy);
				const cov = clamp01(0.5 - (dist - sr));
				if (cov > 0) {
					this.blendPixel(px, py, r, g, b, baseA * cov);
				}
			}
		}
	}

	/** Stroke an anti-aliased circle outline centered at (cx, cy). */
	strokeCircle(cx: number, cy: number, radius: number, lineWidth: number, color: Color): void {
		const rgba = colorToRgba(color);
		if (rgba.a <= 0 || radius <= 0 || lineWidth <= 0 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
		const s = this.scale;
		const scx = cx * s;
		const scy = cy * s;
		const sr = radius * s;
		const hw = Math.max(0.45, lineWidth * s * 0.5);

		const outer = sr + hw + 1.5;
		const minX = Math.max(0, Math.floor(scx - outer));
		const maxX = Math.min(this.pixelWidth - 1, Math.ceil(scx + outer));
		const minY = Math.max(0, Math.floor(scy - outer));
		const maxY = Math.min(this.pixelHeight - 1, Math.ceil(scy + outer));

		const r = clampByteInt(rgba.r);
		const g = clampByteInt(rgba.g);
		const b = clampByteInt(rgba.b);
		const baseA = clamp01(rgba.a);

		for (let py = minY; py <= maxY; py++) {
			const dy = py + 0.5 - scy;
			for (let px = minX; px <= maxX; px++) {
				const dx = px + 0.5 - scx;
				const dist = Math.hypot(dx, dy);
				const cov = clamp01(0.5 - (Math.abs(dist - sr) - hw));
				if (cov > 0) {
					this.blendPixel(px, py, r, g, b, baseA * cov);
				}
			}
		}
	}

	/**
	 * Draw an anti-aliased circular arc / gauge ring segment from startAngle to endAngle (radians).
	 * Clockwise in screen space (0 = right, -PI/2 = top).
	 */
	drawArc(
		cx: number,
		cy: number,
		radius: number,
		startAngle: number,
		endAngle: number,
		lineWidth: number,
		color: Color,
		capRound = true,
	): void {
		const sweep = endAngle - startAngle;
		if (sweep <= 0 || radius <= 0 || lineWidth <= 0 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
		if (sweep >= Math.PI * 2 - 1e-5) {
			this.strokeCircle(cx, cy, radius, lineWidth, color);
			return;
		}
		const rgba = colorToRgba(color);
		if (rgba.a <= 0) return;

		const s = this.scale;
		const scx = cx * s;
		const scy = cy * s;
		const sr = radius * s;
		const hw = Math.max(0.45, lineWidth * s * 0.5);

		const outer = sr + hw + 1.5;
		const minX = Math.max(0, Math.floor(scx - outer));
		const maxX = Math.min(this.pixelWidth - 1, Math.ceil(scx + outer));
		const minY = Math.max(0, Math.floor(scy - outer));
		const maxY = Math.min(this.pixelHeight - 1, Math.ceil(scy + outer));

		const midAngle = (startAngle + endAngle) * 0.5;
		const halfSweep = sweep * 0.5;

		const cosStart = Math.cos(startAngle);
		const sinStart = Math.sin(startAngle);
		const startCapX = cosStart * sr;
		const startCapY = sinStart * sr;

		const cosEnd = Math.cos(endAngle);
		const sinEnd = Math.sin(endAngle);
		const endCapX = cosEnd * sr;
		const endCapY = sinEnd * sr;

		const r = clampByteInt(rgba.r);
		const g = clampByteInt(rgba.g);
		const b = clampByteInt(rgba.b);
		const baseA = clamp01(rgba.a);

		for (let py = minY; py <= maxY; py++) {
			const dy = py + 0.5 - scy;
			for (let px = minX; px <= maxX; px++) {
				const dx = px + 0.5 - scx;
				const radial = Math.hypot(dx, dy);
				const radialDiff = Math.abs(radial - sr);
				if (radialDiff > hw + 1.5) continue;

				let delta = Math.atan2(dy, dx) - midAngle;
				while (delta > Math.PI) delta -= Math.PI * 2;
				while (delta < -Math.PI) delta += Math.PI * 2;

				let sd: number;
				if (Math.abs(delta) <= halfSweep) {
					sd = radialDiff - hw;
				} else if (capRound) {
					const dStart = Math.hypot(dx - startCapX, dy - startCapY);
					const dEnd = Math.hypot(dx - endCapX, dy - endCapY);
					sd = Math.min(dStart, dEnd) - hw;
				} else {
					const projStart = clampNumber(dx * cosStart + dy * sinStart, sr - hw, sr + hw);
					const distStart = Math.hypot(dx - cosStart * projStart, dy - sinStart * projStart);
					const projEnd = clampNumber(dx * cosEnd + dy * sinEnd, sr - hw, sr + hw);
					const distEnd = Math.hypot(dx - cosEnd * projEnd, dy - sinEnd * projEnd);
					sd = Math.min(distStart, distEnd) - 0.5;
				}

				const cov = clamp01(0.5 - sd);
				if (cov > 0) {
					this.blendPixel(px, py, r, g, b, baseA * cov);
				}
			}
		}
	}

	/** Alias of drawArc for progress rings and radial gauges. */
	drawRing(
		cx: number,
		cy: number,
		radius: number,
		startAngle: number,
		endAngle: number,
		thickness: number,
		color: Color,
		capRound = true,
	): void {
		this.drawArc(cx, cy, radius, startAngle, endAngle, thickness, color, capRound);
	}

	/** Draw an anti-aliased line segment using exact capsule/box distance field. */
	drawLineAA(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		lineWidth: number,
		color: Color,
		capRound = true,
	): void {
		const rgba = colorToRgba(color);
		if (rgba.a <= 0 || lineWidth <= 0 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;

		const s = this.scale;
		const sx1 = x1 * s;
		const sy1 = y1 * s;
		const sx2 = x2 * s;
		const sy2 = y2 * s;
		const hw = Math.max(0.45, lineWidth * s * 0.5);

		const vx = sx2 - sx1;
		const vy = sy2 - sy1;
		const lenSq = vx * vx + vy * vy;
		if (lenSq < 1e-8) {
			if (capRound) {
				this.fillCircle(x1, y1, lineWidth * 0.5, color);
			}
			return;
		}
		const len = Math.sqrt(lenSq);
		const invLen = 1 / len;
		const ux = vx * invLen;
		const uy = vy * invLen;

		const pad = hw + 1.5;
		const minX = Math.max(0, Math.floor(Math.min(sx1, sx2) - pad));
		const maxX = Math.min(this.pixelWidth - 1, Math.ceil(Math.max(sx1, sx2) + pad));
		const minY = Math.max(0, Math.floor(Math.min(sy1, sy2) - pad));
		const maxY = Math.min(this.pixelHeight - 1, Math.ceil(Math.max(sy1, sy2) + pad));

		const r = clampByteInt(rgba.r);
		const g = clampByteInt(rgba.g);
		const b = clampByteInt(rgba.b);
		const baseA = clamp01(rgba.a);

		for (let py = minY; py <= maxY; py++) {
			const dy = py + 0.5 - sy1;
			for (let px = minX; px <= maxX; px++) {
				const dx = px + 0.5 - sx1;
				let sd: number;
				if (capRound) {
					const t = clamp01((dx * vx + dy * vy) / lenSq);
					sd = Math.hypot(dx - t * vx, dy - t * vy) - hw;
				} else {
					const along = dx * ux + dy * uy;
					const perp = Math.abs(-dx * uy + dy * ux);
					const endDist = Math.max(-along, along - len);
					const perpDist = perp - hw;
					if (endDist > 0 && perpDist > 0) {
						sd = Math.hypot(endDist, perpDist);
					} else {
						sd = Math.max(endDist, perpDist);
					}
				}
				const cov = clamp01(0.5 - sd);
				if (cov > 0) {
					this.blendPixel(px, py, r, g, b, baseA * cov);
				}
			}
		}
	}

	/**
	 * Draw a multi-segment anti-aliased polyline without alpha double-blending at vertices.
	 */
	drawPolylineAA(points: readonly VectorPoint[], lineWidth: number, color: Color, closed = false): void {
		if (points.length < 2 || lineWidth <= 0 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
		const rgba = colorToRgba(color);
		if (rgba.a <= 0) return;

		const s = this.scale;
		const hw = Math.max(0.45, lineWidth * s * 0.5);
		const pad = hw + 2;

		let minPxX = Number.POSITIVE_INFINITY;
		let minPxY = Number.POSITIVE_INFINITY;
		let maxPxX = Number.NEGATIVE_INFINITY;
		let maxPxY = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < points.length; i++) {
			const pt = points[i];
			if (pt === undefined) continue;
			const sx = pt.x * s;
			const sy = pt.y * s;
			if (sx < minPxX) minPxX = sx;
			if (sx > maxPxX) maxPxX = sx;
			if (sy < minPxY) minPxY = sy;
			if (sy > maxPxY) maxPxY = sy;
		}

		const x0 = Math.max(0, Math.floor(minPxX - pad));
		const y0 = Math.max(0, Math.floor(minPxY - pad));
		const x1 = Math.min(this.pixelWidth - 1, Math.ceil(maxPxX + pad));
		const y1 = Math.min(this.pixelHeight - 1, Math.ceil(maxPxY + pad));
		const bw = x1 - x0 + 1;
		const bh = y1 - y0 + 1;
		if (bw <= 0 || bh <= 0) return;

		const covBuf = new Float32Array(bw * bh);
		const segCount = closed ? points.length : points.length - 1;

		for (let i = 0; i < segCount; i++) {
			const a = points[i];
			const b = points[(i + 1) % points.length];
			if (a === undefined || b === undefined) continue;

			const sx1 = a.x * s;
			const sy1 = a.y * s;
			const sx2 = b.x * s;
			const sy2 = b.y * s;
			const vx = sx2 - sx1;
			const vy = sy2 - sy1;
			const lenSq = vx * vx + vy * vy;

			const segMinX = Math.max(x0, Math.floor(Math.min(sx1, sx2) - pad));
			const segMaxX = Math.min(x1, Math.ceil(Math.max(sx1, sx2) + pad));
			const segMinY = Math.max(y0, Math.floor(Math.min(sy1, sy2) - pad));
			const segMaxY = Math.min(y1, Math.ceil(Math.max(sy1, sy2) + pad));

			for (let py = segMinY; py <= segMaxY; py++) {
				const rowOffset = (py - y0) * bw;
				const dy = py + 0.5 - sy1;
				for (let px = segMinX; px <= segMaxX; px++) {
					const dx = px + 0.5 - sx1;
					const dist =
						lenSq < 1e-8
							? Math.hypot(dx, dy)
							: (() => {
									const t = clamp01((dx * vx + dy * vy) / lenSq);
									return Math.hypot(dx - t * vx, dy - t * vy);
								})();
					const cov = clamp01(0.5 - (dist - hw));
					if (cov > 0) {
						const bufIdx = rowOffset + (px - x0);
						const prev = covBuf[bufIdx] ?? 0;
						if (cov > prev) {
							covBuf[bufIdx] = cov;
						}
					}
				}
			}
		}

		const r = clampByteInt(rgba.r);
		const g = clampByteInt(rgba.g);
		const b = clampByteInt(rgba.b);
		const baseA = clamp01(rgba.a);

		for (let ry = 0; ry < bh; ry++) {
			const rowOffset = ry * bw;
			const py = y0 + ry;
			for (let rx = 0; rx < bw; rx++) {
				const cov = covBuf[rowOffset + rx] ?? 0;
				if (cov > 0) {
					this.blendPixel(x0 + rx, py, r, g, b, baseA * cov);
				}
			}
		}
	}

	/**
	 * Fill an anti-aliased area under a polyline down to baselineY with an optional vertical gradient.
	 */
	fillAreaCurve(
		points: readonly VectorPoint[],
		baselineY: number,
		topColor: Color,
		bottomColor?: Color,
	): void {
		if (points.length < 2 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
		const topRgba = colorToRgba(topColor);
		const botRgba = colorToRgba(bottomColor ?? withAlpha(topColor, 0));
		if (topRgba.a <= 0 && botRgba.a <= 0) return;

		const s = this.scale;
		const first = points[0];
		const last = points[points.length - 1];
		if (first === undefined || last === undefined) return;

		const polyX: number[] = [];
		const polyY: number[] = [];
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = baselineY * s;
		let maxY = baselineY * s;

		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			if (p === undefined) continue;
			const sx = p.x * s;
			const sy = p.y * s;
			polyX.push(sx);
			polyY.push(sy);
			if (sx < minX) minX = sx;
			if (sx > maxX) maxX = sx;
			if (sy < minY) minY = sy;
			if (sy > maxY) maxY = sy;
		}
		const baseSy = baselineY * s;
		polyX.push(last.x * s, first.x * s);
		polyY.push(baseSy, baseSy);

		const x0 = Math.max(0, Math.floor(minX - 1));
		const x1 = Math.min(this.pixelWidth - 1, Math.ceil(maxX + 1));
		const y0 = Math.max(0, Math.floor(minY - 1));
		const y1 = Math.min(this.pixelHeight - 1, Math.ceil(maxY + 1));
		const bw = x1 - x0 + 1;
		const bh = y1 - y0 + 1;
		if (bw <= 0 || bh <= 0) return;

		const covBuf = new Float32Array(bw * bh);
		const polyCount = polyX.length;

		// 4x rotated-grid MSAA subsamples per pixel for smooth diagonal edges
		const subOffsetsX = [0.125, 0.375, 0.625, 0.875];
		const subOffsetsY = [0.375, 0.875, 0.125, 0.625];
		const intersections: number[] = [];

		for (let py = y0; py <= y1; py++) {
			const rowOffset = (py - y0) * bw;
			for (let sample = 0; sample < 4; sample++) {
				const sy = py + (subOffsetsY[sample] ?? 0.5);
				const ox = subOffsetsX[sample] ?? 0.5;
				intersections.length = 0;

				for (let i = 0; i < polyCount; i++) {
					const j = (i + 1) % polyCount;
					const yA = polyY[i] ?? 0;
					const yB = polyY[j] ?? 0;
					if ((yA <= sy && yB > sy) || (yB <= sy && yA > sy)) {
						const xA = polyX[i] ?? 0;
						const xB = polyX[j] ?? 0;
						const t = (sy - yA) / (yB - yA);
						intersections.push(xA + t * (xB - xA));
					}
				}
				if (intersections.length < 2) continue;
				intersections.sort((a, b) => a - b);

				for (let k = 0; k + 1 < intersections.length; k += 2) {
					const spanStart = intersections[k] ?? 0;
					const spanEnd = intersections[k + 1] ?? 0;
					const pxStart = Math.max(x0, Math.ceil(spanStart - ox));
					const pxEnd = Math.min(x1, Math.floor(spanEnd - ox));
					for (let px = pxStart; px <= pxEnd; px++) {
						const idx = rowOffset + (px - x0);
						covBuf[idx] = (covBuf[idx] ?? 0) + 0.25;
					}
				}
			}
		}

		const gradSpan = Math.max(1, baseSy - minY);
		for (let ry = 0; ry < bh; ry++) {
			const py = y0 + ry;
			const rowOffset = ry * bw;
			const t = clamp01((py + 0.5 - minY) / gradSpan);
			const cr = clampByteInt(topRgba.r + (botRgba.r - topRgba.r) * t);
			const cg = clampByteInt(topRgba.g + (botRgba.g - topRgba.g) * t);
			const cb = clampByteInt(topRgba.b + (botRgba.b - topRgba.b) * t);
			const ca = clamp01(topRgba.a + (botRgba.a - topRgba.a) * t);
			if (ca <= 0) continue;

			for (let rx = 0; rx < bw; rx++) {
				const cov = covBuf[rowOffset + rx] ?? 0;
				if (cov > 0) {
					this.blendPixel(x0 + rx, py, cr, cg, cb, ca * cov);
				}
			}
		}
	}

	/** Blit this surface onto a GUI render context. */
	blit(ctx: GuiRenderContext, x: number, y: number, radius = 0, w = this.width, h = this.height): void {
		if (w <= 0 || h <= 0 || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
		ctx.drawImageRgba(x, y, w, h, radius, this.pixelWidth, this.pixelHeight, this.pixels);
	}
}

function clampByteInt(value: number): number {
	const rounded = Math.round(value);
	if (rounded < 0) return 0;
	if (rounded > 255) return 255;
	return rounded;
}

const ICON_SURFACE_CACHE = new Map<string, RasterSurface>();
const MAX_ICON_CACHE_ENTRIES = 512;

/** Render a crisp geometric vector icon into a RasterSurface at (x, y, size). */
export function renderVectorIcon(
	surface: RasterSurface,
	name: VectorIconName,
	x: number,
	y: number,
	size: number,
	color: Color,
	strokeWidth?: number,
): void {
	if (size <= 0) return;
	const u = size / 24;
	const lw = strokeWidth ?? Math.max(1.35, size * 0.088);
	const dotR = Math.max(0.85, lw * 0.62);

	const p = (gx: number, gy: number): VectorPoint => ({
		x: x + gx * u,
		y: y + gy * u,
	});
	const line = (x1: number, y1: number, x2: number, y2: number): void => {
		surface.drawLineAA(x + x1 * u, y + y1 * u, x + x2 * u, y + y2 * u, lw, color, true);
	};
	const poly = (pts: readonly [number, number][], closed = false): void => {
		const mapped: VectorPoint[] = [];
		for (let i = 0; i < pts.length; i++) {
			const pair = pts[i];
			if (pair === undefined) continue;
			mapped.push(p(pair[0], pair[1]));
		}
		surface.drawPolylineAA(mapped, lw, color, closed);
	};
	const circle = (cx: number, cy: number, r: number): void => {
		surface.strokeCircle(x + cx * u, y + cy * u, r * u, lw, color);
	};
	const fillDot = (cx: number, cy: number, r = dotR): void => {
		surface.fillCircle(x + cx * u, y + cy * u, r, color);
	};
	const arc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number): void => {
		surface.drawArc(x + cx * u, y + cy * u, r * u, startAngle, endAngle, lw, color, true);
	};
	const strokeRoundRect = (rx: number, ry: number, rw: number, rh: number, rr: number): void => {
		const cr = Math.min(rr, rw * 0.5, rh * 0.5);
		line(rx + cr, ry, rx + rw - cr, ry);
		line(rx + rw, ry + cr, rx + rw, ry + rh - cr);
		line(rx + rw - cr, ry + rh, rx + cr, ry + rh);
		line(rx, ry + rh - cr, rx, ry + cr);
		if (cr > 0.1) {
			arc(rx + cr, ry + cr, cr, Math.PI, Math.PI * 1.5);
			arc(rx + rw - cr, ry + cr, cr, -Math.PI * 0.5, 0);
			arc(rx + rw - cr, ry + rh - cr, cr, 0, Math.PI * 0.5);
			arc(rx + cr, ry + rh - cr, cr, Math.PI * 0.5, Math.PI);
		}
	};

	switch (name) {
		case "plus":
			line(12, 5, 12, 19);
			line(5, 12, 19, 12);
			break;
		case "minus":
			line(5, 12, 19, 12);
			break;
		case "reset":
			arc(12, 12, 6.75, -Math.PI * 0.8, Math.PI * 0.68);
			poly([
				[5.5, 4.5],
				[5.5, 8.7],
				[9.7, 8.7],
			]);
			break;
		case "sun":
			circle(12, 12, 4);
			line(12, 2.5, 12, 4.7);
			line(12, 19.3, 12, 21.5);
			line(2.5, 12, 4.7, 12);
			line(19.3, 12, 21.5, 12);
			line(5.3, 5.3, 6.8, 6.8);
			line(17.2, 17.2, 18.7, 18.7);
			line(18.7, 5.3, 17.2, 6.8);
			line(6.8, 17.2, 5.3, 18.7);
			break;
		case "moon":
			arc(13, 12, 7, -Math.PI * 0.42, Math.PI * 0.85);
			arc(15.6, 9.2, 4.9, Math.PI * 0.25, Math.PI * 1.15);
			break;
		case "check":
			poly([
				[4.8, 12.6],
				[9.6, 17.4],
				[19.2, 7.2],
			]);
			break;
		case "trash":
			line(4.5, 6.5, 19.5, 6.5);
			line(9.2, 4, 14.8, 4);
			poly([
				[6.5, 6.5],
				[7.6, 19.5],
				[16.4, 19.5],
				[17.5, 6.5],
			]);
			line(10, 10.2, 10, 16.2);
			line(14, 10.2, 14, 16.2);
			break;
		case "chevron-right":
			poly([
				[9, 5.5],
				[15.5, 12],
				[9, 18.5],
			]);
			break;
		case "chevron-left":
			poly([
				[15, 5.5],
				[8.5, 12],
				[15, 18.5],
			]);
			break;
		case "search":
			circle(10.5, 10.5, 6);
			line(15, 15, 20, 20);
			break;
		case "sliders":
			line(4, 7, 20, 7);
			line(4, 12, 20, 12);
			line(4, 17, 20, 17);
			fillDot(9, 7, lw * 1.05);
			fillDot(15.5, 12, lw * 1.05);
			fillDot(10.5, 17, lw * 1.05);
			break;
		case "palette":
			arc(12, 12, 8.2, Math.PI * 0.2, Math.PI * 1.85);
			fillDot(8.8, 9.2, lw * 0.85);
			fillDot(13.2, 7.8, lw * 0.85);
			fillDot(16.2, 11.4, lw * 0.85);
			fillDot(8.6, 13.8, lw * 0.85);
			break;
		case "layout":
			poly(
				[
					[4, 4.5],
					[20, 4.5],
					[20, 19.5],
					[4, 19.5],
				],
				true,
			);
			line(4, 9.5, 20, 9.5);
			line(10, 9.5, 10, 19.5);
			break;
		case "list":
			fillDot(5.5, 7, dotR);
			fillDot(5.5, 12, dotR);
			fillDot(5.5, 17, dotR);
			line(9.2, 7, 19.5, 7);
			line(9.2, 12, 19.5, 12);
			line(9.2, 17, 19.5, 17);
			break;
		case "activity":
			poly([
				[2.5, 12],
				[6.8, 12],
				[9.8, 4.5],
				[14.2, 19.5],
				[17.2, 12],
				[21.5, 12],
			]);
			break;
		case "rocket":
			poly([
				[14.8, 3.8],
				[19.2, 4.8],
				[20.2, 9.2],
				[12.4, 17],
				[7, 11.6],
				[14.8, 3.8],
			]);
			poly([
				[7, 11.6],
				[4, 13.6],
				[6.5, 17.5],
				[10.4, 20],
				[12.4, 17],
			]);
			fillDot(14.5, 9.5, lw * 0.8);
			break;
		case "compass":
			circle(12, 12, 8.5);
			poly(
				[
					[15.6, 8.4],
					[13.4, 13.4],
					[8.4, 15.6],
					[10.6, 10.6],
				],
				true,
			);
			break;
		case "crosshair":
			circle(12, 12, 7);
			line(12, 2.5, 12, 7);
			line(12, 17, 12, 21.5);
			line(2.5, 12, 7, 12);
			line(17, 12, 21.5, 12);
			fillDot(12, 12, lw * 0.85);
			break;
		case "cpu":
			poly(
				[
					[6.5, 6.5],
					[17.5, 6.5],
					[17.5, 17.5],
					[6.5, 17.5],
				],
				true,
			);
			poly(
				[
					[10, 10],
					[14, 10],
					[14, 14],
					[10, 14],
				],
				true,
			);
			line(9.5, 3, 9.5, 6.5);
			line(14.5, 3, 14.5, 6.5);
			line(9.5, 17.5, 9.5, 21);
			line(14.5, 17.5, 14.5, 21);
			line(3, 9.5, 6.5, 9.5);
			line(3, 14.5, 6.5, 14.5);
			line(17.5, 9.5, 21, 9.5);
			line(17.5, 14.5, 21, 14.5);
			break;
		case "shield":
			poly(
				[
					[12, 3.2],
					[19, 6.2],
					[19, 12],
					[15.8, 17.4],
					[12, 20.6],
					[8.2, 17.4],
					[5, 12],
					[5, 6.2],
				],
				true,
			);
			poly([
				[9.2, 12],
				[11.2, 14.2],
				[15.2, 9.8],
			]);
			break;
		case "sparkles":
			poly([
				[12, 3],
				[13.6, 8.8],
				[19.5, 10.4],
				[13.6, 12],
				[12, 17.8],
				[10.4, 12],
				[4.5, 10.4],
				[10.4, 8.8],
				[12, 3],
			]);
			line(18.2, 15.5, 18.2, 20.5);
			line(15.7, 18, 20.7, 18);
			break;
		case "terminal":
			poly(
				[
					[3.5, 5],
					[20.5, 5],
					[20.5, 19],
					[3.5, 19],
				],
				true,
			);
			poly([
				[7, 9.5],
				[10.5, 12.2],
				[7, 15],
			]);
			line(12.5, 15, 17, 15);
			break;
		case "folder":
			poly(
				[
					[3.5, 6.2],
					[9.5, 6.2],
					[11.6, 8.5],
					[20.5, 8.5],
					[20.5, 18.5],
					[3.5, 18.5],
				],
				true,
			);
			break;
		case "send":
			poly(
				[
					[20.5, 3.8],
					[13.5, 20.2],
					[10.6, 13.4],
					[3.8, 10.5],
				],
				true,
			);
			line(10.6, 13.4, 20.5, 3.8);
			break;
		case "stop":
			surface.fillRoundedRect(x + 6 * u, y + 6 * u, 12 * u, 12 * u, 2 * u, color);
			break;
		case "menu":
			line(4, 6.5, 20, 6.5);
			line(4, 12, 20, 12);
			line(4, 17.5, 20, 17.5);
			break;
		case "info":
			circle(12, 12, 8.5);
			line(12, 11, 12, 16.5);
			fillDot(12, 7.6, dotR);
			break;
		case "alert":
			poly(
				[
					[12, 3.6],
					[20.6, 19.2],
					[3.4, 19.2],
				],
				true,
			);
			line(12, 9.2, 12, 13.8);
			fillDot(12, 16.4, dotR * 0.92);
			break;
		case "panel-left":
			strokeRoundRect(3.2, 3.2, 17.6, 17.6, 2.8);
			line(9.2, 3.6, 9.2, 20.4);
			break;
		case "panel-right":
			strokeRoundRect(3.2, 3.2, 17.6, 17.6, 2.8);
			line(14.8, 3.6, 14.8, 20.4);
			break;
		case "compose":
			poly([
				[12.5, 4],
				[6, 4],
				[4, 6],
				[4, 18],
				[6, 20],
				[18, 20],
				[20, 18],
				[20, 11.5],
			]);
			line(19.5, 4.5, 11, 13);
			poly([
				[10, 14],
				[11, 11.5],
				[12.5, 13],
			]);
			break;
		case "arrow-left":
			line(19, 12, 5.2, 12);
			poly([
				[11.5, 5.6],
				[5, 12],
				[11.5, 18.4],
			]);
			break;
		case "arrow-right":
			line(5, 12, 18.8, 12);
			poly([
				[12.5, 5.6],
				[19, 12],
				[12.5, 18.4],
			]);
			break;
		case "arrow-up":
			line(12, 19, 12, 5.2);
			poly([
				[5.6, 11.5],
				[12, 5],
				[18.4, 11.5],
			]);
			break;
		case "arrow-down":
			line(12, 5, 12, 18.8);
			poly([
				[5.6, 12.5],
				[12, 19],
				[18.4, 12.5],
			]);
			break;
		case "chevron-down":
			poly([
				[6.2, 9.2],
				[12, 15.2],
				[17.8, 9.2],
			]);
			break;
		case "chevron-up":
			poly([
				[6.2, 15],
				[12, 9],
				[17.8, 15],
			]);
			break;
		case "git-branch":
			line(6.5, 3.5, 6.5, 15);
			circle(17.5, 6.2, 2.7);
			circle(6.5, 17.8, 2.7);
			arc(9.5, 8.9, 8.0, 0, Math.PI * 0.5);
			break;
		case "git-commit":
			circle(12, 12, 3.1);
			line(3, 12, 8.8, 12);
			line(15.2, 12, 21, 12);
			break;
		case "file-diff":
			poly(
				[
					[14.2, 2.8],
					[5.8, 2.8],
					[4.5, 4.1],
					[4.5, 19.9],
					[5.8, 21.2],
					[18.2, 21.2],
					[19.5, 19.9],
					[19.5, 8.1],
				],
				true,
			);
			poly([
				[14.2, 2.8],
				[14.2, 8.1],
				[19.5, 8.1],
			]);
			line(9.2, 12.8, 14.8, 12.8);
			line(12, 10, 12, 15.6);
			line(9.2, 18.2, 14.8, 18.2);
			break;
		case "file-code":
			poly(
				[
					[14.2, 2.8],
					[5.8, 2.8],
					[4.5, 4.1],
					[4.5, 19.9],
					[5.8, 21.2],
					[18.2, 21.2],
					[19.5, 19.9],
					[19.5, 8.1],
				],
				true,
			);
			poly([
				[14.2, 2.8],
				[14.2, 8.1],
				[19.5, 8.1],
			]);
			poly([
				[10, 12.2],
				[7.8, 14.5],
				[10, 16.8],
			]);
			poly([
				[14, 12.2],
				[16.2, 14.5],
				[14, 16.8],
			]);
			break;
		case "laptop":
			strokeRoundRect(3.6, 4.4, 16.8, 11.4, 2);
			line(2, 19.2, 22, 19.2);
			break;
		case "copy":
			strokeRoundRect(8.4, 8.4, 12.2, 12.2, 2);
			poly([
				[4.6, 15.6],
				[3.6, 14.6],
				[3.6, 4.8],
				[4.8, 3.6],
				[14.6, 3.6],
				[15.6, 4.6],
			]);
			break;
		case "edit":
			poly(
				[
					[17.5, 3.5],
					[20.5, 6.5],
					[8.5, 18.5],
					[4, 20],
					[5.5, 15.5],
				],
				true,
			);
			line(14.8, 6.2, 17.8, 9.2);
			break;
		case "pin":
			line(9, 4, 15, 4);
			poly([
				[10, 4],
				[9.2, 9.6],
				[6.6, 12.6],
				[17.4, 12.6],
				[14.8, 9.6],
				[14, 4],
			]);
			line(12, 12.6, 12, 20.5);
			break;
		case "fork":
			line(3, 12, 10.6, 12);
			line(10.6, 12, 19.8, 4.8);
			poly([
				[15, 4.4],
				[20.2, 4.4],
				[20.2, 9.6],
			]);
			line(10.6, 12, 19.8, 19.2);
			poly([
				[15, 19.6],
				[20.2, 19.6],
				[20.2, 14.4],
			]);
			break;
		case "close":
			line(6.2, 6.2, 17.8, 17.8);
			line(17.8, 6.2, 6.2, 17.8);
			break;
		case "external-link":
			poly([
				[18, 13.5],
				[18, 18.8],
				[16.8, 20],
				[5.2, 20],
				[4, 18.8],
				[4, 7.2],
				[5.2, 6],
				[10.5, 6],
			]);
			line(10.5, 13.5, 19.6, 4.4);
			poly([
				[14.5, 4],
				[20, 4],
				[20, 9.5],
			]);
			break;
		case "eye":
			arc(12, 16.5, 10.2, -Math.PI * 0.78, -Math.PI * 0.22);
			arc(12, 7.5, 10.2, Math.PI * 0.22, Math.PI * 0.78);
			circle(12, 12, 2.8);
			break;
		case "monitor":
			strokeRoundRect(2.8, 4, 18.4, 12.2, 2);
			line(12, 16.4, 12, 20);
			line(7.8, 20, 16.2, 20);
			break;
		case "waku-mark":
			poly(
				[
					[12, 2.8],
					[19.8, 7.4],
					[19.8, 16.6],
					[12, 21.2],
					[4.2, 16.6],
					[4.2, 7.4],
				],
				true,
			);
			poly([
				[7.4, 8.8],
				[9.8, 15.2],
				[12, 10.6],
				[14.2, 15.2],
				[16.6, 8.8],
			]);
			break;
	}
}

/** Draw an anti-aliased vector icon directly onto a GuiRenderContext (cached by size/color). */
export function drawVectorIcon(
	ctx: GuiRenderContext,
	name: VectorIconName,
	x: number,
	y: number,
	size: number,
	color: Color,
	strokeWidth?: number,
	scale = 2,
): void {
	if (size <= 0) return;
	const roundedSize = Math.max(1, Math.round(size));
	const packedColor = packRgba(color);
	const strokeKey = strokeWidth !== undefined ? strokeWidth.toFixed(2) : "auto";
	const cacheKey = `${name}:${roundedSize}:${packedColor}:${strokeKey}:${scale}`;

	let surface = ICON_SURFACE_CACHE.get(cacheKey);
	if (surface === undefined) {
		if (ICON_SURFACE_CACHE.size >= MAX_ICON_CACHE_ENTRIES) {
			ICON_SURFACE_CACHE.clear();
		}
		surface = new RasterSurface(roundedSize, roundedSize, scale);
		renderVectorIcon(surface, name, 0, 0, roundedSize, color, strokeWidth);
		ICON_SURFACE_CACHE.set(cacheKey, surface);
	}
	surface.blit(ctx, x, y, 0, size, size);
}

export interface VectorIconOptions {
	readonly name: VectorIconName;
	readonly size?: number;
	readonly color?: Color;
	readonly strokeWidth?: number;
	readonly label?: string;
}

/** Standalone GUI component wrapping a crisp anti-aliased VectorIcon. */
export class VectorIcon extends GuiComponent {
	private iconName: VectorIconName;
	private sizeValue: number;
	private colorValue: Color | undefined;
	private strokeWidthValue: number | undefined;
	private labelValue: string | undefined;

	constructor(options: VectorIconOptions) {
		super();
		this.iconName = options.name;
		this.sizeValue = Math.max(4, options.size ?? 16);
		this.colorValue = options.color;
		this.strokeWidthValue = options.strokeWidth;
		this.labelValue = options.label;
	}

	getName(): VectorIconName {
		return this.iconName;
	}

	setName(name: VectorIconName): void {
		if (this.iconName === name) return;
		this.iconName = name;
		this.invalidate();
	}

	setColor(color: Color | undefined): void {
		this.colorValue = color;
		this.invalidate();
	}

	setSize(size: number): void {
		const next = Math.max(4, size);
		if (next === this.sizeValue) return;
		this.sizeValue = next;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, _maxWidth: number, _maxHeight?: number): Size {
		return { width: this.sizeValue, height: this.sizeValue };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const drawSize = Math.min(this.sizeValue, r.width, r.height);
		if (drawSize <= 0) return;
		const x = r.x + Math.max(0, (r.width - drawSize) * 0.5);
		const y = r.y + Math.max(0, (r.height - drawSize) * 0.5);
		drawVectorIcon(
			ctx,
			this.iconName,
			x,
			y,
			drawSize,
			this.colorValue ?? ctx.theme.text,
			this.strokeWidthValue,
		);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.labelValue === undefined || this.labelValue.length === 0) return;
		if (this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		out.push({
			id: this.a11yId,
			role: "group",
			label: this.labelValue,
			value: "",
			rect: this.layoutRect,
			stateFlags: SGUI_A11Y_STATE_ENABLED,
		});
	}
}

export interface VectorCanvasOptions {
	readonly width?: number;
	readonly height?: number;
	readonly minWidth?: number;
	readonly minHeight?: number;
	readonly fillWidth?: boolean;
	readonly scale?: number;
	readonly background?: Color;
	readonly borderColor?: Color;
	readonly borderWidth?: number;
	readonly radius?: number;
	readonly focusable?: boolean;
	readonly cursor?: CursorKindId;
	readonly label?: string;
	readonly role?: A11yRole;
	readonly value?: string;
	readonly render: (surface: RasterSurface, rect: Rect, ctx: GuiRenderContext) => void;
	readonly onPointer?: (event: GuiPointerEvent, rect: Rect, ctx: GuiRenderContext) => GuiPointerResult | boolean;
	readonly onScroll?: (event: GuiScrollEvent, rect: Rect, ctx: GuiRenderContext) => boolean;
	readonly onKey?: (event: GuiKeyEvent, rect: Rect, ctx: GuiRenderContext) => boolean;
	readonly onPress?: () => void;
	readonly onIncrement?: () => void;
	readonly onDecrement?: () => void;
	readonly onSetValue?: (value: string) => void;
}

/**
 * Retina-backed vector drawing surface component for gauges, ring meters, sparklines,
 * area plots, and custom interactive data visualizations.
 */
export class VectorCanvas extends GuiComponent {
	private widthValue: number | undefined;
	private heightValue: number | undefined;
	private minWidthValue: number;
	private minHeightValue: number;
	private fillWidthValue: boolean;
	private scaleValue: number;
	private backgroundValue: Color | undefined;
	private borderColorValue: Color | undefined;
	private borderWidthValue: number;
	private radiusValue: number;
	private labelValue: string | undefined;
	private roleValue: A11yRole;
	private valueText: string;
	private renderFn: (surface: RasterSurface, rect: Rect, ctx: GuiRenderContext) => void;
	private onPointerFn:
		| ((event: GuiPointerEvent, rect: Rect, ctx: GuiRenderContext) => GuiPointerResult | boolean)
		| undefined;
	private onScrollFn: ((event: GuiScrollEvent, rect: Rect, ctx: GuiRenderContext) => boolean) | undefined;
	private onKeyFn: ((event: GuiKeyEvent, rect: Rect, ctx: GuiRenderContext) => boolean) | undefined;
	private onPressFn: (() => void) | undefined;
	private onIncrementFn: (() => void) | undefined;
	private onDecrementFn: (() => void) | undefined;
	private onSetValueFn: ((value: string) => void) | undefined;
	private surface: RasterSurface | undefined;

	constructor(options: VectorCanvasOptions) {
		super();
		this.widthValue = options.width;
		this.heightValue = options.height;
		this.minWidthValue = Math.max(0, options.minWidth ?? 40);
		this.minHeightValue = Math.max(0, options.minHeight ?? 40);
		this.fillWidthValue = options.fillWidth ?? false;
		this.scaleValue = Math.max(1, options.scale ?? 2);
		this.backgroundValue = options.background;
		this.borderColorValue = options.borderColor;
		this.borderWidthValue = Math.max(0, options.borderWidth ?? 1);
		this.radiusValue = Math.max(0, options.radius ?? 0);
		this.focusable = options.focusable ?? false;
		this.cursor = options.cursor ?? SGUI_CURSOR_ARROW;
		this.labelValue = options.label;
		this.roleValue = options.role ?? "group";
		this.valueText = options.value ?? "";
		this.renderFn = options.render;
		this.onPointerFn = options.onPointer;
		this.onScrollFn = options.onScroll;
		this.onKeyFn = options.onKey;
		this.onPressFn = options.onPress;
		this.onIncrementFn = options.onIncrement;
		this.onDecrementFn = options.onDecrement;
		this.onSetValueFn = options.onSetValue;
		this.surface = undefined;
	}

	getLabel(): string | undefined {
		return this.labelValue;
	}

	setLabel(label: string | undefined): void {
		this.labelValue = label;
		this.invalidate();
	}

	getRole(): A11yRole {
		return this.roleValue;
	}

	setRole(role: A11yRole): void {
		this.roleValue = role;
		this.invalidate();
	}

	getValue(): string {
		return this.valueText;
	}

	setValue(value: string): void {
		if (this.valueText === value) return;
		this.valueText = value;
		this.invalidate();
	}

	setRender(render: (surface: RasterSurface, rect: Rect, ctx: GuiRenderContext) => void): void {
		this.renderFn = render;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		let w = this.fillWidthValue
			? maxWidth
			: this.widthValue !== undefined
				? Math.min(maxWidth, this.widthValue)
				: Math.max(this.minWidthValue, maxWidth);
		if (this.widthValue !== undefined && !this.fillWidthValue) {
			w = Math.max(this.minWidthValue, Math.min(maxWidth, this.widthValue));
		}
		let h = this.heightValue ?? this.minHeightValue;
		h = Math.max(this.minHeightValue, h);
		if (maxHeight !== undefined) {
			h = Math.min(maxHeight, h);
		}
		return { width: Math.max(0, w), height: Math.max(0, h) };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		if (this.backgroundValue !== undefined) {
			ctx.fillRect(r.x, r.y, r.width, r.height, this.backgroundValue, this.radiusValue);
		}

		const targetW = Math.max(1, Math.round(r.width));
		const targetH = Math.max(1, Math.round(r.height));
		if (
			this.surface === undefined ||
			this.surface.width !== targetW ||
			this.surface.height !== targetH ||
			this.surface.scale !== this.scaleValue
		) {
			this.surface = new RasterSurface(targetW, targetH, this.scaleValue);
		}
		this.surface.clear();
		this.renderFn(this.surface, { x: 0, y: 0, width: r.width, height: r.height }, ctx);
		this.surface.blit(ctx, r.x, r.y, this.radiusValue, r.width, r.height);

		if (this.focusable && this.isFocused()) {
			drawFocusHalo(ctx, r, this.radiusValue);
			ctx.strokeRect(r.x, r.y, r.width, r.height, ctx.theme.borderFocus, 1, this.radiusValue);
		} else if (this.borderColorValue !== undefined && this.borderWidthValue > 0) {
			ctx.strokeRect(r.x, r.y, r.width, r.height, this.borderColorValue, this.borderWidthValue, this.radiusValue);
		}
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		if (!this.visible || !pointInRect(event.x, event.y, this.layoutRect)) {
			return { handled: false };
		}
		if (this.onPointerFn !== undefined) {
			const res = this.onPointerFn(event, this.layoutRect, ctx);
			if (typeof res === "boolean") {
				return {
					handled: res,
					focus: res && this.focusable ? this : undefined,
					cursor: this.cursor,
				};
			}
			return res;
		}
		if (event.phase === "down" && this.focusable) {
			return { handled: true, focus: this, cursor: this.cursor };
		}
		return { handled: false };
	}

	override handleScroll(event: GuiScrollEvent, ctx: GuiRenderContext): boolean {
		if (this.onScrollFn !== undefined) {
			return this.onScrollFn(event, this.layoutRect, ctx);
		}
		return false;
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.onKeyFn !== undefined) {
			return this.onKeyFn(event, this.layoutRect, ctx);
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		if (
			(this.labelValue === undefined || this.labelValue.length === 0) &&
			this.valueText.length === 0 &&
			!this.focusable &&
			this.onPressFn === undefined &&
			this.onIncrementFn === undefined &&
			this.onDecrementFn === undefined &&
			this.onSetValueFn === undefined
		) {
			return;
		}
		let stateFlags = SGUI_A11Y_STATE_ENABLED;
		if (this.focusable && this.isFocused()) {
			stateFlags |= SGUI_A11Y_STATE_FOCUSED;
		}
		out.push({
			id: this.a11yId,
			role: this.roleValue,
			label: this.labelValue ?? "Vector canvas",
			value: this.valueText,
			rect: this.layoutRect,
			stateFlags,
		});
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		valueText: string,
		ctx: GuiRenderContext,
	): boolean {
		if (nodeId !== this.a11yId || !this.visible) return false;
		if (action === "focus" && this.focusable) {
			ctx.requestFocus(this);
			this.invalidate();
			return true;
		}
		if (action === "press" && this.onPressFn !== undefined) {
			this.onPressFn();
			this.invalidate();
			return true;
		}
		if (action === "increment" && this.onIncrementFn !== undefined) {
			this.onIncrementFn();
			this.invalidate();
			return true;
		}
		if (action === "decrement" && this.onDecrementFn !== undefined) {
			this.onDecrementFn();
			this.invalidate();
			return true;
		}
		if (action === "setValue" && this.onSetValueFn !== undefined) {
			this.onSetValueFn(valueText);
			this.invalidate();
			return true;
		}
		return false;
	}
}

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger";

export interface BadgeOptions {
	readonly label: string;
	readonly variant?: BadgeVariant;
	readonly leadingIcon?: VectorIconName;
	readonly iconSize?: number;
	readonly fontSize?: number;
	readonly fontWeight?: number;
	readonly padding?: PaddingInput;
	readonly radius?: number;
	readonly background?: Color;
	readonly textColor?: Color;
	readonly borderColor?: Color;
}

/** Compact pill badge for status labels, telemetry tags, and metric chips. */
export class Badge extends GuiComponent {
	private labelText: string;
	private variant: BadgeVariant;
	private leadingIcon: VectorIconName | undefined;
	private iconSize: number | undefined;
	private fontSize: number | undefined;
	private fontWeight: number;
	private padding: Edges;
	private radiusValue: number | undefined;
	private customBackground: Color | undefined;
	private customTextColor: Color | undefined;
	private customBorderColor: Color | undefined;

	constructor(options: BadgeOptions) {
		super();
		this.labelText = options.label;
		this.variant = options.variant ?? "neutral";
		this.leadingIcon = options.leadingIcon;
		this.iconSize = options.iconSize;
		this.fontSize = options.fontSize;
		this.fontWeight = options.fontWeight ?? 600;
		this.padding = normalizeEdges(options.padding ?? { vertical: 3, horizontal: 9 });
		this.radiusValue = options.radius;
		this.customBackground = options.background;
		this.customTextColor = options.textColor;
		this.customBorderColor = options.borderColor;
	}

	getLabel(): string {
		return this.labelText;
	}

	setLabel(label: string): void {
		if (this.labelText === label) return;
		this.labelText = label;
		this.invalidate();
	}

	setVariant(variant: BadgeVariant): void {
		if (this.variant === variant) return;
		this.variant = variant;
		this.invalidate();
	}

	setLeadingIcon(icon: VectorIconName | undefined): void {
		if (this.leadingIcon === icon) return;
		this.leadingIcon = icon;
		this.invalidate();
	}

	private resolveColors(ctx: GuiRenderContext): { bg: Color; text: Color; border: Color } {
		const t = ctx.theme;
		const fillAlpha = t.dark ? 0.16 : 0.11;
		const borderAlpha = t.dark ? 0.34 : 0.24;
		let tone: Color | undefined;
		switch (this.variant) {
			case "accent":
				tone = t.accent;
				break;
			case "success":
				tone = t.success;
				break;
			case "warning":
				tone = t.warning;
				break;
			case "danger":
				tone = t.danger;
				break;
			case "neutral":
			default:
				tone = undefined;
				break;
		}
		if (tone === undefined) {
			return {
				bg: this.customBackground ?? t.surfaceMuted,
				text: this.customTextColor ?? t.textMuted,
				border: this.customBorderColor ?? t.border,
			};
		}
		return {
			bg: this.customBackground ?? withAlpha(tone, fillAlpha),
			text: this.customTextColor ?? tone,
			border: this.customBorderColor ?? withAlpha(tone, borderAlpha),
		};
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const fs = this.fontSize ?? ctx.theme.fontSizeSmall;
		const style = { fontFamily: SGUI_FONT_REGULAR, fontSize: fs, fontWeight: this.fontWeight };
		const textSize = ctx.measureText(style, 0, this.labelText);
		const iconSz = this.leadingIcon !== undefined ? (this.iconSize ?? Math.max(10, fs)) : 0;
		const iconGap = this.leadingIcon !== undefined && this.labelText.length > 0 ? 5 : 0;
		const width = Math.min(maxWidth, textSize.width + iconSz + iconGap + this.padding.left + this.padding.right);
		const height = Math.max(textSize.height, iconSz) + this.padding.top + this.padding.bottom;
		return { width: Math.max(0, width), height: Math.max(0, height) };
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const radius = this.radiusValue ?? r.height * 0.5;
		const colors = this.resolveColors(ctx);
		ctx.fillRect(r.x, r.y, r.width, r.height, colors.bg, radius);
		ctx.strokeRect(r.x, r.y, r.width, r.height, colors.border, 1, radius);

		const fs = this.fontSize ?? ctx.theme.fontSizeSmall;
		const style = { fontFamily: SGUI_FONT_REGULAR, fontSize: fs, fontWeight: this.fontWeight };
		const textSize = ctx.measureText(style, 0, this.labelText);
		const iconSz = this.leadingIcon !== undefined ? (this.iconSize ?? Math.max(10, fs)) : 0;
		const iconGap = this.leadingIcon !== undefined && this.labelText.length > 0 ? 5 : 0;

		const contentW = iconSz + iconGap + textSize.width;
		const innerW = Math.max(0, r.width - this.padding.left - this.padding.right);
		let cursorX = r.x + this.padding.left + Math.max(0, (innerW - contentW) * 0.5);

		if (this.leadingIcon !== undefined) {
			const iconY = r.y + Math.max(0, (r.height - iconSz) * 0.5);
			drawVectorIcon(ctx, this.leadingIcon, cursorX, iconY, iconSz, colors.text);
			cursorX += iconSz + iconGap;
		}
		if (this.labelText.length > 0) {
			const textY = r.y + Math.max(0, (r.height - textSize.lineHeight) * 0.5);
			const availTextW = Math.max(0, r.x + r.width - this.padding.right - cursorX);
			ctx.drawStyledText(cursorX, textY, availTextW, colors.text, style, this.labelText);
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		out.push({
			id: this.a11yId,
			role: "staticText",
			label: this.labelText,
			value: "",
			rect: this.layoutRect,
			stateFlags: SGUI_A11Y_STATE_ENABLED,
		});
	}
}

export type PillOptions = BadgeOptions;
export const Pill = Badge;
export type Pill = Badge;
