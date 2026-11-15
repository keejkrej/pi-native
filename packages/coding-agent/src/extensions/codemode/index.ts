/**
 * The `codemode` tool as a built-in extension. The CLI loads it as a built-in extension; SDK users
 * add `createCodemodeExtension()` to their extension factories.
 *
 * `codemode` is registered inactive. Activate it with `--tools`, the `defaultTools` setting,
 * `setActiveTools()`, or let the MCP extension activate it for `codemode`-exposed servers.
 */

import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { createCodemodeTool } from "./tool.ts";

export interface CodemodeExtensionOptions {
	mode?: "on" | "only";
	inlineBudget?: number;
}

export function createCodemodeExtension(options: CodemodeExtensionOptions = {}): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			...createCodemodeTool({
				hasModels: true,
				mode: options.mode,
				inlineBudget: options.inlineBudget,
				getAllTools: () => pi.getAllTools(),
				getSettings: () => pi.getSettings(),
				appendStoreEntry: (customType, data) => {
					pi.appendEntry(customType, data);
				},
			}),
			defaultActive: false,
		});
	};
}

export default createCodemodeExtension();
