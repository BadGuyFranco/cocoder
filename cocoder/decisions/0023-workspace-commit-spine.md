# ADR-0023 — The workspace commit spine: direct-to-branch by default, isolation opt-in

**Status:** Accepted (founder, 2026-06-14) — decided in a direct Opus session under the priority
[`orchestration-operating-model-reset`](../priorities/orchestration-operating-model-reset.md), outside
CoCoder's own run machinery (the machinery being reset).
**Supersedes:** [0015](./0015-isolated-working-state-per-run.md) (isolation-per-run was the *default*;
now opt-in), [0021](./0021-oz-repair-commit-authority.md) (Oz out-of-run trunk authority → just one
caller of the spine), [0022](./0022-orchestration-change-durability.md) (its **principles are retained**;
the run-branch strand machinery it built is dissolved — see Conflict audit).
**Reconciles:** [0007](./0007-write-scope-enforcement.md) (the allow-list + gate-the-commit primitive
*is* the spine's scope step — unchanged in spirit, relocated).
**Builds on:** [0003](./0003-data-model-hybrid.md) (run/commit linkage = the receipt),
[0004](./0004-process-architecture.md) (single-writer-per-workspace — what makes in-place commits safe),
[0013](./0013-orchestration-observation.md) (the verify gate — retained for risky code).
**Earned from:** F2, F14, F17, F18, F19, F20 (failure catalog); runs 67/68/70/73/74/75/78/79 (six-plus
strand/reaffirmation incidents); a code-cited audit (2026-06-14) that found three divergent commit
mechanisms, 23 orphaned run worktrees, and `main` frozen 351 commits behind the de-facto trunk.

## Context

A 2026-06-14 audit of `runner.ts` / `launcher.ts` / `routes.ts` / `commit-gate/**` established the
ground truth: **"commit a change to the active workspace branch" has three divergent homes**, plus a
merge path, none unified — a direct violation of the charter's D4 ("one concept, one home"):

1. `runCommitGate` (core) — in-run atoms/wrap/Deb-repair; commits to a throwaway **run worktree** on
   branch `cocoder/run_N`; store-linked, scope-gated, verified; reaches trunk only via a later ff-merge.
2. `commitGovernance` (daemon `routes.ts`) — priority create/reorder, persona assignments, workspace
   scaffold; commits **directly on the active branch**; no scope gate; **swallows commit failures and
   still reports success**.
3. `gateCommitRepair` (core `repair.ts`) — the Oz `repair` verb; commits **directly on the engine
   trunk checkout**; idle-only; **no store row, no commit-link, no event** — the most privileged write
   has the weakest receipt.

Every recurring failure traces to one root: **[ADR-0015](./0015-isolated-working-state-per-run.md) made
an isolated worktree + run branch the DEFAULT for every run.** That run branch is, in ADR-0022's own
words, "the seam every strand crosses." F14 (post-land strand), F17 (escalate strand), F19 (wrap
asserted success before the branch landed), F20 (orchestrator vanished mid-handoff) are all the same
event: committed work sat on a run branch and did not reach the trunk the next session reads. The fix
family was **unbounded** because each leak was patched at the funnel (F14 in-run re-land, F17
escalate→`pending-landing`, ADR-0021 Oz repair, ADR-0022 a "terminal landing invariant") instead of
questioning the default that creates the funnel. Meanwhile 23 worktrees orphaned (GC blocks on
held-back/escalated state that keeps firing), and `main` died because nothing ever converged to it.

[ADR-0022](./0022-orchestration-change-durability.md) got the *principles* right — broad-by-default
access, the two-surface boundary, daemon writes must commit, receipts derived not asserted — but kept
isolation-by-default and tried to make the run-branch funnel **total**. Totalizing a leaky default is
still enumeration. The structural fix is to **remove the default that strands**.

**Founder decisions (2026-06-14):** direct-to-active-branch is the default path for essentially all
work (governance, docs, ADRs, scoped fixes, and verified code); isolated worktrees are an explicit
opt-in for genuinely risky / large / throwaway / parallel work only.

## Decision

### 1. One commit spine

Exactly **one** core service writes tracked files to the active workspace branch. Every actor calls it
— Oscar's wrap edits, Bob's verified atom, Deb's repair, Oz's repair, the daemon's
priority/persona/governance mutations, and any founder-directed edit. No actor reimplements `git
commit`. The spine:

- works on the **active checkout, active branch** (default) — no worktree, no run branch, no merge step;
- applies the **scope gate** ([ADR-0007](./0007-write-scope-enforcement.md) partition): in-scope paths
  commit; out-of-scope paths are **held back and surfaced**, never silently dropped, never silently
  committed;
- applies **verification matched to the change's risk** (§3);
- emits **one durable receipt** for every actor — a commit-link row + event capturing branch, SHA(s),
  changed files, held-back files, and verification evidence. The privileged direct-to-trunk write no
  longer has the weakest receipt; a write that fails to commit can no longer report success.

`runCommitGate`, `commitGovernance`, and `gateCommitRepair` collapse into this one service.

### 2. Direct-to-branch is the default

The default path commits in place on the active branch. **There is no run branch, so there is no
off-trunk place for committed work to strand** — the F14/F17/F19/F20 strand class is dissolved
structurally, not patched. What makes in-place commits safe is the existing
**single-writer-per-workspace lock** ([ADR-0004](./0004-process-architecture.md)): only one actor
mutates the working tree at a time. The worktree was solving working-tree contention that the lock
already serializes; without contention, the worktree's cost (branch lifecycle, GC, orphan sweep, the
entire strand surface) buys nothing for the common case.

### 3. Verification matched to risk — not isolation matched to risk

Safety comes from **verifying before the spine commits**, in place — not from isolating in a worktree:

- **Governance / docs / ADRs / priorities / personas / standards / tickets:** commit directly; light or
  no test gate (the change cannot break a build).
- **Product / machinery code:** the orchestrator still verifies before the spine commits — the per-atom
  whole-tree diff check (catches the F13 scope blowout) and the change's tests
  ([ADR-0013](./0013-orchestration-observation.md)). If verification fails, **nothing commits** and the
  working tree is reverted in place (`restoreToHead` quarantine — sound because the single-writer lock
  guarantees the only uncommitted changes are this actor's own). No worktree is required to make
  quarantine safe.

### 4. Isolated worktree = explicit opt-in sandbox

A run cuts a worktree + branch **only** when the founder or priority explicitly asks for isolation, for
genuinely risky / large / throwaway / parallel / conflict-heavy work. In that mode the **same spine**
owns the land-back to the active branch (verified ff-merge) and emits the **same receipt**. Isolation is
a sandbox you opt into, never the road every change travels. ADR-0015's verified-merge,
integration-verify, and merge-conflict machinery are **retained for this opt-in path only**.

### 5. Held-back is the only "not yet landed" state, and it is first-class

In the default path the sole non-landed outcome is an **out-of-scope held-back change**. It is surfaced
as a first-class Oz "Awaiting you" item with **land** / **discard** actions, recorded in the receipt.
There is no `pending-landing`-on-a-run-branch state in the default path (that state exists only for
opt-in isolation runs). A solo founder never needs to understand worktrees, run branches, merges, or
manual git recovery to use CoCoder.

### 6. The receipt is derived, never asserted (closes F19)

The founder-facing close-out names the branch, commit SHA(s), changed files, held-back files,
verification evidence, and exactly one **runnable** next step (a pasteable command, a launchable
priority, or an offer to craft the missing test — never a doc pointer; F18). Every claim is **read from
the spine's actual result after it runs** — never predicted by a wrap model beforehand. A run can never
again tell the founder "verified for landing / nothing held back" on work that did not land.

## Consequences

- **Three mechanisms collapse to one; D4 is restored.** "Commit to the active branch" has one home.
- **The strand class is gone by construction** in the default path. The unbounded patch family —
  F14/F17/F19/F20 and the ADR-0021/0022 run-branch machinery — retires. The "next session this will be
  resolved" loop ends because there is no run branch to strand on.
- **Worktrees stop accumulating** (the default creates none); the 23 existing orphans are GC'd (Phase E).
- **`main` is the canonical trunk again.** "Land on trunk" = "commit on the active branch" = immediate
  and visible to the next session with no recovery step.
- **Trade-off, stated honestly:** the default path has no per-run isolation safety. Mitigated by (a) the
  single-writer lock; (b) verify-before-commit for code; (c) the scope gate + held-back surfacing; and
  (d) the broad-by-default premise retained from ADR-0022 §1 — on a git-managed repo, rollback is always
  one `git` command away, so the safe default is broad access with a high-risk-only hold-back bar, not
  caution that makes the system unusable. Genuinely risky work opts into §4 isolation.

## Conflict audit (per ADR-0014, for the founder)

- **0015 — SUPERSEDED.** Isolation-per-run was the default and the source of the strand class; it
  becomes opt-in (§4). Its verified-merge / integration-verify / merge-conflict / worktree-GC machinery
  survives **only** behind the opt-in flag.
- **0021 — SUPERSEDED.** Oz's special idle-only, narrow-scope, receipt-less out-of-run trunk authority
  is dissolved: Oz becomes an ordinary caller of the spine, gated by the same scope step and serialized
  by the same single-writer lock, with the same durable receipt as everyone else.
- **0022 — SUPERSEDED (principles retained).** Broad-by-default access (§1), the two-surface boundary
  (§2), daemon-writes-are-committed (§4), and the derived receipt are all **kept** and now realized by
  the spine. What retires: the "terminal landing invariant" over run branches (§3) and the run-branch
  reconciler/`stranded-commits-detected` machinery — unnecessary once the default has no run branch.
- **0007 — RECONCILED, not superseded.** The allow-list + gate-the-commit primitive is the spine's scope
  step, unchanged in spirit. Its 2026-06-13 reconciliation note (founder-directed Surface-A edits are
  in-scope by default; hold-back bar is breakage-risk) carries forward verbatim.
- **0013 — retained.** The verify gate is how §3 protects code; it runs in place (default) or inside the
  opt-in worktree.

## Implementation status

- **Phase A (this ADR + governance reconciliation):** in progress 2026-06-14.
- **Phase B (the core spine + runner default flip):** owed.
- **Phase C (daemon/Oz routed through the spine; first-class held-back surface):** owed.
- **Phase D (persona/Play prompts aligned to the built spine):** owed.
- **Phase E (live-git verification + orphan-worktree GC):** owed — the fresh-session proof is the
  archive gate, per the priority's "Verified when."
