---
id: oz-dashboard-ux
title: "Oz dashboard — consistent card → modal → launch interaction for priorities, tickets, runs"
---

## Objective
The Oz dashboard presents **priorities and runs** through **one consistent interaction pattern**: a
compact **card** (name + slug only — no description), a **detail modal** on click (full info + where it
stands), and a **launch affordance inside the modal** that closes the modal when fired. (Tickets adopt
the *same* pattern but are owned by [`tickets-review`](./tickets-review.md) — folded out per the founder,
run_131.) **Verified when** the behaviors below work in the running app, demonstrated on evidence
(screenshots or a run-through), with no regression to the existing run/launch plumbing:

1. **Priority cards show name + slug, not the description.** The card surfaces the identifier (title +
   `id`/slug); the long description moves into the detail modal.
2. **Clicking a priority opens a detail modal** (not just a card) containing enough to understand *what
   it is and where it stands* (objective/summary, status/disposition, recent run pointer if any) and a
   **Launch** button **inside** the modal; clicking Launch starts the run **and closes the modal**.
3. **Tickets** — **FOLDED into `tickets-review`** (founder decision, run_131). Ticket↔priority UI parity
   (card + slug, detail modal, in-modal "Launch fix" button that closes on launch, reorderable tickets)
   and the **create-ticket Play** now live in
   [`tickets-review`](./tickets-review.md). Tickets reuse the **same** card/modal/reorder pattern this
   priority establishes for priorities — they just aren't owned here. No ticket work in this priority.
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
- **RESOLVED (founder, run_131):** item 3 (all ticket UI: card/modal/launch-fix/reorder) **+ a
  create-ticket Play** are **folded into `tickets-review`**. This priority is scoped to items **1, 2, 4**
  (priority card slug, priority detail modal, run-detail-as-modal). Tickets reuse the card/modal/reorder
  pattern defined here but are owned there.

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
**Code-complete (items 1, 2, 4 + run_133 polish) — archive-candidate, gated on live visual proof.** Built
in run_133 (2026-06-18); polish in run_134 (`c355c40`); item-3 boundary already resolved (founder,
run_131 — folded into `tickets-review`).

- **Item 1 — priority card = name + slug** ✓ committed `e22b2a0`. `PriorityRow` shows the title plus a
  muted-mono slug (`priority.id`); the description no longer renders on the card.
- **Item 2 — priority detail modal + in-modal launch** ✓ committed `e22b2a0`. New
  `PriorityDetailModal.tsx` (reuses the `Modal` primitive) shows summary/status/labels and a recent-run
  pointer; a footer **Launch** fires the existing launch path and closes the modal; respects the
  single-writer `launchBlocked` guard.
- **Item 4 — run detail as modal** ✓ committed `c58b77e`. `RunDetail` now renders inside `Modal`
  (width 840); the dead 460px side-panel grid column was removed; all three run-open triggers and the
  status-adaptive footer actions (stop/attach/teardown/ask-oz/retry/re-run) preserved.

- **Run_133 polish (founder) — ad-hoc Launch label + Oz hint removal** ✓ committed `c355c40` (run_134).
  `AdhocPriorityRow` button relabeled `Launch run` → `Launch` with an `aria-label`; persistent Oz
  daemon-commands footer hint removed from `OzChat.tsx`.

**Evidence so far:** full UI suite green (124/124) across all atoms, verified by Oscar on the actual diffs.
**Remaining gap to archive:** the Objective's live-proof clause — screenshots / a run-through in the
running app — which is a founder/live step (Oscar does not launch the app; host-safety).

**Known follow-up (pre-existing, out of this priority's scope):** `tsc` is red on `main` because
`RunStatus` (`packages/ui/app/model.ts`) lacks `'not-landed'` while three test files reference it; this
predates run_133 and was not introduced here. Worth a ticket.
