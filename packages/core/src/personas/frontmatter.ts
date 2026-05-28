// Minimal frontmatter parser for governance .md files (ADR-0008). Supports exactly the
// shapes we author — scalar `key: value`, inline empty `key: []`, and block string lists:
//   key:
//     - item
//     - item
// We author these files ourselves, so a tiny purpose-built parser beats a YAML dependency
// (Bob's "can we do it in 50 lines?"). Throws on a missing/!malformed frontmatter block.

export interface Frontmatter {
  readonly data: Record<string, string | string[]>
  readonly body: string
}

export function parseFrontmatter(md: string): Frontmatter {
  const text = md.replace(/^﻿/, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new Error('frontmatter: missing `---` delimited block at top of file')
  const [, yaml, body] = m
  const data: Record<string, string | string[]> = {}
  const lines = yaml!.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i += 1
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) throw new Error(`frontmatter: cannot parse line "${line}"`)
    const key = kv[1]!
    const rest = kv[2]!.trim()
    if (rest === '' || rest === '|') {
      // Block list: consume following `  - item` lines.
      const items: string[] = []
      i += 1
      while (i < lines.length && /^\s*-\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''))
        i += 1
      }
      data[key] = items
      continue
    }
    if (rest === '[]') {
      data[key] = []
      i += 1
      continue
    }
    data[key] = rest.replace(/^["']|["']$/g, '')
    i += 1
  }
  return { data, body: (body ?? '').trim() }
}
