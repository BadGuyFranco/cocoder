---
id: 0081
title: local-cache-retention unlaunchable
type: bug
status: Closed
priority: none
owner: founder-session
created: 2026-06-28
---

# 0081 — local-cache-retention unlaunchable

local-cache-retention is unlaunchable - showing error "
Launching “Machine-local cache retention — bound local/ growth with per-workspace run retention”…

Launch needs attention.

Priority "local-cache-retention" may impair the daemon runner machinery that would run it."

This tickt's only job is to repair the priority so that we can launch it directly from the dashboard - it should be in a close enough state in order to not interfere with itself

## Resolution

Closed by reconciliation founder-confirmation-run_278 on 2026-06-28.

Resolved-by-oz-repair (46c602c): priority frontmatter restored to independent-of-runner:true + destructive:true, so dashboard Launch routes to the runnerless+isolation path (ADR-0043/0044). Verified by code path; no new code needed.
