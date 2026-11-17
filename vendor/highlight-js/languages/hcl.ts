import type { HLJSApi, KeywordsSpec, LanguageDetail, Mode } from "../core.ts";

export default function hcl(hljs: HLJSApi): LanguageDetail {
  const KEYWORDS: KeywordsSpec = {
    keyword:
      "resource data variable output locals module provider terraform backend required_providers required_version dynamic for_each count depends_on lifecycle provisioner connection for in if else endif endfor",
    type: "string number bool list set map object tuple any",
    literal: "true false null",
    built_in:
      "abs ceil floor log max min pow signum chomp format formatlist indent join lower regex regexall replace split substr title trim trimprefix trimsuffix trimspace upper chunklist coalesce coalescelist compact concat contains distinct element flatten index keys length lookup merge range reverse setintersection setproduct setsubtract setunion slice sort transpose values zipmap base64decode base64encode base64gzip csvdecode jsondecode jsonencode urlencode yamldecode yamlencode abspath dirname pathexpand basename file fileexists fileset filebase64 templatefile formatdate timeadd timestamp sha256 uuid cidrhost cidrnetmask cidrsubnet cidrsubnets can try tobool tolist tomap tonumber toset tostring nonsensitive sensitive type",
  };

  const SUBST: Mode = {
    className: "subst",
    begin: /[$%]\{/,
    end: /\}/,
    keywords: KEYWORDS,
    contains: [
      hljs.QUOTE_STRING_MODE,
      hljs.C_NUMBER_MODE,
      {
        className: "variable",
        begin:
          /\b(?:var|local|module|data|each|self|count|path|terraform)\.[A-Za-z_][A-Za-z0-9_.-]*/,
      },
    ],
  };

  return {
    name: "HCL",
    aliases: ["terraform", "tf"],
    keywords: KEYWORDS,
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "string",
        begin: /<<-?\s*EOF\b/,
        end: /^[ \t]*EOF\b/m,
        contains: [SUBST],
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE, SUBST],
      },
      {
        className: "attr",
        begin: /^[ \t]*[A-Za-z_][A-Za-z0-9_-]*(?=[ \t]*=[^=])/m,
        relevance: 0,
      },
      {
        className: "variable",
        begin:
          /\b(?:var|local|module|data|each|self|count|path|terraform)\.[A-Za-z_][A-Za-z0-9_.-]*/,
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
