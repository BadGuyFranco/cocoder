---
id: ripgrep-dependency-research
title: Research ripgrep as a CoCoder dependency
---

> **Archived 2026-06-23 (founder) — researched — redundant.** Findings: `rg` should remain optional and
> should not be declared as a CoCoder dependency today. There is no live `rg` usage in `packages/**`,
> `scripts/**`, runtime code, or tests; no `@vscode/ripgrep`/ripgrep package or lockfile dependency; and
> live CI does not install or run `rg`. Current reliance is manual/docs/run-evidence only. The available
> agent CLIs already carry their own search capability (Codex's `codex-path/rg` is vendored ripgrep
> 15.1.0 here), while this machine has no standalone system `rg` outside that vendored path, so adding a
> CoCoder dependency would be redundant. Follow-up doc/CI mismatch is tracked by ticket 0037.

## Objective

Determine whether CoCoder should treat `ripgrep` (`rg`) as a required, optional, or auto-detected dependency across local development, CI, and agent-run verification workflows; verified by a short recommendation with evidence from current repo usage, install/onboarding impact, cross-platform availability, fallback behavior, and any code/docs changes needed. This priority is research-only and should not add or enforce a dependency until the founder approves the recommendation.
