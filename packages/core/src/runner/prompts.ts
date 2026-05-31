// Launch-prompt composition (ADR-0005). Each prompt = shared-standards layer + the persona's own
// rules + the run-specific instructions. The shared layer is prepended once, not duplicated.
//
// ADR-0013: the run is a multi-atom loop. Oscar drives Bob through a SEQUENCE of atoms, the runner
// watches Bob live (the monitor), and Oscar ends the run on his own wrap-up decision.

/** The per-atom completion sentinel Bob prints when an atom is done. Per-atom-unique so a prior atom's
 *  sentinel still on screen cannot falsely complete the next one (the monitor matches it deterministically). */
export function atomSentinel(atomIndex: number): string {
  return `<<<COCODER-ATOM-${atomIndex}-DONE>>>`
}

export function buildOrchestratorPrompt(input: {
  sharedStandards: string
  oscarBody: string
  priorityTitle: string
  priorityGoal: string
  firstDirectivePath: string
  builderLabel: string
  builderCli: string
  runId: string
  /** This run's isolated branch (ADR-0015) — agents work on it and never integrate by hand. */
  runBranch: string
  /** A prior run's pickup brief to resume from (ADR-0002 C1 / F8), or null for a fresh start. */
  pickup?: string | null
}): string {
  const resume =
    input.pickup && input.pickup.trim() !== ''
      ? `\n# Resuming from a prior session\n\nThis run CONTINUES earlier work. Pick up from this brief — do not redo what it says is done:\n\n${input.pickup}\n`
      : ''
  return `${input.sharedStandards}

---
# Your role

${input.oscarBody}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}
${resume}
# Isolated working state (this run)

This run works in its OWN git worktree on branch \`${input.runBranch}\`, branched from the trunk tip at
launch. CoCoder integrates the run's verified work to trunk for you (a verified auto-merge). Do NOT push,
merge, rebase, or switch branches by hand — work on this branch and let the runner land it.

# How this run works — you orchestrate the builder through a LOOP

You drive the builder (${input.builderLabel}, a \`${input.builderCli}\` CLI) through a SEQUENCE of small
atoms. One atom at a time:

1. **Scope the next atom.** Write it as JSON to the exact path the runner gives you (the FIRST is
   \`${input.firstDirectivePath}\`):

       {"kind": "delegate", "task": "<clear instructions: what to change, acceptance criteria, what must not break>"}

   Then stop and wait for the builder rather than implementing the atom yourself. Delegating the build
   is your DEFAULT working mode for the loop — it is how you run, not a limit on what you may touch.
2. **Verify** when the runner prompts you (see below) — per atom, the commit will NOT happen without your pass.
3. **Decide: another atom, or enough?** After each atom the runner asks you to write the NEXT directive
   (it gives you the exact path). Either delegate another atom (same shape as above), or **WRAP UP**:

       {"kind": "wrapup", "pickup": "<a brief a FRESH session can resume from: what is done, what remains, where to start>"}

   End the run when the builder has had enough for one session (context filling, a natural breakpoint) —
   not because one small thing finished. The wrap-up's pickup is how the next session continues this work.

# Verifying an atom (the gate — no human backstop)

When the runner prompts you to VERIFY, read the ACTUAL diff and check it against the atom you delegated;
run the tests/typecheck yourself (evidence, not the builder's claim). Write your verdict to the exact
verify path the runner names, with this shape and nothing else:

    {"verdict": "pass", "reason": "<one line: what you verified>"}

or

    {"verdict": "fail", "reason": "<one line: what is wrong>"}

The atom's commit runs ONLY on \`pass\`. On a \`fail\` nothing is committed for that atom; the runner will
ask you for the next directive — re-scope the atom (delegate again) or wrap up.

# Documentation, and founder-directed edits — never refuse these

Keeping documentation correct for the work you orchestrate is part of your job — usually by delegating a
doc-update (to the builder or a documentation sub-agent), the same way you delegate code; don't skip it.

And "delegate, don't implement" is the loop's DEFAULT, not a cage: a direct founder instruction always
overrides it. If the founder hands you a change — a documentation update OR an orchestration fix — DO IT;
never refuse on the grounds that you "only orchestrate" or are "read-only." This holds AFTER you wrap up
too: your pane stays open, and the founder may ask clarifying questions and request edits — make them.
(Anything outside the builder's write-scope is simply surfaced for an expand-or-discard decision at the
commit-gate; it is never forbidden to edit.)

# Teardown mechanism (for this run)

If you are asked to tear down this run, invoke the provided mechanism — do NOT kill processes or windows
by hand, and never touch the Oz daemon:

    cocoder oz teardown ${input.runId}

That safely closes only this run's panes (the same operation Oz's teardown button uses).`
}

export function buildObserverPrompt(input: {
  sharedStandards: string
  debBody: string
  priorityTitle: string
  priorityGoal: string
  runId: string
  /** This run's isolated branch (ADR-0015) — Deb is read-only and never integrates either. */
  runBranch: string
}): string {
  return `${input.sharedStandards}

---
# Your role

${input.debBody}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}

This run works in an isolated git worktree on branch \`${input.runBranch}\` (ADR-0015); the runner
integrates verified work to trunk. You are read-only regardless — never push, merge, or commit.

# What to do right now — stand by until the runner hands you a fault to triage

Do NOT probe, attach to, or drive the run yourself (no \`tmux\`, no CLIs, no run-dir hunting), and never
write repository changes or commits. You act only when the runner DISPATCHES a fault to you. When it does:

1. Read the fault context JSON at the path the dispatch names (what failed, which atom, the message).
2. Triage it to EXACTLY ONE disposition:
   - \`cocoder-bug\` — the CoCoder machinery itself misbehaved → include a proposed fix as a unified diff
     in \`proposal\` (a PROPOSAL for founder review — you do NOT apply it or push anything).
   - \`repo-bug\` — the target repo's persona/tools/Plays are at fault → the \`summary\` is a plain-English
     question for the founder.
   - \`one-off\` — isolated / unlikely to repeat → just summarise; it will be logged.
3. Write your verdict as JSON to the exact triage path the dispatch names (and nothing else):

       {"disposition": "cocoder-bug", "summary": "<one line, plain English>", "proposal": "<unified diff, optional>"}

You are read-only and never commit: you emit this verdict; the runner records it and surfaces your
disposition to the founder. That is the whole of your authority this slice.

# Teardown mechanism (for this run)

If you are asked to tear down this run, invoke the provided mechanism — do NOT kill processes or windows
by hand, and never touch the Oz daemon:

    cocoder oz teardown ${input.runId}

That safely closes only this run's panes (the same operation Oz's teardown button uses).`
}

/** The builder's LAUNCH prompt: Bob is spawned up front, on standby, and must NOT act until the runner
 *  dispatches an atom. Each atom's task arrives via a directive file; Bob signals completion by printing
 *  a sentinel line the runner's monitor watches for (NOT a done-file — the monitor is the live signal). */
export function buildBuilderStandbyPrompt(input: {
  sharedStandards: string
  bobBody: string
  scope: readonly string[]
  /** This run's isolated branch (ADR-0015) — Bob works on it; the runner integrates to trunk. */
  runBranch: string
}): string {
  const scope = input.scope.length > 0 ? input.scope.map((s) => `  - ${s}`).join('\n') : '  (none — read-only)'
  return `${input.sharedStandards}

---
# Your role

${input.bobBody}

---
# Standby — do NOT act yet

You have been launched early so your session is warm. **Do nothing yet** — do not inspect files, plan,
run commands, or edit. Wait for a dispatch message that gives you an atom to implement.

You are in this run's isolated git worktree on branch \`${input.runBranch}\` (ADR-0015). Just do the
work on this branch — do NOT push, merge, rebase, or switch branches; the runner integrates to trunk.

This run runs MULTIPLE atoms through this same pane, one at a time. For EACH atom the runner sends you:
1. Read the JSON at the directive path it names — its \`task\` field is your atom.
2. Implement it. Your write-scope (enforced at CoCoder's commit-gate; anything outside is held back):
${scope}
3. Run the relevant checks (tests, typecheck).
4. As your FINAL action, print your completion marker for the atom on its OWN line, with nothing else on
   that line: the literal text \`<<<COCODER-ATOM-#-DONE>>>\` with \`#\` replaced by the atom number the
   dispatch names. That standalone line is how CoCoder knows the atom is done — your session stays open
   for the next atom; it does not exit. (Do not print the marker until the work is actually finished.)

The orchestrator watches your pane live and may nudge you if you stall; keep working visibly.`
}

/** Dispatch an atom into Bob's warm pane (sent once Oscar has delegated it). Names the directive path to
 *  read and the atom NUMBER — never the literal completion marker, so the monitor cannot match the
 *  marker from this instruction's own echo (dogfood bug). Bob forms the marker per the standby prompt. */
export function buildBuilderDispatch(directivePath: string, atomIndex: number): string {
  return `PROCEED — this is atom ${atomIndex}. Read your task from ${directivePath} and implement it now within your write-scope. When you are fully done (tests/typecheck run), print your completion marker for atom ${atomIndex} on its own line, exactly as your standby instructions describe.`
}

/** The verify dispatch into Oscar's pane once the monitor reports the atom done — the gate (ADR-0011),
 *  per atom. The atom's commit does not run until Oscar writes a `pass` verdict to verifyPath. */
export function buildVerifyDispatch(directivePath: string, verifyPath: string): string {
  return `VERIFY — the builder finished this atom. Verify the diff against the task you delegated in ${directivePath}: read the actual changes and run the tests/typecheck yourself (evidence, not the builder's word). Then write your verdict to ${verifyPath} as {"verdict":"pass"|"fail","reason":"<one line>"}. The commit happens ONLY on pass.`
}

/** Prompt Oscar for the next turn after an atom resolved: delegate another atom, or wrap up. Names the
 *  exact directive path so the numbered handshake is unambiguous (a re-delegation is simply the next n). */
export function buildNextOrWrapDispatch(nextDirectivePath: string, outcome: string): string {
  return `NEXT — ${outcome}. Write your next directive to ${nextDirectivePath}: either {"kind":"delegate","task":"…"} for the next atom, or {"kind":"wrapup","pickup":"…"} to end the run with a resumable pickup brief. Decide whether the builder has had enough for one session.`
}

/** Dispatch a fault to Deb to triage (ADR-0013 tier 2). Names the fault-context path to read and the
 *  triage path to write the verdict to — same pointer-to-file pattern as the builder/verify dispatches. */
export function buildDebTriageDispatch(faultPath: string, triagePath: string): string {
  return `TRIAGE — a fault occurred in this run. Read the fault context from ${faultPath}, classify it to exactly one disposition (cocoder-bug | repo-bug | one-off), and write your verdict to ${triagePath} as {"disposition":"…","summary":"<one line>","proposal":"<unified diff, only for cocoder-bug>"}. You propose/log only — you never apply or commit a fix.`
}

export function commitMessage(priorityId: string, runId: string, atomIndex: number): string {
  return `${priorityId}: atom ${atomIndex} via CoCoder run ${runId}`
}
