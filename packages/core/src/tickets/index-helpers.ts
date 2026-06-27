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

function closedTicketLink(row: string): string | null {
  const match = row.match(/\|\s*\[[^\]]+\]\((\.\/closed\/[^)]+)\)/)
  return match?.[1] ?? null
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

  const closedLink = closedTicketLink(input.closedRow)
  const alreadyIndexed = closedLink
    ? lines.some((line) => closedTicketLink(line) === closedLink)
    : lines.includes(input.closedRow)
  if (alreadyIndexed) return lines.join('\n')
  lines.splice(separatorIndex(lines, '## Recently Closed') + 1, 0, input.closedRow)
  return lines.join('\n')
}

function tableDelimiters(row: string): number[] {
  const indexes: number[] = []
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] !== '|') continue
    let slashes = 0
    for (let cursor = index - 1; cursor >= 0 && row[cursor] === '\\'; cursor -= 1) {
      slashes += 1
    }
    if (slashes % 2 === 0) indexes.push(index)
  }
  return indexes
}

export function setOpenTicketIndexPriority(indexMarkdown: string, id: string, priority: string): string {
  const lines = indexMarkdown.split(/\r?\n/)
  const open = sectionBounds(lines, '## Open')
  const rowIndex = lines.findIndex((line, index) => index > open.start && index < open.end && line.includes(`| [${id}](`))
  if (rowIndex === -1) throw new Error(`ticket ${id} is missing from INDEX.md Open section`)

  const row = lines[rowIndex]!
  const delimiters = tableDelimiters(row)
  if (delimiters.length < 6) throw new Error(`ticket ${id} INDEX.md Open row must have five columns`)

  lines[rowIndex] = `${row.slice(0, delimiters[3]! + 1)} ${ticketTableCell(priority)} ${row.slice(delimiters[4]!)}`
  return lines.join('\n')
}
