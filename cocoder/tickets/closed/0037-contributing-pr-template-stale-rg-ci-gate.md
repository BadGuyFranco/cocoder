---
id: 0037
title: CONTRIBUTING and PR template still promise an rg CI gate that live ci.yml no longer runs
type: bug
status: Closed
priority: none
owner: Bob
created: 2026-06-23
---

# 0037 — CONTRIBUTING and PR template still promise an rg CI gate that live ci.yml no longer runs

## Context

Run_57 (`ripgrep-dependency-research`) found a real doc/CI mismatch independent of the rg dependency
policy choice: `CONTRIBUTING.md:26` and `.github/pull_request_template.md:24` tell contributors to expect
an `rg` stale-reference CI gate, but live `.github/workflows/ci.yml` no longer installs or runs `rg`
(old stale-reference gates were deleted). Evidence:
`cocoder/runs/57-run_201/ripgrep-usage-evidence.md:21`-`22`, `56`-`57`; recommendation:
`cocoder/runs/57-run_201/ripgrep-recommendation.md:32`-`33`.

Founder research recommends treating `rg` as **optional** (developer/agent convenience, not a declared
dependency). Launch this ticket-fix after the founder confirms that policy (or states required /
auto-detected in the launch message so acceptance wording can follow).

## Acceptance

- `CONTRIBUTING.md` local-gate section matches live CI: install, typecheck, tests, topology — no promise
  of an `rg` gate CI does not run.
- `.github/pull_request_template.md` checklist matches the same live checks.
- If founder adopts **optional** policy: describe `rg` as a manual convenience for stale-reference
  searches (POSIX `grep` / `git grep` acceptable); do not imply CI runs `rg`.
- If founder chooses **required** or **auto-detected** instead, revise both surfaces accordingly and
  note any follow-on install/CI work as out of scope for this Surface-A doc fix unless explicitly
  scoped in the launch message.
- No change to live `.github/workflows/ci.yml` unless the founder explicitly scopes CI work in the
  launch message.

## Notes

- Research artifacts: `cocoder/runs/57-run_201/ripgrep-usage-evidence.md`,
  `cocoder/runs/57-run_201/ripgrep-recommendation.md`.
- Failure mode if `rg` ever re-enters a shell gate without install: bash `if rg ...` exit 127 reads as
  "no match" and silently no-ops the gate — any future rg gate must install rg first or fail closed.

## Resolution

Closed by reconciliation deb-reconciliation on 2026-06-28.

Already reconciled — no fix needed. CONTRIBUTING.md and .github/pull_request_template.md already match live .github/workflows/ci.yml (install, typecheck, lint, test, topology); neither promises an rg stale-reference gate. The only 'rg' reference left is a historical comment in ci.yml noting the v1 stale-reference gate was retired. Verified by grep over CONTRIBUTING.md, the PR template, and ci.yml during run_276.
