import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function swift(hljs: HLJSApi): LanguageDetail {
  const SUBST: Mode = {
    className: "subst",
    begin: /\\\(/,
    end: /\)/,
    contains: [hljs.QUOTE_STRING_MODE, hljs.C_NUMBER_MODE],
  };

  return {
    name: "Swift",
    keywords: {
      $pattern: /(\b\w+|#\w+)/,
      keyword: [
        "associatedtype", "async", "await", "as", "break", "case", "catch",
        "class", "continue", "convenience", "default", "defer", "deinit",
        "didSet", "do", "dynamic", "else", "enum", "extension", "fallthrough",
        "fileprivate", "final", "for", "func", "get", "guard", "if", "import",
        "indirect", "infix", "inout", "internal", "in", "is", "lazy", "let",
        "mutating", "nonmutating", "open", "operator", "optional", "override",
        "postfix", "precedencegroup", "prefix", "private", "protocol", "public",
        "repeat", "required", "rethrows", "return", "set", "some", "static",
        "struct", "subscript", "super", "switch", "throws", "throw", "try",
        "typealias", "unowned", "var", "weak", "where", "while", "willSet",
        "#available", "#colorLiteral", "#column", "#else", "#elseif", "#endif",
        "#error", "#file", "#fileID", "#filePath", "#function", "#if",
        "#keyPath", "#line", "#selector", "#warning",
      ],
      literal: ["false", "nil", "true"],
    },
    contains: [
      hljs.COMMENT("///", "$"),
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      { className: "string", begin: /"""/, end: /"""/, contains: [hljs.BACKSLASH_ESCAPE, SUBST] },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      { className: "meta", begin: /@[A-Za-z_]\w*/ },
      {
        beginKeywords: "func class struct enum protocol extension typealias",
        end: /[{(:<\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        variants: [
          { begin: /\b0[xX][0-9a-fA-F_]+(?:\.[0-9a-fA-F_]+)?(?:[pP][-+]?\d+)?\b/ },
          { begin: /\b0[bB][01_]+\b/ },
          { begin: /\b0[oO][0-7_]+\b/ },
          { begin: /\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d[\d_]*)?\b/ },
        ],
        relevance: 0,
      },
    ],
  };
}
