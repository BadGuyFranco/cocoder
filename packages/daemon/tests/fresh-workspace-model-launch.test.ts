import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { ClaudeAdapter } from '@cocoder/adapters'
import { installRoot, loadAssignments, scaffoldCocoderZone, workspaceTemplateDir } from '@cocoder/core'
import { buildRunInput } from '../src/launcher.js'

const WORKSPACE_ID = 'fresh-product'
const PRIORITY_ID = 'adhoc-session'

describe('fresh workspace Claude model launch', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function freshRunInput(oscarModel = '') {
    const install = await mkdtemp(join(tmpdir(), 'cocoder-fresh-install-'))
    const primary = await mkdtemp(join(tmpdir(), 'cocoder-fresh-primary-'))
    roots.push(install, primary)
    await mkdir(join(install, 'local', 'workspace'), { recursive: true })
    scaffoldCocoderZone({ templateDir: workspaceTemplateDir(), targetRoot: primary, installRoot: installRoot() })
    if (oscarModel) {
      const assignmentsPath = join(primary, 'cocoder', 'personas', 'assignments.json')
      const assignments = loadAssignments(assignmentsPath)
      const personas = { ...assignments.personas, oscar: { ...assignments.personas.oscar, model: oscarModel } }
      await writeFile(assignmentsPath, `${JSON.stringify({ ...assignments, personas }, null, 2)}\n`)
    }
    await writeFile(
      join(install, 'local', 'workspace', `${WORKSPACE_ID}.code-workspace`),
      `${JSON.stringify({ folders: [{ path: primary, role: 'primary' }, { path: '${COCODER_HOME}', role: 'readonly' }], settings: {} }, null, 2)}\n`,
    )
    return { input: await buildRunInput({ cocoderHome: install, runsRoot: join(install, 'local', 'runs') }, WORKSPACE_ID, PRIORITY_ID), primary }
  }

  test('default seeded model builds Claude argv without --model, while explicit pins still pass through', async () => {
    const { input, primary } = await freshRunInput()
    const assignmentsPath = join(primary, 'cocoder', 'personas', 'assignments.json')
    const assignments = loadAssignments(assignmentsPath)
    expect(assignments.personas.oscar?.model).toBe('')
    expect(input.oscar.model).toBe('')

    const adapter = new ClaudeAdapter()
    const defaultCmd = adapter.build({ persona: input.oscar.id, prompt: 'first run', model: input.oscar.model, cwd: primary, outPath: join(primary, 'oscar.out') })
    expect(defaultCmd.args).not.toContain('--model')

    const pinned = await freshRunInput('sonnet')
    const pinnedAssignments = loadAssignments(join(pinned.primary, 'cocoder', 'personas', 'assignments.json'))
    expect(pinnedAssignments.personas.oscar?.model).toBe('sonnet')
    expect(pinned.input.oscar.model).toBe('sonnet')

    const pinnedCmd = adapter.build({
      persona: pinned.input.oscar.id,
      prompt: 'first run',
      model: pinned.input.oscar.model,
      cwd: pinned.primary,
      outPath: join(pinned.primary, 'oscar.out'),
    })
    expect(pinnedCmd.args).toEqual(expect.arrayContaining(['--model', 'sonnet']))
  })
})
