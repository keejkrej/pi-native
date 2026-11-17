# pi-ts

A native ahead-of-time compiled TypeScript implementation of the Pi `v1.5.2` coding agent harness, compiling to a single standalone executable (`dist/pi`) via `scriptc --node-islands=off` with zero Node.js runtime islands, Zig-style vendored dependencies (`vendor/`), Apple JavaScriptCore FFI extension hosting (`@pi-ts/ffi`), and an integrated native 3-pane Waku desktop GUI (`@pi-ts/gui`).

Repository: [`https://github.com/keejkrej/pi-ts`](https://github.com/keejkrej/pi-ts)

## Overview

- **Multi-mode single binary**: Interactive TUI (default), native 3-pane desktop GUI (`--gui` / `--mode gui`), non-interactive print and JSON event stream modes (`-p`, `--mode json`), and JSONL RPC over stdin/stdout (`--mode rpc`).
- **Zero Node islands (`--node-islands=off`)**: Pure TypeScript runtime and vendored libraries under [`vendor/`](vendor/) plus pure-TS HTTP/SSE/EventStream provider clients in [`packages/ai/`](packages/ai/), verified with `SCRIPTC_LIBNODE=/nonexistent`.
- **Drop-in Pi `v1.5.2` compatibility**: Preserves `~/.pi/agent` layout (`settings.json`, `auth.json`, `models.json`, `.jsonl` session trees, trust store, lockfiles, and MCP configuration) and CLI/RPC contracts.
- **Native Darwin FFI & GUI**: Static Cocoa/AppKit/CoreText/ImageIO/JavaScriptCore archives (`libsgui.a` and `libpiffi.a`) linked directly via `scriptc` `ffi_format: 7` manifests with zero `.node` addons.
- **Three extension surfaces**: Dynamic `.ts`/`.js` extensions executed in isolated JavaScriptCore VMs via `@pi-ts/ffi`, static AOT extensions compiled directly into `dist/pi` (`--with-ext`), and built-in extensions (`llama.cpp`, `tool-search`, `mcp`, `codemode`).

## Quick Start

### Prerequisites

- **`scriptc` `0.4.12+`** on `PATH` (or via `SCRIPTC=/path/to/scriptc`)
- **Node.js `>=22.19.0`** (used to hydrate gitignored model catalog JSON under `packages/ai/src/providers/data/` and run `packages/gui` unit tests)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`) for `clang` / `ar` and AppKit/ImageIO/JavaScriptCore SDK frameworks

### Build and Run

```sh
# Build the standalone native binary (auto-hydrates model data and builds libsgui.a + libpiffi.a)
./build.sh pi

# Check version
./dist/pi --version

# Interactive TUI in the current directory
./dist/pi

# Launch the native 3-pane desktop GUI
./dist/pi --gui

# Headless GUI smoke verification (no display required)
PI_GUI_HEADLESS_SMOKE=1 ./dist/pi --mode gui --no-session

# Non-interactive print, JSON event stream, and RPC modes
./dist/pi -p "Summarize the repository structure"
./dist/pi --mode json "List packages"
./dist/pi --mode rpc

# Statically AOT-compile external extensions into a custom binary
./build.sh pi --with-ext packages/coding-agent/examples/extensions/hello.ts -o dist/pi-custom
```

## Build Targets

Both [`./build.sh`](build.sh) and [`Makefile`](Makefile) expose the same build and verification targets:

| Target | Command | Output / Action |
|---|---|---|
| Native CLI + GUI binary | `./build.sh pi` / `make pi` | Compiles `packages/coding-agent/src/cli.ts` to `dist/pi` (with `darwin-gui.json` on macOS) |
| AOT binary with extensions | `./build.sh pi --with-ext <path>` | Invokes [`scripts/build-with-extensions.ts`](scripts/build-with-extensions.ts) to embed extensions statically |
| GUI examples | `./build.sh examples` / `make examples` | Compiles all 7 `@pi-ts/gui` examples to `dist/examples/*` |
| All binaries | `./build.sh all` / `make all` | Builds `dist/pi` and `dist/examples/*` |
| Native test suite | `./build.sh test` / `make test` | Builds `dist/pi` if absent, compiles [`scripts/test-native.ts`](scripts/test-native.ts) to `dist/test-native`, runs with `SCRIPTC_LIBNODE=/nonexistent` |
| Static coverage check | `./build.sh coverage` / `make coverage` | Runs `scriptc coverage --node-islands=off --coverage=reached` on `cli.ts` |
| Hydrate model catalog | `npm run hydrate:model-data` | Generates `packages/ai/src/providers/data/*.json` and `.manifest.json` |
| Clean artifacts | `./build.sh clean` / `make clean` | Removes `dist`, `packages/*/dist`, and `.scriptc` |

## Workspace Packages

All workspace packages use the `@pi-ts/*` scope mapped in [`tsconfig.json`](tsconfig.json) without requiring a root `node_modules` install:

| Package | Path | Responsibility |
|---|---|---|
| `@pi-ts/coding-agent` | [`packages/coding-agent`](packages/coding-agent/) | Main CLI (`pi`), session runtime, built-in tools, interactive TUI, Waku GUI (`modes/gui`), RPC, and extension host |
| `@pi-ts/agent-core` | [`packages/agent`](packages/agent/) | Core agent loop, tool execution lifecycle, steering/follow-up queues, and proxy transport |
| `@pi-ts/ai` | [`packages/ai`](packages/ai/) | Multi-provider LLM streaming API, model catalog, OAuth/enterprise credentials, pure-TS HTTP/SSE/Bedrock clients |
| `@pi-ts/tui` | [`packages/tui`](packages/tui/) | Differential terminal UI, layout components, Markdown/Mermaid rendering, and image/clipboard helpers |
| `@pi-ts/gui` | [`packages/gui`](packages/gui/) | Layer-0 cross-platform 2D native desktop toolkit (`HeadlessBackend` + Cocoa/GTK4/Win32 drivers) |
| `@pi-ts/ffi` | [`packages/ffi`](packages/ffi/) | Native Darwin FFI bindings (`libpiffi.a`: clipboard, modifiers, ImageIO, word segmentation, JavaScriptCore) |
| `@pi-ts/mcp` | [`packages/mcp`](packages/mcp/) | Model Context Protocol client, OAuth management, and stdio/HTTP/pipe/in-memory transports |
| `@pi-ts/schema` | [`packages/schema`](packages/schema/) | Eval-free JSON Schema (drafts 2020-12 and 7) validator compiled into closures |
| `@pi-ts/telemetry` | [`packages/telemetry`](packages/telemetry/) | Vendor-neutral telemetry contracts and testing helpers |

Runtime third-party dependencies are vendored as pure TypeScript under [`vendor/`](vendor/) (`brace-expansion`, `chalk`, `cross-spawn`, `diff`, `get-east-asian-width`, `highlight-js`, `hosted-git-info`, `ignore`, `lovely-mermaid`, `marked`, `marked-cjk-friendly`, `minimatch`, `partial-json`, `proper-lockfile`, `semver`, `typebox`, `yaml`).

## Documentation

- [Documentation Index](docs/README.md) — entry point for engineering and user guides
- [Architecture](docs/architecture.md) — package layering, `--node-islands=off` runtime model, `@pi-ts/ffi`, and vendored libraries
- [Desktop GUI](docs/gui.md) — `@pi-ts/gui` Layer-0 toolkit, Waku 3-pane shell, examples, and smoke tests
- [Extensions & Plugins](docs/extensions.md) — JSC FFI extension host, `--with-ext` AOT compiler, virtual modules, and built-in extensions
- [Building & Testing](docs/building-and-testing.md) — prerequisites, model data hydration, `build.sh` targets, and test verification
- [Agent & Contributor Rules](AGENTS.md) — repository layout, invariants, commands, and hygiene rules
- [Pi User & CLI Reference](packages/coding-agent/docs/index.md) — user documentation shipped with `@pi-ts/coding-agent`

## Development

```sh
# Hydrate and validate model catalog data
npm run hydrate:model-data
npm --prefix packages/ai run check:model-data

# Run @pi-ts/gui unit and scriptc FFI integration tests
npm --prefix packages/gui test

# Compile and run all 34 native zero-node-islands parity tests
./build.sh test
```

## License

MIT — see [LICENSE](LICENSE).
