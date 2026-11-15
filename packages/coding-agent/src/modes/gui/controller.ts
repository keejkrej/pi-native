import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "../../config.ts";
import { type AgentSession, type AgentSessionEvent } from "../../core/agent-session.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "../../core/agent-session-runtime.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../../core/agent-session-services.ts";
import { applyHttpProxySettings, configureHttpDispatcher } from "../../core/http-dispatcher.ts";
import { resolveCliModel } from "../../core/model-resolver.ts";
import { SessionManager } from "../../core/session-manager.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { getTextOutput } from "../../core/tools/render-utils.ts";
import type {
	GuiAuthSummary,
	GuiControllerEvent,
	GuiControllerListener,
	GuiModelSummary,
	GuiSessionController,
	GuiSessionStatus,
} from "./types.ts";

const STANDARD_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "low", "medium", "high"];
const MAX_ARGS_LEN = 140;
const MAX_OUTPUT_LEN = 600;
const MAX_OUTPUT_LINES = 10;

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

export interface RealGuiControllerOptions {
	readonly cwd: string;
	readonly provider?: string;
	readonly model?: string;
}

/**
 * Create a live GUI controller backed by AgentSessionRuntime and ~/.pi/agent/auth.json.
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

	const controller = new RealGuiSessionController(runtime, cwd);
	await controller.bindCurrentSession();
	return controller;
}

class RealGuiSessionController implements GuiSessionController {
	private readonly runtime: AgentSessionRuntime;
	private readonly cwd: string;
	private readonly listeners = new Set<GuiControllerListener>();
	private unsubscribeSession: (() => void) | undefined;
	private activeAssistantMessageId = 0;
	private activeAssistantOpen = false;
	private activeToolName: string | undefined;
	private statusMessage: string | undefined;

	constructor(runtime: AgentSessionRuntime, cwd: string) {
		this.runtime = runtime;
		this.cwd = cwd;
		this.runtime.setRebindSession(async () => {
			await this.bindCurrentSession();
			this.emit({ type: "session_reset", resetReason: "new" });
			this.emitStatusChanged();
		});
	}

	async bindCurrentSession(): Promise<void> {
		this.unsubscribeSession?.();
		this.unsubscribeSession = undefined;
		this.activeAssistantOpen = false;
		this.activeToolName = undefined;
		this.statusMessage = undefined;

		const session = this.runtime.session;
		await session.bindExtensions({
			mode: "print",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (opts) => this.runtime.newSession(opts),
				fork: async (entryId, opts) => {
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
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, opts) => this.runtime.switchSession(sessionPath, opts),
				reload: async () => {
					await session.reload();
				},
			},
			onError: (err) => {
				this.emit({
					type: "error",
					errorMessage: `Extension error (${err.extensionPath}): ${err.error}`,
				});
			},
		});

		this.unsubscribeSession = session.subscribe((event) => {
			this.handleSessionEvent(session, event);
		});
	}

	private handleSessionEvent(session: AgentSession, event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				this.activeToolName = undefined;
				this.statusMessage = "Streaming...";
				this.emitStatusChanged();
				break;

			case "agent_end":
				if (!event.willRetry) {
					this.activeToolName = undefined;
					this.statusMessage = undefined;
					this.emitStatusChanged();
				}
				break;

			case "agent_settled":
				this.activeToolName = undefined;
				this.statusMessage = undefined;
				this.emitStatusChanged();
				break;

			case "message_start": {
				if (event.message.role === "user") {
					const text = extractUserText(event.message);
					if (text.length > 0) {
						this.emit({ type: "user_message", text });
					}
				} else if (event.message.role === "assistant") {
					this.activeAssistantMessageId += 1;
					this.activeAssistantOpen = true;
					const content = extractAssistantContent(event.message);
					this.emit({
						type: "assistant_start",
						messageId: `assistant-${this.activeAssistantMessageId}`,
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
						this.emit({
							type: "assistant_start",
							messageId: `assistant-${this.activeAssistantMessageId}`,
						});
					}
					const content = extractAssistantContent(event.message);
					this.emit({
						type: "assistant_update",
						messageId: `assistant-${this.activeAssistantMessageId}`,
						text: content.text,
						thinking: content.thinking,
					});
				}
				break;
			}

			case "message_end": {
				if (event.message.role === "assistant" && this.activeAssistantOpen) {
					const content = extractAssistantContent(event.message);
					this.activeAssistantOpen = false;
					this.emit({
						type: "assistant_end",
						messageId: `assistant-${this.activeAssistantMessageId}`,
						text: content.text,
						thinking: content.thinking,
						stopReason: content.stopReason,
						errorMessage: content.errorMessage,
					});
				}
				break;
			}

			case "tool_execution_start":
				this.activeToolName = event.toolName;
				this.statusMessage = `Tool: ${event.toolName}`;
				this.emitStatusChanged();
				this.emit({
					type: "tool_start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					argsText: formatCompactToolArgs(event.args),
				});
				break;

			case "tool_execution_update":
				this.emit({
					type: "tool_update",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					argsText: formatCompactToolArgs(event.args),
					outputText: extractToolOutputSnippet(event.partialResult),
				});
				break;

			case "tool_execution_end":
				if (this.activeToolName === event.toolName) {
					this.activeToolName = undefined;
					this.statusMessage = session.isStreaming ? "Streaming..." : undefined;
					this.emitStatusChanged();
				}
				this.emit({
					type: "tool_end",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					outputText: extractToolOutputSnippet(event.result),
					isError: event.isError,
					durationMs: event.durationMs,
				});
				break;

			case "thinking_level_changed":
				this.emitStatusChanged();
				break;

			case "auto_retry_start":
				this.statusMessage = `Retrying (${event.attempt}/${event.maxAttempts})...`;
				this.emitStatusChanged();
				break;

			case "auto_retry_end":
				this.statusMessage = event.success ? "Streaming..." : undefined;
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
				this.statusMessage = session.isStreaming ? "Streaming..." : undefined;
				this.emitStatusChanged();
				break;
		}
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

		return {
			cwd: this.cwd,
			activeModel: activeModel ? toGuiModelSummary(activeModel) : undefined,
			thinkingLevel: session.thinkingLevel,
			availableThinkingLevels: normalizeThinkingOptions(session.getAvailableThinkingLevels()),
			isStreaming: session.isStreaming,
			activeToolName: this.activeToolName,
			statusMessage: this.statusMessage,
			authSummary,
			modelFallbackMessage: this.runtime.modelFallbackMessage,
		};
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
		const trimmed = text.trim();
		if (trimmed.length === 0) return;
		const session = this.runtime.session;
		if (session.isStreaming) {
			await session.prompt(trimmed, { streamingBehavior: "followUp" });
		} else {
			await session.prompt(trimmed);
		}
	}

	async abort(): Promise<void> {
		await this.runtime.session.abort();
	}

	async newSession(): Promise<{ cancelled: boolean }> {
		return this.runtime.newSession();
	}

	clearMessages(): void {
		this.emit({ type: "session_reset", resetReason: "clear" });
	}

	subscribe(listener: GuiControllerListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async dispose(): Promise<void> {
		this.unsubscribeSession?.();
		this.unsubscribeSession = undefined;
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
	}

	getStatus(): GuiSessionStatus {
		const model = this.activeModel;
		const availableThinkingLevels: readonly ThinkingLevel[] =
			model && !model.reasoning ? ["off"] : STANDARD_THINKING_LEVELS;
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
		};
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

	async prompt(text: string): Promise<void> {
		const trimmed = text.trim();
		if (trimmed.length === 0) return;

		this.aborted = false;
		this.emit({ type: "user_message", text: trimmed });

		this.isStreaming = true;
		this.activeToolName = undefined;
		this.statusMessage = "Streaming...";
		this.emitStatusChanged();

		this.messageSeq += 1;
		const messageId = `assistant-${this.messageSeq}`;
		this.emit({ type: "assistant_start", messageId, text: "", thinking: "" });

		try {
			if (this.scenario === "error" || trimmed.startsWith("__error__")) {
				await this.waitStep();
				this.emit({
					type: "assistant_end",
					messageId,
					text: "",
					thinking: "",
					stopReason: "error",
					errorMessage: "Mock provider error: upstream request failed.",
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

	async newSession(): Promise<{ cancelled: boolean }> {
		await this.abort();
		this.emit({ type: "session_reset", resetReason: "new" });
		this.emitStatusChanged();
		return { cancelled: false };
	}

	clearMessages(): void {
		this.emit({ type: "session_reset", resetReason: "clear" });
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
