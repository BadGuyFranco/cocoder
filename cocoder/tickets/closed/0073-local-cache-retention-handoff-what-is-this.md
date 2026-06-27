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
