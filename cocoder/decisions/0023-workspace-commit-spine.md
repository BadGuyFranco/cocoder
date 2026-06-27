# ADR-0023 — The workspace commit spine: direct-to-branch, single mode

**Status:** Accepted (founder, 2026-06-14) — decided in a direct Opus session under the priority
[`orchestration-operating-model-reset`](../zArchive/priorities/v2/orchestration-operating-model-reset.md), outside
CoCoder's own run machinery (the machinery being reset).
**Supersedes:** [0015](../zArchive/v2/decisions/0015-isolated-working-state-per-run.md) (isolation-per-run was the *default*;
now opt-in), [0021](../zArchive/v2/decisions/0021-oz-repair-commit-authority.md) (Oz out-of-run trunk authority → just one
caller of the spine), [0022](../zArchive/v2/decisions/0022-orchestration-change-durability.md) (its **principles are retained**;
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

Every recurring failure traces to one root: **[ADR-0015](../zArchive/v2/decisions/0015-isolated-working-state-per-run.md) made
an isolated worktree + run branch the DEFAULT for every run.** That run branch is, in ADR-0022's own
words, "the seam every strand crosses." F14 (post-land strand), F17 (escalate strand), F19 (wrap
asserted success before the branch landed), F20 (orchestrator vanished mid-handoff) are all the same
event: committed work sat on a run branch and did not reach the trunk the next session reads. The fix
family was **unbounded** because each leak was patched at the funnel (F14 in-run re-land, F17
escalate→`pending-landing`, ADR-0021 Oz repair, ADR-0022 a "terminal landing invariant") instead of
questioning the default that creates the funnel. Meanwhile 23 worktrees orphaned (GC blocks on
held-back/escalated state that keeps firing), and `main` died because nothing ever converged to it.

[ADR-0022](../zArchive/v2/decisions/0022-orchestration-change-durability.md) got the *principles* right — broad-by-default
access, the two-surface boundary, daemon writes must commit, receipts derived not asserted — but kept
isolation-by-default and tried to make the run-branch funnel **total**. Totalizing a leaky default is
still enumeration. The structural fix is to **remove the default that strands**.

**Founder decisions (2026-06-14):** direct-to-active-branch is the default path for essentially all
work (governance, docs, ADRs, scoped fixes, and verified code); isolated worktrees are an explicit
opt-in for genuinely risky / large / throwaway / parallel work only.

## Decision

> **Amendment 2 (founder directive, 2026-06-15) — the OPT-IN ISOLATION LANE (§4) is REMOVED; there is now
> exactly ONE mode.** ADR-0023 dissolved the strand class on the *default* path but kept §4's run-worktree +
> branch→trunk landing machinery alive as an opt-in. That surviving lane was the same funnel — its
> **fail-closed, content-blind integration-verify landing gate** (`landRunBranch` → `runIntegrationVerify`)
> could hold a successful run's commits off-trunk for any reason (no/garbled verdict, timeout, an unrelated
> pre-existing red test, trunk-branch change, merge conflict), regenerating the exact "successful run can't
> commit" symptom F14/F17/F19/F20 each patched. After six sessions chasing it, the root was named: a *second*
> path from "actor changed a file" to "it's on trunk" with a *different* contract than the default's. The fix
> is the same move Amendment 1 made for scope — delete the constraint at the root, don't add a valve: **the
> isolation lane is removed.** §4 is retired; §5's `pending-landing` (its only remaining user) is retired; the
> run worktree, run branch, integration sub-status, `landRunBranch`, integration-verify + merge-conflict Plays,
> the daemon's strand reconciler / worktree-GC / `POST /runs/:id/resolve`, and the store's
> `worktree_path`/`run_branch`/`integration_status` + merge-link columns are all deleted. There is now ONE
> contract for every path: **commit everything to the currently checked-out branch, always** — so no code path
> can hold a committed change off that branch. The verify gate (§3) stays *per-atom and in place* (it reverts a
> failed atom's product code before the commit); it never gates *landing*, because there is no landing step.
> The only reason a branch matters is a **shared remote** (a GitHub collaboration repo): the founder checks out
> a feature branch, the engine commits to it and `git push`es (non-gating); the merge to the shared `main` is
> GitHub's PR review, not the engine's. Verified green: `pnpm typecheck` + 592 tests across all packages.
> §2/§6 stand; §4 and the `pending-landing` half of §5 are struck.

> **Amendment 1 (founder directive, 2026-06-15) — scope is ADVISORY; the spine never withholds.** The
> original §1/§5 had the scope gate *withhold* out-of-scope changes (held back → `pending-scope-decision`).
> That residual commit-blocking regenerated the "decided but nothing lands" strand one rung up (the run_86
> D3 strand) and is the exact constraint three rebuilds set out to remove. It is deleted at the root:
> **every actor (Oscar/Oz/Deb/Bob) commits everything it changed, directly, anytime.** Out-of-lane edits
> are **committed and FLAGGED**, never held back; there is no held-back / `pending-scope-decision` state.
> The only gate that remains is the automated, self-clearing **verify-on-product-code** (§3) — it runs
> before the spine commits and never parks awaiting a human. §1 and §5 below are corrected accordingly; §2
> (direct-to-branch default), §4 (opt-in isolation lane, which still uses `pending-landing`), and §6
> (derived receipt) are unchanged.

### 1. One commit spine

Exactly **one** core service writes tracked files to the active workspace branch. Every actor calls it
— Oscar's wrap edits, Bob's verified atom, Deb's repair, Oz's repair, the daemon's
priority/persona/governance mutations, and any founder-directed edit. No actor reimplements `git
commit`. The spine:

- works on the **active checkout, active branch** (default) — no worktree, no run branch, no merge step;
- commits **everything the actor changed** in one commit; the [ADR-0007](./0007-write-scope-enforcement.md)
  allow-list is now **advisory** — out-of-lane paths are committed and **FLAGGED** for visibility, never
  withheld (2026-06-15 amendment). The spine never holds a commit back;
- applies **verification matched to the change's risk** (§3) — the one remaining gate, automated;
- emits **one durable receipt** for every actor — a commit-link row + event capturing branch, SHA(s),
  changed files, out-of-lane (flagged) files, and verification evidence. The privileged direct-to-trunk
  write no longer has the weakest receipt; a write that fails to commit can no longer report success.

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
  ([ADR-0013](./0013-orchestration-observation.md)). This is the **one remaining gate** and it is
  automated + self-clearing — it never parks awaiting a human. If verification fails, **the atom's product
  code does not commit** and is reverted in place (`restoreToHead` quarantine, reverting what *the atom*
  produced — dirty-after minus a run-start snapshot, so a founder's pre-existing uncommitted edit is never
  destroyed). A failed atom blocks only itself; the run's other (governance/doc) work still commits. No
  worktree is required to make quarantine safe.

### 4. Isolated worktree = explicit opt-in sandbox

A run cuts a worktree + branch **only** when the founder or priority explicitly asks for isolation, for
genuinely risky / large / throwaway / parallel / conflict-heavy work. In that mode the **same spine**
owns the land-back to the active branch (verified ff-merge) and emits the **same receipt**. Isolation is
a sandbox you opt into, never the road every change travels. ADR-0015's verified-merge,
integration-verify, and merge-conflict machinery are **retained for this opt-in path only**.

### 5. There is no held-back state — out-of-lane edits commit and are flagged (2026-06-15 amendment)

In the default path **nothing is withheld.** Every change the actor produces commits to the active branch;
paths outside the actor's advisory allow-list are **committed and FLAGGED** in the receipt (an "out of
lane" visibility signal), never parked for a founder decision. There is no held-back working-tree state and
no `pending-scope-decision` run status — so the "decided but nothing lands" class cannot occur. (The
*original* §5 made held-back a first-class "Awaiting you" item with land/discard actions; that withholding
was the constraint removed by this amendment.) The only non-landed default-path state is none; the opt-in
isolation lane (§4) still has `pending-landing` for a run-branch that escalates at integration, resolved by
the `discard`/`landed` actions. A solo founder never needs to understand worktrees, run branches, merges,
held-back queues, or manual git recovery to use CoCoder — work commits, and git is the undo.

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

## Implementation status — code-complete 2026-06-14 (all six phases landed on `main`)

- **Phase A (this ADR + governance reconciliation):** landed (`e4a9172`).
- **Phase B (core spine + runner default flip to direct-to-branch):** landed (`9dc1c4d`) — direct mode
  is the default; isolation is opt-in; the scoped dirty-guard restores quarantine soundness; live-git
  proof in `runner-direct.test.ts`.
- **Phase C (daemon commit paths collapsed into one spine):** landed (`724a3d1`) — `commitFiles` /
  `commitScoped` + a uniform `CommitReceipt`; the `commitGovernance` swallowed-failure bug is gone
  (502 + reason on failure); `gateCommitRepair` is a thin adapter over the spine; repair attributed to
  an `oz-repair` author.
- **Phase D (persona/Play prompts aligned):** landed (`bce0140`) — the over-promise lines ("repair path
  Oscar doesn't own", "re-lands post-land", "always committable between runs") removed; runtime agent
  prompts are mode-correct (no false "OWN worktree / auto-merge to trunk").
- **Phase F (ADR tree consolidated):** landed (`32e4795`) — 0015/0021/0022 retired to
  `../zArchive/v2/decisions/`; the live `decisions/` set is current-truth only; survivors reconciled.
- **Phase E (verification):** landed (`751d920`) — `node scripts/proof-direct-spine.mjs` is the archive
  proof (10/10 green); full monorepo 626 tests green; failure-catalog records the strand class as
  structurally dissolved.

**Remaining (not code):** (1) an optional live founder conversation on the running daemon — same code
path the tests exercise; (2) a founder inspect/discard decision on **11 historical pre-reset run
branches** that still carry un-landed commits (`git for-each-ref refs/heads/cocoder/`) — left untouched
because ADR-0007/0023 forbid silent discard. The push of `main` to the public `origin` is a separate,
founder-approved step.
