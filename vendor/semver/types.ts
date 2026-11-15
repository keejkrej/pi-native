export type ReleaseType =
  | 'major'
  | 'premajor'
  | 'minor'
  | 'preminor'
  | 'patch'
  | 'prepatch'
  | 'prerelease'
  | 'release'

export type IdentifierBase = '0' | '1' | false

export interface Options {
  loose?: boolean | undefined
}

export interface RangeOptions extends Options {
  includePrerelease?: boolean | undefined
}

export interface CoerceOptions extends Options {
  includePrerelease?: boolean | undefined
  rtl?: boolean | undefined
}

export type Operator = '===' | '!==' | '' | '=' | '==' | '!=' | '>' | '>=' | '<' | '<='
