import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { commitOscarSupportEdits, openRunStore, type Git } from '../src/index.js'

interface CommitCall {
  readonly cwd: string
  readonly files: readonly string[]
  readonly message: string
}

function fakeGit(changed: readonly string[], commits: CommitCall[]): Git {
  const git: Partial<Git> = {
    async headSha() { return 'head-before' },
    async changedFiles() { return [...changed] },
    async addAndCommit(cwd, files, message) {
      commits.push({ cwd, files: [...files], message })
      return 'sha-support'
    },
  }
  return git as Git
}

async function repoWithOscarScope(scope: readonly string[]): Promise<{ readonly repo: string; readonly personasDir: string; readonly baseDir: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'cocoder-core-support-'))
  const personasDir = join(repo, 'cocoder', 'personas')
  const baseDir = join(repo, 'base-personas')
  await mkdir(join(personasDir, 'deltas'), { recursive: true })
  await mkdir(baseDir, { recursive: true })
  await writeFile(join(personasDir, 'assignments.json'), JSON.stringify({ personas: { oscar: { cli: 'fake', model: 'fake-model' } } }))
  await writeFile(join(baseDir, 'oscar.md'), [
    '---',
    'id: oscar',
    'label: Oscar',
    'role: Orchestrator',
    'writeScope:',
    ...scope.map((item) => `  - ${item}`),
    '---',
    'Oscar.',
  ].join('\n'))
  return { repo, personasDir, baseDir }
}

describe('commitOscarSupportEdits', () => {
  test('commits support edits through the gate and flags out-of-lane paths', async () => {
    const { repo, personasDir, baseDir } = await repoWithOscarScope(['docs/**'])
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: repo, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'completed')
    const commits: CommitCall[] = []

    const result = await commitOscarSupportEdits({
      git: fakeGit(['docs/support.md', 'packages/ui/stray.ts'], commits),
      store,
      repoPath: repo,
      runId: run.id,
      workspaceId: 'cocoder',
      priorityId: 'demo',
      personaSources: { baseDir, deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir },
      assignmentsPath: join(personasDir, 'assignments.json'),
      runReference: run.id,
      runMessageReference: `run ${run.id}`,
    })

    expect(result).toMatchObject({
      ok: true,
      commitSha: 'sha-support',
      committedPaths: ['docs/support.md', 'packages/ui/stray.ts'],
      outOfLanePaths: ['packages/ui/stray.ts'],
    })
    expect(commits).toEqual([{
      cwd: repo,
      files: ['docs/support.md', 'packages/ui/stray.ts'],
      message: `oscar-post-wrap: demo via CoCoder run ${run.id}`,
    }])
    expect(store.listEvents(run.id).map((event) => event.type)).toContain('post-wrap-support-commit')
    expect(store.listCommitLinks(run.id).map((link) => link.commitSha)).toEqual(['sha-support'])
  })

  test('refuses post-wrap priority archive bypasses before committing', async () => {
    const { repo, personasDir, baseDir } = await repoWithOscarScope(['cocoder/priorities/**'])
    const store = openRunStore(':memory:')
    store.upsertWorkspace({ id: 'cocoder', path: repo, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(run.id, 'completed')
    const commits: CommitCall[] = []

    const result = await commitOscarSupportEdits({
      git: fakeGit(['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md'], commits),
      store,
      repoPath: repo,
      runId: run.id,
      workspaceId: 'cocoder',
      priorityId: 'demo',
      personaSources: { baseDir, deltaDir: join(personasDir, 'deltas'), repoPersonaDir: personasDir },
      assignmentsPath: join(personasDir, 'assignments.json'),
      runReference: run.id,
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'post-wrap support edits cannot archive the active priority "demo" directly; use the archive-priority authoring Play after an archive-ready founder confirmation — run `cocoder oz archive-priority demo` (the one archive-priority Play; no raw file move).',
      refusedPaths: ['cocoder/priorities/archive/demo.md', 'cocoder/priorities/demo.md'],
    })
    expect(commits).toEqual([])
    expect(store.listCommitLinks(run.id)).toEqual([])
    expect(store.listEvents(run.id).map((event) => event.type)).toContain('post-wrap-support-commit-refused')
  })
})
