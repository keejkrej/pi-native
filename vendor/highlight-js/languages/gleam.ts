import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function gleam(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Gleam",
    keywords: {
      keyword:
        "as assert case const echo external fn if import let opaque panic pub todo type use",
      type: "Int Float String Bool BitArray List Result Option Nil Dynamic",
      literal: "True False Ok Error Some None Nil",
    },
    contains: [
      hljs.COMMENT("///", "$"),
      hljs.C_LINE_COMMENT_MODE,
      {
        className: "meta",
        begin: /@[a-z_]\w*/,
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      {
        beginKeywords: "fn type",
        end: /[({\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?)\b/,
        relevance: 0,
      },
    ],
  };
}
