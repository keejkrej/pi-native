import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function clojure(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Clojure",
    aliases: ["clj", "edn"],
    keywords: {
      $pattern: /[a-zA-Z_!$%&*+\-./:<=>?@^~][a-zA-Z0-9_!$%&*+\-./:<=>?@^~]*/,
      keyword:
        "def defn defn- defmacro defmulti defmethod defprotocol defrecord deftype defstruct defonce fn let letfn loop recur if if-not if-let when when-not when-let when-first cond condp case do try catch finally throw ns require use import refer quote var set! new",
      literal: "true false nil",
      built_in:
        "map filter reduce apply comp partial assoc dissoc get get-in assoc-in update update-in conj cons first rest next seq vec list set hash-map sorted-map count empty? nil? some? fn? coll? seq? map? vector? list? set? string? number? integer? keyword? symbol? str prn println print format inc dec + - * / = not= < <= > >= and or not range repeat repeatedly iterate take drop take-while drop-while into partition group-by frequencies sort sort-by reverse concat flatten distinct interpose interleave zipmap keys vals merge select-keys atom deref reset! swap! future promise delay force",
    },
    contains: [
      hljs.COMMENT(";", "$"),
      {
        className: "regexp",
        begin: /#"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      {
        className: "string",
        begin: /\\(?:newline|space|tab|backspace|formfeed|return|u[0-9a-fA-F]{4}|.)/,
      },
      {
        className: "symbol",
        begin: /::?[A-Za-z0-9*+!\-_?./]+/,
        relevance: 0,
      },
      {
        className: "meta",
        begin: /\^:?[A-Za-z0-9*+!\-_?.]+/,
      },
      {
        className: "number",
        begin:
          /[-+]?\b(?:0[xX][0-9a-fA-F]+|\d+r[0-9a-zA-Z]+|\d+\/\d+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)[MN]?\b/,
        relevance: 0,
      },
    ],
  };
}
