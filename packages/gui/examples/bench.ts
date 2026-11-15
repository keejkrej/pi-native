import {
  type A11yActionKind,
  Badge,
  type BadgeVariant,
  Box,
  Button,
  CombinedAutocompleteProvider,
  Divider,
  Editor,
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
  SGUI_A11Y_STATE_ENABLED,
  SGUI_A11Y_STATE_FOCUSED,
  SGUI_CURSOR_POINTER,
  SGUI_FONT_MONO,
  SGUI_FONT_REGULAR,
  ScrollView,
  type SelectItem,
  SelectList,
  type Size,
  type StackChild,
  Text,
  VStack,
  VectorIcon,
  VirtualList,
  allocateA11yId,
  darkGuiTheme,
  lightGuiTheme,
  oklchColor,
  pointInRect,
  withAlpha,
} from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

type BenchMode = "grid" | "rows" | "inputs";

interface BenchRow {
  index: number;
  label: string;
  tag: string;
  valueMs: number;
}

class HeatCellButton extends GuiComponent {
  override readonly a11yId: number = allocateA11yId();
  private readonly index: number;
  private labelValue: string;
  private tickValue: number;
  private singleHighlighted = false;
  private pressed = false;
  private themeGetter: () => GuiTheme;
  private onPress: () => void;
  override focusable = true;
  override cursor = SGUI_CURSOR_POINTER;

  constructor(
    index: number,
    label: string,
    themeGetter: () => GuiTheme,
    onPress: () => void,
  ) {
    super();
    this.index = index;
    this.labelValue = label;
    this.tickValue = 0;
    this.themeGetter = themeGetter;
    this.onPress = onPress;
  }

  getLabel(): string {
    return this.labelValue;
  }

  setCell(label: string, tick: number, singleHighlighted = false): void {
    this.labelValue = label;
    this.tickValue = tick;
    this.singleHighlighted = singleHighlighted;
    this.invalidate();
  }

  override measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
    const w = Number.isFinite(maxWidth) ? Math.max(58, maxWidth) : 80;
    return { width: w, height: 32 };
  }

  override render(ctx: GuiRenderContext): void {
    const b = this.layoutRect;
    const t = this.themeGetter();
    const isMaster = this.index === 0;
    const hue = (this.index * 11 + this.tickValue * 43 + (this.singleHighlighted ? 120 : 0)) % 360;
    const cellColor = isMaster
      ? t.accent
      : oklchColor(t.dark ? 0.72 : 0.56, 0.14, hue);

    const fillAlpha = isMaster
      ? this.pressed
        ? 0.34
        : this.isHovered()
          ? 0.28
          : 0.2
      : this.pressed
        ? 0.28
        : this.isHovered()
          ? 0.22
          : t.dark
            ? 0.14
            : 0.11;

    const borderAlpha = isMaster
      ? 0.9
      : this.isHovered() || this.singleHighlighted
        ? 0.75
        : t.dark
          ? 0.34
          : 0.28;

    ctx.fillRect(b.x, b.y, b.width, b.height, withAlpha(cellColor, fillAlpha), 8);
    ctx.strokeRect(b.x, b.y, b.width, b.height, withAlpha(cellColor, borderAlpha), isMaster ? 1.5 : 1, 8);

    if (this.isFocused()) {
      ctx.strokeRect(
        b.x - 1,
        b.y - 1,
        b.width + 2,
        b.height + 2,
        withAlpha(t.borderFocus, 0.75),
        1.5,
        9,
      );
    }

    const style = {
      fontFamily: SGUI_FONT_MONO,
      fontSize: 11,
      fontWeight: isMaster || this.singleHighlighted ? 700 : 500,
    };
    const metrics = ctx.measureText(style, Math.max(16, b.width - 8), this.labelValue);
    const tx = b.x + Math.max(4, Math.round((b.width - metrics.width) / 2));
    const ty = b.y + Math.round((b.height - 14) / 2);
    const textColor = isMaster ? t.accent : t.text;
    ctx.drawStyledText(tx, ty, Math.max(12, b.width - 8), textColor, style, this.labelValue);
  }

  override handlePointer(ev: GuiPointerEvent, _ctx: GuiRenderContext): GuiPointerResult {
    const inside = pointInRect(ev.x, ev.y, this.layoutRect);
    if (ev.phase === "move" || ev.phase === "enter" || ev.phase === "leave") {
      return { handled: inside, cursor: inside ? SGUI_CURSOR_POINTER : undefined };
    }
    if (ev.phase === "down" && ev.button === "left") {
      if (!inside) return { handled: false };
      this.pressed = true;
      this.invalidate();
      return { handled: true, capture: this, focus: this, cursor: SGUI_CURSOR_POINTER };
    }
    if (ev.phase === "up" && ev.button === "left") {
      const wasPressed = this.pressed;
      this.pressed = false;
      this.invalidate();
      if (wasPressed && inside) {
        this.onPress();
        return { handled: true, releaseCapture: true };
      }
      return { handled: wasPressed, releaseCapture: true };
    }
    return { handled: false };
  }

  override handleKey(ev: GuiKeyEvent, _ctx: GuiRenderContext): boolean {
    if (ev.phase !== "down") return false;
    if (ev.key === "enter" || ev.key === "Enter" || ev.key === " " || ev.key === "space") {
      this.onPress();
      return true;
    }
    return false;
  }

  override collectAccessibilityNodes(out: import("../src/index.ts").GuiA11yNode[], _ctx: GuiRenderContext): void {
    let stateFlags = SGUI_A11Y_STATE_ENABLED;
    if (this.isFocused()) stateFlags |= SGUI_A11Y_STATE_FOCUSED;
    out.push({
      id: this.a11yId,
      role: "button",
      label: this.labelValue,
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
    if (nodeId !== this.a11yId) return false;
    if (action === "press") {
      this.onPress();
      return true;
    }
    return false;
  }
}

function buildRows(count: number): BenchRow[] {
  const tags = ["layout", "measure", "paint", "a11y", "scroll"];
  const rows: BenchRow[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      index: i + 1,
      label: `Virtual benchmark row #${i + 1}`,
      tag: tags[i % tags.length]!,
      valueMs: Math.round(((i * 17) % 97) * 0.1 * 10) / 10,
    });
  }
  return rows;
}

function buildTenThousandItems(): SelectItem[] {
  const groups = ["core", "layout", "render", "text", "ffi", "input", "canvas", "menu"];
  const items: SelectItem[] = [];
  for (let i = 1; i <= 10000; i += 1) {
    const grp = groups[i % groups.length]!;
    items.push({
      value: `item-${i}`,
      label: `${grp}/bench-symbol-${i}`,
      description: `Index #${i} in 10k catalog`,
    });
  }
  return items;
}

function tagBadgeVariant(tag: string): BadgeVariant {
  if (tag === "paint") return "success";
  if (tag === "measure") return "warning";
  if (tag === "layout" || tag === "scroll") return "accent";
  return "neutral";
}

interface KpiCardHandles {
  box: Box;
  label: Text;
  value: Text;
  badge: Badge;
}

function makeKpiCard(title: string, initialBadge: string, variant: BadgeVariant = "neutral"): KpiCardHandles {
  const label = new Text({
    text: title,
    fontSize: 10.5,
    fontWeight: 600,
    fontFamily: SGUI_FONT_MONO,
  });
  const value = new Text({
    text: "—",
    fontSize: 18,
    fontWeight: 700,
    fontFamily: SGUI_FONT_MONO,
  });
  const badge = new Badge({
    label: initialBadge,
    variant,
    fontSize: 10,
  });
  const box = new Box({
    padding: { top: 10, right: 12, bottom: 10, left: 12 },
    radius: 12,
    borderWidth: 1,
    shadow: "sm",
    child: new VStack({
      gap: 6,
      align: "stretch",
      children: [
        new HStack({
          gap: 6,
          align: "center",
          children: [
            { child: label, grow: 1 },
            badge,
          ],
        }),
        value,
      ],
    }),
  });
  return { box, label, value, badge };
}

interface BenchController {
  app: GuiApp;
  selectMode: (mode: BenchMode) => void;
  triggerGridBatchUpdate: () => number;
  jumpRows: (index: number) => number;
  filterInputs: (query: string) => number;
  toggleTheme: () => void;
  getState: () => {
    mode: BenchMode;
    dark: boolean;
    gridTick: number;
    buttonCount: number;
    button1Label: string;
    rowsCount: number;
    renderedRows: number;
    totalSelectItems: number;
    filteredSelectItems: number;
    lastActionMs: number;
  };
}

function createBenchApp(
  backend: ReturnType<typeof createNativeBackend> | HeadlessBackend,
): BenchController {
  let mode: BenchMode = "grid";
  let dark = true;
  let gridTick = 0;
  let lastActionMs = 0;
  let gridMountMs: number | null = null;
  let gridUpdateMs: number | null = null;
  let rowsScrollMs: number | null = null;
  let inputsFilterMs: number | null = null;
  let appRef: GuiApp | null = null;

  function theme(): GuiTheme {
    return dark ? darkGuiTheme : lightGuiTheme;
  }

  // --- Header ---
  const brandIcon = new VectorIcon({ name: "activity", size: 15 });
  const brandBadgeBox = new Box({
    width: 30,
    height: 30,
    radius: 8,
    borderWidth: 1,
    padding: 7,
    child: brandIcon,
  });
  const titleText = new Text({ text: "UI Bench", fontSize: 19, fontWeight: 700 });
  const subtitleText = new Text({
    text: "200-cell grid, 1k virtual list & 10k searchable catalog",
    fontSize: 12,
  });
  const metricText = new Text({
    text: "Mode: Grid (200 cells) · 0.00 ms",
    fontSize: 11.5,
    fontFamily: SGUI_FONT_MONO,
  });

  const gridTabBtn = new Button({
    label: "Grid",
    variant: "primary",
    fontSize: 12.5,
    padding: { top: 5, right: 12, bottom: 5, left: 12 },
    onClick: () => selectMode("grid"),
  });
  const rowsTabBtn = new Button({
    label: "Rows",
    variant: "ghost",
    fontSize: 12.5,
    padding: { top: 5, right: 12, bottom: 5, left: 12 },
    onClick: () => selectMode("rows"),
  });
  const inputsTabBtn = new Button({
    label: "Inputs",
    variant: "ghost",
    fontSize: 12.5,
    padding: { top: 5, right: 12, bottom: 5, left: 12 },
    onClick: () => selectMode("inputs"),
  });
  const modePillGroup = new Box({
    padding: 3,
    radius: 10,
    borderWidth: 1,
    child: new HStack({
      gap: 2,
      align: "center",
      children: [gridTabBtn, rowsTabBtn, inputsTabBtn],
    }),
  });

  const runAllBtn = new Button({
    label: "Run All Benchmarks",
    leadingIcon: "rocket",
    iconSize: 13,
    variant: "primary",
    fontSize: 12.5,
    padding: { top: 6, right: 12, bottom: 6, left: 12 },
    onClick: () => runAllSuite(),
  });
  const themeBtn = new Button({
    label: "Theme",
    leadingIcon: "sun",
    iconSize: 13,
    variant: "secondary",
    fontSize: 12.5,
    padding: { top: 6, right: 10, bottom: 6, left: 10 },
    onClick: () => toggleTheme(),
  });

  const headerRow = new HStack({
    gap: 12,
    align: "center",
    children: [
      new HStack({
        gap: 10,
        align: "center",
        children: [
          brandBadgeBox,
          new VStack({
            gap: 1,
            align: "start",
            children: [titleText, subtitleText],
          }),
        ],
      }),
      { child: new Box({ height: 1 }), grow: 1 },
      modePillGroup,
      runAllBtn,
      themeBtn,
    ],
  });

  // --- KPI Row ---
  const kpiMount = makeKpiCard("GRID MOUNT", "200 CELLS", "neutral");
  const kpiUpdate = makeKpiCard("200-CELL UPDATE", "TICK 0", "accent");
  const kpiScroll = makeKpiCard("500-ROW SCROLL", "1K VIRTUAL", "neutral");
  const kpiFilter = makeKpiCard("10K FILTER", "10,000", "neutral");

  const kpiRow = new HStack({
    gap: 10,
    align: "stretch",
    children: [
      { child: kpiMount.box, grow: 1 },
      { child: kpiUpdate.box, grow: 1 },
      { child: kpiScroll.box, grow: 1 },
      { child: kpiFilter.box, grow: 1 },
    ],
  });

  // =========================================================================
  // MODE 1: GRID (200 OKLCH Heatmap Cells)
  // =========================================================================
  const gridHint = new Text({
    text: "Press #1 · 0 to batch-update all 200 OKLCH cells and sample frame latency",
    fontSize: 12,
  });
  const batchBtn = new Button({
    label: "Batch Update",
    leadingIcon: "reset",
    iconSize: 12,
    variant: "secondary",
    fontSize: 12,
    padding: { top: 4, right: 10, bottom: 4, left: 10 },
    onClick: () => triggerGridBatchUpdate(),
  });

  const gridCells: HeatCellButton[] = [];
  const gridRowsStack = new VStack({ gap: 6, align: "stretch" });
  const cols = 8;
  const totalButtons = 200;

  for (let r = 0; r < totalButtons / cols; r += 1) {
    const rowChildren: StackChild[] = [];
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      const btnNum = idx + 1;
      const cell = new HeatCellButton(
        idx,
        `#${btnNum} · ${gridTick}`,
        () => theme(),
        () => {
          if (idx === 0) {
            triggerGridBatchUpdate();
          } else {
            const t0 = performance.now();
            cell.setCell(`#${btnNum} *`, gridTick, true);
            appRef?.renderFrame();
            lastActionMs = Math.round((performance.now() - t0) * 100) / 100;
            syncHeaderMetrics();
          }
        },
      );
      gridCells.push(cell);
      rowChildren.push({ child: cell, grow: 1 });
    }
    gridRowsStack.addChild(
      new HStack({
        gap: 6,
        align: "center",
        children: rowChildren,
      }),
    );
  }

  const gridDivider = new Divider({});
  const gridScroll = new ScrollView({ child: gridRowsStack, padding: { top: 4, right: 4, bottom: 4, left: 0 } });
  const gridCard = new Box({
    padding: 14,
    radius: 14,
    borderWidth: 1,
    shadow: "sm",
    child: new VStack({
      gap: 10,
      align: "stretch",
      children: [
        new HStack({
          gap: 10,
          align: "center",
          children: [
            { child: gridHint, grow: 1 },
            metricText,
            batchBtn,
          ],
        }),
        gridDivider,
        { child: gridScroll, grow: 1 },
      ],
    }),
  });

  // =========================================================================
  // MODE 2: ROWS (1,000-row Virtualized Table)
  // =========================================================================
  const rowsData = buildRows(1000);
  const rowsRangeText = new Text({
    text: "Range 0..15 · 1,000 items",
    fontSize: 11.5,
    fontFamily: SGUI_FONT_MONO,
  });

  const virtualRows = new VirtualList<BenchRow>({
    items: rowsData,
    estimatedItemHeight: 38,
    gap: 0,
    overscan: 4,
    padding: 0,
    keyFn: (row) => String(row.index),
    renderItem: (row) => {
      const t = theme();
      const rowBg = row.index % 2 === 0 ? withAlpha(t.surfaceMuted, t.dark ? 0.45 : 0.6) : t.surface;
      const idxText = new Text({
        text: `#${String(row.index).padStart(4, "0")}`,
        fontSize: 11.5,
        fontFamily: SGUI_FONT_MONO,
        color: t.textMuted,
      });
      const labelText = new Text({
        text: row.label,
        fontSize: 13,
        color: t.text,
      });
      const tagBadge = new Badge({
        label: row.tag,
        variant: tagBadgeVariant(row.tag),
        fontSize: 10.5,
      });
      const msText = new Text({
        text: `${row.valueMs.toFixed(1)} ms`,
        fontSize: 11.5,
        fontFamily: SGUI_FONT_MONO,
        color: row.valueMs > 7.5 ? t.warning : t.textMuted,
      });

      const rowContent = new HStack({
        gap: 10,
        align: "center",
        children: [
          new Box({ width: 58, child: idxText }),
          { child: labelText, grow: 1 },
          new Box({ width: 82, alignHorizontal: "start", child: tagBadge }),
          new Box({ width: 68, alignHorizontal: "end", child: msText }),
        ],
      });

      return new Box({
        height: 38,
        background: rowBg,
        child: new VStack({
          gap: 0,
          align: "stretch",
          children: [
            {
              child: new Box({
                padding: { top: 8, right: 14, bottom: 7, left: 14 },
                child: rowContent,
              }),
              grow: 1,
            },
            new Divider({ color: withAlpha(t.border, 0.55) }),
          ],
        }),
      });
    },
  });

  const colIdx = new Text({ text: "IDX", fontSize: 10.5, fontWeight: 600, fontFamily: SGUI_FONT_MONO });
  const colOp = new Text({ text: "OPERATION", fontSize: 10.5, fontWeight: 600, fontFamily: SGUI_FONT_MONO });
  const colSub = new Text({ text: "SUBSYSTEM", fontSize: 10.5, fontWeight: 600, fontFamily: SGUI_FONT_MONO });
  const colLat = new Text({ text: "LATENCY", fontSize: 10.5, fontWeight: 600, fontFamily: SGUI_FONT_MONO });
  const rowsTableHeader = new Box({
    padding: { top: 7, right: 14, bottom: 7, left: 14 },
    child: new HStack({
      gap: 10,
      align: "center",
      children: [
        new Box({ width: 58, child: colIdx }),
        { child: colOp, grow: 1 },
        new Box({ width: 82, child: colSub }),
        new Box({ width: 68, alignHorizontal: "end", child: colLat }),
      ],
    }),
  });
  const rowsHeaderDivider = new Divider({});
  const rowsBodyDivider = new Divider({});

  const rowsCard = new Box({
    padding: 0,
    radius: 14,
    borderWidth: 1,
    shadow: "sm",
    clip: true,
    child: new VStack({
      gap: 0,
      align: "stretch",
      children: [
        new Box({
          padding: { top: 10, right: 14, bottom: 10, left: 14 },
          child: new HStack({
            gap: 8,
            align: "center",
            children: [
              new Button({ label: "Jump #1", variant: "secondary", fontSize: 12, padding: { top: 4, right: 10, bottom: 4, left: 10 }, onClick: () => jumpRows(0) }),
              new Button({ label: "Jump #500", variant: "secondary", fontSize: 12, padding: { top: 4, right: 10, bottom: 4, left: 10 }, onClick: () => jumpRows(499) }),
              new Button({ label: "Jump #1000", variant: "secondary", fontSize: 12, padding: { top: 4, right: 10, bottom: 4, left: 10 }, onClick: () => jumpRows(999) }),
              { child: new Box({ height: 1 }), grow: 1 },
              rowsRangeText,
            ],
          }),
        }),
        rowsHeaderDivider,
        rowsTableHeader,
        rowsBodyDivider,
        { child: virtualRows, grow: 1 },
      ],
    }),
  });

  // =========================================================================
  // MODE 3: INPUTS (10,000-item SelectList + Dual Inputs + Editor)
  // =========================================================================
  const tenKItems = buildTenThousandItems();
  const inputsStatus = new Text({
    text: "Showing 10,000 items",
    fontSize: 12,
    fontFamily: SGUI_FONT_MONO,
  });
  const inputsMatchBadge = new Badge({
    label: "10,000 / 10,000",
    variant: "accent",
    fontSize: 10.5,
  });

  const largeSelectList = new SelectList({
    items: tenKItems,
    maxVisible: 7,
    rowHeight: 30,
    radius: 10,
    onSelect: (item) => {
      inputsStatus.setText(`Selected ${item.value} (${item.label})`);
      appRef?.invalidate();
    },
  });

  const filterInput = new Input({
    value: "",
    placeholder: "Filter 10,000 items...",
    onChange: (q) => filterInputs(q),
  });

  const numericInput = new Input({
    value: "250",
    placeholder: "Batch iterations (number)",
    onChange: (v) => {
      inputsStatus.setText(`Batch count: ${v || "0"}`);
      appRef?.invalidate();
    },
  });

  const clearFilterBtn = new Button({
    label: "Clear",
    leadingIcon: "reset",
    iconSize: 12,
    variant: "ghost",
    fontSize: 12,
    padding: { top: 6, right: 10, bottom: 6, left: 10 },
    onClick: () => {
      filterInput.setValue("");
      filterInputs("");
    },
  });

  const benchAutocomplete = new CombinedAutocompleteProvider(
    [
      { name: "bench", description: "Run Grid/Rows/Inputs timing pass" },
      { name: "reset", description: "Reset counters and filter query" },
    ],
    undefined,
    false,
  );
  const notesEditor = new Editor({
    initialValue: "10,000-item SelectList + dual Inputs + multiline Editor benchmark",
    placeholder: "Benchmark notes...",
    autocompleteProvider: benchAutocomplete,
    minHeight: 78,
    maxHeight: 112,
  });

  const inputsDivider = new Divider({});
  const inputsCard = new Box({
    padding: 14,
    radius: 14,
    borderWidth: 1,
    shadow: "sm",
    child: new VStack({
      gap: 10,
      align: "stretch",
      children: [
        new HStack({
          gap: 8,
          align: "center",
          children: [
            { child: filterInput, grow: 2 },
            { child: numericInput, grow: 1 },
            clearFilterBtn,
          ],
        }),
        new HStack({
          gap: 8,
          align: "center",
          children: [
            { child: inputsStatus, grow: 1 },
            inputsMatchBadge,
          ],
        }),
        { child: largeSelectList, grow: 1 },
        inputsDivider,
        notesEditor,
      ],
    }),
  });

  // --- Shell ---
  const bodySlot = new Box({ child: gridCard });
  const centerColumn = new Box({
    maxWidth: 760,
    fillWidth: true,
    alignHorizontal: "center",
    child: new VStack({
      gap: 14,
      align: "stretch",
      children: [
        headerRow,
        kpiRow,
        { child: bodySlot, grow: 1 },
      ],
    }),
  });

  const rootShell = new Box({
    padding: { top: 18, right: 22, bottom: 18, left: 22 },
    child: centerColumn,
  });

  function formatCount(value: number): string {
    const s = String(Math.trunc(value));
    let out = "";
    for (let i = 0; i < s.length; i += 1) {
      if (i > 0 && (s.length - i) % 3 === 0) {
        out += ",";
      }
      out += s[i]!;
    }
    return out;
  }

  function formatMs(val: number | null): string {
    return val === null ? "—" : `${val.toFixed(2)} ms`;
  }

  function syncKpis(): void {
    kpiMount.value.setText(formatMs(gridMountMs));
    kpiUpdate.value.setText(formatMs(gridUpdateMs));
    kpiUpdate.badge.setLabel(`TICK ${gridTick}`);
    kpiScroll.value.setText(formatMs(rowsScrollMs));
    kpiFilter.value.setText(formatMs(inputsFilterMs));
  }

  function triggerGridBatchUpdate(): number {
    const t0 = performance.now();
    gridTick += 1;
    for (let i = 0; i < gridCells.length; i += 1) {
      gridCells[i]!.setCell(`#${i + 1} · ${gridTick}`, gridTick, false);
    }
    appRef?.renderFrame();
    lastActionMs = Math.round((performance.now() - t0) * 100) / 100;
    gridUpdateMs = lastActionMs;
    syncKpis();
    syncHeaderMetrics();
    return lastActionMs;
  }

  function jumpRows(index: number): number {
    const t0 = performance.now();
    virtualRows.scrollToIndex(index, "start");
    appRef?.renderFrame();
    lastActionMs = Math.round((performance.now() - t0) * 100) / 100;
    rowsScrollMs = lastActionMs;
    const vis = virtualRows.getVisibleRange();
    rowsRangeText.setText(
      `Range ${vis.startIndex}..${vis.endIndex} · Rendered: ${virtualRows.getRenderedCount()} (${lastActionMs.toFixed(2)} ms)`,
    );
    syncKpis();
    syncHeaderMetrics();
    return lastActionMs;
  }

  function filterInputs(query: string): number {
    const t0 = performance.now();
    largeSelectList.setFilter(query);
    appRef?.renderFrame();
    lastActionMs = Math.round((performance.now() - t0) * 100) / 100;
    inputsFilterMs = lastActionMs;
    const matches = largeSelectList.getFilteredItems().length;
    const matchStr = formatCount(matches);
    const totalStr = formatCount(tenKItems.length);
    inputsStatus.setText(
      `Matches: ${matchStr} / ${totalStr} (${lastActionMs.toFixed(2)} ms)`,
    );
    inputsMatchBadge.setLabel(`${matchStr} / ${totalStr}`);
    inputsMatchBadge.setVariant(matches > 0 ? "accent" : "warning");
    syncKpis();
    syncHeaderMetrics();
    return lastActionMs;
  }

  function runAllSuite(): void {
    const savedMode = mode;
    const t0 = performance.now();
    selectMode("grid");
    gridMountMs = Math.round((performance.now() - t0) * 100) / 100;
    triggerGridBatchUpdate();
    selectMode("rows");
    jumpRows(499);
    selectMode("inputs");
    filterInputs("render/bench-symbol-9");
    selectMode(savedMode);
  }

  function selectMode(next: BenchMode): void {
    const t0 = performance.now();
    mode = next;
    syncUi();
    appRef?.renderFrame();
    lastActionMs = Math.round((performance.now() - t0) * 100) / 100;
    if (gridMountMs === null && next === "grid") {
      gridMountMs = lastActionMs;
      syncKpis();
    }
    syncHeaderMetrics();
  }

  function toggleTheme(): void {
    dark = !dark;
    appRef?.setTheme(theme());
    syncUi();
  }

  function syncHeaderMetrics(): void {
    const label =
      mode === "grid"
        ? `Grid (200 cells, tick=${gridTick})`
        : mode === "rows"
          ? `Rows (1k virtual, rendered=${virtualRows.getRenderedCount()})`
          : `Inputs (${largeSelectList.getFilteredItems().length}/${tenKItems.length})`;
    metricText.setText(`${label} · ${lastActionMs.toFixed(2)} ms`);
    appRef?.invalidate();
  }

  function syncUi(): void {
    const t = theme();
    rootShell.setBackground(t.background);
    bodySlot.setBackground(t.background);

    brandBadgeBox.setBackground(withAlpha(t.accent, 0.14));
    brandBadgeBox.setBorder(withAlpha(t.accent, 0.35), 1, 8);
    brandIcon.setColor(t.accent);
    titleText.setColor(t.text);
    subtitleText.setColor(t.textMuted);
    metricText.setColor(t.textMuted);

    modePillGroup.setBackground(t.surfaceMuted);
    modePillGroup.setBorder(t.border, 1, 10);
    gridTabBtn.setVariant(mode === "grid" ? "primary" : "ghost");
    rowsTabBtn.setVariant(mode === "rows" ? "primary" : "ghost");
    inputsTabBtn.setVariant(mode === "inputs" ? "primary" : "ghost");
    themeBtn.setLeadingIcon(dark ? "sun" : "moon");

    const kpis = [kpiMount, kpiUpdate, kpiScroll, kpiFilter];
    for (let i = 0; i < kpis.length; i += 1) {
      const k = kpis[i]!;
      k.box.setBackground(t.surface);
      k.box.setBorder(t.border, 1, 12);
      k.label.setColor(t.textMuted);
      k.value.setColor(t.text);
    }

    gridCard.setBackground(t.surface);
    gridCard.setBorder(t.border, 1, 14);
    gridHint.setColor(t.textMuted);
    gridDivider.setColor(t.border);

    rowsCard.setBackground(t.surface);
    rowsCard.setBorder(t.border, 1, 14);
    rowsRangeText.setColor(t.textMuted);
    rowsTableHeader.setBackground(t.surfaceMuted);
    rowsHeaderDivider.setColor(t.border);
    rowsBodyDivider.setColor(t.border);
    colIdx.setColor(t.textMuted);
    colOp.setColor(t.textMuted);
    colSub.setColor(t.textMuted);
    colLat.setColor(t.textMuted);
    virtualRows.setItems([...rowsData]);

    inputsCard.setBackground(t.surface);
    inputsCard.setBorder(t.border, 1, 14);
    inputsStatus.setColor(t.textMuted);
    inputsDivider.setColor(t.border);

    if (mode === "rows") {
      bodySlot.setChild(rowsCard);
    } else if (mode === "inputs") {
      bodySlot.setChild(inputsCard);
    } else {
      bodySlot.setChild(gridCard);
    }

    syncKpis();
    syncHeaderMetrics();
  }

  const menus: MenuSpec[] = [
    {
      title: "Bench",
      items: [{ kind: "action", label: "Quit Bench", role: "quit", shortcut: "cmd+q" }],
    },
    {
      title: "Mode",
      items: [
        { kind: "action", label: "Grid (200 Cells)", shortcut: "cmd+1", onSelect: () => selectMode("grid") },
        { kind: "action", label: "Rows (1k VirtualList)", shortcut: "cmd+2", onSelect: () => selectMode("rows") },
        { kind: "action", label: "Inputs (10k SelectList)", shortcut: "cmd+3", onSelect: () => selectMode("inputs") },
        { kind: "separator" },
        { kind: "action", label: "Run All Benchmarks", shortcut: "cmd+r", onSelect: () => runAllSuite() },
      ],
    },
  ];

  appRef = new GuiApp({
    backend,
    window: {
      title: "UI Bench — scriptc-ui",
      width: 880,
      height: 680,
      resizable: true,
    },
    theme: theme(),
    menus,
    root: rootShell,
  });

  syncUi();

  return {
    app: appRef,
    selectMode,
    triggerGridBatchUpdate,
    jumpRows,
    filterInputs,
    toggleTheme,
    getState: () => ({
      mode,
      dark,
      gridTick,
      buttonCount: gridCells.length,
      button1Label: gridCells[0]!.getLabel(),
      rowsCount: rowsData.length,
      renderedRows: virtualRows.getRenderedCount(),
      totalSelectItems: tenKItems.length,
      filteredSelectItems: largeSelectList.getFilteredItems().length,
      lastActionMs,
    }),
  };
}

function findBtn(backend: HeadlessBackend, label: string): number {
  const node = backend
    .getAccessibilityTree()
    .find((entry) => entry.role === "button" && entry.label === label);
  if (!node) {
    throw new Error(`Missing button "${label}"`);
  }
  return node.id;
}

function runBenchCli(): void {
  const backend = new HeadlessBackend({ width: 880, height: 680 });
  const ctrl = createBenchApp(backend);

  const tGridMount0 = performance.now();
  ctrl.app.renderFrame();
  const gridMountMs = Math.round((performance.now() - tGridMount0) * 100) / 100;

  const gridUpdate200Ms = ctrl.triggerGridBatchUpdate();

  ctrl.selectMode("rows");
  const rowsScroll500Ms = ctrl.jumpRows(499);

  ctrl.selectMode("inputs");
  const inputsFilterMs = ctrl.filterInputs("render/bench-symbol-9");

  const state = ctrl.getState();
  const result = {
    app: "bench",
    mode: "bench",
    ok:
      state.buttonCount === 200 &&
      state.gridTick === 1 &&
      state.rowsCount === 1000 &&
      state.totalSelectItems === 10000 &&
      state.filteredSelectItems > 0,
    timingsMs: {
      gridMountMs,
      gridUpdate200Ms,
      rowsScroll500Ms,
      inputsFilterMs,
    },
    state,
    frameCount: backend.getFrameCount(),
  };
  ctrl.app.dispose();
  console.log(JSON.stringify(result));
  if (!result.ok) {
    process.exit(1);
  }
}

function runHeadlessSmoke(): void {
  const backend = new HeadlessBackend({ width: 880, height: 680 });
  const ctrl = createBenchApp(backend);
  ctrl.app.renderFrame();

  backend.triggerA11yPress(findBtn(backend, "#1 · 0"));
  ctrl.app.step(0);
  const afterGrid = ctrl.getState();

  backend.triggerA11yPress(findBtn(backend, "Rows"));
  ctrl.app.step(0);
  const afterRows = ctrl.getState();

  backend.triggerA11yPress(findBtn(backend, "Inputs"));
  ctrl.app.step(0);
  const inputsFilterMs = ctrl.filterInputs("symbol-99");
  const afterInputs = ctrl.getState();

  const ok =
    afterGrid.gridTick === 1 &&
    afterGrid.button1Label === "#1 · 1" &&
    afterRows.mode === "rows" &&
    afterRows.renderedRows > 0 &&
    afterInputs.mode === "inputs" &&
    afterInputs.filteredSelectItems < 10000;

  const summary = {
    app: "bench",
    mode: "headless-smoke",
    ok,
    gridTick: afterGrid.gridTick,
    renderedRows: afterRows.renderedRows,
    filteredSelectItems: afterInputs.filteredSelectItems,
    inputsFilterMs,
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
  const ctrl = createBenchApp(backend);
  ctrl.app.renderFrame();
  const gridMs = ctrl.triggerGridBatchUpdate();
  ctrl.selectMode("rows");
  const rowsMs = ctrl.jumpRows(499);
  ctrl.selectMode("inputs");
  const filterMs = ctrl.filterInputs("canvas/bench-symbol-42");
  const metrics = ctrl.app.getWindowMetrics();
  const state = ctrl.getState();
  const ok =
    metrics.width > 0 &&
    state.gridTick === 1 &&
    state.buttonCount === 200 &&
    state.totalSelectItems === 10000;
  const summary = {
    app: "bench",
    mode: "native-smoke",
    ok,
    metrics,
    gridMs,
    rowsMs,
    filterMs,
    state,
  };
  ctrl.app.dispose();
  console.log(JSON.stringify(summary));
  if (!ok) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--bench")) {
    runBenchCli();
    return;
  }
  if (process.argv.includes("--headless-smoke")) {
    runHeadlessSmoke();
    return;
  }
  if (process.argv.includes("--native-smoke")) {
    runNativeSmoke();
    return;
  }
  const backend = createNativeBackend();
  const ctrl = createBenchApp(backend);
  try {
    await ctrl.app.run();
  } finally {
    ctrl.app.dispose();
  }
}

void main();
