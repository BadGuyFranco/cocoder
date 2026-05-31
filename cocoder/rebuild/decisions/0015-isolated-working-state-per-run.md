# ADR-0015 — Isolated working state per run (worktree + branch), auto-merge on verified green

**Status:** Accepted (founder + Claude, 2026-05-31; drafted → adversarially reviewed → revised per founder decisions: verified-merge + build the merge-conflict Play)
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
touched**: the `DirtyWorkingTreeError` guard is **retired**, the founder's WIP is irrelevant to a
launch, and `restoreToHead` can only ever reset the run's own worktree. The founder's uncommitted edits
are intentionally **excluded** from the run (to build on them, commit first — explicit, not forced).

The **run directory stays under `local/runs/<runId>`** (the install root), NOT inside the worktree.
Governance files are read at launch **from the worktree's branch point** (a consistent snapshot). The
stale-daemon check keeps reading `cocoderHome` trunk HEAD, not the worktree HEAD.

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
  `escalated`), so a relaunched agent rebinds to the right worktree and a mid-merge crash is resumable.

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
- **Open for the founder (does NOT block the four criteria):** §6 "a mid-merge crash is resumable" —
  only the write side (status transitions) exists; the read/rebind/auto-resume side is unbuilt. Decide:
  build it, or amend §6 to "recorded-for-forensics, not auto-resumed."
- **Strongest remaining evidence gap:** all proof is from unit + LIVE-git tests, NOT yet a real
  daemon-driven dogfood run (the daemon was down). One live run that isolates → verifies → merges in
  anger is the final archive proof; it needs the daemon back up.
