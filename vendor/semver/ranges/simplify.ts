import satisfies from '../functions/satisfies.ts'
import compare from '../functions/compare.ts'
import type Range from '../classes/range.ts'
import type { Options } from '../types.ts'

const simplifyRange = (
  versions: string[],
  range: string | Range,
  options?: boolean | Options | null,
): string | Range => {
  const set: Array<[string, string | null]> = []
  let first: string | null = null
  let prev: string | null = null
  const v = versions.sort((a, b) => compare(a, b, options))
  for (const version of v) {
    const included = satisfies(version, range, options)
    if (included) {
      prev = version
      if (!first) {
        first = version
      }
    } else {
      if (prev) {
        set.push([first!, prev])
      }
      prev = null
      first = null
    }
  }
  if (first) {
    set.push([first, null])
  }

  const ranges: string[] = []
  for (const [min, max] of set) {
    if (min === max) {
      ranges.push(min)
    } else if (!max && min === v[0]) {
      ranges.push('*')
    } else if (!max) {
      ranges.push(`>=${min}`)
    } else if (min === v[0]) {
      ranges.push(`<=${max}`)
    } else {
      ranges.push(`${min} - ${max}`)
    }
  }
  const simplified = ranges.join(' || ')
  const original =
    typeof range === 'object' && typeof range.raw === 'string'
      ? range.raw
      : String(range)
  return simplified.length < original.length ? simplified : range
}

export default simplifyRange
