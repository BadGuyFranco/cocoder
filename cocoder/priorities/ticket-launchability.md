---
id: ticket-launchability
title: Ticket launchability signals
---

## Objective

Make the existing ticket `priority:` frontmatter reference a trustworthy launchability signal in the
workspace tickets panel, so standalone open tickets are clearly launchable, tickets handled by a live
priority are clearly marked as not direct-launch targets, and stale priority links are surfaced for
founder decision without adding any duplicate field.

## Grounding

The ticket-to-priority link already exists. The ticket `priority:` frontmatter field is a reference to a
priority id, not a priority level. Values across the existing tickets are real priority ids such as
`oz-autonomy`, `orchestration-e2e-test`, and `tickets-review`; `none` and `unassigned` mean standalone.

This work is surface, validation, and lifecycle behavior on the existing field. Do not introduce
`resolvedBy`, `handledBy`, or any other duplicate field. The `priority:` field is the single owner of
the relationship.

Known current surfaces:

- `packages/core/src/tickets/loader.ts` loads `priority:` into `Ticket.priority`.
- `packages/ui/src/renderer/adapter.ts` carries `priority` into the renderer ticket model.
- `packages/ui/src/renderer/sections/dashboard/Dashboard.tsx` currently shows priority as a selected
  ticket detail row, but not as an immediate launchability signal in the ticket card list.

Founder goal: a founder glancing at the workspace tickets panel can instantly tell which open tickets to
launch directly and which are handled by a priority and should ride that priority instead. The signal
must be trustworthy.

## Constraints

- Reuse the existing ticket read path, frontmatter field, UI ticket model, and dashboard ticket panel.
- Do not add a parallel store, schema, field, relationship table, or write-back copy of the relationship.
- Make the smallest clean change that reads like the surrounding code.
- Ship Phase A first, behavior-preserving.
- Each phase must be verified before the next phase begins.
- Relate implementation to the existing `priority:` convention, the governed close/create spines from
  tickets 0055 and 0059, and ADR-0040's bounded governance write lane.

## Phase A - Surface (View Only)

Surface the existing `priority:` link as a launchability signal in the tickets panel.

Requirements:

- In `packages/ui/src/renderer`, update the tickets panel owned by `Dashboard.tsx` / `App.tsx` /
  `adapter.ts`.
- Render standalone tickets as launchable.
- Treat `priority: none`, `priority: unassigned`, blank, and null as standalone for this view-only phase.
- When a ticket has an associated priority, show a small tag under the ticket description/title area
  reading exactly:

  `Handled by Priority: [priority tag]`

- The tag must appear under the ticket description/title in the ticket card list, not only inside the
  selected-ticket detail modal.
- Phase A must not change launch behavior yet. It only makes the existing relationship visible.

Verification gate:

- Add or update a UI test, likely under `packages/ui/tests/dashboard-awaiting.test.tsx`, that pins both
  cases:
  - an owned ticket renders the exact `Handled by Priority: [priority tag]` tag,
  - a standalone ticket does not render that tag.
- Run the focused UI test.
- Run UI typecheck.

## Phase B - Integrity (Make The Signal Trustworthy)

Derive ticket launchability by cross-checking the existing `priority:` value against live priorities.

Requirements:

- Use live priorities from `cocoder/priorities` and `order.json` as the source of truth for whether a
  referenced priority is live.
- Normalize `none`, `unassigned`, blank, and null to one standalone state.
- If `priority:` names a live priority, classify the ticket as handled by that priority: handled, do not
  launch directly.
- If `priority:` names a missing, archived, or otherwise non-live priority, classify the ticket as a stale
  link and surface:

  `⚠ stale link`

- Treat stale-link tickets as standalone-needing-rehome or founder-decision items. Do not silently treat
  them as safely handled, and do not silently auto-launch them without surfacing the stale state.

Verification gate:

- Add tests for:
  - live priority link -> handled by priority,
  - stale or orphaned priority link -> stale link,
  - `none` / `unassigned` / blank / null normalization -> standalone.
- Add or update UI coverage proving the stale warning renders.
- Run focused UI tests and any adapter/model/core tests touched by the derivation.
- Run affected package typecheck.

## Phase C - Lifecycle (Keep It Honest Over Time)

When a priority is archived or completed, reconcile the tickets it handled.

Requirements:

- Tie into the existing archive-priority flow.
- When archiving a priority, detect open tickets whose `priority:` points at that priority.
- Surface those handled tickets for founder decision.
- Default to surfacing for a founder decision, not auto-closing.
- Founder decision options should be explicit:
  - close handled tickets through the governed ticket-close spine,
  - release them back to standalone by clearing/repointing `priority:` through a governed path,
  - rehome them to another live priority.
- Do not hand-edit ticket files, `INDEX.md`, or `order.json`; use governed spines and ADR-0040-style
  bounded write lanes.

Verification gate:

- Add coverage proving that archiving a priority with handled open tickets reconciles or surfaces those
  tickets.
- Test that no handled ticket is silently left appearing covered by an archived priority.
- Test that no handled ticket is auto-closed without founder approval.
- Test that standalone tickets are unaffected.
- Run affected core/daemon tests.
- Run root typecheck.

## Implementation Notes

- Prefer one small pure helper for launchability derivation, fed by existing `Ticket.priority` and live
  priority ids.
- Keep display copy compact and operational; this is a dashboard signal, not explanatory prose.
- Preserve the existing ticket creation and close contracts.
- Preserve direct ticket launch for true standalone tickets.
- The exact founder-required tag text is:

  `Handled by Priority: [priority tag]`

## Non-Goals

- Do not add `resolvedBy`, `handledBy`, or any duplicate relationship field.
- Do not create a new ticket schema.
- Do not create a new launch queue.
- Do not auto-close handled tickets when their priority archives.
- Do not make Phase A depend on Phase C.
