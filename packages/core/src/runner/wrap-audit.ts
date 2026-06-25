// ADR-0041 §4 / ticket 0058 — the run-wrap audit assertion. Detect-don't-prevent (F21/0018/0023)
// made load-bearing: at wrap, any commit that advanced HEAD during the run window but is ABSENT from
// the run's recorded ledger (the commits.jsonl projection of the store's commit links) is a raw
// bypass — an actor committed BESIDE the deterministic spine instead of THROUGH it (the run_234
// D1/D4 shape: Deb's 549ab11/bd5fdf5 never entered the run's ledger).
//
// Founder decision (2026-06-25): FLAG, don't fault. The run records + surfaces the unledgered shas
// but its disposition is unchanged — a legitimate founder commit inside the window must not falsely
// fail the run. The surfaced shas are the evidence a future revisit of prevention would need.

/** The shas reachable in the run window that are NOT in the run's recorded ledger — i.e. raw
 *  bypasses. Pure set difference, window order preserved. */
export function unledgeredWindowCommits(windowShas: readonly string[], ledgerShas: readonly string[]): string[] {
  const ledger = new Set(ledgerShas)
  return windowShas.filter((sha) => !ledger.has(sha))
}
