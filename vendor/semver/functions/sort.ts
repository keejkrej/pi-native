import compareBuild from './compare-build.ts'
import type SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const sort = <T extends string | SemVer>(
  list: T[],
  loose?: boolean | Options | null,
): T[] => list.sort((a, b) => compareBuild(a, b, loose))

export default sort
