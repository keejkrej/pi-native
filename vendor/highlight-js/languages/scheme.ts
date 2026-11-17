import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function scheme(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Scheme",
    aliases: ["lisp", "elisp", "emacs-lisp"],
    keywords: {
      $pattern: /[a-zA-Z_#!$%&*+\-./:<=>?@^~][a-zA-Z0-9_#!$%&*+\-./:<=>?@^~]*/,
      keyword:
        "define define-syntax define-record-type define-values define-macro defun defvar defparameter defcustom defconst defmacro defstruct defclass defmethod lambda let let* letrec letrec* let-values if cond case and or not begin do when unless set! setq setf quote quasiquote unquote unquote-splicing syntax-rules syntax-case import export library module require provide cond-expand delay force parameterize values call-with-values call/cc call-with-current-continuation dynamic-wind while dolist dotimes progn prog1 unwind-protect condition-case",
      literal: "#t #f #true #false t nil",
      built_in:
        "car cdr caar cadr cdar cddr cons list append reverse length null? pair? list? symbol? number? integer? real? rational? complex? boolean? char? string? vector? procedure? eq? eqv? equal? map for-each filter fold-left fold-right apply eval load display write newline read read-line open-input-file open-output-file close-input-port close-output-port error raise format message concat princ prin1 + - * / = < <= > >= mod modulo quotient remainder abs min max expt sqrt string-append string-length substring string->symbol symbol->string number->string string->number vector vector-ref vector-set! vector-length make-vector",
    },
    contains: [
      hljs.COMMENT(/#\|/, /\|#/),
      hljs.COMMENT(";", "$"),
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      {
        className: "string",
        begin: /#\\(?:space|newline|tab|return|[a-zA-Z0-9\S])/,
      },
      {
        className: "symbol",
        begin: /:[a-zA-Z_!$%&*+\-./:<=>?@^~][a-zA-Z0-9_!$%&*+\-./:<=>?@^~]*/,
        relevance: 0,
      },
      {
        className: "number",
        begin:
          /\b\d+\/\d+\b|\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b|#[xXoObBdDeEiI][0-9a-fA-F+\-./]+/,
        relevance: 0,
      },
    ],
  };
}
