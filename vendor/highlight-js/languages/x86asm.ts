import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function x86asm(hljs: HLJSApi): LanguageDetail {
  return {
    name: "x86 / ARM Assembly",
    aliases: ["nasm", "asm", "armasm"],
    case_insensitive: true,
    keywords: {
      $pattern: /[a-zA-Z_.][a-zA-Z0-9_.]*/,
      keyword:
        "mov movzx movsx movabs lea push pop xchg add adc sub sbb inc dec mul imul div idiv neg cmp test and or xor not shl shr sal sar rol ror jmp je jne jz jnz jg jge jl jle ja jae jb jbe jc jnc js jns jo jno call ret iret syscall sysenter int nop hlt cld std rep repe repne loop loope loopne cmovz cmovnz ldr str stp ldp b bl br blr adr adrp svc mrs msr byte word dword qword oword yword zword ptr offset rel section global extern equ db dw dd dq resb resw resd resq",
    },
    contains: [
      hljs.COMMENT(";", "$"),
      hljs.HASH_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        className: "symbol",
        begin: /^[ \t]*[.$@a-zA-Z_0-9][.$@a-zA-Z0-9_]*:/m,
      },
      {
        className: "meta",
        begin: /(?:^[ \t]*%[a-zA-Z_]+|\.[a-zA-Z_][a-zA-Z0-9_]*)/m,
      },
      {
        className: "built_in",
        begin:
          /\b(?:[re]?(?:ax|bx|cx|dx|si|di|bp|sp|ip)|[abcd][hl]|(?:si|di|bp|sp)l|r(?:[89]|1[0-5])[dwb]?|[xyz]mm(?:[12]?\d|3[01])|[cdefgs]s|[xw](?:[12]?\d|30|zr)|v(?:[12]?\d|3[01])|lr|pc)\b/i,
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F]+|[0-9][0-9a-fA-F]*[hH]|0[bB][01]+|[01]+[bB]|\d+)\b/,
        relevance: 0,
      },
    ],
  };
}
