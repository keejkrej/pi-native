import Range from '../classes/range.ts'
import type { Options } from '../types.ts'

const toComparators = (
  range: string | Range,
  options?: boolean | Options | null,
): string[][] =>
  new Range(range, options).set.map((comp) =>
    comp.map((c) => c.value).join(' ').trim().split(' '),
  )

export default toComparators
