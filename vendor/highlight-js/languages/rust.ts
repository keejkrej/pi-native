import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function rust(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Rust",
    aliases: ["rs"],
    keywords: {
      $pattern: /[a-zA-Z]\w*!?/,
      keyword:
        "abstract as async await become box break const continue crate do dyn else enum extern false final fn for if impl in let loop macro match mod move mut override priv pub ref return self Self static struct super trait true try type typeof unsafe unsized use virtual where while yield",
      literal: "true false Some None Ok Err",
      built_in:
        "drop i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 str char bool Box Option Result String Vec Copy Send Sized Sync Drop Fn FnMut FnOnce ToOwned Clone Debug PartialEq PartialOrd Eq Ord AsRef AsMut Into From Default Iterator Extend IntoIterator assert! assert_eq! assert_ne! cfg! env! format! format_args! include_str! panic! print! println! stringify! todo! unimplemented! unreachable! vec! write! writeln! macro_rules!",
    },
    illegal: "</",
    contains: [
      hljs.COMMENT("///", "$"),
      hljs.COMMENT("//!", "$"),
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "meta",
        begin: /#!?\[/,
        end: /\]/,
        contains: [hljs.QUOTE_STRING_MODE],
      },
      {
        className: "string",
        variants: [
          { begin: /b?r#*"/, end: /"#*/ },
          { begin: /b?"/, end: /"/, contains: [hljs.BACKSLASH_ESCAPE] },
        ],
      },
      {
        className: "string",
        begin: /b?'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^'\\])'/,
      },
      {
        className: "symbol",
        begin: /'[a-zA-Z_]\w*/,
      },
      {
        beginKeywords: "fn struct enum trait impl mod type",
        end: /[{(<;:\s]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        variants: [
          { begin: /\b0[xX][0-9a-fA-F_]+(?:[iu](?:8|16|32|64|128|size))?\b/ },
          { begin: /\b0[bB][01_]+(?:[iu](?:8|16|32|64|128|size))?\b/ },
          { begin: /\b0[oO][0-7_]+(?:[iu](?:8|16|32|64|128|size))?\b/ },
          {
            begin:
              /\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][-+]?\d[\d_]*)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?\b/,
          },
        ],
        relevance: 0,
      },
    ],
  };
}
