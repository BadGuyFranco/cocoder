---
id: fix-ticket-0013
title: Daemon auto-rebuild + idle-only reload after daemon-touching runs (ticket 0013)
scopeNarrowing:
  - packages/daemon/**
  - packages/core/**
  - scripts/**
  - docs/**
  - cocoder/tickets/**
---

> **Delivered 2026-06-22 (run_179).** Ticket
> [0013](../tickets/closed/0013-daemon-auto-rebuild-after-runs.md) closed. Mechanism in
> `packages/daemon/src/launcher.ts`; unit proof `packages/daemon/tests/daemon-auto-reload.test.ts`;
> live proof `node scripts/proof-daemon-reload.mjs`.

## Objective

After a run commits changes under `packages/daemon/**` or dependent `packages/core/**`, the live Oz
daemon rebuild-validates and reloads on idle — no founder `scripts/oz.sh restart`. **Verified when:**
(1) idle-only deferral pinned by test (no in-flight interruption); (2) build failures surface and leave
the prior daemon serving; (3) live curl proof of a newly-added route post-reload. **Disposition:**
`archive-candidate` — acceptance met; founder archive confirmation only.
