/**
 * Core GUI application loop, window host, hit-testing, focus traversal, IME/clipboard routing, and overlays.
 */

import type { GuiBackend, WindowMetrics, WindowOptions } from "./backend.ts";
import { type Color, packRgba, withAlpha } from "./colors.ts";
import {
	clampNumber,
	drawElevationShadow,
	type Edges,
	type GuiComponent,
	GuiHost,
	type GuiPointerEvent,
	GuiRenderContext,
	normalizeEdges,
	type PaddingInput,
	pointInRect,
	type Rect,
	type ShadowLevel,
} from "./component.ts";
import { ScrollView } from "./components/scroll-view.ts";
import { type EditorKeybindingAction, type GuiKeybindingsConfig, KeybindingsManager } from "./keybindings.ts";
import { decodeModifiers, type GuiKeyEvent, parseKeyChord } from "./keys.ts";
import { Box, Container, HStack, VStack } from "./layout.ts";
import {
	type CursorKindId,
	DrawCommandWriter,
	type GuiA11yNode,
	type GuiNativeEvent,
	type MenuItemSpec,
	type MenuSpec,
	SGUI_CURSOR_ARROW,
} from "./protocol.ts";
import { darkGuiTheme, type GuiTheme, lightGuiTheme } from "./theme.ts";

export type OverlayAnchor =
	| "center"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right"
	| "top-center"
	| "bottom-center";

export interface OverlayOptions {
	readonly anchor?: OverlayAnchor;
	readonly anchorRect?: Rect;
	readonly width?: number | string;
	readonly maxWidth?: number;
	readonly maxHeight?: number;
	readonly margin?: PaddingInput;
	readonly offsetX?: number;
	readonly offsetY?: number;
	readonly modal?: boolean;
	readonly radius?: number;
	readonly shadow?: ShadowLevel | false;
	readonly dismissOnBackdropClick?: boolean;
	readonly dismissOnEscape?: boolean;
	readonly backdropColor?: Color;
	readonly onDismiss?: () => void;
}

export interface OverlayHandle {
	hide(): void;
	setHidden(hidden: boolean): void;
	isHidden(): boolean;
	focus(): void;
	dispose(): void;
}

interface OverlayEntry {
	readonly component: GuiComponent;
	readonly options: OverlayOptions;
	hidden: boolean;
	rect: Rect;
	previousFocus: GuiComponent | undefined;
}

export interface GuiAppOptions {
	readonly backend: GuiBackend;
	readonly window?: WindowOptions;
	readonly theme?: GuiTheme | "auto";
	readonly keybindings?: GuiKeybindingsConfig | KeybindingsManager;
	readonly root?: GuiComponent;
	readonly menus?: readonly MenuSpec[];
	readonly frameIntervalMs?: number;
	readonly onClose?: () => boolean | undefined;
	readonly onKey?: (event: GuiKeyEvent, ctx: GuiRenderContext) => boolean;
}

function parseWidthSpec(spec: number | string | undefined, availableWidth: number): number | undefined {
	if (spec === undefined) return undefined;
	if (typeof spec === "number") return spec;
	const trimmed = spec.trim();
	if (trimmed.endsWith("%")) {
		const pct = Number.parseFloat(trimmed.slice(0, -1));
		if (Number.isFinite(pct)) {
			return Math.max(0, (pct / 100) * availableWidth);
		}
	}
	const px = Number.parseFloat(trimmed);
	return Number.isFinite(px) ? px : undefined;
}

class GuiAppHost extends GuiHost {
	private readonly app: GuiApp;

	constructor(app: GuiApp) {
		super();
		this.app = app;
	}

	invalidate(component?: GuiComponent): void {
		this.app.invalidate(component);
	}

	requestFocus(component: GuiComponent | undefined): void {
		this.app.setFocus(component);
	}

	isFocused(component: GuiComponent): boolean {
		return this.app.isComponentFocused(component);
	}

	isHovered(component: GuiComponent): boolean {
		return this.app.isComponentHovered(component);
	}

	getClipboardText(): string {
		return this.app.backend.getClipboardText();
	}

	setClipboardText(text: string): void {
		this.app.backend.setClipboardText(text);
	}

	setImeRect(x: number, y: number, width: number, height: number): void {
		this.app.updateImeRect(x, y, width, height);
	}
}

export class GuiApp {
	readonly backend: GuiBackend;
	readonly windowId: number;
	readonly keybindings: KeybindingsManager;

	private readonly host: GuiAppHost;
	private readonly writer: DrawCommandWriter;
	private readonly autoTheme: boolean;
	private readonly frameIntervalMs: number;
	private readonly onCloseCallback: (() => boolean | undefined) | undefined;
	private readonly onKeyCallback: ((event: GuiKeyEvent, ctx: GuiRenderContext) => boolean) | undefined;

	private themeValue: GuiTheme;
	private rootComponent: GuiComponent | undefined;
	private readonly overlays: OverlayEntry[];
	private focusedComponent: GuiComponent | undefined;
	private hoveredComponent: GuiComponent | undefined;
	private capturedComponent: GuiComponent | undefined;
	private activeCursor: CursorKindId;
	private lastImeKey: string;

	private metrics: WindowMetrics;
	private needsRender: boolean;
	private running: boolean;
	private disposed: boolean;

	constructor(options: GuiAppOptions) {
		this.backend = options.backend;
		this.backend.init();

		const winOpts: WindowOptions = options.window ?? {
			title: "scriptc-ui",
			width: 1024,
			height: 720,
			resizable: true,
		};
		this.windowId = this.backend.createWindow(winOpts);
		this.metrics = this.backend.getWindowMetrics(this.windowId);

		if (options.theme === undefined || options.theme === "auto") {
			this.autoTheme = true;
			this.themeValue = this.metrics.darkMode ? darkGuiTheme : lightGuiTheme;
		} else {
			this.autoTheme = false;
			this.themeValue = options.theme;
		}

		if (options.keybindings instanceof KeybindingsManager) {
			this.keybindings = options.keybindings;
		} else {
			this.keybindings = new KeybindingsManager(options.keybindings ?? {}, this.backend.platform);
		}

		this.host = new GuiAppHost(this);
		this.writer = new DrawCommandWriter();
		this.frameIntervalMs = options.frameIntervalMs ?? 8;
		this.onCloseCallback = options.onClose;
		this.onKeyCallback = options.onKey;
		this.overlays = [];
		this.rootComponent = undefined;
		this.focusedComponent = undefined;
		this.hoveredComponent = undefined;
		this.capturedComponent = undefined;
		this.activeCursor = SGUI_CURSOR_ARROW;
		this.lastImeKey = "";
		this.needsRender = true;
		this.running = false;
		this.disposed = false;

		if (options.menus !== undefined) {
			this.setAppMenu(options.menus);
		}
		if (options.root !== undefined) {
			this.setRoot(options.root);
		}
	}

	getTheme(): GuiTheme {
		return this.themeValue;
	}

	setTheme(theme: GuiTheme): void {
		this.themeValue = theme;
		this.rootComponent?.onThemeChange(theme);
		for (let i = 0; i < this.overlays.length; i++) {
			const entry = this.overlays[i];
			if (entry !== undefined) {
				entry.component.onThemeChange(theme);
			}
		}
		this.needsRender = true;
	}

	getWindowMetrics(): WindowMetrics {
		return this.metrics;
	}

	setTitle(title: string): void {
		this.backend.setWindowTitle(this.windowId, title);
	}

	setAppMenu(menus: readonly MenuSpec[]): void {
		const normalized: MenuSpec[] = [];
		for (let i = 0; i < menus.length; i++) {
			const menu = menus[i];
			if (menu === undefined) continue;
			normalized.push({
				title: menu.title,
				items: this.normalizeMenuItems(menu.items),
			});
		}
		this.backend.setAppMenu(normalized);
	}

	private dispatchEditorMenuRole(action: EditorKeybindingAction): void {
		const keyId = this.keybindings.getKeys(action)[0];
		if (keyId === undefined || !this.focusedComponent?.visible) {
			return;
		}
		const parsed = parseKeyChord(keyId, this.backend.platform);
		const synthetic: GuiKeyEvent = {
			phase: "down",
			keyCode: 0,
			key: parsed.key,
			modifiers: {
				shift: parsed.shift,
				ctrl: parsed.ctrl,
				alt: parsed.alt,
				super: parsed.super,
			},
		};
		if (this.focusedComponent.handleKey(synthetic, this.createRenderContext())) {
			this.invalidate();
		}
	}

	private normalizeMenuItems(items: readonly MenuItemSpec[]): MenuItemSpec[] {
		const out: MenuItemSpec[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item === undefined) continue;
			if (item.kind === "submenu") {
				out.push({
					kind: "submenu",
					label: item.label,
					disabled: item.disabled,
					items: this.normalizeMenuItems(item.items),
				});
			} else if (item.kind === "action" && item.onSelect === undefined) {
				const role = item.role;
				if (
					role === "undo" ||
					role === "redo" ||
					role === "cut" ||
					role === "copy" ||
					role === "paste" ||
					role === "selectAll"
				) {
					const actionRole: EditorKeybindingAction = role;
					out.push({
						kind: "action",
						label: item.label,
						shortcut: item.shortcut,
						disabled: item.disabled,
						checked: item.checked,
						role: item.role,
						onSelect: () => {
							this.dispatchEditorMenuRole(actionRole);
						},
					});
				} else if (role === "quit" || role === "close") {
					out.push({
						kind: "action",
						label: item.label,
						shortcut: item.shortcut,
						disabled: item.disabled,
						checked: item.checked,
						role: item.role,
						onSelect: () => {
							this.requestClose();
						},
					});
				} else {
					out.push(item);
				}
			} else {
				out.push(item);
			}
		}
		return out;
	}

	getRoot(): GuiComponent | undefined {
		return this.rootComponent;
	}

	setRoot(component: GuiComponent | undefined): void {
		if (this.rootComponent !== undefined && this.rootComponent !== component) {
			this.rootComponent.attachHost(undefined);
		}
		this.rootComponent = component;
		if (this.rootComponent !== undefined) {
			this.rootComponent.attachHost(this.host);
		}
		this.capturedComponent = undefined;
		this.hoveredComponent = undefined;
		this.needsRender = true;
	}

	invalidate(_component?: GuiComponent): void {
		this.needsRender = true;
	}

	getFocus(): GuiComponent | undefined {
		return this.focusedComponent;
	}

	setFocus(component: GuiComponent | undefined): void {
		const target = component?.focusable && component.visible ? component : undefined;
		if (this.focusedComponent === target) {
			return;
		}
		const prev = this.focusedComponent;
		this.focusedComponent = target;
		prev?.onFocusChange(false);
		target?.onFocusChange(true);
		this.needsRender = true;
	}

	isComponentFocused(component: GuiComponent): boolean {
		return this.focusedComponent === component && this.metrics.focused;
	}

	isComponentHovered(component: GuiComponent): boolean {
		return this.hoveredComponent === component;
	}

	updateImeRect(x: number, y: number, width: number, height: number): void {
		const key = `${Math.round(x)}:${Math.round(y)}:${Math.round(width)}:${Math.round(height)}`;
		if (key === this.lastImeKey) {
			return;
		}
		this.lastImeKey = key;
		this.backend.setImeRect(this.windowId, x, y, width, height);
	}

	showOverlay(component: GuiComponent, options: OverlayOptions = {}): OverlayHandle {
		const entry: OverlayEntry = {
			component,
			options,
			hidden: false,
			rect: { x: 0, y: 0, width: 0, height: 0 },
			previousFocus: this.focusedComponent,
		};
		component.attachHost(this.host);
		this.overlays.push(entry);

		// Focus first focusable inside modal overlay if available
		const focusables: GuiComponent[] = [];
		component.collectFocusables(focusables);
		const firstFocus = focusables[0];
		if (firstFocus !== undefined) {
			this.setFocus(firstFocus);
		}
		this.needsRender = true;

		const dismiss = (): void => {
			const idx = this.overlays.indexOf(entry);
			if (idx === -1) return;
			this.overlays.splice(idx, 1);
			component.attachHost(undefined);
			if (this.capturedComponent === component) {
				this.capturedComponent = undefined;
			}
			if (entry.previousFocus?.visible) {
				this.setFocus(entry.previousFocus);
			} else if (this.focusedComponent !== undefined) {
				// Clear stale focus if it was inside removed overlay
				const activeFocusables = this.collectActiveFocusables();
				if (!activeFocusables.includes(this.focusedComponent)) {
					this.setFocus(activeFocusables[0]);
				}
			}
			options.onDismiss?.();
			this.needsRender = true;
		};

		return {
			hide: () => {
				dismiss();
			},
			setHidden: (hidden: boolean) => {
				if (entry.hidden !== hidden) {
					entry.hidden = hidden;
					this.needsRender = true;
				}
			},
			isHidden: () => entry.hidden,
			focus: () => {
				const items: GuiComponent[] = [];
				component.collectFocusables(items);
				if (items[0] !== undefined) {
					this.setFocus(items[0]);
				}
			},
			dispose: dismiss,
		};
	}

	private createRenderContext(): GuiRenderContext {
		return new GuiRenderContext({
			backend: this.backend,
			theme: this.themeValue,
			keybindings: this.keybindings,
			writer: this.writer,
			scale: this.metrics.scale,
			windowFocused: this.metrics.focused,
			nowMs: Date.now(),
			host: this.host,
		});
	}

	private visibleOverlays(): OverlayEntry[] {
		const out: OverlayEntry[] = [];
		for (let i = 0; i < this.overlays.length; i++) {
			const entry = this.overlays[i];
			if (entry !== undefined && !entry.hidden && entry.component.visible) {
				out.push(entry);
			}
		}
		return out;
	}

	private topmostModalOverlay(visibleList: readonly OverlayEntry[]): OverlayEntry | undefined {
		for (let i = visibleList.length - 1; i >= 0; i--) {
			const entry = visibleList[i];
			if (entry !== undefined && entry.options.modal) {
				return entry;
			}
		}
		return undefined;
	}

	private computeOverlayRect(ctx: GuiRenderContext, entry: OverlayEntry): Rect {
		const opts = entry.options;
		const margin: Edges = normalizeEdges(opts.margin ?? 16);
		const availW = Math.max(0, this.metrics.width - margin.left - margin.right);
		const availH = Math.max(0, this.metrics.height - margin.top - margin.bottom);

		let targetW = parseWidthSpec(opts.width, availW);
		const maxW = opts.maxWidth !== undefined ? Math.min(availW, opts.maxWidth) : availW;
		const maxH = opts.maxHeight !== undefined ? Math.min(availH, opts.maxHeight) : availH;
		if (targetW !== undefined) {
			targetW = clampNumber(targetW, 0, maxW);
		}

		const measured = entry.component.measure(ctx, targetW ?? maxW, maxH);
		const w = clampNumber(targetW ?? measured.width, 0, maxW);
		const h = clampNumber(measured.height, 0, maxH);

		let x = margin.left + (availW - w) * 0.5;
		let y = margin.top + (availH - h) * 0.5;

		if (opts.anchorRect !== undefined) {
			x = clampNumber(opts.anchorRect.x, margin.left, Math.max(margin.left, this.metrics.width - margin.right - w));
			const belowY = opts.anchorRect.y + opts.anchorRect.height + 4;
			if (belowY + h <= this.metrics.height - margin.bottom) {
				y = belowY;
			} else {
				y = clampNumber(
					opts.anchorRect.y - h - 4,
					margin.top,
					Math.max(margin.top, this.metrics.height - margin.bottom - h),
				);
			}
		} else {
			switch (opts.anchor ?? "center") {
				case "top-left":
					x = margin.left;
					y = margin.top;
					break;
				case "top-center":
					x = margin.left + (availW - w) * 0.5;
					y = margin.top;
					break;
				case "top-right":
					x = this.metrics.width - margin.right - w;
					y = margin.top;
					break;
				case "bottom-left":
					x = margin.left;
					y = this.metrics.height - margin.bottom - h;
					break;
				case "bottom-center":
					x = margin.left + (availW - w) * 0.5;
					y = this.metrics.height - margin.bottom - h;
					break;
				case "bottom-right":
					x = this.metrics.width - margin.right - w;
					y = this.metrics.height - margin.bottom - h;
					break;
				default:
					break;
			}
		}

		x += opts.offsetX ?? 0;
		y += opts.offsetY ?? 0;
		return { x, y, width: w, height: h };
	}

	renderFrame(): Uint8Array {
		if (this.disposed) {
			return new Uint8Array(0);
		}
		this.metrics = this.backend.getWindowMetrics(this.windowId);
		const ctx = this.createRenderContext();
		this.writer.reset();
		this.writer.clear(packRgba(this.themeValue.background));

		if (this.rootComponent?.visible) {
			const rootRect: Rect = {
				x: 0,
				y: 0,
				width: this.metrics.width,
				height: this.metrics.height,
			};
			this.rootComponent.layout(ctx, rootRect);
			this.rootComponent.render(ctx);
		}

		const visible = this.visibleOverlays();
		for (let i = 0; i < visible.length; i++) {
			const entry = visible[i];
			if (entry === undefined) continue;
			if (entry.options.modal) {
				const backdrop =
					entry.options.backdropColor ??
					withAlpha(this.themeValue.shadow, this.themeValue.dark ? 0.56 : 0.34);
				ctx.fillRect(0, 0, this.metrics.width, this.metrics.height, backdrop);
			}
			const rect = this.computeOverlayRect(ctx, entry);
			entry.rect = rect;
			entry.component.layout(ctx, rect);
			const box = entry.component instanceof Box ? entry.component : undefined;
			const overlayRadius =
				entry.options.radius ??
				(box !== undefined ? box.getRadius() : undefined) ??
				(entry.options.modal ? this.themeValue.radiusLarge : this.themeValue.radiusMedium);
			const shadowSetting = entry.options.shadow;
			if (shadowSetting !== false && !(box !== undefined && box.hasShadow())) {
				const level: ShadowLevel = shadowSetting ?? (entry.options.modal ? "lg" : "md");
				drawElevationShadow(ctx, rect, overlayRadius, level);
			}
			if (box === undefined || !box.hasBackground()) {
				ctx.fillRect(rect.x, rect.y, rect.width, rect.height, this.themeValue.surfaceElevated, overlayRadius);
			}
			entry.component.render(ctx);
			if (box === undefined || !box.hasBorder()) {
				ctx.strokeRect(
					rect.x,
					rect.y,
					rect.width,
					rect.height,
					withAlpha(this.themeValue.border, this.themeValue.dark ? 0.9 : 0.8),
					1,
					overlayRadius,
				);
			}
		}

		const frameBytes = this.writer.finish();
		this.backend.present(this.windowId, frameBytes);
		const a11yNodes = this.collectActiveA11yNodes(visible, ctx);
		this.backend.setAccessibilityTree(this.windowId, a11yNodes);
		this.needsRender = false;
		return frameBytes;
	}

	private collectActiveA11yNodes(visible: readonly OverlayEntry[], ctx: GuiRenderContext): GuiA11yNode[] {
		const out: GuiA11yNode[] = [];
		const modal = this.topmostModalOverlay(visible);
		if (modal !== undefined) {
			modal.component.collectAccessibilityNodes(out, ctx);
			return out;
		}
		if (this.rootComponent?.visible) {
			this.rootComponent.collectAccessibilityNodes(out, ctx);
		}
		for (let i = 0; i < visible.length; i++) {
			const entry = visible[i];
			if (entry !== undefined) {
				entry.component.collectAccessibilityNodes(out, ctx);
			}
		}
		return out;
	}

	private findActiveComponentByA11yId(nodeId: number): GuiComponent | undefined {
		const visible = this.visibleOverlays();
		const modal = this.topmostModalOverlay(visible);
		if (modal !== undefined) {
			return modal.component.findComponentByA11yId(nodeId);
		}
		for (let i = visible.length - 1; i >= 0; i--) {
			const entry = visible[i];
			if (entry !== undefined) {
				const found = entry.component.findComponentByA11yId(nodeId);
				if (found !== undefined) {
					return found;
				}
			}
		}
		return this.rootComponent?.visible ? this.rootComponent.findComponentByA11yId(nodeId) : undefined;
	}

	private collectActiveFocusables(): GuiComponent[] {
		const visible = this.visibleOverlays();
		const modal = this.topmostModalOverlay(visible);
		const out: GuiComponent[] = [];
		if (modal !== undefined) {
			modal.component.collectFocusables(out);
			return out;
		}
		this.rootComponent?.collectFocusables(out);
		for (let i = 0; i < visible.length; i++) {
			const entry = visible[i];
			if (entry !== undefined) {
				entry.component.collectFocusables(out);
			}
		}
		return out;
	}

	private findPrimaryScrollView(component: GuiComponent | undefined): ScrollView | undefined {
		if (component === undefined || !component.visible) return undefined;
		if (component instanceof ScrollView) {
			if (component.primary) return component;
			const nested = this.findPrimaryScrollView(component.getChild());
			return nested ?? component;
		}
		if (component instanceof Box) {
			return this.findPrimaryScrollView(component.getChild());
		}
		if (component instanceof Container || component instanceof VStack || component instanceof HStack) {
			const children = component.getChildren();
			for (let i = 0; i < children.length; i++) {
				const child = children[i];
				if (child !== undefined) {
					const found = this.findPrimaryScrollView(child);
					if (found !== undefined) return found;
				}
			}
		}
		return undefined;
	}

	private hitTestActiveTree(
		x: number,
		y: number,
	): { target: GuiComponent | undefined; modalBlocked: OverlayEntry | undefined } {
		const visible = this.visibleOverlays();
		for (let i = visible.length - 1; i >= 0; i--) {
			const entry = visible[i];
			if (entry === undefined) continue;
			if (pointInRect(x, y, entry.rect)) {
				const hit = entry.component.hitTest(x, y);
				if (hit !== undefined) {
					return { target: hit, modalBlocked: undefined };
				}
			}
			if (entry.options.modal) {
				return { target: undefined, modalBlocked: entry };
			}
		}
		if (this.rootComponent?.visible) {
			return { target: this.rootComponent.hitTest(x, y), modalBlocked: undefined };
		}
		return { target: undefined, modalBlocked: undefined };
	}

	private setCursorIfChanged(cursor: CursorKindId): void {
		if (this.activeCursor !== cursor) {
			this.activeCursor = cursor;
			this.backend.setCursor(this.windowId, cursor);
		}
	}

	private updateHover(nextHovered: GuiComponent | undefined): void {
		if (this.hoveredComponent === nextHovered) {
			return;
		}
		const prev = this.hoveredComponent;
		this.hoveredComponent = nextHovered;
		prev?.onHoverChange(false);
		nextHovered?.onHoverChange(true);
		this.needsRender = true;
	}

	private dismissOverlayEntry(entry: OverlayEntry): void {
		const idx = this.overlays.indexOf(entry);
		if (idx === -1) return;
		this.overlays.splice(idx, 1);
		entry.component.attachHost(undefined);
		if (entry.previousFocus?.visible) {
			this.setFocus(entry.previousFocus);
		}
		entry.options.onDismiss?.();
		this.needsRender = true;
	}

	private handlePointerEvent(raw: Extract<GuiNativeEvent, { kind: "pointer" }>, ctx: GuiRenderContext): void {
		const pointerEvt: GuiPointerEvent = {
			phase: raw.phase,
			button: raw.button,
			clickCount: raw.clickCount,
			x: raw.x,
			y: raw.y,
			modifiers: decodeModifiers(raw.modifiers),
		};

		if (raw.phase === "leave") {
			if (this.hoveredComponent !== undefined) {
				this.hoveredComponent.handlePointer(pointerEvt, ctx);
				this.updateHover(undefined);
			}
			this.setCursorIfChanged(SGUI_CURSOR_ARROW);
			return;
		}

		if (this.capturedComponent !== undefined) {
			const res = this.capturedComponent.handlePointer(pointerEvt, ctx);
			if (res.cursor !== undefined) {
				this.setCursorIfChanged(res.cursor);
			}
			if (res.releaseCapture || (raw.phase === "up" && res.capture === undefined)) {
				this.capturedComponent = undefined;
				const hit = this.hitTestActiveTree(raw.x, raw.y);
				this.updateHover(hit.target);
				this.setCursorIfChanged(hit.target?.cursor ?? SGUI_CURSOR_ARROW);
			}
			return;
		}

		const { target, modalBlocked } = this.hitTestActiveTree(raw.x, raw.y);
		this.updateHover(target);

		if (modalBlocked !== undefined) {
			this.setCursorIfChanged(SGUI_CURSOR_ARROW);
			if (raw.phase === "down" && modalBlocked.options.dismissOnBackdropClick !== false) {
				this.dismissOverlayEntry(modalBlocked);
			}
			return;
		}

		let cursor: CursorKindId = target?.cursor ?? SGUI_CURSOR_ARROW;
		let current: GuiComponent | undefined = target;
		while (current !== undefined) {
			const res = current.handlePointer(pointerEvt, ctx);
			if (res.cursor !== undefined) {
				cursor = res.cursor;
			}
			if (res.focus !== undefined) {
				this.setFocus(res.focus);
			}
			if (res.capture !== undefined && raw.phase !== "up") {
				this.capturedComponent = res.capture;
			}
			if (res.handled) {
				this.setCursorIfChanged(cursor);
				return;
			}
			current = current.parent;
		}

		if (raw.phase === "down" && raw.button === "left") {
			this.setFocus(undefined);
		}
		this.setCursorIfChanged(cursor);
	}

	private handleScrollEvent(raw: Extract<GuiNativeEvent, { kind: "scroll" }>, ctx: GuiRenderContext): void {
		const scrollEvt = {
			x: raw.x,
			y: raw.y,
			deltaX: raw.deltaX,
			deltaY: raw.deltaY,
			modifiers: decodeModifiers(raw.modifiers),
		};
		const { target } = this.hitTestActiveTree(raw.x, raw.y);
		let current: GuiComponent | undefined = target;
		while (current !== undefined) {
			if (current.handleScroll(scrollEvt, ctx)) {
				return;
			}
			current = current.parent;
		}
	}

	private cycleFocus(reverse: boolean): void {
		const focusables = this.collectActiveFocusables();
		if (focusables.length === 0) return;
		if (this.focusedComponent === undefined) {
			const first = reverse ? focusables[focusables.length - 1] : focusables[0];
			this.setFocus(first);
			return;
		}
		const idx = focusables.indexOf(this.focusedComponent);
		if (idx === -1) {
			this.setFocus(focusables[0]);
			return;
		}
		const delta = reverse ? -1 : 1;
		const nextIdx = (idx + delta + focusables.length) % focusables.length;
		this.setFocus(focusables[nextIdx]);
	}

	private handleKeyEvent(raw: Extract<GuiNativeEvent, { kind: "key" }>, ctx: GuiRenderContext): void {
		const keyEvt: GuiKeyEvent = {
			phase: raw.phase,
			keyCode: raw.keyCode,
			key: raw.name,
			modifiers: decodeModifiers(raw.modifiers),
		};

		if (this.focusedComponent?.visible) {
			if (this.focusedComponent.handleKey(keyEvt, ctx)) {
				return;
			}
		}

		if (this.onKeyCallback?.(keyEvt, ctx)) {
			this.needsRender = true;
			return;
		}

		if (raw.phase === "down" && this.keybindings.matches(keyEvt, "cancel")) {
			const visible = this.visibleOverlays();
			const top = visible[visible.length - 1];
			if (top !== undefined && top.options.dismissOnEscape !== false) {
				this.dismissOverlayEntry(top);
				return;
			}
		}

		if (raw.phase !== "up" && this.keybindings.matches(keyEvt, "focusPrev")) {
			this.cycleFocus(true);
			return;
		}
		if (raw.phase !== "up" && this.keybindings.matches(keyEvt, "focusNext")) {
			this.cycleFocus(false);
			return;
		}

		const visible = this.visibleOverlays();
		const modal = this.topmostModalOverlay(visible);
		const scrollScope = modal !== undefined ? modal.component : this.rootComponent;
		const primaryScroll = this.findPrimaryScrollView(scrollScope);
		if (primaryScroll?.handleKey(keyEvt, ctx)) {
			return;
		}

		if (raw.phase === "down" && this.keybindings.matches(keyEvt, "quit")) {
			this.requestClose();
		}
	}

	private requestClose(): void {
		if (this.onCloseCallback !== undefined) {
			const allow = this.onCloseCallback();
			if (allow === false) {
				return;
			}
		}
		this.running = false;
	}

	processEvents(events: readonly GuiNativeEvent[]): void {
		if (events.length === 0 || this.disposed) return;
		const ctx = this.createRenderContext();

		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			if (event === undefined) continue;
			switch (event.kind) {
				case "close":
					this.requestClose();
					break;
				case "resize":
					this.metrics = {
						...this.metrics,
						width: event.width,
						height: event.height,
						scale: event.scale,
					};
					this.needsRender = true;
					break;
				case "focus": {
					const darkChanged = this.metrics.darkMode !== event.darkMode;
					this.metrics = {
						...this.metrics,
						focused: event.focused,
						darkMode: event.darkMode,
					};
					if (darkChanged && this.autoTheme) {
						this.setTheme(event.darkMode ? darkGuiTheme : lightGuiTheme);
					}
					this.needsRender = true;
					break;
				}
				case "menu":
					this.backend.dispatchMenuItem(event.itemId);
					this.needsRender = true;
					break;
				case "pointer":
					this.handlePointerEvent(event, ctx);
					break;
				case "scroll":
					this.handleScrollEvent(event, ctx);
					break;
				case "key":
					this.handleKeyEvent(event, ctx);
					break;
				case "text":
					if (this.focusedComponent?.visible) {
						this.focusedComponent.handleText(event.text, ctx);
					}
					break;
				case "imePreedit":
					if (this.focusedComponent?.visible) {
						this.focusedComponent.handleImePreedit(event.text, event.cursorStart, event.cursorEnd, ctx);
					}
					break;
				case "a11yAction": {
					const target = this.findActiveComponentByA11yId(event.nodeId);
					if (target !== undefined) {
						if (event.action === "focus" && target.focusable) {
							this.setFocus(target);
						}
						target.handleAccessibilityAction(event.nodeId, event.action, event.value, ctx);
						this.needsRender = true;
					}
					break;
				}
			}
		}
	}

	step(waitMs = 0): boolean {
		if (this.disposed) return false;
		const events = this.backend.pollEvents(waitMs);
		if (events.length > 0) {
			this.processEvents(events);
		}
		if (this.needsRender) {
			this.renderFrame();
			return true;
		}
		return false;
	}

	isRunning(): boolean {
		return this.running;
	}

	stop(): void {
		this.running = false;
	}

	async run(): Promise<void> {
		if (this.disposed) {
			throw new Error("Cannot run a disposed GuiApp");
		}
		this.running = true;
		this.renderFrame();
		while (this.running && !this.disposed) {
			this.step(this.frameIntervalMs);
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 1);
			});
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.running = false;
		this.disposed = true;
		this.overlays.length = 0;
		this.rootComponent?.attachHost(undefined);
		this.backend.destroyWindow(this.windowId);
		this.backend.shutdown();
	}
}
