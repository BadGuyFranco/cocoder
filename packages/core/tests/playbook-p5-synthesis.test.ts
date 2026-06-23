import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  runPlaybookP5Action,
  synthesizeP5Governance,
  type P4QuestionsPayload,
  type P5SynthesisPayload,
} from '../src/index.js'
import type { IntentJson, P3ConvergencePayload, SourcePairComparison } from '../src/playbooks/index.js'

const predicateClauses = {
  noNewContradictionOrDisagreement: true,
  noNewCoverageGap: true,
  priorItemsResolvedOrCarried: true,
  p1SurfaceRepresented: true,
}

const agreedComparison: SourcePairComparison = {
  purpose: { agrees: true, builder: 'Governance coordinates onboarding.', orchestrator: 'Governance coordinates onboarding.' },
  keyBehaviors: { agrees: true, builder: ['Track priorities'], orchestrator: ['Track priorities'] },
  dataControlFlow: { agrees: true, builder: 'Markdown governance drives runs.', orchestrator: 'Markdown governance drives runs.' },
  riskSurface: { agrees: true, builder: 'Governance drift.', orchestrator: 'Governance drift.' },
  coverage: { agrees: true, builder: { coveredEntryPoints: [] }, orchestrator: { coveredEntryPoints: [] } },
  residualGaps: { agrees: true, builder: [], orchestrator: [] },
}

const intent: IntentJson = {
  version: 1,
  inferredFromArtifacts: [{ kind: 'inferred', claim: 'The repo coordinates onboarding.', provenance: [{ ref: 'README.md', kind: 'file' }] }],
  founderAsserted: { projectPurpose: null, futureDirection: null, mustNotChange: null, milestonesOrConstraints: null },
  openQuestions: [],
}

const convergence: P3ConvergencePayload = {
  version: 1,
  roundsRun: 1,
  rounds: [],
  sourceAgreementBySubsystem: { governance: agreedComparison },
  followUpReads: [],
  predicateClauses,
  converged: false,
  capStatus: { tripped: false, reasons: [], tokenCap: 100_000, maxRounds: 3, maxWallClockMs: 1_800_000 },
  finalUnresolvedItems: [{
    key: 'residual-gap:governance:validation',
    kind: 'residual-gap',
    subsystemId: 'governance',
    note: 'Validation command coverage is not proven.',
    severity: 'material',
    confidence: 'high',
    evidence: ['playbook/P2/convergence/governance.json#sources.builder.finalResidualGaps[0]'],
  }],
}

const questions: P4QuestionsPayload = {
  version: 1,
  clarifications: [],
  conflictingFindings: [],
  futurePriorities: [{
    note: 'Validation command coverage is not proven.',
    subsystemId: 'governance',
    evidence: ['playbook/P2/convergence/governance.json#sources.builder.finalResidualGaps[0]'],
    sourceRef: 'playbook/P3/convergence.json#finalUnresolvedItems.residual-gap:governance:validation',
    severity: 'material',
    confidence: 'high',
  }],
}

async function writeFixture(root: string, p1: unknown = intent, p3: unknown = convergence, p4: unknown = questions): Promise<{ readonly repoDir: string; readonly runDir: string }> {
  const repoDir = join(root, 'repo')
  const runDir = join(root, 'run')
  await mkdir(repoDir, { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P1'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P3'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P4'), { recursive: true })
  await writeFile(join(runDir, 'playbook', 'P1', 'intent.json'), `${JSON.stringify(p1, null, 2)}\n`, 'utf8')
  await writeFile(join(runDir, 'playbook', 'P3', 'convergence.json'), `${JSON.stringify(p3, null, 2)}\n`, 'utf8')
  await writeFile(join(runDir, 'playbook', 'P4', 'questions.json'), `${JSON.stringify(p4, null, 2)}\n`, 'utf8')
  return { repoDir, runDir }
}

async function listFiles(root: string, base = root): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return listFiles(path, base)
    return [relative(base, path)]
  }))
  return files.flat().sort()
}

describe('P5 synthesis', () => {
  test('produces only traceable objectives and keeps empty inputs as empty arrays', () => {
    const payload = synthesizeP5Governance({ intent, convergence, founderQuestions: questions })

    expect(payload.objectives).toHaveLength(1)
    expect(payload.objectives[0]?.sourceRef).toBe('playbook/P3/convergence.json#finalUnresolvedItems.residual-gap:governance:validation')
    expect(payload.objectives[0]?.evidence).toContain(payload.objectives[0]?.sourceRef)
    expect(payload.candidatePriorities[0]?.status).toBe('future')
    expect(payload.architectureNotes.length).toBeGreaterThan(0)
    expect(payload.glossaryTerms).toEqual([{
      term: 'governance',
      definition: 'Governance coordinates onboarding.',
      ownerLink: './memory/architecture-notes.md',
      sourceRef: 'playbook/P3/convergence.json#sourceAgreementBySubsystem.governance.purpose',
      evidence: ['playbook/P3/convergence.json#sourceAgreementBySubsystem.governance.purpose'],
    }])

    expect(synthesizeP5Governance({
      intent: { ...intent, inferredFromArtifacts: [], openQuestions: [] },
      convergence: { ...convergence, sourceAgreementBySubsystem: {}, finalUnresolvedItems: [] },
      founderQuestions: { version: 1, clarifications: [], conflictingFindings: [], futurePriorities: [] },
    })).toMatchObject({ objectives: [], candidatePriorities: [], architectureNotes: [], glossaryTerms: [] })
  })

  test('drafts glossary terms only from agreeing purpose findings', () => {
    const withoutPurposeAgreement = synthesizeP5Governance({
      intent,
      convergence: {
        ...convergence,
        sourceAgreementBySubsystem: {
          governance: {
            ...agreedComparison,
            purpose: { agrees: false, builder: 'Builder purpose.', orchestrator: 'Orchestrator purpose.' },
          },
        },
      },
      founderQuestions: questions,
    })

    expect(withoutPurposeAgreement.glossaryTerms).toEqual([])
  })

  test('does not stage a glossary when no purpose agreement yields terms', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p5-no-glossary-'))
    try {
      const { repoDir, runDir } = await writeFixture(root, intent, { ...convergence, sourceAgreementBySubsystem: {} }, questions)

      const artifacts = await runPlaybookP5Action({ repoDir, runDir })

      expect(artifacts.synthesis.glossaryTerms).toEqual([])
      await expect(stat(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'glossary.md'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes proposed governance only under runDir/playbook/P5 staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p5-'))
    try {
      const { repoDir, runDir } = await writeFixture(root)
      const before = new Set(await listFiles(runDir))
      const events: Array<{ readonly objectiveCount: number; readonly candidatePriorityCount: number; readonly architectureNoteCount: number; readonly glossaryTermCount: number }> = []

      const artifacts = await runPlaybookP5Action({
        repoDir,
        runDir,
        onSynthesisResult: (event) => events.push(event),
      }, { approvedBy: 'founder', note: 'continue' })

      expect(artifacts.synthesis.objectives).toHaveLength(1)
      expect(events).toEqual([{ objectiveCount: 1, candidatePriorityCount: 1, architectureNoteCount: 4, glossaryTermCount: 1 }])
      const synthesis = JSON.parse(await readFile(join(runDir, 'playbook', 'P5', 'synthesis.json'), 'utf8')) as P5SynthesisPayload
      expect(synthesis.founderCheckpoint).toEqual({ approvedBy: 'founder', note: 'continue' })
      expect(synthesis.glossaryTerms[0]?.sourceRef).toBe('playbook/P3/convergence.json#sourceAgreementBySubsystem.governance.purpose')
      await expect(readFile(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'glossary.md'), 'utf8')).resolves.toContain(
        '| governance | Governance coordinates onboarding. | [owner](./memory/architecture-notes.md) |',
      )
      await expect(readFile(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'memory', 'architecture-notes.md'), 'utf8')).resolves.toContain('Governance coordinates onboarding')
      await expect(readFile(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'priorities', 'objective-1.md'), 'utf8')).resolves.toContain('## Objective')
      const created = (await listFiles(runDir)).filter((file) => !before.has(file))
      expect(created.every((file) => file.startsWith(join('playbook', 'P5')))).toBe(true)
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses malformed P4 questions before writing P5 artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p5-malformed-'))
    try {
      const { repoDir, runDir } = await writeFixture(root, intent, convergence, { ...questions, version: 2 })

      await expect(runPlaybookP5Action({ repoDir, runDir })).rejects.toThrow('playbook/P4/questions.json version must be 1')
      await expect(stat(join(runDir, 'playbook', 'P5'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('keeps the P5 synthesis engine deterministic', async () => {
    const contents = await readFile(join(process.cwd(), 'src', 'playbooks', 'p5-synthesis.ts'), 'utf8')
    expect(contents).not.toMatch(/Date\.now|Math\.random|execFile|spawn|fetch\(|readFile|writeFile/)
  })
})
