import SemVer from '../classes/semver.ts'
import type { Options, RangeOptions } from '../types.ts'

function parse(version?: string | SemVer | null): SemVer | null
function parse(
  version: string | SemVer | null | undefined,
  optionsOrLoose: boolean | Options | RangeOptions | null | undefined,
  throwErrors: true,
): SemVer
function parse(
  version: string | SemVer | null | undefined,
  optionsOrLoose?: boolean | Options | RangeOptions | null,
  throwErrors?: boolean,
): SemVer | null
function parse(
  version?: string | SemVer | null,
  options?: boolean | Options | RangeOptions | null,
  throwErrors = false,
): SemVer | null {
  if (version instanceof SemVer) {
    return version
  }
  try {
    return new SemVer(version as string, options)
  } catch (er) {
    if (!throwErrors) {
      return null
    }
    throw er
  }
}

export default parse
