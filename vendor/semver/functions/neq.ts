import compare from './compare.ts'
import type SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const neq = (
  a: string | SemVer,
  b: string | SemVer,
  loose?: boolean | Options | null,
): boolean => compare(a, b, loose) !== 0

export default neq
