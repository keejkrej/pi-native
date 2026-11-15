# `scriptc-ui` Native Desktop Examples

Pure-TypeScript desktop example apps compiled to native Mach-O binaries with `scriptc` and linked against the `scriptc-ui` Darwin AppKit FFI backend (`packages/gui/ffi/darwin.json`).

## Examples

| App | Source | Description |
| --- | --- | --- |
| `demo` | [demo.ts](./demo.ts) | Interactive workspace showcase (centered `760px` transcript, concentric composer with slash autocomplete, theme sync, Settings `Overlay`, `Loader`, `MenuSpec`) |
| `counter` | [counter.ts](./counter.ts) | Centered `440px` counter console with double-bezel `72px` tabular numeral card, danger state when `< 0`, icon controls, status `Badge`, and last-5 pill history |
| `tasks` | [tasks.ts](./tasks.ts) | `560px` two-screen task manager (`Tasks` list ↔ `Task` detail), `VectorCanvas` completion bar, hairline `Divider` rows, notes editor, `Done` switch, modal delete `Overlay` |
| `desktop` | [desktop.ts](./desktop.ts) | Authentic `unifiedTitlebar` macOS app respecting `insetLeft`, `44px` toolbar, `248px` inspector sidebar, `Editor`, `MenuSpec`, `⌘` shortcut popover overlay, bottom telemetry bar |
| `hopper` | [hopper.ts](./hopper.ts) | "Hopper Lab" flight workbench with seeded telemetry, `Flights`/`Plan`/`Vehicle` tabs, `Hop log` push route, interactive Canvas charts, RCS quad view |
| `gallery` | [gallery.ts](./gallery.ts) | 7-section widget & system showcase (`Controls`, `Text & Markdown`, `Editor & Autocomplete`, `VirtualList`, `Overlays & Settings`, `Canvas & Oklch Colors`, `Clipboard & System Metrics`) |
| `bench` | [bench.ts](./bench.ts) | `760px` performance console (`Grid`: 200 OKLCH heatmap cells, `Rows`: 1k virtualized table, `Inputs`: 10k `SelectList` + dual `Input`s + `Editor`) + live KPI tiles & `--bench` JSON |

## Static Coverage & Compiling

Ensure the native library is built first (`packages/gui/native/darwin/build/libsgui.a`):

```sh
mkdir -p dist/examples

# Check static TypeScript coverage for an example
npx scriptc coverage packages/gui/examples/counter.ts --ffi packages/gui/ffi/darwin.json

# Compile an example into a standalone Mach-O binary
npx scriptc build packages/gui/examples/counter.ts --ffi packages/gui/ffi/darwin.json -o dist/examples/counter
```

Or build all seven examples:

```sh
for app in demo counter tasks desktop hopper gallery bench; do
  npx scriptc build "packages/gui/examples/${app}.ts" \
    --ffi packages/gui/ffi/darwin.json \
    -o "dist/examples/${app}"
done
```

## Runtime Flags

Every example binary supports three modes:

- **Interactive native window (default)**: `./dist/examples/<app>` launches the interactive native macOS desktop window and event loop.
- **`--headless-smoke`**: `./dist/examples/<app> --headless-smoke` exercises layout, rendering, accessibility actions, and core state transitions on `HeadlessBackend`, printing JSON `{ ..., "ok": true }` and exiting `0`.
- **`--native-smoke`**: `./dist/examples/<app> --native-smoke` creates a real native Cocoa window, renders frames, inspects `WindowMetrics`, verifies state, disposes cleanly, prints JSON, and exits `0`.
- **`--bench` (`bench` only)**: `./dist/examples/bench --bench` runs deterministic layout and frame update timings across Grid (200 buttons), Rows (1k virtualized), and Inputs (10k searchable items) and prints JSON metrics.
