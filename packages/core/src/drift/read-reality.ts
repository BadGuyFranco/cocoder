import { readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { inventoryRepo, type RepoInventory } from '../playbooks/index.js'

export interface DriftRealityPathEntry {
  readonly path: string
  readonly kind: 'file' | 'directory'
}

export interface DriftRealityInventory {
  readonly version: 1
  readonly repo: RepoInventory
  readonly paths: readonly DriftRealityPathEntry[]
  readonly summary: {
    readonly totalPaths: number
    readonly files: number
    readonly directories: number
  }
}

export interface ReadRepoRealityOptions {
  readonly repoRoot: string
}

const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.turbo'])

export function readRepoReality(opts: ReadRepoRealityOptions): DriftRealityInventory {
  assertReadableDirectory(opts.repoRoot)
  const repo = inventoryRepo(opts.repoRoot)
  const paths = [...enumeratePaths(opts.repoRoot, '')].sort(comparePathEntries)
  const files = paths.filter((entry) => entry.kind === 'file').length
  const directories = paths.length - files
  return { version: 1, repo, paths, summary: { totalPaths: paths.length, files, directories } }
}

function enumeratePaths(repoRoot: string, relDir: string): readonly DriftRealityPathEntry[] {
  let entries: readonly string[]
  try {
    entries = readdirSync(join(repoRoot, relDir)).sort()
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const rel = normalizePath(relDir === '' ? entry : join(relDir, entry))
    try {
      const stats = statSync(join(repoRoot, rel))
      if (stats.isDirectory()) {
        if (entry.startsWith('.') || ignoredDirs.has(entry)) return []
        return [{ path: rel, kind: 'directory' as const }, ...enumeratePaths(repoRoot, rel)]
      }
      return stats.isFile() ? [{ path: rel, kind: 'file' as const }] : []
    } catch {
      return []
    }
  })
}

function assertReadableDirectory(repoRoot: string): void {
  try {
    if (!statSync(repoRoot).isDirectory()) throw new Error('not a directory')
    readdirSync(repoRoot)
  } catch (err) {
    throw new Error(`drift reality: unreadable repo root "${repoRoot}": ${err instanceof Error ? err.message : String(err)}`)
  }
}

function comparePathEntries(left: DriftRealityPathEntry, right: DriftRealityPathEntry): number {
  return left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
}

function normalizePath(path: string): string {
  return path.split(sep).join('/')
}
