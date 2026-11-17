import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNativeDarwinAvailable, nativeImageInspect, nativeImageTransform } from "@pi-ts/ffi";
import { parseImageDimensions, stripPngOrientationChunks } from "./image-dimensions.ts";

export interface ImageResizeOptions {
	maxWidth?: number; // Default: 2000
	maxHeight?: number; // Default: 2000
	maxBytes?: number; // Default: 4.5MB of base64 payload (below Anthropic's 5MB limit)
	jpegQuality?: number; // Default: 80
}

export interface ResizedImage {
	data: string; // base64
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}

/**
 * Tag on image resize worker replies. Node can post its own messages on the worker channel
 * (for example `{ "watch:require": [...] }` under `node --watch`), so replies must be identifiable.
 */
export const IMAGE_RESIZE_WORKER_RESPONSE_TYPE = "pi:image-resize-response";

export type ResizeImageWorkerResponse =
	| { type: typeof IMAGE_RESIZE_WORKER_RESPONSE_TYPE; result: ResizedImage | null }
	| { type: typeof IMAGE_RESIZE_WORKER_RESPONSE_TYPE; error: string };

// 4.5MB of base64 payload. Provides headroom below Anthropic's 5MB limit.
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;
const SIPS_PATH = "/usr/bin/sips";
const CLI_COMMAND_TIMEOUT_MS = 15_000;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 2000,
	maxHeight: 2000,
	maxBytes: DEFAULT_MAX_BYTES,
	jpegQuality: 80,
};

interface EncodedCandidate {
	data: string;
	encodedSize: number;
	mimeType: string;
}

interface InspectedDimensions {
	width: number;
	height: number;
	orientation: number;
}

interface CliTransformWorkspace {
	dir: string;
	inputPath: string;
	darwinSourcePath?: string;
}

function encodeCandidate(buffer: Uint8Array, mimeType: string): EncodedCandidate {
	const data = Buffer.from(buffer).toString("base64");
	return {
		data,
		encodedSize: Buffer.byteLength(data, "utf-8"),
		mimeType,
	};
}

function normalizeSupportedRasterMimeType(mimeType: string): string | null {
	const base = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
	switch (base) {
		case "image/png":
			return "image/png";
		case "image/jpeg":
		case "image/jpg":
			return "image/jpeg";
		case "image/gif":
			return "image/gif";
		case "image/webp":
			return "image/webp";
		default:
			return null;
	}
}

function clampQuality(quality: number): number {
	return Math.max(1, Math.min(100, Math.round(quality)));
}

function jpegQualityToFfmpegQ(quality: number): number {
	return Math.max(2, Math.min(31, Math.round(31 - (clampQuality(quality) / 100) * 29)));
}

function hasExecutableInPath(name: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	const separator = process.platform === "win32" ? ";" : ":";
	const dirs = pathEnv.split(separator);
	for (const dir of dirs) {
		if (!dir) continue;
		const candidate = join(dir, name);
		try {
			if (statSync(candidate).isFile()) {
				return true;
			}
		} catch {
			// Ignore missing entries on PATH.
		}
	}
	return false;
}

function runCommand(command: string, args: readonly string[], timeoutMs = CLI_COMMAND_TIMEOUT_MS): Promise<{ ok: boolean; stdout: Buffer }> {
	return new Promise((resolve) => {
		const child = spawn(command, [...args], {
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
		});
		const childStdout = child.stdout;
		const chunks: Buffer[] = [];
		let totalLength = 0;
		let settled = false;

		const finish = (ok: boolean): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ ok, stdout: ok ? Buffer.concat(chunks, totalLength) : Buffer.alloc(0) });
		};

		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			if (childStdout) childStdout.destroy();
			finish(false);
		}, timeoutMs);

		child.on("error", () => finish(false));
		child.on("close", (code) => finish(code === 0));
		if (childStdout) {
			childStdout.on("data", (chunk: Buffer) => {
				if (settled) return;
				totalLength += chunk.length;
				if (totalLength > 1024 * 1024) {
					child.kill("SIGKILL");
					childStdout.destroy();
					finish(false);
				} else {
					chunks.push(chunk);
				}
			});
		}
	});
}

function getSipsOrientationArgs(orientation: number): string[] {
	switch (orientation) {
		case 2:
			return ["-f", "horizontal"];
		case 3:
			return ["-r", "180"];
		case 4:
			return ["-f", "vertical"];
		case 5:
		case 6:
			return ["-r", "90"];
		case 7:
		case 8:
			return ["-r", "270"];
		default:
			return [];
	}
}

async function inspectDimensionsViaCli(inputBytes: Uint8Array): Promise<InspectedDimensions | null> {
	if (process.platform !== "darwin" && process.platform !== "linux") {
		return null;
	}
	const dir = mkdtempSync(join(tmpdir(), "pi-img-inspect-"));
	try {
		const inputPath = join(dir, "input");
		writeFileSync(inputPath, inputBytes);

		if (process.platform === "darwin" && existsSync(SIPS_PATH)) {
			const res = await runCommand(SIPS_PATH, ["-g", "pixelWidth", "-g", "pixelHeight", inputPath]);
			if (res.ok) {
				const text = res.stdout.toString("utf-8");
				const wMatch = /pixelWidth:\s*(\d+)/.exec(text);
				const hMatch = /pixelHeight:\s*(\d+)/.exec(text);
				const width = wMatch && wMatch[1] !== undefined ? Number.parseInt(wMatch[1], 10) : 0;
				const height = hMatch && hMatch[1] !== undefined ? Number.parseInt(hMatch[1], 10) : 0;
				if (width > 0 && height > 0) {
					return { width, height, orientation: 1 };
				}
			}
		}

		const cmds: Array<[string, string[]]> = [
			["magick", ["identify", "-format", "%w %h", inputPath]],
			["identify", ["-format", "%w %h", inputPath]],
			["ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", inputPath]],
		];
		for (const [cmd, args] of cmds) {
			if (!hasExecutableInPath(cmd)) continue;
			const res = await runCommand(cmd, args);
			if (!res.ok) continue;
			const match = /(\d+)[\sx]+(\d+)/.exec(res.stdout.toString("utf-8").trim());
			const width = match && match[1] !== undefined ? Number.parseInt(match[1], 10) : 0;
			const height = match && match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
			if (width > 0 && height > 0) {
				return { width, height, orientation: 1 };
			}
		}

		return null;
	} catch {
		return null;
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup failures.
		}
	}
}

async function prepareDarwinSipsSource(
	workspace: CliTransformWorkspace,
	orientation: number,
): Promise<string | null> {
	if (workspace.darwinSourcePath) {
		return workspace.darwinSourcePath;
	}
	if (orientation === 1) {
		workspace.darwinSourcePath = workspace.inputPath;
		return workspace.darwinSourcePath;
	}
	const orientedPath = join(workspace.dir, "oriented.png");
	const orientArgs = getSipsOrientationArgs(orientation);
	const first = await runCommand(SIPS_PATH, [...orientArgs, "-s", "format", "png", workspace.inputPath, "--out", orientedPath]);
	if (!first.ok) {
		return null;
	}
	if (orientation === 5 || orientation === 7) {
		const second = await runCommand(SIPS_PATH, ["-f", "horizontal", orientedPath]);
		if (!second.ok) {
			return null;
		}
	}
	try {
		const rawOriented = new Uint8Array(readFileSync(orientedPath));
		const stripped = stripPngOrientationChunks(rawOriented);
		if (stripped !== rawOriented) {
			writeFileSync(orientedPath, stripped);
		}
	} catch {
		return null;
	}
	workspace.darwinSourcePath = orientedPath;
	return orientedPath;
}

async function transformWithSips(
	workspace: CliTransformWorkspace,
	orientation: number,
	width: number,
	height: number,
	format: "png" | "jpeg",
	jpegQuality: number,
): Promise<Uint8Array | null> {
	if (!existsSync(SIPS_PATH)) return null;
	const sourcePath = await prepareDarwinSipsSource(workspace, orientation);
	if (!sourcePath) return null;

	const quality = clampQuality(jpegQuality);
	const outPath = join(
		workspace.dir,
		format === "jpeg" ? `sips-${width}x${height}-q${quality}.jpg` : `sips-${width}x${height}.png`,
	);
	const args: string[] = ["-z", String(height), String(width), "-s", "format", format];
	if (format === "jpeg") {
		args.push("-s", "formatOptions", String(quality));
	}
	args.push(sourcePath, "--out", outPath);

	const res = await runCommand(SIPS_PATH, args);
	if (!res.ok || !existsSync(outPath)) return null;
	try {
		const out = readFileSync(outPath);
		return out.length > 0 ? new Uint8Array(out) : null;
	} catch {
		return null;
	}
}

async function transformWithExternalCli(
	workspace: CliTransformWorkspace,
	width: number,
	height: number,
	format: "png" | "jpeg",
	jpegQuality: number,
): Promise<Uint8Array | null> {
	const quality = clampQuality(jpegQuality);
	const outPath = join(
		workspace.dir,
		format === "jpeg" ? `cli-${width}x${height}-q${quality}.jpg` : `cli-${width}x${height}.png`,
	);
	const magickArgs = [workspace.inputPath, "-auto-orient", "-resize", `${width}x${height}!`];
	if (format === "jpeg") {
		magickArgs.push("-background", "white", "-alpha", "remove", "-alpha", "off", "-quality", String(quality));
	}
	magickArgs.push(outPath);

	const ffmpegArgs = [
		"-y",
		"-v",
		"error",
		"-i",
		workspace.inputPath,
		"-vf",
		`scale=${width}:${height}:flags=lanczos`,
		"-frames:v",
		"1",
	];
	if (format === "jpeg") {
		ffmpegArgs.push("-q:v", String(jpegQualityToFfmpegQ(quality)));
	}
	ffmpegArgs.push(outPath);

	const tools: Array<[string, string[]]> = [
		["magick", magickArgs],
		["convert", magickArgs],
		["ffmpeg", ffmpegArgs],
	];

	for (const [cmd, args] of tools) {
		if (!hasExecutableInPath(cmd)) continue;
		const res = await runCommand(cmd, args);
		if (!res.ok || !existsSync(outPath)) continue;
		try {
			const out = readFileSync(outPath);
			if (out.length > 0) return new Uint8Array(out);
		} catch {
			// Try next tool.
		}
	}
	return null;
}

/**
 * Resize an image to fit within the specified max dimensions and encoded file size.
 * Returns null if the image cannot be resized below maxBytes.
 *
 * Strategy:
 * 1. Inspect dimensions/orientation via Darwin ImageIO FFI or pure-TS parser; fast-path
 *    orientation=1 supported raster images already within maxWidth/maxHeight/maxBytes.
 * 2. Otherwise apply EXIF orientation, clamp to maxWidth/maxHeight, and progressively try
 *    PNG vs JPEG (preferring the smaller) at decreasing JPEG quality and 0.75x scale steps.
 */
export async function resizeImageInProcess(
	inputBytes: Uint8Array,
	mimeType: string,
	options?: ImageResizeOptions,
): Promise<ResizedImage | null> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	if (inputBytes.byteLength === 0 || opts.maxWidth <= 0 || opts.maxHeight <= 0 || opts.maxBytes <= 0) {
		return null;
	}

	const inputBase64Size = Math.ceil(inputBytes.byteLength / 3) * 4;
	const darwinNative = isNativeDarwinAvailable();

	// Step A: Inspect dimensions & EXIF orientation.
	let info: InspectedDimensions | null = null;
	if (darwinNative) {
		const nativeInfo = nativeImageInspect(inputBytes);
		if (nativeInfo && nativeInfo.width > 0 && nativeInfo.height > 0) {
			info = {
				width: nativeInfo.width,
				height: nativeInfo.height,
				orientation: nativeInfo.orientation >= 1 && nativeInfo.orientation <= 8 ? nativeInfo.orientation : 1,
			};
		}
	}
	if (!info) {
		const parsed = parseImageDimensions(inputBytes);
		if (parsed && parsed.width > 0 && parsed.height > 0) {
			info = {
				width: parsed.width,
				height: parsed.height,
				orientation: parsed.orientation >= 1 && parsed.orientation <= 8 ? parsed.orientation : 1,
			};
		}
	}
	if (!info) {
		info = await inspectDimensionsViaCli(inputBytes);
	}
	if (!info) {
		return null;
	}

	const supportedMimeType = normalizeSupportedRasterMimeType(mimeType);
	if (
		info.orientation === 1 &&
		info.width <= opts.maxWidth &&
		info.height <= opts.maxHeight &&
		inputBase64Size < opts.maxBytes &&
		supportedMimeType !== null
	) {
		return {
			data: Buffer.from(inputBytes).toString("base64"),
			mimeType: supportedMimeType,
			originalWidth: info.width,
			originalHeight: info.height,
			width: info.width,
			height: info.height,
			wasResized: false,
		};
	}

	// Step B: Account for EXIF swap (5..8) and clamp initial dimensions.
	const originalWidth = info.orientation >= 5 && info.orientation <= 8 ? info.height : info.width;
	const originalHeight = info.orientation >= 5 && info.orientation <= 8 ? info.width : info.height;

	let targetWidth = originalWidth;
	let targetHeight = originalHeight;
	if (targetWidth > opts.maxWidth) {
		targetHeight = Math.max(1, Math.round((targetHeight * opts.maxWidth) / targetWidth));
		targetWidth = opts.maxWidth;
	}
	if (targetHeight > opts.maxHeight) {
		targetWidth = Math.max(1, Math.round((targetWidth * opts.maxHeight) / targetHeight));
		targetHeight = opts.maxHeight;
	}

	let cliWorkspace: CliTransformWorkspace | undefined;
	const getCliWorkspace = (): CliTransformWorkspace => {
		if (!cliWorkspace) {
			const dir = mkdtempSync(join(tmpdir(), "pi-img-resize-"));
			const inputPath = join(dir, "input");
			writeFileSync(inputPath, inputBytes);
			cliWorkspace = { dir, inputPath };
		}
		return cliWorkspace;
	};

	const transform = async (
		width: number,
		height: number,
		format: "png" | "jpeg",
		jpegQuality: number,
	): Promise<Uint8Array | null> => {
		const quality = clampQuality(jpegQuality);
		if (darwinNative) {
			try {
				const nativeOut = nativeImageTransform(inputBytes, width, height, format, quality, true);
				if (nativeOut && nativeOut.length > 0) return nativeOut;
			} catch {
				// Fall through to CLI fallback if native decoding fails for an edge-case image.
			}
			return transformWithExternalCli(getCliWorkspace(), width, height, format, quality);
		}
		if (process.platform === "darwin") {
			const sipsOut = await transformWithSips(getCliWorkspace(), info.orientation, width, height, format, quality);
			if (sipsOut && sipsOut.length > 0) return sipsOut;
			return transformWithExternalCli(getCliWorkspace(), width, height, format, quality);
		}
		if (process.platform === "linux") {
			return transformWithExternalCli(getCliWorkspace(), width, height, format, quality);
		}
		return null;
	};

	const qualitySteps = Array.from(new Set([clampQuality(opts.jpegQuality), 85, 70, 55, 40]));
	const primaryQuality = qualitySteps[0] ?? clampQuality(opts.jpegQuality);
	let currentWidth = targetWidth;
	let currentHeight = targetHeight;

	try {
		while (true) {
			const pngBytes = await transform(currentWidth, currentHeight, "png", 100);
			const jpegBytes = await transform(currentWidth, currentHeight, "jpeg", primaryQuality);
			const png = pngBytes ? encodeCandidate(pngBytes, "image/png") : undefined;
			const jpeg = jpegBytes ? encodeCandidate(jpegBytes, "image/jpeg") : undefined;

			if (!png && !jpeg) {
				return null;
			}

			// Prefer the smaller of PNG and JPEG at configured quality; try lower JPEG qualities only if neither fits.
			const preferred: EncodedCandidate[] = [];
			if (png && jpeg) {
				if (jpeg.encodedSize < png.encodedSize) {
					preferred.push(jpeg, png);
				} else {
					preferred.push(png, jpeg);
				}
			} else if (png) {
				preferred.push(png);
			} else if (jpeg) {
				preferred.push(jpeg);
			}

			for (const candidate of preferred) {
				if (candidate.encodedSize < opts.maxBytes) {
					return {
						data: candidate.data,
						mimeType: candidate.mimeType,
						originalWidth,
						originalHeight,
						width: currentWidth,
						height: currentHeight,
						wasResized: true,
					};
				}
			}

			for (let i = 1; i < qualitySteps.length; i++) {
				const q = qualitySteps[i];
				if (q === undefined) continue;
				const lowerBytes = await transform(currentWidth, currentHeight, "jpeg", q);
				if (!lowerBytes) continue;
				const candidate = encodeCandidate(lowerBytes, "image/jpeg");
				if (candidate.encodedSize < opts.maxBytes) {
					return {
						data: candidate.data,
						mimeType: candidate.mimeType,
						originalWidth,
						originalHeight,
						width: currentWidth,
						height: currentHeight,
						wasResized: true,
					};
				}
			}

			if (currentWidth === 1 && currentHeight === 1) {
				break;
			}

			const nextWidth = currentWidth === 1 ? 1 : Math.max(1, Math.floor(currentWidth * 0.75));
			const nextHeight = currentHeight === 1 ? 1 : Math.max(1, Math.floor(currentHeight * 0.75));
			if (nextWidth === currentWidth && nextHeight === currentHeight) {
				break;
			}

			currentWidth = nextWidth;
			currentHeight = nextHeight;
		}

		return null;
	} catch {
		return null;
	} finally {
		if (cliWorkspace) {
			try {
				rmSync(cliWorkspace.dir, { recursive: true, force: true });
			} catch {
				// Ignore cleanup errors.
			}
		}
	}
}
