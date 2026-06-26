import { existsSync } from 'node:fs'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Priority } from '@cocoder/core'

export interface RunTarget {
  readonly dbPath: string
  readonly runsRoot: string
  readonly isolated: boolean
  readonly scratchRoot: string | null
  readonly copiedStoreFiles: readonly string[]
}

export interface ResolveRunTargetInput {
  readonly root: string
  readonly priority: Pick<Priority, 'destructive'>
  readonly requireIndependentOfRunner: boolean
}

const storeSidecars = ['', '-wal', '-shm'] as const

export async function resolveRunTarget(input: ResolveRunTargetInput): Promise<RunTarget> {
  const liveDbPath = join(input.root, 'local', 'cocoder.db')
  const liveRunsRoot = join(input.root, 'local', 'runs')
  if (!input.requireIndependentOfRunner || input.priority.destructive !== true) {
    return { dbPath: liveDbPath, runsRoot: liveRunsRoot, isolated: false, scratchRoot: null, copiedStoreFiles: [] }
  }

  const scratchRoot = await mkdtemp(join(tmpdir(), 'cocoder-independent-destructive-'))
  const dbPath = join(scratchRoot, 'cocoder.db')
  const copiedStoreFiles: string[] = []
  for (const suffix of storeSidecars) {
    const source = `${liveDbPath}${suffix}`
    if (!existsSync(source)) continue
    const target = `${dbPath}${suffix}`
    await copyFile(source, target)
    copiedStoreFiles.push(source)
  }
  return { dbPath, runsRoot: join(scratchRoot, 'runs'), isolated: true, scratchRoot, copiedStoreFiles }
}
