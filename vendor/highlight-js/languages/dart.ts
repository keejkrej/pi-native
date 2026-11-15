import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function dart(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    variants: [
      { begin: /\$\{[A-Za-z0-9_]+\}/ },
      { begin: /\$[A-Za-z0-9_]+/ },
    ],
  };

  return {
    name: "Dart",
    keywords: {
      keyword:
        "abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield",
      built_in: [
        "Comparable", "DateTime", "Duration", "Function", "Iterable", "Iterator",
        "List", "Map", "Match", "Object", "Pattern", "RegExp", "Set", "Stopwatch",
        "String", "StringBuffer", "StringSink", "Symbol", "Type", "Uri", "bool",
        "double", "int", "num", "Never", "Null", "dynamic", "print", "document",
        "querySelector", "querySelectorAll", "window",
      ],
      $pattern: /[A-Za-z_]\w*\??/,
    },
    contains: [
      hljs.COMMENT("///", "$"),
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      { className: "string", begin: /r'''/, end: /'''/ },
      { className: "string", begin: /r"""/, end: /"""/ },
      { className: "string", begin: /r'/, end: /'/ },
      { className: "string", begin: /r"/, end: /"/ },
      {
        className: "string",
        begin: /'''/,
        end: /'''/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "string",
        begin: /"""/,
        end: /"""/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "string",
        begin: /'/,
        end: /'/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "meta",
        begin: /@[A-Za-z_]\w*/,
      },
      {
        beginKeywords: "class enum mixin extension",
        end: /[{<]/,
        excludeEnd: true,
        contains: [hljs.TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
