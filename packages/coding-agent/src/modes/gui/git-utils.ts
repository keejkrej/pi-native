import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync, closeSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { getAgentDir } from "../../config.ts";
import type {
	GuiChangedFile,
	GuiDiffLine,
	GuiExternalOpener,
	GuiGitStatusSummary,
	GuiLayoutPreferences,
	GuiWorkspaceFileEntry,
	GuiWorkspaceFilePreview,
} from "./types.ts";

const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const MAX_DIFF_FILES = 120;
const MAX_UNTRACKED_BYTES = 32 * 1024;
const MAX_UNTRACKED_LINES = 200;
const DEFAULT_MAX_SCAN_DEPTH = 5;
const DEFAULT_MAX_SCAN_ENTRIES = 1500;
const DEFAULT_PREVIEW_BYTES = 128 * 1024;
const DEFAULT_PREVIEW_LINES = 500;

const IGNORED_WORKSPACE_DIRS = new Set<string>([
	".git",
	"node_modules",
	"dist",
	"build",
	"target",
	".next",
	".turbo",
	".cache",
	".venv",
	"__pycache__",
	"coverage",
	".DS_Store",
]);

const EXTENSION_LANGUAGES: Record<string, string | undefined> = {
	".ts": "typescript",
	".tsx": "tsx",
	".mts": "typescript",
	".cts": "typescript",
	".js": "javascript",
	".jsx": "jsx",
	".mjs": "javascript",
	".cjs": "javascript",
	".json": "json",
	".md": "markdown",
	".mdx": "markdown",
	".rs": "rust",
	".go": "go",
	".py": "python",
	".rb": "ruby",
	".sh": "bash",
	".bash": "bash",
	".zsh": "zsh",
	".css": "css",
	".scss": "scss",
	".html": "html",
	".xml": "xml",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".sql": "sql",
	".c": "c",
	".h": "c",
	".cc": "cpp",
	".cpp": "cpp",
	".hpp": "cpp",
	".swift": "swift",
	".m": "objective-c",
	".mm": "objective-cpp",
	".java": "java",
	".kt": "kotlin",
};

interface ParsedDiffBucket {
	additions: number;
	deletions: number;
	hunks: GuiDiffLine[];
	rawDiffLines: string[];
}

interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

function runProcess(command: string, args: readonly string[], cwd: string): Promise<ExecResult> {
	return new Promise((resolvePromise) => {
		let settled = false;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		const finish = (res: ExecResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolvePromise(res);
		};
		const child = spawn(command, [...args], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const timer = setTimeout(() => {
			if (settled) return;
			try {
				child.kill("SIGTERM");
			} catch {}
			finish({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: `${command} timed out after ${GIT_TIMEOUT_MS}ms`,
				exitCode: 1,
			});
		}, GIT_TIMEOUT_MS);
		if (child.stdout) {
			child.stdout.on("data", (chunk: Buffer | string) => {
				const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
				stdoutBytes += buf.length;
				if (stdoutBytes <= GIT_MAX_BUFFER) {
					stdoutChunks.push(buf);
				} else {
					try {
						child.kill("SIGTERM");
					} catch {}
					finish({
						stdout: Buffer.concat(stdoutChunks).toString("utf8"),
						stderr: `${command} stdout exceeded ${GIT_MAX_BUFFER} bytes`,
						exitCode: 1,
					});
				}
			});
		}
		if (child.stderr) {
			child.stderr.on("data", (chunk: Buffer | string) => {
				const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
				stderrBytes += buf.length;
				if (stderrBytes <= GIT_MAX_BUFFER) {
					stderrChunks.push(buf);
				}
			});
		}
		child.on("error", (err) => {
			finish({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: err.message,
				exitCode: 1,
			});
		});
		child.on("close", (code) => {
			finish({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				exitCode: typeof code === "number" ? code : 1,
			});
		});
	});
}

function assertValidBranchName(branch: string): string {
	const trimmed = branch.trim();
	if (trimmed.length === 0) {
		throw new Error("Branch name cannot be empty.");
	}
	if (trimmed.startsWith("-")) {
		throw new Error("Invalid branch name.");
	}
	return trimmed;
}

function detectLanguageFromPath(filePath: string): string | undefined {
	const ext = extname(filePath).toLowerCase();
	if (ext.length === 0) return undefined;
	return EXTENSION_LANGUAGES[ext];
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | undefined {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
	if (!match) return undefined;
	const oldStart = Number.parseInt(match[1] ?? "1", 10);
	const newStart = Number.parseInt(match[2] ?? "1", 10);
	return {
		oldStart: Number.isFinite(oldStart) ? oldStart : 1,
		newStart: Number.isFinite(newStart) ? newStart : 1,
	};
}

/**
 * Parse a single-file unified diff string into structured diff lines and counts.
 */
export function parseUnifiedDiff(rawDiff: string): {
	hunks: GuiDiffLine[];
	additions: number;
	deletions: number;
} {
	const hunks: GuiDiffLine[] = [];
	let additions = 0;
	let deletions = 0;
	let oldLine = 1;
	let newLine = 1;
	let inHunk = false;

	const lines = rawDiff.split(/\r?\n/);
	for (const line of lines) {
		if (line.startsWith("@@")) {
			const header = parseHunkHeader(line);
			if (header) {
				oldLine = header.oldStart;
				newLine = header.newStart;
			}
			inHunk = true;
			hunks.push({ kind: "hunk", text: line });
			continue;
		}
		if (!inHunk) continue;

		if (line.startsWith("+") && !line.startsWith("+++")) {
			additions += 1;
			hunks.push({ kind: "add", newLine, text: line.slice(1) });
			newLine += 1;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			deletions += 1;
			hunks.push({ kind: "del", oldLine, text: line.slice(1) });
			oldLine += 1;
		} else if (line.startsWith("\\ No newline at end of file")) {
			continue;
		} else if (line.startsWith("diff --git ")) {
			inHunk = false;
		} else {
			const text = line.startsWith(" ") ? line.slice(1) : line;
			hunks.push({ kind: "context", oldLine, newLine, text });
			oldLine += 1;
			newLine += 1;
		}
	}

	return { hunks, additions, deletions };
}

function unquoteGitPath(rawPath: string): string {
	const trimmed = rawPath.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
		try {
			return JSON.parse(trimmed) as string;
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function extractFilePathFromDiffHeader(diffGitLine: string): string {
	const match = /^diff --git (?:"?a\/(.+?)"?|a\/(\S+)) (?:"?b\/(.+?)"?|b\/(\S+))$/.exec(diffGitLine);
	if (!match) return "";
	const bPath = match[3] ?? match[4] ?? "";
	return unquoteGitPath(bPath);
}

function parseMultiFileDiff(rawDiff: string): Map<string, ParsedDiffBucket> {
	const result = new Map<string, ParsedDiffBucket>();
	if (rawDiff.trim().length === 0) return result;

	const lines = rawDiff.split(/\r?\n/);
	let currentPath = "";
	let currentLines: string[] = [];

	const flushBucket = () => {
		if (!currentPath || currentLines.length === 0) return;
		const chunk = currentLines.join("\n");
		const parsed = parseUnifiedDiff(chunk);
		const existing = result.get(currentPath);
		if (existing) {
			existing.additions += parsed.additions;
			existing.deletions += parsed.deletions;
			existing.hunks.push(...parsed.hunks);
			existing.rawDiffLines.push(chunk);
		} else {
			result.set(currentPath, {
				additions: parsed.additions,
				deletions: parsed.deletions,
				hunks: parsed.hunks,
				rawDiffLines: [chunk],
			});
		}
	};

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			flushBucket();
			currentPath = extractFilePathFromDiffHeader(line);
			currentLines = [line];
			continue;
		}
		if (!currentPath) continue;
		if (line.startsWith("+++ b/")) {
			currentPath = unquoteGitPath(line.slice("+++ b/".length));
		} else if (line.startsWith("--- a/") && currentPath.length === 0) {
			currentPath = unquoteGitPath(line.slice("--- a/".length));
		}
		currentLines.push(line);
	}
	flushBucket();
	return result;
}

function buildUntrackedPreviewDiff(fullPath: string): {
	hunks: GuiDiffLine[];
	additions: number;
	rawDiff: string;
} {
	try {
		const stats = statSync(fullPath);
		if (!stats.isFile()) {
			return { hunks: [], additions: 0, rawDiff: "" };
		}
		const bytesToRead = Math.min(stats.size, MAX_UNTRACKED_BYTES);
		const buf = Buffer.alloc(bytesToRead);
		const fd = openSync(fullPath, "r");
		try {
			readSync(fd, buf, 0, bytesToRead, 0);
		} finally {
			closeSync(fd);
		}
		if (buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) {
			return {
				hunks: [{ kind: "hunk", text: "@@ Binary file @@" }],
				additions: 0,
				rawDiff: "Binary file",
			};
		}
		const decoded = buf.toString("utf8");
		const allLines = decoded.length === 0 ? [] : decoded.split(/\r?\n/);
		if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
			allLines.pop();
		}
		const clipped = allLines.slice(0, MAX_UNTRACKED_LINES);
		const hunks: GuiDiffLine[] = clipped.length > 0 ? [{ kind: "hunk", text: `@@ -0,0 +1,${clipped.length} @@` }] : [];
		const rawLines: string[] = hunks.length > 0 ? [hunks[0]!.text] : [];
		for (let i = 0; i < clipped.length; i++) {
			const text = clipped[i] ?? "";
			hunks.push({ kind: "add", newLine: i + 1, text });
			rawLines.push(`+${text}`);
		}
		if (allLines.length > MAX_UNTRACKED_LINES || stats.size > MAX_UNTRACKED_BYTES) {
			hunks.push({ kind: "hunk", text: "@@ ... truncated preview @@" });
		}
		return {
			hunks,
			additions: clipped.length,
			rawDiff: rawLines.join("\n"),
		};
	} catch {
		return { hunks: [], additions: 0, rawDiff: "" };
	}
}

function mapPorcelainStatus(x: string, y: string): "M" | "A" | "D" | "R" | "U" {
	if (x === "?" && y === "?") return "U";
	if (x === "A" || y === "A") return "A";
	if (x === "D" || y === "D") return "D";
	if (x === "R" || y === "R") return "R";
	return "M";
}

/**
 * Inspect git repository branch, changed files, staged/unstaged diffs, and untracked previews.
 */
export async function getGitStatus(cwd: string): Promise<GuiGitStatusSummary> {
	const inside = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], cwd);
	if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
		return {
			isGitRepo: false,
			currentBranch: "",
			branches: [],
			changedFiles: [],
			totalAdditions: 0,
			totalDeletions: 0,
		};
	}

	const [branchRes, branchListRes, statusRes, unstagedDiffRes, stagedDiffRes] = await Promise.all([
		runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd),
		runProcess("git", ["branch", "--format=%(refname:short)"], cwd),
		runProcess("git", ["status", "--porcelain=v1", "-uall", "-z"], cwd),
		runProcess("git", ["diff", "--unified=3", "--no-color"], cwd),
		runProcess("git", ["diff", "--cached", "--unified=3", "--no-color"], cwd),
	]);

	const currentBranch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : "";
	const branchesSet = new Set<string>();
	if (branchListRes.exitCode === 0) {
		for (const line of branchListRes.stdout.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed.length > 0) branchesSet.add(trimmed);
		}
	}
	if (currentBranch.length > 0 && currentBranch !== "HEAD") {
		branchesSet.add(currentBranch);
	}
	const branches = Array.from(branchesSet);

	const unstagedMap = parseMultiFileDiff(unstagedDiffRes.stdout);
	const stagedMap = parseMultiFileDiff(stagedDiffRes.stdout);

	const changedFiles: GuiChangedFile[] = [];
	let totalAdditions = 0;
	let totalDeletions = 0;

	const tokens = statusRes.stdout.split("\0");
	for (let i = 0; i < tokens.length && changedFiles.length < MAX_DIFF_FILES; i++) {
		const token = tokens[i];
		if (!token || token.length < 4) continue;
		const x = token[0] ?? " ";
		const y = token[1] ?? " ";
		const filePath = token.slice(3);
		if (x === "R" || x === "C") {
			i += 1;
		}
		if (filePath.length === 0) continue;

		const status = mapPorcelainStatus(x, y);
		const staged = x !== " " && x !== "?";
		let additions = 0;
		let deletions = 0;
		const hunks: GuiDiffLine[] = [];
		const rawParts: string[] = [];

		if (status === "U") {
			const preview = buildUntrackedPreviewDiff(join(cwd, filePath));
			additions = preview.additions;
			hunks.push(...preview.hunks);
			if (preview.rawDiff.length > 0) rawParts.push(preview.rawDiff);
		} else {
			const stagedBucket = stagedMap.get(filePath);
			const unstagedBucket = unstagedMap.get(filePath);
			if (stagedBucket) {
				additions += stagedBucket.additions;
				deletions += stagedBucket.deletions;
				hunks.push(...stagedBucket.hunks);
				rawParts.push(...stagedBucket.rawDiffLines);
			}
			if (unstagedBucket) {
				additions += unstagedBucket.additions;
				deletions += unstagedBucket.deletions;
				hunks.push(...unstagedBucket.hunks);
				rawParts.push(...unstagedBucket.rawDiffLines);
			}
		}

		totalAdditions += additions;
		totalDeletions += deletions;
		changedFiles.push({
			path: filePath,
			status,
			additions,
			deletions,
			staged,
			hunks,
			rawDiff: rawParts.join("\n"),
		});
	}

	return {
		isGitRepo: true,
		currentBranch,
		branches,
		changedFiles,
		totalAdditions,
		totalDeletions,
	};
}

/**
 * List local branches in the workspace git repository.
 */
export async function getGitBranches(cwd: string): Promise<string[]> {
	const res = await runProcess("git", ["branch", "--format=%(refname:short)"], cwd);
	if (res.exitCode !== 0) return [];
	return res.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Switch to an existing branch without shell interpolation.
 */
export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
	const clean = assertValidBranchName(branch);
	const res = await runProcess("git", ["checkout", clean], cwd);
	if (res.exitCode !== 0) {
		throw new Error(res.stderr.trim() || `Failed to checkout branch ${clean}`);
	}
}

/**
 * Create and switch to a new branch without shell interpolation.
 */
export async function createBranch(cwd: string, branch: string): Promise<void> {
	const clean = assertValidBranchName(branch);
	const res = await runProcess("git", ["checkout", "-b", clean], cwd);
	if (res.exitCode !== 0) {
		throw new Error(res.stderr.trim() || `Failed to create branch ${clean}`);
	}
}

/**
 * Stage selected paths (or all changes) and create a git commit.
 */
export async function stageAndCommitChanges(cwd: string, message: string, paths?: readonly string[]): Promise<void> {
	const cleanMessage = message.trim();
	if (cleanMessage.length === 0) {
		throw new Error("Commit message cannot be empty.");
	}
	const filteredPaths = (paths ?? []).filter((p) => p.length > 0);
	const addArgs = filteredPaths.length > 0 ? ["add", "--", ...filteredPaths] : ["add", "-A"];
	const addRes = await runProcess("git", addArgs, cwd);
	if (addRes.exitCode !== 0) {
		throw new Error(addRes.stderr.trim() || "Failed to stage changes.");
	}

	const commitArgs =
		filteredPaths.length > 0
			? ["commit", "-m", cleanMessage, "--", ...filteredPaths]
			: ["commit", "-m", cleanMessage];
	const commitRes = await runProcess("git", commitArgs, cwd);
	if (commitRes.exitCode !== 0) {
		throw new Error(commitRes.stderr.trim() || "Failed to commit changes.");
	}
}

/**
 * Scan workspace directory tree with depth/entry limits and build/VCS exclusions.
 */
export async function scanWorkspaceFiles(
	cwd: string,
	options: { readonly maxDepth?: number; readonly maxEntries?: number } = {},
): Promise<GuiWorkspaceFileEntry[]> {
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_SCAN_DEPTH;
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_SCAN_ENTRIES;
	const entries: GuiWorkspaceFileEntry[] = [];

	async function walk(dirPath: string, depth: number): Promise<void> {
		if (depth > maxDepth || entries.length >= maxEntries) return;
		const sorted: Array<{ name: string; isDir: boolean; isFile: boolean }> = [];
		try {
			const dirents = await readdir(dirPath, { withFileTypes: true });
			for (const d of dirents) {
				sorted.push({
					name: d.name,
					isDir: d.isDirectory(),
					isFile: d.isFile(),
				});
			}
		} catch {
			return;
		}

		sorted.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			const aLower = a.name.toLowerCase();
			const bLower = b.name.toLowerCase();
			if (aLower < bLower) return -1;
			if (aLower > bLower) return 1;
			return a.name.localeCompare(b.name);
		});

		for (const item of sorted) {
			if (entries.length >= maxEntries) break;
			if (IGNORED_WORKSPACE_DIRS.has(item.name)) continue;

			const fullPath = join(dirPath, item.name);
			const relPath = relative(cwd, fullPath).replace(/\\/g, "/");

			if (item.isDir) {
				entries.push({
					name: item.name,
					path: fullPath,
					relativePath: relPath,
					isDir: true,
					depth,
					expanded: false,
				});
				if (depth < maxDepth) {
					await walk(fullPath, depth + 1);
				}
			} else if (item.isFile) {
				let sizeBytes: number | undefined;
				try {
					sizeBytes = statSync(fullPath).size;
				} catch {
					sizeBytes = undefined;
				}
				entries.push({
					name: item.name,
					path: fullPath,
					relativePath: relPath,
					isDir: false,
					depth,
					sizeBytes,
					language: detectLanguageFromPath(fullPath),
				});
			}
		}
	}

	await walk(cwd, 0);
	return entries;
}

/**
 * Read a bounded UTF-8 file preview with binary detection and workspace boundary enforcement.
 */
export async function readWorkspaceFilePreview(
	cwd: string,
	filePath: string,
	options: { readonly maxBytes?: number; readonly maxLines?: number } = {},
): Promise<GuiWorkspaceFilePreview> {
	const maxBytes = options.maxBytes ?? DEFAULT_PREVIEW_BYTES;
	const maxLines = options.maxLines ?? DEFAULT_PREVIEW_LINES;
	const resolvedCwd = resolve(cwd);
	const resolvedTarget = resolve(isAbsolute(filePath) ? filePath : join(resolvedCwd, filePath));
	const relPath = relative(resolvedCwd, resolvedTarget).replace(/\\/g, "/");

	if (relPath.startsWith("..") || isAbsolute(relPath)) {
		return {
			path: resolvedTarget,
			relativePath: relPath,
			isBinary: false,
			truncated: false,
			lineCount: 0,
			language: detectLanguageFromPath(resolvedTarget),
			content: "",
			error: "Refusing to read file outside workspace.",
		};
	}

	try {
		const stats = statSync(resolvedTarget);
		if (!stats.isFile()) {
			return {
				path: resolvedTarget,
				relativePath: relPath,
				isBinary: false,
				truncated: false,
				lineCount: 0,
				language: detectLanguageFromPath(resolvedTarget),
				content: "",
				error: "Target path is not a regular file.",
			};
		}

		const bytesToRead = Math.min(stats.size, maxBytes);
		const buffer = Buffer.alloc(bytesToRead);
		const fd = openSync(resolvedTarget, "r");
		try {
			readSync(fd, buffer, 0, bytesToRead, 0);
		} finally {
			closeSync(fd);
		}

		const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
		if (sample.includes(0)) {
			return {
				path: resolvedTarget,
				relativePath: relPath,
				isBinary: true,
				truncated: false,
				lineCount: 0,
				language: detectLanguageFromPath(resolvedTarget),
				content: "",
			};
		}

		const text = buffer.toString("utf8");
		const allLines = text.split(/\r?\n/);
		const lineTruncated = allLines.length > maxLines;
		const byteTruncated = stats.size > maxBytes;
		const clipped = lineTruncated ? allLines.slice(0, maxLines) : allLines;

		return {
			path: resolvedTarget,
			relativePath: relPath,
			isBinary: false,
			truncated: lineTruncated || byteTruncated,
			lineCount: clipped.length,
			language: detectLanguageFromPath(resolvedTarget),
			content: clipped.join("\n"),
		};
	} catch (error) {
		return {
			path: resolvedTarget,
			relativePath: relPath,
			isBinary: false,
			truncated: false,
			lineCount: 0,
			language: detectLanguageFromPath(resolvedTarget),
			content: "",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

interface OpenerSpec {
	readonly id: string;
	readonly name: string;
	readonly candidates: readonly string[];
}

function getMacOsOpenerSpecs(): readonly OpenerSpec[] {
	const userApps = join(homedir(), "Applications");
	return [
		{
			id: "vscode",
			name: "VS Code",
			candidates: ["/Applications/Visual Studio Code.app", join(userApps, "Visual Studio Code.app")],
		},
		{
			id: "cursor",
			name: "Cursor",
			candidates: ["/Applications/Cursor.app", join(userApps, "Cursor.app")],
		},
		{
			id: "zed",
			name: "Zed",
			candidates: ["/Applications/Zed.app", join(userApps, "Zed.app")],
		},
		{
			id: "xcode",
			name: "Xcode",
			candidates: ["/Applications/Xcode.app"],
		},
		{
			id: "ghostty",
			name: "Ghostty",
			candidates: ["/Applications/Ghostty.app", join(userApps, "Ghostty.app")],
		},
		{
			id: "iterm",
			name: "iTerm2",
			candidates: ["/Applications/iTerm.app", join(userApps, "iTerm.app")],
		},
		{
			id: "terminal",
			name: "Terminal",
			candidates: ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
		},
		{
			id: "finder",
			name: "Finder",
			candidates: ["/System/Library/CoreServices/Finder.app"],
		},
	];
}

/**
 * Detect installed macOS editors, terminals, and Finder suitable for opening the workspace.
 */
export function detectExternalOpeners(): GuiExternalOpener[] {
	if (process.platform !== "darwin") {
		return [];
	}
	const openers: GuiExternalOpener[] = [];
	for (const spec of getMacOsOpenerSpecs()) {
		const matched = spec.candidates.find((candidate) => existsSync(candidate));
		openers.push({
			id: spec.id,
			name: spec.name,
			appPath: matched,
			available: matched !== undefined || spec.id === "finder",
		});
	}
	return openers;
}

/**
 * Launch an installed macOS external editor, terminal, or Finder without shell interpolation.
 */
export async function openWorkspaceInApp(openerId: string, targetPath: string): Promise<boolean> {
	if (process.platform !== "darwin") {
		return false;
	}
	const openers = detectExternalOpeners();
	const opener = openers.find((item) => item.id === openerId);
	if (!opener || !opener.available) {
		return false;
	}

	const resolvedTarget = resolve(targetPath);
	const args =
		opener.id === "finder"
			? [resolvedTarget]
			: opener.appPath
				? ["-a", opener.appPath, resolvedTarget]
				: [resolvedTarget];

	const res = await runProcess("open", args, existsSync(resolvedTarget) ? resolvedTarget : process.cwd());
	return res.exitCode === 0;
}

/**
 * Default Waku desktop layout and appearance preferences.
 */
export function getDefaultGuiLayoutPreferences(): GuiLayoutPreferences {
	return {
		sidebarWidth: 260,
		sidebarCollapsed: false,
		rightPanelWidth: 380,
		rightPanelOpen: false,
		rightPanelTab: "changes",
		diffViewMode: "unified",
		sidebarGroupBy: "updated",
		appearance: "system",
		pinnedSessionIds: [],
		sessionCustomNames: {},
	};
}

export function getGuiLayoutPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, "gui-layout.json");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

/**
 * Load persistent Waku GUI layout preferences from ~/.pi/agent/gui-layout.json cleanly.
 */
export function loadGuiLayoutPreferences(agentDir: string = getAgentDir()): GuiLayoutPreferences {
	const defaults = getDefaultGuiLayoutPreferences();
	const layoutPath = getGuiLayoutPath(agentDir);
	if (!existsSync(layoutPath)) {
		return defaults;
	}

	try {
		const raw = readFileSync(layoutPath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object") {
			return defaults;
		}

		const rightPanelTab =
			parsed.rightPanelTab === "changes" || parsed.rightPanelTab === "files" || parsed.rightPanelTab === "tree"
				? parsed.rightPanelTab
				: defaults.rightPanelTab;
		const diffViewMode =
			parsed.diffViewMode === "unified" || parsed.diffViewMode === "split"
				? parsed.diffViewMode
				: defaults.diffViewMode;
		const sidebarGroupBy =
			parsed.sidebarGroupBy === "updated" || parsed.sidebarGroupBy === "project"
				? parsed.sidebarGroupBy
				: defaults.sidebarGroupBy;
		const appearance =
			parsed.appearance === "system" || parsed.appearance === "dark" || parsed.appearance === "light"
				? parsed.appearance
				: defaults.appearance;

		const pinnedSessionIds: string[] = Array.isArray(parsed.pinnedSessionIds)
			? parsed.pinnedSessionIds.filter((item): item is string => typeof item === "string" && item.length > 0)
			: [];

		const sessionCustomNames: Record<string, string> = {};
		if (parsed.sessionCustomNames && typeof parsed.sessionCustomNames === "object" && !Array.isArray(parsed.sessionCustomNames)) {
			for (const [k, v] of Object.entries(parsed.sessionCustomNames as Record<string, unknown>)) {
				if (typeof k === "string" && k.length > 0 && typeof v === "string") {
					sessionCustomNames[k] = v;
				}
			}
		}

		return {
			sidebarWidth: clampNumber(parsed.sidebarWidth, defaults.sidebarWidth, 180, 480),
			sidebarCollapsed:
				typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : defaults.sidebarCollapsed,
			rightPanelWidth: clampNumber(parsed.rightPanelWidth, defaults.rightPanelWidth, 240, 720),
			rightPanelOpen: typeof parsed.rightPanelOpen === "boolean" ? parsed.rightPanelOpen : defaults.rightPanelOpen,
			rightPanelTab,
			diffViewMode,
			sidebarGroupBy,
			appearance,
			pinnedSessionIds,
			sessionCustomNames,
		};
	} catch {
		return defaults;
	}
}

/**
 * Persist Waku GUI layout preferences safely to ~/.pi/agent/gui-layout.json.
 */
export function saveGuiLayoutPreferences(prefs: GuiLayoutPreferences, agentDir: string = getAgentDir()): void {
	const layoutPath = getGuiLayoutPath(agentDir);
	const dir = dirname(layoutPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const payload = `${JSON.stringify(prefs, null, 2)}\n`;
	const tmpPath = `${layoutPath}.${process.pid}.tmp`;
	try {
		writeFileSync(tmpPath, payload, "utf8");
		renameSync(tmpPath, layoutPath);
	} catch {
		writeFileSync(layoutPath, payload, "utf8");
	}
}
