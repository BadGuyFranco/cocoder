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
