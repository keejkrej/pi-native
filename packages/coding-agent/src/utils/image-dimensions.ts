/**
 * Pure TypeScript image dimension and EXIF orientation parser.
 * Supports PNG, GIF, JPEG, WebP, and BMP without native or WASM dependencies.
 */

export type ImageFormat = "png" | "gif" | "jpeg" | "webp" | "bmp";

export interface ImageDimensionsInfo {
	width: number;
	height: number;
	orientation: number;
	format: ImageFormat;
}

function u8(bytes: Uint8Array, offset: number): number {
	return offset >= 0 && offset < bytes.length ? (bytes[offset] ?? 0) : 0;
}

function u16BE(bytes: Uint8Array, offset: number): number {
	return (u8(bytes, offset) << 8) | u8(bytes, offset + 1);
}

function u16LE(bytes: Uint8Array, offset: number): number {
	return u8(bytes, offset) | (u8(bytes, offset + 1) << 8);
}

function u24LE(bytes: Uint8Array, offset: number): number {
	return u8(bytes, offset) | (u8(bytes, offset + 1) << 8) | (u8(bytes, offset + 2) << 16);
}

function u32BE(bytes: Uint8Array, offset: number): number {
	return (
		((u8(bytes, offset) << 24) |
			(u8(bytes, offset + 1) << 16) |
			(u8(bytes, offset + 2) << 8) |
			u8(bytes, offset + 3)) >>>
		0
	);
}

function u32LE(bytes: Uint8Array, offset: number): number {
	return (
		(u8(bytes, offset) |
			(u8(bytes, offset + 1) << 8) |
			(u8(bytes, offset + 2) << 16) |
			(u8(bytes, offset + 3) << 24)) >>>
		0
	);
}

function i32LE(bytes: Uint8Array, offset: number): number {
	return (
		u8(bytes, offset) |
		(u8(bytes, offset + 1) << 8) |
		(u8(bytes, offset + 2) << 16) |
		(u8(bytes, offset + 3) << 24)
	);
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
	if (offset < 0 || offset + text.length > bytes.length) return false;
	for (let i = 0; i < text.length; i++) {
		if (u8(bytes, offset + i) !== text.charCodeAt(i)) return false;
	}
	return true;
}

function hasExifHeader(bytes: Uint8Array, offset: number): boolean {
	return (
		offset >= 0 &&
		offset + 6 <= bytes.length &&
		u8(bytes, offset) === 0x45 &&
		u8(bytes, offset + 1) === 0x78 &&
		u8(bytes, offset + 2) === 0x69 &&
		u8(bytes, offset + 3) === 0x66 &&
		u8(bytes, offset + 4) === 0x00 &&
		u8(bytes, offset + 5) === 0x00
	);
}

function readOrientationFromTiff(bytes: Uint8Array, tiffStart: number, limit: number): number {
	if (tiffStart < 0 || tiffStart + 8 > limit) return 1;

	const byteOrder = u16BE(bytes, tiffStart);
	if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return 1;
	const le = byteOrder === 0x4949;

	const read16 = (pos: number): number => (le ? u16LE(bytes, pos) : u16BE(bytes, pos));
	const read32 = (pos: number): number => (le ? u32LE(bytes, pos) : u32BE(bytes, pos));

	if (read16(tiffStart + 2) !== 42) return 1;

	const ifdOffset = read32(tiffStart + 4);
	const ifdStart = tiffStart + ifdOffset;
	if (ifdStart < tiffStart || ifdStart + 2 > limit) return 1;

	const entryCount = read16(ifdStart);
	for (let i = 0; i < entryCount; i++) {
		const entryPos = ifdStart + 2 + i * 12;
		if (entryPos + 12 > limit) return 1;

		if (read16(entryPos) === 0x0112) {
			const value = read16(entryPos + 8);
			return value >= 1 && value <= 8 ? value : 1;
		}
	}

	return 1;
}

function parsePng(bytes: Uint8Array): ImageDimensionsInfo | null {
	if (bytes.length < 24) return null;
	if (
		u8(bytes, 0) !== 0x89 ||
		u8(bytes, 1) !== 0x50 ||
		u8(bytes, 2) !== 0x4e ||
		u8(bytes, 3) !== 0x47 ||
		u8(bytes, 4) !== 0x0d ||
		u8(bytes, 5) !== 0x0a ||
		u8(bytes, 6) !== 0x1a ||
		u8(bytes, 7) !== 0x0a
	) {
		return null;
	}
	if (u32BE(bytes, 8) < 13 || !matchesAscii(bytes, 12, "IHDR")) return null;
	const width = u32BE(bytes, 16);
	const height = u32BE(bytes, 20);
	if (width <= 0 || height <= 0) return null;
	return { width, height, orientation: 1, format: "png" };
}

function parseGif(bytes: Uint8Array): ImageDimensionsInfo | null {
	if (bytes.length < 10) return null;
	if (!matchesAscii(bytes, 0, "GIF87a") && !matchesAscii(bytes, 0, "GIF89a")) {
		return null;
	}
	const width = u16LE(bytes, 6);
	const height = u16LE(bytes, 8);
	if (width <= 0 || height <= 0) return null;
	return { width, height, orientation: 1, format: "gif" };
}

function parseBmp(bytes: Uint8Array): ImageDimensionsInfo | null {
	if (bytes.length < 26) return null;
	if (u8(bytes, 0) !== 0x42 || u8(bytes, 1) !== 0x4d) return null;

	const dibSize = u32LE(bytes, 14);
	let width = 0;
	let height = 0;
	if (dibSize === 12) {
		width = u16LE(bytes, 18);
		height = u16LE(bytes, 20);
	} else if (dibSize >= 40) {
		width = i32LE(bytes, 18);
		height = Math.abs(i32LE(bytes, 22));
	} else {
		return null;
	}

	if (width <= 0 || height <= 0) return null;
	return { width, height, orientation: 1, format: "bmp" };
}

function isJpegSofMarker(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function parseJpeg(bytes: Uint8Array): ImageDimensionsInfo | null {
	if (bytes.length < 4 || u8(bytes, 0) !== 0xff || u8(bytes, 1) !== 0xd8) {
		return null;
	}

	let width = 0;
	let height = 0;
	let orientation = 1;
	let offset = 2;

	while (offset + 1 < bytes.length) {
		if (u8(bytes, offset) !== 0xff) {
			break;
		}
		while (offset + 1 < bytes.length && u8(bytes, offset + 1) === 0xff) {
			offset++;
		}
		if (offset + 1 >= bytes.length) break;

		const marker = u8(bytes, offset + 1);
		if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) {
			break;
		}
		if (offset + 4 > bytes.length) break;

		const length = u16BE(bytes, offset + 2);
		if (length < 2) break;
		const segmentEnd = offset + 2 + length;

		if (marker === 0xe1) {
			const segmentDataStart = offset + 4;
			const segmentLimit = Math.min(bytes.length, segmentEnd);
			if (segmentDataStart + 6 <= segmentLimit && hasExifHeader(bytes, segmentDataStart)) {
				const parsedOrientation = readOrientationFromTiff(bytes, segmentDataStart + 6, segmentLimit);
				if (orientation === 1 && parsedOrientation !== 1) {
					orientation = parsedOrientation;
				}
			}
		} else if (width === 0 && isJpegSofMarker(marker)) {
			if (offset + 9 <= bytes.length && offset + 9 <= segmentEnd) {
				height = u16BE(bytes, offset + 5);
				width = u16BE(bytes, offset + 7);
			}
		}

		if (segmentEnd > bytes.length) break;
		offset = segmentEnd;
	}

	if (width <= 0 || height <= 0) return null;
	return { width, height, orientation, format: "jpeg" };
}

function parseWebp(bytes: Uint8Array): ImageDimensionsInfo | null {
	if (bytes.length < 12 || !matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) {
		return null;
	}

	let width = 0;
	let height = 0;
	let orientation = 1;
	let offset = 12;

	while (offset + 8 <= bytes.length) {
		const chunkSize = u32LE(bytes, offset + 4);
		if (chunkSize > 0x7fffffff) break;
		const dataStart = offset + 8;

		if (width === 0 && matchesAscii(bytes, offset, "VP8 ")) {
			if (
				dataStart + 10 <= bytes.length &&
				(u8(bytes, dataStart) & 0x01) === 0 &&
				u8(bytes, dataStart + 3) === 0x9d &&
				u8(bytes, dataStart + 4) === 0x01 &&
				u8(bytes, dataStart + 5) === 0x2a
			) {
				width = u16LE(bytes, dataStart + 6) & 0x3fff;
				height = u16LE(bytes, dataStart + 8) & 0x3fff;
			}
		} else if (width === 0 && matchesAscii(bytes, offset, "VP8L")) {
			if (dataStart + 5 <= bytes.length && u8(bytes, dataStart) === 0x2f) {
				const bits = u32LE(bytes, dataStart + 1);
				width = (bits & 0x3fff) + 1;
				height = ((bits >> 14) & 0x3fff) + 1;
			}
		} else if (width === 0 && matchesAscii(bytes, offset, "VP8X")) {
			if (dataStart + 10 <= bytes.length) {
				width = u24LE(bytes, dataStart + 4) + 1;
				height = u24LE(bytes, dataStart + 7) + 1;
			}
		} else if (matchesAscii(bytes, offset, "EXIF")) {
			const chunkLimit = Math.min(bytes.length, dataStart + chunkSize);
			if (dataStart + chunkSize <= bytes.length && chunkSize >= 8) {
				const tiffStart = hasExifHeader(bytes, dataStart) ? dataStart + 6 : dataStart;
				orientation = readOrientationFromTiff(bytes, tiffStart, chunkLimit);
			}
		}

		const nextOffset = dataStart + chunkSize + (chunkSize & 1);
		if (nextOffset <= offset) break;
		offset = nextOffset;
	}

	if (width <= 0 || height <= 0) return null;
	return { width, height, orientation, format: "webp" };
}

/**
 * Extract the EXIF orientation (1..8) for JPEG or WebP bytes. Defaults to 1.
 */
export function getExifOrientation(bytes: Uint8Array): number {
	if (bytes.length >= 4 && u8(bytes, 0) === 0xff && u8(bytes, 1) === 0xd8) {
		return parseJpeg(bytes)?.orientation ?? 1;
	}
	if (bytes.length >= 12 && matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WEBP")) {
		return parseWebp(bytes)?.orientation ?? 1;
	}
	return 1;
}

/**
 * Strip EXIF/XMP chunks (`eXIf` and Adobe XMP `iTXt`) from PNG bytes after pixel orientation has
 * already been applied, preventing EXIF-aware viewers from double-rotating the image.
 */
export function stripPngOrientationChunks(bytes: Uint8Array): Uint8Array {
	if (bytes.length < 8 || u32BE(bytes, 0) !== 0x89504e47 || u32BE(bytes, 4) !== 0x0d0a1a0a) {
		return bytes;
	}

	const keptRanges: Array<[number, number]> = [[0, 8]];
	let removed = false;
	let totalLength = 8;
	let offset = 8;

	while (offset < bytes.length) {
		if (offset + 12 > bytes.length) {
			return bytes;
		}
		const length = u32BE(bytes, offset);
		const nextOffset = offset + 12 + length;
		if (length > 0x7fffffff || nextOffset > bytes.length) {
			return bytes;
		}

		const isExifChunk = matchesAscii(bytes, offset + 4, "eXIf");
		const isXmpChunk =
			matchesAscii(bytes, offset + 4, "iTXt") &&
			length >= 18 &&
			matchesAscii(bytes, offset + 8, "XML:com.adobe.xmp\0");

		if (isExifChunk || isXmpChunk) {
			removed = true;
		} else {
			keptRanges.push([offset, nextOffset]);
			totalLength += nextOffset - offset;
		}
		offset = nextOffset;
	}

	if (!removed) {
		return bytes;
	}

	const out = new Uint8Array(totalLength);
	let writeOffset = 0;
	for (const [start, end] of keptRanges) {
		const slice = bytes.subarray(start, end);
		out.set(slice, writeOffset);
		writeOffset += slice.length;
	}
	return out;
}

/**
 * Parse pixel dimensions, EXIF orientation (1..8), and container format from raw image bytes.
 * Returns null if the bytes are not a recognized PNG, GIF, JPEG, WebP, or BMP image.
 */
export function parseImageDimensions(bytes: Uint8Array): ImageDimensionsInfo | null {
	return parsePng(bytes) ?? parseGif(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes) ?? parseBmp(bytes);
}
