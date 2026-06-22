import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../personas/frontmatter.js'
import { parsePlayContractFrontmatter, withOptional } from './frontmatter.js'
import { loadPlay } from './loader.js'
import { mergePlay } from './merge.js'
import type { Play, PlayDelta } from './types.js'

export interface PlaySources {
  readonly baseDir: string
  readonly deltaDir: string
  readonly repoPlayDir: string
}

export class PlayDeltaLoadError extends Error {
  public constructor(
    message: string,
    public readonly file: string,
  ) {
    super(message)
    this.name = 'PlayDeltaLoadError'
  }
}

export function loadPlayDelta(deltaDir: string, id: string): PlayDelta {
  const file = join(deltaDir, `${id}.md`)
  const raw = readFileSync(file, 'utf8')
  const { data, body } = parseFrontmatter(raw, file)
  const fmId = asString(data.id, 'id', file)
  if (fmId !== id) {
    throw new PlayDeltaLoadError(`play delta ${file}: frontmatter id "${fmId}" does not match filename id "${id}"`, file)
  }

  return {
    id,
    ...withOptional('label', optionalString(data.label, 'label', file)),
    ...withOptional('kind', optionalKind(data.kind, file)),
    ...parsePlayContractFrontmatter(data, {
      file,
      owner: 'play delta',
      createError: (message: string) => new PlayDeltaLoadError(message, file),
    }),
    ...withOptional('writeScope', normalizeWriteScope(data.writeScope)),
    body,
  }
}

export function loadEffectivePlay(baseDir: string, deltaDir: string, id: string): Play {
  const base = loadPlay(baseDir, id)
  const deltaFile = join(deltaDir, `${id}.md`)
  if (!existsSync(deltaFile)) return base
  return mergePlay(base, loadPlayDelta(deltaDir, id))
}

export function listEffectivePlays(sources: PlaySources): readonly Play[] {
  const baseIds = new Set(listMarkdownIds(sources.baseDir))
  const plays: Play[] = []

  for (const id of baseIds) {
    plays.push(loadEffectivePlay(sources.baseDir, sources.deltaDir, id))
  }

  for (const id of listMarkdownIds(sources.repoPlayDir)) {
    if (baseIds.has(id)) continue
    try {
      plays.push(loadPlay(sources.repoPlayDir, id))
    } catch {
      /* not a Play definition */
    }
  }

  return [...plays].sort((a: Play, b: Play) => a.id.localeCompare(b.id))
}

function asString(value: string | string[] | undefined, field: string, file: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PlayDeltaLoadError(`play delta ${file}: frontmatter "${field}" must be a non-empty string`, file)
  }
  return value
}

function optionalString(value: string | string[] | undefined, field: string, file: string): string | undefined {
  if (value === undefined) return undefined
  return asString(value, field, file)
}

function optionalKind(value: string | string[] | undefined, file: string): Play['kind'] | undefined {
  if (value === undefined) return undefined
  if (value !== 'headless' && value !== 'interactive') {
    throw new PlayDeltaLoadError(`play delta ${file}: frontmatter "kind" must be "headless" or "interactive"`, file)
  }
  return value
}

function normalizeWriteScope(value: string | string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

function listMarkdownIds(dir: string): readonly string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
}
