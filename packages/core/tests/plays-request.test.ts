import { describe, expect, test } from 'vitest'
import {
  MalformedPlayRequestError,
  parsePlayRequest,
  validatePlayRequest,
  type Play,
} from '../src/index.js'

const play = (overrides: Partial<Play> = {}): Play => ({
  id: 'create-ticket',
  label: 'Create ticket',
  kind: 'headless',
  executionModel: 'prompt-only',
  triggerClass: 'persona-requested',
  purpose: 'Create one open ticket.',
  allowedCallers: ['bob'],
  writeScope: ['cocoder/tickets/**'],
  body: 'Create the ticket.',
  ...overrides,
})

describe('Play request lane', () => {
  test('parses a structured Play request with input', () => {
    expect(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket', input: { title: 'Bug' } }))).toEqual({
      kind: 'play',
      play: 'create-ticket',
      input: { title: 'Bug' },
    })
  })

  test.each([
    ['bad kind', { kind: 'delegate', play: 'create-ticket' }, /"kind" must be "play"/],
    ['missing play id', { kind: 'play' }, /"play" must be a non-empty string/],
    ['blank play id', { kind: 'play', play: ' ' }, /"play" must be a non-empty string/],
  ])('rejects malformed Play requests: %s', (_name, payload, message) => {
    expect(() => parsePlayRequest(JSON.stringify(payload))).toThrow(MalformedPlayRequestError)
    expect(() => parsePlayRequest(JSON.stringify(payload))).toThrow(message)
  })

  test('accepts an authorized optional Play request and carries the dispatch writeScope', () => {
    const result = validatePlayRequest(
      parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket', input: { title: 'Bug' } })),
      { caller: 'bob', plays: [play()] },
    )

    expect(result.accepted).toBe(true)
    if (!result.accepted) throw new Error(result.reason)
    expect(result.play.id).toBe('create-ticket')
    expect(result.input).toEqual({ title: 'Bug' })
    expect(result.writeScope).toEqual(['cocoder/tickets/**'])
  })

  test('rejects an unknown Play', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'missing' })), {
      caller: 'bob',
      plays: [play()],
    })

    expect(result).toEqual({ accepted: false, code: 'unknown-play', reason: 'unknown Play "missing"' })
  })

  test('rejects an unauthorized caller', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket' })), {
      caller: 'oscar',
      plays: [play()],
    })

    expect(result).toEqual({
      accepted: false,
      code: 'unauthorized-caller',
      reason: 'caller "oscar" is not authorized for Play "create-ticket"',
    })
  })

  test('rejects persona requests for mandatory lifecycle-triggered Plays', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'wrap-up' })), {
      caller: 'oscar',
      plays: [
        play({
          id: 'wrap-up',
          triggerClass: 'lifecycle-triggered',
          allowedCallers: ['oscar'],
        }),
      ],
    })

    expect(result).toEqual({
      accepted: false,
      code: 'mandatory-play',
      reason: 'Play "wrap-up" is mandatory and must be triggered by the runner or daemon',
    })
  })

  test('rejects missing input when the Play declares an input schema', () => {
    const result = validatePlayRequest(parsePlayRequest(JSON.stringify({ kind: 'play', play: 'create-ticket' })), {
      caller: 'bob',
      plays: [play({ inputSchema: { ref: 'schemas/create-ticket.input' } })],
    })

    expect(result).toEqual({
      accepted: false,
      code: 'missing-input',
      reason: 'Play "create-ticket" requires input for schema "schemas/create-ticket.input"',
    })
  })
})
