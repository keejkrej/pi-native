import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function kotlin(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    variants: [
      { begin: /\$\{/, end: /\}/, contains: [hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE] },
      { begin: /\$[A-Za-z_]\w*/ },
    ],
  };

  return {
    name: "Kotlin",
    aliases: ["kt", "kts"],
    keywords: {
      keyword:
        "abstract as val var vararg get set class object open private protected public noinline crossinline dynamic final enum if else do while for when throw try catch finally import package is in fun override companion reified inline lateinit init interface annotation data sealed internal infix operator out by constructor super tailrec where const inner suspend typealias external expect actual",
      built_in: "Byte Short Char Int Long Boolean Float Double Void Unit Nothing",
      literal: "true false null",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "string",
        begin: /"""/,
        end: /"""/,
        contains: [SUBST],
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "string",
        begin: /'(?:\\.|[^'\\\n])'/,
      },
      {
        className: "meta",
        begin: /@[A-Za-z_]\w*(?::[A-Za-z_]\w*)?/,
      },
      {
        beginKeywords: "class interface object fun typealias",
        end: /[{(:<\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin: /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d[\d_]*)?)[fFlLuU]?\b/,
        relevance: 0,
      },
    ],
  };
}
