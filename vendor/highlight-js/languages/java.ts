import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function java(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Java",
    aliases: ["jsp"],
    keywords:
      "false synchronized int abstract float private char boolean var static null if const for true while long strictfp finally protected import native final void enum else break transient catch instanceof byte super volatile case assert short package default double public try this switch continue throws module requires exports do record sealed non-sealed permits",
    illegal: /<\/|#/,
    contains: [
      hljs.COMMENT("/\\*\\*", "\\*/", {
        contains: [{ className: "doctag", begin: /@[A-Za-z]+/ }],
      }),
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      { className: "string", begin: /"""/, end: /"""/, contains: [hljs.BACKSLASH_ESCAPE] },
      hljs.QUOTE_STRING_MODE,
      { className: "string", begin: /'(?:\\.|[^'\\\n])'/ },
      { className: "meta", begin: /@[A-Za-z_]\w*/ },
      {
        beginKeywords: "class interface enum record",
        end: /[{(\n<]/,
        excludeEnd: true,
        contains: [hljs.TITLE_MODE],
      },
      {
        className: "number",
        begin: /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d[\d_]*)?)[lLfFdD]?\b/,
        relevance: 0,
      },
    ],
  };
}
