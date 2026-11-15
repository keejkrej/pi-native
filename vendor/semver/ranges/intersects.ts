import Range from '../classes/range.ts'
import type { RangeOptions } from '../types.ts'

const intersects = (
  r1: string | Range,
  r2: string | Range,
  options?: boolean | RangeOptions | null,
): boolean => {
  const range1 = new Range(r1, options)
  const range2 = new Range(r2, options)
  return range1.intersects(range2, options)
}

export default intersects
