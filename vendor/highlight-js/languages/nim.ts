import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function nim(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Nim",
    keywords: {
      keyword:
        "addr and as asm bind block break case cast concept const continue converter defer discard distinct div do elif else end enum except export finally for from func if import in include interface is isnot iterator let macro method mixin mod nil not notin object of or out proc ptr raise ref return shl shr static template try tuple type using var when while xor yield",
      type:
        "int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float float32 float64 bool char string cstring pointer seq array set openArray varargs void auto any",
      literal: "true false nil",
      built_in:
        "echo assert len add del pop low high ord chr inc dec succ pred repr defined compiles typeof sizeof alignof",
    },
    contains: [
      hljs.COMMENT(/##\[/, /\]##/),
      hljs.COMMENT(/#\[/, /\]#/),
      hljs.HASH_COMMENT_MODE,
      {
        className: "meta",
        begin: /\{\./,
        end: /\.\}/,
      },
      {
        className: "string",
        begin: /r"/,
        end: /"/,
        illegal: /\n/,
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
        beginKeywords: "proc func method iterator template macro converter",
        end: /[(*[:=\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?)(?:'?[iuIU](?:8|16|32|64)|'?[fF](?:32|64))?\b/,
        relevance: 0,
      },
    ],
  };
}
