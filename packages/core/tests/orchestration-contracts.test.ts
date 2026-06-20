import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8')

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

  test('ticket authoring surfaces derive markdown from the core ticket composer', () => {
    const play = read('packages/personas/base/plays/create-ticket.md')
    const routes = read('packages/daemon/src/routes.ts')

    expect(play).toContain('composeTicketMarkdown')
    expect(play).not.toMatch(/```\s*---\s*\nid:/)
    expect(routes).toContain('composeTicketMarkdown')
  })

  test('priority authoring surfaces derive markdown from the core priority composer', () => {
    const play = read('packages/personas/base/plays/create-priority.md')
    const routes = read('packages/daemon/src/routes.ts')

    expect(play).toContain('composePriorityMarkdown')
    expect(play).not.toMatch(/exactly `id` and `title` frontmatter/i)
    expect(play).not.toMatch(/followed by the priority body/i)
    expect(routes).toContain('composePriorityMarkdown')
    expect(routes).not.toMatch(/function\s+composePriorityMarkdown/)
    expect(routes).not.toMatch(/return `---\\nid: \$\{input\.id\}\\ntitle: \$\{input\.title\}\\n---/)
  })

  test('design-ref is guarded as a historical reference, not a live app source', () => {
    const readme = read('packages/ui/design-ref/README.md')

    expect(readme).toContain('Historical reference')
    expect(readme).toContain('packages/ui/src/renderer')
    expect(readme).not.toMatch(/source of truth for \*what\* to build/i)
  })
})
