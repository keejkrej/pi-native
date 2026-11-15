import parse from './parse.ts'
import type SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const prerelease = (
  version: string | SemVer,
  options?: boolean | Options | null,
): ReadonlyArray<string | number> | null => {
  const parsed = parse(version, options)
  return parsed && parsed.prerelease.length ? parsed.prerelease : null
}

export default prerelease
