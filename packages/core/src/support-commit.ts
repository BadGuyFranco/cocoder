import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { loadAssignments, resolveEffectivePersona, type Assignments, type PersonaSources } from './personas/index.js'
import { runCommitGate, type Git } from './commit-gate/index.js'
import type { RunStore } from './store/index.js'

export interface CommitOscarSupportEditsInput {
  readonly git: Git
  readonly store: RunStore
  readonly repoPath: string
  readonly runId: string
  readonly workspaceId: string
  readonly priorityId: string | null
  readonly personaSources: PersonaSources
  readonly assignmentsPath: string
  readonly runReference: string
  readonly runMessageReference?: string
  readonly liveOscar?: boolean
}

export type CommitOscarSupportEditsResult =
  | {
    readonly ok: true
    readonly runId: string
    readonly committedPaths: readonly string[]
    readonly commitSha: string | null
    readonly outOfLanePaths: readonly string[]
    readonly selfCommitted: boolean
    readonly liveOscar: boolean
  }
  | {
    readonly ok: false
    readonly status: 409
    readonly error: string
    readonly refusedPaths?: readonly string[]
  }

export async function commitOscarSupportEdits(input: CommitOscarSupportEditsInput): Promise<CommitOscarSupportEditsResult> {
  let assignments: Assignments
  let scope: readonly string[]
  try {
    assignments = loadAssignments(input.assignmentsPath)
    scope = resolveEffectivePersona(input.personaSources, assignments, 'oscar').writeScope
  } catch {
    return { ok: false, status: 409, error: `could not resolve Oscar support scope for workspace "${input.workspaceId}"` }
  }
  if (scope.length === 0) return { ok: false, status: 409, error: 'Oscar has no support-write scope for this workspace' }

  const changed = await input.git.changedFiles(input.repoPath)
  const archiveBypass = await postWrapArchiveBypass(input.repoPath, input.priorityId, changed)
  if (archiveBypass) {
    input.store.recordEvent({
      runId: input.runId,
      type: 'post-wrap-support-commit-refused',
      data: { reason: 'archive-priority-required', files: archiveBypass.files },
    })
    return {
      ok: false,
      status: 409,
      error: archivePriorityRequiredMessage(input.priorityId),
      refusedPaths: archiveBypass.files,
    }
  }

  const headBefore = await input.git.headSha(input.repoPath)
  const label = input.priorityId ?? 'support'
  const runLabel = input.runMessageReference ?? `run ${input.runReference}`
  const gate = await runCommitGate({
    git: input.git,
    store: input.store,
    cwd: input.repoPath,
    runId: input.runId,
    workItemId: null,
    scope,
    message: `oscar-post-wrap: ${label} via CoCoder ${runLabel}`,
    headBefore,
  })
  const liveOscar = input.liveOscar === true
  input.store.recordEvent({
    runId: input.runId,
    type: 'post-wrap-support-commit',
    data: { committedSha: gate.committedSha, files: gate.committedFiles, outOfScope: gate.outOfLane, selfCommitted: gate.selfCommitted, liveOscar },
  })
  return {
    ok: true,
    runId: input.runId,
    committedPaths: gate.committedFiles,
    commitSha: gate.committedSha,
    outOfLanePaths: gate.outOfLane,
    selfCommitted: gate.selfCommitted,
    liveOscar,
  }
}

async function postWrapArchiveBypass(workspacePath: string, priorityId: string | null, changed: readonly string[]): Promise<{ readonly files: readonly string[] } | null> {
  if (priorityId === null) {
    const touchedArchive = changed.filter((file) => /^cocoder\/priorities\/archive\/[^/]+\.md$/.test(file))
    return touchedArchive.length === 0 ? null : { files: touchedArchive }
  }

  const livePath = `cocoder/priorities/${priorityId}.md`
  const archivePath = `cocoder/priorities/archive/${priorityId}.md`
  const touched = changed.filter((file) => file === livePath || file === archivePath)
  if (touched.length === 0) return null
  if (touched.includes(archivePath)) return { files: touched }
  return (await isFile(join(workspacePath, livePath))) ? null : { files: touched }
}

function archivePriorityRequiredMessage(priorityId: string | null): string {
  if (priorityId === null) {
    return 'post-wrap support edits cannot archive a priority directly; use the archive-priority authoring Play after an archive-ready founder confirmation (the one archive-priority Play; no raw file move).'
  }
  return (
    `post-wrap support edits cannot archive the active priority "${priorityId}" directly; ` +
    `use the archive-priority authoring Play after an archive-ready founder confirmation — run \`cocoder oz archive-priority ${priorityId}\` (the one archive-priority Play; no raw file move).`
  )
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
