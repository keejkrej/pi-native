import { basename } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	Badge,
	Box,
	Button,
	darkGuiTheme,
	Editor,
	type GuiApp,
	type GuiKeyEvent,
	type GuiRenderContext,
	type GuiTheme,
	HStack,
	lightGuiTheme,
	type Loader,
	matchesKeyEvent,
	type MenuSpec,
	type OverlayHandle,
	type Rect,
	type ScrollView,
	type SlashCommand,
	Text,
	TruncatedText,
	VStack,
} from "scriptc-ui";
import { createBannerCard } from "./cards.ts";
import {
	createWakuComposer,
	createWakuFooterBar,
	type WakuComposerHandle,
	type WakuFooterBarHandle,
} from "./composer.ts";
import {
	openCommandPalette,
	openContextPopover,
	openExtensionPromptModal,
	openGitBranchModal,
	openGitCommitModal,
	openModelPicker,
	openSessionPicker,
	openSettingsModal,
	resolveAppearanceTheme,
} from "./overlays.ts";
import { createWakuRightPanel, type WakuRightPanelHandle } from "./right-panel.ts";
import { createWakuSidebar, type WakuSidebarHandle } from "./sidebar.ts";
import { createWakuTranscriptView, type WakuTranscriptViewHandle } from "./transcript.ts";
import type {
	GuiControllerEvent,
	GuiPendingPrompt,
	GuiSessionController,
	GuiSessionSnapshot,
	GuiSessionStatus,
	PiGuiOptions,
} from "./types.ts";
import {
	createWakuHeaderBar,
	createWakuToastBanner,
	type WakuHeaderBarHandle,
	type WakuToastBannerHandle,
} from "./window-chrome.ts";

class WakuShellRoot extends Box {
	private readonly onThemeUpdated: (theme: GuiTheme) => void;

	constructor(child: HStack, theme: GuiTheme, onThemeUpdated: (theme: GuiTheme) => void) {
		super({
			background: theme.background,
			padding: 0,
			fillWidth: true,
			child,
		});
		this.onThemeUpdated = onThemeUpdated;
	}

	override onThemeChange(theme: GuiTheme): void {
		super.onThemeChange(theme);
		this.setBackground(theme.background);
		this.onThemeUpdated(theme);
	}
}

function formatWorkspaceBadgeLabel(cwd: string): string {
	const name = basename(cwd);
	return name.length > 0 ? name : cwd;
}

function formatHeaderTitle(status: GuiSessionStatus): string {
	const custom = status.sessionName?.trim();
	if (custom && custom.length > 0) {
		return custom;
	}
	return formatWorkspaceBadgeLabel(status.cwd);
}

function isValidThinkingArg(value: string): value is ThinkingLevel {
	return (
		value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}

type ActiveOverlayKind =
	| "command"
	| "model"
	| "session"
	| "settings"
	| "branch"
	| "commit"
	| "context"
	| "extension";

/**
 * Interactive control surface returned by mountPiGui for testing, shell control, and lifecycle disposal.
 */
export interface PiGuiHandle {
	readonly app: GuiApp;
	readonly controller: GuiSessionController;
	readonly headerTitle: Text;
	readonly workspaceBadge: Badge;
	readonly providerBadge: Badge;
	readonly cwdIndicator: TruncatedText;
	readonly modelButton: Button;
	readonly thinkingButton: Button;
	readonly newSessionButton: Button;
	readonly themeButton: Button;
	readonly settingsButton: Button;
	readonly statusLoader: Loader;
	readonly scrollView: ScrollView;
	readonly messagesStack: VStack;
	readonly editor: Editor;
	readonly sendButton: Button;
	readonly stopButton: Button;
	readonly menus: readonly MenuSpec[];
	readonly sidebar: WakuSidebarHandle;
	readonly headerBar: WakuHeaderBarHandle;
	readonly rightPanel: WakuRightPanelHandle;
	readonly transcriptView: WakuTranscriptViewHandle;
	readonly composer: WakuComposerHandle;
	readonly footerBar: WakuFooterBarHandle;
	readonly openModelPicker: () => void;
	readonly openSettings: () => void;
	readonly openCommandPalette: () => void;
	readonly openSessionPicker: () => void;
	readonly openContextPopover: () => void;
	readonly toggleSidebar: () => void;
	readonly toggleRightPanel: (tab?: "changes" | "files" | "tree") => void;
	readonly closeOverlay: () => void;
	readonly hasActiveOverlay: () => boolean;
	readonly toggleTheme: () => void;
	readonly submitText: (text: string) => void;
	readonly dispose: () => void;
}

/**
 * Mount the full Waku 3-pane Pi Agent Studio GUI onto a GuiApp instance and bind it to a session controller.
 */
export function mountPiGui(app: GuiApp, options: PiGuiOptions): PiGuiHandle {
	const controller = options.controller;
	const initialSnap = controller.getSnapshot();
	const initialStatus = initialSnap.status;

	let currentTheme: GuiTheme =
		options.initialTheme !== undefined
			? typeof options.initialTheme === "string"
				? options.initialTheme === "light"
					? lightGuiTheme
					: darkGuiTheme
				: options.initialTheme
			: resolveAppearanceTheme(initialSnap.layout.appearance, app);

	if (app.getTheme() !== currentTheme) {
		app.setTheme(currentTheme);
	}

	let activeOverlay: OverlayHandle | undefined;
	let activeOverlayKind: ActiveOverlayKind | undefined;
	let shownPromptId: string | undefined;
	let disposed = false;

	const headerTitle = new Text({
		text: formatHeaderTitle(initialStatus),
		fontSize: currentTheme.fontSizeHeading,
		fontWeight: 600,
		color: currentTheme.textBright,
	});
	const workspaceBadge = new Badge({
		label: formatWorkspaceBadgeLabel(initialStatus.cwd),
		variant: "neutral",
	});
	const cwdIndicator = new TruncatedText({
		text: initialStatus.cwd,
		fontSize: currentTheme.fontSizeSmall,
		color: currentTheme.textMuted,
	});

	const syncCompatMetadata = (status: GuiSessionStatus): void => {
		headerTitle.setText(formatHeaderTitle(status));
		workspaceBadge.setLabel(formatWorkspaceBadgeLabel(status.cwd));
		cwdIndicator.setText(status.cwd);
	};

	const syncWindowChrome = (snapshot: GuiSessionSnapshot, theme: GuiTheme): void => {
		const sidebarWidth = snapshot.layout.sidebarCollapsed ? 0 : snapshot.layout.sidebarWidth || 260;
		app.setWindowChrome(theme.dark, sidebarWidth, true);
	};

	const shell: {
		sidebar?: WakuSidebarHandle;
		headerBar?: WakuHeaderBarHandle;
		toastBanner?: WakuToastBannerHandle;
		transcriptView?: WakuTranscriptViewHandle;
		composer?: WakuComposerHandle;
		footerBar?: WakuFooterBarHandle;
		rightPanel?: WakuRightPanelHandle;
	} = {};

	const closeOverlay = (): void => {
		if (activeOverlay !== undefined) {
			const handle = activeOverlay;
			activeOverlay = undefined;
			activeOverlayKind = undefined;
			handle.hide();
		} else {
			activeOverlayKind = undefined;
		}
	};

	const hasActiveOverlay = (): boolean => activeOverlay !== undefined;

	const showManagedOverlay = (
		kind: ActiveOverlayKind,
		openFn: (onDismiss: () => void) => OverlayHandle,
	): void => {
		if (activeOverlayKind === kind && activeOverlay !== undefined) {
			closeOverlay();
			return;
		}
		closeOverlay();
		activeOverlayKind = kind;
		const created = openFn(() => {
			if (activeOverlay === created) {
				activeOverlay = undefined;
				activeOverlayKind = undefined;
				shell.composer?.focus();
				app.invalidate();
			}
		});
		// Synchronous dismiss callbacks may clear activeOverlay before openFn returns.
		if (activeOverlayKind === kind) {
			activeOverlay = created;
		}
	};

	const applyThemeToShell = (theme: GuiTheme): void => {
		currentTheme = theme;
		headerTitle.setColor(theme.textBright);
		shell.sidebar?.applyTheme(theme);
		shell.headerBar?.applyTheme(theme);
		shell.toastBanner?.applyTheme(theme);
		shell.transcriptView?.applyTheme(theme);
		shell.composer?.applyTheme(theme);
		shell.footerBar?.applyTheme(theme);
		shell.rightPanel?.applyTheme(theme);
		syncWindowChrome(controller.getSnapshot(), theme);
		app.invalidate();
	};

	const setThemeAndPersist = (nextTheme: GuiTheme): void => {
		currentTheme = nextTheme;
		const nextAppearance = nextTheme.dark ? "dark" : "light";
		if (controller.getSnapshot().layout.appearance !== nextAppearance) {
			controller.updateLayoutPreferences({ appearance: nextAppearance });
		}
		app.setTheme(nextTheme);
	};

	const toggleTheme = (): void => {
		const nextTheme = currentTheme.dark ? lightGuiTheme : darkGuiTheme;
		setThemeAndPersist(nextTheme);
	};

	const toggleSidebar = (): void => {
		const cur = controller.getSnapshot().layout.sidebarCollapsed;
		const nextLayout = controller.updateLayoutPreferences({ sidebarCollapsed: !cur });
		const snap = { ...controller.getSnapshot(), layout: nextLayout };
		shell.sidebar?.update(snap);
		shell.headerBar?.update(snap);
		syncWindowChrome(snap, currentTheme);
		app.invalidate();
	};

	const toggleRightPanel = (tab?: "changes" | "files" | "tree"): void => {
		const layout = controller.getSnapshot().layout;
		if (tab !== undefined) {
			const shouldOpen = !layout.rightPanelOpen || layout.rightPanelTab !== tab;
			const nextLayout = controller.updateLayoutPreferences({
				rightPanelOpen: shouldOpen,
				rightPanelTab: tab,
			});
			const snap = { ...controller.getSnapshot(), layout: nextLayout };
			shell.rightPanel?.update(snap);
			shell.headerBar?.update(snap);
		} else {
			const nextLayout = controller.updateLayoutPreferences({ rightPanelOpen: !layout.rightPanelOpen });
			const snap = { ...controller.getSnapshot(), layout: nextLayout };
			shell.rightPanel?.update(snap);
			shell.headerBar?.update(snap);
		}
		app.invalidate();
	};

	const openModelPickerModal = (): void => {
		showManagedOverlay("model", (onDismiss) =>
			openModelPicker(app, controller, {
				onOpenSettings: () => openSettingsModalOverlay(),
				onDismiss,
			}),
		);
	};

	const openSessionPickerModal = (): void => {
		showManagedOverlay("session", (onDismiss) => openSessionPicker(app, controller, { onDismiss }));
	};

	const openSettingsModalOverlay = (): void => {
		showManagedOverlay("settings", (onDismiss) =>
			openSettingsModal(app, controller, {
				onOpenModelPicker: () => openModelPickerModal(),
				onToggleTheme: toggleTheme,
				onDismiss,
			}),
		);
	};

	const openGitBranchModalOverlay = (): void => {
		showManagedOverlay("branch", (onDismiss) => openGitBranchModal(app, controller, { onDismiss }));
	};

	const openGitCommitModalOverlay = (): void => {
		showManagedOverlay("commit", (onDismiss) => openGitCommitModal(app, controller, { onDismiss }));
	};

	const openContextPopoverOverlay = (anchorRect?: Rect): void => {
		showManagedOverlay("context", (onDismiss) => openContextPopover(app, controller, { anchorRect, onDismiss }));
	};

	const openCommandPaletteModal = (): void => {
		showManagedOverlay("command", (onDismiss) =>
			openCommandPalette(app, controller, {
				onNewSession: async () => {
					await controller.newSession();
				},
				onOpenSessionPicker: openSessionPickerModal,
				onForkSession: async () => {
					await controller.forkSession();
				},
				onCompactContext: () => controller.compactSession(),
				onToggleSidebar: toggleSidebar,
				onToggleRightPanel: () => toggleRightPanel(),
				onSwitchRightTab: (tab) => {
					const nextLayout = controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: tab });
					const snap = { ...controller.getSnapshot(), layout: nextLayout };
					shell.rightPanel?.setActiveTab(tab);
					shell.rightPanel?.update(snap);
					shell.headerBar?.update(snap);
				},
				onToggleDiffMode: () => {
					const cur = controller.getSnapshot().layout.diffViewMode;
					const nextMode = cur === "unified" ? "split" : "unified";
					const nextLayout = controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "changes", diffViewMode: nextMode });
					const snap = { ...controller.getSnapshot(), layout: nextLayout };
					shell.rightPanel?.update(snap);
					shell.headerBar?.update(snap);
				},
				onToggleTheme: toggleTheme,
				onOpenGitBranch: openGitBranchModalOverlay,
				onOpenGitCommit: openGitCommitModalOverlay,
				onOpenModelPicker: openModelPickerModal,
				onCycleThinking: () => {
					const status = controller.getStatus();
					const levels = status.availableThinkingLevels;
					if (levels.length > 0) {
						const idx = levels.indexOf(status.thinkingLevel);
						const next = levels[(idx + 1) % levels.length] ?? levels[0];
						if (next !== undefined) {
							controller.setThinkingLevel(next);
						}
					}
				},
				onOpenSettings: openSettingsModalOverlay,
				onDismiss,
			}),
		);
	};

	const maybeOpenPendingPrompt = (snapshot: GuiSessionSnapshot, explicitPrompt?: GuiPendingPrompt): void => {
		const prompt = explicitPrompt ?? snapshot.pendingPrompts[0];
		if (prompt === undefined || prompt.id === shownPromptId) {
			return;
		}
		if (activeOverlay !== undefined && activeOverlayKind !== "extension") {
			return;
		}
		shownPromptId = prompt.id;
		showManagedOverlay("extension", (onDismiss) =>
			openExtensionPromptModal(app, controller, prompt, {
				onDismiss: () => {
					shownPromptId = undefined;
					onDismiss();
				},
			}),
		);
	};

	const resolveSlashModel = (args: string): boolean => {
		const query = args.trim().toLowerCase();
		const models = controller.getAvailableModels();
		let match = models.find((m) => m.label.toLowerCase() === query || m.id.toLowerCase() === query);
		if (match === undefined) {
			match = models.find((m) => m.label.toLowerCase().includes(query) || m.name.toLowerCase().includes(query));
		}
		if (match === undefined) {
			shell.transcriptView?.messagesStack.addChild(
				createBannerCard(currentTheme, "Model Not Found", `No available model matches "${args.trim()}".`, "warning")
					.root,
			);
			return true;
		}
		void controller.selectModel(match.provider, match.id);
		return true;
	};

	const handleSlashCommand = (cmdName: string, cmdArgs: string): boolean => {
		const normalized = cmdName.trim().toLowerCase();
		if (normalized === "new") {
			void controller.newSession();
			return true;
		}
		if (normalized === "clear") {
			controller.clearMessages();
			return true;
		}
		if (normalized === "model") {
			if (cmdArgs.length === 0) {
				openModelPickerModal();
			} else {
				resolveSlashModel(cmdArgs);
			}
			return true;
		}
		if (normalized === "thinking") {
			const status = controller.getStatus();
			const levels = status.availableThinkingLevels;
			if (cmdArgs.length === 0) {
				if (levels.length > 0) {
					const idx = levels.indexOf(status.thinkingLevel);
					const next = levels[(idx + 1) % levels.length] ?? levels[0];
					if (next !== undefined) {
						controller.setThinkingLevel(next);
					}
				}
			} else if (isValidThinkingArg(cmdArgs)) {
				controller.setThinkingLevel(cmdArgs);
			} else {
				shell.transcriptView?.messagesStack.addChild(
					createBannerCard(
						currentTheme,
						"Invalid Thinking Level",
						`Supported levels: ${levels.join(", ")}`,
						"warning",
					).root,
				);
			}
			return true;
		}
		if (normalized === "theme") {
			const arg = cmdArgs.toLowerCase();
			if (arg === "dark") {
				setThemeAndPersist(darkGuiTheme);
			} else if (arg === "light") {
				setThemeAndPersist(lightGuiTheme);
			} else {
				toggleTheme();
			}
			return true;
		}
		if (normalized === "compact") {
			void controller.compactSession(cmdArgs.length > 0 ? cmdArgs : undefined);
			return true;
		}
		if (normalized === "fork") {
			void controller.forkSession();
			return true;
		}
		if (normalized === "sessions" || normalized === "resume") {
			openSessionPickerModal();
			return true;
		}
		if (normalized === "branch") {
			openGitBranchModalOverlay();
			return true;
		}
		if (normalized === "commit") {
			openGitCommitModalOverlay();
			return true;
		}
		if (normalized === "settings") {
			openSettingsModalOverlay();
			return true;
		}
		return false;
	};

	const slashCommands: readonly SlashCommand[] = [
		{ name: "new", description: "Start a new conversation session" },
		{ name: "clear", description: "Clear visible messages" },
		{
			name: "model",
			description: "Open model picker or switch model (/model provider/id)",
			getArgumentCompletions: (prefix) => {
				const q = prefix.trim().toLowerCase();
				const matches = controller
					.getAvailableModels()
					.filter((m) => m.label.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
					.slice(0, 12)
					.map((m) => ({ value: m.label, label: m.label, description: m.description }));
				return matches.length > 0 ? matches : null;
			},
		},
		{
			name: "thinking",
			description: "Cycle or set thinking level (off, low, medium, high)",
			getArgumentCompletions: (prefix) => {
				const q = prefix.trim().toLowerCase();
				const levels = controller.getStatus().availableThinkingLevels;
				const items = levels
					.filter((l) => l.startsWith(q))
					.map((l) => ({ value: l, label: l, description: `Set thinking level to ${l}` }));
				return items.length > 0 ? items : null;
			},
		},
		{
			name: "theme",
			description: "Toggle or set dark/light theme (/theme dark | light)",
			getArgumentCompletions: (prefix) => {
				const q = prefix.trim().toLowerCase();
				const items = (["dark", "light"] as const)
					.filter((t) => t.startsWith(q))
					.map((t) => ({ value: t, label: t, description: `Switch to ${t} theme` }));
				return items.length > 0 ? items : null;
			},
		},
		{ name: "compact", description: "Compact session context" },
		{ name: "fork", description: "Fork conversation into a new branch/session" },
		{ name: "sessions", description: "Open session switcher" },
		{ name: "branch", description: "Manage Git branches" },
		{ name: "commit", description: "Commit workspace changes" },
		{ name: "settings", description: "Open GUI settings modal" },
	];

	const sidebar = createWakuSidebar(app, controller, {
		vibrancyEnabled: true,
		onNewSession: () => {
			void controller.newSession();
		},
		onToggleSidebar: toggleSidebar,
		onOpenSettings: openSettingsModalOverlay,
		onToggleTheme: toggleTheme,
		onResize: (width) => {
			const snap = controller.getSnapshot();
			if (!snap.layout.sidebarCollapsed) {
				app.setWindowChrome(currentTheme.dark, width, true);
			}
		},
		onResizeEnd: () => {
			syncWindowChrome(controller.getSnapshot(), currentTheme);
		},
	});
	shell.sidebar = sidebar;

	const headerBar = createWakuHeaderBar(app, controller, {
		onToggleSidebar: toggleSidebar,
		onNewSession: () => {
			void controller.newSession();
		},
		onGoBack: () => {
			void controller.goBack();
		},
		onGoForward: () => {
			void controller.goForward();
		},
		onOpenGitBranch: openGitBranchModalOverlay,
		onToggleRightPanel: () => toggleRightPanel(),
	});
	shell.headerBar = headerBar;

	const toastBanner = createWakuToastBanner(app, controller, { autoDismissMs: 5000 });
	shell.toastBanner = toastBanner;

	const transcriptView = createWakuTranscriptView(app, controller, {
		maxColumnWidth: 760,
		initialTheme: currentTheme,
		onSelectPrompt: (promptText) => {
			shell.composer?.setText(promptText);
			shell.composer?.focus();
		},
		onForkFromMessage: () => {
			void controller.forkSession();
		},
		onOpenFile: (filePath) => {
			const nextLayout = controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "files" });
			const snap = { ...controller.getSnapshot(), layout: nextLayout };
			shell.rightPanel?.update(snap);
			headerBar.update(snap);
			if (filePath.length > 0) {
				shell.rightPanel?.selectFile(filePath);
			}
		},
		onViewDiff: (_toolName, filePath) => {
			if (filePath !== undefined && filePath.length > 0) {
				shell.rightPanel?.selectFile(filePath);
				headerBar.update(controller.getSnapshot());
			} else {
				const nextLayout = controller.updateLayoutPreferences({ rightPanelOpen: true, rightPanelTab: "changes" });
				const snap = { ...controller.getSnapshot(), layout: nextLayout };
				shell.rightPanel?.update(snap);
				headerBar.update(snap);
			}
		},
		onOpenChangedFile: (filePath) => {
			shell.rightPanel?.selectFile(filePath);
			headerBar.update(controller.getSnapshot());
		},
	});
	shell.transcriptView = transcriptView;

	const composer = createWakuComposer(app, controller, {
		initialTheme: currentTheme,
		slashCommands,
		onOpenModelPicker: openModelPickerModal,
		onOpenAttachDialog: () => {
			shell.composer?.focus();
		},
		onSlashCommand: handleSlashCommand,
	});
	shell.composer = composer;

	if (options.initialAttachments !== undefined) {
		for (let i = 0; i < options.initialAttachments.length; i++) {
			const att = options.initialAttachments[i];
			if (att !== undefined) {
				composer.addAttachment(att);
			}
		}
	}

	const footerBar = createWakuFooterBar(controller, {
		initialTheme: currentTheme,
		onWorkspaceClick: () => toggleRightPanel("files"),
		onGitBranchClick: openGitBranchModalOverlay,
		onContextClick: () => openContextPopoverOverlay(),
	});
	shell.footerBar = footerBar;

	const rightPanel = createWakuRightPanel(app, controller, {
		onClose: () => toggleRightPanel(),
		onOpenCommitModal: openGitCommitModalOverlay,
		onOpenBranchModal: openGitBranchModalOverlay,
	});
	shell.rightPanel = rightPanel;

	const centerColumn = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			headerBar.root,
			{ child: transcriptView.root, grow: 1, shrink: 1 },
			composer.root,
			footerBar.root,
		],
	});

	const shellRow = new HStack({
		gap: 0,
		align: "stretch",
		children: [
			sidebar.root,
			{ child: centerColumn, grow: 1, shrink: 1 },
			rightPanel.root,
		],
	});

	const root = new WakuShellRoot(shellRow, currentTheme, applyThemeToShell);
	app.setRoot(root);
	syncWindowChrome(initialSnap, currentTheme);

	// Compat handle shims synced with controller + Waku controls without cluttering the desktop a11y tree.
	const newSessionButton = new Button({
		label: "New Session",
		variant: "ghost",
		onClick: () => {
			void controller.newSession();
		},
	});
	const themeButton = new Button({
		label: "Toggle Theme",
		variant: "ghost",
		onClick: toggleTheme,
	});
	const settingsButton = new Button({
		label: "Settings",
		variant: "ghost",
		onClick: openSettingsModalOverlay,
	});
	const sendButton = new Button({
		label: "Send",
		variant: "primary",
		onClick: () => composer.submitCurrent("auto"),
	});

	const submitText = (text: string): void => {
		composer.setText(text);
		composer.submitCurrent("auto");
	};

	const onControllerEvent = (event: GuiControllerEvent): void => {
		if (disposed) return;
		const snap = event.snapshot ?? controller.getSnapshot();
		syncCompatMetadata(snap.status);

		switch (event.type) {
			case "snapshot":
			case "session_reset":
				sidebar.update(snap);
				headerBar.update(snap);
				rightPanel.update(snap);
				toastBanner.update(snap);
				syncWindowChrome(snap, currentTheme);
				maybeOpenPendingPrompt(snap);
				break;
			case "status_changed":
				sidebar.update(snap);
				headerBar.update(snap);
				syncWindowChrome(snap, currentTheme);
				break;
			case "sessions_changed":
				sidebar.update(snap);
				headerBar.update(snap);
				break;
			case "workspace_changed":
			case "tree_changed":
				headerBar.update(snap);
				rightPanel.update(snap);
				break;
			case "layout_changed": {
				const targetTheme = resolveAppearanceTheme(snap.layout.appearance, app);
				if (targetTheme !== currentTheme) {
					app.setTheme(targetTheme);
				}
				sidebar.update(snap);
				headerBar.update(snap);
				rightPanel.update(snap);
				syncWindowChrome(snap, currentTheme);
				break;
			}
			case "extension_ui":
				toastBanner.update(snap);
				maybeOpenPendingPrompt(snap, event.pendingPrompt);
				break;
			default:
				break;
		}
		app.invalidate();
	};

	const unsubscribeController = controller.subscribe(onControllerEvent);

	const menus: readonly MenuSpec[] = [
		{
			title: "App",
			items: [
				{ kind: "action", label: "About pi-native", role: "about" },
				{ kind: "separator" },
				{ kind: "action", label: "Toggle Theme", shortcut: "mod+t", onSelect: toggleTheme },
				{ kind: "action", label: "Settings", shortcut: "mod+,", onSelect: openSettingsModalOverlay },
				{ kind: "separator" },
				{ kind: "action", label: "Quit", shortcut: "mod+q", role: "quit", onSelect: () => options.onRequestQuit?.() },
			],
		},
		{
			title: "Session",
			items: [
				{
					kind: "action",
					label: "New Session",
					shortcut: "mod+n",
					onSelect: () => {
						void controller.newSession();
					},
				},
				{ kind: "action", label: "Command Palette", shortcut: "mod+shift+k", onSelect: openCommandPaletteModal },
				{ kind: "action", label: "Switch Model", shortcut: "mod+k", onSelect: openModelPickerModal },
				{ kind: "action", label: "Resume Session", shortcut: "mod+shift+o", onSelect: openSessionPickerModal },
				{
					kind: "action",
					label: "Clear Messages",
					shortcut: "mod+l",
					onSelect: () => {
						controller.clearMessages();
					},
				},
				{
					kind: "action",
					label: "Stop Generation",
					onSelect: () => {
						void controller.abort();
					},
				},
			],
		},
		{
			title: "Edit",
			items: [
				{ kind: "action", label: "Find in Transcript", shortcut: "mod+f", onSelect: () => transcriptView.openFindBar() },
				{ kind: "separator" },
				{ kind: "action", label: "Undo", shortcut: "mod+z", role: "undo" },
				{ kind: "action", label: "Redo", shortcut: "mod+shift+z", role: "redo" },
				{ kind: "separator" },
				{ kind: "action", label: "Cut", shortcut: "mod+x", role: "cut" },
				{ kind: "action", label: "Copy", shortcut: "mod+c", role: "copy" },
				{ kind: "action", label: "Paste", shortcut: "mod+v", role: "paste" },
				{ kind: "action", label: "Select All", shortcut: "mod+a", role: "selectAll" },
			],
		},
		{
			title: "Window",
			items: [
				{ kind: "action", label: "Toggle Sidebar", shortcut: "mod+b", onSelect: toggleSidebar },
				{ kind: "action", label: "Toggle Right Panel", shortcut: "mod+\\", onSelect: () => toggleRightPanel() },
				{ kind: "separator" },
				{ kind: "action", label: "Close Window", shortcut: "mod+w", role: "close" },
			],
		},
	];
	app.setAppMenu(menus);

	app.setOnKey((event: GuiKeyEvent, ctx: GuiRenderContext) => {
		if (event.phase === "up") return false;

		if (event.key.toLowerCase() === "escape") {
			if (activeOverlay !== undefined) {
				closeOverlay();
				return true;
			}
			if (transcriptView.handleShortcutKey(event, ctx)) {
				return true;
			}
			if (controller.getStatus().isStreaming) {
				void controller.abort();
				return true;
			}
			return false;
		}

		if (matchesKeyEvent(event, "mod+k", process.platform)) {
			openCommandPaletteModal();
			return true;
		}
		if (matchesKeyEvent(event, "mod+m", process.platform)) {
			openModelPickerModal();
			return true;
		}
		if (matchesKeyEvent(event, "mod+shift+o", process.platform)) {
			openSessionPickerModal();
			return true;
		}
		if (matchesKeyEvent(event, "mod+,", process.platform)) {
			openSettingsModalOverlay();
			return true;
		}
		if (matchesKeyEvent(event, "mod+f", process.platform)) {
			return transcriptView.handleShortcutKey(event, ctx);
		}
		if (matchesKeyEvent(event, "mod+b", process.platform)) {
			toggleSidebar();
			return true;
		}
		if (matchesKeyEvent(event, "mod+\\", process.platform)) {
			toggleRightPanel();
			return true;
		}
		if (matchesKeyEvent(event, "mod+n", process.platform)) {
			void controller.newSession();
			return true;
		}
		if (matchesKeyEvent(event, "mod+l", process.platform)) {
			controller.clearMessages();
			return true;
		}

		if (transcriptView.isFindBarOpen() && transcriptView.handleShortcutKey(event, ctx)) {
			return true;
		}

		return false;
	});

	if (initialStatus.modelFallbackMessage) {
		transcriptView.messagesStack.addChild(
			createBannerCard(currentTheme, "Model Notice", initialStatus.modelFallbackMessage, "notice").root,
		);
	}
	if (options.startupDiagnostics && options.startupDiagnostics.length > 0) {
		for (let i = 0; i < options.startupDiagnostics.length; i++) {
			const d = options.startupDiagnostics[i];
			if (d === undefined) continue;
			const variant = d.type === "error" ? "error" : d.type === "warning" ? "warning" : "notice";
			transcriptView.messagesStack.addChild(createBannerCard(currentTheme, "Startup Diagnostic", d.message, variant).root);
		}
	}

	composer.focus();

	const initialQueue: string[] = [];
	if (options.initialPrompt && options.initialPrompt.trim().length > 0) {
		initialQueue.push(options.initialPrompt.trim());
	}
	if (options.initialMessages && options.initialMessages.length > 0) {
		for (let i = 0; i < options.initialMessages.length; i++) {
			const msg = options.initialMessages[i]?.trim();
			if (msg && msg.length > 0 && msg !== options.initialPrompt?.trim()) {
				initialQueue.push(msg);
			}
		}
	}
	if (initialQueue.length > 0) {
		queueMicrotask(() => {
			if (disposed) return;
			const first = initialQueue[0];
			if (first !== undefined) {
				const atts = composer.getAttachments();
				if (atts.length > 0) {
					composer.clearAttachments();
					void controller.sendUserMessage(first, { attachments: atts, deliverAs: "auto" });
				} else {
					void controller.sendUserMessage(first, { deliverAs: "auto" });
				}
			}
			for (let i = 1; i < initialQueue.length; i++) {
				const extra = initialQueue[i];
				if (extra !== undefined) {
					void controller.sendUserMessage(extra, { deliverAs: "followUp" });
				}
			}
		});
	}

	return {
		app,
		controller,
		headerTitle,
		workspaceBadge,
		providerBadge: footerBar.providerBadge,
		cwdIndicator,
		modelButton: composer.modelButton,
		thinkingButton: composer.thinkingButton,
		newSessionButton,
		themeButton,
		settingsButton,
		statusLoader: footerBar.statusLoader,
		scrollView: transcriptView.scrollView,
		messagesStack: transcriptView.messagesStack,
		editor: composer.editor,
		sendButton,
		stopButton: composer.stopButton,
		menus,
		sidebar,
		headerBar,
		rightPanel,
		transcriptView,
		composer,
		footerBar,
		openModelPicker: openModelPickerModal,
		openSettings: openSettingsModalOverlay,
		openCommandPalette: openCommandPaletteModal,
		openSessionPicker: openSessionPickerModal,
		openContextPopover: () => openContextPopoverOverlay(),
		toggleSidebar,
		toggleRightPanel,
		closeOverlay,
		hasActiveOverlay,
		toggleTheme,
		submitText,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			closeOverlay();
			unsubscribeController();
			sidebar.dispose();
			headerBar.dispose();
			toastBanner.dispose();
			transcriptView.dispose();
			composer.dispose();
			footerBar.dispose();
			rightPanel.dispose();
			app.setOnKey(undefined);
		},
	};
}
