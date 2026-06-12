---
id: workspace-onboarding
title: "Fresh-workspace onboarding — two first-class flows (deferred: after full-oz-dashboard completes)"
---

## Objective
Onboarding a new workspace into CoCoder is a **designed product flow, not a hand-scaffold**. Two
distinct flows, both operated from Oz:

1. **Brand-new primary root** — the target folder is empty/new: CoCoder initializes the repo and
   the `cocoder/` governance zone and the workspace is launch-ready immediately.
2. **Existing-code primary root** — the target repo already has code: onboarding runs a **full
   repo audit + review** and **ingests the findings into the `cocoder/` zone** (repo instructions
   into `cocoder/AGENTS.md`, candidate priorities, architecture notes) so CoCoder starts informed,
   not blind.

**Verified** when a real repo is onboarded through each flow end-to-end from the dashboard and the
first launch on each succeeds with zero hand-scaffolding. Boundary: builds ON the run_62
workspace-create scaffold (assignments + adhoc template + AGENTS.md/CLAUDE.md pointer); honors the
**workspace-footprint contract** — CoCoder's ONLY entry into a target repo is the `cocoder/`
folder; `local/` exists ONLY in the CoCoder install; never a README.

**Why this exists (founder, 2026-06-12):** CoPublisher — the first real non-dogfood workspace —
was hand-scaffolded and immediately surfaced three dogfood-coincidence bugs (failure-catalog F12:
stale-gate repo, missing governance scaffold, worktree placement) plus contract violations (a
README, a `local/` dir in the target repo). The founder reset CoPublisher entirely; it is the
intended first onboarding target once this priority runs. Sequencing is founder-set: **complete
`full-oz-dashboard` first**, then this.

## Status
Backlog — not yet scheduled. Prerequisites tracked in `full-oz-dashboard.md` next-slice items
(0a) worktree placement fix and (0b) AGENTS.md/CLAUDE.md scaffold additions. The Objective above
is a DRAFT for the create-priority flow; it still needs the founder's explicit go-ahead and an
ADR-conflict pass (ADR-0019 workspaces model, ADR-0007 multi-root, the workspace-footprint
contract) before delegation.
