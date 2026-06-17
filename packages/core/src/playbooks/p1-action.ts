import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildEstimate, summarizeEstimate, type EstimateJson, type ModelEstimateAssumptions, type EstimatePricingInput } from './estimate.js'
import { enumerateIntentArtifacts, type IntentArtifactLimits, type IntentGitReader } from './intent-artifacts.js'
import { runIntentIntake, type FounderIntentAnswers, type IntentJson } from './intent.js'
import type { OnboardingPlaybookPhase } from './loader.js'
import { runAgenticRecon, type ReconPassResult, type SubsystemsJsonPayload } from './recon-pass.js'
import { inventoryRepo, type RepoInventory } from './recon.js'
import type { PlaybookPhaseAction } from './executor.js'

export type PlaybookP1AgentPurpose = 'recon' | 'intent'

export interface PlaybookP1AgentTurnInput {
  readonly purpose: PlaybookP1AgentPurpose
  readonly prompt: string
}

export type PlaybookP1AgentTurn = (input: PlaybookP1AgentTurnInput) => Promise<unknown>

export interface RunPlaybookP1ActionInput {
  readonly repoDir: string
  readonly runDir: string
  readonly model: ModelEstimateAssumptions
  readonly agentTurn: PlaybookP1AgentTurn
  readonly founderAnswers?: FounderIntentAnswers
  readonly gitReader?: IntentGitReader
  readonly artifactLimits?: IntentArtifactLimits
  readonly pricing?: EstimatePricingInput
}

export interface PlaybookP1Artifacts {
  readonly inventory: RepoInventory
  readonly subsystems: SubsystemsJsonPayload
  readonly intent: IntentJson
  readonly estimate: EstimateJson
  readonly pickup: string
}

const p1Dir = (runDir: string): string => join(runDir, 'playbook', 'P1')

export function createPlaybookPhaseAction(input: RunPlaybookP1ActionInput): PlaybookPhaseAction {
  return async ({ phase }) => {
    if (!isP1ActionPhase(phase)) return
    await runPlaybookP1Action(input)
  }
}

export async function runPlaybookP1Action(input: RunPlaybookP1ActionInput): Promise<PlaybookP1Artifacts> {
  const dir = p1Dir(input.runDir)
  await mkdir(dir, { recursive: true })

  const [artifacts, inventory] = await Promise.all([
    enumerateIntentArtifacts({ repoDir: input.repoDir, gitReader: input.gitReader, limits: input.artifactLimits }),
    Promise.resolve(inventoryRepo(input.repoDir)),
  ])
  const recon = await runAgenticRecon({
    inventory,
    agentTurn: ({ prompt }) => input.agentTurn({ purpose: 'recon', prompt }),
  })
  const intent = await runIntentIntake({
    artifacts,
    founderAnswers: input.founderAnswers,
    agentTurn: ({ prompt }) => input.agentTurn({ purpose: 'intent', prompt }),
  })
  const estimate = buildEstimate({ inventory, recon, model: input.model, pricing: input.pricing })
  const pickup = renderP1Pickup({ recon, intent, estimate })

  await Promise.all([
    writeJson(join(dir, 'inventory.json'), inventory),
    writeJson(join(dir, 'subsystems.json'), recon.subsystemProposal),
    writeJson(join(dir, 'intent.json'), intent),
    writeJson(join(dir, 'estimate.json'), estimate),
    writeFile(join(dir, 'pickup.md'), pickup, 'utf8'),
  ])

  return { inventory, subsystems: recon.subsystemProposal, intent, estimate, pickup }
}

function isP1ActionPhase(phase: OnboardingPlaybookPhase): boolean {
  return phase.id === 'P1' && (phase.kind === 'recon' || phase.kind === 'intake')
}

function renderP1Pickup(input: { readonly recon: ReconPassResult; readonly intent: IntentJson; readonly estimate: EstimateJson }): string {
  const intentLines = input.intent.inferredFromArtifacts.map((claim) => {
    const refs = claim.provenance.map((item) => item.ref).join(', ')
    return `- ${claim.claim} (${refs})`
  })
  const questions = input.intent.openQuestions.map((question) => `- ${question}`)
  return [
    '# P1 Founder Pickup',
    '',
    '## Intent Interview',
    '',
    intentLines.length > 0 ? intentLines.join('\n') : '- No confident artifact-backed purpose claim yet.',
    '',
    '## Open Questions',
    '',
    questions.length > 0 ? questions.join('\n') : '- No open questions from P1.',
    '',
    '## Subsystem Map',
    '',
    input.recon.humanMap,
    '',
    '## Estimate',
    '',
    summarizeEstimate(input.estimate),
    '',
    '## Spend Decision',
    '',
    'Approve continuing into P2 only if this expected time/token spend is acceptable. If not, answer the open questions above or cap the next phase before approving.',
    '',
  ].join('\n')
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
