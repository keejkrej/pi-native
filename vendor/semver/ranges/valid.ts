import Range from '../classes/range.ts'
import type { RangeOptions } from '../types.ts'

const validRange = (
  range: string | Range | null | undefined,
  options?: boolean | RangeOptions | null,
): string | null => {
  try {
    return new Range(range as string | Range, options).range || '*'
  } catch (_er) {
    return null
  }
}

export default validRange
