import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function graphql(hljs: HLJSApi): LanguageDetail {
  return {
    name: "GraphQL",
    aliases: ["gql"],
    keywords: {
      keyword:
        "query mutation subscription fragment on type interface union enum input extend schema directive scalar implements repeatable",
      type: "Int Float String Boolean ID",
      literal: "true false null",
    },
    illegal: /;/,
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        className: "string",
        begin: /"""/,
        end: /"""/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      hljs.QUOTE_STRING_MODE,
      {
        className: "meta",
        begin: /@[A-Za-z_]\w*/,
      },
      {
        className: "variable",
        begin: /\$[A-Za-z_]\w*/,
      },
      {
        beginKeywords:
          "query mutation subscription fragment type interface union enum input scalar directive schema",
        end: /[({@=\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
      {
        className: "punctuation",
        begin: /\.\.\.|[{}()[\]:!=|&]/,
        relevance: 0,
      },
    ],
  };
}
