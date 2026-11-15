import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function glsl(hljs: HLJSApi): LanguageDetail {
  return {
    name: "GLSL",
    keywords: {
      keyword:
        "break continue do for while switch case default if else discard return struct in out inout uniform buffer shared attribute varying layout centroid flat smooth noperspective patch sample subroutine const invariant precise highp mediump lowp precision coherent volatile restrict readonly writeonly",
      type:
        "void bool int uint float double vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 dvec2 dvec3 dvec4 mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 dmat2 dmat3 dmat4 sampler1D sampler2D sampler3D samplerCube sampler2DRect sampler1DShadow sampler2DShadow samplerCubeShadow sampler1DArray sampler2DArray samplerBuffer sampler2DMS isampler2D usampler2D image2D uimage2D iimage2D atomic_uint",
      built_in:
        "gl_Position gl_FragCoord gl_FragDepth gl_VertexID gl_InstanceID gl_GlobalInvocationID gl_LocalInvocationID gl_WorkGroupID gl_WorkGroupSize gl_NumWorkGroups radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture textureLod textureGrad textureSize texelFetch imageLoad imageStore emitVertex endPrimitive barrier memoryBarrier dFdx dFdy fwidth",
      literal: "true false",
    },
    illegal: '"',
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "meta",
        begin: /^[ \t]*#[ \t]*[a-z_]+/m,
        end: /$/,
        contains: [
          { begin: /\\\n/, relevance: 0 },
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
        ],
      },
      {
        className: "number",
        begin:
          /\b(?:0[xX][0-9a-fA-F]+[uU]?|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?(?:[fFuU]|lf|LF)?)\b|\.\d+(?:[eE][-+]?\d+)?(?:[fF]|lf|LF)?\b/,
        relevance: 0,
      },
    ],
  };
}
