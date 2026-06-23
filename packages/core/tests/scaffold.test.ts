import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { installRoot, loadAssignments, loadPriority, scaffoldCocoderZone, workspaceTemplateDir } from '../src/index.js'

const repoRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const templateDir = (): string => join(repoRoot(), 'templates', 'workspace-cocoder', 'cocoder')
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const dirs: string[] = []

async function tempTarget(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('scaffoldCocoderZone', () => {
  test('copies the shipped template tree into an empty target', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-')
    const result = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })
    const expectedFiles = [
      'cocoder/.gitignore',
      'cocoder/AGENTS.md',
      'cocoder/CLAUDE.md',
      'cocoder/SESSION_LOG.md',
      'cocoder/decisions/README.md',
      'cocoder/memory/AGENTS.md',
      'cocoder/memory/codebase-map.md',
      'cocoder/memory/tech-stack.md',
      'cocoder/personas/assignments.json',
      'cocoder/personas/custom/.gitkeep',
      'cocoder/priorities/.gitkeep',
      'cocoder/priorities/adhoc-session.md',
      'cocoder/standards/AGENTS.md',
      'cocoder/tickets/INDEX.md',
    ]

    expect(result.created).toEqual(expectedFiles)
    for (const file of expectedFiles) {
      expect(await exists(join(targetRoot, file))).toBe(true)
    }
    expect(await readFile(join(targetRoot, 'cocoder', 'AGENTS.md'), 'utf8')).toContain("workspace's governance")
    expect(loadAssignments(join(targetRoot, 'cocoder', 'personas', 'assignments.json')).personas.bob).toEqual({ cli: 'codex', model: '' })
    expect(loadPriority(join(targetRoot, 'cocoder', 'priorities'), 'adhoc-session')).toMatchObject({
      id: 'adhoc-session',
      title: 'Session without a named priority',
    })
    expect(await exists(join(targetRoot, 'cocoder', 'priorities', 'onboard-existing.md'))).toBe(false)
  })

  test('seeds onboard-existing only when target already has source content', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-existing-')
    await mkdir(join(targetRoot, 'src'), { recursive: true })
    await writeFile(join(targetRoot, 'src', 'app.ts'), 'export const app = true\n')

    const result = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })

    expect(result.created).toContain('cocoder/priorities/onboard-existing.md')
    const seeded = await readFile(join(targetRoot, 'cocoder', 'priorities', 'onboard-existing.md'), 'utf8')
    expect(seeded).toContain('## Objective')
    expect(seeded).toContain('scopeNarrowing: ["cocoder/**"]')
    expect(seeded).toContain('auditWriteBoundary: ["cocoder/**"]')
    expect(seeded).toContain('code, content, operations/docs, or a mix')
    expect(seeded).toContain('type subsystems explicitly as code subsystems vs content/governance/ops subsystems')
    expect(seeded).not.toMatch(/CoBuilder|dogfood/i)
    expect(loadPriority(join(targetRoot, 'cocoder', 'priorities'), 'onboard-existing')).toMatchObject({
      id: 'onboard-existing',
      title: 'Onboard an existing repo — deep multi-agent audit that authors its cocoder/ governance',
      scopeNarrowing: ['cocoder/**'],
      auditWriteBoundary: ['cocoder/**'],
    })
  })

  test('does not seed onboard-existing into a .git-only new repo', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-git-only-')
    await mkdir(join(targetRoot, '.git'), { recursive: true })

    const result = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })

    expect(result.created).not.toContain('cocoder/priorities/onboard-existing.md')
    expect(result.created).toContain('cocoder/priorities/adhoc-session.md')
    expect(result.created).toContain('cocoder/personas/assignments.json')
    expect(await exists(join(targetRoot, 'cocoder', 'priorities', 'onboard-existing.md'))).toBe(false)
  })

  test('resolves the shipped template from the running package location', async () => {
    expect(installRoot()).toBe(repoRoot())
    expect(workspaceTemplateDir()).toBe(templateDir())
    expect(await exists(join(workspaceTemplateDir(), 'AGENTS.md'))).toBe(true)
  })

  test('never overwrites an existing target file', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-create-only-')
    await mkdir(join(targetRoot, 'cocoder'), { recursive: true })
    await writeFile(join(targetRoot, 'cocoder', 'AGENTS.md'), 'KEEP ME')

    const result = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })

    expect(await readFile(join(targetRoot, 'cocoder', 'AGENTS.md'), 'utf8')).toBe('KEEP ME')
    expect(result.created).not.toContain('cocoder/AGENTS.md')
  })

  test('is idempotent after the first scaffold', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-idempotent-')

    scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })
    expect(scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })).toEqual({ created: [] })
  })

  test('is idempotent after seeding onboard-existing into an existing repo', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-existing-idempotent-')
    await writeFile(join(targetRoot, 'package.json'), '{"private":true}\n')

    expect(scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() }).created).toContain(
      'cocoder/priorities/onboard-existing.md',
    )
    expect(scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })).toEqual({ created: [] })
  })

  test('refuses to scaffold inside the install tree without rejecting sibling prefixes', async () => {
    const root = await tempTarget('cocoder-scaffold-containment-')
    const installRoot = join(root, 'install')
    const nestedTarget = join(installRoot, 'workspace')
    const siblingTarget = join(root, 'install-other')

    expect(() => scaffoldCocoderZone({ templateDir: templateDir(), targetRoot: nestedTarget, installRoot })).toThrow(
      /refusing to scaffold inside the CoCoder install tree/,
    )
    expect(() => scaffoldCocoderZone({ templateDir: templateDir(), targetRoot: siblingTarget, installRoot })).not.toThrow()
  })

  test('returns sorted POSIX paths relative to targetRoot', async () => {
    const targetRoot = await tempTarget('cocoder-scaffold-paths-')
    const { created } = scaffoldCocoderZone({ templateDir: templateDir(), targetRoot, installRoot: repoRoot() })

    expect(created).toEqual([...created].sort())
    for (const file of created) {
      expect(file.startsWith('cocoder/')).toBe(true)
      expect(file.includes('\\')).toBe(false)
    }
  })
})
