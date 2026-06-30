import { describe, expect, test } from 'vitest'
import {
  deriveOutOfLaneAdjudication,
  deriveTicketCloseDecision,
  deriveWrapDisposition,
  deriveWrapupRunStatus,
  validatePlayOutput,
} from '../src/index.js'
import {
  issue,
  label,
  renderFounderCloseout,
  validatedCloseoutContract,
  workspaceRoot,
  wrapPlay,
} from './runner.test-support.js'

const ticketFounderCloseout = (runStatus: string, decisionNeeded = 'None.'): string => renderFounderCloseout({
  runStatus,
  decisionNeeded,
  nextStep: 'Ticket: `0015` — continue the ticket fix run',
})

describe('founder closeout target-aware Run Status', () => {
  test('contract parser derives priority and ticket Run Status vocabularies from the wrap-up Play', () => {
    const contract = validatedCloseoutContract()

    expect(contract.runStatusVocabulary.priority).toEqual(['continue', 'blocked', 'archive ready'])
    expect(contract.runStatusVocabulary.ticket).toEqual(['needs another run', 'closed', 'needs closing', 'blocked'])
  })

  test('validator enforces ticket Run Status vocabulary and close-or-ask decision semantics', () => {
    const ticketArchive = validatePlayOutput({ play: wrapPlay, output: ticketFounderCloseout('archive ready'), cwd: workspaceRoot, isTicket: true })
    expect(ticketArchive?.issues).toContain(issue('runStatus', 'must be one of needs another run | closed | needs closing | blocked for a ticket-launched run'))

    const ticketClosed = validatePlayOutput({ play: wrapPlay, output: ticketFounderCloseout('closed'), cwd: workspaceRoot, isTicket: true })
    expect(ticketClosed?.issues).toEqual([])

    const ticketNeedsClosing = validatePlayOutput({
      play: wrapPlay,
      output: ticketFounderCloseout('needs closing', 'Yes — close ticket `0015` after the founder confirms this fix is complete.'),
      cwd: workspaceRoot,
      isTicket: true,
    })
    expect(ticketNeedsClosing?.issues).toEqual([])

    const ticketNeedsClosingWithoutDecision = validatePlayOutput({ play: wrapPlay, output: ticketFounderCloseout('needs closing'), cwd: workspaceRoot, isTicket: true })
    expect(ticketNeedsClosingWithoutDecision?.issues).toContain(issue('runStatus', `needs closing requires a non-None ${label('decisionNeeded')}`))
  })

  test('validator rejects ticket-only Run Status values for priority-launched closeouts', () => {
    const priorityClosed = validatePlayOutput({ play: wrapPlay, output: renderFounderCloseout({ runStatus: 'closed' }), cwd: workspaceRoot })

    expect(priorityClosed?.issues).toContain(issue('runStatus', 'must be one of continue | blocked | archive ready for a priority-launched run'))
  })

  test('validator accepts target-prefixed Run Status lines by stripping the target label', () => {
    const prefixed = validatePlayOutput({ play: wrapPlay, output: renderFounderCloseout({ runStatus: 'Priority-launched run: archive ready.' }), cwd: workspaceRoot })

    expect(prefixed?.issues).toEqual([])

    const sectionPrefixed = validatePlayOutput({
      play: wrapPlay,
      output: ticketFounderCloseout('Run Status: needs closing', 'Yes — close ticket `0015` after the founder confirms this fix is complete.'),
      cwd: workspaceRoot,
      isTicket: true,
    })
    expect(sectionPrefixed?.issues).toEqual([])
  })

  test('validator requires an explicit Commit State instead of the old runner-supplied placeholder', () => {
    const placeholder = renderFounderCloseout({ commitState: 'Commit status is supplied by the runner landing outcome.' })
    const invalid = validatePlayOutput({ play: wrapPlay, output: placeholder, cwd: workspaceRoot })

    expect(invalid?.issues).toEqual(expect.arrayContaining([
      issue('commitState', 'must start with Committed, Uncommitted, or Commit error'),
      issue('commitState', 'must not defer commit status to another section'),
    ]))

    const valid = validatePlayOutput({ play: wrapPlay, output: renderFounderCloseout({ commitState: 'Uncommitted — no source changes were needed.' }), cwd: workspaceRoot })
    expect(valid?.issues).toEqual([])
  })

  test('ticket Run Status derives terminal run status and close decision separately', () => {
    const contract = validatedCloseoutContract()

    const closed = ticketFounderCloseout('closed')
    expect(deriveWrapupRunStatus(closed, contract, 'completed', 'ticket')).toBe('completed')
    expect(deriveTicketCloseDecision(closed, contract, 'ticket')).toBe('close')

    const needsClosing = ticketFounderCloseout('needs closing', 'Yes — close ticket `0015` after the founder confirms this fix is complete.')
    expect(deriveWrapupRunStatus(needsClosing, contract, 'completed', 'ticket')).toBe('awaiting-founder')
    expect(deriveTicketCloseDecision(needsClosing, contract, 'ticket')).toBe('ask')

    const sectionPrefixedNeedsClosing = ticketFounderCloseout('Run Status: needs closing', 'Yes — close ticket `0015` after the founder confirms this fix is complete.')
    expect(deriveWrapupRunStatus(sectionPrefixedNeedsClosing, contract, 'completed', 'ticket')).toBe('awaiting-founder')
    expect(deriveTicketCloseDecision(sectionPrefixedNeedsClosing, contract, 'ticket')).toBe('ask')

    const needsAnotherRun = ticketFounderCloseout('needs another run')
    expect(deriveWrapupRunStatus(needsAnotherRun, contract, 'completed', 'ticket')).toBe('completed')
    expect(deriveTicketCloseDecision(needsAnotherRun, contract, 'ticket')).toBe('none')
    expect(deriveTicketCloseDecision(renderFounderCloseout({ runStatus: 'archive ready' }), contract, 'priority')).toBe('none')
    expect(deriveWrapupRunStatus(renderFounderCloseout({ runStatus: 'archive ready' }), contract, 'completed', 'priority')).toBe('awaiting-archive-confirmation')
  })

  test('priority archive-ready derivation is gated by open handled tickets without overriding founder decisions', () => {
    const contract = validatedCloseoutContract()
    const archiveReady = renderFounderCloseout({ runStatus: 'archive ready' })

    expect(deriveWrapupRunStatus(archiveReady, contract, 'completed', 'priority', 0)).toBe('awaiting-archive-confirmation')
    expect(deriveWrapDisposition(archiveReady, contract, 'priority', 0)).toBe('archive-confirmation')
    expect(deriveWrapupRunStatus(archiveReady, contract, 'completed', 'priority', 1)).toBe('awaiting-founder')
    expect(deriveWrapDisposition(archiveReady, contract, 'priority', 1)).toBe('awaiting-founder')

    const founderDecision = renderFounderCloseout({
      runStatus: 'archive ready',
      decisionNeeded: 'Choose whether to keep the priority open for the remaining external proof.',
    })
    expect(deriveWrapupRunStatus(founderDecision, contract, 'completed', 'priority', 0)).toBe('awaiting-founder')
    expect(deriveWrapDisposition(founderDecision, contract, 'priority', 0)).toBe('awaiting-founder')
  })

  // WI-B1: the wrap-time out-of-lane review. Escalate (any founder decision) and ratify (a blanket blessing,
  // no per-file line required) are both adjudicated; only TOTAL silence on a non-empty out-of-lane set is
  // `unadjudicated`. Zero out-of-lane is `none` regardless of closeout content.
  test('out-of-lane adjudication classifies none/ratified/escalated/unadjudicated (WI-B1)', () => {
    const contract = validatedCloseoutContract()
    const stray = ['cocoder/stray.md', 'packages/ui/orphan.ts']

    // none: an empty out-of-lane set is never adjudicated, whatever the closeout says.
    expect(deriveOutOfLaneAdjudication(renderFounderCloseout(), contract, [])).toBe('none')

    // ratified: a blanket blessing in Judgment clears the whole set — no line-per-file required (trust-first).
    const ratified = renderFounderCloseout({
      judgment: 'These files landed outside their nominal lane but are correct: the audit naturally belongs there.',
    })
    expect(deriveOutOfLaneAdjudication(ratified, contract, stray)).toBe('ratified')

    // escalated: any non-None Founder Decision Needed IS the escalation (the founder will see the flag).
    const escalated = renderFounderCloseout({
      decisionNeeded: 'Decide whether `packages/ui/orphan.ts` should keep living off its usual surface.',
    })
    expect(deriveOutOfLaneAdjudication(escalated, contract, stray)).toBe('escalated')

    // unadjudicated: out-of-lane commits the closeout never addresses — neither blessed nor escalated.
    expect(deriveOutOfLaneAdjudication(renderFounderCloseout(), contract, stray)).toBe('unadjudicated')
  })
})
