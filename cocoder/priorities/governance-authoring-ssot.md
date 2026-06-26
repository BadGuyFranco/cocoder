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
- **Ticket closure:** close tickets 0063, 0066, and 0065 through the governed close path once the SSOT
  queue/founder-decision behavior and the nested run-dir completion are verified.

## Notes

- The `create-ticket` Play should become a content/input-gathering facade or be retired from write
  authority; it must not hand-describe `open/NNNN.md`, `INDEX.md`, or `order.json` writes.
- The same standard applies to `create-priority`, `edit-priority`, and `archive-priority`.
- For 0065, execute the founder-chosen ADR-0027 §6 nested layout path: `localRunDir()` nesting,
  migration of existing flat dirs, compat read-fallback, and verification that existing run details
  still load.
