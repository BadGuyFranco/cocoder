// Launch-prompt composition (ADR-0005). Each prompt = shared-standards layer + the persona's
// own rules + the run-specific instructions. The shared layer is prepended once, not duplicated.

export function buildOrchestratorPrompt(input: {
  sharedStandards: string
  oscarBody: string
  priorityTitle: string
  priorityGoal: string
  delegationPath: string
  builderLabel: string
  builderCli: string
  runId: string
}): string {
  return `${input.sharedStandards}

---
# Your role

${input.oscarBody}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}

# What to do right now

You are orchestrating — do NOT implement anything yourself. Scope exactly ONE focused,
self-contained implementation task for the builder (${input.builderLabel}, a \`${input.builderCli}\` CLI).

When the task is fully scoped, write it as JSON to this exact path:

    ${input.delegationPath}

with this shape (and nothing else):

    {"task": "<clear instructions: what to change, acceptance criteria, and what must not break>"}

Writing that file is your FINAL action for delegation — then stop. Do not edit repository files.

# Teardown mechanism (for this run)

If you are asked to tear down this run, invoke the provided mechanism — do NOT kill processes or
windows by hand, and never touch the Oz daemon:

    cocoder oz teardown ${input.runId}

That safely closes only this run's panes (the same operation Oz's teardown button uses).`
}

/** The builder's LAUNCH prompt (concurrent-spawn model): Bob is spawned up front, on standby, and
 *  must NOT act until the runner dispatches "PROCEED". The task itself arrives in delegationPath. */
export function buildBuilderStandbyPrompt(input: {
  sharedStandards: string
  bobBody: string
  scope: readonly string[]
  delegationPath: string
  donePath: string
}): string {
  const scope = input.scope.length > 0 ? input.scope.map((s) => `  - ${s}`).join('\n') : '  (none — read-only)'
  return `${input.sharedStandards}

---
# Your role

${input.bobBody}

---
# Standby — do NOT act yet

You have been launched early so your session is warm. **Do nothing yet** — do not inspect files, plan,
run commands, or edit. Wait for a dispatch message that says **PROCEED**.

When you receive PROCEED:
1. Read the JSON at \`${input.delegationPath}\` — its \`task\` field is your task.
2. Implement it. Your write-scope (enforced at CoCoder's commit-gate; anything outside is held back):
${scope}
3. Run the relevant checks (tests, typecheck).
4. As your FINAL action, write \`${input.donePath}\` with exactly:

       {"done": true, "summary": "<one line: what you changed, or why nothing was needed>"}

   This is how CoCoder knows you are done — your session stays open, it does not exit.`
}

/** The short dispatch line the runner sends into Bob's warm pane once Oscar has delegated. */
export function buildBuilderDispatch(delegationPath: string): string {
  return `PROCEED — your task is ready. Read it from ${delegationPath} and implement it now within your write-scope; write your builder-done file when finished.`
}

export function commitMessage(priorityId: string, runId: string): string {
  return `${priorityId}: implemented via CoCoder run ${runId}`
}
