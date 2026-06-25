---
id: ticket-priority-repoint
title: Ticket priority repoint — governed release and rehome at archive
---

## Objective

Add a governed write spine that can clear or repoint a ticket's existing `priority:` frontmatter (release
to standalone or rehome to another live priority), wire it into archive-priority reconciliation so the
founder-facing close / release / rehome options from ticket-launchability Phase C are one-click executable,
and prove close, release, and rehome paths without hand-editing ticket files or `order.json`.

**Verified when:**
1. A core primitive (symmetric to `createTicket` / `closeTicket`) repoints or clears `priority:` on an open
   ticket in one transactional operation (ticket file + `INDEX.md`; no silent queue mutation).
2. Archive confirmation can execute all three founder options: close via existing `closeTicket` spine,
   release to standalone, and rehome to a named live priority.
3. Tests prove no auto-close, no hand-edit paths, and standalone / other-priority / closed tickets stay
   unaffected.

**Boundary:** ticket `priority:` frontmatter mutation only. No new relationship fields, no launch-queue
changes, no changes to the Phase A/B launchability display helpers (already shipped on
`ticket-launchability`).

## Grounding

`ticket-launchability` shipped detect-and-surface at archive time: handled open tickets are listed with
explicit close / release / rehome options, but only **close** executes today (`requestReconciliationClose`).
Release and rehome require a new governed lane — `compose.ts` writes `priority:` only at creation;
`closeTicket` preserves it. Likely fits ADR-0040's reversible self-direct scope without a new ADR, but the
mutation spine itself is the deliberate build.
