---
id: tickets-review
title: "Tickets review — browse and fix tickets from the dashboard"
---

## Objective
A founder can **review and fix tickets** from the CoCoder dashboard. Two deliverables: (1) the dashboard
panel that today shows **Priorities** and **Run History** as pseudo-tabs becomes **real tabs** —
**Priorities** (unchanged), a new **Tickets** tab (lists the workspace's tickets from `cocoder/tickets/`
with status/type and a detail view), and a **Runs** tab (the run history, replacing the current
runs *button*) — selecting a tab cycles the panel content in place; and (2) a way to act on a ticket:
from the Tickets tab the founder can launch a **ticket-fix run** that proposes/applies the fix and, on
success, **closes the ticket** (moves it `open/ → closed/`, updates `INDEX.md`) through the ADR-0023
commit spine. **Verified when:** the dashboard renders the three working tabs (Priorities behaves as
before; Tickets lists open tickets incl. real ones like `0009` with a readable detail; Runs shows the
same history the button did); AND one real open ticket is fixed end-to-end via a launched run whose
result is committed and whose ticket is moved to `closed/` with `INDEX.md` updated — traceable to the
actual change. **Boundary:** does not change the ticket *governance model* (ADR-0003 flat files +
`INDEX.md` stay the source of truth) and introduces no new commit lane (the fix run commits via the
existing spine); UI work is confined to the dashboard panel + ticket read/launch surface.

## Open design questions — resolve at the priority-start alignment beat (founder-owned)
The founder explicitly deferred the "how do we *fix* a ticket" design to priority start. Resolve these
before decomposing:

1. **What run shape fixes a ticket?** A ticket is smaller than a normal priority/Objective, so it does
   not fit the priority-per-Objective model cleanly. Options to weigh: (a) a **Bob-only** lightweight
   run (one builder atom: read ticket → implement → verify → commit → close) — cheapest, but no
   orchestrator quality gate; (b) a **small Oscar↔Bob run** (Oscar scopes the ticket as an atom or two,
   verifies, gates the commit, closes the ticket) — keeps the no-human-backstop gate, more ceremony;
   (c) reuse the existing **ad-hoc session** lane (`priorities/adhoc-session.md`) seeded with the ticket
   body. Recommendation to bring to the beat: lean (b) for code-touching bug tickets (the verify gate
   matters with no human backstop), (a)/(c) for trivial doc/task tickets — possibly chosen by ticket
   `type`.
2. **Does launching a ticket-fix reuse the run launch surface or need its own?** This intersects the
   run-target work (a run currently targets a `priorityId`); a ticket target may need the same
   plumbing the onboarding-Playbook launch surface will add — check for reuse, don't duplicate.
3. **Ticket-close mechanics through the spine:** confirm the `open/ → closed/` move + `INDEX.md` edit
   is performed by the run (in its write-scope) and committed by the spine, with the resolution line
   filled — not a separate manual step.
4. **Tabs scope:** confirm "real tabs" means in-panel content cycling (not routes/windows), Priorities
   stays byte-for-byte as-is, and the Runs tab fully replaces the run-history *button* (button removed,
   not duplicated).

## Conflict-scan (light — first pass; re-verify at start)
- **Dashboard is live** (`packages/ui/app/sections/dashboard/Dashboard.tsx` — Run History is currently a
  Modal opened by a button; the Priorities/Run-History pseudo-tabs match the founder's description). No
  ADR forbids the tab refactor; confirm current dashboard state at start (an older note referenced an
  "Oz dashboard archived" event — verify what that referred to before touching UI).
- **No existing tickets/dashboard priority** collides; `tickets-review` is net-new.
- **Run-target coupling:** question 2 above overlaps the `new-primary-root` executor's launch-surface
  work (run currently targets `priorityId`); coordinate so the ticket-launch path reuses rather than
  forks that plumbing.
- This Objective is a **DRAFT** pending the founder's go-ahead at the priority-start alignment beat
  (ADR-0010 — the founder owns the Objective; nothing launches/decomposes until ratified).
