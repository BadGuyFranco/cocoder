import { playAvailability } from './manifest.js'
import type { Play } from './types.js'

export interface PlayRequest {
  readonly kind: 'play'
  readonly play: string
  readonly input?: Readonly<Record<string, unknown>>
}

export type PlayRequestRejectionCode =
  | 'unknown-play'
  | 'unauthorized-caller'
  | 'mandatory-play'
  | 'missing-input'

export type PlayRequestValidationResult =
  | {
      readonly accepted: true
      readonly play: Play
      readonly input?: Readonly<Record<string, unknown>>
      readonly writeScope: readonly string[]
    }
  | {
      readonly accepted: false
      readonly code: PlayRequestRejectionCode
      readonly reason: string
    }

export class MalformedPlayRequestError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MalformedPlayRequestError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parsePlayRequest(json: string): PlayRequest {
  const data = JSON.parse(json) as unknown
  if (!isRecord(data)) {
    throw new MalformedPlayRequestError('play request: payload must be an object')
  }
  if (data.kind !== 'play') {
    throw new MalformedPlayRequestError('play request: "kind" must be "play"')
  }
  if (typeof data.play !== 'string' || data.play.trim() === '') {
    throw new MalformedPlayRequestError('play request: "play" must be a non-empty string')
  }
  if (data.input !== undefined && !isRecord(data.input)) {
    throw new MalformedPlayRequestError('play request: optional "input" must be an object')
  }

  const request = { kind: 'play' as const, play: data.play }
  return data.input === undefined ? request : { ...request, input: data.input }
}

export function validatePlayRequest(
  request: PlayRequest,
  input: { readonly caller: string; readonly plays: readonly Play[] },
): PlayRequestValidationResult {
  const play = input.plays.find((candidate) => candidate.id === request.play)
  if (!play) {
    return reject('unknown-play', `unknown Play "${request.play}"`)
  }

  if (!play.allowedCallers?.includes(input.caller)) {
    return reject('unauthorized-caller', `caller "${input.caller}" is not authorized for Play "${play.id}"`)
  }

  if (playAvailability(play) === 'mandatory') {
    return reject('mandatory-play', `Play "${play.id}" is mandatory and must be triggered by the runner or daemon`)
  }

  if (play.inputSchema && (!request.input || Object.keys(request.input).length === 0)) {
    return reject('missing-input', `Play "${play.id}" requires input for schema "${play.inputSchema.ref}"`)
  }

  // Per-persona PlayAssignment validation needs runner/daemon assignment plumbing; keep it in the
  // dispatch wiring instead of inventing a parallel assignment store here.
  return { accepted: true, play, input: request.input, writeScope: play.writeScope }
}

function reject(code: PlayRequestRejectionCode, reason: string): PlayRequestValidationResult {
  return { accepted: false, code, reason }
}
