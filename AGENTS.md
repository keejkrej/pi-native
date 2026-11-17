# AGENTS.md

`pi-ts` (`https://github.com/keejkrej/pi-ts`) is a native AOT-compiled TypeScript implementation of the Pi `v1.5.2` coding agent harness built with `scriptc --node-islands=off`, Zig-style vendored TypeScript dependencies (`vendor/`), Apple JavaScriptCore FFI extension hosting (`@pi-ts/ffi`), and a native 3-pane Waku desktop GUI (`@pi-ts/gui`).

This file states repository layout, invariants, commands, and hygiene rules. Detailed engineering and user guides live under [`docs/README.md`](docs/README.md).

## Layout

```text
package.json                        Root workspace scripts (build, clean, coverage, hydrate:model-data, test)
Makefile                            Convenience wrapper delegating targets to ./build.sh
build.sh                            Primary native build, FFI archive, hydration, coverage, and test driver
tsconfig.base.json                  Shared strict TypeScript compiler options
tsconfig.json                       Root path aliases for @pi-ts/* workspace packages and vendor/* libraries
vitest.base.ts                      Shared Vitest workspace alias configuration
AGENTS.md                           Repository guide (this file)
CLAUDE.md                           Symlink to AGENTS.md
README.md                           Project overview and quick start
LICENSE                             MIT license
docs/
  README.md                         Documentation index (engineering guides + package user docs)
  architecture.md                   Package dependency graph, zero-node-islands model, FFI, and vendored deps
  gui.md                            @pi-ts/gui toolkit, Waku 3-pane desktop shell, examples, and smoke modes
  extensions.md                     JSC FFI extension host, static AOT --with-ext compiler, and built-in extensions
  building-and-testing.md           Prerequisites, model catalog hydration, build targets, and test suites
scripts/
  build-with-extensions.ts          Zig-style static AOT extension compiler (--with-ext)
  package-files.mjs                 Cross-package asset copy, executable bit, and clean helper
  test-native.ts                    Native scriptc --node-islands=off integration test harness (34 cases)
packages/
  ffi/                              @pi-ts/ffi — Darwin native FFI bindings (libpiffi.a, pi_ffi_*, darwin*.json)
  gui/                              @pi-ts/gui — Layer-0 2D native GUI toolkit (libsgui.a, sgui_*, HeadlessBackend, examples)
  telemetry/                        @pi-ts/telemetry — Telemetry contracts, typed schemas, and testing helpers
  schema/                           @pi-ts/schema — Eval-free JSON Schema validator compiled into closures
  mcp/                              @pi-ts/mcp — Model Context Protocol client, OAuth, and transports
  tui/                              @pi-ts/tui — Differential terminal UI library, Markdown/Mermaid, clipboard/word helpers
  ai/                               @pi-ts/ai — Multi-provider LLM streaming API, catalog generator, OAuth, pure-TS HTTP clients
  agent/                            @pi-ts/agent-core — Core agent loop, tool execution, and steering/follow-up queues
  coding-agent/                     @pi-ts/coding-agent — Main CLI (pi), tools, sessions, interactive TUI, Waku GUI, RPC, extensions
    docs/                           Runtime-loaded user documentation (resolved by config.ts getDocsPath)
    examples/                       Runnable extension and SDK examples + examples/tsconfig.json
    schemas/                        JSON Schemas for settings/models/themes
vendor/                             17 Zig-style pure-TS runtime dependencies (zero node_modules required)
  brace-expansion/  chalk/  cross-spawn/  diff/  get-east-asian-width/  highlight-js/
  hosted-git-info/  ignore/  lovely-mermaid/  marked/  marked-cjk-friendly/  minimatch/
  partial-json/  proper-lockfile/  semver/  typebox/  yaml/
```

## Invariants

- **`scriptc --node-islands=off` discipline**:
  - All production code reachable from `packages/coding-agent/src/cli.ts` and `scripts/test-native.ts` must compile cleanly under `scriptc build --node-islands=off` and run with `SCRIPTC_LIBNODE=/nonexistent`.
  - Avoid features unsupported by `scriptc` static compilation: no TypeScript `export default` / default imports (`SC1012`; use named exports everywhere, except static JSON `with { type: "json" }` imports), no `Proxy` / `Reflect`, no Node `vm` module, and keep class hierarchies static.
- **Zero `node_modules` / Zig-style vendoring**:
  - Runtime dependencies live as pure TypeScript under [`vendor/`](vendor/) and resolve via [`tsconfig.json`](tsconfig.json) `paths`. Never commit `node_modules/` or introduce unvendored third-party runtime npm dependencies.
- **`@pi-ts/*` scope & layer boundaries**:
  - Use `@pi-ts/*` exclusively for workspace imports (`@pi-ts/ai`, `@pi-ts/tui`, `@pi-ts/coding-agent`, `@pi-ts/agent-core`, `@pi-ts/mcp`, `@pi-ts/schema`, `@pi-ts/telemetry`, `@pi-ts/ffi`, `@pi-ts/gui`). Do not reintroduce `@earendil-works/*` or `@mariozechner/*` aliases in workspace configs or the extension host.
  - **`packages/gui/` isolation**: `@pi-ts/gui` is a Layer-0 UI toolkit and must never import `@pi-ts/coding-agent`, `@pi-ts/agent-core`, or `@pi-ts/ai`. Agent-aware desktop UI lives in [`packages/coding-agent/src/modes/gui/`](packages/coding-agent/src/modes/gui/).
- **Native FFI static archives**:
  - `packages/gui/native/darwin/build/libsgui.a` (`sgui_*`) and `packages/ffi/native/darwin/build/libpiffi.a` (`pi_ffi_*`) link statically via `ffi_format: 7` manifests ([`packages/gui/ffi/darwin.json`](packages/gui/ffi/darwin.json), [`packages/ffi/ffi/darwin.json`](packages/ffi/ffi/darwin.json), [`packages/ffi/ffi/darwin-gui.json`](packages/ffi/ffi/darwin-gui.json)) with zero `.node` addons.
  - Keep C symbols, JSON FFI manifests, and TypeScript `declare function` bindings synchronized across `packages/ffi/` and `packages/gui/`. Rebuild `libpiffi.a` via `./packages/ffi/native/darwin/build.sh` and `libsgui.a` via `./packages/gui/native/darwin/build.sh` whenever native `.m`/`.h`/build scripts change.
- **Runtime package assets & hydrated model data**:
  - Preserve `packages/coding-agent/{docs,examples,schemas,README.md,CHANGELOG.md,package.json}` — [`packages/coding-agent/src/config.ts`](packages/coding-agent/src/config.ts) resolves them at runtime.
  - `packages/ai/src/providers/data/` is gitignored and required for compiling `packages/ai/src/providers/*.models.ts` and `all.ts`. Hydrate via `npm run hydrate:model-data` (run automatically by `./build.sh` when `.manifest.json` is missing).
- **On-disk & wire parity**: Keep `~/.pi/agent` directory layout (`settings.json`, `auth.json`, `models.json`, session `.jsonl`, lockfiles), RPC JSONL frames, and CLI output compatible with Pi `v1.5.2`.
- **No machine-local paths**: Never hardcode developer home directories (`/Users/`, `/Volumes/`, `C:/Users/`) in source, build scripts, or tests.

## Commands

```sh
# Build native dist/pi binary (CLI + TUI + integrated Waku GUI)
./build.sh pi

# Build dist/pi with statically compiled AOT extensions
./build.sh pi --with-ext <path/to/ext.ts>

# Build standalone @pi-ts/gui examples (dist/examples/*)
./build.sh examples

# Build dist/pi and all GUI examples
./build.sh all

# Compile and run all 34 native zero-node-islands parity tests (builds dist/pi if absent)
./build.sh test

# Run @pi-ts/gui unit and scriptc FFI integration tests (Node test runner)
npm --prefix packages/gui test

# Run static scriptc coverage analysis on cli.ts
./build.sh coverage

# Hydrate and validate packages/ai/src/providers/data/
npm run hydrate:model-data
npm --prefix packages/ai run check:model-data

# Smoke test built CLI + GUI binary headlessly
./dist/pi --version
PI_GUI_HEADLESS_SMOKE=1 ./dist/pi --mode gui --no-session

# Remove build outputs (dist, packages/*/dist, .scriptc)
./build.sh clean
```

## Rules

- Keep prose concise and technical; do not use emojis in commits, PRs, docs, or code.
- Tests must remain offline and deterministic (no live LLM API calls or paid tokens).
- Stage explicit paths (`git add <path>...`); never run `git add -A`, `git add .`, `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or `git commit --no-verify`.
- Do not commit, force-push, or open/merge PRs unless requested by the user.
