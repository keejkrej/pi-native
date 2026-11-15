import SemVer from '../classes/semver.ts'
import Range from '../classes/range.ts'
import type { RangeOptions } from '../types.ts'

const minSatisfying = <T extends string | SemVer>(
  versions: readonly T[],
  range: string | Range,
  options?: boolean | RangeOptions | null,
): T | null => {
  let min: T | null = null
  let minSV: SemVer | null = null
  let rangeObj: Range | null = null
  try {
    rangeObj = new Range(range, options)
  } catch (_er) {
    return null
  }
  versions.forEach((v) => {
    if (rangeObj!.test(v)) {
      if (!min || minSV!.compare(v) === 1) {
        min = v
        minSV = new SemVer(min, options)
      }
    }
  })
  return min
}

export default minSatisfying
