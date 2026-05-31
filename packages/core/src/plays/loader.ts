import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'
import type { Play } from './types.js'

const asString = (v: string | string[] | undefined, field: string, file: string): string => {
  if (typeof v !== 'string' || v === '') throw new Error(`play ${file}: frontmatter "${field}" must be a non-empty string`)
  return v
}

const asKind = (v: string | string[] | undefined, file: string): Play['kind'] => {
  if (v !== 'headless' && v !== 'interactive') {
    throw new Error(`play ${file}: frontmatter "kind" must be "headless" or "interactive"`)
  }
  return v
}

export function loadPlay(playsDir: string, id: string): Play {
  const file = join(playsDir, `${id}.md`)
  const raw = readFileSync(file, 'utf8')
  const { data, body } = parseFrontmatter(raw)
  const fmId = asString(data.id, 'id', file)
  if (fmId !== id) throw new Error(`play ${file}: frontmatter id "${fmId}" does not match filename id "${id}"`)
  const writeScope = Array.isArray(data.writeScope) ? data.writeScope : data.writeScope ? [data.writeScope] : []
  return {
    id,
    label: asString(data.label, 'label', file),
    kind: asKind(data.kind, file),
    writeScope,
    body,
  }
}
