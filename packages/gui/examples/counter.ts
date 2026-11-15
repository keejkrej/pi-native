import {
  Badge,
  type BadgeVariant,
  Box,
  Button,
  Divider,
  GuiApp,
  type GuiTheme,
  HStack,
  HeadlessBackend,
  type MenuSpec,
  SGUI_FONT_MONO,
  Text,
  VStack,
  darkGuiTheme,
  lightGuiTheme,
  withAlpha,
} from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

interface CounterState {
  count: number;
  recent: number[];
  dark: boolean;
}

interface CounterController {
  app: GuiApp;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
  toggleTheme: () => void;
  getState: () => CounterState;
}

function buildMenus(onAction: (id: string) => void): MenuSpec[] {
  return [
    {
      title: "Counter",
      items: [{ kind: "action", label: "Quit Counter", role: "quit", shortcut: "cmd+q" }],
    },
    {
      title: "Actions",
      items: [
        {
          kind: "action",
          label: "Increment (+1)",
          shortcut: "cmd+up",
          onSelect: () => onAction("inc"),
        },
        {
          kind: "action",
          label: "Decrement (-1)",
          shortcut: "cmd+down",
          onSelect: () => onAction("dec"),
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Reset",
          shortcut: "cmd+r",
          onSelect: () => onAction("reset"),
        },
      ],
    },
    {
      title: "View",
      items: [
        {
          kind: "action",
          label: "Toggle Theme",
          shortcut: "cmd+t",
          onSelect: () => onAction("theme"),
        },
      ],
    },
  ];
}

function createCounterApp(
  backend: ReturnType<typeof createNativeBackend> | HeadlessBackend,
): CounterController {
  const state: CounterState = {
    count: 0,
    recent: [0],
    dark: true,
  };

  let appRef: GuiApp | null = null;

  const titleText = new Text({
    text: "Counter",
    fontSize: 20,
    fontWeight: 700,
  });
  const subtitleText = new Text({
    text: "Restrained desktop state studio",
    fontSize: 12,
  });
  const themeBtn = new Button({
    label: "Light",
    leadingIcon: "sun",
    variant: "ghost",
    pill: true,
    onClick: () => toggleTheme(),
  });

  const signBadge = new Badge({
    label: "ZERO",
    variant: "neutral",
    leadingIcon: "activity",
  });
  const countText = new Text({
    text: "0",
    fontSize: 72,
    fontWeight: 700,
    fontFamily: SGUI_FONT_MONO,
    align: "center",
  });
  const signHintText = new Text({
    text: "At origin (0)",
    fontSize: 12,
    align: "center",
  });

  const innerStage = new Box({
    padding: { top: 24, right: 20, bottom: 24, left: 20 },
    radius: 15,
    borderWidth: 1,
    fillWidth: true,
    child: new VStack({
      gap: 10,
      align: "center",
      children: [signBadge, countText, signHintText],
    }),
  });

  const heroBezel = new Box({
    padding: 5,
    radius: 20,
    borderWidth: 1,
    shadow: "sm",
    fillWidth: true,
    child: innerStage,
  });

  const decBtn = new Button({
    label: "-1",
    leadingIcon: "minus",
    variant: "secondary",
    radius: 10,
    padding: { vertical: 10, horizontal: 16 },
    onClick: () => applyDelta(-1),
  });
  const incBtn = new Button({
    label: "+1",
    leadingIcon: "plus",
    variant: "primary",
    radius: 10,
    padding: { vertical: 10, horizontal: 16 },
    onClick: () => applyDelta(1),
  });
  const resetBtn = new Button({
    label: "Reset",
    leadingIcon: "reset",
    variant: "ghost",
    radius: 10,
    padding: { vertical: 10, horizontal: 14 },
    onClick: () => resetCount(),
  });

  const recentHeading = new Text({
    text: "Recent values (1)",
    fontSize: 12,
    fontWeight: 600,
  });
  const recentOrderHint = new Text({
    text: "LAST 5",
    fontSize: 10,
    fontWeight: 600,
    fontFamily: SGUI_FONT_MONO,
  });
  const recentDivider = new Divider();
  const recentChipsRow = new HStack({
    gap: 8,
    align: "center",
  });
  const recentSummaryText = new Text({
    text: "History: 0",
    fontSize: 12,
    fontFamily: SGUI_FONT_MONO,
  });

  const columnBox = new Box({
    maxWidth: 440,
    fillWidth: true,
    alignHorizontal: "center",
    child: new VStack({
      gap: 18,
      align: "stretch",
      children: [
        new HStack({
          gap: 12,
          align: "center",
          children: [
            {
              child: new VStack({
                gap: 2,
                align: "stretch",
                children: [titleText, subtitleText],
              }),
              grow: 1,
            },
            themeBtn,
          ],
        }),
        heroBezel,
        new HStack({
          gap: 10,
          align: "center",
          children: [
            { child: decBtn, grow: 1 },
            { child: incBtn, grow: 1 },
            resetBtn,
          ],
        }),
        new VStack({
          gap: 10,
          align: "stretch",
          children: [
            new HStack({
              gap: 8,
              align: "center",
              children: [{ child: recentHeading, grow: 1 }, recentOrderHint],
            }),
            recentDivider,
            recentChipsRow,
            recentSummaryText,
          ],
        }),
      ],
    }),
  });

  const rootShell = new Box({
    padding: 24,
    child: columnBox,
  });

  function currentTheme(): GuiTheme {
    return state.dark ? darkGuiTheme : lightGuiTheme;
  }

  function applyDelta(delta: number): void {
    state.count += delta;
    state.recent = [state.count, ...state.recent].slice(0, 5);
    syncUi();
  }

  function resetCount(): void {
    if (state.count !== 0) {
      state.count = 0;
      state.recent = [0, ...state.recent].slice(0, 5);
    } else {
      state.recent = [0];
    }
    syncUi();
  }

  function toggleTheme(): void {
    state.dark = !state.dark;
    appRef?.setTheme(currentTheme());
    syncUi();
  }

  function rebuildRecentChips(): void {
    recentChipsRow.clear();
    for (let i = 0; i < state.recent.length; i += 1) {
      const value = state.recent[i]!;
      let variant: BadgeVariant = "neutral";
      if (value < 0) variant = "danger";
      else if (value > 0) variant = i === 0 ? "accent" : "success";
      recentChipsRow.addChild(
        new Badge({
          label: i === 0 ? `now ${value}` : String(value),
          variant,
          fontSize: 12,
          fontWeight: i === 0 ? 700 : 500,
          padding: { vertical: 5, horizontal: 10 },
        }),
      );
    }
  }

  function syncUi(): void {
    const t = currentTheme();
    const isNeg = state.count < 0;
    const isPos = state.count > 0;

    rootShell.setBackground(t.background);
    titleText.setColor(t.text);
    subtitleText.setColor(t.textMuted);
    themeBtn.setLabel(state.dark ? "Light" : "Dark");
    themeBtn.setLeadingIcon(state.dark ? "sun" : "moon");

    heroBezel.setBackground(t.surface);
    heroBezel.setBorder(t.border, 1);

    innerStage.setBackground(isNeg ? withAlpha(t.danger, 0.08) : t.surfaceMuted);
    innerStage.setBorder(isNeg ? withAlpha(t.danger, 0.45) : t.border, 1);

    signBadge.setLabel(isNeg ? "NEGATIVE" : isPos ? "POSITIVE" : "ZERO");
    signBadge.setVariant(isNeg ? "danger" : isPos ? "success" : "neutral");

    countText.setText(String(state.count));
    countText.setColor(isNeg ? t.danger : t.text);

    const deltaLabel =
      state.count === 0
        ? "At origin (0)"
        : state.count > 0
          ? `+${state.count} above origin`
          : `${state.count} below origin`;
    signHintText.setText(deltaLabel);
    signHintText.setColor(isNeg ? t.danger : t.textMuted);

    recentHeading.setText(`Recent values (${state.recent.length})`);
    recentHeading.setColor(t.textMuted);
    recentOrderHint.setColor(t.textDisabled);
    recentDivider.setColor(t.border);
    recentSummaryText.setText(`History: ${state.recent.join("  ·  ")}`);
    recentSummaryText.setColor(t.textMuted);

    rebuildRecentChips();
    appRef?.invalidate();
  }

  const menus = buildMenus((actionId) => {
    if (actionId === "inc") applyDelta(1);
    else if (actionId === "dec") applyDelta(-1);
    else if (actionId === "reset") resetCount();
    else if (actionId === "theme") toggleTheme();
  });

  appRef = new GuiApp({
    backend,
    window: {
      title: "Counter — scriptc-ui",
      width: 520,
      height: 490,
      resizable: true,
    },
    theme: currentTheme(),
    menus,
    root: rootShell,
    onKey: (ev) => {
      if (ev.phase !== "down") return false;
      if (ev.key === "+" || ev.key === "=") {
        applyDelta(1);
        return true;
      }
      if (ev.key === "-" || ev.key === "_") {
        applyDelta(-1);
        return true;
      }
      if (ev.key === "0") {
        resetCount();
        return true;
      }
      return false;
    },
  });

  syncUi();

  return {
    app: appRef,
    increment: () => applyDelta(1),
    decrement: () => applyDelta(-1),
    reset: () => resetCount(),
    toggleTheme,
    getState: () => ({
      count: state.count,
      recent: [...state.recent],
      dark: state.dark,
    }),
  };
}

function findButtonId(backend: HeadlessBackend, label: string): number {
  const node = backend
    .getAccessibilityTree()
    .find((entry) => entry.role === "button" && entry.label === label);
  if (!node) {
    throw new Error(`Missing button a11y node for "${label}"`);
  }
  return node.id;
}

function runHeadlessSmoke(): void {
  const backend = new HeadlessBackend({ width: 520, height: 490 });
  const ctrl = createCounterApp(backend);
  ctrl.app.renderFrame();

  backend.triggerA11yPress(findButtonId(backend, "+1"));
  ctrl.app.step(0);
  backend.triggerA11yPress(findButtonId(backend, "+1"));
  ctrl.app.step(0);
  backend.triggerA11yPress(findButtonId(backend, "-1"));
  ctrl.app.step(0);
  const midState = ctrl.getState();

  backend.triggerA11yPress(findButtonId(backend, "-1"));
  ctrl.app.step(0);
  backend.triggerA11yPress(findButtonId(backend, "-1"));
  ctrl.app.step(0);
  const negState = ctrl.getState();

  backend.triggerA11yPress(findButtonId(backend, "Reset"));
  ctrl.app.step(0);
  const resetState = ctrl.getState();

  const ok =
    midState.count === 1 &&
    negState.count === -1 &&
    resetState.count === 0 &&
    resetState.recent.length <= 5;

  const summary = {
    app: "counter",
    mode: "headless-smoke",
    ok,
    midState,
    negState,
    resetState,
    frameCount: backend.getFrameCount(),
    a11yNodes: backend.getAccessibilityTree().length,
  };
  ctrl.app.dispose();
  console.log(JSON.stringify(summary));
  if (!ok) {
    process.exit(1);
  }
}

function runNativeSmoke(): void {
  const backend = createNativeBackend();
  const ctrl = createCounterApp(backend);
  ctrl.app.renderFrame();
  ctrl.increment();
  ctrl.increment();
  ctrl.decrement();
  ctrl.app.renderFrame();
  const metrics = ctrl.app.getWindowMetrics();
  const state = ctrl.getState();
  const summary = {
    app: "counter",
    mode: "native-smoke",
    ok: state.count === 1 && metrics.width > 0 && metrics.height > 0,
    state,
    metrics,
  };
  ctrl.app.dispose();
  console.log(JSON.stringify(summary));
  if (!summary.ok) {
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
  const ctrl = createCounterApp(backend);
  try {
    await ctrl.app.run();
  } finally {
    ctrl.app.dispose();
  }
}

void main();
