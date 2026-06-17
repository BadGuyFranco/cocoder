import { describe, expect, test } from 'vitest'
import { runIntentIntake, type IntentArtifact } from '../src/playbooks/index.js'

const artifacts: readonly IntentArtifact[] = [
  { ref: 'README.md', kind: 'file', label: 'README', excerpt: 'CoCoder orchestrates AI coding runs for solo builders.' },
  { ref: 'commit:abc1234', kind: 'commit', label: 'recent commit', excerpt: 'Add onboarding playbook executor.' },
  { ref: 'tag:v0.2.0', kind: 'tag', label: 'v0.2.0' },
  { ref: 'issue:42', kind: 'issue', label: 'Launch dashboard reliability' },
]

const agentOutput = (): unknown => ({
  claims: [
    { claim: 'The project is an AI coding orchestration engine.', provenance: ['README.md'] },
    { claim: 'Recent direction emphasizes onboarding playbook execution.', provenance: ['commit:abc1234', 'issue:42'] },
  ],
  openQuestions: ['Which onboarding path is most important for launch?'],
})

describe('intent intake', () => {
  test('builds IntentJson with inferred claims, founder assertions, open questions, and version', async () => {
    let prompt = ''
    const intent = await runIntentIntake({
      artifacts,
      founderAnswers: {
        projectPurpose: 'Help solo builders run AI coding teams.',
        futureDirection: 'Make onboarding reliable enough to dogfood.',
        mustNotChange: ['Keep governance portable'],
        milestonesOrConstraints: ['Launch a takeover path'],
      },
      agentTurn: async (input) => {
        prompt = input.prompt
        return agentOutput()
      },
    })

    expect(prompt).toContain('# P1 Takeover Intent Intake')
    expect(prompt).toContain('README.md')
    expect(intent).toEqual({
      version: 1,
      inferredFromArtifacts: [
        { kind: 'inferred', claim: 'The project is an AI coding orchestration engine.', provenance: [{ ref: 'README.md', kind: 'file' }] },
        {
          kind: 'inferred',
          claim: 'Recent direction emphasizes onboarding playbook execution.',
          provenance: [{ ref: 'commit:abc1234', kind: 'commit' }, { ref: 'issue:42', kind: 'issue' }],
        },
      ],
      founderAsserted: {
        projectPurpose: { kind: 'founder-assertion', value: 'Help solo builders run AI coding teams.' },
        futureDirection: { kind: 'founder-assertion', value: 'Make onboarding reliable enough to dogfood.' },
        mustNotChange: { kind: 'founder-assertion', value: ['Keep governance portable'] },
        milestonesOrConstraints: { kind: 'founder-assertion', value: ['Launch a takeover path'] },
      },
      openQuestions: ['Which onboarding path is most important for launch?'],
    })
  })

  test('refuses inferred claims without valid supplied-artifact provenance', async () => {
    await expect(runIntentIntake({
      artifacts,
      agentTurn: async () => ({ claims: [{ claim: 'Uncited claim', provenance: [] }] }),
    })).rejects.toThrow('claims[0].provenance must be a non-empty string array')
    await expect(runIntentIntake({
      artifacts,
      agentTurn: async () => ({ claims: [{ claim: 'Unknown source claim', provenance: ['docs/missing.md'] }] }),
    })).rejects.toThrow('references unknown artifact "docs/missing.md"')
  })

  test('keeps inferred claims and founder assertions structurally separate', async () => {
    const intent = await runIntentIntake({
      artifacts,
      founderAnswers: { projectPurpose: 'Founder purpose' },
      agentTurn: async () => agentOutput(),
    })

    expect(intent.inferredFromArtifacts.every((claim) => claim.kind === 'inferred' && claim.provenance.length > 0)).toBe(true)
    expect(intent.founderAsserted.projectPurpose).toEqual({ kind: 'founder-assertion', value: 'Founder purpose' })
    expect(intent.inferredFromArtifacts.map((claim) => claim.claim)).not.toContain('Founder purpose')
    expect(intent.founderAsserted.futureDirection).toBeNull()
  })

  test('partial founder answers produce open questions instead of fabricated founder intent', async () => {
    const intent = await runIntentIntake({
      artifacts,
      founderAnswers: { mustNotChange: ['Do not weaken commit gates'] },
      agentTurn: async () => ({ claims: [], openQuestions: [] }),
    })

    expect(intent.founderAsserted).toEqual({
      projectPurpose: null,
      futureDirection: null,
      mustNotChange: { kind: 'founder-assertion', value: ['Do not weaken commit gates'] },
      milestonesOrConstraints: null,
    })
    expect(intent.openQuestions).toEqual([
      'What is this project for?',
      'Where is this project going next?',
      'What near-term milestones or launch constraints matter?',
    ])
  })

  test('refuses malformed agent output', async () => {
    await expect(runIntentIntake({ artifacts, agentTurn: async () => 'not json' })).rejects.toThrow('intent agent output must be a JSON object')
    await expect(runIntentIntake({ artifacts, agentTurn: async () => ({ claims: [{ provenance: ['README.md'] }] }) })).rejects.toThrow('claims[0].claim must be a non-empty string')
    await expect(runIntentIntake({ artifacts, agentTurn: async () => ({ claims: [], openQuestions: [42] }) })).rejects.toThrow('openQuestions must be a string array')
  })

  test('is deterministic for the same inputs and agent output', async () => {
    const input = {
      artifacts,
      founderAnswers: { projectPurpose: 'Founder purpose', futureDirection: 'Founder direction' },
      agentTurn: async () => agentOutput(),
    }
    const first = await runIntentIntake(input)
    const second = await runIntentIntake(input)
    expect(second).toEqual(first)
  })
})
