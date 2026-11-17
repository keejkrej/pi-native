import {
	type Component,
	type ComponentLike,
	type OverlayHandle,
	type OverlayOptions,
	ProcessTerminal,
	type Terminal,
	type TerminalColorScheme,
	type TerminalColors,
	TUI,
	TuiAltScreen,
	type TuiInputListener,
	TuiMainScreen,
	type TuiMode,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	type TuiStopOptions,
	type WheelScrollLines,
} from "@pi-ts/tui";
import { copyToClipboard } from "../../utils/clipboard.ts";
import { openBrowser } from "../../utils/open-browser.ts";
import { keyDisplayText } from "./components/keybinding-hints.ts";
import { theme } from "./theme/theme.ts";

export interface InteractiveTuiOptions {
	readonly tuiMode: "regular" | "fullscreen";
	readonly showHardwareCursor: boolean;
	readonly logDirectory: string;
	readonly terminal?: Terminal;
	readonly onRightClickPaste?: () => void;
	readonly fullscreenCopyOnSelect?: boolean;
	readonly fullscreenWheelScrollLines?: WheelScrollLines;
}

/** Composition root shared by coding-agent presentations. */
export function createInteractiveTui(options: InteractiveTuiOptions & { readonly tuiMode: "fullscreen" }): TuiAltScreen;
export function createInteractiveTui(options: InteractiveTuiOptions & { readonly tuiMode: "regular" }): TuiMainScreen;
export function createInteractiveTui(options: InteractiveTuiOptions): TuiMainScreen | TuiAltScreen;
export function createInteractiveTui(options: InteractiveTuiOptions): TuiMainScreen | TuiAltScreen {
	const terminal = options.terminal ?? new ProcessTerminal();
	if (options.tuiMode === "fullscreen") {
		const styleSearchMatch = (text: string) => theme.bg("searchMatchBg", theme.fg("searchMatchText", text));
		return new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, {
			searchMatchStyle: (text) => theme.underline(styleSearchMatch(text)),
			searchCurrentMatchStyle: (text) => theme.bold(theme.inverse(styleSearchMatch(text))),
			searchNavigationButtonStyle: (text, hovered) => (hovered ? theme.underline(text) : text),
			scrollToEndIndicator: () => {
				const shortcut = keyDisplayText("tui.altScreen.bottom");
				const label = ` ↓ Jump to latest message${shortcut ? ` · ${shortcut}` : ""} `;
				return theme.bg("selectedBg", theme.fg("text", label));
			},
			openUrl: openBrowser,
			onRightClickPaste: options.onRightClickPaste,
			copyOnSelect: options.fullscreenCopyOnSelect,
			wheelScrollLines: options.fullscreenWheelScrollLines ?? "auto",
			copySelection: async (text) => {
				try {
					await copyToClipboard(text);
					return true;
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			},
		});
	}
	return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}

class InteractiveTuiReference extends TUI {
	private readonly getTui: () => TUI;

	constructor(getTui: () => TUI) {
		super();
		this.getTui = getTui;
		// Bind forwarding closures on the instance so detached method references
		// (e.g. `const requestRender = tui.requestRender`) always route through `getTui()`.
		this.addChild = (component: Component | ComponentLike) => this.getTui().addChild(component);
		this.removeChild = (component: Component | ComponentLike) => this.getTui().removeChild(component);
		this.clear = () => this.getTui().clear();
		this.invalidate = () => this.getTui().invalidate();
		this.isLayoutContainerDefaultMouse = () => this.getTui().isLayoutContainerDefaultMouse();
		this.handleMouse = (event: TuiMouseEvent) => this.getTui().handleMouse(event);
		this.render = (width: number) => this.getTui().render(width);
		this.getShowHardwareCursor = () => this.getTui().getShowHardwareCursor();
		this.setShowHardwareCursor = (enabled: boolean) => this.getTui().setShowHardwareCursor(enabled);
		this.getClearOnShrink = () => this.getTui().getClearOnShrink();
		this.setClearOnShrink = (enabled: boolean) => this.getTui().setClearOnShrink(enabled);
		this.getFocusedComponent = () => this.getTui().getFocusedComponent();
		this.setFocus = (component: Component | ComponentLike | null) => this.getTui().setFocus(component);
		this.showOverlay = (component: Component | ComponentLike, options?: OverlayOptions) =>
			this.getTui().showOverlay(component, options);
		this.hideOverlay = () => this.getTui().hideOverlay();
		this.hasOverlay = () => this.getTui().hasOverlay();
		this.start = () => this.getTui().start();
		this.stop = (options?: TuiStopOptions) => this.getTui().stop(options);
		this.renderNow = (force?: boolean) => this.getTui().renderNow(force);
		this.requestRender = (force?: boolean) => this.getTui().requestRender(force);
		this.addInputListener = (listener: TuiInputListener) => this.getTui().addInputListener(listener);
		this.removeInputListener = (listener: TuiInputListener) => this.getTui().removeInputListener(listener);
		this.onTerminalColorSchemeChange = (listener: (scheme: TerminalColorScheme) => void) =>
			this.getTui().onTerminalColorSchemeChange(listener);
		this.setTerminalColorSchemeNotifications = (enabled: boolean) =>
			this.getTui().setTerminalColorSchemeNotifications(enabled);
		this.queryTerminalColors = (options: {
			timeoutMs: number;
			onLateReply?: (colors: TerminalColors) => void;
		}) => this.getTui().queryTerminalColors(options);
		this.isViewport = () => this.getTui().isViewport();
		this.setLayoutRoot = (component: Component | ComponentLike | undefined) => this.getTui().setLayoutRoot(component);
	}

	override get mode(): TuiMode {
		return this.getTui().mode;
	}

	override get children(): Component[] {
		return this.getTui().children;
	}

	override set children(value: Component[]) {
		this.getTui().children = value;
	}

	override get terminal(): Terminal {
		return this.getTui().terminal;
	}

	override set terminal(value: Terminal) {
		this.getTui().terminal = value;
	}

	override get onDebug(): (() => void) | undefined {
		return this.getTui().onDebug;
	}

	override set onDebug(value: (() => void) | undefined) {
		this.getTui().onDebug = value;
	}

	override get fullRedraws(): number {
		return this.getTui().fullRedraws;
	}

	override addChild(component: Component | ComponentLike): void {
		this.getTui().addChild(component);
	}

	override removeChild(component: Component | ComponentLike): void {
		this.getTui().removeChild(component);
	}

	override clear(): void {
		this.getTui().clear();
	}

	override invalidate(): void {
		this.getTui().invalidate();
	}

	override isLayoutContainerDefaultMouse(): boolean {
		return this.getTui().isLayoutContainerDefaultMouse();
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return this.getTui().handleMouse(event);
	}

	override render(width: number): string[] {
		return this.getTui().render(width);
	}

	override getShowHardwareCursor(): boolean {
		return this.getTui().getShowHardwareCursor();
	}

	override setShowHardwareCursor(enabled: boolean): void {
		this.getTui().setShowHardwareCursor(enabled);
	}

	override getClearOnShrink(): boolean {
		return this.getTui().getClearOnShrink();
	}

	override setClearOnShrink(enabled: boolean): void {
		this.getTui().setClearOnShrink(enabled);
	}

	override getFocusedComponent(): Component | null {
		return this.getTui().getFocusedComponent();
	}

	override setFocus(component: Component | ComponentLike | null): void {
		this.getTui().setFocus(component);
	}

	override showOverlay(component: Component | ComponentLike, options?: OverlayOptions): OverlayHandle {
		return this.getTui().showOverlay(component, options);
	}

	override hideOverlay(): void {
		this.getTui().hideOverlay();
	}

	override hasOverlay(): boolean {
		return this.getTui().hasOverlay();
	}

	override start(): void {
		this.getTui().start();
	}

	override stop(options?: TuiStopOptions): void {
		this.getTui().stop(options);
	}

	override renderNow(force?: boolean): void {
		this.getTui().renderNow(force);
	}

	override requestRender(force?: boolean): void {
		this.getTui().requestRender(force);
	}

	override addInputListener(listener: TuiInputListener): () => void {
		return this.getTui().addInputListener(listener);
	}

	override removeInputListener(listener: TuiInputListener): void {
		this.getTui().removeInputListener(listener);
	}

	override onTerminalColorSchemeChange(listener: (scheme: TerminalColorScheme) => void): () => void {
		return this.getTui().onTerminalColorSchemeChange(listener);
	}

	override setTerminalColorSchemeNotifications(enabled: boolean): void {
		this.getTui().setTerminalColorSchemeNotifications(enabled);
	}

	override queryTerminalColors(options: {
		timeoutMs: number;
		onLateReply?: (colors: TerminalColors) => void;
	}): Promise<TerminalColors> {
		return this.getTui().queryTerminalColors(options);
	}

	override isViewport(): boolean {
		return this.getTui().isViewport();
	}

	override setLayoutRoot(component: Component | ComponentLike | undefined): void {
		this.getTui().setLayoutRoot(component);
	}
}

/** Stable reference for components while InteractiveMode replaces the active renderer. */
export function createInteractiveTuiReference(getTui: () => TUI): TUI {
	return new InteractiveTuiReference(getTui);
}
