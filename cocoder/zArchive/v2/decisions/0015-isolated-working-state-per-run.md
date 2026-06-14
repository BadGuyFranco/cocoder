# ADR-0015 — Isolated working state per run (worktree + branch), auto-merge on verified green

> **SUPERSEDED by [ADR-0023](../../../decisions/0023-workspace-commit-spine.md) (2026-06-14).** This ADR made an
> isolated worktree + run branch the **default** for every run — the run branch that became "the seam
> every strand crosses" (F14/F17/F19/F20). ADR-0023 flips the default to direct-to-active-branch and
> keeps the worktree as an **opt-in sandbox** for risky/large/parallel work. The verified-merge,
> integration-verify, merge-conflict, and worktree-GC machinery below survive **only** behind that
> opt-in flag. Kept as history; do not read its default-isolation framing as live.

**Status:** Superseded by ADR-0023 (was: Accepted, founder + Claude, 2026-05-31; drafted → adversarially reviewed → revised per founder decisions: verified-merge + build the merge-conflict Play)
**Seam:** run lifecycle / git integration
**Charter:** [0001](./0001-rebuild-charter.md) (D1 dogfood-earned · D3 probabilistic-for-judgment · D4 one-home)
**Amends:** [0004](./0004-process-architecture.md) (runner launch/teardown + integration step), [0003](./0003-data-model-hybrid.md) (merge-link row + run integration state), [0005](./0005-personas-and-subtasks.md) (adds the `merge-conflict` Play), [0007](./0007-write-scope-enforcement.md) (held-back-change lifetime now coupled to worktree GC), [0013](./0013-orchestration-observation.md) (extends the per-atom verify to a whole-tree integration verify)
**Relates to:** [0002](./0002-substrate-oz-and-cmux.md) (cmux cwd + C1 crash-resume), [0008](./0008-repository-topology.md) (worktree on-disk location)

## Context

A run mutates the repo working tree on the founder's behalf: it **commits** an atom's in-scope files,
holds **out-of-scope** changes back for an expand-or-discard decision ([0007](./0007-write-scope-enforcement.md)),
and on a **rejected** atom **discards** in-scope files (`restoreToHead`, the atom-isolation safety).
That made the working tree a **single shared mutable resource** contended by the run, the founder's own
edits, and (eventually) other runs.

Today's state is **safe but frictionful**: a hard guard (`DirtyWorkingTreeError`) refuses to launch on a
dirty in-scope tree, which is what keeps `restoreToHead` from ever touching the founder's uncommitted
work — so the shared-tree data-loss is *hypothetical* (it would only occur if the guard were removed
without replacing the isolation it provides). The cost is real friction: a launch is **blocked** over
unrelated WIP. The stash workaround we considered is worse — a save/restore whose restore step must
"remember" to run is a fragile data-loss liability, not a guarantee.

Both are symptoms of forcing concurrent, multi-actor work through one working tree (the v1 L1 lesson:
coordination/state failures dominate). The fix is structural isolation, not a better lock.

## Decision

### 1. Each run owns an isolated working state — a git worktree + branch
At launch the runner creates a dedicated worktree from the **tip of the trunk branch as of launch**:
`git worktree add -b <run-branch> local/worktrees/<runId> <trunk-sha>`. It is **clean in-scope by
construction**, which *is* the soundness precondition the retired dirty-tree guard used to provide
(runner.ts computes `preExistingInScope` so the per-atom `restoreToHead` quarantine only ever discards
the run's *own* work — a fresh branch off a committed trunk point satisfies that without a guard).
Agents (Oscar/Bob/Deb, Plays) run with cwd = the worktree. The founder's own checkout is **never
touched DURING the run**: the `DirtyWorkingTreeError` guard is **retired**, the founder's WIP is
irrelevant to a launch, and `restoreToHead` can only ever reset the run's own worktree. The founder's
uncommitted edits are intentionally **excluded** from the run (to build on them, commit first —
explicit, not forced). **At the end**, the verified auto-merge intentionally **advances the trunk
branch** (§3) — standard fast-forward, exactly like the founder's own `git pull` when a teammate
pushes; it never clobbers uncommitted work (an overlap escalates instead of overwriting). CoCoder is
deliberately autonomous here (verify→commit→merge, no human review gate) — that is the "no human
backstop" premise, distinct from a leave-it-uncommitted-for-review model (founder decision 2026-06-02).

The **run directory stays under `local/runs/<runId>`** (the install root), NOT inside the worktree.
Governance files are read at launch **from the worktree's branch point** (a consistent snapshot). The
stale-daemon check keeps reading `cocoderHome` trunk HEAD, not the worktree HEAD.

**Ignored local state is a separate lane from source commits.** If a verified + integrated run writes
allowed files under the worktree's ignored `local/` directory, the runner exports those files back to
the canonical install/workspace `local/` zone after integration. This does **not** widen git write-scope:
tracked source still lands only through the commit gate ([0007](./0007-write-scope-enforcement.md)).
Run-management and secret paths (`local/worktrees/**`, `local/runs/**`, `local/secrets/**`) are not
exported; blocked or failed exports are recorded as run events, and teardown/orphan GC preserves the
worktree until they are resolved.

### 2. The runner owns git mechanics; Plays own semantics
Deterministic code — not a model — does worktree create, branch, per-atom scope-gated commit
([0007](./0007-write-scope-enforcement.md)), the merge, and worktree GC. The semantic work (resolving a
conflict; authoring closeout) is a **Play** on its assigned model. Same Option-B split as wrap-up: the
agent writes files; the runner commits/merges. Agents are told (one prompt line) they are on an isolated
branch and must **not** push or merge by hand.

### 3. Auto-merge on green — and "green" includes a whole-tree integration verify
When a run completes with its atoms verified, the runner integrates the run branch into trunk. **Before
the integration lands, the merged tree is re-verified as a whole** — extending the per-atom verify
([0013](./0013-orchestration-observation.md)) to a **distinct integration-verify station**: a *fresh*
verifier (its own pane/persona — **never** the conflict-resolver self-verifying; evidence, not the
builder's word), baseline = the merged worktree, verdict written to a file the deterministic runner
reads. This closes the hole the review flagged: per-atom green only proves each atom passed *in
isolation* (the very failure 0013 was earned for), so the integrated trunk — the line the founder ships
from — must be proven as a whole, not assumed. **Required on both** the fast-forward and the
post-conflict path: trunk is never landed unverified (F11 — no bypassable gate masquerading as a
guarantee). On verify-fail, the run does not land; it escalates.

Founder-facing completion is tied to that landing, not just to atom verification. `completed` is
reserved for work that is visible on trunk. If the atoms verify but integration escalates, the run
status is `pending-landing`; Oz shows **Not landed** and keeps the run attached to its priority until
the landing question is resolved. This prevents isolated worktree success from being mistaken for a
completed priority in the founder's trunk checkout.

### 4. The `merge-conflict` Play (built now)
When the merge is not a clean fast-forward (trunk advanced — founder edited trunk, or a later run), the
runner dispatches the **`merge-conflict` Play** ([0005](./0005-personas-and-subtasks.md) registry) on
its assigned model to resolve the conflict in the worktree. Then: **resolve → integration-verify (§3) →
merge**. Two guardrails: (a) the resolution is re-verified before landing (never auto-land an unverified
resolution); (b) genuine *semantic* divergence (two intentional changes that truly disagree) is
**escalated to the founder**, not guessed (decision-classifier, shared-standard #9). Mechanical →
resolve; real divergence → escalate.

### 5. Worktree GC never destroys un-integrated or held-back work (amends 0007)
Teardown GC removes only the worktree **directory** (`git worktree remove`) and **never prunes a branch
with commits unreachable from trunk**. GC is **blocked** while the run has **unresolved out-of-scope
held-back changes** ([0007](./0007-write-scope-enforcement.md)): those live in the worktree pending the
founder's expand-or-discard decision, and 0007 forbids silent auto-discard — so the worktree/branch is
preserved until resolved. A **daemon-boot orphan sweep** reconciles `local/worktrees/*` against the run
table, sequenced **close-panes-then-remove-worktree** (a live pane sits inside the worktree cwd). This
folds into the **same teardown primitive** that must also be fixed for the current Deb-pane leak.

### 6. Data-model + crash-resume deltas (amends 0003 + 0002)
- **Merge linkage** ([0003](./0003-data-model-hybrid.md)): add a `commit_link` row variant for the
  branch→trunk merge — a `kind` discriminator (`atom` | `merge`), the merge SHA, the trunk parent, and a
  **nullable** `work_item_id` (a merge has none). Keeps run/commit linkage first-class (the F6 lesson),
  not reconstructed.
- **Resume** ([0002](./0002-substrate-oz-and-cmux.md) C1): the run row carries durable `worktree_path`,
  `run_branch`, and `integration_status` (`pending` | `resolving` | `verifying` | `merged` |
  `escalated`). These are recorded **for discernment, not auto-resume** (founder decision 2026-05-31): a
  mid-merge crash is rare, so the system does NOT automatically pick up and finish a half-done merge.
  Instead the state is durable so a relaunched **orchestrator (Oscar) reads `integration_status` + the
  git state and discerns what happened** when picking the priority back up — and resolves it as work,
  the same way it would any other incomplete priority. (No fragile auto-resume machinery is built.)

### 7. Concurrency is an explicit MVP non-goal
Worktrees remove git-tree contention, but [0004](./0004-process-architecture.md)'s single-writer still
serializes, and standalone mode is effectively single-run. **MVP: runs are sequential; each merges
against a trunk that has usually not moved.** Concurrent runs are a later question (ordering/rebase
semantics undecided), not a benefit claimed here.

## Consequences

- Retires the `DirtyWorkingTreeError` guard and the stash idea; the protection becomes **structural**
  (isolation), not a fragile lock/save/restore. Quarantine soundness is preserved by construction (§1).
- Integration is an explicit, **verified**, conflict-aware step owned by deterministic runner code, with
  Plays only for semantic resolution — and the trunk is never landed unverified (§3).
- Cost: worktree lifecycle (create/GC/orphan-sweep) and branch management are load-bearing plumbing the
  runner must get right — the same lifecycle discipline the Deb-pane teardown leak shows we owe.
- Earned, not speculative (L2): justified by 2026-05-31 dogfooding (dirty-tree friction, stash
  fragility) and the review's verified gaps — not anticipated in the abstract.

## Conflict audit (per ADR-0014, for the founder)
- **0004:** amended — launch gains worktree+branch create; teardown gains GC + orphan-sweep; end-of-run
  gains the verified-merge step.
- **0007:** **amended** (corrected from the first draft) — the lifetime of held-back out-of-scope changes
  is now coupled to worktree GC; GC blocks until they're resolved. Per-atom scope enforcement itself is
  unchanged, now inside the worktree.
- **0003 / 0002:** **amended** — merge-link row + durable worktree/branch/integration-status on the run
  row (§6); not merely "related."
- **0013:** extended — the per-atom verify gains a sibling whole-tree integration verify (§3).
- **0005:** additive — `merge-conflict` joins `wrap-up` in the registry.
- **L3 honesty:** the integration window is the one moment a run's work transiently has **two homes**
  (its branch + trunk), owned by the deterministic runner merge step — surfaced, not self-certified clean.

## Glossary
- **git worktree** (this ADR): a per-run checkout on disk sharing the one object store. **cmux
  workspace**: a UI container for a run's panes. They share only the `runId`; do not conflate them.

## Open questions (for the founder)
- Branch/worktree **retention**: prune failed-run branches, or keep for forensics? GC cadence.
- Where Oz **surfaces an auto-merged result** (the merge commit + diff) for after-the-fact review.

## Implementation status (2026-05-31, run_34 — branch `rebuild/phase-2-oz`)
Built by direct hand-build (the daemon/loop was down; the work is the loop's own engine), per an
adversarial plan review (8 must-fixes, all addressed). Each atom typecheck + tests green, committed.
**All 7 atoms landed — verified-when #1–#4 met with live-git evidence.**
- §1/§2 worktree-at-launch + full cwd isolation; verified-when #1 (dirty checkout launches unblocked,
  founder tree untouched).
- §6 data model + idempotent ALTER migration (proven against a copy of the real 34-run db).
- §3 fail-closed whole-tree integration VERIFY before the ff-merge — a fresh verifier Play; a
  missing/timeout/unparseable/`fail` verdict all escalate without landing (F11 closed); verified-when #2.
- §4 merge-conflict Play: a non-ff merges trunk into the run branch, resolves via the Play →
  re-verifies → ff's; a genuine semantic divergence aborts + escalates, never guessed; verified-when #3.
- §5 teardown worktree GC + daemon-boot orphan-sweep + the Deb-pane leak root fix; verified-when #4.
- **§6 crash-resume — DECIDED (founder, 2026-05-31):** do NOT build auto-resume (too rare to justify the
  fragility). The durable `integration_status` + branch/worktree are recorded so a relaunched Oscar
  discerns a half-done merge on pickup and resolves it as ordinary work. §6 amended accordingly.
- **Strongest remaining evidence gap:** all proof is from unit + LIVE-git tests, NOT yet a real
  daemon-driven dogfood run (the daemon was down). One live run that isolates → verifies → merges in
  anger is the final archive proof; it needs the daemon back up.

### Post-implementation adversarial review (2026-05-31)
A 4-lens bug-hunt over the committed implementation (each finding adversarially verified) confirmed the
launch-side isolation sound and all 8 plan-review must-fixes genuinely closed, but found real defects on
the LANDING / teardown seam — now fixed (commits `4378cec`, `94f5de8`):
- **Cross-restart pane close was broken** (the Deb-leak fix didn't actually work — the fake host masked
  it): the workspace ref needed to close a pane was never persisted, so teardown after a daemon restart
  closed nothing. Fixed: durable `session.workspace_ref` + `SessionHost.closeSurface()`. **This is what
  actually makes verified-when #4 hold in production.**
- **Landing safety:** added a misrouting guard (pin the trunk BRANCH NAME at launch; escalate if the
  founder switched branches / went detached) and guaranteed a terminal integration status on every exit
  (fail-closed catch + abort), so a run can never strand at `verifying`/`resolving`.
- **GC preservation:** an escalated/un-integrated run's worktree (the inspection artifact) is no longer
  GC'd.
- **Open design question (founder call):** a *clean* fast-forward still lands by merging in the founder's
  checkout, which updates their working tree. Made SAFE (misroute-guarded; dirty-overlap escalates), but
  eliminating the working-tree touch entirely needs the trunk-topology decision this ADR's open questions
  already flag (ref-move vs a dedicated integration worktree vs a non-checked-out trunk).
- **Deferred minor (shouldFix):** the merge-conflict `completeMerge` stages with `git add -A` (no
  deterministic scope partition at merge conclusion — gated only by the integration verify after);
  `pending-scope-decision` still has no expand-or-discard exit (its worktree is intentionally pinned).
