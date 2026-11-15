// Regular expressions shared across all compiled schemas: tool schemas repeat a few patterns many times,
// and a RegExp is large once it has run. Bounded FIFO cache to stay compatible with scriptc.

const MAX_SHARED_REGEXES = 1024;
const regexes = new Map<string, RegExp>();

/**
 * The regular expression of a `pattern` source, shared by source. Patterns are ECMAScript regular expressions with
 * the `u` flag; a source that is invalid with it (some older schemas escape characters `u` rejects) compiles
 * without it.
 */
export function sharedRegex(source: string): RegExp {
	const hit = regexes.get(source);
	if (hit !== undefined) return hit;
	let re: RegExp;
	try {
		re = new RegExp(source, "u");
	} catch {
		re = new RegExp(source);
	}
	if (regexes.size >= MAX_SHARED_REGEXES) {
		const oldest = regexes.keys().next().value;
		if (oldest !== undefined) regexes.delete(oldest);
	}
	regexes.set(source, re);
	return re;
}

/** The number of cached regular expressions (for tests). */
export function sharedRegexCount(): number {
	return regexes.size;
}
