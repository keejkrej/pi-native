export interface LinePos {
  line: number;
  col: number;
}

export type ErrorCode =
  | "BAD_ALIAS"
  | "BAD_DIRECTIVE"
  | "BAD_DQ_ESCAPE"
  | "BAD_INDENT"
  | "BAD_SCALAR_START"
  | "DUPLICATE_KEY"
  | "MISSING_CHAR"
  | "MULTILINE_IMPLICIT_KEY"
  | "MULTIPLE_DOCS"
  | "NON_STRING_KEY"
  | "TAB_AS_INDENT"
  | "UNCLOSED_COMMENT"
  | "UNEXPECTED_TOKEN";

export class YAMLError extends Error {
  readonly code: string;
  readonly pos: [number, number];
  readonly linePos?: readonly LinePos[];

  constructor(
    name: "YAMLParseError" | "YAMLWarning",
    pos: [number, number],
    code: string,
    message: string,
    linePos?: readonly LinePos[]
  ) {
    super(message);
    this.name = name;
    this.code = code;
    this.pos = pos;
    this.linePos = linePos;
  }
}

export class YAMLParseError extends YAMLError {
  constructor(
    pos: [number, number],
    code: string,
    message: string,
    linePos?: readonly LinePos[]
  ) {
    super("YAMLParseError", pos, code, message, linePos);
  }
}

export interface ParseOptions {
  strict?: boolean;
  uniqueKeys?: boolean;
  maxAliasCount?: number;
  intAsBigInt?: boolean;
  prettyErrors?: boolean;
  schema?: "core" | "json" | "failsafe" | string;
}

export interface StringifyOptions {
  indent?: number;
  lineWidth?: number;
  sortMapEntries?: boolean;
  defaultStringType?: "PLAIN" | "QUOTE_SINGLE" | "QUOTE_DOUBLE";
  singleQuote?: boolean | null;
}

type YamlPrimitive = string | number | boolean | bigint | null;
type YamlValue = YamlPrimitive | YamlValue[] | { [key: string]: YamlValue };

interface ParserState {
  readonly src: string;
  readonly len: number;
  readonly lineStarts: number[];
  readonly anchors: Map<string, YamlValue>;
  readonly uniqueKeys: boolean;
  readonly schema: string;
  readonly maxAliasCount: number;
  aliasCount: number;
}

function normalizeEol(input: string): string {
  if (input.indexOf("\r") === -1) {
    return input;
  }
  return input.replace(/\r\n?/g, "\n");
}

function buildLineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineColAt(lineStarts: readonly number[], offset: number): LinePos {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lineIdx = Math.max(0, hi);
  return {
    line: lineIdx + 1,
    col: offset - lineStarts[lineIdx] + 1,
  };
}

function makeParseError(
  state: ParserState,
  offset: number,
  code: string,
  reason: string,
  endOffset?: number
): YAMLParseError {
  const clamped = Math.max(0, Math.min(offset, state.len));
  const startPos = lineColAt(state.lineStarts, clamped);
  const endPos =
    endOffset !== undefined
      ? lineColAt(state.lineStarts, Math.max(clamped, Math.min(endOffset, state.len)))
      : undefined;
  const lineStartOffset = state.lineStarts[startPos.line - 1] ?? 0;
  let lineEndOffset = state.src.indexOf("\n", lineStartOffset);
  if (lineEndOffset === -1) {
    lineEndOffset = state.len;
  }
  const lineText = state.src.slice(lineStartOffset, lineEndOffset);
  const caret = " ".repeat(Math.max(0, startPos.col - 1)) + "^";
  const fullMessage = `${reason} at line ${startPos.line}, column ${startPos.col}:\n\n${lineText}\n${caret}\n`;
  const lineTuple: readonly LinePos[] = endPos ? [startPos, endPos] : [startPos];
  return new YAMLParseError(
    [clamped, endOffset ?? clamped],
    code,
    fullMessage,
    lineTuple
  );
}

function isSpaceOrTab(ch: number): boolean {
  return ch === 32 || ch === 9;
}

function isWhitespace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === 10;
}

function isHexDigit(ch: number): boolean {
  return (
    (ch >= 48 && ch <= 57) ||
    (ch >= 65 && ch <= 70) ||
    (ch >= 97 && ch <= 102)
  );
}

function isFlowIndicator(ch: number): boolean {
  return (
    ch === 44 || // ,
    ch === 91 || // [
    ch === 93 || // ]
    ch === 123 || // {
    ch === 125 // }
  );
}

function findLineEnd(src: string, offset: number): number {
  const nl = src.indexOf("\n", offset);
  return nl === -1 ? src.length : nl;
}

function skipHorizontalSpaces(src: string, offset: number, limit: number): number {
  let i = offset;
  while (i < limit && isSpaceOrTab(src.charCodeAt(i))) {
    i++;
  }
  return i;
}

function skipCommentToEol(src: string, offset: number): number {
  let i = offset;
  while (i < src.length && src.charCodeAt(i) !== 10) {
    i++;
  }
  return i;
}

function skipEmptyAndComments(state: ParserState, offset: number): number {
  const { src, len } = state;
  let i = offset;
  while (i < len) {
    const ch = src.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 10) {
      i++;
      continue;
    }
    if (ch === 35) {
      i = skipCommentToEol(src, i);
      continue;
    }
    break;
  }
  return i;
}

function measureLineIndent(state: ParserState, lineStart: number): {
  indent: number;
  firstNonSpace: number;
  isBlankOrComment: boolean;
} {
  const { src, len } = state;
  let i = lineStart;
  while (i < len) {
    const ch = src.charCodeAt(i);
    if (ch === 32) {
      i++;
    } else if (ch === 9) {
      throw makeParseError(
        state,
        i,
        "TAB_AS_INDENT",
        "Tabs are not allowed as indentation"
      );
    } else {
      break;
    }
  }
  const ch = i < len ? src.charCodeAt(i) : -1;
  const isBlankOrComment = ch === -1 || ch === 10 || ch === 35;
  return {
    indent: i - lineStart,
    firstNonSpace: i,
    isBlankOrComment,
  };
}

function isDocBoundaryAtLine(src: string, lineStart: number, marker: string): boolean {
  if (!src.startsWith(marker, lineStart)) {
    return false;
  }
  const after = lineStart + marker.length;
  if (after >= src.length) {
    return true;
  }
  const ch = src.charCodeAt(after);
  return ch === 10 || ch === 32 || ch === 9;
}

function resolvePlainScalar(raw: string, schema: string): YamlPrimitive {
  if (schema === "failsafe") {
    return raw;
  }
  if (
    raw === "" ||
    raw === "null" ||
    raw === "Null" ||
    raw === "NULL" ||
    raw === "~"
  ) {
    return null;
  }
  if (raw === "true" || raw === "True" || raw === "TRUE") {
    return true;
  }
  if (raw === "false" || raw === "False" || raw === "FALSE") {
    return false;
  }
  if (schema === "json") {
    if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) {
      return Number(raw);
    }
    return raw;
  }
  // YAML 1.2 Core schema numbers
  if (/^[-+]?[0-9]+$/.test(raw)) {
    return Number(raw);
  }
  if (/^0o[0-7]+$/.test(raw)) {
    return Number.parseInt(raw.slice(2), 8);
  }
  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    return Number.parseInt(raw.slice(2), 16);
  }
  if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(raw)) {
    return Number(raw);
  }
  if (/^[+]?\.(?:inf|Inf|INF)$/.test(raw)) {
    return Infinity;
  }
  if (/^-\.(?:inf|Inf|INF)$/.test(raw)) {
    return -Infinity;
  }
  if (/^\.(?:nan|NaN|NAN)$/.test(raw)) {
    return Number.NaN;
  }
  return raw;
}

function yamlValueToString(state: ParserState, value: YamlValue, offset: number): string {
  if (value === null) {
    return "";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return `${value}`;
  }
  throw makeParseError(state, offset, "UNEXPECTED_TOKEN", "Expected scalar value for tag");
}

function applyTag(
  state: ParserState,
  tag: string,
  value: YamlValue,
  offset: number
): YamlValue {
  switch (tag) {
    case "!!str":
    case "tag:yaml.org,2002:str":
      return yamlValueToString(state, value, offset);
    case "!!null":
    case "tag:yaml.org,2002:null":
      return null;
    case "!!bool":
    case "tag:yaml.org,2002:bool":
      if (typeof value === "boolean") {
        return value;
      }
      if (value === "true" || value === "True" || value === "TRUE") {
        return true;
      }
      if (value === "false" || value === "False" || value === "FALSE") {
        return false;
      }
      return Boolean(value);
    case "!!int":
    case "tag:yaml.org,2002:int": {
      if (typeof value === "number") {
        return Math.trunc(value);
      }
      const str = yamlValueToString(state, value, offset);
      const n = resolvePlainScalar(str, "core");
      if (typeof n === "number") {
        return Math.trunc(n);
      }
      throw makeParseError(state, offset, "UNEXPECTED_TOKEN", `Invalid !!int value: ${str}`);
    }
    case "!!float":
    case "tag:yaml.org,2002:float": {
      if (typeof value === "number") {
        return value;
      }
      const str = yamlValueToString(state, value, offset);
      const n = resolvePlainScalar(str, "core");
      if (typeof n === "number") {
        return n;
      }
      throw makeParseError(state, offset, "UNEXPECTED_TOKEN", `Invalid !!float value: ${str}`);
    }
    default:
      return value;
  }
}

function parseSingleQuoted(
  state: ParserState,
  startOffset: number
): { value: string; nextOffset: number } {
  const { src, len } = state;
  let i = startOffset + 1;
  let out = "";

  while (i < len) {
    const ch = src.charCodeAt(i);
    if (ch === 39) {
      if (i + 1 < len && src.charCodeAt(i + 1) === 39) {
        out += "'";
        i += 2;
        continue;
      }
      return { value: out, nextOffset: i + 1 };
    }
    if (ch === 10) {
      // Fold newlines in multiline single-quoted scalars per YAML 1.2
      out = out.replace(/[ \t]+$/, "");
      let blankLines = 0;
      i++;
      while (i < len) {
        while (i < len && isSpaceOrTab(src.charCodeAt(i))) {
          i++;
        }
        if (i < len && src.charCodeAt(i) === 10) {
          blankLines++;
          i++;
        } else {
          break;
        }
      }
      out += blankLines > 0 ? "\n".repeat(blankLines) : " ";
      continue;
    }
    out += src[i];
    i++;
  }

  throw makeParseError(
    state,
    len,
    "MISSING_CHAR",
    "Missing closing 'quote"
  );
}

function parseDoubleQuoted(
  state: ParserState,
  startOffset: number
): { value: string; nextOffset: number } {
  const { src, len } = state;
  let i = startOffset + 1;
  let out = "";

  while (i < len) {
    const ch = src.charCodeAt(i);
    if (ch === 34) {
      return { value: out, nextOffset: i + 1 };
    }
    if (ch === 92) {
      i++;
      if (i >= len) {
        throw makeParseError(
          state,
          len,
          "BAD_DQ_ESCAPE",
          "Incomplete escape sequence in double-quoted string"
        );
      }
      const esc = src[i];
      i++;
      switch (esc) {
        case "0":
          out += "\0";
          break;
        case "a":
          out += "\x07";
          break;
        case "b":
          out += "\b";
          break;
        case "t":
        case "\t":
          out += "\t";
          break;
        case "n":
          out += "\n";
          break;
        case "v":
          out += "\v";
          break;
        case "f":
          out += "\f";
          break;
        case "r":
          out += "\r";
          break;
        case "e":
          out += "\x1b";
          break;
        case " ":
          out += " ";
          break;
        case '"':
          out += '"';
          break;
        case "/":
          out += "/";
          break;
        case "\\":
          out += "\\";
          break;
        case "N":
          out += "\u0085";
          break;
        case "_":
          out += "\u00a0";
          break;
        case "L":
          out += "\u2028";
          break;
        case "P":
          out += "\u2029";
          break;
        case "x": {
          const hex = src.slice(i, i + 2);
          if (hex.length < 2 || !isHexDigit(hex.charCodeAt(0)) || !isHexDigit(hex.charCodeAt(1))) {
            throw makeParseError(state, i - 2, "BAD_DQ_ESCAPE", `Invalid \\x escape: \\x${hex}`);
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 2;
          break;
        }
        case "u": {
          const hex = src.slice(i, i + 4);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw makeParseError(state, i - 2, "BAD_DQ_ESCAPE", `Invalid \\u escape: \\u${hex}`);
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
          break;
        }
        case "U": {
          const hex = src.slice(i, i + 8);
          if (hex.length < 8 || !/^[0-9a-fA-F]{8}$/.test(hex)) {
            throw makeParseError(state, i - 2, "BAD_DQ_ESCAPE", `Invalid \\U escape: \\U${hex}`);
          }
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          i += 8;
          break;
        }
        case "\n": {
          while (i < len && isSpaceOrTab(src.charCodeAt(i))) {
            i++;
          }
          break;
        }
        default:
          throw makeParseError(
            state,
            i - 2,
            "BAD_DQ_ESCAPE",
            `Invalid escape sequence \\${esc}`
          );
      }
      continue;
    }
    if (ch === 10) {
      out = out.replace(/[ \t]+$/, "");
      let blankLines = 0;
      i++;
      while (i < len) {
        while (i < len && isSpaceOrTab(src.charCodeAt(i))) {
          i++;
        }
        if (i < len && src.charCodeAt(i) === 10) {
          blankLines++;
          i++;
        } else {
          break;
        }
      }
      out += blankLines > 0 ? "\n".repeat(blankLines) : " ";
      continue;
    }
    out += src[i];
    i++;
  }

  throw makeParseError(
    state,
    len,
    "MISSING_CHAR",
    'Missing closing "quote'
  );
}

function readDecoratorPrefix(
  state: ParserState,
  startOffset: number,
  isFlow: boolean
): {
  anchor: string | undefined;
  tag: string | undefined;
  nextOffset: number;
} {
  const { src, len } = state;
  let i = startOffset;
  let anchor: string | undefined;
  let tag: string | undefined;

  for (let pass = 0; pass < 2; pass++) {
    i = isFlow ? skipEmptyAndComments(state, i) : skipHorizontalSpaces(src, i, findLineEnd(src, i));
    if (i >= len) {
      break;
    }
    const ch = src.charCodeAt(i);
    if (ch === 38 && anchor === undefined) {
      // &anchor
      const start = i + 1;
      let end = start;
      while (end < len) {
        const c = src.charCodeAt(end);
        if (isWhitespace(c) || isFlowIndicator(c)) {
          break;
        }
        end++;
      }
      if (end === start) {
        throw makeParseError(state, i, "UNEXPECTED_TOKEN", "Empty anchor name");
      }
      anchor = src.slice(start, end);
      i = end;
      continue;
    }
    if (ch === 33 && tag === undefined) {
      // !tag or !!tag
      const start = i;
      let end = start + 1;
      while (end < len) {
        const c = src.charCodeAt(end);
        if (isWhitespace(c) || (isFlow && isFlowIndicator(c))) {
          break;
        }
        end++;
      }
      tag = src.slice(start, end);
      i = end;
      continue;
    }
    break;
  }

  return { anchor, tag, nextOffset: i };
}

function parseFlowPlainScalar(
  state: ParserState,
  startOffset: number
): { raw: string; nextOffset: number } {
  const { src, len } = state;
  let i = startOffset;
  let out = "";
  let lineSegment = "";

  while (i < len) {
    const ch = src.charCodeAt(i);
    if (isFlowIndicator(ch)) {
      break;
    }
    if (ch === 35 && lineSegment.length > 0 && isSpaceOrTab(src.charCodeAt(i - 1))) {
      break;
    }
    if (ch === 58) {
      const next = i + 1 < len ? src.charCodeAt(i + 1) : -1;
      if (next === -1 || isWhitespace(next) || isFlowIndicator(next)) {
        break;
      }
    }
    if (ch === 10) {
      out += lineSegment.replace(/[ \t]+$/, "");
      lineSegment = "";
      let j = i + 1;
      let blankLines = 0;
      while (j < len) {
        while (j < len && isSpaceOrTab(src.charCodeAt(j))) {
          j++;
        }
        if (j < len && src.charCodeAt(j) === 10) {
          blankLines++;
          j++;
        } else {
          break;
        }
      }
      if (j >= len) {
        i = j;
        break;
      }
      const nextCh = src.charCodeAt(j);
      if (isFlowIndicator(nextCh) || nextCh === 35) {
        i = j;
        break;
      }
      out += blankLines > 0 ? "\n".repeat(blankLines) : " ";
      i = j;
      continue;
    }
    lineSegment += src[i];
    i++;
  }

  out += lineSegment.replace(/[ \t]+$/, "");
  return { raw: out.trimEnd(), nextOffset: i };
}

function parseFlowNode(
  state: ParserState,
  startOffset: number
): { value: YamlValue; nextOffset: number } {
  const deco = readDecoratorPrefix(state, startOffset, true);
  let i = skipEmptyAndComments(state, deco.nextOffset);

  if (i >= state.len) {
    const emptyVal: YamlValue = deco.tag ? applyTag(state, deco.tag, "", i) : null;
    if (deco.anchor !== undefined) {
      state.anchors.set(deco.anchor, emptyVal);
    }
    return { value: emptyVal, nextOffset: i };
  }

  const ch = state.src.charCodeAt(i);
  let value: YamlValue;
  let nextOffset: number;

  if (ch === 91) {
    const seq = parseFlowSequence(state, i);
    value = seq.value;
    nextOffset = seq.nextOffset;
  } else if (ch === 123) {
    const map = parseFlowMapping(state, i);
    value = map.value;
    nextOffset = map.nextOffset;
  } else if (ch === 34) {
    const dq = parseDoubleQuoted(state, i);
    value = dq.value;
    nextOffset = dq.nextOffset;
  } else if (ch === 39) {
    const sq = parseSingleQuoted(state, i);
    value = sq.value;
    nextOffset = sq.nextOffset;
  } else if (ch === 42) {
    const alias = parseAlias(state, i, true);
    value = alias.value;
    nextOffset = alias.nextOffset;
  } else {
    const plain = parseFlowPlainScalar(state, i);
    value = resolvePlainScalar(plain.raw, state.schema);
    nextOffset = plain.nextOffset;
  }

  if (deco.tag) {
    value = applyTag(state, deco.tag, value, i);
  }
  if (deco.anchor !== undefined) {
    state.anchors.set(deco.anchor, value);
  }
  return { value, nextOffset };
}

function parseAlias(
  state: ParserState,
  startOffset: number,
  isFlow: boolean
): { value: YamlValue; nextOffset: number } {
  const { src, len } = state;
  let end = startOffset + 1;
  while (end < len) {
    const ch = src.charCodeAt(end);
    if (isWhitespace(ch) || (isFlow && isFlowIndicator(ch))) {
      break;
    }
    end++;
  }
  const name = src.slice(startOffset + 1, end);
  if (!name) {
    throw makeParseError(state, startOffset, "BAD_ALIAS", "Empty alias name");
  }
  if (!state.anchors.has(name)) {
    throw makeParseError(state, startOffset, "BAD_ALIAS", `Alias *${name} not found`);
  }
  state.aliasCount++;
  if (state.aliasCount > state.maxAliasCount) {
    throw makeParseError(
      state,
      startOffset,
      "BAD_ALIAS",
      `Exceeded max alias expansion limit (${state.maxAliasCount})`
    );
  }
  return {
    value: state.anchors.get(name) ?? null,
    nextOffset: end,
  };
}

function parseFlowSequence(
  state: ParserState,
  startOffset: number
): { value: YamlValue[]; nextOffset: number } {
  const { src, len } = state;
  const items: YamlValue[] = [];
  let i = startOffset + 1;

  for (;;) {
    i = skipEmptyAndComments(state, i);
    if (i >= len) {
      throw makeParseError(
        state,
        len,
        "MISSING_CHAR",
        "Flow sequence in block collection must be sufficiently indented and end with a ]"
      );
    }
    const ch = src.charCodeAt(i);
    if (ch === 93) {
      return { value: items, nextOffset: i + 1 };
    }
    if (ch === 44) {
      throw makeParseError(state, i, "UNEXPECTED_TOKEN", "Unexpected , in flow sequence");
    }
    if (ch === 125) {
      throw makeParseError(state, i, "UNEXPECTED_TOKEN", "Unexpected } in flow sequence");
    }

    const node = parseFlowNode(state, i);
    let itemValue = node.value;
    let afterItem = skipEmptyAndComments(state, node.nextOffset);

    // Handle flow pair syntax `[a: 1, b: 2]`
    if (
      afterItem < len &&
      src.charCodeAt(afterItem) === 58 &&
      (afterItem + 1 >= len ||
        isWhitespace(src.charCodeAt(afterItem + 1)) ||
        isFlowIndicator(src.charCodeAt(afterItem + 1)))
    ) {
      const keyStr = toMappingKeyString(state, itemValue, i);
      const valStart = skipEmptyAndComments(state, afterItem + 1);
      const nextCh = valStart < len ? src.charCodeAt(valStart) : -1;
      let pairVal: YamlValue = null;
      if (nextCh !== 44 && nextCh !== 93 && nextCh !== -1) {
        const valNode = parseFlowNode(state, valStart);
        pairVal = valNode.value;
        afterItem = skipEmptyAndComments(state, valNode.nextOffset);
      } else {
        afterItem = valStart;
      }
      itemValue = Object.fromEntries([[keyStr, pairVal]]);
    }

    items.push(itemValue);
    i = afterItem;
    if (i >= len) {
      throw makeParseError(
        state,
        len,
        "MISSING_CHAR",
        "Flow sequence must end with a ]"
      );
    }
    const sep = src.charCodeAt(i);
    if (sep === 44) {
      i++;
      continue;
    }
    if (sep === 93) {
      return { value: items, nextOffset: i + 1 };
    }
    throw makeParseError(
      state,
      i,
      "MISSING_CHAR",
      "Expected , or ] in flow sequence"
    );
  }
}

function toMappingKeyString(
  state: ParserState,
  key: YamlValue,
  offset: number
): string {
  if (key === null) {
    return "";
  }
  if (typeof key === "string") {
    return key;
  }
  if (typeof key === "number" || typeof key === "boolean" || typeof key === "bigint") {
    return `${key}`;
  }
  throw makeParseError(
    state,
    offset,
    "NON_STRING_KEY",
    "Mapping keys must be scalar values"
  );
}

function applyMergeKey(
  entries: Array<[string, YamlValue]>,
  seenKeys: Set<string>,
  mergeSource: YamlValue
): void {
  const sources = Array.isArray(mergeSource) ? mergeSource : [mergeSource];
  for (const item of sources) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as { [k: string]: YamlValue };
      for (const key of Object.keys(obj)) {
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          entries.push([key, obj[key]]);
        }
      }
    }
  }
}

function parseFlowMapping(
  state: ParserState,
  startOffset: number
): { value: { [key: string]: YamlValue }; nextOffset: number } {
  const { src, len } = state;
  const entries: Array<[string, YamlValue]> = [];
  const seenKeys = new Set<string>();
  const explicitKeys = new Set<string>();
  const pendingMerges: YamlValue[] = [];
  let i = startOffset + 1;

  for (;;) {
    i = skipEmptyAndComments(state, i);
    if (i >= len) {
      throw makeParseError(
        state,
        len,
        "MISSING_CHAR",
        "Flow mapping must end with a }"
      );
    }
    const ch = src.charCodeAt(i);
    if (ch === 125) {
      for (const mergeSrc of pendingMerges) {
        applyMergeKey(entries, seenKeys, mergeSrc);
      }
      return { value: Object.fromEntries(entries), nextOffset: i + 1 };
    }
    if (ch === 44) {
      throw makeParseError(state, i, "UNEXPECTED_TOKEN", "Unexpected , in flow mapping");
    }
    if (ch === 93) {
      throw makeParseError(state, i, "UNEXPECTED_TOKEN", "Unexpected ] in flow mapping");
    }

    const keyOffset = i;
    if (ch === 63 && (i + 1 >= len || isWhitespace(src.charCodeAt(i + 1)))) {
      i = skipEmptyAndComments(state, i + 1);
    }
    const keyNode = parseFlowNode(state, i);
    const keyStr = toMappingKeyString(state, keyNode.value, keyOffset);
    i = skipEmptyAndComments(state, keyNode.nextOffset);

    let val: YamlValue = null;
    if (
      i < len &&
      src.charCodeAt(i) === 58 &&
      (i + 1 >= len || isWhitespace(src.charCodeAt(i + 1)) || isFlowIndicator(src.charCodeAt(i + 1)))
    ) {
      i = skipEmptyAndComments(state, i + 1);
      const nextCh = i < len ? src.charCodeAt(i) : -1;
      if (nextCh !== 44 && nextCh !== 125 && nextCh !== -1) {
        const valNode = parseFlowNode(state, i);
        val = valNode.value;
        i = skipEmptyAndComments(state, valNode.nextOffset);
      }
    }

    if (keyStr === "<<") {
      pendingMerges.push(val);
    } else {
      if (state.uniqueKeys && explicitKeys.has(keyStr)) {
        throw makeParseError(
          state,
          keyOffset,
          "DUPLICATE_KEY",
          `Map keys must be unique: ${keyStr}`
        );
      }
      explicitKeys.add(keyStr);
      seenKeys.add(keyStr);
      entries.push([keyStr, val]);
    }

    if (i >= len) {
      throw makeParseError(
        state,
        len,
        "MISSING_CHAR",
        "Flow mapping must end with a }"
      );
    }
    const sep = src.charCodeAt(i);
    if (sep === 44) {
      i++;
      continue;
    }
    if (sep === 125) {
      for (const mergeSrc of pendingMerges) {
        applyMergeKey(entries, seenKeys, mergeSrc);
      }
      return { value: Object.fromEntries(entries), nextOffset: i + 1 };
    }
    throw makeParseError(
      state,
      i,
      "MISSING_CHAR",
      "Expected , or } in flow mapping"
    );
  }
}

function consumeTrailingInlineComment(
  state: ParserState,
  offset: number
): number {
  const { src, len } = state;
  const lineEnd = findLineEnd(src, offset);
  const afterSpaces = skipHorizontalSpaces(src, offset, lineEnd);
  if (afterSpaces >= lineEnd) {
    return afterSpaces < len && src.charCodeAt(afterSpaces) === 10
      ? afterSpaces + 1
      : afterSpaces;
  }
  if (src.charCodeAt(afterSpaces) === 35) {
    if (afterSpaces === offset && offset > 0 && !isSpaceOrTab(src.charCodeAt(offset - 1))) {
      throw makeParseError(
        state,
        afterSpaces,
        "UNEXPECTED_TOKEN",
        "Expected whitespace before comment"
      );
    }
    return lineEnd < len && src.charCodeAt(lineEnd) === 10
      ? lineEnd + 1
      : lineEnd;
  }
  throw makeParseError(
    state,
    afterSpaces,
    "UNEXPECTED_TOKEN",
    "Unexpected trailing content on line"
  );
}

function parseBlockScalar(
  state: ParserState,
  headerOffset: number,
  parentIndent: number
): { value: string; nextOffset: number } {
  const { src, len } = state;
  const styleChar = src[headerOffset];
  const isFolded = styleChar === ">";
  const lineEnd = findLineEnd(src, headerOffset);

  let chomp: "clip" | "strip" | "keep" = "clip";
  let explicitIndent = 0;
  let i = headerOffset + 1;

  while (i < lineEnd) {
    const ch = src.charCodeAt(i);
    if (ch === 45 && chomp === "clip") {
      chomp = "strip";
      i++;
    } else if (ch === 43 && chomp === "clip") {
      chomp = "keep";
      i++;
    } else if (ch >= 49 && ch <= 57 && explicitIndent === 0) {
      explicitIndent = ch - 48;
      i++;
    } else if (isSpaceOrTab(ch) || ch === 35) {
      break;
    } else {
      throw makeParseError(
        state,
        i,
        "BAD_SCALAR_START",
        `Invalid block scalar header character: ${src[i]}`
      );
    }
  }

  let cursor = consumeTrailingInlineComment(state, i);
  if (cursor < lineEnd) {
    cursor = lineEnd < len ? lineEnd + 1 : len;
  }

  let blockIndent = explicitIndent > 0 ? Math.max(0, parentIndent) + explicitIndent : -1;
  const collected: Array<{ isBlank: boolean; indent: number; text: string }> = [];

  while (cursor < len) {
    const lineStart = cursor;
    const end = findLineEnd(src, lineStart);
    if (
      isDocBoundaryAtLine(src, lineStart, "---") ||
      isDocBoundaryAtLine(src, lineStart, "...")
    ) {
      break;
    }

    let spaces = 0;
    while (lineStart + spaces < end && src.charCodeAt(lineStart + spaces) === 32) {
      spaces++;
    }
    const isWhitespaceOnly = lineStart + spaces === end;

    if (isWhitespaceOnly) {
      collected.push({
        isBlank: true,
        indent: spaces,
        text: blockIndent > 0 && spaces > blockIndent ? src.slice(lineStart + blockIndent, end) : "",
      });
      cursor = end < len ? end + 1 : end;
      continue;
    }

    if (blockIndent === -1) {
      const minIndent = parentIndent < 0 ? 0 : parentIndent + 1;
      if (spaces < minIndent && spaces === 0 && parentIndent >= 0) {
        break;
      }
      blockIndent = spaces;
    }

    if (spaces < blockIndent) {
      break;
    }

    collected.push({
      isBlank: false,
      indent: spaces,
      text: src.slice(lineStart + blockIndent, end),
    });
    cursor = end < len ? end + 1 : end;
  }

  // Drop leading blank lines if nothing non-blank ever followed, wait:
  // If entire block is blank lines:
  let lastNonBlank = -1;
  for (let idx = collected.length - 1; idx >= 0; idx--) {
    if (!collected[idx].isBlank) {
      lastNonBlank = idx;
      break;
    }
  }

  if (lastNonBlank === -1) {
    if (chomp === "keep") {
      return {
        value: "\n".repeat(collected.length),
        nextOffset: cursor,
      };
    }
    return { value: "", nextOffset: cursor };
  }

  const contentLines = collected.slice(0, lastNonBlank + 1);
  const trailingBlankCount = collected.length - 1 - lastNonBlank;

  let text = "";
  if (!isFolded) {
    const parts: string[] = [];
    for (const item of contentLines) {
      parts.push(item.text);
    }
    text = parts.join("\n");
  } else {
    let idx = 0;
    while (idx < contentLines.length) {
      const cur = contentLines[idx];
      if (cur.isBlank) {
        text += cur.text + "\n";
        idx++;
        continue;
      }
      const isMoreIndented = cur.indent > blockIndent;
      text += cur.text;
      if (idx === contentLines.length - 1) {
        break;
      }
      const next = contentLines[idx + 1];
      if (next.isBlank) {
        let blankIdx = idx + 1;
        while (blankIdx < contentLines.length && contentLines[blankIdx].isBlank) {
          text += "\n";
          blankIdx++;
        }
        idx = blankIdx;
        continue;
      }
      if (isMoreIndented || next.indent > blockIndent) {
        text += "\n";
      } else {
        text += " ";
      }
      idx++;
    }
  }

  if (chomp === "strip") {
    return { value: text, nextOffset: cursor };
  }
  if (chomp === "keep") {
    return {
      value: text + "\n" + "\n".repeat(trailingBlankCount),
      nextOffset: cursor,
    };
  }
  return { value: text + "\n", nextOffset: cursor };
}

function findBlockMappingColon(src: string, start: number, lineEnd: number): number {
  for (let i = start; i < lineEnd; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 35 && i > start && isSpaceOrTab(src.charCodeAt(i - 1))) {
      return -1;
    }
    if (ch === 58) {
      const next = i + 1 < lineEnd ? src.charCodeAt(i + 1) : -1;
      if (next === -1 || isSpaceOrTab(next)) {
        return i;
      }
    }
  }
  return -1;
}

function stripInlineCommentAndSpaces(src: string, start: number, lineEnd: number): number {
  let end = lineEnd;
  for (let i = start; i < lineEnd; i++) {
    if (src.charCodeAt(i) === 35 && (i === start || isSpaceOrTab(src.charCodeAt(i - 1)))) {
      end = i;
      break;
    }
  }
  while (end > start && isSpaceOrTab(src.charCodeAt(end - 1))) {
    end--;
  }
  return end;
}

function parseBlockPlainScalar(
  state: ParserState,
  startOffset: number,
  minContinuationIndent: number
): { raw: string; nextOffset: number } {
  const { src, len } = state;
  const firstEnd = findLineEnd(src, startOffset);
  const trimmedFirstEnd = stripInlineCommentAndSpaces(src, startOffset, firstEnd);
  let text = src.slice(startOffset, trimmedFirstEnd);
  let hadComment = trimmedFirstEnd < firstEnd && src.indexOf("#", trimmedFirstEnd) !== -1;
  let cursor = firstEnd < len ? firstEnd + 1 : firstEnd;

  if (hadComment) {
    return { raw: text, nextOffset: cursor };
  }

  while (cursor < len) {
    const lineStart = cursor;
    if (
      isDocBoundaryAtLine(src, lineStart, "---") ||
      isDocBoundaryAtLine(src, lineStart, "...")
    ) {
      break;
    }
    const lineEnd = findLineEnd(src, lineStart);
    const info = measureLineIndent(state, lineStart);
    if (info.isBlankOrComment) {
      // Peek ahead to see if blank lines continue into another plain scalar line
      let lookAhead = lineEnd < len ? lineEnd + 1 : lineEnd;
      let blankCount = 1;
      let nextLineInfo = { indent: 0, firstNonSpace: lookAhead, isBlankOrComment: true };
      let foundNonBlank = false;
      while (lookAhead < len) {
        if (
          isDocBoundaryAtLine(src, lookAhead, "---") ||
          isDocBoundaryAtLine(src, lookAhead, "...")
        ) {
          break;
        }
        const aheadEnd = findLineEnd(src, lookAhead);
        const aheadInfo = measureLineIndent(state, lookAhead);
        if (aheadInfo.isBlankOrComment) {
          if (aheadInfo.firstNonSpace < aheadEnd && src.charCodeAt(aheadInfo.firstNonSpace) === 35) {
            break;
          }
          blankCount++;
          lookAhead = aheadEnd < len ? aheadEnd + 1 : aheadEnd;
          continue;
        }
        nextLineInfo = aheadInfo;
        foundNonBlank = true;
        break;
      }
      if (!foundNonBlank || nextLineInfo.indent < minContinuationIndent) {
        break;
      }
      const nextCh = src.charCodeAt(nextLineInfo.firstNonSpace);
      const nextAfter = nextLineInfo.firstNonSpace + 1;
      if (
        (nextCh === 45 && (nextAfter >= len || isWhitespace(src.charCodeAt(nextAfter)))) ||
        findBlockMappingColon(src, nextLineInfo.firstNonSpace, findLineEnd(src, lookAhead)) !== -1
      ) {
        break;
      }
      text += "\n".repeat(blankCount);
      const contEnd = findLineEnd(src, lookAhead);
      const contTrimmedEnd = stripInlineCommentAndSpaces(src, nextLineInfo.firstNonSpace, contEnd);
      text += src.slice(nextLineInfo.firstNonSpace, contTrimmedEnd);
      cursor = contEnd < len ? contEnd + 1 : contEnd;
      if (contTrimmedEnd < contEnd && src.indexOf("#", contTrimmedEnd) !== -1) {
        break;
      }
      continue;
    }

    if (info.indent < minContinuationIndent) {
      break;
    }
    const ch = src.charCodeAt(info.firstNonSpace);
    const after = info.firstNonSpace + 1;
    if (
      (ch === 45 && (after >= len || isWhitespace(src.charCodeAt(after)))) ||
      findBlockMappingColon(src, info.firstNonSpace, lineEnd) !== -1
    ) {
      break;
    }
    const trimmedEnd = stripInlineCommentAndSpaces(src, info.firstNonSpace, lineEnd);
    text += " " + src.slice(info.firstNonSpace, trimmedEnd);
    cursor = lineEnd < len ? lineEnd + 1 : lineEnd;
    if (trimmedEnd < lineEnd && src.indexOf("#", trimmedEnd) !== -1) {
      break;
    }
  }

  return { raw: text, nextOffset: cursor };
}

function advanceToNextNonBlankLine(state: ParserState, offset: number): number {
  const { src, len } = state;
  let i = offset;
  while (i < len) {
    const end = findLineEnd(src, i);
    const info = measureLineIndent(state, i);
    if (info.isBlankOrComment) {
      i = end < len ? end + 1 : end;
      continue;
    }
    return i;
  }
  return len;
}

function parseBlockValueOnSameLineOrNested(
  state: ParserState,
  startOffset: number,
  parentIndent: number,
  allowSameIndentSeq: boolean
): { value: YamlValue; nextOffset: number } {
  const { src, len } = state;
  const lineEnd = findLineEnd(src, startOffset);
  const deco = readDecoratorPrefix(state, startOffset, false);
  const i = skipHorizontalSpaces(src, deco.nextOffset, lineEnd);

  let value: YamlValue;
  let nextOffset: number;

  if (i >= lineEnd || src.charCodeAt(i) === 35) {
    // Nested block on following line
    const nextLineStart = advanceToNextNonBlankLine(
      state,
      lineEnd < len ? lineEnd + 1 : lineEnd
    );
    if (
      nextLineStart >= len ||
      isDocBoundaryAtLine(src, nextLineStart, "---") ||
      isDocBoundaryAtLine(src, nextLineStart, "...")
    ) {
      value = null;
      nextOffset = nextLineStart;
    } else {
      const nextInfo = measureLineIndent(state, nextLineStart);
      const ch = src.charCodeAt(nextInfo.firstNonSpace);
      const after = nextInfo.firstNonSpace + 1;
      const isSeqDash =
        ch === 45 && (after >= len || isWhitespace(src.charCodeAt(after)));
      const minRequired =
        allowSameIndentSeq && isSeqDash ? parentIndent : parentIndent + 1;
      if (nextInfo.indent < minRequired) {
        value = null;
        nextOffset = nextLineStart;
      } else {
        const nested = parseBlockNode(state, nextLineStart, parentIndent);
        value = nested.value;
        nextOffset = nested.nextOffset;
      }
    }
  } else {
    const ch = src.charCodeAt(i);
    if (ch === 124 || ch === 62) {
      const blk = parseBlockScalar(state, i, parentIndent);
      value = blk.value;
      nextOffset = blk.nextOffset;
    } else if (ch === 91 || ch === 123) {
      const flow = parseFlowNode(state, i);
      value = flow.value;
      nextOffset = consumeTrailingInlineComment(state, flow.nextOffset);
    } else if (ch === 34) {
      const dq = parseDoubleQuoted(state, i);
      value = dq.value;
      nextOffset = consumeTrailingInlineComment(state, dq.nextOffset);
    } else if (ch === 39) {
      const sq = parseSingleQuoted(state, i);
      value = sq.value;
      nextOffset = consumeTrailingInlineComment(state, sq.nextOffset);
    } else if (ch === 42) {
      const alias = parseAlias(state, i, false);
      value = alias.value;
      nextOffset = consumeTrailingInlineComment(state, alias.nextOffset);
    } else {
      const plain = parseBlockPlainScalar(state, i, parentIndent + 1);
      value = resolvePlainScalar(plain.raw, state.schema);
      nextOffset = plain.nextOffset;
    }
  }

  if (deco.tag) {
    value = applyTag(state, deco.tag, value, i);
  }
  if (deco.anchor !== undefined) {
    state.anchors.set(deco.anchor, value);
  }
  return { value, nextOffset };
}

function parseBlockSequence(
  state: ParserState,
  firstLineStart: number,
  seqIndent: number
): { value: YamlValue[]; nextOffset: number } {
  const { src, len } = state;
  const items: YamlValue[] = [];
  let lineStart = firstLineStart;

  while (lineStart < len) {
    lineStart = advanceToNextNonBlankLine(state, lineStart);
    if (
      lineStart >= len ||
      isDocBoundaryAtLine(src, lineStart, "---") ||
      isDocBoundaryAtLine(src, lineStart, "...")
    ) {
      break;
    }
    const info = measureLineIndent(state, lineStart);
    if (info.indent < seqIndent) {
      break;
    }
    if (info.indent > seqIndent) {
      throw makeParseError(
        state,
        info.firstNonSpace,
        "BAD_INDENT",
        "Unexpected over-indented line in sequence"
      );
    }

    const dashPos = info.firstNonSpace;
    const afterDash = dashPos + 1;
    if (
      src.charCodeAt(dashPos) !== 45 ||
      (afterDash < len && !isWhitespace(src.charCodeAt(afterDash)))
    ) {
      break;
    }

    const lineEnd = findLineEnd(src, dashPos);
    const contentStart = skipHorizontalSpaces(src, afterDash, lineEnd);

    if (contentStart >= lineEnd || src.charCodeAt(contentStart) === 35) {
      const nextLineStart = advanceToNextNonBlankLine(
        state,
        lineEnd < len ? lineEnd + 1 : lineEnd
      );
      if (
        nextLineStart >= len ||
        isDocBoundaryAtLine(src, nextLineStart, "---") ||
        isDocBoundaryAtLine(src, nextLineStart, "...")
      ) {
        items.push(null);
        lineStart = nextLineStart;
      } else {
        const nextInfo = measureLineIndent(state, nextLineStart);
        if (nextInfo.indent <= seqIndent) {
          items.push(null);
          lineStart = nextLineStart;
        } else {
          const itemNode = parseBlockNode(state, nextLineStart, seqIndent);
          items.push(itemNode.value);
          lineStart = itemNode.nextOffset;
        }
      }
      continue;
    }

    const nextCh = src.charCodeAt(contentStart);
    const nextAfter = contentStart + 1;
    const inlineIndent = contentStart - lineStart;

    if (nextCh === 45 && (nextAfter >= len || isWhitespace(src.charCodeAt(nextAfter)))) {
      const nestedSeq = parseInlineSeqOrMapFromOffset(
        state,
        lineStart,
        contentStart,
        inlineIndent,
        true
      );
      items.push(nestedSeq.value);
      lineStart = nestedSeq.nextOffset;
      continue;
    }

    const colonPos =
      nextCh !== 34 && nextCh !== 39 && nextCh !== 91 && nextCh !== 123 && nextCh !== 124 && nextCh !== 62
        ? findBlockMappingColon(src, contentStart, lineEnd)
        : -1;
    const isQuotedMapKey =
      (nextCh === 34 || nextCh === 39) &&
      startsWithQuotedMappingKey(state, contentStart, lineEnd);

    if (colonPos !== -1 || isQuotedMapKey) {
      const nestedMap = parseBlockMappingFromFirstEntry(
        state,
        lineStart,
        contentStart,
        inlineIndent
      );
      items.push(nestedMap.value);
      lineStart = nestedMap.nextOffset;
      continue;
    }

    const itemVal = parseBlockValueOnSameLineOrNested(
      state,
      contentStart,
      seqIndent,
      false
    );
    items.push(itemVal.value);
    lineStart = itemVal.nextOffset;
  }

  return { value: items, nextOffset: lineStart };
}

function parseInlineSeqOrMapFromOffset(
  state: ParserState,
  firstLineStart: number,
  firstItemOffset: number,
  seqIndent: number,
  isFirstInline: boolean
): { value: YamlValue[]; nextOffset: number } {
  const { src, len } = state;
  const items: YamlValue[] = [];
  let lineStart = firstLineStart;
  let first = isFirstInline;

  while (lineStart < len) {
    let dashPos: number;
    if (first) {
      dashPos = firstItemOffset;
      first = false;
    } else {
      lineStart = advanceToNextNonBlankLine(state, lineStart);
      if (
        lineStart >= len ||
        isDocBoundaryAtLine(src, lineStart, "---") ||
        isDocBoundaryAtLine(src, lineStart, "...")
      ) {
        break;
      }
      const info = measureLineIndent(state, lineStart);
      if (info.indent < seqIndent) {
        break;
      }
      if (info.indent > seqIndent) {
        throw makeParseError(
          state,
          info.firstNonSpace,
          "BAD_INDENT",
          "Unexpected over-indented line in nested sequence"
        );
      }
      dashPos = info.firstNonSpace;
      const afterDash = dashPos + 1;
      if (
        src.charCodeAt(dashPos) !== 45 ||
        (afterDash < len && !isWhitespace(src.charCodeAt(afterDash)))
      ) {
        break;
      }
    }

    const lineEnd = findLineEnd(src, dashPos);
    const contentStart = skipHorizontalSpaces(src, dashPos + 1, lineEnd);
    const val = parseBlockValueOnSameLineOrNested(
      state,
      contentStart,
      seqIndent,
      false
    );
    items.push(val.value);
    lineStart = val.nextOffset;
  }

  return { value: items, nextOffset: lineStart };
}

function startsWithQuotedMappingKey(
  state: ParserState,
  quoteOffset: number,
  lineEnd: number
): boolean {
  const { src } = state;
  const ch = src.charCodeAt(quoteOffset);
  try {
    const parsed =
      ch === 34
        ? parseDoubleQuoted(state, quoteOffset)
        : parseSingleQuoted(state, quoteOffset);
    if (parsed.nextOffset > lineEnd) {
      return false;
    }
    const afterSpaces = skipHorizontalSpaces(src, parsed.nextOffset, lineEnd);
    if (afterSpaces < lineEnd && src.charCodeAt(afterSpaces) === 58) {
      const next = afterSpaces + 1;
      return next >= lineEnd || isSpaceOrTab(src.charCodeAt(next));
    }
  } catch {
    return false;
  }
  return false;
}

function parseBlockMappingKey(
  state: ParserState,
  keyStartOffset: number,
  lineEnd: number
): { key: string; colonOffset: number } | undefined {
  const { src } = state;
  let i = keyStartOffset;
  let keyAnchor: string | undefined;
  let keyTag: string | undefined;

  if (src.charCodeAt(i) === 38 || src.charCodeAt(i) === 33) {
    const deco = readDecoratorPrefix(state, i, false);
    keyAnchor = deco.anchor;
    keyTag = deco.tag;
    i = skipHorizontalSpaces(src, deco.nextOffset, lineEnd);
  }

  const ch = i < lineEnd ? src.charCodeAt(i) : -1;
  if (ch === 34 || ch === 39) {
    const parsed =
      ch === 34 ? parseDoubleQuoted(state, i) : parseSingleQuoted(state, i);
    if (parsed.nextOffset > lineEnd) {
      return undefined;
    }
    const afterSpaces = skipHorizontalSpaces(src, parsed.nextOffset, lineEnd);
    if (afterSpaces < lineEnd && src.charCodeAt(afterSpaces) === 58) {
      const afterColon = afterSpaces + 1;
      if (afterColon >= lineEnd || isSpaceOrTab(src.charCodeAt(afterColon))) {
        let keyVal: YamlValue = parsed.value;
        if (keyTag) {
          keyVal = applyTag(state, keyTag, keyVal, i);
        }
        if (keyAnchor !== undefined) {
          state.anchors.set(keyAnchor, keyVal);
        }
        return { key: toMappingKeyString(state, keyVal, i), colonOffset: afterSpaces };
      }
    }
    return undefined;
  }

  if (ch === 91 || ch === 123) {
    // Flow key in block mapping: `{a: 1}: val` or `[1, 2]: val`
    try {
      const node = parseFlowNode(state, i);
      if (node.nextOffset > lineEnd) {
        return undefined;
      }
      const afterSpaces = skipHorizontalSpaces(src, node.nextOffset, lineEnd);
      if (afterSpaces < lineEnd && src.charCodeAt(afterSpaces) === 58) {
        const afterColon = afterSpaces + 1;
        if (afterColon >= lineEnd || isSpaceOrTab(src.charCodeAt(afterColon))) {
          const keyStr = toMappingKeyString(state, node.value, i);
          if (keyAnchor !== undefined) {
            state.anchors.set(keyAnchor, keyStr);
          }
          return { key: keyStr, colonOffset: afterSpaces };
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  const colonOffset = findBlockMappingColon(src, i, lineEnd);
  if (colonOffset === -1) {
    return undefined;
  }

  const rawKey = src.slice(i, colonOffset).trimEnd();
  let keyVal: YamlValue =
    rawKey === "" ? null : resolvePlainScalar(rawKey, state.schema);
  if (keyTag) {
    keyVal = applyTag(state, keyTag, keyVal, i);
  }
  const keyStr = toMappingKeyString(state, keyVal, i);
  if (keyAnchor !== undefined) {
    state.anchors.set(keyAnchor, keyStr);
  }
  return { key: keyStr, colonOffset };
}

function parseBlockMappingFromFirstEntry(
  state: ParserState,
  firstLineStart: number,
  firstKeyStartOffset: number,
  mapIndent: number
): { value: { [key: string]: YamlValue }; nextOffset: number } {
  const { src, len } = state;
  const entries: Array<[string, YamlValue]> = [];
  const seenKeys = new Set<string>();
  const explicitKeys = new Set<string>();
  const pendingMerges: YamlValue[] = [];

  let lineStart = firstLineStart;
  let useOverride = true;

  while (lineStart < len) {
    let keyStart: number;
    let keyIndent: number;

    if (useOverride) {
      keyStart = firstKeyStartOffset;
      keyIndent = mapIndent;
      useOverride = false;
    } else {
      lineStart = advanceToNextNonBlankLine(state, lineStart);
      if (
        lineStart >= len ||
        isDocBoundaryAtLine(src, lineStart, "---") ||
        isDocBoundaryAtLine(src, lineStart, "...")
      ) {
        break;
      }
      const info = measureLineIndent(state, lineStart);
      if (info.indent < mapIndent) {
        break;
      }
      if (info.indent > mapIndent) {
        throw makeParseError(
          state,
          info.firstNonSpace,
          "BAD_INDENT",
          "Bad indentation of a mapping entry"
        );
      }
      keyStart = info.firstNonSpace;
      keyIndent = info.indent;
    }

    const lineEnd = findLineEnd(src, keyStart);
    const ch = src.charCodeAt(keyStart);
    const after = keyStart + 1;

    if (ch === 45 && (after >= len || isWhitespace(src.charCodeAt(after)))) {
      if (entries.length === 0 && pendingMerges.length === 0) {
        throw makeParseError(state, keyStart, "UNEXPECTED_TOKEN", "Unexpected sequence entry");
      }
      break;
    }

    let keyStr: string;
    let valStart: number;

    if (ch === 63 && (after >= lineEnd || isSpaceOrTab(src.charCodeAt(after)))) {
      // Explicit ? key \n : value
      const keyResult = parseBlockValueOnSameLineOrNested(
        state,
        skipHorizontalSpaces(src, after, lineEnd),
        keyIndent,
        true
      );
      keyStr = toMappingKeyString(state, keyResult.value, keyStart);
      const colonLineStart = advanceToNextNonBlankLine(state, keyResult.nextOffset);
      if (colonLineStart < len) {
        const cInfo = measureLineIndent(state, colonLineStart);
        if (
          cInfo.indent === keyIndent &&
          src.charCodeAt(cInfo.firstNonSpace) === 58 &&
          (cInfo.firstNonSpace + 1 >= len || isWhitespace(src.charCodeAt(cInfo.firstNonSpace + 1)))
        ) {
          valStart = cInfo.firstNonSpace + 1;
        } else {
          // Key with no value -> null
          if (state.uniqueKeys && explicitKeys.has(keyStr)) {
            throw makeParseError(state, keyStart, "DUPLICATE_KEY", `Map keys must be unique: ${keyStr}`);
          }
          explicitKeys.add(keyStr);
          seenKeys.add(keyStr);
          entries.push([keyStr, null]);
          lineStart = colonLineStart;
          continue;
        }
      } else {
        entries.push([keyStr, null]);
        lineStart = colonLineStart;
        continue;
      }
    } else {
      const parsedKey = parseBlockMappingKey(state, keyStart, lineEnd);
      if (!parsedKey) {
        throw makeParseError(
          state,
          keyStart,
          "MULTILINE_IMPLICIT_KEY",
          "Implicit keys need to be on a single line"
        );
      }
      keyStr = parsedKey.key;
      valStart = parsedKey.colonOffset + 1;
    }

    const valResult = parseBlockValueOnSameLineOrNested(
      state,
      valStart,
      keyIndent,
      true
    );

    if (keyStr === "<<") {
      pendingMerges.push(valResult.value);
    } else {
      if (state.uniqueKeys && explicitKeys.has(keyStr)) {
        throw makeParseError(
          state,
          keyStart,
          "DUPLICATE_KEY",
          `Map keys must be unique: ${keyStr}`
        );
      }
      explicitKeys.add(keyStr);
      seenKeys.add(keyStr);
      entries.push([keyStr, valResult.value]);
    }

    lineStart = valResult.nextOffset;
  }

  for (const mergeSrc of pendingMerges) {
    applyMergeKey(entries, seenKeys, mergeSrc);
  }
  return { value: Object.fromEntries(entries), nextOffset: lineStart };
}

function parseBlockNode(
  state: ParserState,
  lineStart: number,
  parentIndent: number
): { value: YamlValue; nextOffset: number } {
  const { src, len } = state;
  const start = advanceToNextNonBlankLine(state, lineStart);
  if (
    start >= len ||
    isDocBoundaryAtLine(src, start, "---") ||
    isDocBoundaryAtLine(src, start, "...")
  ) {
    return { value: null, nextOffset: start };
  }

  const info = measureLineIndent(state, start);
  const first = info.firstNonSpace;
  const lineEnd = findLineEnd(src, first);
  const ch = src.charCodeAt(first);
  const after = first + 1;

  // Check for top-level decorator followed by nested block on next line
  if (ch === 38 || ch === 33) {
    const deco = readDecoratorPrefix(state, first, false);
    const rest = skipHorizontalSpaces(src, deco.nextOffset, lineEnd);
    const hasKeyColon = findBlockMappingColon(src, first, lineEnd) !== -1;
    if (!hasKeyColon && (rest >= lineEnd || src.charCodeAt(rest) === 35)) {
      const nextLine = advanceToNextNonBlankLine(
        state,
        lineEnd < len ? lineEnd + 1 : lineEnd
      );
      let val: YamlValue = null;
      let nextOffset = nextLine;
      if (nextLine < len) {
        const nextInfo = measureLineIndent(state, nextLine);
        if (nextInfo.indent > info.indent || (parentIndent < 0 && nextInfo.indent >= info.indent)) {
          const inner = parseBlockNode(state, nextLine, info.indent);
          val = inner.value;
          nextOffset = inner.nextOffset;
        }
      }
      if (deco.tag) {
        val = applyTag(state, deco.tag, val, first);
      }
      if (deco.anchor !== undefined) {
        state.anchors.set(deco.anchor, val);
      }
      return { value: val, nextOffset };
    }
  }

  if (ch === 45 && (after >= len || isWhitespace(src.charCodeAt(after)))) {
    return parseBlockSequence(state, start, info.indent);
  }

  if (
    (ch === 63 && (after >= lineEnd || isSpaceOrTab(src.charCodeAt(after)))) ||
    findBlockMappingColon(src, first, lineEnd) !== -1 ||
    ((ch === 34 || ch === 39) && startsWithQuotedMappingKey(state, first, lineEnd))
  ) {
    return parseBlockMappingFromFirstEntry(state, start, first, info.indent);
  }

  // Scalar or flow value at block root/child
  return parseBlockValueOnSameLineOrNested(state, first, parentIndent, true);
}

export function parse(src: string, options: ParseOptions = {}): any {
  if (typeof src !== "string") {
    throw new TypeError("YAML input must be a string");
  }
  const normalized = normalizeEol(src);
  const state: ParserState = {
    src: normalized,
    len: normalized.length,
    lineStarts: buildLineStarts(normalized),
    anchors: new Map<string, YamlValue>(),
    uniqueKeys: options.uniqueKeys ?? true,
    schema: options.schema ?? "core",
    maxAliasCount: options.maxAliasCount ?? 100,
    aliasCount: 0,
  };

  let cursor = advanceToNextNonBlankLine(state, 0);

  // Skip directives (%YAML, %TAG) before optional document marker `---`
  while (cursor < state.len && state.src.charCodeAt(cursor) === 37) {
    const end = findLineEnd(state.src, cursor);
    cursor = advanceToNextNonBlankLine(state, end < state.len ? end + 1 : end);
  }

  if (cursor >= state.len) {
    return null;
  }

  let docVal: YamlValue = null;

  if (isDocBoundaryAtLine(state.src, cursor, "---")) {
    const lineEnd = findLineEnd(state.src, cursor);
    const afterMarker = skipHorizontalSpaces(state.src, cursor + 3, lineEnd);
    if (afterMarker < lineEnd && state.src.charCodeAt(afterMarker) !== 35) {
      const inline = parseBlockValueOnSameLineOrNested(state, afterMarker, -1, true);
      docVal = inline.value;
      cursor = inline.nextOffset;
    } else {
      cursor = advanceToNextNonBlankLine(state, lineEnd < state.len ? lineEnd + 1 : lineEnd);
      if (cursor < state.len && !isDocBoundaryAtLine(state.src, cursor, "---") && !isDocBoundaryAtLine(state.src, cursor, "...")) {
        const res = parseBlockNode(state, cursor, -1);
        docVal = res.value;
        cursor = res.nextOffset;
      }
    }
  } else if (!isDocBoundaryAtLine(state.src, cursor, "...")) {
    const res = parseBlockNode(state, cursor, -1);
    docVal = res.value;
    cursor = res.nextOffset;
  }

  cursor = advanceToNextNonBlankLine(state, cursor);
  if (cursor < state.len && isDocBoundaryAtLine(state.src, cursor, "...")) {
    const end = findLineEnd(state.src, cursor);
    cursor = advanceToNextNonBlankLine(state, end < state.len ? end + 1 : end);
  }

  if (cursor < state.len) {
    throw makeParseError(
      state,
      cursor,
      isDocBoundaryAtLine(state.src, cursor, "---") ? "MULTIPLE_DOCS" : "UNEXPECTED_TOKEN",
      "Source contains multiple documents or trailing tokens"
    );
  }

  return docVal;
}

function isSafePlainKey(key: string): boolean {
  if (!key) {
    return false;
  }
  if (/[\n\r\t\0-\x1f\x7f]/.test(key)) {
    return false;
  }
  if (/^\s|\s$/.test(key)) {
    return false;
  }
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(key)) {
    return false;
  }
  if (key.includes(": ") || key.includes(" #") || key.endsWith(":")) {
    return false;
  }
  const lower = key.toLowerCase();
  if (lower === "null" || lower === "true" || lower === "false" || key === "~") {
    return false;
  }
  if (/^[-+]?(?:0x[0-9a-f]+|0o[0-7]+|[0-9]+(?:\.[0-9]*)?(?:e[-+]?[0-9]+)?|\.[0-9]+|\.inf|\.nan)$/i.test(key)) {
    return false;
  }
  return true;
}

function isSafePlainStringValue(value: string): boolean {
  if (!isSafePlainKey(value)) {
    return false;
  }
  if (value.includes("[") || value.includes("]") || value.includes("{") || value.includes("}")) {
    return false;
  }
  return true;
}

function escapeDoubleQuotedString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const ch = value[i];
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      default:
        if (code < 0x20 || code === 0x7f) {
          out += `\\x${code.toString(16).padStart(2, "0")}`;
        } else {
          out += ch;
        }
        break;
    }
  }
  out += '"';
  return out;
}

function stringifyScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return ".nan";
    }
    if (value === Infinity) {
      return ".inf";
    }
    if (value === -Infinity) {
      return "-.inf";
    }
    return `${value}`;
  }
  if (typeof value === "bigint") {
    return `${value}`;
  }
  if (typeof value === "string") {
    return isSafePlainStringValue(value) ? value : escapeDoubleQuotedString(value);
  }
  return escapeDoubleQuotedString(
    typeof value === "symbol"
      ? value.description ?? "Symbol()"
      : typeof value === "function"
        ? `[Function ${value.name || "anonymous"}]`
        : "[object Object]"
  );
}

function stringifyKey(key: string): string {
  return isSafePlainKey(key) ? key : escapeDoubleQuotedString(key);
}

function stringifyBlockString(
  str: string,
  indentStr: string,
  childIndentStr: string
): string | undefined {
  if (!str.includes("\n") || /[\x00-\x08\x0b-\x1f\x7f]/.test(str)) {
    return undefined;
  }
  const hasTrailingNl = str.endsWith("\n");
  const body = hasTrailingNl ? str.slice(0, -1) : str;
  if (body.endsWith("\n")) {
    return undefined;
  }
  const header = hasTrailingNl ? "|" : "|-";
  const lines = body.split("\n");
  let out = `${header}\n`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0) {
      out += `${childIndentStr}${line}`;
    }
    if (i < lines.length - 1) {
      out += "\n";
    }
  }
  return out.length > 0 ? out : `${indentStr}${header}`;
}

function stringifyNode(
  value: unknown,
  indentLevel: number,
  indentUnit: number,
  sortKeys: boolean,
  seen: Set<object>
): string {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return stringifyScalar(value);
  }

  if (typeof value === "string") {
    const contentIndentStr = " ".repeat(Math.max(1, indentLevel) * indentUnit);
    const block = stringifyBlockString(value, " ".repeat(indentLevel * indentUnit), contentIndentStr);
    return block ?? stringifyScalar(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Cannot stringify circular structure to YAML");
    }
    seen.add(value);
    try {
      const indentStr = " ".repeat(indentLevel * indentUnit);

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return "[]";
        }
        const lines: string[] = [];
        for (const item of value) {
          const itemStr = stringifyNode(
            item === undefined ? null : item,
            indentLevel + 1,
            indentUnit,
            sortKeys,
            seen
          );
          if (isCollection(item) && hasNonEmptyCollection(item)) {
            lines.push(`${indentStr}-\n${itemStr}`);
          } else {
            lines.push(`${indentStr}- ${itemStr}`);
          }
        }
        return lines.join("\n");
      }

      const rawEntries: Array<[string, unknown]> = [];
      if (value instanceof Map) {
        for (const [k, v] of value.entries()) {
          if (v !== undefined) {
            rawEntries.push([`${k}`, v]);
          }
        }
      } else if (value instanceof Set) {
        const items = Array.from(value);
        return stringifyNode(items, indentLevel, indentUnit, sortKeys, seen);
      } else {
        const record = value as { [key: string]: unknown };
        const keys = Object.keys(record);
        if (sortKeys) {
          keys.sort();
        }
        for (const k of keys) {
          const v = record[k];
          if (v !== undefined) {
            rawEntries.push([k, v]);
          }
        }
      }

      if (rawEntries.length === 0) {
        return "{}";
      }

      const lines: string[] = [];
      for (const [k, v] of rawEntries) {
        const keyOut = stringifyKey(k);
        if (isCollection(v) && hasNonEmptyCollection(v)) {
          const childStr = stringifyNode(v, indentLevel + 1, indentUnit, sortKeys, seen);
          lines.push(`${indentStr}${keyOut}:\n${childStr}`);
        } else {
          const valStr = stringifyNode(v, indentLevel + 1, indentUnit, sortKeys, seen);
          lines.push(`${indentStr}${keyOut}: ${valStr}`);
        }
      }
      return lines.join("\n");
    } finally {
      seen.delete(value);
    }
  }

  return stringifyScalar(value);
}

function isCollection(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  return !(value instanceof Date);
}

function hasNonEmptyCollection(value: unknown): boolean {
  if (!value || typeof value !== "object" || value instanceof Date) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }
  const rec = value as { [key: string]: unknown };
  for (const k of Object.keys(rec)) {
    if (rec[k] !== undefined) {
      return true;
    }
  }
  return false;
}

export function stringify(value: unknown, options: StringifyOptions = {}): string {
  const indentUnit = Math.max(1, options.indent ?? 2);
  const sortKeys = options.sortMapEntries ?? false;
  const seen = new Set<object>();
  const body = stringifyNode(value, 0, indentUnit, sortKeys, seen);
  return `${body}\n`;
}

export const YAML = {
  parse,
  stringify,
  YAMLParseError,
  YAMLError,
};

export default YAML;
