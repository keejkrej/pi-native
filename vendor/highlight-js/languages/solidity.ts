import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function solidity(hljs: HLJSApi): LanguageDetail {
  return {
    name: "Solidity",
    aliases: ["sol"],
    keywords: {
      keyword:
        "pragma solidity abstract contract interface library struct enum event error modifier function constructor fallback receive virtual override using for is public private internal external pure view payable constant immutable memory storage calldata returns return if else while do break continue try catch revert require assert emit new delete import as from indexed anonymous unchecked assembly",
      type:
        "address bool string bytes bytes1 bytes2 bytes4 bytes8 bytes16 bytes20 bytes32 int uint int8 int16 int32 int64 int128 int256 uint8 uint16 uint32 uint64 uint128 uint256 mapping fixed ufixed",
      literal: "true false wei gwei ether seconds minutes hours days years",
      built_in:
        "msg block tx abi keccak256 sha256 ripemd160 ecrecover addmod mulmod selfdestruct type",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "string",
        begin: /hex"(?:[0-9a-fA-F]{2}|_)*"/,
      },
      {
        className: "string",
        begin: /hex'(?:[0-9a-fA-F]{2}|_)*'/,
      },
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        beginKeywords:
          "contract interface library struct enum event error function modifier",
        end: /[({\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d[\d_]*)?)\b/,
        relevance: 0,
      },
    ],
  };
}
