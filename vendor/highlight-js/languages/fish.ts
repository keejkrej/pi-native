import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function fish(hljs: HLJSApi): LanguageDetail {
  const VAR: Mode = {
    className: "variable",
    begin: /\$[A-Za-z_]\w*/,
  };

  return {
    name: "Fish",
    keywords: {
      keyword:
        "if else end switch case for in while break continue function return begin and or not",
      built_in:
        "set read test string math status count contains argparse command builtin exec eval exit source echo printf cd pwd pushd popd jobs fg bg kill wait disown trap umask alias abbr bind set_color complete commandline functions emit random seq sleep",
      literal: "true false",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE, VAR],
      },
      hljs.APOS_STRING_MODE,
      VAR,
      {
        beginKeywords: "function",
        end: /[\n;]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
