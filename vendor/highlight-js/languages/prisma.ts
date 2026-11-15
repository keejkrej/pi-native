import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function prisma(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Prisma",
    keywords: {
      keyword: "datasource generator model enum type view",
      type: "String Boolean Int BigInt Float Decimal DateTime Json Bytes Unsupported",
      literal: "true false null",
      built_in:
        "autoincrement default now uuid cuid dbgenerated env relation unique index map fulltext cascade restrict setNull noAction",
    },
    contains: [
      hljs.COMMENT("///", "$"),
      hljs.C_LINE_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      {
        className: "meta",
        begin: /@@?[A-Za-z_]\w*/,
      },
      {
        beginKeywords: "datasource generator model enum type view",
        end: /[{\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
