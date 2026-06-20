import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { loadPlay } from '@cocoder/core'
import { basePlaysDir } from '@cocoder/personas'
import { buildRunInput } from '../src/launcher.js'

const WORKSPACE_ID = 'demo-workspace'
const PRIORITY_ID = 'demo'

const assignments = {
  personas: {
    oscar: {
      cli: 'claude',
      model: '',
      plays: {
        'wrap-up': { cli: 'cursor-agent', model: '' },
        'integration-verify': { cli: 'claude', model: '' },
        'merge-conflict': { cli: 'claude', model: '' },
      },
    },
    bob: { cli: 'codex', model: '' },
  },
}

async function writeGovernance(home: string, withWrapDelta: boolean): Promise<void> {
  await mkdir(join(home, 'local'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'personas', 'deltas'), { recursive: true })
  await mkdir(join(home, 'cocoder', 'priorities'), { recursive: true })
  await writeFile(
    join(home, 'local', 'workspaces.json'),
    JSON.stringify({ workspaces: [{ id: WORKSPACE_ID, name: 'Demo Workspace', path: home }] }),
  )
  await writeFile(join(home, 'cocoder', 'personas', 'assignments.json'), `${JSON.stringify(assignments, null, 2)}\n`)
  await writeFile(join(home, 'cocoder', 'priorities', `${PRIORITY_ID}.md`), `---\nid: ${PRIORITY_ID}\ntitle: Demo\n---\n## Objective\nProve Play deltas.`)

  if (withWrapDelta) {
    await mkdir(join(home, 'cocoder', 'plays', 'deltas'), { recursive: true })
    await writeFile(
      join(home, 'cocoder', 'plays', 'deltas', 'wrap-up.md'),
      `---\nid: wrap-up\nlabel: Workspace Wrap-up\n---\n\n# Workspace addition\n\nThis text came from the repo Play delta.\n`,
    )
  }
}

describe('daemon run launch Play deltas', () => {
  const homes: string[] = []

  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
  })

  async function runInput(withWrapDelta: boolean) {
    const home = await mkdtemp(join(tmpdir(), 'cocoder-play-delta-launch-'))
    homes.push(home)
    await writeGovernance(home, withWrapDelta)
    return buildRunInput({ cocoderHome: home, runsRoot: join(home, 'local', 'runs') }, WORKSPACE_ID, PRIORITY_ID)
  }

  test('merges a repo Play delta into the wrap-up Play at launch', async () => {
    const base = loadPlay(basePlaysDir(), 'wrap-up')

    const input = await runInput(true)

    const wrapPlay = input.wrapPlay
    if (!wrapPlay) throw new Error('expected input.wrapPlay to be defined')
    expect(wrapPlay.id).toBe('wrap-up')
    expect(wrapPlay.label).toBe('Workspace Wrap-up')
    expect(wrapPlay.body).toContain(base.body.trimEnd())
    expect(wrapPlay.body).toContain('\n\n---\n\n# Workspace addition')
    expect(wrapPlay.body).toContain('This text came from the repo Play delta.')
  })

  test('uses the unchanged base Play when the repo has no matching delta', async () => {
    const base = loadPlay(basePlaysDir(), 'wrap-up')

    const input = await runInput(false)

    expect(input.wrapPlay).toEqual(base)
  })
})
