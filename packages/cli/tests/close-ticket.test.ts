// D5 / ticket 0059 / ADR-0041 §3 R3: `cocoder oz close-ticket <id>` closes a ticket through the
// existing governed core spines (closeTicket → commitFiles) so a loop-down control-plane close never
// needs ad-hoc tsx. Tested against an injected fake Git (no real repo) so the file moves + the governed
// commit are pinned deterministically.
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { COCODER_GOVERNANCE_AUTHOR, type Git } from '@cocoder/core'
import { closeTicketViaCli } from '../src/close-ticket.js'

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
      return 'sha_fake_close'
    },
  }
  return git as Git
}

const TICKET = `---
id: 0099
title: Some bug
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-24
---

# 0099 — Some bug

## Context

Body.
`

const INDEX = `# Tickets — Index

## Open

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| [0099](./open/0099-some-bug.md) | Some bug | bug | none | Open |

## Recently Closed

| ID | Title | Type | Closed | Resolution |
|---|---|---|---|---|
`

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => readdir(d).catch(() => [])))
})

async function setupRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-close-'))
  dirs.push(repo)
  const tickets = join(repo, 'cocoder', 'tickets')
  await mkdir(join(tickets, 'open'), { recursive: true })
  await mkdir(join(tickets, 'closed'), { recursive: true })
  await writeFile(join(tickets, 'open', '0099-some-bug.md'), TICKET)
  await writeFile(join(tickets, 'INDEX.md'), INDEX)
  await writeFile(join(tickets, 'order.json'), `${JSON.stringify(['0099'], null, 2)}\n`)
  return repo
}

test('closes an open ticket through the governed spine and commits exactly the touched files', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  const result = await closeTicketViaCli({
    repoPath: repo,
    ticketId: '0099',
    resolution: 'Fixed it.',
    closedDate: '2026-06-24',
    git: fakeGit(calls),
  })

  expect(result.closed).toBe(true)
  expect(result.commitSha).toBe('sha_fake_close')

  const tickets = join(repo, 'cocoder', 'tickets')
  expect(await readdir(join(tickets, 'open'))).not.toContain('0099-some-bug.md')
  const closed = await readFile(join(tickets, 'closed', '0099-some-bug.md'), 'utf8')
  expect(closed).toContain('status: Closed')
  expect(closed).toContain('## Resolution')
  expect(closed).toContain('Fixed it.')
  expect(JSON.parse(await readFile(join(tickets, 'order.json'), 'utf8'))).toEqual([])

  expect(calls).toHaveLength(1)
  expect(calls[0].message).toBe('governance: close ticket 0099')
  expect(calls[0].author).toEqual(COCODER_GOVERNANCE_AUTHOR)
  expect(calls[0].files).toEqual(expect.arrayContaining([
    'cocoder/tickets/closed/0099-some-bug.md',
    'cocoder/tickets/open/0099-some-bug.md',
    'cocoder/tickets/INDEX.md',
    'cocoder/tickets/order.json',
  ]))
})

test('a --run reference stamps the commit message and resolution with the run fingerprint', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  const result = await closeTicketViaCli({
    repoPath: repo,
    ticketId: '0099',
    resolution: 'Fixed in the run.',
    closedDate: '2026-06-24',
    runId: 'run_777',
    git: fakeGit(calls),
  })

  expect(result.closed).toBe(true)
  expect(calls[0].message).toBe('governance: close ticket 0099 via run run_777')
  const closed = await readFile(join(repo, 'cocoder', 'tickets', 'closed', '0099-some-bug.md'), 'utf8')
  expect(closed).toContain('Resolved by run run_777')
})

test('an unknown / already-closed ticket reports not-closed and makes no spurious commit', async () => {
  const repo = await setupRepo()
  const calls: CommitCall[] = []

  const result = await closeTicketViaCli({
    repoPath: repo,
    ticketId: '4242',
    resolution: 'n/a',
    closedDate: '2026-06-24',
    git: fakeGit(calls),
  })

  expect(result.closed).toBe(false)
  expect(result.reason).toBe('missing-open-ticket')
  expect(calls).toHaveLength(0)
})
