---
id: 0042
title: Deb should default to live Oscar/Bob terminal observation
type: bug
status: Closed
priority: none
owner: deb
created: 2026-06-23
---

# 0042 - Deb should default to live Oscar/Bob terminal observation

## Context

During run_209, Deb was asked to diagnose a suspected Bob loop on atom 0. The only sanctioned observation
surface in Deb's prompt was `local/runs/run_209/deb-status.json`, which still showed Bob as `running` on
`monitoring builder on atom 0` while the file itself was stale by roughly 23 minutes. Deb could recommend an
Oscar nudge, but could not inspect the actual Bob terminal output that would have shown what Bob was doing.

That is the wrong default for escalation engineering. A stale status projection is useful triage metadata,
but it is not the primary evidence when the issue is "Bob is stuck in a loop." Deb's default should be to
read the live Oscar/Bob terminal evidence directly, with the status feed as routing and summary context.

Current owners that will need reconciliation:

- Deb base persona prompt: `packages/personas/base/deb.md` currently says the status feed "is your eyes" and
  forbids probing panes or run dirs.
- Dogfood Deb delta: `cocoder/personas/deltas/deb.md` repeats that Deb must use `deb-status.json` and never
  attach to panes or scrape run dirs.
- Shared host/process safety: `packages/personas/base/shared-standards.md` forbids driving `cmux` windows or
  panes by hand; the fix must preserve the process-safety intent while adding a read-only observation path.
- Runner/session-host surfaces own the actual panes/transcripts and must expose the safe read path; this
  should not be implemented as Deb improvising lifecycle commands from an agent pane.

## Acceptance

Deb has a sanctioned, default live-observation path for Oscar and Bob terminals during an active run:

- A Deb turn can inspect the current Oscar/Bob terminal transcript or read-only snapshot before deciding
  whether to nudge, triage, or repair. For live-loop diagnosis, terminal evidence is the default first
  artifact, and `deb-status.json` is supporting context rather than the sole observation surface.
- The path is read-only and owned by the runner/session host or another single control-plane owner. It must
  not require Deb to start, stop, restart, focus, close, or otherwise drive `cmux`, windows, panes, or daemon
  lifecycle.
- Deb's base prompt, dogfood delta, shared standards, and any runner/daemon prompt text are aligned so they
  no longer tell Deb to rely only on the status feed when live terminal evidence is available.
- Tests or a live proof show Deb can view Bob's current terminal output for an active run and that the same
  path cannot perform process/window lifecycle actions.
- The status feed remains useful for wait conditions, timestamps, fault dispatches, and nudge file routing,
  but it is no longer treated as a complete substitute for live terminal evidence.

## Notes

- Surfaced by the founder during run_209 after Deb correctly followed the current prompt and declined direct
  terminal inspection.
- This is not a request for ad hoc pane scraping from Deb prompts. The durable fix is a first-class,
  process-safe read surface for live terminal evidence, then prompt/runtime alignment around that owner.
- Related governance: ADR-0016 (Deb scoped repair fallback), ADR-0017 (Oz orchestration/tool surface),
  ADR-0036 (Oscar-Deb repair dialogue), and the host/process-safety section of shared standards.

## Resolution

Resolved by run run_217 (direct Deb repair commit in this change set) on 2026-06-24.

Added a runner/session-host-owned read-only Deb terminal snapshot for Oscar/Bob, made it the default live-loop evidence path, aligned Deb/base/dogfood/shared prompt text, and pinned the behavior with core and persona tests.
