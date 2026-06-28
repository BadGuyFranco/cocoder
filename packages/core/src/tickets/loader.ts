import { readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseFrontmatter, type Frontmatter } from '../personas/frontmatter.js'

export type TicketState = 'open' | 'closed'

export interface Ticket {
  readonly id: string
  readonly title: string
  readonly type: string | null
  readonly status: string | null
  readonly priority: string | null
  readonly bindingReason?: string | null
  readonly provenance?: string | null
  readonly owner: string | null
  readonly created: string | null
  readonly state: TicketState
  readonly body: string
}

function scalar(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function stateFromDir(dir: string): TicketState {
  const state = basename(dir)
  if (state === 'open' || state === 'closed') return state
  throw new Error(`ticket directory must be named open or closed: ${dir}`)
}

function idFromFile(file: string): string {
  const id = basename(file, '.md').match(/^(\d{4})/)?.[1]
  if (!id) throw new Error(`ticket filename must start with a four-digit id: ${file}`)
  return id
}

function titleFromBody(body: string, fallback: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback
}

function hasFrontmatterBlock(raw: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(raw.replace(/^﻿/, ''))
}

function parseTicketMarkdown(raw: string): Frontmatter {
  if (hasFrontmatterBlock(raw)) return parseFrontmatter(raw)
  return { data: {}, body: raw.replace(/^﻿/, '').trim() }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function loadTicket(dir: string, file: string): Ticket {
  const path = join(dir, file)
  const state = stateFromDir(dir)
  const fallbackId = idFromFile(file)
  const { data, body } = parseTicketMarkdown(readFileSync(path, 'utf8'))
  const frontmatterId = scalar(data.id)
  if (frontmatterId !== null && frontmatterId !== fallbackId) {
    throw new Error(`ticket ${path}: frontmatter id "${frontmatterId}" != filename id "${fallbackId}"`)
  }
  return {
    id: frontmatterId ?? fallbackId,
    title: scalar(data.title) ?? titleFromBody(body, fallbackId),
    type: scalar(data.type),
    status: scalar(data.status),
    priority: scalar(data.priority),
    bindingReason: scalar(data['binding-reason']),
    provenance: scalar(data.provenance),
    owner: scalar(data.owner),
    created: scalar(data.created) ?? scalar(data.opened),
    state,
    body,
  }
}

async function readStateDir(ticketsDir: string, state: TicketState): Promise<Ticket[]> {
  const dir = join(ticketsDir, state)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const tickets: Ticket[] = []
  for (const name of names) {
    if (!name.endsWith('.md') || name === 'INDEX.md') continue
    if (!/^\d{4}.*\.md$/.test(name)) continue
    try {
      tickets.push(loadTicket(dir, name))
    } catch (error) {
      console.warn(`ticket loader: failed to load ${join(dir, name)}: ${errorMessage(error)}`)
    }
  }
  return tickets.sort((a, b) => a.id.localeCompare(b.id))
}

export async function readTickets(ticketsDir: string): Promise<Ticket[]> {
  const open = await readStateDir(ticketsDir, 'open')
  const closed = await readStateDir(ticketsDir, 'closed')
  return [...open, ...closed]
}

export async function nextTicketId(ticketsDir: string): Promise<string> {
  let max = 0
  for (const state of ['open', 'closed'] as const) {
    let names: string[]
    try {
      names = await readdir(join(ticketsDir, state))
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const n = Number(name.match(/^(\d{4})/)?.[1] ?? 0)
      if (n > max) max = n
    }
  }
  return String(max + 1).padStart(4, '0')
}
