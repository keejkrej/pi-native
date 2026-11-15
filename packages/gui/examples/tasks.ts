import {
  type A11yActionKind,
  Badge,
  Box,
  Button,
  Divider,
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
  SGUI_FONT_REGULAR,
  ScrollView,
  type Size,
  Switch,
  Text,
  VStack,
  VectorCanvas,
  VectorIcon,
  allocateA11yId,
  darkGuiTheme,
  drawVectorIcon,
  lightGuiTheme,
  pointInRect,
  rgbaColor,
  withAlpha,
} from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

interface TaskItem {
  id: string;
  title: string;
  notes: string;
  done: boolean;
}

type TasksRoute = "tasks" | "task";

interface TasksState {
  route: TasksRoute;
  selectedId: string | null;
  draft: string;
  tasks: TaskItem[];
  dark: boolean;
  confirmOpen: boolean;
}

class TaskRowButton extends GuiComponent {
  override readonly a11yId: number = allocateA11yId();
  private task: TaskItem;
  private theme: GuiTheme;
  private onPress: (id: string) => void;
  private pressed = false;
  override focusable = true;
  override cursor = SGUI_CURSOR_POINTER;

  constructor(task: TaskItem, theme: GuiTheme, onPress: (id: string) => void) {
    super();
    this.task = task;
    this.theme = theme;
    this.onPress = onPress;
  }

  measure(_ctx: GuiRenderContext, maxWidth: number, _maxHeight?: number): Size {
    const w = Number.isFinite(maxWidth) ? Math.max(200, maxWidth) : 480;
    return { width: w, height: 50 };
  }

  render(ctx: GuiRenderContext): void {
    const b = this.layoutRect;
    const t = this.theme;
    const bg = this.pressed
      ? t.surfaceMuted
      : this.isHovered()
        ? withAlpha(t.accent, t.dark ? 0.08 : 0.05)
        : t.surface;
    ctx.fillRect(b.x, b.y, b.width, b.height, bg, 0);

    if (this.isFocused()) {
      ctx.strokeRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4, withAlpha(t.borderFocus, 0.7), 1.5, 6);
    }

    // Left completion indicator (rounded check circle)
    const indSize = 18;
    const indX = b.x + 16;
    const indY = b.y + Math.round((b.height - indSize) / 2);
    if (this.task.done) {
      ctx.fillRect(indX, indY, indSize, indSize, t.success, 9);
      drawVectorIcon(ctx, "check", indX + 3, indY + 3, 12, t.textOnAccent, 1.8);
    } else {
      ctx.strokeRect(indX, indY, indSize, indSize, t.border, 1.5, 9);
    }

    // Right status pill + chevron lane
    const statusLabel = this.task.done ? "Done" : "Open";
    const statusColor = this.task.done ? t.success : t.textMuted;
    const statusMetrics = ctx.measureText(
      { fontFamily: SGUI_FONT_REGULAR, fontSize: 11, fontWeight: 600 },
      100,
      statusLabel,
    );
    const pillW = Math.max(46, Math.ceil(statusMetrics.width) + 18);
    const pillH = 22;
    const chevSize = 14;
    const chevX = b.x + b.width - 14 - chevSize;
    const chevY = b.y + Math.round((b.height - chevSize) / 2);
    const pillX = chevX - 8 - pillW;
    const pillY = b.y + Math.round((b.height - pillH) / 2);

    const pillBg = this.task.done ? withAlpha(t.success, 0.14) : t.surfaceMuted;
    const pillBorder = this.task.done ? withAlpha(t.success, 0.35) : t.border;
    ctx.fillRect(pillX, pillY, pillW, pillH, pillBg, 11);
    ctx.strokeRect(pillX, pillY, pillW, pillH, pillBorder, 1, 11);
    ctx.drawStyledText(
      pillX + Math.round((pillW - statusMetrics.width) / 2),
      pillY + 4,
      pillW - 8,
      statusColor,
      { fontFamily: SGUI_FONT_REGULAR, fontSize: 11, fontWeight: 600 },
      statusLabel,
    );
    drawVectorIcon(ctx, "chevron-right", chevX, chevY, chevSize, t.textDisabled, 1.6);

    // Title
    const titleX = indX + indSize + 12;
    const titleMaxW = Math.max(40, pillX - titleX - 12);
    const titleColor = this.task.done ? t.textMuted : t.text;
    ctx.drawStyledText(
      titleX,
      b.y + Math.round((b.height - 17) / 2),
      titleMaxW,
      titleColor,
      {
        fontFamily: SGUI_FONT_REGULAR,
        fontSize: 13.5,
        fontWeight: 500,
        strikethrough: this.task.done,
      },
      this.task.title,
    );
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
        this.onPress(this.task.id);
        return { handled: true, releaseCapture: true };
      }
      return { handled: wasPressed, releaseCapture: true };
    }
    return { handled: false };
  }

  override handleKey(ev: GuiKeyEvent, _ctx: GuiRenderContext): boolean {
    if (ev.phase !== "down") return false;
    if (ev.key === "Enter" || ev.key === " ") {
      this.onPress(this.task.id);
      return true;
    }
    return false;
  }

  override collectAccessibilityNodes(out: GuiA11yNode[], _ctx: GuiRenderContext): void {
    let stateFlags = SGUI_A11Y_STATE_ENABLED;
    if (this.isFocused()) stateFlags |= SGUI_A11Y_STATE_FOCUSED;
    out.push({
      id: this.a11yId,
      role: "button",
      label: this.task.title,
      value: this.task.done ? "Done" : "Open",
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
      this.onPress(this.task.id);
      return true;
    }
    return false;
  }
}

interface TasksController {
  app: GuiApp;
  getState: () => TasksState;
  addTask: (title: string) => void;
  openTask: (id: string) => void;
  goBack: () => void;
  toggleDone: (done: boolean) => void;
  removeSelected: () => void;
}

function createTasksApp(
  backend: ReturnType<typeof createNativeBackend> | HeadlessBackend,
): TasksController {
  let nextSeq = 5;
  const state: TasksState = {
    route: "tasks",
    selectedId: null,
    draft: "",
    dark: true,
    confirmOpen: false,
    tasks: [
      {
        id: "1",
        title: "Wire native accessibility tree",
        notes: "Verify NSAccessibility element labels and roles via agent-desktop",
        done: true,
      },
      {
        id: "2",
        title: "Compile examples with scriptc",
        notes: "Build universal arm64 Mach-O binaries in dist/examples/",
        done: true,
      },
      {
        id: "3",
        title: "Refine concentric surface hierarchy",
        notes: "Single-surface rows separated by 1px hairlines",
        done: false,
      },
      {
        id: "4",
        title: "Verify light & dark contrast tokens",
        notes: "Check hover and focus ring visibility across both themes",
        done: false,
      },
    ],
  };

  let appRef: GuiApp | null = null;
  let confirmOverlay: OverlayHandle | null = null;

  function theme(): GuiTheme {
    return state.dark ? darkGuiTheme : lightGuiTheme;
  }

  // --- Screen 1: Tasks list ---
  const listHeading = new Text({
    text: "Tasks",
    fontSize: 22,
    fontWeight: 700,
  });
  const listSubtitle = new Text({
    text: "Focus queue & detail stack",
    fontSize: 12,
  });
  const remainingBadge = new Badge({
    label: "2 of 4 remaining",
    variant: "accent",
    fontSize: 11,
  });
  const themeBtn = new Button({
    label: "Light",
    leadingIcon: "sun",
    variant: "ghost",
    pill: true,
    onClick: () => toggleTheme(),
  });

  const progressCanvas = new VectorCanvas({
    height: 8,
    fillWidth: true,
    label: "Task completion progress",
    render: (surface, rect) => {
      const t = theme();
      surface.clear();
      surface.fillRoundedRect(0, 1, rect.width, 6, 3, t.surfaceMuted);
      const total = state.tasks.length;
      const done = state.tasks.filter((x) => x.done).length;
      const ratio = total > 0 ? done / total : 0;
      if (ratio > 0) {
        const fillW = Math.max(8, Math.round(rect.width * ratio));
        surface.fillRoundedRect(0, 1, fillW, 6, 3, ratio === 1 ? t.success : t.accent);
      }
    },
  });

  const draftInput = new Input({
    value: "",
    placeholder: "New task",
    radius: 10,
    onChange: (val) => {
      state.draft = val;
      addBtn.setDisabled(val.trim().length === 0);
    },
    onSubmit: (val) => {
      state.draft = val;
      submitDraft();
    },
  });

  const addBtn = new Button({
    label: "Add",
    leadingIcon: "plus",
    variant: "primary",
    radius: 10,
    disabled: true,
    onClick: () => submitDraft(),
  });

  const listItemsStack = new VStack({
    gap: 0,
    align: "stretch",
  });
  const emptyListBox = new Box({
    padding: 32,
    child: new VStack({
      gap: 6,
      align: "center",
      children: [
        new VectorIcon({ name: "check", size: 22 }),
        new Text({ text: "All caught up", fontSize: 14, fontWeight: 600 }),
        new Text({ text: "Add a task above to get started.", fontSize: 12 }),
      ],
    }),
  });

  const listScroll = new ScrollView({
    child: listItemsStack,
    padding: 0,
  });

  const listSurfaceCard = new Box({
    padding: 0,
    radius: 14,
    borderWidth: 1,
    shadow: "sm",
    clip: true,
    child: listScroll,
  });

  const listColumn = new Box({
    maxWidth: 560,
    fillWidth: true,
    alignHorizontal: "center",
    child: new VStack({
      gap: 14,
      align: "stretch",
      children: [
        new HStack({
          gap: 10,
          align: "center",
          children: [
            {
              child: new VStack({
                gap: 2,
                align: "stretch",
                children: [listHeading, listSubtitle],
              }),
              grow: 1,
            },
            remainingBadge,
            themeBtn,
          ],
        }),
        progressCanvas,
        new HStack({
          gap: 8,
          align: "center",
          children: [{ child: draftInput, grow: 1 }, addBtn],
        }),
        { child: listSurfaceCard, grow: 1 },
      ],
    }),
  });

  const listScreen = new Box({
    padding: 24,
    child: listColumn,
  });

  // --- Screen 2: Task detail ---
  const backBtn = new Button({
    label: "Back",
    leadingIcon: "chevron-left",
    variant: "ghost",
    onClick: () => goBack(),
  });
  const detailHeaderTitle = new Text({
    text: "Task Detail",
    fontSize: 18,
    fontWeight: 700,
  });
  const detailStatusBadge = new Badge({
    label: "OPEN",
    variant: "neutral",
  });
  const detailThemeBtn = new Button({
    label: "Light",
    leadingIcon: "sun",
    variant: "ghost",
    pill: true,
    onClick: () => toggleTheme(),
  });

  const detailTitleText = new Text({
    text: "",
    fontSize: 18,
    fontWeight: 700,
    wrap: true,
  });
  const detailNotesLabel = new Text({
    text: "Notes",
    fontSize: 12,
    fontWeight: 600,
  });
  const detailNotesInput = new Input({
    value: "",
    placeholder: "Add notes for this task...",
    radius: 8,
    onChange: (val) => {
      if (!state.selectedId) return;
      state.tasks = state.tasks.map((t) =>
        t.id === state.selectedId ? { ...t, notes: val } : t,
      );
    },
  });

  const doneSwitch = new Switch({
    label: "Done",
    checked: false,
    onChange: (checked) => toggleDone(checked),
  });
  const doneHelperText = new Text({
    text: "Mark task complete in queue",
    fontSize: 12,
  });

  const removeHintText = new Text({
    text: "This action cannot be undone",
    fontSize: 12,
  });
  const removeBtn = new Button({
    label: "Remove",
    leadingIcon: "trash",
    variant: "danger",
    onClick: () => openRemoveModal(),
  });

  const detailDivider1 = new Divider();
  const detailDivider2 = new Divider();

  const detailCard = new Box({
    padding: 0,
    radius: 14,
    borderWidth: 1,
    shadow: "sm",
    child: new VStack({
      gap: 0,
      align: "stretch",
      children: [
        new Box({
          padding: 20,
          child: new VStack({
            gap: 10,
            align: "stretch",
            children: [detailTitleText, detailNotesLabel, detailNotesInput],
          }),
        }),
        detailDivider1,
        new Box({
          padding: { top: 14, right: 20, bottom: 14, left: 20 },
          child: new HStack({
            gap: 12,
            align: "center",
            children: [{ child: doneHelperText, grow: 1 }, doneSwitch],
          }),
        }),
        detailDivider2,
        new Box({
          padding: { top: 14, right: 20, bottom: 14, left: 20 },
          child: new HStack({
            gap: 12,
            align: "center",
            children: [{ child: removeHintText, grow: 1 }, removeBtn],
          }),
        }),
      ],
    }),
  });

  const detailColumn = new Box({
    maxWidth: 560,
    fillWidth: true,
    alignHorizontal: "center",
    child: new VStack({
      gap: 16,
      align: "stretch",
      children: [
        new HStack({
          gap: 10,
          align: "center",
          children: [
            backBtn,
            { child: detailHeaderTitle, grow: 1 },
            detailStatusBadge,
            detailThemeBtn,
          ],
        }),
        detailCard,
      ],
    }),
  });

  const detailScreen = new Box({
    padding: 24,
    child: detailColumn,
  });

  const rootContainer = new Box({
    child: listScreen,
  });

  function currentTask(): TaskItem | undefined {
    if (!state.selectedId) return undefined;
    return state.tasks.find((t) => t.id === state.selectedId);
  }

  function submitDraft(): void {
    const trimmed = state.draft.trim();
    if (!trimmed) return;
    addTask(trimmed);
  }

  function addTask(title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const item: TaskItem = {
      id: String(nextSeq++),
      title: trimmed,
      notes: "",
      done: false,
    };
    state.tasks = [item, ...state.tasks];
    state.draft = "";
    draftInput.setValue("");
    addBtn.setDisabled(true);
    syncUi();
  }

  function openTask(id: string): void {
    const target = state.tasks.find((t) => t.id === id);
    if (!target) return;
    state.selectedId = id;
    state.route = "task";
    detailNotesInput.setValue(target.notes);
    syncUi();
  }

  function goBack(): void {
    closeConfirmModal();
    state.route = "tasks";
    syncUi();
  }

  function toggleDone(checked: boolean): void {
    if (!state.selectedId) return;
    state.tasks = state.tasks.map((t) =>
      t.id === state.selectedId ? { ...t, done: checked } : t,
    );
    syncUi();
  }

  function closeConfirmModal(): void {
    if (confirmOverlay) {
      confirmOverlay.dispose();
      confirmOverlay = null;
    }
    state.confirmOpen = false;
  }

  function removeSelected(): void {
    if (!state.selectedId) return;
    const targetId = state.selectedId;
    state.tasks = state.tasks.filter((t) => t.id !== targetId);
    state.selectedId = null;
    state.route = "tasks";
    closeConfirmModal();
    syncUi();
  }

  function openRemoveModal(): void {
    const task = currentTask();
    if (!task || !appRef) return;
    closeConfirmModal();
    const t = theme();

    const dialog = new Box({
      padding: 20,
      radius: 14,
      background: t.surfaceElevated,
      borderColor: t.border,
      borderWidth: 1,
      child: new VStack({
        gap: 14,
        align: "stretch",
        children: [
          new HStack({
            gap: 10,
            align: "center",
            children: [
              new Box({
                padding: 8,
                radius: 10,
                background: withAlpha(t.danger, 0.14),
                borderColor: withAlpha(t.danger, 0.35),
                child: new VectorIcon({ name: "alert", size: 16, color: t.danger }),
              }),
              new Text({
                text: "Remove this task?",
                fontSize: 16,
                fontWeight: 700,
                color: t.text,
              }),
            ],
          }),
          new Text({
            text: `"${task.title}" will be permanently deleted from your queue.`,
            fontSize: 13,
            color: t.textMuted,
            wrap: true,
          }),
          new HStack({
            gap: 10,
            align: "center",
            children: [
              {
                child: new Button({
                  label: "Cancel",
                  variant: "secondary",
                  radius: 8,
                  onClick: () => {
                    closeConfirmModal();
                    appRef?.invalidate();
                  },
                }),
                grow: 1,
              },
              {
                child: new Button({
                  label: "Remove",
                  leadingIcon: "trash",
                  variant: "danger",
                  radius: 8,
                  onClick: () => removeSelected(),
                }),
                grow: 1,
              },
            ],
          }),
        ],
      }),
    });

    state.confirmOpen = true;
    confirmOverlay = appRef.showOverlay(dialog, {
      modal: true,
      width: 360,
      radius: 14,
      shadow: "lg",
      dismissOnBackdropClick: true,
      dismissOnEscape: true,
      backdropColor: rgbaColor(0, 0, 0, t.dark ? 150 : 95),
      onDismiss: () => {
        confirmOverlay = null;
        state.confirmOpen = false;
      },
    });
  }

  function toggleTheme(): void {
    state.dark = !state.dark;
    appRef?.setTheme(theme());
    syncUi();
  }

  function syncUi(): void {
    const t = theme();
    const themeLabel = state.dark ? "Light" : "Dark";
    const themeIcon = state.dark ? "sun" : "moon";
    rootContainer.setBackground(t.background);
    listScreen.setBackground(t.background);
    detailScreen.setBackground(t.background);
    themeBtn.setLabel(themeLabel);
    themeBtn.setLeadingIcon(themeIcon);
    detailThemeBtn.setLabel(themeLabel);
    detailThemeBtn.setLeadingIcon(themeIcon);

    const total = state.tasks.length;
    const openCount = state.tasks.filter((x) => !x.done).length;
    listHeading.setColor(t.text);
    listSubtitle.setColor(t.textMuted);
    remainingBadge.setLabel(`${openCount} of ${total} remaining`);
    remainingBadge.setVariant(total > 0 && openCount === 0 ? "success" : "accent");

    listSurfaceCard.setBackground(t.surface);
    listSurfaceCard.setBorder(t.border, 1);

    listItemsStack.clear();
    if (state.tasks.length === 0) {
      listItemsStack.addChild(emptyListBox);
    } else {
      for (let i = 0; i < state.tasks.length; i += 1) {
        if (i > 0) {
          listItemsStack.addChild(new Divider({ color: t.border }));
        }
        listItemsStack.addChild(
          new TaskRowButton(state.tasks[i]!, t, (id) => openTask(id)),
        );
      }
    }

    const activeTask = currentTask();
    if (state.route === "task" && activeTask) {
      detailHeaderTitle.setColor(t.text);
      detailStatusBadge.setLabel(activeTask.done ? "DONE" : "OPEN");
      detailStatusBadge.setVariant(activeTask.done ? "success" : "neutral");
      detailCard.setBackground(t.surface);
      detailCard.setBorder(t.border, 1);
      detailDivider1.setColor(t.border);
      detailDivider2.setColor(t.border);
      detailTitleText.setText(activeTask.title);
      detailTitleText.setColor(t.text);
      detailNotesLabel.setColor(t.textMuted);
      doneHelperText.setColor(t.textMuted);
      removeHintText.setColor(t.textMuted);
      doneSwitch.setChecked(activeTask.done);
      rootContainer.setChild(detailScreen);
    } else {
      state.route = "tasks";
      rootContainer.setChild(listScreen);
    }

    appRef?.invalidate();
  }

  const menus: MenuSpec[] = [
    {
      title: "Tasks",
      items: [{ kind: "action", label: "Quit Tasks", role: "quit", shortcut: "cmd+q" }],
    },
    {
      title: "Navigation",
      items: [
        {
          kind: "action",
          label: "Back to List",
          shortcut: "cmd+[",
          onSelect: () => goBack(),
        },
        {
          kind: "action",
          label: "Toggle Theme",
          shortcut: "cmd+t",
          onSelect: () => toggleTheme(),
        },
      ],
    },
  ];

  appRef = new GuiApp({
    backend,
    window: {
      title: "Tasks — scriptc-ui",
      width: 640,
      height: 580,
      resizable: true,
    },
    theme: theme(),
    menus,
    root: rootContainer,
  });

  syncUi();

  return {
    app: appRef,
    getState: () => ({
      route: state.route,
      selectedId: state.selectedId,
      draft: state.draft,
      dark: state.dark,
      confirmOpen: state.confirmOpen,
      tasks: state.tasks.map((t) => ({ ...t })),
    }),
    addTask,
    openTask,
    goBack,
    toggleDone,
    removeSelected,
  };
}

function findNodeId(
  backend: HeadlessBackend,
  role: string,
  label: string,
): number {
  const node = backend
    .getAccessibilityTree()
    .find((entry) => entry.role === role && entry.label === label);
  if (!node) {
    throw new Error(`Missing a11y node role=${role} label="${label}"`);
  }
  return node.id;
}

function runHeadlessSmoke(): void {
  const backend = new HeadlessBackend({ width: 640, height: 580 });
  const ctrl = createTasksApp(backend);
  ctrl.app.renderFrame();

  const inputNode = backend
    .getAccessibilityTree()
    .find((entry) => entry.role === "textField");
  if (!inputNode) {
    throw new Error("Missing task input textField node");
  }
  backend.triggerA11ySetValue(inputNode.id, "Ship native GUI");
  ctrl.app.step(0);

  backend.triggerA11yPress(findNodeId(backend, "button", "Add"));
  ctrl.app.step(0);
  const afterAdd = ctrl.getState();

  backend.triggerA11yPress(findNodeId(backend, "button", "Ship native GUI"));
  ctrl.app.step(0);
  const onDetail = ctrl.getState();

  backend.triggerA11yPress(findNodeId(backend, "checkbox", "Done"));
  ctrl.app.step(0);
  const afterDone = ctrl.getState();

  backend.triggerA11yPress(findNodeId(backend, "button", "Remove"));
  ctrl.app.step(0);
  const modalOpen = ctrl.getState();

  const modalRemoveNodes = backend
    .getAccessibilityTree()
    .filter((entry) => entry.role === "button" && entry.label === "Remove");
  const modalRemoveNode = modalRemoveNodes[modalRemoveNodes.length - 1];
  if (!modalRemoveNode) {
    throw new Error("Missing modal confirmation Remove button");
  }
  backend.triggerA11yPress(modalRemoveNode.id);
  ctrl.app.step(0);
  const afterRemove = ctrl.getState();

  const addedTaskPresent = afterAdd.tasks.some(
    (t) => t.title === "Ship native GUI",
  );
  const markedDone = afterDone.tasks.some(
    (t) => t.title === "Ship native GUI" && t.done,
  );
  const removedCleanly = !afterRemove.tasks.some(
    (t) => t.title === "Ship native GUI",
  );

  const ok =
    addedTaskPresent &&
    onDetail.route === "task" &&
    markedDone &&
    modalOpen.confirmOpen &&
    removedCleanly &&
    afterRemove.route === "tasks";

  const summary = {
    app: "tasks",
    mode: "headless-smoke",
    ok,
    addedTaskPresent,
    markedDone,
    removedCleanly,
    remainingTasks: afterRemove.tasks.length,
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
  const ctrl = createTasksApp(backend);
  ctrl.app.renderFrame();
  ctrl.addTask("Ship native GUI");
  const added = ctrl.getState().tasks[0]!;
  ctrl.openTask(added.id);
  ctrl.toggleDone(true);
  ctrl.goBack();
  ctrl.app.renderFrame();
  const metrics = ctrl.app.getWindowMetrics();
  const state = ctrl.getState();
  const ok =
    state.tasks.some((t) => t.title === "Ship native GUI" && t.done) &&
    state.route === "tasks" &&
    metrics.width > 0;
  const summary = {
    app: "tasks",
    mode: "native-smoke",
    ok,
    taskCount: state.tasks.length,
    metrics,
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
  const ctrl = createTasksApp(backend);
  try {
    await ctrl.app.run();
  } finally {
    ctrl.app.dispose();
  }
}

void main();
