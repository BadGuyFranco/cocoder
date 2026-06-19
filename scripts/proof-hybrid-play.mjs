#!/usr/bin/env node
// Proof harness - hybrid Play real path.
//
//   node scripts/proof-hybrid-play.mjs
//
// This is a runtime proof, not a unit-test wrapper. It imports the monorepo packages through tsx,
// selects a real headless-capable adapter from @cocoder/adapters, and lets dispatchPlay/runRun use
// their default subprocess runners.

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const timeoutMs = Number.parseInt(process.env.COCODER_PROOF_TIMEOUT_MS ?? '180000', 10)

const probe = String.raw`
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  dispatchPlay,
  loadPlay,
  makeGit,
  openRunStore,
  runRun,
  validatePlayOutput,
} from '@cocoder/core'
import { getAdapter as resolveAdapter, makeAdapterRegistry } from '@cocoder/adapters'
import { basePlaysDir } from '@cocoder/personas'

const exec = promisify(execFile)
const repoRoot = ${JSON.stringify(repoRoot)}
const adapterId = process.env.COCODER_PROOF_ADAPTER ?? 'codex'
const model = process.env.COCODER_PROOF_MODEL ?? ''
const timeoutMs = ${JSON.stringify(timeoutMs)}
const registry = makeAdapterRegistry()
const realAdapter = resolveAdapter(adapterId, registry)
const rows = []
const captures = []

function clip(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function fakeSessionHost() {
  let n = 0
  return {
    async spawn() {
      return { id: 'proof-surface-' + (++n), driver: 'proof' }
    },
    async readScreen() {
      return ''
    },
    async status() {
      return { state: 'running' }
    },
    async waitForExit() {
      return { state: 'exited', code: 0 }
    },
    async sendInput() {},
    async show() {},
    async kill() {},
    async closeSurface() {},
  }
}

function recordingAdapter() {
  const calls = []
  const adapter = {
    id: realAdapter.id,
    runReadiness: realAdapter.runReadiness,
    headlessCapable: realAdapter.headlessCapable,
    build(input) {
      const built = realAdapter.build(input)
      calls.push({ input, built })
      return built
    },
    preflight(modelName) {
      return realAdapter.preflight(modelName)
    },
    listModels() {
      return realAdapter.listModels()
    },
  }
  return {
    calls,
    getAdapter(cli) {
      if (cli !== realAdapter.id) throw new Error('proof requested adapter ' + cli + ' but selected ' + realAdapter.id)
      return adapter
    },
  }
}

async function run(command, args, cwd) {
  await exec(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 })
}

async function initGitRepo(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await run('git', ['init', '-q'], dir)
  await run('git', ['config', 'user.email', 'proof@example.invalid'], dir)
  await run('git', ['config', 'user.name', 'CoCoder Proof'], dir)
  return dir
}

async function commitAll(dir, message) {
  await run('git', ['add', '.'], dir)
  await run('git', ['commit', '-q', '-m', message], dir)
}

async function prepareHybridRepo(changed) {
  const dir = await initGitRepo('proof-hybrid-play-review-')
  const scriptPath = join(dir, 'scripts', 'checks', 'code-review-preflight.mjs')
  await mkdir(dirname(scriptPath), { recursive: true })
  await copyFile(join(repoRoot, 'scripts', 'checks', 'code-review-preflight.mjs'), scriptPath)
  await writeFile(join(dir, 'README.md'), '# Proof repo\n', 'utf8')
  await commitAll(dir, 'initial proof fixture')
  if (changed) {
    await mkdir(join(dir, 'packages', 'demo'), { recursive: true })
    await writeFile(join(dir, 'packages', 'demo', 'change.txt'), 'review me\n', 'utf8')
  }
  return dir
}

async function readMaybe(path) {
  return readFile(path, 'utf8').catch(() => '')
}

function parseCloseoutContract(play) {
  const fenceMarker = String.fromCharCode(96, 96, 96)
  const fence = play.body.match(new RegExp(fenceMarker + '(?:[a-zA-Z0-9_-]+)?\\n([\\s\\S]*?)' + fenceMarker))
  if (!fence?.[1]) throw new Error('wrap-up Play has no fenced closeout contract')
  const labels = fence[1].match(/\*\*[^*\n]+?\*\*/g) ?? []
  const finalLine = fence[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)
  if (labels.length < 10 || !finalLine || finalLine.startsWith('**')) throw new Error('wrap-up Play closeout contract is malformed')
  return { labels: labels.slice(0, 10), finalLine }
}

function validCloseout(play) {
  const c = parseCloseoutContract(play)
  const tick = String.fromCharCode(96)
  return [
    c.labels[0],
    '',
    c.labels[1] + ' Yes',
    '',
    c.labels[2] + ' continue',
    '',
    c.labels[3] + ' The hybrid Play proof completed the real-path validation.',
    '',
    c.labels[4],
    '- Continue the remaining verification work.',
    '',
    c.labels[5],
    'Priority: ' + tick + 'demo' + tick + ' - continue the real-path proof review',
    '',
    c.labels[6] + ' None.',
    '',
    c.labels[7] + ' The runner reports the authoritative commit outcome after this brief.',
    '',
    c.labels[8] + ' Standing by; teardown requires an explicit founder request.',
    '',
    c.labels[9],
    'The proof stopped after validating the declared Play contract through the runner.',
    '',
    c.finalLine,
  ].join('\n')
}

function proofIo(pickup, written) {
  let directiveRead = false
  return {
    async ensureRunDir(runDir) {
      await mkdir(runDir, { recursive: true })
    },
    async awaitDirective() {
      if (directiveRead) throw new Error('proof runner requested a second directive')
      directiveRead = true
      return { kind: 'wrapup', pickup }
    },
    async awaitVerification() {
      return { verdict: 'pass', reason: 'not used by wrap-up-only proof' }
    },
    async awaitTriage() {
      return { disposition: 'one-off', summary: 'proof malformed wrap-up was expected', mode: 'propose' }
    },
    async writeFaultContext(runDir, atomIndex, fault) {
      const path = join(runDir, 'fault-' + atomIndex + '.md')
      await writeFile(path, fault, 'utf8')
      return path
    },
    async writeDisposition(runDir, atomIndex, disposition) {
      const path = join(runDir, 'disposition-' + atomIndex + '.json')
      await writeFile(path, JSON.stringify(disposition, null, 2), 'utf8')
      return path
    },
    async writeDebStatus(runDir, status) {
      const path = join(runDir, 'deb-status.json')
      await writeFile(path, JSON.stringify(status, null, 2), 'utf8')
      return path
    },
    async readNudgeRequest() {
      return null
    },
    async writePickup(runDir, markdown) {
      const path = join(runDir, 'pickup.md')
      written.pickups.push(markdown)
      await writeFile(path, markdown, 'utf8')
      return path
    },
    async writeRunArtifact(runDir, fileName, contents) {
      const path = join(runDir, fileName)
      written.artifacts.push({ fileName, contents })
      await writeFile(path, contents, 'utf8')
      return path
    },
    async writeRunRecord(runDir, markdown) {
      const path = join(runDir, 'record.md')
      await writeFile(path, markdown, 'utf8')
      return path
    },
  }
}

async function prepareRunnerRepo() {
  const dir = await initGitRepo('proof-hybrid-play-runner-')
  await mkdir(join(dir, 'cocoder', 'priorities'), { recursive: true })
  await mkdir(join(dir, 'cocoder', 'tickets', 'open'), { recursive: true })
  await writeFile(join(dir, 'cocoder', 'priorities', 'demo.md'), '# Demo\n', 'utf8')
  await writeFile(join(dir, 'README.md'), '# Runner proof repo\n', 'utf8')
  await commitAll(dir, 'initial runner proof fixture')
  return dir
}

async function runValidWrapProof(wellFormedCloseout) {
  const workspacePath = await prepareRunnerRepo()
  const runsRoot = join(workspacePath, '.proof-runs')
  const store = openRunStore(':memory:')
  const rec = recordingAdapter()
  const wrapPlay = loadPlay(basePlaysDir(), 'wrap-up')
  const written = { pickups: [], artifacts: [] }
  const result = await runRun(
    {
      store,
      sessionHost: fakeSessionHost(),
      git: makeGit(),
      getAdapter: rec.getAdapter,
      io: proofIo(
        'Proof instruction: emit exactly the founder closeout between BEGIN_VALID_CLOSEOUT and END_VALID_CLOSEOUT, with no preamble and no code fence.\n\nBEGIN_VALID_CLOSEOUT\n' +
          wellFormedCloseout +
          '\nEND_VALID_CLOSEOUT',
        written,
      ),
      timeouts: { wrapupMs: timeoutMs, pollMs: 1, monitorCadenceMs: 1, minNudgeIntervalMs: 0 },
      limits: { maxAtoms: 1 },
    },
    {
      workspace: { id: 'proof', path: workspacePath, name: 'Proof' },
      priority: { id: 'demo', title: 'Demo', scopeNarrowing: null, goal: 'prove wrap-up', objective: 'prove wrap-up' },
      oscar: { id: 'oscar', label: 'Oscar', role: 'proof orchestrator', cli: adapterId, model, writeScope: [], body: 'Proof Oscar.', mode: 'visible' },
      bob: { id: 'bob', label: 'Bob', role: 'proof builder', cli: adapterId, model, writeScope: ['packages/**'], body: 'Proof Bob.', mode: 'visible' },
      sharedStandards: 'Proof run.',
      engineHome: repoRoot,
      runsRoot,
      wrapPlay,
      wrapPlayAssignment: { cli: adapterId, model },
      wrapPlayPersonaMode: 'headless',
    },
  )
  const wrapOut = await readMaybe(join(runsRoot, result.runId, 'wrapup-out.txt'))
  const wrapStdout = await readMaybe(join(runsRoot, result.runId, 'wrapup-out.txt.stdout'))
  const invalidEvent = store.listEvents(result.runId).find((event) => event.type === 'wrapup-format-invalid')
  const wrapBuild = rec.calls.find((call) => call.input.headless === true && call.input.prompt.includes('# Wrap-up Play'))
  return {
    result,
    status: result.status,
    runId: result.runId,
    workspacePath,
    outputValidatorRef: wrapPlay.outputValidator?.ref ?? null,
    llmInvoked: Boolean(wrapBuild) && wrapOut.trim().length > 0,
    builtCommand: wrapBuild?.built ?? null,
    wrapOut,
    wrapStdout,
    pickup: written.pickups[0] ?? '',
    invalidIssues: invalidEvent ? invalidEvent.data.issues ?? [] : [],
  }
}

async function clauseA() {
  const cwd = await prepareHybridRepo(true)
  const rec = recordingAdapter()
  const outPath = join(cwd, 'code-review.out')
  const play = loadPlay(basePlaysDir(), 'code-review')
  const result = await dispatchPlay(
    { sessionHost: fakeSessionHost(), getAdapter: rec.getAdapter },
    {
      play,
      assignment: { cli: adapterId, model },
      personaMode: 'headless',
      persona: 'proof-reviewer',
      task: 'Proof invocation. Review the current changed file and return a concise code-review conclusion.',
      cwd,
      outPath,
      timeoutMs,
    },
  )
  const build = rec.calls[0]
  const stdout = await readMaybe(outPath + '.stdout')
  const deterministic = result.deterministic?.output ?? ''
  const ok =
    result.exitCode === 0 &&
    deterministic.includes('code-review preflight passed:') &&
    (build?.input.prompt ?? '').includes('## Deterministic precheck result') &&
    (build?.input.prompt ?? '').includes('code-review preflight passed:') &&
    result.output.trim().length > 0
  captures.push({
    id: 'A',
    title: 'Clause A captured outputs',
    deterministic,
    promptExcerpt: (build?.input.prompt ?? '').slice(-1200),
    builtCommand: build?.built ?? null,
    llmOutput: result.output,
    subprocessStdout: stdout,
  })
  return {
    id: 'A',
    label: 'Clause A: hybrid deterministic step feeds LLM',
    ok,
    detail: ok
      ? 'deterministic="' + clip(deterministic) + '"; LLM output bytes=' + result.output.length
      : 'exit=' + result.exitCode + '; deterministic="' + clip(deterministic) + '"; output bytes=' + result.output.length,
  }
}

async function clauseB() {
  const cwd = await prepareHybridRepo(false)
  const rec = recordingAdapter()
  const outPath = join(cwd, 'code-review-empty.out')
  const play = loadPlay(basePlaysDir(), 'code-review')
  const result = await dispatchPlay(
    { sessionHost: fakeSessionHost(), getAdapter: rec.getAdapter },
    {
      play,
      assignment: { cli: adapterId, model },
      personaMode: 'headless',
      persona: 'proof-reviewer',
      task: 'Proof invocation. This repo intentionally has no review diff.',
      cwd,
      outPath,
      timeoutMs,
    },
  )
  const artifact = await readMaybe(outPath)
  const deterministic = result.deterministic?.output ?? ''
  const ok =
    result.exitCode === 1 &&
    result.gated === true &&
    deterministic.includes('code-review preflight failed: no changed files to review') &&
    rec.calls.length === 0 &&
    artifact === ''
  captures.push({
    id: 'B',
    title: 'Clause B captured outputs',
    deterministic,
    adapterBuildCalls: rec.calls.length,
    outputArtifact: artifact,
  })
  return {
    id: 'B',
    label: 'Clause B: deterministic failure gates LLM',
    ok,
    detail: 'gated=' + String(result.gated) + '; exit=' + result.exitCode + '; adapterBuildCalls=' + rec.calls.length + '; deterministic="' + clip(deterministic) + '"',
  }
}

async function clauseC() {
  const wrapPlay = loadPlay(basePlaysDir(), 'wrap-up')
  const wellFormed = validCloseout(wrapPlay)
  const validRun = await runValidWrapProof(wellFormed)
  const validationCwd = validRun.workspacePath
  const validDirect = validatePlayOutput({ play: wrapPlay, output: wellFormed, cwd: validationCwd })
  const malformedDirect = validatePlayOutput({ play: wrapPlay, output: 'PLAY CLOSEOUT', cwd: validationCwd })
  const noValidator = validatePlayOutput({ play: { ...wrapPlay, outputValidator: undefined }, output: 'PLAY CLOSEOUT', cwd: validationCwd })
  let unknownRefMessage = ''
  try {
    validatePlayOutput({ play: { ...wrapPlay, outputValidator: { ref: 'validators/unknown-proof' } }, output: wellFormed, cwd: validationCwd })
  } catch (err) {
    unknownRefMessage = err instanceof Error ? err.message : String(err)
  }

  const ok =
    validRun.outputValidatorRef === 'validators/founder-closeout' &&
    validRun.status === 'completed' &&
    validRun.llmInvoked &&
    validRun.invalidIssues.length === 0 &&
    validDirect !== null &&
    validDirect.issues.length === 0 &&
    malformedDirect !== null &&
    malformedDirect.issues.length > 0 &&
    noValidator === null &&
    unknownRefMessage.includes('unknown outputValidator')

  captures.push({
    id: 'C-valid-run',
    title: 'Clause C valid wrap-up runner outputs',
    outputValidatorRef: validRun.outputValidatorRef,
    status: validRun.status,
    runId: validRun.runId,
    builtCommand: validRun.builtCommand,
    llmOutput: validRun.wrapOut,
    subprocessStdout: validRun.wrapStdout,
    pickup: validRun.pickup,
    invalidIssues: validRun.invalidIssues,
  })
  captures.push({
    id: 'C-validator',
    title: 'Clause C deterministic validator outputs',
    exportedFunction: 'validatePlayOutput',
    declaredRef: wrapPlay.outputValidator?.ref ?? null,
    validationCwd,
    wellFormedIssues: validDirect?.issues ?? null,
    malformedInput: 'PLAY CLOSEOUT',
    malformedIssues: malformedDirect?.issues ?? null,
    noValidatorResult: noValidator,
    unknownRefMessage,
  })
  return {
    id: 'C',
    label: 'Clause C: mandatory wrap-up plus exported field-driven validator',
    ok,
    detail:
      'validator=' + validRun.outputValidatorRef +
      '; validRunStatus=' + validRun.status +
      '; directValidIssues=' + String(validDirect?.issues.length ?? 'null') +
      '; malformedIssues=' + String(malformedDirect?.issues.length ?? 'null') +
      '; noValidator=' + String(noValidator) +
      '; unknownRefThrows=' + String(unknownRefMessage.length > 0),
  }
}

async function main() {
  const preflight = await realAdapter.preflight(model)
  rows.push({
    id: 'adapter',
    label: 'Adapter preflight: ' + adapterId,
    ok: preflight.ok && realAdapter.headlessCapable,
    detail: preflight.checks.map((check) => check.name + '=' + (check.ok ? 'ok' : 'fail') + ' (' + check.detail + ')').join('; '),
  })
  if (!realAdapter.headlessCapable) {
    rows[0].ok = false
    rows[0].detail += '; adapter is not headless-capable'
  }
  if (!rows[0].ok) {
    rows[0].detail += '; configure COCODER_PROOF_ADAPTER to an installed/authenticated headless adapter (codex, claude, or cursor-agent) and COCODER_PROOF_MODEL if needed'
    return
  }

  for (const fn of [clauseA, clauseB, clauseC]) {
    try {
      rows.push(await fn())
    } catch (err) {
      rows.push({
        id: fn.name,
        label: fn.name,
        ok: false,
        detail: err instanceof Error ? err.stack ?? err.message : String(err),
      })
    }
  }
}

void main()
  .catch((err) => {
    rows.push({
      id: 'probe',
      label: 'Probe execution',
      ok: false,
      detail: err instanceof Error ? err.stack ?? err.message : String(err),
    })
  })
  .finally(() => {
    console.log('@@HYBRID_PLAY_PROOF@@' + JSON.stringify({ adapterId, model, rows, captures }))
  })
`

async function runProbe() {
  const { stdout, stderr } = await exec(
    'pnpm',
    ['--filter', '@cocoder/core', 'exec', 'tsx', '--eval', probe],
    { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 },
  )
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('@@HYBRID_PLAY_PROOF@@'))
  if (!line) {
    throw new Error('proof probe did not return JSON\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr)
  }
  return JSON.parse(line.slice('@@HYBRID_PLAY_PROOF@@'.length))
}

function printRows(rows) {
  const statusWidth = 6
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 'Check'.length)
  console.log('MACHINE_PROOF')
  console.log('-'.repeat(labelWidth + statusWidth + 17))
  console.log(`${'Status'.padEnd(statusWidth)} | ${'Check'.padEnd(labelWidth)} | Evidence`)
  console.log(`${'-'.repeat(statusWidth)} | ${'-'.repeat(labelWidth)} | ${'-'.repeat(34)}`)
  for (const row of rows) {
    console.log(`${(row.ok ? 'PASS' : 'FAIL').padEnd(statusWidth)} | ${row.label.padEnd(labelWidth)} | ${row.detail}`)
  }
}

function printCaptured(captures) {
  console.log('')
  console.log('CAPTURED_OUTPUTS')
  console.log('-'.repeat(86))
  for (const capture of captures) {
    console.log('')
    console.log(`## ${capture.title}`)
    for (const [key, value] of Object.entries(capture)) {
      if (key === 'id' || key === 'title') continue
      console.log(`### ${key}`)
      if (typeof value === 'string') console.log(value.trim() === '' ? '(empty)' : value)
      else console.log(JSON.stringify(value, null, 2))
    }
  }
}

try {
  console.log('Proof - hybrid Play real path')
  console.log(`Adapter: ${process.env.COCODER_PROOF_ADAPTER ?? 'codex'}; timeout: ${timeoutMs}ms`)
  console.log('')
  const proof = await runProbe()
  printRows(proof.rows)
  printCaptured(proof.captures)
  const failed = proof.rows.filter((row) => !row.ok)
  console.log('')
  console.log(failed.length === 0
    ? `VERDICT: PASS - all hybrid Play clauses proved through real ${proof.adapterId} invocations and exported validation.`
    : `VERDICT: FAIL - ${failed.length} clause(s) failed; configure a real adapter or fix the named path.`)
  process.exitCode = failed.length === 0 ? 0 : 1
} catch (err) {
  console.log('Proof - hybrid Play real path')
  console.log('MACHINE_PROOF')
  console.log('FAIL   | Harness setup | ' + (err instanceof Error ? err.message : String(err)))
  process.exitCode = 1
}
