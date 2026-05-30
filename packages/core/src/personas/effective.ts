import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import { loadPersona } from './loader.js'
import { mergePersona } from './merge.js'
import type { Assignments, Persona, PersonaDelta, ResolvedPersona } from './types.js'

export interface PersonaSources {
  readonly baseDir: string
  readonly deltaDir: string
  readonly repoPersonaDir: string
}

export class PersonaDeltaLoadError extends Error {
  public constructor(
    message: string,
    public readonly file: string,
  ) {
    super(message)
    this.name = 'PersonaDeltaLoadError'
  }
}

export function loadPersonaDelta(deltaDir: string, id: string): PersonaDelta {
  const file = join(deltaDir, `${id}.md`)
  const raw = readFileSync(file, 'utf8')
  const { data, body } = parseFrontmatter(raw)
  const fmId = asString(data.id, 'id', file)
  if (fmId !== id) {
    throw new PersonaDeltaLoadError(`persona delta ${file}: frontmatter id "${fmId}" does not match filename id "${id}"`, file)
  }

  return {
    id,
    ...withOptional('label', optionalString(data.label, 'label', file)),
    ...withOptional('role', optionalString(data.role, 'role', file)),
    ...withOptional('writeScope', normalizeWriteScope(data.writeScope)),
    body,
  }
}

export function loadEffectivePersona(baseDir: string, deltaDir: string, id: string): Persona {
  const base = loadPersona(baseDir, id)
  const deltaFile = join(deltaDir, `${id}.md`)
  if (!existsSync(deltaFile)) return base
  return mergePersona(base, loadPersonaDelta(deltaDir, id))
}

export function resolveEffectivePersona(sources: PersonaSources, assignments: Assignments, id: string): ResolvedPersona {
  const assignment = assignments.personas[id]
  if (!assignment) throw new Error(`persona "${id}" has no assignment in assignments.json (not a live persona)`)

  const baseFile = join(sources.baseDir, `${id}.md`)
  const definition = existsSync(baseFile)
    ? loadEffectivePersona(sources.baseDir, sources.deltaDir, id)
    : loadPersona(sources.repoPersonaDir, id)

  return { ...definition, cli: assignment.cli, model: assignment.model }
}

function asString(value: string | string[] | undefined, field: string, file: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PersonaDeltaLoadError(`persona delta ${file}: frontmatter "${field}" must be a non-empty string`, file)
  }
  return value
}

function optionalString(value: string | string[] | undefined, field: string, file: string): string | undefined {
  if (value === undefined) return undefined
  return asString(value, field, file)
}

function normalizeWriteScope(value: string | string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

function withOptional<K extends keyof PersonaDelta>(
  key: K,
  value: PersonaDelta[K] | undefined,
): Pick<PersonaDelta, K> | Record<string, never> {
  return value === undefined ? {} : { [key]: value } as Pick<PersonaDelta, K>
}
