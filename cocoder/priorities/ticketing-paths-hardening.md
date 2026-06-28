---
id: ticketing-paths-hardening
title: Ticketing paths hardening — make ticket create/commit/index/binding/reconcile consistent and governed
---
## Objective

The ticket lifecycle is single-owner and self-consistent end to end. Specifically:

1. **No divergence.** A ticket's file, its `INDEX.md` row, and its `order.json` entry cannot drift apart
   — there is one source of truth (the files) with a governed reconcile that rebuilds the derived
   surfaces, pinned by a test that fails if any ticket appears in one surface but not another.
2. **One governed create/commit path that always works.** A ticket — and a post-wrap support edit — can
   be created and committed through a single governed path regardless of whether the daemon is live or
   down, and whether the run is daemon-managed or independent. No off-lane hand-edit fallback, no
   `commit-support` 404 on independent runs, no "daemon is live, refusing" dead-end with nowhere to go.
3. **Binding is deliberate; provenance is separate.** A ticket binds to a priority only when resolving it
   advances that priority's objective, and binding carries a one-line reason. Provenance (the creating
   run/priority) is recorded separately and never auto-binds. Standalone is the default (ticket 0086).
4. **Archive reconciles bindings.** Archiving a priority reconciles every bound ticket (repoint or close)
   so no ticket is left pointing at an archived priority.

**Verification:** a test suite over the create / commit / index / repoint / archive flows that fails on
any surface divergence or stale archived-priority link; plus the repo reaching a state where tickets
0082–0086 are consistently indexed and correctly standalone-or-bound with a binding note, and no ticket
links to the archived `local-cache-retention`.

## Context

This priority was created after a cascade of ticketing-path failures during run_279 (CoCoder run 137,
`local-cache-retention`). What began as "file a follow-up ticket" exposed that several ticket lifecycle
paths are broken or missing, and that the persona was pushed into off-lane hand-edits because the
governed paths refused or 404'd. The damage is real and currently visible in the repo (divergent
`INDEX.md`/`order.json`, tickets stale-linked to an archived priority). This needs planning and
orchestration, not another point patch.

## Known defects to wrap (the evidence)

1. **Provenance vs binding conflated** — `create-ticket` has one overloaded `priority:` slot; a ticket
   created during a run auto-binds to that run's priority, with no standalone default and no binding
   note. → ticket **0086**.
2. **Independent-run support edits can't commit** — `cocoder oz commit-support <runId>` returns
   `404 unknown run` for runnerless/independent runs, so post-wrap support edits strand. → ticket **0085**.
3. **No governed create path while the daemon is live** — `cocoder oz create-ticket` refuses
   (ADR-0041 anti-race) when the daemon is up, and no in-loop/persona-facing alternative is surfaced, so
   the persona resorted to a raw `Write` + `git commit` (off-lane). The only thing that worked was a
   hand-authenticated `POST /workspaces/<ws>/tickets` HTTP call.
4. **Surfaces diverge with no reindex** — the off-lane creation left 0083/0084/0085 present as files and
   (via a governance reorder) in `order.json`, but **absent from `INDEX.md`**. There is no governed
   "rebuild INDEX from files" reconcile to repair this.
5. **Repoint can't repair a divergent ticket** — `reconcile-repoint` throws when a ticket is missing from
   `INDEX.md`, so the governed spine cannot fix exactly the tickets that most need fixing.
6. **Archive leaves stale links** — archiving `local-cache-retention` did not reconcile its dependent
   tickets, so 0082–0085 still show a stale binding to the archived priority.

## Scope

- Decide the binding/provenance model (0086) and make it the one owner of "what priority does this ticket
  belong to," with standalone default and a binding note for genuine bindings.
- Make ticket create + support-commit work through one governed path across daemon-live/daemon-down and
  daemon-managed/independent runs (covers 0085 and defect 3).
- Add a governed reconcile that rebuilds the derived surfaces (`INDEX.md`, `order.json`) from the ticket
  files, and make `reconcile-repoint`/`reconcile-close` robust to pre-existing divergence (defects 4, 5).
- Make priority archive reconcile its bound tickets (defect 6).
- As immediate cleanup under this priority's first run: resolve the current concrete damage — repoint
  0082/0083/0084 to standalone, bind 0085 to this priority with a note, re-index the divergent tickets —
  through the hardened governed paths, not by hand.

## Out of scope

- Ticket **0083** (retention enable affordance) and **0084** (Oscar–Deb repair-dialogue prose-JSON 500)
  are *subjects* surfaced during the incident but are not ticketing-path defects; they stay standalone
  and are owned separately. Only their stale LCR links are cleaned up here.
- The retention engine itself (archived `local-cache-retention`).

## Acceptance

- The four numbered objective conditions hold, each pinned by a test.
- `INDEX.md`, `order.json`, and the ticket files agree for every ticket; a divergence test is red before
  the fix and green after.
- A support edit in an independent run commits through a governed path with a receipt (no 404, no strand).
- Creating a ticket while the daemon is live succeeds through a governed path with no off-lane fallback.
- Archiving a priority leaves zero tickets linked to it.
- Tickets 0082–0086 are consistently indexed and correctly standalone/bound; none links to
  `local-cache-retention`.

## Disposition — `archive-confirmation` (run_138, 2026-06-28)

All four numbered objective conditions are met and test-pinned: ticket files, `INDEX.md`, and
`order.json` stay consistent via governed reconcile; create and support-commit work across
daemon-live/daemon-down and daemon-managed/independent runs; binding is deliberate with
`binding-reason` separate from provenance; archiving a priority releases bound tickets. Tickets
0082–0086 are indexed and correctly standalone-or-bound; none links to archived
`local-cache-retention`. Founder archive reply (`archive` or `archive run_279` in Oz chat) is the
first-class closeout action. Do not relaunch this priority for build work — it would only produce an
empty reaffirmation wrap.
