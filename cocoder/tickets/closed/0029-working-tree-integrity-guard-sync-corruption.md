---
id: 0029
title: Pre-run working-tree integrity guard — detect sync-conflict / corrupted governance before a run
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-22
---

# 0029 — Working-tree integrity guard (sync-corruption resilience)

## Context
This repo lives on a Syncthing'd NAS, and that has bitten us repeatedly this arc:
- `wrap-up.md` arrived with **corrupted YAML frontmatter** from a sync round-trip and **clobbered repairs
  mid-session** — it broke the wrap-up Play loader (4 tests red) and cost a detour.
- Stray/half-synced files have appeared untracked in the working tree (`ripgrep-dependency-research.md`,
  others) during sessions.

A run launched over a corrupted governance file fails opaquely or mid-run. Ticket 0021-era loader hardening
(commit `825e073`) now makes a malformed frontmatter **name its file** when it throws — but a run still only
discovers the problem when it tries to load that file, partway in.

## Objective
A cheap **pre-run integrity check** that surfaces a corrupted/conflicted working tree *before* a run starts,
with a clear founder message, instead of failing opaquely partway through. Detect:
1. **Sync-conflict files** anywhere under the workspace (`*.sync-conflict-*`, `*.orig`, conflict markers) —
   especially under `cocoder/**` and `packages/**`.
2. **Malformed governance** the run will load — the personas/plays/priorities the launch resolves: a
   frontmatter that won't parse (reuse the loaders' now file-named errors; don't reimplement parsing).

## CRITICAL design constraint — do NOT re-block the founder (ADR-0029 lesson)
We *just* removed a founder-blocking launch gate (ADR-0029 — founder WIP self-heals, never refuses). This
guard must not reintroduce that anti-pattern. Therefore:
- **Refuse only on genuine, run-fatal corruption** — a governance file the run *must load* that won't parse.
  That is a hard stop *with the file named*, because the run would crash on it anyway.
- **Everything else WARNS, does not block** — stray sync-conflict files elsewhere, untracked files, etc. are
  surfaced as a clear pre-run notice; the launch proceeds.
- **Founder-overridable.** Even the refuse case takes an explicit override flag (mirroring `--strict-dirt`/
  `strictPreRunDirt`, ADR-0029) so the founder is never hard-stuck. The default protects; the override frees.
- Reuse the launch guard's existing structure; do not add a second pre-run gate lane.

## Verified when
- A workspace with a sync-conflict file launches with a **clear warning**, not a refusal.
- A workspace whose to-be-loaded persona/play/priority has corrupt frontmatter is refused **with the file
  named** (and proceeds under the override flag).
- A clean workspace launches with no new friction (zero false positives on valid governance — the same bar
  ticket 0024 set for the drift detector).
- Tests pin: warn-not-block for conflict files; refuse-with-filename for run-fatal corruption; override works;
  clean tree unaffected.

## Boundary
A pre-run *detection/surface* guard only — does not repair files (the founder/source machine resolves the
sync conflict), does not touch the commit spine, does not change what a run writes. Lower priority than
ticket 0013 (deploy gap); it does not block onboarding work. Pairs with the loader hardening (`825e073`).

## Resolution

Resolved by run run_180 (dea12b91b6fd568f93e70412b9d02d4610137666) on 2026-06-22.

Added the pre-run integrity guard to the existing launch path: sync-conflict/orig files and conflict markers surface as warning events while launch proceeds; loader-backed run-critical governance checks refuse with file-named errors by default; the CLI, daemon API, and dashboard expose allowPreRunIntegrityErrors as the founder override. Tests pin warning-only conflicts, fatal malformed governance, override behavior, and clean launch behavior.
