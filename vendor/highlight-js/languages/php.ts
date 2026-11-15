import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function php(hljs: HLJSApi): LanguageDetail {
  return {
    name: "PHP",
    aliases: ["php3", "php4", "php5", "php6", "php7", "php8"],
    case_insensitive: true,
    keywords: {
      keyword:
        "__CLASS__ __DIR__ __FILE__ __FUNCTION__ __LINE__ __METHOD__ __NAMESPACE__ __TRAIT__ die echo exit include include_once print require require_once array abstract and as binary bool boolean break callable case catch class clone const continue declare default do double else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval extends final finally float for foreach from global goto if implements instanceof insteadof int integer interface isset iterable list match|0 mixed new object or private protected public real return string switch throw trait try unset use var void while xor yield fn",
      literal: "false null true",
      built_in:
        "Error|0 Exception Throwable ArrayAccess Closure Generator Iterator IteratorAggregate Serializable Stringable Traversable WeakReference WeakMap Directory parent self static stdClass",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      { className: "meta", begin: /<\?(?:php|=)?|\?>/i },
      { className: "variable", begin: /\$[A-Za-z_\x7f-\xff][A-Za-z0-9_\x7f-\xff]*/ },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          { className: "variable", begin: /\$[A-Za-z_]\w*/ },
        ],
      },
      hljs.APOS_STRING_MODE,
      {
        beginKeywords: "function class interface trait enum",
        end: /[{(;:\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
