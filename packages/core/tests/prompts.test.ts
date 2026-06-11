import { describe, expect, test } from 'vitest'
import { buildBuilderDispatch, buildObserverPrompt, buildOrchestratorPrompt } from '../src/index.js'

const orchestratorInput = {
  sharedStandards: '# Standards',
  oscarBody: 'Oscar body',
  priorityTitle: 'Demo priority',
  priorityGoal: 'Do the base goal.',
  firstDirectivePath: '/runs/run_1/directive-0.json',
  builderLabel: 'Bob',
  builderCli: 'codex',
  oscarWriteScope: [],
  runId: 'run_1',
  runBranch: 'cocoder/run_1',
}

const observerInput = {
  sharedStandards: '# Standards',
  debBody: 'Deb body',
  priorityTitle: 'Demo priority',
  priorityGoal: 'Do the base goal.',
  runId: 'run_1',
  runBranch: 'cocoder/run_1',
  statusPath: '/runs/run_1/deb-status.json',
  nudgePath: '/runs/run_1/deb-nudge.json',
  writeScope: [],
}

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

  test('renders prompts identically when task is absent or null', () => {
    expect(buildOrchestratorPrompt(orchestratorInput)).toBe(buildOrchestratorPrompt({ ...orchestratorInput, task: null }))
    expect(buildObserverPrompt(observerInput)).toBe(buildObserverPrompt({ ...observerInput, task: null }))
  })
})
