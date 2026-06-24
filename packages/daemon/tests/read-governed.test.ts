import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { OzContext } from '../src/context.js'
import { readGoverned } from '../src/launcher.js'

async function makeWorkspace(): Promise<{ readonly home: string; readonly ctx: OzContext }> {
  const home = await mkdtemp(join(tmpdir(), 'cocoder-read-governed-'))
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'cocoder', name: 'CoCoder', path: '${COCODER_HOME}' }] }))
  return { home, ctx: { cocoderHome: home } as unknown as OzContext }
}

describe('readGoverned', () => {
  test('reads live content from an allowed governed file', async () => {
    const { home, ctx } = await makeWorkspace()
    const path = 'cocoder/decisions/0017-oz-orchestration-persona.md'
    await mkdir(join(home, 'cocoder', 'decisions'), { recursive: true })
    await writeFile(join(home, path), 'ADR-0017 live content\n')

    const result = await readGoverned(ctx, 'cocoder', path)

    expect(result).toEqual({ status: 200, body: { path, content: 'ADR-0017 live content\n' } })
  })

  test('rejects product code before returning file content', async () => {
    const { home, ctx } = await makeWorkspace()
    await mkdir(join(home, 'packages', 'core', 'src'), { recursive: true })
    await writeFile(join(home, 'packages', 'core', 'src', 'index.ts'), 'product code content')

    const result = await readGoverned(ctx, 'cocoder', 'packages/core/src/index.ts')

    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('Path "packages/core/src/index.ts" is outside the governed zones Oz may read.')
    expect(JSON.stringify(result.body)).not.toContain('product code content')
  })

  test('rejects local run state before returning file content', async () => {
    const { home, ctx } = await makeWorkspace()
    await mkdir(join(home, 'local', 'runs', 'run_220'), { recursive: true })
    await writeFile(join(home, 'local', 'runs', 'run_220', 'events.jsonl'), 'run event content')

    const result = await readGoverned(ctx, 'cocoder', 'local/runs/run_220/events.jsonl')

    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('Path "local/runs/run_220/events.jsonl" is outside the governed zones Oz may read.')
    expect(JSON.stringify(result.body)).not.toContain('run event content')
  })

  test('rejects parent-directory traversal before returning escaped file content', async () => {
    const { home, ctx } = await makeWorkspace()
    await mkdir(join(home, 'packages', 'daemon', 'src'), { recursive: true })
    await writeFile(join(home, 'packages', 'daemon', 'src', 'oz-host.ts'), 'daemon source content')

    const result = await readGoverned(ctx, 'cocoder', 'cocoder/decisions/../../packages/daemon/src/oz-host.ts')

    expect(result.status).toBe(400)
    expect(result.body['error']).toBe('Path "cocoder/decisions/../../packages/daemon/src/oz-host.ts" uses parent-directory traversal, which Oz may not read.')
    expect(JSON.stringify(result.body)).not.toContain('daemon source content')
  })
})
