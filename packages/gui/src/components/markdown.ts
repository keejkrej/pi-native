/**
 * Native CommonMark-subset Markdown parser and renderer with inline styles, code blocks, quotes, lists, and rules.
 */

import type { TextStyle } from "../backend.ts";
import { type Color, withAlpha } from "../colors.ts";
import {
	type Edges,
	GuiComponent,
	type GuiRenderContext,
	normalizeEdges,
	type PaddingInput,
	type Size,
} from "../component.ts";
import {
	type GuiA11yNode,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
} from "../protocol.ts";

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

	const pushLine = (): void => {
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

		const padX = span.kind === "code" ? 6 : 0;
		const tokens = splitTokens(span.text);
		for (let t = 0; t < tokens.length; t++) {
			const token = tokens[t];
			if (token === undefined || token.length === 0) continue;
			const isSpace = /^\s+$/.test(token);
			if (isSpace && cursorX === 0) {
				continue;
			}
			const w = ctx.measureText(style, 0, token).width + (isSpace ? 0 : padX);
			if (cursorX > 0 && cursorX + w > widthBudget && !isSpace) {
				pushLine();
			}
			currentSegs.push({
				kind: span.kind,
				text: token,
				xOffset: cursorX,
				width: w,
				style,
			});
			cursorX += w;
		}
	}

	if (currentSegs.length > 0 || lines.length === 0) {
		lines.push({ segments: currentSegs, lineHeight: rowHeight });
	}
	return lines;
}

interface LayoutBlockCacheEntry {
	readonly block: MarkdownBlock;
	readonly y: number;
	readonly height: number;
	readonly lines?: readonly WrappedSpanLine[];
	readonly codeTextHeight?: number;
}

export class Markdown extends GuiComponent {
	private textValue: string;
	private blocks: MarkdownBlock[];
	private padding: Edges;
	private fontSize: number | undefined;
	private paragraphGap: number;
	private textColor: Color | undefined;
	private cachedWidth: number;
	private cachedFontSize: number;
	private cachedLayout: LayoutBlockCacheEntry[];
	private cachedTotalHeight: number;

	constructor(textOrOptions: string | MarkdownOptions = "") {
		super();
		const opts: MarkdownOptions = typeof textOrOptions === "string" ? { text: textOrOptions } : textOrOptions;
		this.textValue = opts.text ?? "";
		this.blocks = parseMarkdownBlocks(this.textValue);
		this.padding = normalizeEdges(opts.padding ?? 0);
		this.fontSize = opts.fontSize;
		this.paragraphGap = opts.paragraphGap ?? 10;
		this.textColor = opts.textColor;
		this.cachedWidth = -1;
		this.cachedFontSize = -1;
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
		this.invalidate();
	}

	setMarkdown(text: string): void {
		this.setText(text);
	}

	private computeLayoutCache(ctx: GuiRenderContext, innerWidth: number): void {
		const baseSize = this.fontSize ?? ctx.theme.fontSizeBody;
		if (Math.abs(this.cachedWidth - innerWidth) <= 0.5 && this.cachedFontSize === baseSize) {
			return;
		}
		this.cachedWidth = innerWidth;
		this.cachedFontSize = baseSize;
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
						fontSize: ctx.theme.fontSizeCode,
						fontWeight: 400,
					};
					const headerH = block.language.length > 0 ? 24 : 0;
					const codeMaxW = Math.max(40, innerWidth - 24);
					const codeMetrics = ctx.measureText(codeStyle, codeMaxW, block.code.length > 0 ? block.code : " ");
					const totalH = headerH + codeMetrics.height + 20;
					entries.push({ block, y, height: totalH, codeTextHeight: codeMetrics.height });
					y += totalH + gapAfter;
					break;
				}
			}
		}

		this.cachedLayout = entries;
		this.cachedTotalHeight = y;
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
	): void {
		let y = startY;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined) continue;
			for (let j = 0; j < line.segments.length; j++) {
				const seg = line.segments[j];
				if (seg === undefined) continue;
				const sx = startX + seg.xOffset;
				let color = defaultColor;
				if (seg.kind === "code") {
					ctx.fillRect(sx, y + 1, seg.width, line.lineHeight - 2, ctx.theme.codeBackground, 4);
					ctx.drawStyledText(sx + 3, y, 0, ctx.theme.codeText, seg.style, seg.text);
					continue;
				}
				if (seg.kind === "link") {
					color = ctx.theme.link;
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
				case "heading":
				case "paragraph": {
					if (entry.lines !== undefined) {
						this.renderInlineLines(ctx, entry.lines, originX, by, defaultColor);
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
						this.renderInlineLines(ctx, entry.lines, originX + 14, by + 4, ctx.theme.textMuted);
					}
					break;
				}
				case "listItem": {
					const bodySize = this.fontSize ?? ctx.theme.fontSizeBody;
					const markerStyle: TextStyle = { fontFamily: SGUI_FONT_REGULAR, fontSize: bodySize, fontWeight: 600 };
					const markerText = block.ordered ? block.marker : "\u2022";
					ctx.drawStyledText(originX + 4, by, 0, ctx.theme.accent, markerStyle, markerText);
					if (entry.lines !== undefined) {
						this.renderInlineLines(ctx, entry.lines, originX + 22, by, defaultColor);
					}
					break;
				}
				case "code": {
					ctx.fillRect(originX, by, innerW, entry.height, ctx.theme.codeBackground, ctx.theme.radiusMedium);
					ctx.strokeRect(originX, by, innerW, entry.height, ctx.theme.border, 1, ctx.theme.radiusMedium);
					let codeTop = by + 10;
					if (block.language.length > 0) {
						const langStyle: TextStyle = {
							fontFamily: SGUI_FONT_MONO,
							fontSize: ctx.theme.fontSizeSmall,
							fontWeight: 600,
						};
						ctx.drawStyledText(originX + 12, by + 6, innerW - 24, ctx.theme.textMuted, langStyle, block.language);
						ctx.drawLine(originX, by + 24, originX + innerW, by + 24, ctx.theme.border, 1);
						codeTop = by + 32;
					}
					const codeStyle: TextStyle = {
						fontFamily: SGUI_FONT_MONO,
						fontSize: ctx.theme.fontSizeCode,
						fontWeight: 400,
					};
					if (block.code.length > 0) {
						ctx.drawStyledText(
							originX + 12,
							codeTop,
							Math.max(40, innerW - 24),
							ctx.theme.codeText,
							codeStyle,
							block.code,
						);
					}
					break;
				}
			}
		}
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
