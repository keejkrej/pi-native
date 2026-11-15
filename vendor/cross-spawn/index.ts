/**
 * Pure TypeScript vendored implementation of `cross-spawn`.
 * Zero third-party dependencies; wraps `node:child_process` with Windows `.cmd`/`.bat` quoting,
 * `PATHEXT` lookup, and `#!` shebang resolution.
 */

import {
	type ChildProcess,
	type SpawnOptions,
	type SpawnSyncOptions,
	type SpawnSyncOptionsWithStringEncoding,
	type SpawnSyncReturns,
	spawn as cpSpawn,
	spawnSync as cpSpawnSync,
} from "node:child_process";

type CrossSpawnSyncOptions = Omit<SpawnSyncOptions, "encoding"> & {
	encoding?: string | null;
	windowsVerbatimArguments?: boolean;
};
type CrossSpawnSyncOptionsWithBufferEncoding = Omit<SpawnSyncOptions, "encoding"> & {
	encoding?: "buffer" | null;
};
import * as fs from "node:fs";
import path from "node:path";
import process from "node:process";

const IS_WIN = process.platform === "win32";
const IS_EXECUTABLE_RE = /\.(?:com|exe)$/i;
const IS_CMD_SHIM_RE = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;
const META_CHARS_RE = /([()\][%!^"`<>&|;, *?])/g;
const SHEBANG_RE = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?([^\s]+)/;

export class CrossSpawnENOENTError extends Error {
	readonly code: string;
	readonly errno: string;
	readonly syscall: string;
	readonly path: string;
	readonly spawnargs: readonly string[];

	constructor(command: string, args: readonly string[], syscall: string) {
		super(`${syscall} ${command} ENOENT`);
		this.name = "Error";
		this.code = "ENOENT";
		this.errno = "ENOENT";
		this.syscall = `${syscall} ${command}`;
		this.path = command;
		this.spawnargs = [...args];
	}
}

type CrossSpawnInputOptions = SpawnOptions & {
	forceShell?: boolean;
	windowsVerbatimArguments?: boolean;
};

interface ParsedSpawn {
	command: string;
	args: string[];
	readonly cwd: string | undefined;
	readonly env: Record<string, string | undefined> | undefined;
	readonly forceShell: boolean;
	windowsVerbatimArguments: boolean;
	file: string | undefined;
	readonly originalCommand: string;
	readonly originalArgs: readonly string[];
}

function escapeCommand(arg: string): string {
	return arg.replace(META_CHARS_RE, "^$1");
}

function escapeArgument(arg: string, doubleEscapeMetaChars: boolean): string {
	let escaped = `${arg}`;
	escaped = escaped.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
	escaped = escaped.replace(/(?=(\\+?)?)\1$/, "$1$1");
	escaped = `"${escaped}"`;
	escaped = escaped.replace(META_CHARS_RE, "^$1");
	if (doubleEscapeMetaChars) {
		escaped = escaped.replace(META_CHARS_RE, "^$1");
	}
	return escaped;
}

function findEnvKey(env: Record<string, string | undefined>, target: string): string | undefined {
	if (!IS_WIN) {
		return Object.hasOwn(env, target) ? target : undefined;
	}
	const lower = target.toLowerCase();
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === lower) {
			return key;
		}
	}
	return undefined;
}

function getPathValue(env: Record<string, string | undefined>): string {
	const key = findEnvKey(env, "PATH");
	return (key !== undefined ? env[key] : undefined) ?? "";
}

function getPathExtList(env: Record<string, string | undefined>, withoutPathExt: boolean): string[] {
	if (withoutPathExt) return [""];
	const key = findEnvKey(env, "PATHEXT");
	const raw = (key !== undefined ? env[key] : undefined) ?? env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
	const exts = raw.split(path.delimiter).filter((ext) => ext.length > 0);
	return exts.length > 0 ? ["", ...exts] : [""];
}

function isFileExecutable(candidate: string): boolean {
	try {
		const stat = fs.statSync(candidate);
		if (!stat.isFile()) return false;
		if (!IS_WIN) {
			fs.accessSync(candidate, fs.constants.X_OK);
		}
		return true;
	} catch {
		return false;
	}
}

function resolveCommandAttempt(
	command: string,
	cwdOption: string | undefined,
	envOption: Record<string, string | undefined> | undefined,
	withoutPathExt: boolean,
): string | undefined {
	const env = envOption ?? (process.env as Record<string, string | undefined>);
	const baseDir = cwdOption !== undefined ? path.resolve(cwdOption) : process.cwd();
	const exts = IS_WIN ? getPathExtList(env, withoutPathExt) : [""];

	const hasPathSeparator = command.includes("/") || (IS_WIN && command.includes("\\"));
	if (hasPathSeparator) {
		const candidateBase = path.resolve(baseDir, command);
		for (const ext of exts) {
			const candidate = candidateBase + ext;
			if (isFileExecutable(candidate)) return candidate;
		}
		return undefined;
	}

	const dirs = getPathValue(env).split(path.delimiter).filter((dir) => dir.length > 0);
	for (const dir of dirs) {
		const resolvedDir = path.resolve(baseDir, dir);
		for (const ext of exts) {
			const candidate = path.join(resolvedDir, command + ext);
			if (isFileExecutable(candidate)) return candidate;
		}
	}
	return undefined;
}

function resolveCommand(parsed: ParsedSpawn): string | undefined {
	const cwd = typeof parsed.cwd === "string" ? parsed.cwd : undefined;
	return (
		resolveCommandAttempt(parsed.command, cwd, parsed.env, false) ??
		resolveCommandAttempt(parsed.command, cwd, parsed.env, true)
	);
}

function readShebang(filePath: string): string | undefined {
	const size = 150;
	const buffer = Buffer.alloc(size);
	let fd: number | undefined;
	let bytesRead = 0;
	try {
		fd = fs.openSync(filePath, "r");
		bytesRead = fs.readSync(fd, buffer, 0, size, 0);
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				// Ignore close errors.
			}
		}
	}
	const firstLine = buffer.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0] ?? "";
	const match = SHEBANG_RE.exec(firstLine);
	return match?.[1];
}

function detectShebang(parsed: ParsedSpawn): string | undefined {
	parsed.file = resolveCommand(parsed);
	if (parsed.file === undefined) return undefined;
	const shebang = readShebang(parsed.file);
	if (shebang !== undefined) {
		parsed.args.unshift(parsed.file);
		parsed.command = shebang;
		return resolveCommand(parsed);
	}
	return parsed.file;
}

function parseNonShell(parsed: ParsedSpawn): ParsedSpawn {
	if (!IS_WIN) {
		return parsed;
	}

	const commandFile = detectShebang(parsed);
	const needsShell = commandFile !== undefined && !IS_EXECUTABLE_RE.test(commandFile);

	if (parsed.forceShell || needsShell) {
		const needsDoubleEscape = commandFile !== undefined && IS_CMD_SHIM_RE.test(commandFile);
		const normalizedCmd = escapeCommand(path.normalize(parsed.command));
		const escapedArgs = parsed.args.map((arg) => escapeArgument(arg, needsDoubleEscape));
		const shellCommand = [normalizedCmd, ...escapedArgs].join(" ");

		parsed.args = ["/d", "/s", "/c", `"${shellCommand}"`];
		parsed.command = process.env.comspec || "cmd.exe";
		parsed.windowsVerbatimArguments = true;
	}

	return parsed;
}

function buildParsedSpawn(
	command: string,
	args: string[],
	cwd: string | undefined,
	env: Record<string, string | undefined> | undefined,
	shell: boolean | string | undefined,
	forceShell: boolean,
	windowsVerbatimArguments: boolean,
): ParsedSpawn {
	const parsed: ParsedSpawn = {
		command,
		args,
		cwd,
		env,
		forceShell,
		windowsVerbatimArguments,
		file: undefined,
		originalCommand: command,
		originalArgs: [...args],
	};

	return shell ? parsed : parseNonShell(parsed);
}

function spawnImpl(command: string, options?: SpawnOptions): ChildProcess;
function spawnImpl(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess;
function spawnImpl(
	command: string,
	argsOrOptions?: readonly string[] | SpawnOptions,
	options?: SpawnOptions,
): ChildProcess {
	let args: string[] = [];
	let rawOptions: CrossSpawnInputOptions | undefined = options as CrossSpawnInputOptions | undefined;
	if (argsOrOptions !== undefined) {
		if (Array.isArray(argsOrOptions)) {
			args = [...argsOrOptions];
		} else {
			rawOptions = argsOrOptions as CrossSpawnInputOptions;
		}
	}
	const clonedOptions: CrossSpawnInputOptions = rawOptions ? { ...rawOptions } : {};
	const cwdStr = typeof clonedOptions.cwd === "string" ? clonedOptions.cwd : undefined;
	const parsed = buildParsedSpawn(
		command,
		args,
		cwdStr,
		clonedOptions.env,
		clonedOptions.shell,
		clonedOptions.forceShell === true,
		clonedOptions.windowsVerbatimArguments === true,
	);
	const spawnOpts: CrossSpawnInputOptions = parsed.windowsVerbatimArguments
		? { ...clonedOptions, windowsVerbatimArguments: true }
		: clonedOptions;
	return cpSpawn(parsed.command, parsed.args, spawnOpts);
}

function toStringEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
	const source = env ?? process.env;
	const out: Record<string, string> = {};
	for (const key of Object.keys(source)) {
		const val = source[key];
		if (typeof val === "string") {
			out[key] = val;
		}
	}
	return out;
}

type SimpleStdio = "pipe" | "ignore" | "inherit";

function toSimpleStdio(val: unknown): SimpleStdio {
	if (val === "inherit") return "inherit";
	if (val === "ignore" || val === null) return "ignore";
	return "pipe";
}

function callSpawnSyncUtf8Stdio(
	command: string,
	args: string[],
	shell: boolean,
	cwd: string,
	env: Record<string, string>,
	input: string | undefined,
	stdioLiteral: SimpleStdio,
	windowsHide: boolean,
	timeout: number | undefined,
): SpawnSyncReturns<string> {
	if (stdioLiteral === "inherit") {
		if (shell) {
			if (timeout !== undefined && input !== undefined) {
				return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, input, stdio: "inherit", shell: true, windowsHide, timeout });
			}
			if (timeout !== undefined) {
				return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, stdio: "inherit", shell: true, windowsHide, timeout });
			}
			if (input !== undefined) {
				return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, input, stdio: "inherit", shell: true, windowsHide });
			}
			return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, stdio: "inherit", shell: true, windowsHide });
		}
		if (timeout !== undefined && input !== undefined) {
			return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, input, stdio: "inherit", shell: false, windowsHide, timeout });
		}
		if (timeout !== undefined) {
			return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, stdio: "inherit", shell: false, windowsHide, timeout });
		}
		if (input !== undefined) {
			return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, input, stdio: "inherit", shell: false, windowsHide });
		}
		return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, stdio: "inherit", shell: false, windowsHide });
	}
	if (stdioLiteral === "ignore") {
		if (shell) {
			if (timeout !== undefined && input !== undefined) {
				return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, input, stdio: "ignore", shell: true, windowsHide, timeout });
			}
			if (timeout !== undefined) {
				return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, stdio: "ignore", shell: true, windowsHide, timeout });
			}
			if (input !== undefined) {
				return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, input, stdio: "ignore", shell: true, windowsHide });
			}
			return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, stdio: "ignore", shell: true, windowsHide });
		}
		if (timeout !== undefined && input !== undefined) {
			return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, input, stdio: "ignore", shell: false, windowsHide, timeout });
		}
		if (timeout !== undefined) {
			return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, stdio: "ignore", shell: false, windowsHide, timeout });
		}
		if (input !== undefined) {
			return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, input, stdio: "ignore", shell: false, windowsHide });
		}
		return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, stdio: "ignore", shell: false, windowsHide });
	}
	if (shell) {
		if (timeout !== undefined && input !== undefined) {
			return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, input, stdio: "pipe", shell: true, windowsHide, timeout });
		}
		if (timeout !== undefined) {
			return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, stdio: "pipe", shell: true, windowsHide, timeout });
		}
		if (input !== undefined) {
			return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, input, stdio: "pipe", shell: true, windowsHide });
		}
		return cpSpawnSync(command, [], { encoding: "utf-8", cwd, env, stdio: "pipe", shell: true, windowsHide });
	}
	if (timeout !== undefined && input !== undefined) {
		return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, input, stdio: "pipe", shell: false, windowsHide, timeout });
	}
	if (timeout !== undefined) {
		return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, stdio: "pipe", shell: false, windowsHide, timeout });
	}
	if (input !== undefined) {
		return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, input, stdio: "pipe", shell: false, windowsHide });
	}
	return cpSpawnSync(command, args, { encoding: "utf-8", cwd, env, stdio: "pipe", shell: false, windowsHide });
}

function callSpawnSyncBufferStdio(
	command: string,
	args: string[],
	shell: boolean,
	cwd: string,
	env: Record<string, string>,
	input: string | undefined,
	stdioLiteral: SimpleStdio,
	windowsHide: boolean,
	timeout: number | undefined,
): SpawnSyncReturns<Buffer> {
	if (stdioLiteral === "inherit") {
		if (shell) {
			if (timeout !== undefined && input !== undefined) {
				return cpSpawnSync(command, [], { cwd, env, input, stdio: "inherit", shell: true, windowsHide, timeout });
			}
			if (timeout !== undefined) {
				return cpSpawnSync(command, [], { cwd, env, stdio: "inherit", shell: true, windowsHide, timeout });
			}
			if (input !== undefined) {
				return cpSpawnSync(command, [], { cwd, env, input, stdio: "inherit", shell: true, windowsHide });
			}
			return cpSpawnSync(command, [], { cwd, env, stdio: "inherit", shell: true, windowsHide });
		}
		if (timeout !== undefined && input !== undefined) {
			return cpSpawnSync(command, args, { cwd, env, input, stdio: "inherit", shell: false, windowsHide, timeout });
		}
		if (timeout !== undefined) {
			return cpSpawnSync(command, args, { cwd, env, stdio: "inherit", shell: false, windowsHide, timeout });
		}
		if (input !== undefined) {
			return cpSpawnSync(command, args, { cwd, env, input, stdio: "inherit", shell: false, windowsHide });
		}
		return cpSpawnSync(command, args, { cwd, env, stdio: "inherit", shell: false, windowsHide });
	}
	if (stdioLiteral === "ignore") {
		if (shell) {
			if (timeout !== undefined && input !== undefined) {
				return cpSpawnSync(command, [], { cwd, env, input, stdio: "ignore", shell: true, windowsHide, timeout });
			}
			if (timeout !== undefined) {
				return cpSpawnSync(command, [], { cwd, env, stdio: "ignore", shell: true, windowsHide, timeout });
			}
			if (input !== undefined) {
				return cpSpawnSync(command, [], { cwd, env, input, stdio: "ignore", shell: true, windowsHide });
			}
			return cpSpawnSync(command, [], { cwd, env, stdio: "ignore", shell: true, windowsHide });
		}
		if (timeout !== undefined && input !== undefined) {
			return cpSpawnSync(command, args, { cwd, env, input, stdio: "ignore", shell: false, windowsHide, timeout });
		}
		if (timeout !== undefined) {
			return cpSpawnSync(command, args, { cwd, env, stdio: "ignore", shell: false, windowsHide, timeout });
		}
		if (input !== undefined) {
			return cpSpawnSync(command, args, { cwd, env, input, stdio: "ignore", shell: false, windowsHide });
		}
		return cpSpawnSync(command, args, { cwd, env, stdio: "ignore", shell: false, windowsHide });
	}
	if (shell) {
		if (timeout !== undefined && input !== undefined) {
			return cpSpawnSync(command, [], { cwd, env, input, stdio: "pipe", shell: true, windowsHide, timeout });
		}
		if (timeout !== undefined) {
			return cpSpawnSync(command, [], { cwd, env, stdio: "pipe", shell: true, windowsHide, timeout });
		}
		if (input !== undefined) {
			return cpSpawnSync(command, [], { cwd, env, input, stdio: "pipe", shell: true, windowsHide });
		}
		return cpSpawnSync(command, [], { cwd, env, stdio: "pipe", shell: true, windowsHide });
	}
	if (timeout !== undefined && input !== undefined) {
		return cpSpawnSync(command, args, { cwd, env, input, stdio: "pipe", shell: false, windowsHide, timeout });
	}
	if (timeout !== undefined) {
		return cpSpawnSync(command, args, { cwd, env, stdio: "pipe", shell: false, windowsHide, timeout });
	}
	if (input !== undefined) {
		return cpSpawnSync(command, args, { cwd, env, input, stdio: "pipe", shell: false, windowsHide });
	}
	return cpSpawnSync(command, args, { cwd, env, stdio: "pipe", shell: false, windowsHide });
}

function callWithLiteralStdio(
	command: string,
	args: readonly string[],
	useUtf8: boolean,
	shell: boolean,
	cwd: string | undefined,
	env: Record<string, string>,
	input: string | undefined,
	stdioLiteral: SimpleStdio,
	windowsHide: boolean,
	timeout: number | undefined,
): SpawnSyncReturns<string | Buffer> {
	const argList = [...args];
	const resolvedCwd = cwd ?? process.cwd();
	return useUtf8
		? callSpawnSyncUtf8Stdio(command, argList, shell, resolvedCwd, env, input, stdioLiteral, windowsHide, timeout)
		: callSpawnSyncBufferStdio(command, argList, shell, resolvedCwd, env, input, stdioLiteral, windowsHide, timeout);
}

function callCpSpawnSync(
	command: string,
	args: readonly string[],
	useUtf8: boolean,
	shell: boolean,
	cwd: string | undefined,
	env: Record<string, string>,
	input: string | undefined,
	stdioRaw: unknown,
	windowsHide: boolean,
	timeout: number | undefined,
): SpawnSyncReturns<string | Buffer> {
	const uniformStdio: SimpleStdio = Array.isArray(stdioRaw)
		? stdioRaw[0] === "inherit" && stdioRaw[1] === "inherit" && stdioRaw[2] === "inherit"
			? "inherit"
			: (stdioRaw[0] === "ignore" || stdioRaw[0] === null) &&
					(stdioRaw[1] === "ignore" || stdioRaw[1] === null) &&
					(stdioRaw[2] === "ignore" || stdioRaw[2] === null)
				? "ignore"
				: "pipe"
		: toSimpleStdio(stdioRaw);

	return callWithLiteralStdio(command, args, useUtf8, shell, cwd, env, input, uniformStdio, windowsHide, timeout);
}

interface CrossSpawnSyncFlatOptions {
	readonly cwd?: unknown;
	readonly env?: Record<string, string | undefined>;
	readonly shell?: boolean | string;
	readonly forceShell?: boolean;
	readonly windowsVerbatimArguments?: boolean;
	readonly timeout?: number;
	readonly input?: unknown;
	readonly windowsHide?: boolean;
	readonly encoding?: unknown;
	readonly stdio?: unknown;
}

function isSyncArgsArray(value: readonly string[] | CrossSpawnSyncFlatOptions): value is readonly string[] {
	return Array.isArray(value);
}

function spawnSyncImpl(command: string): SpawnSyncReturns<Buffer>;
function spawnSyncImpl(command: string, options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
function spawnSyncImpl(command: string, options: CrossSpawnSyncOptionsWithBufferEncoding): SpawnSyncReturns<Buffer>;
function spawnSyncImpl(command: string, options?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer>;
function spawnSyncImpl(command: string, args: readonly string[]): SpawnSyncReturns<Buffer>;
function spawnSyncImpl(
	command: string,
	args: readonly string[],
	options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
function spawnSyncImpl(
	command: string,
	args: readonly string[],
	options: CrossSpawnSyncOptionsWithBufferEncoding,
): SpawnSyncReturns<Buffer>;
function spawnSyncImpl(
	command: string,
	args?: readonly string[],
	options?: CrossSpawnSyncOptions,
): SpawnSyncReturns<string | Buffer>;
function spawnSyncImpl(
	command: string,
	argsOrOptions?: readonly string[] | CrossSpawnSyncFlatOptions,
	options?: CrossSpawnSyncFlatOptions,
): SpawnSyncReturns<string | Buffer> {
	let args: string[] = [];
	let rawOptions: CrossSpawnSyncFlatOptions | undefined = options;
	if (argsOrOptions !== undefined) {
		if (isSyncArgsArray(argsOrOptions)) {
			args = [...argsOrOptions];
		} else {
			rawOptions = argsOrOptions;
		}
	}
	const opts: CrossSpawnSyncFlatOptions = rawOptions ?? {};
	const cwd = typeof opts.cwd === "string" ? opts.cwd : undefined;
	const parsed = buildParsedSpawn(
		command,
		args,
		cwd,
		opts.env,
		opts.shell,
		opts.forceShell === true,
		opts.windowsVerbatimArguments === true,
	);
	const env = toStringEnv(opts.env);
	const timeout = typeof opts.timeout === "number" ? opts.timeout : undefined;
	const input = typeof opts.input === "string" ? opts.input : undefined;
	const windowsHide = opts.windowsHide === true;
	const encoding: unknown = opts.encoding;
	const useUtf8 = typeof encoding === "string" && encoding !== "buffer";

	if (opts.shell) {
		const fullCommand = parsed.args.length > 0 ? `${parsed.command} ${parsed.args.join(" ")}` : parsed.command;
		return callCpSpawnSync(fullCommand, [], useUtf8, true, cwd, env, input, opts.stdio, windowsHide, timeout);
	}
	return callCpSpawnSync(
		parsed.command,
		parsed.args,
		useUtf8,
		false,
		cwd,
		env,
		input,
		opts.stdio,
		windowsHide,
		timeout,
	);
}

export type CrossSpawn = typeof spawnImpl & {
	readonly spawn: typeof spawnImpl;
	readonly sync: typeof spawnSyncImpl;
};

function buildCrossSpawn(): CrossSpawn {
	const fn = spawnImpl as unknown as CrossSpawn;
	Object.defineProperties(fn, {
		spawn: { value: spawnImpl, enumerable: true },
		sync: { value: spawnSyncImpl, enumerable: true },
	});
	return fn;
}

export const crossSpawn: CrossSpawn = buildCrossSpawn();

export const spawn = spawnImpl;
export const sync = spawnSyncImpl;
export default crossSpawn;
