import parse from './parse.ts'
import type SemVer from '../classes/semver.ts'
import type { ReleaseType } from '../types.ts'

const diff = (version1: string | SemVer, version2: string | SemVer): ReleaseType | null => {
  const v1 = parse(version1, null, true)
  const v2 = parse(version2, null, true)
  const comparison = v1.compare(v2)

  if (comparison === 0) {
    return null
  }

  const v1Higher = comparison > 0
  const highVersion = v1Higher ? v1 : v2
  const lowVersion = v1Higher ? v2 : v1
  const highHasPre = !!highVersion.prerelease.length
  const lowHasPre = !!lowVersion.prerelease.length

  if (lowHasPre && !highHasPre) {
    if (!lowVersion.patch && !lowVersion.minor) {
      return 'major'
    }

    if (lowVersion.compareMain(highVersion) === 0) {
      if (lowVersion.minor && !lowVersion.patch) {
        return 'minor'
      }
      return 'patch'
    }
  }

  const prefix = highHasPre ? 'pre' : ''

  if (v1.major !== v2.major) {
    return (prefix + 'major') as ReleaseType
  }

  if (v1.minor !== v2.minor) {
    return (prefix + 'minor') as ReleaseType
  }

  if (v1.patch !== v2.patch) {
    return (prefix + 'patch') as ReleaseType
  }

  return 'prerelease'
}

export default diff
