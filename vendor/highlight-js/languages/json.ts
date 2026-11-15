import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function json(hljs: HLJSApi): LanguageDetail {
  return {
    name: "JSON",
    keywords: {
      literal: "true false null",
    },
    illegal: "\\S",
    contains: [
      {
        className: "attr",
        begin: /"(?:\\.|[^\\"\n])*"(?=\s*:)/,
        relevance: 1,
      },
      hljs.QUOTE_STRING_MODE,
      hljs.C_NUMBER_MODE,
      {
        className: "punctuation",
        begin: /[{}[\],:]/,
        relevance: 0,
      },
    ],
  };
}
