import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { COCODER_GOVERNANCE_AUTHOR, composeTicketMarkdown, type Git } from '@cocoder/core'
import { reconcileTicketsViaCli } from '../src/reconcile-tickets.js'

interface CommitCall {
  readonly cwd: string
  readonly files: readonly string[]
  readonly message: string
  readonly author?: { readonly name: string; readonly email: string }
}

function fakeGit(calls: CommitCall[]): Git {
  const git: Partial<Git> = {
    async addAndCommit(cwd, files, message, author) {
      calls.push({ cwd, files: [...files], message, ...(author ? { author } : {}) })
      return 'sha_fake_reconcile'
    },
  }
  return git as Git
}

async function setupRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-cli-reconcile-'))
  const tickets = join(repo, 'cocoder', 'tickets')
  await mkdir(join(tickets, 'open'), { recursive: true })
  await mkdir(join(tickets, 'closed'), { recursive: true })
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
  return repo
}

test('reconciles divergent ticket surfaces through the governed CLI spine', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  const result = await reconcileTicketsViaCli({ repoPath: repo, git: fakeGit(calls) })

  expect(result).toEqual({
    commitSha: 'sha_fake_reconcile',
    files: ['cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
  })
  expect(JSON.parse(await readFile(join(repo, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual(['0002', '0003'])
  const index = await readFile(join(repo, 'cocoder', 'tickets', 'INDEX.md'), 'utf8')
  expect(index).toContain('| [0003](./open/0003-missing-ticket.md) | Missing Ticket | task | demo | founder-session |')
  expect(index).not.toContain('9999-stale')
  expect(calls).toEqual([{
    cwd: repo,
    files: ['cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
    message: 'governance: reconcile ticket surfaces (cli)',
    author: COCODER_GOVERNANCE_AUTHOR,
  }])
})
