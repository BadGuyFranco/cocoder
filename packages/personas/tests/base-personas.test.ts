import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { basePersonasDir, basePlaysDir, basePrioritiesDir } from '../src/index.js'

const BASE_PERSONA_FILES = ['bob.md', 'deb.md', 'oscar.md', 'oz.md', 'quinn.md', 'talia.md', 'shared-standards.md'] as const
const FRONTMATTER_PERSONA_FILES = ['bob.md', 'deb.md', 'oscar.md', 'oz.md', 'quinn.md', 'talia.md'] as const
const NEW_BASE_PLAY_FILES = ['documentation.md', 'code-review.md', 'electron-test.md'] as const
const READ_ONLY_BASE_PLAY_FILES = ['code-review.md', 'electron-test.md'] as const

const frontmatterValue = (text: string, key: string): string | null => {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.replace(/^["']|["']$/g, '') ?? null
}

const frontmatterList = (text: string, key: string): string[] => {
  const match = text.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm'))
  return match?.[1]?.split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^\s*-\s+/, '')) ?? []
}

const singleLine = (text: string): string => text.replace(/\s+/g, ' ')

const founderCloseoutContract = (text: string): { sections: string[]; finalLine: string } => {
  const fence = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error('wrap-up Play is missing a fenced founder closeout contract')
  const sections = fence[1].match(/\*\*[^*\n]+?\*\*/g) ?? []
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

describe('basePersonasDir', () => {
  test('resolves to the shipped base persona directory', () => {
    const dir = basePersonasDir()

    expect(statSync(dir).isDirectory()).toBe(true)
  })

  test('contains the shipped base persona files', () => {
    const dir = basePersonasDir()

    for (const file of BASE_PERSONA_FILES) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text.length).toBeGreaterThan(0)
    }
  })

  test('keeps persona definition files frontmatter-backed', () => {
    const dir = basePersonasDir()

    for (const file of FRONTMATTER_PERSONA_FILES) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text.split(/\r?\n/, 1)[0]).toBe('---')
    }
  })

  test('Deb base scope covers the governance surfaces incl. tickets (ADR-0016 recurrence escalation)', () => {
    const text = readFileSync(join(basePersonasDir(), 'deb.md'), 'utf8')
    const scope = frontmatterList(text, 'writeScope')
    expect(scope).toEqual(expect.arrayContaining(['cocoder/priorities/**', 'cocoder/decisions/**', 'cocoder/personas/**', 'cocoder/tickets/**']))
    expect(text).toContain('Default to direct repair when told about an orchestration issue')
    expect(text).toContain('Use a full Oscar/Bob/Deb run only when')
    expect(text).toContain('Make orchestration repairs stick')
    expect(text).toContain('Do not leave a low-risk orchestration fix as an')
    expect(text).toContain('Repair evidence')
  })

  test('shared standards require owner-mapped durable orchestration changes', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')
    const normalized = singleLine(text)

    expect(text).toContain('Durable Orchestration Changes')
    expect(normalized).toContain('Before changing orchestration behavior, do an owner map')
    expect(normalized).toContain('A prompt-only change is incomplete')
    expect(normalized).toContain('must not copy its labels, fields, allowed values, or section order into a second local contract')
    expect(normalized).toContain('commit the verified in-scope fix yourself')
    expect(text).toContain('high-risk')
  })

  test('shared standards publish the cross-persona elegance standard', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')
    const normalized = singleLine(text)

    expect(text).toContain('Elegance Standard')
    expect(text).toContain('correctness first, clarity second, elegance third')
    expect(text).toContain('maximum effect with minimum surface area')
    expect(normalized).toContain('without losing behavior, evidence, reversibility, or safeguards')
    expect(text).toContain('Order work so the next agent can run it')
  })

  test('shared standards stay role-neutral and avoid raw decision shorthand', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')

    expect(text).toContain("You are accountable for your role's output")
    expect(text).toContain('There is no human backstop')
    expect(text).not.toContain('You ARE the developer')
    expect(text).not.toMatch(/\bADR-\d{4}\b/)
  })

  test('Oscar base scope covers support artifacts the runner can commit at wrap', () => {
    const scope = frontmatterList(readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8'), 'writeScope')
    expect(scope).toEqual(expect.arrayContaining(['cocoder/priorities/**', 'cocoder/tickets/**', 'docs/**', 'ARCHITECTURE.md']))
  })
})

describe('basePlaysDir', () => {
  test('resolves to the shipped base plays directory', () => {
    const dir = basePlaysDir()

    expect(statSync(dir).isDirectory()).toBe(true)
  })

  test('loads and validates the seeded wrap-up play', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()

    expect(frontmatterValue(text, 'id')).toBe('wrap-up')
    expect(frontmatterValue(text, 'kind')).toBe('headless')
    expect(body.length).toBeGreaterThan(0)
    expect(frontmatterList(text, 'writeScope').length).toBeGreaterThan(0)
  })

  test('loads and validates the generic content and user-simulation plays', () => {
    for (const file of NEW_BASE_PLAY_FILES) {
      const id = file.slice(0, -3)
      const text = readFileSync(join(basePlaysDir(), file), 'utf8')
      const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()

      expect(frontmatterValue(text, 'id')).toBe(id)
      expect(frontmatterValue(text, 'label')?.length).toBeGreaterThan(0)
      expect(frontmatterValue(text, 'kind')).toBe('headless')
      expect(body.length).toBeGreaterThan(0)
      expect(body).not.toMatch(/cocoder/i)
      expect(body).not.toContain('Oz')
    }
  })

  test('read-only base plays declare an empty write scope', () => {
    for (const file of READ_ONLY_BASE_PLAY_FILES) {
      const text = readFileSync(join(basePlaysDir(), file), 'utf8')

      expect(frontmatterList(text, 'writeScope')).toEqual([])
      expect(frontmatterValue(text, 'writeScope')).toBe('[]')
    }
  })

  test('wrap-up keeps the Recommended Next Step label to one runnable action (F18)', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')

    expect(text).toContain('**Recommended Next Step:**')
    expect(text).toContain('It is exactly one ready')
    expect(text).toContain('Name exactly one `Next Action`')
    expect(text).toContain('could a solo non-developer DO it from this one line')
    expect(text).toContain('Do not use "awaiting questions"')
  })

  // ADR-0022 proof #2: the wrap-up Play is the SINGLE owner of the founder closeout format.
  // Pin the founder-facing section contract so no surface can silently drift a parallel shape.
  test('wrap-up Play pins the canonical founder closeout contract (single owner)', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
    const contract = founderCloseoutContract(text)

    expect(contract.sections).toHaveLength(10)
    for (const section of contract.sections) {
      expect(text).toContain(section)
    }
    for (let i = 1; i < contract.sections.length; i += 1) {
      expect(text.indexOf(contract.sections[i])).toBeGreaterThan(text.indexOf(contract.sections[i - 1]))
    }
    expect(text).toContain(`End with exactly \`${contract.finalLine}\``)
  })

  // ADR-0022 proof #2: Oscar must defer to the wrap-up Play's contract, not restate a parallel format.
  test('oscar defers to the wrap-up Play as the closeout-brief owner', () => {
    const text = readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8')
    expect(text).toContain("wrap-up Play's closeout-brief contract")
    expect(text).not.toContain('Report back to the founder in the standardized format')
  })
})

describe('basePrioritiesDir', () => {
  test('resolves to the shipped base priorities directory', () => {
    const dir = basePrioritiesDir()

    expect(statSync(dir).isDirectory()).toBe(true)
  })

  test('ships a product-generic ad-hoc session template', () => {
    const dir = basePrioritiesDir()
    const text = readFileSync(join(dir, 'adhoc-session.md'), 'utf8')

    expect(frontmatterValue(text, 'id')).toBe('adhoc-session')
    expect(frontmatterValue(text, 'title')).toBe('Session without a named priority')
    expect(text).toContain('## Objective')
    expect(text).not.toMatch(/CoBuilder|CoCoder|dogfood/i)
  })
})
