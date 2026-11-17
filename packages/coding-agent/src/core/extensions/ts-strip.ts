/**
 * Pure TypeScript lexical/syntactic stripper, ESM-to-CommonJS transformer,
 * and local dependency graph bundler for external extensions in pi-native.
 *
 * Designed for scriptc (--node-islands=off): zero third-party parsers,
 * zero Node vm/compiler dependencies, zero Proxy/Reflect usage.
 */

import * as fs from "node:fs";
import * as path from "node:path";

type TokenKind =
	| "ident"
	| "priv_ident"
	| "num"
	| "str"
	| "tpl_full"
	| "tpl_head"
	| "tpl_mid"
	| "tpl_tail"
	| "regex"
	| "op"
	| "eof";

interface Token {
	kind: TokenKind;
	text: string;
	start: number;
	end: number;
	newlineBefore: boolean;
}

interface TextEdit {
	start: number;
	end: number;
	text: string;
}

const MULTI_OPS = [
	">>>=",
	"===",
	"!==",
	">>>",
	"<<=",
	">>=",
	"**=",
	"&&=",
	"||=",
	"??=",
	"...",
	"=>",
	"<=",
	">=",
	"==",
	"!=",
	"++",
	"--",
	"<<",
	">>",
	"**",
	"&&",
	"||",
	"??",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"&=",
	"|=",
	"^=",
] as const;

const REGEX_BEFORE_KEYWORDS = new Set([
	"return",
	"throw",
	"case",
	"default",
	"delete",
	"void",
	"typeof",
	"await",
	"yield",
	"in",
	"instanceof",
	"of",
	"new",
	"else",
	"do",
	"try",
	"finally",
	"export",
]);

const CONTROL_PAREN_KEYWORDS = new Set(["if", "while", "for", "with"]);

const NON_TYPE_CONT_OPS = new Set([
	";",
	",",
	")",
	"]",
	"}",
	"=",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"<<=",
	">>=",
	">>>=",
	"**=",
	"&&=",
	"||=",
	"??=",
	"&=",
	"|=",
	"^=",
	"&&",
	"||",
	"??",
	"==",
	"!=",
	"===",
	"!==",
	"+",
	"*",
	"/",
	"%",
	"^",
	"~",
	"<<",
	">>",
	">>>",
	"<=",
	">=",
	"++",
	"--",
	"?.",
	"!",
]);

const INCOMPLETE_TYPE_END_TOKENS = new Set([
	"=",
	"|",
	"&",
	"<",
	",",
	"=>",
	"(",
	"[",
	"{",
	"?",
	":",
	".",
	"extends",
	"infer",
	"keyof",
	"readonly",
	"typeof",
	"unique",
	"asserts",
	"new",
	"abstract",
]);

const CLASS_MEMBER_MODIFIERS = new Set([
	"public",
	"private",
	"protected",
	"readonly",
	"override",
	"abstract",
	"declare",
]);

const PARAM_MODIFIERS = new Set(["public", "private", "protected", "readonly", "override"]);

const BUILTIN_NODE_MODULES = new Set([
	"assert",
	"buffer",
	"child_process",
	"crypto",
	"events",
	"fs",
	"fs/promises",
	"http",
	"https",
	"module",
	"net",
	"os",
	"path",
	"path/posix",
	"path/win32",
	"process",
	"querystring",
	"readline",
	"stream",
	"string_decoder",
	"timers",
	"timers/promises",
	"tty",
	"url",
	"util",
	"vm",
	"zlib",
]);

export const HOST_VIRTUAL_PACKAGES = new Set([
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-tui",
	"@earendil-works/pi-agent-core",
	"@mariozechner/pi-coding-agent",
	"@mariozechner/pi-ai",
	"@mariozechner/pi-tui",
	"@mariozechner/pi-agent-core",
	"typebox",
	"@sinclair/typebox",
]);

export interface BundledExtensionGraph {
	entry: string;
	modules: Record<string, string>;
	jsonModules: Record<string, string>;
	specifierMap: Record<string, Record<string, string>>;
	virtualSpecifiers: string[];
	missingSpecifiers: Array<{ from: string; specifier: string }>;
}

function isIdentStart(ch: number): boolean {
	return (
		(ch >= 65 && ch <= 90) ||
		(ch >= 97 && ch <= 122) ||
		ch === 95 ||
		ch === 36 ||
		ch >= 128
	);
}

function isIdentPart(ch: number): boolean {
	return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

function isDigit(ch: number): boolean {
	return ch >= 48 && ch <= 57;
}

function isHexDigit(ch: number): boolean {
	return (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 70) || (ch >= 97 && ch <= 102);
}

function isWhitespace(ch: number): boolean {
	return ch === 32 || ch === 9 || ch === 11 || ch === 12 || ch === 0xa0 || ch === 0xfeff;
}

/**
 * Tokenize JS/TS source into significant tokens while accurately tracking
 * strings, nested template literals `${...}`, comments, and regex literals.
 */
function tokenize(source: string): { tokens: Token[]; shebangEnd: number } {
	const len = source.length;
	const tokens: Token[] = [];
	let i = 0;
	let shebangEnd = 0;

	if (len >= 2 && source[0] === "#" && source[1] === "!") {
		while (i < len && source[i] !== "\n") {
			i++;
		}
		shebangEnd = i;
	}

	let pendingNewline = false;
	let canStartRegex = true;
	const templateBraceStack: number[] = [];
	const parenControlStack: boolean[] = [];
	const braceBlockStack: boolean[] = [];

	const prevSigToken = (): Token | undefined => (tokens.length > 0 ? tokens[tokens.length - 1] : undefined);
	const prevPrevSigToken = (): Token | undefined => (tokens.length > 1 ? tokens[tokens.length - 2] : undefined);

	const pushToken = (kind: TokenKind, start: number, end: number) => {
		tokens.push({
			kind,
			text: source.slice(start, end),
			start,
			end,
			newlineBefore: pendingNewline,
		});
		pendingNewline = false;
	};

	const scanTemplateSegment = (isResume: boolean) => {
		const start = isResume ? i - 1 : i;
		if (!isResume) {
			i++; // skip opening backtick
		}
		while (i < len) {
			const ch = source.charCodeAt(i);
			if (ch === 92) {
				// backslash escape
				i += 2;
				continue;
			}
			if (ch === 96) {
				// closing backtick
				i++;
				pushToken(isResume ? "tpl_tail" : "tpl_full", start, i);
				canStartRegex = false;
				return;
			}
			if (ch === 36 && i + 1 < len && source.charCodeAt(i + 1) === 123) {
				// ${
				i += 2;
				pushToken(isResume ? "tpl_mid" : "tpl_head", start, i);
				templateBraceStack.push(0);
				canStartRegex = true;
				return;
			}
			i++;
		}
		pushToken(isResume ? "tpl_tail" : "tpl_full", start, len);
		canStartRegex = false;
	};

	while (i < len) {
		const ch = source.charCodeAt(i);

		if (ch === 10 || ch === 13) {
			pendingNewline = true;
			i++;
			continue;
		}
		if (isWhitespace(ch)) {
			i++;
			continue;
		}

		// Comments
		if (ch === 47 && i + 1 < len) {
			const next = source.charCodeAt(i + 1);
			if (next === 47) {
				i += 2;
				while (i < len && source.charCodeAt(i) !== 10 && source.charCodeAt(i) !== 13) {
					i++;
				}
				continue;
			}
			if (next === 42) {
				i += 2;
				while (i < len) {
					const c = source.charCodeAt(i);
					if (c === 10 || c === 13) {
						pendingNewline = true;
					}
					if (c === 42 && i + 1 < len && source.charCodeAt(i + 1) === 47) {
						i += 2;
						break;
					}
					i++;
				}
				continue;
			}
		}

		// Regex literal vs division
		if (ch === 47 && canStartRegex) {
			const start = i;
			i++;
			let inClass = false;
			while (i < len) {
				const c = source.charCodeAt(i);
				if (c === 92) {
					i += 2;
					continue;
				}
				if (c === 91) {
					inClass = true;
				} else if (c === 93 && inClass) {
					inClass = false;
				} else if (c === 47 && !inClass) {
					i++;
					break;
				} else if (c === 10 || c === 13) {
					break;
				}
				i++;
			}
			while (i < len && isIdentPart(source.charCodeAt(i))) {
				i++;
			}
			pushToken("regex", start, i);
			canStartRegex = false;
			continue;
		}

		// Strings '...' or "..."
		if (ch === 39 || ch === 34) {
			const quote = ch;
			const start = i;
			i++;
			while (i < len) {
				const c = source.charCodeAt(i);
				if (c === 92) {
					i += 2;
					continue;
				}
				if (c === quote) {
					i++;
					break;
				}
				if (c === 10 || c === 13) {
					break;
				}
				i++;
			}
			pushToken("str", start, i);
			canStartRegex = false;
			continue;
		}

		// Template literal
		if (ch === 96) {
			scanTemplateSegment(false);
			continue;
		}

		// Closing } possibly returning to template literal
		if (ch === 125 && templateBraceStack.length > 0) {
			const top = templateBraceStack[templateBraceStack.length - 1] ?? 0;
			if (top === 0) {
				templateBraceStack.pop();
				i++;
				scanTemplateSegment(true);
				continue;
			}
			templateBraceStack[templateBraceStack.length - 1] = top - 1;
		} else if (ch === 123 && templateBraceStack.length > 0) {
			const top = templateBraceStack[templateBraceStack.length - 1] ?? 0;
			templateBraceStack[templateBraceStack.length - 1] = top + 1;
		}

		// Numbers
		if (isDigit(ch) || (ch === 46 && i + 1 < len && isDigit(source.charCodeAt(i + 1)))) {
			const start = i;
			if (ch === 48 && i + 1 < len) {
				const n = source.charCodeAt(i + 1);
				if (n === 120 || n === 88 || n === 98 || n === 66 || n === 111 || n === 79) {
					i += 2;
					while (i < len && (isHexDigit(source.charCodeAt(i)) || source.charCodeAt(i) === 95)) {
						i++;
					}
					if (i < len && source.charCodeAt(i) === 110) i++;
					pushToken("num", start, i);
					canStartRegex = false;
					continue;
				}
			}
			while (i < len && (isDigit(source.charCodeAt(i)) || source.charCodeAt(i) === 95)) {
				i++;
			}
			if (i < len && source.charCodeAt(i) === 46) {
				i++;
				while (i < len && (isDigit(source.charCodeAt(i)) || source.charCodeAt(i) === 95)) {
					i++;
				}
			}
			if (i < len && (source.charCodeAt(i) === 101 || source.charCodeAt(i) === 69)) {
				i++;
				if (i < len && (source.charCodeAt(i) === 43 || source.charCodeAt(i) === 45)) {
					i++;
				}
				while (i < len && (isDigit(source.charCodeAt(i)) || source.charCodeAt(i) === 95)) {
					i++;
				}
			}
			if (i < len && source.charCodeAt(i) === 110) {
				i++;
			}
			pushToken("num", start, i);
			canStartRegex = false;
			continue;
		}

		// Private identifier #foo
		if (ch === 35 && i + 1 < len && isIdentStart(source.charCodeAt(i + 1))) {
			const start = i;
			i += 2;
			while (i < len && isIdentPart(source.charCodeAt(i))) {
				i++;
			}
			pushToken("priv_ident", start, i);
			canStartRegex = false;
			continue;
		}

		// Identifier / keyword
		if (isIdentStart(ch)) {
			const start = i;
			i++;
			while (i < len && isIdentPart(source.charCodeAt(i))) {
				i++;
			}
			const word = source.slice(start, i);
			const prev = prevSigToken();
			const afterDot = prev !== undefined && (prev.text === "." || prev.text === "?.");
			pushToken("ident", start, i);
			canStartRegex = !afterDot && REGEX_BEFORE_KEYWORDS.has(word);
			continue;
		}

		// Optional chaining ?. (only if not followed by decimal digit, e.g. a?.5:1)
		if (ch === 63 && i + 1 < len && source.charCodeAt(i + 1) === 46) {
			const afterDotCh = i + 2 < len ? source.charCodeAt(i + 2) : 0;
			if (!isDigit(afterDotCh)) {
				pushToken("op", i, i + 2);
				i += 2;
				canStartRegex = false;
				continue;
			}
		}

		// Multi-char operators
		let matchedOp: string | undefined;
		for (const op of MULTI_OPS) {
			if (source.startsWith(op, i)) {
				matchedOp = op;
				break;
			}
		}
		if (matchedOp !== undefined) {
			const opStart = i;
			i += matchedOp.length;
			pushToken("op", opStart, i);
			canStartRegex = matchedOp !== "++" && matchedOp !== "--";
			continue;
		}

		// Single-char punctuator
		const opStart = i;
		const cStr = source.slice(i, i + 1);
		i++;

		const prev = prevSigToken();
		const prevPrev = prevPrevSigToken();

		if (cStr === "(") {
			const afterDot = prevPrev !== undefined && (prevPrev.text === "." || prevPrev.text === "?.");
			const isControl = prev !== undefined && prev.kind === "ident" && !afterDot && CONTROL_PAREN_KEYWORDS.has(prev.text);
			parenControlStack.push(isControl);
			pushToken("op", opStart, i);
			canStartRegex = true;
			continue;
		}

		if (cStr === ")") {
			const isControl = parenControlStack.pop() ?? false;
			pushToken("op", opStart, i);
			canStartRegex = isControl;
			continue;
		}

		if (cStr === "{") {
			const isBlock =
				prev === undefined ||
				prev.text === ";" ||
				prev.text === "{" ||
				prev.text === "}" ||
				prev.text === ")" ||
				prev.text === "=>" ||
				(prev.kind === "ident" && (prev.text === "else" || prev.text === "try" || prev.text === "finally" || prev.text === "do"));
			braceBlockStack.push(isBlock);
			pushToken("op", opStart, i);
			canStartRegex = true;
			continue;
		}

		if (cStr === "}") {
			const isBlock = braceBlockStack.pop() ?? true;
			pushToken("op", opStart, i);
			canStartRegex = isBlock;
			continue;
		}

		pushToken("op", opStart, i);
		canStartRegex = cStr !== "]";
	}

	tokens.push({
		kind: "eof",
		text: "",
		start: len,
		end: len,
		newlineBefore: pendingNewline,
	});
	return { tokens, shebangEnd };
}

function erasePreservingNewlines(source: string, start: number, end: number): string {
	let newlines = "";
	for (let k = start; k < end; k++) {
		if (source.charCodeAt(k) === 10) {
			newlines += "\n";
		}
	}
	return newlines;
}

function applyEdits(source: string, edits: TextEdit[]): string {
	if (edits.length === 0) return source;
	const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
	let out = "";
	let cursor = 0;
	for (const edit of sorted) {
		if (edit.start < cursor) {
			continue;
		}
		out += source.slice(cursor, edit.start);
		out += edit.text;
		cursor = edit.end;
	}
	out += source.slice(cursor);
	return out;
}

/**
 * Strip TypeScript types and declarations while emitting valid ES2023+ JavaScript.
 * Keeps ESM import/export statements intact for standalone JS use or transformEsmToCjs.
 */
export function stripTypeScriptTypes(source: string, _filename?: string): string {
	const { tokens, shebangEnd } = tokenize(source);
	const edits: TextEdit[] = [];

	if (shebangEnd > 0) {
		edits.push({ start: 0, end: shebangEnd, text: "" });
	}

	const tok = (idx: number): Token => {
		if (idx < 0) return tokens[0]!;
		if (idx >= tokens.length) return tokens[tokens.length - 1]!;
		return tokens[idx]!;
	};

	const eraseRange = (start: number, end: number) => {
		if (end > start) {
			edits.push({ start, end, text: erasePreservingNewlines(source, start, end) });
		}
	};

	const replaceRange = (start: number, end: number, text: string) => {
		edits.push({ start, end, text });
	};

	/** Find matching closing token starting at an opening `(`, `[`, or `{`. */
	const findMatchingDelimiter = (openIdx: number): number => {
		const open = tok(openIdx).text;
		const close = open === "(" ? ")" : open === "[" ? "]" : "}";
		let depth = 1;
		let k = openIdx + 1;
		while (tok(k).kind !== "eof") {
			const t = tok(k).text;
			if (t === "(" || t === "[" || t === "{") {
				if (t === open) depth++;
				else if (open !== t) {
					// balance inner delimiters cleanly via generic stack-free recursive jump
					const subEnd = findMatchingDelimiter(k);
					k = subEnd + 1;
					continue;
				}
			} else if (t === close) {
				depth--;
				if (depth === 0) return k;
			}
			k++;
		}
		return tokens.length - 1;
	};

	/** Speculate `<...>` generic parameter or type argument list starting at `<`. */
	const findMatchingAngleBracket = (openIdx: number, allowAssignmentDefault: boolean): number => {
		if (tok(openIdx).text !== "<") return -1;
		let angleDepth = 1;
		let parenDepth = 0;
		let bracketDepth = 0;
		let braceDepth = 0;
		let k = openIdx + 1;
		while (tok(k).kind !== "eof") {
			const tk = tok(k);
			const t = tk.text;
			if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
				if (t === ";") return -1;
				if (!allowAssignmentDefault && (t === "=" || t === "&&" || t === "||" || t === "==" || t === "!=" || t === "===" || t === "!==" || t === "<=" || t === "+=" || t === "-=" || t === "++" || t === "--")) {
					return -1;
				}
				if (allowAssignmentDefault && (t === "&&" || t === "||" || t === "==" || t === "!=" || t === "===" || t === "!==" || t === "++" || t === "--")) {
					return -1;
				}
			}
			if (t === "(") parenDepth++;
			else if (t === ")") {
				if (parenDepth === 0) return -1;
				parenDepth--;
			} else if (t === "[") bracketDepth++;
			else if (t === "]") {
				if (bracketDepth === 0) return -1;
				bracketDepth--;
			} else if (t === "{") braceDepth++;
			else if (t === "}") {
				if (braceDepth === 0) return -1;
				braceDepth--;
			} else if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
				if (t === "<") {
					angleDepth++;
				} else if (t === ">") {
					angleDepth--;
					if (angleDepth === 0) return k;
				} else if (t === ">>") {
					angleDepth -= 2;
					if (angleDepth <= 0) return angleDepth === 0 ? k : -1;
				} else if (t === ">>>") {
					angleDepth -= 3;
					if (angleDepth <= 0) return angleDepth === 0 ? k : -1;
				}
			}
			k++;
		}
		return -1;
	};

	/**
	 * Scan from start of a TS type expression and return the token index immediately
	 * AFTER the type expression ends.
	 */
	const scanTypeEnd = (startIdx: number, opts?: { stopAtArrowBody?: boolean; stopAtEquals?: boolean; allowCommaStop?: boolean }): number => {
		let k = startIdx;
		let parenDepth = 0;
		let bracketDepth = 0;
		let braceDepth = 0;
		let angleDepth = 0;
		let condDepth = 0;
		let justConsumedTypeOp = true;
		let prevWasCloseParenParamLike = false;

		while (tok(k).kind !== "eof") {
			const tk = tok(k);
			const t = tk.text;
			const atZero = parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0;

			if (atZero && k > startIdx && tk.newlineBefore && !justConsumedTypeOp) {
				const canContinueAcrossLine =
					t === "|" ||
					t === "&" ||
					t === "extends" ||
					t === "." ||
					t === "<" ||
					(t === "?" && condDepth >= 0 && tok(k - 1).text !== "?");
				if (!canContinueAcrossLine) {
					return k;
				}
			}

			if (t === "(") {
				parenDepth++;
				justConsumedTypeOp = true;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}
			if (t === ")") {
				if (atZero) return k;
				if (parenDepth === 0) return k;
				parenDepth--;
				justConsumedTypeOp = false;
				prevWasCloseParenParamLike = parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0;
				k++;
				continue;
			}
			if (t === "[") {
				bracketDepth++;
				justConsumedTypeOp = true;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}
			if (t === "]") {
				if (atZero || bracketDepth === 0) return k;
				bracketDepth--;
				justConsumedTypeOp = false;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}
			if (t === "{") {
				if (atZero && !justConsumedTypeOp) {
					return k;
				}
				braceDepth++;
				justConsumedTypeOp = true;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}
			if (t === "}") {
				if (atZero || braceDepth === 0) return k;
				braceDepth--;
				justConsumedTypeOp = false;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}

			if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
				if (t === "<") {
					angleDepth++;
					justConsumedTypeOp = true;
					prevWasCloseParenParamLike = false;
					k++;
					continue;
				}
				if (t === ">") {
					if (angleDepth > 0) {
						angleDepth--;
						justConsumedTypeOp = false;
						prevWasCloseParenParamLike = false;
						k++;
						continue;
					}
					return k;
				}
				if (t === ">>" && angleDepth >= 2) {
					angleDepth -= 2;
					justConsumedTypeOp = false;
					prevWasCloseParenParamLike = false;
					k++;
					continue;
				}
				if (t === ">>>" && angleDepth >= 3) {
					angleDepth -= 3;
					justConsumedTypeOp = false;
					prevWasCloseParenParamLike = false;
					k++;
					continue;
				}
			}

			if (!atZero) {
				justConsumedTypeOp = false;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}

			// At depth 0 of type expression:
			if (t === "=>") {
				if (opts?.stopAtArrowBody) {
					return k;
				}
				if (prevWasCloseParenParamLike || justConsumedTypeOp) {
					justConsumedTypeOp = true;
					prevWasCloseParenParamLike = false;
					k++;
					continue;
				}
				return k;
			}

			if (t === "as" || t === "satisfies") {
				return k;
			}

			if (opts?.stopAtEquals && t === "=") {
				return k;
			}

			if (NON_TYPE_CONT_OPS.has(t)) {
				return k;
			}

			if (t === "?") {
				// Conditional type: T extends U ? X : Y
				condDepth++;
				justConsumedTypeOp = true;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}

			if (t === ":") {
				if (condDepth > 0) {
					condDepth--;
					justConsumedTypeOp = true;
					prevWasCloseParenParamLike = false;
					k++;
					continue;
				}
				return k;
			}

			if (t === "<") {
				angleDepth++;
				justConsumedTypeOp = true;
				prevWasCloseParenParamLike = false;
				k++;
				continue;
			}

			if (!justConsumedTypeOp && tk.kind !== "op" && t !== "extends" && t !== "is" && t !== "in") {
				// Two adjacent type atoms without a binary connector (`|`/`&`/`.`/`extends`) ends the type (e.g. ASI without newline)
				return k;
			}

			justConsumedTypeOp =
				INCOMPLETE_TYPE_END_TOKENS.has(t) || t === "is";
			prevWasCloseParenParamLike = false;
			k++;
		}

		return k;
	};

	const findStatementSemiOrAsiEnd = (startIdx: number): number => {
		let k = startIdx;
		let paren = 0;
		let bracket = 0;
		let brace = 0;
		while (tok(k).kind !== "eof") {
			const tk = tok(k);
			if (tk.text === "(") paren++;
			else if (tk.text === ")" && paren > 0) paren--;
			else if (tk.text === "[") bracket++;
			else if (tk.text === "]" && bracket > 0) bracket--;
			else if (tk.text === "{") brace++;
			else if (tk.text === "}" && brace > 0) brace--;
			else if (paren === 0 && bracket === 0 && brace === 0) {
				if (tk.text === ";") return k + 1;
				if (k > startIdx && tk.newlineBefore) return k;
			}
			k++;
		}
		return k;
	};

	/** Walk and strip parameter list `( ... )`, optionally returning constructor parameter properties. */
	const processParamList = (openIdx: number, collectParamProps: boolean): { closeIdx: number; paramProps: string[] } => {
		const closeIdx = findMatchingDelimiter(openIdx);
		const paramProps: string[] = [];
		let k = openIdx + 1;

		while (k < closeIdx) {
			// Rest parameter `...`
			if (tok(k).text === "...") {
				k++;
			}

			// Optional constructor/parameter modifiers (`public`, `private`, `protected`, `readonly`, `override`)
			let isParamProp = false;
			while (
				k < closeIdx &&
				tok(k).kind === "ident" &&
				PARAM_MODIFIERS.has(tok(k).text) &&
				tok(k + 1).text !== ":" &&
				tok(k + 1).text !== "," &&
				tok(k + 1).text !== ")" &&
				tok(k + 1).text !== "?" &&
				tok(k + 1).text !== "="
			) {
				isParamProp = true;
				eraseRange(tok(k).start, tok(k + 1).start);
				k++;
			}

			if (tok(k).text === "...") {
				k++;
			}

			// TypeScript pseudo-parameter `this: Type`
			if (tok(k).kind === "ident" && tok(k).text === "this" && tok(k + 1).text === ":") {
				const typeEnd = scanTypeEnd(k + 2);
				if (typeEnd < closeIdx && tok(typeEnd).text === ",") {
					eraseRange(tok(k).start, tok(typeEnd + 1).start);
					k = typeEnd + 1;
					continue;
				}
				eraseRange(tok(k).start, tok(typeEnd).start);
				k = typeEnd;
				continue;
			}

			// Parameter binding pattern (`ident`, `{...}`, `[...]`)
			let boundPropName: string | undefined;
			if (tok(k).text === "{" || tok(k).text === "[") {
				const patEnd = findMatchingDelimiter(k);
				processTokenRange(k + 1, patEnd, false);
				k = patEnd + 1;
			} else if (tok(k).kind === "ident") {
				boundPropName = tok(k).text;
				k++;
			}

			if (isParamProp && collectParamProps && boundPropName !== undefined) {
				paramProps.push(boundPropName);
			}

			// Optional `?` on parameter
			if (k < closeIdx && tok(k).text === "?") {
				eraseRange(tok(k).start, tok(k).end);
				k++;
			}

			// Parameter type annotation `: Type`
			if (k < closeIdx && tok(k).text === ":") {
				const colonStart = tok(k).start;
				const typeEnd = scanTypeEnd(k + 1, { allowCommaStop: true });
				const clampedEnd = Math.min(typeEnd, closeIdx);
				eraseRange(colonStart, tok(clampedEnd).start);
				k = clampedEnd;
			}

			// Default initializer `= expr`
			if (k < closeIdx && tok(k).text === "=") {
				k++;
				const initStart = k;
				let dParen = 0;
				let dBracket = 0;
				let dBrace = 0;
				while (k < closeIdx) {
					const t = tok(k).text;
					if (t === "(") dParen++;
					else if (t === ")") dParen--;
					else if (t === "[") dBracket++;
					else if (t === "]") dBracket--;
					else if (t === "{") dBrace++;
					else if (t === "}") dBrace--;
					else if (t === "," && dParen === 0 && dBracket === 0 && dBrace === 0) break;
					k++;
				}
				processTokenRange(initStart, k, false);
			}

			if (k < closeIdx && tok(k).text === ",") {
				k++;
			} else if (k < closeIdx) {
				k++;
			}
		}

		return { closeIdx, paramProps };
	};

	const processNamedImportOrExportBraces = (openIdx: number): { closeIdx: number; allTypeOnly: boolean } => {
		const closeIdx = findMatchingDelimiter(openIdx);
		let itemCount = 0;
		let keptCount = 0;
		let k = openIdx + 1;
		const keptItems: string[] = [];

		while (k < closeIdx) {
			if (tok(k).text === ",") {
				k++;
				continue;
			}
			const itemStart = k;
			let itemEnd = k;
			while (itemEnd < closeIdx && tok(itemEnd).text !== ",") {
				itemEnd++;
			}
			itemCount++;
			const first = tok(itemStart);
			const isTypeSpecifier =
				first.kind === "ident" &&
				first.text === "type" &&
				itemStart + 1 < itemEnd &&
				tok(itemStart + 1).text !== "as";
			if (!isTypeSpecifier) {
				keptCount++;
				keptItems.push(source.slice(tok(itemStart).start, tok(itemEnd - 1).end));
			}
			k = itemEnd + 1;
		}

		if (itemCount > 0 && keptCount === 0) {
			return { closeIdx, allTypeOnly: true };
		}
		if (keptCount < itemCount) {
			replaceRange(tok(openIdx).start, tok(closeIdx).end, `{ ${keptItems.join(", ")} }`);
		}
		return { closeIdx, allTypeOnly: false };
	};

	/** Strip `import` or `export` type-only forms; returns new cursor index if handled, else -1. */
	const tryHandleImportStatement = (stmtStartIdx: number): number => {
		if (tok(stmtStartIdx).text !== "import") return -1;
		const next = tok(stmtStartIdx + 1);
		// Ignore `import.meta` and `import("...")`
		if (next.text === "." || next.text === "(") return -1;

		// `import type ...` or `import type x = ...`
		if (next.kind === "ident" && next.text === "type") {
			// Check it isn't `import type from "mod"` (default import literally named `type`)
			const afterType = tok(stmtStartIdx + 2);
			if (afterType.kind !== "ident" || afterType.text !== "from") {
				const endIdx = findStatementSemiOrAsiEnd(stmtStartIdx);
				eraseRange(tok(stmtStartIdx).start, tok(endIdx).start);
				return endIdx;
			}
		}

		// `import Def = require("...")`
		if (next.kind === "ident" && tok(stmtStartIdx + 2).text === "=") {
			const endIdx = findStatementSemiOrAsiEnd(stmtStartIdx);
			replaceRange(tok(stmtStartIdx).start, next.end, `const ${next.text}`);
			return endIdx;
		}

		// Scan import clause for `{ type A, B }`
		let k = stmtStartIdx + 1;
		let defaultEnd = -1;
		if (tok(k).kind === "ident") {
			defaultEnd = tok(k).end;
			k++;
			if (tok(k).text === ",") {
				k++;
			}
		}

		if (tok(k).text === "{") {
			const { closeIdx, allTypeOnly } = processNamedImportOrExportBraces(k);
			if (allTypeOnly) {
				if (defaultEnd !== -1) {
					// Keep `import Def` and drop `, { type A }`
					eraseRange(defaultEnd, tok(closeIdx).end);
				} else {
					// Whole import was `{ type ... }`
					let endIdx = closeIdx + 1;
					if (tok(endIdx).kind === "ident" && tok(endIdx).text === "from") {
						endIdx += 2; // skip string literal
					}
					if (tok(endIdx).text === ";") endIdx++;
					eraseRange(tok(stmtStartIdx).start, tok(endIdx).start);
					return endIdx;
				}
			}
			k = closeIdx + 1;
		}

		while (tok(k).kind !== "eof") {
			if (tok(k).text === ";") return k + 1;
			if (k > stmtStartIdx + 1 && tok(k).kind === "str") {
				return tok(k + 1).text === ";" ? k + 2 : k + 1;
			}
			k++;
		}
		return k;
	};

	const tryHandleExportStatement = (stmtStartIdx: number): number => {
		if (tok(stmtStartIdx).text !== "export") return -1;
		const next = tok(stmtStartIdx + 1);

		// `export type ...`
		if (next.kind === "ident" && next.text === "type") {
			const endIdx = tok(stmtStartIdx + 2).text === "{" ? findStatementSemiOrAsiEnd(stmtStartIdx) : findTypeDeclEnd(stmtStartIdx + 2);
			eraseRange(tok(stmtStartIdx).start, tok(endIdx).start);
			return endIdx;
		}

		// `export interface ...`
		if (next.kind === "ident" && next.text === "interface" && tok(stmtStartIdx + 2).kind === "ident") {
			let k = stmtStartIdx + 3;
			while (tok(k).kind !== "eof" && tok(k).text !== "{") k++;
			const closeIdx = tok(k).text === "{" ? findMatchingDelimiter(k) + 1 : k;
			eraseRange(tok(stmtStartIdx).start, tok(closeIdx).start);
			return closeIdx;
		}

		// `export declare ...`
		if (next.kind === "ident" && next.text === "declare") {
			const endIdx = skipDeclareStatement(stmtStartIdx + 1);
			eraseRange(tok(stmtStartIdx).start, tok(endIdx).start);
			return endIdx;
		}

		// `export abstract class ...`
		if (next.kind === "ident" && next.text === "abstract" && tok(stmtStartIdx + 2).text === "class") {
			eraseRange(next.start, tok(stmtStartIdx + 2).start);
			return stmtStartIdx + 2;
		}

		// `export { type A, B } [from "..."]`
		if (next.text === "{") {
			const { closeIdx, allTypeOnly } = processNamedImportOrExportBraces(stmtStartIdx + 1);
			let k = closeIdx + 1;
			if (tok(k).kind === "ident" && tok(k).text === "from") {
				k += 2;
			}
			if (tok(k).text === ";") k++;
			if (allTypeOnly) {
				eraseRange(tok(stmtStartIdx).start, tok(k).start);
			}
			return k;
		}

		// `export = expr;`
		if (next.text === "=") {
			replaceRange(tok(stmtStartIdx).start, next.end, "module.exports =");
			return stmtStartIdx + 2;
		}

		// Check function overload `export [async] function[*]? name<...>(...): Ret;`
		let fnIdx = stmtStartIdx + 1;
		if (tok(fnIdx).kind === "ident" && tok(fnIdx).text === "default") fnIdx++;
		if (tok(fnIdx).kind === "ident" && tok(fnIdx).text === "async") fnIdx++;
		if (tok(fnIdx).kind === "ident" && tok(fnIdx).text === "function") {
			const handledEnd = processFunctionDeclOrExpr(stmtStartIdx, fnIdx, true);
			return handledEnd;
		}

		return stmtStartIdx + 1;
	};

	const findTypeDeclEnd = (afterNameIdx: number): number => {
		let k = afterNameIdx;
		if (tok(k).kind === "ident") k++;
		if (tok(k).text === "<") {
			const closeA = findMatchingAngleBracket(k, true);
			if (closeA !== -1) k = closeA + 1;
		}
		if (tok(k).text === "=") {
			const endIdx = scanTypeEnd(k + 1);
			if (tok(endIdx).text === ";") return endIdx + 1;
			return endIdx;
		}
		return findStatementSemiOrAsiEnd(afterNameIdx);
	};

	const skipDeclareStatement = (declareIdx: number): number => {
		const target = tok(declareIdx + 1);
		if (target.text === "interface" || target.text === "class" || target.text === "namespace" || target.text === "module" || target.text === "global" || target.text === "enum") {
			let k = declareIdx + 2;
			while (tok(k).kind !== "eof" && tok(k).text !== "{" && tok(k).text !== ";") k++;
			if (tok(k).text === "{") return findMatchingDelimiter(k) + 1;
			return tok(k).text === ";" ? k + 1 : k;
		}
		if (target.text === "abstract" && tok(declareIdx + 2).text === "class") {
			let k = declareIdx + 3;
			while (tok(k).kind !== "eof" && tok(k).text !== "{") k++;
			if (tok(k).text === "{") return findMatchingDelimiter(k) + 1;
			return k;
		}
		if (target.text === "function" || (target.text === "async" && tok(declareIdx + 2).text === "function")) {
			let k = declareIdx + 2;
			while (tok(k).kind !== "eof" && tok(k).text !== "(") k++;
			if (tok(k).text === "(") {
				k = findMatchingDelimiter(k) + 1;
				if (tok(k).text === ":") {
					k = scanTypeEnd(k + 1);
				}
				if (tok(k).text === ";") k++;
				return k;
			}
		}
		return findStatementSemiOrAsiEnd(declareIdx);
	};

	/** Handle `function` declaration/overload/expression. Returns token index after header (or after erased overload). */
	const processFunctionDeclOrExpr = (stmtOrFnStart: number, fnKeywordIdx: number, isStatement: boolean): number => {
		let k = fnKeywordIdx + 1;
		if (tok(k).text === "*") k++;
		if (tok(k).kind === "ident") k++;
		if (tok(k).text === "<") {
			const angleClose = findMatchingAngleBracket(k, true);
			if (angleClose !== -1) {
				eraseRange(tok(k).start, tok(angleClose).end);
				k = angleClose + 1;
			}
		}
		if (tok(k).text !== "(") {
			return k;
		}
		const { closeIdx } = processParamList(k, false);
		k = closeIdx + 1;
		if (tok(k).text === ":") {
			const colonStart = tok(k).start;
			const retEnd = scanTypeEnd(k + 1);
			eraseRange(colonStart, tok(retEnd).start);
			k = retEnd;
		}
		// Overload signature if statement with no `{` body
		if (isStatement && tok(k).text !== "{") {
			const overloadEnd = tok(k).text === ";" ? k + 1 : k;
			eraseRange(tok(stmtOrFnStart).start, tok(overloadEnd).start);
			return overloadEnd;
		}
		if (tok(k).text === "{") {
			const bodyClose = findMatchingDelimiter(k);
			processTokenRange(k + 1, bodyClose, true);
			return bodyClose + 1;
		}
		return k;
	};

	/** Handle `class` declaration or expression including generics, extends<T>, implements, and class body. */
	const processClass = (classIdx: number): number => {
		let k = classIdx + 1;
		if (tok(k).kind === "ident" && tok(k).text !== "extends" && tok(k).text !== "implements") {
			k++;
		}
		if (tok(k).text === "<") {
			const angleClose = findMatchingAngleBracket(k, true);
			if (angleClose !== -1) {
				eraseRange(tok(k).start, tok(angleClose).end);
				k = angleClose + 1;
			}
		}
		if (tok(k).kind === "ident" && tok(k).text === "extends") {
			k++;
			// Scan base expression up to `implements` or `{`, stripping `<TypeArgs>` directly before `implements` / `{`
			const exprStart = k;
			let braceDepth = 0;
			let parenDepth = 0;
			let bracketDepth = 0;
			while (tok(k).kind !== "eof") {
				const t = tok(k).text;
				if (t === "(") parenDepth++;
				else if (t === ")") parenDepth--;
				else if (t === "[") bracketDepth++;
				else if (t === "]") bracketDepth--;
				else if (t === "{" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
					break;
				} else if (t === "{" ) {
					braceDepth++;
				} else if (t === "}") {
					braceDepth--;
				} else if (t === "implements" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
					break;
				}
				k++;
			}
			// Strip trailing `<T>` on base class if present (e.g. `extends Base<string>`)
			if (k > exprStart && tok(k - 1).text === ">") {
				for (let scan = exprStart; scan < k; scan++) {
					if (tok(scan).text === "<") {
						const c = findMatchingAngleBracket(scan, false);
						if (c === k - 1) {
							eraseRange(tok(scan).start, tok(c).end);
							processTokenRange(exprStart, scan, false);
							break;
						}
					}
				}
			} else {
				processTokenRange(exprStart, k, false);
			}
		}
		if (tok(k).kind === "ident" && tok(k).text === "implements") {
			const implStart = tok(k).start;
			while (tok(k).kind !== "eof" && tok(k).text !== "{") {
				k++;
			}
			eraseRange(implStart, tok(k).start);
		}
		if (tok(k).text !== "{") {
			return k;
		}
		const bodyClose = findMatchingDelimiter(k);
		processClassBody(k, bodyClose);
		return bodyClose + 1;
	};

	const processClassBody = (openIdx: number, closeIdx: number) => {
		let k = openIdx + 1;
		while (k < closeIdx) {
			if (tok(k).text === ";") {
				k++;
				continue;
			}
			// Decorator @...
			if (tok(k).text === "@") {
				k++;
				if (tok(k).kind === "ident") k++;
				if (tok(k).text === "(") k = findMatchingDelimiter(k) + 1;
				continue;
			}
			// static { ... }
			if (tok(k).kind === "ident" && tok(k).text === "static" && tok(k + 1).text === "{") {
				const blockClose = findMatchingDelimiter(k + 1);
				processTokenRange(k + 2, blockClose, true);
				k = blockClose + 1;
				continue;
			}

			const memberStart = k;
			let isDeclare = false;
			let isAbstract = false;

			// Accessibility/property modifiers
			while (
				k < closeIdx &&
				tok(k).kind === "ident" &&
				CLASS_MEMBER_MODIFIERS.has(tok(k).text) &&
				tok(k + 1).text !== "(" &&
				tok(k + 1).text !== "=" &&
				tok(k + 1).text !== ":" &&
				tok(k + 1).text !== ";" &&
				tok(k + 1).text !== "?" &&
				tok(k + 1).text !== "!"
			) {
				if (tok(k).text === "declare") isDeclare = true;
				if (tok(k).text === "abstract") isAbstract = true;
				eraseRange(tok(k).start, tok(k + 1).start);
				k++;
			}

			while (
				k < closeIdx &&
				tok(k).kind === "ident" &&
				(tok(k).text === "static" || tok(k).text === "async" || tok(k).text === "get" || tok(k).text === "set" || tok(k).text === "accessor") &&
				tok(k + 1).text !== "(" &&
				tok(k + 1).text !== "=" &&
				tok(k + 1).text !== ":" &&
				tok(k + 1).text !== ";" &&
				tok(k + 1).text !== "?" &&
				tok(k + 1).text !== "!"
			) {
				k++;
			}
			if (tok(k).text === "*") k++;

			// Index signature `[key: string]: any;`
			if (tok(k).text === "[") {
				const brClose = findMatchingDelimiter(k);
				if (tok(brClose + 1).text === ":") {
					let endIdx = scanTypeEnd(brClose + 2);
					if (tok(endIdx).text === ";") endIdx++;
					eraseRange(tok(memberStart).start, tok(endIdx).start);
					k = endIdx;
					continue;
				}
				processTokenRange(k + 1, brClose, false);
				k = brClose + 1;
			} else if (k < closeIdx) {
				k++;
			}

			// Property vs Method
			let isConstructor = tok(k - 1).kind === "ident" && tok(k - 1).text === "constructor";
			if (tok(k).text === "?" || tok(k).text === "!") {
				eraseRange(tok(k).start, tok(k).end);
				k++;
			}

			let hasMethodParens = false;
			let isAbstractOrOverloadSignature = false;
			if (tok(k).text === "<") {
				const angleClose = findMatchingAngleBracket(k, true);
				if (angleClose !== -1) {
					eraseRange(tok(k).start, tok(angleClose).end);
					k = angleClose + 1;
				}
			}

			if (tok(k).text === "(") {
				hasMethodParens = true;
				const { closeIdx: paramClose, paramProps } = processParamList(k, isConstructor);
				k = paramClose + 1;
				if (tok(k).text === ":") {
					const colonStart = tok(k).start;
					const retEnd = scanTypeEnd(k + 1);
					eraseRange(colonStart, tok(retEnd).start);
					k = retEnd;
				}
				if (tok(k).text === "{") {
					const methodClose = findMatchingDelimiter(k);
					if (isConstructor && paramProps.length > 0) {
						injectConstructorParamProps(k, methodClose, paramProps);
					}
					processTokenRange(k + 1, methodClose, true);
					k = methodClose + 1;
					continue;
				}
				isAbstractOrOverloadSignature = true;
			} else {
				// Class field `: Type`
				if (tok(k).text === ":") {
					const colonStart = tok(k).start;
					const typeEnd = scanTypeEnd(k + 1, { stopAtEquals: true });
					const clampedEnd = Math.min(typeEnd, closeIdx);
					eraseRange(colonStart, tok(clampedEnd).start);
					k = clampedEnd;
				}
				if (tok(k).text === "=") {
					k++;
					const initStart = k;
					let dp = 0;
					let db = 0;
					let dc = 0;
					while (k < closeIdx) {
						const tk = tok(k);
						const t = tk.text;
						if (t === "(") dp++;
						else if (t === ")") dp--;
						else if (t === "[") db++;
						else if (t === "]") db--;
						else if (t === "{") dc++;
						else if (t === "}") dc--;
						else if (dp === 0 && db === 0 && dc === 0) {
							if (t === ";") {
								k++;
								break;
							}
							if (k > initStart && tk.newlineBefore) {
								break;
							}
						}
						k++;
					}
					processTokenRange(initStart, k, false);
				} else if (tok(k).text === ";") {
					k++;
				}
			}

			if (isDeclare || (hasMethodParens && isAbstractOrOverloadSignature) || isAbstract) {
				if (tok(k).text === ";") k++;
				eraseRange(tok(memberStart).start, tok(k).start);
			}
		}
	};

	const injectConstructorParamProps = (openBraceIdx: number, closeBraceIdx: number, props: string[]) => {
		const assignments = props.map((p) => `this.${p} = ${p};`).join(" ");
		// Look if first statement is `super(...)`
		let scan = openBraceIdx + 1;
		if (scan < closeBraceIdx && tok(scan).kind === "ident" && tok(scan).text === "super" && tok(scan + 1).text === "(") {
			const callClose = findMatchingDelimiter(scan + 1);
			const afterSuper = tok(callClose + 1).text === ";" ? callClose + 1 : callClose;
			const insertPos = tok(afterSuper).end;
			edits.push({ start: insertPos, end: insertPos, text: ` ${assignments}` });
			return;
		}
		const insertPos = tok(openBraceIdx).end;
		edits.push({ start: insertPos, end: insertPos, text: ` ${assignments}` });
	};

	/** Track whether token index `idx` can be a regex start (expr-start) in stripped flow. */
	const processTokenRange = (rangeStart: number, rangeEnd: number, startAtStmt: boolean) => {
		let k = rangeStart;
		let atStmtStart = startAtStmt;
		let exprJustEnded = false;
		let ternaryDepth = 0;
		const bracketStack: Array<{ ch: string; ternaryDepth: number; isObjectLiteral: boolean }> = [];

		while (k < rangeEnd) {
			const tk = tok(k);
			const t = tk.text;

			if (tk.newlineBefore && atStmtStart === false && bracketStack.length === 0) {
				// handled contextually below
			}

			// Statement-start TS declarations
			if (atStmtStart || (tk.newlineBefore && !exprJustEnded)) {
				if (t === "import") {
					const nextIdx = tryHandleImportStatement(k);
					if (nextIdx !== -1) {
						k = nextIdx;
						atStmtStart = true;
						exprJustEnded = false;
						continue;
					}
				}
				if (t === "export") {
					const nextIdx = tryHandleExportStatement(k);
					if (nextIdx !== -1) {
						k = nextIdx;
						atStmtStart = true;
						exprJustEnded = false;
						continue;
					}
				}
				if (t === "declare" && tk.kind === "ident" && tok(k + 1).kind === "ident" && tok(k + 1).text !== "from") {
					const nextWord = tok(k + 1).text;
					if (
						nextWord === "const" ||
						nextWord === "let" ||
						nextWord === "var" ||
						nextWord === "function" ||
						nextWord === "async" ||
						nextWord === "class" ||
						nextWord === "abstract" ||
						nextWord === "interface" ||
						nextWord === "type" ||
						nextWord === "enum" ||
						nextWord === "namespace" ||
						nextWord === "module" ||
						nextWord === "global"
					) {
						const endIdx = skipDeclareStatement(k);
						eraseRange(tk.start, tok(endIdx).start);
						k = endIdx;
						atStmtStart = true;
						exprJustEnded = false;
						continue;
					}
				}
				if (t === "interface" && tk.kind === "ident" && tok(k + 1).kind === "ident") {
					let scan = k + 2;
					while (scan < rangeEnd && tok(scan).text !== "{") scan++;
					const closeIdx = tok(scan).text === "{" ? findMatchingDelimiter(scan) + 1 : scan;
					eraseRange(tk.start, tok(closeIdx).start);
					k = closeIdx;
					atStmtStart = true;
					exprJustEnded = false;
					continue;
				}
				if (
					t === "type" &&
					tk.kind === "ident" &&
					tok(k + 1).kind === "ident" &&
					(tok(k + 2).text === "=" || tok(k + 2).text === "<")
				) {
					const endIdx = findTypeDeclEnd(k + 1);
					eraseRange(tk.start, tok(endIdx).start);
					k = endIdx;
					atStmtStart = true;
					exprJustEnded = false;
					continue;
				}
				if (t === "abstract" && tk.kind === "ident" && tok(k + 1).text === "class") {
					eraseRange(tk.start, tok(k + 1).start);
					k = k + 1;
					continue;
				}
			}

			// Enum fallback (transforms simple TS `enum Foo { A, B = "b" }` if used by an external extension)
			if (
				(atStmtStart || tok(k - 1).text === "export") &&
				t === "enum" &&
				tk.kind === "ident" &&
				tok(k + 1).kind === "ident" &&
				tok(k + 2).text === "{"
			) {
				const enumName = tok(k + 1).text;
				const closeIdx = findMatchingDelimiter(k + 2);
				const objProps: string[] = [];
				let autoVal = 0;
				let m = k + 3;
				while (m < closeIdx) {
					if (tok(m).text === ",") {
						m++;
						continue;
					}
					const memberName = tok(m).text;
					let valExpr = String(autoVal);
					m++;
					if (tok(m).text === "=") {
						const vStart = m + 1;
						let vEnd = vStart;
						while (vEnd < closeIdx && tok(vEnd).text !== ",") vEnd++;
						valExpr = source.slice(tok(vStart).start, tok(vEnd - 1).end);
						const numeric = Number(valExpr);
						if (Number.isInteger(numeric)) autoVal = numeric + 1;
						m = vEnd;
					} else {
						autoVal++;
					}
					objProps.push(`${JSON.stringify(memberName)}: ${valExpr}`);
				}
				replaceRange(tk.start, tok(closeIdx).end, `const ${enumName} = { ${objProps.join(", ")} }`);
				k = closeIdx + 1;
				atStmtStart = true;
				exprJustEnded = false;
				continue;
			}

			// Variable declarations (`const`, `let`, `var`)
			if ((t === "const" || t === "let" || t === "var") && tk.kind === "ident" && tok(k - 1).text !== "." && tok(k - 1).text !== "as") {
				k++;
				while (k < rangeEnd) {
					// Binding identifier or `{}` / `[]`
					if (tok(k).text === "{" || tok(k).text === "[") {
						const patClose = findMatchingDelimiter(k);
						processTokenRange(k + 1, patClose, false);
						k = patClose + 1;
					} else if (tok(k).kind === "ident") {
						k++;
					} else {
						break;
					}
					// Definite assignment `x!: Type`
					if (k < rangeEnd && tok(k).text === "!") {
						eraseRange(tok(k).start, tok(k).end);
						k++;
					}
					// Variable type annotation `: Type`
					if (k < rangeEnd && tok(k).text === ":") {
						const colonStart = tok(k).start;
						const typeEnd = scanTypeEnd(k + 1, { stopAtEquals: true });
						const clamped = Math.min(typeEnd, rangeEnd);
						eraseRange(colonStart, tok(clamped).start);
						k = clamped;
					}
					// Initializer `= expr`
					if (k < rangeEnd && tok(k).text === "=") {
						k++;
						const initStart = k;
						let dp = 0;
						let db = 0;
						let dc = 0;
						while (k < rangeEnd) {
							const tkInit = tok(k);
							const tt = tkInit.text;
							if (tt === "(") dp++;
							else if (tt === ")") {
								if (dp === 0) break;
								dp--;
							} else if (tt === "[") db++;
							else if (tt === "]") {
								if (db === 0) break;
								db--;
							} else if (tt === "{") dc++;
							else if (tt === "}") {
								if (dc === 0) break;
								dc--;
							} else if (dp === 0 && db === 0 && dc === 0) {
								if (tt === "," || tt === ";") break;
								if (k > initStart && tkInit.newlineBefore) {
									const prevInit = tok(k - 1);
									const prevStopsInit =
										prevInit.kind === "ident" ||
										prevInit.kind === "num" ||
										prevInit.kind === "str" ||
										prevInit.kind === "tpl_full" ||
										prevInit.kind === "tpl_tail" ||
										prevInit.kind === "regex" ||
										prevInit.text === ")" ||
										prevInit.text === "]" ||
										prevInit.text === "}";
									const curStartsStmt =
										tt !== "." &&
										tt !== "?." &&
										tt !== "(" &&
										tt !== "[" &&
										tt !== "+" &&
										tt !== "-" &&
										tt !== "*" &&
										tt !== "/" &&
										tt !== "&&" &&
										tt !== "||" &&
										tt !== "??" &&
										tt !== "?" &&
										tt !== ":" &&
										tt !== "as" &&
										tt !== "satisfies";
									if (prevStopsInit && curStartsStmt && !REGEX_BEFORE_KEYWORDS.has(prevInit.text)) {
										break;
									}
								}
							}
							k++;
						}
						processTokenRange(initStart, k, false);
					}
					if (k < rangeEnd && tok(k).text === ",") {
						k++;
						continue;
					}
					break;
				}
				atStmtStart = false;
				exprJustEnded = false;
				continue;
			}

			// Function declarations / expressions
			if (t === "function" && tk.kind === "ident" && tok(k - 1).text !== "." && tok(k - 1).text !== "?.") {
				const isStmt = atStmtStart || (tok(k - 1).text === "async" && (k - 1 === rangeStart || tok(k - 2).text === ";" || tok(k - 2).text === "{" || tok(k - 2).text === "}"));
				const stmtStart = tok(k - 1).text === "async" ? k - 1 : k;
				k = processFunctionDeclOrExpr(stmtStart, k, isStmt);
				atStmtStart = isStmt;
				exprJustEnded = !isStmt;
				continue;
			}

			// Class declarations / expressions
			if (t === "class" && tk.kind === "ident" && tok(k - 1).text !== "." && tok(k - 1).text !== "?.") {
				k = processClass(k);
				atStmtStart = true;
				exprJustEnded = false;
				continue;
			}

			// `catch (err: any)` or `catch ({ a: b }: unknown)`
			if (t === "catch" && tk.kind === "ident" && tok(k + 1).text === "(") {
				const closeP = findMatchingDelimiter(k + 1);
				let depth = 0;
				for (let scan = k + 2; scan < closeP; scan++) {
					const st = tok(scan).text;
					if (st === "(" || st === "[" || st === "{") {
						depth++;
					} else if (st === ")" || st === "]" || st === "}") {
						depth--;
					} else if (depth === 0 && st === ":") {
						eraseRange(tok(scan).start, tok(closeP).start);
						break;
					}
				}
				k = closeP + 1;
				atStmtStart = false;
				continue;
			}

			// Generic arrow `<T>(...) => ...` OR `<Type>expr` cast at expression-start position
			if (t === "<" && !exprJustEnded) {
				const angleClose = findMatchingAngleBracket(k, true);
				if (angleClose !== -1) {
					const afterAngle = angleClose + 1;
					// Check `<T>(...) =>` or `<T>(...): Ret =>`
					if (tok(afterAngle).text === "(") {
						const paramClose = findMatchingDelimiter(afterAngle);
						const afterParen = paramClose + 1;
						let isArrow = tok(afterParen).text === "=>";
						if (!isArrow && tok(afterParen).text === ":") {
							const retEnd = scanTypeEnd(afterParen + 1, { stopAtArrowBody: true });
							if (tok(retEnd).text === "=>") {
								isArrow = true;
							}
						}
						if (isArrow) {
							eraseRange(tk.start, tok(angleClose).end);
							const { closeIdx } = processParamList(afterAngle, false);
							let arrowIdx = closeIdx + 1;
							if (tok(arrowIdx).text === ":") {
								const colonStart = tok(arrowIdx).start;
								const retEnd = scanTypeEnd(arrowIdx + 1, { stopAtArrowBody: true });
								eraseRange(colonStart, tok(retEnd).start);
								arrowIdx = retEnd;
							}
							k = arrowIdx + 1; // past `=>`
							atStmtStart = false;
							exprJustEnded = false;
							continue;
						}
					}

					// Legacy `<Type>expr` cast in expression position
					const castClose = findMatchingAngleBracket(k, false);
					if (castClose !== -1) {
						const afterCast = tok(castClose + 1);
						if (
							afterCast.kind === "ident" ||
							afterCast.kind === "num" ||
							afterCast.kind === "str" ||
							afterCast.kind === "tpl_full" ||
							afterCast.kind === "tpl_head" ||
							afterCast.text === "(" ||
							afterCast.text === "[" ||
							afterCast.text === "{" ||
							afterCast.text === "!" ||
							afterCast.text === "-" ||
							afterCast.text === "~"
						) {
							eraseRange(tk.start, tok(castClose).end);
							k = castClose + 1;
							continue;
						}
					}
				}
			}

			// Arrow function `(params): Ret =>`
			if (t === "(") {
				const closeParen = findMatchingDelimiter(k);
				const afterParen = closeParen + 1;
				let isArrow = tok(afterParen).text === "=>";
				let retColonIdx = -1;
				let retEndIdx = -1;
				if (!isArrow && tok(afterParen).text === ":") {
					const retEnd = scanTypeEnd(afterParen + 1, { stopAtArrowBody: true });
					if (tok(retEnd).text === "=>") {
						// Guard against `cond ? (a) : (b) => c`: if ternaryDepth > 0, check if (a) actually has TS param markers or no ternary-closing branch later
						if (ternaryDepth === 0) {
							isArrow = true;
							retColonIdx = afterParen;
							retEndIdx = retEnd;
						} else {
							let hasParamSyntax = false;
							for (let s = k + 1; s < closeParen; s++) {
								if (tok(s).text === ":" || tok(s).text === "?" || tok(s).text === "...") {
									hasParamSyntax = true;
									break;
								}
							}
							if (hasParamSyntax) {
								isArrow = true;
								retColonIdx = afterParen;
								retEndIdx = retEnd;
							}
						}
					}
				}
				if (isArrow) {
					processParamList(k, false);
					if (retColonIdx !== -1 && retEndIdx !== -1) {
						eraseRange(tok(retColonIdx).start, tok(retEndIdx).start);
						k = retEndIdx + 1;
					} else {
						k = afterParen + 1;
					}
					atStmtStart = false;
					exprJustEnded = false;
					continue;
				}
				// Normal paren expression / call args
				bracketStack.push({ ch: "(", ternaryDepth, isObjectLiteral: false });
				ternaryDepth = 0;
				k++;
				atStmtStart = false;
				exprJustEnded = false;
				continue;
			}

			if (t === ")") {
				const popped = bracketStack.pop();
				if (popped !== undefined) ternaryDepth = popped.ternaryDepth;
				const prevK = k > 0 ? tok(k - 1) : undefined;
				const wasControl = false;
				void prevK;
				void wasControl;
				k++;
				atStmtStart = false;
				exprJustEnded = true;
				continue;
			}

			if (t === "[") {
				bracketStack.push({ ch: "[", ternaryDepth, isObjectLiteral: false });
				ternaryDepth = 0;
				k++;
				atStmtStart = false;
				exprJustEnded = false;
				continue;
			}

			if (t === "]") {
				const popped = bracketStack.pop();
				if (popped !== undefined) ternaryDepth = popped.ternaryDepth;
				k++;
				atStmtStart = false;
				exprJustEnded = true;
				continue;
			}

			if (t === "{") {
				const prev = k > 0 ? tok(k - 1) : undefined;
				const isExportDefaultObj = prev !== undefined && prev.text === "default" && k > 1 && tok(k - 2).text === "export";
				const isObjLit =
					isExportDefaultObj ||
					(prev !== undefined &&
						!atStmtStart &&
						prev.text !== ")" &&
						prev.text !== "=>" &&
						prev.text !== "else" &&
						prev.text !== "try" &&
						prev.text !== "finally" &&
						prev.text !== "do");
				bracketStack.push({ ch: "{", ternaryDepth, isObjectLiteral: isObjLit });
				ternaryDepth = 0;
				k++;
				atStmtStart = !isObjLit;
				exprJustEnded = false;
				continue;
			}

			if (t === "}") {
				const popped = bracketStack.pop();
				if (popped !== undefined) {
					ternaryDepth = popped.ternaryDepth;
					atStmtStart = !popped.isObjectLiteral;
					exprJustEnded = popped.isObjectLiteral;
				} else {
					atStmtStart = true;
					exprJustEnded = false;
				}
				k++;
				continue;
			}

			// Object literal method shorthand: `{ run<T>(x: T): T { ... } }`
			if (
				bracketStack.length > 0 &&
				bracketStack[bracketStack.length - 1]!.isObjectLiteral &&
				(tk.kind === "ident" || tk.kind === "str" || tk.kind === "num") &&
				(tok(k - 1).text === "{" || tok(k - 1).text === "," || (tok(k - 1).text === "async" || tok(k - 1).text === "get" || tok(k - 1).text === "set" || tok(k - 1).text === "*"))
			) {
				let scan = k + 1;
				let methodAngleClose = -1;
				if (tok(scan).text === "<") {
					methodAngleClose = findMatchingAngleBracket(scan, true);
					if (methodAngleClose !== -1) scan = methodAngleClose + 1;
				}
				if (tok(scan).text === "(") {
					const paramClose = findMatchingDelimiter(scan);
					if (tok(paramClose + 1).text === "{" || (tok(paramClose + 1).text === ":")) {
						const afterColon = tok(paramClose + 1).text === ":" ? scanTypeEnd(paramClose + 2) : paramClose + 1;
						if (tok(afterColon).text === "{") {
							if (methodAngleClose !== -1) {
								eraseRange(tok(k + 1).start, tok(methodAngleClose).end);
							}
							processParamList(scan, false);
							if (tok(paramClose + 1).text === ":") {
								eraseRange(tok(paramClose + 1).start, tok(afterColon).start);
							}
							const methodClose = findMatchingDelimiter(afterColon);
							processTokenRange(afterColon + 1, methodClose, true);
							k = methodClose + 1;
							continue;
						}
					}
				}
			}

			// Call / `new` / tagged template type arguments: `fn<string>(x)`, `new Map<K, V>()`
			if (t === "<" && exprJustEnded) {
				const angleClose = findMatchingAngleBracket(k, false);
				if (angleClose !== -1) {
					const nextAfter = tok(angleClose + 1);
					if (nextAfter.text === "(" || nextAfter.kind === "tpl_full" || nextAfter.kind === "tpl_head") {
						eraseRange(tk.start, tok(angleClose).end);
						k = angleClose + 1;
						continue;
					}
				}
			}

			// Postfix `expr as Type` / `expr satisfies Type`
			if (
				exprJustEnded &&
				tk.kind === "ident" &&
				(t === "as" || t === "satisfies") &&
				tok(k + 1).text !== ":" &&
				tok(k + 1).text !== "="
			) {
				const typeEnd = scanTypeEnd(k + 1);
				eraseRange(tk.start, tok(typeEnd).start);
				k = typeEnd;
				exprJustEnded = true;
				atStmtStart = false;
				continue;
			}

			// Postfix non-null assertion `expr!`
			if (t === "!" && exprJustEnded) {
				eraseRange(tk.start, tk.end);
				k++;
				exprJustEnded = true;
				continue;
			}

			// Ternary `?` / `:` tracking
			if (t === "?") {
				ternaryDepth++;
				k++;
				atStmtStart = false;
				exprJustEnded = false;
				continue;
			}
			if (t === ":" && ternaryDepth > 0) {
				ternaryDepth--;
				k++;
				atStmtStart = false;
				exprJustEnded = false;
				continue;
			}

			if (t === ";") {
				atStmtStart = true;
				exprJustEnded = false;
				k++;
				continue;
			}

			if (tk.kind === "ident" || tk.kind === "priv_ident") {
				const prev = k > rangeStart ? tok(k - 1) : undefined;
				const afterDot = prev !== undefined && (prev.text === "." || prev.text === "?.");
				exprJustEnded = afterDot || !REGEX_BEFORE_KEYWORDS.has(t);
				atStmtStart = t === "else" || t === "try" || t === "finally" || t === "do";
				k++;
				continue;
			}

			if (tk.kind === "num" || tk.kind === "str" || tk.kind === "tpl_full" || tk.kind === "tpl_tail" || tk.kind === "regex") {
				exprJustEnded = true;
				atStmtStart = false;
				k++;
				continue;
			}

			// Other operators (`=`, `,`, `+`, etc.)
			atStmtStart = false;
			exprJustEnded = t === "++" || t === "--";
			k++;
		}
	};

	processTokenRange(0, tokens.length - 1, true);
	return applyEdits(source, edits);
}

/** Collect all declared variable names from a destructuring or identifier pattern. */
function collectBindingIdentifiers(patternTokens: Token[]): string[] {
	const names: string[] = [];
	let i = 0;
	const walk = (end: number, inObject: boolean) => {
		while (i < end) {
			const t = patternTokens[i]!.text;
			if (t === ",") {
				i++;
				continue;
			}
			if (t === "...") {
				i++;
				continue;
			}
			if (t === "=") {
				// Skip default expression until next `,` at current bracket depth
				i++;
				let d = 0;
				while (i < end) {
					const tt = patternTokens[i]!.text;
					if (tt === "(" || tt === "[" || tt === "{") d++;
					else if (tt === ")" || tt === "]" || tt === "}") {
						if (d === 0) break;
						d--;
					} else if (tt === "," && d === 0) {
						break;
					}
					i++;
				}
				continue;
			}
			if (t === "{") {
				i++;
				walk(end, true);
				if (i < end && patternTokens[i]!.text === "}") i++;
				continue;
			}
			if (t === "[") {
				i++;
				walk(end, false);
				if (i < end && patternTokens[i]!.text === "]") i++;
				continue;
			}
			if (t === "}" || t === "]") {
				return;
			}
			if (inObject) {
				// `key: rename` or `shorthand` or `[computed]: rename`
				if (patternTokens[i + 1]?.text === ":") {
					i += 2; // skip `key:` and parse bound target
					continue;
				}
				if (patternTokens[i]!.kind === "ident") {
					names.push(patternTokens[i]!.text);
					i++;
					continue;
				}
			} else if (patternTokens[i]!.kind === "ident") {
				names.push(patternTokens[i]!.text);
				i++;
				continue;
			}
			i++;
		}
	};
	walk(patternTokens.length, false);
	return names;
}

const CJS_INTEROP_HEADER = `var __piImportDefault = globalThis.__piImportDefault || function(m) { return m && m.__esModule ? m.default : m; };
var __piImportStar = globalThis.__piImportStar || function(m) { if (m && m.__esModule) return m; var r = { default: m }; if (m != null && typeof m === "object") { for (var k in m) { if (Object.prototype.hasOwnProperty.call(m, k) && k !== "default") r[k] = m[k]; } } return r; };
var __piExportStar = globalThis.__piExportStar || function(m, exp) { if (m != null && typeof m === "object") { for (var k in m) { if (Object.prototype.hasOwnProperty.call(m, k) && k !== "default" && !Object.prototype.hasOwnProperty.call(exp, k)) exp[k] = m[k]; } } };
`;

function unquoteStringToken(tokenText: string): string {
	const quote = tokenText[0];
	if ((quote === '"' || quote === "'") && tokenText.endsWith(quote)) {
		return tokenText.slice(1, -1).replace(/\\(['"\\])/g, "$1");
	}
	return tokenText;
}

/**
 * Transform stripped ES2023+ ESM JavaScript into CommonJS suitable for JSC module evaluation.
 * Preserves pure CJS modules without adding `__esModule: true`.
 */
export function transformEsmToCjs(jsSource: string, filename = "module.js"): string {
	const { tokens, shebangEnd } = tokenize(jsSource);
	const edits: TextEdit[] = [];
	let hasEsmExport = false;
	let tempCounter = 0;

	if (shebangEnd > 0) {
		edits.push({ start: 0, end: shebangEnd, text: "" });
	}

	const tok = (idx: number): Token => {
		if (idx < 0) return tokens[0]!;
		if (idx >= tokens.length) return tokens[tokens.length - 1]!;
		return tokens[idx]!;
	};

	const findDelimiter = (openIdx: number): number => {
		const open = tok(openIdx).text;
		const close = open === "(" ? ")" : open === "[" ? "]" : "}";
		let k = openIdx + 1;
		while (tok(k).kind !== "eof") {
			const t = tok(k).text;
			if (t === "(" || t === "[" || t === "{") {
				k = findDelimiter(k) + 1;
				continue;
			}
			if (t === close) return k;
			k++;
		}
		return tokens.length - 1;
	};

	const findStmtEnd = (startIdx: number): number => {
		let k = startIdx;
		let dp = 0;
		let db = 0;
		let dc = 0;
		while (tok(k).kind !== "eof") {
			const tk = tok(k);
			if (tk.text === "(") dp++;
			else if (tk.text === ")") dp--;
			else if (tk.text === "[") db++;
			else if (tk.text === "]") db--;
			else if (tk.text === "{") dc++;
			else if (tk.text === "}") dc--;
			else if (dp === 0 && db === 0 && dc === 0) {
				if (tk.text === ";") return k + 1;
				if (k > startIdx && tk.newlineBefore) return k;
			}
			k++;
		}
		return k;
	};

	let depth = 0;
	let i = 0;
	while (tok(i).kind !== "eof") {
		const tk = tok(i);

		if (tk.text === "{") {
			depth++;
			i++;
			continue;
		}
		if (tk.text === "}") {
			if (depth > 0) depth--;
			i++;
			continue;
		}

		// Handle `import.meta.*` and dynamic `import(...)` anywhere
		if (tk.text === "import" && tk.kind === "ident" && tok(i - 1).text !== "." && tok(i - 1).text !== "?.") {
			if (tok(i + 1).text === "." && tok(i + 2).kind === "ident" && tok(i + 2).text === "meta") {
				if (tok(i + 3).text === "." && tok(i + 4).kind === "ident") {
					const prop = tok(i + 4).text;
					if (prop === "url") {
						edits.push({ start: tk.start, end: tok(i + 4).end, text: `("file://" + (typeof __piFilename !== "undefined" ? __piFilename : __filename))` });
						i += 5;
						continue;
					}
					if (prop === "dirname") {
						edits.push({ start: tk.start, end: tok(i + 4).end, text: `(typeof __piDirname !== "undefined" ? __piDirname : __dirname)` });
						i += 5;
						continue;
					}
					if (prop === "filename") {
						edits.push({ start: tk.start, end: tok(i + 4).end, text: `(typeof __piFilename !== "undefined" ? __piFilename : __filename)` });
						i += 5;
						continue;
					}
				}
				edits.push({ start: tk.start, end: tok(i + 2).end, text: `({ url: "file://" + (typeof __piFilename !== "undefined" ? __piFilename : __filename), dirname: (typeof __piDirname !== "undefined" ? __piDirname : __dirname), filename: (typeof __piFilename !== "undefined" ? __piFilename : __filename) })` });
				i += 3;
				continue;
			}
			if (tok(i + 1).text === "(") {
				const closeP = findDelimiter(i + 1);
				const argSlice = jsSource.slice(tok(i + 2).start, tok(closeP).start);
				edits.push({ start: tk.start, end: tok(closeP).end, text: `Promise.resolve().then(function() { return require(${argSlice}); })` });
				i = closeP + 1;
				continue;
			}
		}

		// Top-level ESM `import`
		if (depth === 0 && tk.text === "import" && tk.kind === "ident" && tok(i - 1).text !== ".") {
			// Side-effect `import "mod"`
			if (tok(i + 1).kind === "str") {
				const modStr = tok(i + 1).text;
				const endIdx = tok(i + 2).text === ";" ? i + 3 : i + 2;
				edits.push({ start: tk.start, end: tok(endIdx - 1).end, text: `require(${modStr});` });
				i = endIdx;
				continue;
			}

			let k = i + 1;
			let defaultBinding: string | undefined;
			let namespaceBinding: string | undefined;
			const namedBindings: Array<{ imported: string; local: string }> = [];

			if (tok(k).kind === "ident") {
				defaultBinding = tok(k).text;
				k++;
				if (tok(k).text === ",") k++;
			}
			if (tok(k).text === "*" && tok(k + 1).text === "as" && tok(k + 2).kind === "ident") {
				namespaceBinding = tok(k + 2).text;
				k += 3;
			} else if (tok(k).text === "{") {
				const closeB = findDelimiter(k);
				let m = k + 1;
				while (m < closeB) {
					if (tok(m).text === ",") {
						m++;
						continue;
					}
					const impName = tok(m).text;
					let locName = impName;
					m++;
					if (tok(m).text === "as") {
						locName = tok(m + 1).text;
						m += 2;
					}
					namedBindings.push({ imported: impName, local: locName });
				}
				k = closeB + 1;
			}

			if (tok(k).text === "from" && tok(k + 1).kind === "str") {
				const modStr = tok(k + 1).text;
				const endIdx = tok(k + 2).text === ";" ? k + 3 : k + 2;
				const lines: string[] = [];
				const tmp = `_pi_imp_${tempCounter++}`;
				if (namespaceBinding !== undefined && defaultBinding === undefined && namedBindings.length === 0) {
					lines.push(`const ${namespaceBinding} = __piImportStar(require(${modStr}));`);
				} else if (defaultBinding !== undefined && namespaceBinding === undefined && namedBindings.length === 0) {
					lines.push(`const ${defaultBinding} = __piImportDefault(require(${modStr}));`);
				} else {
					lines.push(`const ${tmp} = require(${modStr});`);
					if (defaultBinding !== undefined) {
						lines.push(`const ${defaultBinding} = __piImportDefault(${tmp});`);
					}
					if (namespaceBinding !== undefined) {
						lines.push(`const ${namespaceBinding} = __piImportStar(${tmp});`);
					}
					for (const nb of namedBindings) {
						if (nb.imported === "default") {
							lines.push(`const ${nb.local} = __piImportDefault(${tmp});`);
						} else {
							lines.push(`const ${nb.local} = ${tmp}.${nb.imported};`);
						}
					}
				}
				edits.push({ start: tk.start, end: tok(endIdx - 1).end, text: lines.join(" ") });
				i = endIdx;
				continue;
			}
		}

		// Top-level ESM `export`
		if (depth === 0 && tk.text === "export" && tk.kind === "ident" && tok(i - 1).text !== ".") {
			hasEsmExport = true;
			const next = tok(i + 1);

			// `export * as ns from "mod"`
			if (next.text === "*" && tok(i + 2).text === "as" && tok(i + 3).kind === "ident" && tok(i + 4).text === "from" && tok(i + 5).kind === "str") {
				const nsName = tok(i + 3).text;
				const modStr = tok(i + 5).text;
				const endIdx = tok(i + 6).text === ";" ? i + 7 : i + 6;
				edits.push({ start: tk.start, end: tok(endIdx - 1).end, text: `exports.${nsName} = __piImportStar(require(${modStr}));` });
				i = endIdx;
				continue;
			}

			// `export * from "mod"`
			if (next.text === "*" && tok(i + 2).text === "from" && tok(i + 3).kind === "str") {
				const modStr = tok(i + 3).text;
				const endIdx = tok(i + 4).text === ";" ? i + 5 : i + 4;
				edits.push({ start: tk.start, end: tok(endIdx - 1).end, text: `__piExportStar(require(${modStr}), exports);` });
				i = endIdx;
				continue;
			}

			// `export { ... } [from "mod"]`
			if (next.text === "{") {
				const closeB = findDelimiter(i + 1);
				const items: Array<{ local: string; exported: string }> = [];
				let m = i + 2;
				while (m < closeB) {
					if (tok(m).text === ",") {
						m++;
						continue;
					}
					const loc = tok(m).text;
					let exp = loc;
					m++;
					if (tok(m).text === "as") {
						exp = tok(m + 1).text;
						m += 2;
					}
					items.push({ local: loc, exported: exp });
				}
				let k = closeB + 1;
				if (tok(k).text === "from" && tok(k + 1).kind === "str") {
					const modStr = tok(k + 1).text;
					const endIdx = tok(k + 2).text === ";" ? k + 3 : k + 2;
					const tmp = `_pi_re_${tempCounter++}`;
					const out: string[] = [`const ${tmp} = require(${modStr});`];
					for (const item of items) {
						const rhs = item.local === "default" ? `__piImportDefault(${tmp})` : `${tmp}.${item.local}`;
						out.push(`exports.${item.exported} = ${rhs};`);
					}
					edits.push({ start: tk.start, end: tok(endIdx - 1).end, text: out.join(" ") });
					i = endIdx;
					continue;
				}
				const endIdx = tok(k).text === ";" ? k + 1 : k;
				const out = items.map((item) => `exports.${item.exported} = ${item.local};`);
				edits.push({ start: tk.start, end: tok(endIdx - 1).end, text: out.join(" ") });
				i = endIdx;
				continue;
			}

			// `export default ...`
			if (next.text === "default") {
				const target = tok(i + 2);
				// `export default [async] function[*]? [name](...) { ... }`
				let fnIdx = i + 2;
				if (target.text === "async") fnIdx++;
				if (tok(fnIdx).text === "function") {
					let scan = fnIdx + 1;
					if (tok(scan).text === "*") scan++;
					if (tok(scan).kind === "ident") {
						// Named function declaration: keep `function name(...) { ... }` and append `exports.default = name;`
						const fnName = tok(scan).text;
						while (tok(scan).kind !== "eof" && tok(scan).text !== "(") scan++;
						const paramClose = findDelimiter(scan);
						const bodyClose = findDelimiter(paramClose + 1);
						edits.push({ start: tk.start, end: target.start, text: "" });
						edits.push({ start: tok(bodyClose).end, end: tok(bodyClose).end, text: ` exports.default = ${fnName};` });
						i = i + 2; // let loop process inner body cleanly
						continue;
					}
					edits.push({ start: tk.start, end: target.start, text: "exports.default = " });
					i += 2;
					continue;
				}
				if (target.text === "class") {
					if (tok(i + 3).kind === "ident" && tok(i + 3).text !== "extends") {
						const clsName = tok(i + 3).text;
						let scan = i + 4;
						while (tok(scan).kind !== "eof" && tok(scan).text !== "{") scan++;
						const bodyClose = findDelimiter(scan);
						edits.push({ start: tk.start, end: target.start, text: "" });
						edits.push({ start: tok(bodyClose).end, end: tok(bodyClose).end, text: ` exports.default = ${clsName};` });
						i += 2;
						continue;
					}
					edits.push({ start: tk.start, end: target.start, text: "exports.default = " });
					i += 2;
					continue;
				}
				edits.push({ start: tk.start, end: target.start, text: "exports.default = " });
				i += 2;
				continue;
			}

			// `export async? function[*]? name(...) { ... }`
			let fnIdx = i + 1;
			if (next.text === "async") fnIdx++;
			if (tok(fnIdx).text === "function") {
				let scan = fnIdx + 1;
				if (tok(scan).text === "*") scan++;
				const fnName = tok(scan).text;
				while (tok(scan).kind !== "eof" && tok(scan).text !== "(") scan++;
				const paramClose = findDelimiter(scan);
				const bodyClose = findDelimiter(paramClose + 1);
				edits.push({ start: tk.start, end: next.start, text: "" });
				edits.push({ start: tok(bodyClose).end, end: tok(bodyClose).end, text: ` exports.${fnName} = ${fnName};` });
				i += 1;
				continue;
			}

			// `export class Name { ... }`
			if (next.text === "class" && tok(i + 2).kind === "ident") {
				const clsName = tok(i + 2).text;
				let scan = i + 3;
				while (tok(scan).kind !== "eof" && tok(scan).text !== "{") scan++;
				const bodyClose = findDelimiter(scan);
				edits.push({ start: tk.start, end: next.start, text: "" });
				edits.push({ start: tok(bodyClose).end, end: tok(bodyClose).end, text: ` exports.${clsName} = ${clsName};` });
				i += 1;
				continue;
			}

			// `export const|let|var ...`
			if (next.text === "const" || next.text === "let" || next.text === "var") {
				edits.push({ start: tk.start, end: next.start, text: "" });
				// Walk declarators cleanly to collect exported variable names
				const stmtEnd = findStmtEnd(i + 1);
				const names: string[] = [];
				let k = i + 2;
				while (k < stmtEnd) {
					const patStart = k;
					if (tok(k).text === "{" || tok(k).text === "[") {
						k = findDelimiter(k) + 1;
					} else if (tok(k).kind === "ident") {
						k++;
					} else {
						break;
					}
					names.push(...collectBindingIdentifiers(tokens.slice(patStart, k)));
					if (tok(k).text === "=") {
						k++;
						let dp = 0;
						let db = 0;
						let dc = 0;
						while (k < stmtEnd) {
							const tt = tok(k).text;
							if (tt === "(") dp++;
							else if (tt === ")") dp--;
							else if (tt === "[") db++;
							else if (tt === "]") db--;
							else if (tt === "{") dc++;
							else if (tt === "}") dc--;
							else if ((tt === "," || tt === ";") && dp === 0 && db === 0 && dc === 0) break;
							k++;
						}
					}
					if (tok(k).text === ",") {
						k++;
						continue;
					}
					break;
				}
				const insertPos = tok(stmtEnd - 1).end;
				const sep = tok(stmtEnd - 1).text === ";" ? " " : "; ";
				const exportsAssign = names.map((n) => `exports.${n} = ${n};`).join(" ");
				if (exportsAssign.length > 0) {
					edits.push({ start: insertPos, end: insertPos, text: `${sep}${exportsAssign}` });
				}
				i += 1;
				continue;
			}
		}

		i++;
	}

	const transformed = applyEdits(jsSource, edits);
	if (!hasEsmExport) {
		return `${CJS_INTEROP_HEADER}${transformed}`;
	}
	void filename;
	return `Object.defineProperty(exports, "__esModule", { value: true });\n${CJS_INTEROP_HEADER}${transformed}`;
}

/** Extract static module specifiers (`require("...")`, `import("...")`) from transformed CJS JS. */
function extractModuleSpecifiers(jsSource: string): string[] {
	const { tokens } = tokenize(jsSource);
	const specs: string[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < tokens.length - 3; i++) {
		const t = tokens[i]!;
		const next = tokens[i + 1]!;
		const arg = tokens[i + 2]!;
		const close = tokens[i + 3]!;
		const prev = i > 0 ? tokens[i - 1] : undefined;
		if (
			t.kind === "ident" &&
			t.text === "require" &&
			(prev === undefined || (prev.text !== "." && prev.text !== "?.")) &&
			next.text === "(" &&
			arg.kind === "str" &&
			close.text === ")"
		) {
			const spec = unquoteStringToken(arg.text);
			if (!seen.has(spec)) {
				seen.add(spec);
				specs.push(spec);
			}
		}
	}
	return specs;
}

function isFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function isDirectory(dirPath: string): boolean {
	try {
		return fs.statSync(dirPath).isDirectory();
	} catch {
		return false;
	}
}

function resolveFileWithExtensions(basePath: string): string | null {
	if (isFile(basePath)) {
		return fs.realpathSync(basePath);
	}

	// TS NodeNext style: import "./utils.js" -> "./utils.ts"
	if (basePath.endsWith(".js") || basePath.endsWith(".mjs") || basePath.endsWith(".cjs")) {
		const stem = basePath.replace(/\.(mjs|cjs|js)$/, "");
		for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
			if (isFile(stem + ext)) {
				return fs.realpathSync(stem + ext);
			}
		}
	}

	for (const ext of [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".json"]) {
		if (isFile(basePath + ext)) {
			return fs.realpathSync(basePath + ext);
		}
	}

	if (isDirectory(basePath)) {
		for (const idx of [
			"index.ts",
			"index.mts",
			"index.cts",
			"index.tsx",
			"index.js",
			"index.mjs",
			"index.cjs",
			"index.json",
		]) {
			const candidate = path.join(basePath, idx);
			if (isFile(candidate)) {
				return fs.realpathSync(candidate);
			}
		}
	}

	return null;
}

function parsePackageSpecifier(specifier: string): { pkgName: string; subpath: string } {
	if (specifier.startsWith("@")) {
		const parts = specifier.split("/");
		const pkgName = parts.slice(0, 2).join("/");
		const rest = parts.slice(2).join("/");
		return { pkgName, subpath: rest.length > 0 ? `./${rest}` : "." };
	}
	const slashIdx = specifier.indexOf("/");
	if (slashIdx === -1) {
		return { pkgName: specifier, subpath: "." };
	}
	return {
		pkgName: specifier.slice(0, slashIdx),
		subpath: `./${specifier.slice(slashIdx + 1)}`,
	};
}

function resolveExportTarget(target: unknown): string | null {
	if (typeof target === "string") {
		return target;
	}
	if (Array.isArray(target)) {
		for (const item of target) {
			const resolved = resolveExportTarget(item);
			if (resolved !== null) return resolved;
		}
		return null;
	}
	if (target !== null && typeof target === "object") {
		const record = target as Record<string, unknown>;
		for (const condition of ["import", "node", "default", "require"]) {
			if (Object.prototype.hasOwnProperty.call(record, condition)) {
				const resolved = resolveExportTarget(record[condition]);
				if (resolved !== null) return resolved;
			}
		}
	}
	return null;
}

function resolvePackageEntryInDir(pkgDir: string, subpath: string): string | null {
	const pkgJsonPath = path.join(pkgDir, "package.json");
	if (isFile(pkgJsonPath)) {
		try {
			const raw = fs.readFileSync(pkgJsonPath, "utf8");
			const pkg = JSON.parse(raw) as Record<string, unknown>;
			if (pkg.exports !== undefined && pkg.exports !== null) {
				if (typeof pkg.exports === "string" || Array.isArray(pkg.exports)) {
					if (subpath === ".") {
						const t = resolveExportTarget(pkg.exports);
						if (t !== null) {
							const r = resolveFileWithExtensions(path.resolve(pkgDir, t));
							if (r !== null) return r;
						}
					}
				} else if (typeof pkg.exports === "object") {
					const exportsObj = pkg.exports as Record<string, unknown>;
					if (Object.prototype.hasOwnProperty.call(exportsObj, subpath)) {
						const t = resolveExportTarget(exportsObj[subpath]);
						if (t !== null) {
							const r = resolveFileWithExtensions(path.resolve(pkgDir, t));
							if (r !== null) return r;
						}
					} else if (subpath === "." && !Object.keys(exportsObj).some((k) => k.startsWith("."))) {
						const t = resolveExportTarget(exportsObj);
						if (t !== null) {
							const r = resolveFileWithExtensions(path.resolve(pkgDir, t));
							if (r !== null) return r;
						}
					}
				}
			}

			if (subpath === ".") {
				for (const field of ["module", "main"]) {
					const val = pkg[field];
					if (typeof val === "string" && val.length > 0) {
						const r = resolveFileWithExtensions(path.resolve(pkgDir, val));
						if (r !== null) return r;
					}
				}
			}
		} catch {
			// Fall back to direct path resolution
		}
	}

	if (subpath === ".") {
		return resolveFileWithExtensions(pkgDir);
	}
	return resolveFileWithExtensions(path.resolve(pkgDir, subpath));
}

function packageDeclaresDependency(dir: string, pkgName: string): boolean {
	const pkgJsonPath = path.join(dir, "package.json");
	if (!isFile(pkgJsonPath)) return false;
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;
		for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
			const deps = pkg[section];
			if (deps !== null && typeof deps === "object" && Object.prototype.hasOwnProperty.call(deps, pkgName)) {
				return true;
			}
		}
	} catch {
		return false;
	}
	return false;
}

function normalizeBuiltinSpecifier(specifier: string): string | null {
	const raw = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
	if (BUILTIN_NODE_MODULES.has(raw)) {
		return `node:${raw}`;
	}
	if (specifier.startsWith("node:")) {
		return specifier;
	}
	return null;
}

function isVirtualPackageSpecifier(specifier: string): boolean {
	const { pkgName } = parsePackageSpecifier(specifier);
	return HOST_VIRTUAL_PACKAGES.has(pkgName);
}

/**
 * Resolve and bundle a TypeScript/JavaScript extension entrypoint and all reachable
 * local modules and physical `node_modules` dependencies into a CommonJS module map.
 */
export function bundleExtensionEntry(entryPath: string): BundledExtensionGraph {
	const resolvedEntry = resolveFileWithExtensions(path.resolve(entryPath));
	if (resolvedEntry === null) {
		throw new Error(`Extension entrypoint not found: ${entryPath}`);
	}

	const modules: Record<string, string> = {};
	const jsonModules: Record<string, string> = {};
	const specifierMap: Record<string, Record<string, string>> = {};
	const virtualSet = new Set<string>();
	const missingSpecifiers: Array<{ from: string; specifier: string }> = [];
	const visited = new Set<string>();

	const resolveBareSpecifier = (specifier: string, fromDir: string): string | null => {
		const { pkgName, subpath } = parsePackageSpecifier(specifier);
		const isVirtual = HOST_VIRTUAL_PACKAGES.has(pkgName);
		let dir = path.resolve(fromDir);

		while (true) {
			const pkgDir = path.join(dir, "node_modules", ...pkgName.split("/"));
			if (isDirectory(pkgDir)) {
				// For host-provided virtual packages, only override with physical node_modules when
				// declared in the same owner package's dependencies (regression #9863).
				if (!isVirtual || packageDeclaresDependency(dir, pkgName)) {
					const resolved = resolvePackageEntryInDir(pkgDir, subpath);
					if (resolved !== null) {
						return resolved;
					}
				}
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		return null;
	};

	const visitFile = (filePath: string): void => {
		if (visited.has(filePath)) return;
		visited.add(filePath);

		const raw = fs.readFileSync(filePath, "utf8");
		if (filePath.endsWith(".json")) {
			jsonModules[filePath] = raw;
			return;
		}

		const stripped = stripTypeScriptTypes(raw, filePath);
		const cjs = transformEsmToCjs(stripped, filePath);
		modules[filePath] = cjs;

		const fileSpecs: Record<string, string> = {};
		specifierMap[filePath] = fileSpecs;
		const fromDir = path.dirname(filePath);

		for (const spec of extractModuleSpecifiers(cjs)) {
			const builtin = normalizeBuiltinSpecifier(spec);
			if (builtin !== null) {
				fileSpecs[spec] = builtin;
				virtualSet.add(builtin);
				continue;
			}

			if (spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec)) {
				const target = path.isAbsolute(spec) ? spec : path.resolve(fromDir, spec);
				const resolved = resolveFileWithExtensions(target);
				if (resolved !== null) {
					fileSpecs[spec] = resolved;
					visitFile(resolved);
				} else {
					missingSpecifiers.push({ from: filePath, specifier: spec });
				}
				continue;
			}

			const physical = resolveBareSpecifier(spec, fromDir);
			if (physical !== null) {
				fileSpecs[spec] = physical;
				visitFile(physical);
				continue;
			}

			if (isVirtualPackageSpecifier(spec)) {
				const virtualId = `virtual:${spec}`;
				fileSpecs[spec] = virtualId;
				virtualSet.add(virtualId);
				continue;
			}

			missingSpecifiers.push({ from: filePath, specifier: spec });
		}
	};

	visitFile(resolvedEntry);

	return {
		entry: resolvedEntry,
		modules,
		jsonModules,
		specifierMap,
		virtualSpecifiers: Array.from(virtualSet),
		missingSpecifiers,
	};
}
