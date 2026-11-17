# Extensions & Plugins

`pi-ts` supports three extension surfaces without requiring a Node.js runtime:

1. **Dynamic external `.ts`/`.js` extensions** loaded in isolated Apple JavaScriptCore VMs via `@pi-ts/ffi`
2. **Statically compiled AOT extensions** bundled directly into a custom `dist/pi` binary via `--with-ext`
3. **Built-in extensions** shipped in `@pi-ts/coding-agent`

## External Extension Host (JSC FFI + Pure-TS Bundler)

Implemented under [`packages/coding-agent/src/core/extensions/`](../packages/coding-agent/src/core/extensions/):

- **`ts-strip.ts`**: Pure-TypeScript lexical/syntactic type stripper (`stripTypeScriptTypes`), ESM-to-CommonJS transformer (`transformEsmToCjs`), and local dependency graph bundler (`bundleExtensionEntry`). Designed for `scriptc --node-islands=off` with zero third-party parsers, zero Node `vm`, and zero `Proxy`/`Reflect`.
- **`jsc-loader.ts`**: Instantiates isolated JavaScriptCore VMs via `@pi-ts/ffi` (`nativeJscCreate`, `nativeJscEval`, `nativeJscDestroy`), drives the async host-call pump loop, and bridges `ExtensionAPI` and `ExtensionContext` back to the native host.
- **`loader.ts`**: Discovers extensions from `~/.pi/agent/extensions`, `<cwd>/.pi/extensions`, installed Pi packages, and `--extension` / `-e` flags, falling back to a clear diagnostic warning on platforms where Darwin JSC FFI is unavailable.

### Virtual Host Modules

`HOST_VIRTUAL_PACKAGES` in [`ts-strip.ts`](../packages/coding-agent/src/core/extensions/ts-strip.ts) and the module loader in [`jsc-loader.ts`](../packages/coding-agent/src/core/extensions/jsc-loader.ts) expose `@pi-ts/*` host modules (with no legacy `@earendil-works/*` or `@mariozechner/*` aliases):

- `@pi-ts/coding-agent`
- `@pi-ts/agent-core`
- `@pi-ts/tui`
- `@pi-ts/ai` (and subpaths `/compat`, `/models`, `/oauth`, `/providers/all`)
- `typebox` and `@sinclair/typebox` (`Type`, `TypeCompiler`, etc.)
- Node built-in shims: `node:path`, `node:os`, `node:fs`, `node:fs/promises`, `node:url`, `node:crypto`, `node:events`, `node:buffer`, `node:process`, `node:util`, `node:assert`, `node:assert/strict`, `node:stream`, `node:tty`, `node:string_decoder`, `node:querystring`, `node:zlib`, `node:child_process` (and bare names without `node:`)

Note: Extensions authored for `@pi-ts/*` should declare any host-provided packages under `peerDependencies` with `"*"` rather than `dependencies` (enforced by [`packages/coding-agent/src/core/resource-loader.ts`](../packages/coding-agent/src/core/resource-loader.ts)).

## Static AOT Extension Compiler (`--with-ext`)

[`scripts/build-with-extensions.ts`](../scripts/build-with-extensions.ts) generates a temporary entrypoint that statically imports chosen extension files/packages and passes them via `MainOptions.extensionFactories` to `scriptc build --node-islands=off`:

```sh
# Compile a custom binary with embedded extensions
./build.sh pi --with-ext packages/coding-agent/examples/extensions/hello.ts -o dist/pi-hello

# Multiple extensions or package directories
bun scripts/build-with-extensions.ts \
  --ext packages/coding-agent/examples/extensions/hello.ts \
  --ext packages/coding-agent/examples/extensions/plan-mode \
  -o dist/pi-custom
```

## Built-in Extensions

[`packages/coding-agent/src/extensions/index.ts`](../packages/coding-agent/src/extensions/index.ts) registers four built-in inline extensions:

| Name | Path | Purpose |
|---|---|---|
| `llama.cpp` | [`packages/coding-agent/src/extensions/llama`](../packages/coding-agent/src/extensions/llama/) | Local `llama.cpp` server lifecycle and provider integration |
| `tool-search` | [`packages/coding-agent/src/extensions/tool-search`](../packages/coding-agent/src/extensions/tool-search/) | Replaceable keyword/semantic tool discovery |
| `mcp` | [`packages/coding-agent/src/extensions/mcp`](../packages/coding-agent/src/extensions/mcp/) | Replaceable Model Context Protocol server integration via `@pi-ts/mcp` |
| `codemode` | [`packages/coding-agent/src/extensions/codemode`](../packages/coding-agent/src/extensions/codemode/) | Replaceable JavaScriptCore-backed sandboxed code-execution tool |
