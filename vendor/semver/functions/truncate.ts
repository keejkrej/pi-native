import parse from './parse.ts'
import * as constants from '../internal/constants.ts'
import SemVer from '../classes/semver.ts'
import type { Options, ReleaseType } from '../types.ts'

const truncate = (
  version: string | SemVer,
  truncation: ReleaseType,
  options?: boolean | Options | null,
): string | null => {
  if (!constants.RELEASE_TYPES.includes(truncation)) {
    return null
  }

  const clonedVersion = cloneInputVersion(version, options)
  return clonedVersion && doTruncation(clonedVersion, truncation)
}

const cloneInputVersion = (
  version: string | SemVer,
  options?: boolean | Options | null,
): SemVer | null => {
  const versionStringToParse = version instanceof SemVer ? version.version : version
  return parse(versionStringToParse, options)
}

const doTruncation = (version: SemVer, truncation: ReleaseType): string => {
  if (isPrerelease(truncation)) {
    return version.version
  }

  version.prerelease = []

  switch (truncation) {
    case 'major':
      version.minor = 0
      version.patch = 0
      break
    case 'minor':
      version.patch = 0
      break
  }

  return version.format()
}

const isPrerelease = (type: ReleaseType): boolean => type.startsWith('pre')

export default truncate
