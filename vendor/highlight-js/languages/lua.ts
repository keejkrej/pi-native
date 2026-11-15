import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function lua(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Lua",
    keywords: {
      $pattern: /[a-zA-Z_]\w*/,
      literal: "true false nil",
      keyword:
        "and break do else elseif end for goto if in local not or repeat return then until while",
      built_in:
        "_G _ENV _VERSION __index __newindex __mode __call __metatable __tostring __len __gc __add __sub __mul __div __mod __pow __concat __unm __eq __lt __le assert collectgarbage dofile error getfenv getmetatable ipairs load loadfile loadstring module next pairs pcall print rawequal rawget rawset require select setfenv setmetatable tonumber tostring type unpack xpcall arg self coroutine resume yield status wrap create running debug io lines write close flush open output read math log max acos pi cos sin floor ceil abs random string sub upper len find match gsub format table insert concat sort remove os exit date time clock getenv",
    },
    contains: [
      hljs.COMMENT(/--\[=*\[/, /\]=*\]/),
      hljs.COMMENT("--", "$"),
      { className: "string", begin: /\[=*\[/, end: /\]=*\]/ },
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      {
        beginKeywords: "function",
        end: /[(\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin: /\b(?:0[xX][0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?(?:[pP][-+]?\d+)?|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?)\b/,
        relevance: 0,
      },
    ],
  };
}
