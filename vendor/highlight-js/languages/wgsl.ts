import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function wgsl(hljs: HLJSApi): LanguageDetail {
  return {
    name: "WGSL",
    keywords: {
      keyword:
        "alias break case const const_assert continue continuing default diagnostic discard else enable fn for if let loop override requires return struct switch var while",
      type:
        "bool f16 f32 i32 u32 vec2 vec3 vec4 vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u vec2h vec3h vec4h mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 mat2x2f mat3x3f mat4x4f atomic array ptr sampler sampler_comparison texture_1d texture_2d texture_2d_array texture_3d texture_cube texture_cube_array texture_multisampled_2d texture_storage_1d texture_storage_2d texture_storage_2d_array texture_storage_3d texture_depth_2d",
      built_in:
        "uniform storage workgroup private function read write read_write abs acos acosh all any asin asinh atan atan2 atanh bitcast ceil clamp cos cosh countLeadingZeros countOneBits countTrailingZeros cross degrees determinant distance dot dpdx dpdxCoarse dpdxFine dpdy dpdyCoarse dpdyFine exp exp2 extractBits faceForward firstLeadingBit firstTrailingBit floor fma fract frexp fwidth fwidthCoarse fwidthFine insertBits inverseSqrt ldexp length log log2 max min mix modf normalize pack2x16float pack2x16snorm pack2x16unorm pack4x8snorm pack4x8unorm pow quantizeToF16 radians reflect refract reverseBits round saturate select sign sin sinh smoothstep sqrt step tan tanh textureDimensions textureGather textureLoad textureNumLayers textureNumLevels textureNumSamples textureSample textureSampleBias textureSampleCompare textureSampleGrad textureSampleLevel textureStore transpose trunc unpack2x16float unpack2x16snorm unpack2x16unorm unpack4x8snorm unpack4x8unorm workgroupBarrier storageBarrier textureBarrier",
      literal: "true false",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "meta",
        begin: /@[A-Za-z_]\w*/,
      },
      {
        beginKeywords: "fn struct",
        end: /[{(<\n]/,
        excludeEnd: true,
        contains: [hljs.UNDERSCORE_TITLE_MODE],
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F]+[iu]?|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?[iufh]?)\b|\.\d+(?:[eE][-+]?\d+)?[fh]?\b/,
        relevance: 0,
      },
    ],
  };
}
