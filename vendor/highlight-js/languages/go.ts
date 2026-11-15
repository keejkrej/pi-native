import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function go(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Go",
    aliases: ["golang"],
    keywords: {
      keyword:
        "break default func interface select case map struct chan else goto package switch const fallthrough if range type continue for import return var go defer bool byte complex64 complex128 float32 float64 int8 int16 int32 int64 string uint8 uint16 uint32 uint64 int uint uintptr rune",
      literal: "true false iota nil",
      built_in:
        "append cap close complex copy imag len make new panic print println real recover delete",
    },
    illegal: "</",
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "string",
        variants: [
          hljs.QUOTE_STRING_MODE,
          { begin: /'(?:\\.|[^'\\\n])'/ },
          { begin: /`/, end: /`/ },
        ],
      },
      {
        className: "number",
        variants: [
          { begin: /\b0[xX][0-9a-fA-F_]+(?:\.[0-9a-fA-F_]*)?(?:[pP][-+]?\d+)?i?\b/ },
          { begin: /\b0[bBoO][01_]+i?\b/ },
          { begin: /\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d[\d_]*)?i?\b/ },
        ],
        relevance: 0,
      },
      {
        beginKeywords: "func type",
        end: /[({\n]/,
        excludeEnd: true,
        contains: [hljs.TITLE_MODE],
      },
    ],
  };
}
