import { basename } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	Badge,
	Box,
	Button,
	CombinedAutocompleteProvider,
	darkGuiTheme,
	Divider,
	Editor,
	type GuiApp,
	type GuiTheme,
	HStack,
	lightGuiTheme,
	Loader,
	type MenuSpec,
	type OverlayHandle,
	ScrollView,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	type SlashCommand,
	Spacer,
	Text,
	TruncatedText,
	VectorIcon,
	VStack,
} from "scriptc-ui";
import {
	type AssistantCardHandle,
	createAssistantMessageCard,
	createBannerCard,
	createToolExecutionCard,
	createUserMessageCard,
	createWelcomeCard,
	type ThemedCard,
	type ToolCardHandle,
} from "./cards.ts";
import type { GuiControllerEvent, GuiSessionController, GuiSessionStatus, PiGuiOptions } from "./types.ts";

class ThemeAwareRoot extends Box {
	private readonly onThemeUpdated: (theme: GuiTheme) => void;

	constructor(child: VStack, theme: GuiTheme, onThemeUpdated: (theme: GuiTheme) => void) {
		super({
			background: theme.background,
			padding: 0,
			child,
		});
		this.onThemeUpdated = onThemeUpdated;
	}

	override onThemeChange(theme: GuiTheme): void {
		super.onThemeChange(theme);
		this.onThemeUpdated(theme);
	}
}

function formatCompactModelLabel(label: string): string {
	if (label.length <= 34) return label;
	return `${label.slice(0, 31)}...`;
}

function formatModelButtonLabel(status: GuiSessionStatus): string {
	if (!status.activeModel) return "Model: Select";
	return `Model: ${formatCompactModelLabel(status.activeModel.label)}`;
}

function formatWorkspaceBadgeLabel(cwd: string): string {
	const name = basename(cwd);
	return name.length > 0 ? name : cwd;
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

/**
 * Interactive control surface returned by mountPiGui for testing and lifecycle disposal.
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
	openModelPicker(): void;
	openSettings(): void;
	closeOverlay(): void;
	hasActiveOverlay(): boolean;
	toggleTheme(): void;
	submitText(text: string): Promise<void>;
	dispose(): Promise<void>;
}

/**
 * Mount the full pi-native coding agent desktop interface onto a GuiApp instance.
 */
export function mountPiGui(app: GuiApp, options: PiGuiOptions): PiGuiHandle {
	const { controller } = options;

	if (options.initialTheme === "light") {
		app.setTheme(lightGuiTheme);
	} else if (options.initialTheme === "dark") {
		app.setTheme(darkGuiTheme);
	} else if (options.initialTheme !== undefined) {
		app.setTheme(options.initialTheme);
	}

	let currentTheme = app.getTheme();
	let autoScrollEnabled = options.autoScroll ?? true;
	let disposed = false;

	let activeOverlay: OverlayHandle | undefined;
	let activeOverlayKind: "model" | "settings" | undefined;
	let activeAssistantCard: AssistantCardHandle | undefined;
	const activeToolCards = new Map<string, ToolCardHandle>();
	const cards: ThemedCard[] = [];

	const initialStatus = controller.getStatus();
	app.setTitle(`pi-native — ${initialStatus.cwd}`);

	const brandIcon = new VectorIcon({
		name: "terminal",
		size: 16,
		color: currentTheme.accent,
	});
	const headerTitle = new Text({
		text: "pi-native",
		fontSize: 15,
		fontWeight: 700,
		color: currentTheme.text,
	});
	const workspaceBadge = new Badge({
		label: formatWorkspaceBadgeLabel(initialStatus.cwd),
		leadingIcon: "folder",
		variant: "neutral",
	});
	const cwdIndicator = new TruncatedText({
		text: initialStatus.cwd,
		fontSize: currentTheme.fontSizeSmall,
	});
	const statusLoader = new Loader({
		message: initialStatus.statusMessage ?? "Ready",
		size: 14,
		running: initialStatus.isStreaming,
	});

	const providerBadge = new Badge({
		label: initialStatus.activeModel?.provider ?? "unconfigured",
		leadingIcon: "shield",
		variant: initialStatus.authSummary.hasActiveAuth ? "success" : "warning",
	});
	const modelButton = new Button({
		label: formatModelButtonLabel(initialStatus),
		leadingIcon: "sparkles",
		iconSize: 13,
		variant: "secondary",
		pill: true,
		padding: { vertical: 5, horizontal: 11 },
		onClick: () => openModelPicker(),
	});
	const thinkingButton = new Button({
		label: `Thinking: ${initialStatus.thinkingLevel}`,
		leadingIcon: "cpu",
		iconSize: 13,
		variant: "secondary",
		pill: true,
		padding: { vertical: 5, horizontal: 11 },
		onClick: () => cycleThinkingLevel(),
	});
	const newSessionButton = new Button({
		label: "New Session",
		leadingIcon: "plus",
		iconSize: 13,
		variant: "ghost",
		padding: { vertical: 5, horizontal: 9 },
		onClick: () => {
			void handleNewSession();
		},
	});
	const themeButton = new Button({
		label: "Toggle Theme",
		leadingIcon: currentTheme.dark ? "sun" : "moon",
		iconSize: 13,
		variant: "ghost",
		padding: { vertical: 5, horizontal: 9 },
		onClick: () => toggleTheme(),
	});
	const settingsButton = new Button({
		label: "Settings",
		leadingIcon: "sliders",
		iconSize: 13,
		variant: "ghost",
		padding: { vertical: 5, horizontal: 9 },
		onClick: () => openSettings(),
	});

	const headerTopRow = new HStack({
		gap: 8,
		align: "center",
		children: [
			brandIcon,
			headerTitle,
			workspaceBadge,
			{ child: cwdIndicator, grow: 1, shrink: 1, minSize: 80 },
			statusLoader,
		],
	});
	const headerControlsRow = new HStack({
		gap: 8,
		align: "center",
		children: [
			providerBadge,
			modelButton,
			thinkingButton,
			{ child: new Spacer(), grow: 1 },
			newSessionButton,
			themeButton,
			settingsButton,
		],
	});
	const headerInnerStack = new VStack({
		gap: 8,
		children: [headerTopRow, headerControlsRow],
	});
	const headerBox = new Box({
		padding: { top: 10, bottom: 10, left: 16, right: 16 },
		background: currentTheme.surface,
		child: headerInnerStack,
	});
	const headerDivider = new Divider({ direction: "horizontal" });

	const messagesStack = new VStack({
		gap: 14,
		padding: { top: 2, bottom: 12, left: 0, right: 0 },
	});
	const transcriptColumn = new Box({
		maxWidth: 820,
		fillWidth: true,
		alignHorizontal: "center",
		child: messagesStack,
	});
	const scrollView = new ScrollView({
		follow: autoScrollEnabled ? "end" : "none",
		primary: true,
		padding: { top: 18, bottom: 18, left: 16, right: 16 },
		child: transcriptColumn,
	});

	const welcomeCard = createWelcomeCard(currentTheme, initialStatus);
	const appendCard = (card: ThemedCard) => {
		cards.push(card);
		messagesStack.addChild(card.root);
		if (autoScrollEnabled && scrollView.isFollowingEnd()) {
			scrollView.scrollToEnd();
		}
		app.invalidate();
	};
	appendCard(welcomeCard);

	if (initialStatus.modelFallbackMessage) {
		appendCard(createBannerCard(currentTheme, "Model Notice", initialStatus.modelFallbackMessage, "notice"));
	}

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
		{ name: "quit", description: "Quit pi-native" },
	];

	const autocompleteProvider = new CombinedAutocompleteProvider(slashCommands, initialStatus.cwd);

	const editor = new Editor({
		placeholder: "Ask pi anything, or type / for commands...",
		minHeight: 54,
		maxHeight: 160,
		submitOnEnter: true,
		clearOnSubmit: true,
		autocompleteProvider,
		onSubmit: (submitted) => {
			void submitText(submitted);
		},
	});

	const composerHint = new Text({
		text: "Enter to send · Shift+Enter newline · / for commands",
		fontSize: currentTheme.fontSizeSmall,
		color: currentTheme.textMuted,
	});
	const sendButton = new Button({
		label: "Send",
		leadingIcon: "send",
		iconSize: 13,
		variant: "primary",
		pill: true,
		padding: { vertical: 6, horizontal: 14 },
		onClick: () => {
			const text = editor.getText().trim();
			if (text.length === 0) return;
			editor.addToHistory(text);
			editor.setText("");
			void submitText(text);
		},
	});
	const stopButton = new Button({
		label: "Stop",
		leadingIcon: "stop",
		iconSize: 13,
		variant: "danger",
		pill: true,
		padding: { vertical: 6, horizontal: 12 },
		disabled: !initialStatus.isStreaming,
		onClick: () => {
			void handleStop();
		},
	});

	const composerToolbar = new HStack({
		gap: 8,
		align: "center",
		padding: { top: 2, bottom: 2, left: 6, right: 2 },
		children: [composerHint, { child: new Spacer(), grow: 1 }, stopButton, sendButton],
	});
	const composerStack = new VStack({
		gap: 6,
		children: [editor, composerToolbar],
	});
	const composerCard = new Box({
		padding: 6,
		background: currentTheme.surfaceElevated,
		borderColor: currentTheme.border,
		borderWidth: 1,
		radius: 14,
		shadow: "sm",
		child: composerStack,
	});
	const composerColumn = new Box({
		maxWidth: 820,
		fillWidth: true,
		alignHorizontal: "center",
		child: composerCard,
	});
	const composerRegion = new Box({
		padding: { top: 4, bottom: 14, left: 16, right: 16 },
		child: composerColumn,
	});

	const mainStack = new VStack({
		gap: 0,
		children: [
			headerBox,
			headerDivider,
			{ child: scrollView, grow: 1, shrink: 1, minSize: 120 },
			composerRegion,
		],
	});

	const syncChromeTheme = (theme: GuiTheme) => {
		currentTheme = theme;
		rootBox.setBackground(theme.background);
		headerBox.setBackground(theme.surface);
		brandIcon.setColor(theme.accent);
		headerTitle.setColor(theme.text);
		themeButton.setLeadingIcon(theme.dark ? "sun" : "moon");
		composerCard.setBackground(theme.surfaceElevated);
		composerCard.setBorder(theme.border, 1, 14);
		composerHint.setColor(theme.textMuted);
		for (const card of cards) {
			card.applyTheme(theme);
		}
		app.invalidate();
	};

	const rootBox = new ThemeAwareRoot(mainStack, currentTheme, syncChromeTheme);

	const updateHeaderFromStatus = (status: GuiSessionStatus) => {
		workspaceBadge.setLabel(formatWorkspaceBadgeLabel(status.cwd));
		providerBadge.setLabel(status.activeModel?.provider ?? "unconfigured");
		providerBadge.setVariant(status.authSummary.hasActiveAuth ? "success" : "warning");
		modelButton.setLabel(formatModelButtonLabel(status));
		thinkingButton.setLabel(`Thinking: ${status.thinkingLevel}`);
		cwdIndicator.setText(status.cwd);
		stopButton.setDisabled(!status.isStreaming);
		welcomeCard.update(status);

		const nextMsg = status.statusMessage ?? (status.isStreaming ? "Streaming..." : "Ready");
		statusLoader.setMessage(nextMsg);
		if (status.isStreaming) {
			if (!statusLoader.isRunning()) {
				statusLoader.start(80);
			}
		} else if (statusLoader.isRunning()) {
			statusLoader.stop();
		}
		app.invalidate();
	};

	const resetConversation = (reason: "new" | "clear") => {
		activeAssistantCard = undefined;
		activeToolCards.clear();
		cards.length = 0;
		messagesStack.clear();
		appendCard(welcomeCard);
		welcomeCard.update(controller.getStatus());
		const msg = reason === "new" ? "Started a new session." : "Cleared conversation messages.";
		appendCard(createBannerCard(currentTheme, "Session", msg, "notice"));
	};

	const closeOverlay = () => {
		if (!activeOverlay) return;
		const overlay = activeOverlay;
		activeOverlay = undefined;
		activeOverlayKind = undefined;
		overlay.dispose();
		app.setFocus(editor);
		app.invalidate();
	};

	const openModelPicker = () => {
		if (activeOverlayKind === "model") {
			closeOverlay();
			return;
		}
		closeOverlay();

		const models = controller.getAvailableModels();
		const status = controller.getStatus();
		const activeLabel = status.activeModel?.label ?? "None";

		const title = new Text({
			text: "Switch Model",
			fontSize: currentTheme.fontSizeHeading,
			fontWeight: 700,
			color: currentTheme.text,
		});
		const subtitle = new Text({
			text: `Active: ${activeLabel} · Esc to cancel`,
			fontSize: currentTheme.fontSizeSmall,
			color: currentTheme.textMuted,
			wrap: true,
		});

		const stackChildren: Array<Text | Divider | SelectList | Button> = [
			title,
			subtitle,
			new Divider({ direction: "horizontal" }),
		];

		if (models.length === 0) {
			stackChildren.push(
				new Text({
					text: "No authenticated models found. Configure credentials in ~/.pi/agent/auth.json.",
					fontSize: currentTheme.fontSizeBody,
					color: currentTheme.warning,
					wrap: true,
				}),
			);
			stackChildren.push(
				new Button({
					label: "Close",
					variant: "secondary",
					onClick: () => closeOverlay(),
				}),
			);
		} else {
			const items: SelectItem[] = models.map((m) => ({
				value: `${m.provider}\0${m.id}`,
				label: m.label,
				description: m.description,
			}));
			const selectList = new SelectList({
				items,
				maxVisible: 12,
				onSelect: (selected) => {
					const sep = selected.value.indexOf("\0");
					if (sep < 0) {
						closeOverlay();
						return;
					}
					const provider = selected.value.slice(0, sep);
					const modelId = selected.value.slice(sep + 1);
					closeOverlay();
					void controller
						.selectModel(provider, modelId)
						.then(() => {
							updateHeaderFromStatus(controller.getStatus());
						})
						.catch((err) => {
							appendCard(
								createBannerCard(
									currentTheme,
									"Model Switch Error",
									err instanceof Error ? err.message : String(err),
									"error",
								),
							);
						});
				},
				onCancel: () => closeOverlay(),
			});
			stackChildren.push(selectList);
		}

		const modalBox = new Box({
			padding: 16,
			background: currentTheme.surfaceElevated,
			borderColor: currentTheme.border,
			borderWidth: 1,
			radius: currentTheme.radiusLarge,
			child: new VStack({ gap: 10, children: stackChildren }),
		});

		activeOverlayKind = "model";
		activeOverlay = app.showOverlay(modalBox, {
			anchor: "center",
			width: 540,
			maxHeight: 480,
			radius: currentTheme.radiusLarge,
			shadow: "lg",
			modal: true,
			dismissOnEscape: true,
			dismissOnBackdropClick: true,
			onDismiss: () => {
				activeOverlay = undefined;
				activeOverlayKind = undefined;
				app.setFocus(editor);
				app.invalidate();
			},
		});
	};

	const openSettings = () => {
		if (activeOverlayKind === "settings") {
			closeOverlay();
			return;
		}
		closeOverlay();

		const status = controller.getStatus();
		const thinkingValues =
			status.availableThinkingLevels.length > 0 ? [...status.availableThinkingLevels] : ["off"];

		const settingItems: SettingItem[] = [
			{
				id: "appearance",
				label: "Appearance",
				description: "Switch between dark and light GUI theme",
				currentValue: currentTheme.dark ? "dark" : "light",
				values: ["dark", "light"],
			},
			{
				id: "thinking",
				label: "Thinking Level",
				description: "Reasoning budget for supporting models",
				currentValue: status.thinkingLevel,
				values: thinkingValues,
			},
			{
				id: "autoScroll",
				label: "Auto-scroll",
				description: "Keep conversation scrolled to latest output",
				currentValue: autoScrollEnabled ? "true" : "false",
				values: ["true", "false"],
			},
		];

		const title = new Text({
			text: "Settings",
			fontSize: currentTheme.fontSizeHeading,
			fontWeight: 700,
			color: currentTheme.text,
		});
		const subtitle = new Text({
			text: "Press Enter/Space or click a row to toggle · Esc to close",
			fontSize: currentTheme.fontSizeSmall,
			color: currentTheme.textMuted,
			wrap: true,
		});

		const settingsList = new SettingsList({
			items: settingItems,
			enableSearch: false,
			maxVisible: 8,
			onChange: (id, newValue) => {
				if (id === "appearance") {
					app.setTheme(newValue === "light" ? lightGuiTheme : darkGuiTheme);
				} else if (id === "thinking" && isValidThinkingArg(newValue)) {
					controller.setThinkingLevel(newValue);
					updateHeaderFromStatus(controller.getStatus());
				} else if (id === "autoScroll") {
					autoScrollEnabled = newValue === "true";
					scrollView.setFollowMode(autoScrollEnabled ? "end" : "none");
					if (autoScrollEnabled) {
						scrollView.scrollToEnd();
					}
					app.invalidate();
				}
			},
			onCancel: () => closeOverlay(),
		});

		const modalBox = new Box({
			padding: 16,
			background: currentTheme.surfaceElevated,
			borderColor: currentTheme.border,
			borderWidth: 1,
			radius: currentTheme.radiusLarge,
			child: new VStack({
				gap: 10,
				children: [title, subtitle, new Divider({ direction: "horizontal" }), settingsList],
			}),
		});

		activeOverlayKind = "settings";
		activeOverlay = app.showOverlay(modalBox, {
			anchor: "center",
			width: 500,
			maxHeight: 420,
			radius: currentTheme.radiusLarge,
			shadow: "lg",
			modal: true,
			dismissOnEscape: true,
			dismissOnBackdropClick: true,
			onDismiss: () => {
				activeOverlay = undefined;
				activeOverlayKind = undefined;
				app.setFocus(editor);
				app.invalidate();
			},
		});
	};

	const toggleTheme = () => {
		app.setTheme(currentTheme.dark ? lightGuiTheme : darkGuiTheme);
	};

	const cycleThinkingLevel = () => {
		const status = controller.getStatus();
		const levels = status.availableThinkingLevels;
		if (levels.length <= 1) {
			const current = levels[0] ?? "off";
			appendCard(
				createBannerCard(
					currentTheme,
					"Thinking Level",
					`Active model supports only thinking level "${current}".`,
					"notice",
				),
			);
			return;
		}
		const idx = levels.indexOf(status.thinkingLevel);
		const next = levels[(idx + 1) % levels.length] ?? levels[0] ?? "off";
		controller.setThinkingLevel(next);
		updateHeaderFromStatus(controller.getStatus());
	};

	const handleNewSession = async () => {
		try {
			const res = await controller.newSession();
			if (!res.cancelled && controller.getStatus().isStreaming === false) {
				updateHeaderFromStatus(controller.getStatus());
			}
		} catch (err) {
			appendCard(
				createBannerCard(
					currentTheme,
					"New Session Error",
					err instanceof Error ? err.message : String(err),
					"error",
				),
			);
		}
	};

	const handleClearMessages = () => {
		controller.clearMessages();
	};

	const handleStop = async () => {
		try {
			await controller.abort();
		} catch (err) {
			appendCard(
				createBannerCard(
					currentTheme,
					"Abort Error",
					err instanceof Error ? err.message : String(err),
					"error",
				),
			);
		}
	};

	const requestQuit = () => {
		if (options.onRequestQuit) {
			options.onRequestQuit();
		} else {
			app.stop();
		}
	};

	const handleSlashCommand = async (rawCommand: string): Promise<void> => {
		const withoutSlash = rawCommand.slice(1).trim();
		const spaceIdx = withoutSlash.search(/\s/);
		const cmd = (spaceIdx >= 0 ? withoutSlash.slice(0, spaceIdx) : withoutSlash).toLowerCase();
		const arg = spaceIdx >= 0 ? withoutSlash.slice(spaceIdx + 1).trim() : "";

		switch (cmd) {
			case "new":
				await handleNewSession();
				return;

			case "clear":
				handleClearMessages();
				return;

			case "model": {
				if (arg.length === 0) {
					openModelPicker();
					return;
				}
				const q = arg.toLowerCase();
				const match = controller
					.getAvailableModels()
					.find(
						(m) =>
							m.label.toLowerCase() === q ||
							m.id.toLowerCase() === q ||
							m.label.toLowerCase().includes(q),
					);
				if (!match) {
					appendCard(
						createBannerCard(currentTheme, "Model Not Found", `No available model matching "${arg}".`, "error"),
					);
					return;
				}
				await controller.selectModel(match.provider, match.id);
				appendCard(createBannerCard(currentTheme, "Model Switched", `Active model: ${match.label}`, "notice"));
				return;
			}

			case "thinking": {
				if (arg.length === 0) {
					cycleThinkingLevel();
					return;
				}
				const normalized = arg.toLowerCase();
				if (!isValidThinkingArg(normalized)) {
					appendCard(
						createBannerCard(
							currentTheme,
							"Invalid Thinking Level",
							`Unknown thinking level "${arg}". Use off, low, medium, or high.`,
							"error",
						),
					);
					return;
				}
				controller.setThinkingLevel(normalized);
				updateHeaderFromStatus(controller.getStatus());
				appendCard(
					createBannerCard(
						currentTheme,
						"Thinking Level",
						`Thinking level set to "${controller.getStatus().thinkingLevel}".`,
						"notice",
					),
				);
				return;
			}

			case "theme": {
				const normalized = arg.toLowerCase();
				if (normalized === "dark") {
					app.setTheme(darkGuiTheme);
				} else if (normalized === "light") {
					app.setTheme(lightGuiTheme);
				} else if (normalized.length === 0) {
					toggleTheme();
				} else {
					appendCard(
						createBannerCard(
							currentTheme,
							"Unknown Theme",
							`Unsupported theme "${arg}". Use dark or light.`,
							"error",
						),
					);
					return;
				}
				return;
			}

			case "quit":
			case "exit":
				requestQuit();
				return;

			default:
				appendCard(
					createBannerCard(
						currentTheme,
						"Unknown Command",
						`Unknown command "/${cmd}". Available: /new, /clear, /model, /thinking, /theme, /quit`,
						"error",
					),
				);
		}
	};

	const submitText = async (rawText: string): Promise<void> => {
		if (disposed) return;
		const trimmed = rawText.trim();
		if (trimmed.length === 0) return;

		if (trimmed.startsWith("/")) {
			await handleSlashCommand(trimmed);
			return;
		}

		try {
			await controller.prompt(trimmed);
		} catch (err) {
			appendCard(
				createBannerCard(
					currentTheme,
					"Request Error",
					err instanceof Error ? err.message : String(err),
					"error",
				),
			);
			updateHeaderFromStatus(controller.getStatus());
		}
	};

	const onControllerEvent = (event: GuiControllerEvent) => {
		if (disposed) return;

		switch (event.type) {
			case "status_changed":
				if (event.status) {
					updateHeaderFromStatus(event.status);
				} else {
					updateHeaderFromStatus(controller.getStatus());
				}
				break;

			case "user_message":
				if (event.text) {
					appendCard(createUserMessageCard(currentTheme, event.text));
				}
				break;

			case "assistant_start":
				activeAssistantCard = createAssistantMessageCard(currentTheme);
				activeAssistantCard.update({
					text: event.text ?? "",
					thinking: event.thinking ?? "",
					ended: false,
				});
				appendCard(activeAssistantCard);
				break;

			case "assistant_update":
				if (!activeAssistantCard) {
					activeAssistantCard = createAssistantMessageCard(currentTheme);
					appendCard(activeAssistantCard);
				}
				activeAssistantCard.update({
					text: event.text ?? "",
					thinking: event.thinking ?? "",
					ended: false,
				});
				if (autoScrollEnabled && scrollView.isFollowingEnd()) {
					scrollView.scrollToEnd();
				}
				app.invalidate();
				break;

			case "assistant_end":
				if (!activeAssistantCard) {
					activeAssistantCard = createAssistantMessageCard(currentTheme);
					appendCard(activeAssistantCard);
				}
				activeAssistantCard.update({
					text: event.text ?? "",
					thinking: event.thinking ?? "",
					stopReason: event.stopReason ?? "stop",
					errorMessage: event.errorMessage ?? "",
					ended: true,
				});
				if (activeAssistantCard.isEmpty()) {
					messagesStack.removeChild(activeAssistantCard.root);
					const cardIdx = cards.indexOf(activeAssistantCard);
					if (cardIdx >= 0) cards.splice(cardIdx, 1);
				}
				activeAssistantCard = undefined;
				if (autoScrollEnabled && scrollView.isFollowingEnd()) {
					scrollView.scrollToEnd();
				}
				app.invalidate();
				break;

			case "tool_start": {
				const toolCallId = event.toolCallId ?? `tool-${Date.now()}`;
				const card = createToolExecutionCard(
					currentTheme,
					event.toolName ?? "tool",
					event.argsText ?? "",
				);
				activeToolCards.set(toolCallId, card);
				appendCard(card);
				break;
			}

			case "tool_update": {
				const toolCallId = event.toolCallId ?? "";
				const card = activeToolCards.get(toolCallId);
				if (card) {
					card.update({
						argsText: event.argsText,
						outputText: event.outputText,
						ended: false,
					});
					if (autoScrollEnabled && scrollView.isFollowingEnd()) {
						scrollView.scrollToEnd();
					}
					app.invalidate();
				}
				break;
			}

			case "tool_end": {
				const toolCallId = event.toolCallId ?? "";
				const card = activeToolCards.get(toolCallId);
				if (card) {
					card.update({
						outputText: event.outputText,
						ended: true,
						isError: event.isError ?? false,
						durationMs: event.durationMs,
					});
					activeToolCards.delete(toolCallId);
					if (autoScrollEnabled && scrollView.isFollowingEnd()) {
						scrollView.scrollToEnd();
					}
					app.invalidate();
				}
				break;
			}

			case "error":
				appendCard(
					createBannerCard(
						currentTheme,
						"Error",
						event.errorMessage ?? "An unexpected error occurred.",
						"error",
					),
				);
				break;

			case "session_reset":
				resetConversation(event.resetReason ?? "new");
				break;
		}
	};

	const unsubscribeController = controller.subscribe(onControllerEvent);

	const menus: readonly MenuSpec[] = [
		{
			title: "App",
			items: [
				{ kind: "action", label: "About", role: "about" },
				{ kind: "separator" },
				{ kind: "action", label: "Settings", shortcut: "mod+,", onSelect: () => openSettings() },
				{ kind: "action", label: "Toggle Theme", shortcut: "mod+t", onSelect: () => toggleTheme() },
				{ kind: "separator" },
				{ kind: "action", label: "Quit", shortcut: "mod+q", role: "quit", onSelect: () => requestQuit() },
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
						void handleNewSession();
					},
				},
				{ kind: "action", label: "Switch Model", shortcut: "mod+k", onSelect: () => openModelPicker() },
				{ kind: "action", label: "Clear Messages", shortcut: "mod+l", onSelect: () => handleClearMessages() },
				{ kind: "separator" },
				{
					kind: "action",
					label: "Stop Generation",
					onSelect: () => {
						void handleStop();
					},
				},
			],
		},
		{
			title: "Edit",
			items: [
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
				{ kind: "action", label: "Minimize", shortcut: "mod+m", role: "minimize" },
				{ kind: "action", label: "Zoom", role: "zoom" },
				{ kind: "separator" },
				{ kind: "action", label: "Close", shortcut: "mod+w", role: "close" },
			],
		},
	];

	app.setAppMenu(menus);
	app.setRoot(rootBox);
	app.setFocus(editor);
	app.invalidate();

	if (options.initialPrompt && options.initialPrompt.trim().length > 0) {
		const initialPrompt = options.initialPrompt;
		queueMicrotask(() => {
			if (!disposed) {
				void submitText(initialPrompt);
			}
		});
	}

	return {
		app,
		controller,
		headerTitle,
		workspaceBadge,
		providerBadge,
		cwdIndicator,
		modelButton,
		thinkingButton,
		newSessionButton,
		themeButton,
		settingsButton,
		statusLoader,
		scrollView,
		messagesStack,
		editor,
		sendButton,
		stopButton,
		menus,
		openModelPicker,
		openSettings,
		closeOverlay,
		hasActiveOverlay: () => activeOverlay !== undefined,
		toggleTheme,
		submitText,
		async dispose() {
			if (disposed) return;
			disposed = true;
			closeOverlay();
			statusLoader.stop();
			unsubscribeController();
			await controller.dispose();
		},
	};
}
