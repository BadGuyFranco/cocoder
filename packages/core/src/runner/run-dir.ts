import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, type Dirent } from 'node:fs'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'

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

export function removeLocalRunDir(runsRoot: string, runId: string): { removed: string | null } {
  const dir = resolveLocalRunDir(runsRoot, runId)
  if (dir === null) return { removed: null }

  assertStrictlyInside(runsRoot, dir)
  rmSync(dir, { recursive: true, force: true })
  removeEmptyNestedParent(runsRoot, dir)
  return { removed: dir }
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

function assertStrictlyInside(root: string, target: string): void {
  const absoluteRoot = resolvePath(root)
  const absoluteTarget = resolvePath(target)
  const rootPrefix = absoluteRoot.endsWith(sep) ? absoluteRoot : `${absoluteRoot}${sep}`
  if (absoluteTarget === absoluteRoot || !absoluteTarget.startsWith(rootPrefix)) {
    throw new Error(`Refusing to remove local run dir outside runs root: ${target}`)
  }
}

function removeEmptyNestedParent(runsRoot: string, removedDir: string): void {
  const absoluteRoot = resolvePath(runsRoot)
  const parent = dirname(removedDir)
  if (resolvePath(parent) === absoluteRoot) return
  assertStrictlyInside(runsRoot, parent)

  try {
    if (readdirSync(parent).length === 0) {
      rmdirSync(parent)
    }
  } catch {
    // Best effort only: the run dir has already been removed, and non-empty parents must be retained.
  }
}
