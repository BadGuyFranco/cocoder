import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readWorkspaces } from '../src/registry.js'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cocoder-registry-'))
}

async function writeWorkspace(home: string, name: string, data: unknown): Promise<void> {
  const dir = join(home, 'local', 'workspace')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.code-workspace`), JSON.stringify(data))
}

async function writeLegacy(home: string, data: unknown): Promise<void> {
  await mkdir(join(home, 'local'), { recursive: true })
  await writeFile(join(home, 'local', 'workspaces.json'), JSON.stringify(data))
}

describe('workspace registry', () => {
  test('reads workspace files with roles, variable expansion, relative paths, and default names', async () => {
    const home = await tempHome()
    await writeWorkspace(home, 'demo', {
      folders: [
        { name: 'Product', path: '${COCODER_HOME}/product', role: 'primary' },
        { name: 'Support', path: './support', role: 'writable', description: 'editable tools' },
        { path: 'refs/../reference', role: 'readonly' },
      ],
      settings: { ignored: true },
    })

    const workspaces = await readWorkspaces(home)

    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toMatchObject({ id: 'demo', name: 'demo', path: join(home, 'product') })
    expect(workspaces[0]!.roots).toEqual([
      { name: 'Product', path: join(home, 'product'), rawPath: '${COCODER_HOME}/product', role: 'primary' },
      { name: 'Support', path: join(home, 'local', 'workspace', 'support'), rawPath: './support', role: 'writable', description: 'editable tools' },
      { name: 'reference', path: join(home, 'local', 'workspace', 'reference'), rawPath: 'refs/../reference', role: 'readonly' },
    ])
  })

  test('skips workspace files without exactly one primary while still loading valid files', async () => {
    const home = await tempHome()
    await writeWorkspace(home, 'valid', { folders: [{ path: '${COCODER_HOME}', role: 'primary' }] })
    await writeWorkspace(home, 'zero-primary', { folders: [{ path: '${COCODER_HOME}/docs', role: 'readonly' }] })
    await writeWorkspace(home, 'two-primary', {
      folders: [
        { path: '${COCODER_HOME}', role: 'primary' },
        { path: '${COCODER_HOME}/other', role: 'primary' },
      ],
    })

    const workspaces = await readWorkspaces(home)

    expect(workspaces.map((workspace) => workspace.id)).toEqual(['valid'])
  })

  test('skips unparseable workspace JSON without throwing', async () => {
    const home = await tempHome()
    await writeWorkspace(home, 'valid', { folders: [{ path: '${COCODER_HOME}', role: 'primary' }] })
    await writeFile(join(home, 'local', 'workspace', 'broken.code-workspace'), '{')

    await expect(readWorkspaces(home)).resolves.toHaveLength(1)
  })

  test('workspace directory wins over the legacy registry', async () => {
    const home = await tempHome()
    await writeLegacy(home, { workspaces: [{ id: 'legacy', name: 'Legacy', path: '${COCODER_HOME}/legacy' }] })
    await writeWorkspace(home, 'modern', { folders: [{ path: '${COCODER_HOME}/modern', role: 'primary' }] })

    const workspaces = await readWorkspaces(home)

    expect(workspaces.map((workspace) => workspace.id)).toEqual(['modern'])
    expect(workspaces[0]!.path).toBe(join(home, 'modern'))
  })

  test('falls back to the legacy registry when the workspace directory is missing', async () => {
    const home = await tempHome()
    await writeLegacy(home, { workspaces: [{ id: 'legacy', name: 'Legacy', path: '${COCODER_HOME}/legacy' }] })

    const workspaces = await readWorkspaces(home)

    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toMatchObject({ id: 'legacy', name: 'Legacy', path: join(home, 'legacy') })
  })

  test('legacy entries synthesize a single primary root', async () => {
    const home = await tempHome()
    await writeLegacy(home, { workspaces: [{ id: 'legacy', name: 'Legacy', path: '${COCODER_HOME}/legacy' }] })

    const workspaces = await readWorkspaces(home)

    expect(workspaces[0]!.roots).toEqual([{ name: 'Legacy', path: join(home, 'legacy'), rawPath: '${COCODER_HOME}/legacy', role: 'primary' }])
  })
})
