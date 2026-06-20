#!/usr/bin/env node
// Proof - drift-audit propose/ratify/apply spine through real unit tests.
//
// Turns "is the Drift audit spine actually sound?" into ONE command with a PASS/FAIL table. It does
// NOT reimplement the drift engines: it runs the REAL tests that prove each invariant and maps each row
// to the behavior it protects.
//
//   node scripts/proof-drift-audit.mjs
//
// Green table -> Drift audit reads governance claims + repo reality, compares them into both-sides
//                evidenced findings, reports drafts without writing governance, and only cocoder/**
//                bounded ratified apply can land changes.
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
  files: [
    'tests/drift-read-claims.test.ts',
    'tests/drift-read-reality.test.ts',
    'tests/drift-compare.test.ts',
    'tests/drift-report.test.ts',
    'tests/drift-apply.test.ts',
  ],
  label: 'drift audit claims, reality, compare, report, and apply tests',
}

const INVARIANTS = [
  {
    invariant: 'P1 claims are evidence-backed and refuse-on-malformed',
    expect: 'claims carry file:line evidence; malformed required governance refuses',
    tests: [
      'extracts representative evidence-backed claims across governance categories',
      'refuses an unreadable required governance file with a useful message',
      'returns zero claims for empty or minimal governance',
    ],
  },
  {
    invariant: 'P2 reality reuses inventoryRepo and exposes stale-reference detection',
    expect: 'repo reality lists only existing, non-ignored paths',
    tests: [
      'wraps repo inventory and lists existing repo-relative paths',
      'omits non-existent paths so stale references can be detected',
      'excludes ignored directories from the path view',
    ],
  },
  {
    invariant: 'P3 compare is non-gameable (both-sides evidence; empty inputs -> empty)',
    expect: 'findings require claim+reality evidence; empty inputs stay empty',
    tests: [
      'reports stale memory path references only when the path is missing',
      'reports priority scope globs only when they match no reality paths',
      'emits zero findings for empty claims or empty reality paths',
    ],
  },
  {
    invariant: 'P4 report is artifacts-only and never writes governance',
    expect: 'reports return relative artifacts and draft text without filesystem writes',
    tests: ['writes no files and returns only relative artifact paths', 'renders an empty report without drafts'],
  },
  {
    invariant: 'P5/P6 apply is cocoder/**-only, refuse-not-flag, all-or-nothing',
    expect: 'ratified apply prevalidates every path before any write',
    tests: [
      'refuses out-of-boundary writes before writing anything',
      'refuses absolute and escaping paths before writing anything',
      'empty writes are a no-op',
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
  console.log('\nDrift audit propose/ratify/apply spine - real-test proof')
  console.log('-'.repeat(112))
  for (const row of rows) {
    console.log(`${row.status.padEnd(7)} ${row.invariant.padEnd(68)} ${row.expect}`)
    console.log(`        tests: ${row.tests.join('; ')}`)
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-drift-audit-'))
try {
  console.log('Proof - drift-audit propose/ratify/apply spine')
  console.log(`Running ${SUITE.label}...`)
  const out = join(tmp, 'core-drift-audit.json')
  const results = await runSuite(out)
  console.log(`  - ${SUITE.label}: ${[...results.values()].filter((status) => status === 'passed').length}/${results.size} tests passed`)

  const rows = evaluate(results)
  printTable(rows)

  const failed = rows.filter((row) => row.status !== 'PASS')
  console.log('\n' + '='.repeat(112))
  if (failed.length === 0) {
    console.log('PASS VERDICT: all 5 invariants green. Drift audit reads governance claims + repo reality,')
    console.log('compares them into both-sides-evidenced findings, reports drafts without writing governance,')
    console.log('and only a cocoder/** bounded ratified apply can land changes.')
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
