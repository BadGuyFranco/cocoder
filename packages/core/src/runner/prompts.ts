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

Writing that file is your FINAL action — then stop. Do not edit repository files.`
}

export function buildBuilderPrompt(input: {
  sharedStandards: string
  bobBody: string
  task: string
  scope: readonly string[]
  donePath: string
}): string {
  const scope = input.scope.length > 0 ? input.scope.map((s) => `  - ${s}`).join('\n') : '  (none — read-only)'
  return `${input.sharedStandards}

---
# Your role

${input.bobBody}

---
# Your task

${input.task}

# Write-scope (enforced at commit)

Only changes to these paths will be committed by CoCoder; anything outside is held back for review:
${scope}

Make the change within scope, then run any relevant checks (tests, typecheck).

# Signal completion (required)

When you are finished (including if you determine no change is needed), write this exact file as
your FINAL action — it is how CoCoder knows you are done (your session stays open, it does not exit):

    ${input.donePath}

with this shape (and nothing else):

    {"done": true, "summary": "<one line: what you changed, or why nothing was needed>"}`
}

export function commitMessage(priorityId: string, runId: string): string {
  return `${priorityId}: implemented via CoCoder run ${runId}`
}
