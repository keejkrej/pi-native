import SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const patch = (a: string | SemVer, loose?: boolean | Options | null): number =>
  new SemVer(a, loose).patch

export default patch
