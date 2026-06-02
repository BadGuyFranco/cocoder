// Fault fingerprint for cross-run recurrence detection (ADR-0016 §recurrence). A COARSE, stable key —
// fault type + a normalized message — so "the same fault" matches across runs despite run-specific noise
// (run ids, worktree paths, shas, line/byte counts). Deliberately coarse (founder decision): catch real
// recurrences without over-matching; refinable later. Pure + unit-tested.

/** Normalize a fault message into a stable signature: strip the parts that vary run-to-run but keep the
 *  shape of the failure. Order matters — paths are stripped before bare shas/digits so a sha or number
 *  embedded in a path doesn't survive as its own token. */
export function faultFingerprint(faultType: string, message: string): string {
  const normalized = (message ?? '')
    .toLowerCase()
    .replace(/['"`]/g, '') // quotes around paths/values
    .replace(/\/[^\s)]+/g, '#path') // absolute/relative paths (run dirs, worktrees) → one token
    .replace(/run_\d+/g, 'run_#') // any run ids left outside a path
    .replace(/\b[0-9a-f]{7,40}\b/g, '#sha') // bare git shas
    .replace(/\d+/g, '#') // remaining counts (timeouts ms, atom numbers, sizes)
    .replace(/\s+/g, ' ')
    .trim()
  return `${faultType}|${normalized}`
}
