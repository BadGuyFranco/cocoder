#!/usr/bin/env node
// Proof - orchestration-contract enforcer: the founder closeout contract has one owner.
//
// Turns the structural enforcer into a one-command red/green proof:
// 1. the clean tree passes,
// 2. a deliberately re-encoded founder closeout contract in a live consumer fails the named test,
// 3. the consumer is restored byte-for-byte and the test passes again.
//
//   node scripts/proof-orchestration-enforcer.mjs

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const TEST_FILE = 'tests/orchestration-contracts.test.ts'
const TARGET_TEST = 'live prompt/runtime/test consumers do not restate the founder closeout contract'
const OWNER_PLAY = 'packages/personas/base/plays/wrap-up.md'
const CONSUMER = 'packages/core/src/runner/prompts.ts'

function rel(path) {
  return join(repoRoot, path)
}

async function founderCloseoutSections() {
  const text = await readFile(rel(OWNER_PLAY), 'utf8')
  const fence = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/)
  if (!fence?.[1]) throw new Error(`${OWNER_PLAY} is missing the fenced founder closeout contract`)
  const sections = [...fence[1].matchAll(/^\*\*[^*\n]+?\*\*\s*$/gm)].map((match) => match[0].trim())
  if (sections.length < 3) throw new Error(`${OWNER_PLAY} has fewer than three founder closeout labels`)
  return sections
}

async function runEnforcer(outFile) {
  let exitCode = 0
  let output = ''
  try {
    const result = await exec(
      'pnpm',
      ['--filter', '@cocoder/core', 'exec', 'vitest', 'run', TEST_FILE, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    )
    output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  } catch (error) {
    exitCode = typeof error?.code === 'number' ? error.code : 1
    output = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n')
  }

  const raw = await readFile(outFile, 'utf8').catch(() => null)
  const assertions = new Map()
  if (raw) {
    const json = JSON.parse(raw)
    for (const file of json.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) assertions.set(assertion.title, assertion.status)
    }
  }

  return { exitCode, output, assertions }
}

function countPassed(result) {
  return [...result.assertions.values()].filter((status) => status === 'passed').length
}

function requirePass(label, result) {
  const target = result.assertions.get(TARGET_TEST)
  if (result.exitCode !== 0 || target !== 'passed') {
    throw new Error(`${label} expected PASS, got exit ${result.exitCode}, target=${target ?? 'missing'}\n${firstOutputLine(result.output)}`)
  }
  return {
    step: label,
    status: 'PASS',
    evidence: `${countPassed(result)}/${result.assertions.size} tests passed`,
  }
}

function requireTargetFailure(label, result) {
  const target = result.assertions.get(TARGET_TEST)
  const unrelated = [...result.assertions.entries()].filter(([title, status]) => title !== TARGET_TEST && status !== 'passed')
  if (result.exitCode === 0 || target !== 'failed' || unrelated.length > 0) {
    const unrelatedText = unrelated.map(([title, status]) => `${title}=${status}`).join('; ') || 'none'
    throw new Error(
      `${label} expected only the founder-closeout-restatement test to fail, got exit ${result.exitCode}, ` +
        `target=${target ?? 'missing'}, unrelated=${unrelatedText}\n${firstOutputLine(result.output)}`,
    )
  }
  return {
    step: label,
    status: 'PASS',
    evidence: `${TARGET_TEST} failed; ${countPassed(result)}/${result.assertions.size} tests still passed`,
  }
}

function injectedDuplicate(labels) {
  return [
    '',
    '/* proof-orchestration-enforcer temporary duplicate - restored before exit',
    ...labels.slice(0, 3).map((label) => ` * ${label} proof duplicate`),
    ' */',
    '',
  ].join('\n')
}

function firstOutputLine(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? 'no output captured'
}

function printTable(rows) {
  console.log('\nstep | verdict | evidence')
  console.log('-'.repeat(100))
  for (const row of rows) console.log(`${row.step} | ${row.status} | ${row.evidence}`)
}

const tmp = await mkdtemp(join(tmpdir(), 'proof-orchestration-enforcer-'))
const consumerPath = rel(CONSUMER)
const original = await readFile(consumerPath)
const rows = []
let failure = null
let restoreFailure = null
let mutated = false

try {
  console.log('Proof - orchestration-contract enforcer: single owner for founder closeout sections')
  console.log('Running GREEN baseline...')
  rows.push(requirePass('GREEN baseline', await runEnforcer(join(tmp, 'baseline.json'))))

  const sections = await founderCloseoutSections()
  await writeFile(consumerPath, Buffer.concat([original, Buffer.from(injectedDuplicate(sections))]))
  mutated = true

  console.log('Running RED duplicate injection...')
  rows.push(requireTargetFailure('RED duplicate injected', await runEnforcer(join(tmp, 'red.json'))))
} catch (error) {
  failure = error
} finally {
  try {
    await writeFile(consumerPath, original)
    const restored = await readFile(consumerPath)
    if (!restored.equals(original)) throw new Error(`${CONSUMER} was not restored to its original bytes`)
  } catch (error) {
    restoreFailure = error
  }
}

if (!restoreFailure && mutated) {
  try {
    console.log('Running GREEN restored...')
    rows.push(requirePass('GREEN restored', await runEnforcer(join(tmp, 'restored.json'))))
    const restored = await readFile(consumerPath)
    if (!restored.equals(original)) throw new Error(`${CONSUMER} changed after the restored green run`)
  } catch (error) {
    failure ??= error
  }
}

await rm(tmp, { recursive: true, force: true })

printTable(rows)
console.log('\n' + '='.repeat(100))

if (restoreFailure) {
  console.log(`FAIL: ${restoreFailure.message}`)
  process.exitCode = 1
} else if (failure) {
  console.log(`FAIL: ${failure.message}`)
  process.exitCode = 1
} else {
  console.log('PASS: enforcer proved GREEN -> RED -> GREEN and the consumer was restored byte-for-byte.')
}
