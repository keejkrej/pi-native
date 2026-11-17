# Building & Testing

## Toolchain & Prerequisites

- **`scriptc` `0.4.12+`**: Native TypeScript ahead-of-time compiler. [`build.sh`](../build.sh) uses `$SCRIPTC` if set, otherwise `scriptc` on `PATH` (falling back to `$HOME/.local/share/mise/installs/node/24/bin/scriptc`).
- **Node.js `>=22.19.0`**: Runs model catalog hydration (`catalog/generate.ts`), asset scripts (`scripts/package-files.mjs`), and `@pi-ts/gui` unit tests (`node --test`).
- **Bun** (optional): Used automatically by [`build.sh`](../build.sh) when invoking `scripts/build-with-extensions.ts` (falls back to `node --experimental-strip-types`).
- **Native OS toolchains**:
  - **macOS (primary native target)**: Xcode Command Line Tools (`xcode-select --install`) providing `clang`, `ar`, and Apple SDK frameworks (`AppKit`, `CoreFoundation`, `CoreGraphics`, `CoreText`, `Foundation`, `ImageIO`, `JavaScriptCore`, `QuartzCore`).
  - **Linux GUI archive**: `cc`, `pkg-config`, and GTK 4 headers (`libgtk-4-dev`).
  - **Windows GUI archive**: MSVC `cl` and `lib`.

## Model Catalog Hydration

`packages/ai/src/providers/data/` is gitignored and required for `scriptc` to compile `packages/ai/src/providers/*.models.ts` and `all.ts`:

```sh
# Populate packages/ai/src/providers/data/*.json and .manifest.json
npm run hydrate:model-data

# Validate generated model data against models.generated.ts
npm --prefix packages/ai run check:model-data
```

[`build.sh`](../build.sh) runs `ensure_model_data` automatically before compiling if `packages/ai/src/providers/data/.manifest.json` is absent.

## Build Targets

Run targets via [`./build.sh`](../build.sh) or [`Makefile`](../Makefile):

```sh
# Build native CLI + integrated Waku GUI binary -> dist/pi
./build.sh pi

# Build dist/pi with statically embedded extensions
./build.sh pi --with-ext packages/coding-agent/examples/extensions/hello.ts

# Build all 7 standalone @pi-ts/gui example binaries -> dist/examples/*
./build.sh examples

# Build dist/pi and all GUI examples
./build.sh all

# Run static scriptc coverage check on packages/coding-agent/src/cli.ts
./build.sh coverage

# Clean dist/, packages/*/dist/, and .scriptc/
./build.sh clean
```

Optional environment variables:

- `SCRIPTC`: Override path to the `scriptc` compiler binary.
- `SCRIPTC_EMIT_WORKERS`: Number of `scriptc` codegen emit workers (default `1` in `build.sh`).

## Testing & Verification

### 1. Full Native Zero-Node-Islands Suite (`./build.sh test`)

Compiles [`scripts/test-native.ts`](../scripts/test-native.ts) with `--node-islands=off` to `dist/test-native` (building `dist/pi` first if missing) and runs it with `SCRIPTC_LIBNODE=/nonexistent`:

```sh
./build.sh test
```

Covers 34 native parity suites:
- All 17 `vendor/*` pure-TS libraries (`brace-expansion`, `chalk`, `cross-spawn`, `diff`, `get-east-asian-width`, `highlight.js` 67 languages, `hosted-git-info`, `ignore`, `lovely-mermaid`, `marked`, `minimatch`, `partial-json`, `proper-lockfile`, `semver`, `typebox`, `yaml`)
- `@pi-ts/schema`, `@pi-ts/gui` + `modes/gui` Waku 3-pane shell, and `cli:gui-flags`
- Pure-TS provider HTTP/EventStream stacks (`anthropic-http`, `openai-http`, `google-wire-types`, `bedrock-eventstream`, enterprise Bedrock/Vertex auth)
- `@pi-ts/tui` interactive regression
- `@pi-ts/ffi` word segmenter, pasteboard clipboard, image resize/convert, and JSC codemode sandbox
- External `.ts` extension loader (`ts-strip`, bundler, JSC VM loading `packages/coding-agent/examples/extensions/*`)
- Single-binary native smoke test (`gui:pi-single-binary-native-smoke` against `dist/pi`)

### 2. `@pi-ts/gui` Unit & `scriptc` FFI Integration Tests

```sh
npm --prefix packages/gui test
```

### 3. Single-Binary & Example Smoke Checks

```sh
./dist/pi --version
PI_GUI_HEADLESS_SMOKE=1 ./dist/pi --mode gui --no-session
./dist/examples/demo --headless-smoke
./dist/examples/gallery --headless-smoke
```
