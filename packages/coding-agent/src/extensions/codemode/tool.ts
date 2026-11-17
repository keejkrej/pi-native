/**
 * Codemode tool definition, description catalog builder, and loadout presentation hooks.
 */

import type { AgentTool, AgentToolResult } from "@pi-ts/agent-core";
import { Type } from "typebox";
import type {
	ExtensionToolContext,
	ToolDefinition,
	ToolInfo,
	ToolLoadout,
	ToolLoadoutChanges,
	ToolNamespace,
} from "../../core/extensions/types.ts";
import type { Settings } from "../../core/settings-schema.ts";
import {
	CODEMODE_DOCS_PATH,
	CODEMODE_STORE_ENTRY_TYPE,
	type CodemodeCallRecord,
	type CodemodeToolDetails,
	executeCodemode,
	renderToolDeclaration,
	renderToolOutputType,
	summarizeToolOutputType,
} from "./execute.ts";
import { codemodeRenderers } from "./renderer.ts";
import { sanitizeToolIdentifier } from "./sandbox.ts";

export {
	CODEMODE_DOCS_PATH,
	CODEMODE_STORE_ENTRY_TYPE,
	renderToolOutputType,
	type CodemodeCallRecord,
	type CodemodeToolDetails,
};

export const CODEMODE_TOOL_NAME = "codemode";
const CHARS_PER_TOKEN = 4;

export const codemodeParameters = Type.Object({
	code: Type.String({
		description: "Raw JavaScript source code to run as the body of an async function (not wrapped in markdown fences).",
	}),
});

export type CodemodeInputTool = Pick<AgentTool, "name" | "description" | "parameters" | "outputSchema"> & {
	namespace?: ToolNamespace;
	promptGuidelines?: readonly string[];
};

export interface CreateCodemodeDescriptionOptions {
	inlineBudget?: number;
	namespaces?: ReadonlyMap<string, ToolNamespace>;
	deferred?: ReadonlySet<string>;
	guidelines?: ReadonlyMap<string, readonly string[]>;
	models?: boolean;
}

export interface CreateCodemodeToolOptions {
	hasModels?: boolean;
	mode?: "on" | "only";
	inlineBudget?: number;
	getAllTools?: () => readonly ToolInfo[];
	getSettings?: () => Settings;
	appendStoreEntry?: (customType: string, data: { set: Record<string, unknown>; delete: string[] }) => void;
}

interface CatalogToolEntry {
	name: string;
	section: string;
	tokens: number;
}

interface CatalogGroup {
	key: string;
	namespace?: ToolNamespace;
	items: CatalogToolEntry[];
	included: CatalogToolEntry[];
	nextIndex: number;
	stopped: boolean;
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Build the `codemode` tool description, grouping nested tool declarations by namespace within `inlineBudget`.
 */
export function createCodemodeDescription(
	tools: readonly CodemodeInputTool[],
	options: CreateCodemodeDescriptionOptions = {},
): string {
	const deferred = options.deferred;
	const introLines: string[] = [
		"Run a JavaScript script in an isolated sandbox to call tools, process data, and attach text or images to the result.",
		"",
		"Input is raw JavaScript source (an async function body, so top-level `await` and `return` work; do not wrap in markdown code fences). An optional first line `// @options: {\"max_output_tokens\": 2000, \"timeout_ms\": 60000}` configures output limits and script timeout.",
		"",
		"Globals:",
		"- `tools.<name>(args)`: call a tool (invalid JS identifier chars become `_`); resolves to structured output for tools with an output schema, or text.",
		"- `text(value)` / top-level `return value`: emit text (strings as is, other values as JSON).",
		"- `image(value)`: attach a PNG, JPEG, GIF, or WebP image (`data:` URL, `{ image_url }`, or `{ type: \"image\", data, mimeType }`).",
		"- `console.{log,info,warn,error,debug}(...)`: append lines to `<console_output>`.",
		"- `exit()`: end the script successfully, keeping earlier output.",
		"- `store(key, value)` / `load(key)`: persist small JSON values on the session branch (store `undefined` to delete).",
		"- `ALL_TOOLS`: `{ name, description }[]` for every callable tool.",
	];

	if (options.models) {
		introLines.push(
			`- \`models\`: classifiers and image generation (\`models.getAvailableOfType()\`, \`models.classify()\`, \`models.generateImages()\`); see ${CODEMODE_DOCS_PATH} for the full API.`,
		);
	}

	introLines.push(
		"",
		"Use `await searchTools(query, { limit?, namespace? })`, `await describeTool(name)`, `await describeNamespace(name)`, or `ALL_TOOLS` to find unlisted tools, such as MCP tools, inspect full declarations, or read server instructions.",
	);

	const visibleTools = tools.filter((tool) => tool.name !== CODEMODE_TOOL_NAME && !deferred?.has(tool.name));
	if (visibleTools.length === 0) {
		return introLines.join("\n");
	}

	const groupMap = new Map<string, CatalogGroup>();
	for (const tool of visibleTools) {
		const ns = options.namespaces?.get(tool.name) ?? tool.namespace;
		const gl = options.guidelines?.get(tool.name) ?? tool.promptGuidelines;
		const section = renderToolDeclaration({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			outputSchema: tool.outputSchema,
			namespace: ns,
			promptGuidelines: gl,
		});
		const key = ns?.name ?? "";
		let group = groupMap.get(key);
		if (!group) {
			group = {
				key,
				namespace: ns,
				items: [],
				included: [],
				nextIndex: 0,
				stopped: false,
			};
			groupMap.set(key, group);
		} else if (!group.namespace?.description && ns?.description) {
			group.namespace = ns;
		}
		group.items.push({
			name: tool.name,
			section,
			tokens: estimateTokens(section),
		});
	}

	const groups = Array.from(groupMap.values()).sort((a, b) => {
		if (a.key === "" && b.key !== "") return -1;
		if (b.key === "" && a.key !== "") return 1;
		return compareStrings(a.key, b.key);
	});

	for (const group of groups) {
		group.items.sort((a, b) => a.tokens - b.tokens || compareStrings(a.name, b.name));
	}

	const budget = options.inlineBudget;
	if (budget === undefined) {
		for (const group of groups) {
			group.included.push(...group.items);
		}
	} else if (budget > 0) {
		let remaining = budget;
		let progressed = true;
		while (progressed) {
			progressed = false;
			for (const group of groups) {
				if (group.stopped || group.nextIndex >= group.items.length) continue;
				const candidate = group.items[group.nextIndex];
				if (!candidate) continue;
				const headerOverhead =
					group.included.length === 0 && group.key
						? estimateTokens(`## ${group.key}${group.namespace?.description ? `\n${group.namespace.description.trim()}` : ""}`)
						: 0;
				const cost = candidate.tokens + headerOverhead;
				if (cost <= remaining) {
					group.included.push(candidate);
					group.nextIndex += 1;
					remaining -= cost;
					progressed = true;
				} else {
					// Items within a group are sorted cheapest first, so no later item in this group can fit.
					group.stopped = true;
				}
			}
		}
	}

	const bodyParts: string[] = ["", "Nested tools:"];
	for (const group of groups) {
		const omittedCount = group.items.length - group.included.length;
		if (group.key) {
			const suffix =
				group.included.length === 0
					? " (tools not listed)"
					: omittedCount > 0
						? " (some tools not listed)"
						: "";
			const nsDesc = group.namespace?.description?.trim();
			const header = nsDesc ? `## ${group.key}${suffix}\n${nsDesc}` : `## ${group.key}${suffix}`;
			if (group.included.length > 0) {
				bodyParts.push(`${header}\n\n${group.included.map((item) => item.section).join("\n\n")}`);
			} else {
				bodyParts.push(header);
			}
		} else {
			if (group.included.length > 0) {
				bodyParts.push(group.included.map((item) => item.section).join("\n\n"));
			}
			if (omittedCount > 0) {
				bodyParts.push("Some tools are not listed above; find them with `searchTools()`.");
			}
		}
	}

	return `${introLines.join("\n")}\n${bodyParts.join("\n\n")}`;
}

function extractReachableTools(input: Record<string, unknown>): "all" | readonly string[] {
	const code = typeof input.code === "string" ? input.code : "";
	if (!code) return [];
	if (/\b(?:ALL_TOOLS|searchTools)\b/.test(code)) {
		return "all";
	}
	const tokens = new Set<string>();
	const matches = code.match(/[A-Za-z0-9_$-]+/g);
	if (matches) {
		for (const word of matches) {
			tokens.add(word);
			const normalized = word.replace(/-/g, "_");
			tokens.add(normalized);
			if (!normalized.startsWith("mcp__")) {
				tokens.add(`mcp__${normalized}`);
			}
		}
	}
	return Array.from(tokens);
}

function buildLoadoutChanges(
	loadout: ToolLoadout,
	options: CreateCodemodeToolOptions,
): ToolLoadoutChanges {
	const settings = options.getSettings?.().codemode;
	const mode = settings?.mode ?? options.mode ?? "on";
	const inlineBudget = settings?.inlineBudget ?? options.inlineBudget ?? 3000;

	const declaredNames = new Set(loadout.declared.map((tool) => tool.name));
	const callableTools = loadout.callable.filter((tool) => tool.name !== CODEMODE_TOOL_NAME);
	const callableNames = new Set(callableTools.map((tool) => tool.name));

	const namespaces = new Map<string, ToolNamespace>();
	const deferred = new Set<string>();
	const guidelines = new Map<string, readonly string[]>();

	for (const tool of callableTools) {
		if (loadout.getExposure(tool.name) === "deferred") {
			deferred.add(tool.name);
		}
		const ns = loadout.getNamespace(tool.name);
		if (ns) namespaces.set(tool.name, ns);
		const gl = loadout.getPromptGuidelines(tool.name);
		if (gl.length > 0) guidelines.set(tool.name, gl);
	}

	const descriptions: Record<string, string> = {};

	if (mode === "only") {
		const hiddenDeclarations = loadout.declared
			.filter((tool) => tool.name !== CODEMODE_TOOL_NAME && callableNames.has(tool.name))
			.map((tool) => tool.name);
		descriptions[CODEMODE_TOOL_NAME] = createCodemodeDescription(callableTools, {
			inlineBudget,
			namespaces,
			deferred,
			guidelines,
			models: options.hasModels,
		});
		return { descriptions, hiddenDeclarations };
	}

	for (const tool of loadout.declared) {
		if (tool.name === CODEMODE_TOOL_NAME || !callableNames.has(tool.name)) continue;
		const summary = summarizeToolOutputType(tool.outputSchema, tool.name);
		descriptions[tool.name] =
			`${tool.description}\n\nCodemode: \`tools.${sanitizeToolIdentifier(tool.name)}(args)\` resolves to ${summary}.`;
	}

	const unlistedCallable = callableTools.filter((tool) => !declaredNames.has(tool.name));
	descriptions[CODEMODE_TOOL_NAME] = createCodemodeDescription(unlistedCallable, {
		inlineBudget,
		namespaces,
		deferred,
		guidelines,
		models: options.hasModels,
	});

	return { descriptions };
}

/**
 * Create the `codemode` tool definition.
 */
export function createCodemodeTool(
	options: CreateCodemodeToolOptions = {},
): ToolDefinition<typeof codemodeParameters, CodemodeToolDetails> {
	return {
		name: CODEMODE_TOOL_NAME,
		label: CODEMODE_TOOL_NAME,
		description: createCodemodeDescription([], { models: options.hasModels }),
		parameters: codemodeParameters,
		exposure: "model-only",
		defaultActive: false,
		reachesTools: extractReachableTools,
		prepareLoadout: (loadout) => buildLoadoutChanges(loadout, options),
		async execute(
			toolCallId: string,
			params: { code: string },
			signal?: AbortSignal,
			onUpdate?: unknown,
			ctx?: ExtensionToolContext,
		): Promise<AgentToolResult<CodemodeToolDetails>> {
			return await executeCodemode(toolCallId, params, signal, onUpdate, ctx, {
				hasModels: options.hasModels,
				getAllTools: options.getAllTools,
				appendStoreEntry: options.appendStoreEntry,
			});
		},
		...codemodeRenderers,
	};
}
