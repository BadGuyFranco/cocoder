// ADR-0041 §3.2 item 4 / ticket 0055 — Deb's reconciliation close. She may close a ticket that SHOULD
// already have been closed, through the ONE governed close spine (closeTicket → commitFiles, shared
// governance author). Active runs queue the deterministic close for the safe seam. Tested with a real
// ticket fs + an injected fake Git so the file moves and the governed commit are pinned deterministically.
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { COCODER_GOVERNANCE_AUTHOR, openRunStore, type Git, type RunStore } from '@cocoder/core'
import { listQueuedAuthoring } from '../src/authoring-queue.js'
import { createOzEventBus, type OzContext } from '../src/context.js'
import { requestReconciliationClose } from '../src/launcher.js'

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
priority: none
owner: deb
created: 2026-06-24
---

# 0099 — Stale bug

Body.
`

const INDEX = `# Tickets — Index

## Open

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| [0099](./open/0099-stale-bug.md) | Stale bug | bug | none | Open |

## Recently Closed

| ID | Title | Type | Closed | Resolution |
|---|---|---|---|---|
`

async function makeFixture(commits: CommitCall[]): Promise<{ readonly home: string; readonly store: RunStore; readonly ctx: OzContext }> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-reconcile-'))
  const tickets = join(home, 'cocoder', 'tickets')
  await mkdir(join(tickets, 'open'), { recursive: true })
  await mkdir(join(tickets, 'closed'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(tickets, 'open', '0099-stale-bug.md'), TICKET)
  await writeFile(join(tickets, 'INDEX.md'), INDEX)
  await writeFile(join(tickets, 'order.json'), `${JSON.stringify(['0099'], null, 2)}\n`)
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))

  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const git: Partial<Git> = {
    async addAndCommit(_cwd, files, message, author) {
      commits.push({ files: [...files], message, ...(author ? { author } : {}) })
      return 'sha_fake_close'
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

describe('requestReconciliationClose', () => {
  test('queues a close while an active run owns the workspace', async () => {
    const commits: CommitCall[] = []
    const { home, store, ctx } = await makeFixture(commits)
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0099' })
    ctx.inFlight.set('cocoder', run.id)

    const result = await requestReconciliationClose(ctx, { workspaceId: 'cocoder', ticketId: '0099', resolution: 'should already be closed' })

    expect(result).toMatchObject({ status: 202, body: { ok: true, queued: true, queuedId: 'ticket-close-0099', ticketId: '0099', status: 'queued' } })
    expect(commits).toEqual([]) // never committed
    expect(await readdir(join(home, 'cocoder', 'tickets', 'open'))).toContain('0099-stale-bug.md') // still open
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([
      expect.objectContaining({ queuedId: 'ticket-close-0099', action: 'ticket-close', ticketId: '0099', status: 'queued' }),
    ])
  })

  test('closes a stale-open ticket through the governed spine under the shared governance author', async () => {
    const commits: CommitCall[] = []
    const { home, ctx } = await makeFixture(commits)

    const result = await requestReconciliationClose(ctx, { workspaceId: 'cocoder', ticketId: '0099', resolution: 'Reconciled — was fixed but left open.' })

    expect(result).toMatchObject({ status: 200, body: { ok: true, closed: true, commitSha: 'sha_fake_close' } })
    const tickets = join(home, 'cocoder', 'tickets')
    expect(await readdir(join(tickets, 'open'))).not.toContain('0099-stale-bug.md')
    expect(await readFile(join(tickets, 'closed', '0099-stale-bug.md'), 'utf8')).toContain('status: Closed')
    expect(JSON.parse(await readFile(join(tickets, 'order.json'), 'utf8'))).toEqual([])
    expect(commits).toHaveLength(1)
    expect(commits[0].message).toBe('governance: reconciliation close ticket 0099')
    expect(commits[0].author).toEqual(COCODER_GOVERNANCE_AUTHOR)
  })

  test('refuses to reconciliation-close a ticket whose latest run is awaiting a founder decision', async () => {
    const commits: CommitCall[] = []
    const { home, store, ctx } = await makeFixture(commits)
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0099' })
    store.setRunStatus(run.id, 'awaiting-founder')

    const result = await requestReconciliationClose(ctx, { workspaceId: 'cocoder', ticketId: '0099', resolution: 'should already be closed' })

    expect(result).toMatchObject({ status: 409, body: { ok: false, closed: false, reason: 'awaiting-founder-decision', runId: run.id } })
    const tickets = join(home, 'cocoder', 'tickets')
    expect(await readdir(join(tickets, 'open'))).toContain('0099-stale-bug.md')
    expect(await readdir(join(tickets, 'closed'))).not.toContain('0099-stale-bug.md')
    expect(JSON.parse(await readFile(join(tickets, 'order.json'), 'utf8'))).toEqual(['0099'])
    const index = await readFile(join(tickets, 'INDEX.md'), 'utf8')
    expect(index).toContain('| [0099](./open/0099-stale-bug.md) | Stale bug | bug | none | Open |')
    expect(index).not.toContain('| [0099](./closed/0099-stale-bug.md) |')
    expect(commits).toEqual([])
  })

  test('an active run targeting a different ticket also queues the reconciliation close', async () => {
    const commits: CommitCall[] = []
    const { ctx, store } = await makeFixture(commits)
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-fix', ticketId: '0042' })
    ctx.inFlight.set('cocoder', run.id)

    const result = await requestReconciliationClose(ctx, { workspaceId: 'cocoder', ticketId: '0099', resolution: 'Different ticket in flight.' })

    expect(result).toMatchObject({ status: 202, body: { ok: true, queued: true, ticketId: '0099' } })
    expect(commits).toEqual([])
  })

  test('reports not-closed without a spurious commit when the ticket is not open', async () => {
    const commits: CommitCall[] = []
    const { ctx } = await makeFixture(commits)

    const result = await requestReconciliationClose(ctx, { workspaceId: 'cocoder', ticketId: '4242', resolution: 'n/a' })

    expect(result).toMatchObject({ status: 409, body: { ok: false, closed: false, reason: 'missing-open-ticket' } })
    expect(commits).toEqual([])
  })
})
