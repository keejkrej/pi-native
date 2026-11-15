/**
 * Semantic color types, parsing, perceptual mixing, and packed RGBA conversions.
 */

import { clamp01, clampByte, normalizeHue, okhslToRgb, oklabToRgb, oklchToRgb, rgbToOklab } from "./oklab.ts";

export interface RgbColorValue {
	readonly kind: "rgb";
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

export interface RgbaColorValue {
	readonly kind: "rgba";
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
}

export interface OklchColorValue {
	readonly kind: "oklch";
	readonly l: number;
	readonly c: number;
	readonly h: number;
	readonly a: number;
}

export type Color = RgbColorValue | RgbaColorValue | OklchColorValue;

export interface ResolvedRgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

export function rgbColor(r: number, g: number, b: number): RgbColorValue {
	return { kind: "rgb", r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

export function rgbaColor(r: number, g: number, b: number, a: number): RgbaColorValue {
	return { kind: "rgba", r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clamp01(a) };
}

export function oklchColor(l: number, c: number, h: number, a = 1): OklchColorValue {
	return { kind: "oklch", l: clamp01(l), c: Math.max(0, c), h: normalizeHue(h), a: clamp01(a) };
}

export function okhslColor(h: number, s: number, l: number, a = 1): RgbaColorValue {
	const rgb = okhslToRgb(h, s, l);
	return { kind: "rgba", r: rgb.r, g: rgb.g, b: rgb.b, a: clamp01(a) };
}

export function withAlpha(color: Color, alpha: number): RgbaColorValue {
	const resolved = colorToRgba(color);
	return { kind: "rgba", r: resolved.r, g: resolved.g, b: resolved.b, a: clamp01(alpha) };
}

export function colorToRgba(color: Color): ResolvedRgba {
	switch (color.kind) {
		case "rgb":
			return { r: color.r, g: color.g, b: color.b, a: 1 };
		case "rgba":
			return { r: color.r, g: color.g, b: color.b, a: color.a };
		case "oklch": {
			const rgb = oklchToRgb(color.l, color.c, color.h);
			return { r: rgb.r, g: rgb.g, b: rgb.b, a: color.a };
		}
	}
}

export function packRgba(color: Color): number {
	const rgba = colorToRgba(color);
	const alphaByte = clampByte(rgba.a * 255);
	return (((rgba.r & 0xff) << 24) | ((rgba.g & 0xff) << 16) | ((rgba.b & 0xff) << 8) | (alphaByte & 0xff)) >>> 0;
}

export function unpackRgba(packed: number): ResolvedRgba {
	return {
		r: (packed >>> 24) & 0xff,
		g: (packed >>> 16) & 0xff,
		b: (packed >>> 8) & 0xff,
		a: (packed & 0xff) / 255,
	};
}

function byteToHex(value: number): string {
	const clamped = clampByte(value);
	const hex = clamped.toString(16);
	return hex.length === 1 ? `0${hex}` : hex;
}

export function colorToHex(color: Color): string {
	const rgba = colorToRgba(color);
	const base = `#${byteToHex(rgba.r)}${byteToHex(rgba.g)}${byteToHex(rgba.b)}`;
	if (rgba.a >= 1 - 1e-4) {
		return base;
	}
	return `${base}${byteToHex(rgba.a * 255)}`;
}

export function mixColors(a: Color, b: Color, t: number): RgbaColorValue {
	const ratio = clamp01(t);
	const ra = colorToRgba(a);
	const rb = colorToRgba(b);
	const labA = rgbToOklab(ra.r, ra.g, ra.b);
	const labB = rgbToOklab(rb.r, rb.g, rb.b);
	const L = labA.L + (labB.L - labA.L) * ratio;
	const labAVal = labA.a + (labB.a - labA.a) * ratio;
	const labBVal = labA.b + (labB.b - labA.b) * ratio;
	const rgb = oklabToRgb(L, labAVal, labBVal);
	const alpha = ra.a + (rb.a - ra.a) * ratio;
	return { kind: "rgba", r: rgb.r, g: rgb.g, b: rgb.b, a: clamp01(alpha) };
}

function parseHexColor(hex: string): RgbaColorValue | undefined {
	if (hex.length === 3 || hex.length === 4) {
		const rChar = hex[0];
		const gChar = hex[1];
		const bChar = hex[2];
		if (rChar === undefined || gChar === undefined || bChar === undefined) return undefined;
		const r = Number.parseInt(rChar + rChar, 16);
		const g = Number.parseInt(gChar + gChar, 16);
		const b = Number.parseInt(bChar + bChar, 16);
		let a = 1;
		if (hex.length === 4) {
			const aChar = hex[3];
			if (aChar === undefined) return undefined;
			a = Number.parseInt(aChar + aChar, 16) / 255;
		}
		if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) return undefined;
		return rgbaColor(r, g, b, a);
	}
	if (hex.length === 6 || hex.length === 8) {
		const r = Number.parseInt(hex.slice(0, 2), 16);
		const g = Number.parseInt(hex.slice(2, 4), 16);
		const b = Number.parseInt(hex.slice(4, 6), 16);
		const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
		if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) return undefined;
		return rgbaColor(r, g, b, a);
	}
	return undefined;
}

function parseNumberOrPercent(token: string, percentScale: number): number | undefined {
	const trimmed = token.trim();
	if (trimmed.endsWith("%")) {
		const n = Number.parseFloat(trimmed.slice(0, -1));
		return Number.isFinite(n) ? (n / 100) * percentScale : undefined;
	}
	const n = Number.parseFloat(trimmed);
	return Number.isFinite(n) ? n : undefined;
}

function splitFunctionArgs(rawArgs: string): { channels: string[]; alpha: string | undefined } {
	const slashIndex = rawArgs.indexOf("/");
	const channelPart = slashIndex >= 0 ? rawArgs.slice(0, slashIndex) : rawArgs;
	const alphaPart = slashIndex >= 0 ? rawArgs.slice(slashIndex + 1).trim() : undefined;
	const channels = channelPart
		.replace(/,/g, " ")
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
	return { channels, alpha: alphaPart };
}

export function parseColor(input: string): Color {
	const trimmed = input.trim().toLowerCase();
	if (trimmed === "transparent") {
		return rgbaColor(0, 0, 0, 0);
	}
	if (trimmed === "black") return rgbColor(0, 0, 0);
	if (trimmed === "white") return rgbColor(255, 255, 255);

	if (trimmed.startsWith("#")) {
		const parsed = parseHexColor(trimmed.slice(1));
		if (parsed !== undefined) return parsed;
		throw new Error(`Invalid hex color: ${input}`);
	}

	const openParen = trimmed.indexOf("(");
	if (openParen > 0 && trimmed.endsWith(")")) {
		const fnName = trimmed.slice(0, openParen).trim();
		const body = trimmed.slice(openParen + 1, -1);
		const { channels, alpha } = splitFunctionArgs(body);

		if (fnName === "rgb" || fnName === "rgba") {
			if (channels.length < 3 || channels.length > 4) {
				throw new Error(`Invalid ${fnName} color: ${input}`);
			}
			const rRaw = channels[0];
			const gRaw = channels[1];
			const bRaw = channels[2];
			if (rRaw === undefined || gRaw === undefined || bRaw === undefined) {
				throw new Error(`Invalid ${fnName} color: ${input}`);
			}
			const r = parseNumberOrPercent(rRaw, 255);
			const g = parseNumberOrPercent(gRaw, 255);
			const b = parseNumberOrPercent(bRaw, 255);
			const alphaToken = alpha ?? channels[3];
			const a = alphaToken !== undefined ? parseNumberOrPercent(alphaToken, 1) : 1;
			if (r === undefined || g === undefined || b === undefined || a === undefined) {
				throw new Error(`Invalid ${fnName} color: ${input}`);
			}
			return rgbaColor(r, g, b, a);
		}

		if (fnName === "oklch" && channels.length === 3) {
			const lRaw = channels[0];
			const cRaw = channels[1];
			const hRaw = channels[2];
			if (lRaw === undefined || cRaw === undefined || hRaw === undefined) {
				throw new Error(`Invalid oklch color: ${input}`);
			}
			const l = parseNumberOrPercent(lRaw, 1);
			const c = parseNumberOrPercent(cRaw, 0.4);
			const h = Number.parseFloat(hRaw);
			const a = alpha !== undefined ? parseNumberOrPercent(alpha, 1) : 1;
			if (l === undefined || c === undefined || !Number.isFinite(h) || a === undefined) {
				throw new Error(`Invalid oklch color: ${input}`);
			}
			return oklchColor(l, c, h, a);
		}

		if (fnName === "okhsl" && channels.length === 3) {
			const hRaw = channels[0];
			const sRaw = channels[1];
			const lRaw = channels[2];
			if (hRaw === undefined || sRaw === undefined || lRaw === undefined) {
				throw new Error(`Invalid okhsl color: ${input}`);
			}
			const h = Number.parseFloat(hRaw);
			const s = parseNumberOrPercent(sRaw, 100);
			const l = parseNumberOrPercent(lRaw, 100);
			const a = alpha !== undefined ? parseNumberOrPercent(alpha, 1) : 1;
			if (!Number.isFinite(h) || s === undefined || l === undefined || a === undefined) {
				throw new Error(`Invalid okhsl color: ${input}`);
			}
			return okhslColor(h, s, l, a);
		}
	}

	throw new Error(`Unsupported color literal: ${input}`);
}
