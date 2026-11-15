import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function python(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    begin: /\{/,
    end: /\}/,
    contains: [hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
  };

  return {
    name: "Python",
    aliases: ["py", "gyp", "ipython"],
    keywords: {
      $pattern: /[A-Za-z]\w*|\b_\b/,
      keyword: [
        "and", "as", "assert", "async", "await", "break", "class", "continue",
        "def", "del", "elif", "else", "except", "finally", "for", "from",
        "global", "if", "import", "in", "is", "lambda", "nonlocal|10", "not",
        "or", "pass", "raise", "return", "try", "while", "with", "yield",
        "match", "case",
      ],
      built_in: [
        "__import__", "abs", "all", "any", "ascii", "bin", "bool",
        "breakpoint", "bytearray", "bytes", "callable", "chr", "classmethod",
        "compile", "complex", "delattr", "dict", "dir", "divmod", "enumerate",
        "eval", "exec", "filter", "float", "format", "frozenset", "getattr",
        "globals", "hasattr", "hash", "help", "hex", "id", "input", "int",
        "isinstance", "issubclass", "iter", "len", "list", "locals", "map",
        "max", "memoryview", "min", "next", "object", "oct", "open", "ord",
        "pow", "print", "property", "range", "repr", "reversed", "round", "set",
        "setattr", "slice", "sorted", "staticmethod", "str", "sum", "super",
        "tuple", "type", "vars", "zip",
      ],
      literal: ["__debug__", "Ellipsis", "False", "None", "NotImplemented", "True"],
      type: [
        "Any", "Callable", "Coroutine", "Dict", "List", "Literal", "Generic",
        "Optional", "Sequence", "Set", "Tuple", "Type", "Union",
      ],
    },
    illegal: /(<\/|->|\?)|=>/,
    contains: [
      hljs.SHEBANG(),
      hljs.HASH_COMMENT_MODE,
      {
        className: "meta",
        begin: /^[ \t]*@[A-Za-z_][A-Za-z0-9_.]*/m,
      },
      {
        className: "string",
        variants: [
          { begin: /(?:[fF][rR]?|[rR][fF])"""/, end: /"""/, contains: [hljs.BACKSLASH_ESCAPE, SUBST] },
          { begin: /(?:[fF][rR]?|[rR][fF])'''/, end: /'''/, contains: [hljs.BACKSLASH_ESCAPE, SUBST] },
          { begin: /(?:[uUbBrR])?"""/, end: /"""/, contains: [hljs.BACKSLASH_ESCAPE] },
          { begin: /(?:[uUbBrR])?'''/, end: /'''/, contains: [hljs.BACKSLASH_ESCAPE] },
          { begin: /(?:[fF][rR]?|[rR][fF])"/, end: /"/, illegal: /\n/, contains: [hljs.BACKSLASH_ESCAPE, SUBST] },
          { begin: /(?:[fF][rR]?|[rR][fF])'/, end: /'/, illegal: /\n/, contains: [hljs.BACKSLASH_ESCAPE, SUBST] },
          { begin: /(?:[uUbBrR])?"/, end: /"/, illegal: /\n/, contains: [hljs.BACKSLASH_ESCAPE] },
          { begin: /(?:[uUbBrR])?'/, end: /'/, illegal: /\n/, contains: [hljs.BACKSLASH_ESCAPE] },
        ],
      },
      {
        beginKeywords: "def class",
        end: /[:\n]/,
        excludeEnd: true,
        contains: [
          hljs.UNDERSCORE_TITLE_MODE,
          {
            className: "params",
            begin: /\(/,
            end: /\)/,
            excludeBegin: true,
            excludeEnd: true,
            contains: [hljs.HASH_COMMENT_MODE, hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE],
          },
        ],
      },
      {
        className: "number",
        variants: [
          { begin: /\b0[xX][0-9a-fA-F_]+[jJ]?\b/ },
          { begin: /\b0[bB][01_]+[jJ]?\b/ },
          { begin: /\b0[oO][0-7_]+[jJ]?\b/ },
          { begin: /\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d[\d_]*)?[jJ]?\b/ },
        ],
        relevance: 0,
      },
    ],
  };
}
