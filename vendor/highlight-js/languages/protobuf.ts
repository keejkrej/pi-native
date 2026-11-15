import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function protobuf(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Protocol Buffers",
    aliases: ["proto"],
    keywords: {
      keyword:
        "package import option message service rpc returns enum oneof map reserved extensions extend syntax edition weak public required optional repeated stream group to max",
      type:
        "double float int32 int64 uint32 uint64 sint32 sint64 fixed32 fixed64 sfixed32 sfixed64 bool string bytes",
      built_in: "Any Timestamp Duration Empty Struct Value ListValue",
      literal: "true false",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        beginKeywords: "message enum service rpc extend",
        end: /[({;\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
