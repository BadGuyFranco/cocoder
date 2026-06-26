import { join } from 'node:path'

export interface LocalRunIdentity {
  readonly workspaceId: string
  readonly id: string
}

/** This is the sole owner of the machine-local run-dir layout. The current flat layout is the
 *  unmigrated ADR-0027 §6 Migration step 5 shape; a future workspaceId/runId layout changes here only. */
export function localRunDir(runsRoot: string, run: LocalRunIdentity): string {
  return localRunDirById(runsRoot, run.id)
}

export function localRunDirById(runsRoot: string, runId: string): string {
  return join(runsRoot, runId)
}
