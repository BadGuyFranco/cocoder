import type { Persona, PersonaDelta } from './types.js'

/** Boundary between base persona body and appended repo delta body. */
const BODY_DELTA_SEPARATOR = '\n\n---\n\n'

export class PersonaMergeError extends Error {
  public constructor(
    message: string,
    public readonly baseId: string,
    public readonly deltaId: string,
  ) {
    super(message)
    this.name = 'PersonaMergeError'
  }
}

export function mergePersona(base: Persona, delta: PersonaDelta): Persona {
  if (base.id !== delta.id) {
    throw new PersonaMergeError(
      `persona delta id "${delta.id}" does not match base persona id "${base.id}"`,
      base.id,
      delta.id,
    )
  }

  return {
    id: base.id,
    label: delta.label ?? base.label,
    role: delta.role ?? base.role,
    writeScope: mergeWriteScope(base.writeScope, delta.writeScope),
    body: mergeBody(base.body, delta.body),
  }
}

function mergeWriteScope(base: readonly string[], delta: readonly string[] | undefined): readonly string[] {
  const merged = [...base]
  const seen = new Set(merged)
  for (const entry of delta ?? []) {
    if (!seen.has(entry)) {
      merged.push(entry)
      seen.add(entry)
    }
  }
  return merged
}

function mergeBody(base: string, delta: string | undefined): string {
  if (delta === undefined || delta.trim() === '') return base
  return `${base.trimEnd()}${BODY_DELTA_SEPARATOR}${delta.trimStart()}`
}
