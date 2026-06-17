// Onboarding Playbook loader (ADR-0020). Playbooks are shipped with the base personas
// package and passed in by directory so core never reaches into @cocoder/personas itself.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'

export type OnboardingPlaybookMode = 'bootstrap' | 'takeover' | 'drift'

type MajorPhaseId = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7'
type LowercaseLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'

export type OnboardingPlaybookPhaseId = MajorPhaseId | `${MajorPhaseId}${LowercaseLetter}`

export type PlaybookPhaseKind =
  | 'scaffold'
  | 'intake'
  | 'recon'
  | 'founder-gate'
  | 'deep-read-fanout'
  | 'cross-check'
  | 'founder-question'
  | 'synthesize'
  | 'stack-starter'
  | 'ratify'
  | 'prove'
  | 'drift-read-claims'
  | 'drift-read-reality'
  | 'drift-compare'
  | 'drift-report'
  | 'drift-apply'

export interface OnboardingPlaybookPhase {
  readonly id: OnboardingPlaybookPhaseId
  readonly title: string
  readonly kind: PlaybookPhaseKind
  readonly founderGate: boolean
  readonly output: string
}

export interface OnboardingPlaybook {
  readonly id: string
  readonly title: string
  readonly mode: OnboardingPlaybookMode
  readonly writeScope: readonly string[]
  readonly modelPin: string
  readonly objective: string | null
  readonly phases: readonly OnboardingPlaybookPhase[]
}

const phaseKindByTitle = new Map<string, PlaybookPhaseKind>([
  ['adversarial cross-check', 'cross-check'],
  ['apply', 'drift-apply'],
  ['compare', 'drift-compare'],
  ['dual-source deep read', 'deep-read-fanout'],
  ['founder questions', 'founder-question'],
  ['intake conversation', 'intake'],
  ['optional stack starter', 'stack-starter'],
  ['prove', 'prove'],
  ['ratify', 'ratify'],
  ['read claims', 'drift-read-claims'],
  ['read reality', 'drift-read-reality'],
  ['recon', 'recon'],
  ['report', 'drift-report'],
  ['scaffold', 'scaffold'],
  ['seed minimal governance', 'synthesize'],
  ['synthesize', 'synthesize'],
])

function parseObjective(body: string): string | null {
  const heading = /^##\s+Objective\s*$/im.exec(body)
  if (!heading) return null
  const rest = body.slice(heading.index + heading[0].length)
  const nextHeading = /^#{1,2}\s+/m.exec(rest)
  const objective = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim()
  return objective === '' ? null : objective
}

function asString(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asMode(value: string | string[] | undefined): OnboardingPlaybookMode | null {
  return value === 'bootstrap' || value === 'takeover' || value === 'drift' ? value : null
}

function asWriteScope(value: string | string[] | undefined): readonly string[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value === '') return null
  const inlineList = value.match(/^\[(.*)\]$/)
  if (!inlineList) return [value]
  const items = inlineList[1]!
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter((item) => item !== '')
  return items.length > 0 ? items : null
}

function normalizePhaseTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

function stripMarkdownEmphasis(value: string): string {
  return value.trim().replace(/\*\*/g, '')
}

function parseMarkdownTableRow(line: string): readonly string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function asPhaseId(value: string): OnboardingPlaybookPhaseId | null {
  return /^P[0-7][a-z]?$/.test(value) ? (value as OnboardingPlaybookPhaseId) : null
}

function parsePhaseCell(cell: string): { readonly id: OnboardingPlaybookPhaseId; readonly title: string } | null {
  const text = stripMarkdownEmphasis(cell)
  const [rawId, ...titleParts] = text.split('·')
  if (!rawId || titleParts.length === 0) return null
  const id = asPhaseId(rawId.trim())
  const title = titleParts.join('·').trim()
  if (!id || title === '') return null
  return { id, title }
}

function parseBakedPlaybookPhases(body: string): readonly OnboardingPlaybookPhase[] | null {
  const heading = /^##\s+The baked Playbook\s*$/im.exec(body)
  if (!heading) return null
  const rest = body.slice(heading.index + heading[0].length)
  const nextHeading = /^##\s+/m.exec(rest)
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest
  const lines = section.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => {
    const cells = parseMarkdownTableRow(line)
    return cells !== null && cells[0]?.toLowerCase() === 'phase'
  })
  if (headerIndex < 0) return null
  const separatorCells = parseMarkdownTableRow(lines[headerIndex + 1] ?? '')
  if (!separatorCells || !isSeparatorRow(separatorCells)) return null

  const phases: OnboardingPlaybookPhase[] = []
  for (const line of lines.slice(headerIndex + 2)) {
    const cells = parseMarkdownTableRow(line)
    if (!cells) break
    if (cells.length < 4) return null
    const phase = parsePhaseCell(cells[0]!)
    if (!phase) return null
    const kind = phaseKindByTitle.get(normalizePhaseTitle(phase.title))
    if (!kind) return null
    phases.push({
      id: phase.id,
      title: phase.title,
      kind,
      founderGate: cells[2]!.includes('▸'),
      output: cells[3]!.trim(),
    })
  }

  return phases.length > 0 ? phases : null
}

function loadPlaybook(file: string, id: string): OnboardingPlaybook | null {
  try {
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'))
    if (data.type !== 'onboarding-playbook' || data.id !== id) return null
    const title = asString(data.title)
    const mode = asMode(data.mode)
    const writeScope = asWriteScope(data.writeScope)
    const modelPin = asString(data.modelPin)
    const phases = parseBakedPlaybookPhases(body)
    if (!title || !mode || !writeScope || !modelPin || !phases) return null
    return { id, title, mode, writeScope, modelPin, objective: parseObjective(body), phases }
  } catch {
    return null
  }
}

export function loadOnboardingPlaybooks(playbooksDir: string): readonly OnboardingPlaybook[] {
  try {
    if (!existsSync(playbooksDir) || !statSync(playbooksDir).isDirectory()) return []
    return readdirSync(playbooksDir)
      .filter((entry) => entry.endsWith('.md'))
      .sort()
      .map((entry) => {
        const id = entry.slice(0, -'.md'.length)
        return loadPlaybook(join(playbooksDir, entry), id)
      })
      .filter((playbook): playbook is OnboardingPlaybook => playbook !== null)
  } catch {
    return []
  }
}
