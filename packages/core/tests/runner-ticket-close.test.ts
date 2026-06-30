import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Git, openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, input, makeTicketWorkspace, recordingWindowGit, runInputFor, scriptedGit, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — ticket close', () => {
  test('run-wrap audit FLAGS a commit that advanced HEAD outside the run ledger (ADR-0041 §4 / 0058)', async () => {
    const store = openRunStore(':memory:')
    // The window enumerates a sha the run never recorded — a raw bypass beside the spine (run_234 shape).
    const git: Git = { ...scriptedGit([['packages/a.ts']]), async commitsSince() { return ['deb-raw-bypass-sha'] } }
    const result = await runRun(
      baseDeps({ store, git, io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }) }),
      input,
    )
    expect(result.status).toBe('completed')
    const bypass = store.listEvents(result.runId).find((e) => e.type === 'run-wrap-bypass-detected')
    expect(bypass).toBeDefined()
    expect((bypass?.data as { bypassShas: string[] }).bypassShas).toEqual(['deb-raw-bypass-sha'])
  })

  test('run-wrap audit stays silent when every window commit is in the run ledger', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(
      baseDeps({ store, git: scriptedGit([['packages/a.ts']]), io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }) }),
      input,
    )
    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).some((e) => e.type === 'run-wrap-bypass-detected')).toBe(false)
  })

  test('verify pass can close a ticket through the atom gate', async () => {
    const store = openRunStore(':memory:')
    const { root, ticketId, slug } = await makeTicketWorkspace()
    const closeFiles = [
      `cocoder/tickets/closed/${ticketId}-${slug}.md`,
      `cocoder/tickets/open/${ticketId}-${slug}.md`,
      'cocoder/tickets/INDEX.md',
      'cocoder/tickets/order.json',
    ]
    const { git, commits } = recordingWindowGit([['packages/fix.ts'], closeFiles])

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('fix ticket 0003'), wrapup('done')],
          verdicts: [{ verdict: 'pass', reason: 'verified fix', ticketClose: { ticketId, resolution: 'Verified fix closes this ticket.' } }],
        }),
        now: () => Date.parse('2026-06-26T12:00:00.000Z'),
      }),
      runInputFor(root),
    )

    expect(result.status).toBe('completed')
    expect(store.listCommitLinks(result.runId).filter((link) => link.workItemId !== null).map((link) => link.commitSha)).toEqual(['sha-1', 'sha-2'])
    expect(store.listEvents(result.runId).filter((event) => event.type === 'commit').map((event) => (event.data as { sha: string }).sha)).toEqual(expect.arrayContaining(['sha-1', 'sha-2']))
    expect(store.listEvents(result.runId).some((event) => event.type === 'in-run-ticket-close')).toBe(true)
    expect(store.listEvents(result.runId).some((event) => event.type === 'run-wrap-bypass-detected')).toBe(false)
    expect(existsSync(join(root, 'cocoder', 'tickets', 'open', `${ticketId}-${slug}.md`))).toBe(false)
    expect(existsSync(join(root, 'cocoder', 'tickets', 'closed', `${ticketId}-${slug}.md`))).toBe(true)
    expect(await readFile(join(root, 'cocoder', 'tickets', 'closed', `${ticketId}-${slug}.md`), 'utf8')).toContain('Verified fix closes this ticket.')
    expect(JSON.parse(await readFile(join(root, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual([])
    expect(commits.slice(0, 2)).toEqual([
      { files: ['packages/fix.ts'], message: expect.stringContaining('atom 0') },
      { files: closeFiles, message: `governance: close ticket ${ticketId} via run ${result.runId}` },
    ])
  })

  test('verify fail does not close a requested ticket', async () => {
    const store = openRunStore(':memory:')
    const { root, ticketId, slug } = await makeTicketWorkspace()
    const { git, commits } = recordingWindowGit([['packages/fix.ts']])

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('try ticket fix'), wrapup('done')],
          verdicts: [{ verdict: 'fail', reason: 'not fixed', ticketClose: { ticketId, resolution: 'Should not close.' } }],
        }),
      }),
      runInputFor(root),
    )

    expect(result.status).toBe('completed')
    expect(commits.some((commit) => commit.message.includes('close ticket'))).toBe(false)
    expect(existsSync(join(root, 'cocoder', 'tickets', 'open', `${ticketId}-${slug}.md`))).toBe(true)
    expect(existsSync(join(root, 'cocoder', 'tickets', 'closed', `${ticketId}-${slug}.md`))).toBe(false)
    expect(store.listEvents(result.runId).some((event) => event.type === 'atom-quarantined')).toBe(true)
    expect(store.listEvents(result.runId).find((event) => event.type === 'in-run-ticket-close-skipped')?.data).toMatchObject({ ticketId, reason: 'verify-fail' })
  })

  test('stale order reconciliation from in-run ticket close is ledgered', async () => {
    const store = openRunStore(':memory:')
    const { root, ticketId } = await makeTicketWorkspace({ ticketId: '0007', open: false, order: ['0007'] })
    const { git, commits } = recordingWindowGit([[], ['cocoder/tickets/order.json']])

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('reconcile stale order'), wrapup('done')],
          verdicts: [{ verdict: 'pass', reason: 'stale order entry verified', ticketClose: { ticketId, resolution: 'Remove stale order entry.' } }],
        }),
      }),
      runInputFor(root),
    )

    expect(result.status).toBe('completed')
    expect(JSON.parse(await readFile(join(root, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual([])
    expect(commits.some((commit) => commit.message === `governance: reconcile ticket ${ticketId} order entry via run ${result.runId}` && commit.files.includes('cocoder/tickets/order.json'))).toBe(true)
    expect(store.listEvents(result.runId).find((event) => event.type === 'in-run-ticket-order-reconciled')?.data).toMatchObject({ ticketId, reason: 'missing-open-ticket' })
    expect(store.listEvents(result.runId).some((event) => event.type === 'run-wrap-bypass-detected')).toBe(false)
  })

  test('priority mismatch skips in-run ticket close', async () => {
    const store = openRunStore(':memory:')
    const { root, ticketId, slug } = await makeTicketWorkspace({ priorityValue: 'other-priority' })
    const { git, commits } = recordingWindowGit([[]])

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('do unrelated work'), wrapup('done')],
          verdicts: [{ verdict: 'pass', reason: 'verified unrelated work', ticketClose: { ticketId, resolution: 'Should not close unrelated ticket.' } }],
        }),
      }),
      runInputFor(root),
    )

    expect(result.status).toBe('completed')
    expect(existsSync(join(root, 'cocoder', 'tickets', 'open', `${ticketId}-${slug}.md`))).toBe(true)
    expect(existsSync(join(root, 'cocoder', 'tickets', 'closed', `${ticketId}-${slug}.md`))).toBe(false)
    expect(commits.some((commit) => commit.message.includes('close ticket'))).toBe(false)
    expect(store.listEvents(result.runId).find((event) => event.type === 'in-run-ticket-close-skipped')?.data).toMatchObject({ ticketId, reason: 'priority-mismatch' })
  })

  test('in-run ticket close commit failure fails loudly', async () => {
    const store = openRunStore(':memory:')
    const { root, ticketId, slug } = await makeTicketWorkspace()
    const closeFiles = [
      `cocoder/tickets/closed/${ticketId}-${slug}.md`,
      `cocoder/tickets/open/${ticketId}-${slug}.md`,
      'cocoder/tickets/INDEX.md',
      'cocoder/tickets/order.json',
    ]
    const { git, commits } = recordingWindowGit([['packages/fix.ts'], closeFiles], { failOnCommit: 2 })

    await expect(runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('fix ticket 0003'), wrapup('done')],
          verdicts: [{ verdict: 'pass', reason: 'verified fix', ticketClose: { ticketId, resolution: 'Verified fix closes this ticket.' } }],
        }),
      }),
      runInputFor(root),
    )).rejects.toThrow(/commit 2 failed/)

    const runId = store.listRuns()[0]?.id
    expect(runId).toBeDefined()
    expect(commits).toEqual([{ files: ['packages/fix.ts'], message: expect.stringContaining('atom 0') }])
    expect(store.listEvents(runId!).find((event) => event.type === 'in-run-ticket-close-commit-failed')?.data).toMatchObject({ ticketId })
    expect(existsSync(join(root, 'cocoder', 'tickets', 'closed', `${ticketId}-${slug}.md`))).toBe(true)
  })
})
