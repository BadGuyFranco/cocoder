#!/usr/bin/env node
// Proof - onboard-existing as an ordinary Oscar-driven priority, not a standalone phase executor.
//
// Turns "is the onboarding rebuild actually wired through ordinary priorities?" into ONE command with a
// PASS/FAIL table. It does NOT reimplement the runner, commit gate, or scaffold: it runs the REAL tests
// that prove the rebuilt invariants and maps each row to the behavior it protects.
//
//   node scripts/proof-onboard-existing.mjs
//
// Green table -> onboard-existing refuses product-code writes through the ordinary commit gate,
//                ordinary priorities keep ADR-0023 whole-tree commit semantics, and scaffold seeding
//                gives existing repos the audit priority while leaving empty repos unseeded.
// Any red row -> a specific, named failing or missing test to fix (not vague homework).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUITE = {
  pkg: '@cocoder/core',
  files: ['tests/runner.test.ts', 'tests/commit-gate.test.ts', 'tests/scaffold.test.ts', 'tests/playbook-p5-synthesis.test.ts', 'tests/playbook-p6-apply.test.ts'],
  label: 'onboard-existing runner, commit-gate, scaffold, and synthesis tests',
}

const INVARIANTS = [
  {
    invariant: 'onboarding refuses product-code writes',
    expect: 'AuditWriteBoundaryError before commit; no commit links',
    tests: [
      'refuses onboard-existing product-code writes before the ordinary atom gate commits',
      'refuses onboard-existing audit commits outside cocoder/** before committing',
      'refuses P6 ratification apply-commit when any product path is changed',
    ],
  },
  {
    invariant: 'ordinary runs are unchanged',
    expect: 'no boundary means out-of-lane edits commit and are flagged',
    tests: ['ordinary priorities keep whole-tree commit behavior and only flag out-of-lane files'],
  },
  {
    invariant: 'scaffold seeding is conditional',
    expect: 'existing repos get onboard-existing; .git-only repos do not; reruns are create-only',
    tests: [
      'seeds onboard-existing only when target already has source content',
      'does not seed onboard-existing into a .git-only new repo',
      'is idempotent after seeding onboard-existing into an existing repo',
    ],
  },
  {
    invariant: 'domain glossary is a delivered, single-owner deliverable',
    expect: 'scaffold delivers glossary; boundary remains owned by ADR-0039',
    tests: ['copies the shipped template tree into an empty target', 'keeps the domain glossary boundary rule owned by ADR-0039'],
  },
  {
    invariant: 'onboarding drafts live domain terms, not a dead stub',
    expect: 'verified purpose agreement stages and applies real glossary rows',
    tests: [
      'drafts glossary terms only from agreeing purpose findings',
      'does not stage a glossary when no purpose agreement yields terms',
      'apply materializes staged governance under repoDir/cocoder with runnable priorities',
    ],
  },
]

async function runSuite(outFile) {
  try {
    await exec(
      'pnpm',
      ['--filter', SUITE.pkg, 'exec', 'vitest', 'run', ...SUITE.files, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    // Vitest exits non-zero when a selected test fails. The JSON report is still the source of truth.
  }
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) return new Map()
  const json = JSON.parse(raw)
  const results = new Map()
  for (const file of json.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) results.set(assertion.title, assertion.status)
  }
  return results
}

function evaluate(results) {
  return INVARIANTS.map((row) => {
    const checks = row.tests.map((title) => ({ title, status: results.get(title) ?? 'missing' }))
    const status = checks.every((check) => check.status === 'passed')
      ? 'PASS'
      : checks.some((check) => check.status === 'failed')
        ? 'FAIL'
        : 'MISSING'
    return { ...row, checks, status }
  })
}

function printTable(rows) {
  console.log('\nOscar-driven onboard-existing rebuild - real-test proof')
  console.log('-'.repeat(104))
  for (const row of rows) {
    console.log(`${row.status.padEnd(7)} ${row.invariant.padEnd(42)} ${row.expect}`)
    console.log(`        tests: ${row.tests.join('; ')}`)
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-onboard-existing-'))
try {
  console.log('Proof - onboard-existing ordinary-priority rebuild')
  console.log(`Running ${SUITE.label}...`)
  const out = join(tmp, 'core-onboard-existing.json')
  const results = await runSuite(out)
  console.log(`  - ${SUITE.label}: ${[...results.values()].filter((status) => status === 'passed').length}/${results.size} tests passed`)

  const rows = evaluate(results)
  printTable(rows)

  const failed = rows.filter((row) => row.status !== 'PASS')
  console.log('\n' + '='.repeat(104))
  if (failed.length === 0) {
    console.log('PASS VERDICT: all 5 invariants green. Onboarding is now proven through ordinary priority data,')
    console.log('the ordinary commit spine default is unchanged, scaffold seeding is conditional + idempotent,')
    console.log('and the domain glossary is delivered, single-owner, and alive on onboarding.')
  } else {
    console.log(`FAIL VERDICT: ${failed.length} invariant row(s) not green - fix the named test(s), then rerun this proof:`)
    for (const row of failed) {
      const broken = row.checks.filter((check) => check.status !== 'passed')
      console.log(`   - [${row.status}] ${row.invariant}`)
      for (const check of broken) console.log(`     ${check.status}: ${check.title}`)
    }
  }
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
