import type { Color } from "../colors.ts";
import type { GuiTheme } from "../theme.ts";

/** Syntax highlight token classification matching Waku's Markdown code renderer. */
export type CodeTokenKind =
	| "keyword"
	| "literal"
	| "string"
	| "comment"
	| "number"
	| "type"
	| "function"
	| "meta"
	| "added"
	| "removed"
	| "plain";

/** Single highlighted span within a single line of code. */
export interface CodeToken {
	readonly kind: CodeTokenKind;
	readonly text: string;
}

type LangFamily =
	| "js"
	| "rust"
	| "python"
	| "go"
	| "c_like"
	| "shell"
	| "json"
	| "yaml"
	| "toml"
	| "sql"
	| "markup"
	| "css"
	| "diff"
	| "markdown"
	| "plain";

interface LexerState {
	inBlockComment: boolean;
	quoteChar: string;
	tripleQuote: string;
}

const JS_KEYWORDS = new Set<string>([
	"as",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"declare",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"finally",
	"for",
	"from",
	"function",
	"get",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"keyof",
	"let",
	"module",
	"namespace",
	"new",
	"of",
	"override",
	"package",
	"private",
	"protected",
	"public",
	"readonly",
	"return",
	"satisfies",
	"set",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"try",
	"type",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
]);

const JS_LITERALS = new Set<string>(["true", "false", "null", "undefined", "NaN", "Infinity"]);
const JS_TYPES = new Set<string>([
	"string",
	"number",
	"boolean",
	"bigint",
	"symbol",
	"object",
	"unknown",
	"never",
	"any",
	"void",
	"Array",
	"Map",
	"Set",
	"Promise",
	"Record",
	"Partial",
	"Readonly",
	"Uint8Array",
]);

const RUST_KEYWORDS = new Set<string>([
	"as",
	"async",
	"await",
	"break",
	"const",
	"continue",
	"crate",
	"dyn",
	"else",
	"enum",
	"extern",
	"fn",
	"for",
	"if",
	"impl",
	"in",
	"let",
	"loop",
	"match",
	"mod",
	"move",
	"mut",
	"pub",
	"ref",
	"return",
	"self",
	"Self",
	"static",
	"struct",
	"super",
	"trait",
	"type",
	"unsafe",
	"use",
	"where",
	"while",
]);

const RUST_LITERALS = new Set<string>(["true", "false", "Some", "None", "Ok", "Err"]);
const RUST_TYPES = new Set<string>([
	"bool",
	"char",
	"str",
	"String",
	"usize",
	"isize",
	"u8",
	"u16",
	"u32",
	"u64",
	"u128",
	"i8",
	"i16",
	"i32",
	"i64",
	"i128",
	"f32",
	"f64",
	"Vec",
	"Option",
	"Result",
	"Box",
	"Arc",
	"Rc",
	"HashMap",
	"HashSet",
]);

const PY_KEYWORDS = new Set<string>([
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"match",
	"case",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
]);

const PY_LITERALS = new Set<string>(["True", "False", "None", "self", "cls"]);
const PY_TYPES = new Set<string>(["int", "float", "str", "bool", "list", "dict", "set", "tuple", "bytes", "object"]);

const GO_KEYWORDS = new Set<string>([
	"break",
	"case",
	"chan",
	"const",
	"continue",
	"default",
	"defer",
	"else",
	"fallthrough",
	"for",
	"func",
	"go",
	"goto",
	"if",
	"import",
	"interface",
	"map",
	"package",
	"range",
	"return",
	"select",
	"struct",
	"switch",
	"type",
	"var",
]);

const GO_LITERALS = new Set<string>(["true", "false", "nil", "iota"]);
const GO_TYPES = new Set<string>([
	"bool",
	"byte",
	"complex64",
	"complex128",
	"error",
	"float32",
	"float64",
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"rune",
	"string",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
	"any",
]);

const C_KEYWORDS = new Set<string>([
	"auto",
	"break",
	"case",
	"class",
	"const",
	"constexpr",
	"continue",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"extern",
	"final",
	"for",
	"friend",
	"fun",
	"func",
	"goto",
	"guard",
	"if",
	"implements",
	"import",
	"in",
	"inline",
	"interface",
	"let",
	"namespace",
	"new",
	"noexcept",
	"operator",
	"override",
	"package",
	"private",
	"protected",
	"protocol",
	"public",
	"return",
	"sizeof",
	"static",
	"struct",
	"switch",
	"template",
	"this",
	"throw",
	"try",
	"typedef",
	"typename",
	"union",
	"using",
	"val",
	"var",
	"virtual",
	"volatile",
	"while",
]);

const C_LITERALS = new Set<string>(["true", "false", "NULL", "nullptr", "nil", "YES", "NO"]);
const C_TYPES = new Set<string>([
	"void",
	"bool",
	"BOOL",
	"char",
	"short",
	"int",
	"long",
	"float",
	"double",
	"signed",
	"unsigned",
	"size_t",
	"uint8_t",
	"uint16_t",
	"uint32_t",
	"uint64_t",
	"int8_t",
	"int16_t",
	"int32_t",
	"int64_t",
	"String",
	"NSString",
	"NSView",
	"NSWindow",
	"CGFloat",
	"id",
]);

const SHELL_KEYWORDS = new Set<string>([
	"case",
	"do",
	"done",
	"elif",
	"else",
	"esac",
	"export",
	"fi",
	"for",
	"function",
	"if",
	"in",
	"local",
	"readonly",
	"return",
	"select",
	"set",
	"shift",
	"source",
	"then",
	"unset",
	"until",
	"while",
]);

const SHELL_LITERALS = new Set<string>(["true", "false"]);

const SQL_KEYWORDS = new Set<string>([
	"SELECT",
	"FROM",
	"WHERE",
	"INSERT",
	"INTO",
	"VALUES",
	"UPDATE",
	"SET",
	"DELETE",
	"CREATE",
	"ALTER",
	"DROP",
	"TABLE",
	"INDEX",
	"VIEW",
	"JOIN",
	"LEFT",
	"RIGHT",
	"INNER",
	"OUTER",
	"ON",
	"AS",
	"AND",
	"OR",
	"NOT",
	"IN",
	"IS",
	"GROUP",
	"BY",
	"ORDER",
	"LIMIT",
	"OFFSET",
	"HAVING",
	"DISTINCT",
	"UNION",
	"ALL",
	"CASE",
	"WHEN",
	"THEN",
	"ELSE",
	"END",
	"PRIMARY",
	"KEY",
	"REFERENCES",
]);

/** Resolve a `CodeTokenKind` to the corresponding Waku theme color. */
export function tokenColorForKind(kind: CodeTokenKind, theme: GuiTheme): Color {
	switch (kind) {
		case "keyword":
			return theme.syntaxKeyword;
		case "literal":
			return theme.syntaxLiteral;
		case "string":
			return theme.syntaxString;
		case "comment":
			return theme.syntaxComment;
		case "number":
			return theme.syntaxNumber;
		case "type":
			return theme.syntaxType;
		case "function":
			return theme.syntaxFunction;
		case "meta":
			return theme.syntaxMeta;
		case "added":
			return theme.diffAddText;
		case "removed":
			return theme.diffDelText;
		case "plain":
			return theme.codeText;
	}
}

function resolveLangFamily(language: string): LangFamily {
	const raw = language.trim().toLowerCase();
	const spaceIdx = raw.indexOf(" ");
	const norm = spaceIdx >= 0 ? raw.slice(0, spaceIdx) : raw;
	switch (norm) {
		case "ts":
		case "tsx":
		case "mts":
		case "cts":
		case "typescript":
		case "js":
		case "jsx":
		case "mjs":
		case "cjs":
		case "javascript":
			return "js";
		case "rs":
		case "rust":
			return "rust";
		case "py":
		case "py3":
		case "python":
			return "python";
		case "go":
		case "golang":
			return "go";
		case "c":
		case "h":
		case "cpp":
		case "cc":
		case "cxx":
		case "hpp":
		case "c++":
		case "objc":
		case "obj-c":
		case "objective-c":
		case "m":
		case "mm":
		case "swift":
		case "java":
		case "kotlin":
		case "kt":
		case "scala":
		case "cs":
		case "csharp":
		case "c#":
		case "zig":
		case "dart":
		case "php":
		case "ruby":
		case "rb":
			return "c_like";
		case "sh":
		case "bash":
		case "zsh":
		case "shell":
		case "fish":
		case "console":
			return "shell";
		case "json":
		case "jsonc":
		case "json5":
			return "json";
		case "yaml":
		case "yml":
			return "yaml";
		case "toml":
			return "toml";
		case "sql":
			return "sql";
		case "html":
		case "xml":
		case "svg":
			return "markup";
		case "css":
		case "scss":
		case "less":
			return "css";
		case "diff":
		case "patch":
			return "diff";
		case "md":
		case "markdown":
			return "markdown";
		default:
			return "plain";
	}
}

function isDigit(code: number): boolean {
	return code >= 48 && code <= 57;
}

function isHexDigit(code: number): boolean {
	return isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function isIdentStart(code: number): boolean {
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
}

function isIdentPart(code: number): boolean {
	return isIdentStart(code) || isDigit(code);
}

function isUpperAscii(code: number): boolean {
	return code >= 65 && code <= 90;
}

function pushToken(out: CodeToken[], kind: CodeTokenKind, text: string): void {
	if (text.length === 0) return;
	const last = out.length > 0 ? out[out.length - 1] : undefined;
	if (last !== undefined && last.kind === kind) {
		out[out.length - 1] = { kind, text: last.text + text };
		return;
	}
	out.push({ kind, text });
}

function classifyIdent(
	family: LangFamily,
	word: string,
	afterWordChar: number,
	afterDot: boolean,
): CodeTokenKind {
	if (family === "js") {
		if (!afterDot && JS_KEYWORDS.has(word)) return "keyword";
		if (JS_LITERALS.has(word)) return "literal";
		if (JS_TYPES.has(word)) return "type";
	} else if (family === "rust") {
		if (!afterDot && RUST_KEYWORDS.has(word)) return "keyword";
		if (RUST_LITERALS.has(word)) return "literal";
		if (RUST_TYPES.has(word)) return "type";
		if (afterWordChar === 33) return "meta";
	} else if (family === "python") {
		if (!afterDot && PY_KEYWORDS.has(word)) return "keyword";
		if (PY_LITERALS.has(word)) return "literal";
		if (PY_TYPES.has(word)) return "type";
	} else if (family === "go") {
		if (!afterDot && GO_KEYWORDS.has(word)) return "keyword";
		if (GO_LITERALS.has(word)) return "literal";
		if (GO_TYPES.has(word)) return "type";
	} else if (family === "c_like") {
		if (!afterDot && C_KEYWORDS.has(word)) return "keyword";
		if (C_LITERALS.has(word)) return "literal";
		if (C_TYPES.has(word)) return "type";
	} else if (family === "shell") {
		if (SHELL_KEYWORDS.has(word)) return "keyword";
		if (SHELL_LITERALS.has(word)) return "literal";
	} else if (family === "sql") {
		const upper = word.toUpperCase();
		if (SQL_KEYWORDS.has(upper)) return "keyword";
		if (upper === "TRUE" || upper === "FALSE" || upper === "NULL") return "literal";
	} else if (family === "json" || family === "yaml" || family === "toml") {
		if (word === "true" || word === "false" || word === "null") return "literal";
	}

	if (afterWordChar === 40) return "function";
	const firstCode = word.length > 0 ? word.charCodeAt(0) : 0;
	if (isUpperAscii(firstCode) && word.length > 1) return "type";
	return "plain";
}

function scanQuotedString(line: string, startIdx: number, quoteChar: string, state: LexerState): number {
	const len = line.length;
	let i = startIdx;
	while (i < len) {
		const ch = line.charAt(i);
		if (ch === "\\" && i + 1 < len) {
			i += 2;
			continue;
		}
		if (ch === quoteChar) {
			state.quoteChar = "";
			return i + 1;
		}
		i++;
	}
	// Backtick template strings and single/double strings only persist across lines if unclosed template.
	if (quoteChar === "`") {
		state.quoteChar = "`";
	}
	return len;
}

function scanTripleQuotedString(line: string, startIdx: number, tripleQuote: string, state: LexerState): number {
	const closeIdx = line.indexOf(tripleQuote, startIdx);
	if (closeIdx >= 0) {
		state.tripleQuote = "";
		return closeIdx + 3;
	}
	state.tripleQuote = tripleQuote;
	return line.length;
}

function scanNumberEnd(line: string, startIdx: number): number {
	const len = line.length;
	let i = startIdx;
	if (line.charAt(i) === "0" && i + 1 < len) {
		const next = line.charAt(i + 1);
		if (next === "x" || next === "X" || next === "b" || next === "B" || next === "o" || next === "O") {
			i += 2;
			while (i < len) {
				const c = line.charCodeAt(i);
				if (isHexDigit(c) || c === 95) {
					i++;
				} else {
					break;
				}
			}
			return i;
		}
	}
	while (i < len) {
		const c = line.charCodeAt(i);
		if (isDigit(c) || c === 95 || c === 46) {
			if (c === 46 && (i + 1 >= len || !isDigit(line.charCodeAt(i + 1)))) {
				break;
			}
			i++;
		} else {
			break;
		}
	}
	if (i < len && (line.charAt(i) === "e" || line.charAt(i) === "E")) {
		let exp = i + 1;
		if (exp < len && (line.charAt(exp) === "+" || line.charAt(exp) === "-")) {
			exp++;
		}
		if (exp < len && isDigit(line.charCodeAt(exp))) {
			i = exp;
			while (i < len && isDigit(line.charCodeAt(i))) {
				i++;
			}
		}
	}
	// Suffixes like u32, usize, n, px
	while (i < len && isIdentStart(line.charCodeAt(i))) {
		i++;
	}
	return i;
}

function tokenizeDiffLine(line: string): CodeToken[] {
	if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ")) {
		return [{ kind: "meta", text: line }];
	}
	if (line.startsWith("+")) {
		return [{ kind: "added", text: line }];
	}
	if (line.startsWith("-")) {
		return [{ kind: "removed", text: line }];
	}
	return [{ kind: "plain", text: line }];
}

function tokenizeMarkupLine(line: string, state: LexerState): CodeToken[] {
	const out: CodeToken[] = [];
	const len = line.length;
	let i = 0;

	if (state.inBlockComment) {
		const closeIdx = line.indexOf("-->", i);
		if (closeIdx < 0) {
			pushToken(out, "comment", line);
			return out;
		}
		pushToken(out, "comment", line.slice(0, closeIdx + 3));
		state.inBlockComment = false;
		i = closeIdx + 3;
	}

	while (i < len) {
		if (line.startsWith("<!--", i)) {
			const closeIdx = line.indexOf("-->", i + 4);
			if (closeIdx < 0) {
				pushToken(out, "comment", line.slice(i));
				state.inBlockComment = true;
				break;
			}
			pushToken(out, "comment", line.slice(i, closeIdx + 3));
			i = closeIdx + 3;
			continue;
		}
		if (line.charAt(i) === "<") {
			const closeIdx = line.indexOf(">", i + 1);
			const endTag = closeIdx >= 0 ? closeIdx + 1 : len;
			const tagBody = line.slice(i, endTag);
			let j = 0;
			while (j < tagBody.length) {
				const ch = tagBody.charAt(j);
				if (ch === '"' || ch === "'") {
					const endQ = scanQuotedString(tagBody, j + 1, ch, { inBlockComment: false, quoteChar: "", tripleQuote: "" });
					pushToken(out, "string", tagBody.slice(j, endQ));
					j = endQ;
					continue;
				}
				if (isIdentStart(tagBody.charCodeAt(j))) {
					let k = j + 1;
					while (k < tagBody.length && (isIdentPart(tagBody.charCodeAt(k)) || tagBody.charCodeAt(k) === 45)) {
						k++;
					}
					const prev = j > 0 ? tagBody.charAt(j - 1) : "";
					const isTagName = prev === "<" || prev === "/";
					pushToken(out, isTagName ? "keyword" : "meta", tagBody.slice(j, k));
					j = k;
					continue;
				}
				pushToken(out, "plain", ch);
				j++;
			}
			i = endTag;
			continue;
		}
		const nextTag = line.indexOf("<", i);
		const textEnd = nextTag >= 0 ? nextTag : len;
		pushToken(out, "plain", line.slice(i, textEnd));
		i = textEnd;
	}
	return out;
}

function tokenizeCodeLine(line: string, family: LangFamily, state: LexerState): CodeToken[] {
	if (family === "diff") {
		return tokenizeDiffLine(line);
	}
	if (family === "markup") {
		return tokenizeMarkupLine(line, state);
	}
	if (family === "plain") {
		return line.length > 0 ? [{ kind: "plain", text: line }] : [];
	}

	const out: CodeToken[] = [];
	const len = line.length;
	let i = 0;

	if (state.inBlockComment) {
		const closeIdx = line.indexOf("*/", i);
		if (closeIdx < 0) {
			pushToken(out, "comment", line);
			return out;
		}
		pushToken(out, "comment", line.slice(0, closeIdx + 2));
		state.inBlockComment = false;
		i = closeIdx + 2;
	}

	if (state.tripleQuote.length > 0) {
		const endTriple = scanTripleQuotedString(line, i, state.tripleQuote, state);
		pushToken(out, "string", line.slice(i, endTriple));
		i = endTriple;
	}

	if (state.quoteChar.length > 0) {
		const endQ = scanQuotedString(line, i, state.quoteChar, state);
		pushToken(out, "string", line.slice(i, endQ));
		i = endQ;
	}

	let afterDot = false;
	const supportsSlashComments =
		family === "js" ||
		family === "rust" ||
		family === "go" ||
		family === "c_like" ||
		family === "css" ||
		family === "json";
	const supportsHashComments =
		family === "python" || family === "shell" || family === "yaml" || family === "toml";

	while (i < len) {
		const ch = line.charAt(i);
		const code = line.charCodeAt(i);

		if (ch === " " || ch === "\t") {
			let j = i + 1;
			while (j < len && (line.charAt(j) === " " || line.charAt(j) === "\t")) {
				j++;
			}
			pushToken(out, "plain", line.slice(i, j));
			i = j;
			continue;
		}

		if (supportsSlashComments && line.startsWith("//", i)) {
			pushToken(out, "comment", line.slice(i));
			break;
		}

		if (supportsSlashComments && line.startsWith("/*", i)) {
			const closeIdx = line.indexOf("*/", i + 2);
			if (closeIdx < 0) {
				pushToken(out, "comment", line.slice(i));
				state.inBlockComment = true;
				break;
			}
			pushToken(out, "comment", line.slice(i, closeIdx + 2));
			i = closeIdx + 2;
			afterDot = false;
			continue;
		}

		if (family === "sql" && line.startsWith("--", i)) {
			pushToken(out, "comment", line.slice(i));
			break;
		}

		if (supportsHashComments && ch === "#") {
			pushToken(out, "comment", line.slice(i));
			break;
		}

		if (family === "rust" && line.startsWith("#[", i)) {
			pushToken(out, "meta", "#");
			i++;
			afterDot = false;
			continue;
		}

		if ((family === "c_like" && ch === "#" && i === 0) || ch === "@") {
			let j = i + 1;
			while (j < len && isIdentPart(line.charCodeAt(j))) {
				j++;
			}
			pushToken(out, "meta", line.slice(i, j));
			i = j;
			afterDot = false;
			continue;
		}

		if (family === "python" && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
			const quote = line.slice(i, i + 3);
			const endT = scanTripleQuotedString(line, i + 3, quote, state);
			pushToken(out, "string", line.slice(i, endT));
			i = endT;
			afterDot = false;
			continue;
		}

		if (ch === '"' || ch === "'" || (ch === "`" && family !== "python")) {
			const endQ = scanQuotedString(line, i + 1, ch, state);
			pushToken(out, "string", line.slice(i, endQ));
			i = endQ;
			afterDot = false;
			continue;
		}

		if (isDigit(code)) {
			const endNum = scanNumberEnd(line, i);
			pushToken(out, "number", line.slice(i, endNum));
			i = endNum;
			afterDot = false;
			continue;
		}

		if (isIdentStart(code)) {
			let j = i + 1;
			while (j < len && isIdentPart(line.charCodeAt(j))) {
				j++;
			}
			const word = line.slice(i, j);
			const afterChar = j < len ? line.charCodeAt(j) : 0;
			let kind = classifyIdent(family, word, afterChar, afterDot);
			// Highlight object/map keys before `:` in JSON/YAML/TOML/CSS.
			if ((family === "yaml" || family === "toml" || family === "css") && afterChar === 58) {
				kind = "meta";
			}
			pushToken(out, kind, word);
			i = j;
			afterDot = false;
			continue;
		}

		afterDot = ch === "." || (ch === ":" && i + 1 < len && line.charAt(i + 1) === ":");
		pushToken(out, "plain", ch);
		i++;
	}

	return out;
}

/**
 * Tokenize multi-line source code into syntax-colored tokens per line.
 * Tracks multi-line block comments and strings across lines cleanly.
 */
export function tokenizeCodeLines(code: string, language: string): readonly (readonly CodeToken[])[] {
	const family = resolveLangFamily(language);
	const lines = code.split("\n");
	const state: LexerState = {
		inBlockComment: false,
		quoteChar: "",
		tripleQuote: "",
	};
	const result: CodeToken[][] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		result.push(tokenizeCodeLine(line, family, state));
	}
	return result;
}
