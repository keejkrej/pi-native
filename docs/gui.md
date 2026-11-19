# Desktop GUI

`pi-ts` embeds a native 3-pane Waku desktop workspace directly inside `dist/pi` (`--gui` / `--mode gui`), built on the Layer-0 [`@pi-ts/gui`](../packages/gui/) toolkit and wired into [`packages/coding-agent/src/modes/gui/`](../packages/coding-agent/src/modes/gui/).

## Launching

Launch the integrated desktop GUI from `dist/pi`:

```sh
./dist/pi --gui
./dist/pi --mode gui [options]
```

Headless, native window smoke, and UI-replication export modes are controlled via environment variables on `runGuiMode` ([`packages/coding-agent/src/modes/gui/run-gui.ts`](../packages/coding-agent/src/modes/gui/run-gui.ts)):

```sh
# Deterministic HeadlessBackend frame & menu smoke verification
PI_GUI_HEADLESS_SMOKE=1 ./dist/pi --mode gui --no-session

# Real native macOS window creation smoke check
PI_GUI_NATIVE_SMOKE=1 ./dist/pi --mode gui --no-session

# Offline Waku UI replication export (35 scenes, tokens, components, states, 2x Retina PNGs)
PI_UI_REPLICATION_DIR=.agents/ui-replication ./dist/pi --mode gui --no-session
```

A standalone CLI harness also exists at [`packages/coding-agent/src/gui-cli.ts`](../packages/coding-agent/src/gui-cli.ts) supporting `--cwd`, `--provider`, `--model`, `--prompt`, `--headless-smoke`, and `--native-smoke`.

## Two-Layer Architecture

### Layer 0: `@pi-ts/gui` (`packages/gui/`)

Pure TypeScript 2D UI engine paired with a thin native static library driver (`libsgui.a` / `sgui.lib`) with zero WebView, Chromium, or embedded JS engine runtime:

- **Engine (`packages/gui/src/`)**: `GuiApp`, `GuiComponent` tree, flex layout (`VStack`, `HStack`, `Box`, `Spacer`), `Text`, `TruncatedText`, `Button`, `Editor`, `Input`, `Markdown`, `ScrollView` (including `overlayScrollbar` mode), `SelectList`, `SettingsList`, `VirtualList`, `VectorCanvas`, OKLCH color helpers (`oklab.ts`, `colors.ts`), configurable keybindings, accessibility tree (`GuiA11yNode`), `HeadlessBackend` (capturing encoded frame draw bytes via `getLastFrameBytes()`), and offscreen Retina PNG export (`renderDrawListToPng()`).
- **Native drivers (`packages/gui/native/`)**:
  - macOS (`darwin/src/darwin.m`): AppKit, CoreGraphics, CoreText, ImageIO (`sgui_render_png` offscreen PNG export), `NSTextInputClient`, `NSPasteboard`, `NSMenu` (`libsgui.a` built by `packages/gui/native/darwin/build.sh`).
  - Linux (`linux/src/linux.c`): GTK 4, Cairo, Pango (`packages/gui/native/linux/build.sh`).
  - Windows (`win32/src/win32.c`): Win32, Direct2D, DirectWrite, IMM32 (`packages/gui/native/win32/build.mjs`).
- **Isolation invariant**: `@pi-ts/gui` never imports `@pi-ts/coding-agent`, `@pi-ts/agent-core`, or `@pi-ts/ai`.

### Application Shell: `modes/gui` (`packages/coding-agent/src/modes/gui/`)

| Module | Responsibility |
|---|---|
| `run-gui.ts` | `runGuiMode()` entrypoint, theme resolution, smoke loops, `PI_UI_REPLICATION_DIR` export, lifecycle cleanup |
| `gui-mode.ts` | `mountPiGui()` 3-pane composition, native OS menu bar, keyboard shortcuts, overlay orchestration |
| `controller.ts` | `RealGuiSessionController` (wrapping `AgentSessionRuntime`) and deterministic `MockGuiSessionController` |
| `window-chrome.ts` | Borderless `48px` titlebar header (`Toggle Sidebar`, `Previous`/`Next Session`, title, `Toggle Right Panel`), top-centered `Toast` |
| `sidebar.ts` | `252px` (`180..420`) session sidebar, `New Task`/`Search` rows, `Sidebar options` popover, `51px` cards, `40px` `Open Settings` footer |
| `transcript.ts` | `720px` centered virtualized viewport, sparkle empty state (`"What should we build in <project>?"`), `⌘F` Find Bar, nav rail |
| `cards.ts` | `540px` right-aligned user bubbles, horizontal `Worked for ...` hairline divider, Markdown/bash/tool/compaction/branch/diff cards |
| `composer.ts` | `720px` rounded composer (`"Do anything…"`), `692px` busy queue tray, model/thinking/attach/send chips, `28px` workspace footer |
| `right-panel.ts` | `460px` (`280..1000`) collapsible right panel (`Changes` unified/split diffs, `Files` tree & preview, `Terminal`, `Tree`) |
| `overlays.ts` | `⌘K` Command Palette, `460x390` Model Picker, Thinking/Sidebar options/Project/Workspace/Branch/Context popovers, Commit dialog, 2-pane `Settings`, extension prompts |
| `ui-spec-meta.ts` | Non-intrusive live layout/style metadata annotations for mechanical UI tree inspection |
| `ui-replication-export.ts` | Offline 35-scene harness exporting measured `ui-layout-spec/1`, `ui-tokens/1`, `ui-components/1`, `ui-states/1`, and Retina PNGs |
| `git-utils.ts` | Git status, branches, unified diff parsing, file scanning, and persisted GUI layout preferences |
| `types.ts` | Shared controller, snapshot, layout preference, and UI event types |

## Standalone Examples & Verification

[`packages/gui/examples/`](../packages/gui/examples/README.md) contains 7 standalone `@pi-ts/gui` apps compiled via `./build.sh examples` to `dist/examples/`:

```sh
./build.sh examples
./dist/examples/demo --headless-smoke
./dist/examples/gallery --headless-smoke
./dist/examples/bench --bench
```

Unit tests, `scriptc` FFI compilation tests, and offscreen PNG tests run via:

```sh
npm --prefix packages/gui test
SCRIPTC_LIBNODE=/nonexistent ./build.sh test
```
