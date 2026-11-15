import parse from './parse.ts'
import type { Options } from '../types.ts'

const clean = (
  version: string,
  options?: boolean | Options | null,
): string | null => {
  const s = parse(version.trim().replace(/^[=v]+/, ''), options)
  return s ? s.version : null
}

export default clean
