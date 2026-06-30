#!/usr/bin/env node
// Proof — the required test checkpoint (ADR-0046): structural run-tests input to the one verify gate.
//
// Turns "is the required test checkpoint really enforced?" into ONE command with a PASS/FAIL table.
// It does NOT reimplement anything: it runs the REAL behavior-pinning tests in the core runner suite
// and the base-personas portability suite, then maps each ADR-0046 "Verified when" clause to named tests.
//
//   node scripts/proof-required-checkpoint.mjs
//
// Green table -> code atoms cannot commit without green tests, the rule is inherited across repo layouts
//                through the portable standard, the existing deterministic exec path is reused, and the
//                no-test-surface escape stays advisory.
// Any red row -> a specific, named failing or missing test to fix (not vague homework).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUITES = [
  { pkg: '@cocoder/core', file: 'tests/runner.test.ts', label: 'runner required-checkpoint behavior' },
  { pkg: '@cocoder/personas', file: 'tests/base-personas.test.ts', label: 'base-personas portability' },
]

const RUNNER_GREEN = 'code-touching packages atom with green required test checkpoint commits'
const RUNNER_RED = 'code-touching atom with red required test checkpoint is quarantined and not committed'
const RUNNER_NO_SURFACE = 'code-touching atom with no discoverable test surface records advisory flag and commits'
const RUNNER_DOCS_ONLY = 'docs-only atom does not run the required test checkpoint and commits as today'
const RUNNER_FAIL_VERDICT = 'required test checkpoint only fires after a passing Oscar verdict'
const RUNNER_CROSS_LAYOUT = 'source files outside packages trigger the required checkpoint but non-source files do not'
const PERSONAS_PORTABLE = 'shared standards stay role-neutral and avoid raw decision shorthand'

const CLAUSES = [
  {
    clause: '1. code atom requires green run-tests',
    expect: 'green code atom commits; red code atom is quarantined and commits nothing',
    matches: [RUNNER_GREEN, RUNNER_RED],
  },
  {
    clause: '2. inherited across onboarded repos',
    expect: 'non-packages source triggers the checkpoint; shared standards stay portable',
    matches: [RUNNER_CROSS_LAYOUT, PERSONAS_PORTABLE],
  },
  {
    clause: '3. deterministic exec path reused',
    expect: 'green pin asserts command + cwd through injected execCriterion',
    matches: [RUNNER_GREEN],
  },
  {
    clause: '4. behavior suites + proof stay green',
    expect: 'runner and personas suites both run green inside this proof',
    suiteGreen: true,
  },
  {
    clause: '5. no-test-surface escape is advisory',
    expect: 'no discoverable test surface records advisory flag and still commits',
    matches: [RUNNER_NO_SURFACE],
  },
]

const SUPPORTING = [
  {
    clause: 'docs/governance atoms skip the hard checkpoint',
    expect: 'docs-only atom commits without running the required checkpoint',
    matches: [RUNNER_DOCS_ONLY],
  },
  {
    clause: 'Oscar fail verdict path is unchanged',
    expect: 'checkpoint only fires after Oscar passes the atom',
    matches: [RUNNER_FAIL_VERDICT],
  },
]

async function runSuite(suite, outFile) {
  try {
    await exec(
      'pnpm',
      ['--filter', suite.pkg, 'exec', 'vitest', 'run', suite.file, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    // Vitest exits non-zero on failing tests. The JSON result is still the source of truth below.
  }
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) return { results: [], passed: 0, total: 0 }
  const json = JSON.parse(raw)
  const results = []
  for (const f of json.testResults ?? []) {
    for (const a of f.assertionResults ?? []) {
      results.push({ title: String(a.title ?? ''), status: String(a.status ?? 'unknown'), suite: suite.label })
    }
  }
  return {
    results,
    passed: results.filter((r) => r.status === 'passed').length,
    total: results.length,
  }
}

function findMatch(results, match) {
  return results.filter((result) => result.title.toLowerCase().includes(match.toLowerCase()))
}

function evaluateRow(row, results, suitesGreen) {
  if (row.suiteGreen) {
    return { ...row, status: suitesGreen ? 'PASS' : 'FAIL', details: suitesGreen ? ['all proof suites green'] : ['one or more proof suites red'] }
  }

  const details = []
  let status = 'PASS'
  for (const match of row.matches ?? []) {
    const hits = findMatch(results, match)
    if (hits.length === 0) {
      status = 'MISSING'
      details.push(`missing "${match}"`)
    } else if (hits.length > 1) {
      status = status === 'PASS' ? 'AMBIGUOUS' : status
      details.push(`ambiguous "${match}" (${hits.length} hits)`)
    } else if (hits[0].status !== 'passed') {
      status = 'FAIL'
      details.push(`red "${hits[0].title}" (${hits[0].status})`)
    } else {
      details.push(`passed "${hits[0].title}"`)
    }
  }
  return { ...row, status, details }
}

function evaluate(rows, results, suitesGreen) {
  return rows.map((row) => evaluateRow(row, results, suitesGreen))
}

function printTable(title, evaluated) {
  console.log(`\n${title}`)
  console.log('─'.repeat(104))
  const icon = { PASS: '✅', FAIL: '❌', MISSING: '⚠️ ', AMBIGUOUS: '❓' }
  for (const row of evaluated) console.log(`${icon[row.status]} ${row.clause.padEnd(44)} ${row.expect}`)
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-required-checkpoint-'))
try {
  console.log('Proof — the required test checkpoint (ADR-0046): structural run-tests input to the one verify gate')
  console.log('Running the real core runner + base-personas suites…')
  const allResults = []
  let suitesGreen = true
  for (const suite of SUITES) {
    const out = join(tmp, `${suite.pkg.replace(/\W/g, '_')}_${suite.file.replace(/\W/g, '_')}.json`)
    const suiteResult = await runSuite(suite, out)
    allResults.push(...suiteResult.results)
    const green = suiteResult.total > 0 && suiteResult.passed === suiteResult.total
    suitesGreen = suitesGreen && green
    console.log(`  • ${suite.label}: ${suiteResult.passed}/${suiteResult.total} tests passed`)
  }

  const clauses = evaluate(CLAUSES, allResults, suitesGreen)
  const supporting = evaluate(SUPPORTING, allResults, suitesGreen)
  printTable('ADR-0046 Verified when — required checkpoint contract:', clauses)
  printTable('Supporting behavior pins — exclusions and unchanged verify-fail path:', supporting)

  const all = [...clauses, ...supporting]
  const failed = all.filter((row) => row.status !== 'PASS')
  console.log('\n' + '═'.repeat(104))
  if (failed.length === 0) {
    console.log('✅ VERDICT: all', all.length, 'rows green. The required test checkpoint is structurally enforced:')
    console.log('   code atoms require green tests, cross-layout source files are covered, execCriterion is reused,')
    console.log('   and no-test-surface cases degrade to advisory + flag instead of blocking legitimate work.')
  } else {
    console.log(`❌ VERDICT: ${failed.length} row(s) not green — concrete failing/missing proof anchors:`)
    for (const row of failed) {
      console.log(`   - [${row.status}] ${row.clause}`)
      for (const detail of row.details) console.log(`     ${detail}`)
    }
    console.log('   Next: restore the named test, fix the runner/persona surface, then re-run this harness.')
  }
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
