// Pure scope partition (ADR-0007). Splits the changed-file set into in-scope (committable)
// and out-of-scope (held back, surfaced) against the allow-list. Default-deny: an empty scope
// means everything is out of scope (e.g. a read-only persona that nonetheless wrote files).
import { matchesAny } from './glob.js'

export interface ScopePartition {
  readonly inScope: readonly string[]
  readonly outOfScope: readonly string[]
}

/** Narrow a persona's default scope by a priority's scopeNarrowing (intersection of intent):
 *  the effective allow-list is the narrowing if present, else the persona default. The
 *  narrowing is referenced, not restated (no F4) — it simply replaces the default for the run. */
export function effectiveScope(personaScope: readonly string[], priorityNarrowing: readonly string[] | null): string[] {
  return priorityNarrowing && priorityNarrowing.length > 0 ? [...priorityNarrowing] : [...personaScope]
}

export function partitionByScope(changedFiles: readonly string[], scope: readonly string[]): ScopePartition {
  const inScope: string[] = []
  const outOfScope: string[] = []
  for (const f of changedFiles) {
    ;(matchesAny(f, scope) ? inScope : outOfScope).push(f)
  }
  return { inScope, outOfScope }
}
