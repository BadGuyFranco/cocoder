import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  applyP6Governance,
  runPlaybookP6Action,
  type P5SynthesisPayload,
  type P6RatificationPackage,
} from '../src/index.js'

const synthesis: P5SynthesisPayload = {
  version: 1,
  founderCheckpoint: { approvedBy: 'founder', note: 'P4 accepted' },
  objectives: [{
    id: 'objective-1',
    objective: 'Resolve verified residual gap in governance: validation is not proven.',
    subsystemId: 'governance',
    sourceRef: 'playbook/P3/convergence.json#finalUnresolvedItems.validation',
    evidence: ['playbook/P3/convergence.json#finalUnresolvedItems.validation', 'README.md:1'],
  }],
  candidatePriorities: [{
    id: 'objective-1',
    title: 'Validation is not proven.',
    status: 'future',
    objectiveId: 'objective-1',
    sourceRef: 'playbook/P3/convergence.json#finalUnresolvedItems.validation',
    evidence: ['playbook/P3/convergence.json#finalUnresolvedItems.validation', 'README.md:1'],
  }],
  architectureNotes: [{
    subsystemId: 'governance',
    axis: 'purpose',
    note: 'Governance coordinates onboarding.',
    sourceRef: 'playbook/P3/convergence.json#sourceAgreementBySubsystem.governance.purpose',
    evidence: ['playbook/P3/convergence.json#sourceAgreementBySubsystem.governance.purpose'],
  }],
  glossaryTerms: [{
    term: 'governance',
    definition: 'Governance coordinates onboarding.',
    ownerLink: './memory/architecture-notes.md',
    sourceRef: 'playbook/P3/convergence.json#sourceAgreementBySubsystem.governance.purpose',
    evidence: ['playbook/P3/convergence.json#sourceAgreementBySubsystem.governance.purpose'],
  }],
}

async function writeFixture(root: string, payload: unknown = synthesis): Promise<{ readonly repoDir: string; readonly runDir: string }> {
  const repoDir = join(root, 'repo')
  const runDir = join(root, 'run')
  await mkdir(repoDir, { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'memory'), { recursive: true })
  await mkdir(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'priorities'), { recursive: true })
  await writeFile(join(runDir, 'playbook', 'P5', 'synthesis.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await writeFile(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'glossary.md'), [
    '# Domain Glossary',
    '',
    "This file is this repository's glossary for product and domain terms-of-art.",
    '',
    '## Usage Convention',
    '',
    'Each row is one term: a one-line canonical gloss plus a link to the surface that owns the concept.',
    '',
    '| Term | Definition | Owner |',
    '|---|---|---|',
    '| governance | Governance coordinates onboarding. | [owner](./memory/architecture-notes.md) |',
    '',
  ].join('\n'), 'utf8')
  await writeFile(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'memory', 'architecture-notes.md'), '# Architecture Notes\n\n- Governance coordinates onboarding.\n', 'utf8')
  await writeFile(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'priorities', 'INDEX.md'), '# Candidate Future Priorities\n\n- objective-1\n', 'utf8')
  await writeFile(join(runDir, 'playbook', 'P5', 'proposed-cocoder', 'priorities', 'objective-1.md'), [
    '---',
    'id: objective-1',
    'title: Validation is not proven.',
    'status: future',
    '---',
    '',
    '# Validation is not proven.',
    '',
    '## Objective',
    '',
    'Resolve verified residual gap in governance: validation is not proven.',
    '',
  ].join('\n'), 'utf8')
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

describe('P6 takeover ratification', () => {
  test('present writes a founder ratification package from P5 synthesis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p6-present-'))
    try {
      const { repoDir, runDir } = await writeFixture(root)

      const artifacts = await runPlaybookP6Action({ repoDir, runDir })

      expect(artifacts.ratification.objectives).toHaveLength(1)
      expect(artifacts.ratification.candidatePriorities[0]?.sourceRef).toBe(synthesis.candidatePriorities[0]?.sourceRef)
      expect(artifacts.ratification.glossaryTerms[0]?.term).toBe('governance')
      const ratification = JSON.parse(await readFile(join(runDir, 'playbook', 'P6', 'ratification.json'), 'utf8')) as P6RatificationPackage
      expect(ratification).toMatchObject({ version: 1, objectives: [{ id: 'objective-1' }], candidatePriorities: [{ status: 'future' }], glossaryTerms: [{ term: 'governance' }] })
      await expect(readFile(join(runDir, 'playbook', 'P6', 'ratification.md'), 'utf8')).resolves.toContain('# P6 Ratification')
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('apply materializes staged governance under repoDir/cocoder with runnable priorities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p6-apply-'))
    try {
      const { repoDir, runDir } = await writeFixture(root)
      await mkdir(join(repoDir, 'cocoder'), { recursive: true })
      await writeFile(join(repoDir, 'cocoder', 'glossary.md'), '# Domain Glossary\n\n| Example term | stub |\n', 'utf8')

      const result = await applyP6Governance({ repoDir, runDir, approval: { approvedBy: 'founder', note: 'ratified' } })

      expect(result.event).toEqual({ appliedFileCount: 4, objectiveCount: 1, priorityCount: 1, architectureNoteCount: 1, glossaryTermCount: 1 })
      expect(await listFiles(join(repoDir, 'cocoder'))).toEqual([
        'glossary.md',
        join('memory', 'architecture-notes.md'),
        join('priorities', 'INDEX.md'),
        join('priorities', 'objective-1.md'),
      ])
      const glossary = await readFile(join(repoDir, 'cocoder', 'glossary.md'), 'utf8')
      expect(glossary).toContain('| governance | Governance coordinates onboarding. | [owner](./memory/architecture-notes.md) |')
      expect(glossary).not.toContain('Example term')
      await expect(readFile(join(repoDir, 'cocoder', 'memory', 'architecture-notes.md'), 'utf8')).resolves.toContain('Governance coordinates onboarding')
      const priority = await readFile(join(repoDir, 'cocoder', 'priorities', 'objective-1.md'), 'utf8')
      expect(priority).toContain('## Objective')
      expect(priority).not.toContain('status: future')
      const record = await readFile(join(runDir, 'playbook', 'P6', 'ratification-record.json'), 'utf8')
      expect(record).toContain('"approvedBy": "founder"')
      expect(record).toContain('"glossaryTermCount": 1')
      expect(result.appliedFiles.every((path) => path.startsWith('cocoder/'))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses malformed synthesis before writing P6 artifacts or repo governance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cocoder-playbook-p6-malformed-'))
    try {
      const { repoDir, runDir } = await writeFixture(root, { ...synthesis, version: 2 })

      await expect(runPlaybookP6Action({ repoDir, runDir })).rejects.toThrow('playbook/P5/synthesis.json version must be 1')
      await expect(applyP6Governance({ repoDir, runDir, approval: { approvedBy: 'founder', note: null } })).rejects.toThrow('playbook/P5/synthesis.json version must be 1')
      await expect(stat(join(runDir, 'playbook', 'P6'))).rejects.toThrow()
      await expect(stat(join(repoDir, 'cocoder'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('keeps P6 implementation deterministic', async () => {
    const files = ['p6-apply.ts', 'p6-input.ts', 'p6-render.ts']
    const contents = await Promise.all(files.map((file) => readFile(join(process.cwd(), 'src', 'playbooks', file), 'utf8')))
    expect(contents.join('\n')).not.toMatch(/Date\.now|Math\.random|execFile|spawn|fetch\(/)
  })
})
