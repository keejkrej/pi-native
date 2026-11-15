import {
	Badge,
	Box,
	Divider,
	type GuiTheme,
	HStack,
	Markdown,
	SGUI_FONT_MONO,
	Spacer,
	Text,
	VectorIcon,
	VStack,
} from "scriptc-ui";
import type { GuiSessionStatus } from "./types.ts";

/**
 * Common handle for conversation cards supporting live theme recoloring.
 */
export interface ThemedCard {
	readonly root: Box;
	applyTheme(theme: GuiTheme): void;
}

export interface WelcomeCardHandle extends ThemedCard {
	update(status: GuiSessionStatus): void;
}

export interface AssistantCardHandle extends ThemedCard {
	update(state: {
		text?: string;
		thinking?: string;
		ended?: boolean;
		stopReason?: string;
		errorMessage?: string;
	}): void;
	isEmpty(): boolean;
}

export interface ToolCardHandle extends ThemedCard {
	update(state: {
		argsText?: string;
		outputText?: string;
		ended?: boolean;
		isError?: boolean;
		durationMs?: number;
	}): void;
}

function formatDurationBadge(durationMs: number | undefined): string {
	if (durationMs === undefined || !Number.isFinite(durationMs)) return "";
	if (durationMs < 1000) return ` (${Math.round(durationMs)}ms)`;
	return ` (${(durationMs / 1000).toFixed(1)}s)`;
}

/**
 * Create the welcome/status card displayed at the top of a new or cleared session.
 */
export function createWelcomeCard(initialTheme: GuiTheme, initialStatus: GuiSessionStatus): WelcomeCardHandle {
	let currentTheme = initialTheme;
	let currentStatus = initialStatus;

	const titleIcon = new VectorIcon({
		name: "sparkles",
		size: 16,
		color: initialTheme.accent,
	});
	const titleText = new Text({
		text: "Welcome to pi-native",
		fontSize: 16,
		fontWeight: 700,
		color: initialTheme.text,
	});
	const authBadge = new Badge({
		label: initialStatus.authSummary.activeAuthLabel,
		leadingIcon: "shield",
		variant: initialStatus.authSummary.hasActiveAuth ? "success" : "warning",
	});
	const headerRow = new HStack({
		gap: 8,
		align: "center",
		children: [titleIcon, titleText, { child: new Spacer(), grow: 1 }, authBadge],
	});

	const divider = new Divider({ direction: "horizontal" });

	const workspaceText = new Text({
		text: "",
		fontSize: initialTheme.fontSizeSmall,
		color: initialTheme.text,
		wrap: true,
	});
	const modelText = new Text({
		text: "",
		fontSize: initialTheme.fontSizeSmall,
		color: initialTheme.text,
		wrap: true,
	});
	const authText = new Text({
		text: "",
		fontSize: initialTheme.fontSizeSmall,
		color: initialTheme.textMuted,
		wrap: true,
	});
	const hintText = new Text({
		text: "Enter sends, Shift+Enter inserts a newline, Cmd+K switches models, Cmd+N starts a new session.",
		fontSize: initialTheme.fontSizeSmall,
		color: initialTheme.textMuted,
		wrap: true,
	});

	const stack = new VStack({
		gap: 8,
		children: [
			headerRow,
			divider,
			new VStack({ gap: 4, children: [workspaceText, modelText, authText] }),
			hintText,
		],
	});
	const root = new Box({
		padding: { top: 16, bottom: 16, left: 18, right: 18 },
		background: initialTheme.surface,
		borderColor: initialTheme.border,
		borderWidth: 1,
		radius: initialTheme.radiusLarge,
		shadow: "sm",
		child: stack,
	});

	const syncText = () => {
		workspaceText.setText(`Workspace: ${currentStatus.cwd}`);
		modelText.setText(
			currentStatus.activeModel
				? `Model: ${currentStatus.activeModel.label} (Thinking: ${currentStatus.thinkingLevel})`
				: "Model: Not selected (click Model in the header to choose one)",
		);
		authText.setText(`Auth: ${currentStatus.authSummary.statusLabel}`);
		authBadge.setLabel(currentStatus.authSummary.activeAuthLabel);
		authBadge.setVariant(currentStatus.authSummary.hasActiveAuth ? "success" : "warning");
	};

	const applyTheme = (theme: GuiTheme) => {
		currentTheme = theme;
		root.setBackground(theme.surface);
		root.setBorder(theme.border, 1, theme.radiusLarge);
		titleIcon.setColor(theme.accent);
		titleText.setColor(theme.text);
		workspaceText.setColor(theme.text);
		modelText.setColor(theme.text);
		authText.setColor(currentStatus.authSummary.hasActiveAuth ? theme.textMuted : theme.warning);
		hintText.setColor(theme.textMuted);
	};

	syncText();
	applyTheme(currentTheme);

	return {
		root,
		update(status) {
			currentStatus = status;
			syncText();
			authText.setColor(currentStatus.authSummary.hasActiveAuth ? currentTheme.textMuted : currentTheme.warning);
		},
		applyTheme,
	};
}

/**
 * Create a clean user prompt card anchored with a soft muted fill and pill badge.
 */
export function createUserMessageCard(initialTheme: GuiTheme, text: string): ThemedCard {
	const roleBadge = new Badge({
		label: "You",
		variant: "accent",
		fontSize: initialTheme.fontSizeSmall,
		padding: { vertical: 2, horizontal: 8 },
	});
	const bodyText = new Text({
		text,
		fontSize: initialTheme.fontSizeBody,
		color: initialTheme.text,
		wrap: true,
	});

	const stack = new VStack({
		gap: 8,
		children: [new HStack({ children: [roleBadge, { child: new Spacer(), grow: 1 }] }), bodyText],
	});
	const root = new Box({
		padding: { top: 12, bottom: 12, left: 16, right: 16 },
		background: initialTheme.surfaceMuted,
		borderColor: initialTheme.border,
		borderWidth: 1,
		radius: 12,
		child: stack,
	});

	return {
		root,
		applyTheme(theme) {
			root.setBackground(theme.surfaceMuted);
			root.setBorder(theme.border, 1, 12);
			bodyText.setColor(theme.text);
		},
	};
}

/**
 * Create an open-air editorial assistant markdown card with optional thinking and error callouts.
 */
export function createAssistantMessageCard(initialTheme: GuiTheme): AssistantCardHandle {
	let currentTheme = initialTheme;
	let currentText = "";
	let currentThinking = "";
	let currentStopReason = "";
	let currentError = "";
	let ended = false;

	const roleIcon = new VectorIcon({
		name: "sparkles",
		size: 13,
		color: initialTheme.accent,
	});
	const roleText = new Text({
		text: "Assistant",
		fontSize: initialTheme.fontSizeSmall,
		fontWeight: 700,
		color: initialTheme.text,
	});
	const stateBadge = new Badge({
		label: "Streaming...",
		variant: "accent",
		fontSize: initialTheme.fontSizeSmall,
		padding: { vertical: 2, horizontal: 8 },
	});
	const headerRow = new HStack({
		gap: 6,
		align: "center",
		children: [roleIcon, roleText, { child: new Spacer(), grow: 1 }, stateBadge],
	});

	const thinkingTitle = new Text({
		text: "Thinking",
		fontSize: initialTheme.fontSizeSmall,
		fontWeight: 600,
		color: initialTheme.textMuted,
	});
	const thinkingBody = new Text({
		text: "",
		fontSize: initialTheme.fontSizeSmall,
		italic: true,
		color: initialTheme.textMuted,
		wrap: true,
	});
	const thinkingBox = new Box({
		padding: { top: 8, bottom: 8, left: 12, right: 12 },
		background: initialTheme.surfaceMuted,
		radius: initialTheme.radiusMedium,
		child: new VStack({ gap: 3, children: [thinkingTitle, thinkingBody] }),
	});

	const markdown = new Markdown({
		text: "",
		padding: 0,
		fontSize: initialTheme.fontSizeBody,
	});

	const errorIcon = new VectorIcon({
		name: "alert",
		size: 14,
		color: initialTheme.danger,
	});
	const errorText = new Text({
		text: "",
		fontSize: initialTheme.fontSizeSmall,
		color: initialTheme.danger,
		wrap: true,
	});
	const errorBox = new Box({
		padding: { top: 8, bottom: 8, left: 12, right: 12 },
		background: initialTheme.surfaceMuted,
		borderColor: initialTheme.danger,
		borderWidth: 1,
		radius: initialTheme.radiusMedium,
		child: new HStack({
			gap: 8,
			align: "center",
			children: [errorIcon, { child: errorText, grow: 1 }],
		}),
	});

	const bodyStack = new VStack({
		gap: 8,
		children: [headerRow, markdown],
	});
	const root = new Box({
		padding: { top: 6, bottom: 10, left: 4, right: 4 },
		child: bodyStack,
	});

	const buildErrorBanner = (): string => {
		if (currentStopReason === "aborted") {
			return currentError.trim().length > 0 ? currentError : "Generation stopped by user.";
		}
		if (currentStopReason === "error" || currentError.trim().length > 0) {
			return currentError.trim().length > 0 ? currentError : "Request failed.";
		}
		return "";
	};

	const rebuildChildren = () => {
		bodyStack.clear();
		bodyStack.addChild(headerRow);
		if (currentThinking.trim().length > 0) {
			thinkingBody.setText(currentThinking);
			bodyStack.addChild(thinkingBox);
		}
		markdown.setText(currentText);
		bodyStack.addChild(markdown);
		const banner = buildErrorBanner();
		if (banner.length > 0) {
			errorText.setText(banner);
			bodyStack.addChild(errorBox);
		}
	};

	const applyColors = (theme: GuiTheme) => {
		currentTheme = theme;
		const isErrorState = currentStopReason === "error";
		const isAbortedState = currentStopReason === "aborted";
		roleIcon.setColor(theme.accent);
		roleText.setColor(theme.text);
		thinkingTitle.setColor(theme.textMuted);
		thinkingBody.setColor(theme.textMuted);
		thinkingBox.setBackground(theme.surfaceMuted);

		const calloutTone = isAbortedState && !isErrorState ? theme.warning : theme.danger;
		errorIcon.setColor(calloutTone);
		errorText.setColor(calloutTone);
		errorBox.setBackground(theme.surfaceMuted);
		errorBox.setBorder(calloutTone, 1, theme.radiusMedium);
	};

	return {
		root,
		update(state) {
			if (state.text !== undefined) currentText = state.text;
			if (state.thinking !== undefined) currentThinking = state.thinking;
			if (state.stopReason !== undefined) currentStopReason = state.stopReason;
			if (state.errorMessage !== undefined) currentError = state.errorMessage;
			if (state.ended !== undefined) ended = state.ended;

			if (!ended) {
				stateBadge.setLabel("Streaming...");
				stateBadge.setVariant("accent");
			} else if (currentStopReason === "error") {
				stateBadge.setLabel("Error");
				stateBadge.setVariant("danger");
			} else if (currentStopReason === "aborted") {
				stateBadge.setLabel("Stopped");
				stateBadge.setVariant("warning");
			} else {
				stateBadge.setLabel("Complete");
				stateBadge.setVariant("success");
			}

			rebuildChildren();
			applyColors(currentTheme);
		},
		isEmpty() {
			return (
				currentText.trim().length === 0 &&
				currentThinking.trim().length === 0 &&
				currentError.trim().length === 0 &&
				currentStopReason !== "error" &&
				currentStopReason !== "aborted"
			);
		},
		applyTheme: applyColors,
	};
}

/**
 * Create a recessed single-layer tool execution card with monospaced header and status badge.
 */
export function createToolExecutionCard(
	initialTheme: GuiTheme,
	toolName: string,
	argsText: string,
): ToolCardHandle {
	let currentTheme = initialTheme;
	let currentArgs = argsText;
	let currentOutput = "";
	let ended = false;
	let isError = false;
	let durationMs: number | undefined;

	const toolIcon = new VectorIcon({
		name: "terminal",
		size: 13,
		color: initialTheme.textMuted,
	});
	const titleText = new Text({
		text: `Tool: ${toolName}`,
		fontSize: initialTheme.fontSizeCode,
		fontFamily: SGUI_FONT_MONO,
		fontWeight: 600,
		color: initialTheme.text,
	});
	const statusBadge = new Badge({
		label: "Running...",
		variant: "accent",
		fontSize: initialTheme.fontSizeSmall,
		padding: { vertical: 2, horizontal: 8 },
	});
	const headerRow = new HStack({
		gap: 8,
		align: "center",
		children: [toolIcon, titleText, { child: new Spacer(), grow: 1 }, statusBadge],
	});

	const argsView = new Text({
		text: currentArgs,
		fontSize: initialTheme.fontSizeCode,
		fontFamily: SGUI_FONT_MONO,
		color: initialTheme.textMuted,
		wrap: true,
	});

	const outputDivider = new Divider({ direction: "horizontal" });
	const outputView = new Text({
		text: "",
		fontSize: initialTheme.fontSizeCode,
		fontFamily: SGUI_FONT_MONO,
		color: initialTheme.codeText,
		wrap: true,
	});

	const stack = new VStack({ gap: 6 });
	const root = new Box({
		padding: { top: 10, bottom: 10, left: 12, right: 12 },
		background: initialTheme.surfaceMuted,
		borderColor: initialTheme.border,
		borderWidth: 1,
		radius: 10,
		child: stack,
	});

	const rebuild = () => {
		stack.clear();
		stack.addChild(headerRow);
		if (currentArgs.trim().length > 0) {
			argsView.setText(currentArgs);
			stack.addChild(argsView);
		}
		if (currentOutput.trim().length > 0) {
			stack.addChild(outputDivider);
			outputView.setText(currentOutput);
			stack.addChild(outputView);
		}
		if (!ended) {
			statusBadge.setLabel("Running...");
			statusBadge.setVariant("accent");
		} else if (isError) {
			statusBadge.setLabel(`Error${formatDurationBadge(durationMs)}`);
			statusBadge.setVariant("danger");
		} else {
			statusBadge.setLabel(`Done${formatDurationBadge(durationMs)}`);
			statusBadge.setVariant("success");
		}
	};

	const applyColors = (theme: GuiTheme) => {
		currentTheme = theme;
		root.setBackground(theme.surfaceMuted);
		root.setBorder(ended && isError ? theme.danger : theme.border, 1, 10);
		toolIcon.setColor(ended && isError ? theme.danger : theme.textMuted);
		titleText.setColor(theme.text);
		argsView.setColor(theme.textMuted);
		outputView.setColor(theme.codeText);
	};

	rebuild();
	applyColors(currentTheme);

	return {
		root,
		update(state) {
			if (state.argsText !== undefined) currentArgs = state.argsText;
			if (state.outputText !== undefined) currentOutput = state.outputText;
			if (state.ended !== undefined) ended = state.ended;
			if (state.isError !== undefined) isError = state.isError;
			if (state.durationMs !== undefined) durationMs = state.durationMs;
			rebuild();
			applyColors(currentTheme);
		},
		applyTheme: applyColors,
	};
}

/**
 * Create a styled error or status notice card.
 */
export function createBannerCard(
	initialTheme: GuiTheme,
	title: string,
	message: string,
	tone: "error" | "notice",
): ThemedCard {
	const icon = new VectorIcon({
		name: tone === "error" ? "alert" : "info",
		size: 14,
		color: tone === "error" ? initialTheme.danger : initialTheme.accent,
	});
	const titleText = new Text({
		text: title,
		fontSize: initialTheme.fontSizeSmall,
		fontWeight: 700,
		color: tone === "error" ? initialTheme.danger : initialTheme.accent,
	});
	const bodyText = new Text({
		text: message,
		fontSize: initialTheme.fontSizeSmall,
		color: initialTheme.text,
		wrap: true,
	});

	const stack = new VStack({
		gap: 4,
		children: [new HStack({ gap: 6, align: "center", children: [icon, titleText] }), bodyText],
	});
	const root = new Box({
		padding: { top: 10, bottom: 10, left: 14, right: 14 },
		background: initialTheme.surfaceMuted,
		borderColor: tone === "error" ? initialTheme.danger : initialTheme.border,
		borderWidth: 1,
		radius: 10,
		child: stack,
	});

	return {
		root,
		applyTheme(theme) {
			const accent = tone === "error" ? theme.danger : theme.accent;
			root.setBackground(theme.surfaceMuted);
			root.setBorder(tone === "error" ? theme.danger : theme.border, 1, 10);
			icon.setColor(accent);
			titleText.setColor(accent);
			bodyText.setColor(theme.text);
		},
	};
}
