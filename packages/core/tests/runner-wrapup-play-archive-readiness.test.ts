import { rm } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, input, makeTicketWorkspace, okAdapter, renderFounderCloseout, runInputFor, wrapPlay, wrapPlayAssignment, wrapup, scriptedGit } from './runner.test-support.js'

describe('runRun (multi-atom loop) — wrap-up Play', () => {
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

})
