import outside from './outside.ts'
import type SemVer from '../classes/semver.ts'
import type Range from '../classes/range.ts'
import type { RangeOptions } from '../types.ts'

// Determine if version is less than all the versions possible in the range.
const ltr = (
  version: string | SemVer,
  range: string | Range,
  options?: boolean | RangeOptions | null,
): boolean => outside(version, range, '<', options)

export default ltr
