import SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const compareBuild = (
  a: string | SemVer,
  b: string | SemVer,
  loose?: boolean | Options | null,
): 1 | 0 | -1 => {
  const versionA = new SemVer(a, loose)
  const versionB = new SemVer(b, loose)
  return versionA.compare(versionB) || versionA.compareBuild(versionB)
}

export default compareBuild
