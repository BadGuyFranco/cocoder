// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { pickWorkspaceDirectory, resolveCocoderHome, validateWorkspacePrimaryRoot, type DirectoryPickerDialog } from '../electron/workspace-picker.ts'

const tempDirs: string[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cocoder-picker-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('workspace directory picker validation', () => {
  it('resolves the CoCoder install root from a packages/ui launch cwd', () => {
    expect(resolveCocoderHome('/repo/packages/ui', {})).toBe('/repo')
    expect(resolveCocoderHome('/repo/packages/ui', { COCODER_HOME: '/install' })).toBe('/install')
  })

  it('accepts an existing directory outside the install root and returns an absolute path', async () => {
    const install = await tempRoot()
    const repo = await tempRoot()

    await expect(validateWorkspacePrimaryRoot(repo, install)).resolves.toEqual({ ok: true, status: 200, data: { path: repo } })
  })

  it('rejects missing paths, files, and directories inside the install root', async () => {
    const install = await tempRoot()
    const file = join(install, 'not-a-dir')
    const nested = join(install, 'nested')
    await writeFile(file, 'x')
    await mkdir(nested)

    await expect(validateWorkspacePrimaryRoot(join(install, 'missing'), install)).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: `primary root does not exist or is not a directory: ${join(install, 'missing')}`,
    })
    await expect(validateWorkspacePrimaryRoot(file, install)).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: `primary root does not exist or is not a directory: ${file}`,
    })
    await expect(validateWorkspacePrimaryRoot(nested, install)).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'primary root must not be inside the CoCoder install root',
    })
  })

  it('opens a single native directory picker and returns null when cancelled', async () => {
    const calls: unknown[] = []
    const dialog: DirectoryPickerDialog = {
      showOpenDialog: async (options) => {
        calls.push(options)
        return { canceled: true, filePaths: [] }
      },
    }

    await expect(pickWorkspaceDirectory(dialog, await tempRoot())).resolves.toEqual({ ok: true, status: 200, data: { path: null } })
    expect(calls).toEqual([{ title: 'Choose primary root folder', properties: ['openDirectory'] }])
  })

  it('validates the picked directory before returning it to the renderer', async () => {
    const install = await tempRoot()
    const repo = await tempRoot()
    const dialog: DirectoryPickerDialog = {
      showOpenDialog: async () => ({ canceled: false, filePaths: [repo] }),
    }

    await expect(pickWorkspaceDirectory(dialog, install)).resolves.toEqual({ ok: true, status: 200, data: { path: repo } })
  })
})
