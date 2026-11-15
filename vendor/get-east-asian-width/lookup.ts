import {
	ambiguousMaximumCodePoint,
	ambiguousMinimalCodePoint,
	ambiguousRanges,
	fullwidthMaximumCodePoint,
	fullwidthMinimalCodePoint,
	fullwidthRanges,
	halfwidthMaximumCodePoint,
	halfwidthMinimalCodePoint,
	halfwidthRanges,
	narrowMaximumCodePoint,
	narrowMinimalCodePoint,
	narrowRanges,
	wideMaximumCodePoint,
	wideMinimalCodePoint,
	wideRanges,
} from "./lookup-data.ts";
import { isInRange } from "./utilities.ts";

export type WidthType = "fullwidth" | "halfwidth" | "wide" | "narrow" | "neutral" | "ambiguous";

const commonCjkCodePoint = 0x4e00;
const [wideFastPathStart, wideFastPathEnd] = findWideFastPathRange(wideRanges);

// Use a hot-path range so common `isWide` calls can skip binary search.
// The range containing U+4E00 covers common CJK ideographs;
// fallback to the largest range for resilience to Unicode table changes.
function findWideFastPathRange(ranges: readonly number[]): [number, number] {
	let fastPathStart = ranges[0]!;
	let fastPathEnd = ranges[1]!;

	for (let index = 0; index < ranges.length; index += 2) {
		const start = ranges[index]!;
		const end = ranges[index + 1]!;

		if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) {
			return [start, end];
		}

		if (end - start > fastPathEnd - fastPathStart) {
			fastPathStart = start;
			fastPathEnd = end;
		}
	}

	return [fastPathStart, fastPathEnd];
}

export const isAmbiguous = (codePoint: number): boolean => {
	if (codePoint < ambiguousMinimalCodePoint || codePoint > ambiguousMaximumCodePoint) {
		return false;
	}

	return isInRange(ambiguousRanges, codePoint);
};

export const isFullWidth = (codePoint: number): boolean => {
	if (codePoint < fullwidthMinimalCodePoint || codePoint > fullwidthMaximumCodePoint) {
		return false;
	}

	return isInRange(fullwidthRanges, codePoint);
};

const isHalfWidth = (codePoint: number): boolean => {
	if (codePoint < halfwidthMinimalCodePoint || codePoint > halfwidthMaximumCodePoint) {
		return false;
	}

	return isInRange(halfwidthRanges, codePoint);
};

const isNarrow = (codePoint: number): boolean => {
	if (codePoint < narrowMinimalCodePoint || codePoint > narrowMaximumCodePoint) {
		return false;
	}

	return isInRange(narrowRanges, codePoint);
};

export const isWide = (codePoint: number): boolean => {
	if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) {
		return true;
	}

	if (codePoint < wideMinimalCodePoint || codePoint > wideMaximumCodePoint) {
		return false;
	}

	return isInRange(wideRanges, codePoint);
};

export function getCategory(codePoint: number): WidthType {
	if (isAmbiguous(codePoint)) {
		return "ambiguous";
	}

	if (isFullWidth(codePoint)) {
		return "fullwidth";
	}

	if (isHalfWidth(codePoint)) {
		return "halfwidth";
	}

	if (isNarrow(codePoint)) {
		return "narrow";
	}

	if (isWide(codePoint)) {
		return "wide";
	}

	return "neutral";
}
