import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function llvm(hljs: HLJSApi): LanguageDetail {
  return {
    name: "LLVM IR",
    keywords: {
      $pattern: /[a-zA-Z_][a-zA-Z0-9_.-]*/,
      keyword:
        "define declare global constant private internal available_externally linkonce weak common appending extern_weak linkonce_odr weak_odr external thread_local dllimport dllexport unnamed_addr local_unnamed_addr addrspace align section comdat type target datalayout triple attributes source_filename module asm sideeffect alignstack inteldialect to unwind nuw nsw exact inbounds tail musttail notail volatile atomic syncscope seq_cst acquire release acq_rel monotonic unordered",
      built_in:
        "ret br switch indirectbr invoke callbr resume catchswitch catchret cleanupret unreachable fneg add fadd sub fsub mul fmul udiv sdiv fdiv urem srem frem shl lshr ashr and or xor extractelement insertelement shufflevector extractvalue insertvalue alloca load store fence cmpxchg atomicrmw getelementptr trunc zext sext fptrunc fpext fptoui fptosi uitofp sitofp ptrtoint inttoptr bitcast addrspacecast icmp fcmp phi select freeze call va_arg landingpad catchpad cleanuppad eq ne ugt uge ult ule sgt sge slt sle oeq ogt oge olt ole one ord ueq une uno",
      type:
        "void half bfloat float double fp128 x86_fp80 ppc_fp128 label metadata ptr opaque token",
      literal: "true false null undef poison zeroinitializer none",
    },
    contains: [
      hljs.COMMENT(";", "$"),
      {
        className: "symbol",
        begin: /^[a-zA-Z$._][a-zA-Z0-9$._-]*:/m,
      },
      {
        className: "string",
        begin: /c?"/,
        end: /"/,
        illegal: /\n/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      {
        className: "variable",
        begin: /[%@][a-zA-Z$._0-9-]+/,
      },
      {
        className: "meta",
        begin: /![a-zA-Z$._0-9-]+|#[0-9]+/,
      },
      {
        className: "type",
        begin: /\bi\d+\b/,
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
