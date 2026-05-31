import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { listEffectivePersonas, type PersonaSources } from '../src/index.js'

describe('listEffectivePersonas', () => {
  test('lists base personas sorted and excludes shared-standards', async () => {
    const sources = await makeSources()
    await writePersona(sources.baseDir, { id: 'oscar', label: 'Oscar', role: 'Orchestrator', scope: [], body: 'Oscar body' })
    await writePersona(sources.baseDir, { id: 'bob', label: 'Bob', role: 'Builder', scope: ['packages/**'], body: 'Bob body' })
    await writeFile(join(sources.baseDir, 'shared-standards.md'), '# Shared standards\n')

    const personas = listEffectivePersonas(sources)

    expect(personas.map((persona) => persona.id)).toEqual(['bob', 'oscar'])
  })

  test('returns a base persona merged with its delta', async () => {
    const sources = await makeSources()
    await writePersona(sources.baseDir, { id: 'bob', label: 'Bob', role: 'Builder', scope: ['packages/**'], body: 'Bob body' })
    await writeFile(join(sources.deltaDir, 'bob.md'), ['---', 'id: bob', 'writeScope:', '  - cocoder/**', '---', 'Delta body'].join('\n'))

    const [bob] = listEffectivePersonas(sources)

    expect(bob).toMatchObject({ id: 'bob', writeScope: ['packages/**', 'cocoder/**'] })
    expect(bob?.body).toBe('Bob body\n\n---\n\nDelta body')
  })

  test('includes a repo-only persona', async () => {
    const sources = await makeSources()
    await writePersona(sources.repoPersonaDir, { id: 'phil', label: 'Phil', role: 'Extension', scope: ['plugins/**'], body: 'Phil body' })

    const personas = listEffectivePersonas(sources)

    expect(personas).toEqual([
      { id: 'phil', label: 'Phil', role: 'Extension', writeScope: ['plugins/**'], body: 'Phil body' },
    ])
  })

  test('skips non-persona markdown files in the repo persona dir', async () => {
    const sources = await makeSources()
    await writePersona(sources.repoPersonaDir, { id: 'phil', label: 'Phil', role: 'Extension', scope: ['plugins/**'], body: 'Phil body' })
    await writeFile(join(sources.repoPersonaDir, 'AGENTS.md'), '# Agent notes\nno frontmatter')

    const personas = listEffectivePersonas(sources)

    expect(personas.map((persona) => persona.id)).toEqual(['phil'])
  })

  test('treats an absent repo persona dir as empty', async () => {
    const sources = await makeSources({ repo: false })
    await writePersona(sources.baseDir, { id: 'bob', label: 'Bob', role: 'Builder', scope: ['packages/**'], body: 'Bob body' })

    const personas = listEffectivePersonas(sources)

    expect(personas.map((persona) => persona.id)).toEqual(['bob'])
  })
})

async function makeSources(options: { readonly repo?: boolean } = {}): Promise<PersonaSources> {
  const root = await mkdtemp(join(tmpdir(), 'list-effective-personas-'))
  const baseDir = join(root, 'base')
  const deltaDir = join(root, 'deltas')
  const repoPersonaDir = join(root, 'repo')
  await Promise.all([mkdir(baseDir), mkdir(deltaDir)])
  if (options.repo !== false) await mkdir(repoPersonaDir)
  return { baseDir, deltaDir, repoPersonaDir }
}

async function writePersona(
  dir: string,
  input: {
    readonly id: string
    readonly label: string
    readonly role: string
    readonly scope: readonly string[]
    readonly body: string
  },
): Promise<void> {
  await writeFile(
    join(dir, `${input.id}.md`),
    [
      '---',
      `id: ${input.id}`,
      `label: ${input.label}`,
      `role: ${input.role}`,
      'writeScope:',
      ...input.scope.map((entry) => `  - ${entry}`),
      '---',
      input.body,
    ].join('\n'),
  )
}
