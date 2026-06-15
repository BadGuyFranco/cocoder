---
id: oz-dashboard-priorities-pane
title: "Oz dashboard — the left column is the orderable priorities queue, not a runs list (design-ref)"
---

## Objective
The Oz dashboard's primary left column is the **drag-reorderable priorities queue** (top = next up)
defined by the authoritative design (`packages/ui/design-ref/`) — **not** a list of runs. Today it shows
runs down the side; that is the defect (founder-reported, 2026-06-14). Runs must appear only in their
designed places — expanded **inline under a *running* priority**, in the **run-detail drawer** (opened by
clicking a priority), and in the **pinned ad-hoc row** — never as the primary list.

**Verified when:** the founder opens the dashboard and sees the orderable **priorities** queue matching
`design-ref/` — priorities listed top-to-bottom, drag-to-reorder **persists** (the ADR-0010
`cocoder/priorities/order.json` manifest), a running priority expands inline and opens the run drawer on
click, the ad-hoc row pinned first — and **no runs-as-primary-list** anywhere. A renderer test (or
Quinn's `electron-test`) pins "the queue renders priorities, not runs" so it cannot silently regress.

**Boundary:** `packages/ui` renderer first; only the **minimal** `packages/daemon` model change if the
diagnosis shows priorities/`order.json` aren't reaching the renderer (e.g. a first-run / configured
flag). **No new daemon endpoints** — priorities list, create, and reorder/`order.json` are already
shipped (`full-oz-dashboard`). No orchestration/core changes.

## Context (operational — for the run, not founder-owned)
- The authoritative spec is `packages/ui/design-ref/` (the preserved claude.ai/design prototype;
  `dashboard.jsx` shows the `380px 460px 1fr` grid where column 1 IS the priorities panel and runs nest
  inside it). `docs/oz-design-brief.md` is only the historical input brief, not the design.
- A prior **design audit exists** at `packages/ui/design-audit-priorities-pane.md` (run_64) and a
  **rebuild already landed** (run_65). So start by **reproducing** the founder's "runs down the side"
  report and **diffing the current renderer against design-ref + that audit** — the likely cause is a
  regression, a data-seam gap (priorities / `order.json` not reaching the live renderer; note this
  install may still be on the legacy workspace-registry fallback), or an empty/first-run fallthrough
  that renders runs instead of the queue. Fix the root cause, not the symptom.
- **Reconcile with the current commit model (ADR-0023).** The pre-reset audit mapped
  `pending-landing` / non-merged runs to a `not-landed` founder-attention state; under direct-to-branch
  that state is now rare (opt-in isolation only). Sanity-check the adapter's `not-landed` /
  active-run-join handling against today's reality rather than assuming the pre-reset behavior.
