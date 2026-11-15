import SemVer from '../classes/semver.ts'
import type { IdentifierBase, Options, ReleaseType } from '../types.ts'

function inc(
  version: string | SemVer,
  release: ReleaseType,
  optionsOrLoose?: boolean | Options | null,
  identifier?: string,
  identifierBase?: IdentifierBase,
): string | null
function inc(
  version: string | SemVer,
  release: ReleaseType,
  identifier: string,
  identifierBase?: IdentifierBase,
): string | null
function inc(
  version: string | SemVer,
  release: ReleaseType,
  options?: boolean | Options | string | null,
  identifier?: string | IdentifierBase,
  identifierBase?: IdentifierBase,
): string | null {
  if (typeof options === 'string') {
    identifierBase = identifier as IdentifierBase
    identifier = options
    options = undefined
  }

  try {
    return new SemVer(
      version instanceof SemVer ? version.version : version,
      options,
    ).inc(release, identifier as string | undefined, identifierBase).version
  } catch (_er) {
    return null
  }
}

export default inc
