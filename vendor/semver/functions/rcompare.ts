import compare from './compare.ts'
import type SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const rcompare = (
  a: string | SemVer,
  b: string | SemVer,
  loose?: boolean | Options | null,
): 1 | 0 | -1 => compare(b, a, loose)

export default rcompare
