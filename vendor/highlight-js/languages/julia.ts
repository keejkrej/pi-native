import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function julia(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    variants: [
      {
        begin: /\$\(/,
        end: /\)/,
        contains: [hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
      },
      { begin: /\$[A-Za-z_]\w*/ },
    ],
  };

  return {
    name: "Julia",
    aliases: ["jl"],
    keywords: {
      $pattern: /[A-Za-z_]\w*!?/,
      keyword:
        "baremodule begin break catch const continue do else elseif end export finally for function global if import let local macro module mutable primitive quote return struct try type using where while abstract in isa",
      literal: "true false nothing missing NaN Inf im pi",
      type:
        "Any AbstractArray AbstractFloat AbstractString Array Bool Char Complex Dict Float16 Float32 Float64 Int Int8 Int16 Int32 Int64 Int128 Integer Matrix Nothing Number Real Set String Symbol Tuple UInt UInt8 UInt16 UInt32 UInt64 UInt128 Union Vector",
      built_in:
        "println print show repr length size push! pop! append! map filter reduce collect range enumerate zip keys values haskey get! delete! sort sort! reverse sum prod minimum maximum argmin argmax typeof isa convert parse error throw",
    },
    contains: [
      hljs.COMMENT(/#=/, /=#/),
      hljs.HASH_COMMENT_MODE,
      {
        className: "string",
        begin: /(?:r|raw)"""/,
        end: /"""/,
      },
      {
        className: "string",
        begin: /(?:r|raw)"/,
        end: /"/,
        illegal: /\n/,
      },
      {
        className: "string",
        begin: /"""/,
        end: /"""/,
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
        className: "string",
        begin: /'(?:\\.|[^'\\\n])'/,
        relevance: 0,
      },
      {
        className: "symbol",
        begin: /:[A-Za-z_]\w*/,
      },
      {
        className: "meta",
        begin: /@[A-Za-z_][\w!]*/,
      },
      {
        beginKeywords: "function macro struct module",
        end: /[({<\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eEf][-+]?\d+)?)(?:im)?\b/,
        relevance: 0,
      },
    ],
  };
}
