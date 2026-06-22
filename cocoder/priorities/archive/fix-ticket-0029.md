---
id: fix-ticket-0029
title: Pre-run working-tree integrity guard (ticket 0029)
scopeNarrowing:
  - packages/core/**
  - packages/cli/**
  - packages/daemon/**
  - packages/ui/**
---

> **Code landed 2026-06-22 (`dea12b9`, founder identity) — outside run_180's atom gate.** Ticket
> [0029](../tickets/closed/0029-working-tree-integrity-guard-sync-corruption.md) closed in-place
> (`d02b4a0`). Run_180 wrap-up (`run_180`) blocked on founder confirmation.

## Objective

Cheap pre-run integrity check before launch: sync-conflict/orig/marker files **warn** (launch proceeds);
run-critical governance the loader must parse **refuses with file named** (override via
`allowPreRunIntegrityErrors`, mirroring ADR-0029's `strictPreRunDirt`). **Verified when:** warn-not-block
for conflicts; refuse-with-filename for fatal corruption; override works; clean tree unaffected; real
launcher path proven (not fake thunks only). **Disposition:** `blocked` — feature committed; founder
must confirm out-of-gate landing intent, accept-as-is vs end-to-end proof harness, and any ticket-close
convention reconciliation.
