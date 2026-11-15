import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function toml(hljs: HLJSApi): LanguageDetail {
  return {
    name: "TOML",
    keywords: {
      literal: "true false",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        className: "section",
        begin: /^[ \t]*\[(?:\[[^\]\r\n]+\]|[^\]\r\n]+)\]/m,
        relevance: 10,
      },
      {
        className: "attr",
        begin:
          /(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\\n])*"|'[^'\n]*')(?:[ \t]*\.[ \t]*(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\\n])*"|'[^'\n]*'))*(?=[ \t]*=)/,
        relevance: 1,
      },
      {
        className: "string",
        begin: /"""/,
        end: /"""(?!")/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      {
        className: "string",
        begin: /'''/,
        end: /'''(?!')/,
      },
      hljs.QUOTE_STRING_MODE,
      {
        className: "string",
        begin: /'/,
        end: /'/,
        illegal: /\n/,
      },
      {
        className: "number",
        begin:
          /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?\b|\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/,
        relevance: 5,
      },
      {
        className: "number",
        variants: [
          { begin: /\b0x[0-9a-fA-F_]+\b/ },
          { begin: /\b0o[0-7_]+\b/ },
          { begin: /\b0b[01_]+\b/ },
          { begin: /[+-]?\b(?:inf|nan)\b/ },
          { begin: /[+-]?\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?\b/ },
        ],
        relevance: 0,
      },
    ],
  };
}
