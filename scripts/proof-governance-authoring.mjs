#!/usr/bin/env node
// Proof - governance authoring Plays: one Oz authoring action, one commit spine, no manual commit.
//
// Turns the governance-authoring-plays priority's "Verified when" into ONE command with a
// PASS/FAIL table. It does NOT reimplement the orchestration logic: it runs the REAL daemon/core
// test suites via Vitest JSON output, checks only the declared filesystem/config surfaces, then runs
// the REAL repository static build gate last.
//
//   node scripts/proof-governance-authoring.mjs
//
// Green rows -> the three authoring Plays commit atomically through the repair spine, Oz exposes one
//               author action, agent author-then-launch and human hand-edit author-then-launch both
//               work with zero manual commits, builder-scope WIP is still refused, the Play files and
//               persona grants exist, and typecheck is green.
// Any red row -> a specific failing suite, missing test, missing file/grant, or failed build to fix.

import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const PLAY_IDS = ['create-priority', 'edit-priority', 'archive-priority']

const SUITES = [
  { pkg: '@cocoder/daemon', file: 'tests/authoring-play.test.ts', label: 'authoring Play spine' },
  { pkg: '@cocoder/daemon', file: 'tests/oz-chat.test.ts', label: 'typed Oz author command' },
  { pkg: '@cocoder/daemon', file: 'tests/oz-agent-chat.test.ts', label: 'Oz agent author tool' },
  { pkg: '@cocoder/core', file: 'tests/runner-direct.test.ts', label: 'direct runner dirty guard' },
]

const CLAUSES = [
  {
    id: 'A',
    required: true,
    clause: 'The three authoring Plays commit atomically through the ONE spine (agent path, zero manual commit)',
    tests: [
      'dispatches create-priority and commits the priority file through the repair spine',
      'refuses while any run is in flight and commits nothing',
      'holds back files outside the Play write-scope',
      'nonzero authoring turn commits nothing',
    ],
  },
  {
    id: 'B',
    required: true,
    clause: 'Oz authoring collapses to ONE tool action (resolves oz-dashboard-bugs #12)',
    tests: [
      'author executable dispatches to the authoring Play op and renders committed path, sha, log, and refresh hint',
      'author executable reports no-commit and held-back paths without a refresh hint',
      'author executable requires a workspace',
      'author tool strips play from invocation and dispatches one authoring Play action',
      'author tool rejects missing and non-enum play without executing authoring',
    ],
  },
  {
    id: 'C',
    required: true,
    clause: 'Agent author-then-launch succeeds immediately with zero manual commit',
    tests: ['agent authoring commits a priority and immediate launch succeeds with no manual commit'],
  },
  {
    id: 'D',
    required: true,
    clause: 'A human hand-edit author-then-launch self-heals (launch auto-commits governance dirt, zero manual commit)',
    tests: [
      'human hand-edit authoring is snapshotted at launch and then proceeds',
      'governance-only dirty guard self-heals with a pre-run snapshot and proceeds',
    ],
  },
  {
    id: 'E',
    required: true,
    clause: "The launch guard STILL refuses builder-scope WIP (the guard's real purpose preserved)",
    tests: [
      'scoped dirty guard refuses the launch on uncommitted in-scope WIP; commits nothing',
      'mixed builder and governance dirt still refuses the launch and snapshots nothing',
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

async function evaluatePlayFiles() {
  const paths = PLAY_IDS.map((playId) => `packages/personas/base/plays/${playId}.md`)
  const missing = []
  for (const path of paths) {
    await access(join(repoRoot, path)).catch(() => missing.push(path))
  }
  return {
    id: 'F',
    required: true,
    clause: 'The three Plays exist on disk',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    evidence: missing.length === 0 ? paths.join(', ') : `missing: ${missing.join(', ')}`,
  }
}

async function evaluatePersonaGrants() {
  const assignmentsPath = join(repoRoot, 'cocoder', 'personas', 'assignments.json')
  const assignments = JSON.parse(await readFile(assignmentsPath, 'utf8'))
  const missing = []
  for (const persona of ['oz', 'oscar', 'deb']) {
    const plays = assignments.personas?.[persona]?.plays ?? {}
    for (const playId of PLAY_IDS) {
      if (!Object.hasOwn(plays, playId)) missing.push(`${persona}:${playId}`)
    }
  }
  return {
    id: 'G',
    required: true,
    clause: 'The three Plays are GRANTED to oz, oscar, deb',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    evidence: missing.length === 0
      ? 'oz, oscar, deb all grant create-priority, edit-priority, archive-priority'
      : `missing grants: ${missing.join(', ')}`,
  }
}

async function evaluateBuilds() {
  const results = []
  for (const build of BUILDS) results.push(await runBuild(build))
  const failed = results.filter((result) => !result.ok)
  return {
    id: 'H',
    required: true,
    clause: 'Builds green',
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

const tmp = await mkdtemp(join(tmpdir(), 'proof-governance-authoring-'))
try {
  console.log('Proof - governance authoring Plays: one Oz action, one commit spine, no manual commit')
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
    await evaluatePlayFiles(),
    await evaluatePersonaGrants(),
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
