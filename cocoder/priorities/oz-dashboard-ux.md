---
id: oz-dashboard-ux
title: "Oz dashboard — consistent card → modal → launch interaction for priorities, tickets, runs"
---

## Objective
The Oz dashboard presents **priorities, tickets, and runs** through **one consistent interaction
pattern**: a compact **card** (name + slug only — no description), a **detail modal** on click (full
info + where it stands), and a **launch affordance inside the modal** that closes the modal when fired.
Tickets gain **parity with priorities** — they are **reorderable** and **launchable** (a "launch fix"
button). **Verified when** all four behaviors below work in the running app, demonstrated on evidence
(screenshots or a run-through), with no regression to the existing run/launch plumbing:

1. **Priority cards show name + slug, not the description.** The card surfaces the identifier (title +
   `id`/slug); the long description moves into the detail modal.
2. **Clicking a priority opens a detail modal** (not just a card) containing enough to understand *what
   it is and where it stands* (objective/summary, status/disposition, recent run pointer if any) and a
   **Launch** button **inside** the modal; clicking Launch starts the run **and closes the modal**.
3. **Tickets reach parity with priorities:** a ticket card (name + slug), click → **detail modal** with
   the ticket body + status, a **"Launch fix"** button inside the modal (closes the modal on launch),
   and tickets are **reorderable** the same way priorities are (an `order.json`-style list for the
   tickets surface). *Boundary — see below:* the **ticket-fix run semantics** (what the fix run does,
   and moving the ticket `open/ → closed/` + `INDEX.md` on success) are owned by **`tickets-review`**;
   this priority owns the **card/modal/reorder/launch-button presentation**, and consumes
   `tickets-review`'s run trigger.
4. **Clicking a run opens a modal**, not the side panel. The run detail (currently `RunDetail.tsx`
   rendered as a side panel) renders in the **same modal pattern** as priorities/tickets.

**Likely homes (confirm before editing):** `packages/ui/app/sections/dashboard/Dashboard.tsx` (cards +
list), `packages/ui/app/sections/dashboard/RunDetail.tsx` (run detail → modal), `sections/modals.tsx`
(existing modal infra to reuse), and the priority/ticket card components + `app/adapter.ts`/`live.ts`
for the data the cards/modals consume. Reorder reuses the priority `order.json` mechanism
(`writePriorityOrder` in `priority-order.ts`) generalized to tickets.

**Launch mapping (design note, refine in-priority):** priority launch already exists
(`POST /runs {priorityId}`). A ticket "launch fix" has **no** dedicated run-target today — the simplest
mapping is an **adhoc/focused run** carrying the ticket as its task (`POST /runs
{priorityId: 'adhoc-session', task: <ticket fix brief>}`) rather than new run-target machinery; confirm
with the founder whether ticket-fix should be a first-class run target or ride `adhoc-session`.

## Boundary / single source of truth (ADR-0001 D4, global #7)
- **`tickets-review`** owns: the Tickets *surface as a workflow* (tab/list of `cocoder/tickets/**`) and
  the **ticket-fix run** (launch → fix → close ticket `open/ → closed/` + `INDEX.md` via the ADR-0023
  spine). **This priority does NOT re-own those.**
- **This priority** owns: the **presentation/interaction pattern** — card (name+slug), detail modal,
  in-modal launch button that closes on click, run-detail-as-modal, and ticket **reorder**. Where they
  intersect (the "launch fix" button inside the ticket modal), this priority provides the button +
  modal and *invokes* `tickets-review`'s run trigger.
- **Open governance question for the founder:** items 1/2/4 are clearly new; item 3 overlaps
  `tickets-review`. Either keep the split above, or **fold** item 3's UI into `tickets-review` and scope
  this priority to 1/2/4. Founder decides (recorded as the launch-time call).

## Conceptual note — are tickets just single-atom priorities? (founder's framing)
There is real truth to it: both are **launchable work items** that fit the same card → modal → launch
pattern, which is *why* the consistent interaction makes sense. But they stay **distinct types**: a
priority is a multi-atom, multi-session **Objective** with verification; a ticket is a focused
**single-atom / single-session** fix. Share the **UI pattern**, not the data model — do not merge them
into one type. A ticket-fix run is a small adhoc/focused run; a priority run is the multi-atom loop.

## Related
- Ticket [0014](../tickets/open/0014-oz-workspace-path-picker.md) — add-workspace path picker (same
  dashboard, separate concern).
- Symptom (run_131): a newly-committed ticket (`0014`) did **not** appear in Oz. The daemon's ticket
  reader serves `cocoder/tickets/open/**` live (verified: `readTickets` reads `open/`, no frontmatter
  required), so the file is correct — this points at the **UI not re-fetching the tickets list**, which
  is in scope here: the Tickets surface should reflect newly-committed tickets on reload.

## Status
**Draft — founder-directed, filed run_131 (2026-06-17).** Not yet launched. Needs an Objective
confirmation + the item-3 boundary decision above before a build run.
