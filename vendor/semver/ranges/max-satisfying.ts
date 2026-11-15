import SemVer from '../classes/semver.ts'
import Range from '../classes/range.ts'
import type { RangeOptions } from '../types.ts'

const maxSatisfying = <T extends string | SemVer>(
  versions: readonly T[],
  range: string | Range,
  options?: boolean | RangeOptions | null,
): T | null => {
  let max: T | null = null
  let maxSV: SemVer | null = null
  let rangeObj: Range | null = null
  try {
    rangeObj = new Range(range, options)
  } catch (_er) {
    return null
  }
  versions.forEach((v) => {
    if (rangeObj!.test(v)) {
      if (!max || maxSV!.compare(v) === -1) {
        max = v
        maxSV = new SemVer(max, options)
      }
    }
  })
  return max
}

export default maxSatisfying
