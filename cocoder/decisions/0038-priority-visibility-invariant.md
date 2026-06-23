# ADR-0038 — Priority visibility invariant

**Status:** Accepted (ticket 0032, 2026-06-23).
**Amends:** [0010](./0010-taxonomy-and-authoring.md) — keeps `order.json` as an order-only runtime
overlay, but adds a commit-time visibility guard.

## Context

ADR-0010 says `cocoder/priorities/order.json` does not define priority existence: runtime readers append
loadable `.md` priorities that are absent from the manifest. That preserves serving behavior, but it let
a real priority file become a hidden/ghost queue item when no manifest entry pointed at it.

## Decision

Every loadable priority under `cocoder/priorities/` must be visible by construction: it is either listed
in `order.json`, placed under `archive/` or `backlog/`, or named in the explicit allowlist for standing
non-queue items (`adhoc-session`).

`packages/daemon/src/priority-order.ts` owns this invariant through `findOrphanedPriorities`. The daemon
governance test runs that guard against the live `cocoder/priorities/` tree, so CI fails when a future
priority lands unlisted. Runtime `readPriorities` still follows ADR-0010 and appends unlisted priorities
instead of refusing to serve them.

## Consequences

- Priority creation and hand edits get a deterministic visibility guard without moving existence
  ownership out of the `.md` files.
- `order.json` remains an order-only overlay at runtime.
- Intentional non-queue priorities must be rare and named in the guard allowlist.
