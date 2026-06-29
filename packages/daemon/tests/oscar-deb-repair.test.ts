import { describe, expect, test } from 'vitest'
import {
  firstJsonObjectArtifact,
  makeDialogueId,
  nextDialogueState,
  parseDebRepairResponse,
  parseFounderEscalation,
  parseOscarEvaluation,
  parseOscarEvaluationArtifact,
  parseOscarRepairRequest,
  repairDialogueBaseDir,
  repairDialoguePaths,
  type DialogueEvent,
  type DialogueState,
} from '../src/oscar-deb-repair.js'

const request = {
  schemaVersion: 1,
  dialogueId: 'repair-1860000000000-a1b2',
  workspaceId: 'cocoder',
  sourceRunId: 'run_186',
  requestedBy: 'oscar',
  createdAt: '2026-06-22T19:45:00.000Z',
  problem: 'The runner still tells Oscar to use the within-run lane.',
  evidence: [{ kind: 'file', ref: 'packages/core/src/runner/prompts.ts:589', summary: 'Prompt advertises stale routing.' }],
  desiredOutcome: 'Route proactive repair through ADR-0036.',
} as const

const applied = {
  schemaVersion: 1,
  dialogueId: request.dialogueId,
  kind: 'applied',
  disposition: 'cocoder-bug',
  mode: 'repair',
  summary: 'Removed obsolete routing.',
  diagnosis: 'The path modeled help as failure.',
  whyCocoderOwned: 'Runner prompt/directive machinery is CoCoder-owned.',
  filesChanged: ['packages/core/src/runner/directive.ts'],
  verification: 'pnpm test',
  remainingRisk: 'none',
  commit: { sha: 'abc1234', committedPaths: ['packages/core/src/runner/directive.ts'], outOfLanePaths: [] },
} as const

const proposal = {
  schemaVersion: 1,
  dialogueId: request.dialogueId,
  kind: 'proposal',
  disposition: 'cocoder-bug',
  summary: 'Move repair to daemon.',
  diagnosis: 'The run-loop path is the wrong home.',
  recommendedChanges: [{ file: 'packages/core/src/runner/directive.ts', change: 'Remove stale variant.' }],
  verificationPlan: ['pnpm exec vitest run packages/core/tests/directive.test.ts'],
  risk: 'medium',
  needsFounder: false,
} as const

const evaluation = {
  schemaVersion: 1,
  dialogueId: request.dialogueId,
  evaluatedBy: 'oscar',
  createdAt: '2026-06-22T20:00:00.000Z',
  verdict: 'direct-deb-to-apply',
  reason: 'Proposal is in scope.',
  direction: { action: 'apply', scope: ['packages/core/src/runner/directive.ts'], verificationRequired: ['pnpm test'] },
} as const

const escalation = {
  schemaVersion: 1,
  dialogueId: request.dialogueId,
  kind: 'founder-escalation',
  createdAt: '2026-06-22T20:05:00.000Z',
  reason: 'Hard to reverse.',
  lightestHome: 'founder-decision',
  options: [{ label: 'Approve', effect: 'Deb applies the repair.' }],
  recommendedOption: 'Approve',
  evidenceRefs: ['local/oz/cocoder/repair-dialogues/repair-1860000000000-a1b2/deb-response.json'],
} as const

const json = (value: unknown): string => JSON.stringify(value)

describe('Oscar-Deb repair dialogue data', () => {
  test('parses well-formed artifacts', () => {
    expect(parseOscarRepairRequest(json(request))).toEqual(request)
    expect(parseDebRepairResponse(json(applied))).toEqual(applied)
    expect(parseDebRepairResponse(json(proposal))).toEqual(proposal)
    expect(parseOscarEvaluation(json(evaluation))).toEqual(evaluation)
    expect(parseFounderEscalation(json(escalation))).toEqual(escalation)
  })

  test('extracts an Oscar evaluation JSON object wrapped in prose', () => {
    const output = [
      'Verdict: **escalate-founder**. Deb proposal is correct.',
      '',
      '```json',
      json({ ...evaluation, verdict: 'escalate-founder', reason: 'Risky and hard to reverse.', direction: undefined }),
      '```',
      '',
      'Surface this to the founder.',
    ].join('\n')

    expect(parseOscarEvaluationArtifact(output, request.dialogueId)).toMatchObject({
      dialogueId: request.dialogueId,
      verdict: 'escalate-founder',
      reason: 'Risky and hard to reverse.',
    })
  })

  test('extracts a Deb response JSON object wrapped in prose', () => {
    const output = [
      'I applied the non-interfering repair.',
      '',
      '```json',
      json(applied),
      '```',
      '',
      'Verification passed.',
    ].join('\n')

    expect(firstJsonObjectArtifact(output)).toMatchObject({
      kind: 'applied',
      summary: 'Removed obsolete routing.',
      diagnosis: 'The path modeled help as failure.',
    })
  })

  test.each([
    ['empty problem', { ...request, problem: ' ' }, parseOscarRepairRequest, 'problem'],
    ['over-length problem', { ...request, problem: 'x'.repeat(4001) }, parseOscarRepairRequest, 'too long'],
    ['zero evidence', { ...request, evidence: [] }, parseOscarRepairRequest, 'evidence'],
    ['empty evidence summary', { ...request, evidence: [{ ...request.evidence[0], summary: ' ' }] }, parseOscarRepairRequest, 'summary'],
    ['bad response kind', { ...proposal, kind: 'unknown' }, parseDebRepairResponse, '"kind" must be "applied" or "proposal"'],
    ['bad risk', { ...proposal, risk: 'severe' }, parseDebRepairResponse, '"risk" must be "low", "medium", or "high"'],
    ['bad verdict', { ...evaluation, verdict: 'approve' }, parseOscarEvaluation, '"verdict" must be'],
    ['bad escalation kind', { ...escalation, kind: 'proposal' }, parseFounderEscalation, '"kind" must be "founder-escalation"'],
  ])('rejects malformed artifact: %s', (_name, artifact, parser, message) => {
    expect(() => parser(json(artifact))).toThrow(message)
  })

  test('formats ids and exact artifact paths deterministically', () => {
    expect(makeDialogueId(1860000000000, 'a1b2')).toBe('repair-1860000000000-a1b2')
    expect(repairDialogueBaseDir('cocoder', 'repair-1-ab')).toBe('local/oz/cocoder/repair-dialogues/repair-1-ab')
    expect(repairDialoguePaths('cocoder', 'repair-1-ab')).toEqual({
      baseDir: 'local/oz/cocoder/repair-dialogues/repair-1-ab',
      request: 'local/oz/cocoder/repair-dialogues/repair-1-ab/request.json',
      debResponse: 'local/oz/cocoder/repair-dialogues/repair-1-ab/deb-response.json',
      oscarEvaluation: 'local/oz/cocoder/repair-dialogues/repair-1-ab/oscar-evaluation.json',
      founderEscalation: 'local/oz/cocoder/repair-dialogues/repair-1-ab/founder-escalation.json',
      heldChange: 'local/oz/cocoder/repair-dialogues/repair-1-ab/held-change',
      evidenceLog: 'local/oz/cocoder/repair-dialogues/repair-1-ab/evidence.jsonl',
      debTurnLog: 'local/oz/cocoder/repair-dialogues/repair-1-ab/deb-turn.log',
      oscarTurnLog: 'local/oz/cocoder/repair-dialogues/repair-1-ab/oscar-turn.log',
    })
  })
})

describe('Oscar-Deb repair dialogue state machine', () => {
  test.each([
    ['requested', { type: 'wait-for-idle' }, 'waiting-for-idle'],
    ['requested', { type: 'start-deb' }, 'deb-running'],
    ['waiting-for-idle', { type: 'start-deb' }, 'deb-running'],
    ['deb-running', { type: 'deb-applied' }, 'deb-applied'],
    ['deb-running', { type: 'deb-proposed' }, 'deb-proposed'],
    ['deb-applied', { type: 'complete' }, 'complete'],
    ['deb-applied', { type: 'founder-escalated' }, 'founder-escalated'],
    ['deb-directed-running', { type: 'founder-escalated' }, 'founder-escalated'],
    ['deb-proposed', { type: 'start-oscar-evaluation' }, 'oscar-evaluating'],
    ['oscar-evaluating', { type: 'needs-oscar' }, 'needs-oscar'],
    ['needs-oscar', { type: 'start-oscar-evaluation' }, 'oscar-evaluating'],
    ['oscar-evaluating', { type: 'oscar-directed' }, 'oscar-directed'],
    ['oscar-directed', { type: 'start-directed-deb' }, 'deb-directed-running'],
    ['oscar-directed', { type: 'founder-escalated' }, 'founder-escalated'],
    ['deb-directed-running', { type: 'complete' }, 'complete'],
    ['founder-escalated', { type: 'complete' }, 'complete'],
  ] satisfies ReadonlyArray<readonly [DialogueState, DialogueEvent, DialogueState]>)('%s + %s -> %s', (current, event, expected) => {
    expect(nextDialogueState(current, event)).toBe(expected)
  })

  test.each(['requested', 'waiting-for-idle', 'deb-running', 'deb-applied', 'deb-proposed', 'oscar-evaluating', 'needs-oscar', 'oscar-directed', 'deb-directed-running', 'founder-escalated'] satisfies readonly DialogueState[])(
    'allows active state %s to fail',
    (state) => {
      expect(nextDialogueState(state, { type: 'fail' })).toBe('failed')
    },
  )

  test.each([
    ['deb-applied', { type: 'deb-proposed' }],
    ['deb-proposed', { type: 'deb-applied' }],
    ['oscar-directed', { type: 'complete' }],
    ['complete', { type: 'fail' }],
  ] satisfies ReadonlyArray<readonly [DialogueState, DialogueEvent]>)('rejects illegal transition %s + %s', (current, event) => {
    expect(() => nextDialogueState(current, event)).toThrow(`repair dialogue: illegal transition ${current} -> ${event.type}`)
  })
})
