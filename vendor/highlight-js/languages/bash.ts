import type { HLJSApi, LanguageDetail, Mode } from "../core.ts";

export default function bash(hljs: HLJSApi): LanguageDetail {
  const VAR: Mode = {
    className: "variable",
    variants: [
      { begin: /\$\{[\w\W]+?\}/ },
      { begin: /\$[\w\d#@][\w\d_]*/ },
      { begin: /\$\([^)]*\)/ },
    ],
  };

  const QUOTE_STRING: Mode = {
    className: "string",
    begin: /"/,
    end: /"/,
    contains: [
      hljs.BACKSLASH_ESCAPE,
      VAR,
      {
        className: "variable",
        begin: /\$\(/,
        end: /\)/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
    ],
  };

  const APOS_STRING: Mode = {
    className: "string",
    begin: /'/,
    end: /'/,
  };

  const ESCAPED_QUOTE: Mode = {
    className: "string",
    begin: /\$'/,
    end: /'/,
    contains: [hljs.BACKSLASH_ESCAPE],
  };

  return {
    name: "Bash",
    aliases: ["sh", "zsh", "shell", "console"],
    keywords: {
      $pattern: /\b[a-z._-]+\b/,
      keyword:
        "if then else elif fi for while in do done case esac function",
      literal: "true false",
      built_in:
        "break cd continue eval exec exit export getopts hash pwd readonly return shift test times trap umask unset alias bind builtin caller command declare echo enable help let local logout mapfile printf read readarray source type typeset ulimit unalias set shopt autoload bg bindkey bye cap chdir clone comparguments compcall compctl compdescribe compfiles compgroups compquote comptags comptry compvalues dirs disable disown echotc echoti emulate fc fg float functions getcap getln history integer jobs kill limit log noglob popd print pushd pushln rehash sched setcap setopt stat suspend ttyctl unfunction unhash unlimit unsetopt vared wait whence where which zcompile zformat zftp zle zmodload zparseopts zprof zpty zregexparse zsocket zstyle ztcp",
    },
    contains: [
      hljs.SHEBANG(),
      hljs.HASH_COMMENT_MODE,
      QUOTE_STRING,
      APOS_STRING,
      ESCAPED_QUOTE,
      VAR,
      {
        className: "number",
        begin: /\b\d+\b/,
        relevance: 0,
      },
    ],
  };
}
