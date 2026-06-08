// Stage-3 read surfaces: workspaces / priorities / personas / runs / run-detail. Uses on-disk
// governance fixtures + an injected in-memory store + a fake git, on an ephemeral port.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, type Git, type RunStore, type SessionHost } from '@cocoder/core'
import { createOzServer, type OzServer } from '../src/index.js'

const fakeGit = (): Git => ({
  async headSha() {
    return 'h0'
  },
  async changedFiles() {
    return []
  },
  async addAndCommit() {
    return 'sha'
  },
  async show(_cwd, sha) {
    return `diff for ${sha}`
  },
  async restoreToHead() {},
  async worktreeAdd() {},
  async worktreeRemove() {},
  async listWorktrees() {
    return []
  },
  async isAncestor() {
    return true
  },
  async mergeFastForwardOnly() {
    return 'h0'
  },
  async unmergedCommits() {
    return []
  },
  async mergeInto() {
    return 'clean' as const
  },
  async conflictedFiles() {
    return []
  },
  async completeMerge() {
    return 'h0'
  },
  async abortMerge() {},
  async currentBranch() {
    return 'trunk'
  },
  async resetHard() {},
})

const fakeHost = (): SessionHost =>
  ({
    async spawn() {
      return { id: 'x', driver: 'fake' }
    },
    async readScreen() {
      return ''
    },
    async status() {
      return { state: 'exited', code: 0 }
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async sendInput() {},
    async show() {},
    async kill() {},
    async closeSurface() {},
  }) as SessionHost

interface Resp {
  status: number
  json: any
}
const get = (oz: OzServer, path: string): Promise<Resp> =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: oz.port, path, method: 'GET', headers: { authorization: `Bearer ${oz.token}` } },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }))
      },
    )
    req.on('error', reject)
    req.end()
  })

describe('Oz read surfaces', () => {
  let home: string
  let store: RunStore
  let oz: OzServer | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cocoder-oz-read-'))
    // Governance fixtures under the (dogfood) workspace == cocoderHome.
    await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
    await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
    await mkdir(join(home, 'local'), { recursive: true })
    await writeFile(
      join(home, 'local', 'workspaces.json'),
      JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }),
    )
    await writeFile(join(home, 'cocoder', 'priorities', 'demo.md'), `---\nid: demo\ntitle: Demo priority\n---\nDo the small thing.`)
    await writeFile(join(home, 'cocoder', 'priorities', 'AGENTS.md'), `# Priorities registry\nno frontmatter here`)
    await mkdir(join(home, 'cocoder', 'personas', 'deltas'))
    await writeFile(
      join(home, 'cocoder', 'personas', 'deltas', 'bob.md'),
      `---\nid: bob\nlabel: Repo Bob\nwriteScope:\n  - cocoder/**\n---\nRepo Bob body`,
    )
    await writeFile(
      join(home, 'cocoder', 'personas', 'phil.md'),
      `---\nid: phil\nlabel: Phil\nrole: repo-only\nwriteScope:\n  - plugins/**\n---\nPhil body`,
    )
    await writeFile(join(home, 'cocoder', 'personas', 'shared-standards.md'), `# Shared standards\nno frontmatter`)
    await writeFile(join(home, 'cocoder', 'personas', 'AGENTS.md'), `# Personas registry\nno frontmatter here`)
    await writeFile(
      join(home, 'cocoder', 'personas', 'assignments.json'),
      JSON.stringify({ personas: { bob: { cli: 'codex', model: '' } } }),
    )
    store = openRunStore(':memory:')
    oz = await createOzServer({ cocoderHome: home, port: 0, store, git: fakeGit(), sessionHost: fakeHost() })
  })
  afterEach(async () => {
    await oz?.close()
    oz = undefined
  })

  test('GET /workspaces expands ${COCODER_HOME}', async () => {
    const r = await get(oz!, '/workspaces')
    expect(r.status).toBe(200)
    expect(r.json.workspaces).toEqual([{ id: 'cocoder', name: 'CoCoder', path: home }])
  })

  test('GET /settings returns defaults when no settings file exists', async () => {
    const r = await get(oz!, '/settings')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ pollIntervalMs: 2500, defaultWorkspaceId: null })
  })

  test('GET /workspaces/:id/priorities skips AGENTS.md (no frontmatter) without throwing', async () => {
    const r = await get(oz!, '/workspaces/cocoder/priorities')
    expect(r.status).toBe(200)
    expect(r.json.priorities.map((p: any) => p.id)).toEqual(['demo'])
    expect(r.json.priorities[0]).toMatchObject({ title: 'Demo priority' })
  })

  test('GET /workspaces/:id/personas lists effective personas with assignments', async () => {
    const r = await get(oz!, '/workspaces/cocoder/personas')
    expect(r.status).toBe(200)
    const personas = r.json.personas as Array<{ id: string; label: string; writeScope: readonly string[]; cli: string | null; model: string | null }>
    expect(personas.map((p) => p.id)).toEqual(['bob', 'deb', 'oscar', 'phil'])
    // base bob is repo-agnostic (writeScope []), so the effective scope is whatever the repo delta grants.
    expect(personas.find((p) => p.id === 'bob')).toMatchObject({
      label: 'Repo Bob',
      cli: 'codex',
      model: '',
      writeScope: ['cocoder/**'],
    })
    expect(personas.find((p) => p.id === 'phil')).toMatchObject({
      label: 'Phil',
      cli: null,
      model: null,
      writeScope: ['plugins/**'],
    })
  })

  test('GET /workspaces/:id/priorities → 404 for an unknown workspace', async () => {
    expect((await get(oz!, '/workspaces/nope/priorities')).status).toBe(404)
  })

  test('GET /runs lists runs (newest-first); ?workspace filters', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const a = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const r = await get(oz!, '/runs')
    expect(r.status).toBe(200)
    expect(r.json.runs.map((x: any) => x.id)).toContain(a.id)
    expect((await get(oz!, '/runs?workspace=other')).json.runs).toEqual([])
  })

  test('GET /runs/:id assembles rows + diff + deepLinkable from the live-ref set', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    const session = store.createSession({ runId: run.id, persona: 'bob', sessionRef: 'surface:7' })
    store.recordCommitLink({ runId: run.id, commitSha: 'abc123', message: 'm', files: ['packages/x.ts'] })
    oz!.ctx.liveRefs.add('surface:7') // pretend this session is live in-process

    const r = await get(oz!, `/runs/${run.id}`)
    expect(r.status).toBe(200)
    expect(r.json.run.id).toBe(run.id)
    expect(r.json.sessions.find((s: any) => s.id === session.id).deepLinkable).toBe(true)
    expect(r.json.diffs).toEqual([{ sha: 'abc123', diff: 'diff for abc123' }])
  })

  test('GET /runs/:id → 404 for an unknown run', async () => {
    expect((await get(oz!, '/runs/nope')).status).toBe(404)
  })
})
