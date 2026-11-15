import {
  hljs,
  createHljs,
  type AutoHighlightResult,
  type HLJSApi,
  type HighlightOptions,
  type HighlightResult,
  type HljsConfig,
  type KeywordsSpec,
  type Language,
  type LanguageDetail,
  type LanguageFn,
  type Mode,
  type RegExpLike,
} from "./core.ts";

import bash from "./languages/bash.ts";
import c from "./languages/c.ts";
import cpp from "./languages/cpp.ts";
import csharp from "./languages/csharp.ts";
import dart from "./languages/dart.ts";
import go from "./languages/go.ts";
import groovy from "./languages/groovy.ts";
import java from "./languages/java.ts";
import javascript from "./languages/javascript.ts";
import json from "./languages/json.ts";
import kotlin from "./languages/kotlin.ts";
import lua from "./languages/lua.ts";
import nix from "./languages/nix.ts";
import perl from "./languages/perl.ts";
import php from "./languages/php.ts";
import python from "./languages/python.ts";
import ruby from "./languages/ruby.ts";
import rust from "./languages/rust.ts";
import scala from "./languages/scala.ts";
import swift from "./languages/swift.ts";
import typescript from "./languages/typescript.ts";

function ada(api: HLJSApi): LanguageDetail {
  return {
    name: "Ada",
    case_insensitive: true,
    keywords: {
      keyword:
        "abort else new return abs elsif not reverse abstract end accept entry select access exception of separate aliased exit or some all others subtype and for out synchronized array function overriding at tagged generic package task begin goto pragma terminate body private then if procedure type case in protected constant interface is raise use declare range delay limited record when delta loop rem while digits renames with do mod requeue xor",
      literal: "True False",
    },
    contains: [
      api.COMMENT("--", "$"),
      api.QUOTE_STRING_MODE,
      { className: "string", begin: /'.'/ },
      api.C_NUMBER_MODE,
    ],
  };
}

function diff(api: HLJSApi): LanguageDetail {
  return {
    name: "Diff",
    aliases: ["patch"],
    contains: [
      {
        className: "meta",
        variants: [
          { begin: /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m, relevance: 10 },
          { begin: /^(?:diff --git|index [0-9a-f]+\.\.[0-9a-f]+|---|\+\+\+)/m },
        ],
      },
      { className: "comment", begin: /^\\ No newline at end of file/m },
      { className: "addition", begin: /^\+/m, end: /$/ },
      { className: "deletion", begin: /^-/m, end: /$/ },
    ],
  };
}

function xml(api: HLJSApi): LanguageDetail {
  return {
    name: "HTML, XML",
    aliases: ["html", "xhtml", "rss", "atom", "xjb", "xsd", "xsl", "plist", "wsf", "svg"],
    case_insensitive: true,
    contains: [
      api.COMMENT("<!--", "-->", { relevance: 10 }),
      { className: "meta", begin: /<!DOCTYPE\b/, end: />/ },
      { className: "meta", begin: /<\?[a-zA-Z-]+/, end: /\?>/ },
      { className: "string", begin: /<!\[CDATA\[/, end: /\]\]>/ },
      {
        className: "tag",
        begin: /<\/?[a-zA-Z][\w:-]*/,
        end: /\/?>/,
        contains: [
          {
            className: "attr",
            begin: /[a-zA-Z_:][\w:.-]*(?=\s*=)/,
            relevance: 0,
          },
          api.QUOTE_STRING_MODE,
          api.APOS_STRING_MODE,
        ],
      },
    ],
  };
}

function css(api: HLJSApi): LanguageDetail {
  return {
    name: "CSS",
    case_insensitive: true,
    contains: [
      api.C_BLOCK_COMMENT_MODE,
      { className: "selector-id", begin: /#[A-Za-z0-9_-]+/ },
      { className: "selector-class", begin: /\.[A-Za-z0-9_-]+/ },
      { className: "selector-pseudo", begin: /::?[A-Za-z-]+/ },
      { className: "attribute", begin: /[A-Za-z-]+(?=\s*:)/ },
      api.QUOTE_STRING_MODE,
      api.APOS_STRING_MODE,
      { className: "number", begin: /(?:#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?)/ },
    ],
  };
}

function yaml(api: HLJSApi): LanguageDetail {
  return {
    name: "YAML",
    aliases: ["yml"],
    case_insensitive: true,
    keywords: { literal: "true false yes no on off null" },
    contains: [
      api.HASH_COMMENT_MODE,
      { className: "meta", begin: /^(?:---|\.\.\.)\s*$/m, relevance: 10 },
      { className: "attr", begin: /^[ \t-]*[A-Za-z0-9_.-]+(?=\s*:)/m },
      api.QUOTE_STRING_MODE,
      api.APOS_STRING_MODE,
      { className: "bullet", begin: /^[ \t]*-(?=[ \t]|$)/m },
      api.C_NUMBER_MODE,
    ],
  };
}

function markdown(api: HLJSApi): LanguageDetail {
  return {
    name: "Markdown",
    aliases: ["md", "mkdown", "mkd"],
    contains: [
      { className: "section", begin: /^#{1,6}\s+.+$/m },
      { className: "code", begin: /^```[\s\S]*?^```/m },
      { className: "code", begin: /`[^`\n]+`/ },
      { className: "quote", begin: /^>\s+.+$/m },
      { className: "bullet", begin: /^[ \t]*(?:[*+-]|\d+\.)[ \t]+/m },
      { className: "strong", begin: /\*\*[^*\n]+\*\*/ },
      { className: "emphasis", begin: /\*[^*\n]+\*/ },
      { className: "link", begin: /\[[^\]]+\]\([^)]+\)/ },
    ],
  };
}

function sql(api: HLJSApi): LanguageDetail {
  return {
    name: "SQL",
    case_insensitive: true,
    keywords: {
      keyword:
        "all alter and any as asc begin between by case check column commit create cross cursor database declare default delete desc distinct drop else end escape except exists fetch for foreign from full function grant group having in index inner insert into is join key left like limit match merge natural not null on or order outer over partition primary procedure references release rename returning revoke right rollback row rows savepoint select set show some table then to transaction trigger union unique update using values view when where window with",
      type: "bigint binary blob boolean char clob date decimal double float int integer interval nchar numeric real smallint text time timestamp varchar varbinary",
      literal: "true false unknown null",
    },
    contains: [
      api.COMMENT("--", "$"),
      api.C_BLOCK_COMMENT_MODE,
      api.APOS_STRING_MODE,
      api.QUOTE_STRING_MODE,
      api.C_NUMBER_MODE,
    ],
  };
}

function ini(api: HLJSApi): LanguageDetail {
  return {
    name: "TOML, also INI",
    aliases: ["toml"],
    case_insensitive: true,
    keywords: { literal: "true false" },
    contains: [
      api.COMMENT(/[;#]/, "$"),
      { className: "section", begin: /^\s*\[+[^\]\n]+\]+/m },
      { className: "attr", begin: /^\s*[A-Za-z0-9_.-]+(?=\s*=)/m },
      api.QUOTE_STRING_MODE,
      api.APOS_STRING_MODE,
      api.C_NUMBER_MODE,
    ],
  };
}

function makefile(api: HLJSApi): LanguageDetail {
  return {
    name: "Makefile",
    aliases: ["mk", "mak", "make"],
    keywords:
      "define endef undefine ifdef ifndef ifeq ifneq else endif include override export unexport private vpath",
    contains: [
      api.HASH_COMMENT_MODE,
      { className: "variable", begin: /\$\([^)]+\)|\$\{[^}]+\}/ },
      { className: "section", begin: /^[A-Za-z0-9_./-]+(?=:)/m },
      api.QUOTE_STRING_MODE,
      api.APOS_STRING_MODE,
    ],
  };
}

function dockerfile(api: HLJSApi): LanguageDetail {
  return {
    name: "Dockerfile",
    aliases: ["docker"],
    case_insensitive: true,
    keywords:
      "from maintainer expose env arg user onbuild stopsignal run cmd entrypoint copy add workdir volume label shell healthcheck",
    contains: [
      api.HASH_COMMENT_MODE,
      api.QUOTE_STRING_MODE,
      api.APOS_STRING_MODE,
      api.C_NUMBER_MODE,
    ],
  };
}

function plaintext(): LanguageDetail {
  return {
    name: "Plain text",
    aliases: ["text", "txt"],
    disableAutodetect: true,
    contains: [],
  };
}

function zig(api: HLJSApi): LanguageDetail {
  return {
    name: "Zig",
    keywords: {
      keyword:
        "addrspace align allowzero and anyframe anytype asm async await break callconv catch comptime const continue defer else enum errdefer error export extern fn for if inline linksection noalias noinline nosuspend or orelse packed pub resume return struct suspend switch test threadlocal try union unreachable usingnamespace var volatile while",
      built_in:
        "bool f16 f32 f64 f80 f128 i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize void anyopaque noreturn type comptime_int comptime_float",
      literal: "true false null undefined",
    },
    contains: [
      api.C_LINE_COMMENT_MODE,
      api.QUOTE_STRING_MODE,
      { className: "string", begin: /\\\\[^\n]*/ },
      { className: "built_in", begin: /@[A-Za-z_]\w*/ },
      api.C_NUMBER_MODE,
    ],
  };
}

function haskell(api: HLJSApi): LanguageDetail {
  return {
    name: "Haskell",
    aliases: ["hs"],
    keywords:
      "let in data type newtype deriving class instance where case of do if then else import qualified hiding module infix infixl infixr default foreign",
    contains: [
      api.COMMENT("--", "$"),
      api.COMMENT("\\{-", "-\\}"),
      api.QUOTE_STRING_MODE,
      api.C_NUMBER_MODE,
    ],
  };
}

function elixir(api: HLJSApi): LanguageDetail {
  return {
    name: "Elixir",
    aliases: ["ex", "exs"],
    keywords:
      "after and catch def defdelegate defexception defimpl defmacro defmacrop defmodule defoverridable defp defprotocol defstruct do else end fn for if import in not or quote raise receive require rescue try unless unquote use when with",
    contains: [
      api.HASH_COMMENT_MODE,
      api.QUOTE_STRING_MODE,
      api.APOS_STRING_MODE,
      { className: "symbol", begin: /:[A-Za-z_]\w*/ },
      api.C_NUMBER_MODE,
    ],
  };
}

function ocaml(api: HLJSApi): LanguageDetail {
  return {
    name: "OCaml",
    aliases: ["ml", "mli"],
    keywords: {
      keyword:
        "and as assert asr begin class constraint do done downto else end exception external for fun function functor if in include inherit initializer land lazy let lor lsl lsr lxor match method mod module mutable new nonrec object of open or private rec sig struct then to try type val virtual when while with",
      literal: "true false",
    },
    contains: [
      api.COMMENT("\\(\\*", "\\*\\)"),
      api.QUOTE_STRING_MODE,
      api.C_NUMBER_MODE,
    ],
  };
}

function powershell(api: HLJSApi): LanguageDetail {
  return {
    name: "PowerShell",
    aliases: ["ps", "ps1", "pwsh"],
    case_insensitive: true,
    keywords: {
      keyword:
        "begin break catch class continue data default define do dynamicparam else elseif end enum exit filter finally for foreach from function if in inline parallel param process return sequence switch throw trap try until using var while workflow",
      literal: "$true $false $null",
    },
    contains: [
      api.HASH_COMMENT_MODE,
      api.COMMENT("<#", "#>"),
      api.QUOTE_STRING_MODE,
      api.APOS_STRING_MODE,
      { className: "variable", begin: /\$[A-Za-z_]\w*/ },
      api.C_NUMBER_MODE,
    ],
  };
}

function registerAll(): void {
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("c", c);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("csharp", csharp);
  hljs.registerLanguage("dart", dart);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("groovy", groovy);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("kotlin", kotlin);
  hljs.registerLanguage("lua", lua);
  hljs.registerLanguage("nix", nix);
  hljs.registerLanguage("perl", perl);
  hljs.registerLanguage("php", php);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("ruby", ruby);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("scala", scala);
  hljs.registerLanguage("swift", swift);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("ada", ada);
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("yaml", yaml);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("ini", ini);
  hljs.registerLanguage("makefile", makefile);
  hljs.registerLanguage("dockerfile", dockerfile);
  hljs.registerLanguage("plaintext", plaintext);
  hljs.registerLanguage("zig", zig);
  hljs.registerLanguage("haskell", haskell);
  hljs.registerLanguage("elixir", elixir);
  hljs.registerLanguage("ocaml", ocaml);
  hljs.registerLanguage("powershell", powershell);
}

registerAll();

export {
  hljs,
  createHljs,
  type AutoHighlightResult,
  type HLJSApi,
  type HighlightOptions,
  type HighlightResult,
  type HljsConfig,
  type KeywordsSpec,
  type Language,
  type LanguageDetail,
  type LanguageFn,
  type Mode,
  type RegExpLike,
};

export default hljs;
