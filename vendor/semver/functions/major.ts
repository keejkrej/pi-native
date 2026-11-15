import SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const major = (a: string | SemVer, loose?: boolean | Options | null): number =>
  new SemVer(a, loose).major

export default major
