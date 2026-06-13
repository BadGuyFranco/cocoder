import type { Play, PlayDelta } from './types.js'

/** Boundary between base Play body and appended repo delta body. */
const BODY_DELTA_SEPARATOR = '\n\n---\n\n'

export class PlayMergeError extends Error {
  public constructor(
    message: string,
    public readonly baseId: string,
    public readonly deltaId: string,
  ) {
    super(message)
    this.name = 'PlayMergeError'
  }
}

export function mergePlay(base: Play, delta: PlayDelta): Play {
  if (base.id !== delta.id) {
    throw new PlayMergeError(
      `play delta id "${delta.id}" does not match base Play id "${base.id}"`,
      base.id,
      delta.id,
    )
  }

  return {
    id: base.id,
    label: delta.label ?? base.label,
    kind: delta.kind ?? base.kind,
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
