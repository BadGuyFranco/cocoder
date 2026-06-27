---
id: 0074
title: Independent-of-runner Launch — make it an honest manual handoff (founder decision B), not a fake launch
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-27
---

# 0074 — Independent-of-runner Launch: honest manual handoff (decision B)

## Context

Successor to ticket 0073 (the 5th churned ticket on the "Launch button doesn't launch an
independent-of-runner priority" complaint). Run_260 diagnosed the real situation; the founder then made
the call. This ticket records that decision and scopes the actual work.

**Root cause (verified by reading the code in run_260):**
- The dashboard button on an `independentOfRunner: true` priority calls `launchIndependentHandoff`
  → `POST /runs/independent-handoff` → `requestIndependentHandoff`
  (`packages/daemon/src/launcher.ts:459`). That function **only writes a markdown handoff file** with a
  copy-paste `cocoder run-independent <id>` command and returns 202 — it never spawns a run.
  `App.tsx` `doLaunch` (~:592) shows that command in a modal and toasts "Runnerless handoff created."
- A sibling `requestIndependentLaunch` (`launcher.ts:524`) *does* spawn, but **refuses any
  non-destructive priority** (409 `runnerless-handoff-required`), because per **ADR-0043** a
  non-destructive independent run opening the live SQLite store while the daemon is up would contend
  with it; only `destructive` priorities get scratch-store isolation and auto-launch.
- So "doesn't launch" is **ADR-0043 by design** for the non-destructive case. Tickets 0069–0072 renamed
  and re-presented within that model rather than naming the constraint to the founder.

**Founder decision (2026-06-27): option B.** This is a genuine edge case — only CoCoder-on-CoCoder runs
need a runnerless independent launch. We **keep ADR-0043 unchanged** (no auto-spawn for non-destructive
priorities, no widening of scratch-store isolation, no new ADR). Instead we make the handoff
**honest**: the UI must make unmistakably clear that it produced a command the founder runs manually —
it must not look like a launch/started run.

## ⚠️ Establish ground truth first

Run_260's wrap flagged **uncommitted working-tree edits** to the launch files (`launcher.ts`,
`routes.ts`, `App.tsx`, `live.ts`, `LaunchProgressModal.tsx`, `Priorities.tsx`,
`PriorityDetailModal.tsx`, and their tests) attributed to a "deb-reconciliation" pass — the same pass
that prematurely closed 0073 (see 0075). The closed-0073 resolution claims the button now calls
`/runs/independent-launch` and reads "Launch" again **for destructive priorities**. Before building,
the next run must read the **current** state of these files and reconcile committed vs working-tree vs
the 0073 close claim, so it is fixing reality and not a stale snapshot.

## Acceptance

- Clicking the button on a **non-destructive** `independentOfRunner` priority presents an unmistakable
  **manual-handoff** affordance: clearly labeled "copy this command and run it in a fresh terminal,"
  never framed as a started/launched/in-flight run, and never showing a false error state.
- The handoff surface shows the exact `cocoder run-independent <id>` command and the repo working
  directory, with copy-to-clipboard. Optional (founder nice-to-have): a one-click "open a terminal
  pre-filled with this command."
- The **destructive** independent path (real auto-spawn via `/runs/independent-launch`) is preserved
  and clearly distinct from the manual-handoff path.
- **ADR-0043 untouched** — no scratch-store-isolation scope change, no daemon auto-spawn for
  non-destructive priorities.
- Affected daemon + UI suites and typecheck green; a regression test pins the non-destructive button to
  the honest manual-handoff presentation (not a launch).

## Notes

- Do not reverse ADR-0043; option A (true one-click launch via always-on isolation) was explicitly
  declined by the founder as overkill for this edge case.
- The stray "local-cache-retention / bound local/ growth with per-workspace run retention" line from
  0073's title is unrelated to the launch complaint — file it as its own ticket only if that work is
  still wanted; it is **not** in scope here.
- Related: [[0075]] (why 0073 auto-closed unresolved), prior trail 0069/0070/0071/0072, ADR-0043
  (`cocoder/decisions/0043-runnerless-execution-shape.md`).
