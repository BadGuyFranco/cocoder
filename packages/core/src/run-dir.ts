// SINGLE SOURCE OF TRUTH for a run's machine-local scratch directory. The writer (runner) and the
// retention GC both resolve the path here, so they can never disagree about where a run's scratch lives.
//
// Layout today is FLAT: `<runsRoot>/<runId>` — machine-local only (ADR-0008/0027), never inside a repo.
//
// DRIFT NOTE (ADR-0027 §6): the ratified target is `<runsRoot>/<workspaceId>/<runId>`, but that migration
// is UNSHIPPED — every consumer (runner IO, launcher pickup/nudge, daemon rundir reader,
// oz-context-pointer, and this GC) is still flat. When the nesting migration lands, change ONLY this
// function (and route the remaining inline consumers through it). Tracked by the workspace-segmentation
// run-dir consolidation ticket.
import { join } from 'node:path'

/** The machine-local scratch directory for a run: `<runsRoot>/<runId>`. */
export function localRunDir(runsRoot: string, run: { readonly id: string }): string {
  return join(runsRoot, run.id)
}
