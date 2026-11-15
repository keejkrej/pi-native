import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function fsharp(hljs: HLJSApi): LanguageDetail {
  return {
    name: "F#",
    aliases: ["fs"],
    keywords: {
      keyword:
        "abstract and as assert base begin class default delegate do done downcast downto elif else end exception extern false finally for fun function global if in inherit inline interface internal lazy let match member module mutable namespace new not null of open or override private public rec return select static struct then to true try type upcast use val void when while with yield",
      type:
        "bool byte sbyte int16 uint16 int uint int64 uint64 single float double decimal char string obj unit list seq array option Result Async Task",
      literal: "true false null None Some Ok Error",
      built_in:
        "printf printfn sprintf failwith ignore id fst snd List Array Seq Map Set Option Result Async",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.COMMENT("\\(\\*", "\\*\\)"),
      {
        className: "meta",
        begin: /\[</,
        end: />\]/,
      },
      {
        className: "meta",
        begin: /^[ \t]*#[a-z]+/m,
        end: /$/,
      },
      {
        className: "string",
        begin: /@"/,
        end: /"/,
      },
      {
        className: "string",
        begin: /"""/,
        end: /"""/,
      },
      hljs.QUOTE_STRING_MODE,
      {
        className: "string",
        begin: /'(?:\\.|[^'\\\n])'/,
        relevance: 0,
      },
      {
        className: "symbol",
        begin: /'[a-zA-Z_]\w*/,
        relevance: 0,
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?)[uUlLfFmM]?\b/,
        relevance: 0,
      },
    ],
  };
}
