import {
	type A11yActionKind,
	Badge,
	Box,
	Button,
	type Color,
	type CornerRadii,
	drawFocusHalo,
	type Edges,
	type GuiA11yNode,
	GuiComponent,
	type GuiHost,
	type GuiKeyEvent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiTheme,
	HStack,
	Image,
	Markdown,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_A11Y_STATE_FOCUSED,
	SGUI_CURSOR_POINTER,
	SGUI_FONT_MONO,
	SGUI_FONT_REGULAR,
	type Size,
	Spacer,
	Text,
	type TextStyle,
	TruncatedText,
	VectorIcon,
	type VectorIconName,
	VStack,
	withAlpha,
} from "@pi-ts/gui";
import type {
	GuiAttachmentItem,
	GuiChangedFile,
	GuiDiffLine,
	GuiExtensionWidgetEntry,
	GuiSessionStatus,
	GuiTranscriptEntry,
} from "./types.ts";

/** Base themed card interface preserved across GUI modes. */
export interface ThemedCard {
	readonly root: Box;
	applyTheme(theme: GuiTheme): void;
}

/** Welcome banner card handle preserved for gui-mode.ts compatibility. */
export interface WelcomeCardHandle extends ThemedCard {
	update(status: GuiSessionStatus): void;
}

/** User message card handle with optional search highlighting support. */
export interface UserMessageCardHandle extends ThemedCard {
	setSearchQuery(query: string, activeMatchIndex?: number): void;
	countSearchMatches(query: string): number;
	getText(): string;
}

/** Assistant message card handle preserved for gui-mode.ts compatibility. */
export interface AssistantCardHandle extends ThemedCard {
	update(state: {
		text?: string;
		thinking?: string;
		ended?: boolean;
		stopReason?: string;
		errorMessage?: string;
	}): void;
	isEmpty(): boolean;
	setSearchQuery(query: string, activeMatchIndex?: number): void;
	countSearchMatches(query: string): number;
}

/** Tool execution card handle preserved for gui-mode.ts compatibility. */
export interface ToolCardHandle extends ThemedCard {
	update(state: {
		argsText?: string;
		outputText?: string;
		ended?: boolean;
		isError?: boolean;
		durationMs?: number;
		diffLines?: readonly GuiDiffLine[];
	}): void;
	setExpanded(expanded: boolean): void;
	isExpanded(): boolean;
}

/** Options for rendering a Waku user message bubble. */
export interface UserMessageCardOptions {
	readonly attachments?: readonly GuiAttachmentItem[];
	readonly onCopy?: (text: string) => void;
	readonly onFork?: (text: string) => void;
	readonly maxBubbleWidth?: number;
}

/** Options for rendering a standalone assistant message card. */
export interface AssistantMessageCardOptions {
	readonly onCopyCode?: (code: string, language?: string) => void;
	readonly initiallyThinkingExpanded?: boolean;
}

/** Options for rendering a tool execution row/card. */
export interface ToolExecutionCardOptions {
	readonly initiallyExpanded?: boolean;
	readonly diffLines?: readonly GuiDiffLine[];
	readonly onOpenFile?: (filePath: string) => void;
	readonly onViewDiff?: (toolName: string, filePath?: string) => void;
}

/** State snapshot for updating an entire Waku turn cluster card. */
export interface TurnClusterState {
	readonly thinking?: string;
	readonly text?: string;
	readonly ended?: boolean;
	readonly stopReason?: string;
	readonly errorMessage?: string;
	readonly durationMs?: number;
	readonly changedFiles?: readonly GuiChangedFile[];
}

/** Options for creating a Waku collapsible turn cluster card. */
export interface TurnClusterCardOptions {
	readonly onCopyCode?: (code: string, language?: string) => void;
	readonly onOpenFile?: (filePath: string) => void;
	readonly onViewDiff?: (toolName: string, filePath?: string) => void;
	readonly onOpenChangedFile?: (filePath: string) => void;
}

/** Interactive handle for a Waku collapsible turn cluster. */
export interface TurnClusterCardHandle extends ThemedCard {
	updateTurn(state: TurnClusterState): void;
	upsertTool(
		toolCallId: string,
		state: {
			toolName: string;
			argsText?: string;
			outputText?: string;
			ended?: boolean;
			isError?: boolean;
			durationMs?: number;
			diffLines?: readonly GuiDiffLine[];
		},
	): ToolCardHandle;
	setExpanded(expanded: boolean): void;
	isExpanded(): boolean;
	setSearchQuery(query: string, targetBlock: "thinking" | "text" | "none", activeMatchIndex?: number): void;
	countThinkingMatches(query: string): number;
	countAnswerMatches(query: string): number;
	isEmpty(): boolean;
}

/** Options for bottom-of-turn changed files pill row. */
export interface ChangedFilesCardOptions {
	readonly onOpenFileChanges?: (filePath: string) => void;
}

/** Handle for bottom-of-turn changed files summary card. */
export interface ChangedFilesCardHandle extends ThemedCard {
	setFiles(files: readonly GuiChangedFile[]): void;
}

/** Options for standalone bash execution cards. */
export interface BashCardOptions {
	readonly initiallyExpanded?: boolean;
}

/** Handle for updating a standalone bash execution card. */
export interface BashCardHandle extends ThemedCard {
	update(state: {
		command?: string;
		outputText?: string;
		exitCode?: number;
		isError?: boolean;
		durationMs?: number;
		ended?: boolean;
	}): void;
	setExpanded(expanded: boolean): void;
	isExpanded(): boolean;
}

/** Handle for compaction and branch summary collapsible cards. */
export interface SummaryTranscriptCardHandle extends ThemedCard {
	setSearchQuery(query: string, activeMatchIndex?: number): void;
	countSearchMatches(query: string): number;
	setExpanded(expanded: boolean): void;
}

/** Handle for inline / above-editor / below-editor extension widgets. */
export interface ExtensionWidgetCardHandle extends ThemedCard {
	update(widget: GuiExtensionWidgetEntry): void;
}

/** Options for constructing ClickableContainer. */
export interface ClickableContainerOptions {
	readonly child: GuiComponent;
	readonly label: string;
	readonly background?: Color;
	readonly hoverBackground?: Color;
	readonly activeBackground?: Color;
	readonly borderColor?: Color;
	readonly hoverBorderColor?: Color;
	readonly borderWidth?: number;
	readonly radius?: number;
	readonly cornerRadii?: CornerRadii;
	readonly padding?: PaddingInput;
	readonly fillWidth?: boolean;
	readonly focusable?: boolean;
	readonly onClick?: () => void;
}

/** Concrete interactive container supporting pointer hover, press, keyboard activation, and button accessibility. */
export class ClickableContainer extends GuiComponent {
	private child: GuiComponent;
	private labelText: string;
	private background: Color | undefined;
	private hoverBackground: Color | undefined;
	private activeBackground: Color | undefined;
	private borderColor: Color | undefined;
	private hoverBorderColor: Color | undefined;
	private borderWidth: number;
	private radius: number;
	private cornerRadii: CornerRadii | undefined;
	private padding: Edges;
	private fillWidthValue: boolean;
	private hovered = false;
	private pressed = false;
	private onClickFn: (() => void) | undefined;

	constructor(options: ClickableContainerOptions) {
		super();
		this.child = options.child;
		this.child.setParent(this);
		this.labelText = options.label;
		this.background = options.background;
		this.hoverBackground = options.hoverBackground;
		this.activeBackground = options.activeBackground;
		this.borderColor = options.borderColor;
		this.hoverBorderColor = options.hoverBorderColor;
		this.borderWidth = options.borderWidth ?? 1;
		this.radius = options.radius ?? 8;
		this.cornerRadii = options.cornerRadii;
		this.padding = normalizeEdges(options.padding);
		this.fillWidthValue = options.fillWidth ?? false;
		this.focusable = options.focusable ?? true;
		this.cursor = SGUI_CURSOR_POINTER;
		this.onClickFn = options.onClick;
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.child.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		this.child.onThemeChange(theme);
	}

	setLabel(label: string): void {
		if (this.labelText === label) return;
		this.labelText = label;
		this.invalidate();
	}

	setBackground(color: Color | undefined): void {
		this.background = color;
		this.invalidate();
	}

	setHoverBackground(color: Color | undefined): void {
		this.hoverBackground = color;
		this.invalidate();
	}

	setActiveBackground(color: Color | undefined): void {
		this.activeBackground = color;
		this.invalidate();
	}

	setBorderColor(color: Color | undefined): void {
		this.borderColor = color;
		this.invalidate();
	}

	setHoverBorderColor(color: Color | undefined): void {
		this.hoverBorderColor = color;
		this.invalidate();
	}

	setOnClick(onClick: (() => void) | undefined): void {
		this.onClickFn = onClick;
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const innerMaxW = Math.max(0, maxWidth - this.padding.left - this.padding.right);
		const innerMaxH =
			maxHeight !== undefined ? Math.max(0, maxHeight - this.padding.top - this.padding.bottom) : undefined;
		const measured = this.child.visible ? this.child.measure(ctx, innerMaxW, innerMaxH) : { width: 0, height: 0 };
		const totalW = this.fillWidthValue
			? maxWidth
			: Math.min(maxWidth, measured.width + this.padding.left + this.padding.right);
		const totalH = measured.height + this.padding.top + this.padding.bottom;
		return {
			width: Math.max(0, totalW),
			height: Math.max(0, maxHeight !== undefined ? Math.min(maxHeight, totalH) : totalH),
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const innerRect: Rect = {
			x: rect.x + this.padding.left,
			y: rect.y + this.padding.top,
			width: Math.max(0, rect.width - this.padding.left - this.padding.right),
			height: Math.max(0, rect.height - this.padding.top - this.padding.bottom),
		};
		this.child.layout(ctx, innerRect);
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;

		const bg = this.pressed
			? (this.activeBackground ?? this.hoverBackground ?? this.background)
			: this.hovered
				? (this.hoverBackground ?? this.background)
				: this.background;
		if (bg !== undefined) {
			if (this.cornerRadii !== undefined) {
				ctx.fillRectCorners(
					r.x,
					r.y,
					r.width,
					r.height,
					this.cornerRadii.tl,
					this.cornerRadii.tr,
					this.cornerRadii.br,
					this.cornerRadii.bl,
					bg,
				);
			} else {
				ctx.fillRect(r.x, r.y, r.width, r.height, bg, this.radius);
			}
		}

		const border = this.hovered && this.hoverBorderColor !== undefined ? this.hoverBorderColor : this.borderColor;
		if (border !== undefined && this.borderWidth > 0) {
			if (this.cornerRadii !== undefined) {
				ctx.strokeRectCorners(
					r.x,
					r.y,
					r.width,
					r.height,
					this.cornerRadii.tl,
					this.cornerRadii.tr,
					this.cornerRadii.br,
					this.cornerRadii.bl,
					border,
					this.borderWidth,
				);
			} else {
				ctx.strokeRect(r.x, r.y, r.width, r.height, border, this.borderWidth, this.radius);
			}
		}

		if (this.child.visible) {
			this.child.render(ctx);
		}

		if (this.focusable && this.isFocused()) {
			drawFocusHalo(ctx, r, this.radius);
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) {
			return undefined;
		}
		return this;
	}

	override onHoverChange(hovered: boolean): void {
		if (this.hovered !== hovered) {
			this.hovered = hovered;
			this.invalidate();
		}
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (!this.visible) return { handled: false };
		const inside = pointInRect(event.x, event.y, this.layoutRect);
		if (event.phase === "move" || event.phase === "enter") {
			this.hovered = inside;
			return { handled: false, cursor: inside ? SGUI_CURSOR_POINTER : undefined };
		}
		if (event.phase === "leave") {
			this.hovered = false;
			return { handled: false };
		}
		if (event.phase === "down" && event.button === "left" && inside) {
			this.pressed = true;
			this.invalidate();
			return { handled: true, capture: this, focus: this.focusable ? this : undefined, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "drag" && this.pressed) {
			this.hovered = inside;
			return { handled: true, capture: this, cursor: SGUI_CURSOR_POINTER };
		}
		if (event.phase === "up" && event.button === "left" && this.pressed) {
			this.pressed = false;
			this.hovered = inside;
			this.invalidate();
			if (inside && this.onClickFn !== undefined) {
				this.onClickFn();
			}
			return { handled: true, releaseCapture: true, cursor: inside ? SGUI_CURSOR_POINTER : undefined };
		}
		return { handled: false };
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (!this.visible || !this.focusable) return false;
		if (event.phase !== "down") return false;
		if (ctx.keybindings.matches(event, "activate")) {
			if (this.onClickFn !== undefined) {
				this.onClickFn();
			}
			return true;
		}
		return false;
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		let stateFlags = SGUI_A11Y_STATE_ENABLED;
		if (this.focusable && this.isFocused()) {
			stateFlags |= SGUI_A11Y_STATE_FOCUSED;
		}
		out.push({
			id: this.a11yId,
			role: "button",
			stateFlags,
			rect: this.layoutRect,
			label: this.labelText,
			value: "",
		});
		if (this.child.visible) {
			this.child.collectAccessibilityNodes(out, ctx);
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (this.a11yId === nodeId) return this;
		return this.child.findComponentByA11yId(nodeId);
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		_ctx: GuiRenderContext,
	): boolean {
		if (nodeId === this.a11yId && action === "press") {
			if (this.onClickFn !== undefined) {
				this.onClickFn();
			}
			return true;
		}
		return false;
	}
}

/** Count non-overlapping case-insensitive substring occurrences. */
export function countSubstringMatches(haystack: string, query: string): number {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0 || haystack.length === 0) return 0;
	const lower = haystack.toLowerCase();
	let count = 0;
	let pos = 0;
	while (pos <= lower.length - needle.length) {
		const idx = lower.indexOf(needle, pos);
		if (idx < 0) break;
		count += 1;
		pos = idx + needle.length;
	}
	return count;
}

/** Wrapping text component with Waku search-highlight support for user messages. */
export class SearchableText extends GuiComponent {
	private textValue: string;
	private color: Color | undefined;
	private fontSize: number | undefined;
	private searchQuery = "";
	private activeMatchIndex: number | undefined;
	private cachedWidth = -1;
	private cachedLines: string[] = [];

	constructor(options: { readonly text: string; readonly color?: Color; readonly fontSize?: number }) {
		super();
		this.textValue = options.text;
		this.color = options.color;
		this.fontSize = options.fontSize;
	}

	getText(): string {
		return this.textValue;
	}

	setText(text: string): void {
		if (this.textValue === text) return;
		this.textValue = text;
		this.cachedWidth = -1;
		this.invalidate();
	}

	setColor(color: Color | undefined): void {
		this.color = color;
		this.invalidate();
	}

	setSearchQuery(query: string, activeMatchIndex?: number): void {
		this.searchQuery = query;
		this.activeMatchIndex = activeMatchIndex;
		this.invalidate();
	}

	countMatches(query: string): number {
		return countSubstringMatches(this.textValue, query);
	}

	private buildStyle(ctx: GuiRenderContext): TextStyle {
		return {
			fontFamily: SGUI_FONT_REGULAR,
			fontSize: this.fontSize ?? ctx.theme.fontSizeBody,
			fontWeight: 400,
		};
	}

	private wrapParagraph(ctx: GuiRenderContext, style: TextStyle, paragraph: string, maxWidth: number): string[] {
		if (paragraph.length === 0) return [""];
		if (maxWidth <= 0) return [paragraph];
		if (ctx.getTextCaretX(style, paragraph, paragraph.length) <= maxWidth) {
			return [paragraph];
		}
		const lines: string[] = [];
		const words = paragraph.split(/(\s+)/);
		let current = "";
		for (let i = 0; i < words.length; i++) {
			const token = words[i];
			if (token === undefined || token.length === 0) continue;
			const candidate = current + token;
			if (current.length > 0 && ctx.getTextCaretX(style, candidate, candidate.length) > maxWidth) {
				lines.push(current.trimEnd());
				current = token.trimStart();
				while (current.length > 0 && ctx.getTextCaretX(style, current, current.length) > maxWidth) {
					let split = 1;
					while (split < current.length && ctx.getTextCaretX(style, current, split + 1) <= maxWidth) {
						split += 1;
					}
					lines.push(current.slice(0, split));
					current = current.slice(split);
				}
			} else {
				current = candidate;
			}
		}
		if (current.length > 0) {
			lines.push(current);
		}
		return lines.length > 0 ? lines : [""];
	}

	private computeLines(ctx: GuiRenderContext, width: number): { readonly lines: readonly string[]; readonly lineHeight: number } {
		const style = this.buildStyle(ctx);
		const metrics = ctx.measureText(style, 0, "Mg");
		const effectiveW = Math.max(40, width);
		if (this.cachedWidth !== effectiveW) {
			const rawLines = this.textValue.split(/\r?\n/);
			const wrapped: string[] = [];
			for (let i = 0; i < rawLines.length; i++) {
				const raw = rawLines[i] ?? "";
				const pieces = this.wrapParagraph(ctx, style, raw, effectiveW);
				for (let j = 0; j < pieces.length; j++) {
					const piece = pieces[j];
					if (piece !== undefined) wrapped.push(piece);
				}
			}
			this.cachedLines = wrapped;
			this.cachedWidth = effectiveW;
		}
		return { lines: this.cachedLines, lineHeight: metrics.lineHeight };
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const style = this.buildStyle(ctx);
		const { lines, lineHeight } = this.computeLines(ctx, maxWidth);
		let maxLineW = 0;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const w = line.length > 0 ? ctx.getTextCaretX(style, line, line.length) : 0;
			if (w > maxLineW) maxLineW = w;
		}
		return {
			width: Math.min(maxWidth, Math.max(16, Math.ceil(maxLineW))),
			height: Math.max(lineHeight, lines.length * lineHeight),
		};
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 0) return;
		const style = this.buildStyle(ctx);
		const { lines, lineHeight } = this.computeLines(ctx, r.width);
		const queryLower = this.searchQuery.trim().toLowerCase();
		const textColor = this.color ?? ctx.theme.text;
		let matchIdx = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const ly = r.y + i * lineHeight;
			if (queryLower.length > 0 && line.length > 0) {
				const lineLower = line.toLowerCase();
				let pos = 0;
				while (pos <= lineLower.length - queryLower.length) {
					const found = lineLower.indexOf(queryLower, pos);
					if (found < 0) break;
					const x1 = r.x + ctx.getTextCaretX(style, line, found);
					const x2 = r.x + ctx.getTextCaretX(style, line, found + queryLower.length);
					const isActive = this.activeMatchIndex === matchIdx;
					ctx.fillRect(
						x1,
						ly,
						Math.max(2, x2 - x1),
						lineHeight,
						isActive ? ctx.theme.activeSearchMatchBg : ctx.theme.searchMatchBg,
						3,
					);
					matchIdx += 1;
					pos = found + queryLower.length;
				}
			}
			if (line.length > 0) {
				ctx.drawStyledText(r.x, ly, r.width, textColor, style, line);
			}
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		if (this.textValue.trim().length === 0) return;
		out.push({
			id: this.a11yId,
			role: "staticText",
			stateFlags: SGUI_A11Y_STATE_ENABLED,
			rect: this.layoutRect,
			label: this.textValue,
			value: this.textValue,
		});
	}
}

/** Right-aligns a bubble component up to a capped width inside a transcript column. */
class RightAlignedBubbleSlot extends GuiComponent {
	private readonly child: GuiComponent;
	private readonly maxBubbleWidth: number;
	private onHoverChangeFn: ((hovered: boolean) => void) | undefined;

	constructor(child: GuiComponent, maxBubbleWidth = 600, onHoverChange?: (hovered: boolean) => void) {
		super();
		this.child = child;
		this.child.setParent(this);
		this.maxBubbleWidth = maxBubbleWidth;
		this.onHoverChangeFn = onHoverChange;
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.child.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		this.child.onThemeChange(theme);
	}

	override onHoverChange(hovered: boolean): void {
		if (this.onHoverChangeFn !== undefined) {
			this.onHoverChangeFn(hovered);
		}
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const bubbleCap = Math.min(maxWidth, this.maxBubbleWidth);
		const measured = this.child.measure(ctx, bubbleCap, maxHeight);
		return {
			width: maxWidth,
			height: measured.height,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const bubbleCap = Math.min(rect.width, this.maxBubbleWidth);
		const measured = this.child.measure(ctx, bubbleCap, rect.height);
		const bubbleW = Math.min(bubbleCap, Math.max(100, measured.width));
		const bubbleH = Math.min(rect.height, measured.height);
		const x = rect.x + Math.max(0, rect.width - bubbleW);
		this.child.layout(ctx, { x, y: rect.y, width: bubbleW, height: bubbleH });
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.child.render(ctx);
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		const hit = this.child.hitTest(x, y);
		return hit ?? this;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.child.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.child.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return this.child.findComponentByA11yId(nodeId);
	}
}

/** Draws a thin 2px vertical thread rail beside an indented content component. */
class ThreadRailContainer extends GuiComponent {
	private readonly child: GuiComponent;
	private railColor: Color;

	constructor(child: GuiComponent, railColor: Color) {
		super();
		this.child = child;
		this.child.setParent(this);
		this.railColor = railColor;
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.child.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		this.child.onThemeChange(theme);
	}

	setRailColor(color: Color): void {
		this.railColor = color;
		this.invalidate();
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const inset = 14;
		const childSize = this.child.measure(ctx, Math.max(40, maxWidth - inset), maxHeight);
		return {
			width: maxWidth,
			height: childSize.height,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const inset = 14;
		this.child.layout(ctx, {
			x: rect.x + inset,
			y: rect.y,
			width: Math.max(0, rect.width - inset),
			height: rect.height,
		});
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.height > 4) {
			ctx.fillRect(r.x + 5, r.y + 2, 2, r.height - 4, this.railColor, 1);
		}
		this.child.render(ctx);
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		return this.child.hitTest(x, y);
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		this.child.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.child.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return this.child.findComponentByA11yId(nodeId);
	}
}

/** Flow-wrapping horizontal pill row for attachment chips and modified-file pills. */
export class WrappingPillRow extends GuiComponent {
	private children: GuiComponent[] = [];
	private readonly gapX: number;
	private readonly gapY: number;

	constructor(children: readonly GuiComponent[] = [], gapX = 6, gapY = 6) {
		super();
		this.gapX = gapX;
		this.gapY = gapY;
		this.setChildren(children);
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		for (let i = 0; i < this.children.length; i++) {
			this.children[i]?.attachHost(host);
		}
	}

	override onThemeChange(theme: GuiTheme): void {
		for (let i = 0; i < this.children.length; i++) {
			this.children[i]?.onThemeChange(theme);
		}
	}

	setChildren(next: readonly GuiComponent[]): void {
		for (let i = 0; i < this.children.length; i++) {
			const oldChild = this.children[i];
			if (oldChild !== undefined) {
				oldChild.setParent(undefined);
				oldChild.attachHost(undefined);
			}
		}
		this.children = [];
		for (let i = 0; i < next.length; i++) {
			const c = next[i];
			if (c === undefined) continue;
			c.setParent(this);
			c.attachHost(this.host);
			this.children.push(c);
		}
		this.invalidate();
	}

	private computePlacements(
		ctx: GuiRenderContext,
		maxWidth: number,
	): { readonly totalHeight: number; readonly placements: readonly { child: GuiComponent; rect: Rect }[] } {
		const placements: { child: GuiComponent; rect: Rect }[] = [];
		let cursorX = 0;
		let cursorY = 0;
		let rowH = 0;
		for (let i = 0; i < this.children.length; i++) {
			const child = this.children[i];
			if (child === undefined || !child.visible) continue;
			const measured = child.measure(ctx, maxWidth, undefined);
			if (cursorX > 0 && cursorX + measured.width > maxWidth) {
				cursorX = 0;
				cursorY += rowH + this.gapY;
				rowH = 0;
			}
			placements.push({
				child,
				rect: { x: cursorX, y: cursorY, width: Math.min(maxWidth, measured.width), height: measured.height },
			});
			cursorX += measured.width + this.gapX;
			if (measured.height > rowH) rowH = measured.height;
		}
		return {
			totalHeight: placements.length > 0 ? cursorY + rowH : 0,
			placements,
		};
	}

	measure(ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
		const { totalHeight, placements } = this.computePlacements(ctx, maxWidth);
		let maxRight = 0;
		for (let i = 0; i < placements.length; i++) {
			const p = placements[i];
			if (p === undefined) continue;
			const right = p.rect.x + p.rect.width;
			if (right > maxRight) maxRight = right;
		}
		return {
			width: Math.min(maxWidth, maxRight),
			height: totalHeight,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const { placements } = this.computePlacements(ctx, rect.width);
		for (let i = 0; i < placements.length; i++) {
			const p = placements[i];
			if (p === undefined) continue;
			p.child.layout(ctx, {
				x: rect.x + p.rect.x,
				y: rect.y + p.rect.y,
				width: p.rect.width,
				height: p.rect.height,
			});
		}
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		for (let i = 0; i < this.children.length; i++) {
			const child = this.children[i];
			if (child !== undefined && child.visible) {
				child.render(ctx);
			}
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		for (let i = this.children.length - 1; i >= 0; i--) {
			const hit = this.children[i]?.hitTest(x, y);
			if (hit !== undefined) return hit;
		}
		return undefined;
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		for (let i = 0; i < this.children.length; i++) {
			this.children[i]?.collectFocusables(out);
		}
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		for (let i = 0; i < this.children.length; i++) {
			this.children[i]?.collectAccessibilityNodes(out, ctx);
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		for (let i = 0; i < this.children.length; i++) {
			const found = this.children[i]?.findComponentByA11yId(nodeId);
			if (found !== undefined) return found;
		}
		return undefined;
	}
}

/** Format duration in milliseconds cleanly as ms or 1-decimal seconds. */
export function formatDurationMs(durationMs: number): string {
	if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
	if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
	return `${(durationMs / 1000).toFixed(1)}s`;
}

/** Extract a target file path from compact tool args text (e.g. `path: "src/app.ts"`). */
export function parseToolFilePath(argsText: string): string | undefined {
	const quotedMatch = /(?:^|,|\s)(?:path|file|filePath)\s*:\s*"([^"]+)"/.exec(argsText);
	if (quotedMatch !== null && quotedMatch[1] !== undefined && quotedMatch[1].length > 0) {
		return quotedMatch[1];
	}
	const bareMatch = /(?:^|,|\s)(?:path|file|filePath)\s*:\s*([^\s,]+)/.exec(argsText);
	if (bareMatch !== null && bareMatch[1] !== undefined && bareMatch[1].length > 0) {
		return bareMatch[1];
	}
	return undefined;
}

/** Parse raw unified diff lines into structured diff entries for tool output inspection. */
export function parseUnifiedDiffLines(outputText: string): readonly GuiDiffLine[] {
	const rawLines = outputText.split(/\r?\n/);
	const parsed: GuiDiffLine[] = [];
	let sawHunk = false;
	for (let i = 0; i < rawLines.length; i++) {
		const line = rawLines[i] ?? "";
		if (line.startsWith("@@")) {
			sawHunk = true;
			parsed.push({ kind: "hunk", text: line });
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			parsed.push({ kind: "add", text: line });
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			parsed.push({ kind: "del", text: line });
		} else if (sawHunk) {
			parsed.push({ kind: "context", text: line });
		}
	}
	return sawHunk ? parsed : [];
}

function toolIconForName(toolName: string): VectorIconName {
	const lower = toolName.toLowerCase();
	switch (lower) {
		case "read":
			return "file-code";
		case "edit":
			return "edit";
		case "write":
			return "file-diff";
		case "bash":
		case "shell":
			return "terminal";
		case "grep":
			return "search";
		case "find":
			return "compass";
		case "ls":
			return "folder";
		default:
			return "sliders";
	}
}

function formatByteSize(bytes: number | undefined): string {
	if (bytes === undefined || bytes <= 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateLines(text: string, maxLines = 36, maxChars = 2400): string {
	const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n... (truncated)` : text;
	const lines = clipped.split(/\r?\n/);
	if (lines.length <= maxLines) return clipped;
	const head = lines.slice(0, maxLines).join("\n");
	return `${head}\n... (${lines.length - maxLines} more lines)`;
}

function attachmentIcon(kind: GuiAttachmentItem["kind"]): VectorIconName {
	switch (kind) {
		case "image":
			return "file-code";
		case "pasted-text":
			return "list";
		case "file":
		default:
			return "folder";
	}
}

function createAttachmentPill(theme: GuiTheme, item: GuiAttachmentItem): Box {
	const parts: GuiComponent[] = [];
	if (item.kind === "image" && item.previewRgba !== undefined && item.previewWidth && item.previewHeight) {
		parts.push(
			new Image({
				width: item.previewWidth,
				height: item.previewHeight,
				pixels: item.previewRgba,
				displayWidth: 16,
				displayHeight: 16,
				radius: 3,
				fit: "contain",
			}),
		);
	} else {
		parts.push(
			new VectorIcon({
				name: attachmentIcon(item.kind),
				size: 12,
				color: theme.textMuted,
			}),
		);
	}
	const sizeText = formatByteSize(item.sizeBytes);
	const label = sizeText.length > 0 ? `${item.name} · ${sizeText}` : item.name;
	parts.push(
		new TruncatedText({
			text: label,
			fontSize: theme.fontSizeSmall,
			color: theme.textSecondary,
		}),
	);
	return new Box({
		background: theme.surfaceMuted,
		borderColor: theme.border,
		borderWidth: 1,
		radius: 999,
		padding: { horizontal: 8, vertical: 3 },
		child: new HStack({ gap: 5, align: "center", children: parts }),
	});
}

function buildDiffViewComponent(theme: GuiTheme, diffLines: readonly GuiDiffLine[]): VStack {
	const rows: GuiComponent[] = [];
	const limit = Math.min(diffLines.length, 40);
	for (let i = 0; i < limit; i++) {
		const line = diffLines[i];
		if (line === undefined) continue;
		let bg: Color | undefined;
		let fg: Color = theme.textSecondary;
		if (line.kind === "add") {
			bg = theme.diffAddBg;
			fg = theme.diffAddText;
		} else if (line.kind === "del") {
			bg = theme.diffDelBg;
			fg = theme.diffDelText;
		} else if (line.kind === "hunk") {
			bg = withAlpha(theme.accent, theme.dark ? 0.12 : 0.08);
			fg = theme.accent;
		}
		rows.push(
			new Box({
				background: bg,
				padding: { horizontal: 6, vertical: 1 },
				radius: 3,
				fillWidth: true,
				child: new Text({
					text: line.text.length > 0 ? line.text : " ",
					fontFamily: SGUI_FONT_MONO,
					fontSize: theme.fontSizeSmall,
					color: fg,
					wrap: true,
				}),
			}),
		);
	}
	if (diffLines.length > limit) {
		rows.push(
			new Text({
				text: `... (${diffLines.length - limit} more diff lines)`,
				fontSize: theme.fontSizeSmall,
				color: theme.textMuted,
			}),
		);
	}
	return new VStack({ gap: 1, children: rows });
}

/** Welcome banner card preserved for gui-mode.ts compatibility. */
export function createWelcomeCard(initialTheme: GuiTheme, initialStatus: GuiSessionStatus): WelcomeCardHandle {
	let theme = initialTheme;
	const mark = new VectorIcon({ name: "waku-mark", size: 22, color: theme.accent });
	const title = new Text({
		text: "Pi GUI Ready",
		fontSize: theme.fontSizeHeading,
		fontWeight: 600,
		color: theme.textBright,
	});
	const subtitle = new Text({
		text: "Interactive desktop session powered by @pi-ts/gui.",
		fontSize: theme.fontSizeSmall,
		color: theme.textMuted,
	});
	const infoLine = new TruncatedText({
		text: "",
		fontSize: theme.fontSizeSmall,
	});

	const headerRow = new HStack({
		gap: 8,
		align: "center",
		children: [mark, title],
	});
	const body = new VStack({
		gap: 6,
		children: [headerRow, subtitle, infoLine],
	});
	const root = new Box({
		background: theme.surface,
		borderColor: theme.border,
		borderWidth: 1,
		radius: theme.radiusLarge,
		padding: { horizontal: 16, vertical: 12 },
		fillWidth: true,
		child: body,
	});

	const update = (status: GuiSessionStatus) => {
		const modelLabel = status.activeModel
			? `${status.activeModel.provider}/${status.activeModel.id}`
			: "no model configured";
		infoLine.setText(`Workspace: ${status.cwd}  •  Model: ${modelLabel}  •  Thinking: ${status.thinkingLevel}`);
	};

	update(initialStatus);

	return {
		root,
		update,
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			mark.setColor(theme.accent);
			root.setBackground(theme.surface);
			root.setBorder(theme.border, 1);
			title.setColor(theme.textBright);
			subtitle.setColor(theme.textMuted);
		},
	};
}

/** Upgraded Waku right-aligned user bubble with asymmetric corners, attachment pills, and hover Copy/Fork actions. */
export function createUserMessageCard(
	initialTheme: GuiTheme,
	text: string,
	options: UserMessageCardOptions = {},
): UserMessageCardHandle {
	let theme = initialTheme;
	let currentText = text;
	const maxBubbleWidth = options.maxBubbleWidth ?? 600;
	const bubbleRadii: CornerRadii = { tl: 12, tr: 12, br: 4, bl: 12 };

	const messageText = new SearchableText({
		text,
		color: theme.text,
		fontSize: theme.fontSizeBody,
	});

	const bubbleChildren: GuiComponent[] = [];
	if (options.attachments !== undefined && options.attachments.length > 0) {
		const pills: GuiComponent[] = [];
		for (let i = 0; i < options.attachments.length; i++) {
			const att = options.attachments[i];
			if (att !== undefined) pills.push(createAttachmentPill(theme, att));
		}
		if (pills.length > 0) {
			bubbleChildren.push(new WrappingPillRow(pills, 6, 4));
		}
	}
	bubbleChildren.push(messageText);

	const bubbleContent = new VStack({
		gap: 8,
		children: bubbleChildren,
	});

	const bubbleBox = new Box({
		background: theme.surfaceRaised,
		borderColor: withAlpha(theme.border, theme.dark ? 0.9 : 0.75),
		borderWidth: 1,
		cornerRadii: bubbleRadii,
		padding: { horizontal: 14, vertical: 10 },
		child: bubbleContent,
	});

	const actionHostRef: { host: GuiHost | undefined } = { host: undefined };
	const copyBtn = new Button({
		label: "Copy",
		leadingIcon: "copy",
		iconSize: 11,
		variant: "ghost",
		pill: true,
		padding: { horizontal: 7, vertical: 2 },
		fontSize: theme.fontSizeSmall,
		onClick: () => {
			if (actionHostRef.host !== undefined) {
				actionHostRef.host.setClipboardText(currentText);
			}
			copyBtn.setLabel("Copied");
			if (options.onCopy !== undefined) {
				options.onCopy(currentText);
			}
		},
	});
	const forkBtn = new Button({
		label: "Fork from here",
		leadingIcon: "fork",
		iconSize: 11,
		variant: "ghost",
		pill: true,
		padding: { horizontal: 7, vertical: 2 },
		fontSize: theme.fontSizeSmall,
		onClick: () => {
			if (options.onFork !== undefined) {
				options.onFork(currentText);
			}
		},
	});
	forkBtn.visible = options.onFork !== undefined;

	const actionRow = new HStack({
		gap: 4,
		align: "center",
		children: [{ child: new Spacer(), grow: 1 }, copyBtn, forkBtn],
	});

	let isHovered = false;
	const applyActionVisibility = () => {
		const showBorder = isHovered
			? withAlpha(theme.borderStrong, theme.dark ? 0.85 : 0.7)
			: withAlpha(theme.border, theme.dark ? 0.9 : 0.75);
		bubbleBox.setBorder(showBorder, 1);
	};

	const column = new VStack({
		gap: 4,
		children: [bubbleBox, actionRow],
	});

	const slot = new RightAlignedBubbleSlot(column, maxBubbleWidth, (hovered) => {
		isHovered = hovered;
		applyActionVisibility();
	});

	class UserBubbleRoot extends Box {
		override attachHost(host: GuiHost | undefined): void {
			super.attachHost(host);
			actionHostRef.host = host;
		}
	}

	const root = new UserBubbleRoot({
		padding: { top: 6, bottom: 2 },
		fillWidth: true,
		child: slot,
	});

	return {
		root,
		getText(): string {
			return currentText;
		},
		setSearchQuery(query: string, activeMatchIndex?: number) {
			messageText.setSearchQuery(query, activeMatchIndex);
		},
		countSearchMatches(query: string): number {
			return messageText.countMatches(query);
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			bubbleBox.setBackground(theme.surfaceRaised);
			applyActionVisibility();
			messageText.setColor(theme.text);
		},
	};
}

/** Borderless Waku assistant response card preserved for gui-mode.ts compatibility. */
export function createAssistantMessageCard(
	initialTheme: GuiTheme,
	options: AssistantMessageCardOptions = {},
): AssistantCardHandle {
	let theme = initialTheme;
	let currentText = "";
	let currentThinking = "";
	let isEnded = false;
	let stopReason: string | undefined;
	let errorMessage = "";
	let thinkingExpanded = options.initiallyThinkingExpanded ?? false;

	const thinkingChevron = new VectorIcon({
		name: thinkingExpanded ? "chevron-down" : "chevron-right",
		size: 12,
		color: theme.textMuted,
	});
	const thinkingLabel = new Text({
		text: "Thinking...",
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: theme.textMuted,
	});
	const thinkingHeaderBtn = new ClickableContainer({
		label: "Toggle thinking trace",
		padding: { horizontal: 6, vertical: 3 },
		radius: 6,
		background: withAlpha(theme.surfaceMuted, 0.55),
		hoverBackground: theme.surfaceHover,
		child: new HStack({ gap: 5, align: "center", children: [thinkingChevron, thinkingLabel] }),
		onClick: () => {
			thinkingExpanded = !thinkingExpanded;
			refreshThinkingVisibility();
		},
	});
	const thinkingMarkdown = new Markdown({
		text: "",
		syntaxHighlight: true,
	});
	const thinkingDrawer = new ThreadRailContainer(
		thinkingMarkdown,
		withAlpha(theme.borderStrong, theme.dark ? 0.65 : 0.75),
	);
	const thinkingSection = new VStack({
		gap: 4,
		children: [thinkingHeaderBtn, thinkingDrawer],
	});
	thinkingSection.visible = false;

	const answerMarkdown = new Markdown({
		text: "",
		syntaxHighlight: true,
		onCopyCode: options.onCopyCode,
	});
	answerMarkdown.visible = false;

	const calloutIcon = new VectorIcon({ name: "alert", size: 14, color: theme.danger });
	const calloutTitle = new Badge({ label: "Error", variant: "danger" });
	const calloutText = new Text({
		text: "",
		fontSize: theme.fontSizeSmall,
		color: theme.danger,
	});
	const calloutBox = new Box({
		background: withAlpha(theme.danger, theme.dark ? 0.14 : 0.08),
		borderColor: withAlpha(theme.danger, theme.dark ? 0.45 : 0.35),
		borderWidth: 1,
		radius: theme.radiusMedium,
		padding: { horizontal: 10, vertical: 8 },
		fillWidth: true,
		child: new VStack({
			gap: 4,
			children: [new HStack({ gap: 6, align: "center", children: [calloutIcon, calloutTitle] }), calloutText],
		}),
	});
	calloutBox.visible = false;

	const stack = new VStack({
		gap: 8,
		children: [thinkingSection, answerMarkdown, calloutBox],
	});

	const root = new Box({
		padding: { vertical: 4 },
		fillWidth: true,
		child: stack,
	});

	const refreshThinkingVisibility = () => {
		const hasThinking = currentThinking.trim().length > 0;
		thinkingSection.visible = hasThinking;
		thinkingChevron.setName(thinkingExpanded ? "chevron-down" : "chevron-right");
		thinkingLabel.setText(isEnded ? "Thought trace" : "Thinking...");
		thinkingDrawer.visible = hasThinking && (thinkingExpanded || (!isEnded && currentText.trim().length === 0));
		root.invalidate();
	};

	const refresh = () => {
		refreshThinkingVisibility();
		thinkingMarkdown.setText(currentThinking);

		const hasAnswer = currentText.trim().length > 0;
		answerMarkdown.visible = hasAnswer;
		answerMarkdown.setText(currentText);

		if (isEnded && stopReason === "aborted") {
			calloutBox.visible = true;
			calloutIcon.setColor(theme.warning);
			calloutTitle.setLabel("Stopped");
			calloutTitle.setVariant("warning");
			calloutText.setText(errorMessage.length > 0 ? errorMessage : "Generation stopped.");
			calloutText.setColor(theme.textSecondary);
			calloutBox.setBackground(withAlpha(theme.warning, theme.dark ? 0.14 : 0.08));
			calloutBox.setBorder(withAlpha(theme.warning, theme.dark ? 0.4 : 0.3), 1);
		} else if (stopReason === "error" || (isEnded && errorMessage.trim().length > 0)) {
			calloutBox.visible = true;
			calloutIcon.setColor(theme.danger);
			calloutTitle.setLabel("Error");
			calloutTitle.setVariant("danger");
			calloutText.setText(errorMessage.trim().length > 0 ? errorMessage : "Upstream request failed.");
			calloutText.setColor(theme.danger);
			calloutBox.setBackground(withAlpha(theme.danger, theme.dark ? 0.14 : 0.08));
			calloutBox.setBorder(withAlpha(theme.danger, theme.dark ? 0.45 : 0.35), 1);
		} else {
			calloutBox.visible = false;
		}
		root.invalidate();
	};

	return {
		root,
		update(state) {
			if (state.text !== undefined) currentText = state.text;
			if (state.thinking !== undefined) currentThinking = state.thinking;
			if (state.ended !== undefined) isEnded = state.ended;
			if (state.stopReason !== undefined) stopReason = state.stopReason;
			if (state.errorMessage !== undefined) errorMessage = state.errorMessage;
			refresh();
		},
		isEmpty() {
			return (
				currentText.trim().length === 0 &&
				currentThinking.trim().length === 0 &&
				errorMessage.trim().length === 0 &&
				stopReason !== "aborted" &&
				stopReason !== "error"
			);
		},
		setSearchQuery(query: string, activeMatchIndex?: number) {
			answerMarkdown.setSearchQuery(query, activeMatchIndex);
		},
		countSearchMatches(query: string): number {
			return answerMarkdown.visible ? countSubstringMatches(currentText, query) : 0;
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			thinkingChevron.setColor(theme.textMuted);
			thinkingLabel.setColor(theme.textMuted);
			thinkingHeaderBtn.setBackground(withAlpha(theme.surfaceMuted, 0.55));
			thinkingHeaderBtn.setHoverBackground(theme.surfaceHover);
			thinkingDrawer.setRailColor(withAlpha(theme.borderStrong, theme.dark ? 0.65 : 0.75));
			refresh();
		},
	};
}

/** Sleek Waku tool execution row with tool-specific icon, duration pill, diff/output drawer, and action links. */
export function createToolExecutionCard(
	initialTheme: GuiTheme,
	toolName: string,
	argsText: string,
	options: ToolExecutionCardOptions = {},
): ToolCardHandle {
	let theme = initialTheme;
	let currentArgs = argsText;
	let currentOutput = "";
	let currentDiffLines: readonly GuiDiffLine[] = options.diffLines ?? [];
	let isEnded = false;
	let isError = false;
	let durationMs: number | undefined;
	let expanded = options.initiallyExpanded ?? false;

	const chevronIcon = new VectorIcon({
		name: expanded ? "chevron-down" : "chevron-right",
		size: 12,
		color: theme.textMuted,
	});
	const toolIcon = new VectorIcon({
		name: toolIconForName(toolName),
		size: 13,
		color: theme.textSecondary,
	});
	const titleLabel = new Text({
		text: `Tool: ${toolName}`,
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: theme.textBright,
	});
	const argsLabel = new TruncatedText({
		text: argsText,
		fontSize: theme.fontSizeSmall,
		fontFamily: SGUI_FONT_MONO,
		color: theme.textMuted,
	});
	argsLabel.visible = argsText.trim().length > 0;

	const durationBadge = new Badge({
		label: "",
		variant: "neutral",
		fontSize: 11,
		padding: { horizontal: 6, vertical: 2 },
	});
	durationBadge.visible = false;

	const statusBadge = new Badge({
		label: "Running",
		variant: "accent",
		fontSize: 11,
		padding: { horizontal: 6, vertical: 2 },
	});

	const headerContent = new HStack({
		gap: 6,
		align: "center",
		children: [
			chevronIcon,
			toolIcon,
			titleLabel,
			argsLabel,
			{ child: new Spacer(4, 1), grow: 1, minSize: 4 },
			durationBadge,
			statusBadge,
		],
	});

	const headerBtn = new ClickableContainer({
		label: `Tool: ${toolName}`,
		background: withAlpha(theme.surfaceMuted, theme.dark ? 0.65 : 0.75),
		hoverBackground: theme.surfaceHover,
		borderColor: withAlpha(theme.border, 0.75),
		borderWidth: 1,
		radius: 8,
		padding: { horizontal: 10, vertical: 6 },
		fillWidth: true,
		child: headerContent,
		onClick: () => {
			expanded = !expanded;
			refresh();
		},
	});

	const detailContent = new VStack({
		gap: 6,
	});
	const detailBox = new Box({
		background: theme.codeBlockBg,
		borderColor: theme.border,
		borderWidth: 1,
		radius: 6,
		padding: { horizontal: 10, vertical: 8 },
		fillWidth: true,
		child: detailContent,
	});
	detailBox.visible = false;

	const outerStack = new VStack({
		gap: 4,
		children: [headerBtn, detailBox],
	});
	const root = new Box({
		padding: { vertical: 2 },
		fillWidth: true,
		child: outerStack,
	});

	const rebuildDetailBody = () => {
		detailContent.clear();
		if (!expanded) return;

		const inferredDiff = currentDiffLines.length > 0 ? currentDiffLines : parseUnifiedDiffLines(currentOutput);
		if (inferredDiff.length > 0) {
			detailContent.addChild(buildDiffViewComponent(theme, inferredDiff));
		} else if (currentOutput.trim().length > 0) {
			detailContent.addChild(
				new Text({
					text: truncateLines(currentOutput),
					fontFamily: SGUI_FONT_MONO,
					fontSize: theme.fontSizeSmall,
					color: isError ? theme.danger : theme.textSecondary,
				}),
			);
		} else {
			detailContent.addChild(
				new Text({
					text: isEnded ? "No output" : "Running...",
					fontSize: theme.fontSizeSmall,
					color: theme.textMuted,
				}),
			);
		}

		const targetPath = parseToolFilePath(currentArgs);
		const actionButtons: GuiComponent[] = [];
		if (targetPath !== undefined && options.onOpenFile !== undefined) {
			const openFileCb = options.onOpenFile;
			actionButtons.push(
				new Button({
					label: "Open File",
					leadingIcon: "external-link",
					iconSize: 11,
					variant: "secondary",
					pill: true,
					padding: { horizontal: 8, vertical: 3 },
					fontSize: theme.fontSizeSmall,
					onClick: () => openFileCb(targetPath),
				}),
			);
		}
		const lowerTool = toolName.toLowerCase();
		const isDiffCapable = inferredDiff.length > 0 || lowerTool === "edit" || lowerTool === "write";
		if (isDiffCapable && options.onViewDiff !== undefined) {
			const viewDiffCb = options.onViewDiff;
			actionButtons.push(
				new Button({
					label: "View Diff in Panel",
					leadingIcon: "file-diff",
					iconSize: 11,
					variant: "secondary",
					pill: true,
					padding: { horizontal: 8, vertical: 3 },
					fontSize: theme.fontSizeSmall,
					onClick: () => viewDiffCb(toolName, targetPath),
				}),
			);
		}
		if (actionButtons.length > 0) {
			detailContent.addChild(new HStack({ gap: 6, align: "center", children: actionButtons }));
		}
	};

	const refresh = () => {
		chevronIcon.setName(expanded ? "chevron-down" : "chevron-right");
		argsLabel.setText(currentArgs);
		argsLabel.visible = currentArgs.trim().length > 0;

		if (durationMs !== undefined) {
			durationBadge.setLabel(formatDurationMs(durationMs));
			durationBadge.visible = true;
		} else {
			durationBadge.visible = false;
		}

		if (isEnded) {
			if (isError) {
				statusBadge.setLabel("Error");
				statusBadge.setVariant("danger");
				toolIcon.setColor(theme.danger);
			} else {
				statusBadge.setLabel("Complete");
				statusBadge.setVariant("success");
				toolIcon.setColor(theme.success);
			}
		} else {
			statusBadge.setLabel("Running");
			statusBadge.setVariant("accent");
			toolIcon.setColor(theme.accent);
		}

		detailBox.visible = expanded;
		rebuildDetailBody();
		root.invalidate();
	};

	return {
		root,
		update(state) {
			if (state.argsText !== undefined) currentArgs = state.argsText;
			if (state.outputText !== undefined) currentOutput = state.outputText;
			if (state.diffLines !== undefined) currentDiffLines = state.diffLines;
			if (state.durationMs !== undefined) durationMs = state.durationMs;
			if (state.isError !== undefined) isError = state.isError;
			if (state.ended !== undefined) isEnded = state.ended;
			if (state.isError === true) {
				expanded = true;
			}
			refresh();
		},
		setExpanded(next) {
			if (expanded === next) return;
			expanded = next;
			refresh();
		},
		isExpanded() {
			return expanded;
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			chevronIcon.setColor(theme.textMuted);
			titleLabel.setColor(theme.textBright);
			headerBtn.setBackground(withAlpha(theme.surfaceMuted, theme.dark ? 0.65 : 0.75));
			headerBtn.setHoverBackground(theme.surfaceHover);
			headerBtn.setBorderColor(withAlpha(theme.border, 0.75));
			detailBox.setBackground(theme.codeBlockBg);
			detailBox.setBorder(theme.border, 1);
			refresh();
		},
	};
}

/** Compact bottom-of-turn changed files pill row (`path +A -D`) that opens Changes panel on click. */
export function createChangedFilesCard(
	initialTheme: GuiTheme,
	initialFiles: readonly GuiChangedFile[] = [],
	options: ChangedFilesCardOptions = {},
): ChangedFilesCardHandle {
	let theme = initialTheme;
	let currentFiles: readonly GuiChangedFile[] = initialFiles;

	const headerIcon = new VectorIcon({ name: "file-diff", size: 13, color: theme.textMuted });
	const headerText = new Text({
		text: "Modified files",
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: theme.textMuted,
	});
	const pillRow = new WrappingPillRow([], 6, 6);

	const container = new VStack({
		gap: 6,
		children: [new HStack({ gap: 5, align: "center", children: [headerIcon, headerText] }), pillRow],
	});
	const root = new Box({
		background: withAlpha(theme.surfaceMuted, theme.dark ? 0.4 : 0.55),
		borderColor: withAlpha(theme.border, 0.7),
		borderWidth: 1,
		radius: 8,
		padding: { horizontal: 10, vertical: 8 },
		fillWidth: true,
		child: container,
	});

	const rebuild = () => {
		root.visible = currentFiles.length > 0;
		const pills: GuiComponent[] = [];
		for (let i = 0; i < currentFiles.length; i++) {
			const file = currentFiles[i];
			if (file === undefined) continue;
			const statusColor =
				file.status === "A" ? theme.success : file.status === "D" ? theme.danger : theme.accent;
			const parts: GuiComponent[] = [
				new Text({
					text: file.status,
					fontFamily: SGUI_FONT_MONO,
					fontSize: 11,
					fontWeight: 600,
					color: statusColor,
				}),
				new TruncatedText({
					text: file.path,
					fontFamily: SGUI_FONT_MONO,
					fontSize: theme.fontSizeSmall,
					color: theme.text,
				}),
			];
			if (file.additions > 0) {
				parts.push(
					new Text({
						text: `+${file.additions}`,
						fontFamily: SGUI_FONT_MONO,
						fontSize: 11,
						color: theme.diffAddText,
					}),
				);
			}
			if (file.deletions > 0) {
				parts.push(
					new Text({
						text: `-${file.deletions}`,
						fontFamily: SGUI_FONT_MONO,
						fontSize: 11,
						color: theme.diffDelText,
					}),
				);
			}
			const pillBtn = new ClickableContainer({
				label: `${file.path} +${file.additions} -${file.deletions}`,
				background: theme.surface,
				hoverBackground: theme.surfaceHover,
				borderColor: theme.border,
				hoverBorderColor: theme.accent,
				borderWidth: 1,
				radius: 999,
				padding: { horizontal: 8, vertical: 3 },
				child: new HStack({ gap: 5, align: "center", children: parts }),
				onClick: () => {
					if (options.onOpenFileChanges !== undefined) {
						options.onOpenFileChanges(file.path);
					}
				},
			});
			pills.push(pillBtn);
		}
		pillRow.setChildren(pills);
		root.invalidate();
	};

	rebuild();

	return {
		root,
		setFiles(files) {
			currentFiles = files;
			rebuild();
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			headerIcon.setColor(theme.textMuted);
			headerText.setColor(theme.textMuted);
			root.setBackground(withAlpha(theme.surfaceMuted, theme.dark ? 0.4 : 0.55));
			root.setBorder(withAlpha(theme.border, 0.7), 1);
			rebuild();
		},
	};
}

interface TurnToolEntry {
	readonly id: string;
	readonly card: ToolCardHandle;
	toolName: string;
	ended: boolean;
	isError: boolean;
}

/**
 * Waku Turn Cluster grouping intermediate thinking trace + tool calls under a collapsible
 * `"Worked for ..."` / live `"Working for ..."` header with a 2px vertical thread rail,
 * followed by borderless final answer Markdown and optional changed-files pill row.
 */
export function createTurnClusterCard(
	initialTheme: GuiTheme,
	options: TurnClusterCardOptions = {},
): TurnClusterCardHandle {
	let theme = initialTheme;
	let currentThinking = "";
	let currentText = "";
	let isEnded = false;
	let stopReason: string | undefined;
	let errorMessage = "";
	let explicitDurationMs: number | undefined;
	const startedAtMs = Date.now();
	let userPinnedExpanded: boolean | undefined;
	let expanded = true;

	const tools: TurnToolEntry[] = [];
	const toolMap = new Map<string, ToolCardHandle>();

	const clusterChevron = new VectorIcon({ name: "chevron-right", size: 12, color: theme.textMuted });
	const clusterStatusIcon = new VectorIcon({ name: "activity", size: 13, color: theme.accent });
	const clusterSummaryLabel = new Text({
		text: "Working...",
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: theme.textSecondary,
	});

	const clusterHeaderBtn = new ClickableContainer({
		label: "Toggle turn activity",
		background: withAlpha(theme.surfaceMuted, theme.dark ? 0.48 : 0.65),
		hoverBackground: theme.surfaceHover,
		borderColor: withAlpha(theme.border, 0.5),
		borderWidth: 1,
		radius: 8,
		padding: { horizontal: 10, vertical: 5 },
		child: new HStack({
			gap: 6,
			align: "center",
			children: [clusterChevron, clusterStatusIcon, clusterSummaryLabel],
		}),
		onClick: () => {
			userPinnedExpanded = !expanded;
			expanded = userPinnedExpanded;
			refresh();
		},
	});

	const thinkingLabel = new Text({
		text: "Thinking...",
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: theme.textMuted,
	});
	const thinkingMarkdown = new Markdown({
		text: "",
		syntaxHighlight: true,
	});
	const thinkingGroup = new VStack({
		gap: 4,
		children: [thinkingLabel, thinkingMarkdown],
	});
	thinkingGroup.visible = false;

	const toolListStack = new VStack({
		gap: 4,
	});
	toolListStack.visible = false;

	const railStack = new VStack({
		gap: 8,
		children: [thinkingGroup, toolListStack],
	});
	const railContainer = new ThreadRailContainer(
		railStack,
		withAlpha(theme.borderStrong, theme.dark ? 0.65 : 0.75),
	);
	railContainer.visible = false;

	const collapsedToolsText = new Text({
		text: "",
		fontSize: theme.fontSizeSmall,
		color: theme.textMuted,
	});
	collapsedToolsText.visible = false;

	const clusterSection = new VStack({
		gap: 6,
		children: [clusterHeaderBtn, collapsedToolsText, railContainer],
	});
	clusterSection.visible = false;

	const answerMarkdown = new Markdown({
		text: "",
		syntaxHighlight: true,
		onCopyCode: options.onCopyCode,
	});
	answerMarkdown.visible = false;

	const calloutIcon = new VectorIcon({ name: "alert", size: 14, color: theme.danger });
	const calloutBadge = new Badge({ label: "Error", variant: "danger" });
	const calloutMsg = new Text({
		text: "",
		fontSize: theme.fontSizeSmall,
		color: theme.danger,
	});
	const calloutBox = new Box({
		background: withAlpha(theme.danger, theme.dark ? 0.14 : 0.08),
		borderColor: withAlpha(theme.danger, theme.dark ? 0.45 : 0.35),
		borderWidth: 1,
		radius: theme.radiusMedium,
		padding: { horizontal: 10, vertical: 8 },
		fillWidth: true,
		child: new VStack({
			gap: 4,
			children: [new HStack({ gap: 6, align: "center", children: [calloutIcon, calloutBadge] }), calloutMsg],
		}),
	});
	calloutBox.visible = false;

	const changedFilesCard = createChangedFilesCard(theme, [], {
		onOpenFileChanges: options.onOpenChangedFile,
	});
	changedFilesCard.root.visible = false;

	const turnStack = new VStack({
		gap: 10,
		children: [clusterSection, answerMarkdown, calloutBox, changedFilesCard.root],
	});
	const root = new Box({
		padding: { vertical: 6 },
		fillWidth: true,
		child: turnStack,
	});

	const formatClusterSummaryText = (): string => {
		const elapsed = explicitDurationMs ?? Math.max(0, Date.now() - startedAtMs);
		const durationStr = formatDurationMs(elapsed);
		const toolSuffix = tools.length === 1 ? " · 1 tool" : tools.length > 1 ? ` · ${tools.length} tools` : "";
		if (!isEnded) {
			return elapsed >= 100 ? `Working for ${durationStr}...${toolSuffix}` : `Working...${toolSuffix}`;
		}
		return `Worked for ${durationStr}${toolSuffix}`;
	};

	const refresh = () => {
		const hasThinking = currentThinking.trim().length > 0;
		const hasTools = tools.length > 0;
		const hasSteps = hasThinking || hasTools;

		if (userPinnedExpanded === undefined) {
			// Keep expanded while working on steps; collapse smoothly once final answer is delivered.
			expanded = !isEnded || currentText.trim().length === 0;
		} else {
			expanded = userPinnedExpanded;
		}

		clusterSection.visible = hasSteps;
		if (hasSteps) {
			const summaryText = formatClusterSummaryText();
			clusterSummaryLabel.setText(summaryText);
			clusterHeaderBtn.setLabel(summaryText);
			clusterChevron.setName(expanded ? "chevron-down" : "chevron-right");
			clusterStatusIcon.setName(isEnded ? "sparkles" : "activity");
			clusterStatusIcon.setColor(isEnded ? theme.textMuted : theme.accent);
			railContainer.setRailColor(
				isEnded
					? withAlpha(theme.borderStrong, theme.dark ? 0.65 : 0.75)
					: withAlpha(theme.accent, 0.75),
			);

			thinkingGroup.visible = hasThinking;
			thinkingLabel.setText(isEnded ? "Thought trace" : "Thinking...");
			thinkingMarkdown.setText(currentThinking);

			toolListStack.visible = hasTools;
			railContainer.visible = expanded;
			if (hasTools && !expanded) {
				const summaryParts: string[] = [];
				for (let i = 0; i < tools.length; i++) {
					const entry = tools[i];
					if (entry === undefined) continue;
					const statusStr = entry.ended ? (entry.isError ? "Error" : "Complete") : "Running";
					summaryParts.push(`Tool: ${entry.toolName} · ${statusStr}`);
				}
				collapsedToolsText.setText(summaryParts.join("  "));
				collapsedToolsText.visible = true;
			} else {
				collapsedToolsText.visible = false;
			}
		}

		const hasAnswer = currentText.trim().length > 0;
		answerMarkdown.visible = hasAnswer;
		answerMarkdown.setText(currentText);

		if (isEnded && stopReason === "aborted") {
			calloutBox.visible = true;
			calloutIcon.setColor(theme.warning);
			calloutBadge.setLabel("Stopped");
			calloutBadge.setVariant("warning");
			calloutMsg.setText(errorMessage.length > 0 ? errorMessage : "Generation stopped.");
			calloutMsg.setColor(theme.textSecondary);
			calloutBox.setBackground(withAlpha(theme.warning, theme.dark ? 0.14 : 0.08));
			calloutBox.setBorder(withAlpha(theme.warning, theme.dark ? 0.4 : 0.3), 1);
		} else if (stopReason === "error" || (isEnded && errorMessage.trim().length > 0)) {
			calloutBox.visible = true;
			calloutIcon.setColor(theme.danger);
			calloutBadge.setLabel("Error");
			calloutBadge.setVariant("danger");
			calloutMsg.setText(errorMessage.trim().length > 0 ? errorMessage : "Upstream request failed.");
			calloutMsg.setColor(theme.danger);
			calloutBox.setBackground(withAlpha(theme.danger, theme.dark ? 0.14 : 0.08));
			calloutBox.setBorder(withAlpha(theme.danger, theme.dark ? 0.45 : 0.35), 1);
		} else {
			calloutBox.visible = false;
		}

		root.invalidate();
	};

	return {
		root,
		updateTurn(state) {
			if (state.thinking !== undefined) currentThinking = state.thinking;
			if (state.text !== undefined) currentText = state.text;
			if (state.ended !== undefined) isEnded = state.ended;
			if (state.stopReason !== undefined) stopReason = state.stopReason;
			if (state.errorMessage !== undefined) errorMessage = state.errorMessage;
			if (state.durationMs !== undefined) explicitDurationMs = state.durationMs;
			if (state.changedFiles !== undefined) {
				changedFilesCard.setFiles(state.changedFiles);
			}
			refresh();
		},
		upsertTool(toolCallId, state) {
			let entry: TurnToolEntry | undefined;
			for (let i = 0; i < tools.length; i++) {
				if (tools[i]?.id === toolCallId) {
					entry = tools[i];
					break;
				}
			}
			let card = toolMap.get(toolCallId);
			if (card === undefined) {
				card = createToolExecutionCard(theme, state.toolName, state.argsText ?? "", {
					diffLines: state.diffLines,
					onOpenFile: options.onOpenFile,
					onViewDiff: options.onViewDiff,
				});
				toolMap.set(toolCallId, card);
				entry = {
					id: toolCallId,
					card,
					toolName: state.toolName,
					ended: Boolean(state.ended),
					isError: Boolean(state.isError),
				};
				tools.push(entry);
				toolListStack.addChild(card.root);
			} else if (entry !== undefined) {
				entry.toolName = state.toolName;
				if (state.ended !== undefined) entry.ended = state.ended;
				if (state.isError !== undefined) entry.isError = state.isError;
			}
			card.update({
				argsText: state.argsText,
				outputText: state.outputText,
				ended: state.ended,
				isError: state.isError,
				durationMs: state.durationMs,
				diffLines: state.diffLines,
			});
			refresh();
			return card;
		},
		setExpanded(next) {
			userPinnedExpanded = next;
			expanded = next;
			refresh();
		},
		isExpanded() {
			return expanded;
		},
		setSearchQuery(query: string, targetBlock: "thinking" | "text" | "none", activeMatchIndex?: number) {
			thinkingMarkdown.setSearchQuery(query, targetBlock === "thinking" ? activeMatchIndex : undefined);
			answerMarkdown.setSearchQuery(query, targetBlock === "text" ? activeMatchIndex : undefined);
			if (
				query.trim().length > 0 &&
				targetBlock === "thinking" &&
				activeMatchIndex !== undefined &&
				!expanded
			) {
				userPinnedExpanded = true;
				expanded = true;
				refresh();
			}
		},
		countThinkingMatches(query: string): number {
			return currentThinking.trim().length > 0 ? countSubstringMatches(currentThinking, query) : 0;
		},
		countAnswerMatches(query: string): number {
			return currentText.trim().length > 0 ? countSubstringMatches(currentText, query) : 0;
		},
		isEmpty() {
			return (
				tools.length === 0 &&
				currentThinking.trim().length === 0 &&
				currentText.trim().length === 0 &&
				errorMessage.trim().length === 0 &&
				stopReason !== "aborted" &&
				stopReason !== "error"
			);
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			clusterChevron.setColor(theme.textMuted);
			clusterSummaryLabel.setColor(theme.textSecondary);
			clusterHeaderBtn.setBackground(withAlpha(theme.surfaceMuted, theme.dark ? 0.48 : 0.65));
			clusterHeaderBtn.setHoverBackground(theme.surfaceHover);
			clusterHeaderBtn.setBorderColor(withAlpha(theme.border, 0.5));
			collapsedToolsText.setColor(theme.textMuted);
			thinkingLabel.setColor(theme.textMuted);
			for (let i = 0; i < tools.length; i++) {
				tools[i]?.card.applyTheme(theme);
			}
			changedFilesCard.applyTheme(theme);
			refresh();
		},
	};
}

/** Crisp Waku standalone bash execution card with exit code badge and expandable monospace output. */
export function createBashCard(
	initialTheme: GuiTheme,
	entry: Pick<GuiTranscriptEntry, "command" | "text" | "outputText" | "exitCode" | "isError" | "durationMs">,
	options: BashCardOptions = {},
): BashCardHandle {
	let theme = initialTheme;
	let command = entry.command ?? entry.text;
	let outputText = entry.outputText ?? "";
	let exitCode = entry.exitCode;
	let isError = entry.isError ?? false;
	let durationMs = entry.durationMs;
	let isEnded = entry.exitCode !== undefined || entry.outputText !== undefined || entry.isError !== undefined;
	let expanded = options.initiallyExpanded ?? (outputText.trim().length > 0 && isError);

	const chevron = new VectorIcon({
		name: expanded ? "chevron-down" : "chevron-right",
		size: 12,
		color: theme.textMuted,
	});
	const termIcon = new VectorIcon({ name: "terminal", size: 13, color: theme.accent });
	const cmdLabel = new TruncatedText({
		text: `$ ${command}`,
		fontFamily: SGUI_FONT_MONO,
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: theme.textBright,
	});
	const durationBadge = new Badge({ label: "", variant: "neutral", fontSize: 11, padding: { horizontal: 6, vertical: 2 } });
	const exitBadge = new Badge({ label: "Running", variant: "accent", fontSize: 11, padding: { horizontal: 6, vertical: 2 } });

	const headerBtn = new ClickableContainer({
		label: `Bash: ${command}`,
		background: withAlpha(theme.surfaceMuted, theme.dark ? 0.72 : 0.8),
		hoverBackground: theme.surfaceHover,
		borderColor: theme.border,
		borderWidth: 1,
		radius: 8,
		padding: { horizontal: 10, vertical: 6 },
		fillWidth: true,
		child: new HStack({
			gap: 6,
			align: "center",
			children: [chevron, termIcon, cmdLabel, { child: new Spacer(4, 1), grow: 1, minSize: 4 }, durationBadge, exitBadge],
		}),
		onClick: () => {
			expanded = !expanded;
			refresh();
		},
	});

	const outputMono = new Text({
		text: "",
		fontFamily: SGUI_FONT_MONO,
		fontSize: theme.fontSizeSmall,
		color: theme.textSecondary,
	});
	const outputBox = new Box({
		background: theme.codeBlockBg,
		borderColor: theme.border,
		borderWidth: 1,
		radius: 6,
		padding: { horizontal: 10, vertical: 8 },
		fillWidth: true,
		child: outputMono,
	});

	const stack = new VStack({
		gap: 4,
		children: [headerBtn, outputBox],
	});
	const root = new Box({
		padding: { vertical: 4 },
		fillWidth: true,
		child: stack,
	});

	const refresh = () => {
		chevron.setName(expanded ? "chevron-down" : "chevron-right");
		cmdLabel.setText(`$ ${command}`);
		headerBtn.setLabel(`Bash: ${command}`);

		if (durationMs !== undefined) {
			durationBadge.setLabel(formatDurationMs(durationMs));
			durationBadge.visible = true;
		} else {
			durationBadge.visible = false;
		}

		if (!isEnded) {
			exitBadge.setLabel("Running");
			exitBadge.setVariant("accent");
			termIcon.setColor(theme.accent);
		} else if (isError || (exitCode !== undefined && exitCode !== 0)) {
			exitBadge.setLabel(`exit ${exitCode ?? 1}`);
			exitBadge.setVariant("danger");
			termIcon.setColor(theme.danger);
		} else {
			exitBadge.setLabel(`exit ${exitCode ?? 0}`);
			exitBadge.setVariant("success");
			termIcon.setColor(theme.success);
		}

		outputBox.visible = expanded;
		outputMono.setText(outputText.trim().length > 0 ? truncateLines(outputText) : "(no output)");
		outputMono.setColor(isError ? theme.danger : theme.textSecondary);
		root.invalidate();
	};

	refresh();

	return {
		root,
		update(state) {
			if (state.command !== undefined) command = state.command;
			if (state.outputText !== undefined) outputText = state.outputText;
			if (state.exitCode !== undefined) exitCode = state.exitCode;
			if (state.isError !== undefined) isError = state.isError;
			if (state.durationMs !== undefined) durationMs = state.durationMs;
			if (state.ended !== undefined) isEnded = state.ended;
			if (state.isError === true) expanded = true;
			refresh();
		},
		setExpanded(next) {
			if (expanded === next) return;
			expanded = next;
			refresh();
		},
		isExpanded() {
			return expanded;
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			chevron.setColor(theme.textMuted);
			headerBtn.setBackground(withAlpha(theme.surfaceMuted, theme.dark ? 0.72 : 0.8));
			headerBtn.setHoverBackground(theme.surfaceHover);
			headerBtn.setBorderColor(theme.border);
			outputBox.setBackground(theme.codeBlockBg);
			outputBox.setBorder(theme.border, 1);
			refresh();
		},
	};
}

function createCollapsibleSummaryCard(
	initialTheme: GuiTheme,
	iconName: VectorIconName,
	headingText: string,
	summaryText: string,
	initiallyExpanded = false,
): SummaryTranscriptCardHandle {
	let theme = initialTheme;
	let expanded = initiallyExpanded;

	const chevron = new VectorIcon({
		name: expanded ? "chevron-down" : "chevron-right",
		size: 12,
		color: theme.textMuted,
	});
	const icon = new VectorIcon({ name: iconName, size: 13, color: theme.accent });
	const label = new Text({
		text: headingText,
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: theme.textSecondary,
	});

	const headerBtn = new ClickableContainer({
		label: headingText,
		background: withAlpha(theme.surfaceMuted, theme.dark ? 0.55 : 0.7),
		hoverBackground: theme.surfaceHover,
		borderColor: withAlpha(theme.border, 0.75),
		borderWidth: 1,
		radius: 8,
		padding: { horizontal: 10, vertical: 6 },
		fillWidth: true,
		child: new HStack({ gap: 6, align: "center", children: [chevron, icon, label] }),
		onClick: () => {
			expanded = !expanded;
			refresh();
		},
	});

	const markdown = new Markdown({
		text: summaryText,
		syntaxHighlight: true,
	});
	const bodyBox = new Box({
		background: withAlpha(theme.surface, theme.dark ? 0.7 : 0.85),
		borderColor: withAlpha(theme.border, 0.75),
		borderWidth: 1,
		radius: 8,
		padding: { horizontal: 12, vertical: 8 },
		fillWidth: true,
		child: markdown,
	});

	const stack = new VStack({
		gap: 4,
		children: [headerBtn, bodyBox],
	});
	const root = new Box({
		padding: { vertical: 4 },
		fillWidth: true,
		child: stack,
	});

	const refresh = () => {
		chevron.setName(expanded ? "chevron-down" : "chevron-right");
		bodyBox.visible = expanded;
		root.invalidate();
	};
	refresh();

	return {
		root,
		setExpanded(next) {
			if (expanded === next) return;
			expanded = next;
			refresh();
		},
		setSearchQuery(query: string, activeMatchIndex?: number) {
			markdown.setSearchQuery(query, activeMatchIndex);
			if (query.trim().length > 0 && activeMatchIndex !== undefined && !expanded) {
				expanded = true;
				refresh();
			}
		},
		countSearchMatches(query: string): number {
			return countSubstringMatches(summaryText, query);
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			chevron.setColor(theme.textMuted);
			icon.setColor(theme.accent);
			label.setColor(theme.textSecondary);
			headerBtn.setBackground(withAlpha(theme.surfaceMuted, theme.dark ? 0.55 : 0.7));
			headerBtn.setHoverBackground(theme.surfaceHover);
			headerBtn.setBorderColor(withAlpha(theme.border, 0.75));
			bodyBox.setBackground(withAlpha(theme.surface, theme.dark ? 0.7 : 0.85));
			bodyBox.setBorder(withAlpha(theme.border, 0.75), 1);
		},
	};
}

/** Crisp collapsible compaction summary card matching Waku / pi-go styles. */
export function createCompactionCard(
	initialTheme: GuiTheme,
	entry: Pick<GuiTranscriptEntry, "text">,
): SummaryTranscriptCardHandle {
	return createCollapsibleSummaryCard(initialTheme, "sparkles", "Context compacted", entry.text);
}

/** Crisp collapsible branch summary card matching Waku / pi-go styles. */
export function createBranchSummaryCard(
	initialTheme: GuiTheme,
	entry: Pick<GuiTranscriptEntry, "text">,
): SummaryTranscriptCardHandle {
	return createCollapsibleSummaryCard(initialTheme, "git-branch", "Branch summary", entry.text);
}

/** Extension UI widget card rendered above-editor, below-editor, or inline. */
export function createExtensionWidgetCard(
	initialTheme: GuiTheme,
	widget: GuiExtensionWidgetEntry,
): ExtensionWidgetCardHandle {
	let theme = initialTheme;
	let current = widget;

	const keyLabel = new Text({
		text: widget.key,
		fontSize: 11,
		fontWeight: 600,
		color: theme.textMuted,
	});
	const linesStack = new VStack({ gap: 2 });

	const content = new VStack({
		gap: 4,
		children: [keyLabel, linesStack],
	});
	const root = new Box({
		background: withAlpha(theme.surfaceMuted, theme.dark ? 0.55 : 0.75),
		borderColor: withAlpha(theme.border, 0.8),
		borderWidth: 1,
		radius: 8,
		padding: { horizontal: 10, vertical: 6 },
		fillWidth: true,
		child: content,
	});

	const renderLines = () => {
		keyLabel.setText(current.key);
		keyLabel.visible = current.key.trim().length > 0;
		linesStack.clear();
		for (let i = 0; i < current.lines.length; i++) {
			const line = current.lines[i];
			if (line === undefined) continue;
			linesStack.addChild(
				new Text({
					text: line,
					fontSize: theme.fontSizeSmall,
					color: theme.textSecondary,
				}),
			);
		}
		root.invalidate();
	};

	renderLines();

	return {
		root,
		update(next) {
			current = next;
			renderLines();
		},
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			root.setBackground(withAlpha(theme.surfaceMuted, theme.dark ? 0.55 : 0.75));
			root.setBorder(withAlpha(theme.border, 0.8), 1);
			keyLabel.setColor(theme.textMuted);
			renderLines();
		},
	};
}

/** Banner card for notices, warnings, and errors, preserved for gui-mode.ts compatibility. */
export function createBannerCard(
	initialTheme: GuiTheme,
	title: string,
	message: string,
	tone: "error" | "notice" | "warning",
): ThemedCard {
	let theme = initialTheme;
	const toneColor = (t: GuiTheme) => (tone === "error" ? t.danger : tone === "warning" ? t.warning : t.accent);
	const icon = new VectorIcon({
		name: tone === "notice" ? "info" : "alert",
		size: 14,
		color: toneColor(theme),
	});
	const badge = new Badge({
		label: tone === "error" ? "Error" : tone === "warning" ? "Warning" : "Notice",
		variant: tone === "error" ? "danger" : tone === "warning" ? "warning" : "accent",
	});
	const titleText = new Text({
		text: title,
		fontSize: theme.fontSizeSmall,
		fontWeight: 600,
		color: tone === "error" ? theme.danger : tone === "warning" ? theme.warning : theme.textBright,
	});
	const msgText = new Text({
		text: message,
		fontSize: theme.fontSizeSmall,
		color: theme.text,
	});

	const root = new Box({
		background: withAlpha(toneColor(theme), theme.dark ? 0.14 : 0.08),
		borderColor: withAlpha(toneColor(theme), theme.dark ? 0.45 : 0.35),
		borderWidth: 1,
		radius: theme.radiusMedium,
		padding: { horizontal: 12, vertical: 8 },
		fillWidth: true,
		child: new VStack({
			gap: 4,
			children: [new HStack({ gap: 6, align: "center", children: [icon, badge, titleText] }), msgText],
		}),
	});

	return {
		root,
		applyTheme(nextTheme: GuiTheme) {
			theme = nextTheme;
			const accent = toneColor(theme);
			icon.setColor(accent);
			titleText.setColor(tone === "error" ? theme.danger : tone === "warning" ? theme.warning : theme.textBright);
			msgText.setColor(theme.text);
			root.setBackground(withAlpha(accent, theme.dark ? 0.14 : 0.08));
			root.setBorder(withAlpha(accent, theme.dark ? 0.45 : 0.35), 1);
		},
	};
}
