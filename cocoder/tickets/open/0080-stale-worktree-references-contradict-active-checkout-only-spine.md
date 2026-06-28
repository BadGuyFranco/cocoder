---
id: 0080
title: Stale "worktree" references contradict the active-checkout-only spine
type: bug
status: Open
priority: none
owner: Oscar
created: 2026-06-28
---

# 0080 — Stale "worktree" references contradict the active-checkout-only spine

## Context

Surfaced during run_273 (Doc Truth Analysis), atom 1. ADR-0023 Amendment 2 (founder directive
2026-06-15) removed the opt-in isolation lane: there is exactly **one mode** — the spine works on the
**active checkout / active branch**, with **no worktree, no run branch, and no landing step**
(`ARCHITECTURE.md` commit-spine section; `cocoder/decisions/0023-workspace-commit-spine.md`).

`cocoder/decisions/0016-deb-scoped-repair-fallback.md` §3 still describes Deb's repair edits as happening
**"in the run's worktree"** (around line 60) as current behavior. That is stale relative to the
active-checkout-only spine. It was deliberately left unfixed in run_273 atom 1 (whose scope was the
commit-withholding defect class only) and reported for this ticket.

This is a **defect class, not a single line**: other governed docs/ADRs/personas may describe a
per-run worktree as current behavior. Note that some "worktree" mentions are legitimately correct and
must NOT be changed — e.g. references that explicitly record the *retired* isolation lane as history,
or the harness `isolation: "worktree"` agent capability. The fix targets only **current-truth claims**
that say live runs operate in a worktree.

## Acceptance

- Re-derive the live site set with a grep over governed surfaces
  (`grep -rni 'worktree' ARCHITECTURE.md cocoder/decisions cocoder/standards cocoder/PLAYBOOK.md docs packages/personas/base`)
  and classify each hit as current-truth-contradiction vs correct-historical/capability.
- Every current-truth worktree claim is reconciled to the active-checkout-only spine (ADR-0023
  Amendment 2), starting with ADR-0016 §3.
- Accepted-ADR history is preserved with superseded-pointers, not rewritten (same convention used in
  run_273 atom 1).
- Correct historical/capability worktree mentions are left intact, with the classification recorded.

## Sweep Classification

Command run from the repo root:

```sh
grep -rni 'worktree' ARCHITECTURE.md cocoder/decisions cocoder/standards cocoder/PLAYBOOK.md docs packages/personas/base 2>/dev/null
```

Current-truth contradictions reconciled:

- `ARCHITECTURE.md` and `docs/glossary.md` described `local/worktrees` as current per-run state; they now
  call those entries historical pre-2026-06-15 worktrees.
- `cocoder/decisions/0008-repository-topology.md` described install-private worktrees as current local
  zone contents; it now marks them historical.
- `cocoder/decisions/0016-deb-scoped-repair-fallback.md` described Deb repair edits in a run worktree
  and failed-run ticket drafting on a run branch; those claims now point to the active checkout and
  governed ticket spine, with the old worktree/run-branch wording marked superseded history.
- `cocoder/decisions/0023-workspace-commit-spine.md`, `cocoder/decisions/0034-retire-adr0015-merge-machinery.md`,
  `cocoder/decisions/0041-orchestration-ownership-and-actor-authority.md`,
  `cocoder/decisions/0042-run-concurrency-model.md`, and `cocoder/decisions/README.md` still referred to
  an opt-in worktree/isolation lane as live. They now say ADR-0023 Amendment 2 removed that lane, while
  preserving the older ADR text as superseded history where needed.
- `packages/personas/base/standards/loop-packets.md` said loop criteria rerun in the worktree; it now
  says active checkout.
- `docs/personas.md` and `docs/loop-packets-dispatch-inventory.md` used loose current wording; they now
  say working tree / checkout instead of implying a per-run worktree.

Correct historical/capability mentions left intact:

- ADR-0023's audit/history statements about pre-reset run worktrees, the active-checkout "no worktree"
  rule, and why worktrees stopped accumulating.
- ADR-0027's obsolete `run.worktree_path` field reference.
- ADR-0034's `git-worktree` test / primitive references, now explicitly classified as low-level
  capability and historical cleanup surface, not a live run lane.
- Historical audit docs under `docs/*truth-audit.md`, `docs/loop-packets-retrofit-audit.md`, and
  `docs/phase3-cross-doc-reverification.md`.
- `packages/personas/base/oscar.md` saying Oscar does not need a worktree.
