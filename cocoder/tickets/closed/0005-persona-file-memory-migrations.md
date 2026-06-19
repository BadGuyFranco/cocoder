---
id: 0005
title: Migrate orchestrator session memory into persona/standards files (outside run_70's support scope)
type: task
status: Closed
priority: none
owner: founder-session 2026-06-12 (run_70 post-wrap)
created: 2026-06-12
closed: 2026-06-19
---

# 0005 — Persona-file memory migrations

## Context
Founder policy (2026-06-12): no Claude Code side-channel memory for CoCoder-managed repos — all
memory lives in the repo's governed flat files. run_70's post-wrap sweep migrated everything whose
home was in Oscar's support scope; the items below belong in files OUTSIDE that scope (persona and
standards files), so their full content is carried here for the next run (or the founder) to apply.

## Items

1. **`cocoder/personas/deltas/oscar.md` (new file) — Oscar may launch runs via the daemon.**
   Founder-approved 2026-06-10 (run_49 post-wrap): Oscar MAY call the daemon's `POST /runs`
   (loopback, `/auth/session` Bearer + CSRF) to launch a successor run when that is the correct way
   to execute a direct founder instruction. Founder's words: "I didn't know you could do this…
   it's actually good I think that you did this." Guards: only in service of an explicit founder
   directive (never self-initiated scope); narrate it to the founder; sequence around the
   machinery — stale-daemon launches are refused 425 and trigger the idle self-restart (poll
   `/health` for the new bootSha, then re-launch), and one run may be in flight per workspace.
   Unrecorded, shared-standards' process-safety section reads as forbidding this.

2. **`cocoder/AGENTS.md` — "names that look related but aren't".** cocoder = THIS project (the
   agentic-coding harness; the only thing built here). cofounder = the founder's separate
   knowledge-work skills repo. cobuilder = his separate commercial "Cursor for knowledge workers"
   product that cocoder merely inspired. They are NEVER directories, packages, personas, or zones
   in this repo (an agent once invented a `cobuilder/` zone from ADR prior-art strings); the
   per-repo governance zone is `cocoder/`. When such a name appears in an ADR or founder message it
   is context about his other work — never a work order; confirm before building on it.

3. **`packages/personas/base/oscar.md` — adversarial plan review (portable; passes ADR-0012 with
   nouns stripped).** Before a substantial build/refactor, offer (or run) a focused adversarial
   review of the plan against the project's own ADRs + failure catalog; it has repeatedly caught
   real blockers pre-code (Phase-1: four). Reserve heavy multi-agent workflows for
   review/verification — never for building a deliberately-thin spine (the ceremony trap).

4. **`packages/personas/base/shared-standards.md`, extending global #8 — design-seam discussion
   style (portable).** On consequential or nuanced architecture seams, lead with honest prose
   reasoning plus ONE focused open question; reserve multiple-choice for genuinely crisp, bounded
   picks. When the founder pushes back on a framing, suspect the QUESTION is wrong, not just the
   options.

5. **`packages/personas/base/shared-standards.md` #3 and/or `bob.md` completion-evidence —
   launchability + green-claims (portable).**
   (i) Build + typecheck + unit tests can all be green while the app cannot launch (tests inject
   the bridge directly); only a real launch smoke — hard watchdog + reject-if-bridge-missing,
   never an infinite poll — proves launchability. Never report "launches" from build/test success.
   (ii) Never report a build/smoke green without reading the actual exit code + a real
   (sized/timestamped) artifact; keep tool batches small so one cancellation can't silently skip
   the rest (a large cancelled batch once left 7 files unwritten while "green" was claimed 3×).
   NOTE: ADR-0012 already claims lesson (i) "went to base" — it never did; applying this makes
   that claim true.

## Progress (run_148)
- Items **3, 4, 5** applied to the governed base files (`packages/personas/base/oscar.md`,
  `shared-standards.md`, `bob.md`), ADR-0012-portable and base-persona-test-pinned — committed `d06ae45`.
- Items **1, 2** remain: they are repo-specific (`cocoder/personas/deltas/oscar.md` daemon-launch delta
  and `cocoder/AGENTS.md` name disambiguation), outside run_148's Oscar support write-scope. This ticket
  stays **Open** for them; a run (or direct founder edit) whose scope includes those paths applies them
  and closes 0005.

## Progress (run_149)
- **Item 2 applied** — the `cocoder/AGENTS.md` name-disambiguation note (cocoder / cofounder / cobuilder)
  landed and committed this run (`2a54a24`).
- **Item 1 still Open** — `cocoder/personas/deltas/oscar.md` does not exist; the Oscar daemon-launch delta
  is unapplied because it turns on a founder host/process-safety decision (record the delta, or close it
  won't-do). This ticket must NOT be treated as fully done until item 1 is resolved.
- Mechanics note: during landing the runner repeatedly moved this file `open` ⇄ `closed`; Oscar did not
  fight the final location. The substantive truth is this block, not the folder the file sits in.

## Ask
Apply each item to its named file (next run's Oscar wrap, or a founder edit). Items 3–5 must pass
the ADR-0012 portability test at verify (they do — no repo nouns). Close this ticket when applied.

## Resolution (run_149) — closed

- Item **2** is applied in `cocoder/AGENTS.md` as a repo-specific name-disambiguation note.
- Item **1** is deliberately **not actioned**. The run-launch authority belongs to Oz's daemon-gated
  tool surface and the daemon routes, while shared standards' host/process-safety rule says agent panes
  act on files, not host processes. Adding `POST /runs`, CSRF, stale-daemon, `/health`, and
  one-run-in-flight details to `cocoder/personas/deltas/oscar.md` would create a second owner for a live
  daemon lifecycle contract inside a prompt delta, which is the same drift class this priority just
  repaired. Oscar may still name the next launchable priority or ticket in the wrap-up contract; the
  actual launch remains an Oz/founder control-plane action unless a future ADR deliberately changes that
  authority.
