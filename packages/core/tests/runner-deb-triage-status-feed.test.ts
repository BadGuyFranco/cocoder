import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type DebStatus, type DebTerminalSnapshot, type Git, deriveTerminalProjection, openRunStore, renderDebStatus, runRun } from '../src/index.js'
import {
  baseDeps,
  bob,
  deb,
  delegate,
  fakeIO,
  fakeSessionHost,
  input,
  okAdapter,
  oscar,
  priority,
  scriptedGit,
  wrapPlay,
  wrapup,
  wrapPlayAssignment,
  writeFounderStopSignal,
  worktreeStubs,
} from './runner.test-support.js'

describe('runRun (multi-atom loop) — Deb triage and nudges', () => {
  test('writes a live status feed so Deb can report concrete run state (ADR-0016)', async () => {
    const store = openRunStore(':memory:')
    const statusWrites: DebStatus[] = []
    const terminalSnapshotWrites: DebTerminalSnapshot[] = []
    const sent: string[] = []
    let frame = 0
    await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites, terminalSnapshotWrites }),
        sessionHost: fakeSessionHost({
          // DE-FLAKED (WS4): a healthy run = Oscar making progress = the screen changing, so idleStreak
          // never climbs and the watcher never dispatches. The default constant '' screen let the 1ms
          // cadence loop spuriously detect a stall whenever a directive await was slow under load,
          // flaking the `deb-watch-dispatch` / `DEB WATCH` negative assertions below.
          async readScreen() {
            return `oscar working ${frame++}`
          },
          async sendInput(_ref, text) {
            sent.push(text)
          },
        }),
      }),
      { ...input, deb },
    )
    // The feed only exists for a Deb-backed run, and it carries evidence (state + wait condition).
    expect(statusWrites.length).toBeGreaterThan(0)
    expect(terminalSnapshotWrites).toHaveLength(statusWrites.length)
    expect(statusWrites[0]).toMatchObject({ oscar: 'waiting', bob: 'standby', waitCondition: 'awaiting first directive' })
    expect(statusWrites.some((s) => s.bob === 'running' && s.waitCondition.includes('monitoring builder'))).toBe(true)
    expect(statusWrites.some((s) => s.oscar === 'verifying' && s.verify === 'pending')).toBe(true)
    expect(statusWrites.some((s) => s.watch.active)).toBe(true)
    const finalStatus = statusWrites.at(-1)!
    expect(finalStatus.oscar).toBe('wrapped')
    expect(finalStatus.watch.active).toBe(false)
    // WS1/0054: a run-end terminal projection refreshes the feed AFTER wrap delivery (runner.ts), so the
    // FINAL waitCondition is the concrete terminal string for a completed run — it overrides the richer
    // wrap-delivery line (which named in-scope Surface-A edits). Pinned exactly so wording drift is caught.
    expect(finalStatus.waitCondition).toBe(
      'run completed; Oscar remains reachable for founder questions until explicit teardown',
    )
    const events = store.listEvents(store.listRuns()[0]!.id)
    const derivedTerminal = deriveTerminalProjection(events)!
    const canonicalTerminal = renderDebStatus({
      store,
      runId: store.listRuns()[0]!.id,
      priority,
      scopes: { oscar: oscar.writeScope, bob: bob.writeScope, deb: deb.writeScope },
      phase: derivedTerminal.phase,
      activeAtom: derivedTerminal.activeAtom,
      activeTask: null,
      waitCondition: finalStatus.waitCondition,
    }).json
    expect(finalStatus.activeAtom).toBe(derivedTerminal.activeAtom)
    expect(finalStatus.oscar).toBe(canonicalTerminal.oscar)
    expect(finalStatus.bob).toBe(canonicalTerminal.bob)
    expect(finalStatus.verify).toBe(canonicalTerminal.verify)
    expect(finalStatus.watch).toEqual(canonicalTerminal.watch)
    expect(finalStatus.recentEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['deb-watch-stopped', 'run-end']))
    expect(events.some((e) => e.type === 'deb-watch-started')).toBe(true)
    expect(events.some((e) => e.type === 'deb-watch-dispatch')).toBe(false)
    expect(events.some((e) => e.type === 'deb-status' && (e.data as { waitCondition?: string }).waitCondition === 'awaiting first directive')).toBe(true)
    expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    expect(events.some((e) => e.type === 'deb-watch-stopped')).toBe(true)
    expect(events.map((e) => e.type).lastIndexOf('deb-status')).toBeGreaterThan(events.map((e) => e.type).indexOf('run-end'))
    expect(sent.some((text) => text.startsWith('DEB WATCH'))).toBe(false)

    const noDebStore = openRunStore(':memory:')
    const noDebStatus: DebStatus[] = []
    await runRun(baseDeps({ store: noDebStore, io: fakeIO({ directives: [delegate('do x'), wrapup('done')], statusWrites: noDebStatus }) }), input)
    expect(noDebStatus).toHaveLength(0) // no status feed without Deb
  })

  // ── WS1 step 2 (runner-decoupling-refactor.md): holdRun/stopRun never called refreshStatus, so the
  // status feed kept a STALE pre-terminal phase after a hold/stop. Now they refresh from
  // deriveTerminalProjection(events) AFTER recording the terminal markers, closing the stale-feed gap.
  // This is the ONE intended behavior change in WS1 (held/stopped feed becomes correct, not stale).
  describe('WS1 step 2 — terminal status feed derives its phase from the event log (no stale phase)', () => {
    // The fields the terminal projection controls. generatedAt (render-time) and the free-text
    // waitCondition/activeTask (still imperative) are intentionally excluded so the assertion is
    // deterministic without deep-equalling two independently-built stores (WS1.1 determinism rule).
    const projectionFields = (s: DebStatus) => ({
      oscar: s.oscar,
      activeAtom: s.activeAtom,
      bob: s.bob,
      verify: s.verify,
      outstandingFaults: s.outstandingFaults,
      handoffs: s.handoffs,
    })

    // run_283 regression: a failed wrap that still dispatched a WRAP-UP READY artifact (the fallback
    // closeout) leaves Oscar holding a LIVE delivery instruction. The terminal projection must present
    // the wrapped/standing-by affordance, NOT a generic faulted/blocked "no further action pending" that
    // contradicts the live pane. run.json status stays `failed` (commit outcome), but Oscar is standing by.
    test('failed wrap WITH delivery: terminal DebStatus is wrapped/standing-by, not a stranded faulted wait', async () => {
      const store = openRunStore(':memory:')
      const statusWrites: DebStatus[] = []
      const result = await runRun(
        baseDeps({
          store,
          git: scriptedGit([['packages/atom.ts']]),
          io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], statusWrites }),
          getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
          runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
        }),
        { ...input, deb, wrapPlay, wrapPlayAssignment },
      )
      expect(result.status).toBe('failed')

      const events = store.listEvents(result.runId)
      // The fallback closeout is still delivered for the founder to read, and the send landed.
      const dispatch = events.find((e) => e.type === 'wrapup-delivery-dispatch')!
      expect((dispatch.data as { delivered?: boolean }).delivered).toBe(true)
      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'wrapped', activeAtom: 1 })

      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('wrapped')
      expect(terminal.watch.active).toBe(false)
      // No dead-looking "no further runner action pending"; the feed agrees with the live delivery pane.
      expect(terminal.waitCondition).toBe(
        'WRAP-UP READY delivered after a failed wrap; Oscar is standing by for founder questions until explicit teardown',
      )
      expect(terminal.recentEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['deb-watch-stopped', 'run-end']))
      const canonical = renderDebStatus({ store, runId: result.runId, priority, scopes: {}, phase: derived.phase, activeAtom: derived.activeAtom, activeTask: null, waitCondition: 'derived' }).json
      expect(projectionFields(terminal)).toEqual(projectionFields(canonical))

      const types = events.map((e) => e.type)
      expect(types.lastIndexOf('deb-status')).toBeGreaterThan(types.indexOf('run-end'))
      expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    })

    // Send-outcome hardening: when the WRAP-UP READY send THROWS (swallowed before this fix), Oscar never
    // received the instruction — there is no live pane to "stand by". The dispatch records `delivered:false`
    // and the terminal projection falls through to the honest faulted/blocked no-delivery state, NOT a
    // standing-by affordance that assumes a pane Oscar can't be in.
    test('failed wrap whose delivery send THROWS records delivered:false and projects faulted, not standing-by', async () => {
      const store = openRunStore(':memory:')
      const statusWrites: DebStatus[] = []
      const result = await runRun(
        baseDeps({
          store,
          git: scriptedGit([['packages/atom.ts']]),
          io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], statusWrites }),
          getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
          runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
          sessionHost: fakeSessionHost({
            async sendInput(_ref, text) {
              if (text.startsWith('WRAP-UP READY')) throw new Error('pane gone')
            },
          }),
        }),
        { ...input, deb, wrapPlay, wrapPlayAssignment },
      )
      expect(result.status).toBe('failed')

      const events = store.listEvents(result.runId)
      const dispatch = events.find((e) => e.type === 'wrapup-delivery-dispatch')!
      expect((dispatch.data as { delivered?: boolean }).delivered).toBe(false)
      expect((dispatch.data as { error?: string }).error).toBe('pane gone')

      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'faulted', activeAtom: 1 })
      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('blocked')
      expect(terminal.waitCondition).toBe('run failed; no further runner action pending')
    })

    test('held run: on-disk terminal DebStatus matches deriveTerminalProjection (was a stale pre-hold phase)', async () => {
      const store = openRunStore(':memory:')
      const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-ws1-held-feed-'))
      const runDir = join(runsRoot, 'cocoder', 'run_1')
      await writeFounderStopSignal(runDir)
      const statusWrites: DebStatus[] = []
      const result = await runRun(
        baseDeps({ store, io: fakeIO({ directives: [delegate('should not dispatch')], statusWrites }) }),
        { ...input, runsRoot, deb },
      )
      expect(result.status).toBe('held')

      const events = store.listEvents(result.runId)
      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'awaiting-founder', activeAtom: 0 })

      // The feed is no longer stale: it reflects the held projection (oscar 'blocked'), not the pre-hold
      // 'awaiting-directive'/'waiting' it carried before WS1.2.
      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('blocked')
      // Render the canonical projection from the SAME post-run store (one store → identical event `at`),
      // and confirm the projection-controlled fields agree.
      const canonical = renderDebStatus({ store, runId: result.runId, priority, scopes: {}, phase: derived.phase, activeAtom: derived.activeAtom, activeTask: null, waitCondition: 'derived' }).json
      expect(projectionFields(terminal)).toEqual(projectionFields(canonical))

      // refreshStatus ran AFTER the terminal markers (so the projection saw run-end), and the recorded
      // deb-status events still track the on-disk writes one-for-one.
      const types = events.map((e) => e.type)
      expect(types.lastIndexOf('deb-status')).toBeGreaterThan(types.indexOf('run-end'))
      expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    })

    test('stopped run: on-disk terminal DebStatus matches deriveTerminalProjection (was a stale pre-stop phase)', async () => {
      const store = openRunStore(':memory:')
      const signal = new AbortController()
      const statusWrites: DebStatus[] = []
      const git: Git = {
        ...worktreeStubs,
        async headSha() {
          return 'h0'
        },
        changedFiles: (() => {
          let first = true
          return async () => (first ? ((first = false), []) : ['packages/half-built.ts'])
        })(),
        async addAndCommit(_cwd, files) {
          if (files.every((file) => file.startsWith('cocoder/'))) return 'sha-history'
          throw new Error('stopped atom should not commit')
        },
        async restoreToHead() {},
        async show() {
          return ''
        },
      }
      const result = await runRun(
        baseDeps({
          store,
          git,
          io: fakeIO({ directives: [delegate('half build')], statusWrites }),
          sessionHost: fakeSessionHost({
            async readScreen() {
              signal.abort()
              return 'working'
            },
          }),
          makeJudge: () => async () => ({ state: 'progressing' }),
          signal: signal.signal,
        }),
        { ...input, deb },
      )
      expect(result.status).toBe('stopped')

      const events = store.listEvents(result.runId)
      const derived = deriveTerminalProjection(events)!
      expect(derived).toEqual({ phase: 'faulted', activeAtom: 0 })

      const terminal = statusWrites.at(-1)!
      expect(terminal.oscar).toBe('blocked')
      const canonical = renderDebStatus({ store, runId: result.runId, priority, scopes: {}, phase: derived.phase, activeAtom: derived.activeAtom, activeTask: null, waitCondition: 'derived' }).json
      expect(projectionFields(terminal)).toEqual(projectionFields(canonical))

      const types = events.map((e) => e.type)
      expect(types.lastIndexOf('deb-status')).toBeGreaterThan(types.indexOf('run-end'))
      expect(events.filter((e) => e.type === 'deb-status')).toHaveLength(statusWrites.length)
    })
  })

  test('writes read-only Oscar/Bob terminal snapshots for Deb during an active run', async () => {
    const store = openRunStore(':memory:')
    const terminalSnapshotWrites: DebTerminalSnapshot[] = []
    const noDebSnapshots: DebTerminalSnapshot[] = []

    await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [delegate('do x'), wrapup('done')], terminalSnapshotWrites }),
        sessionHost: fakeSessionHost({
          async readScreen(ref) {
            if (ref.id === 'surface:1') return 'oscar live terminal'
            if (ref.id === 'surface:2') return 'bob live terminal: retrying test command'
            return 'deb observer terminal'
          },
        }),
      }),
      { ...input, deb },
    )

    expect(terminalSnapshotWrites.length).toBeGreaterThan(0)
    expect(terminalSnapshotWrites[0]?.personas.map((p) => p.label)).toEqual(['oscar', 'bob'])
    expect(terminalSnapshotWrites.some((snapshot) => snapshot.personas.some((p) => p.label === 'bob' && p.screen.includes('retrying test command')))).toBe(true)
    expect(store.listEvents(store.listRuns()[0]!.id).some((e) => e.type === 'deb-status' && (e.data as { terminalSnapshot?: string }).terminalSnapshot === 'deb-terminal-snapshot.json')).toBe(true)

    await runRun(baseDeps({ io: fakeIO({ directives: [delegate('do x'), wrapup('done')], terminalSnapshotWrites: noDebSnapshots }) }), input)
    expect(noDebSnapshots).toHaveLength(0)
  })
})
