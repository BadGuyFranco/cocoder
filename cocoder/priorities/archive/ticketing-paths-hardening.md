---
id: ticketing-paths-hardening
title: Ticketing paths hardening — make ticket create/commit/index/binding/reconcile/close consistent and governed
---

> **Archived 2026-06-28 (founder) — Archive-ready: ticket lifecycle is single-owner and self-consistent end to end; all five objective conditions hold, each test-pinned. Close path is atomic and status-less-robust (defect 7), proven live in run_281's fresh-HEAD daemon (bootSha 4e6a5de) which closed resolved ticket 0085 atomically; 0086 also closed; 0082-0084 standalone open; no ticket links to archived local-cache-retention; divergence suite green.** Founder confirmed archive after run_281 produced the fresh-process live close proof and closed the priority's own resolved tickets.

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

Run 139 / run_280 (2026-06-28) committed the close-path hardening and close-on-completion/archive-gate
work in atoms 0–3, but the proof step tried to close 0085 inside the same long-lived runner process that
had launched before atom 0 changed `packages/core/src/tickets/close.ts`. The process still had the old
`closeTicket` implementation loaded, so the verify `ticketClose` repeated defect 7's half-close shape:
0085 was moved out of `open/`, pruned from `order.json`, left in `INDEX.md` as Open, and written to
`closed/` without `status: Closed`. Deb restored that uncommitted partial close before teardown. The
remaining proof must run in a fresh runner/daemon process loaded from HEAD; do not use run_280's stale
in-memory runner as evidence that the close fix works or fails.

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
9. **A run cannot prove freshly changed runner/core machinery inside its own stale process** (NEW, found
   run_280). Atom 0 changed `closeTicket`, but run_280's already-running process used the pre-atom-0
   implementation when Oscar's verify verdict requested `ticketClose` for 0085. That invalidates the
   0085 proof from run_280 and creates a relaunch requirement: after machinery that owns the behavior is
   changed, the acceptance proof that exercises that machinery must happen in a fresh process loaded from
   the committed HEAD, or through an explicit reload boundary that is itself tested.

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
- **Rerun the live close proof in a fresh process:** run_280's committed atoms may stand, but its attempted
  0085 close is not valid evidence because the runner process used stale pre-atom-0 close code. Relaunch
  after teardown/reload and close 0085 through the governed path with the fixed `closeTicket` implementation
  loaded from HEAD.

## Out of scope

- Ticket **0083** (retention enable affordance) closed run_283; ticket **0084** (Oscar–Deb repair-dialogue prose-JSON 500)
  is a *subject* surfaced during the incident, not a ticketing-path defect; it stays standalone and open,
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
- **The live 0085 close proof is produced by a fresh runner/daemon process loaded from HEAD**, not by the
  stale run_280 process that existed before `closeTicket` was fixed.
- This priority's own resolved tickets 0085 and 0086 are CLOSED with stamped resolutions; 0082–0084 are
  consistently indexed and standalone; none links to `local-cache-retention`.

## Disposition — `archive-confirmation` (run_281, 2026-06-28)

All five objective conditions are built, test-pinned, and live-proven. Run_280 committed the close-lifecycle
fix; run_281 closed ticket **0085** through a fresh-HEAD daemon (not the stale run_280 process), verified
every ticket surface agrees, and added `node scripts/proof-ticket-close-atomic.mjs` as a founder-runnable
close atomicity harness. Tickets **0085** and **0086** are closed with stamped resolutions; **0082–0084**
remain open standalone; none link to archived `local-cache-retention`. Founder archive reply (`archive` or
`archive run_281` in Oz chat) is the first-class closeout action — do not relaunch for build work.
