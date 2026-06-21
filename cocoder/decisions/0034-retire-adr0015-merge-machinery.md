# ADR-0034 — Retire ADR-0015's run-branch merge/landing machinery (dead code)

**Status:** Accepted (founder-directed, 2026-06-21).
**Supersedes:** nothing live — this is the implementation-side close-out of
[0015](../zArchive/v2/decisions/0015-isolated-working-state-per-run.md), which was already superseded by
[0023](./0023-workspace-commit-spine.md) and frozen under `zArchive/v2/decisions/`.
**Builds on:** [0023](./0023-workspace-commit-spine.md) (the workspace commit spine — direct-to-branch by
default, no run-branch merge step), and [0007](./0007-write-scope-enforcement.md) (the commit-gate `Git`
port that hosted the removed primitives).

## Context

ADR-0015 (isolated-working-state-per-run) made run-branch isolation the default and added a verified
auto-merge plus a merge-conflict Play. ADR-0023 (the single-mode direct-to-branch commit spine)
superseded it: there is no run-branch merge/landing step anymore, and isolation is an opt-in worktree
lane rather than a merge-back invariant. ADR-0015 was retired to history and frozen under
`cocoder/zArchive/v2/decisions/` at that time.

The merge-conflict Play that consumed ADR-0015's git primitives was already removed. That left a set of
git operations on the commit-gate `Git` port (`packages/core/src/commit-gate/git.ts`) with **no live
caller** — defined in the interface and `makeGit` impl, exercised only by the live-git unit tests, and
referenced only as stub properties on a proof-harness mock. They were carried as "retained pending the
dead-machinery cut" surface-reduction residue:

- `isAncestor`
- `mergeFastForwardOnly`
- `unmergedCommits`
- `mergeInto`
- `conflictedFiles`
- `completeMerge`
- `abortMerge`

Dead code on the integrity boundary (`Git`) is a liability: it implies a run-branch merge model that no
longer exists, and it widens the port surface every actor's git access is mediated through.

## Decision

**Remove ADR-0015's run-branch merge/landing primitives as dead code.**

The seven functions above are deleted from both the `Git` interface and the `makeGit` implementation in
`packages/core/src/commit-gate/git.ts`, along with their doc comments and the ADR-0015 conflict-aware
integration section header. The corresponding live-git tests that exercised them are removed from
`packages/core/tests/git-worktree.test.ts`; the worktree-primitive and `addAndCommit` tests are kept.

The worktree primitives (`worktreeAdd`, `worktreeRemove`, `listWorktrees`) and `resetHard` are **kept**:
they are ADR-0023 §4 isolation/sweep mechanics, not run-branch merge machinery. This cut is exactly the
seven merge/landing functions — nothing else on the port is touched.

## Consequences

- The `Git` port no longer carries any run-branch merge/landing surface; it documents only the operations
  the single-mode spine actually uses (ADR-0023).
- The conflict-aware-integration section comment in `git.ts` is removed; the worktree section header now
  notes that ADR-0015's merge primitives were retired here (ADR-0034).
- ADR-0015 remains frozen under `cocoder/zArchive/v2/decisions/`; its lineage comments in code are
  reconciled to point at ADR-0023/0034 rather than implying a live merge step. This closes the loop on the
  0015 → 0023 supersession at the implementation level.
- No behaviour change: the removed functions had no live caller, so no runtime path is affected.
