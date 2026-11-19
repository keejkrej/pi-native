/**
 * Semantic theme tokens for dark and light desktop appearances.
 */

import { type Color, parseColor, rgbaColor, withAlpha } from "./colors.ts";

export type ThemeMode = "system" | "dark" | "light";

export interface GuiTheme {
	readonly dark: boolean;
	readonly background: Color;
	readonly surface: Color;
	readonly surfaceElevated: Color;
	readonly surfaceRaised: Color;
	readonly surfaceComposer: Color;
	readonly surfaceInset: Color;
	readonly surfaceTerminal: Color;
	readonly surfaceOverlay: Color;
	readonly surfaceOverlayStrong: Color;
	readonly surfaceMuted: Color;
	readonly surfaceHover: Color;
	readonly hover: Color;
	readonly surfaceActive: Color;
	readonly surfaceSelected: Color;
	readonly sidebarBg: Color;
	readonly sidebarItemBg: Color;
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
	readonly gauge: Color;
	readonly danger: Color;
	readonly dangerHover: Color;
	readonly success: Color;
	readonly favorite: Color;
	readonly warning: Color;
	readonly warn: Color;
	readonly info: Color;
	readonly inverseBg: Color;
	readonly inverseFg: Color;
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

const darkAccent = parseColor("#E2795B");
const lightAccent = parseColor("#C85F44");

export const darkGuiTheme: GuiTheme = {
	dark: true,
	background: parseColor("#1A1A1A"),
	surface: parseColor("#1A1A1A"),
	surfaceElevated: parseColor("#232323"),
	surfaceRaised: parseColor("#232323"),
	surfaceComposer: parseColor("#212121"),
	surfaceInset: parseColor("#151515"),
	surfaceTerminal: parseColor("#151515"),
	surfaceOverlay: rgbaColor(227, 229, 232, 0.05),
	surfaceOverlayStrong: rgbaColor(227, 229, 232, 0.09),
	surfaceMuted: parseColor("#2B2B2B"),
	surfaceHover: rgbaColor(227, 229, 232, 0.05),
	hover: rgbaColor(227, 229, 232, 0.05),
	surfaceActive: rgbaColor(227, 229, 232, 0.09),
	surfaceSelected: rgbaColor(227, 229, 232, 0.09),
	sidebarBg: parseColor("#181818"),
	sidebarItemBg: rgbaColor(240, 240, 240, 0.06),
	sidebarTint: withAlpha(parseColor("#181818"), 0.88),
	sidebarBorder: parseColor("#292929"),
	inputBg: parseColor("#2A2A2A"),
	border: rgbaColor(227, 229, 232, 0.07),
	borderStrong: rgbaColor(227, 229, 232, 0.14),
	borderFocus: darkAccent,
	text: parseColor("#E2E2E2"),
	textPrimary: parseColor("#E2E2E2"),
	textBright: parseColor("#F3F2F4"),
	textSecondary: parseColor("#A3A3A3"),
	textMuted: parseColor("#7D7D7D"),
	textDisabled: parseColor("#575757"),
	textOnAccent: parseColor("#FFFFFF"),
	accent: darkAccent,
	accentHover: parseColor("#EB8E74"),
	gauge: parseColor("#3B82F6"),
	danger: parseColor("#E2726A"),
	dangerHover: parseColor("#F08A83"),
	success: parseColor("#62C987"),
	favorite: parseColor("#EAB308"),
	warning: parseColor("#E0B36A"),
	warn: parseColor("#E0B36A"),
	info: parseColor("#3B82F6"),
	inverseBg: parseColor("#E7E9EC"),
	inverseFg: parseColor("#17181C"),
	diffAddText: parseColor("#62C987"),
	diffAddBg: parseColor("#21372A"),
	diffDelText: parseColor("#E2726A"),
	diffDelBg: parseColor("#3B2424"),
	selection: withAlpha(darkAccent, 0.28),
	codeBackground: parseColor("#151515"),
	codeBlockBg: parseColor("#151515"),
	codeText: parseColor("#E0A882"),
	codeWash: rgbaColor(227, 229, 232, 0.08),
	syntaxKeyword: parseColor("#C98BC0"),
	syntaxLiteral: parseColor("#D9A05B"),
	syntaxString: parseColor("#94C08A"),
	syntaxComment: parseColor("#7D7D7D"),
	syntaxNumber: parseColor("#D9A05B"),
	syntaxType: parseColor("#8FB8D9"),
	syntaxFunction: parseColor("#8FB8D9"),
	syntaxMeta: parseColor("#A3A3A3"),
	searchMatchBg: withAlpha(parseColor("#EFC612"), 0.22),
	activeSearchMatchBg: withAlpha(parseColor("#FF8000"), 0.78),
	link: parseColor("#3B82F6"),
	quoteBorder: rgbaColor(227, 229, 232, 0.14),
	scrollbarTrack: withAlpha(parseColor("#FFFFFF"), 0.03),
	scrollbarThumb: withAlpha(parseColor("#FFFFFF"), 0.24),
	shadow: withAlpha(parseColor("#000000"), 0.48),
	fontSizeBody: 13,
	fontSizeSmall: 11,
	fontSizeCode: 12,
	fontSizeHeading: 18,
	radiusSmall: 6,
	radiusMedium: 8,
	radiusLarge: 15,
	radiusBubble: 12,
	radiusComposer: 13,
};

export const lightGuiTheme: GuiTheme = {
	dark: false,
	background: parseColor("#F6F5F6"),
	surface: parseColor("#F6F5F6"),
	surfaceElevated: parseColor("#ECECEC"),
	surfaceRaised: parseColor("#ECECEC"),
	surfaceComposer: parseColor("#FFFFFF"),
	surfaceInset: parseColor("#E6E6E6"),
	surfaceTerminal: parseColor("#FFFFFF"),
	surfaceOverlay: rgbaColor(28, 30, 34, 0.05),
	surfaceOverlayStrong: rgbaColor(28, 30, 34, 0.09),
	surfaceMuted: parseColor("#E2E1E4"),
	surfaceHover: rgbaColor(28, 30, 34, 0.05),
	hover: rgbaColor(28, 30, 34, 0.05),
	surfaceActive: rgbaColor(28, 30, 34, 0.09),
	surfaceSelected: rgbaColor(28, 30, 34, 0.09),
	sidebarBg: parseColor("#F3F3F3"),
	sidebarItemBg: rgbaColor(20, 20, 20, 0.06),
	sidebarTint: withAlpha(parseColor("#F3F3F3"), 0.88),
	sidebarBorder: rgbaColor(20, 20, 20, 0.12),
	inputBg: parseColor("#FFFFFF"),
	border: rgbaColor(28, 30, 34, 0.08),
	borderStrong: rgbaColor(28, 30, 34, 0.15),
	borderFocus: lightAccent,
	text: parseColor("#242424"),
	textPrimary: parseColor("#242424"),
	textBright: parseColor("#111111"),
	textSecondary: parseColor("#666666"),
	textMuted: parseColor("#858585"),
	textDisabled: parseColor("#A4A4A4"),
	textOnAccent: parseColor("#FFFFFF"),
	accent: lightAccent,
	accentHover: parseColor("#B55036"),
	gauge: parseColor("#2563EB"),
	danger: parseColor("#C64A42"),
	dangerHover: parseColor("#AB3B34"),
	success: parseColor("#2F8F52"),
	favorite: parseColor("#CA8A04"),
	warning: parseColor("#A66B20"),
	warn: parseColor("#A66B20"),
	info: parseColor("#2563EB"),
	inverseBg: parseColor("#202227"),
	inverseFg: parseColor("#F8F8F9"),
	diffAddText: parseColor("#2F8F52"),
	diffAddBg: parseColor("#E6F4EA"),
	diffDelText: parseColor("#C64A42"),
	diffDelBg: parseColor("#FCE8E6"),
	selection: withAlpha(lightAccent, 0.22),
	codeBackground: parseColor("#E6E6E6"),
	codeBlockBg: parseColor("#E6E6E6"),
	codeText: parseColor("#9A5528"),
	codeWash: rgbaColor(28, 30, 34, 0.07),
	syntaxKeyword: parseColor("#9A4B92"),
	syntaxLiteral: parseColor("#9A6019"),
	syntaxString: parseColor("#3F7A36"),
	syntaxComment: parseColor("#858585"),
	syntaxNumber: parseColor("#9A6019"),
	syntaxType: parseColor("#2F6690"),
	syntaxFunction: parseColor("#2F6690"),
	syntaxMeta: parseColor("#666666"),
	searchMatchBg: withAlpha(parseColor("#EFC824"), 0.24),
	activeSearchMatchBg: withAlpha(parseColor("#FF8A14"), 0.70),
	link: parseColor("#2563EB"),
	quoteBorder: rgbaColor(28, 30, 34, 0.15),
	scrollbarTrack: withAlpha(parseColor("#000000"), 0.03),
	scrollbarThumb: withAlpha(parseColor("#000000"), 0.22),
	shadow: withAlpha(parseColor("#000000"), 0.16),
	fontSizeBody: 13,
	fontSizeSmall: 11,
	fontSizeCode: 12,
	fontSizeHeading: 18,
	radiusSmall: 6,
	radiusMedium: 8,
	radiusLarge: 15,
	radiusBubble: 12,
	radiusComposer: 13,
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
