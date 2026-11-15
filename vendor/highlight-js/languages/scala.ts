import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function scala(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    variants: [
      { begin: /\$\{/, end: /\}/, contains: [hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE] },
      { begin: /\$[A-Za-z_]\w*/ },
    ],
  };

  return {
    name: "Scala",
    keywords: {
      literal: "true false null",
      keyword:
        "type yield lazy override def with val var sealed abstract private trait object if forSome for while throw finally protected extends import final return else break new catch super class case package default try this match continue throws implicit given using enum export then do",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      { className: "string", begin: /[sf]?"""/, end: /"""/, contains: [SUBST] },
      {
        className: "string",
        begin: /[sf]"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      hljs.QUOTE_STRING_MODE,
      { className: "string", begin: /'(?:\\.|[^'\\\n])'/ },
      { className: "meta", begin: /@[A-Za-z_]\w*/ },
      {
        beginKeywords: "def class trait object enum type",
        end: /[{(\[=:\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
