import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  allocatePortableRunDisplayNumber,
  appendPortableCommits,
  appendPortableEvents,
  appendPortableSessions,
  appendPortableWorkItems,
  portableRunPaths,
  portableWorkspacePaths,
  readPortableCommits,
  readPortableCounters,
  readPortableEvents,
  readPortableRun,
  readPortableSessions,
  readPortableWorkspace,
  readPortableWorkItems,
  rebuildPortableCounters,
  writePortableRun,
  writePortableWorkspace,
  type PortableRunFile,
} from '../src/store/index.js'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cocoder-portable-'))
}

describe('portable store paths', () => {
  test('computes workspace and per-run tracked paths without I/O', () => {
    const root = '/workspace'
    expect(portableWorkspacePaths(root)).toEqual({
      cocoderDir: '/workspace/cocoder',
      workspaceFile: '/workspace/cocoder/workspace.json',
      countersFile: '/workspace/cocoder/counters.json',
      runsDir: '/workspace/cocoder/runs',
    })
    expect(portableRunPaths(root, 12, 'run_abc')).toEqual({
      runDir: '/workspace/cocoder/runs/12-run_abc',
      runFile: '/workspace/cocoder/runs/12-run_abc/run.json',
      sessionsFile: '/workspace/cocoder/runs/12-run_abc/sessions.jsonl',
      workItemsFile: '/workspace/cocoder/runs/12-run_abc/work-items.jsonl',
      commitsFile: '/workspace/cocoder/runs/12-run_abc/commits.jsonl',
      eventsFile: '/workspace/cocoder/runs/12-run_abc/events.jsonl',
    })
  })
})

describe('portable workspace and counters files', () => {
  test('workspace.json is nullable when absent and round-trips the ADR shape', async () => {
    const root = await tempRoot()
    await expect(readPortableWorkspace(root)).resolves.toBeNull()
    await writePortableWorkspace(root, { schemaVersion: 1, id: 'cocoder', name: 'CoCoder' })
    await expect(readPortableWorkspace(root)).resolves.toEqual({ schemaVersion: 1, id: 'cocoder', name: 'CoCoder' })
  })

  test('counters seed defaults and allocate current value before persisting the increment', async () => {
    const root = await tempRoot()
    await expect(readPortableCounters(root)).resolves.toEqual({
      schemaVersion: 1,
      nextTicketNumber: 1,
      nextRunDisplayNumber: 1,
      nextSessionDisplayNumber: 1,
    })

    await expect(allocatePortableRunDisplayNumber(root)).resolves.toBe(1)
    await expect(allocatePortableRunDisplayNumber(root)).resolves.toBe(2)

    await expect(readPortableCounters(root)).resolves.toEqual({
      schemaVersion: 1,
      nextTicketNumber: 1,
      nextRunDisplayNumber: 3,
      nextSessionDisplayNumber: 1,
    })
  })

  test('rebuild recomputes counters from ticket filenames and run display dirs', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'cocoder', 'tickets', 'open'), { recursive: true })
    await mkdir(join(root, 'cocoder', 'tickets', 'closed'), { recursive: true })
    await mkdir(join(root, 'cocoder', 'runs', '8-run_alpha'), { recursive: true })
    await mkdir(join(root, 'cocoder', 'runs', '19-run_beta'), { recursive: true })
    await writeFile(join(root, 'cocoder', 'tickets', 'open', '0007-fix.md'), '', 'utf8')
    await writeFile(join(root, 'cocoder', 'tickets', 'closed', '0014-done.md'), '', 'utf8')
    await writeFile(
      join(root, 'cocoder', 'runs', '8-run_alpha', 'sessions.jsonl'),
      `${JSON.stringify({ session: { id: 'session_5', displayNumber: 5 }, runId: 'run_alpha', persona: 'bob', startedAt: 1, exitCode: null })}\n`,
      'utf8',
    )

    await expect(rebuildPortableCounters(root)).resolves.toEqual({
      schemaVersion: 1,
      nextTicketNumber: 15,
      nextRunDisplayNumber: 20,
      nextSessionDisplayNumber: 6,
    })
    await expect(readPortableCounters(root)).resolves.toEqual({
      schemaVersion: 1,
      nextTicketNumber: 15,
      nextRunDisplayNumber: 20,
      nextSessionDisplayNumber: 6,
    })
  })
})

describe('portable run files', () => {
  test('run.json round-trips all ADR portable fields', async () => {
    const root = await tempRoot()
    const run: PortableRunFile = {
      run: { id: 'run_abc', displayNumber: 4 },
      workspace: { id: 'cocoder' },
      target: { kind: 'ticket' },
      priorityId: 'ticket-fix',
      playbookId: null,
      ticketId: '0007',
      status: 'completed',
      createdAt: 100,
      endedAt: 200,
    }

    await writePortableRun(root, run)

    await expect(readPortableRun(root, 4, 'run_abc')).resolves.toEqual(run)
  })

  test('JSONL streams append across calls and read back in order with trailing newlines', async () => {
    const root = await tempRoot()
    const displayNumber = 2
    const runId = 'run_jsonl'
    await appendPortableSessions(root, displayNumber, runId, [
      { session: { id: 'session_1', displayNumber: 1 }, runId, persona: 'bob', startedAt: 1, exitCode: null },
    ])
    await appendPortableSessions(root, displayNumber, runId, [
      { session: { id: 'session_2', displayNumber: 2 }, runId, persona: 'deb', startedAt: 2, exitCode: 0 },
    ])
    await appendPortableWorkItems(root, displayNumber, runId, [
      {
        id: 'wi_1',
        runId,
        sourcePersona: 'oscar',
        targetPersona: 'bob',
        task: 'Build the port.',
        writeScope: ['packages/**'],
        status: 'done',
        createdAt: 3,
      },
    ])
    await appendPortableCommits(root, displayNumber, runId, [
      {
        id: 'commit_1',
        runId,
        workItemId: 'wi_1',
        commitSha: 'abc123',
        message: 'feat: add port',
        files: ['packages/core/src/store/portable/index.ts'],
        createdAt: 4,
      },
    ])
    await appendPortableEvents(root, displayNumber, runId, [
      { id: 'event_1', runId, type: 'portable', at: 5, data: { status: 'ok', files: ['packages/core'] } },
    ])
    await writeFile(portableRunPaths(root, displayNumber, runId).eventsFile, '\n', { encoding: 'utf8', flag: 'a' })

    await expect(readPortableSessions(root, displayNumber, runId)).resolves.toEqual([
      { session: { id: 'session_1', displayNumber: 1 }, runId, persona: 'bob', startedAt: 1, exitCode: null },
      { session: { id: 'session_2', displayNumber: 2 }, runId, persona: 'deb', startedAt: 2, exitCode: 0 },
    ])
    await expect(readPortableWorkItems(root, displayNumber, runId)).resolves.toEqual([
      {
        id: 'wi_1',
        runId,
        sourcePersona: 'oscar',
        targetPersona: 'bob',
        task: 'Build the port.',
        writeScope: ['packages/**'],
        status: 'done',
        createdAt: 3,
      },
    ])
    await expect(readPortableCommits(root, displayNumber, runId)).resolves.toEqual([
      {
        id: 'commit_1',
        runId,
        workItemId: 'wi_1',
        commitSha: 'abc123',
        message: 'feat: add port',
        files: ['packages/core/src/store/portable/index.ts'],
        createdAt: 4,
      },
    ])
    await expect(readPortableEvents(root, displayNumber, runId)).resolves.toEqual([
      { id: 'event_1', runId, type: 'portable', at: 5, data: { status: 'ok', files: ['packages/core'] } },
    ])

    const rawSessions = await readFile(portableRunPaths(root, displayNumber, runId).sessionsFile, 'utf8')
    expect(rawSessions.split('\n').filter(Boolean)).toHaveLength(2)
  })
})
