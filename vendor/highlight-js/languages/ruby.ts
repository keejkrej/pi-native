import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function ruby(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    begin: /#\{/,
    end: /\}/,
    contains: [hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
  };

  return {
    name: "Ruby",
    aliases: ["rb", "gemspec", "podspec", "thor", "irb"],
    keywords: {
      keyword:
        "and then defined module in return redo if BEGIN retry end for self when next until do begin unless END rescue else break undef not super class case require yield alias while ensure elsif or include attr_reader attr_writer attr_accessor __FILE__",
      built_in: "proc lambda",
      literal: "true false nil",
    },
    contains: [
      hljs.SHEBANG(),
      hljs.COMMENT(/^=begin/, /^=end/),
      hljs.HASH_COMMENT_MODE,
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      hljs.APOS_STRING_MODE,
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
        beginKeywords: "def class module",
        end: /[{;\n(]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin: /\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?)\b/,
        relevance: 0,
      },
    ],
  };
}
