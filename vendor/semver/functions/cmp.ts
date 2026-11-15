import eq from './eq.ts'
import neq from './neq.ts'
import gt from './gt.ts'
import gte from './gte.ts'
import lt from './lt.ts'
import lte from './lte.ts'
import type SemVer from '../classes/semver.ts'
import type { Operator, Options } from '../types.ts'

const cmp = (
  a: string | SemVer,
  op: Operator,
  b: string | SemVer,
  loose?: boolean | Options | null,
): boolean => {
  switch (op) {
    case '===':
      if (typeof a === 'object') {
        a = a.version
      }
      if (typeof b === 'object') {
        b = b.version
      }
      return a === b

    case '!==':
      if (typeof a === 'object') {
        a = a.version
      }
      if (typeof b === 'object') {
        b = b.version
      }
      return a !== b

    case '':
    case '=':
    case '==':
      return eq(a, b, loose)

    case '!=':
      return neq(a, b, loose)

    case '>':
      return gt(a, b, loose)

    case '>=':
      return gte(a, b, loose)

    case '<':
      return lt(a, b, loose)

    case '<=':
      return lte(a, b, loose)

    default:
      throw new TypeError(`Invalid operator: ${op}`)
  }
}

export default cmp
