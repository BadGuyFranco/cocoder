---
id: ticket-launchability
title: Ticket launchability signals
---

## Objective
Make the existing ticket `priority:` frontmatter reference a **trustworthy launchability signal** in the
workspace tickets panel, reusing that one field — **no duplicate field**. From `priority:` alone the panel
must distinguish three states for an open ticket:

- **Standalone (`priority: none`)** — a direct-launch target; clearly launchable on its own.
- **Handled by a live priority (`priority: <active-id>`)** — clearly marked **not** a direct-launch target;
  the priority owns the work, so launching the ticket directly would duplicate or bypass it.
- **Stale link (`priority: <archived-or-missing-id>`)** — the referenced priority is no longer in the active
  stack; surface it for **founder decision** (re-point, clear to `none`, or close), never silently treat it
  as launchable or as handled.

The signal must reflect *current* repo reality (a priority moving active → `archive/`/`backlog/`, or being
deleted, flips the ticket's state without editing the ticket), and it must be derived, not stored — adding no
second field and no write-back to the ticket file.

**Verified when:** in the workspace tickets panel, an open `priority: none` ticket renders as launchable; an
open ticket whose `priority:` names a current active priority renders as not-direct-launch (attributed to that
priority); and an open ticket whose `priority:` names an archived/backlog/missing id renders as a stale link
flagged for founder decision — each proven by a test that constructs the three cases and asserts the rendered
signal, plus the founder seeing the three states distinctly in the live panel.

**Boundary:** read-and-signal only over the existing `priority:` field — no new frontmatter field, no ticket
file rewrite, no change to ticket creation/closing spines, and no change to how priorities launch. The liveness
source of truth is the priority loader's view of active vs `archive/`/`backlog/` (one owner, reused — not a
re-implemented scan).

## First research gate (run this before any code; conclude or build, never hold)
Resolve the unknowns, then either proceed to the atoms below or conclude "not needed → archive" with reasons:

1. **Liveness owner.** Confirm the single source for "is `<id>` a current active priority" — `readPriorities`
   over `cocoder/priorities/*.md` vs `archive/`/`backlog/` placement (ADR-0038). Reuse it; do not add a second
   liveness scan.
2. **Field semantics.** Confirm `Ticket.priority` (`packages/core/src/tickets/loader.ts`) is the only place the
   reference lives, and that today's values include `none`, current active ids, and already-stale ids
   (archived/missing) — so the three states are real, not hypothetical.
3. **Panel owner.** Locate the workspace tickets panel render path and where, if anywhere, launch is offered
   per ticket; decide whether the signal is computed in core (derived, testable) and consumed by the panel.

## Implementation atoms (ordered for systematic build; revise per the gate's findings)
- **Atom 0 — derive the signal in core.** Add one pure derivation (ticket + active-priority set →
  `launchable` | `handled-by:<id>` | `stale:<id>`), owned in core alongside the ticket loader, with unit tests
  over the three cases and the active→archive flip.
- **Atom 1 — surface it in the tickets panel.** Consume the derived signal in the workspace tickets panel:
  launchable affordance for standalone, a not-direct-launch marker attributing the live priority, and a
  founder-decision flag for stale links. No new ticket field; no write-back.
- **Atom 2 — prove and reconcile.** Tests for both core derivation and panel rendering; report the current
  stale references the signal now surfaces so the founder can decide each.
