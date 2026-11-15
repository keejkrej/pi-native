import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	colorToHex,
	colorToRgba,
	darkGuiTheme,
	lightGuiTheme,
	mixColors,
	okhslColor,
	oklchColor,
	packRgba,
	parseColor,
	rgbaColor,
	rgbColor,
	unpackRgba,
	withAlpha,
} from "../src/index.ts";

describe("Color parsing, conversion, and mixing", () => {
	it("parses hex, rgb, rgba, oklch, okhsl, and named keywords", () => {
		assert.deepEqual(colorToRgba(parseColor("#f80")), { r: 255, g: 136, b: 0, a: 1 });
		assert.deepEqual(colorToRgba(parseColor("#11223380")), { r: 17, g: 34, b: 51, a: 128 / 255 });
		assert.deepEqual(colorToRgba(parseColor("rgb(12, 34, 56)")), { r: 12, g: 34, b: 56, a: 1 });
		assert.deepEqual(colorToRgba(parseColor("rgba(12, 34, 56, 0.25)")), { r: 12, g: 34, b: 56, a: 0.25 });
		assert.deepEqual(colorToRgba(parseColor("transparent")), { r: 0, g: 0, b: 0, a: 0 });
		assert.deepEqual(colorToRgba(rgbaColor(10, 20, 30, 0.5)), { r: 10, g: 20, b: 30, a: 0.5 });

		const lch = parseColor("oklch(0.65 0.15 240 / 0.8)");
		const lchRgba = colorToRgba(lch);
		assert.ok(lchRgba.b > lchRgba.r);
		assert.ok(Math.abs(lchRgba.a - 0.8) < 1e-6);

		const hsl = parseColor("okhsl(140 70% 55%)");
		const hslRgba = colorToRgba(hsl);
		assert.ok(hslRgba.g > hslRgba.r && hslRgba.g > hslRgba.b);

		const directHsl = okhslColor(0, 0, 100);
		assert.deepEqual(colorToRgba(directHsl), { r: 255, g: 255, b: 255, a: 1 });
	});

	it("packs and unpacks RGBA integers and applies alpha / perceptual mixing", () => {
		const base = rgbColor(100, 150, 200);
		const packed = packRgba(base);
		assert.equal(packed, 0x6496c8ff);
		assert.deepEqual(unpackRgba(packed), { r: 100, g: 150, b: 200, a: 1 });

		const faded = withAlpha(base, 0.5);
		assert.equal(colorToHex(faded), "#6496c880");

		const mixed = mixColors(rgbColor(0, 0, 0), rgbColor(255, 255, 255), 0.5);
		assert.ok(mixed.r > 90 && mixed.r < 145);
		assert.equal(mixed.r, mixed.g);
		assert.equal(mixed.g, mixed.b);

		const oklchVal = oklchColor(0.7, 0.2, 30);
		const oklchRgb = colorToRgba(oklchVal);
		assert.ok(oklchRgb.r > oklchRgb.b);
	});

	it("provides distinct dark and light themes", () => {
		assert.equal(darkGuiTheme.dark, true);
		assert.equal(lightGuiTheme.dark, false);
		assert.ok(colorToRgba(darkGuiTheme.background).r < colorToRgba(lightGuiTheme.background).r);
		assert.ok(colorToRgba(darkGuiTheme.text).r > colorToRgba(lightGuiTheme.text).r);
	});
});
