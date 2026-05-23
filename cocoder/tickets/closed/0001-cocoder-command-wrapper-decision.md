---
id: 0001
status: Closed
type: question
priority: v0.1-foundation
owner: founder
created: 2026-05-22
closed: 2026-05-23
resolution: Path B — Retire (terminal-only)
---

# 0001 — Restore or retire CoCoder `.command` double-click wrappers

## Context

CoBuilder shipped three macOS double-click wrapper scripts at the orchestration root:

- `cobuilder-build/orchestration/Launch-Orchestrator.command`
- `cobuilder-build/orchestration/ORCH DEBUGGER.command`
- `cobuilder-build/orchestration/Stop-Orchestrator-Run.command`

These were sizable zsh scripts that launched the orchestrator, the debugger, and the stop flow respectively. Double-clicking from Finder was an entry point alongside `pnpm exec cobuilder ...` for users who don't want to open a terminal.

CoCoder **intentionally dropped them** during the CoBuilder extraction (per the Sub-Playbook A extraction manifest; the `.command` files weren't on the port list). All CoCoder documentation and the Sub-Playbook E dogfood loop use `pnpm exec cocoder launch ...` as the documented invocation. The wrappers simply don't exist in this repo.

Sub-Playbook A audit §4 listed `launch-command.test.mjs` as port `E2.2e.12` with the note "port AFTER M4.3 path rename" — implicitly assuming the wrappers would be restored at some point. M4.3 closed 2026-05-22 evening, and the test port landed via PR #13 (2026-05-22 late evening). The ported tests assert behavior of the 3 wrapper files; with the files absent, 6 of 6 tests in `packages/core/tests/launch-command.test.mjs` are currently `test.skip()`'d.

## Acceptance

The founder picks one of three paths, applies it, and removes the skip markers (or removes the test file if "retire"):

### Path A — Restore the wrappers

- [ ] Borrow the 3 `.command` files from CoBuilder source: `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/{Launch-Orchestrator.command, ORCH DEBUGGER.command, Stop-Orchestrator-Run.command}`
- [ ] Scrub: binary name (`cobuilder` → `cocoder`), env prefix (`COB_ORCH_*` → `COCODER_ORCH_*`), paths (`cobuilder-build/orchestration/` → `packages/core/`, references to dogfood priorities, etc.)
- [ ] Drop the files under `cocoder/` at repo root (workspace-zone tracked; double-clickable by macOS Finder)
- [ ] Update `chmod +x` to make them executable
- [ ] Remove all 6 `test.skip` markers in `packages/core/tests/launch-command.test.mjs`; ensure `pnpm -F core test launch-command` is 6/6 green
- [ ] Update `docs/configuration.md` to document the double-click entry point alongside `pnpm exec cocoder ...`
- [ ] Sub-Playbook B's workspace template should ship these wrappers too so adopters get them via `cocoder init`

### Path B — Retire the wrappers + adapt the port

- [ ] Confirm with founder that `pnpm exec cocoder launch ...` is the only supported invocation going forward
- [ ] Delete `packages/core/tests/launch-command.test.mjs` entirely (6 skipped tests asserting nothing; no value remaining)
- [ ] Update `cocoder/priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md` E2.2e.12 entry to reflect "retired" rather than "ported"
- [ ] If any other ported test asserts wrapper presence, drop those assertions

### Path C — Restore wrappers later via Sub-Playbook B

- [ ] Defer the decision until Sub-Playbook B (workspace template + `cocoder init`) activates
- [ ] Sub-Playbook B's Witness section adds this ticket as input
- [ ] Keep `test.skip()`s in place; the comment block in the test file already points back to this ticket

## Notes

- **Estimated effort:** Path A ≈ 1-2 hour session (3 sizable bash scripts to scrub + dogfood). Path B ≈ 10 minutes. Path C ≈ 0 today, then Path A or B's effort whenever Sub-Playbook B activates.
- **Argument for A:** double-click wrappers are part of CoCoder's adopter promise ("solo builders, small teams" — many don't open terminals daily). CoBuilder shipped them; removing them is a real product downgrade.
- **Argument for B:** the wrappers are macOS-specific (v0.1 is macOS-first but this hardens that lock-in), they add ~600 lines of bash to maintain, and `pnpm exec cocoder launch ...` is a clean fallback.
- **Argument for C:** the v0.1-foundation priority is mid-Refine; locking in a wrapper-surface decision under autonomous-port pressure isn't where this decision belongs. Sub-Playbook B will encounter the same question and have more context.
- **Audit cross-reference:** Sub-Playbook A foundation plan E2.2e.12 task row + this ticket are mirrored; updating one should update the other.

## History

- 2026-05-22 — Ticket filed when Sub-Playbook E orchestration loop ported `launch-command.test.mjs` and surfaced the wrapper-absence as a strategic question (run `run-20260522T234016Z-febpfcrd`; Talia BLOCK + Bob PASS-accepting-the-block).
- 2026-05-23 — **Resolved: Path B (Retire).** Founder chose terminal-only as the v0.1 product stance. `packages/core/tests/launch-command.test.mjs` deleted; the 6 skipped tests are now gone (suite drops from 235 → 229 total, all passing). Sub-Playbook A foundation plan E2.2e.12 row updated to "Retired 2026-05-23". `docs/configuration.md` gains an explicit "Invocation" note clarifying CoCoder ships no double-click wrappers. Sub-Playbook B workspace template work (Item 3 of the v0.1 completion plan) inherits the terminal-only stance — no wrapper files in the template.
