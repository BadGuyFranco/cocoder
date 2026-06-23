---
id: fix-ticket-0032
title: Ghost/hidden priority — orphan visibility guard (ticket 0032)
scopeNarrowing:
  - packages/daemon/**
  - cocoder/decisions/**
  - cocoder/tickets/**
---

> **Delivered 2026-06-23 (run_51 / run_195).** Ticket
> [0032](../tickets/closed/0032-hidden-priority-no-order-json-entry.md) closed. Guard in
> `packages/daemon/src/priority-order.ts` (`findOrphanedPriorities`); governance tests pin the live
> `cocoder/priorities/` tree; invariant in ADR-0038.

## Objective

Every created priority is visible by construction — no ghost file without an `order.json`, archive,
backlog, or explicit allowlist entry. **Verified when:** a test fails on an orphaned priority file and
passes once registered/placed; the live priority tree stays clean; existing orphans are scheduled.
**Disposition:** `archive-candidate` — acceptance met (guard path); founder archive confirmation only.
Optional authoring-time registration is a separate founder-gated follow-up, not required for archive.
