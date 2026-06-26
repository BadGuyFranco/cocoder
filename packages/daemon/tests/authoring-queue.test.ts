import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, readTickets, type CommitReceipt } from '@cocoder/core'
import { authoringQueuePath, drainAuthoringQueue, enqueueAuthoring, listQueuedAuthoring } from '../src/authoring-queue.js'
import { createOzEventBus } from '../src/context.js'

const fixedNow = () => Date.UTC(2026, 5, 26, 12, 0, 0)

async function writeWorkspace(home: string): Promise<void> {
  await mkdir(join(home, 'local'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'tickets', 'open'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'tickets', 'closed'), { recursive: true })
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'tickets', 'open', '0003-existing.md'), [
    '---',
    'id: 0003',
    'title: Existing',
    'type: task',
    'status: Open',
    'priority: none',
    'owner: founder-session',
    'created: 2026-06-25',
    '---',
    '',
    '## Context',
    '',
  ].join('\n'))
  await writeFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), [
    '# Tickets - Index',
    '',
    '## Open',
    '',
    '| ID | Title | Type | Priority | Owner |',
    '|---|---|---|---|---|',
    '| [0003](./open/0003-existing.md) | Existing | task | none | founder-session |',
    '',
    '## Recently Closed',
    '',
    '| ID | Title | Type | Closed | Resolution |',
    '|---|---|---|---|---|',
    '',
  ].join('\n'))
}

function receipt(files: readonly string[], sha = 'sha-queued'): CommitReceipt {
  return { committed: true, committedSha: sha, committedFiles: files, outOfLane: [], error: null }
}

describe('authoring queue', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cocoder-authoring-queue-'))
    await writeWorkspace(home)
  })

  test('enqueueAuthoring reserves the final ticket id and persists a queued receipt', async () => {
    const out = await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-create',
      now: fixedNow,
      ticket: { title: 'Queued Ticket', type: 'bug', priority: 'none', description: 'Queued while a run is active.' },
    })

    expect(out).toEqual({ queuedId: 'ticket-create-0004', reservedTicketId: '0004', status: 'queued' })
    const entries = await listQueuedAuthoring(home, 'cocoder')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      queuedId: 'ticket-create-0004',
      action: 'ticket-create',
      workspaceId: 'cocoder',
      status: 'queued',
      reservedTicketId: '0004',
      enqueuedAt: fixedNow(),
      enqueuedAtIso: '2026-06-26T12:00:00.000Z',
      createdDate: '2026-06-26',
    })
    await expect(readFile(authoringQueuePath(home, 'cocoder'), 'utf8')).resolves.toContain('"status": "queued"')
  })

  test('listQueuedAuthoring survives a simulated daemon reload from disk', async () => {
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-create',
      now: fixedNow,
      ticket: { title: 'Durable Ticket', type: 'task', priority: 'none', description: 'Still here after reload.' },
    })

    const reloaded = await listQueuedAuthoring(home, 'cocoder')

    expect(reloaded.map((entry) => [entry.queuedId, entry.status, entry.reservedTicketId])).toEqual([
      ['ticket-create-0004', 'queued', '0004'],
    ])
  })

  test('drainAuthoringQueue creates ticket files, commits through the supplied spine, and ledgers the active run', async () => {
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-create',
      now: fixedNow,
      ticket: { title: 'Drain Ticket', type: 'question', priority: 'none', description: 'Commit this after the run seam.' },
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const commits: Array<{ readonly repoPath: string; readonly files: readonly string[]; readonly message: string }> = []

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (repoPath, files, message) => {
        commits.push({ repoPath, files: [...files], message })
        return receipt(files)
      },
      fixedNow,
    )

    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({ queuedId: 'ticket-create-0004', status: 'committed', committedSha: 'sha-queued' })
    expect(commits).toEqual([{
      repoPath: home,
      files: ['cocoder/tickets/open/0004-drain-ticket.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
      message: 'governance: create queued ticket 0004',
    }])
    expect((await readTickets(join(home, 'cocoder', 'tickets'))).find((ticket) => ticket.id === '0004')).toMatchObject({ title: 'Drain Ticket', state: 'open' })
    await expect(readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8')).resolves.toContain('"0004"')
    expect(store.listCommitLinks(run.id).map((link) => link.commitSha)).toEqual(['sha-queued'])
    expect(store.listEvents(run.id).map((event) => event.type)).toContain('queued-authoring-commit')
    await expect(readFile(join(home, 'local', 'oz-audit.log'), 'utf8')).resolves.toContain('"action":"authoring-queue-drain"')
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([])
  })
})
