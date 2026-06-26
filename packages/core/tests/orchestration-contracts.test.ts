import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseDirective } from '../src/runner/index.js'

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8')

const liveMarkdownFiles = (rel = ''): string[] => {
  const skipDirs = new Set(['.git', 'local', 'node_modules', 'dist', 'coverage', 'zArchive'])
  const walk = (absDir: string): string[] =>
    readdirSync(absDir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) {
        return skipDirs.has(entry.name) ? [] : walk(join(absDir, entry.name))
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) return []
      return relative(repoRoot, join(absDir, entry.name))
    })

  return walk(join(repoRoot, rel)).map((path) => path.replaceAll('\\', '/'))
}

const founderCloseoutContract = (): { sections: string[]; finalLine: string } => {
  const text = read('packages/personas/base/plays/wrap-up.md')
  const fence = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error('wrap-up Play is missing a fenced founder closeout contract')
  const sections = [...fence[1].matchAll(/^\*\*[^*\n]+?\*\*\s*$/gm)].map((match) => match[0].trim())
  const finalLine = fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (sections.length < 10 || !finalLine || finalLine.startsWith('**')) {
    throw new Error('wrap-up Play founder closeout contract is malformed')
  }
  return { sections: sections.slice(0, 10), finalLine }
}

describe('orchestration contract ownership', () => {
  test('live prompt/runtime/test consumers do not restate the founder closeout contract', () => {
    const contract = founderCloseoutContract()
    const consumers = [
      'packages/core/src/runner/prompts.ts',
      'packages/core/src/runner/status.ts',
      'packages/core/src/runner/runner.ts',
      'packages/core/tests/runner.test.ts',
      'packages/personas/base/oscar.md',
      'packages/personas/tests/base-personas.test.ts',
    ]

    const offenders = consumers.flatMap((rel) => {
      const text = read(rel)
      const hits = contract.sections.filter((section) => text.includes(section))
      return hits.length >= 3 ? [`${rel}: ${hits.join(', ')}`] : []
    })

    expect(offenders).toEqual([])
  })

  test('only the runner delivery artifact may instruct Oscar to deliver the founder closeout', () => {
    const deliveryOwner = read('packages/core/src/runner/prompts.ts')
    expect(deliveryOwner.match(/Deliver the validated founder-facing wrap-up below now/g)).toHaveLength(1)

    const nonDeliverySurfaces = [
      'packages/personas/base/oscar.md',
      'packages/core/src/runner/status.ts',
    ]
    const forbidden = [
      /Report back to the founder using the wrap-up Play/i,
      /Report back to the founder in the standardized format/i,
      /Deliver the validated founder-facing wrap-up below now/i,
      /Deliver this founder-facing wrap-up now/i,
    ]

    const offenders = nonDeliverySurfaces.flatMap((rel) => {
      const text = read(rel)
      return forbidden
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${rel}: ${pattern}`)
    })

    expect(offenders).toEqual([])
    expect(read('packages/personas/base/oscar.md')).toContain('wait for the runner\'s `WRAP-UP READY`')
    expect(read('packages/core/src/runner/prompts.ts')).toContain('do not also deliver a founder closeout in the pane')
    expect(read('packages/core/src/runner/prompts.ts')).toContain('WRAP-UP READY artifact for exactly-once delivery')
  })

  test('ticket authoring surfaces derive markdown or ticket creation from core owners', () => {
    const play = read('packages/personas/base/plays/create-ticket.md')
    const routes = read('packages/daemon/src/routes.ts')

    expect(play).toContain('composeTicketMarkdown')
    expect(play).not.toMatch(/```\s*---\s*\nid:/)
    expect(routes).toContain('createTicket as createTicketCore')
    expect(routes).toContain('createTicketCore({ ticketsDir: dir')
  })

  test('priority authoring surfaces derive markdown from the core priority composer', () => {
    const play = read('packages/personas/base/plays/create-priority.md')
    const routes = read('packages/daemon/src/routes.ts')
    const priorityAuthoring = read('packages/daemon/src/priority-authoring.ts')

    expect(play).toContain('composePriorityBody')
    expect(play).toContain('composePriorityMarkdown')
    expect(play).not.toMatch(/exactly `id` and `title` frontmatter/i)
    expect(play).not.toMatch(/followed by the priority body/i)
    expect(routes).toContain('createPriorityFiles')
    expect(priorityAuthoring).toContain('composePriorityMarkdown')
    expect(priorityAuthoring).not.toMatch(/function\s+composePriorityMarkdown/)
    expect(priorityAuthoring).not.toMatch(/return `---\\nid: \$\{input\.id\}\\ntitle: \$\{input\.title\}\\n---/)
  })

  test('the all-persona routing guide owns the live target taxonomy', () => {
    const guide = read('docs/oz-improvement-routing.md')
    // The live routing taxonomy is the FOUR zones in ARCHITECTURE.md "Oz improvement routing".
    // `workspace-local` was retired (no live home in ARCHITECTURE/ADRs/code); the doc and this test
    // dropped it together. (The lingering `workspace-local` in ADR-0027 is the unrelated display-number
    // concept, not a routing zone.)
    const targets = [
      'cocoder-product',
      'workspace-shared',
      'install-local',
      'upstream-candidate',
    ]

    expect(guide).toContain('# Routing Guide')
    expect(guide).toContain('Oz, Oscar, Deb, and Bob')
    expect(guide).toContain('## First Cut: Product Or Workspace')
    expect(guide).toContain('## Kind Of Change')
    expect(guide).toContain('Product')
    expect(guide).toContain('Workspace')
    expect(targets.filter((target) => guide.includes(`\`${target}\``))).toEqual(targets)
    expect(guide).toContain('ADR-0012 portability test')
  })

  test('shared standards point at the single live routing guide instead of restating it', () => {
    const sharedStandards = read('packages/personas/base/shared-standards.md')
    const routingGuideOwners = liveMarkdownFiles()
      .filter((rel) => !rel.startsWith('cocoder/zArchive/'))
      .filter((rel) => {
        const text = read(rel)
        return /^# .*Routing Guide\b/m.test(text) || /routing[-_ ]guide/i.test(rel)
      })

    expect(routingGuideOwners).toEqual(['docs/oz-improvement-routing.md'])
    expect(sharedStandards).toContain('docs/oz-improvement-routing.md')
    expect(sharedStandards).toContain('the single Routing Guide')
    expect(sharedStandards).not.toContain('| `cocoder-product` |')
    expect(sharedStandards).not.toContain('| `workspace-shared` |')
  })

  test('design-ref is guarded as a historical reference, not a live app source', () => {
    const readme = read('packages/ui/design-ref/README.md')

    expect(readme).toContain('Historical reference')
    expect(readme).toContain('packages/ui/src/renderer')
    expect(readme).not.toMatch(/source of truth for \*what\* to build/i)
  })

  test('build-loop directives expose no second Deb repair lane', () => {
    expect(parseDirective(JSON.stringify({ kind: 'delegate', task: 'ship the atom' })).kind).toBe('delegate')
    expect(parseDirective(JSON.stringify({ kind: 'wrapup', pickup: 'resume here' })).kind).toBe('wrapup')
    expect(() => parseDirective(JSON.stringify({ kind: 'deb-investigate', blocker: 'Oscar found a machinery problem' }))).toThrow(
      'directive: "kind" must be "delegate" or "wrapup"',
    )

    const directiveKinds = ['delegate', 'wrapup'] as const
    expect(directiveKinds).toEqual(['delegate', 'wrapup'])
    expect(read('packages/core/src/runner/prompts.ts')).not.toContain('deb-investigate')
  })
})
