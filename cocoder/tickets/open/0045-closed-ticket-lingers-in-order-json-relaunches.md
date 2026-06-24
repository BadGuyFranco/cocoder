---
id: 0045
title: A ticket closed off-spine lingers in tickets/order.json and gets relaunched as an active run
type: bug
status: Open
priority: oz-autonomy
owner: Deb
created: 2026-06-23
---

# 0045 — A ticket closed off-spine lingers in `tickets/order.json` and gets relaunched

## Context

Run_213 was launched against ticket **0044**, which was already fully fixed **and** closed. The run had
no build work; it only re-verified acceptance and diagnosed why a closed ticket became the active target.

Root-caused on primary artifacts:

1. **Off-spine close.** Deb-repair commit `2796bb5` ("guard Deb nudge feed event claims") shipped the
   0044 code fix **and** closed the ticket in the same commit by hand: it set `status: Closed`, moved the
   file to `closed/`, and edited `INDEX.md` — but it never called the `closeTicket()` spine
   (`packages/core/src/tickets/close.ts`). Evidence: the closed 0044 file has **no `## Resolution`
   section** (the spine always appends one via `appendResolution`), and `2796bb5` never touched
   `cocoder/tickets/order.json`.
2. **No prune ⇒ stale queue head.** `closeTicket()` is the **sole owner** of `order.json` pruning
   (`pruneTicketOrder`, close.ts:55-77; pinned by `packages/core/tests/tickets.test.ts:214` and
   `packages/daemon/tests/mutations.test.ts:855`). Because the spine was bypassed, `0044` stayed listed —
   at the **head** — of `cocoder/tickets/order.json`.
3. **No self-heal on the relaunch.** Run-selection picked `0044` off the queue head and launched
   run_213. On a ticket-launched run, `closeTicketAfterSuccessfulRun` (`packages/daemon/src/launcher.ts:424`)
   would normally close + prune via the spine — but `closeTicket()` returns `{ closed: false, reason:
   'already-closed' }` (the file is already in `closed/`), so the daemon logs `ticket-close-skipped` and
   **does not reconcile the stale `order.json` entry**. The queue stays dirty, so the closed ticket would
   relaunch on every subsequent selection.

The immediate stale entry was removed by hand this run (`bbe6943`, `cocoder/tickets/order.json`), which
breaks the relaunch loop but does not fix the class.

**Class:** `cocoder/tickets/order.json` can contain ids that are not open tickets, and nothing prevents,
reconciles, or detects that. This is the tickets-side counterpart of the priorities invariant guarded by
`findOrphanedPriorities` (ticket 0034 / ADR-0038) — but for the **inverse** failure (a *closed/absent* id
*in* the queue) and on the **tickets** queue, which has no equivalent guard.

## Acceptance

Pick the one-owner fix; do not patch selection callers independently.

1. **Self-healing reconcile (primary).** When a ticket-launched run finishes and the ticket is already
   closed, the daemon prunes any stale `order.json` entry for it instead of silently skipping. Concretely:
   make `closeTicketAfterSuccessfulRun` (or `closeTicket` itself) prune `order.json` idempotently even on
   the `already-closed` path, and commit it via the existing governance spine. A test pins: launching a run
   for a ticket whose file is already in `closed/` but whose id is still in `order.json` leaves
   `order.json` pruned after the run.
2. **Guard (belt-and-suspenders).** A governance test fails when `cocoder/tickets/order.json` contains an
   id that is not an **open** ticket (closed or missing) — the tickets-side analog of
   `findOrphanedPriorities`. Under normal operation it must never trip.
3. **Off-spine close prevention (upstream).** The Deb-repair lane must route any ticket closure through
   the `closeTicket()` spine (which prunes `order.json` and stamps `## Resolution`) rather than hand-moving
   the file. If a repair fixes the code, it must either close via the spine or leave the ticket open for
   the run-success close path — never hand-close. This is base-orchestration governance (the Deb persona /
   repair lane under `packages/personas/base/**` and the daemon repair path), so route it through a
   **verified run or Deb repair** with the relevant persona/repair tests, not a post-wrap support edit.

## Notes

- Read surfaces already tolerate this: `readTickets` orders open tickets and **ignores stale ids** (GET
  `/workspaces/:id/tickets`, `packages/daemon/tests/read-surfaces.test.ts:196`). The gap is that
  **selection/launch** does not reuse that open-only view, and the write side never reconciles. Fixing (1)
  closes the durable hole; consider also routing launch-selection through the same open-only owner so a
  closed id can never be selected by construction.
- The 0044 closed file is missing the spine's `## Resolution` section (it carries an equivalent hand-written
  closure note instead). Left as-is to avoid a duplicate; not worth a second owner.
- Relates to: 0034 (priorities-side `order.json` auto-registration), 0032 (closed; `findOrphanedPriorities`),
  ADR-0038 (order.json as order overlay), ADR-0036 (Deb repair lane). Touches `packages/core/src/tickets/**`,
  `packages/daemon/src/launcher.ts`, and Deb base governance — verified-run scope, per-atom verify gate
  applies.
