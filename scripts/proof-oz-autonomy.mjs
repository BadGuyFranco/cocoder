#!/usr/bin/env node
// Proof - Oz autonomy (ADR-0040): conversational authoring, oz-action, and code-level guards.
//
// Turns the oz-autonomy priority's "Verified when" bullets into ONE command with a PASS/FAIL
// table. It does NOT reimplement orchestration logic: it runs the REAL daemon/core Vitest suites
// via Vitest JSON output, checks only the declared ADR filesystem surfaces, then runs the REAL
// repository static build gate last.
//
//   node scripts/proof-oz-autonomy.mjs
//
// Green rows -> Oz can author through the existing author spine, oz-action commits only reversible
// governance edits while holding out-of-lane paths back, product/secrets/local paths are excluded by
// the core scope guard, Objective-less priority authoring is refused, ADR-0040 is accepted and indexed,
// and typecheck is green.

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const SUITES = [
  { pkg: '@cocoder/daemon', file: 'tests/authoring-play.test.ts', label: 'authoring Play spine + Objective guard' },
  { pkg: '@cocoder/daemon', file: 'tests/oz-chat.test.ts', label: 'Oz executable command replies' },
  { pkg: '@cocoder/daemon', file: 'tests/oz-agent-chat.test.ts', label: 'Oz agent tool rounds' },
  { pkg: '@cocoder/daemon', file: 'tests/oz-action.test.ts', label: 'oz-action daemon lane' },
  { pkg: '@cocoder/core', file: 'tests/oz-action-scope.test.ts', label: 'core oz-action scope guard' },
]

const CLAUSES = [
  {
    id: 'A',
    required: true,
    clause: 'Oz creates and commits a priority conversationally via the author spine with no adhoc run',
    tests: [
      'dispatches create-priority and commits the priority file through the repair spine',
      'author executable dispatches to the authoring Play op and renders committed path, sha, log, and refresh hint',
      'author tool strips play from invocation and dispatches one authoring Play action',
      'agent authoring commits a priority and immediate launch succeeds with no manual commit',
    ],
  },
  {
    id: 'B',
    required: true,
    clause: 'oz-action gate-commits all changed paths and flags out-of-lane paths',
    tests: [
      'gate-commits all changed paths as oz-action and flags out-of-lane edits',
      'refuses while any run is in flight before spawning or committing',
      'oz-action executable dispatches to the Oz action op and renders committed plus flagged paths',
      'oz-action tool dispatches through ops and feeds committed plus flagged paths to the follow-up prompt',
      'malformed oz-action tool call feeds validation errors back without executing',
    ],
  },
  {
    id: 'C',
    required: true,
    clause: 'Code-level oz-action scope guard excludes product code, secrets, and install-local state',
    tests: [
      'matches only ADR-0040 reversible-edit paths',
      'commits all paths and flags hard exclusions',
    ],
  },
  {
    id: 'D',
    required: true,
    clause: 'Authoring cannot commit a net-new or blanked priority Objective',
    tests: [
      'refuses create-priority when the written priority has no founder-approved Objective',
      'refuses edit-priority when the edit blanks an existing Objective',
      'archive-priority is exempt from the Objective guard and still commits',
    ],
  },
]

const BUILDS = [
  { command: 'pnpm typecheck', args: ['typecheck'] },
]

async function runSuite(suite, outFile) {
  try {
    await exec(
      'pnpm',
      ['--filter', suite.pkg, 'exec', 'vitest', 'run', suite.file, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    // Vitest exits non-zero when tests fail; the JSON result is still the source of truth.
  }
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  if (!raw) return new Map()
  const json = JSON.parse(raw)
  const results = new Map()
  for (const f of json.testResults ?? []) {
    for (const a of f.assertionResults ?? []) results.set(a.title, a.status)
  }
  return results
}

async function runBuild(build) {
  try {
    await exec('pnpm', build.args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
    return { ok: true, evidence: `${build.command} exited 0` }
  } catch (error) {
    return { ok: false, evidence: `${build.command} failed: ${firstOutputLine(error)}` }
  }
}

function firstOutputLine(error) {
  const text = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n').trim()
  return text.split('\n').find((line) => line.trim())?.trim() ?? 'no output captured'
}

function evaluateTests(rows, results) {
  return rows.map((row) => {
    const missing = row.tests.filter((title) => !results.has(title))
    const failed = row.tests.filter((title) => results.has(title) && results.get(title) !== 'passed')
    let status
    if (missing.length > 0) status = 'MISSING'
    else if (failed.length > 0) status = 'FAIL'
    else status = 'PASS'
    const evidence = status === 'PASS'
      ? `${row.tests.length}/${row.tests.length} named test(s) passed`
      : [
          missing.length ? `missing: ${missing.join('; ')}` : null,
          failed.length ? `not passed: ${failed.map((title) => `${title}=${results.get(title)}`).join('; ')}` : null,
        ].filter(Boolean).join(' | ')
    return { ...row, status, evidence }
  })
}

async function evaluateAdrSurfaces() {
  const checks = []
  checks.push(await fileContains('cocoder/decisions/0040-oz-write-side-autonomy.md', ['Status:', 'Accepted']))
  for (const rel of [
    'cocoder/decisions/0016-deb-scoped-repair-fallback.md',
    'cocoder/decisions/0017-oz-orchestration-persona.md',
    'cocoder/decisions/0025-atomic-authoring-plays.md',
  ]) {
    checks.push(await fileContains(rel, ['0040']))
  }
  checks.push(await fileContains('cocoder/decisions/README.md', ['0040']))

  const failed = checks.filter((check) => !check.ok)
  return {
    id: 'E',
    required: true,
    clause: 'ADR-0040 is founder-accepted, carry-forward pointers exist, and the decisions index references it',
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    evidence: failed.length === 0
      ? checks.map((check) => check.evidence).join('; ')
      : failed.map((check) => check.evidence).join('; '),
  }
}

async function fileContains(rel, needles) {
  const text = await readFile(join(repoRoot, rel), 'utf8').catch(() => null)
  if (text === null) return { ok: false, evidence: `${rel} missing` }
  const missing = needles.filter((needle) => !text.includes(needle))
  if (missing.length > 0) return { ok: false, evidence: `${rel} missing ${missing.join(', ')}` }
  return { ok: true, evidence: `${rel} contains ${needles.join(' + ')}` }
}

async function evaluateBuilds() {
  const results = []
  for (const build of BUILDS) results.push(await runBuild(build))
  const failed = results.filter((result) => !result.ok)
  return {
    id: 'F',
    required: true,
    clause: 'Repository typecheck build gate',
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    evidence: results.map((result) => result.evidence).join('; '),
  }
}

function printTable(rows) {
  console.log('\nclause | verdict | evidence')
  console.log('-'.repeat(120))
  for (const row of rows) {
    const verdict = row.required ? row.status : `${row.status} (not required)`
    console.log(`${row.id}. ${row.clause} | ${verdict} | ${row.evidence}`)
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-oz-autonomy-'))
try {
  console.log('Proof - Oz autonomy (ADR-0040): author spine, oz-action lane, and code-level guards')
  console.log('Running the real daemon/core Vitest suites...')
  const allResults = new Map()
  for (const suite of SUITES) {
    const out = join(tmp, `${suite.pkg.replace(/\W/g, '_')}_${suite.file.replace(/\W/g, '_')}.json`)
    const results = await runSuite(suite, out)
    for (const [title, status] of results) allResults.set(title, status)
    console.log(`  - ${suite.label}: ${[...results.values()].filter((status) => status === 'passed').length}/${results.size} tests passed`)
  }

  const rows = [
    ...evaluateTests(CLAUSES, allResults),
    await evaluateAdrSurfaces(),
  ]

  console.log('Running the repository static build gate last...')
  rows.push(await evaluateBuilds())

  printTable(rows)

  const requiredFailed = rows.filter((row) => row.required && row.status !== 'PASS')
  console.log('\n' + '='.repeat(120))
  if (requiredFailed.length === 0) {
    console.log(`PASS: ${rows.length}/${rows.length} required clause(s) green.`)
  } else {
    console.log(`FAIL: ${requiredFailed.length} required clause(s) red.`)
    for (const row of requiredFailed) console.log(`  - ${row.id}. ${row.clause}: ${row.evidence}`)
  }
  process.exitCode = requiredFailed.length === 0 ? 0 : 1
} finally {
  await rm(tmp, { recursive: true, force: true })
}
