// Stage-3 read surfaces: workspaces / priorities / personas / runs / run-detail. Uses on-disk
// governance fixtures + an injected in-memory store + a fake git, on an ephemeral port.
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openRunStore, writePortableRun, type Git, type RunStore, type SessionHost } from '@cocoder/core'
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
  async currentBranch() {
    return 'trunk'
  },
  async resetHard() {},
  async hasUpstream() {
    return false
  },
  async push() {
    return { ok: true, detail: '' }
  },
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

async function writePriority(home: string, id: string, title = id): Promise<void> {
  await writeFile(join(home, 'cocoder', 'priorities', `${id}.md`), `---\nid: ${id}\ntitle: ${title}\n---\nDo ${id}.`)
}

async function writeTicket(home: string, state: 'open' | 'closed', id: string, title = id): Promise<void> {
  await writeFile(
    join(home, 'cocoder', 'tickets', state, `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`),
    `---\nid: ${id}\ntitle: ${title}\ntype: task\nstatus: ${state === 'open' ? 'Open' : 'Closed'}\npriority: none\nowner: founder-session\ncreated: 2026-06-10\n---\n# ${id}\n\n${title}.`,
  )
}

async function priorityIdsByDirOrder(home: string): Promise<string[]> {
  const names = await readdir(join(home, 'cocoder', 'priorities'))
  return names.filter((name) => name.endsWith('.md') && name !== 'AGENTS.md').map((name) => name.slice(0, -3))
}

describe('Oz read surfaces', () => {
  let home: string
  let store: RunStore
  let oz: OzServer | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'cocoder-oz-read-'))
    // Governance fixtures under the (dogfood) workspace == cocoderHome.
    await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
    await mkdir(join(home, 'cocoder', 'tickets', 'open'), { recursive: true })
    await mkdir(join(home, 'cocoder', 'tickets', 'closed'), { recursive: true })
    await mkdir(join(home, 'cocoder', 'personas'), { recursive: true })
    await mkdir(join(home, 'cocoder', 'plays', 'deltas'), { recursive: true })
    await mkdir(join(home, 'local'), { recursive: true })
    await writeFile(
      join(home, 'local', 'workspaces.json'),
      JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }),
    )
    await writeFile(join(home, 'cocoder', 'priorities', 'demo.md'), `---\nid: demo\ntitle: Demo priority\n---\nDo the small thing.`)
    await writeFile(join(home, 'cocoder', 'priorities', 'AGENTS.md'), `# Priorities registry\nno frontmatter here`)
    await writeFile(
      join(home, 'cocoder', 'tickets', 'open', '0003-docs.md'),
      `---\nid: 0003\ntitle: Docs stale\ntype: task\nstatus: Open\npriority: none\nowner: founder-session\ncreated: 2026-06-10\n---\n# 0003\n\nFix docs.`,
    )
    await writeFile(
      join(home, 'cocoder', 'tickets', 'closed', '0007-post-wrap.md'),
      `---\ntype: bug\nstatus: Closed\npriority: new-primary-root\nowner: founder\n---\n# Closed historical ticket`,
    )
    await writeFile(join(home, 'cocoder', 'tickets', 'closed', 'notes.md'), `# not a ticket`)
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
      JSON.stringify({ personas: { bob: { cli: 'codex', model: '', mode: 'headless' } } }),
    )
    await writeFile(
      join(home, 'cocoder', 'plays', 'deltas', 'wrap-up.md'),
      `---\nid: wrap-up\nlabel: Workspace Wrap-up\nwriteScope:\n  - cocoder/**\n---\nRepo wrap-up body`,
    )
    await writeFile(
      join(home, 'cocoder', 'plays', 'repo-only.md'),
      `---\nid: repo-only\nlabel: Repo-only Play\nkind: interactive\nwriteScope:\n  - docs/**\n---\nRepo-only body`,
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
    expect(r.json.workspaces).toEqual([{ id: 'cocoder', name: 'CoCoder', path: home, roots: [{ name: 'CoCoder', path: home, rawPath: '${COCODER_HOME}', role: 'primary' }] }])
  })

  test('GET /settings returns defaults when no settings file exists', async () => {
    const r = await get(oz!, '/settings')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ pollIntervalMs: 2500, defaultWorkspaceId: null, ozAutoCompactRuns: 3 })
  })

  test('GET /workspaces/:id/priorities skips AGENTS.md (no frontmatter) without throwing', async () => {
    const r = await get(oz!, '/workspaces/cocoder/priorities')
    expect(r.status).toBe(200)
    const priorityIds = r.json.priorities.map((p: any) => p.id)
    expect(priorityIds).toEqual(['demo'])
    expect(r.json.priorities[0]).toMatchObject({ title: 'Demo priority' })
    expect(priorityIds).not.toContain('onboard-existing')
    expect(priorityIds).not.toContain('drift-audit')
    expect(priorityIds).not.toContain('new-primary')
    expect(r.json).not.toHaveProperty('onboarding')
  })

  test('GET /workspaces/:id/tickets serves open and closed ticket files', async () => {
    const r = await get(oz!, '/workspaces/cocoder/tickets')

    expect(r.status).toBe(200)
    expect(r.json.tickets.map((ticket: any) => [ticket.id, ticket.state])).toEqual([
      ['0003', 'open'],
      ['0007', 'closed'],
    ])
    expect(r.json.tickets[0]).toMatchObject({ title: 'Docs stale', type: 'task', status: 'Open', body: expect.stringContaining('Fix docs') })
    expect(r.json.tickets[1]).toMatchObject({ title: 'Closed historical ticket', type: 'bug', status: 'Closed' })
  })

  test('GET /workspaces/:id/tickets applies order.json to open tickets only and ignores stale ids', async () => {
    await writeTicket(home, 'open', '0001', 'First open')
    await writeTicket(home, 'open', '0005', 'Later open')
    await writeTicket(home, 'closed', '0002', 'Closed early')
    await writeFile(join(home, 'cocoder', 'tickets', 'order.json'), JSON.stringify(['0005', 'missing', '0003', '0005']))

    const r = await get(oz!, '/workspaces/cocoder/tickets')

    expect(r.status).toBe(200)
    expect(r.json.tickets.map((ticket: any) => [ticket.id, ticket.state])).toEqual([
      ['0005', 'open'],
      ['0003', 'open'],
      ['0001', 'open'],
      ['0002', 'closed'],
      ['0007', 'closed'],
    ])
  })

  test('GET /workspaces/:id/priorities applies order.json, appends unlisted priorities, and ignores stale ids', async () => {
    await writePriority(home, 'alpha', 'Alpha')
    await writePriority(home, 'beta', 'Beta')
    await writeFile(join(home, 'cocoder', 'priorities', 'order.json'), JSON.stringify(['beta', 'missing']))

    const r = await get(oz!, '/workspaces/cocoder/priorities')

    expect(r.status).toBe(200)
    const dirOrder = (await priorityIdsByDirOrder(home)).filter((id) => id !== 'beta')
    expect(r.json.priorities.map((p: any) => p.id)).toEqual(['beta', ...dirOrder])
  })

  test('GET /workspaces/:id/priorities without order.json preserves directory order', async () => {
    await writePriority(home, 'alpha', 'Alpha')
    await writePriority(home, 'beta', 'Beta')

    const r = await get(oz!, '/workspaces/cocoder/priorities')

    expect(r.status).toBe(200)
    expect(r.json.priorities.map((p: any) => p.id)).toEqual(await priorityIdsByDirOrder(home))
  })

  test('GET /workspaces/:id/personas lists effective personas with assignments', async () => {
    const r = await get(oz!, '/workspaces/cocoder/personas')
    expect(r.status).toBe(200)
    const personas = r.json.personas as Array<{ id: string; label: string; writeScope: readonly string[]; cli: string | null; model: string | null }>
    expect(personas.map((p) => p.id)).toEqual(['bob', 'deb', 'oscar', 'oz', 'phil', 'quinn'])
    expect(r.json.assignments.bob).toMatchObject({ cli: 'codex', model: '', mode: 'headless' })
    expect(r.json.assignments.oz).toBeUndefined()
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

  test('GET /workspaces/:id/plays lists effective Plays', async () => {
    const r = await get(oz!, '/workspaces/cocoder/plays')
    expect(r.status).toBe(200)
    const plays = r.json.plays as Array<{ id: string; label: string; kind: string; writeScope: readonly string[] }>
    expect(plays.length).toBeGreaterThan(0)
    expect(plays.map((play) => play.id)).toEqual(expect.arrayContaining(['wrap-up', 'deep-read', 'code-review', 'repo-only']))
    for (const play of plays) {
      expect(play).toEqual({
        id: expect.any(String),
        label: expect.any(String),
        kind: expect.stringMatching(/^(headless|interactive)$/),
        writeScope: expect.any(Array),
      })
    }
    expect(plays.find((play) => play.id === 'wrap-up')).toMatchObject({
      label: 'Workspace Wrap-up',
      writeScope: expect.arrayContaining(['cocoder/**']),
    })
    expect(plays.find((play) => play.id === 'repo-only')).toMatchObject({
      label: 'Repo-only Play',
      kind: 'interactive',
      writeScope: ['docs/**'],
    })
  })

  test('GET /workspaces/:id/plays → 404 for an unknown workspace', async () => {
    expect((await get(oz!, '/workspaces/nope/plays')).status).toBe(404)
  })

  test('GET /workspaces/:id/priorities → 404 for an unknown workspace', async () => {
    expect((await get(oz!, '/workspaces/nope/priorities')).status).toBe(404)
  })

  test('GET /runs lists runs (newest-first); ?workspace filters', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const a = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    store.setRunStatus(a.id, 'completed')
    const r = await get(oz!, '/runs')
    expect(r.status).toBe(200)
    expect(r.json.runs.find((x: any) => x.id === a.id)).toMatchObject({ status: 'completed' })
    expect((await get(oz!, '/runs?workspace=other')).json.runs).toEqual([])
  })

  test('GET /runs and /runs/:id surface displayNumber from portable run.json', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })
    await writePortableRun(home, {
      run: { id: run.id, displayNumber: 7 },
      workspace: { id: 'cocoder' },
      target: { kind: 'priority' },
      priorityId: 'demo',
      playbookId: null,
      ticketId: null,
      status: 'running',
      createdAt: run.createdAt,
      endedAt: null,
    })

    const list = await get(oz!, '/runs?workspace=cocoder')
    const detail = await get(oz!, `/runs/${run.id}`)

    expect(list.status).toBe(200)
    expect(list.json.runs.find((x: any) => x.id === run.id)).toMatchObject({ id: run.id, displayNumber: 7 })
    expect(detail.status).toBe(200)
    expect(detail.json.run).toMatchObject({ id: run.id, displayNumber: 7 })
  })

  test('GET /runs and /runs/:id tolerate a legacy run with no portable run.json', async () => {
    store.upsertWorkspace({ id: 'cocoder', path: home, name: 'CoCoder' })
    const run = store.createRun({ workspaceId: 'cocoder', priorityId: 'demo' })

    const list = await get(oz!, '/runs?workspace=cocoder')
    const detail = await get(oz!, `/runs/${run.id}`)

    expect(list.status).toBe(200)
    expect(list.json.runs.find((x: any) => x.id === run.id)).toMatchObject({ id: run.id, displayNumber: null })
    expect(detail.status).toBe(200)
    expect(detail.json.run).toMatchObject({ id: run.id, displayNumber: null })
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
