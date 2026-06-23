#!/usr/bin/env node
// Proof - launch disposition: archive-candidate requires evidence, and guards are load-bearing.
//
//   node scripts/proof-launch-disposition.mjs

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const TEST_FILE = 'tests/runner.test.ts'
const RUNNER = 'packages/core/src/runner/runner.ts'
const RUNNER_TEST = 'packages/core/tests/runner.test.ts'

const ARCHIVE_SIGNAL_TEST = 'archive-ready first-directive wrap records archive-candidate disposition with zero build atoms'
const ACTIONABLE_TEST = 'onboard-existing proceeds after a valid spend approval checkpoint'
const NO_FAKE_BUILD_TEST = 'archive-ready wrap after a builder dispatch records continue disposition'
const NO_BARE_ASSERTION_TEST = 'archive-ready first-directive wrap without a runnable signal records continue disposition'

const NO_FAKE_BUILD_GUARD = ' && builderDispatchCount === 0'
const CHECKABLE_SIGNAL_GUARD = ' && closeoutCitesCheckableSignal(markdown)'
const NO_FAKE_BUILD_TRANSIENT_JUDGMENT =
  "judgment: 'Oscar completed a delegated build atom, so the runner cannot treat this as an archive candidate.',"
const NO_FAKE_BUILD_TRANSIENT_JUDGMENT_WITH_SIGNAL =
  "judgment: 'Oscar completed a delegated build atom and verified this with `node scripts/proof-launch-disposition.mjs`, so the runner cannot treat this as an archive candidate.',"
const NO_FAKE_BUILD_TRANSIENT_EXPECTATION =
  "expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({ disposition: 'continue', buildAtoms: 1, signal: null })"
const NO_FAKE_BUILD_TRANSIENT_EXPECTATION_WITH_SIGNAL =
  "expect(store.listEvents(result.runId).find((e) => e.type === 'wrap-disposition')?.data).toEqual({ disposition: 'continue', buildAtoms: 1, signal: 'node scripts/proof-launch-disposition.mjs' })"

function rel(path) {
  return join(repoRoot, path)
}

function execPnpm(args) {
  return new Promise((resolve) => {
    execFile('pnpm', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        output: [stdout, stderr, error?.message].filter(Boolean).join('\n'),
      })
    })
  })
}

function execGit(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        output: [stdout, stderr, error?.message].filter(Boolean).join('\n'),
      })
    })
  })
}

async function runRunnerTests(outFile, testName = null) {
  const args = ['--filter', '@cocoder/core', 'exec', 'vitest', 'run', TEST_FILE]
  if (testName) args.push('-t', testName)
  args.push('--reporter=json', `--outputFile=${outFile}`)

  const result = await execPnpm(args)
  const raw = await readFile(outFile, 'utf8').catch(() => null)
  const assertions = new Map()
  if (raw) {
    const json = JSON.parse(raw)
    for (const file of json.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) assertions.set(assertion.title, assertion.status)
    }
  }
  return { ...result, assertions }
}

function countPassed(result) {
  return [...result.assertions.values()].filter((status) => status === 'passed').length
}

function firstOutputLine(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? 'no output captured'
}

function requirePass(label, result, targetTest) {
  const target = result.assertions.get(targetTest)
  if (result.exitCode !== 0 || target !== 'passed') {
    throw new Error(`${label} expected PASS, got exit ${result.exitCode}, target=${target ?? 'missing'}\n${firstOutputLine(result.output)}`)
  }
  return {
    step: label,
    status: 'PASS',
    evidence: `${targetTest}; ${countPassed(result)}/${result.assertions.size} tests passed`,
  }
}

function requireTargetFailure(label, result, targetTest) {
  const target = result.assertions.get(targetTest)
  const unrelated = [...result.assertions.entries()].filter(([title, status]) => title !== targetTest && status !== 'passed' && status !== 'skipped')
  if (result.exitCode === 0 || target !== 'failed' || unrelated.length > 0) {
    const unrelatedText = unrelated.map(([title, status]) => `${title}=${status}`).join('; ') || 'none'
    throw new Error(
      `${label} expected only ${targetTest} to fail, got exit ${result.exitCode}, target=${target ?? 'missing'}, unrelated=${unrelatedText}\n${firstOutputLine(result.output)}`,
    )
  }
  return {
    step: label,
    status: 'PASS',
    evidence: `${targetTest} failed as expected`,
  }
}

function requireActionableSourceEvidence(source) {
  const testStart = source.indexOf(`test('${ACTIONABLE_TEST}'`)
  if (testStart < 0) throw new Error(`${RUNNER_TEST} is missing actionable proof test "${ACTIONABLE_TEST}"`)
  const nextTest = source.indexOf('\n  test(', testStart + 1)
  const body = source.slice(testStart, nextTest < 0 ? source.length : nextTest)
  if (!body.includes("delegate('deep read after approval')") || !body.includes("event.type === 'builder-dispatch'")) {
    throw new Error(`${ACTIONABLE_TEST} no longer proves a delegate directive produces builder-dispatch`)
  }
}

function mutateOnce(source, target, label) {
  if (!source.includes(target)) throw new Error(`${label} mutation target not found in ${RUNNER}: ${target}`)
  return source.replace(target, '')
}

function patchNoFakeBuildTest(source) {
  if (!source.includes(NO_FAKE_BUILD_TRANSIENT_JUDGMENT)) throw new Error(`${RUNNER_TEST} missing expected no-fake-build judgment fixture`)
  if (!source.includes(NO_FAKE_BUILD_TRANSIENT_EXPECTATION)) throw new Error(`${RUNNER_TEST} missing expected no-fake-build disposition assertion`)
  return source
    .replace(NO_FAKE_BUILD_TRANSIENT_JUDGMENT, NO_FAKE_BUILD_TRANSIENT_JUDGMENT_WITH_SIGNAL)
    .replace(NO_FAKE_BUILD_TRANSIENT_EXPECTATION, NO_FAKE_BUILD_TRANSIENT_EXPECTATION_WITH_SIGNAL)
}

async function restoreBytes(path, label, original) {
  await writeFile(path, original)
  const restored = await readFile(path)
  if (!restored.equals(original)) throw new Error(`${label} was not restored to its original bytes`)
}

function printTable(rows) {
  console.log('\nstep | verdict | evidence')
  console.log('-'.repeat(120))
  for (const row of rows) console.log(`${row.step} | ${row.status} | ${row.evidence}`)
}

const tmp = await mkdtemp(join(repoRoot, 'local', 'proof-launch-disposition-'))
const runnerPath = rel(RUNNER)
const runnerTestPath = rel(RUNNER_TEST)
const originalRunner = await readFile(runnerPath)
const originalRunnerText = originalRunner.toString('utf8')
const originalRunnerTest = await readFile(runnerTestPath)
const originalRunnerTestText = originalRunnerTest.toString('utf8')
const rows = []
let failure = null
let restoreFailure = null

try {
  console.log('Proof - launch disposition: archive-candidate is evidence-backed')
  requireActionableSourceEvidence(await readFile(rel(RUNNER_TEST), 'utf8'))

  console.log('Running GREEN baseline...')
  const baseline = await runRunnerTests(join(tmp, 'baseline.json'))
  rows.push(requirePass('PASS obligation A: archive candidate has cited signal', baseline, ARCHIVE_SIGNAL_TEST))
  rows.push(requirePass('PASS obligation B: actionable delegate dispatches builder', baseline, ACTIONABLE_TEST))
  rows.push(requirePass('PASS obligation C: bare archive-ready is not enough', baseline, NO_BARE_ASSERTION_TEST))

  try {
    await writeFile(runnerTestPath, patchNoFakeBuildTest(originalRunnerTestText))
    await writeFile(runnerPath, mutateOnce(originalRunnerText, NO_FAKE_BUILD_GUARD, 'no-fake-build guard'))
    console.log('Running RED no-fake-build guard removal...')
    rows.push(requireTargetFailure('PASS mutation: no-fake-build guard is load-bearing', await runRunnerTests(join(tmp, 'red-no-fake-build.json'), NO_FAKE_BUILD_TEST), NO_FAKE_BUILD_TEST))
  } finally {
    try {
      await restoreBytes(runnerPath, RUNNER, originalRunner)
      await restoreBytes(runnerTestPath, RUNNER_TEST, originalRunnerTest)
    } catch (error) {
      restoreFailure = error
    }
  }

  if (!restoreFailure) {
    console.log('Running GREEN no-fake-build restored...')
    rows.push(requirePass('PASS restore: no-fake-build guard', await runRunnerTests(join(tmp, 'green-no-fake-build.json'), NO_FAKE_BUILD_TEST), NO_FAKE_BUILD_TEST))
  }

  if (!restoreFailure) {
    try {
      await writeFile(runnerPath, mutateOnce(originalRunnerText, CHECKABLE_SIGNAL_GUARD, 'checkable-signal guard'))
      console.log('Running RED checkable-signal guard removal...')
      rows.push(
        requireTargetFailure(
          'PASS mutation: checkable-signal guard is load-bearing',
          await runRunnerTests(join(tmp, 'red-checkable-signal.json'), NO_BARE_ASSERTION_TEST),
          NO_BARE_ASSERTION_TEST,
        ),
      )
    } finally {
      try {
        await restoreBytes(runnerPath, RUNNER, originalRunner)
      } catch (error) {
        restoreFailure = error
      }
    }
  }

  if (!restoreFailure) {
    console.log('Running GREEN checkable-signal restored...')
    rows.push(requirePass('PASS restore: checkable-signal guard', await runRunnerTests(join(tmp, 'green-checkable-signal.json'), NO_BARE_ASSERTION_TEST), NO_BARE_ASSERTION_TEST))
  }

  const finalRunner = await readFile(runnerPath)
  if (!finalRunner.equals(originalRunner)) throw new Error(`${RUNNER} changed after proof run`)
  const finalRunnerTest = await readFile(runnerTestPath)
  if (!finalRunnerTest.equals(originalRunnerTest)) throw new Error(`${RUNNER_TEST} changed after proof run`)
  const diff = await execGit(['diff', '--quiet', '--', RUNNER])
  if (diff.exitCode !== 0) throw new Error(`${RUNNER} has a residual git diff after proof run\n${firstOutputLine(diff.output)}`)
} catch (error) {
  failure = error
} finally {
  try {
    await restoreBytes(runnerPath, RUNNER, originalRunner)
    await restoreBytes(runnerTestPath, RUNNER_TEST, originalRunnerTest)
  } catch (error) {
    restoreFailure ??= error
  }
  await rm(tmp, { recursive: true, force: true })
}

printTable(rows)
console.log('\n' + '='.repeat(120))

if (restoreFailure) {
  console.log(`FAIL: ${restoreFailure.message}`)
  process.exit(1)
} else if (failure) {
  console.log(`FAIL: ${failure.message}`)
  process.exit(1)
} else {
  console.log('PASS: launch disposition proof completed GREEN -> RED -> GREEN; runner.ts was restored byte-for-byte.')
}
