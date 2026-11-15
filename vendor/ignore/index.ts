export type Pathname = string;

export interface IgnoreRuleInfo {
  readonly pattern: string;
  readonly mark?: string;
  readonly negative: boolean;
}

export interface TestResult {
  ignored: boolean;
  unignored: boolean;
  rule?: IgnoreRuleInfo;
}

export interface PatternParams {
  pattern: string;
  mark?: string;
}

export interface IgnoreOptions {
  ignorecase?: boolean;
  ignoreCase?: boolean;
  allowRelativePaths?: boolean;
}

export interface Ignore {
  add(
    patterns: string | Ignore | readonly (string | Ignore)[] | PatternParams
  ): this;
  addPattern(
    patterns: string | Ignore | readonly (string | Ignore)[] | PatternParams
  ): this;
  filter(pathnames: readonly Pathname[]): Pathname[];
  createFilter(): (pathname: Pathname) => boolean;
  ignores(pathname: Pathname): boolean;
  test(pathname: Pathname): TestResult;
  checkIgnore(pathname: Pathname): TestResult;
}

export type IgnoreFactory = ((options?: IgnoreOptions) => Ignore) & {
  readonly isPathValid: (pathname: string) => boolean;
};

const EMPTY = "";
const SPACE = " ";
const ESCAPE = "\\";
const SLASH = "/";
const DOUBLE_SLASH = "//";
const SLASH_CODE = 47;
const DOT_CODE = 46;

const REGEX_LITERAL_SPECIAL = /[.*+?()[\]{}^$|\\/]/;
const REGEX_TEST_BLANK_LINE = /^ +$/;
const REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
const REGEX_REPLACE_LEADING_ESCAPED_EXCLAMATION = /^\\!/;
const REGEX_REPLACE_LEADING_ESCAPED_HASH = /^\\#/;
const REGEX_SPLITALL_CRLF = /\r?\n/g;
const REGEX_INNER_SLASH = /\/(?!$)/;
const REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\uE000$/;
const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;

const NEVER_MATCH = "[]";
const PLACEHOLDER = "\u0000";
const REGEX_RESTORE_PLACEHOLDER = /\u0000(\d+)\u0000/g;
const TRAILING_WILDCARD = "\uE000";
const WILDCARD = "[^\\/]*";

const CLASS_MEMBERS_TO_ESCAPE = "\\]^-[" ;

const POSIX_CLASSES = new Map<string, string>([
  ["alnum", "0-9A-Za-z"],
  ["alpha", "A-Za-z"],
  ["blank", " \\t"],
  ["cntrl", "\\x00-\\x1f\\x7f"],
  ["digit", "0-9"],
  ["graph", "!-.0-~"],
  ["lower", "a-z"],
  ["print", " -.0-~"],
  ["punct", "!-.:-@\\[-`{-~"],
  ["space", " \\t\\n\\r"],
  ["upper", "A-Z"],
  ["xdigit", "0-9A-Fa-f"],
]);

function cleanRangeBackSlash(slashes: string): string {
  const { length } = slashes;
  return slashes.slice(0, length - (length % 2));
}

function escapeMember(ch: string): string {
  return CLASS_MEMBERS_TO_ESCAPE.indexOf(ch) < 0 ? ch : ESCAPE + ch;
}

function classSource(negated: string, body: string): string {
  if (negated) {
    return `[^\\/${body}]`;
  }
  const source = `[${body}]`;
  return new RegExp(source).test("/") ? `(?!\\/)${source}` : source;
}

interface BracketScanResult {
  readonly end: number;
  readonly source: string;
}

function scanBracket(pattern: string, start: number): BracketScanResult | null {
  const { length } = pattern;
  let index = start + 1;
  let negated = EMPTY;

  const lead = pattern[index];
  if (lead === "!" || lead === "^") {
    negated = "^";
    index++;
  }

  let body = EMPTY;
  let prev = EMPTY;

  for (;;) {
    const ch = pattern[index];
    if (ch === undefined) {
      return null;
    }

    if (ch === ESCAPE) {
      const escaped = pattern[index + 1];
      if (escaped === undefined) {
        return null;
      }
      body += escapeMember(escaped);
      prev = escaped;
      index++;
    } else if (
      ch === "-" &&
      prev &&
      index + 1 < length &&
      pattern[index + 1] !== "]"
    ) {
      index++;
      let to = pattern[index];
      if (to === ESCAPE) {
        index++;
        to = pattern[index];
      }
      if (to !== undefined && prev <= to) {
        body += `-${escapeMember(to)}`;
      }
      prev = EMPTY;
    } else if (ch === "[" && pattern[index + 1] === ":") {
      const nameStart = index + 2;
      let end = nameStart;
      while (end < length && pattern[end] !== "]") {
        end++;
      }
      if (end === length) {
        return null;
      }
      if (end > nameStart && pattern[end - 1] === ":") {
        const expanded = POSIX_CLASSES.get(pattern.slice(nameStart, end - 1));
        if (expanded === undefined) {
          return null;
        }
        body += expanded;
        prev = EMPTY;
        index = end;
      } else {
        body += escapeMember("[");
        prev = "[";
        index = nameStart - 2;
      }
    } else {
      body += escapeMember(ch);
      prev = ch;
    }

    index++;
    if (pattern[index] === "]") {
      return {
        end: index,
        source: classSource(negated, body),
      };
    }
  }
}

interface ExtractedBrackets {
  readonly source: string;
  readonly sources: string[];
}

function extractBrackets(pattern: string): ExtractedBrackets {
  const sources: string[] = [];
  const hold = (src: string): string => {
    const idx = sources.push(src) - 1;
    return `${PLACEHOLDER}${idx}${PLACEHOLDER}`;
  };

  const { length } = pattern;
  let out = EMPTY;
  let index = 0;

  while (index < length) {
    const ch = pattern[index];
    if (ch === ESCAPE) {
      const escaped = pattern[index + 1];
      if (
        escaped === "*" ||
        escaped === "[" ||
        escaped === SPACE ||
        escaped === ESCAPE
      ) {
        out += pattern.slice(index, index + 2);
      } else if (escaped !== undefined) {
        out += hold(
          REGEX_LITERAL_SPECIAL.test(escaped) ? ESCAPE + escaped : escaped
        );
      }
      index += 2;
    } else if (ch === PLACEHOLDER) {
      out += hold(`[${PLACEHOLDER}]`);
      index++;
    } else if (ch === "[") {
      const scanned = scanBracket(pattern, index);
      if (scanned === null) {
        out += hold(NEVER_MATCH);
        index = length;
      } else {
        out += hold(scanned.source);
        index = scanned.end + 1;
      }
    } else {
      out += ch;
      index++;
    }
  }

  return { source: out, sources };
}

interface PinToken {
  readonly wildcard: boolean;
  readonly single?: string;
  readonly boundary?: string;
}

function pinWildcards(source: string): string {
  if (source.indexOf(WILDCARD) < 0) {
    return source;
  }

  const tokens: PinToken[] = [];
  const { length } = source;
  let index = 0;

  while (index < length) {
    const ch = source[index];

    if (source.startsWith(WILDCARD, index)) {
      const prev = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
      if (!prev || !prev.wildcard) {
        tokens.push({ wildcard: true });
      }
      index += WILDCARD.length;
    } else if (ch === "[") {
      let end = index + 1;
      if (source[end] === "^") {
        end++;
      }
      if (source[end] === "]") {
        end++;
      }
      while (end < length && source[end] !== "]") {
        end += source[end] === ESCAPE ? 2 : 1;
      }
      end++;
      tokens.push({ wildcard: false, single: source.slice(index, end) });
      index = end;
    } else if (ch === ESCAPE) {
      tokens.push({ wildcard: false, single: source.slice(index, index + 2) });
      index += 2;
    } else if (ch === "(") {
      let depth = 0;
      let end = index;
      do {
        if (source[end] === ESCAPE) {
          end++;
        } else if (source[end] === "(") {
          depth++;
        } else if (source[end] === ")") {
          depth--;
        }
        end++;
      } while (end < length && depth > 0);

      const quantifier = source[end];
      if (quantifier !== undefined && "*+?".indexOf(quantifier) >= 0) {
        end++;
      }
      tokens.push({ wildcard: false, boundary: source.slice(index, end) });
      index = end;
    } else if (ch === "^" || ch === "$") {
      tokens.push({ wildcard: false, boundary: ch });
      index++;
    } else {
      tokens.push({ wildcard: false, single: ch });
      index++;
    }
  }

  let out = EMPTY;
  let run: PinToken[] = [];

  const flush = (): void => {
    let lastWildcard = -1;
    for (let i = 0; i < run.length; i++) {
      if (run[i].wildcard) {
        lastWildcard = i;
      }
    }
    for (let i = 0; i < run.length; i++) {
      const tok = run[i];
      if (!tok.wildcard) {
        out += tok.single ?? EMPTY;
      } else if (i === lastWildcard || !run[i + 1]?.single) {
        out += WILDCARD;
      } else {
        out += `(?:(?!${run[i + 1].single})[^\\/])*`;
      }
    }
    run = [];
  };

  for (const token of tokens) {
    if (token.boundary === undefined) {
      run.push(token);
    } else {
      flush();
      out += token.boundary;
    }
  }
  flush();

  return out;
}

function makeRegexPrefix(pattern: string): string {
  const { source, sources } = extractBrackets(pattern);
  let s = source;

  // Step 1: Remove BOM
  if (s.indexOf("\uFEFF") >= 0 && /^\uFEFF/.test(s)) {
    s = s.replace(/^\uFEFF/, EMPTY);
  }

  // Step 2: Strip trailing line terminators
  if (/[\r\n]+$/.test(s)) {
    s = s.replace(/[\r\n]+$/, EMPTY);
  }

  // Step 3: Trim unescaped trailing spaces
  if (/((?:\\\\)*?)(\\? +)$/.test(s)) {
    s = s.replace(
      /((?:\\\\)*?)(\\? +)$/,
      (_match: string, m1: string, m2: string) =>
        m1 + (m2.indexOf(ESCAPE) === 0 ? SPACE : EMPTY)
    );
  }

  // Step 4: Replace escaped space `\ ` with literal space
  if (/(\\+?) /.test(s)) {
    s = s.replace(/(\\+?) /g, (_match: string, m1: string) => {
      const len = m1.length;
      return m1.slice(0, len - (len % 2)) + SPACE;
    });
  }

  // Step 5: Escape regex metacharacters
  if (/[\\$.|*+(){^]/.test(s)) {
    s = s.replace(/[\\$.|*+(){^]/g, (match: string) => `\\${match}`);
  }

  // Step 6: Replace unescaped `?` with `[^/]`
  if (s.indexOf("?") >= 0 && /(?!\\)\?/.test(s)) {
    s = s.replace(/(?!\\)\?/g, "[^/]");
  }

  // Step 7: Leading slash anchors to start
  if (s.indexOf(SLASH) >= 0 && /^\//.test(s)) {
    s = s.replace(/^\//, "^");
  }

  // Step 8: Escape remaining slashes
  if (s.indexOf(SLASH) >= 0) {
    s = s.replace(/\//g, "\\/");
  }

  // Step 9: Leading `**/`
  if (s.indexOf("*") >= 0 && /^\^*(?:\\\*\\\*\\\/)+/.test(s)) {
    s = s.replace(/^\^*(?:\\\*\\\*\\\/)+/, "^(?:.*\\/)?");
  }

  // Step 10: Anchor start if pattern had an inner slash
  if (s && s[0] !== "^") {
    const anchor = !REGEX_INNER_SLASH.test(pattern) ? "(?:^|\\/)" : "^";
    s = anchor + s;
  }

  // Step 11: Handle `/**/` and `/**`
  if (s.indexOf("*") >= 0 && /\\\/\\\*\\\*(?=\\\/|$)/.test(s)) {
    s = s.replace(
      /\\\/\\\*\\\*(?=\\\/|$)/g,
      (_match: string, index: number, str: string) =>
        index + 6 < str.length
          ? str.slice(index + 6) === "\\/"
            ? "(?:\\/[^\\/]+)+"
            : "(?:\\/[^\\/]+)*"
          : "\\/.+"
    );
  }

  // Step 12: Intermediate `*` wildcards
  if (s.indexOf("*") >= 0 && /(^|[^\\]+)(\\\*)+(?=.+)/.test(s)) {
    s = s.replace(
      /(^|[^\\]+)(\\\*)+(?=.+)/g,
      (_match: string, p1: string, p2: string) =>
        p1 + p2.replace(/\\\*/g, "[^\\/]*")
    );
  }

  // Step 13: Trailing `*` wildcard marker
  if (s.indexOf("*") >= 0 && /(^|[^\\])((?:\\\\)*)\\\*$/.test(s)) {
    s = s.replace(
      /(^|[^\\])((?:\\\\)*)\\\*$/,
      (match: string, p1: string, p2: string) =>
        (p2.length / 2) % 2 === 0 ? p1 + p2 + TRAILING_WILDCARD : match
    );
  }

  // Step 14: Revert extra escaping before regex specials
  if (s.indexOf("\\\\") >= 0 && /\\\\\\(?=[$.|*+(){^])/.test(s)) {
    s = s.replace(/\\\\\\(?=[$.|*+(){^])/g, ESCAPE);
  }

  // Step 15: Collapse `\\` -> `\`
  if (s.indexOf("\\\\") >= 0) {
    s = s.replace(/\\\\/g, ESCAPE);
  }

  // Step 16: Literal escaped `[`
  if (s.indexOf("[") >= 0 && /\\\[([^\]/]*?)(\\*)($|\])/.test(s)) {
    s = s.replace(
      /\\\[([^\]/]*?)(\\*)($|\])/g,
      (_match: string, range: string, endEscape: string, close: string) =>
        `\\[${range}${cleanRangeBackSlash(endEscape)}${close}`
    );
  }

  // Step 17: Ending anchor
  const last = s[s.length - 1];
  if (last && last !== TRAILING_WILDCARD) {
    s = last === SLASH ? `${s}$` : `${s}(?=$|\\/$)`;
  }

  if (sources.length === 0) {
    return s;
  }
  return s.replace(REGEX_RESTORE_PLACEHOLDER, (_match: string, idxStr: string) => {
    const idx = Number(idxStr);
    return sources[idx] ?? EMPTY;
  });
}

function matchesBasename(body: string): boolean {
  const index = body.indexOf(SLASH);
  return index < 0 || index === body.length - 1;
}

function basenameOf(path: string): string {
  const end = path.length - 1;
  const index = path.lastIndexOf(SLASH, path[end] === SLASH ? end - 1 : end);
  return index < 0 ? path : path.slice(index + 1);
}

function parentOf(path: string): string {
  if (path.charCodeAt(0) === SLASH_CODE || path.indexOf(DOUBLE_SLASH) >= 0) {
    const slices = path.split(SLASH).filter(Boolean);
    slices.pop();
    return slices.length ? slices.join(SLASH) + SLASH : EMPTY;
  }

  const end = path.length - 1;
  const cut = path.lastIndexOf(
    SLASH,
    path.charCodeAt(end) === SLASH_CODE ? end - 1 : end
  );
  return cut < 0 ? EMPTY : path.slice(0, cut + 1);
}

function checkPattern(pattern: unknown): pattern is string {
  return (
    typeof pattern === "string" &&
    pattern.length > 0 &&
    !REGEX_TEST_BLANK_LINE.test(pattern) &&
    !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) &&
    pattern.indexOf("#") !== 0
  );
}

function splitPattern(pattern: string): string[] {
  return pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
}

class CompiledRule {
  readonly pattern: string;
  readonly mark?: string;
  readonly negative: boolean;
  readonly body: string;
  readonly ignoreCase: boolean;
  readonly regexPrefix: string;
  private cachedBasenameOnly: boolean | undefined;
  private cachedRegex: RegExp | undefined;
  private cachedCheckRegex: RegExp | undefined;

  constructor(
    pattern: string,
    mark: string | undefined,
    body: string,
    ignoreCase: boolean,
    negative: boolean,
    regexPrefix: string
  ) {
    this.pattern = pattern;
    this.mark = mark;
    this.negative = negative;
    this.body = body;
    this.ignoreCase = ignoreCase;
    this.regexPrefix = regexPrefix;
    this.cachedBasenameOnly = undefined;
    this.cachedRegex = undefined;
    this.cachedCheckRegex = undefined;
  }

  get basenameOnly(): boolean {
    if (this.cachedBasenameOnly === undefined) {
      this.cachedBasenameOnly = matchesBasename(this.body);
    }
    return this.cachedBasenameOnly;
  }

  get regex(): RegExp {
    if (!this.cachedRegex) {
      this.cachedRegex = this.make(false);
    }
    return this.cachedRegex;
  }

  get checkRegex(): RegExp {
    if (!this.cachedCheckRegex) {
      this.cachedCheckRegex = this.make(true);
    }
    return this.cachedCheckRegex;
  }

  toRuleInfo(): IgnoreRuleInfo {
    if (this.mark !== undefined) {
      return { pattern: this.pattern, mark: this.mark, negative: this.negative };
    }
    return { pattern: this.pattern, negative: this.negative };
  }

  private make(isCheckIgnore: boolean): RegExp {
    const str = pinWildcards(
      this.regexPrefix.replace(
        REGEX_REPLACE_TRAILING_WILDCARD,
        (_match: string, p1?: string) => {
          const prefix = p1
            ? isCheckIgnore
              ? `${p1}[^/]*`
              : `${p1}[^/]+`
            : "[^/]*";
          return `${prefix}(?=$|\\/$)`;
        }
      )
    );
    return this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
  }
}

function createRule(params: PatternParams, ignoreCase: boolean): CompiledRule {
  let negative = false;
  let body = params.pattern;

  if (body.indexOf("!") === 0) {
    negative = true;
    body = body.slice(1);
  }

  body = body
    .replace(REGEX_REPLACE_LEADING_ESCAPED_EXCLAMATION, "!")
    .replace(REGEX_REPLACE_LEADING_ESCAPED_HASH, "#");

  const regexPrefix = makeRegexPrefix(body);
  return new CompiledRule(
    params.pattern,
    params.mark,
    body,
    ignoreCase,
    negative,
    regexPrefix
  );
}

class RuleManager {
  readonly ignoreCase: boolean;
  rules: CompiledRule[];
  basenameCount: number;

  constructor(ignoreCase: boolean) {
    this.ignoreCase = ignoreCase;
    this.rules = [];
    this.basenameCount = 0;
  }

  addOne(entry: string | Ignore | PatternParams): boolean {
    if (entry instanceof IgnoreImpl) {
      for (const rule of entry.rulesManager.rules) {
        this.rules.push(rule);
      }
      this.basenameCount += entry.rulesManager.basenameCount;
      return true;
    }

    const params: PatternParams | undefined =
      typeof entry === "string"
        ? { pattern: entry }
        : entry && typeof entry === "object" && "pattern" in entry
          ? entry
          : undefined;

    if (!params || !checkPattern(params.pattern)) {
      return false;
    }

    const rule = createRule(params, this.ignoreCase);
    this.rules.push(rule);
    if (matchesBasename(rule.body)) {
      this.basenameCount++;
    }
    return true;
  }

  add(
    patterns: string | Ignore | readonly (string | Ignore)[] | PatternParams
  ): boolean {
    let added = false;
    if (typeof patterns === "string") {
      for (const line of splitPattern(patterns)) {
        if (this.addOne(line)) {
          added = true;
        }
      }
      return added;
    }
    if (Array.isArray(patterns)) {
      for (const item of patterns) {
        if (this.addOne(item)) {
          added = true;
        }
      }
      return added;
    }
    return this.addOne(patterns as Ignore | PatternParams);
  }

  test(path: string, checkUnignored: boolean, isCheckIgnore: boolean): TestResult {
    let ignored = false;
    let unignored = false;
    let matchedRule: CompiledRule | undefined;

    const rules = this.rules;
    const length = rules.length;
    const shortcut = this.basenameCount * 2 >= length;
    const basename = shortcut ? basenameOf(path) : path;

    for (let index = 0; index < length; index++) {
      const rule = rules[index];
      const { negative } = rule;

      const skip =
        (unignored === negative && ignored !== unignored) ||
        (negative && !ignored && !unignored && !checkUnignored);

      if (!skip) {
        const re = isCheckIgnore ? rule.checkRegex : rule.regex;
        const target = shortcut && rule.basenameOnly ? basename : path;
        if (re.test(target)) {
          ignored = !negative;
          unignored = negative;
          matchedRule = negative ? undefined : rule;
        }
      }
    }

    if (matchedRule) {
      return {
        ignored,
        unignored,
        rule: matchedRule.toRuleInfo(),
      };
    }
    return { ignored, unignored };
  }
}

function isWindowsPlatform(): boolean {
  return typeof process !== "undefined" && process.platform === "win32";
}

function convertPath(path: string): string {
  if (!isWindowsPlatform()) {
    return path;
  }
  if (/^\\\\\?\\/.test(path) || /["<>|\u0000-\u001F]+/u.test(path)) {
    return path;
  }
  return path.replace(/\\/g, SLASH);
}

function isPosixNotRelative(path: string): boolean {
  const first = path.charCodeAt(0);
  if (first === SLASH_CODE) {
    return true;
  }
  if (first !== DOT_CODE) {
    return false;
  }
  if (path.length === 1) {
    return true;
  }
  const second = path.charCodeAt(1);
  if (second === SLASH_CODE) {
    return true;
  }
  if (second !== DOT_CODE) {
    return false;
  }
  return path.length === 2 || path.charCodeAt(2) === SLASH_CODE;
}

function isNotRelative(path: string): boolean {
  if (isWindowsPlatform() && REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path)) {
    return true;
  }
  return isPosixNotRelative(path);
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === undefined ||
    value === null
  ) {
    return `${value}`;
  }
  return typeof value;
}

function checkPath(
  path: unknown,
  originalPath: unknown,
  throwOnError: boolean
): path is string {
  if (typeof path !== "string") {
    if (throwOnError) {
      throw new TypeError(
        `path must be a string, but got \`${formatUnknownValue(originalPath)}\``
      );
    }
    return false;
  }
  if (!path) {
    if (throwOnError) {
      throw new TypeError("path must not be empty");
    }
    return false;
  }
  if (isNotRelative(path)) {
    if (throwOnError) {
      throw new RangeError(
        `path should be a \`path.relative()\`d string, but got "${formatUnknownValue(originalPath)}"`
      );
    }
    return false;
  }
  return true;
}

class IgnoreImpl implements Ignore {
  readonly rulesManager: RuleManager;
  private readonly strictPathCheck: boolean;
  private ignoreCache: Map<string, TestResult>;
  private testCache: Map<string, TestResult>;

  constructor(options: IgnoreOptions = {}) {
    const ignoreCase =
      options.ignoreCase ?? options.ignorecase ?? true;
    this.rulesManager = new RuleManager(ignoreCase);
    this.strictPathCheck = !(options.allowRelativePaths ?? false);
    this.ignoreCache = new Map<string, TestResult>();
    this.testCache = new Map<string, TestResult>();
  }

  private resetCache(): void {
    this.ignoreCache = new Map<string, TestResult>();
    this.testCache = new Map<string, TestResult>();
  }

  add(
    patterns: string | Ignore | readonly (string | Ignore)[] | PatternParams
  ): this {
    if (this.rulesManager.add(patterns)) {
      this.resetCache();
    }
    return this;
  }

  addPattern(
    patterns: string | Ignore | readonly (string | Ignore)[] | PatternParams
  ): this {
    return this.add(patterns);
  }

  private testInternal(
    originalPath: Pathname,
    cache: Map<string, TestResult>,
    checkUnignored: boolean
  ): TestResult {
    const converted =
      typeof originalPath === "string" && originalPath
        ? convertPath(originalPath)
        : originalPath;

    checkPath(converted, originalPath, this.strictPathCheck);
    return this.lookupPath(converted, cache, checkUnignored);
  }

  private lookupPath(
    path: string,
    cache: Map<string, TestResult>,
    checkUnignored: boolean
  ): TestResult {
    const cached = cache.get(path);
    if (cached !== undefined) {
      return cached;
    }

    const parentPath = parentOf(path);
    const parent = parentPath
      ? this.lookupPath(parentPath, cache, checkUnignored)
      : undefined;

    const result =
      parent && parent.ignored
        ? parent
        : this.rulesManager.test(path, checkUnignored, false);

    cache.set(path, result);
    return result;
  }

  ignores(pathname: Pathname): boolean {
    return this.testInternal(pathname, this.ignoreCache, false).ignored;
  }

  createFilter(): (pathname: Pathname) => boolean {
    return (pathname: Pathname) => !this.ignores(pathname);
  }

  filter(pathnames: readonly Pathname[]): Pathname[] {
    const list = Array.isArray(pathnames) ? pathnames : [pathnames];
    const out: Pathname[] = [];
    for (const pathname of list) {
      if (!this.ignores(pathname)) {
        out.push(pathname);
      }
    }
    return out;
  }

  test(pathname: Pathname): TestResult {
    return this.testInternal(pathname, this.testCache, true);
  }

  checkIgnore(pathname: Pathname): TestResult {
    if (pathname.charCodeAt(pathname.length - 1) !== SLASH_CODE) {
      return this.test(pathname);
    }

    const parentPath = parentOf(pathname);
    if (parentPath) {
      const parent = this.lookupPath(parentPath, this.testCache, true);
      if (parent.ignored) {
        return parent;
      }
    }

    return this.rulesManager.test(pathname, false, true);
  }
}

export function isPathValid(pathname: string): boolean {
  if (typeof pathname !== "string" || !pathname) {
    return false;
  }
  return checkPath(convertPath(pathname), pathname, false);
}

function createIgnore(options?: IgnoreOptions): Ignore {
  return new IgnoreImpl(options);
}

function buildIgnoreFactory(): IgnoreFactory {
  const fn = createIgnore as unknown as IgnoreFactory;
  Object.defineProperties(fn, {
    isPathValid: {
      value: isPathValid,
      enumerable: true,
      configurable: true,
    },
  });
  return fn;
}

export const ignore: IgnoreFactory = buildIgnoreFactory();
export default ignore;
