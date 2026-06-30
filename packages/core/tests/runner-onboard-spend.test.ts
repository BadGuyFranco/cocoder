import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { AuditWriteBoundaryError, openRunStore, runRun } from '../src/index.js'
import { baseDeps, bob, delegate, fakeIO, input, priority, recordingScriptedGit, scriptedGit, wrapup } from './runner.test-support.js'

describe('runRun (multi-atom loop) — onboard spend', () => {
  test('onboard-existing audit recon writes are in-scope while product writes are still hard-refused', async () => {
    const store = openRunStore(':memory:')
    const { git, commits } = recordingScriptedGit([['cocoder/audit/recon.md']])
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('write recon'), wrapup('done')] }),
      }),
      { ...input, priority: onboardingPriority },
    )

    expect(result.status).toBe('completed')
    expect(commits).toContainEqual(['cocoder/audit/recon.md'])
    expect(store.listEvents(result.runId).some((event) => event.type === 'out-of-scope-committed')).toBe(false)
  })

  test('refuses onboard-existing product-code writes before the ordinary atom gate commits', async () => {
    const store = openRunStore(':memory:')
    const { git, commits } = recordingScriptedGit([['packages/core/src/foo.ts']])
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    await expect(runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('audit the repo'), wrapup('done')] }),
      }),
      { ...input, priority: onboardingPriority },
    )).rejects.toBeInstanceOf(AuditWriteBoundaryError)

    const runId = store.listRuns()[0]?.id
    expect(runId).toBeDefined()
    expect(commits).toEqual([])
    expect(store.listCommitLinks(runId!)).toEqual([])
    const event = store.listEvents(runId!).find((item) => item.type === 'audit-write-boundary-refused')
    expect(event?.data).toMatchObject({ label: 'onboard-existing', files: ['packages/core/src/foo.ts'] })
  })

  test('onboard-existing blocks expensive reads after recon until spend approval is recorded', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-onboarding-spend-block-'))
    await mkdir(join(targetRoot, 'cocoder', 'audit'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'recon.md'), '# Recon\n')
    const store = openRunStore(':memory:')
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/audit/deep-read.md']]),
        io: fakeIO({ directives: [delegate('deep read after recon'), wrapup('pause for founder approval')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, priority: onboardingPriority, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(false)
    expect(events.find((event) => event.type === 'onboarding-spend-approval-required')?.data).toMatchObject({
      atom: 0,
      message: 'recon complete; spend approval required before expensive read — record approval at cocoder/audit/spend-approval.json',
      reconPath: 'cocoder/audit/recon.md',
      approvalPath: 'cocoder/audit/spend-approval.json',
    })
  })

  test('onboard-existing proceeds after a valid spend approval checkpoint', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-onboarding-spend-open-'))
    await mkdir(join(targetRoot, 'cocoder', 'audit'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'recon.md'), '# Recon\n')
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'spend-approval.json'), JSON.stringify({ approved: true }))
    const store = openRunStore(':memory:')
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/audit/deep-read.md']]),
        io: fakeIO({ directives: [delegate('deep read after approval'), wrapup('done')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, priority: onboardingPriority, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(events.some((event) => event.type === 'onboarding-spend-approval-required')).toBe(false)
  })

  test('onboard-existing recon retries are not blocked before recon exists', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-onboarding-retry-open-'))
    await mkdir(join(targetRoot, 'cocoder'), { recursive: true })
    const store = openRunStore(':memory:')
    const onboardingPriority = { ...priority, id: 'onboard-existing', scopeNarrowing: ['cocoder/**'], auditWriteBoundary: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['cocoder/audit/recon.md']]),
        io: fakeIO({ directives: [delegate('retry recon'), wrapup('done')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, priority: onboardingPriority, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(events.some((event) => event.type === 'onboarding-spend-approval-required')).toBe(false)
  })

  test('non-onboarding priorities do not run the spend gate', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'cocoder-non-onboarding-open-'))
    await mkdir(join(targetRoot, 'cocoder', 'audit'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'audit', 'recon.md'), '# Recon\n')
    const store = openRunStore(':memory:')

    const result = await runRun(
      baseDeps({
        store,
        git: scriptedGit([['packages/deep-read.ts']]),
        io: fakeIO({ directives: [delegate('ordinary deep read'), wrapup('done')] }),
      }),
      { ...input, workspace: { id: 'target', path: targetRoot, name: 'Target' }, engineHome: targetRoot },
    )

    expect(result.status).toBe('completed')
    const events = store.listEvents(result.runId)
    expect(events.some((event) => event.type === 'builder-dispatch')).toBe(true)
    expect(events.some((event) => event.type === 'onboarding-spend-approval-required')).toBe(false)
  })

  test('ordinary priorities commit out-of-lane atom files without tripping the audit boundary', async () => {
    const store = openRunStore(':memory:')
    const { git, commits } = recordingScriptedGit([['packages/core/src/foo.ts']])
    const governanceBob = { ...bob, writeScope: ['cocoder/**'] }

    const result = await runRun(
      baseDeps({
        store,
        git,
        io: fakeIO({ directives: [delegate('ordinary work'), wrapup('done')] }),
      }),
      { ...input, bob: governanceBob },
    )

    expect(result.status).toBe('completed')
    expect(store.getRun(result.runId)?.status).toBe('completed')
    expect(commits[0]).toContain('packages/core/src/foo.ts')
    expect(store.listCommitLinks(result.runId).filter((link) => link.workItemId !== null).map((link) => link.files)).toEqual([['packages/core/src/foo.ts']])
    expect(result.committedFiles).toEqual(['packages/core/src/foo.ts'])
    expect(result.outOfScope).toEqual(['packages/core/src/foo.ts'])
    expect(store.listEvents(result.runId).some((item) => item.type === 'out-of-scope-committed')).toBe(true)
    expect(store.listEvents(result.runId).some((item) => item.type === 'audit-write-boundary-refused')).toBe(false)
  })
})
