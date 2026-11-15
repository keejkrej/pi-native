import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function csharp(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    begin: /\{/,
    end: /\}/,
    contains: [hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
  };

  const VERBATIM_STRING: Mode = {
    className: "string",
    begin: /@"|@\$"|\$@"/,
    end: /"/,
    contains: [{ begin: /""/ }],
  };

  const INTERPOLATED_STRING: Mode = {
    className: "string",
    begin: /\$"/,
    end: /"/,
    illegal: /\n/,
    contains: [{ begin: /\{\{/ }, { begin: /\}\}/ }, hljs.BACKSLASH_ESCAPE, SUBST],
  };

  return {
    name: "C#",
    aliases: ["cs", "c#"],
    keywords: {
      keyword: [
        "abstract", "as", "base", "break", "case", "class", "const", "continue",
        "do", "else", "event", "explicit", "extern", "finally", "fixed", "for",
        "foreach", "goto", "if", "implicit", "in", "interface", "internal", "is",
        "lock", "namespace", "new", "operator", "out", "override", "params",
        "private", "protected", "public", "readonly", "record", "ref", "return",
        "sealed", "sizeof", "stackalloc", "static", "struct", "switch", "this",
        "throw", "try", "typeof", "unchecked", "unsafe", "using", "virtual",
        "void", "volatile", "while", "add", "alias", "and", "ascending", "async",
        "await", "by", "descending", "equals", "from", "get", "global", "group",
        "init", "into", "join", "let", "nameof", "not", "notnull", "on", "or",
        "orderby", "partial", "remove", "select", "set", "unmanaged", "value|0",
        "var", "when", "where", "with", "yield",
      ],
      built_in: [
        "bool", "byte", "char", "decimal", "delegate", "double", "dynamic",
        "enum", "float", "int", "long", "nint", "nuint", "object", "sbyte",
        "short", "string", "ulong", "uint", "ushort",
      ],
      literal: ["default", "false", "null", "true"],
    },
    illegal: /::/,
    contains: [
      hljs.COMMENT("///", "$", {
        contains: [
          { className: "doctag", begin: /<\/?\w+[^>]*>/ },
        ],
      }),
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "meta",
        begin: /^#\s*[a-zA-Z]+/,
        end: /$/,
      },
      VERBATIM_STRING,
      INTERPOLATED_STRING,
      hljs.QUOTE_STRING_MODE,
      {
        className: "string",
        begin: /'(?:\\.|[^'\\\n])'/,
        relevance: 0,
      },
      {
        beginKeywords: "class interface struct enum record namespace",
        end: /[{;=:<]/,
        excludeEnd: true,
        contains: [hljs.TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
