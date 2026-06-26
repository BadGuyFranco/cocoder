---
id: founder-facing-run-identity
title: Founder-facing run identity — speak [workspace] run N, not the DB id
---

> **Archived 2026-06-25 (founder) — archive confirmed.** Founder confirmed archive from CLI.

## Objective

Every founder-facing surface and every actor (Oscar, Bob, Deb, Oz, and read-only observers) refers to a run by its per-workspace display number ('CoCoder run 98' / 'workspace run 98'), never the internal runner DB id (run_242). The display number is the primary label in the workspace Runs tab, and that tab is renamed from 'Runs/Sessions' to just 'Runs'. The technical id stays in durable records only.

## Context (the bug)
The runner carries two identifiers for one run: the internal DB id (`run_242`) and the per-workspace display number (`98`). The display layer already exists — `runDisplayName()` renders "workspace run 98" (`packages/core/src/store/portable/display.ts:11`), and `displayNumber` is computed and threaded through `packages/ui/src/renderer/adapter.ts`, `packages/daemon/src/oz-awareness.ts`, and `packages/daemon/src/run-display.ts`. But the technical id still leaks into the live conversational surface — agent/persona language, Oz chat, and status output reference `run_242` — so when the founder says "#98" and an agent says "run_242," they cannot align. Commit labels already carry both ("via CoCoder workspace run 98 (technical id: run_242)"), which is the right pattern for a durable record; the live surface should lead with the display number the same way.

Motivating example: in the session that surfaced this, the dashboard showed "CoCoder #98" while the observer/agents referred to "run_242" — the founder and the system could not share one reference.

## Scope
1. One shared run-reference vocabulary. All founder-facing language uses "[workspace] run [N]" (e.g., "CoCoder run 98") as the primary handle. Update persona prompts/instructions (Oscar, Bob, Deb) and Oz's chat/awareness output to refer to runs this way. The technical id is demoted to an optional parenthetical for debugging only — never the primary handle. Consider making `runDisplayName` emit the actual workspace name ("CoCoder run 98") rather than the literal word "workspace run 98," so the [workspace] slot is real.
2. Surface the display number in the Runs tab. The workspace panel's Runs list shows the founder-facing number ("run 98") as each run's primary label (it already computes `displayNumber`/`runDisplayName`), with the technical id available but secondary.
3. Rename the tab. `packages/ui/src/renderer/sections/dashboard/Dashboard.tsx:74` — `label: 'Runs/Sessions'` → `label: 'Runs'`.

## Acceptance
- No founder-facing surface leads with `run_<n>`: persona prompts, Oz chat/awareness, the dashboard run list, and status/feed text all reference runs as "[workspace] run N".
- The Runs tab shows each run's display number prominently and is labeled exactly "Runs".
- The technical id remains recorded and queryable (commit labels, `run.json`, ledgers) but is never the primary conversational handle.
- A test pins (a) the tab label and (b) the run-list primary label to the display number, so the regression can't silently return.

## Out of scope / do not regress
- Keep the technical id in durable records — commit messages, `run.json`, event ledgers — including the existing "(technical id: run_XXX)" suffix; it is needed for forensics and DB joins. This priority changes the primary surface, not the record of truth.
- Do not renumber existing runs or change how `displayNumber` is allocated.
