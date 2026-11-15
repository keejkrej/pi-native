import SemVer from '../classes/semver.ts'
import parse from './parse.ts'
import { safeRe as re, t } from '../internal/re.ts'
import type { CoerceOptions, RangeOptions } from '../types.ts'

const coerce = (
  version: string | number | SemVer | null | undefined,
  options?: CoerceOptions | null,
): SemVer | null => {
  if (version instanceof SemVer) {
    return version
  }

  if (typeof version === 'number') {
    version = String(version)
  }

  if (typeof version !== 'string') {
    return null
  }

  const opts: CoerceOptions = options || {}

  let match: RegExpMatchArray | null = null
  if (!opts.rtl) {
    match = version.match(opts.includePrerelease ? re[t.COERCEFULL!]! : re[t.COERCE!]!)
  } else {
    const coerceRtlRegex = opts.includePrerelease ? re[t.COERCERTLFULL!]! : re[t.COERCERTL!]!
    let next: RegExpExecArray | null
    while (
      (next = coerceRtlRegex.exec(version)) &&
      (!match || match.index! + match[0].length !== version.length)
    ) {
      if (!match || next.index + next[0].length !== match.index! + match[0].length) {
        match = next
      }
      coerceRtlRegex.lastIndex = next.index + next[1]!.length + next[2]!.length
    }
    coerceRtlRegex.lastIndex = -1
  }

  if (match === null) {
    return null
  }

  const major = match[2]!
  const minor = match[3] || '0'
  const patch = match[4] || '0'
  const prerelease = opts.includePrerelease && match[5] ? `-${match[5]}` : ''
  const build = opts.includePrerelease && match[6] ? `+${match[6]}` : ''

  const parseOpts: RangeOptions = {
    loose: opts.loose,
    includePrerelease: opts.includePrerelease,
  }
  return parse(`${major}.${minor}.${patch}${prerelease}${build}`, parseOpts)
}

export default coerce
