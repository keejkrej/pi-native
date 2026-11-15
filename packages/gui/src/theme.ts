/**
 * Semantic theme tokens for dark and light desktop appearances.
 */

import { type Color, parseColor, withAlpha } from "./colors.ts";

export interface GuiTheme {
	readonly dark: boolean;
	readonly background: Color;
	readonly surface: Color;
	readonly surfaceElevated: Color;
	readonly surfaceMuted: Color;
	readonly border: Color;
	readonly borderFocus: Color;
	readonly text: Color;
	readonly textMuted: Color;
	readonly textDisabled: Color;
	readonly textOnAccent: Color;
	readonly accent: Color;
	readonly accentHover: Color;
	readonly danger: Color;
	readonly dangerHover: Color;
	readonly success: Color;
	readonly warning: Color;
	readonly selection: Color;
	readonly codeBackground: Color;
	readonly codeText: Color;
	readonly link: Color;
	readonly quoteBorder: Color;
	readonly scrollbarTrack: Color;
	readonly scrollbarThumb: Color;
	readonly shadow: Color;
	readonly fontSizeBody: number;
	readonly fontSizeSmall: number;
	readonly fontSizeCode: number;
	readonly fontSizeHeading: number;
	readonly radiusSmall: number;
	readonly radiusMedium: number;
	readonly radiusLarge: number;
}

const darkAccent = parseColor("#4c8dff");
const lightAccent = parseColor("#1f6feb");

export const darkGuiTheme: GuiTheme = {
	dark: true,
	background: parseColor("#121418"),
	surface: parseColor("#191c22"),
	surfaceElevated: parseColor("#22262f"),
	surfaceMuted: parseColor("#15181e"),
	border: parseColor("#2c323d"),
	borderFocus: darkAccent,
	text: parseColor("#eceff4"),
	textMuted: parseColor("#8d96a5"),
	textDisabled: parseColor("#565e6b"),
	textOnAccent: parseColor("#ffffff"),
	accent: darkAccent,
	accentHover: parseColor("#6ba1ff"),
	danger: parseColor("#f85149"),
	dangerHover: parseColor("#ff6b63"),
	success: parseColor("#3fb950"),
	warning: parseColor("#d29922"),
	selection: withAlpha(darkAccent, 0.28),
	codeBackground: parseColor("#0e1014"),
	codeText: parseColor("#cdd5e0"),
	link: parseColor("#79c0ff"),
	quoteBorder: parseColor("#3b4351"),
	scrollbarTrack: withAlpha(parseColor("#ffffff"), 0.02),
	scrollbarThumb: withAlpha(parseColor("#ffffff"), 0.24),
	shadow: withAlpha(parseColor("#000000"), 0.48),
	fontSizeBody: 13,
	fontSizeSmall: 11,
	fontSizeCode: 12,
	fontSizeHeading: 18,
	radiusSmall: 6,
	radiusMedium: 8,
	radiusLarge: 14,
};

export const lightGuiTheme: GuiTheme = {
	dark: false,
	background: parseColor("#f5f6f8"),
	surface: parseColor("#ffffff"),
	surfaceElevated: parseColor("#ffffff"),
	surfaceMuted: parseColor("#ebedf1"),
	border: parseColor("#d5dae1"),
	borderFocus: lightAccent,
	text: parseColor("#181b20"),
	textMuted: parseColor("#636b78"),
	textDisabled: parseColor("#9aa2ae"),
	textOnAccent: parseColor("#ffffff"),
	accent: lightAccent,
	accentHover: parseColor("#388bfd"),
	danger: parseColor("#cf222e"),
	dangerHover: parseColor("#e53844"),
	success: parseColor("#1a7f37"),
	warning: parseColor("#9a6700"),
	selection: withAlpha(lightAccent, 0.18),
	codeBackground: parseColor("#f0f2f5"),
	codeText: parseColor("#22272e"),
	link: parseColor("#0969da"),
	quoteBorder: parseColor("#d5dae1"),
	scrollbarTrack: withAlpha(parseColor("#000000"), 0.02),
	scrollbarThumb: withAlpha(parseColor("#000000"), 0.22),
	shadow: withAlpha(parseColor("#000000"), 0.16),
	fontSizeBody: 13,
	fontSizeSmall: 11,
	fontSizeCode: 12,
	fontSizeHeading: 18,
	radiusSmall: 6,
	radiusMedium: 8,
	radiusLarge: 14,
};
