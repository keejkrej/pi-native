import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function typst(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Typst",
    aliases: ["typ"],
    keywords: {
      $pattern: /[a-zA-Z_][\w-]*/,
      keyword:
        "let set show if else for while break continue return import include as in and or not",
      literal: "true false none auto",
      built_in:
        "text heading par list enum table grid stack rect circle ellipse line polygon path image figure align pad block box place page counter state locate query layout measure style rgb luma cmyk oklab oklch",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "code",
        begin: /```[\s\S]*?```|`[^`\n]+`/,
      },
      {
        className: "section",
        begin: /^[ \t]*=+[^\n]*$/m,
      },
      {
        className: "formula",
        begin: /\$/,
        end: /\$/,
      },
      {
        className: "symbol",
        begin: /<[a-zA-Z_][\w:-]*>|@[a-zA-Z_][\w:-]*/,
      },
      {
        className: "keyword",
        begin:
          /#(?:let|set|show|if|else|for|while|break|continue|return|import|include|as|in|and|or|not)\b/,
      },
      {
        className: "title",
        begin: /#[a-zA-Z_][\w-]*/,
      },
      hljs.QUOTE_STRING_MODE,
      {
        className: "number",
        begin: /\b\d+(?:\.\d+)?(?:pt|mm|cm|in|em|fr|deg|rad|%)?\b/,
        relevance: 0,
      },
    ],
  };
}
