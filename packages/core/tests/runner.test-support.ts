import { readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect } from 'vitest'
import {
  type FounderCloseoutContract,
  type Play,
  type PlayAssignment,
  type ResolvedPersona,
  validatePlayOutput,
} from '../src/index.js'

export const persona = (over: Partial<ResolvedPersona> & { id: string; cli: string }): ResolvedPersona => ({
  label: over.id,
  role: 'r',
  writeScope: [],
  body: `${over.id} body`,
  model: '',
  ...over,
})

export const oscar = persona({ id: 'oscar', cli: 'claude', writeScope: [] })
export const bob = persona({ id: 'bob', cli: 'codex', writeScope: ['packages/**'] })
export const deb = persona({ id: 'deb', cli: 'claude', writeScope: [] })
export const priority = { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'do the small thing', objective: 'do the small thing' }
export const workspaceRoot = join(tmpdir(), `cocoder-runner-unit-repo-${process.pid}`)
export const workspace = { id: 'cocoder', path: workspaceRoot, name: 'CoCoder' }

beforeAll(async () => {
  await mkdir(join(workspaceRoot, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(workspaceRoot, 'cocoder', 'tickets', 'open'), { recursive: true })
  await writeFile(join(workspaceRoot, 'cocoder', 'priorities', 'demo.md'), '# Demo\n')
  await writeFile(join(workspaceRoot, 'cocoder', 'tickets', 'open', '0015-demo-ticket.md'), '# Demo ticket\n')
})

afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const wrapPlayRaw = readFileSync(join(repoRoot, 'packages', 'personas', 'base', 'plays', 'wrap-up.md'), 'utf8')
const wrapPlayBody = wrapPlayRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
export const wrapPlay: Play = {
  id: 'wrap-up',
  label: 'Wrap-up',
  kind: 'headless',
  outputValidator: { ref: 'validators/founder-closeout' },
  writeScope: ['docs/**'],
  body: wrapPlayBody,
}
export const wrapPlayAssignment: PlayAssignment = { cli: 'cursor-agent', model: 'cheap-wrap' }

export type FounderCloseoutRole =
  | 'title'
  | 'atomComplete'
  | 'runStatus'
  | 'whatChanged'
  | 'whatRemains'
  | 'nextStep'
  | 'decisionNeeded'
  | 'commitState'
  | 'teardownReadiness'
  | 'judgment'

const founderCloseoutRole = (labelText: string): FounderCloseoutRole | null => {
  const normalized = labelText
    .replace(/\*/g, '')
    .replace(/:/g, '')
    .trim()
    .toLowerCase()
  if (normalized === 'founder completion brief') return 'title'
  if (normalized === 'atom complete') return 'atomComplete'
  if (normalized === 'run status') return 'runStatus'
  if (normalized === 'what changed') return 'whatChanged'
  if (normalized === 'what remains') return 'whatRemains'
  if (normalized === 'recommended next step') return 'nextStep'
  if (normalized === 'founder decision needed') return 'decisionNeeded'
  if (normalized === 'commit state') return 'commitState'
  if (normalized === 'teardown readiness') return 'teardownReadiness'
  if (normalized === 'judgment') return 'judgment'
  return null
}

const founderCloseoutContract = (playBody: string): { labels: Record<FounderCloseoutRole, string>; orderedRoles: readonly FounderCloseoutRole[]; finalLine: string } => {
  const fence = playBody.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error('test wrap-up Play is missing a fenced founder closeout contract')
  const sections = [...fence[1].matchAll(/^\*\*[^*\n]+?\*\*\s*$/gm)].map((match) => match[0].trim())
  const roleEntries = sections.flatMap((section): readonly [FounderCloseoutRole, string][] => {
    const role = founderCloseoutRole(section)
    return role ? [[role, section]] : []
  })
  const labels = Object.fromEntries(roleEntries) as Partial<Record<FounderCloseoutRole, string>>
  const finalLine = fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (
    !labels.title ||
    !labels.atomComplete ||
    !labels.runStatus ||
    !labels.whatChanged ||
    !labels.whatRemains ||
    !labels.nextStep ||
    !labels.decisionNeeded ||
    !labels.commitState ||
    !labels.teardownReadiness ||
    !labels.judgment ||
    !finalLine ||
    finalLine.startsWith('**')
  ) {
    throw new Error('test wrap-up Play founder closeout contract is malformed')
  }
  return {
    labels: labels as Record<FounderCloseoutRole, string>,
    orderedRoles: roleEntries.map(([role]) => role),
    finalLine,
  }
}

const closeoutContract = founderCloseoutContract(wrapPlayBody)
export const label = (role: FounderCloseoutRole): string => closeoutContract.labels[role]
export const issue = (role: FounderCloseoutRole, text: string): string => `${label(role)} ${text}`
export const block = (role: FounderCloseoutRole, text: string): string => `${label(role)}\n${text}`
export const renderFounderCloseout = (input: {
  summary?: string
  atomComplete?: string
  runStatus?: string
  whatRemains?: string
  nextStep?: string
  decisionNeeded?: string
  commitState?: string
  teardownReadiness?: string
  judgment?: string
  finalLine?: string
} = {}): string => {
  const content: Record<FounderCloseoutRole, string> = {
    title: '',
    atomComplete: input.atomComplete ?? 'Yes',
    runStatus: input.runStatus ?? 'continue',
    whatChanged: input.summary ?? 'The requested work was completed.',
    whatRemains: input.whatRemains ?? '- Continue the remaining priority atoms.',
    nextStep: input.nextStep ?? 'Priority: `demo` — continue the remaining priority atoms',
    decisionNeeded: input.decisionNeeded ?? 'None.',
    commitState: input.commitState ?? 'Committed — 1 commit was recorded by the runner.',
    teardownReadiness: input.teardownReadiness ?? 'Standing by; teardown requires an explicit founder request.',
    judgment: input.judgment ?? 'Oscar stopped at a clean wrap-up point.',
  }
  const body = closeoutContract.orderedRoles
    .map((role) => (role === 'title' ? label(role) : block(role, content[role])))
    .join('\n\n')
  return `${body}\n\n${input.finalLine ?? closeoutContract.finalLine}\n`
}
export const validFounderCloseout = (summary = 'The requested work was completed.'): string => renderFounderCloseout({ summary })

export const validatedCloseoutContract = (): FounderCloseoutContract => {
  const result = validatePlayOutput({ play: wrapPlay, output: validFounderCloseout(), cwd: workspaceRoot })
  if (!result?.founderCloseoutContract) throw new Error('wrap-up Play did not produce a founder closeout contract')
  expect(result.issues).toEqual([])
  return result.founderCloseoutContract
}
