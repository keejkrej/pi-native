import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function perl(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Perl",
    aliases: ["pl", "pm"],
    keywords: {
      $pattern: /[\w.]+/,
      keyword:
        "abs accept alarm and atan2 bind binmode bless break caller chdir chmod chomp chop chown chr chroot close closedir connect continue cos crypt dbmclose dbmopen defined delete die do dump each else elsif endgrent eof eval exec exists exit exp fcntl fileno flock for foreach fork format getc given glob gmtime goto grep gt hex if index int ioctl join keys kill last lc lcfirst length link listen local localtime log lstat lt map mkdir my ne next no not oct open opendir or ord our pack package pipe pop pos print printf prototype push q|0 qq quotemeta qw qx rand read readdir readline readlink redo ref rename require reset return reverse rewinddir rindex rmdir say scalar seek select send shift sin sleep socket sort splice split sprintf sqrt srand stat state study sub substr symlink sysopen sysread syswrite tell tie tied time times tr truncate uc ucfirst umask undef unless unlink unpack unshift untie until use utime values vec wait waitpid warn when while write x|0 xor y|0",
    },
    contains: [
      hljs.SHEBANG(),
      hljs.COMMENT(/^=[a-zA-Z]/, /^=cut/),
      hljs.HASH_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        className: "variable",
        begin: /[$@%](?:\^[A-Z]|\w+(?:::\w+)*|\{[A-Za-z_]\w*\}|[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/,
      },
      {
        className: "regexp",
        begin: /(?:m|qr|s|tr|y)?\/(?:\\.|[^/\n\\])+\/[msixpodualngcer]*/,
      },
      {
        beginKeywords: "sub package",
        end: /[{(\s;]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
