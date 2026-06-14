# Retired v2 ADRs (superseded by the live tree)

**Status: FROZEN — history only. Not part of the live decision tree.**

These v2-era ADRs carried decisions that later changed. They were retired here (founder directive
2026-06-14, the `orchestration-operating-model-reset` priority) so the live
[`decisions/`](../../../decisions/README.md) tree contains **only current-truth decisions** — no ADR
sits in "Accepted" while contradicting reality. Kept for history and as the rationale record behind the
decisions that replaced them; never read as live.

| Retired ADR | Was | Replaced by |
|---|---|---|
| 0015 — Isolated working state per run | An isolated worktree + run branch was the **default** for every run — the run branch that became the strand surface (F14/F17/F19/F20). | [ADR-0023](../../../decisions/0023-workspace-commit-spine.md) — direct-to-branch is the default; isolation is opt-in. (0015's worktree/verify/merge machinery survives **only** behind that opt-in.) |
| 0021 — Oz repair: trunk commit authority outside a run | Oz had a special idle-only, narrow-scope, receipt-less out-of-run trunk-commit path. | [ADR-0023](../../../decisions/0023-workspace-commit-spine.md) — Oz is an ordinary caller of the one commit spine, with the same scope gate and receipt as everyone else. |
| 0022 — Orchestration-change durability | Broad-by-default access + the two-surface boundary + a "terminal landing invariant" over run branches. | [ADR-0023](../../../decisions/0023-workspace-commit-spine.md) — **principles retained** (broad-by-default, two-surface, daemon-writes-commit, derived receipts); the run-branch strand machinery retired with the default run branch. |

Internal `./NNNN-…` links inside these files refer to ADRs as they stood when written; resolve them
against the live [`decisions/`](../../../decisions/README.md) tree.
