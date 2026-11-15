import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { GuiTheme } from "scriptc-ui";

/**
 * Compact summary of an available model exposed to the GUI model picker and header.
 */
export interface GuiModelSummary {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly reasoning: boolean;
	readonly label: string;
	readonly description: string;
}

/**
 * Safe authentication status summary derived from ModelRuntime without exposing credentials.
 */
export interface GuiAuthSummary {
	readonly statusLabel: string;
	readonly providerAuthCount: number;
	readonly hasActiveAuth: boolean;
	readonly activeAuthLabel: string;
}

/**
 * Snapshot of the active session state rendered in the GUI header and welcome card.
 */
export interface GuiSessionStatus {
	readonly cwd: string;
	readonly activeModel?: GuiModelSummary;
	readonly thinkingLevel: ThinkingLevel;
	readonly availableThinkingLevels: readonly ThinkingLevel[];
	readonly isStreaming: boolean;
	readonly activeToolName?: string;
	readonly statusMessage?: string;
	readonly authSummary: GuiAuthSummary;
	readonly modelFallbackMessage?: string;
}

export type GuiControllerEventType =
	| "status_changed"
	| "user_message"
	| "assistant_start"
	| "assistant_update"
	| "assistant_end"
	| "tool_start"
	| "tool_update"
	| "tool_end"
	| "error"
	| "session_reset";

/**
 * Flat controller event consumed by the GUI viewport and header state updater.
 */
export interface GuiControllerEvent {
	readonly type: GuiControllerEventType;
	readonly status?: GuiSessionStatus;
	readonly messageId?: string;
	readonly text?: string;
	readonly thinking?: string;
	readonly stopReason?: string;
	readonly errorMessage?: string;
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly argsText?: string;
	readonly outputText?: string;
	readonly isError?: boolean;
	readonly durationMs?: number;
	readonly resetReason?: "new" | "clear";
}

export type GuiControllerListener = (event: GuiControllerEvent) => void;

/**
 * Backend-agnostic session controller contract used by both the live AgentSession runtime
 * and deterministic headless/smoke test controllers.
 */
export interface GuiSessionController {
	getStatus(): GuiSessionStatus;
	getAvailableModels(): readonly GuiModelSummary[];
	selectModel(provider: string, modelId: string): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	newSession(): Promise<{ cancelled: boolean }>;
	clearMessages(): void;
	subscribe(listener: GuiControllerListener): () => void;
	dispose(): Promise<void>;
}

export type GuiThemePreference = "dark" | "light";

/**
 * CLI arguments parsed by gui-cli.ts.
 */
export interface GuiCliArgs {
	readonly headlessSmoke: boolean;
	readonly nativeSmoke: boolean;
	readonly cwd: string;
	readonly provider?: string;
	readonly model?: string;
	readonly prompt?: string;
	readonly help: boolean;
}

/**
 * Configuration passed when mounting the Pi GUI application onto a GuiApp instance.
 */
export interface PiGuiOptions {
	readonly controller: GuiSessionController;
	readonly initialTheme?: GuiThemePreference | GuiTheme;
	readonly autoScroll?: boolean;
	readonly initialPrompt?: string;
	readonly onRequestQuit?: () => void;
}
