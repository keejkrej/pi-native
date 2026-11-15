import Range from '../classes/range.ts'
import Comparator from '../classes/comparator.ts'
import satisfies from '../functions/satisfies.ts'
import compare from '../functions/compare.ts'
import type SemVer from '../classes/semver.ts'
import type { RangeOptions } from '../types.ts'

const ANY = Comparator.ANY

const subset = (
  sub: string | Range,
  dom: string | Range,
  options: boolean | RangeOptions = {},
): boolean => {
  if (sub === dom) {
    return true
  }

  sub = new Range(sub, options)
  dom = new Range(dom, options)
  let sawNonNull = false

  OUTER: for (const simpleSub of sub.set) {
    for (const simpleDom of dom.set) {
      const isSub = simpleSubset(simpleSub, simpleDom, options)
      sawNonNull = sawNonNull || isSub !== null
      if (isSub) {
        continue OUTER
      }
    }
    if (sawNonNull) {
      return false
    }
  }
  return true
}

const minimumVersionWithPreRelease = [new Comparator('>=0.0.0-0')]
const minimumVersion = [new Comparator('>=0.0.0')]

const simpleSubset = (
  sub: Comparator[],
  dom: Comparator[],
  options: boolean | RangeOptions,
): boolean | null => {
  if (sub === dom) {
    return true
  }

  const opts = typeof options === 'object' && options ? options : { loose: !!options }

  if (sub.length === 1 && sub[0]!.semver === ANY) {
    if (dom.length === 1 && dom[0]!.semver === ANY) {
      return true
    } else if (opts.includePrerelease) {
      sub = minimumVersionWithPreRelease
    } else {
      sub = minimumVersion
    }
  }

  if (dom.length === 1 && dom[0]!.semver === ANY) {
    if (opts.includePrerelease) {
      return true
    } else {
      dom = minimumVersion
    }
  }

  const eqSet = new Set<SemVer>()
  let gt: Comparator | undefined
  let lt: Comparator | undefined
  for (const c of sub) {
    if (c.operator === '>' || c.operator === '>=') {
      gt = higherGT(gt, c, options)
    } else if (c.operator === '<' || c.operator === '<=') {
      lt = lowerLT(lt, c, options)
    } else {
      eqSet.add(c.semver)
    }
  }

  if (eqSet.size > 1) {
    return null
  }

  let gtltComp: number | undefined
  if (gt && lt) {
    gtltComp = compare(gt.semver, lt.semver, options)
    if (gtltComp > 0) {
      return null
    } else if (gtltComp === 0 && (gt.operator !== '>=' || lt.operator !== '<=')) {
      return null
    }
  }

  for (const eq of eqSet) {
    if (gt && !satisfies(eq, String(gt), options)) {
      return null
    }

    if (lt && !satisfies(eq, String(lt), options)) {
      return null
    }

    for (const c of dom) {
      if (!satisfies(eq, String(c), options)) {
        return false
      }
    }

    return true
  }

  let higher: Comparator
  let lower: Comparator
  let hasDomLT = false
  let hasDomGT = false
  let needDomLTPre: SemVer | false =
    lt && !opts.includePrerelease && lt.semver.prerelease.length
      ? lt.semver
      : false
  let needDomGTPre: SemVer | false =
    gt && !opts.includePrerelease && gt.semver.prerelease.length
      ? gt.semver
      : false

  if (
    needDomLTPre &&
    needDomLTPre.prerelease.length === 1 &&
    lt!.operator === '<' &&
    needDomLTPre.prerelease[0] === 0
  ) {
    needDomLTPre = false
  }

  for (const c of dom) {
    hasDomGT = hasDomGT || c.operator === '>' || c.operator === '>='
    hasDomLT = hasDomLT || c.operator === '<' || c.operator === '<='
    if (gt) {
      if (needDomGTPre) {
        if (
          c.semver.prerelease &&
          c.semver.prerelease.length &&
          c.semver.major === needDomGTPre.major &&
          c.semver.minor === needDomGTPre.minor &&
          c.semver.patch === needDomGTPre.patch
        ) {
          needDomGTPre = false
        }
      }
      if (c.operator === '>' || c.operator === '>=') {
        higher = higherGT(gt, c, options)
        if (higher === c && higher !== gt) {
          return false
        }
      } else if (gt.operator === '>=' && !c.test(gt.semver)) {
        return false
      }
    }
    if (lt) {
      if (needDomLTPre) {
        if (
          c.semver.prerelease &&
          c.semver.prerelease.length &&
          c.semver.major === needDomLTPre.major &&
          c.semver.minor === needDomLTPre.minor &&
          c.semver.patch === needDomLTPre.patch
        ) {
          needDomLTPre = false
        }
      }
      if (c.operator === '<' || c.operator === '<=') {
        lower = lowerLT(lt, c, options)
        if (lower === c && lower !== lt) {
          return false
        }
      } else if (lt.operator === '<=' && !c.test(lt.semver)) {
        return false
      }
    }
    if (!c.operator && (lt || gt) && gtltComp !== 0) {
      return false
    }
  }

  if (gt && hasDomLT && !lt && gtltComp !== 0) {
    return false
  }

  if (lt && hasDomGT && !gt && gtltComp !== 0) {
    return false
  }

  if (needDomGTPre || needDomLTPre) {
    return false
  }

  return true
}

const higherGT = (
  a: Comparator | undefined,
  b: Comparator,
  options: boolean | RangeOptions,
): Comparator => {
  if (!a) {
    return b
  }
  const comp = compare(a.semver, b.semver, options)
  return comp > 0
    ? a
    : comp < 0
      ? b
      : b.operator === '>' && a.operator === '>='
        ? b
        : a
}

const lowerLT = (
  a: Comparator | undefined,
  b: Comparator,
  options: boolean | RangeOptions,
): Comparator => {
  if (!a) {
    return b
  }
  const comp = compare(a.semver, b.semver, options)
  return comp < 0
    ? a
    : comp > 0
      ? b
      : b.operator === '<' && a.operator === '<='
        ? b
        : a
}

export default subset
