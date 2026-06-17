import { join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { basePlaybooksDir } from '../../personas/src/index.js'
import { loadOnboardingPlaybooks } from '../src/index.js'

describe('onboarding playbook loader', () => {
  test('discovers the shipped onboarding playbooks', () => {
    const playbooks = loadOnboardingPlaybooks(basePlaybooksDir())
    const byId = new Map(playbooks.map((playbook) => [playbook.id, playbook]))

    expect([...byId.keys()].sort()).toEqual(['cocoder-takeover', 'drift-audit', 'new-primary'])
    expect(byId.has('README')).toBe(false)

    expect(byId.get('new-primary')).toMatchObject({
      id: 'new-primary',
      title: 'New Primary — onboard a fresh/empty primary root',
      mode: 'bootstrap',
      modelPin: 'standard',
      writeScope: ['cocoder/**'],
    })
    expect(byId.get('cocoder-takeover')).toMatchObject({
      id: 'cocoder-takeover',
      title: 'CoCoder Takeover — onboard an existing repo via a deep multi-agent audit',
      mode: 'takeover',
      modelPin: 'top-tier',
      writeScope: ['cocoder/**'],
    })
    expect(byId.get('drift-audit')).toMatchObject({
      id: 'drift-audit',
      title: 'Drift Audit — re-audit an already-managed cocoder/ root (propose-only)',
      mode: 'drift',
      modelPin: 'top-tier',
      writeScope: ['cocoder/**'],
    })

    for (const playbook of playbooks) {
      expect(playbook.objective).toEqual(expect.any(String))
      expect(playbook.objective).not.toHaveLength(0)
    }
  })

  test('parses exact ordered executable phases for shipped playbooks', () => {
    const playbooks = loadOnboardingPlaybooks(basePlaybooksDir())
    const byId = new Map(playbooks.map((playbook) => [playbook.id, playbook]))
    const phaseSummary = (id: string) =>
      byId.get(id)?.phases.map(({ id: phaseId, title, kind, founderGate }) => ({
        id: phaseId,
        title,
        kind,
        founderGate,
      }))

    expect(phaseSummary('cocoder-takeover')).toEqual([
      { id: 'P0', title: 'Scaffold', kind: 'scaffold', founderGate: false },
      { id: 'P1', title: 'Recon', kind: 'recon', founderGate: true },
      { id: 'P2', title: 'Dual-source deep read', kind: 'deep-read-fanout', founderGate: false },
      { id: 'P3', title: 'Adversarial cross-check', kind: 'cross-check', founderGate: false },
      { id: 'P4', title: 'Founder questions', kind: 'founder-question', founderGate: true },
      { id: 'P5', title: 'Synthesize', kind: 'synthesize', founderGate: false },
      { id: 'P6', title: 'Ratify', kind: 'ratify', founderGate: true },
      { id: 'P7', title: 'Prove', kind: 'prove', founderGate: false },
    ])
    expect(phaseSummary('new-primary')).toEqual([
      { id: 'P0', title: 'Scaffold', kind: 'scaffold', founderGate: false },
      { id: 'P1', title: 'Intake conversation', kind: 'intake', founderGate: false },
      { id: 'P1a', title: 'Optional stack starter', kind: 'stack-starter', founderGate: true },
      { id: 'P2', title: 'Seed minimal governance', kind: 'synthesize', founderGate: false },
      { id: 'P3', title: 'Ratify', kind: 'ratify', founderGate: true },
      { id: 'P4', title: 'Prove', kind: 'prove', founderGate: false },
    ])
    expect(phaseSummary('drift-audit')).toEqual([
      { id: 'P1', title: 'Read claims', kind: 'drift-read-claims', founderGate: false },
      { id: 'P2', title: 'Read reality', kind: 'drift-read-reality', founderGate: false },
      { id: 'P3', title: 'Compare', kind: 'drift-compare', founderGate: false },
      { id: 'P4', title: 'Report', kind: 'drift-report', founderGate: false },
      { id: 'P5', title: 'Ratify', kind: 'ratify', founderGate: true },
      { id: 'P6', title: 'Apply', kind: 'drift-apply', founderGate: false },
    ])
  })

  test('refuses a playbook with an unmappable phase title', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cocoder-playbook-loader-'))
    try {
      writeFileSync(
        join(dir, 'unknown-phase.md'),
        `---
id: unknown-phase
title: "Unknown Phase"
type: onboarding-playbook
mode: bootstrap
writeScope: ["cocoder/**"]
modelPin: standard
---

## Objective
Reject this playbook.

## The baked Playbook

| Phase | Det/Agentic | Founder gate | Output |
|---|---|---|---|
| **P0 · Mystery phase** | deterministic | — | nothing |
`,
      )

      expect(loadOnboardingPlaybooks(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns an empty list for a nonexistent directory', () => {
    expect(loadOnboardingPlaybooks(join(basePlaybooksDir(), 'missing'))).toEqual([])
  })
})
