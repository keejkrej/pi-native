# @pi-ts/gui

Native cross-platform GUI toolkit written in pure TypeScript for `scriptc` native executables and Node tests, with zero WebView, Chromium, or embedded JS engine runtime.

## Architecture

- **TypeScript UI engine (`src/`)**: Owns the component tree (`GuiComponent`), flex layout (`VStack`, `HStack`, `Box`, `Spacer`), text measurement caching, hit-testing, focus traversal, configurable keybindings (`KeybindingsManager`), IME preedit & caret anchor reporting, clipboard operations, modal/anchored overlays, and binary draw command serialization.
- **Native thin driver (`native/`)**: Static library (`libsgui.a` / `sgui.lib`) using platform native toolkits for 2D vector drawing, font shaping, OS menus, clipboard, and IME:
  - macOS (`native/darwin/src/darwin.m`): AppKit, CoreGraphics, CoreText, `NSTextInputClient`, `NSPasteboard`, `NSMenu`
  - Linux (`native/linux/src/linux.c`): GTK 4, Cairo, Pango, `GtkIMMulticontext`, `GdkClipboard`, `GMenu`
  - Windows (`native/win32/src/win32.c`): Win32, Direct2D, DirectWrite, IMM32, Win32 Clipboard, `HMENU`
- **FFI manifests (`ffi/`)**: `scriptc` `ffi_format: 7` manifests linking static native archives directly with zero `.node` addons.
- **Headless backend (`HeadlessBackend`)**: Deterministic pure-TypeScript backend for fast displayless `node:test` verification.

## Usage

Import core widgets and headless utilities from `@pi-ts/gui`, and native windowing from `@pi-ts/gui/native`:

```ts
import { Button, GuiApp, VStack } from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

const app = new GuiApp({
	backend: createNativeBackend(),
	window: { title: "Hello", width: 800, height: 600 },
});

app.setRoot(
	new VStack({
		padding: 20,
		children: [new Button({ label: "Click me", variant: "primary", onClick: () => app.stop() })],
	}),
);

await app.run();
app.dispose();
```

## Build and Test

```bash
npm --prefix packages/gui run build:native:darwin
npm --prefix packages/gui run build
npm --prefix packages/gui test
```

Compile the demo binary natively with `scriptc`:

```bash
scriptc build packages/gui/examples/demo.ts --ffi packages/gui/ffi/darwin.json -o /tmp/scriptgui-demo
/tmp/scriptgui-demo --headless-smoke
```
