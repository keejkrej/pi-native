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
 * Token, cost, and context-window usage snapshot for the active session.
 */
export interface GuiContextUsage {
	readonly usedTokens: number | null;
	readonly maxTokens: number;
	readonly percent: number | null;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly totalCostUsd?: number;
	readonly modelId?: string;
}

/**
 * Snapshot of the active session state rendered in the GUI header, chrome, and welcome card.
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
	readonly sessionId?: string;
	readonly sessionFile?: string;
	readonly sessionName?: string;
	readonly gitBranch?: string;
	readonly isGitRepo?: boolean;
	readonly contextUsage?: GuiContextUsage;
	readonly pendingSteeringCount?: number;
	readonly pendingFollowUpCount?: number;
	readonly canGoBack?: boolean;
	readonly canGoForward?: boolean;
	readonly workingMessage?: string;
	readonly workingVisible?: boolean;
	readonly toolsExpanded?: boolean;
	readonly windowTitle?: string;
}

/**
 * Sidebar session list entry persisted in ~/.pi/agent/sessions.
 */
export interface GuiSessionListItem {
	readonly id: string;
	readonly sessionFile: string;
	readonly cwd: string;
	readonly workspaceName: string;
	readonly title: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly messageCount: number;
	readonly pinned?: boolean;
	readonly isActive?: boolean;
	readonly projectKey?: string;
}

/**
 * Composer attachment item (image, workspace/file reference, or large pasted text block).
 */
export interface GuiAttachmentItem {
	readonly id: string;
	readonly kind: "image" | "file" | "pasted-text";
	readonly name: string;
	readonly mimeType?: string;
	readonly sizeBytes?: number;
	readonly path?: string;
	readonly base64Data?: string;
	readonly textContent?: string;
	readonly previewRgba?: Uint8Array;
	readonly previewWidth?: number;
	readonly previewHeight?: number;
}

/**
 * Parsed unified diff line inside a changed file hunk.
 */
export interface GuiDiffLine {
	readonly kind: "context" | "add" | "del" | "hunk";
	readonly oldLine?: number;
	readonly newLine?: number;
	readonly text: string;
}

/**
 * Git working tree or staged change summary with parsed hunks.
 */
export interface GuiChangedFile {
	readonly path: string;
	readonly status: "M" | "A" | "D" | "R" | "U";
	readonly additions: number;
	readonly deletions: number;
	readonly staged?: boolean;
	readonly hunks: readonly GuiDiffLine[];
	readonly rawDiff?: string;
}

/**
 * Workspace directory/file entry rendered in the right-panel Files browser.
 */
export interface GuiWorkspaceFileEntry {
	readonly name: string;
	readonly path: string;
	readonly relativePath: string;
	readonly isDir: boolean;
	readonly depth: number;
	readonly expanded?: boolean;
	readonly sizeBytes?: number;
	readonly language?: string;
}

/**
 * Flattened session tree entry for branch navigation in the Tree tab.
 */
export interface GuiTreeEntryItem {
	readonly id: string;
	readonly parentId?: string;
	readonly kind: string;
	readonly label: string;
	readonly summary: string;
	readonly isCurrent: boolean;
	readonly depth: number;
	readonly timestamp?: string;
}

/**
 * Interactive prompt requested by extensions (confirm, select, input, editor).
 */
export interface GuiPendingPrompt {
	readonly id: string;
	readonly kind: "confirm" | "select" | "input" | "editor";
	readonly title: string;
	readonly message: string;
	readonly options?: readonly string[];
	readonly defaultValue?: string;
	readonly resolve?: (value: unknown) => void;
}

/**
 * Extension status widget rendered above or below the composer.
 */
export interface GuiExtensionWidgetEntry {
	readonly key: string;
	readonly placement?: "aboveEditor" | "belowEditor";
	readonly lines: readonly string[];
}

/**
 * Extension status bar pill rendered in the GUI chrome/footer.
 */
export interface GuiExtensionStatusEntry {
	readonly key: string;
	readonly text: string;
}

/**
 * Transient notification toast surfaced by extension notify() or controller actions.
 */
export interface GuiToastEntry {
	readonly id: string;
	readonly message: string;
	readonly level: "info" | "warning" | "error";
	readonly createdAt: number;
}

/**
 * Persistent Waku desktop layout and appearance preferences stored in ~/.pi/agent/gui-layout.json.
 */
export interface GuiLayoutPreferences {
	sidebarWidth: number;
	sidebarCollapsed: boolean;
	rightPanelWidth: number;
	rightPanelOpen: boolean;
	rightPanelTab: "changes" | "files" | "tree";
	diffViewMode: "unified" | "split";
	sidebarGroupBy: "updated" | "project";
	appearance: "system" | "dark" | "light";
	pinnedSessionIds: string[];
	sessionCustomNames: Record<string, string>;
}

/**
 * Hydrated or live transcript item representing conversation history cards in the GUI.
 */
export interface GuiTranscriptEntry {
	readonly id: string;
	readonly role: "user" | "assistant" | "tool" | "bash" | "compaction" | "branchSummary" | "system";
	readonly text: string;
	readonly thinking?: string;
	readonly stopReason?: string;
	readonly errorMessage?: string;
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly argsText?: string;
	readonly outputText?: string;
	readonly isError?: boolean;
	readonly durationMs?: number;
	readonly turnDurationMs?: number;
	readonly timestamp?: number;
	readonly command?: string;
	readonly exitCode?: number;
	readonly changedFiles?: readonly GuiChangedFile[];
	readonly attachments?: readonly GuiAttachmentItem[];
}

/**
 * Queued steering or follow-up message waiting to be delivered to the active session.
 */
export interface GuiQueuedMessageItem {
	readonly id: string;
	readonly kind: "steer" | "followUp";
	readonly text: string;
	readonly attachments?: readonly GuiAttachmentItem[];
	readonly createdAt: number;
}

/**
 * Installed macOS external editor, terminal, or Finder opener for the active workspace.
 */
export interface GuiExternalOpener {
	readonly id: string;
	readonly name: string;
	readonly appPath?: string;
	readonly available: boolean;
}

/**
 * Aggregate git status and diff result returned by git inspection helpers.
 */
export interface GuiGitStatusSummary {
	readonly isGitRepo: boolean;
	readonly currentBranch: string;
	readonly branches: readonly string[];
	readonly changedFiles: readonly GuiChangedFile[];
	readonly totalAdditions: number;
	readonly totalDeletions: number;
}

/**
 * File preview payload returned for workspace file viewer inspection.
 */
export interface GuiWorkspaceFilePreview {
	readonly path: string;
	readonly relativePath: string;
	readonly isBinary: boolean;
	readonly truncated: boolean;
	readonly lineCount: number;
	readonly language?: string;
	readonly content: string;
	readonly error?: string;
}

/**
 * Options for dispatching user messages with optional attachments and queue/steer behavior.
 */
export interface GuiSendMessageOptions {
	readonly attachments?: readonly GuiAttachmentItem[];
	readonly deliverAs?: "auto" | "steer" | "followUp";
}

/**
 * Complete Waku GUI controller state snapshot for initial render and full rehydration.
 */
export interface GuiSessionSnapshot {
	readonly status: GuiSessionStatus;
	readonly transcript: readonly GuiTranscriptEntry[];
	readonly sessions: readonly GuiSessionListItem[];
	readonly changedFiles: readonly GuiChangedFile[];
	readonly workspaceFiles: readonly GuiWorkspaceFileEntry[];
	readonly treeEntries: readonly GuiTreeEntryItem[];
	readonly gitBranch: string;
	readonly gitBranches: readonly string[];
	readonly isGitRepo: boolean;
	readonly openers: readonly GuiExternalOpener[];
	readonly queuedMessages: readonly GuiQueuedMessageItem[];
	readonly pendingPrompts: readonly GuiPendingPrompt[];
	readonly widgets: readonly GuiExtensionWidgetEntry[];
	readonly statuses: readonly GuiExtensionStatusEntry[];
	readonly toasts: readonly GuiToastEntry[];
	readonly layout: GuiLayoutPreferences;
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
	| "session_reset"
	| "snapshot"
	| "sessions_changed"
	| "workspace_changed"
	| "tree_changed"
	| "queue_changed"
	| "extension_ui"
	| "layout_changed"
	| "editor_text"
	| "bash_result";

/**
 * Flat controller event consumed by the GUI viewport, panels, and header state updater.
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
	readonly sessionActionReason?: "new" | "clear" | "switch" | "fork" | "tree" | "reload";
	readonly snapshot?: GuiSessionSnapshot;
	readonly transcript?: readonly GuiTranscriptEntry[];
	readonly sessions?: readonly GuiSessionListItem[];
	readonly changedFiles?: readonly GuiChangedFile[];
	readonly workspaceFiles?: readonly GuiWorkspaceFileEntry[];
	readonly treeEntries?: readonly GuiTreeEntryItem[];
	readonly queuedMessages?: readonly GuiQueuedMessageItem[];
	readonly attachments?: readonly GuiAttachmentItem[];
	readonly pendingPrompt?: GuiPendingPrompt;
	readonly toast?: GuiToastEntry;
	readonly editorText?: string;
	readonly appendEditorText?: boolean;
	readonly command?: string;
	readonly exitCode?: number;
	readonly layout?: GuiLayoutPreferences;
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

	getSnapshot(): GuiSessionSnapshot;
	getTranscript(): readonly GuiTranscriptEntry[];
	sendUserMessage(text: string, options?: GuiSendMessageOptions): Promise<void>;
	steerMessage(text: string, attachments?: readonly GuiAttachmentItem[]): Promise<void>;
	removeQueuedMessage(id: string): void;
	clearQueuedMessages(): { steering: string[]; followUp: string[] };
	executeBashCommand(command: string, excludeFromContext?: boolean): Promise<void>;
	abortBash(): void;

	getSessions(filterAllProjects?: boolean): Promise<readonly GuiSessionListItem[]>;
	switchSession(sessionFile: string): Promise<{ cancelled: boolean }>;
	forkSession(entryId?: string): Promise<{ cancelled: boolean; selectedText?: string }>;
	renameSession(sessionId: string, title: string): Promise<void>;
	togglePinSession(sessionId: string): Promise<void>;
	deleteSession(sessionFile: string): Promise<boolean>;

	canGoBack(): boolean;
	canGoForward(): boolean;
	goBack(): Promise<boolean>;
	goForward(): Promise<boolean>;

	refreshWorkspaceState(): Promise<void>;
	checkoutBranch(branch: string): Promise<void>;
	createBranch(branch: string): Promise<void>;
	commitChanges(message: string, paths?: readonly string[]): Promise<void>;
	readWorkspaceFile(filePath: string): Promise<GuiWorkspaceFilePreview>;
	getExternalOpeners(): readonly GuiExternalOpener[];
	openInExternalApp(openerId: string, targetPath?: string): Promise<boolean>;

	getTreeEntries(): readonly GuiTreeEntryItem[];
	navigateTreeEntry(entryId: string, summarize?: boolean): Promise<{ cancelled: boolean; editorText?: string }>;
	getContextUsage(): GuiContextUsage | undefined;
	compactSession(customInstructions?: string): Promise<void>;
	updateLayoutPreferences(patch: Partial<GuiLayoutPreferences>): GuiLayoutPreferences;
	resolvePendingPrompt(promptId: string, value: unknown, cancelled?: boolean): void;
	dismissToast(toastId: string): void;
	getEditorText(): string;
	setEditorText(text: string): void;
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
	readonly initialMessages?: readonly string[];
	readonly initialAttachments?: readonly GuiAttachmentItem[];
	readonly startupDiagnostics?: readonly { readonly type: string; readonly message: string }[];
	readonly onRequestQuit?: () => void;
}
