import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { enumerateIntentArtifacts, runIntentIntake, type IntentGitReader } from '../src/playbooks/index.js'

function writeFixtureFile(root: string, path: string, content: string): void {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

const fakeGitReader: IntentGitReader = {
  async recentCommits() {
    return [
      { sha: 'abc1234', subject: 'Add onboarding executor' },
      { sha: 'abc1234', subject: 'Duplicate should dedupe by ref' },
      { sha: 'def5678', subject: 'Document takeover path' },
    ]
  },
  async tags() {
    return [
      { name: 'v0.2.0', subject: 'Onboarding preview' },
      { name: 'v0.1.0' },
    ]
  },
}

describe('intent artifact enumeration', () => {
  test('discovers bounded file, commit, and tag artifacts in stable deduped order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-intent-artifacts-'))
    try {
      writeFixtureFile(dir, 'README.md', '# Product\nCoCoder coordinates AI coding teams.\n')
      writeFixtureFile(dir, 'docs/usage.md', '# Usage\nRun onboarding playbooks.\n')
      writeFixtureFile(dir, 'CHANGELOG.md', '# Changelog\n- Added takeover flow.\n')
      writeFixtureFile(dir, 'package.json', JSON.stringify({ name: 'fixture', description: 'AI coding orchestration' }))
      writeFixtureFile(dir, 'src/index.ts', 'export const ignored = true\n')

      const artifacts = await enumerateIntentArtifacts({ repoDir: dir, gitReader: fakeGitReader })
      const refs = artifacts.map((artifact) => artifact.ref)

      expect(refs).toEqual([...refs].sort())
      expect(refs).toEqual(['CHANGELOG.md', 'README.md', 'commit:abc1234', 'commit:def5678', 'docs/usage.md', 'package.json', 'tag:v0.1.0', 'tag:v0.2.0'])
      expect(new Set(refs).size).toBe(refs.length)
      expect(artifacts.find((artifact) => artifact.ref === 'README.md')).toMatchObject({ kind: 'file', excerpt: expect.stringContaining('CoCoder coordinates') })
      expect(artifacts.find((artifact) => artifact.ref === 'package.json')?.excerpt).toBe('name: fixture\ndescription: AI coding orchestration')
      expect(artifacts.find((artifact) => artifact.ref === 'commit:abc1234')).toMatchObject({ kind: 'commit', excerpt: 'Add onboarding executor' })
      expect(artifacts.find((artifact) => artifact.ref === 'tag:v0.2.0')).toMatchObject({ kind: 'tag', excerpt: 'Onboarding preview' })
      expect(artifacts.every((artifact) => artifact.kind !== 'issue')).toBe(true)
      expect(artifacts.map((artifact) => artifact.kind as string)).not.toContain('branch')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('enforces excerpt and scan bounds without dumping huge files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-intent-artifacts-bounds-'))
    try {
      writeFixtureFile(dir, 'README.md', 'R'.repeat(1_000))
      writeFixtureFile(dir, 'docs/huge.md', 'D'.repeat(1_000))
      writeFixtureFile(dir, 'docs/skip.md', 'skip me when maxFileArtifacts is reached')

      const artifacts = await enumerateIntentArtifacts({
        repoDir: dir,
        gitReader: { recentCommits: async () => [], tags: async () => [] },
        limits: { maxFileArtifacts: 2, maxFileBytes: 100, maxTotalFileBytes: 150, maxExcerptChars: 40 },
      })

      expect(artifacts.map((artifact) => artifact.ref)).toEqual(['README.md', 'docs/huge.md'])
      expect(artifacts.every((artifact) => (artifact.excerpt ?? '').length <= 40)).toBe(true)
      expect(artifacts.find((artifact) => artifact.ref === 'README.md')?.excerpt).toBe('R'.repeat(40))
      expect(artifacts.find((artifact) => artifact.ref === 'docs/huge.md')?.excerpt).toBe('D'.repeat(40))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('produced refs are consumable by the intent intake provenance guard', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-intent-artifacts-consume-'))
    try {
      writeFixtureFile(dir, 'README.md', '# Purpose\nThe repo helps founders orchestrate coding agents.\n')
      const artifacts = await enumerateIntentArtifacts({
        repoDir: dir,
        gitReader: { recentCommits: async () => [{ sha: 'abc1234', subject: 'Initial product direction' }], tags: async () => [] },
      })
      const refs = artifacts.map((artifact) => artifact.ref)

      const intent = await runIntentIntake({
        artifacts,
        agentTurn: async () => ({
          claims: [
            { claim: 'The repo helps founders orchestrate coding agents.', provenance: ['README.md'] },
            { claim: 'Recent work established product direction.', provenance: ['commit:abc1234'] },
          ],
          openQuestions: [],
        }),
      })

      expect(refs).toContain('README.md')
      expect(refs).toContain('commit:abc1234')
      expect(intent.inferredFromArtifacts.map((claim) => claim.provenance.map((item) => item.ref))).toEqual([['README.md'], ['commit:abc1234']])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is deterministic for the same repo and fake git reader', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-intent-artifacts-determinism-'))
    try {
      writeFixtureFile(dir, 'README.md', '# Product\nStable artifact list.\n')
      writeFixtureFile(dir, 'docs/a.md', 'A\n')
      const first = await enumerateIntentArtifacts({ repoDir: dir, gitReader: fakeGitReader })
      const second = await enumerateIntentArtifacts({ repoDir: dir, gitReader: fakeGitReader })
      expect(second).toEqual(first)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
