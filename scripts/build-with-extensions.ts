#!/usr/bin/env bun
/**
 * Zig-style static AOT extension compiler for pi-native.
 *
 * Generates a temporary TypeScript entrypoint statically importing the chosen
 * extensions and passes them via MainOptions.extensionFactories so scriptc
 * compiles a single self-contained native binary with zero VM startup cost.
 *
 * Usage:
 *   bun scripts/build-with-extensions.ts --ext path/to/ext.ts [--ext other.ts] [-o dist/pi]
 */

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface BuildCliOptions {
	extensions: string[];
	out: string;
	optimization: "dev" | "release" | "speed";
	ffiPath?: string;
	noFfi: boolean;
	scriptc?: string;
	dryRun: boolean;
	help: boolean;
}

function findRepoRoot(startDir: string): string {
	let dir = path.resolve(startDir);
	while (true) {
		const candidate = path.join(dir, "packages", "coding-agent", "src", "main.ts");
		if (fs.existsSync(candidate)) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error("Could not locate pi-native repository root (missing packages/coding-agent/src/main.ts)");
		}
		dir = parent;
	}
}

function printHelp(): void {
	process.stdout.write(
		[
			"Usage:",
			"  scripts/build-with-extensions.ts --ext <path> [--ext <path> ...] [-o <out>]",
			"",
			"Options:",
			"  --ext, --with-ext <path>        Extension entry file or package directory (repeatable)",
			"  -o, --out <path>                Output binary path (default: dist/pi)",
			"  --optimization <dev|release|speed>  scriptc optimization level (default: dev)",
			"  --ffi <path>                    FFI descriptor JSON (default: packages/pi-native-ffi/ffi/darwin.json if present)",
			"  --no-ffi                        Do not auto-pass --ffi",
			"  --scriptc <path>                Path to scriptc compiler binary",
			"  --dry-run                       Print generated entry and command without building",
			"  -h, --help                      Show this help message",
			"",
		].join("\n"),
	);
}

export function parseBuildArgs(argv: string[]): BuildCliOptions {
	const opts: BuildCliOptions = {
		extensions: [],
		out: "dist/pi",
		optimization: "dev",
		noFfi: false,
		dryRun: false,
		help: false,
	};

	const readValue = (flag: string, inlineVal: string | undefined, idx: number): { value: string; nextIdx: number } => {
		if (inlineVal !== undefined) {
			return { value: inlineVal, nextIdx: idx };
		}
		const next = argv[idx + 1];
		if (next === undefined || next.startsWith("-")) {
			throw new Error(`Option ${flag} requires a value`);
		}
		return { value: next, nextIdx: idx + 1 };
	};

	for (let i = 0; i < argv.length; i++) {
		const raw = argv[i] ?? "";
		if (raw === "-h" || raw === "--help") {
			opts.help = true;
			continue;
		}
		if (raw === "--dry-run") {
			opts.dryRun = true;
			continue;
		}
		if (raw === "--no-ffi") {
			opts.noFfi = true;
			continue;
		}

		const eqIdx = raw.indexOf("=");
		const flag = eqIdx >= 0 ? raw.slice(0, eqIdx) : raw;
		const inlineVal = eqIdx >= 0 ? raw.slice(eqIdx + 1) : undefined;

		if (flag === "--ext" || flag === "--with-ext") {
			const { value, nextIdx } = readValue(flag, inlineVal, i);
			opts.extensions.push(value);
			i = nextIdx;
			continue;
		}
		if (flag === "-o" || flag === "--out") {
			const { value, nextIdx } = readValue(flag, inlineVal, i);
			opts.out = value;
			i = nextIdx;
			continue;
		}
		if (flag === "--optimization") {
			const { value, nextIdx } = readValue(flag, inlineVal, i);
			if (value !== "dev" && value !== "release" && value !== "speed") {
				throw new Error(`Invalid optimization "${value}" (expected dev, release, or speed)`);
			}
			opts.optimization = value;
			i = nextIdx;
			continue;
		}
		if (flag === "--ffi") {
			const { value, nextIdx } = readValue(flag, inlineVal, i);
			opts.ffiPath = value;
			i = nextIdx;
			continue;
		}
		if (flag === "--scriptc") {
			const { value, nextIdx } = readValue(flag, inlineVal, i);
			opts.scriptc = value;
			i = nextIdx;
			continue;
		}
		if (raw.startsWith("-")) {
			throw new Error(`Unknown option: ${raw}`);
		}
		opts.extensions.push(raw);
	}

	return opts;
}

function isSupportedExtensionFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".js" || ext === ".mjs" || ext === ".cjs";
}

export function resolveExtensionInputs(inputs: string[], cwd: string): string[] {
	const resolved: string[] = [];
	const seen = new Set<string>();

	const addFile = (filePath: string): void => {
		const abs = path.resolve(filePath);
		if (!fs.existsSync(abs)) {
			throw new Error(`Extension file does not exist: ${filePath}`);
		}
		const st = fs.statSync(abs);
		if (!st.isFile()) {
			throw new Error(`Expected extension file, got non-file path: ${filePath}`);
		}
		if (!isSupportedExtensionFile(abs)) {
			throw new Error(`Unsupported extension file type "${path.extname(abs)}" for: ${filePath}`);
		}
		if (!seen.has(abs)) {
			seen.add(abs);
			resolved.push(abs);
		}
	};

	for (const input of inputs) {
		const candidate = path.resolve(cwd, input);
		if (!fs.existsSync(candidate)) {
			throw new Error(`Extension path does not exist: ${input}`);
		}
		const st = fs.statSync(candidate);
		if (st.isFile()) {
			addFile(candidate);
			continue;
		}
		if (!st.isDirectory()) {
			throw new Error(`Invalid extension path: ${input}`);
		}

		// Directory resolution matches pi package convention: package.json "pi.extensions" or index.{ts,js}
		const pkgPath = path.join(candidate, "package.json");
		let addedFromManifest = false;
		if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isFile()) {
			try {
				const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
				if (parsed !== null && typeof parsed === "object") {
					const piVal = Object.getOwnPropertyDescriptor(parsed, "pi")?.value;
					if (piVal !== null && typeof piVal === "object") {
						const extVal = Object.getOwnPropertyDescriptor(piVal, "extensions")?.value;
						if (Array.isArray(extVal) && extVal.length > 0) {
							for (let idx = 0; idx < extVal.length; idx++) {
								const rel: unknown = extVal[idx];
								if (typeof rel === "string" && rel.length > 0) {
									addFile(path.resolve(candidate, rel));
									addedFromManifest = true;
								}
							}
						}
					}
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`Failed to parse ${pkgPath}: ${message}`);
			}
		}

		if (!addedFromManifest) {
			const idxTs = path.join(candidate, "index.ts");
			const idxJs = path.join(candidate, "index.js");
			if (fs.existsSync(idxTs) && fs.statSync(idxTs).isFile()) {
				addFile(idxTs);
			} else if (fs.existsSync(idxJs) && fs.statSync(idxJs).isFile()) {
				addFile(idxJs);
			} else {
				throw new Error(`Directory "${input}" does not contain index.ts, index.js, or package.json pi.extensions`);
			}
		}
	}

	return resolved;
}

function toImportSpecifier(fromDir: string, targetFile: string): string {
	let rel = path.relative(fromDir, targetFile).split(path.sep).join("/");
	if (!rel.startsWith(".") && !rel.startsWith("/")) {
		rel = `./${rel}`;
	}
	return rel;
}

function deriveExtensionName(filePath: string, usedNames: Set<string>): string {
	const parsed = path.parse(filePath);
	let base = parsed.name;
	if (base === "index") {
		const parentBase = path.basename(parsed.dir);
		if (parentBase.length > 0) base = parentBase;
	}
	let name = base.length > 0 ? base : "extension";
	let suffix = 2;
	while (usedNames.has(name)) {
		name = `${base}-${suffix}`;
		suffix++;
	}
	usedNames.add(name);
	return name;
}

export function generateStaticEntrySource(
	entryDir: string,
	repoRoot: string,
	extensionFiles: string[],
): string {
	const setupSpec = toImportSpecifier(entryDir, path.join(repoRoot, "packages", "coding-agent", "src", "cli", "setup.ts"));
	const mainSpec = toImportSpecifier(entryDir, path.join(repoRoot, "packages", "coding-agent", "src", "main.ts"));
	const typesSpec = toImportSpecifier(
		entryDir,
		path.join(repoRoot, "packages", "coding-agent", "src", "core", "extensions", "types.ts"),
	);

	const usedNames = new Set<string>();
	const imports: string[] = [
		`import { setupCli } from ${JSON.stringify(setupSpec)};`,
		`import { main } from ${JSON.stringify(mainSpec)};`,
		`import type { InlineExtension } from ${JSON.stringify(typesSpec)};`,
	];
	const items: string[] = [];

	for (let i = 0; i < extensionFiles.length; i++) {
		const extFile = extensionFiles[i];
		if (!extFile) continue;
		const ident = `extFactory${i}`;
		const spec = toImportSpecifier(entryDir, extFile);
		const extName = deriveExtensionName(extFile, usedNames);
		imports.push(`import ${ident} from ${JSON.stringify(spec)};`);
		items.push(`\t{ name: ${JSON.stringify(extName)}, factory: ${ident} },`);
	}

	return [
		"// Auto-generated by scripts/build-with-extensions.ts (do not commit)",
		...imports,
		"",
		"const staticExtensions: InlineExtension[] = [",
		...items,
		"];",
		"",
		"setupCli();",
		"void main(process.argv.slice(2), { extensionFactories: staticExtensions });",
		"",
	].join("\n");
}

function resolveScriptcBinary(explicit?: string): string {
	if (explicit && explicit.length > 0) return explicit;
	if (process.env.SCRIPTC && process.env.SCRIPTC.length > 0) return process.env.SCRIPTC;
	try {
		const found = execFileSync("which", ["scriptc"], { encoding: "utf8" }).trim();
		if (found.length > 0) return found;
	} catch {
		// Fall back to PATH name
	}
	return "scriptc";
}

function cleanupBuildArtifacts(outPath: string): void {
	const removeIfExists = (target: string): void => {
		try {
			if (fs.existsSync(target)) {
				fs.rmSync(target, { recursive: true, force: true });
			}
		} catch {
			// Best-effort cleanup
		}
	};

	removeIfExists(`${outPath}.dSYM`);
	removeIfExists(`${outPath}.libnode`);
	const outDir = path.dirname(outPath);
	try {
		if (fs.existsSync(outDir)) {
			for (const entry of fs.readdirSync(outDir)) {
				if (entry.endsWith(".ll")) {
					removeIfExists(path.join(outDir, entry));
				}
			}
		}
	} catch {
		// Best-effort cleanup
	}
}

export function runBuildWithExtensions(argv: string[]): void {
	const opts = parseBuildArgs(argv);
	if (opts.help) {
		printHelp();
		return;
	}
	if (opts.extensions.length === 0) {
		throw new Error("At least one extension path must be provided via --ext <path>");
	}

	const repoRoot = findRepoRoot(process.cwd());
	const extensionFiles = resolveExtensionInputs(opts.extensions, process.cwd());
	const outPath = path.resolve(process.cwd(), opts.out);
	const outDir = path.dirname(outPath);

	const scriptcDir = path.join(repoRoot, ".scriptc");
	fs.mkdirSync(scriptcDir, { recursive: true });
	const createdScriptcDir = fs.readdirSync(scriptcDir).length === 0;
	const tempEntry = path.join(scriptcDir, `pi-with-extensions-${process.pid}.ts`);

	const defaultFfi = path.join(repoRoot, "packages", "pi-native-ffi", "ffi", "darwin.json");
	const ffiArg = opts.noFfi
		? undefined
		: opts.ffiPath
			? path.resolve(process.cwd(), opts.ffiPath)
			: fs.existsSync(defaultFfi)
				? defaultFfi
				: undefined;

	if (opts.ffiPath && ffiArg && !fs.existsSync(ffiArg)) {
		throw new Error(`FFI descriptor not found: ${opts.ffiPath}`);
	}

	const scriptcBin = resolveScriptcBinary(opts.scriptc);
	const scriptcArgs = [
		"build",
		"--node-islands=off",
		`--optimization=${opts.optimization}`,
		"--strip",
		"--no-keep-llvm",
		"--no-shape-overlay",
	];
	if (ffiArg) {
		scriptcArgs.push("--ffi", ffiArg);
	}
	scriptcArgs.push(tempEntry, "-o", outPath);

	const source = generateStaticEntrySource(scriptcDir, repoRoot, extensionFiles);

	try {
		fs.writeFileSync(tempEntry, source, "utf8");

		if (opts.dryRun) {
			const cmdPreview = process.platform === "darwin"
				? `taskpolicy -c utility ${scriptcBin} ${scriptcArgs.join(" ")}`
				: `${scriptcBin} ${scriptcArgs.join(" ")}`;
			process.stdout.write(`# Temporary entry: ${tempEntry}\n${source}\n# Command:\n${cmdPreview}\n`);
			return;
		}

		fs.mkdirSync(outDir, { recursive: true });
		const env: Record<string, string | undefined> = {
			...process.env,
			SCRIPTC_EMIT_WORKERS: process.env.SCRIPTC_EMIT_WORKERS || "1",
		};

		const useTaskpolicy = process.platform === "darwin";
		const execCmd = useTaskpolicy ? "taskpolicy" : scriptcBin;
		const execArgs = useTaskpolicy ? ["-c", "utility", scriptcBin, ...scriptcArgs] : scriptcArgs;

		const res = spawnSync(execCmd, execArgs, {
			cwd: repoRoot,
			env,
			stdio: "inherit",
		});
		if (res.error) {
			throw res.error;
		}
		if (typeof res.status === "number" && res.status !== 0) {
			throw new Error(`scriptc build exited with status ${res.status}`);
		}
		cleanupBuildArtifacts(outPath);
	} finally {
		try {
			if (fs.existsSync(tempEntry)) {
				fs.unlinkSync(tempEntry);
			}
			if (createdScriptcDir && fs.existsSync(scriptcDir) && fs.readdirSync(scriptcDir).length === 0) {
				fs.rmdirSync(scriptcDir);
			}
		} catch {
			// Best-effort temp cleanup
		}
	}
}

const isEntryScript =
	typeof process !== "undefined" &&
	Array.isArray(process.argv) &&
	typeof process.argv[1] === "string" &&
	path.resolve(process.argv[1]).endsWith(`${path.sep}build-with-extensions.ts`);

if (isEntryScript) {
	try {
		runBuildWithExtensions(process.argv.slice(2));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`Error: ${message}\n`);
		process.exit(1);
	}
}
