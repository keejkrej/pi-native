# Documentation

Start with the guide for your area. Repository rules, layout, and day-to-day commands live in [`AGENTS.md`](../AGENTS.md).

## Engineering Guides

- [Architecture](architecture.md) — workspace package graph, `scriptc --node-islands=off` execution model, `@pi-ts/ffi`, Zig-style `vendor/*` dependencies, and storage/wire parity
- [Desktop GUI](gui.md) — `@pi-ts/gui` Layer-0 toolkit, Waku 3-pane desktop shell (`modes/gui`), standalone examples, and headless/native smoke verification
- [Extensions & Plugins](extensions.md) — JavaScriptCore FFI external `.ts`/`.js` extension host, virtual modules, `--with-ext` AOT compiler, and built-in extensions
- [Building & Testing](building-and-testing.md) — toolchain prerequisites, model catalog hydration, `build.sh` targets, and offline test suites
- [AGENTS.md](../AGENTS.md) — repository invariants, layer boundaries, and contributor rules

## User & CLI Documentation

User documentation shipped with `@pi-ts/coding-agent` lives in [`packages/coding-agent/docs/`](../packages/coding-agent/docs/index.md) (resolved at runtime via `getDocsPath()` in [`packages/coding-agent/src/config.ts`](../packages/coding-agent/src/config.ts)):

- **Getting Started & CLI**
  - [Overview](../packages/coding-agent/docs/index.md) · [Quickstart](../packages/coding-agent/docs/quickstart.md) · [How Pi Works](../packages/coding-agent/docs/how-pi-works.md)
  - [CLI Reference](../packages/coding-agent/docs/cli.md) · [Interactive Usage](../packages/coding-agent/docs/usage.md) · [Slash Commands](../packages/coding-agent/docs/slash-commands.md) · [Keybindings](../packages/coding-agent/docs/keybindings.md)
  - [Settings](../packages/coding-agent/docs/settings.md) · [Configuration](../packages/coding-agent/docs/configuration.md) · [Environment Variables](../packages/coding-agent/docs/environment-variables.md)
  - [Terminal Setup](../packages/coding-agent/docs/terminal-setup.md) · [Shell Aliases](../packages/coding-agent/docs/shell-aliases.md) · [tmux](../packages/coding-agent/docs/tmux.md) · [Windows](../packages/coding-agent/docs/windows.md) · [Termux](../packages/coding-agent/docs/termux.md)
- **Providers & Models**
  - [Models](../packages/coding-agent/docs/models.md) · [Models Configuration](../packages/coding-agent/docs/models-configuration.md) · [Providers](../packages/coding-agent/docs/providers.md) · [Custom Providers](../packages/coding-agent/docs/custom-provider.md) · [Virtual Models](../packages/coding-agent/docs/virtual-models.md) · [Local `llama.cpp` Models](../packages/coding-agent/docs/llama-cpp.md)
- **Sessions, Context & Security**
  - [Sessions](../packages/coding-agent/docs/sessions.md) · [Session Format](../packages/coding-agent/docs/session-format.md) · [Compaction](../packages/coding-agent/docs/compaction.md) · [Message Types](../packages/coding-agent/docs/message-types.md)
  - [Security](../packages/coding-agent/docs/security.md) · [Containerization](../packages/coding-agent/docs/containerization.md)
- **Customization & Extensions**
  - [Extensions](../packages/coding-agent/docs/extensions.md) · [Codemode](../packages/coding-agent/docs/codemode.md) · [MCP](../packages/coding-agent/docs/mcp.md) · [Skills](../packages/coding-agent/docs/skills.md) · [Prompt Templates](../packages/coding-agent/docs/prompt-templates.md) · [Themes](../packages/coding-agent/docs/themes.md) · [Packages](../packages/coding-agent/docs/packages.md)
- **Automation & Integration**
  - [JSON Event Stream](../packages/coding-agent/docs/json.md) · [RPC Protocol](../packages/coding-agent/docs/rpc.md) · [RPC Commands](../packages/coding-agent/docs/rpc-commands.md) · [RPC Extension UI](../packages/coding-agent/docs/rpc-extension-ui.md)
  - [CLI Integration](../packages/coding-agent/docs/cli-integration.md) · [SDK](../packages/coding-agent/docs/sdk.md) · [TUI Components](../packages/coding-agent/docs/tui.md)
