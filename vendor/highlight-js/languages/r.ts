import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function r(hljs: HLJSApi): LanguageDetail {
  return {
    name: "R",
    keywords: {
      $pattern: /[a-zA-Z.][a-zA-Z0-9_.]*/,
      keyword:
        "function if in break next repeat else for return switch while library require attach detach source",
      literal: "NULL NA NA_integer_ NA_real_ NA_complex_ NA_character_ TRUE FALSE Inf NaN",
      built_in:
        "c list data.frame matrix array factor vector character numeric integer logical length nrow ncol dim names colnames rownames print cat paste paste0 sprintf grep grepl sub gsub strsplit apply lapply sapply tapply mapply which sum mean median sd var min max range sort order unique table summary head tail str class typeof is.na is.null as.numeric as.character as.logical as.data.frame read.csv write.csv seq rep",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        className: "string",
        begin: /[rR]"(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})"/,
      },
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F]+[Li]?|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?[Li]?)\b|\.\d+(?:[eE][-+]?\d+)?[Li]?\b/,
        relevance: 0,
      },
    ],
  };
}
