---
id: oz-dashboard-bugs
title: Oz dashboard defect sweep (12 founder-reported bugs)
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
11. **Headless-Play→CLI binding warns for every CLI except codex** *(founder-reported 2026-06-15)* —
    binding a headless Play to any CLI other than codex raises **"Headless Play on an interactive-only
    CLI — would hang"**, blocking the bind. Founder position: **any CLI should be able to run headless**,
    so the warning misfires for all non-codex CLIs. Root direction: this is the `headlessCapable`
    capability **data** shipped with `plays-first-class` (commit `20260c4`), not the warning's render
    logic — the data marks too few CLIs headless-capable (note the tension with bug #1's claim that only
    `cursor-agent` runs headless and claude/codex are interactive-TUI-only; the capability table and the
    real adapter headless support must be reconciled to one source of truth). Fix the capability data so
    every CLI that can actually run headless is marked so; keep the ⚠️ only for genuinely
    interactive-only adapters. This does **not** reopen `plays-first-class` deliverable 4 (the warning's
    no-misfire negative test stands for a correct capability table); it corrects the capability inputs.
12. **Oz orchestrator fails routine edits — 3-tool action budget too low** *(founder-reported
    2026-06-15)* — asking Oz (headless orchestrator, bound to cocoder) to add bug #11 errored with
    **"Oz exceeded the 3-tool action budget for this message."** A routine governance edit (read the
    priority, edit it) exceeds the per-message tool-action cap of 3, so Oz cannot complete simple
    founder-directed priority edits. Root-cause the cap (raise it, or make the budget per-turn/adaptive
    rather than a hard 3 that fails the message). Turn logs:
    `local/oz/cocoder/turn-1.log`, `turn-2.log`, `turn-3.log`.

**Verified when:** each defect is fixed at the cause, renderer/daemon tests + proof scripts are green,
and the fixes are confirmed live on the running daemon. Follow-up design work is carried by
`plays-first-class` (catalog + permissions — archive-candidate, run_88/89; top-level Plays nav per
founder `12d2f0c`). The deferred dispatch-boundary question is resolved (`play-dispatch-boundary.md`);
optional follow-on is `hybrid-plays`.

## Status — run_103 (2026-06-16): ARCHIVED · founder-confirmed · code-complete

**Archived 2026-06-16 on the founder's explicit `archive` go-ahead** (the founder-owned acceptance gate;
no self-archive). All twelve defects are fixed at the cause; renderer/daemon tests + builds green. run_103
added no code — reaffirmed archive-candidate after run_94 landed the fixes, ran the machine proof
(`node scripts/proof-oz-surfaces.mjs` — daemon 194/194, UI 111/111, ENDPOINTS_OWED 8/10 served, remainder
bounded to the three live proofs), and archived on founder confirmation.

- **Landed run_94:** #2, #5, #7, #8 (recovered — see below), #11, #12.
- **Pre-fixed 2026-06-14, verified surviving in the live tree run_94:** #1, #3, #4, #6, #9, #10.
- **#12 closed via governance-authoring-plays (run_98):** Oz `author` collapses to one tool action; budget 3→10 with graceful degradation.
- **Rebuild-clobber (failure-catalog F21):** #2/#5/#7/#8 were fixed 2026-06-14, then silently reverted when the "Fusion" renderer rebuild (`2ccff89`) regenerated `packages/ui/app` from the frozen `design-ref/`. run_94 re-fixed them. `design-ref/` still holds the old `claude-code` id → **ticket 0007** (design-ref rebuild guard).
- **#11 scope:** capability data matches adapter reality (only `cursor-agent` runs headless today). The founder's "any CLI headless" is the unbuilt headless-adapter lane → **`headless-adapter-lane`** + **ticket 0006**, not a data flip (flipping would cause real hangs).

**Disposition:** `archived` (founder-confirmed 2026-06-16). Machine proof: `node scripts/proof-oz-surfaces.mjs` (daemon + UI suites green, ENDPOINTS_OWED ledger served). The three irreducibly-live founder proofs (Oz chat with a real CLI, one headless Oscar + Bob run, Q/A acceptance pass) were the founder's acceptance gate, cleared by the explicit `archive` go-ahead. Open follow-ons that do NOT reopen this priority: `headless-adapter-lane` + ticket 0006 (make "any CLI headless" real), ticket 0007 (design-ref rebuild guard, F21).
