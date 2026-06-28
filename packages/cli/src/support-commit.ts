import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  commitOscarSupportEdits,
  makeGit,
  openRunStore,
  type Git,
  type RunStore,
} from '@cocoder/core'
import { basePersonasDir } from '@cocoder/personas'

export interface SupportCommitCliInput {
  readonly repoPath: string
  readonly runId: string
  readonly git?: Git
  readonly store?: RunStore
}

export type SupportCommitCliResult =
  | {
    readonly ok: true
    readonly runId: string
    readonly commitSha: string | null
    readonly committedPaths: readonly string[]
    readonly outOfLanePaths: readonly string[]
    readonly selfCommitted: boolean
  }
  | {
    readonly ok: false
    readonly error: string
    readonly refusedPaths?: readonly string[]
  }

export async function supportCommitViaCli(input: SupportCommitCliInput): Promise<SupportCommitCliResult> {
  const git = input.git ?? makeGit()
  if (input.store === undefined) await mkdir(join(input.repoPath, 'local'), { recursive: true })
  const ownedStore = input.store === undefined ? openRunStore(join(input.repoPath, 'local', 'cocoder.db')) : null
  const liveStore = input.store ?? ownedStore
  if (!liveStore) throw new Error('support commit requires a run store')

  try {
    liveStore.upsertWorkspace({ id: 'cocoder', path: input.repoPath, name: 'CoCoder' })
    const run = liveStore.getRun(input.runId)
    if (run?.status === 'running') {
      return { ok: false, error: 'run/workspace is still active — support edits are committed by the live runner until wrap completes' }
    }

    const priorityId = run?.priorityId ?? await inferPriorityId(git, input.repoPath)
    const gateStore = run === null ? openRunStore(':memory:') : liveStore
    try {
      let gateRunId = run?.id ?? input.runId
      if (run === null) {
        gateStore.upsertWorkspace({ id: 'cocoder', path: input.repoPath, name: 'CoCoder' })
        const synthetic = gateStore.createRun({ workspaceId: 'cocoder', priorityId: priorityId ?? 'support-commit' })
        gateStore.setRunStatus(synthetic.id, 'completed')
        gateRunId = synthetic.id
      }

      const personasDir = join(input.repoPath, 'cocoder', 'personas')
      const result = await commitOscarSupportEdits({
        git,
        store: gateStore,
        repoPath: input.repoPath,
        runId: gateRunId,
        workspaceId: 'cocoder',
        priorityId,
        personaSources: { baseDir: basePersonasDir(), deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir },
        assignmentsPath: join(personasDir, 'assignments.json'),
        runReference: input.runId,
      })
      if (!result.ok) return { ok: false, error: result.error, ...(result.refusedPaths ? { refusedPaths: result.refusedPaths } : {}) }
      return {
        ok: true,
        runId: input.runId,
        commitSha: result.commitSha,
        committedPaths: result.committedPaths,
        outOfLanePaths: result.outOfLanePaths,
        selfCommitted: result.selfCommitted,
      }
    } finally {
      if (run === null) gateStore.close()
    }
  } finally {
    ownedStore?.close()
  }
}

async function inferPriorityId(git: Git, repoPath: string): Promise<string | null> {
  const ids = new Set<string>()
  for (const file of await git.changedFiles(repoPath)) {
    const live = file.match(/^cocoder\/priorities\/([^/]+)\.md$/)?.[1]
    const archived = file.match(/^cocoder\/priorities\/archive\/([^/]+)\.md$/)?.[1]
    if (live) ids.add(live)
    if (archived) ids.add(archived)
  }
  return ids.size === 1 ? [...ids][0]! : null
}
