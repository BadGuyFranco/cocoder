---
id: ui-package-layout-stabilization
title: "Stabilize packages/ui source layout and retire design-ref as live regeneration source"
---

> **Drafted by Grok** — This priority was initially constructed by Grok (Grok Build AI coding harness) during a structured codebase review. It requires further review, validation, refinement, and explicit ownership by the founder / Oscar as the **first step** before any scoping or implementation work.

## Objective
Eliminate the persistent topology warnings from `scripts/check-topology.mjs` for `packages/ui`, stop design-ref regeneration from silently reverting hand-applied fixes (F21), and make the UI package structure follow the same maintainability standards as the rest of the monorepo.

Concretely:
- Decide and implement a single source of truth for the renderer + electron main/preload source (either move everything under a proper `src/` layout that the topology checker accepts, or explicitly carve out the Electron app as an allowed exception with a documented rule).
- Mark or remove `packages/ui/design-ref/` as a live regeneration source. Any future regeneration must be one-directional from the hand-maintained tree or explicitly disabled.
- Ensure `out/` build artifacts are never treated as source (they are already in .gitignore patterns in practice but still trigger warnings).
- Update any regeneration scripts / BUILD_PROMPT.md / electron.vite config as needed.
- All existing UI fixes and features remain (no functional regression).

**Verified when:**
- `node scripts/check-topology.mjs` runs clean with zero warnings from `packages/ui` (or the remaining warnings are intentional and documented in the script or ADR).
- A controlled "rebuild from design-ref" attempt (if the mechanism is kept at all) no longer clobbers recent commits in `packages/ui/app` or `packages/ui/electron`.
- The UI can still be developed (dev mode) and built (production) exactly as before.
- New UI work follows the chosen layout convention.

**Boundaries:** This priority touches only layout, topology guard, and regeneration process. It does **not** redesign the Oz UI, change component architecture, or alter Electron IPC contracts.

## Context & Evidence
- F21 (failure-catalog.md): A wholesale "rebuild the renderer against the V1 design" commit reverted multiple previously fixed bugs because `design-ref/` was used as the source of truth.
- `scripts/check-topology.mjs` produces ~40 warnings specifically for files living in `app/`, `electron/`, `design-ref/`, `out/`, and `tests/` instead of under a `src/` tree.
- Other packages strictly follow `packages/<name>/src/`. The UI package is the only persistent violator.
- `packages/ui/BUILD_PROMPT.md` and `design-ref/README.md` still reference the regeneration flow.
- This noise makes the guardrail less effective and hides real topology issues.

## Suggested Next Action (for Oscar / founder)
After scoping, delegate an audit pass over `packages/ui/` layout options, produce a short decision, then execute the structural move + guard updates + removal of regeneration path. Verify with a clean topology run + full UI test + real dev/build cycle.