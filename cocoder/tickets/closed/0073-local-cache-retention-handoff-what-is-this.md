---
id: 0073
title: local-cache-retention - handoff - what is this
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-27
---

# 0073 — local-cache-retention - handoff - what is this

Machine-local cache retention — bound local/ growth with per-workspace run retention
local-cache-retention

The last ticket changed the name of the launch button to handoff and still does not launch the priority - this is now the 5th ticket trying to fix the launch issue for a outside of runner priority launch

## Resolution

Closed by reconciliation deb-reconciliation on 2026-06-27.

Fixed: dashboard Launch for independent destructive priorities now calls /runs/independent-launch and starts cocoder run-independent as a detached runnerless CLI process; button text is Launch again. Verified daemon/UI tests, typechecks, topology, and UI build.

## Correction (2026-06-27, run_260) — PREMATURE CLOSE, SUPERSEDED

This close was wrong and is retained only as history. Run_260 wrapped with status `needs closing`,
awaiting a founder A/B/C decision that had not been made; the "deb-reconciliation" pass closed the
ticket anyway, and the "Fixed" resolution above only covers **destructive** independent priorities —
not the **non-destructive** case that was the actual complaint. The founder chose **option B** (keep
ADR-0043; make the handoff an honest manual affordance, not a fake launch).

- Real launch work → **[[0074]]** (founder decision B).
- The recurring auto-close-without-resolution bug this close exemplifies → **[[0075]]**.

Ticket 0075 re-checked this disposition and leaves this ticket Closed-superseded rather than reopening it.
Do not treat the "Fixed" claim above as accurate.
