# ADR-0038 — Priority visibility invariant

**Status:** Accepted (ticket 0032, 2026-06-23); amended 2026-06-23 to flip detect → prevent:
`order.json` registration is owned by the write spine.
**Amends:** [0010](./0010-taxonomy-and-authoring.md) — keeps `order.json` as an order-only runtime
overlay, but adds write-time registration. Also refines [0025](./0025-atomic-authoring-plays.md): atomic
authoring now registers priority order in the same governance commit.

## Context

ADR-0010 says `cocoder/priorities/order.json` does not define priority existence: runtime readers append
loadable `.md` priorities that are absent from the manifest. That preserves serving behavior, but it let
a real priority file become a hidden/ghost queue item when no manifest entry pointed at it.

## Decision

Every loadable priority under `cocoder/priorities/` must be visible by construction: it is either listed
in `order.json`, placed under `archive/` or `backlog/`, or named in the explicit allowlist for standing
non-queue items (`adhoc-session`).

Prevention is owned by the write/commit spine, not by a later manual step. The single registration owner
is `registerLivePriorities` in `packages/daemon/src/priority-order.ts`. Any spine that lands a live
`cocoder/priorities/*.md` also calls that owner before commit, so the priority file and the `order.json`
registration land atomically in the same governance commit.

The two creation spines are:

- the daemon `createPriority` route, after the file is renamed and validated and before
  `commitGovernance`; and
- the authoring-Play gate-commit path, where `runHeadlessThenGateCommit` runs a `beforeCommit` hook for
  `create-priority`, `edit-priority`, and `archive-priority` before `gateCommitRepair`.

`findOrphanedPriorities` and its daemon governance test remain the explicit belt-and-suspenders net. Under
normal operation they must never trip; they now catch direct file-system drift or a future write spine that
forgot to call the owner, rather than serving as the primary mechanism.

Runtime serving is unchanged from ADR-0010: `readPriorities` still treats `order.json` as an order-only
overlay and appends unlisted loadable priorities instead of refusing to serve them. Existence still lives
in the `.md` files. Registration happens at write time as part of ADR-0025's atomic validate → write →
commit dispatch, not as a second source of existence truth and not as a later manual cleanup.

## Consequences

- Priority creation through the daemon route or authoring Play registers by construction.
- The orphan guard is a backstop that should never fire in normal operation.
- `order.json` remains an order-only overlay at runtime; priority existence stays in the `.md` files.
- Intentional non-queue priorities must be rare and named in the guard allowlist.
