import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { COCODER_GOVERNANCE_AUTHOR, composeTicketMarkdown, openRunStore, type Git, type RunStore } from '@cocoder/core'
import { listQueuedAuthoring } from '../src/authoring-queue.js'
import { createOzEventBus, type OzContext } from '../src/context.js'
import { requestReconciliationTickets } from '../src/launcher.js'

interface CommitCall {
  readonly files: readonly string[]
  readonly message: string
  readonly author?: { readonly name: string; readonly email: string }
}

async function makeFixture(commits: CommitCall[]): Promise<{ readonly home: string; readonly store: RunStore; readonly ctx: OzContext }> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-reconcile-tickets-'))
  const tickets = join(home, 'cocoder', 'tickets')
  await mkdir(join(tickets, 'open'), { recursive: true })
  await mkdir(join(tickets, 'closed'), { recursive: true })
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(
    join(tickets, 'open', '0002-indexed-ticket.md'),
    composeTicketMarkdown('0002', { title: 'Indexed Ticket', type: 'task', priority: 'none', description: 'Already indexed.' }, '2026-06-28'),
  )
  await writeFile(
    join(tickets, 'open', '0003-missing-ticket.md'),
    composeTicketMarkdown('0003', { title: 'Missing Ticket', type: 'task', priority: 'demo', bindingReason: 'Founder chose demo for this ticket.', description: 'Missing from surfaces.' }, '2026-06-28'),
  )
  await writeFile(join(tickets, 'INDEX.md'), [
    '# Tickets - Index',
    '',
    '## Open',
    '',
    '| ID | Title | Type | Priority | Owner |',
    '|---|---|---|---|---|',
    '| [0002](./open/0002-indexed-ticket.md) | Indexed Ticket | task | none | founder-session |',
    '| [9999](./open/9999-stale.md) | Stale | task | none | founder-session |',
    '',
    '## Recently Closed',
    '',
    '| ID | Title | Type | Closed | Resolution |',
    '|---|---|---|---|---|',
    '',
  ].join('\n'))
  await writeFile(join(tickets, 'order.json'), `${JSON.stringify(['0002', '9999'], null, 2)}\n`)
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))

  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
  const git: Partial<Git> = {
    async addAndCommit(_cwd, files, message, author) {
      commits.push({ files: [...files], message, ...(author ? { author } : {}) })
      return 'sha_fake_reconcile'
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

describe('requestReconciliationTickets', () => {
  test('reconciles divergent ticket surfaces and commits exactly the touched files', async () => {
    const commits: CommitCall[] = []
    const { home, ctx } = await makeFixture(commits)

    const result = await requestReconciliationTickets(ctx, { workspaceId: 'cocoder' })

    expect(result).toMatchObject({ status: 200, body: { ok: true, reconciled: true, commitSha: 'sha_fake_reconcile' } })
    expect(result.body.committedPaths).toEqual(['cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'])
    expect(JSON.parse(await readFile(join(home, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0002', '0003'])
    const index = await readFile(join(home, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')
    expect(index).toContain('| [0003](./open/0003-missing-ticket.md) | Missing Ticket | task | demo | founder-session |')
    expect(index).not.toContain('9999-stale')
    expect(commits).toEqual([{
      files: ['cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
      message: 'governance: reconcile ticket surfaces (cocoder)',
      author: COCODER_GOVERNANCE_AUTHOR,
    }])
  })

  test('returns an idempotent no-op when surfaces are already consistent', async () => {
    const commits: CommitCall[] = []
    const { ctx } = await makeFixture(commits)

    await requestReconciliationTickets(ctx, { workspaceId: 'cocoder' })
    commits.length = 0
    const result = await requestReconciliationTickets(ctx, { workspaceId: 'cocoder' })

    expect(result).toMatchObject({ status: 200, body: { ok: true, reconciled: true, commitSha: null, committedPaths: [] } })
    expect(commits).toEqual([])
  })

  test('queues ticket reconciliation while an active run owns the workspace', async () => {
    const commits: CommitCall[] = []
    const { home, store, ctx } = await makeFixture(commits)
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    ctx.inFlight.set('cocoder', run.id)

    const result = await requestReconciliationTickets(ctx, { workspaceId: 'cocoder' })

    expect(result).toMatchObject({ status: 202, body: { ok: true, queued: true, queuedId: 'ticket-reconcile', status: 'queued' } })
    expect(commits).toEqual([])
    await expect(listQueuedAuthoring(home, 'cocoder')).resolves.toEqual([
      expect.objectContaining({ queuedId: 'ticket-reconcile', action: 'ticket-reconcile', status: 'queued' }),
    ])
  })
})
