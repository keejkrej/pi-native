# Desktop GUI

`pi-ts` embeds a native 3-pane Waku desktop workspace directly inside `dist/pi` (`--gui` / `--mode gui`), built on the Layer-0 [`@pi-ts/gui`](../packages/gui/) toolkit and wired into [`packages/coding-agent/src/modes/gui/`](../packages/coding-agent/src/modes/gui/).

## Launching

Launch the integrated desktop GUI from `dist/pi`:

```sh
./dist/pi --gui
./dist/pi --mode gui [options]
```

Headless and native window smoke modes are controlled via environment variables on `runGuiMode` ([`packages/coding-agent/src/modes/gui/run-gui.ts`](../packages/coding-agent/src/modes/gui/run-gui.ts)):

```sh
# Deterministic HeadlessBackend frame & menu smoke verification
PI_GUI_HEADLESS_SMOKE=1 ./dist/pi --mode gui --no-session

# Real native macOS window creation smoke check
PI_GUI_NATIVE_SMOKE=1 ./dist/pi --mode gui --no-session
```

A standalone CLI harness also exists at [`packages/coding-agent/src/gui-cli.ts`](../packages/coding-agent/src/gui-cli.ts) supporting `--cwd`, `--provider`, `--model`, `--prompt`, `--headless-smoke`, and `--native-smoke`.

## Two-Layer Architecture

### Layer 0: `@pi-ts/gui` (`packages/gui/`)

Pure TypeScript 2D UI engine paired with a thin native static library driver (`libsgui.a` / `sgui.lib`) with zero WebView, Chromium, or embedded JS engine runtime:

- **Engine (`packages/gui/src/`)**: `GuiApp`, `GuiComponent` tree, flex layout (`VStack`, `HStack`, `Box`, `Spacer`), `Text`, `TruncatedText`, `Button`, `Editor`, `Input`, `Markdown`, `ScrollView`, `SelectList`, `SettingsList`, `VirtualList`, `VectorCanvas`, OKLCH color helpers (`oklab.ts`, `colors.ts`), configurable keybindings, accessibility tree (`GuiA11yNode`), and `HeadlessBackend`.
- **Native drivers (`packages/gui/native/`)**:
  - macOS (`darwin/src/darwin.m`): AppKit, CoreGraphics, CoreText, `NSTextInputClient`, `NSPasteboard`, `NSMenu` (`libsgui.a` built by `packages/gui/native/darwin/build.sh`).
  - Linux (`linux/src/linux.c`): GTK 4, Cairo, Pango (`packages/gui/native/linux/build.sh`).
  - Windows (`win32/src/win32.c`): Win32, Direct2D, DirectWrite, IMM32 (`packages/gui/native/win32/build.mjs`).
- **Isolation invariant**: `@pi-ts/gui` never imports `@pi-ts/coding-agent`, `@pi-ts/agent-core`, or `@pi-ts/ai`.

### Application Shell: `modes/gui` (`packages/coding-agent/src/modes/gui/`)

| Module | Responsibility |
|---|---|
| `run-gui.ts` | `runGuiMode()` entrypoint, theme resolution, smoke loops, lifecycle cleanup |
| `gui-mode.ts` | `mountPiGui()` 3-pane composition, native OS menu bar, keyboard shortcuts, overlay orchestration |
| `controller.ts` | `RealGuiSessionController` (wrapping `AgentSessionRuntime`) and deterministic `MockGuiSessionController` |
| `window-chrome.ts` | Unified titlebar chrome, header bar, navigation history buttons, toast banner |
| `sidebar.ts` | Session list sidebar (grouping, pin, rename, switch, collapsible width) |
| `transcript.ts` | Virtualized conversation viewport |
| `cards.ts` | Welcome, user, assistant Markdown, bash, tool execution, turn-cluster, compaction, and diff cards |
| `composer.ts` | Prompt composer, `@pi-ts/ffi` image/file pasteboard attachments, model/thinking selectors, footer gauge |
| `right-panel.ts` | Collapsible right inspector (`Changes` unified/split diffs, `Files` tree & preview, `Tree`) |
| `overlays.ts` | Command palette, model picker, session picker, settings modal, context popover, git branch/commit modals, extension prompts |
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

Unit tests and `scriptc` FFI compilation tests for `@pi-ts/gui` run via:

```sh
npm --prefix packages/gui test
```
