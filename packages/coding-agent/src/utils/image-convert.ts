import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCapabilities, type ImageTranscoder, setImageTranscoder } from "@earendil-works/pi-tui";
import { isNativeDarwinAvailable, nativeImageTransform } from "../../../pi-native-ffi/src/index.ts";
import { getExifOrientation, stripPngOrientationChunks } from "./image-dimensions.ts";

const SIPS_PATH = "/usr/bin/sips";
const CLI_CONVERT_TIMEOUT_MS = 10_000;

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

function encodePngViaSipsSync(bytes: Uint8Array): Uint8Array | null {
	if (!existsSync(SIPS_PATH)) return null;
	const orientation = getExifOrientation(bytes);
	const dir = mkdtempSync(join(tmpdir(), "pi-img-convert-"));
	try {
		const inputPath = join(dir, "input");
		const outputPath = join(dir, "output.png");
		writeFileSync(inputPath, bytes);
		const orientArgs = getSipsOrientationArgs(orientation);
		execFileSync(SIPS_PATH, [...orientArgs, "-s", "format", "png", inputPath, "--out", outputPath], {
			stdio: "ignore",
			timeout: CLI_CONVERT_TIMEOUT_MS,
		});
		if (orientation === 5 || orientation === 7) {
			execFileSync(SIPS_PATH, ["-f", "horizontal", outputPath], {
				stdio: "ignore",
				timeout: CLI_CONVERT_TIMEOUT_MS,
			});
		}
		const out = readFileSync(outputPath);
		if (out.length === 0) return null;
		const bytesOut = new Uint8Array(out);
		return orientation !== 1 ? stripPngOrientationChunks(bytesOut) : bytesOut;
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

function encodePngViaExternalCliSync(bytes: Uint8Array): Uint8Array | null {
	const hasAnyCli =
		hasExecutableInPath("magick") || hasExecutableInPath("convert") || hasExecutableInPath("ffmpeg");
	if (!hasAnyCli) return null;
	const dir = mkdtempSync(join(tmpdir(), "pi-img-convert-"));
	try {
		const inputPath = join(dir, "input");
		const outputPath = join(dir, "output.png");
		writeFileSync(inputPath, bytes);

		const tools: Array<[string, string[]]> = [
			["magick", [inputPath, "-auto-orient", outputPath]],
			["convert", [inputPath, "-auto-orient", outputPath]],
			["ffmpeg", ["-y", "-v", "error", "-i", inputPath, "-frames:v", "1", outputPath]],
		];
		for (const [cmd, args] of tools) {
			if (!hasExecutableInPath(cmd)) continue;
			try {
				execFileSync(cmd, args, { stdio: "ignore", timeout: CLI_CONVERT_TIMEOUT_MS });
				if (existsSync(outputPath)) {
					const out = readFileSync(outputPath);
					if (out.length > 0) return new Uint8Array(out);
				}
			} catch {
				// Try next fallback tool if available.
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

/**
 * Synchronously decode arbitrary image bytes (applying EXIF orientation) and encode as PNG.
 * Uses Darwin ImageIO FFI in-process when available, falling back to /usr/bin/sips on Darwin
 * or ImageMagick/ffmpeg on Darwin/Linux.
 */
export function encodePngBytesSync(bytes: Uint8Array): Uint8Array | null {
	if (bytes.length === 0) return null;

	if (isNativeDarwinAvailable()) {
		try {
			const encoded = nativeImageTransform(bytes, 0, 0, "png", 100, true);
			if (encoded && encoded.length > 0) return encoded;
		} catch {
			// Fall back to external CLI tools below when ImageIO rejects an edge-case image.
		}
		return encodePngViaExternalCliSync(bytes);
	}

	if (process.platform === "darwin") {
		const sipsOut = encodePngViaSipsSync(bytes);
		if (sipsOut) return sipsOut;
		return encodePngViaExternalCliSync(bytes);
	}
	if (process.platform === "linux") {
		return encodePngViaExternalCliSync(bytes);
	}
	return null;
}

export async function convertImageBytesToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
	return encodePngBytesSync(bytes);
}

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 */
export async function convertToPng(
	base64Data: string,
	mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
	// Already PNG, no conversion needed
	if (mimeType === "image/png") {
		return { data: base64Data, mimeType };
	}

	const bytes = new Uint8Array(Buffer.from(base64Data, "base64"));
	const pngBytes = await convertImageBytesToPng(bytes);
	if (!pngBytes) {
		return null;
	}

	return {
		data: Buffer.from(pngBytes).toString("base64"),
		mimeType: "image/png",
	};
}

function hasPngTranscoderBackend(): boolean {
	if (isNativeDarwinAvailable()) return true;
	if (process.platform === "darwin" && existsSync(SIPS_PATH)) return true;
	if (process.platform === "darwin" || process.platform === "linux") {
		return hasExecutableInPath("magick") || hasExecutableInPath("convert") || hasExecutableInPath("ffmpeg");
	}
	return false;
}

/**
 * Return a synchronous PNG transcoder for pi-tui's Kitty image rendering.
 * Returns undefined if no image backend is available.
 */
export async function loadPngTranscoder(): Promise<ImageTranscoder | undefined> {
	if (!hasPngTranscoderBackend()) return undefined;
	return (base64Data) => {
		const pngBytes = encodePngBytesSync(new Uint8Array(Buffer.from(base64Data, "base64")));
		return pngBytes ? Buffer.from(pngBytes).toString("base64") : null;
	};
}

let pngTranscoderLoad: Promise<boolean> | undefined;
let pngTranscoderRegistered = false;

/**
 * On Kitty-protocol terminals, register a synchronous PNG transcoder so non-PNG images render.
 * Loads once. `onRegistered` runs after registration so callers can re-render images that
 * showed text fallbacks; it is not called if the transcoder was already registered or cannot load.
 */
export function ensurePngTranscoder(onRegistered: () => void): void {
	if (pngTranscoderRegistered || getCapabilities().images !== "kitty") return;
	pngTranscoderLoad ??= loadPngTranscoder().then((transcoder) => {
		if (!transcoder) return false;
		setImageTranscoder(transcoder);
		pngTranscoderRegistered = true;
		return true;
	});
	void pngTranscoderLoad.then((registered) => {
		if (registered) onRegistered();
	});
}
