import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function latex(hljs: HLJSApi): LanguageDetail {
  return {
    name: "LaTeX",
    aliases: ["tex"],
    contains: [
      hljs.COMMENT("%", "$"),
      {
        className: "formula",
        begin: /\$\$|\\\[/,
        end: /\$\$|\\\]/,
      },
      {
        className: "formula",
        begin: /\$(?!\$)/,
        end: /\$/,
        illegal: /\n/,
      },
      {
        className: "section",
        begin:
          /\\(?:part|chapter|(?:sub){0,2}section|(?:sub)?paragraph|title)\*?\{/,
        end: /\}/,
      },
      {
        className: "keyword",
        begin: /\\(?:begin|end)\{[^}\n]+\}/,
      },
      {
        className: "keyword",
        begin:
          /\\(?:documentclass|usepackage|newcommand|renewcommand|providecommand|input|include|bibliographystyle|bibliography|item|label|ref|cite)\b/,
      },
      {
        className: "built_in",
        begin: /\\[a-zA-Z@]+\*?/,
      },
      {
        className: "symbol",
        begin: /\\[^a-zA-Z\s]/,
        relevance: 0,
      },
      {
        className: "params",
        begin: /\[/,
        end: /\]/,
        relevance: 0,
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
