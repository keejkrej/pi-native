import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { getAgentDir } from "../../config.ts";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "../../core/agent-session-runtime.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../../core/agent-session-services.ts";
import type { ExtensionUIContext } from "../../core/extensions/types.ts";
import { applyHttpProxySettings, configureHttpDispatcher } from "../../core/http-dispatcher.ts";
import { resolveCliModel } from "../../core/model-resolver.ts";
import { type SessionEntry, type SessionInfo, SessionManager, type SessionTreeNode } from "../../core/session-manager.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { getTextOutput } from "../../core/tools/render-utils.ts";
import {
	getAvailableThemesWithPaths,
	getThemeByName,
	setRegisteredThemes,
	setTheme as setGlobalThemeByName,
	setThemeInstance,
	theme as globalTheme,
} from "../interactive/theme/theme.ts";
import {
	checkoutBranch,
	createBranch,
	detectExternalOpeners,
	getDefaultGuiLayoutPreferences,
	getGitStatus,
	loadGuiLayoutPreferences,
	openWorkspaceInApp,
	readWorkspaceFilePreview,
	saveGuiLayoutPreferences,
	scanWorkspaceFiles,
	stageAndCommitChanges,
} from "./git-utils.ts";
import type {
	GuiAttachmentItem,
	GuiAuthSummary,
	GuiChangedFile,
	GuiContextUsage,
	GuiControllerEvent,
	GuiControllerListener,
	GuiExtensionStatusEntry,
	GuiExtensionWidgetEntry,
	GuiExternalOpener,
	GuiLayoutPreferences,
	GuiModelSummary,
	GuiPendingPrompt,
	GuiQueuedMessageItem,
	GuiSendMessageOptions,
	GuiSessionController,
	GuiSessionListItem,
	GuiSessionSnapshot,
	GuiSessionStatus,
	GuiToastEntry,
	GuiTranscriptEntry,
	GuiTreeEntryItem,
	GuiWorkspaceFileEntry,
	GuiWorkspaceFilePreview,
} from "./types.ts";

const STANDARD_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "low", "medium", "high"];
const MAX_ARGS_LEN = 140;
const MAX_OUTPUT_LEN = 600;
const MAX_OUTPUT_LINES = 10;
const MAX_ATTACHMENT_TEXT_BYTES = 128 * 1024;
const MAX_TOAST_COUNT = 20;

function truncateText(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

/**
 * Format tool arguments into a compact single-line summary for tool execution cards.
 */
export function formatCompactToolArgs(args: unknown): string {
	if (args === undefined || args === null) return "";
	if (typeof args === "string") {
		return truncateText(args.replace(/\s+/g, " ").trim(), MAX_ARGS_LEN);
	}
	if (typeof args !== "object") {
		return truncateText(String(args), MAX_ARGS_LEN);
	}
	try {
		const record = args as Record<string, unknown>;
		const entries = Object.entries(record);
		if (entries.length === 0) return "";
		const parts: string[] = [];
		for (let i = 0; i < entries.length && i < 4; i++) {
			const entry = entries[i];
			if (!entry) continue;
			const key = entry[0];
			const val = entry[1];
			let formattedVal: string;
			if (typeof val === "string") {
				formattedVal = JSON.stringify(truncateText(val.replace(/\s+/g, " "), 48));
			} else if (typeof val === "number" || typeof val === "boolean") {
				formattedVal = String(val);
			} else {
				formattedVal = JSON.stringify(val) ?? String(val);
			}
			parts.push(`${key}: ${formattedVal}`);
		}
		const suffix = entries.length > 4 ? ", ..." : "";
		return truncateText(`${parts.join(", ")}${suffix}`, MAX_ARGS_LEN);
	} catch {
		return "[args]";
	}
}

/**
 * Extract a bounded plain-text snippet from a tool execution result object.
 */
export function extractToolOutputSnippet(result: unknown): string {
	if (result === undefined || result === null) return "";
	let raw = "";
	if (typeof result === "string") {
		raw = result;
	} else if (typeof result === "object") {
		const candidate = result as {
			content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: unknown;
		};
		if (Array.isArray(candidate.content)) {
			raw = getTextOutput({ content: candidate.content }, false);
		} else {
			try {
				raw = JSON.stringify(result, null, 2);
			} catch {
				raw = String(result);
			}
		}
	} else {
		raw = String(result);
	}

	const trimmed = raw.trim();
	if (trimmed.length === 0) return "";

	const lines = trimmed.split(/\r?\n/);
	let clipped = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
	if (lines.length > MAX_OUTPUT_LINES) {
		clipped = `${clipped}\n... (${lines.length - MAX_OUTPUT_LINES} more lines)`;
	}
	return truncateText(clipped, MAX_OUTPUT_LEN);
}

/**
 * Extract displayable plain user text from an AgentMessage when role === "user".
 */
function extractUserText(message: AgentMessage): string {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text" && block.text.length > 0) {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

function extractUserAttachments(message: AgentMessage): GuiAttachmentItem[] | undefined {
	if (message.role !== "user" || !Array.isArray(message.content)) return undefined;
	const attachments: GuiAttachmentItem[] = [];
	let imageIndex = 0;
	for (const block of message.content) {
		if (block.type === "image") {
			imageIndex += 1;
			attachments.push({
				id: `img-${imageIndex}`,
				kind: "image",
				name: `image-${imageIndex}`,
				mimeType: block.mimeType,
				base64Data: block.data,
			});
		}
	}
	return attachments.length > 0 ? attachments : undefined;
}

/**
 * Extract concatenated markdown text, thinking text, stop reason, and error message from an assistant message.
 */
export function extractAssistantContent(message: AgentMessage): {
	text: string;
	thinking: string;
	stopReason: string;
	errorMessage: string;
} {
	if (message.role !== "assistant") {
		return { text: "", thinking: "", stopReason: "", errorMessage: "" };
	}
	const textParts: string[] = [];
	const thinkingParts: string[] = [];

	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (block.type === "text") {
				textParts.push(block.text);
			} else if (block.type === "thinking") {
				thinkingParts.push(block.thinking);
			}
		}
	}

	return {
		text: textParts.join("\n\n"),
		thinking: thinkingParts.join("\n\n"),
		stopReason: typeof message.stopReason === "string" ? message.stopReason : "",
		errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : "",
	};
}

function toGuiModelSummary(model: Model<Api>): GuiModelSummary {
	const label = `${model.provider}/${model.id}`;
	const name = model.name || model.id;
	const reasoningTag = model.reasoning ? "reasoning" : "standard";
	const description = name !== model.id ? `${name} (${reasoningTag})` : `${model.provider} (${reasoningTag})`;
	return {
		provider: model.provider,
		id: model.id,
		name,
		reasoning: Boolean(model.reasoning),
		label,
		description,
	};
}

function normalizeThinkingOptions(available: readonly ThinkingLevel[]): readonly ThinkingLevel[] {
	const filtered = STANDARD_THINKING_LEVELS.filter((level) => available.includes(level));
	if (filtered.length > 0) return filtered;
	return available.length > 0 ? available : ["off"];
}

/**
 * Build a safe, secret-free auth summary for the UI without inspecting or exposing token values.
 */
function buildSafeAuthSummary(
	availableModels: readonly Model<Api>[],
	activeModel: Model<Api> | undefined,
	hasConfiguredAuth: (provider: string) => boolean,
	isUsingOAuth: (provider: string) => boolean,
): GuiAuthSummary {
	const providers = new Set<string>();
	for (const model of availableModels) {
		if (hasConfiguredAuth(model.provider)) {
			providers.add(model.provider);
		}
	}
	const providerAuthCount = providers.size;

	if (!activeModel) {
		return {
			statusLabel:
				providerAuthCount > 0
					? `${providerAuthCount} provider(s) configured`
					: "No credentials in ~/.pi/agent/auth.json",
			providerAuthCount,
			hasActiveAuth: false,
			activeAuthLabel: "No active model",
		};
	}

	const hasAuth = hasConfiguredAuth(activeModel.provider);
	let activeAuthLabel = "Not configured";
	if (hasAuth) {
		activeAuthLabel = isUsingOAuth(activeModel.provider) ? "OAuth" : "API key";
	}
	const statusLabel = hasAuth
		? `${activeModel.provider}: ${activeAuthLabel} (${providerAuthCount} provider${providerAuthCount === 1 ? "" : "s"} ready)`
		: `${activeModel.provider}: Not configured`;

	return {
		statusLabel,
		providerAuthCount,
		hasActiveAuth: hasAuth,
		activeAuthLabel,
	};
}

function inferImageMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	switch (ext) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		default:
			return "image/png";
	}
}

function escapeXmlAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function buildOutboundMessagePayload(
	text: string,
	attachments?: readonly GuiAttachmentItem[],
): { text: string; images: ImageContent[] | undefined } {
	const images: ImageContent[] = [];
	const appendedBlocks: string[] = [];

	if (attachments && attachments.length > 0) {
		for (const item of attachments) {
			if (item.kind === "image") {
				if (item.base64Data) {
					images.push({
						type: "image",
						data: item.base64Data,
						mimeType: item.mimeType ?? "image/png",
					});
				} else if (item.path && existsSync(item.path)) {
					try {
						const rawBytes = readFileSync(item.path);
						images.push({
							type: "image",
							data: rawBytes.toString("base64"),
							mimeType: item.mimeType ?? inferImageMimeType(item.path),
						});
					} catch {
						appendedBlocks.push(`<attached_image name="${escapeXmlAttr(item.name)}" path="${escapeXmlAttr(item.path)}" />`);
					}
				}
			} else if (item.kind === "file") {
				const targetLabel = item.path ?? item.name;
				let fileBody = item.textContent;
				if (fileBody === undefined && item.path && existsSync(item.path)) {
					try {
						const buf = readFileSync(item.path);
						const clipped = buf.subarray(0, MAX_ATTACHMENT_TEXT_BYTES);
						if (!clipped.subarray(0, Math.min(clipped.length, 8192)).includes(0)) {
							fileBody = clipped.toString("utf8");
						}
					} catch {
						fileBody = undefined;
					}
				}
				if (fileBody !== undefined) {
					appendedBlocks.push(
						`<attached_file path="${escapeXmlAttr(targetLabel)}">\n${fileBody}\n</attached_file>`,
					);
				} else {
					appendedBlocks.push(`<attached_file path="${escapeXmlAttr(targetLabel)}" />`);
				}
			} else if (item.kind === "pasted-text") {
				const content = item.textContent ?? "";
				if (content.length > 0) {
					appendedBlocks.push(
						`<pasted_text name="${escapeXmlAttr(item.name)}">\n${content}\n</pasted_text>`,
					);
				}
			}
		}
	}

	const trimmed = text.trim();
	const combinedText =
		appendedBlocks.length === 0
			? trimmed
			: trimmed.length > 0
				? `${trimmed}\n\n${appendedBlocks.join("\n\n")}`
				: appendedBlocks.join("\n\n");

	return {
		text: combinedText,
		images: images.length > 0 ? images : undefined,
	};
}

function buildTranscriptFromSession(session: AgentSession): GuiTranscriptEntry[] {
	const branch = session.sessionManager.getBranch();
	const transcript: GuiTranscriptEntry[] = [];
	const toolIndexById = new Map<string, number>();
	let lastUserTimestamp: number | undefined;

	for (const entry of branch) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user") {
				const text = extractUserText(msg);
				lastUserTimestamp = typeof msg.timestamp === "number" ? msg.timestamp : undefined;
				transcript.push({
					id: entry.id,
					role: "user",
					text,
					timestamp: lastUserTimestamp,
					attachments: extractUserAttachments(msg),
				});
			} else if (msg.role === "assistant") {
				const content = extractAssistantContent(msg);
				const ts = typeof msg.timestamp === "number" ? msg.timestamp : undefined;
				const isFinalTurn = content.stopReason !== "toolUse";
				const turnDurationMs =
					isFinalTurn && lastUserTimestamp !== undefined && ts !== undefined && ts >= lastUserTimestamp
						? ts - lastUserTimestamp
						: undefined;

				if (
					content.text.length > 0 ||
					content.thinking.length > 0 ||
					content.errorMessage.length > 0 ||
					!Array.isArray(msg.content) ||
					!msg.content.some((block) => block.type === "toolCall")
				) {
					transcript.push({
						id: entry.id,
						role: "assistant",
						text: content.text,
						thinking: content.thinking || undefined,
						stopReason: content.stopReason || undefined,
						errorMessage: content.errorMessage || undefined,
						turnDurationMs,
						timestamp: ts,
					});
				}

				if (Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block.type === "toolCall") {
							const toolIdx = transcript.length;
							toolIndexById.set(block.id, toolIdx);
							transcript.push({
								id: `${entry.id}:${block.id}`,
								role: "tool",
								text: "",
								toolCallId: block.id,
								toolName: block.name,
								argsText: formatCompactToolArgs(block.arguments),
								timestamp: ts,
							});
						}
					}
				}
			} else if (msg.role === "toolResult") {
				const existingIdx = toolIndexById.get(msg.toolCallId);
				const outputText = extractToolOutputSnippet({ content: msg.content, details: msg.details });
				if (existingIdx !== undefined) {
					const existing = transcript[existingIdx];
					if (existing) {
						transcript[existingIdx] = {
							...existing,
							outputText,
							isError: msg.isError,
						};
					}
				} else {
					transcript.push({
						id: entry.id,
						role: "tool",
						text: "",
						toolCallId: msg.toolCallId,
						toolName: msg.toolName,
						outputText,
						isError: msg.isError,
						timestamp: typeof msg.timestamp === "number" ? msg.timestamp : undefined,
					});
				}
			} else if (msg.role === "bashExecution") {
				transcript.push({
					id: entry.id,
					role: "bash",
					text: msg.command,
					command: msg.command,
					outputText: msg.output,
					exitCode: msg.exitCode,
					isError: Boolean(msg.cancelled || (msg.exitCode !== undefined && msg.exitCode !== 0)),
					timestamp: msg.timestamp,
				});
			} else if (msg.role === "custom" && msg.display) {
				const customText =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								.filter((part): part is TextContent => part.type === "text")
								.map((part) => part.text)
								.join("\n");
				transcript.push({
					id: entry.id,
					role: "system",
					text: customText,
					timestamp: msg.timestamp,
				});
			}
		} else if (entry.type === "compaction") {
			transcript.push({
				id: entry.id,
				role: "compaction",
				text: entry.summary,
				timestamp: Date.parse(entry.timestamp) || undefined,
			});
		} else if (entry.type === "branch_summary") {
			transcript.push({
				id: entry.id,
				role: "branchSummary",
				text: entry.summary,
				timestamp: Date.parse(entry.timestamp) || undefined,
			});
		} else if (entry.type === "custom_message" && entry.display) {
			const customText =
				typeof entry.content === "string"
					? entry.content
					: entry.content
							.filter((part): part is TextContent => part.type === "text")
							.map((part) => part.text)
							.join("\n");
			transcript.push({
				id: entry.id,
				role: "system",
				text: customText,
				timestamp: Date.parse(entry.timestamp) || undefined,
			});
		}
	}

	return transcript;
}

function summarizeSessionEntry(entry: SessionEntry): string {
	switch (entry.type) {
		case "message": {
			const msg = entry.message;
			if (msg.role === "user") {
				return truncateText(extractUserText(msg).replace(/\s+/g, " ").trim() || "(user message)", 72);
			}
			if (msg.role === "assistant") {
				const content = extractAssistantContent(msg);
				const summary = content.text.replace(/\s+/g, " ").trim();
				if (summary.length > 0) return truncateText(summary, 72);
				if (Array.isArray(msg.content)) {
					const toolNames = msg.content
						.filter((block) => block.type === "toolCall")
						.map((block) => block.name);
					if (toolNames.length > 0) return `Tools: ${toolNames.join(", ")}`;
				}
				return content.stopReason ? `Assistant (${content.stopReason})` : "Assistant";
			}
			if (msg.role === "toolResult") {
				return `${msg.toolName}: ${msg.isError ? "error" : "result"}`;
			}
			if (msg.role === "bashExecution") {
				return `! ${truncateText(msg.command, 64)}`;
			}
			return msg.role;
		}
		case "model_change":
			return `Model: ${entry.provider}/${entry.modelId}`;
		case "thinking_level_change":
			return `Thinking: ${entry.thinkingLevel}`;
		case "compaction":
			return `Compacted (${entry.tokensBefore} tokens)`;
		case "branch_summary":
			return truncateText(`Branch: ${entry.summary.replace(/\s+/g, " ")}`, 72);
		case "session_info":
			return entry.name ? `Renamed: ${entry.name}` : "Session info";
		case "label":
			return entry.label ? `Label: ${entry.label}` : "Cleared label";
		case "custom_message":
			return `Custom (${entry.customType})`;
		case "custom":
			return `State (${entry.customType})`;
		case "context_edit":
			return entry.replacement === null ? "Omitted entry" : "Edited entry";
		case "usage":
			return `Usage (${entry.kind})`;
	}
}

function buildTreeEntriesFromSession(session: AgentSession): GuiTreeEntryItem[] {
	const roots: SessionTreeNode[] = session.sessionManager.getTree();
	const leafId = session.sessionManager.getLeafId();
	const items: GuiTreeEntryItem[] = [];

	function visit(node: SessionTreeNode, depth: number): void {
		const kind = node.entry.type === "message" ? node.entry.message.role : node.entry.type;
		const summary = summarizeSessionEntry(node.entry);
		items.push({
			id: node.entry.id,
			parentId: node.entry.parentId ?? undefined,
			kind,
			label: node.label ?? kind,
			summary,
			isCurrent: node.entry.id === leafId,
			depth,
			timestamp: node.entry.timestamp,
		});
		for (const child of node.children) {
			visit(child, depth + 1);
		}
	}

	for (const root of roots) {
		visit(root, 0);
	}
	return items;
}

function computeSessionUsageTotals(session: AgentSession): {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCostUsd: number;
} {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let totalCostUsd = 0;

	for (const entry of session.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant" && entry.message.usage) {
			const usage = entry.message.usage;
			inputTokens += usage.input ?? 0;
			outputTokens += usage.output ?? 0;
			cacheReadTokens += usage.cacheRead ?? 0;
			cacheWriteTokens += usage.cacheWrite ?? 0;
			totalCostUsd += usage.cost?.total ?? 0;
		} else if (entry.type === "usage" && entry.usage) {
			inputTokens += entry.usage.input ?? 0;
			outputTokens += entry.usage.output ?? 0;
			cacheReadTokens += entry.usage.cacheRead ?? 0;
			cacheWriteTokens += entry.usage.cacheWrite ?? 0;
			totalCostUsd += entry.usage.cost?.total ?? 0;
		}
	}

	return {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalCostUsd,
	};
}

/** Look up an optional custom session title without triggering unchecked Record string assertions in scriptc. */
function getSessionCustomName(names: Record<string, string>, sessionId: string): string | undefined {
	for (const [key, value] of Object.entries(names)) {
		if (key === sessionId) return value;
	}
	return undefined;
}

function deriveSessionTitle(
	info: Pick<SessionInfo, "id" | "name" | "firstMessage">,
	layout: GuiLayoutPreferences,
): string {
	const custom = getSessionCustomName(layout.sessionCustomNames, info.id);
	if (custom && custom.trim().length > 0) return custom.trim();
	if (info.name && info.name.trim().length > 0) return info.name.trim();
	const firstLine = info.firstMessage.split(/\r?\n/)[0]?.trim() ?? "";
	if (firstLine.length > 0) return truncateText(firstLine, 60);
	return "New Session";
}

function getWorkspaceName(cwd: string): string {
	const base = basename(cwd);
	return base.length > 0 ? base : cwd;
}

export interface RealGuiControllerOptions {
	readonly cwd: string;
	readonly provider?: string;
	readonly model?: string;
}

export interface GuiControllerFromRuntimeOptions {
	readonly layoutPreferences?: GuiLayoutPreferences;
	readonly persistLayout?: boolean;
	readonly onShutdownRequested?: () => void;
}

/**
 * Create a live GUI controller attached to an existing AgentSessionRuntime.
 */
export async function createGuiControllerFromRuntime(
	runtime: AgentSessionRuntime,
	options: GuiControllerFromRuntimeOptions = {},
): Promise<RealGuiSessionController> {
	const controller = new RealGuiSessionController(runtime, runtime.cwd, options);
	await controller.bindCurrentSession();
	return controller;
}

/**
 * Create a live GUI controller backed by a fresh AgentSessionRuntime and ~/.pi/agent/auth.json.
 */
export async function createRealGuiSessionController(
	options: RealGuiControllerOptions,
): Promise<GuiSessionController> {
	const agentDir = getAgentDir();
	const cwd = options.cwd;

	const bootstrapSettings = SettingsManager.create(cwd, agentDir);
	applyHttpProxySettings(bootstrapSettings.getGlobalSettings().httpProxy);
	configureHttpDispatcher(bootstrapSettings.getHttpIdleTimeoutMs());

	const sessionManager = SessionManager.create(cwd, bootstrapSettings.getSessionDir());

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd: runtimeCwd,
		agentDir: runtimeAgentDir,
		sessionManager: runtimeSessionManager,
		sessionStartEvent,
	}) => {
		const settingsManager = SettingsManager.create(runtimeCwd, runtimeAgentDir);
		const services = await createAgentSessionServices({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			settingsManager,
			modelRuntimeSignal: AbortSignal.timeout(15_000),
		});

		let requestedModel: Model<Api> | undefined;
		let requestedThinkingLevel: ThinkingLevel | undefined;
		const diagnostics = [...services.diagnostics];

		if (options.model) {
			const resolved = resolveCliModel({
				cliProvider: options.provider,
				cliModel: options.model,
				modelRuntime: services.modelRuntime,
			});
			if (resolved.error) {
				diagnostics.push({ type: "error", message: resolved.error });
			} else {
				requestedModel = resolved.model;
				requestedThinkingLevel = resolved.thinkingLevel;
				if (resolved.warning) {
					diagnostics.push({ type: "warning", message: resolved.warning });
				}
			}
		} else if (options.provider) {
			const match = services.modelRuntime
				.getAvailableSnapshot()
				.find((m) => m.provider.toLowerCase() === options.provider?.toLowerCase());
			if (match) {
				requestedModel = match;
			} else {
				diagnostics.push({
					type: "warning",
					message: `No available model found for provider "${options.provider}".`,
				});
			}
		}

		const created = await createAgentSessionFromServices({
			services,
			sessionManager: runtimeSessionManager,
			sessionStartEvent,
			model: requestedModel,
			thinkingLevel: requestedThinkingLevel,
		});

		return {
			...created,
			services,
			diagnostics,
		};
	};

	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager,
	});

	applyHttpProxySettings(runtime.services.settingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher(runtime.services.settingsManager.getHttpIdleTimeoutMs());

	return createGuiControllerFromRuntime(runtime);
}

/**
 * Live GUI session controller wrapping AgentSessionRuntime with transcript hydration,
 * queue/steer management, git/workspace inspection, session management, and ExtensionUIContext.
 */
export class RealGuiSessionController implements GuiSessionController {
	private readonly runtime: AgentSessionRuntime;
	private readonly listeners = new Set<GuiControllerListener>();
	private readonly persistLayout: boolean;
	private readonly onShutdownRequested: (() => void) | undefined;

	private unsubscribeSession: (() => void) | undefined;
	private activeAssistantMessageId = 0;
	private activeAssistantOpen = false;
	private activeAssistantTranscriptIndex = -1;
	private activeToolName: string | undefined;
	private statusMessage: string | undefined;
	private turnStartedAt: number | undefined;
	private pendingTurnDurationMs: number | undefined;

	private transcript: GuiTranscriptEntry[] = [];
	private sessions: GuiSessionListItem[] = [];
	private changedFiles: GuiChangedFile[] = [];
	private workspaceFiles: GuiWorkspaceFileEntry[] = [];
	private treeEntries: GuiTreeEntryItem[] = [];
	private gitBranch = "";
	private gitBranches: string[] = [];
	private isGitRepo = false;
	private openers: GuiExternalOpener[] = [];
	private queuedMessages: GuiQueuedMessageItem[] = [];
	private isRebuildingQueue = false;
	private queueItemSeq = 0;
	private lastPendingAttachments = new Map<string, readonly GuiAttachmentItem[]>();

	private readonly pendingPrompts: GuiPendingPrompt[] = [];
	private readonly pendingPromptCleanup = new Map<string, (value: unknown, cancelled: boolean) => void>();
	private promptSeq = 0;
	private readonly widgets = new Map<string, GuiExtensionWidgetEntry>();
	private readonly statuses = new Map<string, string>();
	private toasts: GuiToastEntry[] = [];
	private toastSeq = 0;
	private workingMessage: string | undefined;
	private workingVisible = true;
	private toolsExpanded = false;
	private windowTitle: string | undefined;
	private editorText = "";

	private layout: GuiLayoutPreferences;
	private historyStack: string[] = [];
	private historyIndex = -1;
	private isNavigatingHistory = false;
	private nextSessionResetReason: "new" | "clear" = "new";
	private nextSessionActionReason: "new" | "clear" | "switch" | "fork" | "tree" | "reload" = "new";
	private workspaceRefreshInFlight = false;
	private workspaceRefreshQueued = false;
	private disposed = false;

	constructor(runtime: AgentSessionRuntime, _cwd: string, options: GuiControllerFromRuntimeOptions = {}) {
		this.runtime = runtime;
		this.persistLayout = options.persistLayout ?? true;
		this.onShutdownRequested = options.onShutdownRequested;
		this.layout =
			options.layoutPreferences ??
			(this.persistLayout ? loadGuiLayoutPreferences(runtime.services.agentDir) : getDefaultGuiLayoutPreferences());
		this.openers = detectExternalOpeners();

		this.runtime.setRebindSession(async () => {
			await this.bindCurrentSession();
			const snapshot = this.getSnapshot();
			this.emit({
				type: "session_reset",
				resetReason: this.nextSessionResetReason,
				sessionActionReason: this.nextSessionActionReason,
				snapshot,
			});
			this.nextSessionResetReason = "new";
			this.nextSessionActionReason = "new";
			this.emit({ type: "snapshot", snapshot });
			this.emitStatusChanged();
		});
	}

	private get currentCwd(): string {
		return this.runtime.session.sessionManager.getCwd() || this.runtime.cwd;
	}

	private recordSessionHistory(sessionKey: string): void {
		if (sessionKey.length === 0) return;
		if (this.isNavigatingHistory) return;
		if (this.historyIndex >= 0 && this.historyStack[this.historyIndex] === sessionKey) {
			return;
		}
		if (this.historyIndex < this.historyStack.length - 1) {
			this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
		}
		this.historyStack.push(sessionKey);
		this.historyIndex = this.historyStack.length - 1;
	}

	async bindCurrentSession(): Promise<void> {
		if (this.unsubscribeSession) {
			this.unsubscribeSession();
			this.unsubscribeSession = undefined;
		}

		this.activeAssistantOpen = false;
		this.activeAssistantTranscriptIndex = -1;
		this.activeToolName = undefined;
		this.statusMessage = undefined;
		this.turnStartedAt = undefined;
		this.pendingTurnDurationMs = undefined;
		this.queuedMessages = [];
		this.lastPendingAttachments.clear();

		const session = this.runtime.session;
		const uiContext = this.createGuiExtensionUIContext();

		await session.bindExtensions({
			uiContext,
			mode: "tui",
			abortHandler: () => {
				const cleared = session.clearQueue();
				const restored = [...cleared.steering, ...cleared.followUp];
				if (restored.length > 0 && this.editorText.trim().length === 0) {
					this.setEditorText(restored.join("\n"));
				}
			},
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (opts) => {
					this.nextSessionActionReason = "new";
					return this.runtime.newSession(opts);
				},
				fork: async (entryId, opts) => {
					this.nextSessionActionReason = "fork";
					const result = await this.runtime.fork(entryId, opts);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, opts) => {
					const result = await session.navigateTree(targetId, {
						summarize: opts?.summarize,
						customInstructions: opts?.customInstructions,
						replaceInstructions: opts?.replaceInstructions,
						label: opts?.label,
					});
					if (!result.cancelled) {
						this.rehydrateTranscriptAndTree();
						if (result.editorText) {
							this.setEditorText(result.editorText);
						}
					}
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, opts) => {
					this.nextSessionActionReason = "switch";
					return this.runtime.switchSession(sessionPath, opts);
				},
				reload: async () => {
					this.nextSessionActionReason = "reload";
					await session.reload();
					this.rehydrateTranscriptAndTree();
					this.emitStatusChanged();
				},
			},
			shutdownHandler: () => {
				if (this.onShutdownRequested) {
					this.onShutdownRequested();
				}
			},
			onError: (err) => {
				this.emit({
					type: "error",
					errorMessage: `Extension error (${err.extensionPath}): ${err.error}`,
				});
			},
		});

		setRegisteredThemes(session.resourceLoader.getThemes().themes);

		const sessionKey = session.sessionFile ?? `memory:${session.sessionId}`;
		this.recordSessionHistory(sessionKey);

		this.rehydrateTranscriptAndTree();

		this.unsubscribeSession = session.subscribe((event) => {
			this.handleSessionEvent(session, event);
		});

		await Promise.allSettled([this.refreshWorkspaceState(), this.refreshSessionsList()]);
		this.emit({ type: "snapshot", snapshot: this.getSnapshot() });
	}

	private createGuiExtensionUIContext(): ExtensionUIContext {
		return {
			select: (title, options, opts) =>
				this.enqueuePendingPrompt<string | undefined>(
					{
						kind: "select",
						title,
						message: title,
						options: [...options],
					},
					undefined,
					opts?.signal,
					opts?.timeout,
					(value, cancelled) => (!cancelled && typeof value === "string" ? value : undefined),
				),

			confirm: (title, message, opts) =>
				this.enqueuePendingPrompt<boolean>(
					{
						kind: "confirm",
						title,
						message,
					},
					false,
					opts?.signal,
					opts?.timeout,
					(value, cancelled) => (!cancelled ? Boolean(value) : false),
				),

			input: (title, placeholder, opts) =>
				this.enqueuePendingPrompt<string | undefined>(
					{
						kind: "input",
						title,
						message: title,
						defaultValue: placeholder,
					},
					undefined,
					opts?.signal,
					opts?.timeout,
					(value, cancelled) => (!cancelled && typeof value === "string" ? value : undefined),
				),

			notify: (message, type = "info") => {
				this.pushToast(message, type);
			},

			onTerminalInput: () => {
				return () => {};
			},

			setStatus: (key, text) => {
				if (text === undefined || text.length === 0) {
					this.statuses.delete(key);
				} else {
					this.statuses.set(key, text);
				}
				this.emit({ type: "extension_ui", snapshot: this.getSnapshot() });
			},

			setWorkingMessage: (message) => {
				this.workingMessage = message;
				this.emitStatusChanged();
			},

			setWorkingVisible: (visible) => {
				this.workingVisible = visible;
				this.emitStatusChanged();
			},

			setWorkingIndicator: () => {
				// Status indicator animation uses native GUI loader.
			},

			setHiddenThinkingLabel: () => {
				// GUI cards render thinking sections uniformly.
			},

			setWidget: (key, content, options) => {
				if (content === undefined) {
					this.widgets.delete(key);
					this.emit({ type: "extension_ui", snapshot: this.getSnapshot() });
					return;
				}
				if (Array.isArray(content)) {
					this.widgets.set(key, {
						key,
						placement: options?.placement,
						lines: [...content],
					});
					this.emit({ type: "extension_ui", snapshot: this.getSnapshot() });
				}
			},

			setFooter: () => {},
			setHeader: () => {},

			setTitle: (title) => {
				this.windowTitle = title;
				this.emitStatusChanged();
			},

			custom: async () => {
				return undefined as never;
			},

			pasteToEditor: (text) => {
				const next = this.editorText.length > 0 ? `${this.editorText}${text}` : text;
				this.editorText = next;
				this.emit({ type: "editor_text", editorText: next, appendEditorText: true });
			},

			setEditorText: (text) => {
				this.setEditorText(text);
			},

			getEditorText: () => {
				return this.editorText;
			},

			editor: (title, prefill) =>
				this.enqueuePendingPrompt<string | undefined>(
					{
						kind: "editor",
						title,
						message: title,
						defaultValue: prefill,
					},
					undefined,
					undefined,
					undefined,
					(value, cancelled) => (!cancelled && typeof value === "string" ? value : undefined),
				),

			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,

			get theme() {
				return globalTheme;
			},

			getAllThemes: () => {
				return getAvailableThemesWithPaths();
			},

			getTheme: (name) => {
				return getThemeByName(name);
			},

			setTheme: (targetTheme) => {
				if (typeof targetTheme === "string") {
					const result = setGlobalThemeByName(targetTheme, true);
					if (result.success && (targetTheme === "dark" || targetTheme === "light")) {
						this.updateLayoutPreferences({ appearance: targetTheme });
					}
					return result;
				}
				setThemeInstance(targetTheme);
				return { success: true };
			},

			getToolsExpanded: () => this.toolsExpanded,

			setToolsExpanded: (expanded) => {
				this.toolsExpanded = expanded;
				this.emitStatusChanged();
			},
		};
	}

	private enqueuePendingPrompt<T>(
		spec: Omit<GuiPendingPrompt, "id" | "resolve">,
		defaultValue: T,
		signal: AbortSignal | undefined,
		timeoutMs: number | undefined,
		parseResult: (value: unknown, cancelled: boolean) => T,
	): Promise<T> {
		const id = `prompt-${++this.promptSeq}`;
		return new Promise<T>((resolvePromise) => {
			let settled = false;
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const finish = (value: unknown, cancelled: boolean) => {
				if (settled) return;
				settled = true;
				if (timeoutId !== undefined) clearTimeout(timeoutId);
				if (signal) signal.removeEventListener("abort", onAbort);
				this.pendingPromptCleanup.delete(id);
				const idx = this.pendingPrompts.findIndex((item) => item.id === id);
				if (idx >= 0) {
					this.pendingPrompts.splice(idx, 1);
				}
				this.emit({ type: "extension_ui", snapshot: this.getSnapshot() });
				resolvePromise(cancelled ? defaultValue : parseResult(value, false));
			};

			const onAbort = () => {
				finish(undefined, true);
			};

			if (signal) {
				if (signal.aborted) {
					resolvePromise(defaultValue);
					return;
				}
				signal.addEventListener("abort", onAbort, { once: true });
			}

			if (timeoutMs !== undefined && timeoutMs > 0) {
				timeoutId = setTimeout(() => finish(undefined, true), timeoutMs);
			}

			const entry: GuiPendingPrompt = {
				id,
				...spec,
				resolve: (value) => finish(value, false),
			};
			this.pendingPromptCleanup.set(id, finish);
			this.pendingPrompts.push(entry);
			this.emit({
				type: "extension_ui",
				pendingPrompt: entry,
				snapshot: this.getSnapshot(),
			});
		});
	}

	private pushToast(message: string, level: "info" | "warning" | "error" = "info"): void {
		const toast: GuiToastEntry = {
			id: `toast-${++this.toastSeq}`,
			message,
			level,
			createdAt: Date.now(),
		};
		this.toasts.push(toast);
		if (this.toasts.length > MAX_TOAST_COUNT) {
			this.toasts = this.toasts.slice(-MAX_TOAST_COUNT);
		}
		this.emit({
			type: "extension_ui",
			toast,
			snapshot: this.getSnapshot(),
		});
	}

	private rehydrateTranscriptAndTree(): void {
		const session = this.runtime.session;
		this.transcript = buildTranscriptFromSession(session);
		this.treeEntries = buildTreeEntriesFromSession(session);
		this.emit({ type: "tree_changed", treeEntries: this.treeEntries });
	}

	private handleSessionEvent(session: AgentSession, event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				this.activeToolName = undefined;
				this.statusMessage = this.workingMessage ?? "Streaming...";
				if (this.turnStartedAt === undefined) {
					this.turnStartedAt = Date.now();
				}
				this.emitStatusChanged();
				break;

			case "agent_end":
				if (!event.willRetry) {
					this.activeToolName = undefined;
					this.statusMessage = undefined;
					this.turnStartedAt = undefined;
					this.rehydrateTranscriptAndTree();
					void this.refreshWorkspaceState();
					void this.refreshSessionsList();
					this.emitStatusChanged();
				}
				break;

			case "agent_settled":
				this.activeToolName = undefined;
				this.statusMessage = undefined;
				this.turnStartedAt = undefined;
				this.rehydrateTranscriptAndTree();
				void this.refreshWorkspaceState();
				this.emitStatusChanged();
				break;

			case "queue_update":
				if (!this.isRebuildingQueue) {
					this.syncQueuedMessagesFromSession(event.steering, event.followUp);
				}
				break;

			case "message_start": {
				if (event.message.role === "user") {
					const text = extractUserText(event.message);
					const attachments = extractUserAttachments(event.message);
					this.turnStartedAt = Date.now();
					this.pendingTurnDurationMs = undefined;
					if (text.length > 0 || (attachments && attachments.length > 0)) {
						this.transcript.push({
							id: `live-user-${Date.now()}-${this.transcript.length}`,
							role: "user",
							text,
							attachments,
							timestamp: typeof event.message.timestamp === "number" ? event.message.timestamp : Date.now(),
						});
						this.emit({ type: "user_message", text, attachments });
					}
				} else if (event.message.role === "assistant") {
					this.activeAssistantMessageId += 1;
					this.activeAssistantOpen = true;
					const content = extractAssistantContent(event.message);
					const messageId = `assistant-${this.activeAssistantMessageId}`;
					this.activeAssistantTranscriptIndex = this.transcript.length;
					this.transcript.push({
						id: messageId,
						role: "assistant",
						text: content.text,
						thinking: content.thinking || undefined,
						timestamp: typeof event.message.timestamp === "number" ? event.message.timestamp : Date.now(),
					});
					this.emit({
						type: "assistant_start",
						messageId,
						text: content.text,
						thinking: content.thinking,
					});
				}
				break;
			}

			case "message_update": {
				if (event.message.role === "assistant") {
					if (!this.activeAssistantOpen) {
						this.activeAssistantMessageId += 1;
						this.activeAssistantOpen = true;
						const messageId = `assistant-${this.activeAssistantMessageId}`;
						this.activeAssistantTranscriptIndex = this.transcript.length;
						this.transcript.push({
							id: messageId,
							role: "assistant",
							text: "",
							timestamp: Date.now(),
						});
						this.emit({
							type: "assistant_start",
							messageId,
						});
					}
					const content = extractAssistantContent(event.message);
					const messageId = `assistant-${this.activeAssistantMessageId}`;
					const currentEntry = this.transcript[this.activeAssistantTranscriptIndex];
					if (currentEntry) {
						this.transcript[this.activeAssistantTranscriptIndex] = {
							...currentEntry,
							text: content.text,
							thinking: content.thinking || undefined,
						};
					}
					this.emit({
						type: "assistant_update",
						messageId,
						text: content.text,
						thinking: content.thinking,
					});
				}
				break;
			}

			case "message_end": {
				if (event.message.role === "assistant" && this.activeAssistantOpen) {
					const content = extractAssistantContent(event.message);
					const messageId = `assistant-${this.activeAssistantMessageId}`;
					const isFinalTurn = content.stopReason !== "toolUse";
					const durationMs =
						isFinalTurn && this.turnStartedAt !== undefined
							? Math.max(0, Date.now() - this.turnStartedAt)
							: undefined;
					if (durationMs !== undefined) {
						this.pendingTurnDurationMs = durationMs;
					}
					const currentEntry = this.transcript[this.activeAssistantTranscriptIndex];
					if (currentEntry) {
						this.transcript[this.activeAssistantTranscriptIndex] = {
							...currentEntry,
							text: content.text,
							thinking: content.thinking || undefined,
							stopReason: content.stopReason || undefined,
							errorMessage: content.errorMessage || undefined,
							turnDurationMs: durationMs,
						};
					}
					this.activeAssistantOpen = false;
					this.activeAssistantTranscriptIndex = -1;
					this.emit({
						type: "assistant_end",
						messageId,
						text: content.text,
						thinking: content.thinking,
						stopReason: content.stopReason,
						errorMessage: content.errorMessage,
						durationMs,
					});
				}
				break;
			}

			case "tool_execution_start": {
				const argsText = formatCompactToolArgs(event.args);
				this.activeToolName = event.toolName;
				this.statusMessage = `Tool: ${event.toolName}`;
				this.transcript.push({
					id: `live-tool-${event.toolCallId}`,
					role: "tool",
					text: "",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					argsText,
					timestamp: Date.now(),
				});
				this.emitStatusChanged();
				this.emit({
					type: "tool_start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					argsText,
				});
				break;
			}

			case "tool_execution_update": {
				const argsText = formatCompactToolArgs(event.args);
				const outputText = extractToolOutputSnippet(event.partialResult);
				this.updateTranscriptTool(event.toolCallId, { argsText, outputText });
				this.emit({
					type: "tool_update",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					argsText,
					outputText,
				});
				break;
			}

			case "tool_execution_end": {
				const outputText = extractToolOutputSnippet(event.result);
				this.updateTranscriptTool(event.toolCallId, {
					outputText,
					isError: event.isError,
					durationMs: event.durationMs,
				});
				if (this.activeToolName === event.toolName) {
					this.activeToolName = undefined;
					this.statusMessage = session.isStreaming ? (this.workingMessage ?? "Streaming...") : undefined;
					this.emitStatusChanged();
				}
				this.emit({
					type: "tool_end",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					outputText,
					isError: event.isError,
					durationMs: event.durationMs,
				});
				if (event.toolName === "write" || event.toolName === "edit" || event.toolName === "bash") {
					void this.refreshWorkspaceState();
				}
				break;
			}

			case "thinking_level_changed":
			case "session_info_changed":
				this.emitStatusChanged();
				void this.refreshSessionsList();
				break;

			case "entry_appended":
				this.treeEntries = buildTreeEntriesFromSession(session);
				this.emit({ type: "tree_changed", treeEntries: this.treeEntries });
				break;

			case "auto_retry_start":
				this.statusMessage = `Retrying (${event.attempt}/${event.maxAttempts})...`;
				this.emitStatusChanged();
				break;

			case "auto_retry_end":
				this.statusMessage = event.success ? (this.workingMessage ?? "Streaming...") : undefined;
				if (!event.success && event.finalError) {
					this.emit({ type: "error", errorMessage: event.finalError });
				}
				this.emitStatusChanged();
				break;

			case "compaction_start":
				this.statusMessage = "Compacting context...";
				this.emitStatusChanged();
				break;

			case "compaction_end":
				this.statusMessage = session.isStreaming ? (this.workingMessage ?? "Streaming...") : undefined;
				this.rehydrateTranscriptAndTree();
				this.emit({ type: "snapshot", snapshot: this.getSnapshot() });
				this.emitStatusChanged();
				break;
		}
	}

	private updateTranscriptTool(
		toolCallId: string,
		patch: { argsText?: string; outputText?: string; isError?: boolean; durationMs?: number },
	): void {
		for (let i = this.transcript.length - 1; i >= 0; i--) {
			const item = this.transcript[i];
			if (item && item.role === "tool" && item.toolCallId === toolCallId) {
				this.transcript[i] = {
					...item,
					argsText: patch.argsText ?? item.argsText,
					outputText: patch.outputText ?? item.outputText,
					isError: patch.isError ?? item.isError,
					durationMs: patch.durationMs ?? item.durationMs,
				};
				return;
			}
		}
	}

	private syncQueuedMessagesFromSession(steering: readonly string[], followUp: readonly string[]): void {
		const next: GuiQueuedMessageItem[] = [];
		const now = Date.now();
		for (const text of steering) {
			next.push({
				id: `queue-${++this.queueItemSeq}`,
				kind: "steer",
				text,
				attachments: this.lastPendingAttachments.get(`steer:${text}`),
				createdAt: now,
			});
		}
		for (const text of followUp) {
			next.push({
				id: `queue-${++this.queueItemSeq}`,
				kind: "followUp",
				text,
				attachments: this.lastPendingAttachments.get(`followUp:${text}`),
				createdAt: now,
			});
		}
		this.queuedMessages = next;
		this.emit({ type: "queue_changed", queuedMessages: this.queuedMessages });
		this.emitStatusChanged();
	}

	getStatus(): GuiSessionStatus {
		const session = this.runtime.session;
		const modelRuntime = this.runtime.services.modelRuntime;
		const availableModels = modelRuntime.getAvailableSnapshot();
		const activeModel = session.model;

		const authSummary = buildSafeAuthSummary(
			availableModels,
			activeModel,
			(provider) => modelRuntime.hasConfiguredAuth(provider),
			(provider) => modelRuntime.isUsingOAuth(provider),
		);

		const sessionId = session.sessionId;
		const sessionName =
			getSessionCustomName(this.layout.sessionCustomNames, sessionId) ??
			session.sessionName ??
			session.sessionManager.getSessionName();

		return {
			cwd: this.currentCwd,
			activeModel: activeModel ? toGuiModelSummary(activeModel) : undefined,
			thinkingLevel: session.thinkingLevel,
			availableThinkingLevels: normalizeThinkingOptions(session.getAvailableThinkingLevels()),
			isStreaming: session.isStreaming,
			activeToolName: this.activeToolName,
			statusMessage: this.statusMessage,
			authSummary,
			modelFallbackMessage: this.runtime.modelFallbackMessage,
			sessionId,
			sessionFile: session.sessionFile,
			sessionName,
			gitBranch: this.gitBranch || undefined,
			isGitRepo: this.isGitRepo,
			contextUsage: this.getContextUsage(),
			pendingSteeringCount: session.getSteeringMessages().length,
			pendingFollowUpCount: session.getFollowUpMessages().length,
			canGoBack: this.canGoBack(),
			canGoForward: this.canGoForward(),
			workingMessage: this.workingMessage,
			workingVisible: this.workingVisible,
			toolsExpanded: this.toolsExpanded,
			windowTitle: this.windowTitle,
		};
	}

	getSnapshot(): GuiSessionSnapshot {
		return {
			status: this.getStatus(),
			transcript: [...this.transcript],
			sessions: [...this.sessions],
			changedFiles: [...this.changedFiles],
			workspaceFiles: [...this.workspaceFiles],
			treeEntries: [...this.treeEntries],
			gitBranch: this.gitBranch,
			gitBranches: [...this.gitBranches],
			isGitRepo: this.isGitRepo,
			openers: [...this.openers],
			queuedMessages: [...this.queuedMessages],
			pendingPrompts: [...this.pendingPrompts],
			widgets: Array.from(this.widgets.values()),
			statuses: Array.from(this.statuses.entries()).map(([key, text]) => ({ key, text })),
			toasts: [...this.toasts],
			layout: {
				...this.layout,
				pinnedSessionIds: [...this.layout.pinnedSessionIds],
				sessionCustomNames: { ...this.layout.sessionCustomNames },
			},
		};
	}

	getTranscript(): readonly GuiTranscriptEntry[] {
		return [...this.transcript];
	}

	getAvailableModels(): readonly GuiModelSummary[] {
		return this.runtime.services.modelRuntime.getAvailableSnapshot().map(toGuiModelSummary);
	}

	async selectModel(provider: string, modelId: string): Promise<void> {
		const model = this.runtime.services.modelRuntime
			.getAvailableSnapshot()
			.find((item) => item.provider === provider && item.id === modelId);
		if (!model) {
			throw new Error(`Model not found or unavailable: ${provider}/${modelId}`);
		}
		await this.runtime.session.setModel(model);
		this.emitStatusChanged();
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.runtime.session.setThinkingLevel(level);
		this.emitStatusChanged();
	}

	async prompt(text: string): Promise<void> {
		await this.sendUserMessage(text);
	}

	async sendUserMessage(text: string, options: GuiSendMessageOptions = {}): Promise<void> {
		const trimmed = text.trim();
		const attachments = options.attachments;
		if (trimmed.length === 0 && (!attachments || attachments.length === 0)) {
			return;
		}

		if (trimmed.startsWith("!!")) {
			const cmd = trimmed.slice(2).trim();
			if (cmd.length > 0) {
				await this.executeBashCommand(cmd, true);
			}
			return;
		}
		if (trimmed.startsWith("!")) {
			const cmd = trimmed.slice(1).trim();
			if (cmd.length > 0) {
				await this.executeBashCommand(cmd, false);
			}
			return;
		}

		const payload = buildOutboundMessagePayload(text, attachments);
		if (payload.text.length === 0 && !payload.images) {
			return;
		}

		const session = this.runtime.session;
		if (session.isStreaming) {
			const behavior =
				options.deliverAs === "steer" || options.deliverAs === "followUp" ? options.deliverAs : "followUp";
			if (attachments && attachments.length > 0) {
				this.lastPendingAttachments.set(`${behavior}:${payload.text}`, attachments);
			}
			await session.prompt(payload.text, {
				images: payload.images,
				streamingBehavior: behavior,
			});
			return;
		}

		await session.prompt(payload.text, { images: payload.images });
	}

	async steerMessage(text: string, attachments?: readonly GuiAttachmentItem[]): Promise<void> {
		await this.sendUserMessage(text, { attachments, deliverAs: "steer" });
	}

	removeQueuedMessage(id: string): void {
		const targetIdx = this.queuedMessages.findIndex((item) => item.id === id);
		if (targetIdx < 0) return;

		const remaining = this.queuedMessages.filter((item) => item.id !== id);
		const session = this.runtime.session;
		this.isRebuildingQueue = true;
		try {
			session.clearQueue();
			this.queuedMessages = [];
		} finally {
			this.isRebuildingQueue = false;
		}

		void this.requeueRemainingMessages(remaining);
	}

	private async requeueRemainingMessages(remaining: readonly GuiQueuedMessageItem[]): Promise<void> {
		const session = this.runtime.session;
		for (const item of remaining) {
			if (!session.isStreaming) {
				await this.sendUserMessage(item.text, { attachments: item.attachments });
				continue;
			}
			const payload = buildOutboundMessagePayload(item.text, item.attachments);
			if (item.attachments && item.attachments.length > 0) {
				this.lastPendingAttachments.set(`${item.kind}:${payload.text}`, item.attachments);
			}
			await session.prompt(payload.text, {
				expandPromptTemplates: false,
				images: payload.images,
				streamingBehavior: item.kind,
			});
		}
		this.syncQueuedMessagesFromSession(session.getSteeringMessages(), session.getFollowUpMessages());
	}

	clearQueuedMessages(): { steering: string[]; followUp: string[] } {
		const cleared = this.runtime.session.clearQueue();
		this.queuedMessages = [];
		this.lastPendingAttachments.clear();
		this.emit({ type: "queue_changed", queuedMessages: [] });
		this.emitStatusChanged();
		return cleared;
	}

	async executeBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const trimmed = command.trim();
		if (trimmed.length === 0) return;

		const session = this.runtime.session;
		const toolCallId = `bash-${Date.now()}`;
		let streamedOutput = "";
		this.activeToolName = "bash";
		this.statusMessage = `Running: ! ${truncateText(trimmed, 40)}`;
		this.emitStatusChanged();
		this.emit({
			type: "tool_start",
			toolCallId,
			toolName: "bash",
			argsText: formatCompactToolArgs({ command: trimmed, excludeFromContext }),
		});

		const startedAt = Date.now();
		try {
			const result = await session.executeBash(
				trimmed,
				(chunk) => {
					streamedOutput += chunk;
					this.emit({
						type: "tool_update",
						toolCallId,
						toolName: "bash",
						argsText: formatCompactToolArgs({ command: trimmed }),
						outputText: extractToolOutputSnippet(streamedOutput),
					});
				},
				{ excludeFromContext, id: toolCallId },
			);
			const durationMs = Date.now() - startedAt;
			const isError = Boolean(result.cancelled || (result.exitCode !== undefined && result.exitCode !== 0));
			const outputText = extractToolOutputSnippet(result.output);
			this.transcript.push({
				id: toolCallId,
				role: "bash",
				text: trimmed,
				command: trimmed,
				outputText: result.output,
				exitCode: result.exitCode,
				isError,
				durationMs,
				timestamp: startedAt,
			});
			this.emit({
				type: "tool_end",
				toolCallId,
				toolName: "bash",
				outputText,
				isError,
				durationMs,
			});
			this.emit({
				type: "bash_result",
				command: trimmed,
				outputText: result.output,
				exitCode: result.exitCode,
				isError,
				durationMs,
			});
		} finally {
			this.activeToolName = undefined;
			this.statusMessage = session.isStreaming ? (this.workingMessage ?? "Streaming...") : undefined;
			this.emitStatusChanged();
			void this.refreshWorkspaceState();
		}
	}

	abortBash(): void {
		this.runtime.session.abortBash();
	}

	async abort(): Promise<void> {
		this.runtime.session.abortBash();
		await this.runtime.session.abort();
	}

	private async refreshSessionsList(includeAllProjects = true): Promise<GuiSessionListItem[]> {
		const session = this.runtime.session;
		const sessionDir = session.sessionManager.getSessionDir();
		const activeFile = session.sessionFile;
		const activeId = session.sessionId;
		const byPath = new Map<string, SessionInfo>();

		const [projectSessions, allSessions] = await Promise.all([
			SessionManager.list(this.currentCwd, sessionDir).catch((): SessionInfo[] => []),
			includeAllProjects ? SessionManager.listAll().catch((): SessionInfo[] => []) : Promise.resolve([] as SessionInfo[]),
		]);

		for (const list of [projectSessions, allSessions]) {
			for (const info of list) {
				if (!byPath.has(info.path)) {
					byPath.set(info.path, info);
				}
			}
		}

		const items: GuiSessionListItem[] = [];
		let activePresent = false;
		const pinnedSet = new Set(this.layout.pinnedSessionIds);

		for (const info of byPath.values()) {
			const isActive = Boolean((activeFile && info.path === activeFile) || info.id === activeId);
			if (isActive) activePresent = true;
			const itemCwd = info.cwd || this.currentCwd;
			items.push({
				id: info.id,
				sessionFile: info.path,
				cwd: itemCwd,
				workspaceName: getWorkspaceName(itemCwd),
				title: deriveSessionTitle(info, this.layout),
				createdAt: info.created.getTime(),
				updatedAt: info.modified.getTime(),
				messageCount: info.messageCount,
				pinned: pinnedSet.has(info.id),
				isActive,
				projectKey: itemCwd,
			});
		}

		if (!activePresent) {
			const now = Date.now();
			const firstUser = this.transcript.find((entry) => entry.role === "user");
			items.unshift({
				id: activeId,
				sessionFile: activeFile ?? `memory:${activeId}`,
				cwd: this.currentCwd,
				workspaceName: getWorkspaceName(this.currentCwd),
				title: deriveSessionTitle(
					{
						id: activeId,
						name: session.sessionName ?? session.sessionManager.getSessionName(),
						firstMessage: firstUser?.text ?? "",
					},
					this.layout,
				),
				createdAt: now,
				updatedAt: now,
				messageCount: this.transcript.filter((item) => item.role === "user" || item.role === "assistant").length,
				pinned: pinnedSet.has(activeId),
				isActive: true,
				projectKey: this.currentCwd,
			});
		}

		items.sort((a, b) => {
			if (Boolean(a.pinned) !== Boolean(b.pinned)) {
				return a.pinned ? -1 : 1;
			}
			return b.updatedAt - a.updatedAt;
		});

		this.sessions = items;
		this.emit({ type: "sessions_changed", sessions: this.sessions });
		return items;
	}

	async getSessions(filterAllProjects = false): Promise<readonly GuiSessionListItem[]> {
		return this.refreshSessionsList(!filterAllProjects ? true : true);
	}

	async newSession(): Promise<{ cancelled: boolean }> {
		this.nextSessionResetReason = "new";
		this.nextSessionActionReason = "new";
		return this.runtime.newSession();
	}

	async switchSession(sessionFile: string): Promise<{ cancelled: boolean }> {
		if (!sessionFile || sessionFile.startsWith("memory:")) {
			return { cancelled: true };
		}
		if (!existsSync(sessionFile)) {
			throw new Error(`Session file not found: ${sessionFile}`);
		}
		this.nextSessionResetReason = "new";
		this.nextSessionActionReason = "switch";
		return this.runtime.switchSession(sessionFile);
	}

	async forkSession(entryId?: string): Promise<{ cancelled: boolean; selectedText?: string }> {
		const session = this.runtime.session;
		const targetId = entryId ?? session.sessionManager.getLeafId();
		if (!targetId) {
			const res = await this.newSession();
			return { cancelled: res.cancelled };
		}
		this.nextSessionResetReason = "new";
		this.nextSessionActionReason = "fork";
		const position = entryId ? "at" : "at";
		return this.runtime.fork(targetId, { position });
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		const clean = title.trim();
		const nextNames = { ...this.layout.sessionCustomNames };
		if (clean.length === 0) {
			delete nextNames[sessionId];
		} else {
			nextNames[sessionId] = clean;
		}
		this.updateLayoutPreferences({ sessionCustomNames: nextNames });
		if (sessionId === this.runtime.session.sessionId && clean.length > 0) {
			this.runtime.session.setSessionName(clean);
		}
		await this.refreshSessionsList();
		this.emitStatusChanged();
	}

	async togglePinSession(sessionId: string): Promise<void> {
		const exists = this.layout.pinnedSessionIds.includes(sessionId);
		const pinnedSessionIds = exists
			? this.layout.pinnedSessionIds.filter((id) => id !== sessionId)
			: [...this.layout.pinnedSessionIds, sessionId];
		this.updateLayoutPreferences({ pinnedSessionIds });
		await this.refreshSessionsList();
	}

	async deleteSession(sessionFile: string): Promise<boolean> {
		if (!sessionFile || sessionFile.startsWith("memory:") || !sessionFile.endsWith(".jsonl")) {
			return false;
		}
		const activeFile = this.runtime.session.sessionFile;
		const deletingActive = activeFile === sessionFile;

		if (deletingActive) {
			const fallback = this.sessions.find(
				(item) => item.sessionFile !== sessionFile && !item.sessionFile.startsWith("memory:") && existsSync(item.sessionFile),
			);
			if (fallback) {
				await this.switchSession(fallback.sessionFile);
			} else {
				await this.newSession();
			}
		}

		if (existsSync(sessionFile)) {
			rmSync(sessionFile, { force: true });
		}

		this.historyStack = this.historyStack.filter((item) => item !== sessionFile);
		if (this.historyIndex >= this.historyStack.length) {
			this.historyIndex = this.historyStack.length - 1;
		}

		await this.refreshSessionsList();
		this.emitStatusChanged();
		return true;
	}

	canGoBack(): boolean {
		return this.historyIndex > 0;
	}

	canGoForward(): boolean {
		return this.historyIndex >= 0 && this.historyIndex < this.historyStack.length - 1;
	}

	async goBack(): Promise<boolean> {
		if (!this.canGoBack()) return false;
		const previousIndex = this.historyIndex;
		for (let idx = previousIndex - 1; idx >= 0; idx--) {
			const target = this.historyStack[idx];
			if (!target || target.startsWith("memory:") || !existsSync(target)) continue;
			this.historyIndex = idx;
			this.isNavigatingHistory = true;
			try {
				const res = await this.switchSession(target);
				if (res.cancelled) {
					this.historyIndex = previousIndex;
					return false;
				}
				this.emitStatusChanged();
				return true;
			} finally {
				this.isNavigatingHistory = false;
			}
		}
		return false;
	}

	async goForward(): Promise<boolean> {
		if (!this.canGoForward()) return false;
		const previousIndex = this.historyIndex;
		for (let idx = previousIndex + 1; idx < this.historyStack.length; idx++) {
			const target = this.historyStack[idx];
			if (!target || target.startsWith("memory:") || !existsSync(target)) continue;
			this.historyIndex = idx;
			this.isNavigatingHistory = true;
			try {
				const res = await this.switchSession(target);
				if (res.cancelled) {
					this.historyIndex = previousIndex;
					return false;
				}
				this.emitStatusChanged();
				return true;
			} finally {
				this.isNavigatingHistory = false;
			}
		}
		return false;
	}

	async refreshWorkspaceState(): Promise<void> {
		if (this.workspaceRefreshInFlight) {
			this.workspaceRefreshQueued = true;
			return;
		}
		this.workspaceRefreshInFlight = true;
		try {
			const cwd = this.currentCwd;
			const [gitSummary, files] = await Promise.all([getGitStatus(cwd), scanWorkspaceFiles(cwd)]);
			this.isGitRepo = gitSummary.isGitRepo;
			this.gitBranch = gitSummary.currentBranch;
			this.gitBranches = [...gitSummary.branches];
			this.changedFiles = [...gitSummary.changedFiles];
			this.workspaceFiles = files;
			this.openers = detectExternalOpeners();
			this.emit({
				type: "workspace_changed",
				changedFiles: this.changedFiles,
				workspaceFiles: this.workspaceFiles,
				status: this.getStatus(),
			});
			this.emitStatusChanged();
		} finally {
			this.workspaceRefreshInFlight = false;
			if (this.workspaceRefreshQueued) {
				this.workspaceRefreshQueued = false;
				await this.refreshWorkspaceState();
			}
		}
	}

	async checkoutBranch(branch: string): Promise<void> {
		await checkoutBranch(this.currentCwd, branch);
		await this.refreshWorkspaceState();
		this.pushToast(`Switched branch to ${branch}`, "info");
	}

	async createBranch(branch: string): Promise<void> {
		await createBranch(this.currentCwd, branch);
		await this.refreshWorkspaceState();
		this.pushToast(`Created branch ${branch}`, "info");
	}

	async commitChanges(message: string, paths?: readonly string[]): Promise<void> {
		await stageAndCommitChanges(this.currentCwd, message, paths);
		await this.refreshWorkspaceState();
		this.pushToast("Committed changes", "info");
	}

	async readWorkspaceFile(filePath: string): Promise<GuiWorkspaceFilePreview> {
		return readWorkspaceFilePreview(this.currentCwd, filePath);
	}

	getExternalOpeners(): readonly GuiExternalOpener[] {
		return [...this.openers];
	}

	async openInExternalApp(openerId: string, targetPath?: string): Promise<boolean> {
		return openWorkspaceInApp(openerId, targetPath ?? this.currentCwd);
	}

	getTreeEntries(): readonly GuiTreeEntryItem[] {
		return [...this.treeEntries];
	}

	async navigateTreeEntry(
		entryId: string,
		summarize = false,
	): Promise<{ cancelled: boolean; editorText?: string }> {
		const result = await this.runtime.session.navigateTree(entryId, { summarize });
		if (!result.cancelled) {
			this.rehydrateTranscriptAndTree();
			if (result.editorText) {
				this.setEditorText(result.editorText);
			}
			const snapshot = this.getSnapshot();
			this.emit({
				type: "session_reset",
				resetReason: "new",
				sessionActionReason: "tree",
				snapshot,
			});
			this.emit({ type: "snapshot", snapshot });
			this.emitStatusChanged();
		}
		return { cancelled: result.cancelled, editorText: result.editorText };
	}

	getContextUsage(): GuiContextUsage | undefined {
		const session = this.runtime.session;
		const ctx = session.getContextUsage();
		const totals = computeSessionUsageTotals(session);
		if (!ctx && totals.inputTokens === 0 && totals.outputTokens === 0) {
			return undefined;
		}
		return {
			usedTokens: ctx ? ctx.tokens : null,
			maxTokens: ctx ? ctx.contextWindow : 0,
			percent: ctx ? ctx.percent : null,
			inputTokens: totals.inputTokens,
			outputTokens: totals.outputTokens,
			cacheReadTokens: totals.cacheReadTokens,
			cacheWriteTokens: totals.cacheWriteTokens,
			totalCostUsd: totals.totalCostUsd,
			modelId: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
		};
	}

	async compactSession(customInstructions?: string): Promise<void> {
		await this.runtime.session.compact(customInstructions);
		this.rehydrateTranscriptAndTree();
		this.emit({ type: "snapshot", snapshot: this.getSnapshot() });
		this.emitStatusChanged();
	}

	updateLayoutPreferences(patch: Partial<GuiLayoutPreferences>): GuiLayoutPreferences {
		const next: GuiLayoutPreferences = {
			...this.layout,
			...patch,
			pinnedSessionIds: patch.pinnedSessionIds ? [...patch.pinnedSessionIds] : [...this.layout.pinnedSessionIds],
			sessionCustomNames: patch.sessionCustomNames
				? { ...patch.sessionCustomNames }
				: { ...this.layout.sessionCustomNames },
		};
		this.layout = next;
		if (this.persistLayout) {
			saveGuiLayoutPreferences(next, this.runtime.services.agentDir);
		}
		this.emit({ type: "layout_changed", layout: next });
		return next;
	}

	resolvePendingPrompt(promptId: string, value: unknown, cancelled = false): void {
		const cleanup = this.pendingPromptCleanup.get(promptId);
		if (cleanup) {
			cleanup(value, cancelled);
		}
	}

	dismissToast(toastId: string): void {
		const beforeLen = this.toasts.length;
		this.toasts = this.toasts.filter((item) => item.id !== toastId);
		if (this.toasts.length !== beforeLen) {
			this.emit({ type: "extension_ui", snapshot: this.getSnapshot() });
		}
	}

	getEditorText(): string {
		return this.editorText;
	}

	setEditorText(text: string): void {
		this.editorText = text;
		this.emit({ type: "editor_text", editorText: text });
	}

	clearMessages(): void {
		this.transcript = [];
		this.emit({ type: "session_reset", resetReason: "clear", sessionActionReason: "clear" });
	}

	subscribe(listener: GuiControllerListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const finish of [...this.pendingPromptCleanup.values()]) {
			finish(undefined, true);
		}
		this.pendingPromptCleanup.clear();
		if (this.unsubscribeSession) {
			this.unsubscribeSession();
			this.unsubscribeSession = undefined;
		}
		this.listeners.clear();
		await this.runtime.dispose();
	}

	private emitStatusChanged(): void {
		this.emit({ type: "status_changed", status: this.getStatus() });
	}

	private emit(event: GuiControllerEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

export interface MockGuiControllerOptions {
	readonly cwd?: string;
	readonly models?: readonly GuiModelSummary[];
	readonly stepDelayMs?: number;
	readonly scenario?: "default" | "with-tool" | "error";
	readonly responseChunks?: readonly string[];
	readonly thinkingText?: string;
}

const DEFAULT_MOCK_MODELS: readonly GuiModelSummary[] = [
	{
		provider: "anthropic",
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		reasoning: true,
		label: "anthropic/claude-sonnet-4-5",
		description: "Claude Sonnet 4.5 (reasoning)",
	},
	{
		provider: "openai",
		id: "gpt-4o",
		name: "GPT-4o",
		reasoning: false,
		label: "openai/gpt-4o",
		description: "GPT-4o (standard)",
	},
	{
		provider: "google",
		id: "gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		reasoning: true,
		label: "google/gemini-2.5-pro",
		description: "Gemini 2.5 Pro (reasoning)",
	},
];

interface MockSessionRecord {
	id: string;
	sessionFile: string;
	cwd: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	transcript: GuiTranscriptEntry[];
}

/**
 * Deterministic session controller for --headless-smoke, --native-smoke, and unit tests.
 */
export class MockGuiSessionController implements GuiSessionController {
	private readonly cwd: string;
	private readonly models: readonly GuiModelSummary[];
	private readonly stepDelayMs: number;
	private readonly scenario: "default" | "with-tool" | "error";
	private readonly responseChunks: readonly string[];
	private readonly thinkingText: string;
	private readonly listeners = new Set<GuiControllerListener>();

	private activeModel: GuiModelSummary | undefined;
	private thinkingLevel: ThinkingLevel = "medium";
	private isStreaming = false;
	private activeToolName: string | undefined;
	private statusMessage: string | undefined;
	private aborted = false;
	private messageSeq = 0;
	private abortResolvers: Array<() => void> = [];

	private activeSessionId = "mock-session-1";
	private readonly mockSessions = new Map<string, MockSessionRecord>();
	private historyStack: string[] = [];
	private historyIndex = 0;
	private gitBranch = "main";
	private gitBranches = ["main", "feat/gui"];
	private changedFiles: GuiChangedFile[] = [];
	private workspaceFiles: GuiWorkspaceFileEntry[] = [];
	private queuedMessages: GuiQueuedMessageItem[] = [];
	private pendingPrompts: GuiPendingPrompt[] = [];
	private widgets: GuiExtensionWidgetEntry[] = [];
	private statuses: GuiExtensionStatusEntry[] = [];
	private toasts: GuiToastEntry[] = [];
	private layout: GuiLayoutPreferences = getDefaultGuiLayoutPreferences();
	private editorText = "";
	private toolsExpanded = false;
	private windowTitle: string | undefined;

	constructor(options: MockGuiControllerOptions = {}) {
		this.cwd = options.cwd ?? process.cwd();
		this.models = options.models ?? DEFAULT_MOCK_MODELS;
		this.activeModel = this.models[0];
		this.stepDelayMs = options.stepDelayMs ?? 1;
		this.scenario = options.scenario ?? "default";
		this.responseChunks = options.responseChunks ?? [
			"## Summary\n\n",
			"I inspected the workspace and verified the **GUI** session flow.\n\n",
			"- Streaming tokens render smoothly\n- Controls stay responsive",
		];
		this.thinkingText = options.thinkingText ?? "Checking active workspace files and preparing response.";

		const now = Date.now();
		const initialFile = join(this.cwd, ".mock-sessions", "mock-session-1.jsonl");
		this.mockSessions.set(initialFile, {
			id: this.activeSessionId,
			sessionFile: initialFile,
			cwd: this.cwd,
			title: "New Session",
			createdAt: now,
			updatedAt: now,
			transcript: [],
		});
		this.historyStack = [initialFile];
		this.workspaceFiles = [
			{
				name: "package.json",
				path: join(this.cwd, "package.json"),
				relativePath: "package.json",
				isDir: false,
				depth: 0,
				sizeBytes: 512,
				language: "json",
			},
			{
				name: "src",
				path: join(this.cwd, "src"),
				relativePath: "src",
				isDir: true,
				depth: 0,
				expanded: true,
			},
		];
		this.changedFiles =
			this.scenario === "with-tool"
				? [
						{
							path: "package.json",
							status: "M",
							additions: 1,
							deletions: 0,
							hunks: [
								{ kind: "hunk", text: "@@ -1,2 +1,3 @@" },
								{ kind: "context", oldLine: 1, newLine: 1, text: "{" },
								{ kind: "add", newLine: 2, text: '  "private": true,' },
							],
						},
					]
				: [];
	}

	private get currentSessionRecord(): MockSessionRecord {
		for (const rec of this.mockSessions.values()) {
			if (rec.id === this.activeSessionId) return rec;
		}
		const fallback = this.mockSessions.values().next().value;
		if (fallback) return fallback;
		const created: MockSessionRecord = {
			id: this.activeSessionId,
			sessionFile: join(this.cwd, ".mock-sessions", `${this.activeSessionId}.jsonl`),
			cwd: this.cwd,
			title: "New Session",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			transcript: [],
		};
		this.mockSessions.set(created.sessionFile, created);
		return created;
	}

	getStatus(): GuiSessionStatus {
		const model = this.activeModel;
		const availableThinkingLevels: readonly ThinkingLevel[] =
			model && !model.reasoning ? ["off"] : STANDARD_THINKING_LEVELS;
		const current = this.currentSessionRecord;
		return {
			cwd: this.cwd,
			activeModel: model,
			thinkingLevel: availableThinkingLevels.includes(this.thinkingLevel) ? this.thinkingLevel : "off",
			availableThinkingLevels,
			isStreaming: this.isStreaming,
			activeToolName: this.activeToolName,
			statusMessage: this.statusMessage,
			authSummary: {
				statusLabel: model ? `${model.provider}: Configured (demo)` : "Demo mode",
				providerAuthCount: this.models.length,
				hasActiveAuth: true,
				activeAuthLabel: "Configured (demo)",
			},
			sessionId: current.id,
			sessionFile: current.sessionFile,
			sessionName: getSessionCustomName(this.layout.sessionCustomNames, current.id) ?? current.title,
			gitBranch: this.gitBranch,
			isGitRepo: true,
			contextUsage: this.getContextUsage(),
			pendingSteeringCount: this.queuedMessages.filter((q) => q.kind === "steer").length,
			pendingFollowUpCount: this.queuedMessages.filter((q) => q.kind === "followUp").length,
			canGoBack: this.canGoBack(),
			canGoForward: this.canGoForward(),
			toolsExpanded: this.toolsExpanded,
			windowTitle: this.windowTitle,
		};
	}

	getSnapshot(): GuiSessionSnapshot {
		return {
			status: this.getStatus(),
			transcript: [...this.currentSessionRecord.transcript],
			sessions: this.buildSessionListSync(),
			changedFiles: [...this.changedFiles],
			workspaceFiles: [...this.workspaceFiles],
			treeEntries: this.getTreeEntries(),
			gitBranch: this.gitBranch,
			gitBranches: [...this.gitBranches],
			isGitRepo: true,
			openers: [],
			queuedMessages: [...this.queuedMessages],
			pendingPrompts: [...this.pendingPrompts],
			widgets: [...this.widgets],
			statuses: [...this.statuses],
			toasts: [...this.toasts],
			layout: {
				...this.layout,
				pinnedSessionIds: [...this.layout.pinnedSessionIds],
				sessionCustomNames: { ...this.layout.sessionCustomNames },
			},
		};
	}

	getTranscript(): readonly GuiTranscriptEntry[] {
		return [...this.currentSessionRecord.transcript];
	}

	getAvailableModels(): readonly GuiModelSummary[] {
		return this.models;
	}

	async selectModel(provider: string, modelId: string): Promise<void> {
		const found = this.models.find((m) => m.provider === provider && m.id === modelId);
		if (!found) {
			throw new Error(`Mock model not found: ${provider}/${modelId}`);
		}
		this.activeModel = found;
		if (!found.reasoning) {
			this.thinkingLevel = "off";
		} else if (this.thinkingLevel === "off") {
			this.thinkingLevel = "medium";
		}
		this.emitStatusChanged();
	}

	setThinkingLevel(level: ThinkingLevel): void {
		const allowed = this.getStatus().availableThinkingLevels;
		this.thinkingLevel = allowed.includes(level) ? level : allowed[0] ?? "off";
		this.emitStatusChanged();
	}

	async sendUserMessage(text: string, options: GuiSendMessageOptions = {}): Promise<void> {
		const trimmed = text.trim();
		if (trimmed.length === 0 && (!options.attachments || options.attachments.length === 0)) return;
		if (trimmed.startsWith("!!")) {
			await this.executeBashCommand(trimmed.slice(2).trim(), true);
			return;
		}
		if (trimmed.startsWith("!")) {
			await this.executeBashCommand(trimmed.slice(1).trim(), false);
			return;
		}
		if (this.isStreaming) {
			const kind = options.deliverAs === "steer" ? "steer" : "followUp";
			this.queuedMessages.push({
				id: `mock-queue-${++this.messageSeq}`,
				kind,
				text: trimmed,
				attachments: options.attachments,
				createdAt: Date.now(),
			});
			this.emit({ type: "queue_changed", queuedMessages: [...this.queuedMessages] });
			this.emitStatusChanged();
			return;
		}
		await this.prompt(trimmed);
	}

	async steerMessage(text: string, attachments?: readonly GuiAttachmentItem[]): Promise<void> {
		await this.sendUserMessage(text, { attachments, deliverAs: "steer" });
	}

	removeQueuedMessage(id: string): void {
		this.queuedMessages = this.queuedMessages.filter((item) => item.id !== id);
		this.emit({ type: "queue_changed", queuedMessages: [...this.queuedMessages] });
		this.emitStatusChanged();
	}

	clearQueuedMessages(): { steering: string[]; followUp: string[] } {
		const steering = this.queuedMessages.filter((item) => item.kind === "steer").map((item) => item.text);
		const followUp = this.queuedMessages.filter((item) => item.kind === "followUp").map((item) => item.text);
		this.queuedMessages = [];
		this.emit({ type: "queue_changed", queuedMessages: [] });
		this.emitStatusChanged();
		return { steering, followUp };
	}

	async executeBashCommand(command: string, _excludeFromContext = false): Promise<void> {
		const clean = command.trim();
		if (clean.length === 0) return;
		const toolCallId = `mock-bash-${++this.messageSeq}`;
		const outputText = `Mock bash output for: ${clean}`;
		this.currentSessionRecord.transcript.push({
			id: toolCallId,
			role: "bash",
			text: clean,
			command: clean,
			outputText,
			exitCode: 0,
			isError: false,
			durationMs: 10,
			timestamp: Date.now(),
		});
		this.emit({ type: "tool_start", toolCallId, toolName: "bash", argsText: formatCompactToolArgs({ command: clean }) });
		this.emit({ type: "tool_end", toolCallId, toolName: "bash", outputText, isError: false, durationMs: 10 });
		this.emit({ type: "bash_result", command: clean, outputText, exitCode: 0, isError: false, durationMs: 10 });
	}

	abortBash(): void {}

	async prompt(text: string): Promise<void> {
		const trimmed = text.trim();
		if (trimmed.length === 0) return;

		this.aborted = false;
		const rec = this.currentSessionRecord;
		if (rec.title === "New Session") {
			rec.title = truncateText(trimmed, 60);
		}
		rec.updatedAt = Date.now();
		rec.transcript.push({
			id: `mock-user-${++this.messageSeq}`,
			role: "user",
			text: trimmed,
			timestamp: rec.updatedAt,
		});
		this.emit({ type: "user_message", text: trimmed });

		this.isStreaming = true;
		this.activeToolName = undefined;
		this.statusMessage = "Streaming...";
		this.emitStatusChanged();

		this.messageSeq += 1;
		const messageId = `assistant-${this.messageSeq}`;
		const assistantIdx = rec.transcript.length;
		rec.transcript.push({
			id: messageId,
			role: "assistant",
			text: "",
			timestamp: Date.now(),
		});
		this.emit({ type: "assistant_start", messageId, text: "", thinking: "" });

		try {
			if (this.scenario === "error" || trimmed.startsWith("__error__")) {
				await this.waitStep();
				const errorMessage = "Mock provider error: upstream request failed.";
				rec.transcript[assistantIdx] = {
					id: messageId,
					role: "assistant",
					text: "",
					stopReason: "error",
					errorMessage,
					timestamp: Date.now(),
				};
				this.emit({
					type: "assistant_end",
					messageId,
					text: "",
					thinking: "",
					stopReason: "error",
					errorMessage,
				});
				return;
			}

			let thinkingSoFar = "";
			if (this.thinkingLevel !== "off" && this.thinkingText.length > 0) {
				thinkingSoFar = this.thinkingText;
				this.emit({ type: "assistant_update", messageId, text: "", thinking: thinkingSoFar });
				await this.waitStep();
				if (this.aborted) {
					this.emitAbortedEnd(messageId, "", thinkingSoFar);
					return;
				}
			}

			if (this.scenario === "with-tool" || trimmed.toLowerCase().includes("[tool]")) {
				const toolCallId = `tool-${this.messageSeq}`;
				this.activeToolName = "read";
				this.statusMessage = "Tool: read";
				this.emitStatusChanged();
				this.emit({
					type: "tool_start",
					toolCallId,
					toolName: "read",
					argsText: 'path: "package.json"',
				});
				await this.waitStep();
				if (this.aborted) {
					this.emit({
						type: "tool_end",
						toolCallId,
						toolName: "read",
						outputText: "Aborted",
						isError: true,
						durationMs: 12,
					});
					this.emitAbortedEnd(messageId, "", thinkingSoFar);
					return;
				}
				this.emit({
					type: "tool_update",
					toolCallId,
					toolName: "read",
					argsText: 'path: "package.json"',
					outputText: '{\n  "name": "pi-native"',
				});
				await this.waitStep();
				this.emit({
					type: "tool_end",
					toolCallId,
					toolName: "read",
					outputText: '{\n  "name": "pi-native",\n  "private": true\n}',
					isError: false,
					durationMs: 18,
				});
				this.activeToolName = undefined;
				this.statusMessage = "Streaming...";
				this.emitStatusChanged();
			}

			let textSoFar = "";
			for (const chunk of this.responseChunks) {
				if (this.aborted) {
					this.emitAbortedEnd(messageId, textSoFar, thinkingSoFar);
					return;
				}
				textSoFar += chunk;
				this.emit({
					type: "assistant_update",
					messageId,
					text: textSoFar,
					thinking: thinkingSoFar,
				});
				await this.waitStep();
			}

			if (this.aborted) {
				this.emitAbortedEnd(messageId, textSoFar, thinkingSoFar);
				return;
			}

			rec.transcript[assistantIdx] = {
				id: messageId,
				role: "assistant",
				text: textSoFar,
				thinking: thinkingSoFar || undefined,
				stopReason: "stop",
				timestamp: Date.now(),
			};

			this.emit({
				type: "assistant_end",
				messageId,
				text: textSoFar,
				thinking: thinkingSoFar,
				stopReason: "stop",
			});
		} finally {
			this.isStreaming = false;
			this.activeToolName = undefined;
			this.statusMessage = undefined;
			this.emitStatusChanged();
		}
	}

	async abort(): Promise<void> {
		this.aborted = true;
		const resolvers = this.abortResolvers.splice(0, this.abortResolvers.length);
		for (const resolve of resolvers) {
			resolve();
		}
	}

	private buildSessionListSync(): GuiSessionListItem[] {
		const pinnedSet = new Set(this.layout.pinnedSessionIds);
		const items: GuiSessionListItem[] = [];
		for (const rec of this.mockSessions.values()) {
			items.push({
				id: rec.id,
				sessionFile: rec.sessionFile,
				cwd: rec.cwd,
				workspaceName: getWorkspaceName(rec.cwd),
				title: getSessionCustomName(this.layout.sessionCustomNames, rec.id) ?? rec.title,
				createdAt: rec.createdAt,
				updatedAt: rec.updatedAt,
				messageCount: rec.transcript.length,
				pinned: pinnedSet.has(rec.id),
				isActive: rec.id === this.activeSessionId,
				projectKey: rec.cwd,
			});
		}
		return items.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async getSessions(): Promise<readonly GuiSessionListItem[]> {
		return this.buildSessionListSync();
	}

	async newSession(): Promise<{ cancelled: boolean }> {
		await this.abort();
		const nextNum = this.mockSessions.size + 1;
		const nextId = `mock-session-${nextNum}`;
		const nextFile = join(this.cwd, ".mock-sessions", `${nextId}.jsonl`);
		const now = Date.now();
		this.mockSessions.set(nextFile, {
			id: nextId,
			sessionFile: nextFile,
			cwd: this.cwd,
			title: "New Session",
			createdAt: now,
			updatedAt: now,
			transcript: [],
		});
		this.activeSessionId = nextId;
		this.historyStack = [...this.historyStack.slice(0, this.historyIndex + 1), nextFile];
		this.historyIndex = this.historyStack.length - 1;
		this.emit({ type: "session_reset", resetReason: "new", sessionActionReason: "new", snapshot: this.getSnapshot() });
		this.emitStatusChanged();
		return { cancelled: false };
	}

	async switchSession(sessionFile: string): Promise<{ cancelled: boolean }> {
		const rec = this.mockSessions.get(sessionFile);
		if (!rec) return { cancelled: true };
		await this.abort();
		this.activeSessionId = rec.id;
		this.historyStack = [...this.historyStack.slice(0, this.historyIndex + 1), sessionFile];
		this.historyIndex = this.historyStack.length - 1;
		this.emit({
			type: "session_reset",
			resetReason: "new",
			sessionActionReason: "switch",
			snapshot: this.getSnapshot(),
		});
		this.emitStatusChanged();
		return { cancelled: false };
	}

	async forkSession(): Promise<{ cancelled: boolean; selectedText?: string }> {
		const source = this.currentSessionRecord;
		const nextNum = this.mockSessions.size + 1;
		const nextId = `mock-session-${nextNum}`;
		const nextFile = join(this.cwd, ".mock-sessions", `${nextId}.jsonl`);
		const now = Date.now();
		this.mockSessions.set(nextFile, {
			id: nextId,
			sessionFile: nextFile,
			cwd: this.cwd,
			title: `${source.title} (fork)`,
			createdAt: now,
			updatedAt: now,
			transcript: [...source.transcript],
		});
		this.activeSessionId = nextId;
		this.emit({
			type: "session_reset",
			resetReason: "new",
			sessionActionReason: "fork",
			snapshot: this.getSnapshot(),
		});
		this.emitStatusChanged();
		return { cancelled: false };
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		const nextNames = { ...this.layout.sessionCustomNames, [sessionId]: title.trim() };
		this.updateLayoutPreferences({ sessionCustomNames: nextNames });
		this.emit({ type: "sessions_changed", sessions: this.buildSessionListSync() });
		this.emitStatusChanged();
	}

	async togglePinSession(sessionId: string): Promise<void> {
		const exists = this.layout.pinnedSessionIds.includes(sessionId);
		const pinnedSessionIds = exists
			? this.layout.pinnedSessionIds.filter((id) => id !== sessionId)
			: [...this.layout.pinnedSessionIds, sessionId];
		this.updateLayoutPreferences({ pinnedSessionIds });
		this.emit({ type: "sessions_changed", sessions: this.buildSessionListSync() });
	}

	async deleteSession(sessionFile: string): Promise<boolean> {
		if (!this.mockSessions.has(sessionFile)) return false;
		const isCurrent = this.currentSessionRecord.sessionFile === sessionFile;
		this.mockSessions.delete(sessionFile);
		if (isCurrent) {
			await this.newSession();
		}
		this.emit({ type: "sessions_changed", sessions: this.buildSessionListSync() });
		return true;
	}

	canGoBack(): boolean {
		return this.historyIndex > 0;
	}

	canGoForward(): boolean {
		return this.historyIndex >= 0 && this.historyIndex < this.historyStack.length - 1;
	}

	async goBack(): Promise<boolean> {
		if (!this.canGoBack()) return false;
		this.historyIndex -= 1;
		const target = this.historyStack[this.historyIndex];
		const rec = target ? this.mockSessions.get(target) : undefined;
		if (!rec) return false;
		this.activeSessionId = rec.id;
		this.emit({ type: "session_reset", resetReason: "new", sessionActionReason: "switch", snapshot: this.getSnapshot() });
		this.emitStatusChanged();
		return true;
	}

	async goForward(): Promise<boolean> {
		if (!this.canGoForward()) return false;
		this.historyIndex += 1;
		const target = this.historyStack[this.historyIndex];
		const rec = target ? this.mockSessions.get(target) : undefined;
		if (!rec) return false;
		this.activeSessionId = rec.id;
		this.emit({ type: "session_reset", resetReason: "new", sessionActionReason: "switch", snapshot: this.getSnapshot() });
		this.emitStatusChanged();
		return true;
	}

	async refreshWorkspaceState(): Promise<void> {
		this.emit({
			type: "workspace_changed",
			changedFiles: [...this.changedFiles],
			workspaceFiles: [...this.workspaceFiles],
			status: this.getStatus(),
		});
	}

	async checkoutBranch(branch: string): Promise<void> {
		if (!this.gitBranches.includes(branch)) {
			throw new Error(`Unknown branch: ${branch}`);
		}
		this.gitBranch = branch;
		this.emitStatusChanged();
	}

	async createBranch(branch: string): Promise<void> {
		if (!this.gitBranches.includes(branch)) {
			this.gitBranches.push(branch);
		}
		this.gitBranch = branch;
		this.emitStatusChanged();
	}

	async commitChanges(_message: string, _paths?: readonly string[]): Promise<void> {
		this.changedFiles = [];
		await this.refreshWorkspaceState();
	}

	async readWorkspaceFile(filePath: string): Promise<GuiWorkspaceFilePreview> {
		return {
			path: filePath,
			relativePath: basename(filePath),
			isBinary: false,
			truncated: false,
			lineCount: 1,
			language: "json",
			content: '{ "name": "pi-native" }',
		};
	}

	getExternalOpeners(): readonly GuiExternalOpener[] {
		return [];
	}

	async openInExternalApp(_openerId: string, _targetPath?: string): Promise<boolean> {
		return false;
	}

	getTreeEntries(): readonly GuiTreeEntryItem[] {
		const entries = this.currentSessionRecord.transcript;
		return entries.map((item, idx) => ({
			id: item.id,
			parentId: idx > 0 ? entries[idx - 1]?.id : undefined,
			kind: item.role,
			label: item.role,
			summary: truncateText(item.text || item.toolName || item.role, 72),
			isCurrent: idx === entries.length - 1,
			depth: idx,
		}));
	}

	async navigateTreeEntry(
		entryId: string,
		_summarize = false,
	): Promise<{ cancelled: boolean; editorText?: string }> {
		const rec = this.currentSessionRecord;
		const idx = rec.transcript.findIndex((item) => item.id === entryId);
		if (idx < 0) return { cancelled: true };
		rec.transcript = rec.transcript.slice(0, idx + 1);
		this.emit({ type: "session_reset", resetReason: "new", sessionActionReason: "tree", snapshot: this.getSnapshot() });
		return { cancelled: false };
	}

	getContextUsage(): GuiContextUsage {
		const tokenEstimate = this.currentSessionRecord.transcript.reduce(
			(sum, entry) => sum + Math.max(1, Math.ceil(entry.text.length / 4)),
			0,
		);
		const maxTokens = 200_000;
		return {
			usedTokens: tokenEstimate,
			maxTokens,
			percent: (tokenEstimate / maxTokens) * 100,
			inputTokens: tokenEstimate,
			outputTokens: Math.floor(tokenEstimate / 2),
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCostUsd: 0,
			modelId: this.activeModel?.label,
		};
	}

	async compactSession(): Promise<void> {
		this.currentSessionRecord.transcript.push({
			id: `mock-compact-${++this.messageSeq}`,
			role: "compaction",
			text: "Mock conversation compacted.",
			timestamp: Date.now(),
		});
		this.emit({ type: "snapshot", snapshot: this.getSnapshot() });
	}

	updateLayoutPreferences(patch: Partial<GuiLayoutPreferences>): GuiLayoutPreferences {
		this.layout = {
			...this.layout,
			...patch,
			pinnedSessionIds: patch.pinnedSessionIds ? [...patch.pinnedSessionIds] : [...this.layout.pinnedSessionIds],
			sessionCustomNames: patch.sessionCustomNames
				? { ...patch.sessionCustomNames }
				: { ...this.layout.sessionCustomNames },
		};
		this.emit({ type: "layout_changed", layout: this.layout });
		return this.layout;
	}

	resolvePendingPrompt(promptId: string, value: unknown, cancelled = false): void {
		const idx = this.pendingPrompts.findIndex((item) => item.id === promptId);
		if (idx < 0) return;
		const [prompt] = this.pendingPrompts.splice(idx, 1);
		if (prompt?.resolve) {
			prompt.resolve(cancelled ? undefined : value);
		}
		this.emit({ type: "extension_ui", snapshot: this.getSnapshot() });
	}

	dismissToast(toastId: string): void {
		this.toasts = this.toasts.filter((item) => item.id !== toastId);
		this.emit({ type: "extension_ui", snapshot: this.getSnapshot() });
	}

	getEditorText(): string {
		return this.editorText;
	}

	setEditorText(text: string): void {
		this.editorText = text;
		this.emit({ type: "editor_text", editorText: text });
	}

	clearMessages(): void {
		this.currentSessionRecord.transcript = [];
		this.emit({ type: "session_reset", resetReason: "clear", sessionActionReason: "clear" });
	}

	subscribe(listener: GuiControllerListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async dispose(): Promise<void> {
		await this.abort();
		this.listeners.clear();
	}

	private emitAbortedEnd(messageId: string, text: string, thinking: string): void {
		this.emit({
			type: "assistant_end",
			messageId,
			text,
			thinking,
			stopReason: "aborted",
			errorMessage: "Generation stopped.",
		});
	}

	private waitStep(): Promise<void> {
		if (this.aborted) return Promise.resolve();
		if (this.stepDelayMs <= 0) return Promise.resolve();
		return new Promise((resolve) => {
			let settled = false;
			const done = () => {
				if (settled) return;
				settled = true;
				resolve();
			};
			this.abortResolvers.push(done);
			setTimeout(() => {
				const idx = this.abortResolvers.indexOf(done);
				if (idx >= 0) this.abortResolvers.splice(idx, 1);
				done();
			}, this.stepDelayMs);
		});
	}

	private emitStatusChanged(): void {
		this.emit({ type: "status_changed", status: this.getStatus() });
	}

	private emit(event: GuiControllerEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
