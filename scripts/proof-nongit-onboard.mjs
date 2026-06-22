#!/usr/bin/env node
// Proof - D/E onboarding behavior for non-git and already-git primary roots.
//
// Turns "does workspace onboarding produce the right real git history?" into ONE command with a
// PASS/FAIL table. It does NOT reimplement git, scaffold, or the daemon: it runs the REAL daemon
// tests that prove the invariants and maps each row to the behavior it protects.
//
//   node scripts/proof-nongit-onboard.mjs
//
// Green table -> the D/E onboarding behavior is proven by real tests: non-git roots get a full-tree
//                baseline plus complete governance commit and clean status; already-git roots are not
//                re-imported and commit every written non-ignored governance file.
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
  pkg: '@cocoder/daemon',
  file: 'tests/mutations.test.ts',
  label: 'daemon real-git workspace onboarding tests',
}

const INVARIANTS = [
  {
    invariant: 'non-git root baseline + governance commit',
    expect: 'git init, full existing tree baseline, junk excluded, clean status',
    tests: ['POST /workspaces initializes and commits governance for a non-git primary root'],
  },
  {
    invariant: 'already-git root complete governance commit',
    expect: 'no re-import; committed == written - ignored, including counters/workspace',
    tests: ['POST /workspaces leaves an existing git root remote and root gitignore untouched'],
  },
]

const EXPECTED_TESTS = new Set(INVARIANTS.flatMap((row) => row.tests))
const TEST_FILTER = [...EXPECTED_TESTS].map(escapeRegex).join('|')

// Invariant 2 also pins the run_181 counters.json ownership concern: scaffold create-seeds
// counters.json into the governance commit; run history owns later mutations.
async function runSuite(outFile) {
  try {
    await exec(
      'pnpm',
      ['--filter', SUITE.pkg, 'exec', 'vitest', 'run', SUITE.file, '-t', TEST_FILTER, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    // Vitest exits non-zero when a selected test fails or no tests match. The JSON report is still
    // the source of truth when present; missing report data becomes MISSING below.
  }
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) return new Map()
  const json = JSON.parse(raw)
  const results = new Map()
  for (const file of json.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (EXPECTED_TESTS.has(assertion.title)) results.set(assertion.title, assertion.status)
    }
  }
  return results
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  console.log('\nD/E onboarding real-git proof')
  console.log('-'.repeat(112))
  for (const row of rows) {
    console.log(`${row.status.padEnd(8)} ${row.invariant.padEnd(44)} ${row.expect}`)
    console.log(`         tests: ${row.tests.join('; ')}`)
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-nongit-onboard-'))
try {
  console.log('Proof - D/E onboarding behavior')
  console.log(`Running ${SUITE.label}...`)
  const out = join(tmp, 'daemon-nongit-onboard.json')
  const results = await runSuite(out)
  console.log(`  - ${SUITE.label}: ${[...results.values()].filter((status) => status === 'passed').length}/${results.size} tests passed`)

  const rows = evaluate(results)
  printTable(rows)

  const failed = rows.filter((row) => row.status !== 'PASS')
  console.log('\n' + '='.repeat(112))
  if (failed.length === 0) {
    console.log('PASS VERDICT: both D/E onboarding invariants are green through the real daemon tests.')
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
