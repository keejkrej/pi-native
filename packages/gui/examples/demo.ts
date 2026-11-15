/**
 * Interactive scriptc-ui demo showcasing native windowing, layouts, Markdown, Editor, overlays, and menus.
 *
 * Modes:
 *   --headless-smoke   Run deterministic headless UI interactions without opening a native window
 *   --native-smoke     Compile/link with native backend, create a real window, render frames, and exit cleanly
 *   (default)          Launch interactive native GUI window
 */

import {
	Badge,
	Box,
	Button,
	CombinedAutocompleteProvider,
	Divider,
	darkGuiTheme,
	Editor,
	GuiApp,
	type GuiTheme,
	HeadlessBackend,
	HStack,
	Image,
	Input,
	Loader,
	lightGuiTheme,
	Markdown,
	type MenuSpec,
	type OverlayHandle,
	SGUI_FONT_MONO,
	ScrollView,
	SettingsList,
	Spacer,
	Text,
	VStack,
	withAlpha,
} from "../src/index.ts";
import { createNativeBackend } from "../src/native.ts";

function makeCheckerboardIcon(size: number): Uint8Array {
	const pixels = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const idx = (y * size + x) * 4;
			const diag = ((x + y) / (size * 2)) * 255;
			pixels[idx] = Math.round(70 + diag * 0.6);
			pixels[idx + 1] = Math.round(130 + ((x * 255) / size) * 0.4);
			pixels[idx + 2] = 245;
			pixels[idx + 3] = 255;
		}
	}
	return pixels;
}

function buildDemoUi(app: GuiApp): {
	statusText: Text;
	messagesStack: VStack;
	scrollView: ScrollView;
	editor: Editor;
	sendButton: Button;
	settingsButton: Button;
	themeToggleCount: { value: number };
	sentMessages: string[];
} {
	const sentMessages: string[] = [];
	const themeToggleCount = { value: 0 };

	const statusText = new Text({
		text: "Ready (TypeScript -> native binary via scriptc)",
		fontSize: 11.5,
		color: app.getTheme().textMuted,
	});

	const icon = new Image({
		width: 16,
		height: 16,
		displayWidth: 28,
		displayHeight: 28,
		radius: 7,
		pixels: makeCheckerboardIcon(16),
	});

	const titleText = new Text({
		text: "scriptc-ui Native Workspace",
		fontSize: 16.5,
		fontWeight: 700,
	});

	const nativeBadge = new Badge({
		label: "NATIVE",
		variant: "accent",
		leadingIcon: "sparkles",
		fontSize: 10,
	});

	const loader = new Loader({ message: "Idle", size: 13 });

	const settingsButton = new Button({
		label: "Settings",
		leadingIcon: "sliders",
		iconSize: 13,
		variant: "secondary",
		fontSize: 12.5,
		padding: { top: 6, right: 11, bottom: 6, left: 11 },
	});

	const themeButton = new Button({
		label: "Toggle Theme",
		leadingIcon: app.getTheme().dark ? "sun" : "moon",
		iconSize: 13,
		variant: "ghost",
		fontSize: 12.5,
		padding: { top: 6, right: 10, bottom: 6, left: 10 },
	});

	const headerBar = new Box({
		padding: { top: 10, right: 18, bottom: 10, left: 18 },
		background: app.getTheme().surface,
		child: new Box({
			maxWidth: 760,
			fillWidth: true,
			alignHorizontal: "center",
			child: new HStack({
				gap: 10,
				align: "center",
				children: [
					icon,
					{ child: new VStack({ gap: 2, children: [titleText, statusText] }), grow: 1 },
					nativeBadge,
					loader,
					themeButton,
					settingsButton,
				],
			}),
		}),
	});
	const headerDivider = new Divider({});

	const welcomeTitle = new Text({
		text: "Welcome to scriptc-ui",
		fontSize: 15,
		fontWeight: 700,
	});
	const welcomeBadge = new Badge({
		label: "QUICK START",
		variant: "accent",
		leadingIcon: "terminal",
		fontSize: 10,
	});
	const welcomeDivider = new Divider({});
	const welcomeMarkdown = new Markdown(
		[
			"Pure TypeScript UI compiled directly to native machine code using `scriptc`.",
			"",
			"- Native OS 2D canvas & CoreText / Pango / DirectWrite text",
			"- Composable `VStack`, `HStack`, `ScrollView`, `VirtualList`, `Editor`, and `Markdown`",
			"- Zero Chromium or WebView runtime overhead (`Enter` sends · `/cmd` completes)",
			"",
			"```ts",
			'const btn = new Button({ label: "Send", leadingIcon: "send", variant: "primary" });',
			"```",
		].join("\n"),
	);

	const welcomeCard = new Box({
		padding: 16,
		background: app.getTheme().surface,
		borderColor: app.getTheme().border,
		borderWidth: 1,
		radius: 14,
		shadow: "sm",
		child: new VStack({
			gap: 10,
			align: "stretch",
			children: [
				new HStack({
					gap: 8,
					align: "center",
					children: [
						welcomeBadge,
						{ child: welcomeTitle, grow: 1 },
					],
				}),
				welcomeDivider,
				welcomeMarkdown,
			],
		}),
	});

	const messageCards: Array<{ card: Box; metaText: Text }> = [];

	const messagesStack = new VStack({
		gap: 12,
		align: "stretch",
		children: [welcomeCard],
	});

	const transcriptColumn = new Box({
		maxWidth: 760,
		fillWidth: true,
		alignHorizontal: "center",
		padding: { top: 16, right: 20, bottom: 14, left: 20 },
		child: messagesStack,
	});

	const scrollView = new ScrollView({
		child: transcriptColumn,
		follow: "end",
		primary: true,
	});

	const autocomplete = new CombinedAutocompleteProvider(
		[
			{ name: "clear", description: "Clear conversation messages" },
			{ name: "help", description: "Show keyboard shortcuts" },
			{ name: "theme", description: "Toggle dark or light appearance" },
		],
		process.cwd(),
		false,
	);

	const submitMessage = (rawText: string): void => {
		const trimmed = rawText.trim();
		if (trimmed.length === 0) return;

		if (trimmed === "/clear") {
			messagesStack.clear();
			messageCards.length = 0;
			statusText.setText("Cleared messages");
			return;
		}
		if (trimmed === "/theme") {
			const next = app.getTheme().dark ? lightGuiTheme : darkGuiTheme;
			app.setTheme(next);
			syncTheme();
			statusText.setText(`Switched to ${next.dark ? "dark" : "light"} theme`);
			return;
		}

		sentMessages.push(trimmed);
		const t = app.getTheme();
		const msgIdxText = new Text({
			text: `#${sentMessages.length}`,
			fontSize: 11,
			fontFamily: SGUI_FONT_MONO,
			color: t.textMuted,
		});
		const msgCard = new Box({
			padding: { top: 12, right: 14, bottom: 12, left: 14 },
			background: t.surface,
			borderColor: withAlpha(t.accent, 0.35),
			borderWidth: 1,
			radius: 14,
			shadow: "sm",
			child: new VStack({
				gap: 6,
				align: "stretch",
				children: [
					new HStack({
						gap: 8,
						align: "center",
						children: [
							new Badge({ label: "YOU", variant: "accent", fontSize: 10 }),
							{ child: new Spacer(), grow: 1 },
							msgIdxText,
						],
					}),
					new Markdown(trimmed),
				],
			}),
		});
		messageCards.push({ card: msgCard, metaText: msgIdxText });
		messagesStack.addChild(msgCard);
		statusText.setText(`Messages: ${sentMessages.length}`);
		scrollView.scrollToEnd();
	};

	const editor = new Editor({
		placeholder: "Type a message or /command...",
		minHeight: 50,
		maxHeight: 150,
		clearOnSubmit: true,
		autocompleteProvider: autocomplete,
		onSubmit: submitMessage,
	});

	const quickInput = new Input({
		placeholder: "Quick status tag...",
		onSubmit: (value) => {
			statusText.setText(`Tag: ${value}`);
		},
	});

	const sendButton = new Button({
		label: "Send",
		leadingIcon: "send",
		iconSize: 13,
		variant: "primary",
		padding: { top: 8, right: 14, bottom: 8, left: 14 },
		onClick: () => {
			const text = editor.getText();
			if (text.trim().length > 0) {
				editor.setText("");
				submitMessage(text);
			}
		},
	});

	settingsButton.onClick = () => {
		let handleRef: OverlayHandle | undefined;
		const settings = new SettingsList({
			enableSearch: true,
			items: [
				{
					id: "theme",
					label: "Appearance",
					currentValue: app.getTheme().dark ? "dark" : "light",
					values: ["dark", "light"],
				},
				{
					id: "follow",
					label: "Auto-scroll to bottom",
					currentValue: scrollView.isFollowingEnd() ? "true" : "false",
					values: ["true", "false"],
				},
			],
			onChange: (id, value) => {
				if (id === "theme") {
					app.setTheme(value === "dark" ? darkGuiTheme : lightGuiTheme);
					syncTheme();
				} else if (id === "follow") {
					scrollView.setFollowMode(value === "true" ? "end" : "none");
				}
			},
			onCancel: () => {
				handleRef?.hide();
			},
		});
		const modalBox = new Box({
			padding: 18,
			background: app.getTheme().surfaceElevated,
			borderColor: app.getTheme().border,
			borderWidth: 1,
			radius: 14,
			shadow: "lg",
			child: new VStack({
				gap: 12,
				align: "stretch",
				children: [
					new Text({ text: "Workspace Settings", fontSize: 16, fontWeight: 700 }),
					new Divider({}),
					settings,
					new HStack({
						gap: 8,
						children: [
							{ child: new Spacer(), grow: 1 },
							new Button({
								label: "Close",
								variant: "secondary",
								onClick: () => handleRef?.hide(),
							}),
						],
					}),
				],
			}),
		});
		handleRef = app.showOverlay(modalBox, {
			modal: true,
			anchor: "center",
			width: 440,
		});
	};

	const hintText = new Text({
		text: "Enter send · /cmd",
		fontSize: 11,
		fontFamily: SGUI_FONT_MONO,
	});
	const composerDivider = new Divider({});
	const composerCard = new Box({
		padding: 12,
		background: app.getTheme().surface,
		borderColor: app.getTheme().border,
		borderWidth: 1,
		radius: 14,
		shadow: "sm",
		child: new VStack({
			gap: 8,
			align: "stretch",
			children: [
				new HStack({
					gap: 10,
					align: "center",
					children: [
						{ child: quickInput, grow: 1 },
						hintText,
					],
				}),
				composerDivider,
				new HStack({
					gap: 10,
					align: "end",
					children: [
						{ child: editor, grow: 1 },
						sendButton,
					],
				}),
			],
		}),
	});

	const composerWrap = new Box({
		padding: { top: 4, right: 20, bottom: 14, left: 20 },
		child: new Box({
			maxWidth: 760,
			fillWidth: true,
			alignHorizontal: "center",
			child: composerCard,
		}),
	});

	const rootStack = new VStack({
		gap: 0,
		align: "stretch",
		children: [
			headerBar,
			headerDivider,
			{ child: scrollView, grow: 1, shrink: 1, minSize: 120 },
			composerWrap,
		],
	});

	const root = new Box({
		background: app.getTheme().background,
		child: rootStack,
	});

	function syncTheme(): void {
		const t: GuiTheme = app.getTheme();
		root.setBackground(t.background);
		composerWrap.setBackground(t.background);

		headerBar.setBackground(t.surface);
		headerDivider.setColor(t.border);
		titleText.setColor(t.text);
		statusText.setColor(t.textMuted);
		themeButton.setLeadingIcon(t.dark ? "sun" : "moon");

		welcomeCard.setBackground(t.surface);
		welcomeCard.setBorder(t.border, 1, 14);
		welcomeTitle.setColor(t.text);
		welcomeDivider.setColor(t.border);

		for (let i = 0; i < messageCards.length; i += 1) {
			const entry = messageCards[i]!;
			entry.card.setBackground(t.surface);
			entry.card.setBorder(withAlpha(t.accent, 0.35), 1, 14);
			entry.metaText.setColor(t.textMuted);
		}

		composerCard.setBackground(t.surface);
		composerCard.setBorder(t.border, 1, 14);
		composerDivider.setColor(t.border);
		hintText.setColor(t.textMuted);
		app.invalidate();
	}

	themeButton.onClick = () => {
		themeToggleCount.value += 1;
		const next = app.getTheme().dark ? lightGuiTheme : darkGuiTheme;
		app.setTheme(next);
		syncTheme();
	};

	const menus: readonly MenuSpec[] = [
		{
			title: "scriptc-ui",
			items: [
				{ kind: "action", label: "About scriptc-ui", role: "about" },
				{ kind: "separator" },
				{ kind: "action", label: "Toggle Theme", shortcut: "mod+t", onSelect: () => themeButton.onClick?.() },
				{ kind: "separator" },
				{ kind: "action", label: "Hide", shortcut: "mod+h", role: "hide" },
				{ kind: "action", label: "Quit", shortcut: "mod+q", role: "quit", onSelect: () => app.stop() },
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
				{ kind: "action", label: "Close", shortcut: "mod+w", role: "close" },
			],
		},
	];

	syncTheme();
	app.setAppMenu(menus);
	app.setRoot(root);
	app.setFocus(editor);

	return {
		statusText,
		messagesStack,
		scrollView,
		editor,
		sendButton,
		settingsButton,
		themeToggleCount,
		sentMessages,
	};
}

function runHeadlessSmoke(): void {
	const backend = new HeadlessBackend({ width: 960, height: 640, darkMode: true, platform: "darwin" });
	const app = new GuiApp({
		backend,
		window: { title: "scriptc-ui Smoke", width: 960, height: 640 },
	});
	const ui = buildDemoUi(app);
	app.renderFrame();

	// Type slash autocomplete and submit
	backend.insertText("/th");
	app.step(0);
	const suggestions = ui.editor.getAutocompleteItems();
	if (suggestions.length === 0 || suggestions[0]?.value !== "theme") {
		throw new Error(`Expected autocomplete suggestion "theme", got ${JSON.stringify(suggestions)}`);
	}
	backend.pressKey("enter");
	app.step(0);
	backend.pressKey("enter");
	app.step(0);

	// Now type a regular message and click Send
	backend.insertText("Hello from native TypeScript GUI!");
	app.step(0);
	const sendRect = ui.sendButton.layoutRect;
	backend.click(sendRect.x + sendRect.width * 0.5, sendRect.y + sendRect.height * 0.5);
	app.step(0);

	if (ui.sentMessages.length !== 1 || ui.sentMessages[0] !== "Hello from native TypeScript GUI!") {
		throw new Error(`Expected sent message, got ${JSON.stringify(ui.sentMessages)}`);
	}

	// Trigger Settings overlay and dismiss with Escape
	const settingsRect = ui.settingsButton.layoutRect;
	backend.click(settingsRect.x + settingsRect.width * 0.5, settingsRect.y + settingsRect.height * 0.5);
	app.step(0);
	backend.pressKey("escape");
	app.step(0);

	const renderedTexts = backend.getRenderedTexts(app.windowId);
	if (!renderedTexts.some((t) => t.includes("scriptc-ui Native Workspace"))) {
		throw new Error("Expected rendered title text in draw stream");
	}
	console.log(
		JSON.stringify({
			ok: true,
			mode: "headless-smoke",
			frames: backend.getFrameCount(app.windowId),
			sent: ui.sentMessages.length,
		}),
	);
	app.dispose();
}

function runNativeSmoke(): void {
	const backend = createNativeBackend();
	const app = new GuiApp({
		backend,
		window: { title: "scriptc-ui Native Smoke", width: 800, height: 560, resizable: true },
	});
	buildDemoUi(app);
	const frame = app.renderFrame();
	app.step(5);
	const metrics = app.getWindowMetrics();
	if (metrics.width <= 0 || metrics.height <= 0 || frame.byteLength === 0) {
		app.dispose();
		throw new Error("Invalid native window metrics or empty frame");
	}
	console.log(
		JSON.stringify({
			ok: true,
			mode: "native-smoke",
			width: metrics.width,
			height: metrics.height,
			frameBytes: frame.byteLength,
		}),
	);
	app.dispose();
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--headless-smoke")) {
		runHeadlessSmoke();
		return;
	}
	if (args.includes("--native-smoke")) {
		runNativeSmoke();
		return;
	}
	const backend = createNativeBackend();
	const app = new GuiApp({
		backend,
		window: { title: "scriptc-ui Demo", width: 1024, height: 720, resizable: true },
	});
	buildDemoUi(app);
	try {
		await app.run();
	} finally {
		app.dispose();
	}
}

void main();
