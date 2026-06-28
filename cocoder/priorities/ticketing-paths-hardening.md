---
id: ticketing-paths-hardening
title: Ticketing paths hardening — make ticket create/commit/index/binding/reconcile/close consistent and governed
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
5. **Close is atomic, governed, and completion-driven.** Closing a ticket either fully lands (file moved
   to `closed/`, `status: Closed` set even when the source ticket has no `status` line, `order.json`
   pruned, `INDEX.md` row moved to Recently Closed, committed) or makes NO change at all — never a
   partial, uncommitted, divergent half-close. A run closes the tickets its priority verifiably completes
   through the governed close path at wrap, with NO founder-confirmation gate for a verified-complete
   close; a priority is not `archive ready` while any ticket it has resolved remains open. The close gate
   (ticket 0075) blocks only genuinely ambiguous/premature closes — work or a founder decision still
   pending — not verified-complete ones.

**Verification:** a test suite over the create / commit / index / repoint / archive / **close** flows
that fails on any surface divergence, stale archived-priority link, or partial/non-atomic close (closing
a ticket that has no `status` line must land cleanly; a forced mid-close failure must leave zero changes,
not a divergent half-close); plus the repo reaching a state where this priority's own resolved tickets
0085 and 0086 are CLOSED with stamped resolutions, tickets 0082–0084 are consistently indexed and
correctly standalone, and no ticket links to the archived `local-cache-retention`.

## Context

This priority was created after a cascade of ticketing-path failures during run_279 (CoCoder run 137,
`local-cache-retention`). What began as "file a follow-up ticket" exposed that several ticket lifecycle
paths are broken or missing, and that the persona was pushed into off-lane hand-edits because the
governed paths refused or 404'd.

Run 138 (2026-06-28) built conditions 1–4 and pinned them, but wrapped as a premature `archive ready`
with this priority's own resolved tickets (0085, 0086) still open — a "fixed-but-unclosed" limbo. The
founder corrected this: a priority must close the tickets it completes, with no founder gate, and is not
archive-ready until it does. Closing then exposed a real close-path bug (defect 7), proving the close
lifecycle itself is in scope. Condition 5 and defects 7–8 were added; the priority was reopened. 0086 is
closed (commit b803b5d); 0085's close was attempted, hit defect 7, and was rolled back to a clean
committed state.

## Known defects to wrap (the evidence)

1. **Provenance vs binding conflated** — `create-ticket` had one overloaded `priority:` slot; a ticket
   created during a run auto-bound to that run's priority, with no standalone default and no binding
   note. → ticket **0086** (DONE run_138; ticket closed b803b5d).
2. **Independent-run support edits can't commit** — `cocoder oz commit-support <runId>` returned
   `404 unknown run` for runnerless/independent runs, so post-wrap support edits stranded. → ticket
   **0085** (code DONE run_138; ticket still OPEN — its close is blocked by defect 7).
3. **No governed create path while the daemon is live** — `cocoder oz create-ticket` refused
   (ADR-0041 anti-race) when the daemon was up with no surfaced alternative; the persona resorted to a
   raw `Write` + `git commit` (off-lane). (DONE run_138: the CLI now routes to the governed daemon endpoint.)
4. **Surfaces diverge with no reindex** — off-lane creation left tickets present as files but absent from
   `INDEX.md`; there was no governed "rebuild INDEX from files" reconcile. (DONE run_138.)
5. **Repoint can't repair a divergent ticket** — `reconcile-repoint` threw when a ticket was missing from
   `INDEX.md`. (DONE run_138: repoint/close now self-heal.)
6. **Archive leaves stale links** — archiving a priority did not reconcile its dependent tickets. (DONE
   run_138: archive now releases bound tickets to standalone.)
7. **Close is non-atomic and not robust to a missing `status` field** (NEW, found run_138). `closeTicket`
   sets status via a regex *replace* (`/^status:\s*.*$/m`) that silently no-ops when a ticket has no
   `status:` line. Tickets 0082–0085 were off-lane created WITHOUT a `status` field, so the replace
   does nothing, `status` stays absent, and the round-trip check `ticket.status !== 'Closed'` throws —
   AFTER the file has already been moved to `closed/` and `order.json` pruned, with `INDEX.md` not
   updated and nothing committed. Result: a 500 plus an uncommitted divergent half-close (the exact
   failure mode this priority exists to prevent). 0086 closed cleanly only because it had `status: Open`.
8. **Runs don't close the tickets they complete; `archive ready` isn't gated on it** (NEW, found run_138).
   The persona deferred closing resolved tickets to a founder confirmation, leaving 0085/0086 fixed-but-open
   and emitting a premature `archive ready`. There is no behavior that closes a priority's verifiably
   completed tickets at wrap, and no gate preventing `archive ready` while such tickets remain open.

## Scope

- Decide the binding/provenance model (0086) and make it the one owner. (DONE)
- Make ticket create + support-commit work through one governed path across daemon-live/down and
  daemon-managed/independent runs. (DONE)
- Add a governed reconcile that rebuilds the derived surfaces from the files; make
  `reconcile-repoint`/`reconcile-close` robust to pre-existing divergence. (DONE)
- Make priority archive reconcile its bound tickets. (DONE)
- **Harden the close path (defect 7):** make `closeTicket` insert `status: Closed` when the source has no
  `status` line; make close ATOMIC — validate/round-trip before any irreversible mutation (or fully roll
  back on failure) so a failed close can never leave a partial, uncommitted, divergent state; normalize
  0082–0085 to carry a `status` field. Defect-class: cover both the daemon `reconcile-close` lane and the
  CLI `close-ticket` lane.
- **Close-on-completion + archive gating (defect 8):** a run closes the tickets its priority verifiably
  completes through the governed close path at wrap (no founder-confirmation gate for a verified-complete
  close); gate `archive ready` so a priority with any of its own resolved tickets still open cannot be
  archive-ready; refine the close gate (0075) so it blocks only ambiguous/premature closes. This is an
  orchestration/persona/standards change — touch the wrap-up Play, oscar.md, and the close gate as one
  owner-mapped set, pinned by tests; do not create a parallel close contract.
- **Close this priority's own resolved tickets through the fixed path:** 0085 (defect 2, resolved) closed
  cleanly with a stamped resolution; confirm 0086 stays closed.

## Out of scope

- Tickets **0083** (retention enable affordance) and **0084** (Oscar–Deb repair-dialogue prose-JSON 500)
  are *subjects* surfaced during the incident, not ticketing-path defects; they stay standalone and open,
  owned separately. Their `status`-field normalization is in scope only as close-path data hygiene.
- The retention engine itself (archived `local-cache-retention`).

## Acceptance

- The five numbered objective conditions hold, each pinned by a test.
- `INDEX.md`, `order.json`, and the ticket files agree for every ticket; the divergence test stays green.
- A support edit in an independent run commits through a governed path with a receipt (no 404, no strand).
- Creating a ticket while the daemon is live succeeds through a governed path with no off-lane fallback.
- Archiving a priority leaves zero tickets linked to it.
- **Closing a ticket that has no `status` line lands atomically** (file in `closed/` with `status: Closed`
  and a stamped `## Resolution`, `order.json` pruned, `INDEX.md` row moved, committed); a test that forces
  a mid-close failure proves zero partial/divergent state is left behind — red before the fix, green after.
- **A run closes the tickets its priority verifiably completes** and cannot reach `archive ready` while any
  of its resolved tickets remain open — pinned by a test.
- This priority's own resolved tickets 0085 and 0086 are CLOSED with stamped resolutions; 0082–0084 are
  consistently indexed and standalone; none links to `local-cache-retention`.

## Disposition — reopened, NOT archive-ready (run_138, 2026-06-28)

Conditions 1–4 are built and test-pinned. The run wrapped prematurely as `archive ready` with resolved
tickets 0085/0086 still open; the founder correctly rejected that. Closing surfaced defect 7 (non-atomic,
status-less close) and defect 8 (no close-on-completion + no archive gating). 0086 is closed (b803b5d);
0085 is resolved but its close is blocked on defect 7 and was rolled back to a clean committed state. This
priority is NOT archive-ready. Relaunch it for the close-lifecycle work: fix defect 7 (atomic, status-less
close, defect-class across both close lanes), wire defect 8 (close-on-completion + archive gating + close-gate
refinement, owner-mapped across wrap-up Play / oscar.md / the gate), then close 0085 cleanly through the
fixed path and confirm 0086 stays closed. Each pinned by a test. Do not archive until 0085 is closed and the
close flow is atomic and green.
