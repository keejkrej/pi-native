import SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const compare = (
  a: string | SemVer,
  b: string | SemVer,
  loose?: boolean | Options | null,
): 1 | 0 | -1 => new SemVer(a, loose).compare(new SemVer(b, loose))

export default compare
