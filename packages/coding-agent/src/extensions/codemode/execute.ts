/**
 * Codemode script option parsing, host tool/model RPC dispatch, store management, and result formatting.
 */

import { join } from "node:path";
import type { AgentTool, AgentToolResult } from "@pi-ts/agent-core";
import type { TSchema } from "typebox";
import type {
	AnyModel,
	ClassifierContext,
	ClassifierModel,
	ClassifierQuestion,
	ClassifierResult,
	ImageContent,
	ImageModel,
	ImagesContext,
	ModelType,
	TextContent,
	Usage,
} from "@pi-ts/ai";
import { getDocsPath } from "../../config.ts";
import type { ExtensionToolContext, ToolInfo, ToolNamespace } from "../../core/extensions/types.ts";
import type { SessionEntry } from "../../core/session-manager.ts";
import { sliceHead, sliceTail } from "../../core/tools/truncate.ts";
import { combineUsage } from "../../core/usage-totals.ts";
import { writeOutputFile } from "../../utils/output-files.ts";
import { Bm25Ranker, createToolSearchDocument, DEFAULT_TOOL_SEARCH_LIMIT } from "../tool-search/tool.ts";
import {
	runCodemodeSandbox,
	type SandboxOutputItem,
	type SandboxStoreDelta,
	type SandboxToolDescriptor,
	sanitizeToolIdentifier,
} from "./sandbox.ts";

export const CODEMODE_DOCS_PATH = join(getDocsPath(), "codemode.md");
export const CODEMODE_STORE_ENTRY_TYPE = "codemode-store";

const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const CHARS_PER_TOKEN = 4;
const MAX_MODEL_CONCURRENCY = 4;
const MAX_SUMMARY_LENGTH = 120;
const ALLOWED_MODEL_TYPES: ReadonlySet<string> = new Set(["chat", "image", "classifier"]);
const ALLOWED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);

export interface CodemodeCallRecord {
	id: string;
	name: string;
	args: string;
	status: "ok" | "error";
	durationMs: number;
	cost?: number;
	error?: string;
}

export interface CodemodeToolDetails {
	calls: CodemodeCallRecord[];
	fullOutputPath?: string;
}

export interface CodemodeToolMetadata {
	name: string;
	description: string;
	parameters: unknown;
	outputSchema?: unknown;
	namespace?: ToolNamespace;
	promptGuidelines?: readonly string[];
}

export interface ExecuteCodemodeOptions {
	hasModels?: boolean;
	getAllTools?: () => readonly ToolInfo[];
	appendStoreEntry?: (customType: string, data: { set: Record<string, unknown>; delete: string[] }) => void;
}

interface ParsedOptions {
	maxOutputTokens: number;
	timeoutMs?: number;
}

type ParseOptionsResult = { ok: true; value: ParsedOptions } | { ok: false; error: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the optional `// @options: {...}` line, which must appear on line 1 and be followed by JS source.
 */
export function parseCodemodeOptions(code: string): ParseOptionsResult {
	const lines = code.split(/\r?\n/);
	for (let i = 1; i < lines.length; i++) {
		if (/^\s*\/\/\s*@options\b/.test(lines[i] ?? "")) {
			return {
				ok: false,
				error: `The // @options: line must be the first line of the input; found one on line ${i + 1}`,
			};
		}
	}

	const firstLine = lines[0] ?? "";
	const optionsPrefix = /^\s*\/\/\s*@options(?:\b|$)(.*)$/.exec(firstLine);
	if (!optionsPrefix) {
		return { ok: true, value: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } };
	}

	const afterKeyword = optionsPrefix[1] ?? "";
	const colonMatch = /^\s*:\s*(.*)$/.exec(afterKeyword);
	if (!colonMatch) {
		return { ok: false, error: "Invalid // @options: line; expected JSON object after `:`" };
	}

	if (lines.slice(1).join("\n").trim().length === 0) {
		return { ok: false, error: "The @options line must be followed by JavaScript source" };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(colonMatch[1] ?? "");
	} catch (err) {
		return {
			ok: false,
			error: `Invalid @options JSON: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	if (!isPlainRecord(parsed)) {
		return { ok: false, error: "@options must be a JSON object" };
	}

	let maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
	let timeoutMs: number | undefined;

	for (const [key, value] of Object.entries(parsed)) {
		if (key === "max_output_tokens") {
			if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
				return { ok: false, error: "@options.max_output_tokens must be a positive integer" };
			}
			maxOutputTokens = value;
		} else if (key === "timeout_ms") {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
				return { ok: false, error: "@options.timeout_ms must be a positive number" };
			}
			timeoutMs = value;
		} else {
			return {
				ok: false,
				error: `@options only supports \`max_output_tokens\` and \`timeout_ms\`; got \`${key}\``,
			};
		}
	}

	return { ok: true, value: { maxOutputTokens, timeoutMs } };
}

/**
 * Fold `codemode-store` custom entries from root to leaf on a session branch, ignoring malformed entries.
 */
export function readCodemodeStore(entries: readonly SessionEntry[]): Record<string, unknown> {
	const store: Record<string, unknown> = {};
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CODEMODE_STORE_ENTRY_TYPE) continue;
		const data = entry.data;
		if (!isPlainRecord(data)) continue;
		if (!isPlainRecord(data.set) || !Array.isArray(data.delete)) continue;
		if (!data.delete.every((key) => typeof key === "string")) continue;

		for (const [key, value] of Object.entries(data.set)) {
			const encoded = JSON.stringify(value);
			if (encoded !== undefined) {
				store[key] = JSON.parse(encoded);
			}
		}
		for (const key of data.delete) {
			delete store[key];
		}
	}
	return store;
}

/** Format a tool description with any prompt guidelines appended cleanly. */
export function formatToolDescriptionWithGuidelines(
	description: string,
	guidelines?: readonly string[],
): string {
	const trimmed = description.trim();
	if (!guidelines || guidelines.length === 0) return trimmed;
	const bullets = guidelines.map((g) => `- ${g}`).join("\n");
	return trimmed ? `${trimmed}\n\nGuidelines:\n${bullets}` : `Guidelines:\n${bullets}`;
}

function decodePointerSegment(segment: string): string | undefined {
	try {
		return decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~");
	} catch {
		return undefined;
	}
}

function resolveLocalRef(ref: string, root: unknown): unknown {
	if (ref === "#") return root;
	if (!ref.startsWith("#/")) return undefined;
	const segments = ref.slice(2).split("/");
	let cursor: unknown = root;
	for (const rawSeg of segments) {
		const key = decodePointerSegment(rawSeg);
		if (key === undefined) return undefined;
		if (Array.isArray(cursor)) {
			const idx = Number(key);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) return undefined;
			cursor = cursor[idx];
		} else if (typeof cursor === "object" && cursor !== null) {
			const record = cursor as Record<string, unknown>;
			if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
			cursor = record[key];
		} else {
			return undefined;
		}
	}
	return cursor;
}

function formatPropertyKey(key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderSchemaNodeType(node: unknown, root: unknown, activeRefs: Set<string>): string {
	if (typeof node !== "object" || node === null) return "unknown";
	const obj = node as Record<string, unknown>;

	if (typeof obj.$ref === "string") {
		const ref = obj.$ref;
		if (!ref.startsWith("#") || activeRefs.has(ref)) return "unknown";
		const target = resolveLocalRef(ref, root);
		if (target === undefined) return "unknown";
		const nextRefs = new Set(activeRefs);
		nextRefs.add(ref);
		return renderSchemaNodeType(target, root, nextRefs);
	}

	if (Object.prototype.hasOwnProperty.call(obj, "const")) {
		return JSON.stringify(obj.const) ?? "unknown";
	}

	if (Array.isArray(obj.enum) && obj.enum.length > 0) {
		return obj.enum.map((item) => JSON.stringify(item) ?? "unknown").join(" | ");
	}

	if (Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
		return obj.anyOf.map((branch) => renderSchemaNodeType(branch, root, activeRefs)).join(" | ");
	}

	if (Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
		return obj.oneOf.map((branch) => renderSchemaNodeType(branch, root, activeRefs)).join(" | ");
	}

	if (Array.isArray(obj.allOf) && obj.allOf.length > 0) {
		return obj.allOf.map((part) => renderSchemaNodeType(part, root, activeRefs)).join(" & ");
	}

	if (Array.isArray(obj.type)) {
		return obj.type
			.map((t) => renderSchemaNodeType({ ...obj, type: t }, root, activeRefs))
			.join(" | ");
	}

	const schemaType = obj.type;
	if (schemaType === "string") return "string";
	if (schemaType === "number" || schemaType === "integer") return "number";
	if (schemaType === "boolean") return "boolean";
	if (schemaType === "null") return "null";

	if (schemaType === "array") {
		if (Array.isArray(obj.items)) {
			return `[${obj.items.map((item) => renderSchemaNodeType(item, root, activeRefs)).join(", ")}]`;
		}
		const itemType = obj.items ? renderSchemaNodeType(obj.items, root, activeRefs) : "unknown";
		return `Array<${itemType}>`;
	}

	if (schemaType === "object" || isPlainRecord(obj.properties)) {
		const props = isPlainRecord(obj.properties) ? obj.properties : undefined;
		const required = new Set(
			Array.isArray(obj.required) ? obj.required.filter((r): r is string => typeof r === "string") : [],
		);
		const parts: string[] = [];
		if (props) {
			const keys = Object.keys(props).sort();
			for (const key of keys) {
				const opt = required.has(key) ? "" : "?";
				const valType = renderSchemaNodeType(props[key], root, activeRefs);
				parts.push(`${formatPropertyKey(key)}${opt}: ${valType};`);
			}
		}
		if (obj.additionalProperties === true) {
			parts.push("[key: string]: unknown;");
		} else if (isPlainRecord(obj.additionalProperties)) {
			const valType = renderSchemaNodeType(obj.additionalProperties, root, activeRefs);
			parts.push(`[key: string]: ${valType};`);
		}
		if (parts.length === 0) {
			if (obj.additionalProperties === false || props !== undefined) return "{}";
			return "{ [key: string]: unknown; }";
		}
		return `{ ${parts.join(" ")} }`;
	}

	return "unknown";
}

/**
 * Render a JSON Schema (such as `tool.outputSchema`) into a compact TypeScript type string, resolving local `$ref`s.
 */
export function renderToolOutputType(schema: unknown): string {
	if (schema === undefined || schema === null) return "string";
	return renderSchemaNodeType(schema, schema, new Set<string>());
}

function unwrapLocalRef(node: unknown, root: unknown, seen: Set<string>): unknown {
	let current = node;
	while (isPlainRecord(current) && typeof current.$ref === "string") {
		const ref = current.$ref;
		if (!ref.startsWith("#") || seen.has(ref)) return undefined;
		seen.add(ref);
		current = resolveLocalRef(ref, root);
	}
	return current;
}

function summarizeObjectFields(
	obj: Record<string, unknown>,
	root: unknown,
	inUnion: boolean,
	depth: number,
	seen: Set<string>,
): string | undefined {
	const props = isPlainRecord(obj.properties) ? obj.properties : undefined;
	if (!props) return undefined;
	const keys = Object.keys(props);
	if (keys.length === 0) return "{}";
	if (keys.length > 8) return undefined;

	const required = new Set(
		Array.isArray(obj.required) ? obj.required.filter((r): r is string => typeof r === "string") : [],
	);
	const parts: string[] = [];
	for (const key of keys) {
		const opt = required.has(key) ? "" : "?";
		const resolved = unwrapLocalRef(props[key], root, new Set(seen));
		if (isPlainRecord(resolved)) {
			if (Object.prototype.hasOwnProperty.call(resolved, "const")) {
				parts.push(`${formatPropertyKey(key)}${opt}: ${JSON.stringify(resolved.const)}`);
				continue;
			}
			if (Array.isArray(resolved.enum) && resolved.enum.length === 1) {
				parts.push(`${formatPropertyKey(key)}${opt}: ${JSON.stringify(resolved.enum[0])}`);
				continue;
			}
			if (
				!inUnion &&
				depth === 0 &&
				(resolved.type === "object" || isPlainRecord(resolved.properties))
			) {
				const nested = summarizeObjectFields(resolved, root, false, depth + 1, new Set(seen));
				if (nested) {
					parts.push(`${formatPropertyKey(key)}${opt}: ${nested}`);
					continue;
				}
			}
		}
		parts.push(`${formatPropertyKey(key)}${opt}`);
	}
	return `{ ${parts.join(", ")} }`;
}

function summarizeNode(
	node: unknown,
	root: unknown,
	inUnion: boolean,
	depth: number,
	seen: Set<string>,
): string | undefined {
	const resolved = unwrapLocalRef(node, root, new Set(seen));
	if (!isPlainRecord(resolved)) return undefined;

	if (Object.prototype.hasOwnProperty.call(resolved, "const")) {
		return JSON.stringify(resolved.const);
	}
	if (Array.isArray(resolved.enum) && resolved.enum.length > 0 && resolved.enum.length <= 4) {
		return resolved.enum.map((v) => JSON.stringify(v)).join(" | ");
	}

	const unionBranches = Array.isArray(resolved.anyOf)
		? resolved.anyOf
		: Array.isArray(resolved.oneOf)
			? resolved.oneOf
			: undefined;
	if (unionBranches && unionBranches.length > 0) {
		if (unionBranches.length > 4) return undefined;
		const parts: string[] = [];
		for (const branch of unionBranches) {
			const summary = summarizeNode(branch, root, true, depth, seen);
			if (!summary) return undefined;
			parts.push(summary);
		}
		return parts.join(" | ");
	}

	if (Array.isArray(resolved.type)) {
		if (resolved.type.length > 4) return undefined;
		const parts: string[] = [];
		for (const t of resolved.type) {
			const summary = summarizeNode({ ...resolved, type: t }, root, true, depth, seen);
			if (!summary) return undefined;
			parts.push(summary);
		}
		return parts.join(" | ");
	}

	const schemaType = resolved.type;
	if (schemaType === "string") return "string";
	if (schemaType === "number" || schemaType === "integer") return "number";
	if (schemaType === "boolean") return "boolean";
	if (schemaType === "null") return "null";

	if (schemaType === "array") {
		if (!resolved.items || isPlainRecord(resolved.items)) {
			const itemResolved = resolved.items ? unwrapLocalRef(resolved.items, root, new Set(seen)) : undefined;
			if (
				isPlainRecord(itemResolved) &&
				(itemResolved.type === "string" ||
					itemResolved.type === "number" ||
					itemResolved.type === "integer" ||
					itemResolved.type === "boolean")
			) {
				return `Array<${itemResolved.type === "integer" ? "number" : itemResolved.type}>`;
			}
		}
		return undefined;
	}

	if (schemaType === "object" || isPlainRecord(resolved.properties)) {
		return summarizeObjectFields(resolved, root, inUnion, depth, seen);
	}

	return undefined;
}

/**
 * Produce the short single-line `Codemode: tools.<id>(args) resolves to ...` summary phrase.
 */
export function summarizeToolOutputType(outputSchema: unknown, toolName: string): string {
	if (outputSchema === undefined || outputSchema === null) {
		return "`string`";
	}
	const summary = summarizeNode(outputSchema, outputSchema, false, 0, new Set<string>());
	if (summary && !summary.includes("\n") && summary.length <= MAX_SUMMARY_LENGTH) {
		return `\`${summary}\``;
	}
	return `a value; \`await describeTool("${toolName}")\` shows its type`;
}

/**
 * Render one tool's full codemode documentation section (heading, description + guidelines, TS declaration).
 */
export function renderToolDeclaration(tool: CodemodeToolMetadata): string {
	const scriptId = sanitizeToolIdentifier(tool.name);
	const fullDesc = formatToolDescriptionWithGuidelines(tool.description, tool.promptGuidelines);
	const paramsType = tool.parameters !== undefined ? renderToolOutputType(tool.parameters) : "Record<string, unknown>";
	const returnType = tool.outputSchema !== undefined ? renderToolOutputType(tool.outputSchema) : "string";
	const parts: string[] = [`### \`${tool.name}\``];
	if (fullDesc) parts.push(fullDesc);
	parts.push(
		`\`\`\`ts\n// codemode tool declaration:\ndeclare namespace tools {\n  function ${scriptId}(args: ${paramsType}): Promise<${returnType}>;\n}\n\`\`\``,
	);
	return parts.join("\n\n");
}

function normalizeNamespaceKey(name: string): string {
	return name.replace(/-/g, "_");
}

function matchesNamespaceFilter(toolNamespace: ToolNamespace | undefined, filter: string): boolean {
	if (!toolNamespace) return false;
	const normNs = normalizeNamespaceKey(toolNamespace.name);
	const normFilter = normalizeNamespaceKey(filter);
	return normNs === normFilter || normNs === `mcp__${normFilter}`;
}

function extractTextContent(content: readonly (TextContent | ImageContent)[]): string {
	const texts: string[] = [];
	for (const block of content) {
		if (block.type === "text") texts.push(block.text);
	}
	return texts.join("\n");
}

function createConcurrencyLimiter(maxConcurrent: number): <T>(fn: () => Promise<T>) => Promise<T> {
	let active = 0;
	const queue: Array<() => void> = [];

	return async <T>(fn: () => Promise<T>): Promise<T> => {
		if (active >= maxConcurrent) {
			await new Promise<void>((resolve) => queue.push(resolve));
		}
		active += 1;
		try {
			return await fn();
		} finally {
			active -= 1;
			const next = queue.shift();
			if (next) next();
		}
	};
}

function describeGotValue(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (Array.isArray(value)) return value.length === 0 ? "an empty array" : "an array";
	const t = typeof value;
	if (t === "string") return "a string";
	if (t === "number") return "a number";
	if (t === "boolean") return "a boolean";
	if (t === "object") return "an object";
	return t;
}

function describeObjectOrValue(value: unknown): string {
	if (isPlainRecord(value)) {
		const keys = Object.keys(value);
		return keys.length === 0 ? "{}" : `{ ${keys.join(", ")} }`;
	}
	return describeGotValue(value);
}

function assertValidModelType(value: unknown): asserts value is ModelType {
	if (typeof value !== "string" || !ALLOWED_MODEL_TYPES.has(value)) {
		throw new Error(`Unknown model type ${JSON.stringify(String(value))}. Expected "chat", "image", or "classifier".`);
	}
}

function sanitizeModelInfo(model: AnyModel): Record<string, unknown> {
	const copy: Record<string, unknown> = {
		provider: model.provider,
		id: model.id,
		name: model.name,
		api: model.api,
		input: model.input,
	};
	if (model.type !== undefined) copy.type = model.type;
	if ("contextWindow" in model && model.contextWindow !== undefined) copy.contextWindow = model.contextWindow;
	if ("maxTokens" in model && model.maxTokens !== undefined) copy.maxTokens = model.maxTokens;
	if ("output" in model && model.output !== undefined) copy.output = model.output;
	if ("reasoning" in model && model.reasoning !== undefined) copy.reasoning = model.reasoning;
	if ("cost" in model && model.cost !== undefined) copy.cost = model.cost;
	return copy;
}

function lookupCanonicalModel<TType extends ModelType>(
	ctx: ExtensionToolContext | undefined,
	expectedType: TType,
	fnName: string,
	hasModel: boolean,
	modelArg: unknown,
) {
	if (!ctx?.modelRegistry) {
		throw new Error(`${fnName} is not available outside a Pi session.`);
	}
	const expectedLabel = expectedType === "classifier" ? "classifier" : expectedType === "image" ? "image" : "chat";
	const article = expectedType === "image" ? "an" : "a";

	if (!hasModel || modelArg === undefined) {
		throw new Error(
			`${fnName} expects ${article} ${expectedLabel} model as its first argument, got undefined. models.getModelOfType() returns undefined for an unknown provider or id.`,
		);
	}
	if (!isPlainRecord(modelArg)) {
		throw new Error(
			`${fnName} expects ${article} ${expectedLabel} model as its first argument, got ${describeGotValue(modelArg)}.`,
		);
	}
	const provider = modelArg.provider;
	const id = modelArg.id;
	if (typeof provider !== "string" || !provider || typeof id !== "string" || !id) {
		throw new Error(`${fnName} expects a model object with string provider and id properties.`);
	}

	const found = ctx.modelRegistry.getModelOfType(expectedType, provider, id);
	if (found) return found;

	for (const candidateType of ["chat", "image", "classifier"] as const) {
		if (candidateType === expectedType) continue;
		const other = ctx.modelRegistry.getModelOfType(candidateType, provider, id);
		if (other) {
			const otherArticle = candidateType === "image" ? "an" : "a";
			throw new Error(
				`${JSON.stringify(`${provider}/${id}`)} is ${otherArticle} ${candidateType} model, not ${article} ${expectedLabel} model. List the ${expectedLabel} models you can use with models.getAvailableOfType("${expectedType}").`,
			);
		}
	}

	throw new Error(
		`Unknown ${expectedLabel} model ${JSON.stringify(`${provider}/${id}`)}. List the ${expectedLabel} models you can use with models.getAvailableOfType("${expectedType}").`,
	);
}

function validateImageBlock(block: unknown): ImageContent | undefined {
	if (!isPlainRecord(block)) return undefined;
	if (block.type !== "image") return undefined;
	if (typeof block.data !== "string" || block.data.length === 0) return undefined;
	if (typeof block.mimeType !== "string" || !ALLOWED_IMAGE_MIME_TYPES.has(block.mimeType.toLowerCase())) {
		return undefined;
	}
	return { type: "image", data: block.data, mimeType: block.mimeType };
}

function validateClassifyContext(hasContext: boolean, contextArg: unknown): ClassifierContext {
	if (!hasContext || !isPlainRecord(contextArg)) {
		throw new Error(
			`models.classify() expects a context object as its second argument, got ${describeGotValue(hasContext ? contextArg : undefined)}. See ${CODEMODE_DOCS_PATH}.`,
		);
	}

	if (!isPlainRecord(contextArg.state)) {
		throw new Error(
			`models.classify() context.state must be an object, got ${describeGotValue(contextArg.state)}. See ${CODEMODE_DOCS_PATH}.`,
		);
	}

	let images: ImageContent[] | undefined;
	if (contextArg.images !== undefined) {
		if (!Array.isArray(contextArg.images)) {
			throw new Error(
				`models.classify() context.images must be an array of image blocks, got ${describeGotValue(contextArg.images)}. See ${CODEMODE_DOCS_PATH}.`,
			);
		}
		images = [];
		for (let i = 0; i < contextArg.images.length; i++) {
			const item = contextArg.images[i];
			const valid = validateImageBlock(item);
			if (!valid) {
				throw new Error(
					`models.classify() context.images[${i}] must be an image block, got ${describeObjectOrValue(item)}. See ${CODEMODE_DOCS_PATH}.`,
				);
			}
			images.push(valid);
		}
	}

	if (!isPlainRecord(contextArg.questions) || Object.keys(contextArg.questions).length === 0) {
		const got = isPlainRecord(contextArg.questions)
			? "an empty object"
			: describeGotValue(contextArg.questions);
		throw new Error(
			`models.classify() context.questions must map question IDs to questions, got ${got}. See ${CODEMODE_DOCS_PATH}.`,
		);
	}

	const questions: Record<string, ClassifierQuestion> = {};
	for (const [id, rawQ] of Object.entries(contextArg.questions)) {
		if (!isPlainRecord(rawQ)) {
			throw new Error(
				`models.classify() context.questions.${id} must be a question object, got ${describeGotValue(rawQ)}. See ${CODEMODE_DOCS_PATH}.`,
			);
		}
		if (typeof rawQ.instructions !== "string") {
			throw new Error(
				`models.classify() context.questions.${id}.instructions must be a string. See ${CODEMODE_DOCS_PATH}.`,
			);
		}
		if (rawQ.type === "choice") {
			if (
				!isPlainRecord(rawQ.criteria) ||
				Object.keys(rawQ.criteria).length === 0 ||
				Object.values(rawQ.criteria).some((v) => typeof v !== "string")
			) {
				throw new Error(
					`models.classify() context.questions.${id} is a "choice" question, so criteria must map each label to its meaning. See ${CODEMODE_DOCS_PATH}.`,
				);
			}
			questions[id] = {
				type: "choice",
				instructions: rawQ.instructions,
				criteria: { ...(rawQ.criteria as Record<string, string>) },
			};
		} else if (rawQ.type === "score") {
			if (
				!Array.isArray(rawQ.criteria) ||
				rawQ.criteria.length === 0 ||
				rawQ.criteria.some((v) => typeof v !== "string")
			) {
				throw new Error(
					`models.classify() context.questions.${id} is a "score" question, so criteria must be an array of level descriptions. See ${CODEMODE_DOCS_PATH}.`,
				);
			}
			questions[id] = {
				type: "score",
				instructions: rawQ.instructions,
				criteria: [...(rawQ.criteria as string[])],
			};
		} else if (rawQ.type === "bool") {
			if (
				!isPlainRecord(rawQ.criteria) ||
				typeof rawQ.criteria.true !== "string" ||
				typeof rawQ.criteria.false !== "string"
			) {
				throw new Error(
					`models.classify() context.questions.${id} is a "bool" question, so criteria must be { true: string, false: string }. See ${CODEMODE_DOCS_PATH}.`,
				);
			}
			questions[id] = {
				type: "bool",
				instructions: rawQ.instructions,
				criteria: { true: rawQ.criteria.true, false: rawQ.criteria.false },
			};
		} else {
			throw new Error(
				`models.classify() context.questions.${id}.type must be "choice", "score", or "bool", got ${JSON.stringify(rawQ.type)}. See ${CODEMODE_DOCS_PATH}.`,
			);
		}
	}

	return {
		state: contextArg.state as ClassifierContext["state"],
		...(images ? { images } : {}),
		questions,
	};
}

function validateImagesContext(hasContext: boolean, contextArg: unknown): ImagesContext {
	if (!hasContext || !isPlainRecord(contextArg)) {
		throw new Error(
			`models.generateImages() expects a context object as its second argument, got ${describeGotValue(hasContext ? contextArg : undefined)}. See ${CODEMODE_DOCS_PATH}.`,
		);
	}

	if (!Array.isArray(contextArg.input) || contextArg.input.length === 0) {
		throw new Error(
			`models.generateImages() context.input must be a non-empty array of blocks, got ${describeGotValue(contextArg.input)}. See ${CODEMODE_DOCS_PATH}.`,
		);
	}

	const input: ImagesContext["input"] = [];
	for (let i = 0; i < contextArg.input.length; i++) {
		const item = contextArg.input[i];
		if (isPlainRecord(item) && item.type === "text" && typeof item.text === "string") {
			input.push({ type: "text", text: item.text });
			continue;
		}
		const img = validateImageBlock(item);
		if (img) {
			input.push(img);
			continue;
		}
		throw new Error(
			`models.generateImages() context.input[${i}] must be a text or image block, got ${describeObjectOrValue(item)}. See ${CODEMODE_DOCS_PATH}.`,
		);
	}

	return { input };
}

function mimeTypeExtension(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/png":
			return "png";
		case "image/jpeg":
		case "image/jpg":
			return "jpg";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		default:
			return "bin";
	}
}

function buildTextSection(
	textPieces: readonly string[],
	consoleLines: readonly string[],
	extraLines: readonly string[],
): string {
	const chunks: string[] = [];
	let endsWithNewline = false;
	let hasAny = false;

	const pushPart = (part: string) => {
		if (hasAny && !endsWithNewline) {
			chunks.push("\n");
		}
		chunks.push(part);
		hasAny = true;
		endsWithNewline = part.endsWith("\n");
	};

	const totalTexts = textPieces.length;
	for (let i = 0; i < totalTexts; i++) {
		const raw = textPieces[i] ?? "";
		if (totalTexts > 1) {
			pushPart(`==> text ${i + 1}/${totalTexts} <==\n${raw}`);
		} else {
			pushPart(raw);
		}
	}

	if (consoleLines.length > 0) {
		pushPart(`<console_output>\n${consoleLines.join("\n")}\n</console_output>`);
	}

	for (const line of extraLines) {
		pushPart(line);
	}

	return chunks.join("");
}

/**
 * Execute a codemode script inside the isolated Apple JavaScriptCore sandbox.
 */
export async function executeCodemode(
	toolCallId: string,
	params: { code?: unknown },
	signal?: AbortSignal,
	_onUpdate?: unknown,
	ctx?: ExtensionToolContext,
	options: ExecuteCodemodeOptions = {},
): Promise<AgentToolResult<CodemodeToolDetails>> {
	const code = typeof params?.code === "string" ? params.code : undefined;
	if (code === undefined) {
		return {
			content: [{ type: "text", text: "Invalid codemode arguments: `code` must be a string." }],
			details: { calls: [] },
			isError: true,
		};
	}

	const parsed = parseCodemodeOptions(code);
	if (!parsed.ok) {
		return {
			content: [{ type: "text", text: parsed.error }],
			details: { calls: [] },
			isError: true,
		};
	}

	const allInfoMap = new Map<string, ToolInfo>();
	for (const info of options.getAllTools?.() ?? []) {
		allInfoMap.set(info.name, info);
	}

	const rawTools: readonly AgentTool[] = (ctx?.tools ?? []).filter((tool) => tool.name !== "codemode");
	const toolByName = new Map<string, AgentTool>();
	const toolMetaByName = new Map<string, CodemodeToolMetadata>();
	const sandboxTools: SandboxToolDescriptor[] = [];
	const toolSearchDocs: ReturnType<typeof createToolSearchDocument>[] = [];

	for (const tool of rawTools) {
		const info = allInfoMap.get(tool.name);
		const maybeExtended = tool as AgentTool & { namespace?: ToolNamespace; promptGuidelines?: readonly string[] };
		const namespace = info?.namespace ?? maybeExtended.namespace;
		const promptGuidelines = info?.promptGuidelines ?? maybeExtended.promptGuidelines;
		const meta: CodemodeToolMetadata = {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			outputSchema: tool.outputSchema,
			namespace,
			promptGuidelines,
		};
		const formattedDesc = formatToolDescriptionWithGuidelines(tool.description, promptGuidelines);
		toolByName.set(tool.name, tool);
		toolMetaByName.set(tool.name, meta);
		sandboxTools.push({
			name: tool.name,
			scriptName: sanitizeToolIdentifier(tool.name),
			description: formattedDesc,
		});
		toolSearchDocs.push(
			createToolSearchDocument(
				{ name: tool.name, description: formattedDesc, parameters: tool.parameters as TSchema },
				namespace,
			),
		);
	}

	const initialStore = ctx?.sessionManager ? readCodemodeStore(ctx.sessionManager.getBranch()) : {};
	const calls: CodemodeCallRecord[] = [];
	let callSequence = 0;
	let aggregatedUsage: Usage | undefined;
	const generatedImageDatas: string[] = [];
	const runModelCall = createConcurrencyLimiter(MAX_MODEL_CONCURRENCY);

	const recordUsage = (usage: Usage | undefined) => {
		if (!usage) return;
		aggregatedUsage = aggregatedUsage ? combineUsage(aggregatedUsage, usage) : usage;
	};

	const sandboxResult = await runCodemodeSandbox({
		code,
		tools: sandboxTools,
		initialStore,
		timeoutMs: parsed.value.timeoutMs,
		signal,
		includeModels: Boolean(options.hasModels || ctx?.modelRegistry),
		handlers: {
			async callTool(name, args, callSignal) {
				const tool = toolByName.get(name);
				if (!tool || !ctx) {
					throw new Error(`Tool ${name} not found`);
				}
				const startedAt = performance.now();
				let argsPreview = "{}";
				try {
					argsPreview = JSON.stringify(args ?? {});
				} catch {
					argsPreview = "{}";
				}
				const callId = `${toolCallId}/${++callSequence}`;
				try {
					const outcome = await ctx.executeTool(name, (args ?? {}) as Record<string, unknown>, {
						signal: callSignal,
					});
					const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
					if (outcome.result.structuredContent !== undefined) {
						calls.push({ id: callId, name, args: argsPreview, status: "ok", durationMs });
						return outcome.result.structuredContent;
					}
					const text = extractTextContent(outcome.result.content);
					if (outcome.isError) {
						calls.push({
							id: callId,
							name,
							args: argsPreview,
							status: "error",
							durationMs,
							error: text || `Tool ${name} failed`,
						});
						throw new Error(text || `Tool ${name} failed`);
					}
					calls.push({ id: callId, name, args: argsPreview, status: "ok", durationMs });
					return text;
				} catch (err) {
					const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
					const msg = err instanceof Error ? err.message : String(err);
					const alreadyRecorded = calls.some((entry) => entry.id === callId);
					if (!alreadyRecorded) {
						calls.push({ id: callId, name, args: argsPreview, status: "error", durationMs, error: msg });
					}
					throw err instanceof Error ? err : new Error(msg);
				}
			},

			async searchTools(query, searchOptions) {
				const opts = isPlainRecord(searchOptions) ? searchOptions : {};
				const limit =
					typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit >= 0
						? Math.floor(opts.limit)
						: DEFAULT_TOOL_SEARCH_LIMIT;
				const namespaceFilter = typeof opts.namespace === "string" && opts.namespace ? opts.namespace : undefined;

				const filteredDocs = namespaceFilter
					? toolSearchDocs.filter((doc) => matchesNamespaceFilter(toolMetaByName.get(doc.name)?.namespace, namespaceFilter))
					: toolSearchDocs;

				const ranked = new Bm25Ranker().rank(query, filteredDocs, limit);
				return ranked.map((entry) => {
					const meta = toolMetaByName.get(entry.name);
					return {
						name: entry.name,
						description: meta ? formatToolDescriptionWithGuidelines(meta.description, meta.promptGuidelines) : "",
					};
				});
			},

			async describeTool(name) {
				let meta = toolMetaByName.get(name);
				if (!meta) {
					for (const candidate of toolMetaByName.values()) {
						if (sanitizeToolIdentifier(candidate.name) === name) {
							meta = candidate;
							break;
						}
					}
				}
				return meta ? renderToolDeclaration(meta) : undefined;
			},

			async describeNamespace(name) {
				if (!name) return undefined;
				let matchedNs: ToolNamespace | undefined;
				const matchingTools: { name: string; description: string }[] = [];
				for (const meta of toolMetaByName.values()) {
					if (!meta.namespace) continue;
					if (matchesNamespaceFilter(meta.namespace, name)) {
						if (!matchedNs) matchedNs = meta.namespace;
						matchingTools.push({
							name: meta.name,
							description: formatToolDescriptionWithGuidelines(meta.description, meta.promptGuidelines),
						});
					}
				}
				if (!matchedNs) return undefined;
				return {
					name: matchedNs.name,
					...(matchedNs.description !== undefined ? { description: matchedNs.description } : {}),
					...(matchedNs.instructions !== undefined ? { instructions: matchedNs.instructions } : {}),
					tools: matchingTools,
				};
			},

			async modelGetModelsOfType(type, provider) {
				if (!ctx?.modelRegistry) throw new Error("models API is not available outside a Pi session.");
				assertValidModelType(type);
				if (provider !== undefined && typeof provider !== "string") {
					throw new TypeError("models.getModelsOfType() provider must be a string");
				}
				const list = ctx.modelRegistry.getModelsOfType(type, provider);
				return list.map(sanitizeModelInfo);
			},

			async modelGetAvailableOfType(type, provider) {
				if (!ctx?.modelRegistry) throw new Error("models API is not available outside a Pi session.");
				assertValidModelType(type);
				if (provider !== undefined && typeof provider !== "string") {
					throw new TypeError("models.getAvailableOfType() provider must be a string");
				}
				const list = await ctx.modelRegistry.getAvailableOfType(type, provider);
				return list.map(sanitizeModelInfo);
			},

			async modelGetModelOfType(type, provider, id) {
				if (!ctx?.modelRegistry) throw new Error("models API is not available outside a Pi session.");
				assertValidModelType(type);
				if (typeof provider !== "string" || !provider || typeof id !== "string" || !id) {
					throw new Error(
						'models.getModelOfType(type, provider, id) requires provider and id strings. The provider and the id are separate arguments (e.g. models.getModelOfType("classifier", "scorer", "judge")).',
					);
				}
				const found = ctx.modelRegistry.getModelOfType(type, provider, id);
				return found ? sanitizeModelInfo(found) : undefined;
			},

			async modelClassify(hasModel, modelArg, hasContext, contextArg, callSignal) {
				const canonicalModel = lookupCanonicalModel(
					ctx,
					"classifier",
					"models.classify()",
					hasModel,
					modelArg,
				) as ClassifierModel<any>;
				const validated = validateClassifyContext(hasContext, contextArg);

				return await runModelCall(async () => {
					const startedAt = performance.now();
					const callId = `${toolCallId}/models.classify/${++callSequence}`;
					const modelLabel = `${canonicalModel.provider}/${canonicalModel.id}`;
					const result: ClassifierResult = await ctx!.modelRegistry.classify(canonicalModel, validated, {
						signal: callSignal,
					});
					const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
					const cost = result.usage?.cost.total;
					recordUsage(result.usage);
					calls.push({
						id: callId,
						name: "models.classify",
						args: modelLabel,
						status: result.stopReason === "stop" ? "ok" : "error",
						durationMs,
						...(cost !== undefined ? { cost } : {}),
						...(result.stopReason !== "stop" && result.errorMessage ? { error: result.errorMessage } : {}),
					});
					return result;
				});
			},

			async modelGenerateImages(hasModel, modelArg, hasContext, contextArg, callSignal) {
				const canonicalModel = lookupCanonicalModel(
					ctx,
					"image",
					"models.generateImages()",
					hasModel,
					modelArg,
				) as ImageModel<any>;
				const validated = validateImagesContext(hasContext, contextArg);

				return await runModelCall(async () => {
					const startedAt = performance.now();
					const callId = `${toolCallId}/models.generateImages/${++callSequence}`;
					const modelLabel = `${canonicalModel.provider}/${canonicalModel.id}`;
					const result = await ctx!.modelRegistry.generateImages(canonicalModel, validated, {
						signal: callSignal,
					});
					const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
					const cost = result.usage?.cost.total;
					recordUsage(result.usage);
					calls.push({
						id: callId,
						name: "models.generateImages",
						args: modelLabel,
						status: result.stopReason === "stop" ? "ok" : "error",
						durationMs,
						...(cost !== undefined ? { cost } : {}),
						...(result.stopReason !== "stop" && result.errorMessage ? { error: result.errorMessage } : {}),
					});
					for (const block of result.output) {
						if (block.type === "image") {
							generatedImageDatas.push(block.data);
						}
					}
					return result;
				});
			},
		},
	});

	if (sandboxResult.didNotStart) {
		return {
			content: [{ type: "text", text: sandboxResult.error ?? "Script failed before starting." }],
			details: { calls },
			isError: true,
			...(aggregatedUsage ? { usage: aggregatedUsage } : {}),
		};
	}

	const wallSeconds = (sandboxResult.wallTimeMs / 1000).toFixed(1);
	const headerBlock: TextContent = {
		type: "text",
		text: `${sandboxResult.ok ? "Script completed" : "Script failed"}\nWall time ${wallSeconds} seconds\nOutput:\n`,
	};

	if (sandboxResult.ok && sandboxResult.storeDelta.hasWrites && options.appendStoreEntry) {
		const delta: SandboxStoreDelta = sandboxResult.storeDelta;
		options.appendStoreEntry(CODEMODE_STORE_ENTRY_TYPE, {
			set: delta.set,
			delete: delta.delete,
		});
	}

	// Deduplicate identical images and write each unique image to a temp file.
	const savedImageCache = new Map<string, { label: string; block: ImageContent }>();
	const imageOutputs = new Map<number, { label: string; block: ImageContent }>();
	const textOutputs: string[] = [];
	const shownDataCounts = new Map<string, number>();

	for (let i = 0; i < sandboxResult.outputs.length; i++) {
		const item: SandboxOutputItem | undefined = sandboxResult.outputs[i];
		if (!item) continue;
		if (item.kind === "text") {
			textOutputs.push(item.text);
		} else {
			shownDataCounts.set(item.data, (shownDataCounts.get(item.data) ?? 0) + 1);
			const key = `${item.mimeType}\0${item.data}`;
			let saved = savedImageCache.get(key);
			if (!saved) {
				const bytes = Buffer.from(item.data, "base64");
				const path = await writeOutputFile("pi-codemode", mimeTypeExtension(item.mimeType), bytes);
				saved = {
					label: `[Image saved to ${path} (${item.mimeType}, ${bytes.length}B)]`,
					block: { type: "image", data: item.data, mimeType: item.mimeType },
				};
				savedImageCache.set(key, saved);
			}
			imageOutputs.set(i, saved);
		}
	}

	// Warn if models.generateImages() returned images that the script did not show with image().
	const trailingNotes: string[] = [];
	if (sandboxResult.ok && generatedImageDatas.length > 0) {
		let unshown = 0;
		const remainingShown = new Map(shownDataCounts);
		for (const data of generatedImageDatas) {
			const count = remainingShown.get(data) ?? 0;
			if (count > 0) {
				remainingShown.set(data, count - 1);
			} else {
				unshown += 1;
			}
		}
		if (unshown > 0) {
			trailingNotes.push(
				`Note: models.generateImages() returned ${unshown} ${unshown === 1 ? "image" : "images"} that the script did not show. Show each image block of result.output with image(block).`,
			);
		}
	}

	const failureLines: string[] = [];
	if (!sandboxResult.ok) {
		failureLines.push(`Script error:\n${sandboxResult.error ?? "Script failed"}`);
		if (calls.length > 0) {
			const callSummary = calls.map((c) => `${c.name} (${c.status})`).join(", ");
			failureLines.push(`Tool calls made before the failure (they are not undone): ${callSummary}`);
		}
	}

	const maxTokens = parsed.value.maxOutputTokens;
	const maxChars = maxTokens * CHARS_PER_TOKEN;
	const pureTextForBudget = buildTextSection(textOutputs, sandboxResult.consoleLines, trailingNotes);
	let fullOutputPath: string | undefined;

	const content: (TextContent | ImageContent)[] = [headerBlock];

	if (pureTextForBudget.length > maxChars) {
		fullOutputPath = await writeOutputFile("pi-codemode", "txt", pureTextForBudget);
		const totalTokens = Math.ceil(pureTextForBudget.length / CHARS_PER_TOKEN);
		const headBudget = Math.ceil(maxChars / 2);
		const tailBudget = Math.floor(maxChars / 2);
		const head = sliceHead(pureTextForBudget, headBudget);
		const tail = sliceTail(pureTextForBudget, tailBudget);
		const omittedTokens = Math.max(1, totalTokens - Math.ceil((head.length + tail.length) / CHARS_PER_TOKEN));
		const truncatedLines = [
			`Warning: truncated output (${totalTokens} tokens > limit ${maxTokens})`,
			head,
			`... ${omittedTokens} tokens truncated ...`,
			tail,
			`[Full output: ${fullOutputPath} (read with offset/limit)]`,
			...failureLines,
		];
		content.push({ type: "text", text: truncatedLines.join("\n") });

		// Images follow the truncated text, each after the path it was saved to.
		for (let i = 0; i < sandboxResult.outputs.length; i++) {
			const img = imageOutputs.get(i);
			if (!img) continue;
			content.push({ type: "text", text: img.label });
			content.push(img.block);
		}
	} else {
		// Emit interleaved text and image items linearly, batching adjacent text lines into one TextContent block.
		let currentPieces: string[] = [];
		let stateHasAny = false;
		let stateEndsWithNewline = false;
		let textIndex = 0;
		const totalTexts = textOutputs.length;

		const pushTextLine = (part: string) => {
			if (stateHasAny && !stateEndsWithNewline) {
				currentPieces.push("\n");
			}
			currentPieces.push(part);
			stateHasAny = true;
			stateEndsWithNewline = part.endsWith("\n");
		};

		const flushText = () => {
			if (currentPieces.length > 0) {
				content.push({ type: "text", text: currentPieces.join("") });
				currentPieces = [];
				stateHasAny = false;
				stateEndsWithNewline = false;
			}
		};

		for (let i = 0; i < sandboxResult.outputs.length; i++) {
			const item = sandboxResult.outputs[i];
			if (!item) continue;
			if (item.kind === "text") {
				textIndex += 1;
				if (totalTexts > 1) {
					pushTextLine(`==> text ${textIndex}/${totalTexts} <==\n${item.text}`);
				} else {
					pushTextLine(item.text);
				}
			} else {
				const img = imageOutputs.get(i);
				if (img) {
					pushTextLine(img.label);
					flushText();
					content.push(img.block);
				}
			}
		}

		if (sandboxResult.consoleLines.length > 0) {
			pushTextLine(`<console_output>\n${sandboxResult.consoleLines.join("\n")}\n</console_output>`);
		}
		for (const note of trailingNotes) {
			pushTextLine(note);
		}
		for (const errLine of failureLines) {
			pushTextLine(errLine);
		}
		flushText();
	}

	const details: CodemodeToolDetails = {
		calls,
		...(fullOutputPath ? { fullOutputPath } : {}),
	};

	return {
		content,
		details,
		...(sandboxResult.ok ? {} : { isError: true }),
		...(aggregatedUsage ? { usage: aggregatedUsage } : {}),
	};
}
