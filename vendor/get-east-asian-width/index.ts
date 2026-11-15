import { getCategory, isAmbiguous, isFullWidth, isWide, type WidthType } from "./lookup.ts";

export type { WidthType };

export type Options = {
	/**
	 * Whether to treat an `'ambiguous'` character as wide.
	 *
	 * @default false
	 */
	readonly ambiguousAsWide?: boolean;
};

function validate(codePoint: number): void {
	if (!Number.isSafeInteger(codePoint)) {
		throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
	}
}

/**
 * Returns the type of "East Asian Width" for the given code point.
 */
export function eastAsianWidthType(codePoint: number): WidthType {
	validate(codePoint);

	return getCategory(codePoint);
}

/**
 * Returns the width as a number for the given code point.
 */
export function eastAsianWidth(codePoint: number, { ambiguousAsWide = false }: Options = {}): 1 | 2 {
	validate(codePoint);

	if (isFullWidth(codePoint) || isWide(codePoint) || (ambiguousAsWide && isAmbiguous(codePoint))) {
		return 2;
	}

	return 1;
}

// Private exports for https://github.com/sindresorhus/is-fullwidth-code-point
export { isFullWidth as _isFullWidth, isWide as _isWide };
