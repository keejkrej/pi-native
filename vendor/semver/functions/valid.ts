import parse from './parse.ts'
import type SemVer from '../classes/semver.ts'
import type { Options } from '../types.ts'

const valid = (
  version: string | SemVer | null | undefined,
  options?: boolean | Options | null,
): string | null => {
  const v = parse(version, options)
  return v ? v.version : null
}

export default valid
