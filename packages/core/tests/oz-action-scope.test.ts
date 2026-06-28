import { describe, expect, test } from 'vitest'
import { commitScoped, type Git, OZ_ACTION_SCOPE, partitionByScope } from '../src/index.js'

function fakeGit(changed: readonly string[]): { readonly git: Git; readonly commits: Array<{ readonly files: readonly string[]; readonly message: string }> } {
  const commits: Array<{ readonly files: readonly string[]; readonly message: string }> = []
  const git: Git = {
    async isGitRepo() {
      return true
    },
    async initRepo() {},
    async headSha() {
      return 'h0'
    },
    async changedFiles() {
      return [...changed]
    },
    async addAndCommit(_cwd, files, message) {
      commits.push({ files: [...files], message })
      return 'sha-oz-action'
    },
    async restoreToHead() {},
    async show() {
      return ''
    },
    async worktreeAdd() {},
    async worktreeRemove() {},
    async listWorktrees() {
      return []
    },
    async currentBranch() {
      return 'main'
    },
    async resetHard() {},
    async hasUpstream() {
      return false
    },
    async push() {
      return { ok: true, detail: '' }
    },
    async commitsSince() {
      return []
    },
  }
  return { git, commits }
}

describe('OZ_ACTION_SCOPE', () => {
  test('matches only ADR-0040 reversible-edit paths', () => {
    const inLane = [
      'cocoder/priorities/order.json',
      'cocoder/tickets/open/0099-x.md',
      'docs/foo.md',
      'README.md',
      'cocoder/priorities/oz-autonomy.md',
    ]
    const hardExcluded = [
      'packages/daemon/src/launcher.ts',
      '.env',
      'local/runs/run_212/run.json',
      'cocoder/decisions/0040-oz-autonomy.md',
    ]

    expect(partitionByScope([...inLane, ...hardExcluded], OZ_ACTION_SCOPE)).toEqual({
      inScope: inLane,
      outOfScope: hardExcluded,
    })
  })

  test('commits all paths and flags hard exclusions', async () => {
    const inLane = [
      'cocoder/priorities/order.json',
      'cocoder/tickets/open/0099-x.md',
      'docs/foo.md',
      'cocoder/priorities/oz-autonomy.md',
    ]
    const hardExcluded = [
      'packages/daemon/src/launcher.ts',
      '.env',
      'local/runs/run_212/run.json',
    ]
    const { git, commits } = fakeGit([...inLane, ...hardExcluded])

    const receipt = await commitScoped(git, '/repo', OZ_ACTION_SCOPE, 'oz-action')

    expect(receipt).toEqual({
      committed: true,
      committedSha: 'sha-oz-action',
      committedFiles: [...inLane, ...hardExcluded],
      outOfLane: hardExcluded,
      error: null,
    })
    expect(receipt.outOfLane).toEqual(expect.arrayContaining(hardExcluded))
    expect(commits).toEqual([{ files: [...inLane, ...hardExcluded], message: 'oz-action' }])
  })
})
