import LRU from '../internal/lrucache.ts'
import parseOptions from '../internal/parse-options.ts'
import Comparator from './comparator.ts'
import debug from '../internal/debug.ts'
import SemVer from './semver.ts'
import {
  safeRe as re,
  src,
  t,
  comparatorTrimReplace,
  tildeTrimReplace,
  caretTrimReplace,
} from '../internal/re.ts'
import { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } from '../internal/constants.ts'
import type { RangeOptions } from '../types.ts'

const SPACE_CHARACTERS = /\s+/g
const cache = new LRU<string, Comparator[]>()
const BUILDSTRIPRE = new RegExp(src[t.BUILD!]!, 'g')

const isNullSet = (c: Comparator): boolean => c.value === '<0.0.0-0'
const isAny = (c: Comparator): boolean => c.value === ''

export default class Range {
  raw!: string
  loose!: boolean
  options!: RangeOptions
  includePrerelease!: boolean
  set!: Comparator[][]
  private formatted: string | undefined

  constructor(range: string | Range | Comparator, options?: boolean | RangeOptions | null) {
    const opts = parseOptions(options)

    if (range instanceof Range) {
      if (
        range.loose === !!opts.loose &&
        range.includePrerelease === !!opts.includePrerelease
      ) {
        return range
      } else {
        return new Range(range.raw, opts)
      }
    }

    if (range instanceof Comparator) {
      this.raw = range.value
      this.set = [[range]]
      this.options = opts
      this.loose = !!opts.loose
      this.includePrerelease = !!opts.includePrerelease
      this.formatted = undefined
      return this
    }

    this.options = opts
    this.loose = !!opts.loose
    this.includePrerelease = !!opts.includePrerelease

    this.raw = range.trim().replace(SPACE_CHARACTERS, ' ')

    this.set = this.raw
      .split('||')
      .map((r) => this.parseRange(r.trim()))
      .filter((c) => c.length)

    if (!this.set.length) {
      throw new TypeError(`Invalid SemVer Range: ${this.raw}`)
    }

    if (this.set.length > 1) {
      const first = this.set[0]!
      this.set = this.set.filter((c) => !isNullSet(c[0]!))
      if (this.set.length === 0) {
        this.set = [first]
      } else if (this.set.length > 1) {
        for (const c of this.set) {
          if (c.length === 1 && isAny(c[0]!)) {
            this.set = [c]
            break
          }
        }
      }
    }

    this.formatted = undefined
  }

  get range(): string {
    if (this.formatted === undefined) {
      this.formatted = ''
      for (let i = 0; i < this.set.length; i++) {
        if (i > 0) {
          this.formatted += '||'
        }
        const comps = this.set[i]!
        for (let k = 0; k < comps.length; k++) {
          if (k > 0) {
            this.formatted += ' '
          }
          this.formatted += comps[k]!.toString().trim()
        }
      }
    }
    return this.formatted
  }

  format(): string {
    return this.range
  }

  toString(): string {
    return this.range
  }

  parseRange(range: string): Comparator[] {
    range = range.replace(BUILDSTRIPRE, '')

    const memoOpts =
      (this.options.includePrerelease ? FLAG_INCLUDE_PRERELEASE : 0) |
      (this.options.loose ? FLAG_LOOSE : 0)
    const memoKey = memoOpts + ':' + range
    const cached = cache.get(memoKey)
    if (cached) {
      return cached
    }

    const loose = this.options.loose
    const hr = loose ? re[t.HYPHENRANGELOOSE!]! : re[t.HYPHENRANGE!]!
    range = range.replace(hr, hyphenReplace(this.options.includePrerelease))
    debug('hyphen replace', range)

    range = range.replace(re[t.COMPARATORTRIM!]!, comparatorTrimReplace)
    debug('comparator trim', range)

    range = range.replace(re[t.TILDETRIM!]!, tildeTrimReplace)
    debug('tilde trim', range)

    range = range.replace(re[t.CARETTRIM!]!, caretTrimReplace)
    debug('caret trim', range)

    let rangeList = range
      .split(' ')
      .map((comp) => parseComparator(comp, this.options))
      .join(' ')
      .split(/\s+/)
      .map((comp) => replaceGTE0(comp, this.options))

    if (loose) {
      rangeList = rangeList.filter((comp) => {
        debug('loose invalid filter', comp, this.options)
        return !!comp.match(re[t.COMPARATORLOOSE!]!)
      })
    }
    debug('range list', rangeList)

    const rangeMap = new Map<string, Comparator>()
    const comparators = rangeList.map((comp) => new Comparator(comp, this.options))
    for (const comp of comparators) {
      if (isNullSet(comp)) {
        return [comp]
      }
      rangeMap.set(comp.value, comp)
    }
    if (rangeMap.size > 1 && rangeMap.has('')) {
      rangeMap.delete('')
    }

    const result = [...rangeMap.values()]
    cache.set(memoKey, result)
    return result
  }

  intersects(range: Range, options?: boolean | RangeOptions | null): boolean {
    if (!(range instanceof Range)) {
      throw new TypeError('a Range is required')
    }

    return this.set.some((thisComparators) => {
      return (
        isSatisfiable(thisComparators, options) &&
        range.set.some((rangeComparators) => {
          return (
            isSatisfiable(rangeComparators, options) &&
            thisComparators.every((thisComparator) => {
              return rangeComparators.every((rangeComparator) => {
                return thisComparator.intersects(rangeComparator, options)
              })
            })
          )
        })
      )
    })
  }

  test(version: string | SemVer): boolean {
    if (!version) {
      return false
    }

    if (typeof version === 'string') {
      try {
        version = new SemVer(version, this.options)
      } catch (_er) {
        return false
      }
    }

    for (let i = 0; i < this.set.length; i++) {
      if (testSet(this.set[i]!, version, this.options)) {
        return true
      }
    }
    return false
  }
}

const isSatisfiable = (comparators: Comparator[], options?: boolean | RangeOptions | null): boolean => {
  let result = true
  const remainingComparators = comparators.slice()
  let testComparator = remainingComparators.pop()

  while (result && testComparator && remainingComparators.length) {
    result = remainingComparators.every((otherComparator) => {
      return testComparator!.intersects(otherComparator, options)
    })

    testComparator = remainingComparators.pop()
  }

  return result
}

const parseComparator = (comp: string, options: RangeOptions): string => {
  comp = comp.replace(re[t.BUILD!]!, '')
  debug('comp', comp, options)
  comp = replaceCarets(comp, options)
  debug('caret', comp)
  comp = replaceTildes(comp, options)
  debug('tildes', comp)
  comp = replaceXRanges(comp, options)
  debug('xrange', comp)
  comp = replaceStars(comp, options)
  debug('stars', comp)
  return comp
}

const isX = (id?: string | number): boolean => !id || String(id).toLowerCase() === 'x' || id === '*'

const invalidXRangeOrder = (M: string, m: string, p: string): boolean =>
  (isX(M) && !isX(m)) || (isX(m) && !!p && !isX(p))

const replaceTildes = (comp: string, options: RangeOptions): string =>
  comp
    .trim()
    .split(/\s+/)
    .map((c) => replaceTilde(c, options))
    .join(' ')

const replaceTilde = (comp: string, options: RangeOptions): string => {
  const r = options.loose ? re[t.TILDELOOSE!]! : re[t.TILDE!]!
  const z = options.includePrerelease ? '-0' : ''
  return comp.replace(
    r,
    (
      _,
      M: string | undefined,
      m: string | undefined,
      p: string | undefined,
      pr: string | undefined,
    ) => {
      debug('tilde', comp, _, M, m, p, pr)
      let ret: string

      if (isX(M)) {
        ret = ''
      } else if (isX(m)) {
        const major = M ?? ''
        ret = `>=${major}.0.0${z} <${+major + 1}.0.0-0`
      } else if (isX(p)) {
        const major = M ?? ''
        const minor = m ?? ''
        ret = `>=${major}.${minor}.0${z} <${major}.${+minor + 1}.0-0`
      } else if (pr) {
        const major = M ?? ''
        const minor = m ?? ''
        const patch = p ?? ''
        debug('replaceTilde pr', pr)
        ret = `>=${major}.${minor}.${patch}-${pr} <${major}.${+minor + 1}.0-0`
      } else {
        const major = M ?? ''
        const minor = m ?? ''
        const patch = p ?? ''
        ret = `>=${major}.${minor}.${patch} <${major}.${+minor + 1}.0-0`
      }

      debug('tilde return', ret)
      return ret
    },
  )
}

const replaceCarets = (comp: string, options: RangeOptions): string =>
  comp
    .trim()
    .split(/\s+/)
    .map((c) => replaceCaret(c, options))
    .join(' ')

const replaceCaret = (comp: string, options: RangeOptions): string => {
  debug('caret', comp, options)
  const r = options.loose ? re[t.CARETLOOSE!]! : re[t.CARET!]!
  const z = options.includePrerelease ? '-0' : ''
  return comp.replace(
    r,
    (
      _,
      M: string | undefined,
      m: string | undefined,
      p: string | undefined,
      pr: string | undefined,
    ) => {
      debug('caret', comp, _, M, m, p, pr)
      let ret: string

      if (isX(M)) {
        ret = ''
      } else if (isX(m)) {
        const major = M ?? ''
        ret = `>=${major}.0.0${z} <${+major + 1}.0.0-0`
      } else if (isX(p)) {
        const major = M ?? ''
        const minor = m ?? ''
        if (major === '0') {
          ret = `>=${major}.${minor}.0${z} <${major}.${+minor + 1}.0-0`
        } else {
          ret = `>=${major}.${minor}.0${z} <${+major + 1}.0.0-0`
        }
      } else if (pr) {
        const major = M ?? ''
        const minor = m ?? ''
        const patch = p ?? ''
        debug('replaceCaret pr', pr)
        if (major === '0') {
          if (minor === '0') {
            ret = `>=${major}.${minor}.${patch}-${pr} <${major}.${minor}.${+patch + 1}-0`
          } else {
            ret = `>=${major}.${minor}.${patch}-${pr} <${major}.${+minor + 1}.0-0`
          }
        } else {
          ret = `>=${major}.${minor}.${patch}-${pr} <${+major + 1}.0.0-0`
        }
      } else {
        const major = M ?? ''
        const minor = m ?? ''
        const patch = p ?? ''
        debug('no pr')
        if (major === '0') {
          if (minor === '0') {
            ret = `>=${major}.${minor}.${patch} <${major}.${minor}.${+patch + 1}-0`
          } else {
            ret = `>=${major}.${minor}.${patch} <${major}.${+minor + 1}.0-0`
          }
        } else {
          ret = `>=${major}.${minor}.${patch} <${+major + 1}.0.0-0`
        }
      }

      debug('caret return', ret)
      return ret
    },
  )
}

const replaceXRanges = (comp: string, options: RangeOptions): string =>
  comp
    .split(/\s+/)
    .map((c) => replaceXRange(c, options))
    .join(' ')

const replaceXRange = (comp: string, options: RangeOptions): string => {
  comp = comp.trim()
  const r = options.loose ? re[t.XRANGELOOSE!]! : re[t.XRANGE!]!
  return comp.replace(
    r,
    (
      ret: string,
      gtlt: string | undefined,
      M: string | undefined,
      m: string | number | undefined,
      p: string | number | undefined,
      pr: string | undefined,
    ) => {
      let major = M ?? ''
      let minor: string | number = m ?? ''
      let patch: string | number = p ?? ''
      let op = gtlt ?? ''
      debug('xRange', comp, ret, op, major, minor, patch, pr)
      if (invalidXRangeOrder(major, String(minor), String(patch))) {
        return comp
      }

      const xM = isX(major)
      const xm = xM || isX(minor)
      const xp = xm || isX(patch)
      const anyX = xp

      if (op === '=' && anyX) {
        op = ''
      }

      pr = options.includePrerelease ? '-0' : ''

      if (xM) {
        if (op === '>' || op === '<') {
          ret = '<0.0.0-0'
        } else {
          ret = '*'
        }
      } else if (op && anyX) {
        if (xm) {
          minor = 0
        }
        patch = 0

        if (op === '>') {
          op = '>='
          if (xm) {
            major = String(+major + 1)
            minor = 0
            patch = 0
          } else {
            minor = +minor + 1
            patch = 0
          }
        } else if (op === '<=') {
          op = '<'
          if (xm) {
            major = String(+major + 1)
          } else {
            minor = +minor + 1
          }
        }

        if (op === '<') {
          pr = '-0'
        }

        ret = `${op + major}.${minor}.${patch}${pr}`
      } else if (xm) {
        ret = `>=${major}.0.0${pr} <${+major + 1}.0.0-0`
      } else if (xp) {
        ret = `>=${major}.${minor}.0${pr} <${major}.${+minor + 1}.0-0`
      }

      debug('xRange return', ret)
      return ret
    },
  )
}

const replaceStars = (comp: string, options: RangeOptions): string => {
  debug('replaceStars', comp, options)
  return comp.trim().replace(re[t.STAR!]!, '')
}

const replaceGTE0 = (comp: string, options: RangeOptions): string => {
  debug('replaceGTE0', comp, options)
  return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE! : t.GTE0!]!, '')
}

const hyphenReplace =
  (incPr?: boolean) =>
  (
    _$0: string,
    from: string | undefined,
    fM: string | undefined,
    fm: string | undefined,
    fp: string | undefined,
    fpr: string | undefined,
    _fb: string | undefined,
    to: string | undefined,
    tM: string | undefined,
    tm: string | undefined,
    tp: string | undefined,
    tpr: string | undefined,
  ): string => {
    let fromStr = from ?? ''
    if (isX(fM)) {
      fromStr = ''
    } else if (isX(fm)) {
      fromStr = `>=${fM ?? ''}.0.0${incPr ? '-0' : ''}`
    } else if (isX(fp)) {
      fromStr = `>=${fM ?? ''}.${fm ?? ''}.0${incPr ? '-0' : ''}`
    } else if (fpr) {
      fromStr = `>=${fromStr}`
    } else {
      fromStr = `>=${fromStr}${incPr ? '-0' : ''}`
    }

    let toStr = to ?? ''
    if (isX(tM)) {
      toStr = ''
    } else if (isX(tm)) {
      toStr = `<${+(tM ?? 0) + 1}.0.0-0`
    } else if (isX(tp)) {
      toStr = `<${tM ?? ''}.${+(tm ?? 0) + 1}.0-0`
    } else if (tpr) {
      toStr = `<=${tM ?? ''}.${tm ?? ''}.${tp ?? ''}-${tpr}`
    } else if (incPr) {
      toStr = `<${tM ?? ''}.${tm ?? ''}.${+(tp ?? 0) + 1}-0`
    } else {
      toStr = `<=${toStr}`
    }

    return `${fromStr} ${toStr}`.trim()
  }

const testSet = (set: Comparator[], version: SemVer, options: RangeOptions): boolean => {
  for (let i = 0; i < set.length; i++) {
    if (!set[i]!.test(version)) {
      return false
    }
  }

  if (version.prerelease.length && !options.includePrerelease) {
    for (let i = 0; i < set.length; i++) {
      debug(set[i]!.semver)
      if (set[i]!.semver === Comparator.ANY) {
        continue
      }

      if (set[i]!.semver.prerelease.length > 0) {
        const allowed = set[i]!.semver
        if (
          allowed.major === version.major &&
          allowed.minor === version.minor &&
          allowed.patch === version.patch
        ) {
          return true
        }
      }
    }

    return false
  }

  return true
}
