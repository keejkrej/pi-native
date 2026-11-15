import * as internalRe from './internal/re.ts'
import * as constants from './internal/constants.ts'
import SemVer from './classes/semver.ts'
import * as identifiers from './internal/identifiers.ts'
import parse from './functions/parse.ts'
import valid from './functions/valid.ts'
import clean from './functions/clean.ts'
import inc from './functions/inc.ts'
import diff from './functions/diff.ts'
import major from './functions/major.ts'
import minor from './functions/minor.ts'
import patch from './functions/patch.ts'
import prerelease from './functions/prerelease.ts'
import compare from './functions/compare.ts'
import rcompare from './functions/rcompare.ts'
import compareLoose from './functions/compare-loose.ts'
import compareBuild from './functions/compare-build.ts'
import sort from './functions/sort.ts'
import rsort from './functions/rsort.ts'
import gt from './functions/gt.ts'
import lt from './functions/lt.ts'
import eq from './functions/eq.ts'
import neq from './functions/neq.ts'
import gte from './functions/gte.ts'
import lte from './functions/lte.ts'
import cmp from './functions/cmp.ts'
import coerce from './functions/coerce.ts'
import truncate from './functions/truncate.ts'
import Comparator from './classes/comparator.ts'
import Range from './classes/range.ts'
import satisfies from './functions/satisfies.ts'
import toComparators from './ranges/to-comparators.ts'
import maxSatisfying from './ranges/max-satisfying.ts'
import minSatisfying from './ranges/min-satisfying.ts'
import minVersion from './ranges/min-version.ts'
import validRange from './ranges/valid.ts'
import outside from './ranges/outside.ts'
import gtr from './ranges/gtr.ts'
import ltr from './ranges/ltr.ts'
import intersects from './ranges/intersects.ts'
import simplifyRange from './ranges/simplify.ts'
import subset from './ranges/subset.ts'

export const re: RegExp[] = internalRe.re
export const src: string[] = internalRe.src
export const tokens: Record<string, number> = internalRe.t
export const SEMVER_SPEC_VERSION: typeof constants.SEMVER_SPEC_VERSION = constants.SEMVER_SPEC_VERSION
export const RELEASE_TYPES: typeof constants.RELEASE_TYPES = constants.RELEASE_TYPES
export const compareIdentifiers: typeof identifiers.compareIdentifiers = identifiers.compareIdentifiers
export const rcompareIdentifiers: typeof identifiers.rcompareIdentifiers = identifiers.rcompareIdentifiers

export {
  parse,
  valid,
  clean,
  inc,
  diff,
  major,
  minor,
  patch,
  prerelease,
  compare,
  rcompare,
  compareLoose,
  compareBuild,
  sort,
  rsort,
  gt,
  lt,
  eq,
  neq,
  gte,
  lte,
  cmp,
  coerce,
  truncate,
  Comparator,
  Range,
  satisfies,
  toComparators,
  maxSatisfying,
  minSatisfying,
  minVersion,
  validRange,
  outside,
  gtr,
  ltr,
  intersects,
  simplifyRange,
  subset,
  SemVer,
}

export type {
  ReleaseType,
  IdentifierBase,
  Options,
  RangeOptions,
  CoerceOptions,
  Operator,
} from './types.ts'
