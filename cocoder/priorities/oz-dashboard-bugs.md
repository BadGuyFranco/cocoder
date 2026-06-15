---
id: oz-dashboard-bugs
title: Oz dashboard defect sweep (10 founder-reported bugs)
---

> **Founder-directed 2026-06-14** — a focused defect sweep on the Oz dashboard (`packages/ui`), run as
> a direct founder+Opus debugging session (not a launched run). Root-caused against the authoritative
> design (`packages/ui/design-ref/`) and the ADR-0023 commit-spine model. Captured as a priority per
> CoCoder's model (dashboard defects become focused priorities).

## Objective

Reproduce, root-cause, fix, and verify the following founder-reported dashboard defects. Fix the cause,
not the symptom; verify with renderer tests (`cd packages/ui && npm test`), a `pnpm --dir packages/ui
build`, the proof scripts, and live against the running daemon.

1. **Oz chat is not a natural-language agent** — every non-command falls back to the command list.
   Root: `oz` absent from `assignments.json` (gates the NL agent path); and only `cursor-agent` runs
   headless today (claude/codex adapters are interactive-TUI-only). Fix: assign Oz→cursor-agent now;
   add a claude headless build path next.
2. **Priorities rows too verbose** — show number + name + status chip only (drop the summary line).
3. **P02 "unclickable" while P01 runs** — this is the intended single-writer-per-workspace lock
   (ADR-0004/0023), not a bug. Fix legibility: disable Launch with a reason when a run is active.
4. **CLIs report "do not enumerate models"** — ship curated per-CLI model lists; keep free-text.
5. **Persona order** — canonical: Oz, Oscar, Bob, Deb, Talia, Quinn.
6. **Models not selectable** — downstream of #4 (free-text input → dropdown once enumerable).
7. **Plays as sub-agents / cross-persona Plays** — relabel "Sub-agents" → "Skills (Plays)" + validation
   now; the first-class catalog + permission surfacing is its own priority (`plays-first-class`).
8. **Stale "pending daemon endpoint" banners** — Settings banner is factually wrong (settings ARE
   served); remove it. Personas banner is mostly stale; rework to an accurate, calm note.
9. **Compact density / reduce motion are no-ops** — wire both to actually take effect.
10. **No "Restart Oz" control** — wire `POST /daemon/restart` through the IPC bridge + add a button.

**Verified when:** each defect is fixed at the cause, renderer/daemon tests + proof scripts are green,
and the fixes are confirmed live on the running daemon. Follow-up design work is carried by
`plays-first-class` (catalog + permissions) and a deferred ADR (adversarial/dynamic Plays).
