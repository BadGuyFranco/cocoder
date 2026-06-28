import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { composeTicketMarkdown, loadTicket } from '../src/index.js'
import { TicketBindingError, validateBinding } from '../src/tickets/index.js'

describe('ticket binding schema', () => {
  test('compose and loader round-trip binding and provenance metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-binding-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    const markdown = composeTicketMarkdown(
      '0021',
      {
        title: 'Carry binding metadata',
        type: 'task',
        priority: 'ticketing-paths-hardening',
        bindingReason: 'Founder approved priority binding.',
        provenance: 'run_279 (ticketing-paths-hardening)',
        description: 'Preserve the binding fields.',
      },
      '2026-06-28',
    )
    await writeFile(join(dir, 'open', '0021-carry-binding-metadata.md'), markdown)

    expect(loadTicket(join(dir, 'open'), '0021-carry-binding-metadata.md')).toMatchObject({
      id: '0021',
      priority: 'ticketing-paths-hardening',
      bindingReason: 'Founder approved priority binding.',
      provenance: 'run_279 (ticketing-paths-hardening)',
    })
  })

  test('legacy standalone tickets load absent binding fields as null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tickets-standalone-'))
    await mkdir(join(dir, 'open'), { recursive: true })
    const markdown = composeTicketMarkdown(
      '0022',
      {
        title: 'Standalone ticket',
        type: 'task',
        priority: 'none',
        description: 'No binding metadata.',
      },
      '2026-06-28',
    )
    await writeFile(join(dir, 'open', '0022-standalone-ticket.md'), markdown)

    expect(loadTicket(join(dir, 'open'), '0022-standalone-ticket.md')).toMatchObject({
      id: '0022',
      priority: 'none',
      bindingReason: null,
      provenance: null,
    })
  })
})

describe('ticket binding rule', () => {
  test('accepts standalone tickets without a reason', () => {
    expect(validateBinding({ priority: 'none' })).toEqual({ priority: null, reason: null })
    expect(validateBinding({ priority: '' })).toEqual({ priority: null, reason: null })
  })

  test('rejects standalone tickets with a reason', () => {
    expect(() => validateBinding({ priority: 'none', reason: 'Not standalone after all.' })).toThrow(TicketBindingError)
    expect(() => validateBinding({ priority: null, reason: 'Not standalone after all.' })).toThrow('standalone tickets must not carry a binding reason')
  })

  test('accepts non-standalone bindings with a reason', () => {
    expect(validateBinding({ priority: 'ticketing-paths-hardening', reason: 'Founder approved.' })).toEqual({
      priority: 'ticketing-paths-hardening',
      reason: 'Founder approved.',
    })
  })

  test('rejects non-standalone bindings without a reason', () => {
    expect(() => validateBinding({ priority: 'ticketing-paths-hardening' })).toThrow(TicketBindingError)
    expect(() => validateBinding({ priority: 'ticketing-paths-hardening', reason: '  ' })).toThrow(
      'ticket binding to ticketing-paths-hardening requires a binding reason',
    )
  })
})
