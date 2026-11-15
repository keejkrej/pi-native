import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function groovy(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    variants: [
      { begin: /\$\{/, end: /\}/, contains: [hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE] },
      { begin: /\$[A-Za-z_]\w*/ },
    ],
  };

  return {
    name: "Groovy",
    aliases: ["gradle"],
    keywords: {
      literal: "true false null",
      built_in: "this super",
      keyword:
        "byte short char int long boolean float double void def as in assert trait abstract static volatile transient public private protected synchronized final class interface enum if else for while switch case break default continue throw throws try catch finally implements extends new import package return instanceof",
    },
    contains: [
      hljs.SHEBANG(),
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      { className: "string", begin: /"""/, end: /"""/, contains: [hljs.BACKSLASH_ESCAPE, SUBST] },
      { className: "string", begin: /'''/, end: /'''/ },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      hljs.APOS_STRING_MODE,
      { className: "meta", begin: /@[A-Za-z_]\w*/ },
      {
        beginKeywords: "class interface trait enum def",
        end: /[{(\n]/,
        excludeEnd: true,
        contains: [hljs.TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
