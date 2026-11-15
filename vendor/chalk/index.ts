/**
 * Pure TypeScript vendored implementation of Chalk (v5/v6 API surface).
 * Zero third-party dependencies; compatible with Node.js, Vitest, strict TS (`erasableSyntaxOnly`),
 * and `scriptc` static compilation.
 */

import os from "node:os";
import process from "node:process";
import tty from "node:tty";

export type ColorSupportLevel = 0 | 1 | 2 | 3;

export interface ColorSupport {
	readonly level: ColorSupportLevel;
	readonly hasBasic: boolean;
	readonly has256: boolean;
	readonly has16m: boolean;
}

export type ColorInfo = ColorSupport | false;

export interface Options {
	readonly level?: ColorSupportLevel;
}

export type ModifierName =
	| "reset"
	| "bold"
	| "dim"
	| "italic"
	| "underline"
	| "underlineDouble"
	| "underlineCurly"
	| "underlineDotted"
	| "underlineDashed"
	| "overline"
	| "inverse"
	| "hidden"
	| "strikethrough"
	| "visible";

export type ForegroundColorName =
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "blackBright"
	| "gray"
	| "grey"
	| "redBright"
	| "greenBright"
	| "yellowBright"
	| "blueBright"
	| "magentaBright"
	| "cyanBright"
	| "whiteBright";

export type BackgroundColorName =
	| "bgBlack"
	| "bgRed"
	| "bgGreen"
	| "bgYellow"
	| "bgBlue"
	| "bgMagenta"
	| "bgCyan"
	| "bgWhite"
	| "bgBlackBright"
	| "bgGray"
	| "bgGrey"
	| "bgRedBright"
	| "bgGreenBright"
	| "bgYellowBright"
	| "bgBlueBright"
	| "bgMagentaBright"
	| "bgCyanBright"
	| "bgWhiteBright";

export type UnderlineColorName =
	| "underlineBlack"
	| "underlineRed"
	| "underlineGreen"
	| "underlineYellow"
	| "underlineBlue"
	| "underlineMagenta"
	| "underlineCyan"
	| "underlineWhite"
	| "underlineBlackBright"
	| "underlineGray"
	| "underlineGrey"
	| "underlineRedBright"
	| "underlineGreenBright"
	| "underlineYellowBright"
	| "underlineBlueBright"
	| "underlineMagentaBright"
	| "underlineCyanBright"
	| "underlineWhiteBright";

export type ColorName = ForegroundColorName | BackgroundColorName;
export type Modifiers = ModifierName;
export type ForegroundColor = ForegroundColorName;
export type BackgroundColor = BackgroundColorName;
export type Color = ColorName;

export const modifierNames: readonly ModifierName[] = [
	"reset",
	"bold",
	"dim",
	"italic",
	"underline",
	"underlineDouble",
	"underlineCurly",
	"underlineDotted",
	"underlineDashed",
	"overline",
	"inverse",
	"hidden",
	"strikethrough",
	"visible",
];

export const foregroundColorNames: readonly ForegroundColorName[] = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"blackBright",
	"gray",
	"grey",
	"redBright",
	"greenBright",
	"yellowBright",
	"blueBright",
	"magentaBright",
	"cyanBright",
	"whiteBright",
];

export const backgroundColorNames: readonly BackgroundColorName[] = [
	"bgBlack",
	"bgRed",
	"bgGreen",
	"bgYellow",
	"bgBlue",
	"bgMagenta",
	"bgCyan",
	"bgWhite",
	"bgBlackBright",
	"bgGray",
	"bgGrey",
	"bgRedBright",
	"bgGreenBright",
	"bgYellowBright",
	"bgBlueBright",
	"bgMagentaBright",
	"bgCyanBright",
	"bgWhiteBright",
];

export const underlineColorNames: readonly UnderlineColorName[] = [
	"underlineBlack",
	"underlineRed",
	"underlineGreen",
	"underlineYellow",
	"underlineBlue",
	"underlineMagenta",
	"underlineCyan",
	"underlineWhite",
	"underlineBlackBright",
	"underlineGray",
	"underlineGrey",
	"underlineRedBright",
	"underlineGreenBright",
	"underlineYellowBright",
	"underlineBlueBright",
	"underlineMagentaBright",
	"underlineCyanBright",
	"underlineWhiteBright",
];

export const colorNames: readonly ColorName[] = [...foregroundColorNames, ...backgroundColorNames];
export const modifiers: readonly Modifiers[] = modifierNames;
export const foregroundColors: readonly ForegroundColor[] = foregroundColorNames;
export const backgroundColors: readonly BackgroundColor[] = backgroundColorNames;
export const colors: readonly Color[] = colorNames;

interface StyleCodePair {
	readonly open: string;
	readonly close: string;
}

const STYLE_PAIRS: Readonly<Record<Exclude<ModifierName, "visible"> | ForegroundColorName | BackgroundColorName | UnderlineColorName, StyleCodePair>> = {
	// Modifiers
	reset: { open: "\u001B[0m", close: "\u001B[0m" },
	bold: { open: "\u001B[1m", close: "\u001B[22m" },
	dim: { open: "\u001B[2m", close: "\u001B[22m" },
	italic: { open: "\u001B[3m", close: "\u001B[23m" },
	underline: { open: "\u001B[4m", close: "\u001B[24m" },
	underlineDouble: { open: "\u001B[4:2m", close: "\u001B[24m" },
	underlineCurly: { open: "\u001B[4:3m", close: "\u001B[24m" },
	underlineDotted: { open: "\u001B[4:4m", close: "\u001B[24m" },
	underlineDashed: { open: "\u001B[4:5m", close: "\u001B[24m" },
	overline: { open: "\u001B[53m", close: "\u001B[55m" },
	inverse: { open: "\u001B[7m", close: "\u001B[27m" },
	hidden: { open: "\u001B[8m", close: "\u001B[28m" },
	strikethrough: { open: "\u001B[9m", close: "\u001B[29m" },

	// Foreground colors
	black: { open: "\u001B[30m", close: "\u001B[39m" },
	red: { open: "\u001B[31m", close: "\u001B[39m" },
	green: { open: "\u001B[32m", close: "\u001B[39m" },
	yellow: { open: "\u001B[33m", close: "\u001B[39m" },
	blue: { open: "\u001B[34m", close: "\u001B[39m" },
	magenta: { open: "\u001B[35m", close: "\u001B[39m" },
	cyan: { open: "\u001B[36m", close: "\u001B[39m" },
	white: { open: "\u001B[37m", close: "\u001B[39m" },
	blackBright: { open: "\u001B[90m", close: "\u001B[39m" },
	gray: { open: "\u001B[90m", close: "\u001B[39m" },
	grey: { open: "\u001B[90m", close: "\u001B[39m" },
	redBright: { open: "\u001B[91m", close: "\u001B[39m" },
	greenBright: { open: "\u001B[92m", close: "\u001B[39m" },
	yellowBright: { open: "\u001B[93m", close: "\u001B[39m" },
	blueBright: { open: "\u001B[94m", close: "\u001B[39m" },
	magentaBright: { open: "\u001B[95m", close: "\u001B[39m" },
	cyanBright: { open: "\u001B[96m", close: "\u001B[39m" },
	whiteBright: { open: "\u001B[97m", close: "\u001B[39m" },

	// Background colors
	bgBlack: { open: "\u001B[40m", close: "\u001B[49m" },
	bgRed: { open: "\u001B[41m", close: "\u001B[49m" },
	bgGreen: { open: "\u001B[42m", close: "\u001B[49m" },
	bgYellow: { open: "\u001B[43m", close: "\u001B[49m" },
	bgBlue: { open: "\u001B[44m", close: "\u001B[49m" },
	bgMagenta: { open: "\u001B[45m", close: "\u001B[49m" },
	bgCyan: { open: "\u001B[46m", close: "\u001B[49m" },
	bgWhite: { open: "\u001B[47m", close: "\u001B[49m" },
	bgBlackBright: { open: "\u001B[100m", close: "\u001B[49m" },
	bgGray: { open: "\u001B[100m", close: "\u001B[49m" },
	bgGrey: { open: "\u001B[100m", close: "\u001B[49m" },
	bgRedBright: { open: "\u001B[101m", close: "\u001B[49m" },
	bgGreenBright: { open: "\u001B[102m", close: "\u001B[49m" },
	bgYellowBright: { open: "\u001B[103m", close: "\u001B[49m" },
	bgBlueBright: { open: "\u001B[104m", close: "\u001B[49m" },
	bgMagentaBright: { open: "\u001B[105m", close: "\u001B[49m" },
	bgCyanBright: { open: "\u001B[106m", close: "\u001B[49m" },
	bgWhiteBright: { open: "\u001B[107m", close: "\u001B[49m" },

	// Underline colors
	underlineBlack: { open: "\u001B[58;5;0m", close: "\u001B[59m" },
	underlineRed: { open: "\u001B[58;5;1m", close: "\u001B[59m" },
	underlineGreen: { open: "\u001B[58;5;2m", close: "\u001B[59m" },
	underlineYellow: { open: "\u001B[58;5;3m", close: "\u001B[59m" },
	underlineBlue: { open: "\u001B[58;5;4m", close: "\u001B[59m" },
	underlineMagenta: { open: "\u001B[58;5;5m", close: "\u001B[59m" },
	underlineCyan: { open: "\u001B[58;5;6m", close: "\u001B[59m" },
	underlineWhite: { open: "\u001B[58;5;7m", close: "\u001B[59m" },
	underlineBlackBright: { open: "\u001B[58;5;8m", close: "\u001B[59m" },
	underlineGray: { open: "\u001B[58;5;8m", close: "\u001B[59m" },
	underlineGrey: { open: "\u001B[58;5;8m", close: "\u001B[59m" },
	underlineRedBright: { open: "\u001B[58;5;9m", close: "\u001B[59m" },
	underlineGreenBright: { open: "\u001B[58;5;10m", close: "\u001B[59m" },
	underlineYellowBright: { open: "\u001B[58;5;11m", close: "\u001B[59m" },
	underlineBlueBright: { open: "\u001B[58;5;12m", close: "\u001B[59m" },
	underlineMagentaBright: { open: "\u001B[58;5;13m", close: "\u001B[59m" },
	underlineCyanBright: { open: "\u001B[58;5;14m", close: "\u001B[59m" },
	underlineWhiteBright: { open: "\u001B[58;5;15m", close: "\u001B[59m" },
};

// --- Supports-color detection ---

function hasFlag(flag: string): boolean {
	const argv = process.argv;
	const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
	const position = argv.indexOf(prefix + flag);
	const terminatorPosition = argv.indexOf("--");
	return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
}

function hasNumericForceColor(value: string | undefined): value is string {
	return value !== undefined && /^\d+$/.test(value);
}

function envForceColor(): number | undefined {
	const env = process.env;
	if (!Object.hasOwn(env, "FORCE_COLOR")) return undefined;
	const raw = env.FORCE_COLOR;
	if (raw === "false") return 0;
	if (raw === "true" || raw === "") return 1;
	if (!hasNumericForceColor(raw)) return undefined;
	return Math.min(Number.parseInt(raw, 10), 3);
}

let cachedFlagForceColor: number | undefined;
if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
	cachedFlagForceColor = 0;
} else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
	cachedFlagForceColor = 1;
}

function translateLevel(level: number): ColorInfo {
	if (level <= 0) return false;
	const clamped: ColorSupportLevel = level >= 3 ? 3 : level === 2 ? 2 : 1;
	return {
		level: clamped,
		hasBasic: true,
		has256: clamped >= 2,
		has16m: clamped >= 3,
	};
}

function detectSupportLevel(haveStream: boolean, streamIsTTY: boolean): number {
	const env = process.env;
	const noFlagForceColor = envForceColor();
	let flagForceColor = cachedFlagForceColor;
	if (noFlagForceColor !== undefined) {
		flagForceColor = noFlagForceColor;
	}

	if (flagForceColor === 0) return 0;
	if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) return 3;
	if (hasFlag("color=256")) return 2;

	if (flagForceColor !== undefined && hasNumericForceColor(env.FORCE_COLOR)) {
		return flagForceColor;
	}

	if (Object.hasOwn(env, "TF_BUILD") && Object.hasOwn(env, "AGENT_NAME")) {
		return 1;
	}

	if (haveStream && !streamIsTTY && flagForceColor === undefined) {
		return 0;
	}

	const min = flagForceColor ?? 0;

	if (env.TERM === "dumb") return min;

	if (process.platform === "win32") {
		const osRelease = os.release().split(".");
		const major = Number(osRelease[0]);
		const build = Number(osRelease[2]);
		if (major >= 10 && build >= 10_586) {
			return build >= 14_931 ? 3 : 2;
		}
		return 1;
	}

	if (Object.hasOwn(env, "CI")) {
		if (
			Object.hasOwn(env, "GITHUB_ACTIONS") ||
			Object.hasOwn(env, "GITEA_ACTIONS") ||
			Object.hasOwn(env, "CIRCLECI")
		) {
			return 3;
		}
		if (
			Object.hasOwn(env, "TRAVIS") ||
			Object.hasOwn(env, "APPVEYOR") ||
			Object.hasOwn(env, "GITLAB_CI") ||
			Object.hasOwn(env, "BUILDKITE") ||
			Object.hasOwn(env, "DRONE") ||
			env.CI_NAME === "codeship"
		) {
			return 1;
		}
		return min;
	}

	if (Object.hasOwn(env, "TEAMCITY_VERSION")) {
		return /^(?:9\.0*[1-9]\d*\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION ?? "") ? 1 : 0;
	}

	if (env.COLORTERM === "truecolor") return 3;
	if (env.TERM === "xterm-kitty" || env.TERM === "xterm-ghostty" || env.TERM === "wezterm") return 3;

	if (Object.hasOwn(env, "TERM_PROGRAM")) {
		const version = Number.parseInt((env.TERM_PROGRAM_VERSION ?? "").split(".", 1)[0] ?? "", 10);
		if (env.TERM_PROGRAM === "iTerm.app") return version >= 3 ? 3 : 2;
		if (env.TERM_PROGRAM === "Apple_Terminal") return 2;
	}

	if (env.TERM !== undefined && /-256(?:color)?$/i.test(env.TERM)) return 2;
	if (
		env.TERM !== undefined &&
		/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)
	) {
		return 1;
	}
	if (Object.hasOwn(env, "COLORTERM")) return 1;

	return min;
}

export const supportsColor: ColorInfo = translateLevel(detectSupportLevel(true, tty.isatty(1)));
export const supportsColorStderr: ColorInfo = translateLevel(detectSupportLevel(true, tty.isatty(2)));

// --- Color model conversions ---

function rgbToAnsi256(red: number, green: number, blue: number): number {
	if (red === green && green === blue) {
		if (red < 8) return 16;
		if (red > 248) return 231;
		return Math.round(((red - 8) / 247) * 24) + 232;
	}
	return (
		16 +
		36 * Math.round((red / 255) * 5) +
		6 * Math.round((green / 255) * 5) +
		Math.round((blue / 255) * 5)
	);
}

function hexToRgb(hex: string): [number, number, number] {
	const matches = /[\da-f]{6}|[\da-f]{3}/i.exec(hex);
	if (!matches) return [0, 0, 0];
	let colorString = matches[0];
	if (colorString.length === 3) {
		colorString =
			colorString[0]! +
			colorString[0]! +
			colorString[1]! +
			colorString[1]! +
			colorString[2]! +
			colorString[2]!;
	}
	const integer = Number.parseInt(colorString, 16);
	return [(integer >> 16) & 0xff, (integer >> 8) & 0xff, integer & 0xff];
}

function ansi256ToAnsi(code: number): number {
	if (code < 8) return 30 + code;
	if (code < 16) return 90 + (code - 8);
	let red: number;
	let green: number;
	let blue: number;
	if (code >= 232) {
		red = ((code - 232) * 10 + 8) / 255;
		green = red;
		blue = red;
	} else {
		const shifted = code - 16;
		const remainder = shifted % 36;
		red = Math.floor(shifted / 36) / 5;
		green = Math.floor(remainder / 6) / 5;
		blue = (remainder % 6) / 5;
	}
	const value = Math.max(red, green, blue) * 2;
	if (value === 0) return 30;
	let result = 30 + ((Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red));
	if (value === 2) result += 60;
	return result;
}

function wrapAnsi(offset: number, code: number): string {
	if (offset === 20) {
		const palette = code < 90 ? code - 30 : code - 90 + 8;
		return `\u001B[58;5;${palette}m`;
	}
	return `\u001B[${code + offset}m`;
}

function wrapAnsi256(offset: number, code: number): string {
	return `\u001B[${38 + offset};5;${code}m`;
}

function wrapAnsi16m(offset: number, red: number, green: number, blue: number): string {
	return `\u001B[${38 + offset};2;${red};${green};${blue}m`;
}

// --- String utilities ---

function stringReplaceAll(str: string, substring: string, postfix: string): string {
	let index = str.indexOf(substring);
	if (index === -1) return str;
	const substringLength = substring.length;
	let endIndex = 0;
	let result = "";
	do {
		result += str.slice(endIndex, index) + substring + postfix;
		endIndex = index + substringLength;
		index = str.indexOf(substring, endIndex);
	} while (index !== -1);
	result += str.slice(endIndex);
	return result;
}

function stringEncaseCRLFWithFirstIndex(str: string, prefix: string, postfix: string, index: number): string {
	let endIndex = 0;
	let result = "";
	do {
		const isCRLF = index > 0 && str[index - 1] === "\r";
		result += str.slice(endIndex, isCRLF ? index - 1 : index) + prefix + (isCRLF ? "\r\n" : "\n") + postfix;
		endIndex = index + 1;
		index = str.indexOf("\n", endIndex);
	} while (index !== -1);
	result += str.slice(endIndex);
	return result;
}

function joinArgs(args: readonly unknown[]): string {
	if (args.length === 0) return "";
	if (args.length === 1) return String(args[0]);
	if (args.length === 2) return `${String(args[0])} ${String(args[1])}`;
	return args.map((arg) => String(arg)).join(" ");
}

// --- Styler & ChalkInstance ---

interface Styler {
	readonly open: string;
	readonly close: string;
	readonly openAll: string;
	readonly closeAll: string;
	readonly parent: Styler | undefined;
}

class LevelBox {
	level: ColorSupportLevel;

	constructor(level: ColorSupportLevel) {
		this.level = level;
	}
}

interface ChalkState {
	readonly box: LevelBox;
	readonly styler: Styler | undefined;
	readonly isEmpty: boolean;
}

export interface ChalkInstance {
	(...text: unknown[]): string;
	level: ColorSupportLevel;

	rgb(red: number, green: number, blue: number): ChalkInstance;
	hex(color: string): ChalkInstance;
	ansi256(index: number): ChalkInstance;

	bgRgb(red: number, green: number, blue: number): ChalkInstance;
	bgHex(color: string): ChalkInstance;
	bgAnsi256(index: number): ChalkInstance;

	underlineRgb(red: number, green: number, blue: number): ChalkInstance;
	underlineHex(color: string): ChalkInstance;
	underlineAnsi256(index: number): ChalkInstance;

	readonly reset: ChalkInstance;
	readonly bold: ChalkInstance;
	readonly dim: ChalkInstance;
	readonly italic: ChalkInstance;
	readonly underline: ChalkInstance;
	readonly underlineDouble: ChalkInstance;
	readonly underlineCurly: ChalkInstance;
	readonly underlineDotted: ChalkInstance;
	readonly underlineDashed: ChalkInstance;
	readonly overline: ChalkInstance;
	readonly inverse: ChalkInstance;
	readonly hidden: ChalkInstance;
	readonly strikethrough: ChalkInstance;
	readonly visible: ChalkInstance;

	readonly black: ChalkInstance;
	readonly red: ChalkInstance;
	readonly green: ChalkInstance;
	readonly yellow: ChalkInstance;
	readonly blue: ChalkInstance;
	readonly magenta: ChalkInstance;
	readonly cyan: ChalkInstance;
	readonly white: ChalkInstance;
	readonly blackBright: ChalkInstance;
	readonly gray: ChalkInstance;
	readonly grey: ChalkInstance;
	readonly redBright: ChalkInstance;
	readonly greenBright: ChalkInstance;
	readonly yellowBright: ChalkInstance;
	readonly blueBright: ChalkInstance;
	readonly magentaBright: ChalkInstance;
	readonly cyanBright: ChalkInstance;
	readonly whiteBright: ChalkInstance;

	readonly bgBlack: ChalkInstance;
	readonly bgRed: ChalkInstance;
	readonly bgGreen: ChalkInstance;
	readonly bgYellow: ChalkInstance;
	readonly bgBlue: ChalkInstance;
	readonly bgMagenta: ChalkInstance;
	readonly bgCyan: ChalkInstance;
	readonly bgWhite: ChalkInstance;
	readonly bgBlackBright: ChalkInstance;
	readonly bgGray: ChalkInstance;
	readonly bgGrey: ChalkInstance;
	readonly bgRedBright: ChalkInstance;
	readonly bgGreenBright: ChalkInstance;
	readonly bgYellowBright: ChalkInstance;
	readonly bgBlueBright: ChalkInstance;
	readonly bgMagentaBright: ChalkInstance;
	readonly bgCyanBright: ChalkInstance;
	readonly bgWhiteBright: ChalkInstance;

	readonly underlineBlack: ChalkInstance;
	readonly underlineRed: ChalkInstance;
	readonly underlineGreen: ChalkInstance;
	readonly underlineYellow: ChalkInstance;
	readonly underlineBlue: ChalkInstance;
	readonly underlineMagenta: ChalkInstance;
	readonly underlineCyan: ChalkInstance;
	readonly underlineWhite: ChalkInstance;
	readonly underlineBlackBright: ChalkInstance;
	readonly underlineGray: ChalkInstance;
	readonly underlineGrey: ChalkInstance;
	readonly underlineRedBright: ChalkInstance;
	readonly underlineGreenBright: ChalkInstance;
	readonly underlineYellowBright: ChalkInstance;
	readonly underlineBlueBright: ChalkInstance;
	readonly underlineMagentaBright: ChalkInstance;
	readonly underlineCyanBright: ChalkInstance;
	readonly underlineWhiteBright: ChalkInstance;
}

const CHALK_STATES = new WeakMap<object, ChalkState>();

function assertValidLevel(level: number): ColorSupportLevel {
	if (!Number.isSafeInteger(level) || level < 0 || level > 3) {
		throw new Error("The `level` should be an integer from 0 to 3");
	}
	return level as ColorSupportLevel;
}

function createStyler(open: string, close: string, parent: Styler | undefined): Styler {
	if (parent === undefined) {
		return { open, close, openAll: open, closeAll: close, parent: undefined };
	}
	return {
		open,
		close,
		openAll: parent.openAll + open,
		closeAll: close + parent.closeAll,
		parent,
	};
}

function applyStyle(state: ChalkState, text: string): string {
	if (state.box.level <= 0 || text.length === 0) {
		return state.isEmpty ? "" : text;
	}
	let styler = state.styler;
	if (styler === undefined) return text;
	const { openAll, closeAll } = styler;
	let formatted = text;
	if (formatted.includes("\u001B")) {
		while (styler !== undefined) {
			formatted = stringReplaceAll(formatted, styler.close, styler.open);
			styler = styler.parent;
		}
	}
	const lfIndex = formatted.indexOf("\n");
	if (lfIndex !== -1) {
		formatted = stringEncaseCRLFWithFirstIndex(formatted, closeAll, openAll, lfIndex);
	}
	return openAll + formatted + closeAll;
}

function openRgbForLevel(level: ColorSupportLevel, offset: number, r: number, g: number, b: number): string {
	if (level === 0) return "";
	if (level === 1) return wrapAnsi(offset, ansi256ToAnsi(rgbToAnsi256(r, g, b)));
	if (level === 2) return wrapAnsi256(offset, rgbToAnsi256(r, g, b));
	return wrapAnsi16m(offset, r, g, b);
}

function openHexForLevel(level: ColorSupportLevel, offset: number, hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return openRgbForLevel(level, offset, r, g, b);
}

function openAnsi256ForLevel(level: ColorSupportLevel, offset: number, index: number): string {
	if (level === 0) return "";
	if (level === 1) return wrapAnsi(offset, ansi256ToAnsi(index));
	return wrapAnsi256(offset, index);
}

const CLOSE_FG = "\u001B[39m";
const CLOSE_BG = "\u001B[49m";
const CLOSE_UL = "\u001B[59m";

function buildDescriptors(): PropertyDescriptorMap {
	const map: PropertyDescriptorMap = Object.create(null) as PropertyDescriptorMap;

	map.level = {
		enumerable: true,
		get(this: object): ColorSupportLevel {
			return CHALK_STATES.get(this)!.box.level;
		},
		set(this: object, value: ColorSupportLevel): void {
			CHALK_STATES.get(this)!.box.level = assertValidLevel(value);
		},
	};

	for (const name of Object.keys(STYLE_PAIRS)) {
		const pair = STYLE_PAIRS[name as keyof typeof STYLE_PAIRS];
		map[name] = {
			enumerable: true,
			get(this: object): ChalkInstance {
				const st = CHALK_STATES.get(this)!;
				const next = createBuilder(st.box, createStyler(pair.open, pair.close, st.styler), st.isEmpty);
				Object.defineProperty(this, name, { value: next, enumerable: true, configurable: true });
				return next;
			},
			configurable: true,
		};
	}

	map.visible = {
		enumerable: true,
		get(this: object): ChalkInstance {
			const st = CHALK_STATES.get(this)!;
			const next = createBuilder(st.box, st.styler, true);
			Object.defineProperty(this, "visible", { value: next, enumerable: true, configurable: true });
			return next;
		},
		configurable: true,
	};

	const modelSpecs: ReadonlyArray<{
		readonly prefix: "" | "bg" | "underline";
		readonly offset: number;
		readonly close: string;
	}> = [
		{ prefix: "", offset: 0, close: CLOSE_FG },
		{ prefix: "bg", offset: 10, close: CLOSE_BG },
		{ prefix: "underline", offset: 20, close: CLOSE_UL },
	];

	for (const spec of modelSpecs) {
		const rgbName = spec.prefix === "" ? "rgb" : `${spec.prefix}Rgb`;
		const hexName = spec.prefix === "" ? "hex" : `${spec.prefix}Hex`;
		const ansiName = spec.prefix === "" ? "ansi256" : `${spec.prefix}Ansi256`;

		map[rgbName] = {
			enumerable: true,
			value(this: object, red: number, green: number, blue: number): ChalkInstance {
				const st = CHALK_STATES.get(this)!;
				const open = openRgbForLevel(st.box.level, spec.offset, red, green, blue);
				return createBuilder(st.box, createStyler(open, spec.close, st.styler), st.isEmpty);
			},
		};
		map[hexName] = {
			enumerable: true,
			value(this: object, hex: string): ChalkInstance {
				const st = CHALK_STATES.get(this)!;
				const open = openHexForLevel(st.box.level, spec.offset, hex);
				return createBuilder(st.box, createStyler(open, spec.close, st.styler), st.isEmpty);
			},
		};
		map[ansiName] = {
			enumerable: true,
			value(this: object, index: number): ChalkInstance {
				const st = CHALK_STATES.get(this)!;
				const open = openAnsi256ForLevel(st.box.level, spec.offset, index);
				return createBuilder(st.box, createStyler(open, spec.close, st.styler), st.isEmpty);
			},
		};
	}

	return map;
}

const DESCRIPTORS = buildDescriptors();

function createBuilder(box: LevelBox, styler: Styler | undefined, isEmpty: boolean): ChalkInstance {
	const state: ChalkState = { box, styler, isEmpty };
	const fn = (...text: unknown[]): string => applyStyle(state, joinArgs(text));
	CHALK_STATES.set(fn, state);
	Object.defineProperties(fn, DESCRIPTORS);
	return fn as unknown as ChalkInstance;
}

function createChalk(options?: Options): ChalkInstance {
	const defaultLevel: ColorSupportLevel = supportsColor !== false ? supportsColor.level : 0;
	const level = options?.level !== undefined ? assertValidLevel(options.level) : defaultLevel;
	return createBuilder(new LevelBox(level), undefined, false);
}

export interface ChalkConstructor {
	new (options?: Options): ChalkInstance;
}

function ChalkCtor(options?: Options): ChalkInstance {
	return createChalk(options);
}

export const Chalk: ChalkConstructor = ChalkCtor as unknown as ChalkConstructor;
export const chalk: ChalkInstance = createChalk();
export const chalkStderr: ChalkInstance = createChalk({
	level: supportsColorStderr !== false ? supportsColorStderr.level : 0,
});

export default chalk;
