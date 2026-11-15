import type { RangeOptions } from '../types.ts'

const looseOption: RangeOptions = Object.freeze({ loose: true })
const emptyOpts: RangeOptions = Object.freeze({})

const parseOptions = (options?: boolean | RangeOptions | null): RangeOptions => {
  if (!options) {
    return emptyOpts
  }

  if (typeof options !== 'object') {
    return looseOption
  }

  return options
}

export default parseOptions
