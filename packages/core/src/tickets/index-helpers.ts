import { readFile } from 'node:fs/promises'

export function ticketIndexSkeleton(): string {
  return [
    '# Tickets — Index',
    '',
    '## Open',
    '',
    '| ID | Title | Type | Priority | Owner |',
    '|---|---|---|---|---|',
    '',
    '## Recently Closed',
    '',
    '| ID | Title | Type | Closed | Resolution |',
    '|---|---|---|---|---|',
    '',
  ].join('\n')
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { readonly code?: unknown }).code === 'string'
    ? (error as { readonly code: string }).code
    : null
}

export async function readTicketIndex(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return ticketIndexSkeleton()
    throw error
  }
}

export function ticketTableCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

function sectionBounds(lines: readonly string[], heading: string): { start: number; end: number } {
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) throw new Error(`tickets INDEX.md is missing ${heading}`)
  const nextHeading = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return { start, end: nextHeading === -1 ? lines.length : nextHeading }
}

function separatorIndex(lines: readonly string[], heading: string): number {
  const bounds = sectionBounds(lines, heading)
  const separator = lines.findIndex((line, index) => index > bounds.start && index < bounds.end && /^\|\s*-{3,}/.test(line.trim()))
  if (separator === -1) throw new Error(`tickets INDEX.md ${heading.replace(/^##\s+/, '')} table is missing a separator row`)
  return separator
}

export function insertOpenTicketIndexRow(indexMarkdown: string, row: string, id: string): string {
  if (indexMarkdown.includes(`| [${id}](`)) throw new Error(`ticket ${id} is already present in INDEX.md`)
  const lines = indexMarkdown.split(/\r?\n/)
  lines.splice(separatorIndex(lines, '## Open') + 1, 0, row)
  return lines.join('\n')
}

export function moveTicketIndexRowToClosed(indexMarkdown: string, input: { readonly id: string; readonly closedRow: string }): string {
  const lines = indexMarkdown.split(/\r?\n/)
  const open = sectionBounds(lines, '## Open')
  const openRowIndex = lines.findIndex((line, index) => index > open.start && index < open.end && line.includes(`| [${input.id}](`))
  if (openRowIndex === -1) return indexMarkdown
  lines.splice(openRowIndex, 1)

  if (lines.some((line) => line.includes(`| [${input.id}](./closed/`))) return lines.join('\n')
  lines.splice(separatorIndex(lines, '## Recently Closed') + 1, 0, input.closedRow)
  return lines.join('\n')
}
