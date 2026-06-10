---
id: run-resolution-and-loop-reliability
title: Unjam the loop — land stranded work, build the run-resolution exit, fix directive-0, self-heal staleness
---

## Objective
Restore the loop's throughput by making **getting work out of a run** as reliable as doing work in
one. **Verified** when: (a) the stranded run_44–46 work is landed on trunk or explicitly discarded,
with their DB rows in a terminal state and worktrees GC'd; (b) a `pending-scope-decision` run can be
resolved through a sanctioned daemon operation (expand → commit held-back files / discard / close-as-
landed), exercised on real runs; (c) Oscar's launch prompt enforces the artifact-first rule so the
recurring `directive-timeout` fault class (runs 33/34/38/39/40) cannot recur from prompt ambiguity;
(d) a stale daemon with no runs in flight self-heals instead of refusing launches until a human runs
`oz.sh restart`; and (e) the Personas screen makes no untruthful claims — what persists, persists;
what is preview-only says so; runner honoring of run-mode/sub-agents is a drafted ADR for founder
review, not silently shipped. Boundary: multi-root workspace build-out (ADR-0007 v1 / Q2) is NOT in
scope — this priority only drafts the decision brief; the Oz-chat feature itself is not extended.

Raised by the founder (2026-06-09) after a whole-repo review: 46 runs → only 4 ever merged; runs
44–46 (the Oz-chat slice, built three times) parked in `pending-scope-decision` with commits stranded
on run branches; throughput fell 16 atoms/week → ~0. Root constraint is the unbuilt ADR-0015
decision-mechanics exit, compounded by directive-0 prompt ambiguity and the stale-daemon restart tax.

## Phases (executed top-to-bottom in the founder-directed session of 2026-06-09)
- **Phase 0 — Land the stranded work (hand archaeology, once).** ff-merge `cocoder/run_46`
  (recovered Oz-chat slice + `891a782` wrap fix + decision docs); cherry-pick run_45's docs-only
  commits (`7dd56a1`, `e570121` — slice record + priority-architecture-contract backlog stub);
  run_44 code stays abandoned (founder decision, run_46) — its multi-root docs commit (`0f47d73`)
  feeds the Phase 5 brief instead. Commit the finished `codex.ts --disable apps` working-tree change.
  Whole-tree verify (typecheck + all suites) before and after.
- **Phase 1 — Build the run-resolution exit (ADR-0015 §decision mechanics).** Daemon operation to
  resolve a non-completed run: `discard` (drop held-back changes, close), `landed-by-hand` (record
  trunk landing, close), `expand` deferred if it exceeds the slice. Terminal status + integration
  status recorded; worktree/branch released to existing GC; surfaced in the dashboard's pending list.
  Use it to close run_44 (discard), run_45/46 (landed-by-hand). Tests.
- **Phase 2 — Directive-0 reliability.** Add the artifact-first rule to the orchestrator launch
  prompt (the fix Deb's run_33 triage already specified): first action = write the directive JSON;
  never exit without one; if the priority lacks delegable work, write a wrap-up directive saying what
  founder input is needed. Test asserts the rule is present.
- **Phase 3 — Truthful persona config.** Keep run-mode/sub-agents as clearly-flagged previews (the
  banner already says so — sharpen it); wire nothing the runner ignores. Draft the runner-honoring
  seam ADR (run-mode = session visibility; sub-agents vs ADR-0005 Plays vocabulary) as
  **proposed**, for founder review.
- **Phase 4 — Stale-daemon self-heal.** Daemon-side (per founder decision 2026-05-30): when a launch
  is refused stale and zero runs are in flight, the daemon restarts itself safely (re-exec) instead
  of parking until a human notices. Never mid-run. Tests.
- **Phase 5 — Decision queue + briefs + closeout.** Surface "awaiting founder" (pending-scope-
  decision runs + open questions) at whatever depth is cheap on existing endpoints; draft the
  multi-root/Q2 decision brief (incorporating run_44's `0f47d73` record); SESSION_LOG entry; update
  this file's status; final report.

## Relationship to other priorities
- Completes the owed exit path from [ADR-0015](../decisions/0015-isolated-working-state-per-run.md)
  (`pending-scope-decision` mechanics were drafted, never built).
- Unblocks [`full-oz-dashboard`](./full-oz-dashboard.md) — its run_44–46 work is what's stranded.
- The Phase 3 seam ADR is the "persona mode/sub-agents runner-honoring gap" named in that priority.
