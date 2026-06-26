// Deb's reconciliation repoint mirrors reconciliation close, but keeps the ticket open and only changes
// its governed priority assignment through the core ticket spine.
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { COCODER_GOVERNANCE_AUTHOR, openRunStore, type Git, type RunStore } from '@cocoder/core'
import { listQueuedAuthoring } from '../src/authoring-queue.js'
import { createOzEventBus, type OzContext } from '../src/context.js'
import { requestReconciliationRepoint } from '../src/launcher.js'

interface CommitCall {
  readonly files: readonly string[]
  readonly message: string
  readonly author?: { readonly name: string; readonly email: string }
}

const TICKET = `---
id: 0099
title: Stale bug
type: bug
status: Open
priority: ticket-fix
owner: deb
created: 2026-06-24
---

# 0099 - Stale bug

Body.
`

const CLOSED_TICKET = `---
id: 0100
title: Closed bug
type: bug
status: Closed
priority: ticket-fix
owner: deb
created: 2026-06-24
---

# 0100 - Closed bug

Body.
`

const INDEX = `# Tickets - Index

## Open

| ID | Title | Type | Priority | Owner |
|---|---|---|---|---|
| [0099](./open/0099-stale-bug.md) | Stale bug | bug | ticket-fix | deb |

## Recently Closed

| ID | Title | Type | Closed | Resolution |
|---|---|---|---|---|
| [0100](./closed/0100-closed-bug.md) | Closed bug | bug | 2026-06-24 | Done |
`

async function makeFixture(commits: CommitCall[]): Promise<{ readonly home: string; readonly store: RunStore; readonly ctx: OzContext }> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-repoint-'))
  const tickets = join(home, 'cocoder', 'tickets')
  await mkdir(join(tickets, 'open'), { recursive: true })
  await mkdir(join(tickets, 'closed'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(tickets, 'open', '0099-stale-bug.md'), TICKET)
  await writeFile(join(tickets, 'closed', '0100-closed-bug.md'), CLOSED_TICKET)
  await writeFile(join(tickets, 'INDEX.md'), INDEX)
  await writeFile(join(tickets, 'order.json'), `${JSON.stringify(['0099'], null, 2)}\n`)
  await writeFile(join(home, 'cocoder', 'priorities', 'ticket-fix.md'), '---\nid: ticket-fix\n---\n')
  await writeFile(join(home, 'cocoder', 'priorities', 'archive-priority.md'), '---\nid: archive-priority\n---\n')
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))

  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const git: Partial<Git> = {
    async addAndCommit(_cwd, files, message, author) {
      commits.push({ files: [...files], message, ...(author ? { author } : {}) })
      return 'sha_fake_repoint'
    },
  }
  const ctx = {
    cocoderHome: home,
    store,
    git: git as Git,
    inFlight: new Map<string, string>(),
    events: createOzEventBus(),
  } as unknown as OzContext
  return { home, store, ctx }
}

describe('requestReconciliationRepoint', () => {
  test('releases a ticket to standalone through the governed spine', async () => {
    const commits: CommitCall[] = []
    const { home, ctx } = await makeFixture(commits)
    const orderBefore = await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8')

    const result = await requestReconciliationRepoint(ctx, { workspaceId: 'cocoder', ticketId: '0099', targetPriority: null })

    expect(result).toMatchObject({ status: 200, body: { ok: true, repointed: true, targetPriority: null, commitSha: 'sha_fake_repoint' } })
    const tickets = join(home, 'cocoder', 'tickets')
    const raw = await readFile(join(tickets, 'open', '0099-stale-bug.md'), 'utf8')
    expect(raw).toContain('\npriority: none\n')
    expect(raw).toContain('\nstatus: Open\n')
    expect(await readdir(join(tickets, 'open'))).toContain('0099-stale-bug.md')
    expect(await readFile(join(tickets, 'order.json'), 'utf8')).toBe(orderBefore)
    expect(commits).toEqual([{
      files: ['cocoder/tickets/open/0099-stale-bug.md', 'cocoder/tickets/INDEX.md'],
      message: 'governance: reconciliation repoint ticket 0099 -> standalone',
      author: COCODER_GOVERNANCE_AUTHOR,
    }])
  })

  test('rehomes a ticket to a live priority through the governed spine', async () => {
    const commits: CommitCall[] = []
    const { home, ctx } = await makeFixture(commits)
    const orderBefore = await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8')

    const result = await requestReconciliationRepoint(ctx, { workspaceId: 'cocoder', ticketId: '0099', targetPriority: 'archive-priority' })

    expect(result).toMatchObject({ status: 200, body: { ok: true, repointed: true, targetPriority: 'archive-priority', commitSha: 'sha_fake_repoint' } })
    const tickets = join(home, 'cocoder', 'tickets')
    expect(await readFile(join(tickets, 'open', '0099-stale-bug.md'), 'utf8')).toContain('\npriority: archive-priority\n')
    expect(await readFile(join(tickets, 'INDEX.md'), 'utf8')).toContain('| [0099](./open/0099-stale-bug.md) | Stale bug | bug | archive-priority | deb |')
    expect(await readFile(join(tickets, 'order.json'), 'utf8')).toBe(orderBefore)
    expect(commits).toEqual([{
      files: ['cocoder/tickets/open/0099-stale-bug.md', 'cocoder/tickets/INDEX.md'],
      message: 'governance: reconciliation repoint ticket 0099 -> archive-priority',
      author: COCODER_GOVERNANCE_AUTHOR,
    }])
  })

  test('queues a repoint while an active run owns the workspace, even before the target is live', async () => {
    const commits: CommitCall[] = []
    const { home, store, ctx } = await makeFixture(commits)
    const before = await readFile(join(home, 'cocoder', 'tickets', 'open', '0099-stale-bug.md'), 'utf8')
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0099' })
    ctx.inFlight.set('cocoder', run.id)

    const result = await requestReconciliationRepoint(ctx, { workspaceId: 'cocoder', ticketId: '0099', targetPriority: 'missing-priority' })

    expect(result).toMatchObject({ status: 202, body: { ok: true, queued: true, queuedId: 'ticket-repoint-0099', ticketId: '0099', status: 'queued' } })
    expect(commits).toEqual([])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'open', '0099-stale-bug.md'), 'utf8')).toBe(before)
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([
      expect.objectContaining({ queuedId: 'ticket-repoint-0099', action: 'ticket-repoint', ticketId: '0099', status: 'queued', input: expect.objectContaining({ targetPriority: 'missing-priority' }) }),
    ])
  })

  test('refuses rehome to a non-live priority without touching the ticket', async () => {
    const commits: CommitCall[] = []
    const { home, ctx } = await makeFixture(commits)
    const before = await readFile(join(home, 'cocoder', 'tickets', 'open', '0099-stale-bug.md'), 'utf8')

    const result = await requestReconciliationRepoint(ctx, { workspaceId: 'cocoder', ticketId: '0099', targetPriority: 'missing-priority' })

    expect(result).toMatchObject({ status: 409, body: { ok: false, error: expect.stringContaining('cocoder/priorities/missing-priority.md is not a live priority') } })
    expect(commits).toEqual([])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'open', '0099-stale-bug.md'), 'utf8')).toBe(before)
  })

  test('returns already-at-target without a spurious commit', async () => {
    const commits: CommitCall[] = []
    const { home, ctx } = await makeFixture(commits)
    const before = await readFile(join(home, 'cocoder', 'tickets', 'open', '0099-stale-bug.md'), 'utf8')

    const result = await requestReconciliationRepoint(ctx, { workspaceId: 'cocoder', ticketId: '0099', targetPriority: 'ticket-fix' })

    expect(result).toMatchObject({ status: 409, body: { ok: false, repointed: false, reason: 'already-at-target' } })
    expect(commits).toEqual([])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'open', '0099-stale-bug.md'), 'utf8')).toBe(before)
  })

  test('returns missing-open-ticket for closed or absent tickets without a spurious commit', async () => {
    const commits: CommitCall[] = []
    const { home, ctx } = await makeFixture(commits)
    const closedBefore = await readFile(join(home, 'cocoder', 'tickets', 'closed', '0100-closed-bug.md'), 'utf8')

    await expect(requestReconciliationRepoint(ctx, { workspaceId: 'cocoder', ticketId: '0100', targetPriority: null }))
      .resolves.toMatchObject({ status: 409, body: { ok: false, repointed: false, reason: 'missing-open-ticket' } })
    await expect(requestReconciliationRepoint(ctx, { workspaceId: 'cocoder', ticketId: '9999', targetPriority: null }))
      .resolves.toMatchObject({ status: 409, body: { ok: false, repointed: false, reason: 'missing-open-ticket' } })

    expect(commits).toEqual([])
    expect(await readFile(join(home, 'cocoder', 'tickets', 'closed', '0100-closed-bug.md'), 'utf8')).toBe(closedBefore)
  })
})
