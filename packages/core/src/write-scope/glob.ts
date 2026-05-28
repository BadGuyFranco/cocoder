// Minimal path-glob matcher for write-scope allow-lists (ADR-0007). Supports the subset we
// author: `**` (any number of path segments, incl. across `/`), `*` (any chars within a
// segment), and literals. A tiny tested matcher beats a dependency for this (Bob's rule).

/** Convert a glob to an anchored RegExp over POSIX-style paths. */
export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*' // ** — across segment boundaries
        i += 1
      } else {
        out += '[^/]*' // * — within a segment
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += `\\${c}` // escape regex metachars
    } else {
      out += c
    }
  }
  return new RegExp(`^${out}$`)
}

/** True if `path` matches any glob in `globs`. Empty list = default-deny (matches nothing). */
export function matchesAny(path: string, globs: readonly string[]): boolean {
  const p = path.replace(/^\.\//, '').replace(/\\/g, '/')
  return globs.some((g) => globToRegExp(g).test(p))
}
