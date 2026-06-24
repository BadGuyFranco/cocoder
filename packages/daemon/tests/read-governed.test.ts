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
  test('reads live content from repo files by default', async () => {
    const { home, ctx } = await makeWorkspace()
    await mkdir(join(home, 'packages', 'core', 'src'), { recursive: true })
    await writeFile(join(home, 'packages', 'core', 'src', 'index.ts'), 'core barrel live content\n')
    await writeFile(join(home, 'ARCHITECTURE.md'), '# Architecture live content\n')

    await expect(readGoverned(ctx, 'cocoder', 'packages/core/src/index.ts')).resolves.toEqual({
      status: 200,
      body: { path: 'packages/core/src/index.ts', content: 'core barrel live content\n' },
    })

    await expect(readGoverned(ctx, 'cocoder', 'ARCHITECTURE.md')).resolves.toEqual({
      status: 200,
      body: { path: 'ARCHITECTURE.md', content: '# Architecture live content\n' },
    })
  })

  test('rejects local secrets before returning file content', async () => {
    const { home, ctx } = await makeWorkspace()
    await mkdir(join(home, 'local', 'secrets'), { recursive: true })
    await writeFile(join(home, 'local', 'secrets', 'oz-token'), 'local secret token')

    const result = await readGoverned(ctx, 'cocoder', 'local/secrets/oz-token')

    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('Path "local/secrets/oz-token" is refused because it is secrets, runtime state, or host-private data.')
    expect(JSON.stringify(result.body)).not.toContain('local secret token')
  })

  test('rejects env files before returning file content', async () => {
    const { home, ctx } = await makeWorkspace()
    await mkdir(join(home, 'packages', 'daemon'), { recursive: true })
    await writeFile(join(home, 'packages', 'daemon', '.env.local'), 'env secret content')

    const result = await readGoverned(ctx, 'cocoder', 'packages/daemon/.env.local')

    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('Path "packages/daemon/.env.local" is refused because it is secrets, runtime state, or host-private data.')
    expect(JSON.stringify(result.body)).not.toContain('env secret content')
  })

  test('rejects parent-directory traversal before returning escaped file content', async () => {
    const { home, ctx } = await makeWorkspace()
    await writeFile(join(home, '..', 'escaped-secret'), 'escaped secret content')

    const result = await readGoverned(ctx, 'cocoder', '../escaped-secret')

    expect(result.status).toBe(400)
    expect(result.body['error']).toBe('Path "../escaped-secret" uses parent-directory traversal, which Oz may not read.')
    expect(JSON.stringify(result.body)).not.toContain('escaped secret content')
  })

  test('rejects absolute paths before returning file content', async () => {
    const { home, ctx } = await makeWorkspace()
    const absoluteTarget = join(home, 'packages', 'core', 'src', 'index.ts')
    await mkdir(join(home, 'packages', 'core', 'src'), { recursive: true })
    await writeFile(absoluteTarget, 'absolute path content')

    const result = await readGoverned(ctx, 'cocoder', absoluteTarget)

    expect(result.status).toBe(400)
    expect(result.body['error']).toBe(`Path "${absoluteTarget}" must be relative to the repo root.`)
    expect(JSON.stringify(result.body)).not.toContain('absolute path content')
  })
})
