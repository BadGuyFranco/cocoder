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

  test('ticket authoring surfaces derive markdown from the core ticket composer', () => {
    const play = read('packages/personas/base/plays/create-ticket.md')
    const routes = read('packages/daemon/src/routes.ts')

    expect(play).toContain('composeTicketMarkdown')
    expect(play).not.toMatch(/```\s*---\s*\nid:/)
    expect(routes).toContain('composeTicketMarkdown')
  })

  test('design-ref is guarded as a historical reference, not a live app source', () => {
    const readme = read('packages/ui/design-ref/README.md')

    expect(readme).toContain('Historical reference')
    expect(readme).toContain('packages/ui/src/renderer')
    expect(readme).not.toMatch(/source of truth for \*what\* to build/i)
  })
})
