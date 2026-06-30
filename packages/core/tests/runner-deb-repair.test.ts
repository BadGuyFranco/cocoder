import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Git, type RunnerIO, openRunStore, readTickets, runRun } from '../src/index.js'
import {
  askFounderContinue,
  baseDeps,
  deb,
  delegate,
  fakeIO,
  fakeSessionHost,
  input,
  persona,
  workspaceRoot,
  worktreeStubs,
} from './runner.test-support.js'

describe('runRun (multi-atom loop) — Deb repair', () => {
  test('repair mode commits only Deb-declared repair files when filesChanged is present', async () => {
    const store = openRunStore(':memory:')
    const debRepair = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const io: RunnerIO = {
      ...fakeIO({
        directives: [],
        triage: { disposition: 'cocoder-bug', summary: 'runner contract bug', mode: 'repair', diagnosis: 'wait condition references an unassigned file', filesChanged: ['cocoder/priorities/x.md'] },
      }),
      async awaitDirective() {
        throw new Error('no valid directive within 1ms') // the fault Deb triages + repairs
      },
    }
    // Deb edited one in-scope CoCoder file while an unrelated product file is dirty. The tree is CLEAN at
    // launch (first changedFiles call = the start-of-run guard/snapshot); the unrelated dirt appears once
    // the repair runs, but Deb's `filesChanged` list is the repair commit pathspec.
    let repairStarted = false
    const commits: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        if (!repairStarted) {
          repairStarted = true
          return []
        }
        return ['cocoder/priorities/x.md', 'packages/app/product.ts']
      },
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        return 'sha-repair'
      },
      async restoreToHead() {},
      async show() {
        return ''
      },
    }
    await expect(runRun(baseDeps({ store, io, git }), { ...input, deb: debRepair })).rejects.toThrow(/no valid directive/)
    const runId = store.listRuns()[0]!.id
    const events = store.listEvents(runId)
    const repair = events.find((e) => e.type === 'deb-repair')
    expect(repair?.data).toMatchObject({ committedSha: 'sha-repair', files: ['cocoder/priorities/x.md'], outOfScope: [] })
    expect(commits).toContainEqual(['cocoder/priorities/x.md'])
    expect(events.find((e) => e.type === 'out-of-scope-committed')).toBeUndefined()
    expect(store.listCommitLinks(runId).filter((c) => !c.message.startsWith('run-history: ')).flatMap((c) => c.files)).toEqual(['cocoder/priorities/x.md'])
    expect(store.getRun(runId)?.status).toBe('failed') // a repair never rescues the run
  })

  test('a builder fault quarantines the atom residue before Deb triages, so a deb-repair commit cannot sweep it (run_231)', async () => {
    const store = openRunStore(':memory:')
    const debRepair = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const residue = ['eslint.config.mjs', 'package.json'] // the faulted builder's out-of-lane WIP, left dirty
    const debEdit = ['cocoder/PLAYBOOK.md'] // Deb's actual repair, written during triage
    // Repair mode with NO filesChanged → exercises the unbounded whole-tree repair gate (the exact path
    // that swept the dirty ticket-0048 lint work in run_231). The fix is upstream: the runner quarantines
    // the faulted atom's residue BEFORE the fault reaches Deb, so the gate can only ever see Deb's edit.
    const io = fakeIO({
      directives: [delegate('adopt the linter')],
      triage: { disposition: 'cocoder-bug', summary: 'false blocker classification', mode: 'repair', diagnosis: 'd', whyCocoderOwned: 'runner-owned', verification: 'unit tests' },
    })
    let changedCalls = 0
    const restored: string[] = []
    const commits: string[][] = []
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        changedCalls += 1
        if (changedCalls === 1) return [] // launch guard: clean tree
        if (changedCalls === 2) return residue // quarantine sees the faulted atom's residue
        return debEdit // after quarantine, only Deb's repair edit remains dirty
      },
      async restoreToHead(_cwd, files) {
        restored.push(...files)
      },
      async addAndCommit(_cwd, files) {
        commits.push([...files])
        return 'sha-repair'
      },
      async show() {
        return ''
      },
    }
    await expect(
      runRun(
        baseDeps({
          store,
          io,
          git,
          sessionHost: fakeSessionHost({
            async readScreen(ref) {
              return ref.id === 'surface:2' ? '<<<COCODER-ATOM-0-BLOCKED: the atom needs creating files the builder cannot author>>>' : ''
            },
          }),
          timeouts: { orchestrationMs: 200, buildMs: 200, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
        }),
        { ...input, deb: debRepair },
      ),
    ).rejects.toThrow(/builder reported/)
    const runId = store.listRuns()[0]!.id
    const events = store.listEvents(runId)
    // The faulted atom's residue was quarantined (restored to HEAD) BEFORE the fault reached triage.
    expect(events.find((e) => e.type === 'atom-quarantined')?.data).toMatchObject({ atom: 0, files: residue })
    expect(restored).toEqual(expect.arrayContaining(residue))
    // Deb's repair commit contains ONLY her edit — the residue was never swept into a deb-repair commit.
    expect(events.find((e) => e.type === 'deb-repair')?.data).toMatchObject({ committedSha: 'sha-repair', files: debEdit })
    expect(commits.flat()).not.toContain('eslint.config.mjs')
    expect(commits.flat()).not.toContain('package.json')
    expect(store.getRun(runId)?.status).toBe('failed') // a repair never rescues the run
  })

  test('a recurring fault escalates on the 2nd occurrence: Deb files a ticket, gate-committed (ADR-0016 §recurrence)', async () => {
    const store = openRunStore(':memory:')
    const debScoped = persona({ id: 'deb', cli: 'claude', writeScope: ['cocoder/**'] })
    const MSG = 'no valid directive within 1ms'
    const timeoutIO = (triage: Parameters<typeof fakeIO>[0]['triage']): RunnerIO => ({
      ...fakeIO({ directives: [], triage }),
      async awaitDirective() {
        throw new Error(MSG) // directive-timeout — same message both runs → same fingerprint
      },
    })
    const expectedTicketId = '0016'
    const expectedTicketFile = `cocoder/tickets/open/${expectedTicketId}-recurring-directive-timeout.md`
    const expectedTicketFiles = [expectedTicketFile, 'cocoder/tickets/INDEX.md', 'cocoder/tickets/order.json']
    const commits: Array<{ files: readonly string[]; message: string }> = []
    const ticketGit = (): Git => {
      // Clean at launch (first changedFiles call = the start-of-run guard/snapshot). Escalation-ticket
      // creation now commits the governed spine's explicit file list, not Deb's changedFiles.
      let started = false
      return {
        ...worktreeStubs,
        async headSha() {
          return 'h0'
        },
        async changedFiles() {
          if (!started) {
            started = true
            return []
          }
          return []
        },
        async addAndCommit(_cwd, files, message) {
          commits.push({ files: [...files], message })
          return 'sha-ticket'
        },
        async restoreToHead() {},
        async show() {
          return ''
        },
      }
    }

    // 1st occurrence → one-off; records a fault-triaged carrying the fingerprint, but no recurrence yet.
    let r1 = ''
    await expect(
      runRun(
        baseDeps({ store, io: timeoutIO({ disposition: 'one-off', summary: 'first time' }), git: ticketGit(), onRunCreated: (r) => {
          r1 = r.id
        } }),
        { ...input, deb: debScoped },
      ),
    ).rejects.toThrow(/no valid directive/)
    expect(store.listEvents(r1).some((e) => e.type === 'fault-recurrence')).toBe(false)

    // 2nd occurrence (same fault) → Deb escalates with a ticket; the runner gate-commits it.
    let r2 = ''
    await expect(
      runRun(
        baseDeps({
          store,
          io: timeoutIO({
            disposition: 'cocoder-bug',
            summary: 'recurring directive-timeout',
            escalation: 'ticket',
            ticketTitle: 'Recurring directive timeout',
            ticketType: 'bug',
            ticketPriority: 'demo',
            ticketBody: '## Context\n\nThe directive timeout recurred.',
          }),
          git: ticketGit(),
          now: () => Date.parse('2026-06-25T12:00:00.000Z'),
          onRunCreated: (r) => {
            r2 = r.id
          },
        }),
        { ...input, deb: debScoped },
      ),
    ).rejects.toThrow(/no valid directive/)
    const evs = store.listEvents(r2)
    expect((evs.find((e) => e.type === 'fault-recurrence')?.data as { occurrence?: number })?.occurrence).toBe(2)
    expect(evs.find((e) => e.type === 'deb-repair')?.data).toMatchObject({ escalation: 'ticket', ticketId: expectedTicketId, committedSha: 'sha-ticket', files: expectedTicketFiles, outOfScope: [] })
    expect(evs.find((e) => e.type === 'deb-repair-out-of-scope-held')).toBeUndefined()
    expect(evs.find((e) => e.type === 'out-of-scope-committed')).toBeUndefined()
    const ticketCommit = commits.find((commit) => commit.files.includes(expectedTicketFile))
    expect(ticketCommit).toMatchObject({ files: expectedTicketFiles })
    expect(ticketCommit?.message).toContain(`deb-escalation: directive-timeout (atom 0) occurrence 2 → ticket ${expectedTicketId}`)
    expect(store.listCommitLinks(r2).filter((c) => !c.message.startsWith('run-history: ')).flatMap((c) => c.files)).toEqual(expectedTicketFiles)
    expect(JSON.parse(readFileSync(join(workspaceRoot, 'cocoder', 'tickets', 'order.json'), 'utf8'))).toEqual([expectedTicketId])
    expect((await readTickets(join(workspaceRoot, 'cocoder', 'tickets'))).find((ticket) => ticket.id === expectedTicketId)).toMatchObject({
      id: expectedTicketId,
      title: 'Recurring directive timeout',
      type: 'bug',
      priority: 'demo',
      owner: 'founder-session',
      created: '2026-06-25',
      status: 'Open',
      state: 'open',
    })
    expect(store.getRun(r2)?.status).toBe('failed') // escalation tracks it; the run still fails
  })


})
