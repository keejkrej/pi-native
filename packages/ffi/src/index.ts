declare function piFfiAvailable(): number;
declare function piFfiReadScratch(out: Uint8Array): number;
declare function piFfiClipboardGetText(): number;
declare function piFfiClipboardSetText(text: string): number;
declare function piFfiClipboardGetImagePng(): number;
declare function piFfiClipboardGetFilePaths(): number;
declare function piFfiIsModifierPressed(name: string): number;
declare function piFfiImageInspect(bytes: Uint8Array, out: Uint8Array): number;
declare function piFfiImageTransform(
	bytes: Uint8Array,
	targetWidth: number,
	targetHeight: number,
	format: number,
	jpegQuality: number,
	applyOrientation: number,
): number;
declare function piFfiWordSegment(text: string): number;
declare function piFfiJscCreate(): number;
declare function piFfiJscEval(
	vmId: number,
	code: string,
	sourceUrl: string,
	timeoutMs: number,
	outTag: Uint8Array,
): number;
declare function piFfiJscDestroy(vmId: number): void;

export interface NativeImageInfo {
	width: number;
	height: number;
	orientation: number;
}

export interface NativeWordSegment {
	segment: string;
	index: number;
	isWordLike: boolean;
}

export type NativeJscEvalResult =
	| { ok: true; value: string }
	| { ok: false; timedOut?: boolean; error: string };

let cachedFfiAvailable: boolean | null = null;
const utf8Decoder = new TextDecoder();
const wordLikeRe = /[\p{L}\p{N}]/u;

function readScratchBytes(len: number): Uint8Array {
	if (len <= 0) return new Uint8Array(0);
	const out = new Uint8Array(len);
	const copied = piFfiReadScratch(out);
	if (copied <= 0) return new Uint8Array(0);
	return copied === len ? out : out.subarray(0, copied);
}

function readU32Le(bytes: Uint8Array, offset: number): number {
	const b0 = bytes[offset] ?? 0;
	const b1 = bytes[offset + 1] ?? 0;
	const b2 = bytes[offset + 2] ?? 0;
	const b3 = bytes[offset + 3] ?? 0;
	return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

export function isNativeDarwinAvailable(): boolean {
	if (typeof process !== "undefined" && process.platform !== "darwin") {
		return false;
	}
	if (cachedFfiAvailable === null) {
		try {
			cachedFfiAvailable = piFfiAvailable() === 1;
		} catch {
			cachedFfiAvailable = false;
		}
	}
	return cachedFfiAvailable;
}

export function nativeClipboardGetText(): string | null {
	if (!isNativeDarwinAvailable()) return null;
	const len = piFfiClipboardGetText();
	if (len === -1) return null;
	if (len < -1) {
		throw new Error("Failed to read clipboard text from Darwin pasteboard");
	}
	if (len === 0) return "";
	return utf8Decoder.decode(readScratchBytes(len));
}

export function nativeClipboardSetText(text: string): boolean {
	if (!isNativeDarwinAvailable()) return false;
	return piFfiClipboardSetText(text) === 1;
}

export function nativeClipboardGetImagePng(): Uint8Array | null {
	if (!isNativeDarwinAvailable()) return null;
	const len = piFfiClipboardGetImagePng();
	if (len === -1) return null;
	if (len < -1) {
		throw new Error("Failed to read clipboard image from Darwin pasteboard");
	}
	if (len === 0) return null;
	const bytes = readScratchBytes(len);
	return bytes.byteLength > 0 ? bytes : null;
}

export function nativeClipboardGetFilePaths(): string[] | null {
	if (!isNativeDarwinAvailable()) return null;
	const len = piFfiClipboardGetFilePaths();
	if (len === -1) return null;
	if (len < -1) {
		throw new Error("Failed to read clipboard file paths from Darwin pasteboard");
	}
	if (len === 0) return null;
	const raw = utf8Decoder.decode(readScratchBytes(len));
	const paths = raw.split("\0").filter((p) => p.length > 0);
	return paths.length > 0 ? paths : null;
}

export function nativeIsModifierPressed(name: "shift" | "command" | "control" | "option"): boolean {
	if (!isNativeDarwinAvailable()) return false;
	return piFfiIsModifierPressed(name) === 1;
}

export function nativeImageInspect(bytes: Uint8Array): NativeImageInfo | null {
	if (!isNativeDarwinAvailable() || bytes.byteLength === 0) return null;
	const out = new Uint8Array(12);
	if (piFfiImageInspect(bytes, out) !== 0) return null;
	const width = readU32Le(out, 0);
	const height = readU32Le(out, 4);
	const orientation = readU32Le(out, 8);
	if (width === 0 || height === 0) return null;
	return {
		width,
		height,
		orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
	};
}

export function nativeImageTransform(
	bytes: Uint8Array,
	targetWidth: number,
	targetHeight: number,
	format: "png" | "jpeg",
	jpegQuality: number,
	applyOrientation: boolean,
): Uint8Array | null {
	if (!isNativeDarwinAvailable() || bytes.byteLength === 0) return null;
	const w = targetWidth > 0 && Number.isFinite(targetWidth) ? Math.max(1, Math.round(targetWidth)) : 0;
	const h = targetHeight > 0 && Number.isFinite(targetHeight) ? Math.max(1, Math.round(targetHeight)) : 0;
	const fmtCode = format === "jpeg" ? 1 : 0;
	const q = Number.isFinite(jpegQuality) ? Math.min(100, Math.max(0, Math.round(jpegQuality))) : 85;
	const applyFlag = applyOrientation ? 1 : 0;
	const len = piFfiImageTransform(bytes, w, h, fmtCode, q, applyFlag);
	if (len <= 0) return null;
	const out = readScratchBytes(len);
	return out.byteLength > 0 ? out : null;
}

export function nativeWordSegment(text: string): NativeWordSegment[] | null {
	if (!isNativeDarwinAvailable()) return null;
	if (text.length === 0) return [];
	const byteLen = piFfiWordSegment(text);
	if (byteLen < 0 || byteLen % 12 !== 0) return null;
	const raw = readScratchBytes(byteLen);
	if (raw.byteLength !== byteLen) return null;

	const result: NativeWordSegment[] = [];
	let expectedPos = 0;
	for (let offset = 0; offset < raw.byteLength; offset += 12) {
		const start = readU32Le(raw, offset);
		const end = readU32Le(raw, offset + 4);
		const wordLikeFlag = readU32Le(raw, offset + 8);
		if (start !== expectedPos || end < start || end > text.length) {
			return null;
		}
		if (end > start) {
			const seg = text.slice(start, end);
			result.push({
				segment: seg,
				index: start,
				isWordLike: wordLikeFlag === 1 || wordLikeRe.test(seg),
			});
			expectedPos = end;
		}
	}
	if (expectedPos !== text.length) {
		return null;
	}
	return result;
}

export function nativeJscCreate(): number {
	if (!isNativeDarwinAvailable()) return -1;
	return piFfiJscCreate();
}

export function nativeJscEval(
	vmId: number,
	code: string,
	sourceUrl?: string,
	timeoutMs?: number,
): NativeJscEvalResult {
	if (!isNativeDarwinAvailable()) {
		return { ok: false, error: "Native Darwin JSC FFI is unavailable" };
	}
	if (!Number.isInteger(vmId) || vmId < 1) {
		return { ok: false, error: `Invalid JSC VM id: ${String(vmId)}` };
	}
	const outTag = new Uint8Array(1);
	const url = sourceUrl ?? "";
	const ms = timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : -1;
	const byteLen = piFfiJscEval(vmId, code, url, ms, outTag);
	if (byteLen < 0) {
		return { ok: false, error: `Invalid or destroyed JSC VM id: ${String(vmId)}` };
	}
	const tag = outTag[0] ?? 1;
	const payload = byteLen > 0 ? utf8Decoder.decode(readScratchBytes(byteLen)) : "";
	if (tag === 0) {
		return { ok: true, value: payload };
	}
	if (tag === 2) {
		return { ok: false, timedOut: true, error: payload.length > 0 ? payload : "Execution timed out" };
	}
	return { ok: false, error: payload.length > 0 ? payload : "JavaScript error" };
}

export function nativeJscDestroy(vmId: number): void {
	if (!isNativeDarwinAvailable()) return;
	if (!Number.isInteger(vmId) || vmId < 1) return;
	piFfiJscDestroy(vmId);
}
