import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface LocalRunIdentity {
  readonly workspaceId: string
  readonly id: string
}

/** This is the sole owner of the machine-local run-dir layout. */
export function localRunDir(runsRoot: string, run: LocalRunIdentity): string {
  return join(runsRoot, run.workspaceId, run.id)
}

export function resolveLocalRunDir(runsRoot: string, runId: string): string | null {
  const nested = existingNestedRunDir(runsRoot, runId)
  if (nested !== null) return nested
  const legacy = join(runsRoot, runId)
  return isDirectory(legacy) ? legacy : null
}

/** @deprecated Use resolveLocalRunDir for read-by-id compatibility. */
export function localRunDirById(runsRoot: string, runId: string): string
export function localRunDirById(runsRoot: string, runId: string, opts: { readonly missing: 'null' }): string | null
export function localRunDirById(runsRoot: string, runId: string, opts?: { readonly missing: 'null' }): string | null {
  const resolved = resolveLocalRunDir(runsRoot, runId)
  if (opts?.missing === 'null') return resolved
  return resolved ?? join(runsRoot, runId)
}

function existingNestedRunDir(runsRoot: string, runId: string): string | null {
  let entries
  try {
    entries = readdirSync(runsRoot, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = join(runsRoot, entry.name, runId)
    if (isDirectory(candidate)) return candidate
  }
  return null
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}
