import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function json(hljs: HLJSApi): LanguageDetail {
  return {
    name: "JSON",
    aliases: ["jsonc", "jsonl"],
    keywords: {
      literal: "true false null",
    },
    illegal: "\\S",
    contains: [
      hljs.inherit(hljs.C_LINE_COMMENT_MODE, { relevance: 0 }),
      hljs.inherit(hljs.C_BLOCK_COMMENT_MODE, { relevance: 0 }),
      {
        className: "attr",
        begin: /"(?:\\.|[^\\"\n])*"(?=\s*:)/,
        relevance: 1,
      },
      hljs.QUOTE_STRING_MODE,
      hljs.C_NUMBER_MODE,
      {
        className: "literal",
        begin: /\b(?:true|false|null)\b/,
        relevance: 1,
      },
      {
        className: "punctuation",
        begin: /[{}[\],:]/,
        relevance: 0,
      },
    ],
  };
}
