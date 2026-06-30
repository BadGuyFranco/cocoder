import { describe, expect, test } from 'vitest'
import { type Git, openRunStore, runRun } from '../src/index.js'
import { baseDeps, delegate, fakeIO, fakeSessionHost, input, okAdapter, oscar, recordingScriptedGit, scriptedGit, wrapup, worktreeStubs } from './runner.test-support.js'

describe('runRun (multi-atom loop) — wrap delivery', () => {
  test('falls back to Oscar pickup without dispatching a Play when no wrap Play is configured', async () => {
    const store = openRunStore(':memory:')
    const pickupWrites: string[] = []
    const adapterCalls: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [wrapup('Oscar hand-authored pickup')], pickupWrites }),
        getAdapter: (cli) => {
          adapterCalls.push(cli)
          return okAdapter
        },
      }),
      input,
    )

    expect(result.atoms).toBe(0)
    expect(result.committedShas).toEqual([])
    expect(pickupWrites).toEqual(['Oscar hand-authored pickup'])
    expect(adapterCalls).not.toContain('cursor-agent')
    expect(store.listCommitLinks(result.runId)).toHaveLength(1)
    expect(store.listCommitLinks(result.runId)[0]).toMatchObject({ commitSha: 'sha-0', workItemId: null })
    const wrap = store.listEvents(result.runId).find((e) => e.type === 'wrapup')
    expect(wrap?.data).toEqual({ atoms: 0, forced: false })
  })

  test('visible Oscar wrap is delivered after landing outcome as the final short artifact pointer', async () => {
    const store = openRunStore(':memory:')
    const artifactWrites: Array<{ runDir: string; fileName: string; contents: string }> = []
    const sends: string[] = []

    const result = await runRun(
      baseDeps({
        store,
        io: fakeIO({ directives: [wrapup('Founder closeout\nwith detail')], artifactWrites }),
        sessionHost: fakeSessionHost({
          async sendInput(_ref, text) {
            sends.push(text)
          },
        }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(sends).toEqual(['WRAP-UP READY: read /runs/cocoder/run_1/wrapup-delivery.md and follow it now.'])
    expect(sends.every((text) => !text.includes('\n'))).toBe(true)
    expect(artifactWrites.map((w) => w.fileName)).toEqual(['landing-outcome-delivery.md', 'wrapup-delivery.md'])
    expect(artifactWrites[0]?.contents).toContain('LANDING OUTCOME for run_1')
    expect(artifactWrites[1]?.contents).toMatch(/WRAP-UP READY for CoCoder run \d+\./)
    expect(artifactWrites[1]?.contents).toContain('Preserve the closeout headings, order, and final')
    expect(artifactWrites[1]?.contents).toContain('do not summarize, reformat, or paraphrase the closeout brief')
    expect(artifactWrites[1]?.contents).not.toContain('Deliver this founder-facing wrap-up now, in plain English')
    expect(artifactWrites[1]?.contents).toContain('**Landing Outcome**')
    expect(artifactWrites[1]?.contents).toContain('Uncommitted — no source changes were committed on `trunk`')
    expect(artifactWrites[1]?.contents).toContain('Founder closeout\nwith detail')
    const delivery = store.listEvents(result.runId).find((e) => e.type === 'wrapup-delivery-dispatch')
    expect(delivery?.data).toMatchObject({ ref: 'surface:1', path: '/runs/cocoder/run_1/wrapup-delivery.md' })
  })

  test('gate-commits Oscar support files at wrap with no cleanup pass', async () => {
    const store = openRunStore(':memory:')
    const oscarWithSupport = { ...oscar, writeScope: ['cocoder/priorities/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([
          ['packages/atom.ts'],
          ['cocoder/priorities/full-oz-dashboard.md'],
        ]),
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
      }),
      { ...input, oscar: oscarWithSupport },
    )

    expect(result.status).toBe('completed')
    expect(result.committedShas).toEqual(['sha-1', 'sha-2'])
    expect(result.committedFiles).toEqual(['packages/atom.ts', 'cocoder/priorities/full-oz-dashboard.md'])
    expect(result.outOfScope).toEqual([])

    const links = store.listCommitLinks(result.runId).filter((c) => !c.message.startsWith('run-history: '))
    expect(links.map((c) => c.files)).toEqual([['packages/atom.ts'], ['cocoder/priorities/full-oz-dashboard.md']])
    expect(links.map((c) => c.workItemId)).toEqual([store.listWorkItems(result.runId)[0]?.id, null])

    expect(store.listEvents(result.runId).map((e) => e.type)).toContain('oscar-support-commit')
  })

  test('per-atom commit attribution includes committed out-of-lane files for visibility', async () => {
    const store = openRunStore(':memory:')
    // Both atoms leave docs/leak.md dirty out of lane; atom commits land the whole changed set and surface
    // the leak through out-of-lane events.
    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([
          ['packages/a.ts', 'docs/leak.md'],
          ['packages/b.ts', 'docs/leak.md'],
        ]),
        io: fakeIO({ directives: [delegate('atom 0'), delegate('atom 1'), wrapup('done')] }),
      }),
      input,
    )
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([
      ['packages/a.ts', 'docs/leak.md'],
      ['packages/b.ts', 'docs/leak.md'],
    ])
    expect(result.outOfScope).toEqual(['docs/leak.md']) // flagged once (unioned)
    expect(store.listEvents(result.runId).filter((event) => event.type === 'out-of-scope-committed')).toHaveLength(2)
    expect(result.status).toBe('completed')
  })

  test('atom commit lands and flags concurrent governance ticket edits in the whole changed set', async () => {
    const store = openRunStore(':memory:')
    const { git, commits } = recordingScriptedGit([['packages/atom.ts', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/open/0060-bug.md']])

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('atom 0'), wrapup('done')] }),
      }),
      input,
    )

    expect(result.status).toBe('completed')
    expect(commits[0]).toEqual(['packages/atom.ts', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/open/0060-bug.md'])
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([['packages/atom.ts', 'cocoder/tickets/INDEX.md', 'cocoder/tickets/open/0060-bug.md']])
    expect(result.outOfScope).toEqual(['cocoder/tickets/INDEX.md', 'cocoder/tickets/open/0060-bug.md'])
    expect(store.listEvents(result.runId).find((event) => event.type === 'out-of-scope-committed')?.data).toEqual({
      files: ['cocoder/tickets/INDEX.md', 'cocoder/tickets/open/0060-bug.md'],
    })
  })

  test('atom isolation: a rejected atom\'s in-scope changes are quarantined, not committed by a later atom', async () => {
    const store = openRunStore(':memory:')
    const restored: string[][] = []
    let call = 0
    const changedPerCall = [[], ['packages/bad.ts'], ['packages/good.ts']] // [run-start clean], atom0 rejected (quarantined), atom1's work
    const git: Git = {
      ...worktreeStubs,
      async headSha() {
        return 'h0'
      },
      async changedFiles() {
        return changedPerCall[call++] ?? []
      },
      async addAndCommit() {
        return `sha-${call}`
      },
      async restoreToHead(_cwd, files) {
        restored.push([...files])
      },
      async show() {
        return ''
      },
    }
    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('thin'), delegate('good'), wrapup('done')],
          verdicts: [{ verdict: 'fail', reason: 'thin' }, { verdict: 'pass', reason: 'good' }],
        }),
      }),
      input,
    )
    expect(restored).toEqual([['packages/bad.ts']]) // the rejected atom's in-scope work was discarded
    expect(store.listCommitLinks(result.runId).filter((c) => c.workItemId !== null).map((c) => c.files)).toEqual([['packages/good.ts']]) // only the passing atom committed
    const quarantine = store.listEvents(result.runId).find((e) => e.type === 'atom-quarantined')!
    expect(quarantine.data).toEqual({
      atom: 0,
      files: ['packages/bad.ts'],
      quarantineDir: '/runs/cocoder/run_1/quarantine/atom-0',
      recovery: { tracked: 'HEAD', untracked: '/runs/cocoder/run_1/quarantine/atom-0' },
    })
  })

  test('a rejected atom commits nothing, then Oscar can delegate the next atom', async () => {
    const store = openRunStore(':memory:')
    const committed: string[] = []
    const git: Git = { ...scriptedGit([['packages/a.ts'], ['packages/b.ts']]), async addAndCommit() {
      committed.push('x')
      return `sha-${committed.length}`
    } }
    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({
          directives: [delegate('thin atom'), delegate('good atom'), wrapup('done')],
          verdicts: [{ verdict: 'fail', reason: 'too thin' }, { verdict: 'pass', reason: 'good' }],
        }),
      }),
      input,
    )
    expect(result.committedShas).toHaveLength(1) // only the passing atom is included in the run result
    expect(result.atoms).toBe(2)
    const types = store.listEvents(result.runId).map((e) => e.type)
    expect(types).toContain('verify-rejected')
    const wis = store.listWorkItems(result.runId)
    expect(wis.map((w) => w.status)).toEqual(['abandoned', 'done'])
  })
})
