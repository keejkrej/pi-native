import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function svelte(hljs: HLJSApi): LanguageDetail {
  const EXPR_CONTAINS: Array<Mode | "self"> = [
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    hljs.C_NUMBER_MODE,
    {
      begin: /\{/,
      end: /\}/,
      contains: [hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
    },
  ];

  const TAG_ATTRS: Mode = {
    endsWithParent: true,
    relevance: 0,
    contains: [
      {
        className: "attr",
        begin: /[a-zA-Z_:][\w:.-]*(?=\s*=)/,
        relevance: 0,
      },
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        className: "subst",
        begin: /\{/,
        end: /\}/,
        contains: EXPR_CONTAINS,
      },
    ],
  };

  return {
    name: "Svelte",
    contains: [
      hljs.COMMENT("<!--", "-->", { relevance: 10 }),
      {
        className: "tag",
        begin:
          /<(?=script\s+(?:(?:"[^"]*"|'[^']*'|\/(?!>)|[^/>"'])*\s)?lang\s*=\s*(?:"(?:ts|typescript)"|'(?:ts|typescript)')(?:\s+(?:"[^"]*"|'[^']*'|\/(?!>)|[^/>"'])*)?>)/i,
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
        className: "template-tag",
        begin: /\{(?:#|\/|:|@)/,
        end: /\}/,
        keywords: {
          keyword: "if else each await then catch key snippet html render const debug as",
        },
        contains: EXPR_CONTAINS,
      },
      {
        className: "subst",
        begin: /\{/,
        end: /\}/,
        contains: EXPR_CONTAINS,
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
