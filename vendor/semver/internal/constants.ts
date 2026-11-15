import type { ReleaseType } from '../types.ts'

// Note: this is the semver.org version of the spec that it implements
// Not necessarily the package version of this code.
export const SEMVER_SPEC_VERSION = '2.0.0' as const

export const MAX_LENGTH = 256
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || 9007199254740991

// Max safe segment length for coercion.
export const MAX_SAFE_COMPONENT_LENGTH = 16

// Max safe length for a build identifier. The max length minus 6 characters for
// the shortest version with a build 0.0.0+BUILD.
export const MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6

export const RELEASE_TYPES: ReleaseType[] = [
  'major',
  'premajor',
  'minor',
  'preminor',
  'patch',
  'prepatch',
  'prerelease',
]

export const FLAG_INCLUDE_PRERELEASE = 0b001
export const FLAG_LOOSE = 0b010
