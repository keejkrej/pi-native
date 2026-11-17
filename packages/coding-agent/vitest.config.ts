import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
			env: { PI_OFFLINE: "1" },
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
		resolve: {
			alias: [
				{ find: /^@pi-ts\/ai$/, replacement: workspaceSourcePaths.aiIndex },
				{ find: /^@pi-ts\/schema$/, replacement: fileURLToPath(new URL("../schema/src/index.ts", import.meta.url)) },
				{ find: /^@pi-ts\/schema\/formats$/, replacement: fileURLToPath(new URL("../schema/src/formats/index.ts", import.meta.url)) },
				{ find: /^@pi-ts\/agent-core$/, replacement: workspaceSourcePaths.agentIndex },
				{ find: /^@pi-ts\/ffi$/, replacement: workspaceSourcePaths.ffiIndex },
				{ find: /^@pi-ts\/gui$/, replacement: fileURLToPath(new URL("../gui/src/index.ts", import.meta.url)) },
				{ find: /^@pi-ts\/gui\/native$/, replacement: fileURLToPath(new URL("../gui/src/native.ts", import.meta.url)) },
			],
		},
	}),
);
