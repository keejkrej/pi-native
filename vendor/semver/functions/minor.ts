import SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const minor = (a: string | SemVer, loose?: boolean | Options | null): number =>
  new SemVer(a, loose).minor

export default minor
