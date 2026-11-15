import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function erlang(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Erlang",
    aliases: ["erl"],
    keywords: {
      keyword:
        "after and andalso band begin bnot bor bsl bsr bxor case catch cond div end fun if let not of or orelse receive rem try when xor maybe else",
      literal: "true false ok error undefined",
      built_in:
        "abs atom_to_binary atom_to_list binary_to_atom binary_to_list bit_size byte_size element error exit float hd integer_to_binary integer_to_list iolist_size iolist_to_binary is_atom is_binary is_boolean is_float is_function is_integer is_list is_map is_number is_pid is_port is_reference is_tuple length list_to_atom list_to_binary list_to_integer list_to_tuple make_ref map_size max min node nodes now pid_to_list register registered round self send setelement size spawn spawn_link spawn_monitor split_binary throw tl trunc tuple_size tuple_to_list unregister whereis",
    },
    contains: [
      hljs.COMMENT("%", "$"),
      hljs.QUOTE_STRING_MODE,
      {
        className: "meta",
        begin: /^[ \t]*-[a-z_]+(?=\s*\()/m,
      },
      {
        className: "meta",
        begin: /\?[A-Za-z_]\w*/,
      },
      {
        className: "symbol",
        begin: /'(?:\\.|[^'\\\n])*'/,
        relevance: 0,
      },
      {
        className: "number",
        begin:
          /\b(?:\d+#[0-9a-zA-Z]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\b|\$(?:\\.|[^\s])/,
        relevance: 0,
      },
    ],
  };
}
