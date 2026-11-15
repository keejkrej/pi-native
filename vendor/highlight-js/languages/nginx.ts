import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function nginx(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Nginx config",
    keywords: {
      $pattern: /[a-zA-Z_][a-zA-Z0-9_-]*/,
      keyword:
        "http server location events upstream stream mail types map geo limit_except if set return rewrite break last permanent redirect try_files proxy_pass fastcgi_pass uwsgi_pass grpc_pass include listen server_name root index alias error_page access_log error_log add_header ssl_certificate ssl_certificate_key worker_processes worker_connections sendfile tcp_nopush tcp_nodelay keepalive_timeout gzip types_hash_max_size client_max_body_size allow deny auth_basic auth_basic_user_file proxy_set_header resolver",
      literal: "on off default_server ssl http2 ipv6only",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        className: "variable",
        begin: /\$\{?[a-zA-Z_]\w*\}?/,
      },
      {
        className: "number",
        begin: /\b\d+(?:\.\d+)?(?:[kKmMgG]|[mshdwMy])?\b/,
        relevance: 0,
      },
    ],
  };
}
