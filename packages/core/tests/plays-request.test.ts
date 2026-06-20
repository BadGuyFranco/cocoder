import { describe, expect, test } from 'vitest'
import {
  commitScoped,
  COCODER_GOVERNANCE_AUTHOR,
  type Git,
  MalformedPlayRequestError,
  parsePlayRequest,
  runCommitGate,
  validatePlayRequest,
  openRunStore,
  type Play,
} from '../src/index.js'

const play = (overrides: Partial<Play> = {}): Play => ({
  id: 'create-ticket',
  label: 'Create ticket',
  kind: 'headless',
  executionModel: 'prompt-only',
  triggerClass: 'persona-requested',
  purpose: 'Create one open ticket.',
  allowedCallers: ['bob'],
  writeScope: ['cocoder/tickets/**'],
  body: 'Create the ticket.',
  ...overrides,
})

function fakeGit(changed: readonly string[]): { readonly git: Git; readonly commits: readonly { readonly files: readonly string[]; readonly message: string }[] } {
  const commits: { files: string[]; message: string }[] = []
  let head = 'h0'
  const noop = async (): Promise<void> => {}
  const git: Git = {
    headSha: async () => head,
    changedFiles: async () => [...changed],
    async addAndCommit(_cwd, files, message) {
      commits.push({ files: [...files], message })
      head = `sha-${commits.length}`
      return head
    },
    restoreToHead: noop,
    show: async () => '',
    worktreeAdd: noop,
    worktreeRemove: noop,
    listWorktrees: async () => [],
    isAncestor: async () => true,
    mergeFastForwardOnly: async () => head,
    unmergedCommits: async () => [],
    mergeInto: async () => 'clean',
    conflictedFiles: async () => [],
    completeMerge: async () => head,
    abortMerge: noop,
    currentBranch: async () => 'main',
    resetHard: noop,
    hasUpstream: async () => false,
    push: async () => ({ ok: true, detail: '' }),
  }
  return { git, commits }
}

describe('Play request lane', () => {
  test('parses a structured Play request with input', () => {
    expect(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket', input: { title: 'Bug' } }))).toEqual({
      kind: 'play',
      play: 'create-ticket',
      input: { title: 'Bug' },
    })
  })

  test.each([
    ['bad kind', { kind: 'delegate', play: 'create-ticket' }, /"kind" must be "play"/],
    ['missing play id', { kind: 'play' }, /"play" must be a non-empty string/],
    ['blank play id', { kind: 'play', play: ' ' }, /"play" must be a non-empty string/],
  ])('rejects malformed Play requests: %s', (_name, payload, message) => {
    expect(() => parsePlayRequest(JSON.stringify(payload))).toThrow(MalformedPlayRequestError)
    expect(() => parsePlayRequest(JSON.stringify(payload))).toThrow(message)
  })

  test('accepts an authorized optional Play request and carries the dispatch writeScope', () => {
    const result = validatePlayRequest(
      parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket', input: { title: 'Bug' } })),
      { caller: 'bob', plays: [play()] },
    )

    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.reason)
    expect(result.play.id).toBe('create-ticket')
    expect(result.input).toEqual({ title: 'Bug' })
    expect(result.writeScope).toEqual(['cocoder/tickets/**'])
  })

  test('accepted Play request writeScope is the commit boundary used for changed files', async () => {
    const accepted = validatePlayRequest(
      parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket', input: { title: 'Bug' } })),
      { caller: 'bob', plays: [play()] },
    )
    expect(accepted.accepted).toBe(true)
    if (!accepted.accepted) throw new Error(accepted.reason)

    const ordinary = fakeGit(['cocoder/tickets/open/0024-bug.md', 'packages/core/src/leak.ts'])
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: '/repo', name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'ticket-authoring' })

    const ordinaryReceipt = await runCommitGate({
      git: ordinary.git,
      store,
      cwd: '/repo',
      runId: run.id,
      workItemId: null,
      scope: accepted.writeScope,
      message: 'play: create ticket',
      headBefore: 'h0',
    })

    expect(ordinaryReceipt.committedFiles).toEqual(['cocoder/tickets/open/0024-bug.md', 'packages/core/src/leak.ts'])
    expect(ordinaryReceipt.outOfScope).toEqual(['packages/core/src/leak.ts'])
    expect(store.listEvents(run.id).some((event) => event.type === 'out-of-scope-committed')).toBe(true)

    const scoped = fakeGit(['cocoder/tickets/open/0024-bug.md', 'packages/core/src/leak.ts'])
    const scopedReceipt = await commitScoped(
      scoped.git,
      '/repo',
      accepted.writeScope,
      'play: create ticket',
      COCODER_GOVERNANCE_AUTHOR,
      { commitOnlyScope: true },
    )

    expect(scopedReceipt).toMatchObject({
      committed: true,
      committedFiles: ['cocoder/tickets/open/0024-bug.md'],
      outOfLane: ['packages/core/src/leak.ts'],
      error: null,
    })
    expect(scoped.commits).toEqual([{ files: ['cocoder/tickets/open/0024-bug.md'], message: 'play: create ticket' }])
  })

  test('rejects an unknown Play', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'missing' })), {
      caller: 'bob',
      plays: [play()],
    })

    expect(result).toEqual({ accepted: false, code: 'unknown-play', reason: 'unknown Play "missing"' })
  })

  test('rejects an unauthorized caller', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket' })), {
      caller: 'oscar',
      plays: [play()],
    })

    expect(result).toEqual({
      accepted: false,
      code: 'unauthorized-caller',
      reason: 'caller "oscar" is not authorized for Play "create-ticket"',
    })
  })

  test('rejects persona requests for mandatory lifecycle-triggered Plays', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'wrap-up' })), {
      caller: 'oscar',
      plays: [
        play({
          id: 'wrap-up',
          triggerClass: 'lifecycle-triggered',
          allowedCallers: ['oscar'],
        }),
      ],
    })

    expect(result).toEqual({
      accepted: false,
      code: 'mandatory-play',
      reason: 'Play "wrap-up" is mandatory and must be triggered by the runner or daemon',
    })
  })

  test('rejects missing input when the Play declares an input schema', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket' })), {
      caller: 'bob',
      plays: [play({ inputSchema: { ref: 'schemas/create-ticket.input' } })],
    })

    expect(result).toEqual({
      accepted: false,
      code: 'missing-input',
      reason: 'Play "create-ticket" requires input for schema "schemas/create-ticket.input"',
    })
  })
})
