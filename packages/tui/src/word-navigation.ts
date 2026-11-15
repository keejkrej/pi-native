import { getWordSegmenter, isWhitespaceChar, PUNCTUATION_REGEX } from "./utils.ts";

const wordSegmenter = getWordSegmenter();

/**
 * Options for word navigation functions.
 * When omitted, uses the default Intl.Segmenter word segmentation.
 */
export interface WordNavigationOptions {
	/** Custom segmenter returning word segments for the given text. */
	segment?: (text: string) => Iterable<Intl.SegmentData>;
	/** Predicate identifying atomic segments that should be treated as single units (e.g. paste markers). */
	isAtomicSegment?: (segment: string) => boolean;
}

/**
 * Find the cursor position after moving one word backward from `cursor` in `text`.
 * Skips trailing whitespace, then stops at the next word/punctuation boundary.
 *
 * Pure function - does not mutate any state.
 */
export function findWordBackward(text: string, cursor: number, options?: WordNavigationOptions): number {
	if (cursor <= 0) return 0;

	const textBeforeCursor = text.slice(0, cursor);
	const segmentFn = options?.segment;
	const isAtomic = options?.isAtomicSegment;
	const segments = segmentFn ? [...segmentFn(textBeforeCursor)] : [...wordSegmenter.segment(textBeforeCursor)];
	let newCursor = cursor;

	// Skip trailing whitespace
	while (segments.length > 0) {
		const seg = segments[segments.length - 1]!;
		if (isAtomic?.(seg.segment) || !isWhitespaceChar(seg.segment)) break;
		segments.pop();
		newCursor -= seg.segment.length;
	}

	if (segments.length === 0) return newCursor;

	const last = segments[segments.length - 1]!;

	if (isAtomic?.(last.segment)) {
		// Skip one atomic segment.
		newCursor -= last.segment.length;
	} else if (last.isWordLike) {
		// Skip inside one word-like segment, preserving ASCII punctuation boundaries.
		const segment = last.segment;
		const matches = [...segment.matchAll(new RegExp(PUNCTUATION_REGEX, "g"))];
		if (matches.length <= 0) {
			newCursor -= segment.length;
		} else {
			const lastMatch = matches[matches.length - 1]!;
			newCursor -= segment.length - (lastMatch.index + lastMatch[0].length);
		}
	} else {
		// Skip non-word non-whitespace run (punctuation)
		while (segments.length > 0) {
			const seg = segments[segments.length - 1]!;
			if (isAtomic?.(seg.segment) || seg.isWordLike || isWhitespaceChar(seg.segment)) break;
			segments.pop();
			newCursor -= seg.segment.length;
		}
	}

	return newCursor;
}

/**
 * Find the cursor position after moving one word forward from `cursor` in `text`.
 * Skips leading whitespace, then stops at the next word/punctuation boundary.
 *
 * Pure function - does not mutate any state.
 */
export function findWordForward(text: string, cursor: number, options?: WordNavigationOptions): number {
	if (cursor >= text.length) return text.length;

	const textAfterCursor = text.slice(cursor);
	const segmentFn = options?.segment;
	const isAtomic = options?.isAtomicSegment;
	const segments = segmentFn ? [...segmentFn(textAfterCursor)] : [...wordSegmenter.segment(textAfterCursor)];
	let idx = 0;
	let newCursor = cursor;

	// Skip leading whitespace
	while (idx < segments.length) {
		const seg = segments[idx]!;
		if (isAtomic?.(seg.segment) || !isWhitespaceChar(seg.segment)) break;
		newCursor += seg.segment.length;
		idx += 1;
	}

	if (idx >= segments.length) return newCursor;

	const current = segments[idx]!;
	if (isAtomic?.(current.segment)) {
		// Skip one atomic segment.
		newCursor += current.segment.length;
	} else if (current.isWordLike) {
		// Skip inside one word-like segment, preserving ASCII punctuation boundaries.
		const match = PUNCTUATION_REGEX.exec(current.segment);
		newCursor += match ? match.index : current.segment.length;
	} else {
		// Skip non-word non-whitespace run (punctuation)
		while (idx < segments.length) {
			const seg = segments[idx]!;
			if (isAtomic?.(seg.segment) || seg.isWordLike || isWhitespaceChar(seg.segment)) break;
			newCursor += seg.segment.length;
			idx += 1;
		}
	}

	return newCursor;
}
