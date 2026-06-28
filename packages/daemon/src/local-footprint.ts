import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface LocalRunDirFootprint {
  readonly total: number
  readonly byWorkspace: Record<string, { readonly count: number; readonly runIds: readonly string[] }>
}

export interface LocalFootprint {
  readonly localBytes: number
  readonly dbBytes: number
  readonly walBytes: number
  readonly auditBytes: number
  readonly runDirs: LocalRunDirFootprint
}

export async function measureLocalFootprint(localRoot: string): Promise<LocalFootprint> {
  return {
    localBytes: await treeBytes(localRoot),
    dbBytes: await fileSize(join(localRoot, 'cocoder.db')),
    walBytes: await fileSize(join(localRoot, 'cocoder.db-wal')),
    auditBytes: await fileSize(join(localRoot, 'oz-audit.log')),
    runDirs: await countRunDirs(join(localRoot, 'runs')),
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function treeBytes(root: string): Promise<number> {
  let entry
  try {
    entry = await stat(root)
  } catch {
    return 0
  }
  if (!entry.isDirectory()) return entry.size

  let total = 0
  for (const name of await readdir(root)) {
    total += await treeBytes(join(root, name))
  }
  return total
}

async function countRunDirs(root: string): Promise<LocalRunDirFootprint> {
  if (!(await exists(root))) return { total: 0, byWorkspace: {} }
  let total = 0
  const byWorkspace: LocalRunDirFootprint['byWorkspace'] = {}
  for (const workspaceId of (await readdir(root)).sort()) {
    const wsDir = join(root, workspaceId)
    if (!(await stat(wsDir)).isDirectory()) continue
    const runIds: string[] = []
    for (const runId of (await readdir(wsDir)).sort()) {
      if ((await stat(join(wsDir, runId))).isDirectory()) runIds.push(runId)
    }
    byWorkspace[workspaceId] = { count: runIds.length, runIds }
    total += runIds.length
  }
  return { total, byWorkspace }
}
