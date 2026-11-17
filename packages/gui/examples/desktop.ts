import {
  type A11yActionKind,
  Badge,
  Box,
  Button,
  CombinedAutocompleteProvider,
  Divider,
  Editor,
  type GuiA11yNode,
  GuiApp,
  GuiComponent,
  type GuiKeyEvent,
  type GuiPointerEvent,
  type GuiPointerResult,
  type GuiRenderContext,
  type GuiTheme,
  HStack,
  HeadlessBackend,
  Input,
  type MenuSpec,
  type OverlayHandle,
  SGUI_A11Y_STATE_ENABLED,
  SGUI_A11Y_STATE_FOCUSED,
  SGUI_CURSOR_POINTER,
  SGUI_FONT_MONO,
  SGUI_FONT_REGULAR,
  ScrollView,
  type Size,
  Switch,
  Text,
  VStack,
  VectorIcon,
  type VectorIconName,
  allocateA11yId,
  darkGuiTheme,
  drawVectorIcon,
  lightGuiTheme,
  pointInRect,
  rgbaColor,
  withAlpha,
} from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

interface DesktopState {
  search: string;
  wordWrap: boolean;
  unifiedChrome: boolean;
  dark: boolean;
  contextOpen: boolean;
  actionLog: string[];
}

interface DesktopController {
  app: GuiApp;
  getState: () => DesktopState;
  toggleWordWrap: (next?: boolean) => void;
  toggleTitlebarStyle: () => void;
  openContextMenu: () => void;
  sayHello: (source: string) => void;
}

class PopoverMenuRow extends GuiComponent {
  override readonly a11yId: number = allocateA11yId();
  private readonly label: string;
  private readonly shortcut: string;
  private readonly icon?: VectorIconName;
  private readonly disabled: boolean;
  private readonly checked: boolean;
  private readonly theme: GuiTheme;
  private readonly onSelect?: () => void;
  private pressed = false;

  constructor(options: {
    label: string;
    shortcut?: string;
    icon?: VectorIconName;
    disabled?: boolean;
    checked?: boolean;
    theme: GuiTheme;
    onSelect?: () => void;
  }) {
    super();
    this.label = options.label;
    this.shortcut = options.shortcut ?? "";
    this.icon = options.icon;
    this.disabled = options.disabled ?? false;
    this.checked = options.checked ?? false;
    this.theme = options.theme;
    this.onSelect = options.onSelect;
    this.focusable = !this.disabled;
    this.cursor = SGUI_CURSOR_POINTER;
  }

  measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
    const w = Number.isFinite(maxWidth) ? Math.max(180, maxWidth) : 220;
    return { width: w, height: 30 };
  }

  render(ctx: GuiRenderContext): void {
    const b = this.layoutRect;
    const t = this.theme;
    const hovered = !this.disabled && (this.isHovered() || this.isFocused());
    if (hovered || this.pressed) {
      ctx.fillRect(
        b.x,
        b.y,
        b.width,
        b.height,
        this.pressed ? withAlpha(t.accent, 0.22) : withAlpha(t.accent, 0.14),
        6,
      );
    }

    const fg = this.disabled ? t.textDisabled : t.text;
    const iconSlotW = 18;
    const xText = b.x + 10 + iconSlotW;

    if (this.checked) {
      drawVectorIcon(ctx, "check", b.x + 8, b.y + 8, 13, t.accent, 1.8);
    } else if (this.icon) {
      drawVectorIcon(ctx, this.icon, b.x + 8, b.y + 8, 13, this.disabled ? t.textDisabled : t.textMuted, 1.6);
    }

    let rightReserved = 10;
    if (this.shortcut.length > 0) {
      const scW = ctx.measureText(
        { fontFamily: SGUI_FONT_MONO, fontSize: 11, fontWeight: 500 },
        80,
        this.shortcut,
      ).width;
      rightReserved = Math.ceil(scW) + 16;
      ctx.drawStyledText(
        b.x + b.width - rightReserved + 4,
        b.y + 8,
        rightReserved - 8,
        this.disabled ? t.textDisabled : t.textMuted,
        { fontFamily: SGUI_FONT_MONO, fontSize: 11, fontWeight: 500 },
        this.shortcut,
      );
    }

    ctx.drawStyledText(
      xText,
      b.y + 7,
      Math.max(40, b.width - iconSlotW - rightReserved - 12),
      fg,
      { fontFamily: SGUI_FONT_REGULAR, fontSize: 13, fontWeight: 500 },
      this.label,
    );
  }

  override handlePointer(ev: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
    if (this.disabled) return { handled: false };
    const inside = pointInRect(ev.x, ev.y, this.layoutRect);
    if (ev.phase === "move" || ev.phase === "enter" || ev.phase === "leave") {
      return { handled: inside, cursor: inside ? SGUI_CURSOR_POINTER : undefined };
    }
    if (ev.phase === "down" && ev.button === "left") {
      if (!inside) return { handled: false };
      this.pressed = true;
      this.invalidate();
      return { handled: true, capture: this, focus: this };
    }
    if (ev.phase === "up" && ev.button === "left") {
      const was = this.pressed;
      this.pressed = false;
      this.invalidate();
      if (was && inside) {
        this.onSelect?.();
        return { handled: true, releaseCapture: true };
      }
      return { handled: was, releaseCapture: true };
    }
    return { handled: false };
  }

  override handleKey(ev: GuiKeyEvent, _ctx: GuiRenderContext): boolean {
    if (this.disabled || ev.phase !== "down") return false;
    if (ev.key === "Enter" || ev.key === " ") {
      this.onSelect?.();
      return true;
    }
    return false;
  }

  override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
    let stateFlags = this.disabled ? 0 : SGUI_A11Y_STATE_ENABLED;
    if (this.isFocused()) stateFlags |= SGUI_A11Y_STATE_FOCUSED;
    out.push({
      id: this.a11yId,
      role: "button",
      label: this.label,
      rect: this.layoutRect,
      stateFlags,
    });
  }

  override handleAccessibilityAction(
    nodeId: number,
    action: A11yActionKind,
    _value: string,
    _ctx: GuiRenderContext,
  ): boolean {
    if (this.disabled || nodeId !== this.a11yId) return false;
    if (action === "press") {
      this.onSelect?.();
      return true;
    }
    return false;
  }
}

const SAMPLE_PREVIEW =
  "Unified desktop chrome keeps macOS traffic lights centered in a 42pt translucent toolbar while splitting document workspace and live window inspector telemetry with crisp 1px hairlines.";

function createDesktopApp(
  backend: ReturnType<typeof createNativeBackend> | HeadlessBackend,
): DesktopController {
  const state: DesktopState = {
    search: "",
    wordWrap: true,
    unifiedChrome: true,
    dark: true,
    contextOpen: false,
    actionLog: ["1. Unified desktop workspace mounted"],
  };

  let seq = 2;
  let appRef: GuiApp | null = null;
  let contextOverlay: OverlayHandle | null = null;

  function theme(): GuiTheme {
    return state.dark ? darkGuiTheme : lightGuiTheme;
  }

  function pushLog(entry: string): void {
    state.actionLog = [`${seq++}. ${entry}`, ...state.actionLog].slice(0, 16);
    syncUi();
  }

  function buildMenus(): MenuSpec[] {
    return [
      {
        title: "Desktop",
        items: [
          {
            kind: "action",
            label: "About Desktop Studio",
            role: "about",
            onSelect: () => pushLog("Menu: About Desktop Studio"),
          },
          { kind: "separator" },
          { kind: "action", label: "Quit Desktop", role: "quit", shortcut: "cmd+q" },
        ],
      },
      {
        title: "File",
        items: [
          {
            kind: "action",
            label: "New Document",
            shortcut: "cmd+n",
            onSelect: () => pushLog("Menu: File -> New Document"),
          },
          {
            kind: "action",
            label: "Save Workspace",
            shortcut: "cmd+s",
            onSelect: () => pushLog("Menu: File -> Save Workspace"),
          },
          { kind: "separator" },
          { kind: "action", label: "Close Window", role: "close", shortcut: "cmd+w" },
        ],
      },
      {
        title: "Edit",
        items: [
          { kind: "action", label: "Undo", role: "undo", shortcut: "cmd+z" },
          { kind: "action", label: "Redo", role: "redo", shortcut: "cmd+shift+z" },
          { kind: "separator" },
          { kind: "action", label: "Cut", role: "cut", shortcut: "cmd+x" },
          { kind: "action", label: "Copy", role: "copy", shortcut: "cmd+c" },
          { kind: "action", label: "Paste", role: "paste", shortcut: "cmd+v" },
          { kind: "action", label: "Select All", role: "selectAll", shortcut: "cmd+a" },
        ],
      },
      {
        title: "View",
        items: [
          {
            kind: "action",
            label: "Word Wrap",
            checked: state.wordWrap,
            shortcut: "alt+z",
            onSelect: () => toggleWordWrap(),
          },
          {
            kind: "action",
            label: "Toggle Title Bar",
            checked: state.unifiedChrome,
            shortcut: "cmd+shift+t",
            onSelect: () => toggleTitlebarStyle(),
          },
          { kind: "separator" },
          {
            kind: "action",
            label: "Toggle Theme",
            shortcut: "cmd+t",
            onSelect: () => toggleTheme(),
          },
        ],
      },
      {
        title: "Window",
        items: [
          { kind: "action", label: "Minimize", role: "minimize", shortcut: "cmd+m" },
          { kind: "action", label: "Zoom", role: "zoom" },
        ],
      },
    ];
  }

  // --- Top Unified Chrome Bar (42px+) ---
  const brandIcon = new VectorIcon({ name: "layout", size: 16 });
  const appTitleText = new Text({
    text: "Desktop Studio",
    fontSize: 13,
    fontWeight: 600,
  });
  const chromeBadge = new Badge({
    label: "UNIFIED",
    variant: "accent",
    fontSize: 10,
  });

  const searchInput = new Input({
    value: "",
    placeholder: "Search",
    radius: 8,
    padding: { vertical: 5, horizontal: 10 },
    onChange: (value) => {
      state.search = value;
      syncPreviewText();
      syncStatusBar();
    },
    onSubmit: (value) => {
      state.search = value;
      pushLog(`Search: "${value || "(empty)"}"`);
    },
  });

  const contextMenuBtn = new Button({
    label: "Context menu",
    leadingIcon: "menu",
    variant: "secondary",
    padding: { vertical: 5, horizontal: 10 },
    onClick: () => toggleContextMenu(),
  });
  const titlebarBtn = new Button({
    label: "Toggle title bar",
    leadingIcon: "sliders",
    variant: "ghost",
    padding: { vertical: 5, horizontal: 10 },
    onClick: () => toggleTitlebarStyle(),
  });
  const themeBtn = new Button({
    label: "Light",
    leadingIcon: "sun",
    variant: "ghost",
    padding: { vertical: 5, horizontal: 9 },
    onClick: () => toggleTheme(),
  });

  const chromeBarBox = new Box({
    height: 44,
    padding: { top: 6, right: 14, bottom: 6, left: 84 },
    child: new HStack({
      gap: 8,
      align: "center",
      children: [
        brandIcon,
        appTitleText,
        chromeBadge,
        { child: new Box({ maxWidth: 210, fillWidth: true, child: searchInput }), grow: 1 },
        contextMenuBtn,
        titlebarBtn,
        themeBtn,
      ],
    }),
  });
  const topDivider = new Divider();

  // --- Left 240px Inspector Sidebar ---
  const inspectorEyebrow = new Text({
    text: "WINDOW INSPECTOR",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: SGUI_FONT_MONO,
  });
  const metricSizeRow = new Text({ text: "", fontSize: 11, fontFamily: SGUI_FONT_MONO });
  const metricChromeRow = new Text({ text: "", fontSize: 11, fontFamily: SGUI_FONT_MONO });
  const metricAppearanceRow = new Text({ text: "", fontSize: 11, fontFamily: SGUI_FONT_MONO });

  const wrapSwitch = new Switch({
    label: "Word Wrap",
    checked: state.wordWrap,
    onChange: (checked) => toggleWordWrap(checked),
  });

  const logHeading = new Text({
    text: "ACTION LOG",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: SGUI_FONT_MONO,
  });
  const clearLogBtn = new Button({
    label: "Clear",
    variant: "ghost",
    fontSize: 11,
    padding: { vertical: 3, horizontal: 8 },
    onClick: () => {
      state.actionLog = [`${seq++}. Log cleared`];
      syncUi();
    },
  });
  const logRows = new VStack({ gap: 5, align: "stretch" });

  const sidebarDiv1 = new Divider();
  const sidebarDiv2 = new Divider();

  const inspectorSidebar = new Box({
    width: 248,
    padding: 14,
    child: new VStack({
      gap: 12,
      align: "stretch",
      children: [
        new VStack({
          gap: 6,
          align: "stretch",
          children: [inspectorEyebrow, metricSizeRow, metricChromeRow, metricAppearanceRow],
        }),
        sidebarDiv1,
        wrapSwitch,
        sidebarDiv2,
        new HStack({
          gap: 8,
          align: "center",
          children: [{ child: logHeading, grow: 1 }, clearLogBtn],
        }),
        { child: new ScrollView({ child: logRows, padding: 0 }), grow: 1 },
      ],
    }),
  });
  const splitDivider = new Divider({ direction: "vertical" });

  // --- Right Document Canvas ---
  const docTitleText = new Text({
    text: "Document Surface",
    fontSize: 18,
    fontWeight: 700,
  });
  const docWrapBadge = new Badge({
    label: "WRAP ON",
    variant: "success",
    fontSize: 10,
  });
  const previewSlot = new Box({});
  const previewCard = new Box({
    padding: 16,
    radius: 12,
    borderWidth: 1,
    shadow: "sm",
    child: new VStack({
      gap: 8,
      align: "stretch",
      children: [
        new Text({ text: "Live Preview", fontSize: 12, fontWeight: 600 }),
        previewSlot,
      ],
    }),
  });

  const scratchAutocomplete = new CombinedAutocompleteProvider(
    [
      { name: "wrap", description: "Toggle Word Wrap in editor preview" },
      { name: "hello", description: "Append greeting entry to action log" },
    ],
    undefined,
    false,
  );
  const scratchpadEditor = new Editor({
    initialValue:
      "// Unified titlebar notes\nUse Cmd+N, Alt+Z (Word Wrap), or Context menu -> Say hello.",
    placeholder: "Write workspace notes...",
    autocompleteProvider: scratchAutocomplete,
    minHeight: 170,
    maxHeight: 280,
    radius: 10,
    onSubmit: (txt) => pushLog(`Note submitted (${txt.length} chars)`),
  });

  const documentPane = new Box({
    padding: 20,
    child: new VStack({
      gap: 14,
      align: "stretch",
      children: [
        new HStack({
          gap: 10,
          align: "center",
          children: [{ child: docTitleText, grow: 1 }, docWrapBadge],
        }),
        previewCard,
        { child: scratchpadEditor, grow: 1 },
      ],
    }),
  });

  // --- Bottom Status Bar (28px) ---
  const bottomDivider = new Divider();
  const statusLeftText = new Text({
    text: "",
    fontSize: 11,
    fontFamily: SGUI_FONT_MONO,
  });
  const statusRightText = new Text({
    text: "",
    fontSize: 11,
    fontFamily: SGUI_FONT_MONO,
  });
  const statusBar = new Box({
    height: 28,
    padding: { vertical: 5, horizontal: 14 },
    child: new HStack({
      gap: 12,
      align: "center",
      children: [{ child: statusLeftText, grow: 1 }, statusRightText],
    }),
  });

  const rootShell = new Box({
    child: new VStack({
      gap: 0,
      align: "stretch",
      children: [
        chromeBarBox,
        topDivider,
        {
          child: new HStack({
            gap: 0,
            align: "stretch",
            children: [
              inspectorSidebar,
              splitDivider,
              { child: documentPane, grow: 1 },
            ],
          }),
          grow: 1,
        },
        bottomDivider,
        statusBar,
      ],
    }),
  });

  function closeContextMenu(): void {
    if (contextOverlay) {
      contextOverlay.dispose();
      contextOverlay = null;
    }
    state.contextOpen = false;
  }

  function sayHello(source: string): void {
    closeContextMenu();
    pushLog(`Hello from ${source}!`);
  }

  function toggleWordWrap(next?: boolean): void {
    state.wordWrap = next !== undefined ? next : !state.wordWrap;
    appRef?.setAppMenu(buildMenus());
    pushLog(`Word Wrap -> ${state.wordWrap ? "ON" : "OFF"}`);
  }

  function toggleTitlebarStyle(): void {
    state.unifiedChrome = !state.unifiedChrome;
    appRef?.setAppMenu(buildMenus());
    pushLog(
      `Title bar -> ${state.unifiedChrome ? "Unified" : "Standard"}`,
    );
  }

  function toggleTheme(): void {
    state.dark = !state.dark;
    appRef?.setTheme(theme());
    pushLog(`Theme -> ${state.dark ? "Dark" : "Light"}`);
  }

  function openContextMenu(): void {
    if (!appRef) return;
    closeContextMenu();
    const t = theme();

    const menuBox = new Box({
      padding: 4,
      radius: 10,
      background: t.surfaceElevated,
      borderColor: t.border,
      borderWidth: 1,
      child: new VStack({
        gap: 2,
        align: "stretch",
        children: [
          new PopoverMenuRow({
            label: "Say hello",
            shortcut: "⌘H",
            icon: "sparkles",
            theme: t,
            onSelect: () => sayHello("context menu"),
          }),
          new PopoverMenuRow({
            label: "Disabled action",
            disabled: true,
            theme: t,
          }),
          new Box({
            padding: { vertical: 3, horizontal: 6 },
            child: new Divider({ color: t.border }),
          }),
          new PopoverMenuRow({
            label: `Word Wrap: ${state.wordWrap ? "ON" : "OFF"}`,
            shortcut: "⌥Z",
            checked: state.wordWrap,
            theme: t,
            onSelect: () => {
              closeContextMenu();
              toggleWordWrap();
            },
          }),
        ],
      }),
    });

    state.contextOpen = true;
    contextOverlay = appRef.showOverlay(menuBox, {
      anchor: "top-left",
      anchorRect: contextMenuBtn.layoutRect,
      width: 232,
      offsetY: 6,
      radius: 10,
      shadow: "lg",
      modal: false,
      dismissOnBackdropClick: true,
      dismissOnEscape: true,
      backdropColor: rgbaColor(0, 0, 0, 12),
      onDismiss: () => {
        contextOverlay = null;
        state.contextOpen = false;
        appRef?.invalidate();
      },
    });
    appRef.invalidate();
  }

  function toggleContextMenu(): void {
    if (state.contextOpen) {
      closeContextMenu();
      appRef?.invalidate();
      return;
    }
    openContextMenu();
  }

  function syncPreviewText(): void {
    const t = theme();
    const query = state.search.trim();
    const text =
      query.length > 0
        ? `[filter="${query}"] ${SAMPLE_PREVIEW}`
        : SAMPLE_PREVIEW;
    previewSlot.setChild(
      new Text({
        text,
        fontSize: 13,
        color: t.text,
        wrap: state.wordWrap,
      }),
    );
    appRef?.invalidate();
  }

  function syncStatusBar(): void {
    const metrics = appRef?.getWindowMetrics();
    const insetL = metrics ? metrics.insetLeft : 81;
    const tbH = metrics ? metrics.titlebarHeight : 38;
    const scale = metrics ? metrics.scale : 2;
    statusLeftText.setText(
      `insetLeft=${insetL}pt · titlebar=${tbH}pt · scale=${scale}x · search="${state.search || "—"}"`,
    );
    statusRightText.setText(
      `wrap=${state.wordWrap ? "on" : "off"} · events=${state.actionLog.length}`,
    );
  }

  function syncUi(): void {
    const t = theme();
    const metrics = appRef?.getWindowMetrics();
    const insetLeft = metrics ? Math.max(14, metrics.insetLeft) : 81;
    const tbH = metrics ? metrics.titlebarHeight : 38;

    rootShell.setBackground(t.background);
    chromeBarBox.setBackground(state.unifiedChrome ? t.surfaceElevated : t.surfaceMuted);
    chromeBarBox.setPadding({
      top: state.unifiedChrome ? Math.max(6, Math.round((tbH - 26) / 2)) : 6,
      right: 14,
      bottom: 6,
      left: state.unifiedChrome ? insetLeft + 8 : 14,
    });

    brandIcon.setColor(t.accent);
    appTitleText.setColor(t.text);
    chromeBadge.setLabel(state.unifiedChrome ? "UNIFIED" : "STANDARD");
    chromeBadge.setVariant(state.unifiedChrome ? "accent" : "neutral");

    themeBtn.setLabel(state.dark ? "Light" : "Dark");
    themeBtn.setLeadingIcon(state.dark ? "sun" : "moon");

    topDivider.setColor(t.border);
    splitDivider.setColor(t.border);
    sidebarDiv1.setColor(t.border);
    sidebarDiv2.setColor(t.border);
    bottomDivider.setColor(t.border);

    inspectorSidebar.setBackground(t.surfaceMuted);
    inspectorEyebrow.setColor(t.textMuted);
    logHeading.setColor(t.textMuted);

    if (metrics) {
      metricSizeRow.setText(`SIZE   ${metrics.width}×${metrics.height} @ ${metrics.scale}x`);
      metricChromeRow.setText(`CHROME inset=${metrics.insetLeft} tb=${metrics.titlebarHeight}`);
      metricAppearanceRow.setText(`MODE   ${state.unifiedChrome ? "unified" : "standard"} / sysDark=${metrics.darkMode}`);
    } else {
      metricSizeRow.setText("SIZE   860×580 @ 2x");
      metricChromeRow.setText("CHROME inset=81 tb=38");
      metricAppearanceRow.setText("MODE   unified");
    }
    metricSizeRow.setColor(t.text);
    metricChromeRow.setColor(t.textMuted);
    metricAppearanceRow.setColor(t.textMuted);

    wrapSwitch.setChecked(state.wordWrap);

    logRows.clear();
    for (let i = 0; i < state.actionLog.length; i += 1) {
      logRows.addChild(
        new Text({
          text: state.actionLog[i]!,
          fontSize: 11,
          fontFamily: SGUI_FONT_MONO,
          color: i === 0 ? t.text : t.textMuted,
          wrap: true,
        }),
      );
    }

    documentPane.setBackground(t.background);
    docTitleText.setColor(t.text);
    docWrapBadge.setLabel(state.wordWrap ? "WRAP ON" : "WRAP OFF");
    docWrapBadge.setVariant(state.wordWrap ? "success" : "neutral");

    previewCard.setBackground(t.surface);
    previewCard.setBorder(t.border, 1);
    syncPreviewText();

    statusBar.setBackground(t.surfaceMuted);
    statusLeftText.setColor(t.textMuted);
    statusRightText.setColor(t.textMuted);
    syncStatusBar();

    appRef?.invalidate();
  }

  appRef = new GuiApp({
    backend,
    window: {
      title: "Desktop Studio — @pi-ts/gui",
      width: 860,
      height: 580,
      resizable: true,
      unifiedTitlebar: true,
    },
    theme: theme(),
    menus: buildMenus(),
    root: rootShell,
  });

  syncUi();

  return {
    app: appRef,
    getState: () => ({
      search: state.search,
      wordWrap: state.wordWrap,
      unifiedChrome: state.unifiedChrome,
      dark: state.dark,
      contextOpen: state.contextOpen,
      actionLog: [...state.actionLog],
    }),
    toggleWordWrap,
    toggleTitlebarStyle,
    openContextMenu,
    sayHello,
  };
}

function findNode(backend: HeadlessBackend, role: string, label: string): number {
  const node = backend
    .getAccessibilityTree()
    .find((entry) => entry.role === role && entry.label === label);
  if (!node) {
    throw new Error(`Missing ${role} "${label}"`);
  }
  return node.id;
}

function runHeadlessSmoke(): void {
  const backend = new HeadlessBackend({ width: 860, height: 580 });
  const ctrl = createDesktopApp(backend);
  ctrl.app.renderFrame();

  backend.triggerA11yPress(findNode(backend, "button", "Context menu"));
  ctrl.app.step(0);
  const openedState = ctrl.getState();

  backend.triggerA11yPress(findNode(backend, "button", "Say hello"));
  ctrl.app.step(0);

  backend.triggerA11yPress(findNode(backend, "button", "Toggle title bar"));
  ctrl.app.step(0);

  backend.triggerA11yPress(findNode(backend, "checkbox", "Word Wrap"));
  ctrl.app.step(0);
  const finalState = ctrl.getState();

  const viewMenu = backend.getMenus().find((m) => m.title === "View");
  const wrapMenuItem = viewMenu?.items.find(
    (item) => item.kind === "action" && item.label === "Word Wrap",
  );
  const wrapMenuChecked =
    wrapMenuItem && wrapMenuItem.kind === "action" ? wrapMenuItem.checked === false : false;

  const ok =
    openedState.contextOpen &&
    !finalState.unifiedChrome &&
    !finalState.wordWrap &&
    wrapMenuChecked &&
    finalState.actionLog.some((l) => l.includes("Hello from context menu")) &&
    finalState.actionLog.some((l) => l.includes("Word Wrap -> OFF"));

  const summary = {
    app: "desktop",
    mode: "headless-smoke",
    ok,
    wordWrap: finalState.wordWrap,
    unifiedChrome: finalState.unifiedChrome,
    logCount: finalState.actionLog.length,
    menusCount: backend.getMenus().length,
    frameCount: backend.getFrameCount(),
  };
  ctrl.app.dispose();
  console.log(JSON.stringify(summary));
  if (!ok) {
    process.exit(1);
  }
}

function runNativeSmoke(): void {
  const backend = createNativeBackend();
  const ctrl = createDesktopApp(backend);
  ctrl.app.renderFrame();
  ctrl.toggleTitlebarStyle();
  ctrl.toggleWordWrap();
  ctrl.app.renderFrame();
  const metrics = ctrl.app.getWindowMetrics();
  const state = ctrl.getState();
  const ok = metrics.width > 0 && state.actionLog.length >= 3;
  const summary = {
    app: "desktop",
    mode: "native-smoke",
    ok,
    metrics,
    wordWrap: state.wordWrap,
    unifiedChrome: state.unifiedChrome,
    logEntries: state.actionLog.length,
  };
  ctrl.app.dispose();
  console.log(JSON.stringify(summary));
  if (!ok) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--headless-smoke")) {
    runHeadlessSmoke();
    return;
  }
  if (process.argv.includes("--native-smoke")) {
    runNativeSmoke();
    return;
  }
  const backend = createNativeBackend();
  const ctrl = createDesktopApp(backend);
  try {
    await ctrl.app.run();
  } finally {
    ctrl.app.dispose();
  }
}

void main();
