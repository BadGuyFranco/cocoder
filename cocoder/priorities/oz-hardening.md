---
id: oz-hardening
title: "Oz hardening — first-class chat, self-refreshing run-state awareness, drag-to-ask context"
---

> **Drafted 2026-06-18 (founder request, run_134).** Objective below is Oscar's draft from the founder's
> four asks; **not yet founder-confirmed for launch.** Resolve the "Open questions" before the first run.

## Objective
Oz becomes a reliable, first-class operator surface. Its terminal reads like a real chat; its situational
awareness is a **live projection of active run/ticket state** rather than stale chat scrollback, so it can
refresh itself and report accurate status at any time; and the founder can drop any work item into it to
ask about that item.

**Verified when** the running app and targeted tests prove all of the following, with an **owner map
completed before implementation**:

1. **The Oz terminal is a first-class chat.** Oz responses render rich markdown (headings, lists, fenced
   code in monospace, inline code, links); streamed **reasoning is shown in a distinct, collapsible
   "thinking" affordance** separate from the final answer; and in-progress responses **stream** rather
   than appearing all at once. Demonstrated on a real Oz exchange in the running app.
2. **Oz self-compacts and rebuilds awareness from run state.** Oz can compact its own context on a
   frequency/threshold trigger **without losing operating accuracy**, because its working context is
   reconstructed from the durable active-run/session state — not from chat history. After a forced
   compaction, a `status` request returns an accurate, current summary of every active run/session.
   Verified by: force a compaction, then confirm Oz still reports correct active-run status.
3. **Drag a work item into Oz to ask about it.** A **priority, run, or ticket** can be dragged from the
   dashboard into the Oz terminal; it attaches as explicit context, and Oz answers questions scoped to
   that item ("where does this stand?", "what's blocking it?"). Demonstrated in the running app.
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
- **Coordinate item 1 with `workspace-segmentation`.** That priority owns the Oz terminal **panel layout
  and global controls**; THIS priority owns the chat **rendering quality** (markdown, thinking, streaming)
  inside that panel. Both touch `OzChat.tsx` — sequence them so they don't clobber each other.

## Related
- Ticket [0013](../tickets/open/0013-daemon-auto-rebuild-after-runs.md) and
  [0015](../tickets/open/0015-tickets-silently-dropped-without-frontmatter.md) — adjacent reliability gaps
  in the run/ticket pipeline; fold in or reference at owner-map time (item 4 likely subsumes them).
- Symptom (run_131): a newly-committed ticket (`0014`) did not appear in Oz — UI/Oz not re-fetching after
  an agentic commit. Squarely item 4.
- `workspace-segmentation` item 1 (Oz terminal panel) — sibling surface on the same component.

## Open questions for the founder (resolve at launch)
1. **"Shows thinking" depends on the Oz agent runtime emitting reasoning tokens** the daemon can forward.
   Confirm the underlying Oz CLI exposes a thinking stream; if not, item 1's thinking display is a
   separate enablement, not just a UI change.
2. **Self-compaction trigger** — time/frequency-based, token-threshold, or both?
3. **Drag-to-ask payload** — inject a cheap deterministic **summary** of the dropped item, or the **full
   file** (richer but heavier on Oz's context)?
