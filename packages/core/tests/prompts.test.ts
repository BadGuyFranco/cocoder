import { describe, expect, test } from 'vitest'
import { buildBuilderDispatch, buildBuilderStandbyPrompt, buildNextOrWrapDispatch, buildObserverPrompt, buildOrchestratorPrompt, renderPlayManifest, type Play } from '../src/index.js'

const orchestratorInput = {
  sharedStandards: '# Standards',
  oscarBody: 'Oscar body',
  playManifest: '(none)',
  priorityId: 'demo',
  priorityTitle: 'Demo priority',
  priorityGoal: 'Do the base goal.',
  firstDirectivePath: '/runs/run_1/directive-0.json',
  builderLabel: 'Bob',
  builderCli: 'codex',
  oscarWriteScope: [],
  runId: 'run_1',
  runBranch: 'cocoder/run_1',
  cocoderHome: '/Volumes/NAS LOCAL/CoCoder',
}

const observerInput = {
  sharedStandards: '# Standards',
  debBody: 'Deb body',
  playManifest: '(none)',
  priorityTitle: 'Demo priority',
  priorityGoal: 'Do the base goal.',
  runId: 'run_1',
  runBranch: 'cocoder/run_1',
  cocoderHome: '/Volumes/NAS LOCAL/CoCoder',
  statusPath: '/runs/run_1/deb-status.json',
  nudgePath: '/runs/run_1/deb-nudge.json',
  writeScope: [],
}

const manifestPlay = (overrides: Partial<Play>): Play => ({
  id: 'code-review',
  label: 'Code review',
  kind: 'headless',
  executionModel: 'prompt-only',
  triggerClass: 'persona-requested',
  purpose: 'Review a provided diff.',
  allowedCallers: ['oscar'],
  writeScope: [],
  body: 'SECRET FULL BODY PHRASE',
  ...overrides,
})

describe('buildBuilderDispatch', () => {
  test('keeps non-loop dispatch text unchanged', () => {
    expect(buildBuilderDispatch('/runs/run_1/directive-2.json', 2)).toBe(
      'PROCEED — this is atom 2. Read your task from /runs/run_1/directive-2.json and implement it now within your write-scope. When you are fully done (tests/typecheck run), print your completion marker for atom 2 on its own line, exactly as your standby instructions describe.',
    )
  })

  test('adds the loop ledger contract only for loop atoms', () => {
    const text = buildBuilderDispatch('/runs/run_1/directive-2.json', 2, '/runs/run_1/loop-ledger-2.jsonl')
    expect(text).toContain('/runs/run_1/loop-ledger-2.jsonl')
    expect(text).toContain('"result":"green"|"red"')
  })

  test('adds the founder ad-hoc instruction to Oscar and Deb prompts when task is set', () => {
    const task = 'Investigate the flaky launch path before wrapping up.'

    const oscarPrompt = buildOrchestratorPrompt({ ...orchestratorInput, task })
    const debPrompt = buildObserverPrompt({ ...observerInput, task })

    for (const prompt of [oscarPrompt, debPrompt]) {
      expect(prompt).toContain("## Founder's ad-hoc instruction (this run)")
      expect(prompt).toContain(task)
      expect(prompt.indexOf('Do the base goal.')).toBeLessThan(prompt.indexOf("## Founder's ad-hoc instruction (this run)"))
    }
  })

  test('treats pasted adhoc-session instructions as the work before wrap-up', () => {
    const prompt = buildOrchestratorPrompt({
      ...orchestratorInput,
      priorityId: 'adhoc-session',
      priorityTitle: 'Session without a named priority',
      task: 'Review this traceback and tell me what happened.',
    })

    expect(prompt).toContain('# Adhoc support mode')
    expect(prompt).toContain("the founder pasted a specific instruction")
    expect(prompt).toContain('Do not treat "no concrete builder atom" as an immediate reason to\nwrap up')
    expect(prompt).toContain('First perform the bounded read-only support/drafting task')
    expect(prompt).toContain('Do not\nwrite an immediate wrap-up merely because there is no builder atom')
    expect(prompt).not.toContain('your FIRST action in this run is to write the required\ndirective JSON')
  })

  test('keeps the strict artifact-first rule for normal priority tasks', () => {
    const prompt = buildOrchestratorPrompt({
      ...orchestratorInput,
      task: 'Implement the next scoped atom.',
    })

    expect(prompt).toContain('# Oscar launch card')
    expect(prompt.indexOf('# Oscar launch card')).toBeLessThan(prompt.indexOf('# Your role'))
    expect(prompt).toContain('First action: Write the required directive JSON to `/runs/run_1/directive-0.json` before chat or waiting.')
    expect(prompt).toContain('Artifact-first rule')
    expect(prompt).toContain('your FIRST action in this run is to write the required\ndirective JSON')
    expect(prompt).not.toContain('# Adhoc support mode')
  })

  test('renders prompts identically when task is absent or null', () => {
    expect(buildOrchestratorPrompt(orchestratorInput)).toBe(buildOrchestratorPrompt({ ...orchestratorInput, task: null }))
    expect(buildObserverPrompt(observerInput)).toBe(buildObserverPrompt({ ...observerInput, task: null }))
  })

  test('renders teardown through the install root so pane PATH does not matter', () => {
    const prompt = buildOrchestratorPrompt(orchestratorInput)
    expect(prompt).toContain("pnpm --dir '/Volumes/NAS LOCAL/CoCoder' exec cocoder oz teardown run_1 --initiator oscar")
  })

  test('tells Oscar to continue by default while concrete priority work remains', () => {
    const prompt = buildOrchestratorPrompt(orchestratorInput)

    expect(prompt).toContain('Continue by default when the next item is')
    expect(prompt).toContain('A clean commit boundary is a good place to')
    expect(prompt).toContain('Stop conditions: the priority is done')
    expect(prompt).not.toContain('End the run when the builder has had enough')
  })

  test('next-or-wrap dispatch biases toward the next concrete atom without removing wrap discretion', () => {
    const dispatch = buildNextOrWrapDispatch('/runs/run_1/directive-2.json', 'atom 1 verified + committed abc123')

    expect(dispatch).toContain('/runs/run_1/directive-2.json')
    expect(dispatch).toContain('delegate the next concrete in-priority atom')
    expect(dispatch).toContain('unless a real stop condition applies')
    expect(dispatch).toContain('only write the directive file')
    expect(dispatch).toContain('do not also deliver a founder closeout in the pane')
    expect(dispatch).toContain('WRAP-UP READY artifact for exactly-once delivery')
    expect(dispatch).toContain('A clean commit boundary alone is not a reason to stop')
    expect(dispatch).toContain('founder approval needed')
    expect(dispatch).not.toContain('builder has had enough')
  })

  test('renders only Plays available to the caller with compact contract metadata', () => {
    const manifest = renderPlayManifest([
      manifestPlay({
        id: 'code-review',
        purpose: 'Review a provided diff.',
        triggerClass: 'persona-requested',
        allowedCallers: ['oscar'],
        inputSchema: { ref: 'schemas/code-review.input' },
      }),
      manifestPlay({
        id: 'electron-test',
        purpose: 'Drive the app as QA.',
        triggerClass: 'persona-requested',
        allowedCallers: ['quinn'],
      }),
    ], 'oscar')

    expect(manifest).toContain('code-review')
    expect(manifest).toContain('Review a provided diff.')
    expect(manifest).toContain('trigger: persona-requested')
    expect(manifest).toContain('optional')
    expect(manifest).toContain('writes: read-only')
    expect(manifest).toContain('input: schemas/code-review.input')
    expect(manifest).not.toContain('electron-test')
  })

  test('omits reserved Plays from caller manifests while rendering normal Plays unchanged', () => {
    const manifest = renderPlayManifest([
      manifestPlay({
        id: 'create-ticket',
        purpose: 'Create one open ticket.',
        triggerClass: 'persona-requested',
        allowedCallers: ['bob'],
        writeScope: ['cocoder/tickets/**'],
        inputSchema: { ref: 'schemas/create-ticket.input' },
      }),
      manifestPlay({
        id: 'api-repair',
        purpose: 'Dispatch through an API.',
        triggerClass: 'tool/API-triggered',
        allowedCallers: ['bob'],
      }),
      manifestPlay({
        id: 'browser-control',
        purpose: 'Drive browser control.',
        kind: 'interactive',
        allowedCallers: ['bob'],
      }),
    ], 'bob')

    expect(manifest).toBe(
      '- create-ticket: Create one open ticket. | trigger: persona-requested | optional | writes: cocoder/tickets/** | input: schemas/create-ticket.input',
    )
    expect(manifest).not.toContain('api-repair')
    expect(manifest).not.toContain('browser-control')
  })

  test('derives mandatory and optional labels from trigger class', () => {
    const manifest = renderPlayManifest([
      manifestPlay({
        id: 'wrap-up',
        purpose: 'Produce the founder closeout.',
        triggerClass: 'lifecycle-triggered',
        allowedCallers: ['runner wrap-up lifecycle'],
        writeScope: ['cocoder/SESSION_LOG.md'],
      }),
      manifestPlay({
        id: 'create-ticket',
        purpose: 'Create one open ticket.',
        triggerClass: 'persona-requested',
        allowedCallers: ['runner wrap-up lifecycle'],
      }),
    ], 'runner wrap-up lifecycle')

    expect(manifest).toContain('wrap-up: Produce the founder closeout. | trigger: lifecycle-triggered | mandatory')
    expect(manifest).toContain('create-ticket: Create one open ticket. | trigger: persona-requested | optional')
    expect(manifest).toContain('writes: cocoder/SESSION_LOG.md')
  })

  test('launch prompts include compact Play manifest without injecting Play bodies', () => {
    const manifest = renderPlayManifest([
      manifestPlay({
        id: 'create-ticket',
        purpose: 'Create one open ticket from persona-provided follow-up input.',
        allowedCallers: ['bob'],
      }),
    ], 'bob')

    const prompt = buildBuilderStandbyPrompt({
      sharedStandards: '# Standards',
      bobBody: 'Bob body',
      playManifest: manifest,
      scope: ['packages/**'],
      runBranch: 'cocoder/run_1',
    })

    expect(prompt).toContain('# Available Plays')
    expect(prompt).toContain('create-ticket')
    expect(prompt).toContain('Create one open ticket from persona-provided follow-up input.')
    expect(prompt).not.toContain('SECRET FULL BODY PHRASE')
  })
})
