import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function cpp(hljs: HLJSApi): LanguageDetail {
  const PREPROCESSOR: Mode = {
    className: "meta",
    begin: /#\s*[a-z]+\b/,
    end: /$/,
    keywords: {
      "meta-keyword":
        "if else elif endif define undef warning error line pragma ifdef ifndef include",
    },
    contains: [
      { begin: /\\\n/, relevance: 0 },
      hljs.inherit(hljs.QUOTE_STRING_MODE, { className: "meta-string" }),
      {
        className: "meta-string",
        begin: /<.*?>/,
        end: /$/,
        illegal: "\\n",
      },
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
    ],
  };

  const CHAR_MODE: Mode = {
    className: "string",
    begin: /'(?:\\.|[^'\\\n])'/,
    relevance: 0,
  };

  return {
    name: "C++",
    aliases: ["cc", "c++", "h++", "hpp", "hh", "hxx", "cxx"],
    keywords: {
      keyword:
        "int float while private char char8_t char16_t char32_t catch import module export virtual operator sizeof dynamic_cast|10 typedef const_cast|10 const for static_cast|10 union namespace unsigned long volatile static protected bool template mutable if public friend do goto auto void enum else break extern using asm case typeid wchar_t short reinterpret_cast|10 default double register explicit signed typename try this switch continue inline delete alignas alignof constexpr consteval constinit decltype concept co_await co_return co_yield requires noexcept static_assert thread_local restrict final override new throw return and and_eq bitand bitor compl not not_eq or or_eq xor xor_eq class struct",
      built_in: "_Bool _Complex _Imaginary",
      _relevance_hints: [
        "std",
        "string",
        "wstring",
        "cin",
        "cout",
        "cerr",
        "clog",
        "vector",
        "map",
        "set",
        "pair",
        "unordered_map",
        "unordered_set",
        "unique_ptr",
        "shared_ptr",
        "make_pair",
        "array",
        "printf",
        "malloc",
        "free",
      ],
      literal: "true false nullptr NULL",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      PREPROCESSOR,
      {
        className: "string",
        begin: /R"\(/,
        end: /\)"/,
      },
      hljs.QUOTE_STRING_MODE,
      CHAR_MODE,
      {
        beginKeywords: "class struct namespace",
        end: /[{;=]/,
        excludeEnd: true,
        contains: [hljs.TITLE_MODE],
      },
      {
        className: "number",
        begin: /\b(?:0[xX][0-9a-fA-F']+|0[bB][01']+|\d[\d']*(?:\.[\d']*)?(?:[eE][-+]?\d+)?)(?:[uUlLfF]{0,3})\b/,
        relevance: 0,
      },
    ],
  };
}
