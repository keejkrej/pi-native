const numeric = /^[0-9]+$/

export const compareIdentifiers = (a: string | number, b: string | number): 1 | 0 | -1 => {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b ? 0 : a < b ? -1 : 1
  }

  const anum = numeric.test(String(a))
  const bnum = numeric.test(String(b))

  if (anum && bnum) {
    a = +a
    b = +b
  }

  return a === b
    ? 0
    : anum && !bnum
      ? -1
      : bnum && !anum
        ? 1
        : a < b
          ? -1
          : 1
}

export const rcompareIdentifiers = (a: string | number, b: string | number): 1 | 0 | -1 =>
  compareIdentifiers(b, a)
