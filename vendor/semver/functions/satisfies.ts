import Range from '../classes/range.ts'
import type SemVer from '../classes/semver.ts'
import type { RangeOptions } from '../types.ts'

const satisfies = (
  version: string | SemVer,
  range: string | Range,
  options?: boolean | RangeOptions | null,
): boolean => {
  try {
    range = new Range(range, options)
  } catch (_er) {
    return false
  }
  return range.test(version)
}

export default satisfies
