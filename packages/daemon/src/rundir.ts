// Run-dir reader (ADR-0003): a completed run's terminal output + structured artifacts live as files
// under the runner-owned machine-local run dir. Oz's run-detail surface renders them read-only.
// Large outputs are capped so a run detail can't return an unbounded payload.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { localRunDir, resolveLocalRunDir, truncate, type LocalRunIdentity } from '@cocoder/core'

/** Cap any single captured stream so a run-detail response stays bounded. */
const CAP = 50_000

const readCapped = async (path: string): Promise<string | null> => {
  try {
    return truncate(await readFile(path, 'utf8'), CAP)
  } catch {
    return null // file absent (e.g. a run that never reached that step) — not an error
  }
}

export interface RunDirContents {
  readonly oscarOut: string | null
  readonly oscarErr: string | null
  readonly bobOut: string | null
  readonly bobErr: string | null
  /** The resumable pickup brief from the run's wrap-up (ADR-0013 continuation; F8), if any. */
  readonly pickup: string | null
  readonly record: string | null
}

/** Read the per-run artifacts; every field is best-effort (null when the file isn't present). */
export async function readRunDir(runsRoot: string, run: LocalRunIdentity | string): Promise<RunDirContents> {
  const dir = typeof run === 'string'
    ? resolveLocalRunDir(runsRoot, run)
    : (resolveLocalRunDir(runsRoot, run.id) ?? localRunDir(runsRoot, run))
  if (dir === null) {
    return { oscarOut: null, oscarErr: null, bobOut: null, bobErr: null, pickup: null, record: null }
  }
  const [oscarOut, oscarErr, bobOut, bobErr, pickup, record] = await Promise.all([
    readCapped(join(dir, 'oscar.out')),
    readCapped(join(dir, 'oscar.err')),
    readCapped(join(dir, 'bob.out')),
    readCapped(join(dir, 'bob.err')),
    readCapped(join(dir, 'pickup.md')),
    readCapped(join(dir, 'record.md')),
  ])
  return { oscarOut, oscarErr, bobOut, bobErr, pickup, record }
}
