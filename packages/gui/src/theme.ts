/**
 * Semantic theme tokens for dark and light desktop appearances.
 */

import { type Color, parseColor, withAlpha } from "./colors.ts";

export type ThemeMode = "system" | "dark" | "light";

export interface GuiTheme {
	readonly dark: boolean;
	readonly background: Color;
	readonly surface: Color;
	readonly surfaceElevated: Color;
	readonly surfaceRaised: Color;
	readonly surfaceComposer: Color;
	readonly surfaceMuted: Color;
	readonly surfaceHover: Color;
	readonly hover: Color;
	readonly surfaceActive: Color;
	readonly surfaceSelected: Color;
	readonly sidebarBg: Color;
	readonly sidebarTint: Color;
	readonly sidebarBorder: Color;
	readonly inputBg: Color;
	readonly border: Color;
	readonly borderStrong: Color;
	readonly borderFocus: Color;
	readonly text: Color;
	readonly textPrimary: Color;
	readonly textBright: Color;
	readonly textSecondary: Color;
	readonly textMuted: Color;
	readonly textDisabled: Color;
	readonly textOnAccent: Color;
	readonly accent: Color;
	readonly accentHover: Color;
	readonly danger: Color;
	readonly dangerHover: Color;
	readonly success: Color;
	readonly warning: Color;
	readonly warn: Color;
	readonly info: Color;
	readonly diffAddText: Color;
	readonly diffAddBg: Color;
	readonly diffDelText: Color;
	readonly diffDelBg: Color;
	readonly selection: Color;
	readonly codeBackground: Color;
	readonly codeBlockBg: Color;
	readonly codeText: Color;
	readonly codeWash: Color;
	readonly syntaxKeyword: Color;
	readonly syntaxLiteral: Color;
	readonly syntaxString: Color;
	readonly syntaxComment: Color;
	readonly syntaxNumber: Color;
	readonly syntaxType: Color;
	readonly syntaxFunction: Color;
	readonly syntaxMeta: Color;
	readonly searchMatchBg: Color;
	readonly activeSearchMatchBg: Color;
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
	readonly radiusBubble: number;
	readonly radiusComposer: number;
}

export type ThemePalette = GuiTheme;

const darkAccent = parseColor("#e2795b");
const lightAccent = parseColor("#c85f44");

export const darkGuiTheme: GuiTheme = {
	dark: true,
	background: parseColor("#1a1a1a"),
	surface: parseColor("#181818"),
	surfaceElevated: parseColor("#232323"),
	surfaceRaised: parseColor("#232323"),
	surfaceComposer: parseColor("#212121"),
	surfaceMuted: parseColor("#2d2d2e"),
	surfaceHover: parseColor("#2f2e2f"),
	hover: parseColor("#2f2e2f"),
	surfaceActive: parseColor("#2d2d2e"),
	surfaceSelected: parseColor("#2d2d2e"),
	sidebarBg: parseColor("#181818"),
	sidebarTint: withAlpha(parseColor("#181818"), 0.88),
	sidebarBorder: withAlpha(parseColor("#ffffff"), 0.08),
	inputBg: parseColor("#4b4b4b"),
	border: parseColor("#2d2c2e"),
	borderStrong: parseColor("#424242"),
	borderFocus: darkAccent,
	text: parseColor("#ecebed"),
	textPrimary: parseColor("#ecebed"),
	textBright: parseColor("#f3f2f4"),
	textSecondary: parseColor("#a0a0a0"),
	textMuted: parseColor("#737272"),
	textDisabled: parseColor("#5a595b"),
	textOnAccent: parseColor("#ffffff"),
	accent: darkAccent,
	accentHover: parseColor("#eb8e74"),
	danger: parseColor("#eb8074"),
	dangerHover: parseColor("#f2978d"),
	success: parseColor("#86c798"),
	warning: parseColor("#e4b65e"),
	warn: parseColor("#e4b65e"),
	info: parseColor("#78b2df"),
	diffAddText: parseColor("#86c798"),
	diffAddBg: parseColor("#21372a"),
	diffDelText: parseColor("#eb8074"),
	diffDelBg: parseColor("#3b2424"),
	selection: withAlpha(darkAccent, 0.28),
	codeBackground: parseColor("#151515"),
	codeBlockBg: parseColor("#151515"),
	codeText: parseColor("#e0a882"),
	codeWash: withAlpha(darkAccent, 0.14),
	syntaxKeyword: parseColor("#c98bc0"),
	syntaxLiteral: parseColor("#d9a05b"),
	syntaxString: parseColor("#94c08a"),
	syntaxComment: parseColor("#737272"),
	syntaxNumber: parseColor("#d9a05b"),
	syntaxType: parseColor("#8fb8d9"),
	syntaxFunction: parseColor("#8fb8d9"),
	syntaxMeta: parseColor("#a0a0a0"),
	searchMatchBg: withAlpha(parseColor("#efc612"), 0.22),
	activeSearchMatchBg: withAlpha(parseColor("#ff8000"), 0.78),
	link: parseColor("#78b2df"),
	quoteBorder: parseColor("#424242"),
	scrollbarTrack: withAlpha(parseColor("#ffffff"), 0.03),
	scrollbarThumb: withAlpha(parseColor("#ffffff"), 0.24),
	shadow: withAlpha(parseColor("#000000"), 0.48),
	fontSizeBody: 13,
	fontSizeSmall: 11,
	fontSizeCode: 12,
	fontSizeHeading: 18,
	radiusSmall: 6,
	radiusMedium: 8,
	radiusLarge: 14,
	radiusBubble: 12,
	radiusComposer: 16,
};

export const lightGuiTheme: GuiTheme = {
	dark: false,
	background: parseColor("#f6f5f6"),
	surface: parseColor("#f3f3f3"),
	surfaceElevated: parseColor("#ececec"),
	surfaceRaised: parseColor("#ececec"),
	surfaceComposer: parseColor("#ffffff"),
	surfaceMuted: parseColor("#e2e1e4"),
	surfaceHover: parseColor("#e6e5e7"),
	hover: parseColor("#e6e5e7"),
	surfaceActive: parseColor("#e2e1e4"),
	surfaceSelected: parseColor("#e2e1e4"),
	sidebarBg: parseColor("#f3f3f3"),
	sidebarTint: withAlpha(parseColor("#f3f3f3"), 0.88),
	sidebarBorder: withAlpha(parseColor("#000000"), 0.08),
	inputBg: parseColor("#ffffff"),
	border: parseColor("#dedcdf"),
	borderStrong: parseColor("#c9c7cb"),
	borderFocus: lightAccent,
	text: parseColor("#242424"),
	textPrimary: parseColor("#242424"),
	textBright: parseColor("#111111"),
	textSecondary: parseColor("#666666"),
	textMuted: parseColor("#858585"),
	textDisabled: parseColor("#a8a8aa"),
	textOnAccent: parseColor("#ffffff"),
	accent: lightAccent,
	accentHover: parseColor("#b55036"),
	danger: parseColor("#b9382c"),
	dangerHover: parseColor("#9f2b20"),
	success: parseColor("#237b3b"),
	warning: parseColor("#b57c14"),
	warn: parseColor("#b57c14"),
	info: parseColor("#2f6690"),
	diffAddText: parseColor("#237b3b"),
	diffAddBg: parseColor("#e6f4ea"),
	diffDelText: parseColor("#b9382c"),
	diffDelBg: parseColor("#fce8e6"),
	selection: withAlpha(lightAccent, 0.22),
	codeBackground: parseColor("#f0f0f0"),
	codeBlockBg: parseColor("#f0f0f0"),
	codeText: parseColor("#9a5528"),
	codeWash: withAlpha(lightAccent, 0.10),
	syntaxKeyword: parseColor("#9a4b92"),
	syntaxLiteral: parseColor("#9a6019"),
	syntaxString: parseColor("#3f7a36"),
	syntaxComment: parseColor("#858585"),
	syntaxNumber: parseColor("#9a6019"),
	syntaxType: parseColor("#2f6690"),
	syntaxFunction: parseColor("#2f6690"),
	syntaxMeta: parseColor("#666666"),
	searchMatchBg: withAlpha(parseColor("#efc824"), 0.24),
	activeSearchMatchBg: withAlpha(parseColor("#ff8a14"), 0.70),
	link: parseColor("#2f6690"),
	quoteBorder: parseColor("#c9c7cb"),
	scrollbarTrack: withAlpha(parseColor("#000000"), 0.03),
	scrollbarThumb: withAlpha(parseColor("#000000"), 0.22),
	shadow: withAlpha(parseColor("#000000"), 0.16),
	fontSizeBody: 13,
	fontSizeSmall: 11,
	fontSizeCode: 12,
	fontSizeHeading: 18,
	radiusSmall: 6,
	radiusMedium: 8,
	radiusLarge: 14,
	radiusBubble: 12,
	radiusComposer: 16,
};

export const DARK_THEME: GuiTheme = darkGuiTheme;
export const LIGHT_THEME: GuiTheme = lightGuiTheme;

/** Resolve dark or light palette from an explicit mode or system appearance flag. */
export function resolveTheme(mode: ThemeMode, systemDark = true): GuiTheme {
	if (mode === "dark") {
		return darkGuiTheme;
	}
	if (mode === "light") {
		return lightGuiTheme;
	}
	return systemDark ? darkGuiTheme : lightGuiTheme;
}
