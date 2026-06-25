// ADR-0041 §3.1 — the interference rail that bounds Deb's always-on overseer authority.
//
// Founder decision (2026-06-25, the "conservative" gray-zone resolution): a live Deb change
// INTERFERES iff it touches any non-.md surface. An `.md`/instruction edit (orchestration prompts,
// `personas/**`, `decisions/**`, `PLAYBOOK.md`, `failure-catalog.md`, docs) is the ONLY
// non-interfering self-fix; ALL code — the runner, the active run's target, or an isolated guard in
// an unrelated file alike — routes to the founder as a run-end suggestion. The runner-tree and
// target-overlap distinctions of §3.1's widened variant therefore collapse: under the conservative
// rail every code touch interferes regardless of where it lands, so this is a PURE file-domain test
// over the change set, independent of the active run and of Deb's "is this minor?" judgment.
//
// Default-when-unsure → interfering falls out of the shape: anything that is not an unambiguous
// `.md` path (an extensionless path, a blank entry) is treated as code and therefore interferes.

/** An instruction surface is an `.md` file — the only surface Deb's autonomous self-fix may touch.
 *  The single `.md` rule the whole rail is built on; consumers reuse this rather than restate it. */
export function isInstructionSurface(file: string): boolean {
  return /\.md$/i.test(file.trim())
}

/** True iff `changeSet` contains any file Deb may not change live — i.e. any non-`.md` surface. */
export function interferes(changeSet: readonly string[]): boolean {
  return changeSet.some((file) => !isInstructionSurface(file))
}
