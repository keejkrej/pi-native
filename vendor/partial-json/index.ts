/**
 * Allow partial strings like `"hello \u12` to be parsed as `"hello "`
 */
export const STR = 0b000000001;
/**
 * Allow partial numbers like `123.` to be parsed as `123`
 */
export const NUM = 0b000000010;
/**
 * Allow partial arrays like `[1, 2,` to be parsed as `[1, 2]`
 */
export const ARR = 0b000000100;
/**
 * Allow partial objects like `{"a": 1, "b":` to be parsed as `{"a": 1}`
 */
export const OBJ = 0b000001000;
/**
 * Allow `nu` to be parsed as `null`
 */
export const NULL = 0b000010000;
/**
 * Allow `tr` to be parsed as `true`, and `fa` to be parsed as `false`
 */
export const BOOL = 0b000100000;
/**
 * Allow `Na` to be parsed as `NaN`
 */
export const NAN = 0b001000000;
/**
 * Allow `Inf` to be parsed as `Infinity`
 */
export const INFINITY = 0b010000000;
/**
 * Allow `-Inf` to be parsed as `-Infinity`
 */
export const _INFINITY = 0b100000000;
export const INF = INFINITY | _INFINITY;
export const SPECIAL = NULL | BOOL | INF | NAN;
export const ATOM = STR | NUM | SPECIAL;
export const COLLECTION = ARR | OBJ;
export const ALL = ATOM | COLLECTION;

/**
 * Control what types you allow to be partially parsed.
 */
export const Allow = {
	STR,
	NUM,
	ARR,
	OBJ,
	NULL,
	BOOL,
	NAN,
	INFINITY,
	_INFINITY,
	INF,
	SPECIAL,
	ATOM,
	COLLECTION,
	ALL,
};

export default Allow;

export class PartialJSON extends Error {}
export class MalformedJSON extends Error {}

/**
 * Parse incomplete JSON.
 *
 * @param jsonString Partial JSON to be parsed
 * @param allowPartial Specify what types are allowed to be partial, see {@link Allow} for details
 * @returns The parsed JSON
 * @throws {PartialJSON} If the JSON is incomplete (related to the `allow` parameter)
 * @throws {MalformedJSON} If the JSON is malformed
 */
export function parseJSON(jsonString: string, allowPartial: number = Allow.ALL): any {
	if (typeof jsonString !== "string") {
		throw new TypeError(`expecting str, got ${typeof jsonString}`);
	}
	if (!jsonString.trim()) {
		throw new Error(`${jsonString} is empty`);
	}
	return _parseJSON(jsonString.trim(), allowPartial);
}

export const parse = parseJSON;

function _parseJSON(jsonString: string, allow: number): any {
	const length = jsonString.length;
	let index = 0;

	const markPartialJSON = (msg: string): never => {
		throw new PartialJSON(`${msg} at position ${index}`);
	};
	const throwMalformedError = (msg: string): never => {
		throw new MalformedJSON(`${msg} at position ${index}`);
	};

	const skipBlank = (): void => {
		while (index < length && " \n\r\t".includes(jsonString[index]!)) {
			index++;
		}
	};

	const parseStr = (): string => {
		const start = index;
		let escape = false;
		index++; // skip initial quote
		while (index < length && (jsonString[index] !== '"' || (escape && jsonString[index - 1] === "\\"))) {
			escape = jsonString[index] === "\\" ? !escape : false;
			index++;
		}
		if (jsonString.charAt(index) === '"') {
			try {
				return JSON.parse(jsonString.substring(start, ++index - Number(escape))) as string;
			} catch (e) {
				return throwMalformedError(String(e));
			}
		}
		if (Allow.STR & allow) {
			try {
				return JSON.parse(`${jsonString.substring(start, index - Number(escape))}"`) as string;
			} catch {
				// SyntaxError: Invalid escape sequence
				return JSON.parse(`${jsonString.substring(start, jsonString.lastIndexOf("\\"))}"`) as string;
			}
		}
		return markPartialJSON("Unterminated string literal");
	};

	const parseNum = (): number => {
		if (index === 0) {
			if (jsonString === "-") {
				return throwMalformedError("Not sure what '-' is");
			}
			try {
				return JSON.parse(jsonString) as number;
			} catch (e) {
				if (Allow.NUM & allow) {
					try {
						return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf("e"))) as number;
					} catch {
						// fall through
					}
				}
				return throwMalformedError(String(e));
			}
		}
		const start = index;
		if (jsonString[index] === "-") {
			index++;
		}
		while (jsonString[index] && ",]}".indexOf(jsonString[index]!) === -1) {
			index++;
		}
		if (index === length && !(Allow.NUM & allow)) {
			markPartialJSON("Unterminated number literal");
		}
		try {
			return JSON.parse(jsonString.substring(start, index)) as number;
		} catch (e) {
			if (jsonString.substring(start, index) === "-") {
				markPartialJSON("Not sure what '-' is");
			}
			try {
				return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("e"))) as number;
			} catch {
				return throwMalformedError(String(e));
			}
		}
	};

	const parseObj = (): Record<string, any> => {
		index++; // skip initial brace
		skipBlank();
		const obj: Record<string, any> = {};
		try {
			while (jsonString[index] !== "}") {
				skipBlank();
				if (index >= length && Allow.OBJ & allow) {
					return obj;
				}
				const key = parseStr();
				skipBlank();
				index++; // skip colon
				try {
					const value = parseAny();
					obj[key] = value;
				} catch (e) {
					if (Allow.OBJ & allow) {
						return obj;
					}
					throw e;
				}
				skipBlank();
				if (jsonString[index] === ",") {
					index++; // skip comma
				}
			}
		} catch {
			if (Allow.OBJ & allow) {
				return obj;
			}
			markPartialJSON("Expected '}' at end of object");
		}
		index++; // skip final brace
		return obj;
	};

	const parseArr = (): any[] => {
		index++; // skip initial bracket
		const arr: any[] = [];
		try {
			while (jsonString[index] !== "]") {
				arr.push(parseAny());
				skipBlank();
				if (jsonString[index] === ",") {
					index++; // skip comma
				}
			}
		} catch {
			if (Allow.ARR & allow) {
				return arr;
			}
			markPartialJSON("Expected ']' at end of array");
		}
		index++; // skip final bracket
		return arr;
	};

	const parseAny = (): any => {
		skipBlank();
		if (index >= length) {
			markPartialJSON("Unexpected end of input");
		}
		if (jsonString[index] === '"') {
			return parseStr();
		}
		if (jsonString[index] === "{") {
			return parseObj();
		}
		if (jsonString[index] === "[") {
			return parseArr();
		}
		if (
			jsonString.substring(index, index + 4) === "null" ||
			(Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index)))
		) {
			index += 4;
			return null;
		}
		if (
			jsonString.substring(index, index + 4) === "true" ||
			(Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index)))
		) {
			index += 4;
			return true;
		}
		if (
			jsonString.substring(index, index + 5) === "false" ||
			(Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index)))
		) {
			index += 5;
			return false;
		}
		if (
			jsonString.substring(index, index + 8) === "Infinity" ||
			(Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index)))
		) {
			index += 8;
			return Infinity;
		}
		if (
			jsonString.substring(index, index + 9) === "-Infinity" ||
			(Allow._INFINITY & allow &&
				1 < length - index &&
				length - index < 9 &&
				"-Infinity".startsWith(jsonString.substring(index)))
		) {
			index += 9;
			return -Infinity;
		}
		if (
			jsonString.substring(index, index + 3) === "NaN" ||
			(Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index)))
		) {
			index += 3;
			return NaN;
		}
		return parseNum();
	};

	return parseAny();
}
