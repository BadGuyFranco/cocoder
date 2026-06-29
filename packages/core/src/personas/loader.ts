// Persona loader (ADR-0008). Explicit-by-id: assignments.json names which personas are live;
// each is loaded from `<personasDir>/<id>.md`. v1 *.json files (quarantined elsewhere) are
// never touched. This is the only "which personas exist" discriminator (kills F1/F4 ambiguity).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODEL_TIERS, type ModelTier } from '../adapter/index.js'
import { parseFrontmatter } from './frontmatter.js'
import type { Assignments, Persona, PersonaAssignment, PersonaRunMode, PlayAssignment, ResolvedPersona } from './types.js'

const asString = (v: string | string[] | undefined, field: string, file: string): string => {
  if (typeof v !== 'string' || v === '') throw new Error(`persona ${file}: frontmatter "${field}" must be a non-empty string`)
  return v
}

const isModelTier = (value: unknown): value is ModelTier =>
  typeof value === 'string' && (MODEL_TIERS as readonly string[]).includes(value)

export function loadPersona(personasDir: string, id: string): Persona {
  const file = join(personasDir, `${id}.md`)
  const raw = readFileSync(file, 'utf8')
  const { data, body } = parseFrontmatter(raw, file)
  const fmId = asString(data.id, 'id', file)
  if (fmId !== id) throw new Error(`persona ${file}: frontmatter id "${fmId}" does not match filename id "${id}"`)
  const writeScope = Array.isArray(data.writeScope) ? data.writeScope : data.writeScope ? [data.writeScope] : []
  return {
    id,
    label: asString(data.label, 'label', file),
    role: asString(data.role, 'role', file),
    writeScope,
    body,
  }
}

export function loadAssignments(path: string): Assignments {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Assignments>
  if (!parsed.personas || typeof parsed.personas !== 'object') {
    throw new Error(`assignments ${path}: missing "personas" object`)
  }
  for (const [id, a] of Object.entries(parsed.personas)) {
    const asn = a as Partial<PersonaAssignment> | null
    if (typeof asn?.cli !== 'string' || typeof asn?.model !== 'string') {
      throw new Error(`assignments ${path}: persona "${id}" needs string "cli" and "model" (model may be "")`)
    }
    if (asn.enabled !== undefined && typeof asn.enabled !== 'boolean') {
      throw new Error(`assignments ${path}: persona "${id}" optional "enabled" must be a boolean`)
    }
    if (asn.mode !== undefined && asn.mode !== 'visible' && asn.mode !== 'headless') {
      throw new Error(`assignments ${path}: persona "${id}" optional "mode" must be "visible" or "headless"`)
    }
    if (asn.tier !== undefined && !isModelTier(asn.tier)) {
      throw new Error(`assignments ${path}: persona "${id}" optional "tier" must be one of: ${MODEL_TIERS.join(', ')}`)
    }
    if (asn.plays !== undefined) {
      if (typeof asn.plays !== 'object' || asn.plays === null || Array.isArray(asn.plays)) {
        throw new Error(`assignments ${path}: persona "${id}" optional "plays" must be an object`)
      }
      for (const [playId, p] of Object.entries(asn.plays)) {
        const play = p as Partial<PlayAssignment> | null
        if (typeof play?.cli !== 'string' || typeof play?.model !== 'string') {
          throw new Error(`assignments ${path}: persona "${id}" play "${playId}" needs string "cli" and "model" (model may be "")`)
        }
        if (play.tier !== undefined && !isModelTier(play.tier)) {
          throw new Error(`assignments ${path}: persona "${id}" play "${playId}" optional "tier" must be one of: ${MODEL_TIERS.join(', ')}`)
        }
      }
    }
  }
  return parsed as Assignments
}

export function isPersonaEnabled(assignments: Assignments, id: string): boolean {
  const assignment = assignments.personas[id]
  return assignment ? assignment.enabled !== false : false
}

/** Load a persona's definition and merge its CLI/model assignment. Throws if either is missing. */
export function resolvePersona(personasDir: string, assignments: Assignments, id: string): ResolvedPersona {
  const assignment = assignments.personas[id]
  if (!assignment) throw new Error(`persona "${id}" has no assignment in assignments.json (not a live persona)`)
  return {
    ...loadPersona(personasDir, id),
    cli: assignment.cli,
    model: assignment.model,
    ...(assignment.tier === undefined ? {} : { tier: assignment.tier }),
    ...(assignment.mode === undefined ? {} : { mode: assignment.mode }),
  }
}

export function resolvePlayAssignment(assignments: Assignments, personaId: string, playId: string): PlayAssignment {
  const assignment = assignments.personas[personaId]
  if (!assignment) throw new Error(`persona "${personaId}" has no assignment in assignments.json (not a live persona)`)
  return assignment.plays?.[playId] ?? {
    cli: assignment.cli,
    model: assignment.model,
    ...(assignment.tier === undefined ? {} : { tier: assignment.tier }),
  }
}

export function resolvePersonaMode(assignments: Assignments, personaId: string): PersonaRunMode | undefined {
  const assignment = assignments.personas[personaId]
  if (!assignment) throw new Error(`persona "${personaId}" has no assignment in assignments.json (not a live persona)`)
  return assignment.mode
}
