---
id: governance-authoring-ssot
title: Governance authoring SSOT + active-run queue
---
## Objective

Make ticket and priority authoring one deterministic governance operation per action, with every surface
(dashboard, CLI, Oz chat, Oscar/Deb, runner escalation, and authoring Plays) acting only as a transport
or input-gathering layer. Founder requests made while a run is active are accepted immediately, surfaced
as queued/pending, and committed at the earliest safe run boundary rather than refused or silently held
until wrap. Mid-run founder decisions are handled in-context and allow the run to continue when a
concrete next atom remains. Verified when tickets 0063, 0066, and the stranded 0065 run-dir ticket are
closed through the governed ticket-close path, with tests proving queued governance authoring, one SSOT
write path, and the run_245 premature-wrap regression.

## Context

This priority folds three related failures into one launchable owner:

- **0063:** ticket/priority authoring during an active run is refused or unclear instead of queued and
  surfaced.
- **0066:** Oscar wrapped run_245 for a founder decision even though the founder decision could have
  happened mid-run and Bob could continue with the next atom.
- **0065:** run_245 left the run-dir ticket incomplete after a preparatory atom because the founder
  decision was treated as a stop condition. The founder has since chosen the nested ADR-0027 §6 path;
  this priority must carry that ticket to closure too, so the regression is repaired against a real
  stranded ticket rather than only a synthetic test.

The design rule is stricter than "use the same helper where convenient": there is one owner per
governance authoring action. A Play may gather or refine structured input, but it must not restate file
formats, `INDEX.md` rows, `order.json` updates, id allocation, validation, or commit behavior as a
second procedure.

## Required Owner Map Before Code Edits

The first atom must be read-only except for a concise owner-map note if one is needed for handoff. Do
not start by patching prompt text. Produce a concrete map of the current owners, emitters, edge cases,
and pinning tests, then implement from that map.

Minimum surfaces to inspect and account for:

- **Ticket create:** core owner candidates `packages/core/src/tickets/create.ts`,
  `compose.ts`, `loader.ts`, `index-helpers.ts`; emitters/consumers in
  `packages/daemon/src/routes.ts` (dashboard/API), `packages/cli/src/create-ticket.ts` and
  `packages/cli/src/run.ts`, runner escalation in `packages/core/src/runner/triage.ts`, and the
  `create-ticket` Play.
- **Ticket close/repoint/order:** `packages/core/src/tickets/close.ts`,
  `packages/core/src/tickets/repoint.ts`, daemon ticket close/repoint callers, ticket launch
  auto-close, `cocoder/tickets/order.json`, and `cocoder/tickets/INDEX.md` mirroring.
- **Priority create/edit/archive/order:** core priority loader/composers, daemon priority create route
  and order route, `requestAuthoringPlay`, Oz chat `author`, CLI create/edit/archive wrappers, and the
  `create-priority`, `edit-priority`, and `archive-priority` Plays.
- **Active-run and commit seams:** `launchRun`/`inFlight` guards, `requestAuthoringPlay` active-run
  refusal, atom verify/pass/fail commit sequence, Oscar support commit, wrap-up commit, run-end history
  commit, wrap audit, and Deb status/watch projections.
- **Dashboard/Oz visibility:** ticket and priority read surfaces, pending/queued state projection, Oz
  chat confirmation text, and the current behavior when a daemon is live but no run is active.

Use `docs/orchestration-contract-ownership.md` as the starting map, but verify against the live code. If
that doc is stale, fix the owner first or file a narrow follow-up before changing runtime behavior.

## Edge Cases To Preserve Or Decide

- Id allocation and reservation for queued ticket creates: prefer assigning the final id at queue time
  so the founder can reference it immediately; if that is unsafe, define the temporary queued id and
  final-id handoff explicitly.
- Ticket collisions across open, closed, `INDEX.md`, and `order.json`; stale order ids; already-closed
  close requests; missing-open-ticket close/repoint; and existing `repointTicket()` no-op behavior.
- Priority id collisions, invalid ids, Objective presence, `order.json` registration, orphan detection,
  active-vs-backlog/archive placement, already-archived archive requests, and archive no-op honesty.
- Active run states: running builder atom, verifying, failed atom, rejected atom/quarantine,
  awaiting-founder, awaiting-archive-confirmation, held, stopped, failed, and normal wrap.
- Commit ordering: queued governance commits must be ledgered and must not be mistaken for raw
  out-of-band commits by wrap audit or run-history projection.
- Failure behavior: if queued governance creation cannot commit at the next seam, it remains visible
  with an error/retry state; it must not silently disappear and must not strand half-written governance
  files.
- Prompt/Play cleanup: remove duplicate file-writing instructions only after deterministic operations
  and tests exist. A Play may ask clarifying questions or shape structured input; it may not be the
  writer of record.
- Ticket 0065 is a regression fixture and completion obligation, not the architectural center. Do not
  let run-dir migration concerns distort the governance-authoring queue design.

## Acceptance

- **Single writer per action:** ticket create/repoint/close and priority create/edit/archive each have
  one deterministic operation that owns validation, file composition, index/order updates, round-trip
  checks, events, and commit behavior.
- **Transport-only surfaces:** dashboard routes, CLI commands, Oz chat tools, Oscar/Deb requests,
  runner escalation, and authoring Plays call those operations or submit structured input to them. No
  Play or persona prompt contains an alternate file-writing contract for tickets or priorities.
- **Active-run queue:** when a founder submits ticket/priority authoring while a run is active, the
  daemon accepts it immediately, returns a durable visible queued receipt, and shows it in the dashboard
  as pending/queued instead of refusing or failing silently.
- **Earliest safe commit:** queued governance authoring drains at the first safe seam (after the current
  atom verify/commit or fail handling, before the next Oscar directive when possible), not only at full
  run wrap. The commit is ledgered so wrap audit does not treat it as an out-of-band mystery commit.
- **Mid-run founder decisions:** the runner/Oscar contract distinguishes "ask founder now, then
  continue" from "wrap awaiting founder." A founder answer during the run can unblock the next concrete
  atom without losing Bob context or ending the run.
- **Regression pins:** tests cover the run_245 shape: a preparatory atom commits, a founder choice is
  needed, the answer is accepted in-context, Atom 2 is delegated, and the ticket closes only after the
  actual remaining work is verified.
- **Existing edge cases stay pinned:** existing tests for ticket create/close/repoint, priority
  create/order/archive, authoring Play dispatch, wrap audit, and ticket-fix launch remain green; add
  missing tests before relying on behavior that is currently unpinned.
- **Ticket closure:** close tickets 0063, 0066, and 0065 through the governed close path once the SSOT
  queue/founder-decision behavior and the nested run-dir completion are verified.

## Notes

- The `create-ticket` Play should become a content/input-gathering facade or be retired from write
  authority; it must not hand-describe `open/NNNN.md`, `INDEX.md`, or `order.json` writes.
- The same standard applies to `create-priority`, `edit-priority`, and `archive-priority`.
- For 0065, execute the founder-chosen ADR-0027 §6 nested layout path: `localRunDir()` nesting,
  migration of existing flat dirs, compat read-fallback, and verification that existing run details
  still load.

## Continuation — elegance cleanup (founder-directed 2026-06-26, do NOT archive until done)

The SSOT/queue objective above is met and verified (run_246, 9 atoms; 0063/0066/0065 closed). The
founder directed an elegance-cleanup pass before archive. Relaunch this priority and delegate these as
verified atoms (each: correctness first, then minimum surface; keep all suites green):

1. **One run-dir resolver, one name.** Delete `localRunDirById` and the alias
   `localRunDirById as resolveLocalRunDir` (packages/daemon/src/{rundir,launcher,oz-context-pointer}.ts,
   packages/core/src/runner/run-dir.ts + index). Every read-by-id caller already passes `{missing:'null'}`
   i.e. wants the real `resolveLocalRunDir`; import it directly. One owner, one name, fewer concepts.
2. **Consolidate the queue receipt/union.** `QueuedAuthoringReceipt` grew to several variants incl. a
   bare `{queuedId,status}`, and `QUEUE_SCHEMA_VERSION` accreted v1→v3. Tidy the receipt to one shape and
   confirm the entry union reads as designed-once; keep the loud old-version rejection.
3. **First-class mid-run governed ticket-close.** The 0063/0066/0065 closures had to run through a
   throwaway scratchpad script because the queue only drains post-wrap and the CLI refuses mid-run. Add a
   verify-gated path to close a ticket through the governed `closeTicket` op from inside a run (so
   closures commit and verify at the gate, no scratchpad workaround). Design atom first.

Out of scope here: the physical run-dir migration + retiring the legacy fallback is owned by ticket 0067
(runs once no active run references the flat shape). Do not fold it in.
