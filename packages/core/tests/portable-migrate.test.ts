import { access, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  migrateWorkspacePortableHistory,
  openRunStore,
  portableRunPaths,
  portableWorkspacePaths,
  readPortableCommits,
  readPortableCounters,
  readPortableEvents,
  readPortableRun,
  readPortableSessions,
  readPortableWorkspace,
  readPortableWorkItems,
  writePortableRunHistory,
  type RunStore,
} from '../src/store/index.js'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

function clock(): () => number {
  let t = 100
  return () => (t += 1)
}

describe('migrateWorkspacePortableHistory', () => {
  test('fresh backfill materializes DB-only runs with createdAt-ordered display numbers and correct counters', async () => {
    const store = populatedStore()
    const rootA = await tempRoot('portable-migrate-a-')
    const rootB = await tempRoot('portable-migrate-b-')
    await mkdir(join(rootA, 'cocoder', 'tickets', 'open'), { recursive: true })
    await mkdir(join(rootA, 'cocoder', 'tickets', 'closed'), { recursive: true })
    await writeFile(join(rootA, 'cocoder', 'tickets', 'open', '0009-open.md'), '', 'utf8')
    await writeFile(join(rootA, 'cocoder', 'tickets', 'closed', '0012-closed.md'), '', 'utf8')

    await expect(readPortableWorkspace(rootA)).resolves.toBeNull()
    await expect(
      migrateWorkspacePortableHistory({ primaryRoot: rootA, workspace: { id: 'alpha', name: 'Alpha' }, store }),
    ).resolves.toEqual({ runsExported: 2, sessionsExported: 2 })
    await expect(
      migrateWorkspacePortableHistory({ primaryRoot: rootB, workspace: { id: 'beta', name: 'Beta' }, store }),
    ).resolves.toEqual({ runsExported: 1, sessionsExported: 1 })

    await expect(readPortableWorkspace(rootA)).resolves.toEqual({ schemaVersion: 1, id: 'alpha', name: 'Alpha' })
    await expect(readPortableRun(rootA, 1, 'run_1')).resolves.toMatchObject(
      { run: { id: 'run_1', displayNumber: 1 }, workspace: { id: 'alpha' }, target: { kind: 'priority' }, priorityId: 'p-alpha', playbookId: null, ticketId: null },
    )
    await expect(readPortableRun(rootA, 2, 'run_3')).resolves.toMatchObject(
      { run: { id: 'run_3', displayNumber: 2 }, workspace: { id: 'alpha' }, target: { kind: 'ticket' }, ticketId: '0012' },
    )
    await expect(readPortableRun(rootB, 1, 'run_2')).resolves.toMatchObject(
      { run: { id: 'run_2', displayNumber: 1 }, workspace: { id: 'beta' }, target: { kind: 'playbook' }, playbookId: 'onboarding' },
    )

    const sessions = await readPortableSessions(rootA, 1, 'run_1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ session: { displayNumber: 1 }, runId: 'run_1', persona: 'bob', exitCode: 0 })
    const rawSessions = await readFile(portableRunPaths(rootA, 1, 'run_1').sessionsFile, 'utf8')
    expect(rawSessions).not.toMatch(/sessionRef|workspaceRef|surface:|cmux:/)

    await expect(readPortableWorkItems(rootA, 1, 'run_1')).resolves.toEqual([
      expect.objectContaining({
        runId: 'run_1',
        sourcePersona: 'oscar',
        targetPersona: 'bob',
        task: 'Build alpha.',
        writeScope: ['packages/**'],
        status: 'done',
      }),
    ])
    await expect(readPortableCommits(rootA, 1, 'run_1')).resolves.toEqual([
      expect.objectContaining({
        runId: 'run_1',
        workItemId: expect.any(String),
        commitSha: 'abc123',
        message: 'feat: alpha',
        files: ['packages/core/src/alpha.ts'],
      }),
    ])

    await expect(readPortableEvents(rootA, 1, 'run_1')).resolves.toEqual([
      expect.objectContaining({
        runId: 'run_1',
        type: 'alpha-event',
        data: {
          atom: 1,
          nested: { keep: 'value' },
          list: ['portable', { keep: 'also' }],
        },
      }),
    ])
    const rawEvents = await readFile(portableRunPaths(rootA, 1, 'run_1').eventsFile, 'utf8')
    expect(rawEvents).not.toMatch(/runDir|outPath|statePath|"ref"|\/tmp\//)

    await expect(readPortableCounters(rootA)).resolves.toEqual({ schemaVersion: 1, nextTicketNumber: 13, nextRunDisplayNumber: 3, nextSessionDisplayNumber: 3 })
    await expect(readPortableCounters(rootB)).resolves.toEqual({ schemaVersion: 1, nextTicketNumber: 1, nextRunDisplayNumber: 2, nextSessionDisplayNumber: 2 })
    store.close()
  })

  test('running backfill twice is a no-op with unchanged portable tree and counters', async () => {
    const store = populatedStore()
    const rootA = await tempRoot('portable-migrate-idempotent-')

    await expect(
      migrateWorkspacePortableHistory({ primaryRoot: rootA, workspace: { id: 'alpha', name: 'Alpha' }, store }),
    ).resolves.toEqual({ runsExported: 2, sessionsExported: 2 })
    const before = await snapshotFiles(join(rootA, 'cocoder'))
    await expect(
      migrateWorkspacePortableHistory({ primaryRoot: rootA, workspace: { id: 'alpha', name: 'Ignored Existing Name' }, store }),
    ).resolves.toEqual({ runsExported: 0, sessionsExported: 0 })
    await expect(snapshotFiles(join(rootA, 'cocoder'))).resolves.toEqual(before)
    await expect(readPortableCounters(rootA)).resolves.toEqual({ schemaVersion: 1, nextTicketNumber: 1, nextRunDisplayNumber: 3, nextSessionDisplayNumber: 3 })
    store.close()
  })

  test('partial backfill preserves existing display numbers and fills missing runs above the current max', async () => {
    const store = populatedStore()
    const root = await tempRoot('portable-migrate-partial-')
    const existingRun = store.getRun('run_3')
    const existingSession = store.listSessions('run_3')[0]
    if (!existingRun || !existingSession) throw new Error('test fixture missing run_3 history')
    await writePortableRunHistory({
      primaryRoot: root,
      store,
      run: existingRun,
      displayNumber: 7,
      sessionDisplayNumbers: new Map([[existingSession.id, 11]]),
    })

    await expect(
      migrateWorkspacePortableHistory({ primaryRoot: root, workspace: { id: 'alpha', name: 'Alpha' }, store }),
    ).resolves.toEqual({ runsExported: 1, sessionsExported: 1 })

    await expect(readPortableRun(root, 7, 'run_3')).resolves.toMatchObject({ run: { id: 'run_3', displayNumber: 7 } })
    await expect(readPortableSessions(root, 7, 'run_3')).resolves.toEqual([
      expect.objectContaining({ session: { id: existingSession.id, displayNumber: 11 }, runId: 'run_3' }),
    ])
    await expect(readPortableRun(root, 8, 'run_1')).resolves.toMatchObject({ run: { id: 'run_1', displayNumber: 8 } })
    await expect(readPortableRun(root, 1, 'run_1')).resolves.toBeNull()
    await expect(readPortableCounters(root)).resolves.toEqual({ schemaVersion: 1, nextTicketNumber: 1, nextRunDisplayNumber: 9, nextSessionDisplayNumber: 13 })
    store.close()
  })

  test('stops before exporting when workspace.json id mismatches', async () => {
    const store = populatedStore()
    const root = await tempRoot('portable-migrate-mismatch-')
    await mkdir(join(root, 'cocoder'), { recursive: true })
    await writeFile(join(root, 'cocoder', 'workspace.json'), JSON.stringify({ schemaVersion: 1, id: 'wrong', name: 'Wrong' }), 'utf8')

    await expect(
      migrateWorkspacePortableHistory({ primaryRoot: root, workspace: { id: 'alpha', name: 'Alpha' }, store }),
    ).rejects.toThrow('Portable workspace id mismatch: expected alpha, found wrong')
    await expect(exists(portableWorkspacePaths(root).countersFile)).resolves.toBe(false)
    await expect(exists(portableWorkspacePaths(root).runsDir)).resolves.toBe(false)
    store.close()
  })
})

function populatedStore(): RunStore {
  const store = openRunStore(':memory:', { now: clock() })
  store.upsertWorkspace({ id: 'alpha', path: '/alpha', name: 'Alpha' })
  store.upsertWorkspace({ id: 'beta', path: '/beta', name: 'Beta' })

  const alpha1 = store.createRun({ workspaceId: 'alpha', priorityId: 'p-alpha' })
  const beta1 = store.createRun({ workspaceId: 'beta', priorityId: 'playbook-run', playbookId: 'onboarding' })
  const alpha2 = store.createRun({ workspaceId: 'alpha', priorityId: 'ticket-fix', ticketId: '0012' })
  store.setRunStatus(alpha1.id, 'completed')

  const alphaSession = store.createSession({ runId: alpha1.id, persona: 'bob', sessionRef: 'surface:alpha', workspaceRef: 'cmux:alpha' })
  store.setSessionExit(alphaSession.id, 0)
  store.createSession({ runId: beta1.id, persona: 'oscar', sessionRef: 'surface:beta', workspaceRef: 'cmux:beta' })
  store.createSession({ runId: alpha2.id, persona: 'deb', sessionRef: 'surface:alpha-2', workspaceRef: null })

  const item = store.createWorkItem({
    runId: alpha1.id,
    sourcePersona: 'oscar',
    targetPersona: 'bob',
    task: 'Build alpha.',
    writeScope: ['packages/**'],
  })
  store.setWorkItemStatus(item.id, 'done')
  store.recordCommitLink({
    runId: alpha1.id,
    workItemId: item.id,
    commitSha: 'abc123',
    message: 'feat: alpha',
    files: ['packages/core/src/alpha.ts'],
  })
  store.recordEvent({
    runId: alpha1.id,
    type: 'alpha-event',
    data: {
      atom: 1,
      runDir: '/tmp/cocoder/run_1',
      outPath: '/tmp/cocoder/run_1/out.txt',
      statePath: '/tmp/cocoder/run_1/state.json',
      ref: 'surface:alpha',
      nested: { keep: 'value', ref: 'surface:nested', path: '/tmp/local-only' },
      list: ['portable', '/tmp/drop-me', { keep: 'also', outPath: '/tmp/drop-too' }],
    },
  })
  return store
}

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await collectFiles(root, root, out)
  return out
}

async function collectFiles(root: string, dir: string, out: Record<string, string>): Promise<void> {
  const entries = await readdir(dir)
  for (const entry of entries) {
    const path = join(dir, entry)
    if ((await stat(path)).isDirectory()) {
      await collectFiles(root, path, out)
    } else {
      out[relative(root, path)] = await readFile(path, 'utf8')
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
