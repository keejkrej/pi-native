import { basename } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { darkGuiTheme, GuiApp, type GuiBackend, type GuiTheme, HeadlessBackend, lightGuiTheme } from "scriptc-ui";
import { createNativeBackend } from "scriptc-ui/native";
import type { AgentSessionRuntime, AgentSessionRuntimeDiagnostic } from "../../core/agent-session-runtime.ts";
import { resolveThemeSetting, stopThemeWatcher } from "../interactive/theme/theme.ts";
import { createGuiControllerFromRuntime, type RealGuiSessionController } from "./controller.ts";
import { loadGuiLayoutPreferences } from "./git-utils.ts";
import { mountPiGui, type PiGuiHandle } from "./gui-mode.ts";
import type { GuiAttachmentItem, GuiThemePreference } from "./types.ts";

/**
 * Options passed by main.ts when launching `pi --gui` / `pi --mode gui`.
 */
export interface RunGuiModeOptions {
	readonly migratedProviders?: readonly string[];
	readonly startupDiagnostics?: readonly AgentSessionRuntimeDiagnostic[];
	readonly modelFallbackMessage?: string;
	readonly autoTrustOnReloadCwd?: string;
	readonly initialMessage?: string;
	readonly initialImages?: readonly ImageContent[];
	readonly initialMessages?: readonly string[];
	readonly verbose?: boolean;
	readonly initialThemeSetting?: string;
	readonly noSession?: boolean;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveGuiThemes(
	initialThemeSetting: string | undefined,
	appearance: "system" | "dark" | "light",
): { appTheme: GuiTheme | "auto"; uiPreference: GuiThemePreference | undefined } {
	const resolvedSetting = resolveThemeSetting(initialThemeSetting, appearance === "light" ? "light" : "dark");
	const effective = resolvedSetting?.trim().toLowerCase() ?? appearance;

	if (effective === "light") {
		return { appTheme: lightGuiTheme, uiPreference: "light" };
	}
	if (effective === "dark") {
		return { appTheme: darkGuiTheme, uiPreference: "dark" };
	}
	return { appTheme: "auto", uiPreference: undefined };
}

function convertInitialImagesToAttachments(images: readonly ImageContent[] | undefined): GuiAttachmentItem[] {
	if (!images || images.length === 0) return [];
	const attachments: GuiAttachmentItem[] = [];
	for (let i = 0; i < images.length; i++) {
		const image = images[i];
		if (!image) continue;
		attachments.push({
			id: `initial-img-${i + 1}`,
			kind: "image",
			name: `image-${i + 1}`,
			mimeType: image.mimeType,
			base64Data: image.data,
		});
	}
	return attachments;
}

function formatWindowTitle(cwd: string): string {
	const name = basename(cwd);
	return name.length > 0 ? `pi — ${name}` : `pi — ${cwd}`;
}

async function sleepMs(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function runHeadlessSmokeLoop(app: GuiApp, handle: PiGuiHandle): Promise<void> {
	app.renderFrame();
	app.step(16);
	const metrics = app.getWindowMetrics();
	if (metrics.width <= 0 || metrics.height <= 0) {
		throw new Error("GUI headless smoke failed: invalid window metrics");
	}
	if (handle.menus.length === 0) {
		throw new Error("GUI headless smoke failed: native menu spec not initialized");
	}
	app.stop();
}

async function runNativeSmokeLoop(app: GuiApp): Promise<void> {
	app.renderFrame();
	for (let frame = 0; frame < 20; frame++) {
		app.step(12);
		await sleepMs(12);
	}
	const metrics = app.getWindowMetrics();
	if (metrics.width <= 0 || metrics.height <= 0) {
		throw new Error("GUI native smoke failed: invalid window metrics");
	}
	app.stop();
}

/**
 * Launch the desktop GUI mode backed by an active AgentSessionRuntime.
 */
export async function runGuiMode(runtime: AgentSessionRuntime, options: RunGuiModeOptions = {}): Promise<void> {
	const headlessSmoke = isTruthyEnvFlag(process.env.PI_GUI_HEADLESS_SMOKE);
	const nativeSmoke = isTruthyEnvFlag(process.env.PI_GUI_NATIVE_SMOKE);

	const layout = loadGuiLayoutPreferences(runtime.services.agentDir);
	const { appTheme, uiPreference } = resolveGuiThemes(options.initialThemeSetting, layout.appearance);
	const initialAttachments = convertInitialImagesToAttachments(options.initialImages);

	const backend: GuiBackend = headlessSmoke ? new HeadlessBackend({ width: 1280, height: 840 }) : createNativeBackend();
	let app: GuiApp | undefined;
	let handle: PiGuiHandle | undefined;
	let controller: RealGuiSessionController | undefined;

	try {
		app = new GuiApp({
			backend,
			theme: appTheme,
			window: {
				title: formatWindowTitle(runtime.cwd),
				width: 1280,
				height: 840,
				resizable: true,
			},
			frameIntervalMs: nativeSmoke ? 12 : 8,
		});

		const activeApp = app;
		controller = await createGuiControllerFromRuntime(runtime, {
			layoutPreferences: layout,
			persistLayout: !headlessSmoke && !nativeSmoke && !options.noSession,
			onShutdownRequested: () => {
				activeApp.stop();
			},
		});

		const isSmoke = headlessSmoke || nativeSmoke;
		const hasInitialImages = initialAttachments.length > 0;
		handle = mountPiGui(activeApp, {
			controller,
			initialTheme: uiPreference,
			initialPrompt: isSmoke || hasInitialImages ? undefined : options.initialMessage,
			initialAttachments: isSmoke ? undefined : initialAttachments,
			startupDiagnostics: options.startupDiagnostics,
			onRequestQuit: () => {
				activeApp.stop();
			},
		});

		if (headlessSmoke) {
			await runHeadlessSmokeLoop(activeApp, handle);
			process.exitCode = 0;
			return;
		}

		if (nativeSmoke) {
			await runNativeSmokeLoop(activeApp);
			process.exitCode = 0;
			return;
		}

		if (hasInitialImages && ((options.initialMessage && options.initialMessage.trim().length > 0) || initialAttachments.length > 0)) {
			void controller.sendUserMessage(options.initialMessage ?? "", { attachments: initialAttachments });
		}
		if (options.initialMessages && options.initialMessages.length > 0) {
			for (const message of options.initialMessages) {
				if (message.trim().length > 0) {
					void controller.sendUserMessage(message, { deliverAs: "followUp" });
				}
			}
		}

		await activeApp.run();
	} finally {
		if (handle) {
			await handle.dispose();
		}
		if (controller) {
			await controller.dispose();
		} else {
			await runtime.dispose();
		}
		if (app) {
			app.dispose();
		} else {
			backend.shutdown();
		}
		stopThemeWatcher();
	}
}
