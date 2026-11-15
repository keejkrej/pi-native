import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function odin(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Odin",
    keywords: {
      keyword:
        "align_of asm auto_cast bit_field bit_set break case cast context continue defer distinct do dynamic else enum fallthrough for foreign if import in map matrix not_in offset_of or_break or_continue or_else or_return package proc return size_of struct switch transmute type_info_of type_of typeid union using when where",
      type:
        "bool b8 b16 b32 b64 int i8 i16 i32 i64 i128 uint u8 u16 u32 u64 u128 uintptr i16le i32le i64le i128le u16le u32le u64le u128le i16be i32be i64be i128be u16be u32be u64be u128be f16 f32 f64 f16le f32le f64le f16be f32be f64be complex32 complex64 complex128 quaternion64 quaternion128 quaternion256 rune string cstring rawptr any typeid",
      literal: "true false nil",
      built_in:
        "len cap size_of align_of offset_of type_of type_info_of make new delete append clear reserve resize shrink copy panic assert min max abs clamp",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "meta",
        begin: /#[a-zA-Z_]\w*/,
      },
      {
        className: "meta",
        begin: /@(?:\([^)]*\)|[a-zA-Z_]\w*)/,
      },
      {
        className: "string",
        begin: /`/,
        end: /`/,
      },
      hljs.QUOTE_STRING_MODE,
      {
        className: "string",
        begin: /'(?:\\.|[^'\\\n])'/,
        relevance: 0,
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|0[zZ][0-9a-zA-Z_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?[ijk]?)\b/,
        relevance: 0,
      },
    ],
  };
}
