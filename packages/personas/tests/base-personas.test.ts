import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { basePersonasDir, basePlaysDir } from '../src/index.js'

const BASE_PERSONA_FILES = ['bob.md', 'deb.md', 'oscar.md', 'oz.md', 'quinn.md', 'shared-standards.md'] as const
const FRONTMATTER_PERSONA_FILES = ['bob.md', 'deb.md', 'oscar.md', 'oz.md', 'quinn.md'] as const
const NEW_BASE_PLAY_FILES = ['documentation.md', 'code-review.md', 'electron-test.md', 'write-tests.md', 'run-tests.md'] as const
const READ_ONLY_BASE_PLAY_FILES = ['code-review.md', 'electron-test.md', 'run-tests.md'] as const
const PRIORITY_AUTHORING_PLAY_COMMANDS = [
  ['create-priority.md', 'create-priority', 'cocoder oz create-priority'],
  ['edit-priority.md', 'edit-priority', 'cocoder oz edit-priority'],
  ['archive-priority.md', 'archive-priority', 'cocoder oz archive-priority'],
] as const
const templatePrioritiesDir = (): string => join(basePersonasDir(), '..', '..', '..', 'templates', 'workspace-cocoder', 'cocoder', 'priorities')
const dogfoodBobDeltaPath = (): string => join(basePersonasDir(), '..', '..', '..', 'cocoder', 'personas', 'deltas', 'bob.md')

const frontmatterValue = (text: string, key: string): string | null => {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.replace(/^["']|["']$/g, '') ?? null
}

const frontmatterList = (text: string, key: string): string[] => {
  const match = text.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm'))
  return match?.[1]?.split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^\s*-\s+/, '')) ?? []
}

const singleLine = (text: string): string => text.replace(/\s+/g, ' ')

const fencedBlocks = (text: string): string[] => [...text.matchAll(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g)].map((match) => match[1] ?? '')

const founderCloseoutContract = (text: string): { block: string; sections: string[]; finalLine: string } => {
  const block = fencedBlocks(text)[0]
  if (!block) throw new Error('wrap-up Play is missing a fenced founder closeout contract')
  const sections = block.match(/\*\*[^*\n]+?\*\*/g) ?? []
  const finalLine = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (sections.length < 10 || !finalLine || finalLine.startsWith('**')) {
    throw new Error('wrap-up Play founder closeout contract is malformed')
  }
  return { block, sections: sections.slice(0, 10), finalLine }
}

const founderCloseoutSection = (block: string, sections: string[], section: string): string => {
  const start = block.indexOf(section)
  if (start < 0) throw new Error(`wrap-up Play founder closeout contract is missing ${section}`)
  const contentStart = start + section.length
  const nextStarts = sections.map((candidate) => block.indexOf(candidate, contentStart)).filter((index) => index >= 0)
  const contentEnd = nextStarts.length > 0 ? Math.min(...nextStarts) : block.length
  return block.slice(contentStart, contentEnd).trim()
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

  test('dogfood Bob can author CoCoder product and tooling surfaces without owning workspace governance', () => {
    const text = readFileSync(dogfoodBobDeltaPath(), 'utf8')
    const scope = frontmatterList(text, 'writeScope')

    expect(scope).toEqual(expect.arrayContaining(['packages/**', 'templates/**', 'docs/**', 'ARCHITECTURE.md']))
    expect(scope).toEqual(expect.arrayContaining(['package.json', 'pnpm-lock.yaml', 'eslint.config.*', 'scripts/**']))
    expect(scope).not.toContain('cocoder/**')
    expect(text).toContain('CoCoder product and tooling surfaces')
    expect(text).toContain('governance under `cocoder/**` remains outside Bob')
  })

  test('Deb base scope covers the governance surfaces incl. tickets (ADR-0016 recurrence escalation)', () => {
    const text = readFileSync(join(basePersonasDir(), 'deb.md'), 'utf8')
    const scope = frontmatterList(text, 'writeScope')
    expect(scope).toEqual(expect.arrayContaining(['cocoder/priorities/**', 'cocoder/decisions/**', 'cocoder/personas/**', 'cocoder/tickets/**']))
    expect(text).toContain('The interference rail (ADR-0041 §3.1)')
    expect(text).toContain('Direct a minor, NON-INTERFERING self-fix')
    expect(text).toContain('Make orchestration repairs stick')
    expect(text).toContain('refuses to commit any non-`.md` change')
    expect(text).toContain('read-only Oscar/Bob terminal snapshot first')
    expect(text).toContain('status feed for routing')
    expect(text).toContain('Reading the runner-provided terminal snapshot is allowed')
    expect(text).not.toContain('it is your eyes')
    expect(text).toContain('Repair evidence')
  })

  test('Deb services Oscar-initiated repair dialogues without turning them into run rescue', () => {
    const text = readFileSync(join(basePersonasDir(), 'deb.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('Service Oscar-initiated repair dialogues (ADR-0036)')
    expect(normalized).toContain('proactive entry into your overseer authority')
    expect(normalized).toContain('including after Oscar has wrapped')
    expect(normalized).toContain('apply an easy, **non-interfering `.md` self-fix**, committed through the governed spine')
    expect(normalized).toContain('return a proposal for Oscar to evaluate and direct')
    expect(normalized).toContain('Any interfering (code/runner) change is held for the')
    expect(normalized).toContain('you never direct Bob, and a repair is never a run rescue')
  })

  test('Deb routes tracked ticket closure through the governed close spine', () => {
    const text = readFileSync(join(basePersonasDir(), 'deb.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('route ticket closure through `closeTicket()` or the governed close spine')
    expect(normalized).toContain('instead of moving the file into `cocoder/tickets/closed/`, rewriting `status:` to Closed, or hand-editing the tickets `INDEX.md`/`order.json`')
    expect(normalized).toContain('Hand-closing is forbidden because it bypasses `order.json` pruning')
    expect(normalized).toContain('leave the ticket open for the run-success close path')
  })

  test('shared standards require owner-mapped durable orchestration changes', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')
    const normalized = singleLine(text)

    expect(text).toContain('Durable Orchestration Changes')
    expect(normalized).toContain('Before changing orchestration behavior, do an owner map')
    expect(normalized).toContain('A prompt-only change is incomplete')
    expect(normalized).toContain('must not copy its labels, fields, allowed values, or section order into a second local contract')
    expect(normalized).toContain('commit the verified in-scope fix yourself')
    expect(normalized).toContain('Read-only runner/session-host artifacts, such as terminal snapshots explicitly handed to you by the runner, are evidence files and may be read')
    expect(normalized).toContain('do not grant permission to focus, attach to, type into, close, or otherwise operate')
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

  test('shared standards require launch smoke and artifact evidence before green claims', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('only a real launch smoke with a bounded watchdog and missing-artifact rejection proves launchability')
    expect(normalized).toContain('read the actual command exit code and verify a real artifact by path, size, and timestamp')
    expect(normalized).toContain('one cancellation cannot silently skip the rest')
  })

  test('shared standards guide nuanced design-seam discussions with prose and one question', () => {
    const text = readFileSync(join(basePersonasDir(), 'shared-standards.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('On consequential architecture seams, lead with honest reasoning plus one focused open question')
    expect(normalized).toContain('Reserve multiple-choice for genuinely crisp, bounded picks')
    expect(normalized).toContain('suspect the question is wrong, not just the options')
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

  test('Oscar routes base persona and Play governance through verified repair, not blind support scope', () => {
    const text = readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('packages/personas/base/**')
    expect(normalized).toContain('are Surface-A governance')
    expect(normalized).toContain('do not refuse it as "product code"')
    expect(normalized).toContain('route it through a verified run or Deb repair')
  })

  test('Oscar initiates proactive Deb repair dialogues outside the build loop', () => {
    const text = readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('Proactively initiate Oscar-Deb machinery repair (ADR-0036)')
    expect(normalized).toContain('including after you have wrapped')
    expect(normalized).toContain('cocoder oz request-deb-repair <workspaceId> --problem <text>')
    expect(normalized).toContain('not a within-run directive and not the Bob build loop')
    expect(normalized).toContain('the propose->evaluate->direct handshake')
    expect(normalized).toContain('Genuinely risky or hard-to-reverse machinery changes escalate one tier further to the founder')
    expect(normalized).toContain('never rescues a formally failed run')
    expect(normalized).toContain('no second commit lane')
    expect(normalized).toContain("does not replace your per-atom verify gate over Bob's product work")
  })

  test('Oscar offers adversarial plan review before substantial build plans', () => {
    const text = readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('Before a substantial build or refactor, offer or run a focused review')
    expect(normalized).toContain("against the project's own decisions and failure history")
    expect(normalized).toContain('Use heavyweight multi-agent workflows for review and verification')
  })

  test('Oscar routes confirmed priority archives through the archive-priority Play owner', () => {
    const text = readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('founder explicitly confirms archive')
    expect(normalized).toContain('do not use a native harness Skill')
    expect(normalized).toContain('a builder directive, a raw file move, or post-wrap support commit')
    expect(normalized).toContain('Use the single archive-priority Play owner')
    expect(normalized).toContain('call the `author` tool with `play: "archive-priority"`')
    expect(normalized).toContain('pnpm --dir <install-root> exec cocoder oz archive-priority <priorityId>')
    expect(normalized).toContain('commits through the daemon-backed governance spine')
  })

  test('Bob completion evidence rejects unproven launch and artifact green claims', () => {
    const text = readFileSync(join(basePersonasDir(), 'bob.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('Do not report launchability from build, typecheck, or unit-test success alone')
    expect(normalized).toContain('prove it with a bounded launch smoke when launch is claimed')
    expect(normalized).toContain('verify the artifact by path, size, and timestamp')
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

  test('testing plays are callable by every base persona except retired testing roles', () => {
    for (const file of ['write-tests.md', 'run-tests.md']) {
      const text = readFileSync(join(basePlaysDir(), file), 'utf8')
      const callers = frontmatterList(text, 'allowedCallers')

      expect(callers).toEqual(['oz', 'oscar', 'bob', 'deb', 'quinn'])
      expect(callers).not.toContain('talia')
      expect(callers).not.toContain('*')
    }
  })

  test('priority authoring Plays document their daemon-backed executable lanes', () => {
    for (const [file, playId, command] of PRIORITY_AUTHORING_PLAY_COMMANDS) {
      const text = readFileSync(join(basePlaysDir(), file), 'utf8')
      const normalized = singleLine(text)

      expect(normalized).toContain(`author\` tool call with \`play: "${playId}"`)
      expect(normalized).toContain(command)
      expect(normalized).toContain(`POST /workspaces/:id/authoring-plays/${playId}`)
    }
  })

  test('create-ticket Play documents both governed creation lanes', () => {
    const text = readFileSync(join(basePlaysDir(), 'create-ticket.md'), 'utf8')
    const normalized = singleLine(text)

    expect(normalized).toContain('POST /workspaces/:id/authoring-plays/create-ticket')
    expect(normalized).toContain('cocoder oz create-ticket')
    expect(normalized).toContain('calls the core `createTicket()` spine directly')
    expect(normalized).toContain('not a reason to hand-edit ticket files, `INDEX.md`, or `order.json`')
  })

  test('wrap-up keeps the Recommended Next Step label to one runnable action (F18)', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')

    expect(text).toContain('**Recommended Next Step**')
    expect(text).toContain('Exactly one ready work item')
    expect(text).toContain('Name exactly one `Next Action`')
    expect(text).toContain('could a solo non-developer DO it from this one line')
    expect(text).toContain('Do not use "awaiting questions"')
  })

  // Historical ADR-0022 proof lineage: the wrap-up Play is the SINGLE owner of the founder closeout format.
  // Pin the founder-facing section contract so no surface can silently drift a parallel shape.
  test('wrap-up Play pins the canonical founder closeout contract (single owner)', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
    const contract = founderCloseoutContract(text)

    expect(fencedBlocks(text)).toHaveLength(1)
    expect(contract.sections).toHaveLength(10)
    for (const section of contract.sections) {
      expect(text).toContain(section)
    }
    for (let i = 1; i < contract.sections.length; i += 1) {
      expect(text.indexOf(contract.sections[i])).toBeGreaterThan(text.indexOf(contract.sections[i - 1]))
    }
    expect(text).toContain(`End with exactly \`${contract.finalLine}\``)
  })

  test('wrap-up Play pins target-aware Run Status vocabulary in the single contract', () => {
    const text = readFileSync(join(basePlaysDir(), 'wrap-up.md'), 'utf8')
    const contract = founderCloseoutContract(text)
    const runStatus = contract.sections.find((section) => section.replaceAll('*', '') === 'Run Status')
    if (!runStatus) throw new Error('wrap-up Play founder closeout contract is missing Run Status')

    const content = founderCloseoutSection(contract.block, contract.sections, runStatus)

    expect([...contract.block.matchAll(/^\*\*Run Status\*\*$/gm)]).toHaveLength(1)
    expect(content).toContain('Priority-launched run: continue | blocked | archive ready.')
    expect(content).toContain('Ticket-launched run: needs another run | closed | needs closing | blocked.')
    expect(content).toContain('`archive ready` applies only to priority-launched runs')
    expect(content).toContain('`closed` is only for a verified-complete ticket fix closed through `closeTicket()`')
    expect(content).toContain('Use `needs closing` only with a non-None Founder Decision Needed')
    expect(content).toContain('Never leave a verified-fixed ticket implicitly waiting for teardown')
    expect(content).toContain('Do not map ticket `closed` onto priority `archive ready`')
  })

  // Historical ADR-0022 proof lineage: Oscar must defer to the wrap-up Play's contract, not restate one.
  test('oscar defers to the wrap-up Play as the closeout-brief owner', () => {
    const text = readFileSync(join(basePersonasDir(), 'oscar.md'), 'utf8')
    expect(text).toContain("wrap-up Play's closeout-brief contract")
    expect(text).toContain('wait for the runner\'s `WRAP-UP READY`')
    expect(text).toContain('Do not manually deliver a\n   founder closeout before that runner delivery')
    expect(text).not.toContain('Report back to the founder in the standardized format')
    expect(text).not.toContain('Report back to the founder using the wrap-up Play')
  })
})

describe('workspace priority templates', () => {
  test('resolves to the shipped priority template directory', () => {
    const dir = templatePrioritiesDir()

    expect(statSync(dir).isDirectory()).toBe(true)
  })

  test('ships a product-generic ad-hoc session template', () => {
    const dir = templatePrioritiesDir()
    const text = readFileSync(join(dir, 'adhoc-session.md'), 'utf8')

    expect(frontmatterValue(text, 'id')).toBe('adhoc-session')
    expect(frontmatterValue(text, 'title')).toBe('Session without a named priority')
    expect(text).toContain('## Objective')
    expect(text).not.toMatch(/CoBuilder|CoCoder|dogfood/i)
  })
})
