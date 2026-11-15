import parseOptions from '../internal/parse-options.ts'
import { safeRe as re, t } from '../internal/re.ts'
import cmp from '../functions/cmp.ts'
import debug from '../internal/debug.ts'
import SemVer from './semver.ts'
import Range from './range.ts'
import type { Options, RangeOptions } from '../types.ts'

const ANY = new SemVer('0.0.0')

export default class Comparator {
  static get ANY(): SemVer {
    return ANY
  }

  semver!: SemVer
  operator!: '' | '=' | '<' | '>' | '<=' | '>='
  value!: string
  loose!: boolean
  options!: Options

  constructor(comp: string | Comparator, options?: boolean | Options | null) {
    const opts = parseOptions(options)

    if (comp instanceof Comparator) {
      if (comp.loose === !!opts.loose) {
        return comp
      } else {
        comp = comp.value
      }
    }

    comp = comp.trim().split(/\s+/).join(' ')
    debug('comparator', comp, opts)
    this.options = opts
    this.loose = !!opts.loose
    this.parse(comp)

    if (this.semver === ANY) {
      this.value = ''
    } else {
      this.value = this.operator + this.semver.version
    }

    debug('comp', this)
  }

  parse(comp: string): void {
    const r = this.options.loose ? re[t.COMPARATORLOOSE!]! : re[t.COMPARATOR!]!
    const m = comp.match(r)

    if (!m) {
      throw new TypeError(`Invalid comparator: ${comp}`)
    }

    this.operator = (m[1] !== undefined ? m[1] : '') as Comparator['operator']
    if (this.operator === '=') {
      this.operator = ''
    }

    if (!m[2]) {
      this.semver = ANY
    } else {
      this.semver = new SemVer(m[2], this.options.loose)
    }
  }

  toString(): string {
    return this.value
  }

  test(version: string | SemVer): boolean {
    debug('Comparator.test', version, this.options.loose)

    if (this.semver === ANY || version === ANY) {
      return true
    }

    if (typeof version === 'string') {
      try {
        version = new SemVer(version, this.options)
      } catch (_er) {
        return false
      }
    }

    return cmp(version, this.operator, this.semver, this.options)
  }

  intersects(comp: Comparator, options?: boolean | RangeOptions | null): boolean {
    if (!(comp instanceof Comparator)) {
      throw new TypeError('a Comparator is required')
    }

    if (this.operator === '') {
      if (this.value === '') {
        return true
      }
      return new Range(comp.value, options).test(this.value)
    } else if (comp.operator === '') {
      if (comp.value === '') {
        return true
      }
      return new Range(this.value, options).test(comp.semver)
    }

    const opts = parseOptions(options)

    if (
      opts.includePrerelease &&
      (this.value === '<0.0.0-0' || comp.value === '<0.0.0-0')
    ) {
      return false
    }
    if (
      !opts.includePrerelease &&
      (this.value.startsWith('<0.0.0') || comp.value.startsWith('<0.0.0'))
    ) {
      return false
    }

    if (this.operator.startsWith('>') && comp.operator.startsWith('>')) {
      return true
    }
    if (this.operator.startsWith('<') && comp.operator.startsWith('<')) {
      return true
    }
    if (
      this.semver.version === comp.semver.version &&
      this.operator.includes('=') &&
      comp.operator.includes('=')
    ) {
      return true
    }
    if (
      cmp(this.semver, '<', comp.semver, opts) &&
      this.operator.startsWith('>') &&
      comp.operator.startsWith('<')
    ) {
      return true
    }
    if (
      cmp(this.semver, '>', comp.semver, opts) &&
      this.operator.startsWith('<') &&
      comp.operator.startsWith('>')
    ) {
      return true
    }
    return false
  }
}
