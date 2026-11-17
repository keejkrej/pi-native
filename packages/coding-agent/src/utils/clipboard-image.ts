import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNativeClipboard, type NativeClipboard } from "@pi-ts/tui";
import { runClipboardCommand } from "./clipboard-command.ts";
import { convertImageBytesToPng } from "./image-convert.ts";
import { detectSupportedImageMimeType } from "./mime.ts";
import { isWSL } from "./wsl.ts";

export type ClipboardImage = {
	bytes: Uint8Array;
	mimeType: string;
};

const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const DEFAULT_LIST_TIMEOUT_MS = 1000;
const DEFAULT_CLI_IMAGE_TIMEOUT_MS = 5000;

export function isWaylandSession(env: Record<string, string | undefined> = process.env): boolean {
	return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
}

function baseMimeType(mimeType: string): string {
	return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

export function extensionForImageMimeType(mimeType: string): string | null {
	switch (baseMimeType(mimeType)) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			return null;
	}
}

function selectPreferredImageMimeType(mimeTypes: string[]): string | null {
	const normalized = mimeTypes
		.map((t) => t.trim())
		.filter(Boolean)
		.map((t) => ({ raw: t, base: baseMimeType(t) }));

	for (const preferred of SUPPORTED_IMAGE_MIME_TYPES) {
		const match = normalized.find((t) => t.base === preferred);
		if (match) {
			return match.raw;
		}
	}

	const anyImage = normalized.find((t) => t.base.startsWith("image/"));
	return anyImage?.raw ?? null;
}

function isSupportedImageMimeType(mimeType: string): boolean {
	const base = baseMimeType(mimeType);
	return SUPPORTED_IMAGE_MIME_TYPES.some((t) => t === base);
}

// Undefined means the backend failed; null means it has no image. An empty
// Wayland clipboard must not fall through to stale X11 clipboard contents.
async function readClipboardImageViaWlPaste(): Promise<ClipboardImage | null | undefined> {
	const list = await runClipboardCommand("wl-paste", ["--list-types"], { timeoutMs: DEFAULT_LIST_TIMEOUT_MS });
	if (list === undefined) return undefined;

	const types = list
		.toString("utf-8")
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter(Boolean);

	const selectedType = selectPreferredImageMimeType(types);
	if (!selectedType) {
		return null;
	}

	const data = await runClipboardCommand("wl-paste", ["--type", selectedType, "--no-newline"]);
	if (data === undefined) return undefined;
	if (data.length === 0) return null;

	return { bytes: data, mimeType: baseMimeType(selectedType) };
}

/**
 * Read an image from the Windows clipboard through PowerShell (used on both native Windows
 * when no native helper is present and WSL where the Linux display lacks Windows screenshots).
 */
async function readClipboardImageViaPowerShell(useWslPath: boolean): Promise<ClipboardImage | null> {
	const tmpFile = join(tmpdir(), `pi-wsl-clip-${randomUUID()}.png`);

	try {
		let winPath = tmpFile;
		if (useWslPath) {
			const winPathResult = await runClipboardCommand("wslpath", ["-w", tmpFile], {
				timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
			});
			if (winPathResult === undefined) {
				return null;
			}

			winPath = winPathResult.toString("utf-8").trim();
			if (!winPath) {
				return null;
			}
		}

		const psQuotedWinPath = winPath.replaceAll("'", "''");
		const psScript = [
			"Add-Type -AssemblyName System.Windows.Forms",
			"Add-Type -AssemblyName System.Drawing",
			`$path = '${psQuotedWinPath}'`,
			"$img = [System.Windows.Forms.Clipboard]::GetImage()",
			"if ($img) { $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } else { Write-Output 'empty' }",
		].join("; ");

		const result = await runClipboardCommand("powershell.exe", ["-NoProfile", "-Command", psScript], {
			timeoutMs: DEFAULT_CLI_IMAGE_TIMEOUT_MS,
		});
		if (result === undefined) {
			return null;
		}

		const output = result.toString("utf-8").trim();
		if (output !== "ok") {
			return null;
		}

		const bytes = readFileSync(tmpFile);
		if (bytes.length === 0) {
			return null;
		}

		return { bytes: new Uint8Array(bytes), mimeType: "image/png" };
	} catch {
		return null;
	} finally {
		try {
			unlinkSync(tmpFile);
		} catch {
			// Ignore cleanup errors.
		}
	}
}

async function readClipboardImageViaAppleScript(): Promise<ClipboardImage | null> {
	const tmpFile = join(tmpdir(), `pi-darwin-clip-${randomUUID()}.png`);
	const escapedPath = tmpFile.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
	const script = [
		'use framework "AppKit"',
		'use framework "Foundation"',
		"set pb to current application's NSPasteboard's generalPasteboard()",
		"set pngType to current application's NSPasteboardTypePNG",
		"set tiffType to current application's NSPasteboardTypeTIFF",
		"if (pb's availableTypeFromArray:{pngType, tiffType}) is missing value then return \"empty\"",
		"set pngData to pb's dataForType:pngType",
		"if pngData is missing value then",
		"  set pbImg to current application's NSImage's alloc()'s initWithPasteboard:pb",
		"  if pbImg is missing value then return \"empty\"",
		"  set pbTiff to pbImg's TIFFRepresentation()",
		"  if pbTiff is missing value then return \"empty\"",
		"  set rep to current application's NSBitmapImageRep's imageRepWithData:pbTiff",
		"  if rep is missing value then return \"empty\"",
		"  set pngData to rep's representationUsingType:(current application's NSBitmapImageFileTypePNG) |properties|:(current application's NSDictionary's dictionary())",
		"end if",
		"if pngData is missing value then return \"empty\"",
		`if (pngData's writeToFile:"${escapedPath}" atomically:true) as boolean then return "ok"`,
		'return "empty"',
	].join("\n");

	try {
		const result = await runClipboardCommand("osascript", ["-e", script], {
			timeoutMs: DEFAULT_CLI_IMAGE_TIMEOUT_MS,
		});
		if (result === undefined) {
			return null;
		}
		if (result.toString("utf-8").trim() !== "ok") {
			return null;
		}
		const bytes = readFileSync(tmpFile);
		if (bytes.length === 0) {
			return null;
		}
		return { bytes: new Uint8Array(bytes), mimeType: "image/png" };
	} catch {
		return null;
	} finally {
		try {
			unlinkSync(tmpFile);
		} catch {
			// Ignore cleanup errors.
		}
	}
}

async function readClipboardImageViaXclip(): Promise<ClipboardImage | null | undefined> {
	const targets = await runClipboardCommand("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"], {
		timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
	});

	if (targets === undefined) return undefined;

	const candidateTypes = targets
		.toString("utf-8")
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter(Boolean);
	const preferred = selectPreferredImageMimeType(candidateTypes);
	if (!preferred) return null;

	const data = await runClipboardCommand("xclip", ["-selection", "clipboard", "-t", preferred, "-o"]);
	if (data === undefined) return undefined;
	if (data.length === 0) return null;
	return { bytes: data, mimeType: baseMimeType(preferred) };
}

async function readClipboardImageViaNativeClipboard(
	nativeClipboard: NativeClipboard | undefined = getNativeClipboard(),
): Promise<ClipboardImage | null | undefined> {
	const bytes = await nativeClipboard?.getImage();
	if (bytes === undefined) return undefined;
	if (!bytes?.length) return null;
	return { bytes, mimeType: detectSupportedImageMimeType(bytes) ?? "application/octet-stream" };
}

export async function readClipboardImage(options?: {
	env?: Record<string, string | undefined>;
	platform?: string;
}): Promise<ClipboardImage | null> {
	const env = options?.env ?? process.env;
	const platform = options?.platform ?? process.platform;

	if (env.TERMUX_VERSION) {
		return null;
	}

	let image: ClipboardImage | null | undefined;

	if (platform === "linux") {
		const wsl = isWSL(env);
		if (isWaylandSession(env) || wsl) {
			image = await readClipboardImageViaWlPaste();
		}
		if (image === undefined) image = await readClipboardImageViaXclip();
		// Preserve Linux's empty/unavailable distinction if Windows has no image.
		if (!image && wsl) image = (await readClipboardImageViaPowerShell(true)) ?? image;
		if (image === undefined) image = await readClipboardImageViaNativeClipboard();
	} else {
		const nativeClipboard = getNativeClipboard();
		if (nativeClipboard) {
			image = await readClipboardImageViaNativeClipboard(nativeClipboard);
		} else if (platform === "darwin") {
			image = await readClipboardImageViaAppleScript();
		} else if (platform === "win32") {
			image = await readClipboardImageViaPowerShell(false);
		}
	}

	if (!image) {
		return null;
	}

	// Convert unsupported formats (e.g., Windows DIB data wrapped as BMP, TIFF) to PNG
	if (!isSupportedImageMimeType(image.mimeType)) {
		const pngBytes = await convertImageBytesToPng(image.bytes);
		if (!pngBytes) {
			return null;
		}
		return { bytes: pngBytes, mimeType: "image/png" };
	}

	return image;
}
