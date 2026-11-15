import compare from './compare.ts'
import type SemVer from '../classes/semver.ts'

const compareLoose = (a: string | SemVer, b: string | SemVer): 1 | 0 | -1 =>
  compare(a, b, true)

export default compareLoose
