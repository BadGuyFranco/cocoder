---
id: daemon-auto-restart
title: "Daemon auto-restart — never silently run stale orchestration code (deferred: not yet scheduled)"
---

## Objective
CoCoder **never silently runs stale orchestration code**. When a commit advances repo HEAD past the
code the long-lived daemon loaded at boot, the daemon picks up the current code **on its own** — no
human has to remember `scripts/oz.sh restart`. **Verified** when, after HEAD moves ahead of the
daemon's loaded SHA while idle, the **next launched run executes current orchestration logic** (not
boot-time code) with no manual restart, **and** this refresh **never interrupts or orphans a run in
flight** (it only ever happens when nothing is running). The daemon **stays headless and
lifecycle-independent of the UI** — Electron may *trigger* a refresh but is never *required* for one,
and the daemon must survive the app closing. Boundary: the staleness-refresh mechanism only; **not**
folding the daemon's control plane into the Electron/UI process (see the headless-substrate decision
below).

**Why this exists:** the stale-daemon trap silently burned three consecutive runs (run_19/20/21) — the
daemon served boot-time `runner.ts` while the fix sat committed on disk, so wrap-up silently took the
old path and produced no proof. run_21 (commit `9b04a09`) added a partial guard — the wrap-up now
*fails loud* on a stale daemon instead of faking a closeout — but that is a seatbelt, not the fix:
atoms and the verify-gate still run stale code silently, and a human still has to remember to restart.

**Hard constraints (founder-set, 2026-05-30):** the daemon is the always-on **substrate** so that
"literally anything" — cron, other agents, CI, a future fully-agentic driver — can run CoCoder with
no UI open. So the auto-restart guard must live **daemon-side / `oz.sh`-side**, restart **only when no
run is in flight**, and never couple the daemon's life to the dashboard. This boundary has ADR weight
(it shapes the daemon↔UI seam) — **record an ADR when this is built.**

**Two candidate approaches (decomposition is run-time, not fixed here):** (1) *cheap seatbelt* — a
restart-when-idle guard that bounces the daemon when stale-and-idle (it already exposes its boot SHA at
`/health` and emits a `daemon-stale` event); (2) *root-cause fix* — runs execute as fresh subprocesses
(like the `cocoder run` CLI path already does), leaving the daemon a thin always-on control plane, so
orchestration code is never stale. The orchestrator picks the approach at run time.

**Deferred — not blocked on a hard dependency; simply sequenced after current work.** Authored now so
the intent and constraints aren't lost. Promote out of `backlog/` with a `git mv` when scheduled.
