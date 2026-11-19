/**
 * Native CommonMark-subset Markdown parser and renderer with inline styles, code blocks, quotes, lists, and rules.
 */

import type { TextStyle } from "../backend.ts";
import { type Color, withAlpha } from "../colors.ts";
import {
	type Edges,
	GuiComponent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	type Size,
} from "../component.ts";
import {
	type GuiA11yNode,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
} from "../protocol.ts";
import { type CodeToken, type CodeTokenKind, tokenColorForKind, tokenizeCodeLines } from "./code-highlight.ts";
import { drawVectorIcon } from "./vector.ts";

export interface InlineSpan {
	readonly kind: "text" | "bold" | "italic" | "code" | "strike" | "link";
	readonly text: string;
	readonly href?: string;
}

export type MarkdownBlock =
	| { readonly kind: "heading"; readonly level: number; readonly spans: readonly InlineSpan[] }
	| { readonly kind: "paragraph"; readonly spans: readonly InlineSpan[] }
	| { readonly kind: "code"; readonly language: string; readonly code: string }
	| { readonly kind: "blockquote"; readonly spans: readonly InlineSpan[] }
	| {
			readonly kind: "listItem";
			readonly ordered: boolean;
			readonly marker: string;
			readonly spans: readonly InlineSpan[];
	  }
	| { readonly kind: "hr" };

export function parseInlineMarkdown(input: string): InlineSpan[] {
	const spans: InlineSpan[] = [];
	let i = 0;
	let plainBuf = "";

	const flushPlain = (): void => {
		if (plainBuf.length > 0) {
			spans.push({ kind: "text", text: plainBuf });
			plainBuf = "";
		}
	};

	while (i < input.length) {
		const ch = input.charAt(i);

		// Inline code `...`
		if (ch === "`") {
			const end = input.indexOf("`", i + 1);
			if (end > i + 1) {
				flushPlain();
				spans.push({ kind: "code", text: input.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}

		// Link [label](url)
		if (ch === "[") {
			const closeBracket = input.indexOf("]", i + 1);
			if (closeBracket > i + 1 && input.charAt(closeBracket + 1) === "(") {
				const closeParen = input.indexOf(")", closeBracket + 2);
				if (closeParen > closeBracket + 2) {
					flushPlain();
					spans.push({
						kind: "link",
						text: input.slice(i + 1, closeBracket),
						href: input.slice(closeBracket + 2, closeParen),
					});
					i = closeParen + 1;
					continue;
				}
			}
		}

		// Bold **...** or __...__
		if ((ch === "*" || ch === "_") && input.charAt(i + 1) === ch) {
			const delim = ch + ch;
			const end = input.indexOf(delim, i + 2);
			if (end > i + 2) {
				flushPlain();
				spans.push({ kind: "bold", text: input.slice(i + 2, end) });
				i = end + 2;
				continue;
			}
		}

		// Strikethrough ~~...~~
		if (ch === "~" && input.charAt(i + 1) === "~") {
			const end = input.indexOf("~~", i + 2);
			if (end > i + 2) {
				flushPlain();
				spans.push({ kind: "strike", text: input.slice(i + 2, end) });
				i = end + 2;
				continue;
			}
		}

		// Italic *...* or _..._
		if (ch === "*" || ch === "_") {
			const end = input.indexOf(ch, i + 1);
			if (end > i + 1) {
				flushPlain();
				spans.push({ kind: "italic", text: input.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}

		plainBuf += ch;
		i += 1;
	}

	flushPlain();
	return spans;
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
	const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	const blocks: MarkdownBlock[] = [];
	let i = 0;

	while (i < lines.length) {
		const raw = lines[i] ?? "";
		const trimmed = raw.trim();

		if (trimmed.length === 0) {
			i += 1;
			continue;
		}

		// Fenced code block
		if (trimmed.startsWith("```")) {
			const lang = trimmed.slice(3).trim();
			const codeLines: string[] = [];
			i += 1;
			while (i < lines.length) {
				const line = lines[i] ?? "";
				if (line.trim().startsWith("```")) {
					i += 1;
					break;
				}
				codeLines.push(line);
				i += 1;
			}
			blocks.push({ kind: "code", language: lang, code: codeLines.join("\n") });
			continue;
		}

		// Horizontal rule
		if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
			blocks.push({ kind: "hr" });
			i += 1;
			continue;
		}

		// Heading # .. ######
		const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
		if (headingMatch !== null) {
			const hashes = headingMatch[1] ?? "#";
			const body = headingMatch[2] ?? "";
			blocks.push({ kind: "heading", level: hashes.length, spans: parseInlineMarkdown(body.trim()) });
			i += 1;
			continue;
		}

		// Blockquote
		if (trimmed.startsWith(">")) {
			const quoteParts: string[] = [];
			while (i < lines.length) {
				const qLine = (lines[i] ?? "").trim();
				if (!qLine.startsWith(">")) break;
				quoteParts.push(qLine.replace(/^>\s?/, ""));
				i += 1;
			}
			blocks.push({ kind: "blockquote", spans: parseInlineMarkdown(quoteParts.join(" ")) });
			continue;
		}

		// Unordered list item
		const ulMatch = /^\s*[-*+]\s+(.+)$/.exec(raw);
		if (ulMatch !== null) {
			blocks.push({
				kind: "listItem",
				ordered: false,
				marker: "-",
				spans: parseInlineMarkdown((ulMatch[1] ?? "").trim()),
			});
			i += 1;
			continue;
		}

		// Ordered list item
		const olMatch = /^\s*(\d+\.)\s+(.+)$/.exec(raw);
		if (olMatch !== null) {
			blocks.push({
				kind: "listItem",
				ordered: true,
				marker: olMatch[1] ?? "1.",
				spans: parseInlineMarkdown((olMatch[2] ?? "").trim()),
			});
			i += 1;
			continue;
		}

		// Paragraph: accumulate contiguous non-block lines
		const paraLines: string[] = [trimmed];
		i += 1;
		while (i < lines.length) {
			const next = (lines[i] ?? "").trim();
			if (
				next.length === 0 ||
				next.startsWith("```") ||
				next.startsWith(">") ||
				/^(#{1,6})\s+/.test(next) ||
				/^(?:-{3,}|\*{3,}|_{3,})$/.test(next) ||
				/^[-*+]\s+/.test(next) ||
				/^\d+\.\s+/.test(next)
			) {
				break;
			}
			paraLines.push(next);
			i += 1;
		}
		blocks.push({ kind: "paragraph", spans: parseInlineMarkdown(paraLines.join(" ")) });
	}

	return blocks;
}

interface PositionedInlineSegment {
	readonly kind: InlineSpan["kind"];
	readonly text: string;
	readonly xOffset: number;
	readonly width: number;
	readonly style: TextStyle;
	readonly textPadLeft?: number;
}

interface WrappedSpanLine {
	readonly segments: readonly PositionedInlineSegment[];
	readonly lineHeight: number;
}

function spansPlainText(spans: readonly InlineSpan[]): string {
	let out = "";
	for (let i = 0; i < spans.length; i++) {
		const span = spans[i];
		if (span !== undefined) {
			out += span.text;
		}
	}
	return out;
}

function extractReadableMarkdownText(blocks: readonly MarkdownBlock[], fallback: string): string {
	const parts: string[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (block === undefined) continue;
		if (block.kind === "heading" || block.kind === "paragraph" || block.kind === "blockquote") {
			const text = spansPlainText(block.spans).trim();
			if (text.length > 0) parts.push(text);
		} else if (block.kind === "listItem") {
			const text = spansPlainText(block.spans).trim();
			if (text.length > 0) parts.push(`${block.marker} ${text}`);
		} else if (block.kind === "code") {
			const code = block.code.trim();
			if (code.length > 0) parts.push(code);
		}
	}
	if (parts.length > 0) {
		return parts.join("\n");
	}
	return blocks.length === 0 ? fallback.trim() : "";
}

export interface MarkdownOptions {
	readonly text?: string;
	readonly padding?: PaddingInput;
	readonly fontSize?: number;
	readonly paragraphGap?: number;
	readonly textColor?: Color;
	/** Optional case-insensitive substring query highlighted across prose and code blocks. */
	readonly searchQuery?: string;
	/** Zero-based document-order index of the active search match (`activeSearchMatchBg`). */
	readonly activeSearchMatch?: number;
	/** Whether to draw the Waku header strip (language + Copy button) on fenced code blocks. Default: true. */
	readonly showCodeHeader?: boolean;
	/** Whether to apply syntax token coloring inside fenced code blocks. Default: true. */
	readonly syntaxHighlight?: boolean;
	/** Callback invoked when the user clicks the Copy button in a code block header. */
	readonly onCopyCode?: (code: string, language: string) => void;
	/** Optional custom syntax highlighter override returning tokens per source line. */
	readonly codeHighlighter?: (code: string, language: string) => readonly (readonly CodeToken[])[];
}

function spanTextStyle(kind: InlineSpan["kind"], baseFontSize: number, boldWeight = 400): TextStyle {
	switch (kind) {
		case "bold":
			return { fontFamily: SGUI_FONT_REGULAR, fontSize: baseFontSize, fontWeight: 700 };
		case "italic":
			return { fontFamily: SGUI_FONT_REGULAR, fontSize: baseFontSize, fontWeight: boldWeight, italic: true };
		case "code":
			return {
				fontFamily: SGUI_FONT_MONO,
				fontSize: Math.max(11, baseFontSize - 1),
				fontWeight: 400,
			};
		case "strike":
			return { fontFamily: SGUI_FONT_REGULAR, fontSize: baseFontSize, fontWeight: boldWeight, strikethrough: true };
		case "link":
			return { fontFamily: SGUI_FONT_REGULAR, fontSize: baseFontSize, fontWeight: boldWeight, underline: true };
		default:
			return { fontFamily: SGUI_FONT_REGULAR, fontSize: baseFontSize, fontWeight: boldWeight };
	}
}

function splitTokens(text: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	while (i < text.length) {
		const isSpace = /\s/.test(text.charAt(i));
		let j = i + 1;
		while (j < text.length && /\s/.test(text.charAt(j)) === isSpace) {
			j += 1;
		}
		tokens.push(text.slice(i, j));
		i = j;
	}
	return tokens;
}

function layoutInlineSpans(
	ctx: GuiRenderContext,
	spans: readonly InlineSpan[],
	maxWidth: number,
	baseFontSize: number,
	baseWeight = 400,
): WrappedSpanLine[] {
	const widthBudget = Math.max(40, maxWidth);
	const lines: WrappedSpanLine[] = [];
	let currentSegs: PositionedInlineSegment[] = [];
	let cursorX = 0;
	let rowHeight = ctx.measureText({ fontFamily: SGUI_FONT_REGULAR, fontSize: baseFontSize }, 0, "Mg").lineHeight;

	const addTrailingCodePad = (): void => {
		const last = currentSegs[currentSegs.length - 1];
		if (last !== undefined && last.kind === "code") {
			currentSegs[currentSegs.length - 1] = {
				kind: last.kind,
				text: last.text,
				xOffset: last.xOffset,
				width: last.width + 3,
				style: last.style,
				textPadLeft: last.textPadLeft,
			};
			cursorX += 3;
		}
	};

	const pushLine = (): void => {
		addTrailingCodePad();
		lines.push({ segments: currentSegs, lineHeight: rowHeight });
		currentSegs = [];
		cursorX = 0;
	};

	for (let s = 0; s < spans.length; s++) {
		const span = spans[s];
		if (span === undefined) continue;
		const style = spanTextStyle(span.kind, baseFontSize, baseWeight);
		const spanLH = ctx.measureText(style, 0, "Mg").lineHeight;
		if (spanLH > rowHeight) rowHeight = spanLH;

		const isCode = span.kind === "code";
		if (!isCode) {
			addTrailingCodePad();
		}
		const tokens = splitTokens(span.text);
		for (let t = 0; t < tokens.length; t++) {
			const token = tokens[t];
			if (token === undefined || token.length === 0) continue;
			const isSpace = /^\s+$/.test(token);
			if (isSpace && cursorX === 0) {
				continue;
			}
			const textW = Math.ceil(ctx.measureText(style, 0, token).width);
			const prevSeg = currentSegs[currentSegs.length - 1];
			let leftPad = isCode && (prevSeg === undefined || prevSeg.kind !== "code") ? 3 : 0;
			const wrapBudgetCheck = leftPad + textW + (isCode ? 3 : 0);
			if (cursorX > 0 && cursorX + wrapBudgetCheck > widthBudget && !isSpace) {
				pushLine();
				leftPad = isCode ? 3 : 0;
			}
			const w = leftPad + textW;
			currentSegs.push({
				kind: span.kind,
				text: token,
				xOffset: cursorX,
				width: w,
				style,
				textPadLeft: leftPad,
			});
			cursorX += w;
		}
	}

	if (currentSegs.length > 0 || lines.length === 0) {
		addTrailingCodePad();
		lines.push({ segments: currentSegs, lineHeight: rowHeight });
	}
	return lines;
}

interface CodeBlockLayoutSegment {
	readonly kind: CodeTokenKind;
	readonly text: string;
	readonly xOffset: number;
	readonly width: number;
}

interface WrappedCodeBlockLine {
	readonly segments: readonly CodeBlockLayoutSegment[];
	readonly lineText: string;
	readonly lineHeight: number;
}

interface LayoutBlockCacheEntry {
	readonly block: MarkdownBlock;
	readonly y: number;
	readonly height: number;
	readonly lines?: readonly WrappedSpanLine[];
	readonly codeLines?: readonly WrappedCodeBlockLine[];
	readonly hasHeader?: boolean;
	readonly codeTextHeight?: number;
}

interface SearchMatchRange {
	readonly start: number;
	readonly end: number;
}

interface SearchMatchCounter {
	index: number;
}

interface HighlightSegmentLike {
	readonly text: string;
	readonly xOffset: number;
	readonly style: TextStyle;
	readonly textPadLeft?: number;
}

const CODE_HEADER_HEIGHT = 28;
const COPY_FEEDBACK_MS = 1600;

function findSearchMatchRanges(text: string, queryLower: string): SearchMatchRange[] {
	if (queryLower.length === 0 || text.length === 0) return [];
	const lower = text.toLowerCase();
	const out: SearchMatchRange[] = [];
	let from = 0;
	while (from <= lower.length - queryLower.length) {
		const idx = lower.indexOf(queryLower, from);
		if (idx < 0) break;
		out.push({ start: idx, end: idx + queryLower.length });
		from = idx + queryLower.length;
	}
	return out;
}

function renderLineSearchHighlights(
	ctx: GuiRenderContext,
	lineText: string,
	segments: readonly HighlightSegmentLike[],
	startX: number,
	lineY: number,
	lineHeight: number,
	queryLower: string,
	activeMatchIndex: number,
	counter: SearchMatchCounter,
): void {
	if (queryLower.length === 0) return;
	const ranges = findSearchMatchRanges(lineText, queryLower);
	if (ranges.length === 0) return;

	for (let r = 0; r < ranges.length; r++) {
		const range = ranges[r];
		if (range === undefined) continue;
		const isActive = counter.index === activeMatchIndex;
		counter.index += 1;
		const bgColor = isActive ? ctx.theme.activeSearchMatchBg : ctx.theme.searchMatchBg;

		let segCharStart = 0;
		for (let s = 0; s < segments.length; s++) {
			const seg = segments[s];
			if (seg === undefined) continue;
			const segCharEnd = segCharStart + seg.text.length;
			const ovStart = Math.max(range.start, segCharStart);
			const ovEnd = Math.min(range.end, segCharEnd);
			if (ovEnd > ovStart) {
				const localStart = ovStart - segCharStart;
				const localEnd = ovEnd - segCharStart;
				const baseX = startX + seg.xOffset + (seg.textPadLeft ?? 0);
				const x0 = baseX + ctx.getTextCaretX(seg.style, seg.text, localStart);
				const x1 = baseX + ctx.getTextCaretX(seg.style, seg.text, localEnd);
				ctx.fillRect(x0, lineY + 1, Math.max(2, x1 - x0), Math.max(2, lineHeight - 2), bgColor, 3);
			}
			segCharStart = segCharEnd;
		}
	}
}

function fitCodePrefixLength(
	ctx: GuiRenderContext,
	codeStyle: TextStyle,
	text: string,
	availWidth: number,
	allowEmpty: boolean,
): number {
	if (text.length === 0) return 0;
	if (ctx.measureText(codeStyle, 0, text).width <= availWidth) {
		return text.length;
	}
	let low = allowEmpty ? 0 : 1;
	let high = text.length;
	let best = low;
	while (low <= high) {
		const mid = Math.floor((low + high) * 0.5);
		if (mid === 0) {
			low = 1;
			continue;
		}
		const w = ctx.measureText(codeStyle, 0, text.slice(0, mid)).width;
		if (w <= availWidth) {
			best = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}

function rawLinesAsPlainTokens(code: string): readonly (readonly CodeToken[])[] {
	const lines = code.split("\n");
	const out: CodeToken[][] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		out.push(line.length > 0 ? [{ kind: "plain", text: line }] : []);
	}
	return out;
}

function layoutCodeBlockLines(
	ctx: GuiRenderContext,
	code: string,
	language: string,
	maxWidth: number,
	codeStyle: TextStyle,
	syntaxHighlight: boolean,
	customHighlighter: ((code: string, language: string) => readonly (readonly CodeToken[])[]) | undefined,
): { readonly lines: readonly WrappedCodeBlockLine[]; readonly totalHeight: number } {
	const budget = Math.max(40, maxWidth);
	const lineHeight = ctx.measureText(codeStyle, 0, "Mg").lineHeight;
	const tokenLines =
		customHighlighter !== undefined
			? customHighlighter(code, language)
			: syntaxHighlight
				? tokenizeCodeLines(code, language)
				: rawLinesAsPlainTokens(code);

	const wrapped: WrappedCodeBlockLine[] = [];
	for (let li = 0; li < tokenLines.length; li++) {
		const sourceTokens = tokenLines[li] ?? [];
		let segs: CodeBlockLayoutSegment[] = [];
		let lineText = "";
		let cursorX = 0;

		const flushVisualLine = (): void => {
			wrapped.push({ segments: segs, lineText, lineHeight });
			segs = [];
			lineText = "";
			cursorX = 0;
		};

		for (let ti = 0; ti < sourceTokens.length; ti++) {
			const tok = sourceTokens[ti];
			if (tok === undefined || tok.text.length === 0) continue;
			let remaining = tok.text;
			while (remaining.length > 0) {
				const avail = Math.max(0, budget - cursorX);
				const take = fitCodePrefixLength(ctx, codeStyle, remaining, avail, cursorX > 0);
				if (take === 0) {
					flushVisualLine();
					continue;
				}
				const chunk = remaining.slice(0, take);
				const chunkW = ctx.measureText(codeStyle, 0, chunk).width;
				segs.push({
					kind: tok.kind,
					text: chunk,
					xOffset: cursorX,
					width: chunkW,
				});
				lineText += chunk;
				cursorX += chunkW;
				remaining = remaining.slice(take);
				if (remaining.length > 0) {
					flushVisualLine();
				}
			}
		}

		flushVisualLine();
	}

	const totalHeight = Math.max(lineHeight, wrapped.length * lineHeight);
	return { lines: wrapped, totalHeight };
}

export class Markdown extends GuiComponent {
	private textValue: string;
	private blocks: MarkdownBlock[];
	private padding: Edges;
	private fontSize: number | undefined;
	private paragraphGap: number;
	private textColor: Color | undefined;
	private searchQuery: string;
	private activeSearchMatch: number;
	private showCodeHeader: boolean;
	private syntaxHighlight: boolean;
	private onCopyCode: ((code: string, language: string) => void) | undefined;
	private codeHighlighter: ((code: string, language: string) => readonly (readonly CodeToken[])[]) | undefined;
	private cachedWidth: number;
	private cachedFontSize: number;
	private cachedCodeFontSize: number;
	private cachedShowCodeHeader: boolean;
	private cachedSyntaxHighlight: boolean;
	private cachedLayout: LayoutBlockCacheEntry[];
	private cachedTotalHeight: number;
	private hoveredCopyIndex = -1;
	private pressedCopyIndex = -1;
	private copiedBlockIndex = -1;
	private copiedUntilMs = 0;

	constructor(textOrOptions: string | MarkdownOptions = "") {
		super();
		const opts: MarkdownOptions = typeof textOrOptions === "string" ? { text: textOrOptions } : textOrOptions;
		this.textValue = opts.text ?? "";
		this.blocks = parseMarkdownBlocks(this.textValue);
		this.padding = normalizeEdges(opts.padding ?? 0);
		this.fontSize = opts.fontSize;
		this.paragraphGap = opts.paragraphGap ?? 10;
		this.textColor = opts.textColor;
		this.searchQuery = opts.searchQuery ?? "";
		this.activeSearchMatch = opts.activeSearchMatch ?? 0;
		this.showCodeHeader = opts.showCodeHeader ?? true;
		this.syntaxHighlight = opts.syntaxHighlight ?? true;
		this.onCopyCode = opts.onCopyCode;
		this.codeHighlighter = opts.codeHighlighter;
		this.cachedWidth = -1;
		this.cachedFontSize = -1;
		this.cachedCodeFontSize = -1;
		this.cachedShowCodeHeader = this.showCodeHeader;
		this.cachedSyntaxHighlight = this.syntaxHighlight;
		this.cachedLayout = [];
		this.cachedTotalHeight = 0;
	}

	getText(): string {
		return this.textValue;
	}

	setText(text: string): void {
		if (this.textValue === text) return;
		this.textValue = text;
		this.blocks = parseMarkdownBlocks(text);
		this.cachedWidth = -1;
		this.copiedBlockIndex = -1;
		this.copiedUntilMs = 0;
		this.invalidate();
	}

	setMarkdown(text: string): void {
		this.setText(text);
	}

	getSearchQuery(): string {
		return this.searchQuery;
	}

	setSearchQuery(query: string, activeMatchIndex?: number): void {
		const nextActive = activeMatchIndex ?? this.activeSearchMatch;
		if (this.searchQuery === query && this.activeSearchMatch === nextActive) return;
		this.searchQuery = query;
		this.activeSearchMatch = nextActive;
		this.invalidate();
	}

	getActiveSearchMatch(): number {
		return this.activeSearchMatch;
	}

	setActiveSearchMatch(index: number): void {
		if (this.activeSearchMatch === index) return;
		this.activeSearchMatch = index;
		this.invalidate();
	}

	setOnCopyCode(callback: ((code: string, language: string) => void) | undefined): void {
		this.onCopyCode = callback;
	}

	setShowCodeHeader(show: boolean): void {
		if (this.showCodeHeader === show) return;
		this.showCodeHeader = show;
		this.cachedWidth = -1;
		this.invalidate();
	}

	setSyntaxHighlight(enabled: boolean): void {
		if (this.syntaxHighlight === enabled) return;
		this.syntaxHighlight = enabled;
		this.cachedWidth = -1;
		this.invalidate();
	}

	private computeLayoutCache(ctx: GuiRenderContext, innerWidth: number): void {
		const baseSize = this.fontSize ?? ctx.theme.fontSizeBody;
		const codeSize = ctx.theme.fontSizeCode;
		if (
			Math.abs(this.cachedWidth - innerWidth) <= 0.5 &&
			this.cachedFontSize === baseSize &&
			this.cachedCodeFontSize === codeSize &&
			this.cachedShowCodeHeader === this.showCodeHeader &&
			this.cachedSyntaxHighlight === this.syntaxHighlight
		) {
			return;
		}
		this.cachedWidth = innerWidth;
		this.cachedFontSize = baseSize;
		this.cachedCodeFontSize = codeSize;
		this.cachedShowCodeHeader = this.showCodeHeader;
		this.cachedSyntaxHighlight = this.syntaxHighlight;
		const entries: LayoutBlockCacheEntry[] = [];
		let y = 0;

		for (let i = 0; i < this.blocks.length; i++) {
			const block = this.blocks[i];
			if (block === undefined) continue;
			const gapAfter = i + 1 < this.blocks.length ? this.paragraphGap : 0;

			switch (block.kind) {
				case "hr": {
					const h = 12;
					entries.push({ block, y, height: h });
					y += h + gapAfter;
					break;
				}
				case "heading": {
					const scale = block.level === 1 ? 1.55 : block.level === 2 ? 1.3 : block.level === 3 ? 1.15 : 1.02;
					const hSize = Math.round(baseSize * scale);
					const lines = layoutInlineSpans(ctx, block.spans, innerWidth, hSize, 700);
					let h = 0;
					for (let li = 0; li < lines.length; li++) h += lines[li]?.lineHeight ?? 0;
					entries.push({ block, y, height: h, lines });
					y += h + gapAfter;
					break;
				}
				case "paragraph": {
					const lines = layoutInlineSpans(ctx, block.spans, innerWidth, baseSize, 400);
					let h = 0;
					for (let li = 0; li < lines.length; li++) h += lines[li]?.lineHeight ?? 0;
					entries.push({ block, y, height: h, lines });
					y += h + gapAfter;
					break;
				}
				case "blockquote": {
					const quoteWidth = Math.max(40, innerWidth - 18);
					const lines = layoutInlineSpans(ctx, block.spans, quoteWidth, baseSize, 400);
					let h = 0;
					for (let li = 0; li < lines.length; li++) h += lines[li]?.lineHeight ?? 0;
					const totalH = Math.max(20, h + 8);
					entries.push({ block, y, height: totalH, lines });
					y += totalH + gapAfter;
					break;
				}
				case "listItem": {
					const listWidth = Math.max(40, innerWidth - 22);
					const lines = layoutInlineSpans(ctx, block.spans, listWidth, baseSize, 400);
					let h = 0;
					for (let li = 0; li < lines.length; li++) h += lines[li]?.lineHeight ?? 0;
					entries.push({ block, y, height: h, lines });
					y += h + Math.min(6, gapAfter);
					break;
				}
				case "code": {
					const codeStyle: TextStyle = {
						fontFamily: SGUI_FONT_MONO,
						fontSize: codeSize,
						fontWeight: 400,
					};
					const hasHeader = this.showCodeHeader;
					const headerH = hasHeader ? CODE_HEADER_HEIGHT : 0;
					const codeMaxW = Math.max(40, innerWidth - 24);
					const laid = layoutCodeBlockLines(
						ctx,
						block.code,
						block.language,
						codeMaxW,
						codeStyle,
						this.syntaxHighlight,
						this.codeHighlighter,
					);
					const totalH = headerH + laid.totalHeight + 20;
					entries.push({
						block,
						y,
						height: totalH,
						codeLines: laid.lines,
						hasHeader,
						codeTextHeight: laid.totalHeight,
					});
					y += totalH + gapAfter;
					break;
				}
			}
		}

		this.cachedLayout = entries;
		this.cachedTotalHeight = y;
	}

	private copyButtonRectForEntry(
		entry: LayoutBlockCacheEntry,
		originX: number,
		originY: number,
		innerW: number,
	): Rect | undefined {
		if (entry.block.kind !== "code" || !entry.hasHeader) {
			return undefined;
		}
		return {
			x: originX + innerW - 30,
			y: originY + entry.y + 3,
			width: 24,
			height: 22,
		};
	}

	private hitTestCopyButton(x: number, y: number): number {
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return -1;
		const innerW = Math.max(40, r.width - this.padding.left - this.padding.right);
		const originX = r.x + this.padding.left;
		const originY = r.y + this.padding.top;
		for (let i = 0; i < this.cachedLayout.length; i++) {
			const entry = this.cachedLayout[i];
			if (entry === undefined) continue;
			const rect = this.copyButtonRectForEntry(entry, originX, originY, innerW);
			if (rect !== undefined && pointInRect(x, y, rect)) {
				return i;
			}
		}
		return -1;
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const innerW = Math.max(40, maxWidth - this.padding.left - this.padding.right);
		this.computeLayoutCache(ctx, innerW);
		return {
			width: maxWidth,
			height: this.cachedTotalHeight + this.padding.top + this.padding.bottom,
		};
	}

	private renderInlineLines(
		ctx: GuiRenderContext,
		lines: readonly WrappedSpanLine[],
		startX: number,
		startY: number,
		defaultColor: Color,
		queryLower: string,
		matchCounter: SearchMatchCounter,
	): void {
		let y = startY;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined) continue;
			let lineText = "";
			const hlSegments: HighlightSegmentLike[] = [];
			let j = 0;
			while (j < line.segments.length) {
				const seg = line.segments[j];
				if (seg === undefined) {
					j += 1;
					continue;
				}
				if (seg.kind === "code") {
					const runStartX = startX + seg.xOffset;
					let runEndX = runStartX + seg.width;
					let k = j + 1;
					while (k < line.segments.length) {
						const nextSeg = line.segments[k];
						if (nextSeg === undefined || nextSeg.kind !== "code") break;
						runEndX = startX + nextSeg.xOffset + nextSeg.width;
						k += 1;
					}
					ctx.fillRect(runStartX, y + 1, Math.max(2, runEndX - runStartX), line.lineHeight - 2, ctx.theme.codeWash, 4);
					for (let m = j; m < k; m++) {
						const codeSeg = line.segments[m];
						if (codeSeg === undefined) continue;
						lineText += codeSeg.text;
						hlSegments.push({
							text: codeSeg.text,
							xOffset: codeSeg.xOffset,
							style: codeSeg.style,
							textPadLeft: codeSeg.textPadLeft ?? 0,
						});
					}
					j = k;
					continue;
				}
				lineText += seg.text;
				hlSegments.push({
					text: seg.text,
					xOffset: seg.xOffset,
					style: seg.style,
					textPadLeft: 0,
				});
				j += 1;
			}

			renderLineSearchHighlights(
				ctx,
				lineText,
				hlSegments,
				startX,
				y,
				line.lineHeight,
				queryLower,
				this.activeSearchMatch,
				matchCounter,
			);

			for (let j = 0; j < line.segments.length; j++) {
				const seg = line.segments[j];
				if (seg === undefined) continue;
				const sx = startX + seg.xOffset;
				let color = defaultColor;
				if (seg.kind === "code") {
					ctx.drawStyledText(sx + (seg.textPadLeft ?? 0), y, 0, ctx.theme.codeText, seg.style, seg.text);
					continue;
				}
				if (seg.kind === "link") {
					color = ctx.theme.link;
				} else if (seg.kind === "bold") {
					color = this.textColor ?? ctx.theme.textBright;
				} else if (seg.kind === "italic") {
					color = this.textColor ?? (defaultColor === ctx.theme.text ? ctx.theme.textSecondary : defaultColor);
				}
				ctx.drawStyledText(sx, y, 0, color, seg.style, seg.text);
			}
			y += line.lineHeight;
		}
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		const innerW = Math.max(40, r.width - this.padding.left - this.padding.right);
		this.computeLayoutCache(ctx, innerW);

		const originX = r.x + this.padding.left;
		const originY = r.y + this.padding.top;
		const defaultColor = this.textColor ?? ctx.theme.text;
		const headingDefaultColor = this.textColor ?? ctx.theme.textBright;
		const queryLower = this.searchQuery.trim().toLowerCase();
		const matchCounter: SearchMatchCounter = { index: 0 };

		for (let i = 0; i < this.cachedLayout.length; i++) {
			const entry = this.cachedLayout[i];
			if (entry === undefined) continue;
			const by = originY + entry.y;
			const block = entry.block;

			switch (block.kind) {
				case "hr": {
					const lineY = by + entry.height * 0.5;
					ctx.drawLine(originX, lineY, originX + innerW, lineY, ctx.theme.border, 1);
					break;
				}
				case "heading": {
					if (entry.lines !== undefined) {
						this.renderInlineLines(
							ctx,
							entry.lines,
							originX,
							by,
							headingDefaultColor,
							queryLower,
							matchCounter,
						);
					}
					break;
				}
				case "paragraph": {
					if (entry.lines !== undefined) {
						this.renderInlineLines(ctx, entry.lines, originX, by, defaultColor, queryLower, matchCounter);
					}
					break;
				}
				case "blockquote": {
					ctx.fillRect(
						originX,
						by,
						innerW,
						entry.height,
						withAlpha(ctx.theme.surfaceMuted, 0.7),
						ctx.theme.radiusSmall,
					);
					ctx.fillRect(originX, by, 4, entry.height, ctx.theme.quoteBorder, 2);
					if (entry.lines !== undefined) {
						this.renderInlineLines(
							ctx,
							entry.lines,
							originX + 14,
							by + 4,
							ctx.theme.textSecondary,
							queryLower,
							matchCounter,
						);
					}
					break;
				}
				case "listItem": {
					const bodySize = this.fontSize ?? ctx.theme.fontSizeBody;
					const markerStyle: TextStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: bodySize, fontWeight: 600 };
					const markerText = block.ordered ? block.marker : "\u2022";
					ctx.drawStyledText(originX + 4, by, 0, ctx.theme.textMuted, markerStyle, markerText);
					if (entry.lines !== undefined) {
						this.renderInlineLines(ctx, entry.lines, originX + 22, by, defaultColor, queryLower, matchCounter);
					}
					break;
				}
				case "code": {
					ctx.fillRect(originX, by, innerW, entry.height, ctx.theme.codeBlockBg, ctx.theme.radiusMedium);
					ctx.strokeRect(originX, by, innerW, entry.height, ctx.theme.border, 1, ctx.theme.radiusMedium);

					let codeTop = by + 10;
					if (entry.hasHeader) {
						const langStyle: TextStyle = {
							fontFamily: SGUI_FONT_MONO,
							fontSize: ctx.theme.fontSizeSmall,
							fontWeight: 600,
						};
						const langLabel = block.language.length > 0 ? block.language.toLowerCase() : "code";
						ctx.drawStyledText(
							originX + 12,
							by + 7,
							Math.max(40, innerW - 56),
							ctx.theme.textMuted,
							langStyle,
							langLabel,
						);
						ctx.drawLine(originX, by + CODE_HEADER_HEIGHT, originX + innerW, by + CODE_HEADER_HEIGHT, ctx.theme.border, 1);

						const btnRect = this.copyButtonRectForEntry(entry, originX, originY, innerW);
						if (btnRect !== undefined) {
							const isCopied = this.copiedBlockIndex === i && ctx.nowMs < this.copiedUntilMs;
							const isBtnHovered = this.isHovered() && this.hoveredCopyIndex === i;
							if (isBtnHovered || isCopied) {
								ctx.fillRect(btnRect.x, btnRect.y, btnRect.width, btnRect.height, ctx.theme.hover, 4);
							}
							const iconColor = isCopied
								? ctx.theme.accent
								: isBtnHovered
									? ctx.theme.textBright
									: ctx.theme.textSecondary;
							drawVectorIcon(ctx, isCopied ? "check" : "copy", btnRect.x + 5, btnRect.y + 4, 14, iconColor);
						}
						codeTop = by + CODE_HEADER_HEIGHT + 10;
					}

					const codeStyle: TextStyle = {
						fontFamily: SGUI_FONT_MONO,
						fontSize: ctx.theme.fontSizeCode,
						fontWeight: 400,
					};
					const codeLines = entry.codeLines ?? [];
					let lineY = codeTop;
					for (let li = 0; li < codeLines.length; li++) {
						const cl = codeLines[li];
						if (cl === undefined) continue;
						if (queryLower.length > 0 && cl.lineText.length > 0) {
							const hlSegs: HighlightSegmentLike[] = [];
							for (let si = 0; si < cl.segments.length; si++) {
								const seg = cl.segments[si];
								if (seg === undefined) continue;
								hlSegs.push({
									text: seg.text,
									xOffset: seg.xOffset,
									style: codeStyle,
								});
							}
							renderLineSearchHighlights(
								ctx,
								cl.lineText,
								hlSegs,
								originX + 12,
								lineY,
								cl.lineHeight,
								queryLower,
								this.activeSearchMatch,
								matchCounter,
							);
						}
						for (let si = 0; si < cl.segments.length; si++) {
							const seg = cl.segments[si];
							if (seg === undefined || seg.text.length === 0) continue;
							const tokColor = tokenColorForKind(seg.kind, ctx.theme);
							ctx.drawStyledText(originX + 12 + seg.xOffset, lineY, 0, tokColor, codeStyle, seg.text);
						}
						lineY += cl.lineHeight;
					}
					break;
				}
			}
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) {
			return undefined;
		}
		return this.hitTestCopyButton(x, y) >= 0 ? this : undefined;
	}

	override handlePointer(event: GuiPointerEvent, ctx: GuiRenderContext): GuiPointerResult {
		if (!this.visible) {
			return { handled: false };
		}
		const idx = this.hitTestCopyButton(event.x, event.y);
		if (event.phase === "move") {
			if (this.hoveredCopyIndex !== idx) {
				this.hoveredCopyIndex = idx;
				this.invalidate();
			}
			return idx >= 0 ? { handled: false, cursor: SGUI_CURSOR_POINTER } : { handled: false };
		}
		if (event.phase === "down" && event.button === "left") {
			if (idx >= 0) {
				this.pressedCopyIndex = idx;
				this.hoveredCopyIndex = idx;
				this.invalidate();
				return { handled: true, capture: this, cursor: SGUI_CURSOR_POINTER };
			}
			return { handled: false };
		}
		if (event.phase === "drag" && this.pressedCopyIndex >= 0) {
			const nextHover = idx === this.pressedCopyIndex ? idx : -1;
			if (this.hoveredCopyIndex !== nextHover) {
				this.hoveredCopyIndex = nextHover;
				this.invalidate();
			}
			return { handled: true, capture: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && this.pressedCopyIndex >= 0) {
			const targetIdx = this.pressedCopyIndex;
			this.pressedCopyIndex = -1;
			this.hoveredCopyIndex = idx;
			if (idx === targetIdx) {
				const entry = this.cachedLayout[targetIdx];
				if (entry !== undefined && entry.block.kind === "code") {
					ctx.setClipboardText(entry.block.code);
					this.onCopyCode?.(entry.block.code, entry.block.language);
					this.copiedBlockIndex = targetIdx;
					this.copiedUntilMs = ctx.nowMs + COPY_FEEDBACK_MS;
				}
			}
			this.invalidate();
			return {
				handled: true,
				releaseCapture: true,
				cursor: idx >= 0 ? SGUI_CURSOR_POINTER : undefined,
			};
		}
		return { handled: false };
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		const r = this.layoutRect;
		if (!this.visible || r.width <= 0 || r.height <= 0) return;
		const text = extractReadableMarkdownText(this.blocks, this.textValue);
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
