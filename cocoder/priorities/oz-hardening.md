---
id: oz-hardening
title: "Oz hardening — first-class chat, self-refreshing run-state awareness, drag-to-ask context"
---

> **Drafted 2026-06-18 (founder request, run_134); design calls resolved by founder same day.** The three
> open design questions are answered and folded into the Objective below. **#1 in `order.json`**
> (run_155 re-rank; `workspace-segmentation` archived).

## Objective
Oz becomes a reliable, first-class operator surface. Its terminal reads like a real chat; its situational
awareness is a **live projection of active run/ticket state** rather than stale chat scrollback, so it can
refresh itself and report accurate status at any time; and the founder can drop any work item into it to
ask about that item.

**Verified when** the running app and targeted tests prove all of the following, with an **owner map
completed before implementation**:

1. **The Oz terminal is a first-class chat.** Oz responses render rich markdown (headings, lists, fenced
   code in monospace, inline code, links); in-progress responses **stream** rather than appearing all at
   once; and **when the Oz runtime exposes reasoning tokens, they render in a distinct, collapsible
   "thinking" affordance** separate from the final answer — **show-thinking-if-available**, gracefully
   absent when the runtime emits none. Demonstrated on a real Oz exchange in the running app.
2. **Oz self-compacts on an orchestration-count setting and rebuilds awareness from run state.** A
   setting **"Oz Auto Compact at N Runs"** (**default 3, range 2–10**) triggers Oz to compact its own
   context after every N orchestrated runs; compaction **does not lose operating accuracy** because Oz's
   working context is reconstructed from the durable active-run/session state, not chat history. (A
   token-threshold trigger — ~200k — may back this up *if feasible*, but the runs-count setting is the
   primary mechanism.) After a compaction, a `status` request returns an accurate, current summary of
   every active run/session. Verified by: set N low, drive N runs, confirm Oz compacts and still reports
   correct active-run status.
3. **Drag a work item into Oz to ask about it.** A **priority, run, or ticket** can be dragged from the
   dashboard into the Oz terminal; it attaches as a **lightweight pointer — the item's file path with its
   slug shown** in the chat (not the full file body) — and Oz answers questions scoped to that item
   ("where does this stand?", "what's blocking it?"). Demonstrated in the running app.
4. **Oz picks up status changes automatically.** When a priority session reaches **wrap/teardown** and
   when a **ticket is added agentically** (committed under `cocoder/tickets/open/`), Oz's awareness
   updates **without a manual nudge**: the completed run's outcome and the new ticket are reflected on the
   next refresh and Oz can report them. This closes the run_131 symptom (newly-committed ticket `0014`
   did not appear in Oz) and the broader "Oz misses post-completion status" gap.

## Boundary / single source of truth (ADR-0010, durable-orchestration rule)
- **Owner map required before implementation:** name the source of truth for Oz's run-state projection,
  every surface that renders Oz messages or status (daemon Oz loop, `OzChat.tsx`, the status feed), and
  the tests/fixtures that pin them. Fix the owner and align consumers — do not add a parallel contract.
- **Items 2 & 4 share one engine.** Oz's awareness is a projection of durable run/ticket state. Build
  that projection **once**: item 2 is the refresh/compact read path, item 4 is the change-detection path.
- **Item 1 touches `OzChat.tsx`.** `workspace-segmentation` (archived run_139) owns the Oz terminal **panel
  layout and global controls**; THIS priority owns the chat **rendering quality** (markdown, thinking,
  streaming) inside that panel. Coordinate at owner-map time so they don't clobber each other.

## Related
- Ticket [0013](../tickets/open/0013-daemon-auto-rebuild-after-runs.md) and
  [0015](../tickets/open/0015-tickets-silently-dropped-without-frontmatter.md) — adjacent reliability gaps
  in the run/ticket pipeline; fold in or reference at owner-map time (item 4 likely subsumes them).
- Symptom (run_131): a newly-committed ticket (`0014`) did not appear in Oz — UI/Oz not re-fetching after
  an agentic commit. Squarely item 4.
- `workspace-segmentation` item 1 (Oz terminal panel) — sibling surface on the same component.

## Resolved design calls (founder, run_134)
1. **Thinking display is best-effort:** *show-thinking-if-available*. Render reasoning when the Oz runtime
   emits it; degrade silently when it does not. Item 1 must not block on a thinking stream existing.
2. **Compaction trigger = orchestration count, exposed as a setting.** **"Oz Auto Compact at N Runs"**,
   default **3**, range **2–10**. This is the primary trigger (the founder's preferred shape). A ~200k
   token-threshold may supplement it *if feasible*, but is not required. Implies a **new settings field** —
   audit the settings surface at owner-map time so it is one owner, not a parallel toggle.
3. **Drag-to-ask attaches a pointer, not the body.** The dropped priority/run/ticket is injected as its
   **file path with the slug visibly shown**; Oz reads the item by reference. Keeps Oz's context cheap.
