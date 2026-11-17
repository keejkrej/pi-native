import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function hlsl(hljs: HLJSApi): LanguageDetail {
  return {
    name: "HLSL",
    keywords: {
      keyword:
        "asm blendstate break buffer case cbuffer centroid class column_major compile const continue default depthstencilstate depthstencilview discard do domainshader dword else export extern for fxgroup geometryshader groupshared hullshader if in inline inout inputpatch interface line lineadj linear linestream namespace nointerpolation noperspective out outputpatch packoffset pass pixelfragment pixelshader point pointstream precise register return row_major rwbuffer rwbyteaddressbuffer rwstructuredbuffer rwtexture1d rwtexture1darray rwtexture2d rwtexture2darray rwtexture3d sample sampler samplerstate samplercomparisonstate shared snorm stateblock stateblock_state static struct switch structuredbuffer tbuffer technique technique10 technique11 texture Texture1D Texture1DArray Texture2D Texture2DArray Texture2DMS Texture2DMSArray Texture3D TextureCube TextureCubeArray typedef triangle triangleadj trianglestream uniform unorm unsigned vertexfragment vertexshader volatile while",
      type:
        "void bool bool1 bool2 bool3 bool4 int int1 int2 int3 int4 uint uint1 uint2 uint3 uint4 half half1 half2 half3 half4 float float1 float2 float3 float4 double double1 double2 double3 double4 float2x2 float3x3 float4x4 float3x4 float4x3 matrix vector string",
      built_in:
        "abs acos all AllMemoryBarrier AllMemoryBarrierWithGroupSync any asdouble asfloat asin asint asuint atan atan2 ceil clamp clip cos cosh countbits cross ddx ddx_coarse ddx_fine ddy ddy_coarse ddy_fine degrees determinant DeviceMemoryBarrier DeviceMemoryBarrierWithGroupSync distance dot dst EvaluateAttributeAtCentroid EvaluateAttributeAtSample EvaluateAttributeSnapped exp exp2 f16tof32 f32tof16 faceforward firstbithigh firstbitlow floor fma fmod frac frexp fwidth GroupMemoryBarrier GroupMemoryBarrierWithGroupSync InterlockedAdd InterlockedAnd InterlockedCompareExchange InterlockedCompareStore InterlockedExchange InterlockedMax InterlockedMin InterlockedOr InterlockedXor isfinite isinf isnan ldexp length lerp lit log log10 log2 mad max min modf mul noise normalize pow radians rcp reflect refract reversebits round rsqrt saturate sign sin sincos sinh smoothstep sqrt step tan tanh tex1D tex2D tex3D texCUBE transpose trunc",
      literal: "true false NULL",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "meta",
        begin: /^[ \t]*#[ \t]*[a-z_]+/m,
        end: /$/,
        contains: [
          { begin: /\\\n/, relevance: 0 },
          hljs.QUOTE_STRING_MODE,
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
        ],
      },
      {
        className: "meta",
        begin: /\bSV_[A-Za-z0-9_]+\b/,
      },
      hljs.QUOTE_STRING_MODE,
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F]+[uUlL]?|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?[fFhHuUlL]?)\b|\.\d+(?:[eE][-+]?\d+)?[fFhH]?\b/,
        relevance: 0,
      },
    ],
  };
}
