import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@pi-ts/ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import type { ExtensionFactory } from "../src/index.ts";
import { resolveAppMode } from "../src/main.ts";
import { createGuiControllerFromRuntime, MockGuiSessionController } from "../src/modes/gui/controller.ts";
import {
	checkoutBranch,
	createBranch,
	detectExternalOpeners,
	getDefaultGuiLayoutPreferences,
	getGitBranches,
	getGitStatus,
	loadGuiLayoutPreferences,
	parseUnifiedDiff,
	readWorkspaceFilePreview,
	saveGuiLayoutPreferences,
	scanWorkspaceFiles,
	stageAndCommitChanges,
} from "../src/modes/gui/git-utils.ts";
import { runGuiMode } from "../src/modes/index.ts";

describe("gui-controller-core", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	function createTempDir(prefix: string): string {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
		cleanups.push(() => {
			if (existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		});
		return dir;
	}

	function runGit(cwd: string, args: string[]): string {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "Test User",
				GIT_AUTHOR_EMAIL: "test@example.com",
				GIT_COMMITTER_NAME: "Test User",
				GIT_COMMITTER_EMAIL: "test@example.com",
			},
		});
	}

	async function createFauxRuntime(extensionFactory?: ExtensionFactory) {
		const tempDir = createTempDir("pi-gui-runtime-");
		const workspaceDir = join(tempDir, "workspace");
		mkdirSync(workspaceDir, { recursive: true });
		writeFileSync(join(workspaceDir, "hello.ts"), "export const x = 1;\n", "utf8");

		const faux = registerFauxProvider();
		faux.setResponses([
			fauxAssistantMessage("First GUI reply"),
			fauxAssistantMessage("Second GUI reply"),
			fauxAssistantMessage("Third GUI reply"),
		]);

		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(tempDir, "models.json"),
		});
		const model = faux.getModel();
		modelRuntime.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [
				{
					id: model.id,
					name: model.name,
					api: model.api,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
			],
		});

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				agentDir: tempDir,
				cwd,
				modelRuntime,
				resourceLoaderOptions: {
					extensionFactories: extensionFactory ? [extensionFactory] : [],
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
				},
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: workspaceDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(workspaceDir, join(tempDir, "sessions")),
		});
		await runtime.session.bindExtensions({});

		cleanups.push(async () => {
			await runtime.dispose();
			faux.unregister();
		});

		return { runtime, tempDir, workspaceDir, faux };
	}

	describe("resolveAppMode", () => {
		it("preserves gui mode even when stdin and stdout are not TTYs", () => {
			const guiFlagArgs = parseArgs(["--gui"]);
			expect(guiFlagArgs.gui).toBe(true);
			expect(resolveAppMode(guiFlagArgs, false, false)).toBe("gui");
			expect(resolveAppMode(guiFlagArgs, true, false)).toBe("gui");

			const modeGuiArgs = parseArgs(["--mode", "gui"]);
			expect(modeGuiArgs.mode).toBe("gui");
			expect(resolveAppMode(modeGuiArgs, false, false)).toBe("gui");

			const plainArgs = parseArgs(["hello"]);
			expect(resolveAppMode(plainArgs, false, false)).toBe("print");
			expect(resolveAppMode(plainArgs, true, true)).toBe("interactive");
		});
	});

	describe("git-utils", () => {
		it("parses unified diffs with line numbers and counts", () => {
			const parsed = parseUnifiedDiff(
				[
					"diff --git a/foo.ts b/foo.ts",
					"index 1111111..2222222 100644",
					"--- a/foo.ts",
					"+++ b/foo.ts",
					"@@ -10,4 +10,5 @@ export function foo() {",
					" const a = 1;",
					"-const b = 2;",
					"+const b = 3;",
					"+const c = 4;",
					" return a;",
					"\\ No newline at end of file",
				].join("\n"),
			);

			expect(parsed.additions).toBe(2);
			expect(parsed.deletions).toBe(1);
			expect(parsed.hunks).toHaveLength(6);
			expect(parsed.hunks[0]).toEqual({ kind: "hunk", text: "@@ -10,4 +10,5 @@ export function foo() {" });
			expect(parsed.hunks[1]).toEqual({ kind: "context", oldLine: 10, newLine: 10, text: "const a = 1;" });
			expect(parsed.hunks[2]).toEqual({ kind: "del", oldLine: 11, text: "const b = 2;" });
			expect(parsed.hunks[3]).toEqual({ kind: "add", newLine: 11, text: "const b = 3;" });
			expect(parsed.hunks[4]).toEqual({ kind: "add", newLine: 12, text: "const c = 4;" });
		});

		it("inspects non-git and git repositories including branches, diffs, and commits", async () => {
			const plainDir = createTempDir("pi-nogit-");
			const nonGit = await getGitStatus(plainDir);
			expect(nonGit.isGitRepo).toBe(false);
			expect(nonGit.changedFiles).toEqual([]);

			const repoDir = createTempDir("pi-git-");
			runGit(repoDir, ["init", "-b", "main"]);
			writeFileSync(join(repoDir, "tracked.ts"), "line1\nline2\n", "utf8");
			runGit(repoDir, ["add", "tracked.ts"]);
			runGit(repoDir, ["commit", "-m", "initial commit"]);

			writeFileSync(join(repoDir, "tracked.ts"), "line1\nline2 updated\nline3\n", "utf8");
			writeFileSync(join(repoDir, "untracked.txt"), "hello world\n", "utf8");

			const summary = await getGitStatus(repoDir);
			expect(summary.isGitRepo).toBe(true);
			expect(summary.currentBranch).toBe("main");
			expect(summary.branches).toContain("main");
			expect(summary.totalAdditions).toBe(3);
			expect(summary.totalDeletions).toBe(1);
			expect(summary.changedFiles.map((f) => f.path)).toEqual(["tracked.ts", "untracked.txt"]);

			await createBranch(repoDir, "feat/test-branch");
			const branches = await getGitBranches(repoDir);
			expect(branches).toContain("feat/test-branch");
			await checkoutBranch(repoDir, "main");
			expect((await getGitStatus(repoDir)).currentBranch).toBe("main");

			await stageAndCommitChanges(repoDir, "commit all changes");
			const cleanSummary = await getGitStatus(repoDir);
			expect(cleanSummary.changedFiles).toEqual([]);
			expect(cleanSummary.totalAdditions).toBe(0);
		});

		it("scans workspace files safely and previews UTF-8 vs binary vs out-of-bounds files", async () => {
			const dir = createTempDir("pi-files-");
			mkdirSync(join(dir, ".git"), { recursive: true });
			mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
			writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "ignored", "utf8");
			writeFileSync(join(dir, "src", "app.ts"), "line1\nline2\nline3\nline4\n", "utf8");
			writeFileSync(join(dir, "README.md"), "# Title\n", "utf8");
			writeFileSync(join(dir, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x03]));

			const entries = await scanWorkspaceFiles(dir);
			expect(entries.some((e) => e.name === ".git" || e.name === "node_modules")).toBe(false);
			expect(entries[0]?.isDir).toBe(true);
			expect(entries[0]?.relativePath).toBe("src");
			expect(entries.some((e) => e.relativePath === "src/app.ts" && e.language === "typescript")).toBe(true);

			const preview = await readWorkspaceFilePreview(dir, "src/app.ts", { maxLines: 2 });
			expect(preview.isBinary).toBe(false);
			expect(preview.truncated).toBe(true);
			expect(preview.lineCount).toBe(2);
			expect(preview.content).toBe("line1\nline2");

			const binaryPreview = await readWorkspaceFilePreview(dir, "bin.dat");
			expect(binaryPreview.isBinary).toBe(true);

			const traversal = await readWorkspaceFilePreview(dir, "../outside.txt");
			expect(traversal.error).toContain("outside workspace");
		});

		it("persists and clamps GUI layout preferences cleanly", () => {
			const agentDir = createTempDir("pi-layout-");
			const defaults = getDefaultGuiLayoutPreferences();
			expect(defaults.sidebarWidth).toBe(260);
			expect(defaults.rightPanelWidth).toBe(380);
			expect(loadGuiLayoutPreferences(agentDir)).toEqual(defaults);

			saveGuiLayoutPreferences(
				{
					...defaults,
					sidebarWidth: 300,
					rightPanelOpen: true,
					rightPanelTab: "files",
					diffViewMode: "split",
					appearance: "dark",
					pinnedSessionIds: ["s1", "s2"],
					sessionCustomNames: { s1: "Named Session" },
				},
				agentDir,
			);

			const loaded = loadGuiLayoutPreferences(agentDir);
			expect(loaded.sidebarWidth).toBe(300);
			expect(loaded.rightPanelOpen).toBe(true);
			expect(loaded.rightPanelTab).toBe("files");
			expect(loaded.diffViewMode).toBe("split");
			expect(loaded.appearance).toBe("dark");
			expect(loaded.pinnedSessionIds).toEqual(["s1", "s2"]);
			expect(loaded.sessionCustomNames).toEqual({ s1: "Named Session" });

			if (process.platform === "darwin") {
				const openers = detectExternalOpeners();
				expect(openers.some((opener) => opener.id === "finder" && opener.available)).toBe(true);
			}
		});
	});

	describe("MockGuiSessionController", () => {
		it("supports multi-session navigation, queuing/steering, layout, prompts, and workspace ops", async () => {
			const dir = createTempDir("pi-mock-layout-");
			const controller = new MockGuiSessionController({
				cwd: dir,
				stepDelayMs: 5,
				responseChunks: ["Mock ", "reply"],
			});

			const initialSnap = controller.getSnapshot();
			expect(initialSnap.sessions.length).toBeGreaterThanOrEqual(1);
			const firstSession = initialSnap.sessions[0];
			expect(firstSession).toBeDefined();

			await controller.sendUserMessage("Hello world");
			expect(controller.getTranscript().length).toBe(2);
			expect(controller.getTranscript()[0]?.role).toBe("user");
			expect(controller.getTranscript()[1]?.role).toBe("assistant");

			await controller.executeBashCommand("echo hello");
			expect(controller.getTranscript().some((entry) => entry.role === "bash")).toBe(true);

			await controller.renameSession(firstSession!.id, "Renamed Mock");
			await controller.togglePinSession(firstSession!.id);
			const updated = (await controller.getSessions()).find((s) => s.id === firstSession!.id);
			expect(updated?.title).toBe("Renamed Mock");
			expect(updated?.pinned).toBe(true);

			const created = await controller.newSession();
			expect(created.cancelled).toBe(false);
			expect(controller.canGoBack()).toBe(true);
			expect(controller.canGoForward()).toBe(false);

			expect(await controller.goBack()).toBe(true);
			expect(controller.canGoForward()).toBe(true);
			expect(await controller.goForward()).toBe(true);

			const forkResult = await controller.forkSession();
			expect(forkResult.cancelled).toBe(false);
			expect((await controller.getSessions()).length).toBe(3);

			const prefs = controller.updateLayoutPreferences({ sidebarWidth: 310, rightPanelTab: "tree" });
			expect(prefs.sidebarWidth).toBe(310);
			expect(prefs.rightPanelTab).toBe("tree");

			controller.setEditorText("draft input");
			expect(controller.getEditorText()).toBe("draft input");

			const treeEntries = controller.getTreeEntries();
			expect(Array.isArray(treeEntries)).toBe(true);
			await controller.compactSession();

			await controller.dispose();
		});
	});

	describe("RealGuiSessionController and runGuiMode", () => {
		it("hydrates transcript, handles sessions/fork/navigation, and bridges extension UI", async () => {
			let capturedNotify: ((msg: string, type?: "info" | "warning" | "error") => void) | undefined;
			let capturedConfirm: ((title: string, msg: string) => Promise<boolean>) | undefined;
			let capturedSetStatus: ((key: string, text: string | undefined) => void) | undefined;

			const extensionFactory: ExtensionFactory = (pi) => {
				pi.on("session_start", async (_event, ctx) => {
					capturedNotify = ctx.ui.notify.bind(ctx.ui);
					capturedConfirm = ctx.ui.confirm.bind(ctx.ui);
					capturedSetStatus = ctx.ui.setStatus.bind(ctx.ui);
				});
			};

			const { runtime, workspaceDir } = await createFauxRuntime(extensionFactory);
			const controller = await createGuiControllerFromRuntime(runtime, { persistLayout: false });

			expect(capturedNotify).toBeDefined();
			expect(capturedConfirm).toBeDefined();
			expect(capturedSetStatus).toBeDefined();

			capturedNotify!("Ready from extension", "info");
			capturedSetStatus!("ext-check", "active");
			const snapAfterExt = controller.getSnapshot();
			expect(snapAfterExt.toasts.some((t) => t.message === "Ready from extension")).toBe(true);
			expect(snapAfterExt.statuses.some((s) => s.key === "ext-check" && s.text === "active")).toBe(true);

			const confirmPromise = capturedConfirm!("Confirm Action", "Proceed?");
			const pendingPrompt = controller.getSnapshot().pendingPrompts[0];
			expect(pendingPrompt?.kind).toBe("confirm");
			controller.resolvePendingPrompt(pendingPrompt!.id, true);
			expect(await confirmPromise).toBe(true);

			await controller.sendUserMessage("Hi from real GUI");
			const transcript = controller.getTranscript();
			expect(transcript.some((t) => t.role === "user" && t.text === "Hi from real GUI")).toBe(true);
			expect(transcript.some((t) => t.role === "assistant" && t.text.includes("First GUI reply"))).toBe(true);
			expect(controller.getContextUsage()?.maxTokens).toBeGreaterThan(0);

			await controller.executeBashCommand("printf 'bash-ok'");
			expect(controller.getTranscript().some((t) => t.role === "bash" && t.command === "printf 'bash-ok'")).toBe(true);

			const preview = await controller.readWorkspaceFile("hello.ts");
			expect(preview.content).toContain("export const x = 1;");
			expect(preview.relativePath).toBe("hello.ts");

			const sessionsBeforeNew = await controller.getSessions();
			expect(sessionsBeforeNew.length).toBeGreaterThanOrEqual(1);
			const firstSessionFile = sessionsBeforeNew[0]?.sessionFile;
			expect(firstSessionFile).toBeTruthy();

			const newResult = await controller.newSession();
			expect(newResult.cancelled).toBe(false);
			expect(controller.getTranscript()).toEqual([]);
			expect(controller.canGoBack()).toBe(true);

			expect(await controller.goBack()).toBe(true);
			expect(controller.getTranscript().some((t) => t.text.includes("First GUI reply"))).toBe(true);
			expect(controller.getStatus().cwd).toBe(workspaceDir);

			const forkResult = await controller.forkSession();
			expect(forkResult.cancelled).toBe(false);
			expect(controller.getStatus().sessionFile).not.toBe(firstSessionFile);

			await controller.dispose();
		});

		it("runs runGuiMode in PI_GUI_HEADLESS_SMOKE=1 mode cleanly", async () => {
			const { runtime } = await createFauxRuntime();
			const prevHeadless = process.env.PI_GUI_HEADLESS_SMOKE;
			const prevExitCode = process.exitCode;
			process.env.PI_GUI_HEADLESS_SMOKE = "1";
			try {
				await runGuiMode(runtime, { noSession: true });
				expect(process.exitCode).toBe(0);
			} finally {
				if (prevHeadless === undefined) {
					delete process.env.PI_GUI_HEADLESS_SMOKE;
				} else {
					process.env.PI_GUI_HEADLESS_SMOKE = prevHeadless;
				}
				process.exitCode = prevExitCode;
			}
		});
	});
});
