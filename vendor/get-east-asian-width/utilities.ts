/**
 * Binary search on a sorted flat array of [start, end] pairs.
 *
 * @param ranges - Flat array of inclusive [start, end] range pairs, e.g. [0, 5, 10, 20].
 * @param codePoint - The value to search for.
 * @returns Whether the value falls within any of the ranges.
 */
export function isInRange(ranges: readonly number[], codePoint: number): boolean {
	let low = 0;
	let high = Math.floor(ranges.length / 2) - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const i = mid * 2;
		const start = ranges[i]!;
		const end = ranges[i + 1]!;
		if (codePoint < start) {
			high = mid - 1;
		} else if (codePoint > end) {
			low = mid + 1;
		} else {
			return true;
		}
	}

	return false;
}
