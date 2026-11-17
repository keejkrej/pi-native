import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function awk(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Awk",
    keywords: {
      keyword:
        "BEGIN END if else while do for in break continue delete exit function return next nextfile getline print printf",
      built_in:
        "ARGC ARGV CONVFMT ENVIRON FILENAME FNR FS NF NR OFMT OFS ORS RLENGTH RS RSTART SUBSEP atan2 cos exp int log rand sin sqrt srand gsub index length match split sprintf sub substr tolower toupper close fflush system",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      {
        begin: /(?:~|!~|\(|,|&&|\|\||^|\?|:)[ \t]*(?=\/)/,
        excludeBegin: true,
        end: /(?=$|\s|[;,.)\]}])/,
        contains: [
          {
            className: "regexp",
            begin: /\//,
            end: /\/[gimuy]*/,
            endsParent: true,
            illegal: /\n/,
            contains: [
              hljs.BACKSLASH_ESCAPE,
              {
                begin: /\[/,
                end: /\]/,
                relevance: 0,
                contains: [hljs.BACKSLASH_ESCAPE],
              },
            ],
          },
        ],
      },
      {
        className: "variable",
        begin: /\$(?:\d+|[A-Za-z_]\w*)/,
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
