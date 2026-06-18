#!/usr/bin/env node
// Proof - Takeover phase executor end-to-end on fakes. Run with:
//   node scripts/proof-takeover-executor.mjs

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const harness = String.raw`
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AuditWriteBoundaryError,
  loadOnboardingPlaybooks,
  loadPlaybookExecutor,
  openRunStore,
  runCommitGate,
  scaffoldCocoderZone,
  startPlaybookExecutor,
  workspaceTemplateDir,
} from '@cocoder/core'
import { basePlaybooksDir } from '@cocoder/personas'

const repoRoot = __REPO_ROOT__
let createDaemonPlaybookPhaseAction

function check(label, condition, detail = '') {
  if (!condition) throw new Error(label + (detail ? ': ' + detail : ''))
  console.log('PASS - ' + label + (detail ? ' - ' + detail : ''))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function listFiles(root, base = root) {
  if (!(await exists(root))) return []
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return listFiles(path, base)
    return [relative(base, path).split('\\').join('/')]
  }))
  return files.flat().sort()
}

function fakeAdapter(builds) {
  return {
    build(input) {
      builds.push({ persona: input.persona, model: input.model, prompt: input.prompt })
      return { command: 'fake-agent', args: [input.persona, input.prompt] }
    },
  }
}

function fakeGitFromWorkspace(commits) {
  let head = 'h0'
  return {
    async headSha() { return head },
    async changedFiles(cwd) {
      const cocoder = join(cwd, 'cocoder')
      const files = await listFiles(cocoder)
      return files
        .filter((file) => file === 'memory/architecture-notes.md' || file === 'priorities/INDEX.md' || /^priorities\/objective-\d+\.md$/.test(file))
        .map((file) => 'cocoder/' + file)
    },
    async addAndCommit(_cwd, files, message) {
      commits.push({ files: [...files], message })
      head = 'sha-proof-' + commits.length
      return head
    },
  }
}

function fakeGitChanged(changed, commits) {
  let head = 'h0'
  return {
    ...fakeGitFromWorkspace(commits),
    async headSha() { return head },
    async changedFiles() { return changed },
    async addAndCommit(_cwd, files, message) {
      commits.push({ files: [...files], message })
      head = 'sha-poison-' + commits.length
      return head
    },
  }
}

const reconOutput = {
  subsystems: [{
    id: 'governance',
    name: 'Governance',
    pathGlobs: ['README.md', 'package.json'],
    entryPoints: ['README.md'],
    validationCommands: ['pnpm -w typecheck'],
    boundaryReason: 'Proof fixture governance root.',
    allowedAdjacency: [],
  }],
  humanMap: 'Governance covers the proof fixture instructions.',
  complexitySignals: {
    crossSubsystemCoupling: [],
    unclearOwnership: [],
    stackHeterogeneity: [],
    weakValidation: [],
    broadEntryPoints: [],
    highRiskSurfaces: [],
  },
}

const intentOutput = {
  claims: [{ claim: 'The fixture exists for takeover executor proof.', provenance: ['README.md'] }],
  openQuestions: ['What should P2 inspect first?'],
}

function deepReadOutput(source, iteration) {
  return JSON.stringify({
    theory: {
      purpose: 'Maintain takeover executor proof governance.',
      keyBehaviors: ['Explain takeover proof', 'Validate workspace health'],
      dataControlFlow: 'README.md describes the fixture and pnpm -w typecheck validates workspace health.',
      riskSurface: source === 'builder' ? 'Governance drift.' : 'Governance drift plus stale validation.',
    },
    findings: [
      { axis: 'entry point', claim: 'README.md explains takeover proof.', evidence: 'README.md:1', confidence: 'high', severity: 'low' },
      { axis: 'validation', claim: 'pnpm -w typecheck validates workspace health.', evidence: 'package.json:scripts.typecheck', confidence: 'high', severity: 'low' },
    ],
    residualGaps: [{ note: 'Validation proof still needs a runnable priority.', confidence: 'high', severity: 'high', coversValidationCommand: 'pnpm -w typecheck' }],
    decision: iteration === 2 ? 'converged' : 'read-more',
  })
}

async function writeExecutorFixture(workspace) {
  await mkdir(join(workspace, 'cocoder', 'personas'), { recursive: true })
  await mkdir(join(workspace, 'cocoder', 'plays', 'deltas'), { recursive: true })
  await writeFile(join(workspace, 'README.md'), '# Takeover Proof Fixture\nThis repo proves takeover executor flow.\n', 'utf8')
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }, null, 2) + '\n', 'utf8')
  await writeFile(join(workspace, 'cocoder', 'personas', 'assignments.json'), JSON.stringify({
    personas: {
      oscar: { cli: 'claude', model: '' },
      bob: { cli: 'codex', model: '' },
      deb: { cli: 'codex', model: '', enabled: true },
    },
  }, null, 2) + '\n', 'utf8')
}

async function proveHappyPath(root) {
  const workspace = join(root, 'workspace')
  const runDir = join(root, 'run')
  await writeExecutorFixture(workspace)

  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'proof', path: workspace, name: 'Takeover Proof' })
  const run = store.createRun({ workspaceId: 'proof', priorityId: 'onboarding-playbook', playbookId: 'cocoder-takeover' })
  const commits = []
  const builds = []
  const ctx = {
    store,
    git: fakeGitFromWorkspace(commits),
    sessionHost: {},
    liveRefs: new Set(),
    cliTestCache: new Map([
      ['codex', { preflight: { ok: true, checks: [] }, models: { canEnumerate: true, models: ['gpt-proof-top'], detail: 'codex fake' }, testedAt: 1 }],
      ['claude', { preflight: { ok: true, checks: [] }, models: { canEnumerate: true, models: ['opus-proof-top'], detail: 'claude fake' }, testedAt: 1 }],
    ]),
    getAdapter: () => fakeAdapter(builds),
    runHeadless: async (input) => {
      const prompt = String(input.args[1] ?? '')
      if (prompt.includes('# P1 Agentic Recon Pass')) return { exitCode: 0, output: JSON.stringify(reconOutput) }
      if (prompt.includes('# P1 Takeover Intent Intake')) return { exitCode: 0, output: JSON.stringify(intentOutput) }
      if (prompt.includes('P3 follow-up')) return { exitCode: 0, output: deepReadOutput('orchestrator', 2) }
      const source = prompt.includes('Deep-read source: builder') ? 'builder' : 'orchestrator'
      const iteration = prompt.includes('Iteration: 2') ? 2 : 1
      return { exitCode: 0, output: deepReadOutput(source, iteration) }
    },
  }

  const playbook = loadOnboardingPlaybooks(basePlaybooksDir()).find((candidate) => candidate.id === 'cocoder-takeover')
  check('Takeover playbook loads', playbook !== undefined)
  const runPhase = createDaemonPlaybookPhaseAction(ctx, workspace, runDir, run.id, playbook.modelPin, { cli: 'codex', model: '' }, new AbortController().signal)
  let clock = 1000
  const now = () => clock++

  const started = await startPlaybookExecutor({ playbook, runDir, now, runPhase })
  check('executor pauses at P1 founder gate', started.state.status === 'awaiting-founder' && started.state.gate?.phaseId === 'P1')

  const p1 = await loadPlaybookExecutor({ playbook, runDir, now, runPhase })
  const afterP1 = await p1.resume({ approvedBy: 'founder', note: 'approve P1 map and spend' })
  check('executor resumes through P2/P3 and pauses at P4 founder gate', afterP1.state.status === 'awaiting-founder' && afterP1.state.gate?.phaseId === 'P4')

  const p4 = await loadPlaybookExecutor({ playbook, runDir, now, runPhase })
  const afterP4 = await p4.resume({ approvedBy: 'founder', note: 'answer P4 checkpoint' })
  check('executor runs P5/P6 present and pauses at P6 ratify gate', afterP4.state.status === 'awaiting-founder' && afterP4.state.gate?.phaseId === 'P6')

  const stagedFiles = await listFiles(join(runDir, 'playbook', 'P5', 'proposed-cocoder'))
  check('P5 staged proposed cocoder governance exists', stagedFiles.includes('memory/architecture-notes.md') && stagedFiles.some((file) => /^priorities\/objective-\d+\.md$/.test(file)), stagedFiles.join(', '))
  const preRatifyPriorities = (await listFiles(join(workspace, 'cocoder', 'priorities'))).filter((file) => /^objective-\d+\.md$/.test(file))
  check('nothing synthesized is runnable before P6 ratification', preRatifyPriorities.length === 0)

  const p6 = await loadPlaybookExecutor({ playbook, runDir, now, runPhase })
  const afterP6 = await p6.resume({ approvedBy: 'founder', note: 'ratify objectives' })
  check('executor resumes past P6, runs P7, and reaches done', afterP6.state.status === 'done' && afterP6.state.currentPhaseId === null)

  const appliedFiles = await listFiles(join(workspace, 'cocoder'))
  const appliedPriority = appliedFiles.find((file) => /^priorities\/objective-\d+\.md$/.test(file))
  check('ratified priorities materialize under cocoder/priorities', appliedPriority !== undefined, appliedFiles.join(', '))
  const priorityText = await readFile(join(workspace, 'cocoder', appliedPriority), 'utf8')
  check('ratified priority has draft status marker stripped', !priorityText.includes('status: future'))
  check('happy path commit writes only cocoder/**', commits.length === 1 && commits[0].files.length > 0 && commits[0].files.every((file) => file.startsWith('cocoder/')), JSON.stringify(commits[0]?.files ?? []))

  const ratifyEvents = store.listEvents(run.id).filter((event) => event.type === 'playbook-ratify-result')
  const ratify = ratifyEvents[0]?.data
  check('playbook-ratify-result fires exactly once', ratifyEvents.length === 1)
  check('ratify event records applied-file and objective counts', ratify.appliedFileCount > 0 && ratify.objectiveCount > 0 && ratify.priorityCount > 0, JSON.stringify(ratify))
}

async function provePoisonRefusal() {
  const store = openRunStore(':memory:')
  store.upsertWorkspace({ id: 'poison', path: '/tmp/poison', name: 'Poison' })
  const run = store.createRun({ workspaceId: 'poison', priorityId: 'onboarding-playbook', playbookId: 'cocoder-takeover' })
  const commits = []
  const git = fakeGitChanged(['cocoder/priorities/objective-1.md', 'src/product.ts'], commits)
  let refused = false
  try {
    await runCommitGate({
      git,
      store,
      cwd: '/tmp/poison',
      runId: run.id,
      workItemId: null,
      scope: ['cocoder/**'],
      message: 'takeover-ratify: poisoned apply proof',
      headBefore: 'h0',
      auditWriteBoundary: { label: 'cocoder-takeover', scope: ['cocoder/**'] },
    })
  } catch (err) {
    refused = err instanceof AuditWriteBoundaryError
  }
  const refusedEvents = store.listEvents(run.id).filter((event) => event.type === 'audit-write-boundary-refused')
  check('poisoned apply-commit is refused with AuditWriteBoundaryError', refused)
  check('poisoned apply-commit commits nothing', commits.length === 0 && store.listCommitLinks(run.id).length === 0)
  check('poisoned apply-commit records audit-write-boundary-refused', refusedEvents.length === 1)
}

async function main() {
  ;({ createDaemonPlaybookPhaseAction } = await import(pathToFileURL(join(repoRoot, 'packages/daemon/src/launcher.ts')).href))
  const root = await mkdtemp(join(tmpdir(), 'proof-takeover-executor-'))
  try {
    console.log('Proof - Takeover phase executor on fakes')
    console.log('Temp root: ' + root)
    console.log('')

    const scaffoldRoot = join(root, 'p0-scaffold')
    await mkdir(scaffoldRoot, { recursive: true })
    const scaffold = scaffoldCocoderZone({ templateDir: workspaceTemplateDir(), targetRoot: scaffoldRoot, installRoot: repoRoot })
    check('P0 scaffold primitive creates the governance skeleton', scaffold.created.includes('cocoder/AGENTS.md'), scaffold.created.length + ' files')
    console.log('INFO - Executor fixture is separate from P0 scaffold so synthesized takeover priorities are absent until P6.')

    await proveHappyPath(root)
    await provePoisonRefusal()

    console.log('')
    console.log('SUMMARY: PASS - Takeover executor reached done through P1/P4/P6 gates on fakes; P6 apply committed only cocoder/**; poisoned apply was refused.')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exitCode = 1
})
`

try {
  const result = await exec('pnpm', ['exec', 'tsx', '--eval', harness.replace('__REPO_ROOT__', JSON.stringify(repoRoot))], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
} catch (err) {
  if (err && typeof err === 'object') {
    const detail = err
    if (typeof detail.stdout === 'string') process.stdout.write(detail.stdout)
    if (typeof detail.stderr === 'string') process.stderr.write(detail.stderr)
    if (typeof detail.message === 'string') console.error(detail.message)
  } else {
    console.error(String(err))
  }
  process.exitCode = 1
}
