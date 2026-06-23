// Priority loader (ADR-0008). A priority is a flat governance .md in cocoder/priorities/:
// frontmatter {id, title, optional scopeNarrowing/auditWriteBoundary} + a body describing the goal. The
// scopeNarrowing (if present) NARROWS the builder persona's writeScope for this run; auditWriteBoundary
// is a hard commit boundary for audit-style priorities —
// referenced, not restated (no F4 fragmentation).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'

export interface Priority {
  readonly id: string
  readonly title: string
  /** Optional allow-list that narrows the builder's writeScope for this priority. */
  readonly scopeNarrowing: readonly string[] | null
  /** Optional hard commit allow-list for audit-style priorities. Omitted priorities keep ordinary commits. */
  readonly auditWriteBoundary?: readonly string[]
  /** The goal/brief the orchestrator works from. */
  readonly goal: string
  /** The structural Objective section required before launch. */
  readonly objective: string | null
}

function parseObjective(body: string): string | null {
  const heading = /^##\s+Objective\s*$/im.exec(body)
  if (!heading) return null
  const rest = body.slice(heading.index + heading[0].length)
  const nextHeading = /^#{1,2}\s+/m.exec(rest)
  const objective = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim()
  return objective === '' ? null : objective
}

function parseOptionalStringList(value: string | readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return value
  const inline = value.match(/^\[(.*)\]$/)
  if (!inline) return [value]
  const inner = inline[1]!.trim()
  if (inner === '') return []
  return inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter((item) => item !== '')
}

export function loadPriority(prioritiesDir: string, id: string): Priority {
  const file = join(prioritiesDir, `${id}.md`)
  const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'), file)
  if (data.id !== id) throw new Error(`priority ${file}: frontmatter id "${String(data.id)}" != filename id "${id}"`)
  if (typeof data.title !== 'string' || data.title === '') {
    throw new Error(`priority ${file}: frontmatter "title" must be a non-empty string`)
  }
  const scopeNarrowing = parseOptionalStringList(data.scopeNarrowing) ?? null
  const auditWriteBoundary = parseOptionalStringList(data.auditWriteBoundary)
  return { id, title: data.title, scopeNarrowing, auditWriteBoundary, goal: body, objective: parseObjective(body) }
}
