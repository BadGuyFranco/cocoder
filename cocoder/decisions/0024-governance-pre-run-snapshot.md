# ADR-0024 — Launch self-heals governance dirt: the pre-run snapshot

**Status:** Accepted, partially superseded by [ADR-0029](./0029-founder-trusted-pre-run-snapshot.md)
(founder-directed, 2026-06-16). ADR-0029 supersedes only Decision step 2 / the builder-dirt refusal;
the governance pre-run snapshot and self-heal remainder stay live. Decided under the priority
[`governance-authoring-plays`](../priorities/archive/governance-authoring-plays.md), which names the new ADR as
a required outcome.
> **PARTIALLY SUPERSEDED by [ADR-0029](./0029-founder-trusted-pre-run-snapshot.md):** builder-scope dirt
> now self-heals as a founder-attributed pre-run snapshot instead of refusing. The governance-scope
> pre-run snapshot remains current.
**Amends:** [0023](./0023-workspace-commit-spine.md) §2/§3 — the direct-mode launch guard. The spine and
its single-mode, commit-everything contract are unchanged; only the *launch-time dirty-tree refusal* is
refined.
**Builds on:** [0007](./0007-write-scope-enforcement.md) (the write-scope allow-list is what partitions
governance from product dirt), [0004](./0004-process-architecture.md) (single-writer-per-workspace — only
one actor mutates the tree, so a pre-run snapshot races nothing).
**Earned from:** runs 91–96 (six consecutive launches refused by the very governance edit they were
launched to run); `oz-dashboard-bugs` #11/#12.

## Context

ADR-0023 made direct-to-branch the one mode and added a launch guard: if any file inside the run's
**committing scope** (the union of Bob's, Oscar's, Deb's, and the wrap Play's write-scopes) is already
dirty at launch, refuse with `DirtyWorkingTreeError`. The guard's real purpose is sound — the per-atom
commit-gate and quarantine both sweep in-scope files, so launching over uncommitted **founder WIP** could
destroy it.

But the guard was scope-blind to *whose* dirt it was. Authoring a priority or ticket writes into
`cocoder/**` — which is squarely inside Oscar's and Deb's committing scope. So the act of authoring left
governance dirt that the next launch refused: runs 91–96 each tried to launch a freshly-authored priority
and were blocked by that same priority's uncommitted file. The only escape was a manual commit — exactly
the "no human backstop" hole CoCoder exists to close. Root cause: only the daemon's typed routes commit
through `commitGovernance`; an agent or a human hand-editing governance files free-hand bypasses the spine
and strands dirt the guard then trips over.

The companion fix (Part 1 of the priority — atomic authoring Plays) stops *agents* from leaving dirt. This
ADR is the **backstop** for the path Plays don't cover: a human hand-edit, or any governance dirt that
reaches a launch by any route.

## Decision

**The launch guard partitions dirty-in-scope files by builder vs. governance scope, and self-heals the
governance half.** At launch, after the single start-of-run `changedFiles` snapshot:

1. Split the dirty-in-scope set into **builder-scope dirt** (files matching Bob's effective build scope —
   `packages/**`) and **governance-scope dirt** (the remainder — the Oscar/Deb/wrap-up surfaces, i.e.
   `cocoder/**`, `docs/**`, `ARCHITECTURE.md`).
2. **Builder-scope dirt → still REFUSE**, unchanged: `DirtyWorkingTreeError`, run marked failed,
   `dirty-working-tree` event. The guard's protective purpose — never sweep up or destroy the founder's
   uncommitted product WIP — is preserved exactly. **Mixed dirt (both classes present) refuses and commits
   nothing**: the governance half is *not* snapshotted while product dirt blocks the launch.
3. **Governance-scope dirt only → SELF-HEAL**: commit exactly those files through the one spine
   (`commitFiles` with the shared `cocoder-governance` author — the same identity `commitGovernance` uses,
   now a single hoisted constant) as one `governance: pre-run snapshot` commit, record a
   `governance-presnapshot` event `{ files, sha }`, then **proceed** with the launch. If the snapshot commit
   itself fails, the launch refuses rather than proceeding over uncommitted dirt.
4. The quarantine baseline (`dirtyAtStart`) is recomputed **after** the snapshot, so snapshot-committed files
   are not later mistaken for founder pre-existing WIP — and a founder's out-of-scope WIP is still never
   reverted by per-atom quarantine.

What is intentionally **not** changed: the spine's commit-everything-and-flag behavior for out-of-scope
edits; the per-atom commit-gate and whole-tree diff check; the single-mode, no-run-branch contract of
ADR-0023.

## Consequences

- **Authoring-then-launch can never strand on self-authored governance dirt** — on the agent path (Plays,
  Part 1) and the human hand-edit path (this backstop). The run_91–96 failure class is dissolved
  structurally: governance dirt becomes a committed snapshot, not a refusal.
- The guard stays a real guard for the case that matters: uncommitted product WIP still blocks the launch.
- A `governance: pre-run snapshot` commit may appear at the head of a launch when governance files were left
  dirty — an explicit, auditable receipt, not a silent sweep.

**Verified:** `packages/core/tests/runner-direct.test.ts` — governance-only dirt self-heals and the run
proceeds; mixed builder+governance dirt still refuses and snapshots nothing; the pre-existing product-WIP
refusal stays green. Landed in `5842e32`.
