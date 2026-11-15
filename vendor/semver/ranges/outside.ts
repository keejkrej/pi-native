import SemVer from '../classes/semver.ts'
import Comparator from '../classes/comparator.ts'
import Range from '../classes/range.ts'
import satisfies from '../functions/satisfies.ts'
import gt from '../functions/gt.ts'
import lt from '../functions/lt.ts'
import lte from '../functions/lte.ts'
import gte from '../functions/gte.ts'
import type { RangeOptions } from '../types.ts'

const ANY = Comparator.ANY

const outside = (
  version: string | SemVer,
  range: string | Range,
  hilo: '>' | '<',
  options?: boolean | RangeOptions | null,
): boolean => {
  version = new SemVer(version, options)
  range = new Range(range, options)

  let gtfn: typeof gt
  let ltefn: typeof lte
  let ltfn: typeof lt
  let comp: '>' | '<'
  let ecomp: '>=' | '<='

  switch (hilo) {
    case '>':
      gtfn = gt
      ltefn = lte
      ltfn = lt
      comp = '>'
      ecomp = '>='
      break
    case '<':
      gtfn = lt
      ltefn = gte
      ltfn = gt
      comp = '<'
      ecomp = '<='
      break
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"')
  }

  if (satisfies(version, range, options)) {
    return false
  }

  for (let i = 0; i < range.set.length; ++i) {
    const comparators = range.set[i]!

    let high: Comparator | null = null
    let low: Comparator | null = null

    comparators.forEach((comparator) => {
      if (comparator.semver === ANY) {
        comparator = new Comparator('>=0.0.0')
      }
      high = high || comparator
      low = low || comparator
      if (gtfn(comparator.semver, high.semver, options)) {
        high = comparator
      } else if (ltfn(comparator.semver, low.semver, options)) {
        low = comparator
      }
    })

    if (high!.operator === comp || high!.operator === ecomp) {
      return false
    }

    if (
      (!low!.operator || low!.operator === comp) &&
      ltefn(version, low!.semver)
    ) {
      return false
    } else if (low!.operator === ecomp && ltfn(version, low!.semver)) {
      return false
    }
  }
  return true
}

export default outside
