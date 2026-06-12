// Launch-prompt composition (ADR-0005). Each prompt = shared-standards layer + the persona's own
// rules + the run-specific instructions. The shared layer is prepended once, not duplicated.
//
// ADR-0013: the run is a multi-atom loop. Oscar drives Bob through a SEQUENCE of atoms, the runner
// watches Bob live (the monitor), and Oscar ends the run on his own wrap-up decision.

/** The per-atom completion sentinel Bob prints when an atom is done. Per-atom-unique so a prior atom's
 *  sentinel still on screen cannot falsely complete the next one (the monitor matches it deterministically). */
export function atomSentinel(atomIndex: number, attemptQualifier?: string): string {
  return `<<<COCODER-ATOM-${atomIndex}${attemptQualifier === undefined ? '' : `-${attemptQualifier}`}-DONE>>>`
}

function adHocInstruction(task?: string | null): string {
  return typeof task === 'string' && task.trim() !== '' ? `\n## Founder's ad-hoc instruction (this run)\n\n${task}\n` : ''
}

export function buildOrchestratorPrompt(input: {
  sharedStandards: string
  oscarBody: string
  priorityTitle: string
  priorityGoal: string
  task?: string | null
  firstDirectivePath: string
  builderLabel: string
  builderCli: string
  /** Oscar's support-write allow-list. Non-empty scopes are gate-committed at wrap. */
  oscarWriteScope: readonly string[]
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
  const oscarScope =
    input.oscarWriteScope.length > 0
      ? input.oscarWriteScope.map((s) => `  - ${s}`).join('\n')
      : '  (none — direct edits are surfaced for a scope decision, not committed)'
  return `${input.sharedStandards}

---
# Your role

${input.oscarBody}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}${adHocInstruction(input.task)}
${resume}
# Isolated working state (this run)

This run works in its OWN git worktree on branch \`${input.runBranch}\`, branched from the trunk tip at
launch. CoCoder integrates the run's verified work to trunk for you (a verified auto-merge). Do NOT push,
merge, rebase, or switch branches by hand — work on this branch and let the runner land it.

# How this run works — you orchestrate the builder through a LOOP

**Artifact-first rule (non-negotiable):** your FIRST action in this run is to write the required
directive JSON to \`${input.firstDirectivePath}\`. Do not answer in chat, finish the session, or wait
for founder follow-up before that artifact exists — the runner is polling for the FILE; a chat reply
is invisible to it, and exiting without the file faults the whole run (\`directive-timeout\`, the
loop's most-recurred failure). If the priority does not contain enough concrete work to delegate yet,
write a wrap-up directive whose pickup says exactly what founder input is needed — never just exit.

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

# Oscar support edits and wrap commits

Keeping documentation correct for the work you orchestrate is part of your job — usually by delegating a
doc-update (to the builder or a documentation sub-agent), the same way you delegate code; don't skip it.

And "delegate, don't implement" is the loop's DEFAULT, not a cage: a direct founder instruction always
overrides it. If the founder hands you a change — a documentation update OR an orchestration fix — DO IT
before wrap-up; never refuse on the grounds that you "only orchestrate" or are "read-only." After wrap-up
delivery, answer questions and diagnose freely, but do not make file-changing edits unless the runner has
opened a fresh committed path for them. Otherwise state that the change needs a new run or explicit repair
path.

Your support-write scope for this run is:

${oscarScope}

When you wrap, the runner's default is to commit any pending files inside that Oscar support scope. If a
support edit is outside this scope, or another blocker prevents the commit, bubble that blocker to the
founder plainly; do not treat "already wrapped" as a reason to leave your own in-scope support files
uncommitted.

# Teardown mechanism (for this run)

If you are asked to tear down this run, invoke the provided mechanism — do NOT kill processes or windows
by hand, and never touch the Oz daemon:

    cocoder oz teardown ${input.runId}

That safely closes only this run's panes (the same operation Oz's teardown button uses).`
}

export function buildHeadlessOscarTurnPrompt(input: {
  sharedStandards: string
  oscarBody: string
  priorityTitle: string
  priorityGoal: string
  task?: string | null
  builderLabel: string
  builderCli: string
  /** Oscar's support-write allow-list. Non-empty scopes are gate-committed at wrap. */
  oscarWriteScope: readonly string[]
  runId: string
  runBranch: string
  runDir: string
  dispatch: string
}): string {
  const oscarScope =
    input.oscarWriteScope.length > 0
      ? input.oscarWriteScope.map((s) => `  - ${s}`).join('\n')
      : '  (none — direct edits are surfaced for a scope decision, not committed)'
  return `${input.sharedStandards}

---
# Your role

${input.oscarBody}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}${adHocInstruction(input.task)}
# Fresh headless turn

This is a FRESH session resuming an in-progress run. Reconstruct state by reading the
\`directive-*.json\` and \`verify-*.json\` artifacts in:

    ${input.runDir}

before acting. Your required output artifact is defined by the dispatch below.

This run works in its OWN git worktree on branch \`${input.runBranch}\`, branched from the trunk tip at
launch. CoCoder integrates the run's verified work to trunk for you (a verified auto-merge). Do NOT push,
merge, rebase, or switch branches by hand — work on this branch and let the runner land it.

You drive the builder (${input.builderLabel}, a \`${input.builderCli}\` CLI) through a sequence of atoms.
Write the exact directive or verify artifact named by the dispatch. Delegate builds to the builder by
writing delegate directives; verify atoms yourself against the actual diff and evidence; wrap only at a
natural breakpoint with a pickup brief a fresh session can resume from.

Oscar support edits and wrap commits follow the same rules as launch: documentation/support work is part
of orchestration, and pending files inside your support-write scope are gate-committed at wrap. Your
support-write scope for this run is:

${oscarScope}

Teardown, if explicitly requested, must use:

    cocoder oz teardown ${input.runId}

---
# Dispatch

${input.dispatch}`
}

export function buildObserverPrompt(input: {
  sharedStandards: string
  debBody: string
  priorityTitle: string
  priorityGoal: string
  task?: string | null
  runId: string
  /** This run's isolated branch (ADR-0015) — Deb integrates nothing by hand either. */
  runBranch: string
  /** The runner-owned live status feed Deb reads to assess the run (ADR-0016). */
  statusPath: string
  /** Where Deb writes a narrow nudge recommendation for the runner to deliver to Oscar (ADR-0016). */
  nudgePath: string
  /** Deb's effective write-scope this run — non-empty enables repair mode (ADR-0016). */
  writeScope: readonly string[]
}): string {
  const scope = input.writeScope.length > 0 ? input.writeScope.map((s) => `  - ${s}`).join('\n') : '  (none this run — propose only)'
  return `${input.sharedStandards}

---
# Your role

${input.debBody}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}${adHocInstruction(input.task)}

This run works in an isolated git worktree on branch \`${input.runBranch}\` (ADR-0015); the runner
integrates verified work to trunk. Never push, merge, rebase, or switch branches by hand.

# How you see the run — the status feed (read it any time)

The runner keeps a live status projection for you at:

    ${input.statusPath}

Read it whenever you need to assess the run — it is your eyes, so you never probe panes, attach to
sessions, or hunt run dirs (\`tmux\`/CLIs/run-dir scraping are forbidden; the feed replaces them). It
reports the active atom/task, Oscar/Bob/verify state (waiting · running · verifying · stalled ·
blocked), the timestamps of the last directive / builder activity / verify, the current wait condition,
outstanding fault dispatches, and write scopes by persona. When asked "how's Oscar doing?", answer from
this — concrete state + timestamps + what the runner is blocked on — never a guess.

# Recommending a nudge (you advise; the runner delivers)

If the feed shows a stall you can name a narrow fix for — Oscar waiting on a verify verdict with no
evidence; Bob repeating a failed command; the runner waiting on a file no persona is scoped to write —
recommend ONE narrow intervention by writing JSON to:

    ${input.nudgePath}

    {"target": "oscar", "message": "<the narrow prompt to send Oscar>", "rationale": "<why>", "seq": 1}

Bump \`seq\` for each new recommendation. The runner decides whether/how to deliver it (rate-limited) and
sends it to Oscar — you never message Oscar or Bob directly. You may OBSERVE Bob to diagnose, but you
never direct Bob: \`target\` is always \`oscar\` (the authority rule, ADR-0013).

# When the runner dispatches a fault — triage it

When the runner hands you a fault, read its context JSON, then write EXACTLY ONE disposition as JSON to
the triage path it names (and nothing else):

   - \`cocoder-bug\` — the CoCoder machinery itself misbehaved. Either PROPOSE a fix (\`{"disposition":
     "cocoder-bug","summary":"…","mode":"propose","proposal":"<unified diff>"}\` — reviewed, not applied),
     OR, if it is clearly within your active CoCoder authority below, REPAIR it directly: edit the files in this
     worktree, run the checks, then write \`{"disposition":"cocoder-bug","summary":"…","mode":"repair",
     "diagnosis":"…","whyCocoderOwned":"…","filesChanged":["…"],"verification":"…","remainingRisk":"…"}\`.
   - \`repo-bug\` — the target repo's persona/tools/Plays are at fault → \`summary\` is a plain-English
     question for the founder.
   - \`one-off\` — isolated / unlikely to repeat → just summarise; it will be logged.

# Repair mode — authority-gated, and never a rescue

Your active write-scope this run (the paths the runner may commit for your repair):
${scope}

Anything you edit OUTSIDE this scope — especially target-repo product code — is held back at the gate and
surfaced to the founder, never committed. In the CoCoder source repo, diagnose the \`cocoder-bug\` and
repair the root cause where it lives; do not stop merely because it crosses an old implementation-folder
boundary. Never commit on behalf of Bob/Talia/Quinn, and never write their delegation/verify verdicts. A
repair does NOT rescue the run (a faulted run still fails); it lands as a distinct \`deb-repair\` commit
the founder reviews.

# Recurring faults — escalate on the SECOND occurrence

The fault context carries an \`occurrence\` count (how many times this fault's fingerprint has appeared
across runs). On a FIRST occurrence, a transient is fine to log as \`one-off\`. On a SECOND+ occurrence it
is not a one-off — escalate, in this order:
1. **Fix it** if it is easy and clearly within your active CoCoder authority (repair mode above).
2. **Otherwise (your default): file a tracked ticket** — create \`cocoder/tickets/open/NNNN-slug.md\` (next
   id from \`cocoder/tickets/INDEX.md\`, which you also update) with frontmatter \`type: bug\`, \`status:
   Open\`, \`owner: deb\`, and \`priority: <the most relevant existing priority slug, or none>\`. That is "a
   follow-up on an existing priority" — set \`"escalation":"ticket","ticketId":"NNNN"\` in your verdict.
3. **Only if a new priority is truly warranted**, recommend it INSIDE that ticket for founder approval
   (\`"escalation":"recommend-priority"\`) — never create a \`cocoder/priorities/*\` file yourself.

The ticket is gate-committed like a repair (on the run branch; the founder lands it), and the recurrence
is recorded in your disposition so the founder is informed. Do not spin up new priorities to make progress.

# Teardown mechanism (for this run)

If you are asked to tear down this run, invoke the provided mechanism — do NOT kill processes or windows
by hand, and never touch the Oz daemon:

    cocoder oz teardown ${input.runId}

That safely closes only this run's panes (the same operation Oz's teardown button uses).`
}

export function buildWrapupDelivery(runId: string, brief: string): string {
  return `WRAP-UP READY for ${runId}.

Deliver this founder-facing wrap-up now, in plain English, then wait. Do not close panes, do not run
teardown, and do not ask for teardown. The founder may ask questions, request a priority update, or say
"kill" / "tear down" explicitly.

${brief}`
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
export function buildBuilderDispatch(directivePath: string, atomIndex: number, loopLedgerPath?: string): string {
  const base = `PROCEED — this is atom ${atomIndex}. Read your task from ${directivePath} and implement it now within your write-scope. When you are fully done (tests/typecheck run), print your completion marker for atom ${atomIndex} on its own line, exactly as your standby instructions describe.`
  if (loopLedgerPath === undefined) return base
  return `${base} This is a loop atom: after each completed iteration, append one JSON line to ${loopLedgerPath} with at minimum {"iteration":<1-based int>,"result":"green"|"red","failed":"<what failed>","changed":"<what changed>","inScope":<bool>}.`
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

/** Dispatch a fault to Deb to triage (ADR-0013 tier 2, expanded by ADR-0016). Names the fault-context
 *  path to read and the triage path to write the verdict to — same pointer-to-file pattern as the
 *  builder/verify dispatches. The status feed (already in Deb's launch prompt) gives her the run context.
 *  `occurrence` is how many times this fault's fingerprint has been seen (1 = first; >=2 = recurrence). */
export function buildDebTriageDispatch(faultPath: string, triagePath: string, occurrence = 1): string {
  const recurrence =
    occurrence >= 2
      ? ` This fault has now occurred ${occurrence} times (see "occurrence" in the context) — it is NOT a one-off. Escalate per your recurring-fault rules: fix it if it is easy and clearly in your fence; else file a tracked ticket under cocoder/tickets/ tagged to the most relevant existing priority (set "escalation":"ticket","ticketId":"NNNN"); only recommend a NEW priority inside that ticket for founder approval (set "escalation":"recommend-priority") — never create a priority file yourself.`
      : ''
  return `TRIAGE — a fault occurred in this run. Read the fault context from ${faultPath} (and the status feed for context), classify it to exactly one disposition (cocoder-bug | repo-bug | one-off), and write your verdict to ${triagePath}. For a cocoder-bug choose "mode":"propose" (a "proposal" diff, reviewed not applied) OR, only within your write-scope, "mode":"repair" (edit the files now, then report diagnosis/whyCocoderOwned/filesChanged/verification/remainingRisk). Out-of-scope edits — including any target-repo product code — are held back at the commit-gate, never committed. A repair does not rescue the run.${recurrence}`
}

export function commitMessage(priorityId: string, runId: string, atomIndex: number): string {
  return `${priorityId}: atom ${atomIndex} via CoCoder run ${runId}`
}
