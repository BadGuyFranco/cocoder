import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type Adapter, type HeadlessRunInput, type Play, type RunnerIO, openRunStore, runRun } from '../src/index.js'
import { baseDeps, block, deb, delegate, fakeIO, fakeSessionHost, input, issue, label, makeTicketWorkspace, okAdapter, renderFounderCloseout, runInputFor, scriptedGit, settledCloseout, validFounderCloseout, wrapPlay, wrapPlayAssignment, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — wrap-up Play', () => {
  test('a single atom then wrap-up still works (one atom, one commit)', async () => {
    const store = openRunStore(':memory:')
    const result = await runRun(baseDeps({ store }), input)
    expect(result.atoms).toBe(1)
    expect(result.committedShas).toHaveLength(1)
    expect(result.status).toBe('completed')
    expect(store.listEvents(result.runId).filter((e) => e.type === 'loop-iteration')).toHaveLength(0)
  })

  test('dispatches the wrap-up Play as a HEADLESS subprocess (no pane), pickup from its output, gate-commits its scope', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const adapterCalls: string[] = []
    const wrapBuilds: { prompt: string; model: string }[] = []
    const headlessCalls: HeadlessRunInput[] = []
    const paneSpawns: string[] = []
    const runsRoot = await mkdtemp(join(tmpdir(), 'runner-wrap-play-'))
    const wrapAdapter: Adapter = {
      id: 'cursor-agent',
      runReadiness: { mechanism: 'launch-flags', flags: [], managesUserConfig: false, detail: 'test adapter' },
      headlessCapable: true,
      build(input) {
        wrapBuilds.push({ prompt: input.prompt, model: input.model })
        return { command: 'cursor-agent', args: ['--prompt', input.prompt], stdoutPath: input.outPath }
      },
      preflight: async () => ({ ok: true, checks: [] }),
      listModels: async () => ({ canEnumerate: false, models: [], detail: 'test adapter' }),
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts'], ['docs/wrap.md', 'packages/not-wrap.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => {
          adapterCalls.push(cli)
          return cli === 'cursor-agent' ? wrapAdapter : okAdapter
        },
        // The headless wrap-up Play must NOT open a cmux pane — it runs as a captured subprocess.
        sessionHost: fakeSessionHost({
          async spawn(opts) {
            paneSpawns.push(opts.command)
            return { id: `surface:${paneSpawns.length}`, driver: 'fake' }
          },
        }),
        runHeadless: async (i) => {
          headlessCalls.push(i)
          return { exitCode: 0, output: validFounderCloseout('PLAY CLOSEOUT') }
        },
      }),
      { ...input, runsRoot, wrapPlay, wrapPlayAssignment },
    )

    expect(adapterCalls).toContain('cursor-agent')
    expect(wrapBuilds).toHaveLength(1)
    expect(wrapBuilds[0]).toMatchObject({ model: 'cheap-wrap' })
    expect(wrapBuilds[0]?.prompt).toContain('# Wrap-up Play')
    expect(wrapBuilds[0]?.prompt).toContain(label('title'))
    expect(wrapBuilds[0]?.prompt).toMatch(/CoCoder run \d+ on priority demo\. 1 atom\(s\) were delegated; commits so far: sha-1\./)
    expect(wrapBuilds[0]?.prompt).toContain('Oscar seed closeout')
    // Ran headless (captured subprocess) carrying the built prompt — and NO cmux pane was spawned for it.
    expect(headlessCalls).toHaveLength(1)
    expect(headlessCalls[0]?.command).toBe('cursor-agent')
    expect(headlessCalls[0]?.args.join('\n')).toContain('# Wrap-up Play')
    expect(headlessCalls[0]?.args.join('\n')).toContain(label('title'))
    expect(paneSpawns).not.toContain('cursor-agent')
    expect(pickupWrites).toEqual([settledCloseout(
      validFounderCloseout('PLAY CLOSEOUT'),
      2,
      'Out-of-lane files committed and flagged for your review (scope is advisory — ADR-0045): packages/not-wrap.ts.',
    )])
    expect(result.committedShas).toEqual(['sha-1', 'sha-2'])
    // Scope advisory: the wrap commit includes the out-of-lane file too; it's flagged.
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'docs/wrap.md', 'packages/not-wrap.ts'])
    expect(result.outOfScope).toEqual(['packages/not-wrap.ts'])
    expect(result.status).toBe('completed')
    expect(store.listCommitLinks(result.runId).map((c) => c.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(new RegExp(`^demo: atom 0 via CoCoder workspace run \\d+ \\(technical id: ${result.runId}\\)$`)),
      expect.stringMatching(new RegExp(`^run-history: ${result.runId} via CoCoder workspace run \\d+ \\(technical id: ${result.runId}\\)$`)),
    ]))
    const links = store.listCommitLinks(result.runId).filter((c) => !c.message.startsWith('run-history: '))
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['docs/wrap.md', 'packages/not-wrap.ts']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect((wrap?.data as { play?: string }).play).toBe('wrap-up')
  })

  test('unadjudicated out-of-lane commits auto-escalate to the founder without a hard wrap failure (WI-B1)', async () => {
    const store = openRunStore(':memory:')
    // atom 0 commits a file off Bob's usual surface (out-of-lane); the wrap gate adds nothing. The closeout
    // is silent on it — neither ratify nor escalate — so the runner must auto-escalate to the founder.
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/stray.md'], []]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout() }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.outOfScope).toEqual(['cocoder/stray.md'])
    // Auto-escalated: the SAME terminal state an escalation reaches, reached WITHOUT a fault and WITHOUT a
    // silent pass.
    expect(result.status).toBe('awaiting-founder')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'out-of-lane-auto-escalated')?.data).toEqual({ files: ['cocoder/stray.md'] })
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({
      disposition: 'awaiting-founder',
      adjudication: 'unadjudicated',
    })
    expect((events.find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('awaiting-founder')
    // No NEW hard-fail wrap path: the wrap was not failed/triaged and no format-invalid fallback was emitted.
    expect(events.find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
    expect(events.find((e) => e.type === 'triage-dispatch')).toBeUndefined()
  })

  test('ratified out-of-lane commits wrap normally with no auto-escalation (WI-B1)', async () => {
    const store = openRunStore(':memory:')
    const ratifiedCloseout = renderFounderCloseout({
      judgment: 'The audit landed outside its nominal lane but is correct: it naturally belongs in the governance tree.',
    })
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/stray.md'], []]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ratifiedCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.outOfScope).toEqual(['cocoder/stray.md'])
    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'out-of-lane-auto-escalated')).toBeUndefined()
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({ disposition: 'continue', adjudication: 'ratified' })
  })

  test('wrap-up Play output is repaired once before pickup delivery', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const repaired = validFounderCloseout('REPAIRED PLAY CLOSEOUT')
    const outputs = [
      'PLAY CLOSEOUT\n',
      `Documentation is already committed for this run; the only repair needed is the founder closeout format.\n\n${repaired}\n---\n\nDocumentation updated within wrap-up write scope.`,
    ]
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: outputs.shift() ?? '' }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([settledCloseout(repaired)])
    const events = store.listEvents(result.runId)
    const repair = events.find((e) => e.type === 'wrapup-format-repair-attempt')
    expect(repair?.data).toMatchObject({ play: 'wrap-up', issues: expect.arrayContaining([`missing ${label('title')}`]), outPath: expect.stringContaining('wrapup-out.txt') })
    expect(events.find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
    expect(events.find((e) => e.type === 'triage-dispatch')).toBeUndefined()
  })

  test('archive-ready first-directive wrap records archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar found no build atoms to delegate and verified this with `node scripts/proof-launch-disposition.mjs`.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([[]]),
        io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 0,
      signal: 'node scripts/proof-launch-disposition.mjs',
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('archive-ready priority wrap with a bound open ticket records awaiting-founder disposition and no archive action', async () => {
    const store = openRunStore(':memory:')
    const ticketWorkspace = await makeTicketWorkspace()
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Ticket `0003` is still open and bound to this priority.',
      nextStep: 'Priority: `demo` — close or release the remaining handled ticket',
      judgment: 'Oscar incorrectly called archive-ready while an open handled ticket remains.',
    })

    try {
      const result = await runRun(
        baseDeps({
          store,
          git: scriptedGit([[]]),
          io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
          getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
          runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
        }),
        { ...runInputFor(ticketWorkspace.root), wrapPlay, wrapPlayAssignment },
      )

      expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
        disposition: 'awaiting-founder',
        buildAtoms: 0,
        signal: null,
      })
      expect(result.status).toBe('awaiting-founder')
    } finally {
      await rm(ticketWorkspace.root, { recursive: true, force: true })
    }
  })

  test('archive-ready first-directive wrap without a runnable signal still records archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const bareArchiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar found no build atoms to delegate and the priority is ready to archive.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([[]]),
        io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: bareArchiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(0)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 0,
      signal: null,
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('target-prefixed archive-ready Run Status normalizes to archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const prefixedArchiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Priority-launched run: archive ready.',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar found no build atoms to delegate and the priority is ready to archive.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([[]]),
        io: fakeIO({ directives: [wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: prefixedArchiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 0,
      signal: null,
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('ticket wrap records ask when delivered Run Status line includes the section label', async () => {
    const store = openRunStore(':memory:')
    const ticketCloseout = renderFounderCloseout({
      runStatus: 'Run Status: needs closing',
      decisionNeeded: 'Yes — close ticket `0015` after the founder confirms this fix is complete.',
      nextStep: 'Ticket: `0015` — confirm the ticket close',
      judgment: 'Oscar stopped because the ticket is ready for founder-confirmed close.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ticketCloseout }),
      }),
      { ...input, ticketId: '0015', target: { type: 'ticket', slug: '0015' }, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(result.ticketCloseDecision).toBe('ask')
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'awaiting-founder',
      buildAtoms: 1,
      signal: null,
      ticketCloseDecision: 'ask',
    })
  })

  test('archive-ready wrap with a founder decision records awaiting-founder disposition and no action', async () => {
    const store = openRunStore(':memory:')
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'awaiting-founder',
      buildAtoms: 1,
      signal: null,
    })
  })

  test('archive-ready wrap after a builder dispatch records archive-confirmation disposition and action', async () => {
    const store = openRunStore(':memory:')
    const archiveReadyCloseout = renderFounderCloseout({
      runStatus: 'Archive ready',
      whatRemains: '- Nothing remains for this priority.',
      nextStep: 'Ticket: `0015` — archive the completed priority record',
      judgment: 'Oscar completed a delegated build atom, so the runner cannot treat this as an archive candidate.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')] }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: archiveReadyCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(store.listEvents(result.runId).filter((e) => e.type === 'builder-dispatch')).toHaveLength(1)
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({
      disposition: 'archive-confirmation',
      buildAtoms: 1,
      signal: null,
      action: {
        type: 'archive-priority-confirmation',
        workspaceId: 'cocoder',
        runId: result.runId,
        priorityId: 'demo',
        method: 'POST',
        endpoint: `/runs/${result.runId}/archive-confirmation`,
        confirmWith: 'archive',
      },
    })
    expect(result.status).toBe('awaiting-archive-confirmation')
  })

  test('validated wrap-up with a founder decision leaves the run awaiting-founder', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'continue',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.getRun(result.runId)?.status).toBe('awaiting-founder')
    expect(pickupWrites).toEqual([settledCloseout(founderGateCloseout)])
    expect((store.listEvents(result.runId).find((e) => e.type === 'landing-outcome')?.data as { status?: string }).status).toBe('awaiting-founder')
    expect((store.listEvents(result.runId).find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('awaiting-founder')
  })

  test('post-wrap awaiting-founder closeout returns without entering a directive-timeout wait', async () => {
    const store = openRunStore(':memory:')
    const runsRoot = await mkdtemp(join(tmpdir(), 'cocoder-post-wrap-founder-wait-'))
    const runDir = join(runsRoot, 'cocoder', 'run_1')
    const pickupWrites: string[] = []
    const awaitedPaths: string[] = []
    const founderGateCloseout = renderFounderCloseout({
      runStatus: 'continue',
      decisionNeeded: 'Choose the external repo for the live onboarding proof. Recommendation: use the CoBuilder copy.',
      nextStep: 'Priority: `demo` — founder chooses the live-proof target repo',
      judgment: 'Oscar stopped because the next step is founder-gated and cannot be delegated as a build atom.',
    })
    const directives = [delegate('atom 0'), wrapup('Oscar seed closeout')]
    let directiveIndex = 0
    const io: RunnerIO = {
      ...fakeIO({ directives: [], pickupWrites }),
      async awaitDirective(path) {
        awaitedPaths.push(path)
        const directive = directives[directiveIndex++]
        if (!directive) throw new Error(`post-wrap founder wait should not poll another directive: ${path}`)
        return directive
      },
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io,
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: founderGateCloseout }),
        timeouts: { orchestrationMs: 1, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      }),
      { ...input, runsRoot, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('awaiting-founder')
    expect(store.getRun(result.runId)?.status).toBe('awaiting-founder')
    expect(awaitedPaths).toEqual([join(runDir, 'directive-0.json'), join(runDir, 'directive-1.json')])
    expect(pickupWrites).toEqual([settledCloseout(founderGateCloseout)])
    const events = store.listEvents(result.runId)
    expect(events.find((e) => e.type === 'run-end')?.data).toMatchObject({ status: 'awaiting-founder' })
    expect(events.find((e) => e.type === 'landing-outcome')?.data).toMatchObject({ status: 'awaiting-founder' })
    expect(events.find((e) => e.type === 'wrap-disposition')?.data).toMatchObject({ disposition: 'awaiting-founder' })
    expect(events.some((e) => e.type === 'directive-timeout')).toBe(false)
    expect(events.some((e) => e.type === 'triage-dispatch')).toBe(false)
    expect(events.some((e) => e.type === 'fault-triaged')).toBe(false)
  })

  test('wrap-up Play output validation is disabled when no outputValidator is declared', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const unvalidatedWrapPlay: Play = {
      id: wrapPlay.id,
      label: wrapPlay.label,
      kind: wrapPlay.kind,
      writeScope: wrapPlay.writeScope,
      body: wrapPlay.body,
    }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
      }),
      { ...input, wrapPlay: unvalidatedWrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual(['PLAY CLOSEOUT\n'])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('malformed wrap-up output falls back honestly and is dispatched to Deb when retry also fails', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({
          directives: [delegate('atom 0'), wrapup('Oscar seed closeout')],
          pickupWrites,
          triage: { disposition: 'cocoder-bug', summary: 'wrap-up Play emitted a malformed founder closeout', proposal: 'tighten the closeout owner' },
        }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: 'PLAY CLOSEOUT\n' }),
      }),
      { ...input, deb, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).not.toContain(block('decisionNeeded', 'None.'))
    expect(pickupWrites[0]).toContain('The orchestrator must repair and re-issue a conforming wrap-up.')
    const events = store.listEvents(result.runId)
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['wrapup-format-repair-attempt', 'wrapup-format-invalid', 'triage-dispatch', 'fault-triaged', 'wrapup', 'run-end']))
    expect(events.find((e) => e.type === 'wrapup-format-invalid')?.data).toMatchObject({ outPath: expect.stringContaining('wrapup-out-retry.txt') })
    expect(events.find((e) => e.type === 'triage-dispatch')?.data).toMatchObject({ fault: 'wrapup-format-invalid', atom: 1 })
    expect(events.find((e) => e.type === 'fault-triaged')?.data).toMatchObject({ fault: 'wrapup-format-invalid', disposition: 'cocoder-bug' })
    expect((events.find((e) => e.type === 'run-end')?.data as { status?: string }).status).toBe('failed')
  })

  test('wrap-up Play label changes are enforced from the Play contract', async () => {
    const renamedDecisionLabel = '**Founder Decision Required**'
    const renamedPlay: Play = {
      ...wrapPlay,
      body: wrapPlay.body.replace(label('decisionNeeded'), renamedDecisionLabel),
    }

    const staleStore = openRunStore(':memory:')
    const stalePickupWrites: string[] = []
    const staleResult = await runRun(
      baseDeps({
        store: staleStore,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites: stalePickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: validFounderCloseout('PLAY CLOSEOUT') }),
      }),
      { ...input, wrapPlay: renamedPlay, wrapPlayAssignment },
    )

    expect(staleResult.status).toBe('failed')
    expect(stalePickupWrites).toHaveLength(1)
    expect(stalePickupWrites[0]).toContain(`missing ${renamedDecisionLabel}`)
    const staleInvalid = staleStore.listEvents(staleResult.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(staleInvalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([`missing ${renamedDecisionLabel}`]),
    })

    const updatedCloseout = validFounderCloseout('PLAY CLOSEOUT').replace(block('decisionNeeded', 'None.'), `${renamedDecisionLabel}\nNone.`)
    const updatedStore = openRunStore(':memory:')
    const updatedPickupWrites: string[] = []
    const updatedResult = await runRun(
      baseDeps({
        store: updatedStore,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites: updatedPickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: updatedCloseout }),
      }),
      { ...input, wrapPlay: renamedPlay, wrapPlayAssignment },
    )

    expect(updatedPickupWrites).toEqual([settledCloseout(updatedCloseout)])
    expect(updatedStore.listEvents(updatedResult.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play rejects ledger-shaped founder briefs even with the right headings', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const ledgerCloseout = renderFounderCloseout({
      runStatus: 'archive ready',
      summary:
        'Atom 0 (8449d5e) aligned read consumers and Atom 1 (c11d90a) proved concurrency; core 370/370, daemon 215/215, UI 126/126, and typecheck are all green, with the exact run ledger and implementation inventory included here even though the founder asked for a decision brief.',
      whatRemains: ['- Founder confirms the visual split.', '- Optional: run a migration command before archive.'].join('\n'),
      nextStep: 'Confirm the UI and/or optionally run the migration command.',
      judgment: 'Oscar stopped because the priority is code-complete.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ledgerCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'contains ledger/test-matrix detail'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'includes optional work'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'must not offer optional or multi-choice actions'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([
        issue('whatChanged', 'contains ledger/test-matrix detail'),
        issue('whatRemains', 'includes optional work instead of required gaps'),
        issue('nextStep', 'must not offer optional or multi-choice actions'),
      ]),
    })
  })

  test('wrap-up Play rejects priority-ledger briefs that point back to a bare priority', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const priorityLedgerCloseout = renderFounderCloseout({
      runStatus: 'continue\nRebuild is roughly 60% done; the hard trust invariant and scaffold seeding still need wiring before onboard-existing can run safely.',
      summary:
        'The existing-repo onboarding rebuild retired the standalone executor and loader discovery surface, and authored `onboard-existing` as an ordinary Oscar-driven priority. ADR-0020 section 7 now records scaffold-seeded onboarding priorities.',
      whatRemains: [
        '- **Trust invariant (A3a):** wire the cocoder-only refuse-boundary',
        '- **Scaffold seeding (A3b):** conditionally seed onboard-existing for existing repos',
        '- **Proof harness (A4):** replace the retired executor proof script',
        '- **Live external-repo onboarding proof:** founder must authorize the billable run',
        '- **Dogfood Drift Audit:** needs its own seeded priority',
      ].join('\n'),
      nextStep: 'Priority: `demo`',
      judgment:
        'Stopped after five green atoms because the executor-to-priority pivot is structurally complete, but A3a is a delicate atom that deserves a fresh session.',
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: priorityLedgerCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'is too long for a founder brief'))
    expect(pickupWrites[0]).toContain(issue('whatChanged', 'must be one sentence'))
    expect(pickupWrites[0]).toContain(issue('runStatus', 'must not estimate percentage complete'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'has too many bullets'))
    expect(pickupWrites[0]).toContain(issue('whatRemains', 'contains atom/implementation labels'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'must name the concrete focus after the priority slug'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([
        issue('whatChanged', 'is too long for a founder brief'),
        issue('whatChanged', 'must be one sentence'),
        issue('runStatus', 'must not estimate percentage complete'),
        issue('whatRemains', 'has too many bullets'),
        issue('whatRemains', 'contains atom/implementation labels'),
        issue('nextStep', 'must name the concrete focus after the priority slug'),
      ]),
    })
  })

  test('wrap-up Play accepts an open ticket as the ready-to-run next item', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const ticketCloseout = validFounderCloseout().replace('Priority: `demo` — continue the remaining priority atoms', 'Ticket: `0015` — repair the listed orchestration bug')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: ticketCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([settledCloseout(ticketCloseout)])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play permits founder-facing numerals in What Remains', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const numericGapCloseout = renderFounderCloseout({
      whatRemains: [
        '- Ticket 0015 needs a follow-up launch proof.',
        '- The Oz compact setting still needs the default 3-run smoke.',
      ].join('\n'),
    })

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: numericGapCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('completed')
    expect(pickupWrites).toEqual([settledCloseout(numericGapCloseout)])
    expect(store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')).toBeUndefined()
  })

  test('wrap-up Play blocks a Recommended Next Step priority that is not launchable', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const missingPriorityCloseout = validFounderCloseout().replace('Priority: `demo`', 'Priority: `missing-priority`')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/atom.ts']]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('Oscar seed closeout')], pickupWrites }),
        getAdapter: (cli) => (cli === 'cursor-agent' ? { ...okAdapter, id: 'cursor-agent', headlessCapable: true } : okAdapter),
        runHeadless: async () => ({ exitCode: 0, output: missingPriorityCloseout }),
      }),
      { ...input, wrapPlay, wrapPlayAssignment },
    )

    expect(result.status).toBe('failed')
    expect(pickupWrites).toHaveLength(1)
    expect(pickupWrites[0]).toContain(block('runStatus', 'blocked'))
    expect(pickupWrites[0]).toContain(issue('nextStep', 'priority "missing-priority" is not launchable'))
    const invalid = store.listEvents(result.runId).find((e) => e.type === 'wrapup-format-invalid')
    expect(invalid?.data).toMatchObject({
      play: 'wrap-up',
      issues: expect.arrayContaining([issue('nextStep', 'priority "missing-priority" is not launchable')]),
    })
  })
})
