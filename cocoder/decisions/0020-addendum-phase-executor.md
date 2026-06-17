# ADR-0020 Addendum — Playbook phase executor for P1→P5 onboarding runs

**Status:** Proposed implementation addendum (2026-06-16). This does not change ADR-0020's accepted
product decision; it specifies the runner/daemon design needed to execute the shipped Playbooks.
**Extends:** [0020](./0020-primary-root-audit.md).
**Builds on:** [0005](./0005-personas-and-subtasks.md) (Plays), [0013](./0013-orchestration-observation.md)
(the directive/verify loop and run observation), [0018](./0018-persona-run-mode-and-sub-agents.md)
(sub-agents are per-persona Play assignments), [0023](./0023-workspace-commit-spine.md) (one commit
spine), [0025](./0025-atomic-authoring-plays.md) (headless authoring Play + spine harness).

## Context

ADR-0020 accepted three install-shipped onboarding Playbooks under
`packages/personas/base/playbooks/`: `new-primary.md`, `cocoder-takeover.md`, and `drift-audit.md`.
The current code has only the foundation:

- `packages/core/src/playbooks/loader.ts` loads Playbook metadata (`id`, `title`, `mode`, `writeScope`,
  `modelPin`, `objective`) for the daemon.
- `packages/daemon/src/priority-order.ts` exposes those summaries beside ordinary priorities.
- `packages/core/src/plays/dispatch.ts` runs one Play invocation, headless or interactive, through the
  adapter/session-host abstraction.
- `packages/core/src/runner/runner.ts` runs the ordinary Oscar↔Bob loop: wait for
  `directive-<n>.json`, dispatch Bob, monitor the completion marker, ask Oscar to write
  `verify-<n>.json`, then commit on pass.
- `packages/daemon/src/launcher.ts` hard-wires only the ordinary run path and the wrap-up Play; its
  `requestAuthoringPlay` path already proves the shape for one headless agent turn followed by a spine
  commit.
- `packages/personas/base/plays/deep-read.md` is the P2 read unit: read-only, one subsystem per
  invocation, structured `axis`/`claim`/`evidence`/`confidence` findings, explicit coverage gaps.

What is missing is the Playbook phase machine: no current module can run P1 recon, pause for founder
approval, fan out P2 deep-read invocations, cross-check them, synthesize `cocoder/**`, pause for
ratification, then resume.

## Decision

Add a Playbook executor as a new runner mode, not a second runner contract.

The executor is a deterministic phase supervisor that reuses the existing primitives:

- **Ordinary atom mechanics:** P1/P3/P4 phases that need a builder turn use the same runner-owned
  work-item, monitor, verification, and commit primitives as the existing directive loop. The current
  Oscar-authored `Directive` remains the ordinary priority contract; Playbook phases produce typed
  phase steps that are lowered into the same internal "run one agent step" primitive.
- **Play/sub-agent mechanics:** P2 uses `dispatchPlay` with the existing `deep-read` Play once per
  subsystem. No new sub-agent schema is added; the invoked `{cli, model}` comes from ADR-0018
  per-persona Play assignment resolution.
- **Commit mechanics:** Any phase that writes `cocoder/**` commits through the ADR-0023 spine:
  `runCommitGate` for in-run verified phase work and the same `gateCommitRepair`/`commitScoped` spine
  used by `requestAuthoringPlay` for one-turn headless authoring. No phase calls `git commit`.
- **Operational record:** phase progress is stored as run events plus run-dir artifacts. The store
  remains the durable ledger; the run dir holds large phase payloads.

This is an extension of `packages/core/src/runner/runner.ts`, `packages/core/src/plays/dispatch.ts`,
and `packages/daemon/src/launcher.ts`, not a parallel cmux loop or a second dispatch protocol.

## Phase Model

`loadOnboardingPlaybooks()` should grow from "summary only" to "executable metadata":

```ts
type PlaybookPhaseKind =
  | 'scaffold'
  | 'intake'
  | 'recon'
  | 'founder-gate'
  | 'deep-read-fanout'
  | 'cross-check'
  | 'synthesize'
  | 'ratify'
  | 'prove'
  | 'drift-read-claims'
  | 'drift-read-reality'
  | 'drift-compare'
  | 'drift-report'
  | 'drift-apply'

interface OnboardingPlaybookPhase {
  readonly id: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6'
  readonly title: string
  readonly kind: PlaybookPhaseKind
  readonly founderGate: boolean
  readonly output: string
}
```

The source of truth stays the Playbook markdown files. The loader parses the `## The baked Playbook`
table and maps the known phase titles to the `kind` enum. If a shipped Playbook row cannot be mapped,
the loader refuses that Playbook instead of guessing. Tests in `packages/core/tests/playbooks.test.ts`
pin the exact phase lists for all three shipped skeletons.

Takeover does not add a separate intake phase. The shipped Takeover table is fixed as P0 Scaffold, P1
Recon, P2 deep read, P3 cross-check, P4 Synthesize, P5 Ratify, P6 Prove; its intent capture is folded
into P1 Recon and confirmed at the existing P1 founder gate. The `intake` phase kind remains for the
shipped New Primary Playbook, which already has a P1 intake conversation because there is no existing
codebase to audit. Drift does not get an intake beat.

Runtime state lives in:

- `local/runs/<runId>/playbook-state.json` — current phase, gate id, artifact paths, subsystem ids,
  P2 convergence state, and resume token.
- `local/runs/<runId>/playbook/<phase-id>/...` — phase artifacts such as `inventory.json`,
  `subsystems.json`, `intent.json`, `estimate.json`, `findings/<subsystem>.md`,
  `convergence/<subsystem>.json`, `cross-check.md`, `drafts/`, and `ratification.json`.
- `RunEvent` rows — `playbook-phase-start`, `playbook-phase-complete`, `playbook-founder-gate`,
  `playbook-resume`, `playbook-fanout-dispatch`, `playbook-fanout-result`, and
  `playbook-phase-commit`.

The event names are projections; `playbook-state.json` is the restart cursor. The executor can rebuild
UI status from events, but it resumes from the state artifact so a daemon restart does not require
screen scraping.

## P1 Recon And Subsystem Enumeration

P1 Takeover recon produces `playbook/P1/inventory.json`, `playbook/P1/subsystems.json`,
`playbook/P1/intent.json`, and `playbook/P1/estimate.json`.

The recon has two layers:

1. **Deterministic inventory helper** in `packages/core/src/playbooks/recon.ts`:
   read package manifests, lockfiles, workspace files, source roots, test roots, app entry points,
   build/test scripts, and file counts. It also records cheap complexity signals: file and approximate
   LOC counts per proposed path group, monorepo package count, dependency fan-out from manifests,
   language and framework indicators, whether each subsystem has a known test or validation command, and
   high-risk surface hints that can be detected mechanically such as migrations, auth, payments,
   deployment, persistence, generated outputs, and public API entry points. It should use structured
   parsers where available (`package.json`, workspace manifests) and `rg --files` style file enumeration
   for the rest.
2. **Agent recon pass** lowered through the existing runner step primitive:
   given the deterministic inventory, produce a human-readable map, propose subsystem boundaries, and
   add judgment-based complexity signals: cross-subsystem coupling, unclear ownership, stack
   heterogeneity not obvious from manifests, missing or weak validation, unusually broad entry points,
   and high-risk surfaces that need deeper audit attention.

P1 also captures Takeover intent so authored governance reflects where the repo is going, not only what
the current code is. This is a beat inside P1 Recon, not a new Takeover phase. It has two input classes:

- **Purpose from artifacts:** mechanically enumerate and agentically summarize README files, docs,
  changelog or release notes, package metadata, issue tracker material if reachable through existing
  repo configuration, recent commit themes, release tags, and branch names. These inputs produce
  inferred-purpose claims only when they cite provenance such as file paths, commit hashes, tag names,
  or issue identifiers.
- **Founder-stated intent:** at the existing P1 founder gate, ask a short bounded interview alongside
  subsystem-map and spend approval: what the project is for, where it is going, what must not change,
  and the near-term milestones or launch constraints. These answers are founder assertions, not inferred
  repo facts.

Subsystems are the smallest reviewable areas that make sense for one context window. P1 must include:

- stable `id` for artifact filenames;
- display name;
- path globs;
- entry points;
- tests or validation commands if known;
- reason the boundary exists;
- known adjacency reads allowed for P2.

P1 turns the recon signals into a complexity-scaled audit plan. The plan assigns each subsystem a
complexity tier (`small`, `standard`, `large`, or `high-risk`) and maps that tier to a P2 allocation:
target iterations, projected wall-clock, and token budget for that subsystem. Larger or riskier
subsystems receive more allocation, but scaling only moves toward the existing P2 ceilings: max 4
iterations, 45 minutes, and 250k captured model tokens per subsystem loop. The "remaining P2 budget
allocation for that subsystem" consumed by P2 is this approved per-subsystem allocation minus captured
P2 spend already recorded for that subsystem.

The same plan allocates P3 review depth from the approved P2 total: expected P3 rounds, wall-clock, and
token budget based on subsystem count, unresolved P2 risk, cross-subsystem coupling, and the number of
named entry points/tests to check. Scaling only moves toward the existing P3 ceilings: max 3 rounds, 30
minutes, and 125k captured model tokens for the P3 loop. The "remaining P3 budget allocation" consumed
by P3 is this approved P3 allocation minus captured P3 spend.

P1 accumulates artifacts on disk:

- `playbook/P1/intent.json` is the machine-readable intent record: captured purpose inferred from
  artifacts, founder-stated direction and milestones, must-not-change constraints, open intent
  questions, and provenance for every item. The record separates `inferredFromArtifacts` from
  `founderAsserted` so P4 cannot launder a guess into a founder decision.
- `playbook/P1/estimate.json` is the machine-readable estimate and approved-plan candidate:
  complexity signals by subsystem, selected complexity tier by subsystem, P2 allocation by subsystem,
  P3 allocation, projected token cost and projected wall-clock per phase and per subsystem, assumptions
  used for model tier and `{cli, model}` from `modelPin`, iteration and round caps, subsystem count,
  low/expected/high token and time bands, projected dollar cost when pricing is derivable from the
  resolved model assignment, and a `multiDay: true | false` signal when the high band crosses a working
  day or the expected plan requires staged execution.
- `pickup.md` includes a human-readable estimate summary for the gate: subsystem count, expected and
  high-band time/cost, the depth tier implied by the plan, the assumptions behind any dollar figure, the
  multi-day signal when present, the short founder intent interview, and the concrete spend decision
  needed to resume.

Estimate bands are honest uncertainty, not guarantees. Post-hoc P2 cap/spend data recorded in
`playbook/P2/convergence/<subsystem-id>.json` can refine future estimates, but the current run is
bounded by the founder-approved allocation and the hard phase caps.

P1 must not spend P2 money. It samples enough to define boundaries, command inventory, inferred purpose,
complexity signals, and the spend plan, then pauses. The P1 founder gate approves or edits
`subsystems.json`, completes or confirms `intent.json`, and approves the spend decision from
`estimate.json` before P2 fan-out begins. Drift and New Primary can use the same estimate shape with
lighter inputs and a lighter or optional spend gate; Takeover always requires the explicit P1 spend
decision. New Primary keeps its existing intake conversation as the primary source of intent, and Drift
does not add founder intent intake because it audits existing governance against reality.

## Founder Gate Interleave

Founder gates are phase boundaries, never loop bodies.

At a gate, the executor:

1. writes `playbook-state.json` with `status: "awaiting-founder"` and the current gate id;
2. writes a concise `pickup.md` that names the gate, summarizes the artifact to review, and states the
   single resume action;
3. records `playbook-founder-gate`;
4. ends the live run without leaving an agent pane responsible for waiting.

The daemon resumes the same Playbook through an explicit resume request carrying the prior run id and
gate approval payload. The current `/runs` resume path already passes `resumeFromRunId` into
`buildRunInput`; the Playbook path should reuse that idea but add a typed gate payload so P1 approval
and P5 ratification cannot be confused with ordinary free-text pickup.

Required gates:

- **Takeover P1 gate:** founder approves or edits the subsystem map, answers or confirms the bounded
  intent interview, and makes an explicit spend decision over `estimate.json`. The gate presents
  `subsystems.json`, `intent.json`, and `estimate.json`, with the intent questions and estimate summary
  in `pickup.md`. The typed resume payload must carry the approved subsystem map revision, founder
  intent answers or confirmations with provenance marked as founder asserted, and one spend decision:
  approve the plan and spend as-is, edit scope by dropping or merging subsystems to reduce cost, or
  choose a shallower depth tier that lowers allocations beneath the hard caps. The executor records the
  approved intent record and allocation in `playbook-state.json` and does not dispatch any P2 deep-read
  job until this gate resumes with subsystem-map approval, intent confirmation, and spend approval.
- **Takeover P5 gate:** founder ratifies each drafted Objective. The executor does not mark candidate
  priorities runnable, and does not launch P6, until this gate resumes with ratified Objectives.
- **Drift P5 gate:** founder selects which amendments/tickets to apply. P1-P4 remain propose-only.

New Primary's intake/ratify gates can use the same gate mechanism with lighter artifacts.

## P2 Fan-Out

P2 Takeover dispatches one bounded `deep-read` loop per subsystem in the founder-approved
`subsystems.json`. The executor may run subsystem loops concurrently, but each loop owns exactly one
subsystem context and never mixes cross-subsystem review into P2.

The per-iteration invocation contract is:

- play definition: `packages/personas/base/plays/deep-read.md`;
- dispatch primitive: `dispatchPlay()` in `packages/core/src/plays/dispatch.ts`;
- output path: `playbook/P2/findings/<subsystem-id>.md`;
- task text: subsystem id, path globs, entry points, tests or validation commands from P1, allowed
  adjacency reads, the iteration number, the prior theory and residual gap list if any, and the fixed
  output contract from the Play;
- mode: headless captured subprocess;
- write scope: empty/read-only.

Each subsystem loop is hypothesis-driven:

1. form or refine an explicit theory of the subsystem: purpose, key behaviors, data/control flow, and
   risk surface;
2. verify that theory against the actual code using the existing `axis`/`claim`/`evidence`/`confidence`
   finding shape, where evidence cites concrete files, lines, symbols, commands, or
   `evidence: UNVERIFIED`;
3. emit the residual gap list: open questions, surprises, low-confidence claims, contradictions, and
   entry points or validation commands not yet covered by verified claims;
4. decide whether the subsystem has converged or needs another read.

The loop keeps reading until the subsystem is understood or a hard cap trips. "Understood" is not an
agent feeling; it is this executor-checkable predicate:

- the latest iteration added no new material claim compared with the prior iteration's theory, where
  material means a claim that changes purpose, key behavior, data/control flow, risk surface, or
  coverage status;
- the latest residual gap list contains no open gap with confidence below `high` or severity
  `material`;
- every P1-named entry point and every P1-named test or validation command for the subsystem is covered
  by at least one verified claim where `evidence != UNVERIFIED`;
- the final findings contain no unresolved contradiction between verified claims inside the subsystem.

This predicate is honest because it depends on positive coverage and preserved gaps, not on silence. An
agent cannot pass by omitting gaps: uncovered P1 entry points or validation commands fail the coverage
clause, unresolved contradictions fail the contradiction clause, and a final iteration that newly
changes the theory fails the no-new-material-claim clause.

Caps are spend controls, not quality signals:

- max iterations per subsystem: 4;
- wall-clock cap per subsystem loop: 45 minutes;
- cost/token cap per subsystem loop: the smaller of 250k captured model tokens or the run's remaining
  P2 budget allocation for that subsystem.

If any cap trips before convergence, the executor records that subsystem as `understood: false`, keeps
the latest findings and residual gaps, records which cap tripped, and continues or completes P2 only as
"read attempted with unresolved gaps." It never silently passes the subsystem as complete. P3 must
surface those residual gaps in `cross-check.md`, and the founder-facing P5 package must preserve any
material unresolved gap instead of burying it in run logs. The per-subsystem cap data is also recorded
so later P1 estimates can use actual P2 spend as calibration evidence.

P2 accumulates artifacts on disk:

- `playbook/P2/findings/<subsystem-id>.md` is the rolling human-readable finding file. Each iteration
  appends or replaces a clearly marked iteration section containing the theory, verified claims, residual
  gaps, and read-more/converged decision.
- `playbook/P2/convergence/<subsystem-id>.json` is the machine-readable convergence record:
  `iterationsRun`, the hypotheses/theories tried, what each iteration closed, final predicate clause
  results, `understood: true | false`, cap status, assignment `{cli, model}` history, output paths, and
  the final residual gap list.

Each subsystem completion records `playbook-fanout-result` with exit code, output path, subsystem id,
assignment `{cli, model}`, iteration count, `understood`, cap status, and whether the result contains
unverified findings.

ADR-0018 is honored by resolving a per-persona Play assignment for `deep-read`; no `subAgents` field is
introduced. For a brand-new root that has only template assignments, the implementation needs a shipped
top-tier default for Playbook `modelPin: top-tier`, with workspace overrides still coming from
`cocoder/personas/assignments.json`.

Build-time follow-up: the `deep-read` Play contract will need a matching iteration input/output clause
when the executor is implemented; this addendum intentionally does not edit the base Play now.

## P3 Cross-Check

P3 consumes all P2 findings plus P1 `subsystems.json` and emits `playbook/P3/cross-check.md`. It is a
convergence-based reviewer loop over the P2 record, not another repo read from scratch.

Each round cross-checks the complete P2 set:

- verify every subsystem claimed by P1 has a P2 finding file;
- flag every finding with `evidence: UNVERIFIED`;
- detect contradictory claims across subsystems using the same `axis`/`claim`/`evidence`/`confidence`
  finding shape from P2;
- detect missing coverage for every P1-named entry point and every P1-named test or validation command;
- carry forward prior contradictions and coverage gaps until they are explicitly resolved or preserved
  as unresolved.

The loop keeps running rounds until the cross-check has converged or a hard cap trips. "Cross-checked"
is not a reviewer feeling; it is this executor-checkable predicate for the latest round:

- no new contradiction was found compared with the prior round;
- no new coverage gap was found compared with the prior round;
- every contradiction or coverage gap raised in any prior round is now either resolved with cited
  evidence where `evidence != UNVERIFIED`, or explicitly carried as an unresolved item with severity and
  confidence;
- every P1-named subsystem, entry point, test, and validation command is represented in the current
  cross-check state as verified, unresolved, or blocked by a named missing artifact.

This predicate is honest because it depends on positive coverage and preserved unresolved items, not on
silence. A round cannot pass by omission: an absent P2 finding file fails the subsystem clause, an
unmentioned P1 entry point or validation command fails the coverage clause, a newly discovered conflict
fails the no-new-contradiction clause, and a prior contradiction or gap remains open unless the record
either cites resolving evidence or carries it forward with severity and confidence.

P3 may dispatch targeted follow-up reads between rounds. Each follow-up uses `dispatchPlay()` with
`packages/personas/base/plays/deep-read.md`, mode `headless captured subprocess`, empty/read-only write
scope, and a task naming one concrete subsystem id plus one concrete question raised by the current
round. A P3 round may dispatch at most 3 follow-up reads, and only for named contradictions or coverage
gaps in `playbook/P3/cross-check.md`. The follow-up results are appended to the P3 record and become
inputs to the next round's cross-check; they do not close anything until the next round applies the
predicate. These reads are P3-owned and bounded; they are not a founder gate and not an open-ended loop.

Caps are spend controls, not quality signals:

- max rounds: 3;
- wall-clock cap for the P3 loop: 30 minutes;
- cost/token cap for the P3 loop: the smaller of 125k captured model tokens or the run's remaining P3
  budget allocation.

P3 uses fewer rounds and a smaller budget than P2 because it reviews already-produced findings and
dispatches only named follow-up reads, instead of independently reading every subsystem to convergence.

If any cap trips before convergence, the executor records `converged: false`, keeps the latest
cross-check state, records which cap tripped, and preserves every unresolved contradiction and coverage
gap. It never silently marks P3 clean. Material unresolved items must be carried into the
founder-facing P5 package instead of being buried in run logs, matching the P2 to P3 to P5
gap-preservation chain.

P3 accumulates artifacts on disk:

- `playbook/P3/cross-check.md` is the rolling human-readable output. Each round updates a verified
  findings section and a blocked/uncertain section, with unresolved contradictions, missing coverage,
  unverified evidence, and follow-up reads named explicitly.
- `playbook/P3/convergence.json` is the machine-readable convergence record: `roundsRun`,
  contradictions found and closed per round, coverage gaps found and closed per round, final predicate
  clause results, `converged: true | false`, cap status, follow-up reads dispatched with their
  `{cli, model}` assignment, output paths, and the final unresolved-items list with severity and
  confidence.

## P4 Synthesis Into `cocoder/**`

P4 writes only the target primary root's `cocoder/**`, using the verified P3 findings and
`playbook/P1/intent.json` as inputs. Intent shapes which Objectives are worth drafting; verified P3
reality keeps those Objectives honest. P4 must not turn inferred purpose into founder intent unless the
intent record marks it as founder asserted or confirmed.

Takeover P4 drafts:

- `cocoder/memory/**` codebase map and tech stack;
- architecture notes where the target template has a home for them;
- candidate priorities with draft Objectives that reflect founder-stated direction, repo purpose,
  must-not-change constraints, and near-term milestones, grounded in verified P3 findings;
- persona deltas when repo-specific behavior is necessary;
- standards extensions when repo-specific standards are necessary.

Drift P4 is different by structure: it writes only report artifacts and amendment/ticket drafts. It
must not rewrite live governance until Drift P6 apply.

P4 uses the same spine as current governance authoring:

- if implemented as a builder atom, it uses the factored runner step and `runCommitGate`;
- if implemented as one or more headless authoring Plays, it uses the `requestAuthoringPlay` pattern in
  `packages/daemon/src/launcher.ts` and commits through `gateCommitRepair`/`commitScoped`;
- either way, the commit receipt is the ADR-0023 receipt: branch, SHA, changed files, out-of-lane flags,
  and verification evidence.

P4 must leave draft Objectives visibly draft until P5. The "nothing runnable until ratified" rule is a
data rule: candidate priorities need a draft marker or separate draft location that launch code refuses.
Do not rely on prose warnings.

## P5 Ratification

P5 presents the drafted Objectives and any Drift amendment selection to the founder as a gate artifact.
On resume:

- Takeover: apply founder edits to the draft priority Objectives, remove the draft marker, and commit the
  ratified `cocoder/**` changes through the spine.
- Drift: apply only the selected amendments/tickets, then commit through the spine.
- New Primary: ratify the minimal starter Objective(s), then allow P4 prove.

The executor should not ask the founder inside P2 fan-out or while an agent is still running. P5 is a
single checkpoint after synthesis.

## Reused Vs Net-New

Reused:

- `loadOnboardingPlaybooks()` as the loader entry point.
- `dispatchPlay()` as the only Play/sub-agent dispatcher.
- `deep-read` as the P2 unit.
- `resolvePlayAssignment()` / `assignments.json` as the Play assignment model.
- `runCommitGate`, `gateCommitRepair`, `commitScoped`, and `commitFiles` as the commit spine.
- `RunStore` events, work items, commit links, and run records for durable receipts.
- Existing daemon launch/resume shape around `launchRun()` and `buildRunInput()`.

Net-new:

- executable phase metadata in the Playbook loader;
- `playbook-state.json` cursor and phase artifact layout;
- a Playbook runner mode/facade that lowers phases into existing runner steps and Play dispatch;
- recon subsystem enumeration helper;
- founder gate status/projection and typed gate resume payload;
- P2 fan-out coordinator over `dispatchPlay`;
- P3 cross-check prompt/Play;
- P4 synthesis and P5 ratification mechanics that keep draft Objectives non-runnable until approved;
- UI/API affordances to launch a Playbook separately from a priority and resume a gate.

## Ordered Implementation Atoms

1. **Phase metadata loader.**
   Files: `packages/core/src/playbooks/loader.ts`, `packages/core/src/playbooks/index.ts`,
   `packages/core/tests/playbooks.test.ts`.
   Exit: the three shipped Playbooks expose ordered executable phases; malformed phase tables are
   rejected; current onboarding summaries still render unchanged.

2. **Run target and daemon launch surface.**
   Files: `packages/core/src/store/types.ts`, `packages/core/src/store/schema.ts`,
   `packages/daemon/src/routes.ts`, `packages/daemon/src/launcher.ts`,
   `packages/daemon/src/priority-order.ts`, relevant UI store/API files.
   Exit: Oz can launch `playbookId` distinctly from `priorityId`; ordinary priority runs are unchanged;
   run receipts identify whether the target was a priority or Playbook.

3. **Runner primitive extraction.**
   Files: `packages/core/src/runner/runner.ts` plus a small helper under `packages/core/src/runner/`.
   Exit: the existing Oscar↔Bob loop passes unchanged tests while sharing an internal "run one agent
   step, verify, commit" primitive that Playbook phases can call.

4. **Playbook state and gate cursor.**
   Files: `packages/core/src/playbooks/executor.ts`, `packages/core/src/store/types.ts`,
   `packages/core/src/runner/status.ts`, daemon run-list/status projection tests.
   Exit: a synthetic Playbook run can start P1, write `playbook-state.json`, pause at an
   `awaiting-founder` gate, and resume from the saved cursor after process restart.

5. **P1 recon subsystem enumeration.**
   Files: `packages/core/src/playbooks/recon.ts`, `packages/core/tests/playbook-recon.test.ts`,
   executor tests.
   Exit: Takeover P1 writes deterministic inventory plus `subsystems.json`; the P1 founder gate points
   at that artifact; no P2 dispatch occurs before approval.

6. **P2 deep-read fan-out.**
   Files: `packages/core/src/playbooks/executor.ts`, `packages/core/src/plays/dispatch.ts` tests as
   needed, template or assignment defaults for `deep-read`.
   Exit: approved subsystems dispatch one bounded, hypothesis-driven headless `deep-read` loop each,
   write rolling findings plus convergence records under the run dir, record assignment/model and
   iteration/cap evidence, emit `understood: true | false`, preserve residual gaps on non-convergence,
   and fail clearly on missing top-tier assignment.

7. **P3 cross-check.**
   Files: new base Play or executor prompt under `packages/personas/base/plays/`, executor tests.
   Exit: P3 consumes P2 findings, emits `cross-check.md`, flags unverified/contradictory/missing coverage,
   and can schedule only bounded named follow-up reads.

8. **P4 synthesis and draft priority safety.**
   Files: executor, authoring Play/harness reuse in `packages/daemon/src/launcher.ts`, priority loader if
   a draft marker is added, tests.
   Exit: P4 writes only `cocoder/**`, commits through the spine, and any candidate priority remains
   non-runnable until P5 ratification.

9. **P5 ratification and Drift apply.**
   Files: daemon gate resume route, executor, priority loader/draft marker tests, Drift tests.
   Exit: founder-approved Objectives become runnable and commit; Drift applies only selected
   amendments/tickets; unselected drafts remain reports, not live governance.

10. **End-to-end proof harnesses.**
    Files: `scripts/proof-*` as appropriate plus daemon/core integration tests.
    Exit: a fixture Takeover run exercises P1 gate → P2 fan-out → P3 → P4 → P5 gate without real CLIs
    via fakes; ordinary `pnpm typecheck`, package tests, and `node scripts/check-topology.mjs` stay green.

## Founder Ratification Required

ADR-0020 already ratified the product structure. This addendum leaves one implementation policy for the
founder before live proof:

- **Top-tier default for P2/P3:** choose the shipped `{cli, model}` fallback for `modelPin: top-tier`
  when a brand-new target has not yet overridden `deep-read` in `assignments.json`. This is a cost and
  quality judgment, so the code should support overrides but the default should be founder-approved.

During each Playbook run, the founder gates are mandatory runtime decisions:

- approve/edit P1 subsystem map before P2 fan-out;
- ratify P5 Objectives before candidate priorities become runnable;
- for Drift, select P5 amendments/tickets before P6 apply.

No founder decision is needed to add the executor scaffolding itself if this addendum is accepted.
