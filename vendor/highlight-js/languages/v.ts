import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function v(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    variants: [
      {
        begin: /\$\{/,
        end: /\}/,
        contains: [hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
      },
      { begin: /\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/ },
    ],
  };

  return {
    name: "V",
    aliases: ["vlang"],
    keywords: {
      keyword:
        "as asm assert atomic break const continue defer else enum false fn for go goto if import in interface is lock match module mut none or pub return rlock select shared sizeof spawn static struct true type typeof union unsafe volatile __offsetof",
      type:
        "bool string i8 i16 int i64 i128 u8 u16 u32 u64 u128 rune f32 f64 isize usize voidptr any chan map",
      literal: "true false none",
      built_in: "println print eprintln eprint panic exit dump",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "meta",
        begin: /@?\[[a-zA-Z_][\w:;,\s='"]*\]/,
      },
      {
        className: "string",
        begin: /[rc]'/,
        end: /'/,
        illegal: /\n/,
      },
      {
        className: "string",
        begin: /[rc]"/,
        end: /"/,
        illegal: /\n/,
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
        beginKeywords: "fn struct enum interface type module",
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
