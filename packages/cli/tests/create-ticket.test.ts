// D5 / ticket 0061 / ADR-0041 §3 R3: `cocoder oz create-ticket` creates a ticket through the
// existing governed core spines (createTicket → commitFiles) so a loop-down control-plane create never
// needs ad-hoc tsx. Tested against an injected fake Git (no real repo) so the governed ticket writes +
// commit are pinned deterministically.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { COCODER_GOVERNANCE_AUTHOR, composeTicketMarkdown, type Git } from '@cocoder/core'
import { createTicketViaCli } from '../src/create-ticket.js'

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
      return 'sha_fake_create'
    },
  }
  return git as Git
}

async function setupRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-create-'))
  const tickets = join(repo, 'cocoder', 'tickets')
  await mkdir(join(tickets, 'open'), { recursive: true })
  await writeFile(
    join(tickets, 'open', '0001-existing-ticket.md'),
    composeTicketMarkdown('0001', { title: 'Existing ticket', type: 'task', priority: 'none', description: 'Already queued.' }, '2026-06-24'),
  )
  await writeFile(join(tickets, 'order.json'), `${JSON.stringify(['0001'], null, 2)}\n`)
  return repo
}

test('creates an open ticket through the governed spine and commits exactly the touched files', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  const result = await createTicketViaCli({
    repoPath: repo,
    title: 'Agent Ticket',
    type: 'bug',
    priority: 'tickets-review',
    bindingReason: 'Founder chose tickets-review for this CLI ticket.',
    description: '## Context\nFiled by the CLI.',
    created: '2026-06-25',
    git: fakeGit(calls),
  })

  expect(result).toEqual({
    created: true,
    id: '0002',
    commitSha: 'sha_fake_create',
    files: ['cocoder/tickets/open/0002-agent-ticket.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
  })

  const tickets = join(repo, 'cocoder', 'tickets')
  const markdown = await readFile(join(tickets, 'open', '0002-agent-ticket.md'), 'utf8')
  expect(markdown).toContain('id: 0002')
  expect(markdown).toContain('title: Agent Ticket')
  expect(markdown).toContain('priority: tickets-review')
  expect(markdown).toContain('binding-reason: Founder chose tickets-review for this CLI ticket.')

  const index = await readFile(join(tickets, 'INDEX.md'), 'utf8')
  expect(index.split('\n').filter((line) => line.includes('| [0002]('))).toEqual([
    '| [0002](./open/0002-agent-ticket.md) | Agent Ticket | bug | tickets-review | founder-session |',
  ])
  expect(JSON.parse(await readFile(join(tickets, 'order.json'), 'utf8'))).toEqual(['0001', '0002'])

  expect(calls).toEqual([{
    cwd: repo,
    files: ['cocoder/tickets/open/0002-agent-ticket.md', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json'],
    message: 'governance: create ticket 0002',
    author: COCODER_GOVERNANCE_AUTHOR,
  }])
})

test('a --run reference stamps the create commit message with the run fingerprint', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  const result = await createTicketViaCli({
    repoPath: repo,
    title: 'Run Ticket',
    type: 'task',
    description: 'Created from a run.',
    created: '2026-06-25',
    runId: 'run_777',
    git: fakeGit(calls),
  })

  expect(result.created).toBe(true)
  expect(calls[0].message).toBe('governance: create ticket 0002 via run run_777')
  await expect(readFile(join(repo, 'cocoder', 'tickets', 'open', '0002-run-ticket.md'), 'utf8')).resolves.toContain('provenance: run_777')
  await expect(readFile(join(repo, 'cocoder', 'tickets', 'open', '0002-run-ticket.md'), 'utf8')).resolves.toContain('priority: none')
})

test('rejects a priority binding without a binding reason before committing', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  await expect(createTicketViaCli({
    repoPath: repo,
    title: 'Reasonless Binding',
    type: 'bug',
    priority: 'tickets-review',
    description: 'Do not create.',
    created: '2026-06-25',
    git: fakeGit(calls),
  })).rejects.toThrow(/requires a binding reason/)

  expect(calls).toHaveLength(0)
})

test('an id collision reports not-created and makes no commit', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  const result = await createTicketViaCli({
    repoPath: repo,
    ticketId: '0001',
    title: 'Existing ticket',
    type: 'task',
    priority: 'none',
    description: 'Do not duplicate.',
    created: '2026-06-25',
    git: fakeGit(calls),
  })

  expect(result).toEqual({ created: false, reason: 'already-exists', commitSha: null, files: [] })
  expect(calls).toHaveLength(0)
})
