#!/usr/bin/env node
// Proof - Oscar-Deb autonomous repair dialogue (ADR-0036).
//
// Maps the objective's verified-when clauses to the shipped tests that prove them.
//
//   node scripts/proof-oscar-deb-repair.mjs

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const suites = [
  {
    id: 'operation',
    files: ['packages/daemon/tests/oscar-deb-repair-op.test.ts'],
    tests: [
      'allows a wrapped source run and completes an applied Deb repair',
      'runs proposal through Oscar direction and a second Deb turn before committing',
      'records founder escalation without committing',
      'returns failed when Deb turn exits nonzero and commits nothing',
      'never spawns Bob or enters the run loop',
    ],
  },
  {
    id: 'build-loop',
    files: [
      'packages/core/tests/orchestration-contracts.test.ts',
      'packages/core/tests/directive.test.ts',
    ],
    tests: [
      'build-loop directives expose no second Deb repair lane',
      'rejects the removed Deb investigation directive kind',
    ],
  },
]

const clauses = [
  {
    clause: 'Oscar initiates post-wrap and routes to Deb without Bob/runRun',
    suite: 'operation',
    tests: [
      'allows a wrapped source run and completes an applied Deb repair',
      'never spawns Bob or enters the run loop',
    ],
  },
  {
    clause: 'Deb lands an in-scope fix or proposes for Oscar evaluation and direction',
    suite: 'operation',
    tests: [
      'allows a wrapped source run and completes an applied Deb repair',
      'runs proposal through Oscar direction and a second Deb turn before committing',
    ],
  },
  {
    clause: 'Risky items escalate to the founder with no commit',
    suite: 'operation',
    tests: ['records founder escalation without committing'],
  },
  {
    clause: 'Failed repair dialogue commits nothing and does not rescue the run',
    suite: 'operation',
    tests: ['returns failed when Deb turn exits nonzero and commits nothing'],
  },
  {
    clause: 'Build loop carries no second Deb investigation lane',
    suite: 'build-loop',
    tests: [
      'build-loop directives expose no second Deb repair lane',
      'rejects the removed Deb investigation directive kind',
    ],
  },
]

function relOutput(path) {
  return path.replaceAll('\\', '/')
}

function firstOutputLine(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? 'no output captured'
}

async function runSuite(suite, outFile) {
  let exitCode = 0
  let output = ''
  try {
    const result = await exec(
      'pnpm',
      ['--dir', repoRoot, 'exec', 'vitest', 'run', ...suite.files, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
    output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  } catch (error) {
    exitCode = typeof error?.code === 'number' ? error.code : 1
    output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n')
  }

  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) throw new Error(`${suite.id}: vitest did not write JSON output\n${firstOutputLine(output)}`)
  const json = JSON.parse(raw)
  const assertions = new Map()
  for (const file of json.testResults ?? []) {
    const name = relOutput(String(file.name ?? ''))
    if (name.includes('/.worktrees/')) continue
    for (const assertion of file.assertionResults ?? []) {
      assertions.set(String(assertion.title), String(assertion.status))
    }
  }

  if (exitCode !== 0) {
    throw new Error(`${suite.id}: vitest exited ${exitCode}\n${firstOutputLine(output)}`)
  }
  for (const testName of suite.tests) {
    const status = assertions.get(testName)
    if (status !== 'passed') {
      throw new Error(`${suite.id}: expected "${testName}" to pass, got ${status ?? 'missing'}`)
    }
  }
  return assertions
}

function printRows(rows) {
  console.log('\nverified-when clause | verdict | evidence')
  console.log('-'.repeat(120))
  for (const row of rows) {
    console.log(`${row.clause} | PASS | ${row.evidence}`)
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-oscar-deb-repair-'))
const results = new Map()
const rows = []
let failure = null

try {
  console.log('Proof - Oscar-Deb autonomous repair dialogue (ADR-0036)')
  for (const suite of suites) {
    console.log(`Running ${suite.id}: ${suite.files.join(', ')}`)
    results.set(suite.id, await runSuite(suite, join(tmp, `${suite.id}.json`)))
  }

  for (const clause of clauses) {
    const assertions = results.get(clause.suite)
    if (!assertions) throw new Error(`missing suite result: ${clause.suite}`)
    for (const testName of clause.tests) {
      if (assertions.get(testName) !== 'passed') {
        throw new Error(`${clause.clause}: expected "${testName}" to pass`)
      }
    }
    rows.push({
      clause: clause.clause,
      evidence: clause.tests.map((testName) => `${testName}`).join('; '),
    })
  }
} catch (error) {
  failure = error
} finally {
  await rm(tmp, { recursive: true, force: true })
}

printRows(rows)
console.log('\n' + '='.repeat(120))

if (failure) {
  console.log(`FAIL: ${failure.message}`)
  process.exitCode = 1
} else {
  console.log('PASS: Oscar-Deb repair dialogue proof mapped every verified-when clause to green shipped tests.')
}
