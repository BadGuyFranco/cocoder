// Launch-prompt composition (ADR-0005). Each prompt = shared-standards layer + the persona's own
// rules + the run-specific instructions. The shared layer is prepended once, not duplicated.
//
// ADR-0013: the run is a multi-atom loop. Oscar drives Bob through a SEQUENCE of atoms, the runner
// watches Bob live (the monitor), and Oscar ends the run on his own wrap-up decision. The default
// next-turn bias is to continue while concrete in-priority work remains; wrap-up is for real stop
// conditions, not merely for a clean commit boundary.
import { coCoderRunReference, runDisplayName, runDisplayNumber, type RunDisplayInput } from '../store/index.js'

/** The per-atom completion sentinel Bob prints when an atom is done. Per-atom-unique so a prior atom's
 *  sentinel still on screen cannot falsely complete the next one (the monitor matches it deterministically). */
export function atomSentinel(atomIndex: number, attemptQualifier?: string): string {
  return `<<<COCODER-ATOM-${atomIndex}${attemptQualifier === undefined ? '' : `-${attemptQualifier}`}-DONE>>>`
}

function adHocInstruction(task?: string | null): string {
  return typeof task === 'string' && task.trim() !== '' ? `\n## Founder's ad-hoc instruction (this run)\n\n${task}\n` : ''
}

function availablePlaysSection(manifest: string): string {
  return `---
# Available Plays

Available Plays are CoCoder workflows, not native harness Skills. Do not invoke them with
\`Skill(...)\`, slash commands, or model-host skill syntax unless this prompt explicitly provides a
bridge. Follow runner/daemon Play dispatches when they arrive; for a direct founder-requested support
edit inside your write scope, edit the governed files directly and use the named commit path.

${manifest}`
}

function hasAdHocTask(task?: string | null): boolean {
  return typeof task === 'string' && task.trim() !== ''
}

function isAdHocSupportRun(input: { priorityId: string; task?: string | null }): boolean {
  return input.priorityId === 'adhoc-session' && hasAdHocTask(input.task)
}

function adHocSupportMode(input: { priorityId: string; task?: string | null }): string {
  if (!isAdHocSupportRun(input)) return ''
  return `
# Adhoc support mode

This is the standing "no named priority" on-ramp, and the founder pasted a specific instruction. That
instruction is the work for this run. Do not treat "no concrete builder atom" as an immediate reason to
wrap up.

Handle the pasted instruction before wrap-up:
- If it asks for thinking, research, review, diagnosis, or a draft priority, do that read-mostly work
  yourself and produce the written report or draft in the founder-visible conversation.
- If it reveals product-code work, do not delegate or commit product code from this session; draft the
  needed priority/objective or name the exact founder approval needed.
- Wrap only after you have delivered the report/draft or identified the one missing founder input. The
  pickup brief must include that concrete result, not just "ready" or "no atom".
`
}

function resumeFounderDecisionSection(input?: { readonly question: string; readonly answer?: string | null; readonly nextDirectivePath: string } | null): string {
  if (!input) return ''
  const answer = typeof input.answer === 'string' && input.answer.trim() !== ''
    ? input.answer.trim()
    : '(No founder answer was supplied to the runner; incorporate the founder answer if it is present in the surrounding launch context.)'
  return `
# Resuming after founder decision

You previously asked the founder this question without wrapping the run:

${input.question}

Founder answer:

${answer}

Incorporate that answer now, then write the next directive to ${input.nextDirectivePath}. If concrete
in-priority work remains, write {"kind":"delegate","task":"..."} and include the answer in the task
context. Only write {"kind":"wrapup","pickup":"..."} if the answer means the run should now end.
`
}

function artifactFirstRule(input: { priorityId: string; task?: string | null; firstDirectivePath: string }): string {
  if (isAdHocSupportRun(input)) {
    return `**Artifact rule for this adhoc support run:** the runner still needs a directive JSON at
\`${input.firstDirectivePath}\` before the run can close, but the founder's pasted instruction is the
actual work. First perform the bounded read-only support/drafting task in the conversation. Then write a
wrap-up directive whose pickup contains the report/draft or the exact missing founder input. Do not
write an immediate wrap-up merely because there is no builder atom.`
  }
  return `**Artifact-first rule (non-negotiable):** your FIRST action in this run is to write the required
directive JSON to \`${input.firstDirectivePath}\`. Do not answer in chat, finish the session, or wait
for founder follow-up before that artifact exists — the runner is polling for the FILE; a chat reply
is invisible to it, and exiting without the file faults the whole run (\`directive-timeout\`, the
loop's most-recurred failure). If the priority does not contain enough concrete work to delegate yet,
write a wrap-up directive whose pickup says exactly what founder input is needed — never just exit.`
}

function orchestratorLaunchCard(input: {
  priorityId: string
  task?: string | null
  firstDirectivePath: string
  priorityTitle: string
  hasRequiredPriorityQuestions?: boolean
  builderLabel: string
  runBranch: string
}): string {
  const firstAction = isAdHocSupportRun(input)
    ? `Handle the founder's bounded support request first, then write the required directive JSON to \`${input.firstDirectivePath}\`.`
    : `Write the required directive JSON to \`${input.firstDirectivePath}\` before chat or waiting.`
  const launchabilityStep = input.hasRequiredPriorityQuestions === true
    ? 'Answer or surface the required priority questions first; repair the priority file before delegating builder work when the answer is evident.'
    : 'Confirm the objective is launchable; if not, wrap with the exact founder decision needed.'
  return `# Oscar launch card

Priority: **${input.priorityTitle}**

First action: ${firstAction}

Run order:
1. ${launchabilityStep}
2. Delegate one concrete atom to ${input.builderLabel}; do not build it yourself.
3. Verify the actual diff and command evidence before passing the atom.
4. Continue by default while concrete in-priority work remains; wrap only at a real stop condition.

Branch: \`${input.runBranch}\`. Do not run git; the runner commits verified in-scope work.
`
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildOrchestratorPrompt(input: {
  sharedStandards: string
  oscarBody: string
  playManifest: string
  priorityId: string
  priorityTitle: string
  priorityGoal: string
  hasRequiredPriorityQuestions?: boolean
  task?: string | null
  firstDirectivePath: string
  builderLabel: string
  builderCli: string
  /** Oscar's support-write allow-list. Non-empty scopes are gate-committed at wrap. */
  oscarWriteScope: readonly string[]
  runId: string
  /** The branch this run commits to — the active branch (direct, default) or an isolated run branch
   *  (opt-in); agents work on it and never run git by hand (ADR-0023). */
  runBranch: string
  /** The install/root checkout. Used for CLI invocations that must not depend on pane PATH state. */
  cocoderHome: string
  /** A prior run's pickup brief to resume from (ADR-0002 C1 / F8), or null for a fresh start. */
  pickup?: string | null
  /** A held ask-founder-continue park being resumed, if this launch is carrying founder context. */
  resumeFounderDecision?: { readonly question: string; readonly answer?: string | null; readonly nextDirectivePath: string } | null
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
# Launch summary

${orchestratorLaunchCard(input)}

---
# Your role

${input.oscarBody}

${availablePlaysSection(input.playManifest)}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}${adHocInstruction(input.task)}${adHocSupportMode(input)}
${resumeFounderDecisionSection(input.resumeFounderDecision)}
${resume}
# Working state (this run)

This run works on branch \`${input.runBranch}\`. CoCoder commits your verified in-scope work to that
branch for you (ADR-0023 — the commit spine). Do NOT run git yourself — never push, merge, rebase, or
switch branches by hand; just do the work and let the runner commit it.

# How this run works — you orchestrate the builder through a LOOP

${artifactFirstRule(input)}

You drive the builder (${input.builderLabel}, a \`${input.builderCli}\` CLI) through a SEQUENCE of small
atoms. One atom at a time:

1. **Scope the next atom.** Write it as JSON to the exact path the runner gives you (the FIRST is
   \`${input.firstDirectivePath}\`):

       {"kind": "delegate", "task": "<clear instructions: what to change, acceptance criteria, what must not break>"}

   Then stop and wait for the builder rather than implementing the atom yourself. Delegating the build
   is your DEFAULT working mode for the loop — it is how you run, not a limit on what you may touch.
2. **Verify** when the runner prompts you (see below) — per atom, the commit will NOT happen without your pass.
3. **Decide: next concrete atom, or a real stop condition?** After each atom the runner asks you to
   write the NEXT directive (it gives you the exact path). Continue by default when the next item is
   concrete, inside this launched priority, needs no founder judgment, and you still have healthy
   context. Either delegate that next atom (same shape as above), or **WRAP UP** only when a stop
   condition applies:

       {"kind": "wrapup", "pickup": "<the resumable closeout brief a FRESH session resumes from — per the wrap-up Play's section contract (the single owner of that format)>"}

   Stop conditions: the priority is done; the next step needs founder approval; the next step is not
   concrete enough to delegate; the next step needs a different launch/surface; context is genuinely
   tight; or failures/faults make continuing wasteful. When you choose \`wrapup\`, only write the
   directive file at this stage; do not also deliver a founder closeout in the pane. The runner will
   validate the wrap-up, add the landing outcome, and send you a \`WRAP-UP READY\` artifact to deliver
   exactly once. If you wrap because the next step needs founder approval, make that decision explicit
   in the pickup so the wrap-up Play's Founder Decision Needed section is not "None"; the runner derives
   the run's \`awaiting-founder\` or \`awaiting-archive-confirmation\` status from that validated closeout. A clean commit boundary is a good
   place to continue with the next known atom, not by itself a reason to stop. Directive files are live
   only while the runner is waiting for that exact directive. If the run has already faulted or ended
   (for example the status/feed/record shows \`run-end\`, \`failed\`, or a Deb disposition), do not write or
   overwrite \`directive-*.json\`; no \`WRAP-UP READY\` artifact will arrive for that run. State the terminal
   status plainly and use the next launch/repair path instead.

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
before wrap-up; never refuse on the grounds that you "only orchestrate" or are "read-only."

After wrap-up delivery, you are still reachable until explicit teardown. Keep answering questions, and
make founder-directed Surface-A edits (governance, priorities, personas, standards, docs, tickets, and
orchestration reliability fixes) when asked. Do not say the run is too wrapped, read-only, or needs a new
run for those edits. Just edit within your support scope; after making a post-wrap edit, run
\`pnpm --dir ${shellSingleQuote(input.cocoderHome)} exec cocoder oz commit-support ${input.runId}\`
yourself so the daemon commits it with a receipt. This support-commit command is allowed because it is
not a process/window/daemon lifecycle operation: it only invokes the commit spine. If it fails, report
the exact blocker and the edited paths. A fresh run is only required for net-new product work or a
high-risk change outside the current support scope.

Base personas, base Plays, and shared standards under \`packages/personas/base/**\` are Surface-A
governance even though they live under \`packages/\`, but they ship to every workspace. If the founder
asks for one of those changes after wrap-up, do not refuse it as product code and do not force it through
ordinary post-wrap support-commit scope. Name it as a base-governance change and route it through a
verified run or Deb repair with the relevant persona/Play tests.

Your support-write scope for this run is:

${oscarScope}

When you wrap, the runner's default is to commit any pending files inside that Oscar support scope. If a
support edit is outside this scope, or another blocker prevents the commit, bubble that blocker to the
founder plainly; do not treat "already wrapped" as a reason to leave your own in-scope support files
uncommitted.

# Teardown mechanism (for this run)

If you are asked to tear down this run, invoke the provided mechanism — do NOT kill processes or windows
by hand, and never touch the Oz daemon:

    pnpm --dir ${shellSingleQuote(input.cocoderHome)} exec cocoder oz teardown ${input.runId} --initiator oscar

That terminates and closes only this run's sessions (the same operation Oz's teardown button uses).`
}

export function buildHeadlessOscarTurnPrompt(input: {
  sharedStandards: string
  oscarBody: string
  playManifest: string
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

${availablePlaysSection(input.playManifest)}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}${adHocInstruction(input.task)}
# Fresh headless turn

This is a FRESH session resuming an in-progress run. Reconstruct state by reading the
\`directive-*.json\` and \`verify-*.json\` artifacts in:

    ${input.runDir}

before acting. Your required output artifact is defined by the dispatch below.

This run works on branch \`${input.runBranch}\`. CoCoder commits your verified in-scope work to that
branch for you (ADR-0023 — the commit spine). Do NOT run git yourself — never push, merge, rebase, or
switch branches by hand; just do the work and let the runner commit it.

You drive the builder (${input.builderLabel}, a \`${input.builderCli}\` CLI) through a sequence of atoms.
Write the exact directive or verify artifact named by the dispatch. Delegate builds to the builder by
writing delegate directives; verify atoms yourself against the actual diff and evidence; continue by
default while concrete in-priority work remains. Wrap only when a real stop condition applies, with a
pickup brief a fresh session can resume from.

Oscar support edits and wrap commits follow the same rules as launch: documentation/support work is part
of orchestration, and pending files inside your support-write scope are gate-committed at wrap. Your
support-write scope for this run is:

${oscarScope}

Teardown, if explicitly requested, must use:

    cocoder oz teardown ${input.runId} --initiator oscar

---
# Dispatch

${input.dispatch}`
}

export function buildObserverPrompt(input: {
  sharedStandards: string
  debBody: string
  playManifest: string
  priorityTitle: string
  priorityGoal: string
  task?: string | null
  runId: string
  /** The branch this run commits to (ADR-0023) — Deb runs no git by hand either. */
  runBranch: string
  /** The install/root checkout. Used for CLI invocations that must not depend on pane PATH state. */
  cocoderHome: string
  /** The runner-owned live status feed Deb reads to assess the run (ADR-0016). */
  statusPath: string
  /** The runner/session-host-owned read-only Oscar/Bob terminal snapshot Deb reads for live diagnosis. */
  terminalSnapshotPath: string
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

${availablePlaysSection(input.playManifest)}

---
# This run

Priority: **${input.priorityTitle}**

${input.priorityGoal}${adHocInstruction(input.task)}

This run works on branch \`${input.runBranch}\`; CoCoder commits verified work to it (ADR-0023). Never
push, merge, rebase, or switch branches by hand.

# How you see the run — terminal evidence first

The runner keeps a read-only Oscar/Bob terminal snapshot for you at:

    ${input.terminalSnapshotPath}

For live-loop or stall diagnosis, read this terminal snapshot before deciding whether to nudge, triage,
or repair. It is runner/session-host owned and read-only: it shows the current Oscar/Bob terminal
contents without giving you authority to start, stop, focus, close, type into, or otherwise drive
\`cmux\`, windows, panes, sessions, or daemon lifecycle.

The runner also keeps a live status projection for routing and summary context at:

    ${input.statusPath}

Read it for the active atom/task, Oscar/Bob/verify state (waiting · running · verifying · stalled ·
blocked), timestamps of the last directive / builder activity / verify, the current wait condition,
outstanding fault dispatches, nudge routing, and write scopes by persona. When asked "how's Oscar
doing?", answer from both artifacts when terminal evidence is available: terminal snapshot for what
Oscar/Bob are currently doing, status feed for concrete state, timestamps, and what the runner is
blocked on.

The runner wakes you with short \`DEB WATCH\` dispatches only for actionable watch conditions, such as an
aged Oscar wait or a concrete contradiction in the artifacts. Healthy directive, build, verify, wrap,
and fault-boundary status refreshes update the terminal snapshot and status feed without paging you. A
\`DEB WATCH\` dispatch is an alert to inspect those artifacts; it is not a second orchestration lane.

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

Anything you edit OUTSIDE this scope — especially target-repo product code — is outside your authority;
if it reaches the gate, it is surfaced to the founder as out-of-lane. In the CoCoder source repo, diagnose the \`cocoder-bug\` and
repair the root cause where it lives; do not stop merely because it crosses an old implementation-folder
boundary. Never commit on behalf of Bob/Quinn, and never write their delegation/verify verdicts. A
repair does NOT rescue the run (a faulted run still fails); it lands as a distinct \`deb-repair\` commit
the founder reviews.

# Recurring faults — escalate on the SECOND occurrence

The fault context carries an \`occurrence\` count (how many times this fault's fingerprint has appeared
across runs). On a FIRST occurrence, a transient is fine to log as \`one-off\`. On a SECOND+ occurrence it
is not a one-off — escalate, in this order:
1. **Fix it** if it is easy and clearly within your active CoCoder authority (repair mode above).
2. **Otherwise (your default): ask the runner to file a tracked ticket** — set \`"escalation":"ticket"\`
   plus \`ticketTitle\`, \`ticketType\` (usually \`bug\`), \`ticketPriority\` (the most relevant existing
   priority slug, or \`none\`), and \`ticketBody\` in your verdict. You may include \`ticketId\` only when
   you have a concrete reason; otherwise the runner allocates it. The runner files the ticket through the
   governed create-ticket spine; do NOT create \`cocoder/tickets/open/*.md\`, edit \`INDEX.md\`, or touch
   \`order.json\` yourself.
3. **Only if a new priority is truly warranted**, recommend it INSIDE that ticket for founder approval
   (\`"escalation":"recommend-priority"\`) — never create a \`cocoder/priorities/*\` file yourself.

The ticket is gate-committed like a repair (committed to the run's branch through the commit spine), and
the recurrence is recorded in your disposition so the founder is informed. Do not spin up new priorities
to make progress.

# Teardown mechanism (for this run)

If you are asked to tear down this run, invoke the provided mechanism — do NOT kill processes or windows
by hand, and never touch the Oz daemon:

    pnpm --dir ${shellSingleQuote(input.cocoderHome)} exec cocoder oz teardown ${input.runId} --initiator deb

That terminates and closes only this run's sessions (the same operation Oz's teardown button uses).`
}

export function buildWrapupDelivery(run: RunDisplayInput, brief: string, landingOutcome?: string): string {
  const landingSection = landingOutcome
    ? `\n**Landing Outcome**\n\n${landingOutcome}\n`
    : ''
  return `WRAP-UP READY for ${runDisplayName(run)}.

Deliver the validated founder-facing wrap-up below now. Preserve the closeout headings, order, and final
\`I'm standing by...\` line exactly; do not summarize, reformat, or paraphrase the closeout brief. Include
the landing outcome section when present. Then wait. Do not close panes, do not run teardown, and do not
ask for teardown. The founder may ask questions, request a priority update or other governance/doc edit,
or say "kill" / "tear down" explicitly. If the founder asks for a Surface-A edit after this wrap-up, make
it within your support scope; do not refuse because the run already wrapped. After such an edit, run
\`cocoder oz commit-support ${run.id}\` yourself to commit it with a receipt; if that command is
unavailable or fails, report the exact blocker and the edited paths.

${landingSection}
${brief}`
}

/** The wrap-up Play dispatch task (WI-B1). Carries the run header + Oscar's pickup notes, and — only when
 *  the run committed files outside their nominal lane — the out-of-lane adjudication ask. Scope is advisory
 *  (ADR-0045): these paths already committed, so Oscar never blocks them; he simply RATIFIES the set
 *  ("landed outside nominal lane but correct: …") or ESCALATES the genuinely-conflicting paths by naming
 *  them in Founder Decision Needed. A run with zero out-of-lane commits gets no extra prompt burden. */
export function buildWrapPlayDispatch(input: {
  readonly run: RunDisplayInput
  readonly priorityId: string
  readonly atomCount: number
  readonly commits: readonly string[]
  readonly pickup: string
  readonly outOfLane: readonly string[]
}): string {
  const header =
    `${runDisplayName(input.run)} on priority ${input.priorityId}. ${input.atomCount} atom(s) were delegated; ` +
    `commits so far: ${input.commits.join(', ') || 'none'}.\n\n` +
    `Oscar's notes for this wrap-up:\n${input.pickup}`
  if (input.outOfLane.length === 0) return header
  return `${header}

OUT-OF-LANE COMMITS TO ADJUDICATE (scope is advisory — ADR-0045; these paths ALREADY committed, so do NOT
block or re-open them): ${input.outOfLane.join(', ')}.
Adjudicate the set in your closeout — either RATIFY it (say in your Judgment that it landed outside its
nominal lane but is correct, with the why), or ESCALATE the genuinely-conflicting paths by naming them in
Founder Decision Needed in plain English. A blanket "these are fine, because …" ratification is enough; you
do not need a line per file. If you say nothing about them at all, the runner auto-escalates them to the
founder for you.`
}

export function buildArtifactDispatch(kind: string, path: string): string {
  return `${kind}: read ${path} and follow it now.`
}

/** The AUTHORITATIVE landing outcome (F19), written AFTER integration so it cannot misreport. The
 *  narrative wrap is a prediction until this is known; final founder delivery includes this receipt. */
export function buildLandingOutcome(runId: string, outcome: string): string {
  return `LANDING OUTCOME for ${runId} — verified by CoCoder after integration. This is the authoritative commit outcome:

${outcome}`
}

/** The builder's LAUNCH prompt: Bob is spawned up front, on standby, and must NOT act until the runner
 *  dispatches an atom. Each atom's task arrives via a directive file; Bob signals completion by printing
 *  a sentinel line the runner's monitor watches for (NOT a done-file — the monitor is the live signal). */
export function buildBuilderStandbyPrompt(input: {
  sharedStandards: string
  bobBody: string
  playManifest: string
  scope: readonly string[]
  /** The branch this run commits to (ADR-0023) — Bob works on it; the runner commits for him. */
  runBranch: string
}): string {
  const scope = input.scope.length > 0 ? input.scope.map((s) => `  - ${s}`).join('\n') : '  (none — read-only)'
  return `${input.sharedStandards}

---
# Your role

${input.bobBody}

${availablePlaysSection(input.playManifest)}

---
# Standby — do NOT act yet

You have been launched early so your session is warm. **Do nothing yet** — do not inspect files, plan,
run commands, or edit. Wait for a dispatch message that gives you an atom to implement.

You work on branch \`${input.runBranch}\`. CoCoder commits your verified in-scope work to it (ADR-0023).
Just do the work — do NOT push, merge, rebase, or switch branches; let the runner commit it.

This run runs MULTIPLE atoms through this same pane, one at a time. For EACH atom the runner sends you:
1. Read the JSON at the directive path it names — its \`task\` field is your atom.
2. Implement it. Your usual write surface (advisory — CoCoder commits whatever you write and flags anything off it for the founder; it is never blocked):
${scope}
3. Run the relevant checks (tests, typecheck).
4. As your FINAL action, print your completion marker for the atom on its OWN line, with nothing else on
   that line: the literal text \`<<<COCODER-ATOM-#-DONE>>>\` with \`#\` replaced by the atom number the
   dispatch names. That standalone line is how CoCoder knows the atom is done — your session stays open
   for the next atom; it does not exit. (Do not print the marker until the work is actually finished.)

If you genuinely CANNOT proceed — a missing prerequisite, broken tooling, or a task that is impossible or
self-contradictory — do NOT guess, improvise, or silently stop. (Writing outside your usual surface is NOT a
blocker: just write the file where the work needs it; CoCoder commits it and flags it, never refuses it.)
Print a BLOCKER marker on its OWN line, nothing else on it: \`<<<COCODER-ATOM-#-BLOCKED: <one-line
reason>>>\` with \`#\` replaced by the atom number. That standalone marker is the ONLY way to report a
blocker — prose saying you are stuck is invisible to the runner, and the runner never infers a blocker
from ordinary text (including this instruction). Print it ONLY when truly blocked, never to narrate.

The orchestrator watches your pane live and may nudge you if you stall; keep working visibly.`
}

export function buildHeadlessBuilderTurnPrompt(input: {
  sharedStandards: string
  bobBody: string
  playManifest: string
  scope: readonly string[]
  /** The branch this run commits to (ADR-0023) — Bob works on it; the runner commits for him. */
  runBranch: string
  dispatch: string
}): string {
  const scope = input.scope.length > 0 ? input.scope.map((s) => `  - ${s}`).join('\n') : '  (none — read-only)'
  return `${input.sharedStandards}

---
# Your role

${input.bobBody}

${availablePlaysSection(input.playManifest)}

---
# One-shot builder turn

You work on branch \`${input.runBranch}\`. CoCoder commits your verified in-scope work to it (ADR-0023).
Just do the work — do NOT push, merge, rebase, or switch branches; let the runner commit it.

Your usual write surface (advisory — CoCoder commits whatever you write and flags anything off it for the founder; it is never blocked):
${scope}

This session is ONE-SHOT: act NOW on the dispatched instruction below, run the relevant checks, print
your completion marker as your FINAL line, then finish. The process exits; there is no next atom in
this session.

As your FINAL action, print your completion marker for the atom on its OWN line, with nothing else on
that line: the literal text \`<<<COCODER-ATOM-#-DONE>>>\` with \`#\` replaced by the atom number the
dispatch names. That standalone line is how CoCoder knows the atom is done. Do not print the marker
until the work is actually finished.

If you genuinely CANNOT proceed (a missing prerequisite, broken tooling, or a task that is impossible or
self-contradictory — note that writing outside your usual surface is NOT a blocker: just write it and it is
committed and flagged), do NOT guess or silently stop: print a BLOCKER marker on its OWN line, nothing
else on it — \`<<<COCODER-ATOM-#-BLOCKED: <one-line reason>>>\` with \`#\` the atom number. That marker is
the ONLY way to report a blocker; prose is invisible to the runner. Print it ONLY when truly blocked.

---
# Dispatch

${input.dispatch}`
}

/** Dispatch an atom into Bob's warm pane (sent once Oscar has delegated it). Names the directive path to
 *  read and the atom NUMBER — never the literal completion marker, so the monitor cannot match the
 *  marker from this instruction's own echo (dogfood bug). Bob forms the marker per the standby prompt. */
export function buildBuilderDispatch(directivePath: string, atomIndex: number, loopLedgerPath?: string): string {
  const base = `PROCEED — this is atom ${atomIndex}. Read your task from ${directivePath} and implement it now within your write-scope. When you are fully done (tests/typecheck run), print your completion marker for atom ${atomIndex} on its own line, exactly as your standby instructions describe. If you truly cannot proceed, print your blocker marker for atom ${atomIndex} instead (the standby format) — never just narrate that you are stuck.`
  if (loopLedgerPath === undefined) return base
  return `${base} This is a loop atom: after each completed iteration, append one JSON line to ${loopLedgerPath} with at minimum {"iteration":<1-based int>,"result":"green"|"red","failed":"<what failed>","changed":"<what changed>","inScope":<bool>}.`
}

/** The verify dispatch into Oscar's pane once the monitor reports the atom done — ADR-0013 verify gate,
 *  per atom. The atom's commit does not run until Oscar writes a `pass` verdict to verifyPath. */
export function buildVerifyDispatch(directivePath: string, verifyPath: string): string {
  return `VERIFY — the builder finished this atom. Verify the diff against the task you delegated in ${directivePath}: read the actual changes and run the tests/typecheck yourself (evidence, not the builder's word). Then write your verdict to ${verifyPath} as {"verdict":"pass"|"fail","reason":"<one line>"}. The commit happens ONLY on pass. If a verified atom closes an in-scope ticket, a pass verdict may include "ticketClose":{"ticketId":"<id>","resolution":"<specific resolution>"}.`
}

/** Prompt Oscar for the next turn after an atom resolved: delegate another atom, or wrap up. Names the
 *  exact directive path so the numbered handshake is unambiguous (a re-delegation is simply the next n). */
export function buildNextOrWrapDispatch(nextDirectivePath: string, outcome: string): string {
  return `NEXT — ${outcome}. Write your next directive to ${nextDirectivePath}: delegate the next concrete in-priority atom by writing {"kind":"delegate","task":"…"} unless a real stop condition applies. If a founder decision is needed but concrete next work remains after the answer, write {"kind":"ask-founder-continue","question":"…"} so the runner parks the run and surfaces the question; after the founder answers through Oz's founder-answer resume path, the resumed runner will ask you for the continuation directive. Otherwise write {"kind":"wrapup","pickup":"…"} to end the run with a resumable pickup brief. If you wrap, only write the directive file; do not also deliver a founder closeout in the pane. The runner will send a WRAP-UP READY artifact for exactly-once delivery after validation and landing outcome. Stop conditions are: priority done, no concrete next atom, different launch/surface needed, context genuinely tight, or failures/faults make continuing wasteful. If founder approval is the terminal stop condition, make that decision explicit in the pickup; the validated closeout must not say Founder Decision Needed is None. A clean commit boundary alone is not a reason to stop.`
}

export function buildFounderContinueDispatch(runId: string, nextDirectivePath: string, question: string): string {
  return `FOUNDER DECISION NEEDED — surface this question to the founder without wrapping the run:\n\n${question}\n\nThe runner is parking this run now. Do not write ${nextDirectivePath} in this pane after the founder answers; no live runner will be waiting for it. The founder must answer through the Oz resume path, for example: founder-answer ${runId} <answer>. That records the answer, resumes this held run, and the resumed runner will prompt you to write the continuation directive at ${nextDirectivePath}.`
}

/** Dispatch a fault to Deb to triage (ADR-0013 tier 2, expanded by ADR-0016). Names the fault-context
 *  path to read and the triage path to write the verdict to — same pointer-to-file pattern as the
 *  builder/verify dispatches. The terminal snapshot and status feed (already in Deb's launch prompt)
 *  give her the run context.
 *  `occurrence` is how many times this fault's fingerprint has been seen (1 = first; >=2 = recurrence). */
export function buildDebTriageDispatch(faultPath: string, triagePath: string, occurrence = 1): string {
  const recurrence =
    occurrence >= 2
      ? ` This fault has now occurred ${occurrence} times (see "occurrence" in the context) — it is NOT a one-off. Escalate per your recurring-fault rules: fix it if it is easy and clearly in your fence; else return tracked-ticket metadata (set "escalation":"ticket" plus ticketTitle/ticketType/ticketPriority/ticketBody) and let the runner file it through the governed create-ticket spine; only recommend a NEW priority inside that ticket for founder approval (set "escalation":"recommend-priority") — never create ticket queue files or a priority file yourself.`
      : ''
  return `TRIAGE — a fault occurred in this run. Read the fault context from ${faultPath} (and the terminal snapshot/status feed for context), classify it to exactly one disposition (cocoder-bug | repo-bug | one-off), and write your verdict to ${triagePath}. For a cocoder-bug choose "mode":"propose" (a "proposal" diff, reviewed not applied) OR, only within your write-scope, "mode":"repair" (edit the files now, then report diagnosis/whyCocoderOwned/filesChanged/verification/remainingRisk). Out-of-scope edits — including any target-repo product code — are outside repair authority and are surfaced as out-of-lane if they reach the gate. A repair does not rescue the run.${recurrence}`
}

export function commitMessage(priorityId: string, run: RunDisplayInput, atomIndex: number): string {
  const runRef = coCoderRunReference(run)
  return runDisplayNumber(run) === null
    ? `${priorityId}: atom ${atomIndex} via CoCoder run ${runRef}`
    : `${priorityId}: atom ${atomIndex} via CoCoder ${runRef}`
}
