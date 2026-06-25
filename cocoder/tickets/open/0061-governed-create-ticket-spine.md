---
id: 0061
title: Governed createTicket spine for tracked ticket filing
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-25
---

# 0061 - Governed createTicket spine for tracked ticket filing

## Context

Ticket close has a deterministic governed spine:
`closeTicket()` in `packages/core/src/tickets/close.ts` moves `open/` to `closed/`, flips status,
appends the resolution, prunes `order.json`, updates `INDEX.md`, validates the round trip, and returns
the exact file list for the governed commit.

Ticket create does not have the symmetric primitive. `composeTicketMarkdown()` in
`packages/core/src/tickets/compose.ts` only builds the markdown string. The actual tracked-ticket filing
pattern is still freehand: create `cocoder/tickets/open/NNNN-slug.md`, hand-edit `INDEX.md`, and hand-edit
`order.json`. The runner prompt in `packages/core/src/runner/prompts.ts` also tells Deb to create the
ticket file and update `INDEX.md` by hand.

That is the same uncontrolled queue-edit class ADR-0041 / 0055 closed on the ticket-close side, still
open on ticket creation.

## Evidence

`run_235` / workspace run 91 exposed the gap while filing ticket 0060:

- Deb created `cocoder/tickets/open/0060-orchestration-e2e-stalls-after-builder-artifact.md`.
- Deb hand-edited `cocoder/tickets/INDEX.md` and `cocoder/tickets/order.json`.
- The atom commit `a2155e9` flagged those queue edits as `out-of-scope-committed`.
- The final landing outcome reported the ticket files as committed out of lane, not held.

The live test for this ticket repeats the shape intentionally but obeys the interference rail: Deb
created this `.md` ticket and updated `INDEX.md`, but did not touch `order.json`. That leaves the ticket
un-enqueued until a founder action or the new governed spine reconciles it, which is exactly the defect:
there is no way for Deb to file a fully queued ticket cleanly without freehand non-`.md` queue access.

## Proposal

Add a governed `createTicket()` spine symmetric to `closeTicket()`:

- Allocate or accept the ticket id.
- Write `open/NNNN-slug.md` from the existing ticket markdown composer.
- Insert the `INDEX.md` open-ticket row.
- Append the id to `order.json` in one transactional operation.
- Validate that `readTickets()` sees the ticket as open with the expected metadata.
- Return the exact relative file list for the governed commit.

Then expose the spine through a thin CLI/op wrapper that mirrors `cocoder oz close-ticket` and the Deb
reconciliation-close operation. Issue logging by Deb/Oscar should call this spine instead of hand-editing
the queue.

This supersedes the naive fix of adding `cocoder/tickets/**` to every persona write scope. The spine keeps
the queue consistent by construction without reopening freehand queue access.

## Acceptance

- `packages/core/src/tickets/` exports a governed `createTicket()` primitive that writes the ticket file,
  inserts the `INDEX.md` row, appends `order.json`, validates the round trip, and returns the exact file
  list for commit.
- The daemon/CLI exposes a thin `cocoder oz create-ticket` path over that spine, with behavior and tests
  mirroring `cocoder oz close-ticket`.
- Deb escalation / issue-logging paths use the governed create spine instead of prompt instructions to
  hand-create `cocoder/tickets/open/NNNN-slug.md`.
- The create path is in-lane by construction for the commit gate, so the ticket file, `INDEX.md`, and
  `order.json` do not trip `out-of-scope-committed` when a persona files an orchestration bug.
- Regression coverage pins the `run_235` shape: filing a ticket during/after overseer diagnosis produces
  one governed create-ticket commit with the three expected files and no freehand queue edit.
- Existing `closeTicket()` behavior and the ticket order stale-entry guards remain green.

## Notes

- Related: ADR-0041, especially the D1/D5 actor-authority gaps and Deb interference rail.
- Related: 0055, which made Deb close/repair authority commit through governed paths instead of raw or
  out-of-sequence edits.
- Related: 0059, which added CLI coverage over existing governed close/create-priority spines; this ticket
  adds the missing ticket-create spine the CLI can safely wrap.
- Related: 0060, which records the `run_235` e2e stall and the atom commit's `out-of-scope-committed`
  queue sweep.
