import { join } from 'node:path'
import { localRunDir, resolveLocalRunDir, runDisplayName } from '@cocoder/core'
import type { OzAwarenessSnapshot } from './oz-awareness.js'

type ContextPointerType = 'priority' | 'ticket' | 'run'

export type ContextPointerInput =
  | { readonly kind: 'founder'; readonly text: string }
  | { readonly kind: 'tool-result'; readonly result: string }
  | { readonly kind: 'tool-budget-exhausted'; readonly result: string }

export interface ContextPointerDirs {
  readonly prioritiesDir: string
  readonly ticketsDir: string
  readonly runsRoot: string
}

export interface ParsedPromptInput {
  readonly body: string
  readonly requestedContext: string | null
}

interface ContextPointer {
  readonly type: ContextPointerType
  readonly id: string
  readonly label: string
}

interface ParsedFounderBody {
  readonly body: string
  readonly pointer: ContextPointer | null
}

interface ResolvedContextPointer {
  readonly pointer: ContextPointer
  readonly slugLabel: string
  readonly filePath: string | null
  readonly note: string
}

export function parsePromptInput(input: ContextPointerInput, awareness: OzAwarenessSnapshot, dirs: ContextPointerDirs): ParsedPromptInput {
  const parsed = parseFounderBody(input)
  return {
    body: parsed.body,
    requestedContext: parsed.pointer ? formatRequestedContext(resolveContextPointer(awareness, dirs, parsed.pointer)) : null,
  }
}

function parseFounderBody(input: ContextPointerInput): ParsedFounderBody {
  if (input.kind !== 'founder') return { body: input.result, pointer: null }

  const body = input.text.trim()
  const match = /^\[context: (priority|ticket|run) ([^\s\]]+) — ([^\]\r\n]+)\](?:\r?\n|$)/.exec(body)
  if (!match) return { body, pointer: null }

  return {
    body: body.slice(match[0].length).trim(),
    pointer: { type: match[1] as ContextPointerType, id: match[2]!, label: match[3]!.trim() },
  }
}

function resolveContextPointer(awareness: OzAwarenessSnapshot, dirs: ContextPointerDirs, pointer: ContextPointer): ResolvedContextPointer {
  if (pointer.type === 'priority') {
    const priority = awareness.priorities.find((item) => item.id === pointer.id)
    return priority
      ? {
          pointer,
          slugLabel: `${priority.id} — ${priority.title}`,
          filePath: join(dirs.prioritiesDir, `${priority.id}.md`),
          note: 'Resolved from the loaded priorities digest.',
        }
      : unresolved(pointer, `No priority with id "${pointer.id}" appears in the loaded awareness snapshot.`)
  }

  if (pointer.type === 'ticket') {
    const ticket = awareness.openTickets.find((item) => item.id === pointer.id)
    return ticket
      ? {
          pointer,
          slugLabel: `${ticket.id} — ${ticket.title}`,
          filePath: join(dirs.ticketsDir, 'open', `${ticket.id}-${slugifyTitle(ticket.title) || 'ticket'}.md`),
          note: 'Resolved from the loaded open tickets digest.',
        }
      : unresolved(pointer, `No open ticket with id "${pointer.id}" appears in the loaded awareness snapshot.`)
  }

  const run = awareness.recentRuns.find((item) => item.id === pointer.id)
  return run
    ? {
        pointer,
        slugLabel: run.ticketId ? `${runDisplayName(run)} — ticket ${run.ticketId}` : run.playbookId ? `${runDisplayName(run)} — playbook ${run.playbookId}` : `${runDisplayName(run)} — priority ${run.priorityId}`,
        filePath: resolveLocalRunDir(dirs.runsRoot, run.id) ?? localRunDir(dirs.runsRoot, run),
        note: 'Resolved from the loaded run digest.',
      }
    : unresolved(pointer, `No run with id "${pointer.id}" appears in the loaded awareness snapshot.`)
}

function unresolved(pointer: ContextPointer, note: string): ResolvedContextPointer {
  return { pointer, slugLabel: `${pointer.id} — ${pointer.label}`, filePath: null, note }
}

function formatRequestedContext(resolved: ResolvedContextPointer): string {
  return [
    `Type: ${resolved.pointer.type}`,
    `ID: ${resolved.pointer.id}`,
    `Slug/label: ${resolved.slugLabel}`,
    `File path: ${resolved.filePath ?? 'unresolved'}`,
    `Resolution: ${resolved.note}`,
    'Instruction: Use this file path as a reference for the founder question. Read it if needed; do not assume the file body is embedded in this prompt.',
  ].join('\n')
}

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-')
}
