import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function c(hljs: HLJSApi): LanguageDetail {
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
    name: "C",
    aliases: ["h"],
    keywords: {
      keyword:
        "int float while private char char8_t char16_t char32_t catch import module export virtual operator sizeof typedef const for union namespace unsigned long volatile static protected bool template mutable if public friend do goto auto void enum else break extern using asm case wchar_t short default double register explicit signed typename try this switch continue inline delete alignas alignof constexpr consteval constinit decltype noexcept static_assert thread_local restrict new throw return and or not xor",
      built_in:
        "std string wstring stdin stdout stderr abort abs acos asin atan atan2 calloc ceil cos cosh exit exp fabs floor fmod fprintf fputs free frexp isalnum isalpha iscntrl isdigit isgraph islower isprint ispunct isspace isupper isxdigit tolower toupper labs ldexp log log10 malloc realloc memchr memcmp memcpy memset modf pow printf putchar puts scanf sin sinh snprintf sprintf sqrt sscanf strcat strchr strcmp strcpy strcspn strlen strncat strncmp strncpy strpbrk strrchr strspn strstr tan tanh vfprintf vprintf vsprintf _Bool complex _Complex imaginary _Imaginary",
      literal: "true false nullptr NULL",
    },
    illegal: "</",
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      PREPROCESSOR,
      hljs.QUOTE_STRING_MODE,
      CHAR_MODE,
      {
        className: "number",
        begin: /\b(?:0[xX][0-9a-fA-F']+|0[bB][01']+|\d[\d']*(?:\.[\d']*)?(?:[eE][-+]?\d+)?)(?:[uUlLfF]{0,3})\b/,
        relevance: 0,
      },
    ],
  };
}
