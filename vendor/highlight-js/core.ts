export type RegExpLike = string | RegExp;

export type KeywordsSpec =
  | string
  | {
      $pattern?: RegExpLike;
      _relevance_hints?: string | readonly string[];
      [scope: string]: string | readonly string[] | RegExpLike | undefined;
    };

export interface Mode {
  scope?: string;
  className?: string;
  begin?: RegExpLike;
  match?: RegExpLike;
  end?: RegExpLike;
  beginKeywords?: string;
  keywords?: KeywordsSpec;
  illegal?: RegExpLike;
  contains?: Array<Mode | "self">;
  variants?: Mode[];
  starts?: Mode;
  subLanguage?: string | readonly string[];
  excludeBegin?: boolean;
  excludeEnd?: boolean;
  returnBegin?: boolean;
  returnEnd?: boolean;
  endsWithParent?: boolean;
  endsParent?: boolean;
  skip?: boolean;
  relevance?: number;
  case_insensitive?: boolean;
  lexemes?: RegExpLike;
  disableAutodetect?: boolean;
}

export interface LanguageDetail extends Mode {
  name?: string;
  aliases?: readonly string[];
  unicodeRegex?: boolean;
  supersetOf?: string;
}

export type Language = LanguageDetail;
export type LanguageFn = (hljs: HLJSApi) => LanguageDetail;

export interface HighlightOptions {
  language: string;
  ignoreIllegals?: boolean;
}

export interface HighlightResult {
  code?: string;
  relevance: number;
  value: string;
  language?: string;
  illegal: boolean;
  errorRaised?: Error;
  secondBest?: Omit<HighlightResult, "secondBest">;
}

export interface AutoHighlightResult {
  relevance: number;
  value: string;
  language?: string;
  illegal: boolean;
  secondBest?: Omit<AutoHighlightResult, "secondBest">;
}

export interface HljsConfig {
  classPrefix: string;
  noHighlightRe: RegExp;
  languageDetectRe: RegExp;
  tabReplace?: string;
  useBR?: boolean;
  languages?: readonly string[];
  throwUnescapedHTML?: boolean;
}

export interface HLJSApi {
  readonly IDENT_RE: string;
  readonly UNDERSCORE_IDENT_RE: string;
  readonly NUMBER_RE: string;
  readonly C_NUMBER_RE: string;
  readonly BINARY_NUMBER_RE: string;
  readonly RE_STARTERS_RE: string;
  readonly SHEBANG: (mode?: Partial<Mode>) => Mode;
  readonly BACKSLASH_ESCAPE: Mode;
  readonly APOS_STRING_MODE: Mode;
  readonly QUOTE_STRING_MODE: Mode;
  readonly PHRASAL_WORDS_MODE: Mode;
  readonly COMMENT: (begin: RegExpLike, end: RegExpLike, mode?: Partial<Mode>) => Mode;
  readonly C_LINE_COMMENT_MODE: Mode;
  readonly C_BLOCK_COMMENT_MODE: Mode;
  readonly HASH_COMMENT_MODE: Mode;
  readonly NUMBER_MODE: Mode;
  readonly C_NUMBER_MODE: Mode;
  readonly BINARY_NUMBER_MODE: Mode;
  readonly REGEXP_MODE: Mode;
  readonly TITLE_MODE: Mode;
  readonly UNDERSCORE_TITLE_MODE: Mode;
  readonly METHOD_GUARD: Mode;
  readonly END_SAME_AS_BEGIN: (mode: Mode) => Mode;

  registerLanguage(languageName: string, languageDefinition: LanguageFn): void;
  unregisterLanguage(languageName: string): void;
  registerAliases(
    aliasList: string | readonly string[],
    options: { languageName: string }
  ): void;
  getLanguage(languageName: string): Language | undefined;
  listLanguages(): string[];
  autoDetection(languageName: string): boolean;
  highlight(code: string, options: HighlightOptions): HighlightResult;
  highlight(
    languageName: string,
    code: string,
    ignoreIllegals?: boolean
  ): HighlightResult;
  highlightAuto(
    code: string,
    languageSubset?: readonly string[]
  ): AutoHighlightResult;
  configure(options: Partial<HljsConfig>): void;
  inherit<T extends Mode>(parent: T, ...overrides: Array<Partial<Mode>>): Mode;
}

interface KeywordEntry {
  readonly scope: string | null;
  readonly relevance: number;
}

interface CompiledKeywords {
  readonly patternRe: RegExp;
  readonly map: Map<string, KeywordEntry>;
}

interface RegexEntry {
  readonly id: number;
  readonly re: RegExp;
}

interface CompiledMode {
  readonly source: Mode;
  readonly scope: string | undefined;
  readonly beginRe: RegexEntry | undefined;
  readonly endRe: RegexEntry | undefined;
  readonly illegalRe: RegexEntry | undefined;
  readonly beginKeywordSet: Set<string> | undefined;
  readonly keywords: CompiledKeywords | undefined;
  readonly contains: CompiledMode[];
  readonly starts: CompiledMode | undefined;
  readonly excludeBegin: boolean;
  readonly excludeEnd: boolean;
  readonly returnBegin: boolean;
  readonly returnEnd: boolean;
  readonly endsWithParent: boolean;
  readonly endsParent: boolean;
  readonly skip: boolean;
  readonly relevance: number;
  readonly caseInsensitive: boolean;
  readonly subLanguage: string | undefined;
}

interface CachedExec {
  pos: number;
  match: RegExpExecArray | null;
}

const IDENT_RE = "[a-zA-Z]\\w*";
const UNDERSCORE_IDENT_RE = "[a-zA-Z_]\\w*";
const NUMBER_RE = "\\b\\d+(\\.\\d+)?";
const C_NUMBER_RE =
  "(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)";
const BINARY_NUMBER_RE = "\\b(0b[01]+)";
const RE_STARTERS_RE =
  "!|!=|!==|%|%=|&|&&|&=|\\*|\\*=|\\+|\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\?|\\[|\\{|\\(|\\^|\\^=|\\||\\|=|\\|\\||~|\\b(?:case|return|throw)\\b";

const BACKSLASH_ESCAPE: Mode = {
  begin: "\\\\[\\s\\S]",
  relevance: 0,
};

const APOS_STRING_MODE: Mode = {
  className: "string",
  begin: "'",
  end: "'",
  illegal: "\\n",
  contains: [BACKSLASH_ESCAPE],
};

const QUOTE_STRING_MODE: Mode = {
  className: "string",
  begin: '"',
  end: '"',
  illegal: "\\n",
  contains: [BACKSLASH_ESCAPE],
};

const PHRASAL_WORDS_MODE: Mode = {
  begin: /\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\b/,
};

function createCommentMode(
  begin: RegExpLike,
  end: RegExpLike,
  mode?: Partial<Mode>
): Mode {
  const result: Mode = {
    className: "comment",
    begin,
    end,
    illegal: mode?.illegal,
    contains: mode?.contains ?? [PHRASAL_WORDS_MODE],
    excludeBegin: mode?.excludeBegin,
    excludeEnd: mode?.excludeEnd,
    relevance: mode?.relevance,
  };
  return result;
}

const C_LINE_COMMENT_MODE: Mode = createCommentMode("//", "$");
const C_BLOCK_COMMENT_MODE: Mode = createCommentMode("/\\*", "\\*/");
const HASH_COMMENT_MODE: Mode = createCommentMode("#", "$");

const NUMBER_MODE: Mode = {
  className: "number",
  begin: NUMBER_RE,
  relevance: 0,
};

const C_NUMBER_MODE: Mode = {
  className: "number",
  begin: C_NUMBER_RE,
  relevance: 0,
};

const BINARY_NUMBER_MODE: Mode = {
  className: "number",
  begin: BINARY_NUMBER_RE,
  relevance: 0,
};

const REGEXP_MODE: Mode = {
  className: "regexp",
  begin: /\//,
  end: /\/[gimuy]*/,
  illegal: /\n/,
  contains: [
    BACKSLASH_ESCAPE,
    {
      begin: /\[/,
      end: /\]/,
      relevance: 0,
      contains: [BACKSLASH_ESCAPE],
    },
  ],
};

const TITLE_MODE: Mode = {
  className: "title",
  begin: IDENT_RE,
  relevance: 0,
};

const UNDERSCORE_TITLE_MODE: Mode = {
  className: "title",
  begin: UNDERSCORE_IDENT_RE,
  relevance: 0,
};

const METHOD_GUARD: Mode = {
  begin: `\\.\\s*${UNDERSCORE_IDENT_RE}`,
  relevance: 0,
};

function createShebangMode(mode?: Partial<Mode>): Mode {
  return {
    className: "meta",
    begin: /^#![^\n]+/,
    relevance: mode?.relevance ?? 10,
    end: mode?.end ?? "$",
    contains: mode?.contains,
  };
}

function cloneModeShape(mode: Mode): Mode {
  return {
    scope: mode.scope,
    className: mode.className,
    begin: mode.begin,
    match: mode.match,
    end: mode.end,
    beginKeywords: mode.beginKeywords,
    keywords: mode.keywords,
    illegal: mode.illegal,
    contains: mode.contains,
    variants: mode.variants,
    starts: mode.starts,
    subLanguage: mode.subLanguage,
    excludeBegin: mode.excludeBegin,
    excludeEnd: mode.excludeEnd,
    returnBegin: mode.returnBegin,
    returnEnd: mode.returnEnd,
    endsWithParent: mode.endsWithParent,
    endsParent: mode.endsParent,
    skip: mode.skip,
    relevance: mode.relevance,
    case_insensitive: mode.case_insensitive,
    lexemes: mode.lexemes,
    disableAutodetect: mode.disableAutodetect,
  };
}

function endSameAsBegin(mode: Mode): Mode {
  return cloneModeShape(mode);
}

function inheritMode<T extends Mode>(
  parent: T,
  ...overrides: Array<Partial<Mode>>
): Mode {
  let out: Mode = cloneModeShape(parent);
  for (const ov of overrides) {
    if (!ov) {
      continue;
    }
    out = {
      scope: ov.scope !== undefined ? ov.scope : out.scope,
      className: ov.className !== undefined ? ov.className : out.className,
      begin: ov.begin !== undefined ? ov.begin : out.begin,
      match: ov.match !== undefined ? ov.match : out.match,
      end: ov.end !== undefined ? ov.end : out.end,
      beginKeywords: ov.beginKeywords !== undefined ? ov.beginKeywords : out.beginKeywords,
      keywords: ov.keywords !== undefined ? ov.keywords : out.keywords,
      illegal: ov.illegal !== undefined ? ov.illegal : out.illegal,
      contains: ov.contains !== undefined ? ov.contains : out.contains,
      variants: ov.variants !== undefined ? ov.variants : out.variants,
      starts: ov.starts !== undefined ? ov.starts : out.starts,
      subLanguage: ov.subLanguage !== undefined ? ov.subLanguage : out.subLanguage,
      excludeBegin: ov.excludeBegin !== undefined ? ov.excludeBegin : out.excludeBegin,
      excludeEnd: ov.excludeEnd !== undefined ? ov.excludeEnd : out.excludeEnd,
      returnBegin: ov.returnBegin !== undefined ? ov.returnBegin : out.returnBegin,
      returnEnd: ov.returnEnd !== undefined ? ov.returnEnd : out.returnEnd,
      endsWithParent: ov.endsWithParent !== undefined ? ov.endsWithParent : out.endsWithParent,
      endsParent: ov.endsParent !== undefined ? ov.endsParent : out.endsParent,
      skip: ov.skip !== undefined ? ov.skip : out.skip,
      relevance: ov.relevance !== undefined ? ov.relevance : out.relevance,
      case_insensitive: ov.case_insensitive !== undefined ? ov.case_insensitive : out.case_insensitive,
      lexemes: ov.lexemes !== undefined ? ov.lexemes : out.lexemes,
      disableAutodetect: ov.disableAutodetect !== undefined ? ov.disableAutodetect : out.disableAutodetect,
    };
  }
  return out;
}

function escapeHtml(text: string): string {
  if (!text) {
    return "";
  }
  let hasSpecial = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 38 || code === 60 || code === 62 || code === 34 || code === 39) {
      hasSpecial = true;
      break;
    }
  }
  if (!hasSpecial) {
    return text;
  }
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexToGlobal(
  pattern: RegExpLike,
  caseInsensitive: boolean
): RegExp | undefined {
  const source = typeof pattern === "string" ? pattern : pattern.source;
  if (!source) {
    return undefined;
  }
  let flags = "gm";
  if (typeof pattern !== "string") {
    if (pattern.unicode) flags += "u";
    if (pattern.ignoreCase || caseInsensitive) flags += "i";
  } else if (caseInsensitive) {
    flags += "i";
  }
  try {
    return new RegExp(source, flags);
  } catch {
    return undefined;
  }
}

function compileKeywords(
  spec: KeywordsSpec | undefined,
  lexemes: RegExpLike | undefined,
  caseInsensitive: boolean
): CompiledKeywords | undefined {
  if (!spec) {
    return undefined;
  }
  const map = new Map<string, KeywordEntry>();
  let patternSpec: RegExpLike = lexemes ?? "\\w+";

  const addWords = (scope: string | null, words: string | readonly string[]) => {
    const list =
      typeof words === "string" ? words.trim().split(/\s+/) : words;
    for (const rawWord of list) {
      if (!rawWord) {
        continue;
      }
      const pipeIdx = rawWord.indexOf("|");
      const word = pipeIdx === -1 ? rawWord : rawWord.slice(0, pipeIdx);
      if (!word) {
        continue;
      }
      let rel = 1;
      if (pipeIdx !== -1) {
        const parsed = Number.parseInt(rawWord.slice(pipeIdx + 1), 10);
        if (!Number.isNaN(parsed)) {
          rel = parsed;
        }
      } else if (word.length < 3) {
        rel = 0;
      }
      const key = caseInsensitive ? word.toLowerCase() : word;
      map.set(key, { scope, relevance: rel });
    }
  };

  if (typeof spec === "string") {
    addWords("keyword", spec);
  } else {
    if (spec.$pattern) {
      patternSpec = spec.$pattern;
    }
    for (const group of Object.keys(spec)) {
      if (group === "$pattern" || group === "self") {
        continue;
      }
      const val = spec[group];
      if (!val || val instanceof RegExp) {
        continue;
      }
      const scope = group === "_relevance_hints" ? null : group;
      addWords(scope, val);
    }
  }

  if (map.size === 0) {
    return undefined;
  }

  const patternRe = regexToGlobal(patternSpec, caseInsensitive) ?? /\w+/gm;
  return { patternRe, map };
}

function expandModeVariants(mode: Mode): Mode[] {
  if (!mode.variants || mode.variants.length === 0) {
    return [mode];
  }
  const expanded: Mode[] = [];
  for (const variant of mode.variants) {
    const merged: Mode = {
      scope: variant.scope ?? mode.scope,
      className: variant.className ?? mode.className,
      begin: variant.begin ?? variant.match ?? mode.begin ?? mode.match,
      end: variant.end ?? mode.end,
      beginKeywords: variant.beginKeywords ?? mode.beginKeywords,
      keywords: variant.keywords ?? mode.keywords,
      illegal: variant.illegal ?? mode.illegal,
      contains: variant.contains ?? mode.contains,
      starts: variant.starts ?? mode.starts,
      subLanguage: variant.subLanguage ?? mode.subLanguage,
      excludeBegin: variant.excludeBegin ?? mode.excludeBegin,
      excludeEnd: variant.excludeEnd ?? mode.excludeEnd,
      returnBegin: variant.returnBegin ?? mode.returnBegin,
      returnEnd: variant.returnEnd ?? mode.returnEnd,
      endsWithParent: variant.endsWithParent ?? mode.endsWithParent,
      endsParent: variant.endsParent ?? mode.endsParent,
      skip: variant.skip ?? mode.skip,
      relevance: variant.relevance ?? mode.relevance,
      case_insensitive: variant.case_insensitive ?? mode.case_insensitive,
      lexemes: variant.lexemes ?? mode.lexemes,
    };
    expanded.push(...expandModeVariants(merged));
  }
  return expanded;
}

interface ModeCachePair {
  readonly mode: Mode;
  readonly compiled: CompiledMode;
}

function findCachedMode(
  entries: readonly ModeCachePair[],
  mode: Mode
): CompiledMode | undefined {
  for (const pair of entries) {
    if (pair.mode === mode) {
      return pair.compiled;
    }
  }
  return undefined;
}

function compileModeTree(
  rootLang: LanguageDetail,
  parentKeywords: KeywordsSpec | undefined,
  parentCaseInsensitive: boolean
): CompiledMode {
  const modeCache: ModeCachePair[] = [];
  let nextRegexId = 0;
  const wrapRe = (re: RegExp | undefined): RegexEntry | undefined => {
    if (!re) {
      return undefined;
    }
    const id = nextRegexId;
    nextRegexId = id + 1;
    return { id, re };
  };

  const rootMode = cloneModeShape(rootLang);
  let rootCompiledRef: CompiledMode | undefined;

  const compileOne = (
    mode: Mode,
    ci: boolean,
    inheritedKeywords: KeywordsSpec | undefined
  ): CompiledMode => {
    const existing = findCachedMode(modeCache, mode);
    if (existing) {
      return existing;
    }

    const effectiveCi = mode.case_insensitive ?? ci;
    let beginReRaw: RegExp | undefined;
    let beginKeywordSet: Set<string> | undefined;

    if (mode.beginKeywords) {
      const kws = mode.beginKeywords
        .trim()
        .split(/\s+/)
        .map((w) => {
          const idx = w.indexOf("|");
          return idx === -1 ? w : w.slice(0, idx);
        })
        .filter(Boolean);
      if (kws.length > 0) {
        beginKeywordSet = new Set<string>(
          kws.map((w) => (effectiveCi ? w.toLowerCase() : w))
        );
        const escaped = kws.map(escapeRegExp).join("|");
        beginReRaw = regexToGlobal(`\\b(${escaped})\\b`, effectiveCi);
      }
    } else if (mode.match !== undefined) {
      beginReRaw = regexToGlobal(mode.match, effectiveCi);
    } else if (mode.begin !== undefined) {
      beginReRaw = regexToGlobal(mode.begin, effectiveCi);
    }

    const endReRaw = mode.end !== undefined ? regexToGlobal(mode.end, effectiveCi) : undefined;
    const illegalReRaw =
      mode.illegal !== undefined ? regexToGlobal(mode.illegal, effectiveCi) : undefined;

    const kwSpec = mode.keywords ?? (mode === rootMode ? inheritedKeywords : undefined);
    const compiledKw = compileKeywords(kwSpec, mode.lexemes, effectiveCi);

    const subLang = Array.isArray(mode.subLanguage)
      ? mode.subLanguage.length > 0
        ? mode.subLanguage[0]
        : undefined
      : typeof mode.subLanguage === "string"
        ? mode.subLanguage
        : undefined;

    const placeholder: CompiledMode & { starts?: CompiledMode } = {
      source: mode,
      scope: mode.scope ?? mode.className,
      beginRe: wrapRe(beginReRaw),
      endRe: wrapRe(endReRaw),
      illegalRe: wrapRe(illegalReRaw),
      beginKeywordSet,
      keywords: compiledKw,
      contains: [],
      starts: undefined,
      excludeBegin: mode.excludeBegin ?? false,
      excludeEnd: mode.excludeEnd ?? false,
      returnBegin: mode.returnBegin ?? false,
      returnEnd: mode.returnEnd ?? false,
      endsWithParent: mode.endsWithParent ?? false,
      endsParent: mode.endsParent ?? false,
      skip: mode.skip ?? false,
      relevance: mode.relevance ?? 1,
      caseInsensitive: effectiveCi,
      subLanguage: subLang,
    };

    modeCache.push({ mode, compiled: placeholder });
    if (mode === rootMode && !rootCompiledRef) {
      rootCompiledRef = placeholder;
    }

    if (mode.contains) {
      for (const item of mode.contains) {
        if (item === "self") {
          if (rootCompiledRef) {
            placeholder.contains.push(rootCompiledRef);
          }
          continue;
        }
        const variants = expandModeVariants(item);
        for (const variant of variants) {
          placeholder.contains.push(compileOne(variant, effectiveCi, kwSpec));
        }
      }
    }

    if (mode.starts) {
      placeholder.starts = compileOne(mode.starts, effectiveCi, kwSpec);
    }

    return placeholder;
  };

  return compileOne(rootMode, parentCaseInsensitive, parentKeywords);
}

function nextMatchAtOrAfter(
  entry: RegexEntry,
  code: string,
  pos: number,
  cache: Array<CachedExec | undefined>
): RegExpExecArray | null {
  const cached = cache[entry.id];
  if (cached) {
    if (cached.match === null) {
      return null;
    }
    if (cached.match.index >= pos) {
      return cached.match;
    }
  }
  entry.re.lastIndex = pos;
  const match = entry.re.exec(code);
  cache[entry.id] = { pos, match };
  return match;
}

class IllegalTokenError extends Error {}

export function createHljs(): HLJSApi {
  const languages = new Map<string, LanguageDetail>();
  const aliases = new Map<string, string>();
  const compiledCache = new Map<string, CompiledMode>();

  let config: HljsConfig = {
    classPrefix: "hljs-",
    noHighlightRe: /^(no-?highlight)$/i,
    languageDetectRe: /\blang(?:uage)?-([\w-]+)\b/i,
  };

  const resolveLanguageName = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    if (languages.has(lower)) {
      return lower;
    }
    return aliases.get(lower);
  };

  const registerAliases = (
    aliasList: string | readonly string[],
    options: { languageName: string }
  ): void => {
    const list = typeof aliasList === "string" ? [aliasList] : aliasList;
    const target = options.languageName.toLowerCase();
    for (const alias of list) {
      aliases.set(alias.toLowerCase(), target);
    }
  };

  const registerLanguage = (
    languageName: string,
    languageDefinition: LanguageFn
  ): void => {
    const key = languageName.toLowerCase();
    const def = languageDefinition(api);
    languages.set(key, def);
    compiledCache.delete(key);
    if (def.aliases) {
      registerAliases(def.aliases, { languageName: key });
    }
  };

  const unregisterLanguage = (languageName: string): void => {
    const key = languageName.toLowerCase();
    languages.delete(key);
    compiledCache.delete(key);
    for (const [alias, target] of aliases.entries()) {
      if (target === key) {
        aliases.delete(alias);
      }
    }
  };

  const getLanguage = (languageName: string): Language | undefined => {
    if (!languageName) {
      return undefined;
    }
    const resolved = resolveLanguageName(languageName);
    return resolved ? languages.get(resolved) : undefined;
  };

  const listLanguages = (): string[] => {
    return Array.from(languages.keys());
  };

  const autoDetection = (languageName: string): boolean => {
    const lang = getLanguage(languageName);
    return Boolean(lang && !lang.disableAutodetect);
  };

  const configure = (options: Partial<HljsConfig>): void => {
    config = {
      ...config,
      ...options,
    };
  };

  const getCompiled = (langKey: string): CompiledMode => {
    let compiled = compiledCache.get(langKey);
    if (!compiled) {
      const langDef = languages.get(langKey);
      if (!langDef) {
        throw new Error(`Unknown language: "${langKey}"`);
      }
      compiled = compileModeTree(
        langDef,
        langDef.keywords,
        langDef.case_insensitive ?? false
      );
      compiledCache.set(langKey, compiled);
    }
    return compiled;
  };

  const emitKeywordsSegment = (
    text: string,
    kw: CompiledKeywords | undefined,
    caseInsensitive: boolean,
    relevanceOut: { total: number }
  ): string => {
    if (!text) {
      return "";
    }
    if (!kw) {
      return escapeHtml(text);
    }
    const re = kw.patternRe;
    re.lastIndex = 0;
    let out = "";
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const word = match[0];
      if (word.length === 0) {
        re.lastIndex = re.lastIndex + 1;
        continue;
      }
      const lookup = caseInsensitive ? word.toLowerCase() : word;
      const entry = kw.map.get(lookup);
      if (entry) {
        if (match.index > lastIdx) {
          out += escapeHtml(text.slice(lastIdx, match.index));
        }
        relevanceOut.total += entry.relevance;
        if (entry.scope) {
          out += `<span class="${config.classPrefix}${entry.scope}">${escapeHtml(word)}</span>`;
        } else {
          out += escapeHtml(word);
        }
        lastIdx = match.index + word.length;
      }
    }
    if (lastIdx < text.length) {
      out += escapeHtml(text.slice(lastIdx));
    }
    return out;
  };

  const highlightWithCompiled = (
    code: string,
    rootCompiled: CompiledMode,
    ignoreIllegals: boolean
  ): { value: string; relevance: number; illegal: boolean } => {
    const regexCache: Array<CachedExec | undefined> = [];
    const relevanceCounter = { total: 0 };
    const maxDepth = 128;

    const scanMode = (
      mode: CompiledMode,
      startPos: number,
      depth: number,
      ancestorEndRes: readonly RegexEntry[]
    ): { html: string; endPos: number; endedParent: boolean } => {
      let pos = startPos;
      let html = "";

      if (mode.subLanguage && languages.has(mode.subLanguage.toLowerCase())) {
        // Defer sublanguage highlighting when closing delimiter is known.
        if (mode.endRe) {
          const endMatch = nextMatchAtOrAfter(mode.endRe, code, pos, regexCache);
          const sliceEnd = endMatch ? endMatch.index : code.length;
          const subCode = code.slice(pos, sliceEnd);
          const subCompiled = getCompiled(mode.subLanguage.toLowerCase());
          const subRes = highlightWithCompiled(subCode, subCompiled, true);
          relevanceCounter.total += subRes.relevance;
          html += subRes.value;
          if (endMatch) {
            if (mode.excludeEnd) {
              return { html, endPos: endMatch.index, endedParent: false };
            }
            html += escapeHtml(endMatch[0]);
            return {
              html,
              endPos: endMatch.index + endMatch[0].length,
              endedParent: false,
            };
          }
          return { html, endPos: code.length, endedParent: false };
        }
      }

      const childEndAncestors: RegexEntry[] =
        mode.endRe !== undefined
          ? [...ancestorEndRes, mode.endRe]
          : [...ancestorEndRes];

      while (pos < code.length) {
        let bestKind: "end" | "parentEnd" | "child" | "illegal" | "none" = "none";
        let bestIndex = code.length;
        let bestMatch: RegExpExecArray | null = null;
        let bestChild: CompiledMode | undefined;

        if (mode.endRe) {
          const m = nextMatchAtOrAfter(mode.endRe, code, pos, regexCache);
          if (m && m.index < bestIndex) {
            bestKind = "end";
            bestIndex = m.index;
            bestMatch = m;
          }
        }

        if (mode.endsWithParent) {
          for (const parentEnd of ancestorEndRes) {
            const m = nextMatchAtOrAfter(parentEnd, code, pos, regexCache);
            if (m && m.index < bestIndex) {
              bestKind = "parentEnd";
              bestIndex = m.index;
              bestMatch = m;
            }
          }
        }

        for (const child of mode.contains) {
          if (!child.beginRe) {
            continue;
          }
          const m = nextMatchAtOrAfter(child.beginRe, code, pos, regexCache);
          if (m && m.index < bestIndex) {
            bestKind = "child";
            bestIndex = m.index;
            bestMatch = m;
            bestChild = child;
          }
        }

        if (!ignoreIllegals && mode.illegalRe) {
          const m = nextMatchAtOrAfter(mode.illegalRe, code, pos, regexCache);
          if (m && m.index < bestIndex) {
            bestKind = "illegal";
            bestIndex = m.index;
            bestMatch = m;
          }
        }

        if (bestKind === "none" || !bestMatch) {
          html += emitKeywordsSegment(
            code.slice(pos),
            mode.keywords,
            mode.caseInsensitive,
            relevanceCounter
          );
          pos = code.length;
          break;
        }

        if (bestIndex > pos) {
          html += emitKeywordsSegment(
            code.slice(pos, bestIndex),
            mode.keywords,
            mode.caseInsensitive,
            relevanceCounter
          );
          pos = bestIndex;
        }

        if (bestKind === "illegal") {
          throw new IllegalTokenError(
            `Illegal lexeme "${bestMatch[0]}" for mode "${mode.scope ?? "<unnamed>"}"`
          );
        }

        if (bestKind === "parentEnd") {
          return { html, endPos: pos, endedParent: false };
        }

        if (bestKind === "end") {
          const endLen = bestMatch[0].length;
          if (!mode.excludeEnd && !mode.returnEnd && endLen > 0) {
            html += escapeHtml(bestMatch[0]);
            pos += endLen;
          } else if (mode.returnEnd) {
            pos = bestIndex;
          } else if (mode.excludeEnd) {
            pos = bestIndex;
          }
          return { html, endPos: pos, endedParent: mode.endsParent };
        }

        if (bestKind === "child" && bestChild) {
          const beginText = bestMatch[0];
          const beginLen = beginText.length;

          relevanceCounter.total += bestChild.relevance;

          const isAtomic =
            !bestChild.endRe &&
            !bestChild.endsWithParent &&
            bestChild.contains.length === 0;

          if (isAtomic) {
            if (beginLen === 0) {
              html += escapeHtml(code[pos] ?? "");
              pos++;
              continue;
            }
            if (bestChild.beginKeywordSet) {
              html += `<span class="${config.classPrefix}keyword">${escapeHtml(beginText)}</span>`;
            } else if (bestChild.scope && !bestChild.skip) {
              html += `<span class="${config.classPrefix}${bestChild.scope}">${escapeHtml(beginText)}</span>`;
            } else {
              html += escapeHtml(beginText);
            }
            pos += beginLen;
            if (bestChild.starts) {
              const afterStart = scanMode(
                bestChild.starts,
                pos,
                depth + 1,
                childEndAncestors
              );
              if (bestChild.starts.scope && !bestChild.starts.skip) {
                html += `<span class="${config.classPrefix}${bestChild.starts.scope}">${afterStart.html}</span>`;
              } else {
                html += afterStart.html;
              }
              pos = afterStart.endPos;
            }
            continue;
          }

          if (depth >= maxDepth) {
            html += escapeHtml(beginText);
            pos += Math.max(1, beginLen);
            continue;
          }

          let innerStart = bestChild.returnBegin ? bestIndex : bestIndex + beginLen;
          let openHtml = "";

          if (!bestChild.returnBegin && beginLen > 0) {
            if (bestChild.excludeBegin) {
              html += emitKeywordsSegment(
                beginText,
                mode.keywords,
                mode.caseInsensitive,
                relevanceCounter
              );
            } else if (bestChild.beginKeywordSet) {
              openHtml = `<span class="${config.classPrefix}keyword">${escapeHtml(beginText)}</span>`;
            } else {
              openHtml = escapeHtml(beginText);
            }
          }

          const inner = scanMode(
            bestChild,
            innerStart,
            depth + 1,
            childEndAncestors
          );

          // Advance at least 1 char if mode consumed nothing to prevent loops
          let nextPos = inner.endPos;
          if (nextPos <= pos) {
            html += escapeHtml(code[pos] ?? "");
            pos++;
            continue;
          }

          let closeEndHtml = "";
          if (bestChild.excludeEnd && bestChild.endRe) {
            const closeM = nextMatchAtOrAfter(bestChild.endRe, code, nextPos, regexCache);
            if (closeM && closeM.index === nextPos && closeM[0].length > 0) {
              closeEndHtml = escapeHtml(closeM[0]);
              nextPos += closeM[0].length;
            }
          }

          const bodyHtml = openHtml + inner.html;
          if (bestChild.scope && !bestChild.skip && bodyHtml.length > 0) {
            html += `<span class="${config.classPrefix}${bestChild.scope}">${bodyHtml}</span>`;
          } else {
            html += bodyHtml;
          }
          html += closeEndHtml;
          pos = nextPos;

          if (bestChild.starts) {
            const afterStart = scanMode(
              bestChild.starts,
              pos,
              depth + 1,
              childEndAncestors
            );
            if (bestChild.starts.scope && !bestChild.starts.skip) {
              html += `<span class="${config.classPrefix}${bestChild.starts.scope}">${afterStart.html}</span>`;
            } else {
              html += afterStart.html;
            }
            pos = afterStart.endPos;
          }

          if (inner.endedParent) {
            return { html, endPos: pos, endedParent: false };
          }
        }
      }

      return { html, endPos: pos, endedParent: false };
    };

    try {
      const rootResult = scanMode(rootCompiled, 0, 0, []);
      return {
        value: rootResult.html,
        relevance: relevanceCounter.total,
        illegal: false,
      };
    } catch (err) {
      if (err instanceof IllegalTokenError) {
        if (!ignoreIllegals) {
          throw err;
        }
        return {
          value: escapeHtml(code),
          relevance: 0,
          illegal: true,
        };
      }
      throw err;
    }
  };

  function highlight(
    codeOrLanguage: string,
    optionsOrCode: HighlightOptions | string,
    legacyIgnoreIllegals?: boolean
  ): HighlightResult {
    let code: string;
    let languageName: string;
    let ignoreIllegals: boolean;

    if (typeof optionsOrCode === "string") {
      languageName = codeOrLanguage;
      code = optionsOrCode;
      ignoreIllegals = legacyIgnoreIllegals ?? false;
    } else {
      code = codeOrLanguage;
      languageName = optionsOrCode.language;
      ignoreIllegals = optionsOrCode.ignoreIllegals ?? false;
    }

    const resolved = resolveLanguageName(languageName);
    if (!resolved) {
      if (ignoreIllegals) {
        return {
          code,
          value: escapeHtml(code),
          relevance: 0,
          illegal: false,
        };
      }
      throw new Error(`Unknown language: "${languageName}"`);
    }

    const compiled = getCompiled(resolved);
    const res = highlightWithCompiled(code, compiled, ignoreIllegals);
    return {
      code,
      value: res.value,
      relevance: res.relevance,
      language: resolved,
      illegal: res.illegal,
    };
  }

  const highlightAuto = (
    code: string,
    languageSubset?: readonly string[]
  ): AutoHighlightResult => {
    const candidates =
      languageSubset && languageSubset.length > 0
        ? languageSubset
        : config.languages && config.languages.length > 0
          ? config.languages
          : listLanguages();

    let best: HighlightResult = {
      value: escapeHtml(code),
      relevance: 0,
      language: undefined,
      illegal: false,
    };
    let secondBest: HighlightResult = {
      value: escapeHtml(code),
      relevance: 0,
      language: undefined,
      illegal: false,
    };

    for (const candidate of candidates) {
      const resolved = resolveLanguageName(candidate);
      if (!resolved) {
        continue;
      }
      if (!languageSubset && !autoDetection(resolved)) {
        continue;
      }
      let res: HighlightResult;
      try {
        res = highlight(code, { language: resolved, ignoreIllegals: false });
      } catch {
        continue;
      }
      if (res.relevance > secondBest.relevance) {
        secondBest = res;
      }
      if (res.relevance > best.relevance) {
        secondBest = best;
        best = res;
      }
    }

    return {
      value: best.value,
      relevance: best.relevance,
      language: best.language,
      illegal: best.illegal,
      secondBest: secondBest.language
        ? {
            value: secondBest.value,
            relevance: secondBest.relevance,
            language: secondBest.language,
            illegal: secondBest.illegal,
          }
        : undefined,
    };
  };

  const api: HLJSApi = {
    IDENT_RE,
    UNDERSCORE_IDENT_RE,
    NUMBER_RE,
    C_NUMBER_RE,
    BINARY_NUMBER_RE,
    RE_STARTERS_RE,
    SHEBANG: createShebangMode,
    BACKSLASH_ESCAPE,
    APOS_STRING_MODE,
    QUOTE_STRING_MODE,
    PHRASAL_WORDS_MODE,
    COMMENT: createCommentMode,
    C_LINE_COMMENT_MODE,
    C_BLOCK_COMMENT_MODE,
    HASH_COMMENT_MODE,
    NUMBER_MODE,
    C_NUMBER_MODE,
    BINARY_NUMBER_MODE,
    REGEXP_MODE,
    TITLE_MODE,
    UNDERSCORE_TITLE_MODE,
    METHOD_GUARD,
    END_SAME_AS_BEGIN: endSameAsBegin,
    registerLanguage,
    unregisterLanguage,
    registerAliases,
    getLanguage,
    listLanguages,
    autoDetection,
    highlight,
    highlightAuto,
    configure,
    inherit: inheritMode,
  };

  return api;
}

export const hljs: HLJSApi = createHljs();
export default hljs;
