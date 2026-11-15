import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function vue(hljs: HLJSApi): LanguageDetail {
  const TAG_ATTRS: Mode = {
    endsWithParent: true,
    relevance: 0,
    contains: [
      {
        className: "keyword",
        begin: /(?:v-[a-zA-Z0-9_.:-]+|[@:#][a-zA-Z0-9_.:-]+)(?=\s*=|\s|\/?>)/,
        relevance: 2,
      },
      {
        className: "attr",
        begin: /[a-zA-Z_:][\w:.-]*(?=\s*=)/,
        relevance: 0,
      },
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
    ],
  };

  return {
    name: "Vue",
    contains: [
      hljs.COMMENT("<!--", "-->", { relevance: 10 }),
      {
        className: "tag",
        begin:
          /<(?=script\s+(?:(?:"[^"]*"|'[^']*'|\/(?!>)|[^/>"'])*\s)?lang\s*=\s*(?:"(?:ts|tsx|typescript)"|'(?:ts|tsx|typescript)')(?:\s+(?:"[^"]*"|'[^']*'|\/(?!>)|[^/>"'])*)?>)/i,
        end: />/,
        contains: [
          {
            className: "name",
            begin: /script/i,
            relevance: 0,
            starts: TAG_ATTRS,
          },
        ],
        starts: {
          end: /<\/script>/i,
          excludeEnd: true,
          subLanguage: "typescript",
        },
      },
      {
        className: "tag",
        begin: /<(?=script(?:\s+(?:"[^"]*"|'[^']*'|\/(?!>)|[^/>"'])*)?>)/i,
        end: />/,
        contains: [
          {
            className: "name",
            begin: /script/i,
            relevance: 0,
            starts: TAG_ATTRS,
          },
        ],
        starts: {
          end: /<\/script>/i,
          excludeEnd: true,
          subLanguage: "javascript",
        },
      },
      {
        className: "tag",
        begin: /<(?=style(?:\s+(?:"[^"]*"|'[^']*'|\/(?!>)|[^/>"'])*)?>)/i,
        end: />/,
        contains: [
          {
            className: "name",
            begin: /style/i,
            relevance: 0,
            starts: TAG_ATTRS,
          },
        ],
        starts: {
          end: /<\/style>/i,
          excludeEnd: true,
          subLanguage: "css",
        },
      },
      {
        className: "template-variable",
        begin: /\{\{/,
        end: /\}\}/,
        keywords: {
          keyword: "true false null undefined typeof instanceof in of",
        },
        contains: [hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
      },
      {
        className: "tag",
        begin: /<\/?(?=[a-zA-Z])/,
        end: /\/?>/,
        contains: [
          {
            className: "name",
            begin: /[a-zA-Z][\w.:-]*/,
            relevance: 0,
            starts: TAG_ATTRS,
          },
        ],
      },
    ],
  };
}
