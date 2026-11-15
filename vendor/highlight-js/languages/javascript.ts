import type { HLJSApi, KeywordsSpec, LanguageDetail, Mode } from "../core.ts";

export default function javascript(hljs: HLJSApi): LanguageDetail {
  const KEYWORDS: KeywordsSpec = {
    $pattern: /[A-Za-z$_][0-9A-Za-z$_]*/,
    keyword: [
      "as", "in", "of", "if", "for", "while", "finally", "var", "new",
      "function", "do", "return", "void", "else", "break", "catch",
      "instanceof", "with", "throw", "case", "default", "try", "switch",
      "continue", "typeof", "delete", "let", "yield", "const", "class",
      "debugger", "async", "await", "static", "import", "from", "export",
      "extends",
    ],
    literal: ["true", "false", "null", "undefined", "NaN", "Infinity"],
    built_in: [
      "setInterval", "setTimeout", "clearInterval", "clearTimeout", "require",
      "exports", "eval", "isFinite", "isNaN", "parseFloat", "parseInt",
      "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
      "escape", "unescape", "arguments", "this", "super", "console", "window",
      "document", "localStorage", "module", "global", "Intl", "DataView",
      "Number", "Math", "Date", "String", "RegExp", "Object", "Function",
      "Boolean", "Error", "Symbol", "Set", "Map", "WeakSet", "WeakMap",
      "Proxy", "Reflect", "JSON", "Promise", "Float64Array", "Int16Array",
      "Int32Array", "Int8Array", "Uint16Array", "Uint32Array", "Float32Array",
      "Array", "Uint8Array", "Uint8ClampedArray", "ArrayBuffer",
      "BigInt64Array", "BigUint64Array", "BigInt", "EvalError", "InternalError",
      "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError",
    ],
  };

  const NUMBER_MODE: Mode = {
    className: "number",
    variants: [
      { begin: /\b0[xX][0-9a-fA-F_]+n?\b/ },
      { begin: /\b0[bB][01_]+n?\b/ },
      { begin: /\b0[oO][0-7_]+n?\b/ },
      { begin: /\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d[\d_]*)?n?\b/ },
    ],
    relevance: 0,
  };

  const REGEX_AFTER_STARTER: Mode = {
    begin: `(?:^|${hljs.RE_STARTERS_RE})\\s*(?=\\/(?![/*]))`,
    excludeBegin: true,
    end: /(?=$|\s|[;,.)\]}])/,
    contains: [
      {
        className: "regexp",
        begin: /\//,
        end: /\/[dgimsuy]*/,
        endsParent: true,
        illegal: /\n/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          { begin: /\[/, end: /\]/, relevance: 0, contains: [hljs.BACKSLASH_ESCAPE] },
        ],
      },
    ],
  };

  const SUBST_CONTAINS: Array<Mode | "self"> = [
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    NUMBER_MODE,
    REGEX_AFTER_STARTER,
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    { begin: /\{/, end: /\}/, contains: ["self"] },
  ];

  const SUBST: Mode = {
    className: "subst",
    begin: /\$\{/,
    end: /\}/,
    keywords: KEYWORDS,
    contains: SUBST_CONTAINS,
  };

  const TEMPLATE_STRING: Mode = {
    className: "string",
    begin: /`/,
    end: /`/,
    contains: [hljs.BACKSLASH_ESCAPE, SUBST],
  };

  SUBST_CONTAINS.push(TEMPLATE_STRING);

  return {
    name: "Javascript",
    aliases: ["js", "jsx", "mjs", "cjs"],
    keywords: KEYWORDS,
    contains: [
      hljs.SHEBANG(),
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      TEMPLATE_STRING,
      REGEX_AFTER_STARTER,
      NUMBER_MODE,
      {
        beginKeywords: "function class",
        end: /[{(;]/,
        excludeEnd: true,
        contains: [
          hljs.UNDERSCORE_TITLE_MODE,
          {
            className: "params",
            begin: /\(/,
            end: /\)/,
            excludeBegin: true,
            excludeEnd: true,
            contains: [hljs.C_LINE_COMMENT_MODE, hljs.C_BLOCK_COMMENT_MODE],
          },
        ],
      },
    ],
  };
}
