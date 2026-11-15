const _proc = (
  globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }
).process

const debug: (...args: unknown[]) => void =
  typeof _proc === 'object' &&
  _proc?.env?.NODE_DEBUG &&
  /\bsemver\b/i.test(_proc.env.NODE_DEBUG)
    ? (...args: unknown[]) => console.error('SEMVER', ...args)
    : () => {}

export default debug
