import debug from '../internal/debug.ts'
import { MAX_LENGTH, MAX_SAFE_INTEGER } from '../internal/constants.ts'
import { safeRe as re, t } from '../internal/re.ts'
import parseOptions from '../internal/parse-options.ts'
import { compareIdentifiers } from '../internal/identifiers.ts'
import type { IdentifierBase, Options, RangeOptions, ReleaseType } from '../types.ts'

const isPrereleaseIdentifier = (prerelease: ReadonlyArray<string | number>, identifier: string): boolean => {
  const identifiers = identifier.split('.')
  if (identifiers.length > prerelease.length) {
    return false
  }

  for (let i = 0; i < identifiers.length; i++) {
    if (compareIdentifiers(prerelease[i]!, identifiers[i]!) !== 0) {
      return false
    }
  }

  return true
}

export default class SemVer {
  raw!: string
  loose!: boolean
  options!: Options
  includePrerelease!: boolean
  major!: number
  minor!: number
  patch!: number
  version!: string
  build!: string[]
  prerelease!: Array<string | number>

  constructor(version: string | SemVer, options?: boolean | RangeOptions | null) {
    const opts = parseOptions(options)

    if (version instanceof SemVer) {
      if (
        version.loose === !!opts.loose &&
        version.includePrerelease === !!opts.includePrerelease
      ) {
        return version
      } else {
        version = version.version
      }
    } else if (typeof version !== 'string') {
      throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`)
    }

    if (version.length > MAX_LENGTH) {
      throw new TypeError(`version is longer than ${MAX_LENGTH} characters`)
    }

    debug('SemVer', version, opts)
    this.options = opts
    this.loose = !!opts.loose
    this.includePrerelease = !!opts.includePrerelease

    const m = version.trim().match(opts.loose ? re[t.LOOSE!]! : re[t.FULL!]!)

    if (!m) {
      throw new TypeError(`Invalid Version: ${version}`)
    }

    this.raw = version

    // these are actually numbers
    this.major = +m[1]!
    this.minor = +m[2]!
    this.patch = +m[3]!

    if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
      throw new TypeError('Invalid major version')
    }

    if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
      throw new TypeError('Invalid minor version')
    }

    if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
      throw new TypeError('Invalid patch version')
    }

    // numberify any prerelease numeric ids
    if (!m[4]) {
      this.prerelease = []
    } else {
      this.prerelease = m[4].split('.').map((id) => {
        if (/^[0-9]+$/.test(id)) {
          const num = +id
          if (num >= 0 && num < MAX_SAFE_INTEGER) {
            return num
          }
        }
        return id
      })
    }

    this.build = m[5] ? m[5].split('.') : []
    this.format()
  }

  format(): string {
    this.version = `${this.major}.${this.minor}.${this.patch}`
    if (this.prerelease.length) {
      this.version += `-${this.prerelease.join('.')}`
    }
    return this.version
  }

  toString(): string {
    return this.version
  }

  compare(other: string | SemVer): 1 | 0 | -1 {
    debug('SemVer.compare', this.version, this.options, other)
    if (!(other instanceof SemVer)) {
      if (typeof other === 'string' && other === this.version) {
        return 0
      }
      other = new SemVer(other, this.options)
    }

    if (other.version === this.version) {
      return 0
    }

    return this.compareMain(other) || this.comparePre(other)
  }

  compareMain(other: string | SemVer): 1 | 0 | -1 {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options)
    }

    if (this.major < other.major) {
      return -1
    }
    if (this.major > other.major) {
      return 1
    }
    if (this.minor < other.minor) {
      return -1
    }
    if (this.minor > other.minor) {
      return 1
    }
    if (this.patch < other.patch) {
      return -1
    }
    if (this.patch > other.patch) {
      return 1
    }
    return 0
  }

  comparePre(other: string | SemVer): 1 | 0 | -1 {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options)
    }

    // NOT having a prerelease is > having one
    if (this.prerelease.length && !other.prerelease.length) {
      return -1
    } else if (!this.prerelease.length && other.prerelease.length) {
      return 1
    } else if (!this.prerelease.length && !other.prerelease.length) {
      return 0
    }

    let i = 0
    do {
      const a = this.prerelease[i]
      const b = other.prerelease[i]
      debug('prerelease compare', i, a, b)
      if (a === undefined && b === undefined) {
        return 0
      } else if (b === undefined) {
        return 1
      } else if (a === undefined) {
        return -1
      } else if (a === b) {
        continue
      } else {
        return compareIdentifiers(a, b)
      }
    } while (++i)
    return 0
  }

  compareBuild(other: string | SemVer): 1 | 0 | -1 {
    if (!(other instanceof SemVer)) {
      other = new SemVer(other, this.options)
    }

    let i = 0
    do {
      const a = this.build[i]
      const b = other.build[i]
      debug('build compare', i, a, b)
      if (a === undefined && b === undefined) {
        return 0
      } else if (b === undefined) {
        return 1
      } else if (a === undefined) {
        return -1
      } else if (a === b) {
        continue
      } else {
        return compareIdentifiers(a, b)
      }
    } while (++i)
    return 0
  }

  inc(
    release: ReleaseType,
    identifier?: string,
    identifierBase?: IdentifierBase,
  ): SemVer {
    if (release.startsWith('pre')) {
      if (!identifier && identifierBase === false) {
        throw new Error('invalid increment argument: identifier is empty')
      }
      if (identifier) {
        const match = `-${identifier}`.match(
          this.options.loose ? re[t.PRERELEASELOOSE!]! : re[t.PRERELEASE!]!,
        )
        if (!match || match[1] !== identifier) {
          throw new Error(`invalid identifier: ${identifier}`)
        }
      }
    }

    switch (release as ReleaseType | 'pre') {
      case 'premajor':
        this.prerelease.length = 0
        this.patch = 0
        this.minor = 0
        this.major++
        this.inc('pre' as ReleaseType, identifier, identifierBase)
        break
      case 'preminor':
        this.prerelease.length = 0
        this.patch = 0
        this.minor++
        this.inc('pre' as ReleaseType, identifier, identifierBase)
        break
      case 'prepatch':
        this.prerelease.length = 0
        this.inc('patch', identifier, identifierBase)
        this.inc('pre' as ReleaseType, identifier, identifierBase)
        break
      case 'prerelease':
        if (this.prerelease.length === 0) {
          this.inc('patch', identifier, identifierBase)
        }
        this.inc('pre' as ReleaseType, identifier, identifierBase)
        break
      case 'release':
        if (this.prerelease.length === 0) {
          throw new Error(`version ${this.raw} is not a prerelease`)
        }
        this.prerelease.length = 0
        break
      case 'major':
        if (
          this.minor !== 0 ||
          this.patch !== 0 ||
          this.prerelease.length === 0
        ) {
          this.major++
        }
        this.minor = 0
        this.patch = 0
        this.prerelease = []
        break
      case 'minor':
        if (this.patch !== 0 || this.prerelease.length === 0) {
          this.minor++
        }
        this.patch = 0
        this.prerelease = []
        break
      case 'patch':
        if (this.prerelease.length === 0) {
          this.patch++
        }
        this.prerelease = []
        break
      case 'pre': {
        const base = Number(identifierBase) ? 1 : 0

        if (this.prerelease.length === 0) {
          this.prerelease = [base]
        } else {
          let i = this.prerelease.length
          while (--i >= 0) {
            const cur = this.prerelease[i]
            if (typeof cur === 'number') {
              this.prerelease[i] = cur + 1
              i = -2
            }
          }
          if (i === -1) {
            if (identifier === this.prerelease.join('.') && identifierBase === false) {
              throw new Error('invalid increment argument: identifier already exists')
            }
            this.prerelease.push(base)
          }
        }
        if (identifier) {
          let prerelease: Array<string | number> = [identifier, base]
          if (identifierBase === false) {
            prerelease = [identifier]
          }
          if (isPrereleaseIdentifier(this.prerelease, identifier)) {
            const prereleaseBase = this.prerelease[identifier.split('.').length]
            if (isNaN(prereleaseBase as unknown as number)) {
              this.prerelease = prerelease
            }
          } else {
            this.prerelease = prerelease
          }
        }
        break
      }
      default:
        throw new Error(`invalid increment argument: ${release}`)
    }
    this.raw = this.format()
    if (this.build.length) {
      this.raw += `+${this.build.join('.')}`
    }
    return this
  }
}
