import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  buildFounderQuestions,
  runPlaybookP4Action,
  type P4QuestionsPayload,
} from '../src/index.js'
import type { IntentJson, P3ConvergencePayload, SourcePairComparison } from '../src/playbooks/index.js'

const predicateClauses = {
  noNewContradictionOrDisagreement: true,
  noNewCoverageGap: true,
  priorItemsResolvedOrCarried: true,
  p1SurfaceRepresented: true,
}

const agreedComparison: SourcePairComparison = {
  purpose: { agrees: true, builder: 'same', orchestrator: 'same' },
  keyBehaviors: { agrees: true, builder: ['same'], orchestrator: ['same'] },
  dataControlFlow: { agrees: true, builder: 'same', orchestrator: 'same' },
  riskSurface: { agrees: true, builder: 'same', orchestrator: 'same' },
  coverage: { agrees: true, builder: { coveredEntryPoints: [], coveredValidationCommands: [] }, orchestrator: { coveredEntryPoints: [], coveredValidationCommands: [] } },
  residualGaps: { agrees: true, builder: [], orchestrator: [] },
}

const emptyIntent: IntentJson = {
  version: 1,
  inferredFromArtifacts: [],
  founderAsserted: { projectPurpose: null, futureDirection: null, mustNotChange: null, milestonesOrConstraints: null },
  openQuestions: [],
}

const emptyConvergence: P3ConvergencePayload = {
  version: 1,
  roundsRun: 1,
  rounds: [],
  sourceAgreementBySubsystem: {},
  followUpReads: [],
  predicateClauses,
  converged: true,
  capStatus: { tripped: false, reasons: [], tokenCap: 100_000, maxRounds: 3, maxWallClockMs: 1_800_000 },
  finalUnresolvedItems: [],
}

function populatedIntent(): IntentJson {
  return {
    ...emptyIntent,
    inferredFromArtifacts: [{ kind: 'inferred', claim: 'The repo coordinates onboarding.', provenance: [{ ref: 'README.md', kind: 'file' }] }],
    openQuestions: ['What should P2 inspect first?'],
  }
}

function populatedConvergence(): P3ConvergencePayload {
  return {
    ...emptyConvergence,
    sourceAgreementBySubsystem: {
      api: {
        ...agreedComparison,
        riskSurface: { agrees: false, builder: 'Release risk.', orchestrator: 'Security risk.' },
      },
    },
    converged: false,
    capStatus: { ...emptyConvergence.capStatus, tripped: true, reasons: ['round'] },
    finalUnresolvedItems: [{
      key: 'residual-gap:api:auth-not-proven',
      kind: 'residual-gap',
      subsystemId: 'api',
      note: 'Authentication behavior is not proven.',
      severity: 'high',
      confidence: 'medium',
      evidence: ['playbook/P2/convergence/api.json#sources.builder.finalResidualGaps'],
    }],
  }
}

async function writeFixture(root: string, intent: unknown = emptyIntent, convergence: unknown = emptyConvergence): Promise<{ readonly repoDir: string; readonly runDir: string }> {
  const repoDir = join(root, 'repo')
  const runDir = join(root, 'run')
  await mkdir(join(repoDir, 'packages', 'api'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P1'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P3'), { recursive: true })
  await writeFile(join(runDir, 'playbook', 'P1', 'intent.json'), `${JSON.stringify(intent, null, 2)}\n`, 'utf8')
  await writeFile(join(runDir, 'playbook', 'P3', 'convergence.json'), `${JSON.stringify(convergence, null, 2)}\n`, 'utf8')
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

describe('P4 founder questions', () => {
  test('partitions clarifications, conflicting findings, and future priorities with traceable sources', () => {
    const questions = buildFounderQuestions({ intent: populatedIntent(), convergence: populatedConvergence() })

    expect(questions.clarifications.map((item) => item.note)).toContain('What should P2 inspect first?')
    expect(questions.conflictingFindings.map((item) => item.note)).toContain('P3 sources disagree on riskSurface for api.')
    expect(questions.conflictingFindings.map((item) => item.note)).toContain('Authentication behavior is not proven.')
    expect(questions.futurePriorities.map((item) => item.note)).toEqual(['Authentication behavior is not proven.'])
    for (const item of [...questions.clarifications, ...questions.conflictingFindings, ...questions.futurePriorities]) {
      expect(item).toHaveProperty('subsystemId')
      expect(item.evidence.length).toBeGreaterThan(0)
      expect(item.sourceRef).toMatch(/^playbook\//)
    }
  })

  test('keeps all three classes as empty arrays when inputs contain no questions', () => {
    const questions = buildFounderQuestions({ intent: emptyIntent, convergence: emptyConvergence })

    expect(questions).toEqual({ version: 1, clarifications: [], conflictingFindings: [], futurePriorities: [] })
  })

  test('refuses malformed input before writing artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p4-malformed-'))
    try {
      const { repoDir, runDir } = await writeFixture(root, { ...emptyIntent, version: 2 })

      await expect(runPlaybookP4Action({ repoDir, runDir })).rejects.toThrow('playbook/P1/intent.json version must be 1')
      await expect(stat(join(runDir, 'playbook', 'P4'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes only questions artifacts under runDir/playbook/P4', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p4-boundary-'))
    try {
      const { repoDir, runDir } = await writeFixture(root, populatedIntent(), populatedConvergence())
      const before = new Set(await listFiles(runDir))
      const events: Array<{ readonly clarificationCount: number; readonly conflictingFindingCount: number; readonly futurePriorityCount: number }> = []

      const artifacts = await runPlaybookP4Action({
        repoDir,
        runDir,
        onFounderQuestionsResult: (event) => events.push(event),
      })

      expect(artifacts.questions.clarifications.length).toBeGreaterThan(0)
      expect(events).toEqual([{ clarificationCount: 2, conflictingFindingCount: 2, futurePriorityCount: 1 }])
      const questions = JSON.parse(await readFile(join(runDir, 'playbook', 'P4', 'questions.json'), 'utf8')) as P4QuestionsPayload
      expect(Object.keys(questions).sort()).toEqual(['clarifications', 'conflictingFindings', 'futurePriorities', 'version'])
      await expect(readFile(join(runDir, 'playbook', 'P4', 'questions.md'), 'utf8')).resolves.toContain('## Clarifications')
      const after = await listFiles(runDir)
      const created = after.filter((file) => !before.has(file))
      expect(created.sort()).toEqual([join('playbook', 'P4', 'questions.json'), join('playbook', 'P4', 'questions.md')].sort())
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('keeps the new core P4 modules deterministic', async () => {
    const files = ['p4-input.ts', 'p4-questions.ts', 'p4-action.ts', 'p4-render.ts']
    const contents = await Promise.all(files.map((file) => readFile(join(process.cwd(), 'src', 'playbooks', file), 'utf8')))
    expect(contents.join('\n')).not.toMatch(/Date\.now|Math\.random|execFile|spawn|fetch\(/)
  })
})
