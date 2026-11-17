import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const workspaceSourcePaths = {
	telemetryIndex: fileURLToPath(new URL("./packages/telemetry/src/index.ts", import.meta.url)),
	telemetryTesting: fileURLToPath(new URL("./packages/telemetry/src/testing/index.ts", import.meta.url)),
	schemaIndex: fileURLToPath(new URL("./packages/schema/src/index.ts", import.meta.url)),
	schemaFormats: fileURLToPath(new URL("./packages/schema/src/formats/index.ts", import.meta.url)),
	mcpIndex: fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
	mcpOAuth: fileURLToPath(new URL("./packages/mcp/src/oauth/index.ts", import.meta.url)),
	mcpTesting: fileURLToPath(new URL("./packages/mcp/src/testing/index.ts", import.meta.url)),
	aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
	aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
	aiModels: fileURLToPath(new URL("./packages/ai/src/models.ts", import.meta.url)),
	aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
	aiApi: fileURLToPath(new URL("./packages/ai/src/api", import.meta.url)),
	aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
	aiUtils: fileURLToPath(new URL("./packages/ai/src/utils", import.meta.url)),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	codemodeIndex: fileURLToPath(new URL("./packages/codemode/src/index.ts", import.meta.url)),
	codemodeDeclarations: fileURLToPath(new URL("./packages/codemode/src/declarations.ts", import.meta.url)),
	codemodeSource: fileURLToPath(new URL("./packages/codemode/src/source.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
	tuiIndex: fileURLToPath(new URL("./packages/tui/src/index.ts", import.meta.url)),
	ffiIndex: fileURLToPath(new URL("./packages/ffi/src/index.ts", import.meta.url)),
	guiIndex: fileURLToPath(new URL("./packages/gui/src/index.ts", import.meta.url)),
	guiNative: fileURLToPath(new URL("./packages/gui/src/native.ts", import.meta.url)),
} as const;

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@pi-ts\/telemetry$/, replacement: workspaceSourcePaths.telemetryIndex },
			{ find: /^@pi-ts\/telemetry\/testing$/, replacement: workspaceSourcePaths.telemetryTesting },
			{ find: /^@pi-ts\/schema$/, replacement: workspaceSourcePaths.schemaIndex },
			{ find: /^@pi-ts\/schema\/formats$/, replacement: workspaceSourcePaths.schemaFormats },
			{ find: /^@pi-ts\/mcp$/, replacement: workspaceSourcePaths.mcpIndex },
			{ find: /^@pi-ts\/mcp\/oauth$/, replacement: workspaceSourcePaths.mcpOAuth },
			{ find: /^@pi-ts\/mcp\/testing$/, replacement: workspaceSourcePaths.mcpTesting },
			{ find: /^@pi-ts\/ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@pi-ts\/ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@pi-ts\/ai\/models$/, replacement: workspaceSourcePaths.aiModels },
			{ find: /^@pi-ts\/ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@pi-ts\/ai\/utils\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiUtils}/$1.ts`,
			},
			{
				find: /^@pi-ts\/ai\/api\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiApi}/$1.ts`,
			},
			{
				find: /^@pi-ts\/ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{ find: /^@pi-ts\/agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@pi-ts\/codemode$/, replacement: workspaceSourcePaths.codemodeIndex },
			{ find: /^@pi-ts\/codemode\/declarations$/, replacement: workspaceSourcePaths.codemodeDeclarations },
			{ find: /^@pi-ts\/codemode\/source$/, replacement: workspaceSourcePaths.codemodeSource },
			{ find: /^@pi-ts\/coding-agent$/, replacement: workspaceSourcePaths.codingAgentIndex },
			{ find: /^@pi-ts\/tui$/, replacement: workspaceSourcePaths.tuiIndex },
			{ find: /^@pi-ts\/ffi$/, replacement: workspaceSourcePaths.ffiIndex },
			{ find: /^@pi-ts\/gui$/, replacement: workspaceSourcePaths.guiIndex },
			{ find: /^@pi-ts\/gui\/native$/, replacement: workspaceSourcePaths.guiNative },
		],
	},
});
