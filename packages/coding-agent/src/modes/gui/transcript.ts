import { basename } from "node:path";
import {
	type A11yActionKind,
	Badge,
	Box,
	Button,
	type Color,
	DARK_THEME,
	drawElevationShadow,
	type GuiA11yNode,
	type GuiApp,
	GuiComponent,
	type GuiHost,
	type GuiKeyEvent,
	type GuiPointerEvent,
	type GuiPointerResult,
	type GuiRenderContext,
	type GuiScrollEvent,
	type GuiTheme,
	HStack,
	IconButton,
	Input,
	pointInRect,
	type Rect,
	ScrollView,
	SGUI_A11Y_STATE_ENABLED,
	SGUI_CURSOR_POINTER,
	type Size,
	Text,
	VectorIcon,
	VStack,
	withAlpha,
} from "@pi-ts/gui";
import {
	type BashCardHandle,
	createBannerCard,
	createBashCard,
	createBranchSummaryCard,
	createCompactionCard,
	createTurnClusterCard,
	createUserMessageCard,
	type SummaryTranscriptCardHandle,
	type ThemedCard,
	type TurnClusterCardHandle,
	type UserMessageCardHandle,
} from "./cards.ts";
import type {
	GuiAttachmentItem,
	GuiChangedFile,
	GuiControllerEvent,
	GuiSessionController,
	GuiSessionSnapshot,
	GuiSessionStatus,
	GuiTranscriptEntry,
} from "./types.ts";

const DEFAULT_MAX_COLUMN_WIDTH = 760;
const NAV_RAIL_WIDTH = 18;
const JUMP_BTN_SIZE = 32;

const QUICK_START_PROMPTS: readonly string[] = [
	"Summarize repo changes",
	"Explain architecture",
	"Run tests & fix failures",
	"Review current diff",
];

/** Options for configuring createWakuTranscriptView. */
export interface WakuTranscriptViewOptions {
	readonly maxColumnWidth?: number;
	readonly initialTheme?: GuiTheme;
	readonly quickPrompts?: readonly string[];
	readonly onSelectPrompt?: (prompt: string) => void;
	readonly onForkFromMessage?: (text: string) => void;
	readonly onOpenFile?: (filePath: string) => void;
	readonly onViewDiff?: (toolName: string, filePath?: string) => void;
	readonly onOpenChangedFile?: (filePath: string) => void;
	readonly onCopyCode?: (code: string, language?: string) => void;
}

/** Interactive control surface for the Waku centered transcript viewport. */
export interface WakuTranscriptViewHandle {
	readonly root: GuiComponent;
	readonly scrollView: ScrollView;
	readonly messagesStack: VStack;
	readonly findInput: Input;
	applyTheme(theme: GuiTheme): void;
	applySnapshot(snapshot: GuiSessionSnapshot): void;
	handleEvent(event: GuiControllerEvent): void;
	openFindBar(): void;
	closeFindBar(): void;
	toggleFindBar(): void;
	isFindBarOpen(): boolean;
	setFindQuery(query: string): void;
	nextFindMatch(): void;
	prevFindMatch(): void;
	getFindMatchInfo(): { readonly current: number; readonly total: number };
	handleShortcutKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean;
	scrollToTurn(index: number): void;
	scrollToEnd(): void;
	isShowingEmptyState(): boolean;
	dispose(): void;
}

/** Centers a child VStack up to maxColumnWidth while filling parent viewport height naturally. */
class CenteredTranscriptColumn extends GuiComponent {
	private readonly child: GuiComponent;
	private readonly maxColumnWidth: number;
	private readonly padX: number;

	constructor(child: GuiComponent, maxColumnWidth = DEFAULT_MAX_COLUMN_WIDTH, padX = 24) {
		super();
		this.child = child;
		this.child.setParent(this);
		this.maxColumnWidth = maxColumnWidth;
		this.padX = padX;
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.child.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		this.child.onThemeChange(theme);
	}

	measure(ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		const availW = Math.max(80, maxWidth - this.padX * 2 - NAV_RAIL_WIDTH);
		const colW = Math.min(this.maxColumnWidth, availW);
		const measured = this.child.visible ? this.child.measure(ctx, colW, maxHeight) : { width: colW, height: 0 };
		return {
			width: maxWidth,
			height: measured.height,
		};
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		const availW = Math.max(80, rect.width - this.padX * 2 - NAV_RAIL_WIDTH);
		const colW = Math.min(this.maxColumnWidth, availW);
		const measured = this.child.measure(ctx, colW, undefined);
		const x = rect.x + Math.max(this.padX, Math.floor((rect.width - colW) / 2));
		this.child.layout(ctx, {
			x,
			y: rect.y,
			width: colW,
			height: Math.max(rect.height, measured.height),
		});
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible || !this.child.visible) return;
		this.child.render(ctx);
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		return this.child.hitTest(x, y);
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible || !this.child.visible) return;
		this.child.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible || !this.child.visible) return;
		this.child.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return this.child.findComponentByA11yId(nodeId);
	}
}

interface NavTickMarker {
	readonly label: string;
	readonly ratio: number;
	readonly index: number;
}

/** Slim vertical navigation rail in the right viewport margin for jumping across user turns. */
class TranscriptNavRail extends GuiComponent {
	private markers: NavTickMarker[] = [];
	private streaming = false;
	private hoveredIdx = -1;
	private onSelectTurn: (index: number) => void;

	constructor(onSelectTurn: (index: number) => void) {
		super();
		this.onSelectTurn = onSelectTurn;
		this.cursor = SGUI_CURSOR_POINTER;
	}

	setMarkers(markers: readonly NavTickMarker[], streaming: boolean): void {
		this.markers = markers.slice();
		this.streaming = streaming;
		this.visible = this.markers.length > 0 || this.streaming;
		this.invalidate();
	}

	measure(_ctx: GuiRenderContext, _maxWidth: number, maxHeight?: number): Size {
		return { width: NAV_RAIL_WIDTH, height: maxHeight ?? 120 };
	}

	private markerY(idx: number): number {
		const m = this.markers[idx];
		const r = this.layoutRect;
		const padY = 18;
		const span = Math.max(12, r.height - padY * 2);
		const ratio = m !== undefined ? Math.max(0, Math.min(1, m.ratio)) : 0;
		return r.y + padY + ratio * span;
	}

	private hitMarkerIndex(y: number): number {
		let bestIdx = -1;
		let bestDist = 12;
		for (let i = 0; i < this.markers.length; i++) {
			const dist = Math.abs(y - this.markerY(i));
			if (dist <= bestDist) {
				bestDist = dist;
				bestIdx = i;
			}
		}
		return bestIdx;
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		const r = this.layoutRect;
		if (r.width <= 0 || r.height <= 24) return;
		const lineX = r.x + Math.floor(r.width * 0.5);
		ctx.drawLine(lineX, r.y + 14, lineX, r.y + r.height - 14, withAlpha(ctx.theme.border, 0.45), 1);

		for (let i = 0; i < this.markers.length; i++) {
			const y = this.markerY(i);
			const active = i === this.hoveredIdx;
			const tickW = active ? 10 : 7;
			const color: Color = active ? ctx.theme.accent : ctx.theme.textMuted;
			ctx.fillRect(lineX - tickW * 0.5, y - 1.5, tickW, 3, color, 1.5);
		}

		if (this.streaming) {
			const pulseY = r.y + r.height - 16;
			ctx.fillRect(lineX - 3, pulseY - 3, 6, 6, ctx.theme.accent, 3);
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		return this;
	}

	override handlePointer(event: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
		if (!this.visible) return { handled: false };
		const idx = this.hitMarkerIndex(event.y);
		if (event.phase === "move" || event.phase === "enter") {
			if (this.hoveredIdx !== idx) {
				this.hoveredIdx = idx;
				this.invalidate();
			}
			return { handled: false, cursor: idx >= 0 ? SGUI_CURSOR_POINTER : undefined };
		}
		if (event.phase === "leave") {
			if (this.hoveredIdx !== -1) {
				this.hoveredIdx = -1;
				this.invalidate();
			}
			return { handled: false };
		}
		if (event.phase === "down" && event.button === "left") {
			if (idx >= 0) {
				const marker = this.markers[idx];
				if (marker !== undefined) {
					this.onSelectTurn(marker.index);
				}
				return { handled: true, cursor: SGUI_CURSOR_POINTER };
			}
			return { handled: false };
		}
		return { handled: false };
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
		if (!this.visible || this.layoutRect.width <= 0 || this.layoutRect.height <= 0) return;
		for (let i = 0; i < this.markers.length; i++) {
			const m = this.markers[i];
			if (m === undefined) continue;
			const y = this.markerY(i);
			out.push({
				id: this.a11yId + 10000 + i,
				role: "button",
				stateFlags: SGUI_A11Y_STATE_ENABLED,
				rect: { x: this.layoutRect.x, y: y - 6, width: this.layoutRect.width, height: 12 },
				label: m.label,
				value: "",
			});
		}
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		if (nodeId === this.a11yId) return this;
		if (nodeId >= this.a11yId + 10000 && nodeId < this.a11yId + 10000 + this.markers.length) {
			return this;
		}
		return undefined;
	}

	override handleAccessibilityAction(
		nodeId: number,
		action: A11yActionKind,
		_value: string,
		_ctx: GuiRenderContext,
	): boolean {
		if (action !== "press") return false;
		const idx = nodeId - (this.a11yId + 10000);
		const marker = this.markers[idx];
		if (marker !== undefined) {
			this.onSelectTurn(marker.index);
			return true;
		}
		return false;
	}
}

/** Layered transcript viewport combining ScrollView, Empty State, Find Bar, Nav Rail, and Jump-to-Bottom Pill. */
class WakuTranscriptViewport extends GuiComponent {
	private readonly scrollView: ScrollView;
	private readonly emptyState: GuiComponent;
	private readonly findBar: GuiComponent;
	private readonly navRail: TranscriptNavRail;
	private readonly scrollToBottomBtn: IconButton;
	private readonly onBeforeRenderSync: () => void;
	private readonly onShortcut: (event: GuiKeyEvent, ctx: GuiRenderContext) => boolean;

	constructor(params: {
		readonly scrollView: ScrollView;
		readonly emptyState: GuiComponent;
		readonly findBar: GuiComponent;
		readonly navRail: TranscriptNavRail;
		readonly scrollToBottomBtn: IconButton;
		readonly onBeforeRenderSync: () => void;
		readonly onShortcut: (event: GuiKeyEvent, ctx: GuiRenderContext) => boolean;
	}) {
		super();
		this.scrollView = params.scrollView;
		this.emptyState = params.emptyState;
		this.findBar = params.findBar;
		this.navRail = params.navRail;
		this.scrollToBottomBtn = params.scrollToBottomBtn;
		this.onBeforeRenderSync = params.onBeforeRenderSync;
		this.onShortcut = params.onShortcut;

		this.scrollView.setParent(this);
		this.emptyState.setParent(this);
		this.findBar.setParent(this);
		this.navRail.setParent(this);
		this.scrollToBottomBtn.setParent(this);
	}

	override attachHost(host: GuiHost | undefined): void {
		super.attachHost(host);
		this.scrollView.attachHost(host);
		this.emptyState.attachHost(host);
		this.findBar.attachHost(host);
		this.navRail.attachHost(host);
		this.scrollToBottomBtn.attachHost(host);
	}

	override onThemeChange(theme: GuiTheme): void {
		this.scrollView.onThemeChange(theme);
		this.emptyState.onThemeChange(theme);
		this.findBar.onThemeChange(theme);
		this.navRail.onThemeChange(theme);
		this.scrollToBottomBtn.onThemeChange(theme);
	}

	measure(_ctx: GuiRenderContext, maxWidth: number, maxHeight?: number): Size {
		return {
			width: Math.max(0, maxWidth),
			height: maxHeight !== undefined ? Math.max(0, maxHeight) : 320,
		};
	}

	private layoutFloatingOverlays(ctx: GuiRenderContext, rect: Rect): void {
		if (this.emptyState.visible) {
			const esSize = this.emptyState.measure(ctx, Math.min(540, Math.max(220, rect.width - 48)), rect.height);
			const esW = Math.min(rect.width - 32, esSize.width);
			const esH = Math.min(rect.height - 32, esSize.height);
			const esX = rect.x + Math.max(16, Math.floor((rect.width - esW) * 0.5));
			const esY = rect.y + Math.max(16, Math.floor((rect.height - esH) * 0.44));
			this.emptyState.layout(ctx, { x: esX, y: esY, width: Math.max(0, esW), height: Math.max(0, esH) });
		}

		if (this.navRail.visible) {
			this.navRail.layout(ctx, {
				x: rect.x + Math.max(0, rect.width - NAV_RAIL_WIDTH - 10),
				y: rect.y + 12,
				width: NAV_RAIL_WIDTH,
				height: Math.max(0, rect.height - 64),
			});
		}

		if (this.findBar.visible) {
			const maxBarW = Math.min(380, Math.max(200, rect.width - 32));
			const barSize = this.findBar.measure(ctx, maxBarW, rect.height);
			const barW = Math.min(maxBarW, Math.max(240, barSize.width));
			const barH = barSize.height;
			this.findBar.layout(ctx, {
				x: rect.x + Math.max(12, rect.width - barW - 22),
				y: rect.y + 12,
				width: barW,
				height: barH,
			});
		}

		if (this.scrollToBottomBtn.visible) {
			this.scrollToBottomBtn.layout(ctx, {
				x: rect.x + Math.max(12, rect.width - JUMP_BTN_SIZE - 18),
				y: rect.y + Math.max(12, rect.height - JUMP_BTN_SIZE - 12),
				width: JUMP_BTN_SIZE,
				height: JUMP_BTN_SIZE,
			});
		}
	}

	override layout(ctx: GuiRenderContext, rect: Rect): void {
		super.layout(ctx, rect);
		this.scrollView.layout(ctx, rect);
		this.onBeforeRenderSync();
		this.layoutFloatingOverlays(ctx, rect);
	}

	render(ctx: GuiRenderContext): void {
		if (!this.visible) return;
		this.scrollView.render(ctx);
		this.onBeforeRenderSync();
		this.layoutFloatingOverlays(ctx, this.layoutRect);

		if (this.emptyState.visible) {
			this.emptyState.render(ctx);
		}
		if (this.navRail.visible) {
			this.navRail.render(ctx);
		}
		if (this.scrollToBottomBtn.visible) {
			const r = this.scrollToBottomBtn.layoutRect;
			const radius = JUMP_BTN_SIZE * 0.5;
			drawElevationShadow(ctx, r, radius, "md");
			ctx.fillRect(r.x, r.y, r.width, r.height, ctx.theme.surfaceElevated, radius);
			ctx.strokeRect(r.x, r.y, r.width, r.height, ctx.theme.borderStrong, 1, radius);
			this.scrollToBottomBtn.render(ctx);
		}
		if (this.findBar.visible) {
			drawElevationShadow(ctx, this.findBar.layoutRect, 10, "md");
			this.findBar.render(ctx);
		}
	}

	override hitTest(x: number, y: number): GuiComponent | undefined {
		if (!this.visible || !pointInRect(x, y, this.layoutRect)) return undefined;
		if (this.findBar.visible) {
			const hit = this.findBar.hitTest(x, y);
			if (hit !== undefined) return hit;
		}
		if (this.scrollToBottomBtn.visible) {
			const hit = this.scrollToBottomBtn.hitTest(x, y);
			if (hit !== undefined) return hit;
		}
		if (this.navRail.visible) {
			const hit = this.navRail.hitTest(x, y);
			if (hit !== undefined) return hit;
		}
		if (this.emptyState.visible) {
			const hit = this.emptyState.hitTest(x, y);
			if (hit !== undefined) return hit;
		}
		return this.scrollView.hitTest(x, y);
	}

	override handleScroll(event: GuiScrollEvent, ctx: GuiRenderContext): boolean {
		return this.scrollView.handleScroll(event, ctx);
	}

	override handleKey(event: GuiKeyEvent, ctx: GuiRenderContext): boolean {
		if (this.onShortcut(event, ctx)) return true;
		return this.scrollView.handleKey(event, ctx);
	}

	override collectFocusables(out: GuiComponent[]): void {
		if (!this.visible) return;
		if (this.findBar.visible) this.findBar.collectFocusables(out);
		if (this.emptyState.visible) this.emptyState.collectFocusables(out);
		this.scrollView.collectFocusables(out);
		if (this.scrollToBottomBtn.visible) this.scrollToBottomBtn.collectFocusables(out);
	}

	override collectAccessibilityNodes(out: GuiA11yNode[], ctx: GuiRenderContext): void {
		if (!this.visible) return;
		if (this.emptyState.visible) {
			this.emptyState.collectAccessibilityNodes(out, ctx);
		} else {
			this.scrollView.collectAccessibilityNodes(out, ctx);
		}
		if (this.navRail.visible) this.navRail.collectAccessibilityNodes(out, ctx);
		if (this.scrollToBottomBtn.visible) this.scrollToBottomBtn.collectAccessibilityNodes(out, ctx);
		if (this.findBar.visible) this.findBar.collectAccessibilityNodes(out, ctx);
	}

	override findComponentByA11yId(nodeId: number): GuiComponent | undefined {
		return (
			this.findBar.findComponentByA11yId(nodeId) ??
			this.scrollToBottomBtn.findComponentByA11yId(nodeId) ??
			this.navRail.findComponentByA11yId(nodeId) ??
			this.emptyState.findComponentByA11yId(nodeId) ??
			this.scrollView.findComponentByA11yId(nodeId) ??
			super.findComponentByA11yId(nodeId)
		);
	}
}

type SearchableTranscriptItem =
	| { readonly kind: "user"; readonly handle: UserMessageCardHandle }
	| { readonly kind: "turn"; readonly handle: TurnClusterCardHandle }
	| { readonly kind: "summary"; readonly handle: SummaryTranscriptCardHandle };

interface SearchMatchLocation {
	readonly item: SearchableTranscriptItem;
	readonly targetBlock: "thinking" | "text";
	readonly localMatchIndex: number;
}

interface TurnRailItem {
	readonly card: ThemedCard;
	readonly snippet: string;
}

/**
 * Create Waku's centered (`760px` maxWidth) transcript viewport with Empty State hero,
 * turn clustering (`Worked for ...`), right-margin navigation rail, `⌘F` Find Bar, and
 * floating scroll-to-bottom pill.
 */
export function createWakuTranscriptView(
	app: GuiApp | undefined,
	controller: GuiSessionController,
	options: WakuTranscriptViewOptions = {},
): WakuTranscriptViewHandle {
	let theme = options.initialTheme ?? app?.getTheme() ?? DARK_THEME;
	const initialSnap = controller.getSnapshot();

	const cards: ThemedCard[] = [];
	const searchableItems: SearchableTranscriptItem[] = [];
	const userTurns: TurnRailItem[] = [];
	const activeBashCards = new Map<string, BashCardHandle>();
	let lastStandaloneBashCard: BashCardHandle | undefined;
	let activeTurnCluster: TurnClusterCardHandle | undefined;
	let activeTurnThoughtAccum = "";
	let activeTurnTextAccum = "";
	let isAgentStreaming = initialSnap.status.isStreaming;
	let findBarOpen = false;
	let currentFindQuery = "";
	let findMatches: SearchMatchLocation[] = [];
	let currentFindIndex = 0;

	const messagesStack = new VStack({ gap: 10 });
	const centeredColumn = new CenteredTranscriptColumn(
		messagesStack,
		options.maxColumnWidth ?? DEFAULT_MAX_COLUMN_WIDTH,
		24,
	);
	const scrollView = new ScrollView({
		follow: "end",
		scrollToEndLabel: "↓",
		primary: true,
		padding: { vertical: 16 },
		child: centeredColumn,
	});

	// --- Empty State Hero ---
	const heroMark = new VectorIcon({ name: "waku-mark", size: 38, color: theme.accent });
	const heroBadge = new Box({
		background: withAlpha(theme.accent, theme.dark ? 0.14 : 0.1),
		borderColor: withAlpha(theme.accent, theme.dark ? 0.35 : 0.28),
		borderWidth: 1,
		radius: 18,
		padding: 12,
		child: heroMark,
	});
	const heroGreeting = new Text({
		text: "Start building",
		fontSize: theme.fontSizeHeading,
		fontWeight: 600,
		color: theme.textBright,
		align: "center",
	});
	const heroSubtitle = new Text({
		text: "Ask anything about this workspace or choose a prompt below.",
		fontSize: theme.fontSizeSmall,
		color: theme.textMuted,
		align: "center",
	});
	const heroModelPill = new Badge({
		label: "No model",
		variant: "neutral",
		leadingIcon: "cpu",
		iconSize: 12,
	});

	const quickPrompts = options.quickPrompts ?? QUICK_START_PROMPTS;
	const promptButtons: GuiComponent[] = [];
	for (let i = 0; i < quickPrompts.length; i++) {
		const promptText = quickPrompts[i];
		if (promptText === undefined) continue;
		promptButtons.push(
			new Button({
				label: promptText,
				variant: "secondary",
				pill: true,
				fontSize: theme.fontSizeSmall,
				padding: { horizontal: 12, vertical: 6 },
				onClick: () => {
					if (options.onSelectPrompt !== undefined) {
						options.onSelectPrompt(promptText);
					} else {
						void controller.sendUserMessage(promptText);
					}
				},
			}),
		);
	}
	const heroPromptsRow = new HStack({ gap: 8, align: "center", children: promptButtons });

	const emptyStateStack = new VStack({
		gap: 12,
		align: "center",
		children: [heroBadge, heroGreeting, heroModelPill, heroSubtitle, heroPromptsRow],
	});
	const emptyStateBox = new Box({
		padding: { horizontal: 20, vertical: 16 },
		child: emptyStateStack,
	});

	const updateEmptyStateStatus = (status: GuiSessionStatus) => {
		const projectName = basename(status.cwd);
		heroGreeting.setText(projectName.length > 0 ? `Start building in ${projectName}` : "Start building");
		const modelText = status.activeModel
			? `${status.activeModel.provider} · ${status.activeModel.label}`
			: "No model selected";
		heroModelPill.setLabel(modelText);
	};

	const syncEmptyStateVisibility = () => {
		emptyStateBox.visible = cards.length === 0;
	};

	// --- Find Bar (⌘F) ---
	const findCountText = new Text({
		text: "",
		fontSize: theme.fontSizeSmall,
		color: theme.textMuted,
	});
	const findInput = new Input({
		placeholder: "Find in transcript...",
		fontSize: theme.fontSizeSmall,
		onChange: (value) => {
			setFindQuery(value);
		},
		onSubmit: () => {
			nextFindMatch();
		},
	});
	const findPrevBtn = new IconButton({
		icon: "chevron-up",
		size: 24,
		iconSize: 13,
		label: "Previous match",
		onClick: () => prevFindMatch(),
	});
	const findNextBtn = new IconButton({
		icon: "chevron-down",
		size: 24,
		iconSize: 13,
		label: "Next match",
		onClick: () => nextFindMatch(),
	});
	const findCloseBtn = new IconButton({
		icon: "close",
		size: 24,
		iconSize: 13,
		label: "Close find bar",
		onClick: () => closeFindBar(),
	});
	const findBar = new Box({
		background: theme.surfaceElevated,
		borderColor: theme.borderStrong,
		borderWidth: 1,
		radius: 10,
		padding: { horizontal: 8, vertical: 6 },
		child: new HStack({
			gap: 6,
			align: "center",
			children: [
				new VectorIcon({ name: "search", size: 13, color: theme.textMuted }),
				findInput,
				findCountText,
				findPrevBtn,
				findNextBtn,
				findCloseBtn,
			],
		}),
	});
	findBar.visible = false;

	const refreshNavMarkers = () => {
		if (cards.length === 0 || (userTurns.length === 0 && !isAgentStreaming)) {
			navRail.setMarkers([], false);
			return;
		}
		const totalCards = Math.max(1, cards.length - 1);
		const markers: NavTickMarker[] = [];
		for (let i = 0; i < userTurns.length; i++) {
			const turn = userTurns[i];
			if (turn === undefined) continue;
			const cardIdx = cards.indexOf(turn.card);
			const ratio = totalCards > 0 && cardIdx >= 0 ? cardIdx / totalCards : i / Math.max(1, userTurns.length);
			const label = turn.snippet.length > 0 ? `Turn ${i + 1}: ${turn.snippet}` : `Turn ${i + 1}`;
			markers.push({ label, ratio, index: i });
		}
		navRail.setMarkers(markers, isAgentStreaming);
	};

	const scrollToTurn = (turnIdx: number) => {
		const turn = userTurns[turnIdx];
		if (turn === undefined) return;
		const stackY = messagesStack.layoutRect.y;
		const targetY = turn.card.root.layoutRect.y - stackY;
		if (Number.isFinite(targetY)) {
			scrollView.scrollTo(Math.max(0, targetY - 12));
		}
		app?.invalidate();
	};

	const navRail = new TranscriptNavRail(scrollToTurn);

	const scrollToBottomBtn = new IconButton({
		icon: "arrow-down",
		size: JUMP_BTN_SIZE,
		iconSize: 15,
		radius: JUMP_BTN_SIZE * 0.5,
		label: "Scroll to bottom",
		onClick: () => {
			scrollView.scrollToEnd();
			app?.invalidate();
		},
	});
	scrollToBottomBtn.visible = false;

	const recomputeSearchMatches = (preserveIndex = false) => {
		const query = currentFindQuery.trim();
		findMatches = [];
		if (query.length > 0) {
			for (let i = 0; i < searchableItems.length; i++) {
				const item = searchableItems[i];
				if (item === undefined) continue;
				if (item.kind === "user") {
					const cnt = item.handle.countSearchMatches(query);
					for (let m = 0; m < cnt; m++) {
						findMatches.push({ item, targetBlock: "text", localMatchIndex: m });
					}
				} else if (item.kind === "turn") {
					const thinkCnt = item.handle.countThinkingMatches(query);
					for (let m = 0; m < thinkCnt; m++) {
						findMatches.push({ item, targetBlock: "thinking", localMatchIndex: m });
					}
					const ansCnt = item.handle.countAnswerMatches(query);
					for (let m = 0; m < ansCnt; m++) {
						findMatches.push({ item, targetBlock: "text", localMatchIndex: m });
					}
				} else {
					const cnt = item.handle.countSearchMatches(query);
					for (let m = 0; m < cnt; m++) {
						findMatches.push({ item, targetBlock: "text", localMatchIndex: m });
					}
				}
			}
		}

		if (findMatches.length === 0) {
			currentFindIndex = 0;
		} else if (!preserveIndex || currentFindIndex >= findMatches.length || currentFindIndex < 0) {
			currentFindIndex = 0;
		}

		const activeMatch = findMatches[currentFindIndex];
		for (let i = 0; i < searchableItems.length; i++) {
			const item = searchableItems[i];
			if (item === undefined) continue;
			const isActiveItem = activeMatch !== undefined && activeMatch.item === item;
			if (item.kind === "user") {
				item.handle.setSearchQuery(query, isActiveItem ? activeMatch.localMatchIndex : undefined);
			} else if (item.kind === "turn") {
				item.handle.setSearchQuery(
					query,
					isActiveItem ? activeMatch.targetBlock : "none",
					isActiveItem ? activeMatch.localMatchIndex : undefined,
				);
			} else {
				item.handle.setSearchQuery(query, isActiveItem ? activeMatch.localMatchIndex : undefined);
			}
		}

		if (query.length === 0) {
			findCountText.setText("");
		} else {
			findCountText.setText(
				findMatches.length > 0 ? `${currentFindIndex + 1} / ${findMatches.length}` : "0 / 0",
			);
		}
	};

	const scrollToCurrentMatch = () => {
		const active = findMatches[currentFindIndex];
		if (active === undefined) return;
		const stackY = messagesStack.layoutRect.y;
		const cardY = active.item.handle.root.layoutRect.y - stackY;
		if (Number.isFinite(cardY) && cardY >= 0) {
			scrollView.scrollTo(Math.max(0, cardY - 64));
		}
	};

	const setFindQuery = (query: string) => {
		currentFindQuery = query;
		if (findInput.getValue() !== query) {
			findInput.setValue(query);
		}
		recomputeSearchMatches(false);
		scrollToCurrentMatch();
		app?.invalidate();
	};

	const nextFindMatch = () => {
		if (findMatches.length === 0) return;
		currentFindIndex = (currentFindIndex + 1) % findMatches.length;
		recomputeSearchMatches(true);
		scrollToCurrentMatch();
		app?.invalidate();
	};

	const prevFindMatch = () => {
		if (findMatches.length === 0) return;
		currentFindIndex = (currentFindIndex - 1 + findMatches.length) % findMatches.length;
		recomputeSearchMatches(true);
		scrollToCurrentMatch();
		app?.invalidate();
	};

	const openFindBar = () => {
		findBarOpen = true;
		findBar.visible = true;
		app?.setFocus(findInput);
		app?.invalidate();
	};

	const closeFindBar = () => {
		findBarOpen = false;
		findBar.visible = false;
		if (currentFindQuery.length > 0) {
			setFindQuery("");
		}
		app?.invalidate();
	};

	const toggleFindBar = () => {
		if (findBarOpen) {
			closeFindBar();
		} else {
			openFindBar();
		}
	};

	const handleShortcutKey = (event: GuiKeyEvent, _ctx: GuiRenderContext): boolean => {
		if (event.phase !== "down") return false;
		if ((event.modifiers.super || event.modifiers.ctrl) && !event.modifiers.alt && event.key.toLowerCase() === "f") {
			openFindBar();
			return true;
		}
		if (findBarOpen && event.key.toLowerCase() === "escape") {
			closeFindBar();
			return true;
		}
		if (findBarOpen && findInput.isFocused() && event.key.toLowerCase() === "enter") {
			if (event.modifiers.shift) {
				prevFindMatch();
			} else {
				nextFindMatch();
			}
			return true;
		}
		return false;
	};

	const appendCard = (card: ThemedCard) => {
		cards.push(card);
		messagesStack.addChild(card.root);
		syncEmptyStateVisibility();
		refreshNavMarkers();
		if (scrollView.isFollowingEnd()) {
			scrollView.scrollToEnd();
		}
		app?.invalidate();
	};

	const removeCard = (card: ThemedCard) => {
		messagesStack.removeChild(card.root);
		const idx = cards.indexOf(card);
		if (idx >= 0) cards.splice(idx, 1);
		for (let i = searchableItems.length - 1; i >= 0; i--) {
			if (searchableItems[i]?.handle === card) {
				searchableItems.splice(i, 1);
			}
		}
		syncEmptyStateVisibility();
		refreshNavMarkers();
	};

	const clearAll = () => {
		cards.length = 0;
		searchableItems.length = 0;
		userTurns.length = 0;
		activeBashCards.clear();
		lastStandaloneBashCard = undefined;
		activeTurnCluster = undefined;
		activeTurnThoughtAccum = "";
		activeTurnTextAccum = "";
		messagesStack.clear();
		syncEmptyStateVisibility();
		refreshNavMarkers();
		if (currentFindQuery.length > 0) {
			recomputeSearchMatches(false);
		}
		app?.invalidate();
	};

	const appendUserBubble = (text: string, attachments?: readonly GuiAttachmentItem[]) => {
		activeTurnCluster = undefined;
		activeTurnThoughtAccum = "";
		activeTurnTextAccum = "";
		lastStandaloneBashCard = undefined;
		const card = createUserMessageCard(theme, text, {
			attachments,
			onFork: options.onForkFromMessage,
		});
		const snippet = text.trim().split(/\r?\n/)[0] ?? "";
		userTurns.push({
			card,
			snippet: snippet.length > 36 ? `${snippet.slice(0, 33)}...` : snippet,
		});
		searchableItems.push({ kind: "user", handle: card });
		appendCard(card);
	};

	const ensureActiveTurnCluster = (): TurnClusterCardHandle => {
		if (activeTurnCluster === undefined) {
			activeTurnThoughtAccum = "";
			activeTurnTextAccum = "";
			const cluster = createTurnClusterCard(theme, {
				onCopyCode: options.onCopyCode,
				onOpenFile: options.onOpenFile,
				onViewDiff: options.onViewDiff,
				onOpenChangedFile: options.onOpenChangedFile,
			});
			activeTurnCluster = cluster;
			searchableItems.push({ kind: "turn", handle: cluster });
			appendCard(cluster);
		}
		return activeTurnCluster;
	};

	const applySnapshot = (snapshot: GuiSessionSnapshot) => {
		clearAll();
		isAgentStreaming = snapshot.status.isStreaming;
		updateEmptyStateStatus(snapshot.status);

		const entries: readonly GuiTranscriptEntry[] = snapshot.transcript;
		let turnCluster: TurnClusterCardHandle | undefined;
		let turnThinking = "";
		let turnText = "";

		const flushCluster = () => {
			if (turnCluster !== undefined && turnCluster.isEmpty()) {
				removeCard(turnCluster);
			}
			turnCluster = undefined;
			turnThinking = "";
			turnText = "";
		};

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry === undefined) continue;
			switch (entry.role) {
				case "user":
					flushCluster();
					appendUserBubble(entry.text, entry.attachments);
					break;

				case "assistant": {
					if (turnCluster === undefined) {
						turnCluster = createTurnClusterCard(theme, {
							onCopyCode: options.onCopyCode,
							onOpenFile: options.onOpenFile,
							onViewDiff: options.onViewDiff,
							onOpenChangedFile: options.onOpenChangedFile,
						});
						searchableItems.push({ kind: "turn", handle: turnCluster });
						appendCard(turnCluster);
					}
					const nextThink = (entry.thinking ?? "").trim();
					if (nextThink.length > 0) {
						turnThinking = turnThinking.length > 0 ? `${turnThinking}\n\n${nextThink}` : nextThink;
					}
					if (entry.text.trim().length > 0) {
						turnText = entry.text;
					}
					const isStillStreamingThisEntry = snapshot.status.isStreaming && i === entries.length - 1;
					const hasFollowupInSameTurn =
						i + 1 < entries.length &&
						(entries[i + 1]?.role === "assistant" || entries[i + 1]?.role === "tool");
					turnCluster.updateTurn({
						thinking: turnThinking,
						text: turnText,
						stopReason: entry.stopReason,
						errorMessage: entry.errorMessage,
						durationMs: entry.turnDurationMs ?? entry.durationMs,
						changedFiles: entry.changedFiles,
						ended: !isStillStreamingThisEntry && !hasFollowupInSameTurn,
					});
					break;
				}

				case "tool": {
					if (turnCluster === undefined) {
						turnCluster = createTurnClusterCard(theme, {
							onCopyCode: options.onCopyCode,
							onOpenFile: options.onOpenFile,
							onViewDiff: options.onViewDiff,
							onOpenChangedFile: options.onOpenChangedFile,
						});
						searchableItems.push({ kind: "turn", handle: turnCluster });
						appendCard(turnCluster);
					}
					const isLastToolStreaming = snapshot.status.isStreaming && i === entries.length - 1 && entry.outputText === undefined;
					turnCluster.upsertTool(entry.toolCallId ?? entry.id, {
						toolName: entry.toolName ?? "tool",
						argsText: entry.argsText ?? "",
						outputText: entry.outputText,
						isError: entry.isError ?? false,
						durationMs: entry.durationMs,
						ended: !isLastToolStreaming,
					});
					turnCluster.updateTurn({ ended: !snapshot.status.isStreaming });
					break;
				}

				case "bash": {
					flushCluster();
					const bashCard = createBashCard(theme, entry);
					appendCard(bashCard);
					break;
				}

				case "compaction": {
					flushCluster();
					const card = createCompactionCard(theme, entry);
					searchableItems.push({ kind: "summary", handle: card });
					appendCard(card);
					break;
				}

				case "branchSummary": {
					flushCluster();
					const card = createBranchSummaryCard(theme, entry);
					searchableItems.push({ kind: "summary", handle: card });
					appendCard(card);
					break;
				}

				case "system": {
					flushCluster();
					appendCard(createBannerCard(theme, "System", entry.text, entry.isError ? "error" : "notice"));
					break;
				}
			}
		}

		if (snapshot.status.isStreaming && turnCluster !== undefined) {
			activeTurnCluster = turnCluster;
			activeTurnThoughtAccum = turnThinking;
			activeTurnTextAccum = turnText;
		} else {
			flushCluster();
		}

		if (currentFindQuery.length > 0) {
			recomputeSearchMatches(false);
		}
		scrollView.scrollToEnd();
		app?.invalidate();
	};

	const handleEvent = (event: GuiControllerEvent) => {
		switch (event.type) {
			case "status_changed": {
				const st = event.status ?? controller.getStatus();
				isAgentStreaming = st.isStreaming;
				updateEmptyStateStatus(st);
				if (!isAgentStreaming && activeTurnCluster !== undefined) {
					activeTurnCluster.updateTurn({ ended: true });
					if (activeTurnCluster.isEmpty()) {
						removeCard(activeTurnCluster);
					}
					activeTurnCluster = undefined;
				}
				refreshNavMarkers();
				app?.invalidate();
				break;
			}

			case "user_message":
				if (event.text !== undefined && (event.text.length > 0 || (event.attachments?.length ?? 0) > 0)) {
					appendUserBubble(event.text, event.attachments);
					if (currentFindQuery.length > 0) recomputeSearchMatches(true);
				}
				break;

			case "assistant_start": {
				isAgentStreaming = true;
				const cluster = ensureActiveTurnCluster();
				const nextThink = event.thinking ?? "";
				const nextText = event.text ?? "";
				if (nextThink.length > 0) {
					activeTurnThoughtAccum =
						activeTurnThoughtAccum.length > 0 ? `${activeTurnThoughtAccum}\n\n${nextThink}` : nextThink;
				}
				if (nextText.length > 0) {
					activeTurnTextAccum = nextText;
				}
				cluster.updateTurn({
					thinking: activeTurnThoughtAccum,
					text: activeTurnTextAccum,
					ended: false,
				});
				refreshNavMarkers();
				if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
				app?.invalidate();
				break;
			}

			case "assistant_update": {
				const cluster = ensureActiveTurnCluster();
				const thinkingUpdate = event.thinking ?? "";
				const textUpdate = event.text ?? "";
				if (thinkingUpdate.length > 0) {
					activeTurnThoughtAccum = thinkingUpdate;
				}
				if (textUpdate.length > 0) {
					activeTurnTextAccum = textUpdate;
				}
				cluster.updateTurn({
					thinking: activeTurnThoughtAccum,
					text: activeTurnTextAccum,
					ended: false,
				});
				if (currentFindQuery.length > 0) recomputeSearchMatches(true);
				if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
				app?.invalidate();
				break;
			}

			case "assistant_end": {
				const cluster = ensureActiveTurnCluster();
				if (event.thinking !== undefined && event.thinking.length > 0) {
					activeTurnThoughtAccum = event.thinking;
				}
				if (event.text !== undefined) {
					activeTurnTextAccum = event.text;
				}
				const continuesLoop = event.stopReason === "toolUse";
				const latestChangedFiles: readonly GuiChangedFile[] | undefined =
					!continuesLoop ? controller.getSnapshot().changedFiles : undefined;
				cluster.updateTurn({
					thinking: activeTurnThoughtAccum,
					text: activeTurnTextAccum,
					stopReason: event.stopReason ?? "stop",
					errorMessage: event.errorMessage ?? "",
					changedFiles: latestChangedFiles && latestChangedFiles.length > 0 ? latestChangedFiles : undefined,
					ended: !continuesLoop,
				});
				if (!continuesLoop) {
					isAgentStreaming = false;
					if (cluster.isEmpty()) {
						removeCard(cluster);
					}
					activeTurnCluster = undefined;
				}
				refreshNavMarkers();
				if (currentFindQuery.length > 0) recomputeSearchMatches(true);
				if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
				app?.invalidate();
				break;
			}

			case "tool_start": {
				const toolCallId = event.toolCallId ?? `tool-${Date.now()}`;
				const toolName = event.toolName ?? "tool";
				const isUserBash =
					toolCallId.startsWith("bash-") ||
					toolCallId.startsWith("mock-bash-") ||
					(activeTurnCluster === undefined && toolName === "bash" && !isAgentStreaming);
				if (isUserBash) {
					const cmdText = event.argsText ?? "";
					const bashCard = createBashCard(theme, { command: cmdText, text: cmdText });
					activeBashCards.set(toolCallId, bashCard);
					lastStandaloneBashCard = bashCard;
					appendCard(bashCard);
					break;
				}
				const cluster = ensureActiveTurnCluster();
				cluster.upsertTool(toolCallId, {
					toolName,
					argsText: event.argsText ?? "",
					ended: false,
				});
				if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
				app?.invalidate();
				break;
			}

			case "tool_update": {
				const toolCallId = event.toolCallId ?? "";
				const bashCard = activeBashCards.get(toolCallId);
				if (bashCard !== undefined) {
					bashCard.update({
						outputText: event.outputText,
						ended: false,
					});
					if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
					app?.invalidate();
					break;
				}
				if (activeTurnCluster !== undefined) {
					activeTurnCluster.upsertTool(toolCallId, {
						toolName: event.toolName ?? "tool",
						argsText: event.argsText,
						outputText: event.outputText,
						ended: false,
					});
					if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
					app?.invalidate();
				}
				break;
			}

			case "tool_end": {
				const toolCallId = event.toolCallId ?? "";
				const bashCard = activeBashCards.get(toolCallId);
				if (bashCard !== undefined) {
					bashCard.update({
						outputText: event.outputText,
						isError: event.isError ?? false,
						durationMs: event.durationMs,
						ended: true,
					});
					activeBashCards.delete(toolCallId);
					if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
					app?.invalidate();
					break;
				}
				if (activeTurnCluster !== undefined) {
					activeTurnCluster.upsertTool(toolCallId, {
						toolName: event.toolName ?? "tool",
						outputText: event.outputText,
						isError: event.isError ?? false,
						durationMs: event.durationMs,
						ended: true,
					});
					if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
					app?.invalidate();
				}
				break;
			}

			case "bash_result": {
				if (lastStandaloneBashCard !== undefined) {
					lastStandaloneBashCard.update({
						command: event.command ?? "",
						outputText: event.outputText ?? "",
						exitCode: event.exitCode,
						isError: event.isError ?? false,
						durationMs: event.durationMs,
						ended: true,
					});
					lastStandaloneBashCard = undefined;
					if (scrollView.isFollowingEnd()) scrollView.scrollToEnd();
					app?.invalidate();
				} else {
					const bashCard = createBashCard(theme, {
						command: event.command ?? "",
						text: event.command ?? "",
						outputText: event.outputText,
						exitCode: event.exitCode,
						isError: event.isError,
						durationMs: event.durationMs,
					});
					appendCard(bashCard);
				}
				break;
			}

			case "error":
				appendCard(
					createBannerCard(
						theme,
						"Error",
						event.errorMessage ?? "An unexpected error occurred.",
						"error",
					),
				);
				break;

			case "session_reset":
			case "snapshot":
				applySnapshot(event.snapshot ?? controller.getSnapshot());
				break;
		}
	};

	const root = new WakuTranscriptViewport({
		scrollView,
		emptyState: emptyStateBox,
		findBar,
		navRail,
		scrollToBottomBtn,
		onBeforeRenderSync: () => {
			scrollToBottomBtn.visible = !scrollView.isFollowingEnd() && scrollView.getMaxScrollY() > 0;
		},
		onShortcut: handleShortcutKey,
	});

	const applyTheme = (nextTheme: GuiTheme) => {
		theme = nextTheme;
		heroMark.setColor(theme.accent);
		heroBadge.setBackground(withAlpha(theme.accent, theme.dark ? 0.14 : 0.1));
		heroBadge.setBorder(withAlpha(theme.accent, theme.dark ? 0.35 : 0.28), 1);
		heroGreeting.setColor(theme.textBright);
		heroSubtitle.setColor(theme.textMuted);
		findBar.setBackground(theme.surfaceElevated);
		findBar.setBorder(theme.borderStrong, 1);
		findCountText.setColor(theme.textMuted);
		for (let i = 0; i < cards.length; i++) {
			cards[i]?.applyTheme(theme);
		}
		root.invalidate();
	};

	applySnapshot(initialSnap);
	const unsubscribe = controller.subscribe(handleEvent);

	return {
		root,
		scrollView,
		messagesStack,
		findInput,
		applyTheme,
		applySnapshot,
		handleEvent,
		openFindBar,
		closeFindBar,
		toggleFindBar,
		isFindBarOpen: () => findBarOpen,
		setFindQuery,
		nextFindMatch,
		prevFindMatch,
		getFindMatchInfo: () => ({
			current: findMatches.length > 0 ? currentFindIndex + 1 : 0,
			total: findMatches.length,
		}),
		handleShortcutKey,
		scrollToTurn,
		scrollToEnd: () => {
			scrollView.scrollToEnd();
			app?.invalidate();
		},
		isShowingEmptyState: () => emptyStateBox.visible,
		dispose: () => {
			unsubscribe();
		},
	};
}
