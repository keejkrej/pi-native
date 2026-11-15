import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function nix(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    begin: /\$\{/,
    end: /\}/,
    contains: ["self"],
  };

  return {
    name: "Nix",
    aliases: ["nixos"],
    keywords: {
      keyword: "rec with let in inherit assert if else then",
      literal: "true false or and null",
      built_in:
        "import abort baseNameOf dirOf isNull builtins map removeAttrs throw toString derivation",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "string",
        begin: /''/,
        end: /''(?!['$\\])/,
        contains: [{ begin: /'''|''\$|''\\/ }, SUBST],
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "attr",
        begin: /[A-Za-z_][A-Za-z0-9_'_-]*(?:\.[A-Za-z_][A-Za-z0-9_'_-]*)*\s*(?==)/,
        relevance: 0,
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
