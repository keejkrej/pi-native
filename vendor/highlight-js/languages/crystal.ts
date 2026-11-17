import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function crystal(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    begin: /#\{/,
    end: /\}/,
    contains: [hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
  };

  return {
    name: "Crystal",
    aliases: ["cr"],
    keywords: {
      $pattern: /[a-zA-Z_]\w*[!?]?/,
      keyword:
        "abstract alias annotation as as? asm begin break case class def do else elsif end ensure enum extend for fun if in include instance_sizeof is_a? lib macro module next nil? of out pointerof private protected require rescue responds_to? return select self sizeof struct super then type typeof uninitialized union unless until verbatim when while with yield",
      type:
        "Int8 Int16 Int32 Int64 Int128 UInt8 UInt16 UInt32 UInt64 UInt128 Float32 Float64 Bool Char String Symbol Array Hash Set Tuple NamedTuple Range Regex Proc Pointer Nil Void NoReturn",
      literal: "true false nil",
      built_in: "puts print p pp raise spawn sleep",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        className: "meta",
        begin: /@\[/,
        end: /\]/,
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "string",
        begin: /'(?:\\.|[^'\\\n])'/,
        relevance: 0,
      },
      {
        className: "symbol",
        begin: /:[A-Za-z_]\w*[!?=]?/,
        relevance: 0,
      },
      {
        className: "variable",
        begin: /(?:@@?|\$)[A-Za-z_]\w*/,
      },
      {
        beginKeywords: "def class struct module enum lib macro",
        end: /[{(\n<;]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?)(?:_[iu](?:8|16|32|64|128)|_f(?:32|64))?\b/,
        relevance: 0,
      },
    ],
  };
}
