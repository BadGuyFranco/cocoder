import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { loadPriority, openRunStore, readTickets, type CommitReceipt } from '@cocoder/core'
import { authoringQueuePath, drainAuthoringQueue, enqueueAuthoring, listQueuedAuthoring } from '../src/authoring-queue.js'
import { createOzEventBus } from '../src/context.js'

const fixedNow = () => Date.UTC(2026, 5, 26, 12, 0, 0)

async function writeWorkspace(home: string): Promise<void> {
  await mkdir(join(home, 'local'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'tickets', 'open'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'tickets', 'closed'), { recursive: true })
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  await writeFile(join(home, 'cocoder', 'priorities', 'demo.md'), '---\nid: demo\ntitle: Demo\n---\n## Objective\nExisting priority.')
  await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), `${JSON.stringify(['demo'], null, 2)}\n`)
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

async function writeSecondOpenTicket(home: string): Promise<void> {
  await writeFile(join(home, 'cocoder', 'tickets', 'open', '0005-later.md'), [
    '---',
    'id: 0005',
    'title: Later',
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
  const indexPath = join(home, 'cocoder', 'tickets', 'INDEX.md')
  const index = await readFile(indexPath, 'utf8')
  await writeFile(indexPath, index.replace(
    '\n## Recently Closed',
    '\n| [0005](./open/0005-later.md) | Later | task | none | founder-session |\n\n## Recently Closed',
  ))
}

async function writeClosedTicket(home: string): Promise<void> {
  await writeFile(join(home, 'cocoder', 'tickets', 'closed', '0007-closed.md'), [
    '---',
    'id: 0007',
    'title: Closed',
    'type: task',
    'status: Closed',
    'priority: none',
    'owner: founder-session',
    'created: 2026-06-25',
    '---',
    '',
    'Already closed.',
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
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-reorder',
      now: fixedNow,
      order: ['0005', '0003'],
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'priority-create',
      now: fixedNow,
      priority: { id: 'durable-priority', title: 'Durable Priority', goal: '## Objective\nStill here after reload.' },
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-close',
      now: fixedNow,
      ticketId: '0003',
      resolution: 'Still here after reload.',
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-repoint',
      now: fixedNow,
      ticketId: '0003',
      targetPriority: 'next',
      bindingReason: 'Queued rehome to the next live priority.',
      order: ['0003'],
    })

    const reloaded = await listQueuedAuthoring(home, 'cocoder')

    expect(reloaded.map((entry) => [entry.queuedId, entry.action, entry.status])).toEqual([
      ['ticket-create-0004', 'ticket-create', 'queued'],
      ['ticket-reorder-0001', 'ticket-reorder', 'queued'],
      ['priority-create-durable-priority', 'priority-create', 'queued'],
      ['ticket-close-0003', 'ticket-close', 'queued'],
      ['ticket-repoint-0003', 'ticket-repoint', 'queued'],
    ])
  })

  test('listQueuedAuthoring rejects the previous queue schema version loudly', async () => {
    await mkdir(join(home, 'local', 'authoring-queue'), { recursive: true })
    await writeFile(authoringQueuePath(home, 'cocoder'), `${JSON.stringify({ schemaVersion: 2, entries: [] }, null, 2)}\n`)

    await expect(listQueuedAuthoring(home, 'cocoder')).rejects.toThrow(/unsupported schema version 2/)
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

  test('drainAuthoringQueue reorders tickets and creates a priority through the supplied spine', async () => {
    await writeSecondOpenTicket(home)
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-reorder',
      now: fixedNow,
      order: ['0005', '0003'],
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'priority-create',
      now: fixedNow,
      priority: { id: 'queued-priority', title: 'Queued Priority', goal: '## Objective\nCreate this priority.' },
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const commits: Array<{ readonly files: readonly string[]; readonly message: string }> = []

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (_repoPath, files, message) => {
        commits.push({ files: [...files], message })
        return receipt(files, `sha-${commits.length}`)
      },
      fixedNow,
    )

    expect(drained.map((entry) => [entry.queuedId, entry.status])).toEqual([
      ['ticket-reorder-0001', 'committed'],
      ['priority-create-queued-priority', 'committed'],
    ])
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0005', '0003'])
    expect(loadPriority(join(home, 'cocoder', 'priorities'), 'queued-priority').objective).toBe('Create this priority.')
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'priorities', 'order.json'), 'utf8'))).toEqual(['demo', 'queued-priority'])
    expect(commits).toEqual([
      { files: ['cocoder/tickets/order.json'], message: 'governance: reorder queued tickets (cocoder)' },
      { files: ['cocoder/priorities/queued-priority.md', 'cocoder/priorities/order.json'], message: 'governance: create queued priority queued-priority' },
    ])
    expect(store.listCommitLinks(run.id).map((link) => link.commitSha)).toEqual(['sha-1', 'sha-2'])
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([])
  })

  test('drainAuthoringQueue reconciles queued ticket surfaces through the supplied spine', async () => {
    await writeFile(join(home, 'cocoder', 'tickets', 'open', '0005-missing-row.md'), [
      '---',
      'id: 0005',
      'title: Missing Row',
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
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003', '9999'], null, 2)}\n`)
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-reconcile',
      now: fixedNow,
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const commits: Array<{ readonly files: readonly string[]; readonly message: string }> = []

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (_repoPath, files, message) => {
        commits.push({ files: [...files], message })
        return receipt(files)
      },
      fixedNow,
    )

    expect(drained.map((entry) => [entry.queuedId, entry.status])).toEqual([
      ['ticket-reconcile', 'committed'],
    ])
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0003', '0005'])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')).toContain('| [0005](./open/0005-missing-row.md) | Missing Row | task | none | founder-session |')
    expect(commits).toEqual([
      { files: ['cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'], message: 'governance: reconcile queued ticket surfaces (cocoder)' },
    ])
  })

  test('drainAuthoringQueue closes and repoints tickets through the supplied spine', async () => {
    await writeSecondOpenTicket(home)
    await writeFile(join(home, 'cocoder', 'priorities', 'next.md'), '---\nid: next\ntitle: Next\n---\n## Objective\nNext priority.')
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), `${JSON.stringify(['0003'], null, 2)}\n`)
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-repoint',
      now: fixedNow,
      ticketId: '0005',
      targetPriority: 'next',
      bindingReason: 'Queued rehome to the next live priority.',
      order: ['0005', '0003'],
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-close',
      now: fixedNow,
      ticketId: '0003',
      resolution: 'Closed from queue.',
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const commits: Array<{ readonly files: readonly string[]; readonly message: string }> = []

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (_repoPath, files, message) => {
        commits.push({ files: [...files], message })
        return receipt(files, `sha-ticket-${commits.length}`)
      },
      fixedNow,
    )

    expect(drained.map((entry) => [entry.queuedId, entry.status])).toEqual([
      ['ticket-repoint-0005', 'committed'],
      ['ticket-close-0003', 'committed'],
    ])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'open', '0005-later.md'), 'utf8')).toContain('\npriority: next\n')
    await expect(readFile(join(home, 'cocoder', 'tickets', 'open', '0003-existing.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(home, 'cocoder', 'tickets', 'closed', '0003-existing.md'), 'utf8')).toContain('Closed from queue.')
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0005'])
    expect(commits).toEqual([
      { files: ['cocoder/tickets/open/0005-later.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'], message: 'governance: repoint queued ticket 0005 -> next' },
      { files: ['cocoder/tickets/closed/0003-existing.md', 'cocoder/tickets/open/0003-existing.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'], message: 'governance: close queued ticket 0003' },
    ])
    expect(store.listEvents(run.id).filter((event) => event.type === 'queued-authoring-commit')).toHaveLength(2)
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([])
  })

  test('drainAuthoringQueue keeps priority-create errors visible without aborting later entries', async () => {
    await writeSecondOpenTicket(home)
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'priority-create',
      now: fixedNow,
      priority: { id: 'demo', title: 'Duplicate Demo', goal: '## Objective\nThis should fail.' },
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-reorder',
      now: fixedNow,
      order: ['0005', '0003'],
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (_repoPath, files) => receipt(files),
      fixedNow,
    )

    expect(drained.map((entry) => [entry.queuedId, entry.status])).toEqual([
      ['priority-create-demo', 'error'],
      ['ticket-reorder-0001', 'committed'],
    ])
    const visible = await listQueuedAuthoring(home, 'cocoder')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({ queuedId: 'priority-create-demo', status: 'error', priorityId: 'demo', error: 'priority id "demo" already exists' })
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0005', '0003'])
  })

  test('drainAuthoringQueue keeps ticket-close errors visible without aborting later entries', async () => {
    await writeSecondOpenTicket(home)
    await writeClosedTicket(home)
    await writeFile(join(home, 'cocoder', 'priorities', 'next.md'), '---\nid: next\ntitle: Next\n---\n## Objective\nNext priority.')
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-close',
      now: fixedNow,
      ticketId: '0007',
      resolution: 'Already closed.',
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-repoint',
      now: fixedNow,
      ticketId: '0005',
      targetPriority: 'next',
      bindingReason: 'Queued rehome to the next live priority.',
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (_repoPath, files) => receipt(files),
      fixedNow,
    )

    expect(drained.map((entry) => [entry.queuedId, entry.status])).toEqual([
      ['ticket-close-0007', 'error'],
      ['ticket-repoint-0005', 'committed'],
    ])
    const visible = await listQueuedAuthoring(home, 'cocoder')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({ queuedId: 'ticket-close-0007', status: 'error', ticketId: '0007', error: 'ticket 0007 cannot be queued-closed (already-closed)' })
    expect(await readFile(join(home, 'cocoder', 'tickets', 'open', '0005-later.md'), 'utf8')).toContain('\npriority: next\n')
  })

  test('drainAuthoringQueue keeps ticket-repoint missing-priority errors visible', async () => {
    await writeSecondOpenTicket(home)
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-repoint',
      now: fixedNow,
      ticketId: '0005',
      targetPriority: 'missing-priority',
      bindingReason: 'Queued rehome to a priority that is not live yet.',
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const commits: Array<{ readonly files: readonly string[] }> = []

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (_repoPath, files) => {
        commits.push({ files: [...files] })
        return receipt(files)
      },
      fixedNow,
    )

    expect(drained.map((entry) => [entry.queuedId, entry.status])).toEqual([
      ['ticket-repoint-0005', 'error'],
    ])
    expect(commits).toEqual([])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'open', '0005-later.md'), 'utf8')).toContain('\npriority: none\n')
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([
      expect.objectContaining({ queuedId: 'ticket-repoint-0005', status: 'error', error: 'ticket 0005 cannot be queued-repointed (missing-priority)' }),
    ])
  })

  test('drainAuthoringQueue keeps ticket-reorder errors visible without aborting later entries', async () => {
    await writeSecondOpenTicket(home)
    await mkdir(join(home, 'cocoder', 'tickets', 'order.json'), { recursive: true })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'ticket-reorder',
      now: fixedNow,
      order: ['0005', '0003'],
    })
    await enqueueAuthoring({ cocoderHome: home }, {
      workspaceId: 'cocoder',
      action: 'priority-create',
      now: fixedNow,
      priority: { id: 'after-reorder-error', title: 'After Reorder Error', goal: '## Objective\nStill drains after reorder fails.' },
    })
    const store = openRunStore(':memory:', { now: fixedNow })
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const drained = await drainAuthoringQueue(
      { cocoderHome: home, store, inFlight: new Map([['cocoder', run.id]]), events: createOzEventBus() },
      'cocoder',
      async (_repoPath, files) => receipt(files),
      fixedNow,
    )

    expect(drained.map((entry) => [entry.queuedId, entry.status])).toEqual([
      ['ticket-reorder-0001', 'error'],
      ['priority-create-after-reorder-error', 'committed'],
    ])
    const visible = await listQueuedAuthoring(home, 'cocoder')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({ queuedId: 'ticket-reorder-0001', status: 'error' })
    expect(loadPriority(join(home, 'cocoder', 'priorities'), 'after-reorder-error').objective).toBe('Still drains after reorder fails.')
  })
})
