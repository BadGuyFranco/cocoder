import { existsSync, mkdirSync, readdirSync, renameSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

export interface LocalRunIdentity {
  readonly workspaceId: string
  readonly id: string
}

export interface FlatRunDirMigrationReport {
  moved: Array<{ runId: string; from: string; to: string }>
  skippedActive: string[]
  skippedUnknownWorkspace: string[]
  skippedTargetExists: string[]
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

export function migrateLegacyFlatRunDirs(
  runsRoot: string,
  resolveWorkspaceId: (runId: string) => string | null,
  isActive: (runId: string) => boolean,
): FlatRunDirMigrationReport {
  const report: FlatRunDirMigrationReport = {
    moved: [],
    skippedActive: [],
    skippedUnknownWorkspace: [],
    skippedTargetExists: [],
  }

  let entries: Dirent[]
  try {
    entries = readdirSync(runsRoot, { withFileTypes: true })
  } catch {
    return report
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const runId = entry.name
    const workspaceId = resolveWorkspaceId(runId)
    if (workspaceId === null) {
      report.skippedUnknownWorkspace.push(runId)
      continue
    }

    if (isActive(runId)) {
      report.skippedActive.push(runId)
      continue
    }

    const from = join(runsRoot, runId)
    const to = join(runsRoot, workspaceId, runId)
    if (existsSync(to)) {
      report.skippedTargetExists.push(runId)
      continue
    }

    mkdirSync(join(runsRoot, workspaceId), { recursive: true })
    renameSync(from, to)
    report.moved.push({ runId, from, to })
  }

  return report
}

function existingNestedRunDir(runsRoot: string, runId: string): string | null {
  let entries: Dirent[]
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
