---
id: 0002
title: Add local-state export lane for isolated runs
type: bug
status: Closed
priority: isolated-working-state-per-run
owner: deb
created: 2026-06-08
closed: 2026-06-08
---

# 0002 — Add local-state export lane for isolated runs

## Context
Isolated run worktrees correctly protect the founder's checkout and make tracked source changes
commit-gated. They also created a bad runtime-state failure mode: ignored `local/` writes made inside a
run worktree did not land in git and did not propagate back to the install-local source of truth after
the run wrapped.

That was too restrictive for CoCoder's operating model. `local/` is intentionally untracked, but it is
still the home for durable install/runtime state such as workspace registry, settings, audit, run
records, and local caches. The fix keeps commit authority and runtime-state authority separate.

## Acceptance
- Runs have an explicit local-state export step separate from commit write-scope.
- Allowed local-state writes survive the run boundary into the canonical install/workspace `local/`
  location, while tracked source still goes through the existing commit gate.
- Blocked local-state writes are surfaced as `local-state-export` event data and are not copied.
- Teardown/orphan GC preserves worktrees with blocked or failed local-state exports.
- Tests prove that a run writing an allowed `local/` artifact in its isolated worktree makes that
  artifact available after wrap-up, that secrets are blocked, and that ordinary source commit scope
  remains unchanged.

## Notes
Implemented 2026-06-08:
- `packages/core/src/runner/local-state.ts` exports run-authored ignored `local/` files back to the
  canonical `local/` zone after verified integration.
- `packages/core/src/runner/runner.ts` records `local-state-export` / `local-state-export-failed` events.
- `packages/daemon/src/launcher.ts` blocks worktree GC when a local-state export has blocked files or
  failed, preserving the inspection artifact.
- `packages/core/tests/runner-worktree.test.ts` covers export of `local/settings.json` and blocking of
  `local/secrets/token`.
- `packages/daemon/tests/worktree-gc.test.ts` covers teardown preservation for unresolved blocked
  local-state exports.

Founder correction from the same incident: Deb should not be blocked from fixing this class by a narrow
CoCoder repair fence. The Deb dogfood persona now has broad CoCoder implementation repair authority for
diagnosed `cocoder-bug`s.
