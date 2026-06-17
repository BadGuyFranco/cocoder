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
before; Tickets lists open tickets incl. real ones (e.g. `0003`/`0005`/`0007`) with a readable detail; Runs shows the
same history the button did); AND one real open ticket is fixed end-to-end via a launched run whose
result is committed and whose ticket is moved to `closed/` with `INDEX.md` updated — traceable to the
actual change. **Boundary:** does not change the ticket *governance model* (ADR-0003 flat files +
`INDEX.md` stay the source of truth) and introduces no new commit lane (the fix run commits via the
existing spine); UI work is confined to the dashboard panel + ticket read/launch surface.

## Design decisions — RATIFIED at the priority-start alignment beat (founder, 2026-06-17)
The founder ratified the Objective and the four deferred design questions. These are now fixed inputs
to decomposition — do not re-open without a new founder decision.

1. **Run shape to fix a ticket — small Oscar↔Bob run for code-touching tickets** (Oscar scopes the
   ticket as an atom or two, verifies, gates the commit, closes the ticket) — keeps the no-human-backstop
   verify gate. **Lighter path (Bob-only, or ad-hoc lane) for trivial doc/task tickets**, selected by
   ticket `type`.
2. **Launch surface — reuse, do not fork.** A ticket target reuses the **generalized run-target
   plumbing** from `new-primary-root`'s Addendum Atom 2 (run-target + daemon launch surface). This
   priority **sequences after** that atom lands (or folds a shared `target = ticket | priority | playbook`
   abstraction into it) — it must **not** add a parallel ticket-launch lane (single source of truth,
   global #7). `RunInput` is hard-typed to `priority: Priority` today; that is the generalization both
   priorities depend on.
3. **Ticket-close mechanics through the spine.** The fix run itself performs the `open/ → closed/` move
   + `INDEX.md` edit + resolution line **inside its write-scope**, committed by the ADR-0023 spine — not
   a separate manual step.
4. **Tabs scope — in-panel content cycling** (not routes/windows). Priorities stays byte-for-byte as-is;
   the Runs tab fully **replaces** the run-history *button* (button removed, not duplicated). The
   panel-header **"+ / add" button is contextual per tab**: Priorities → *add a priority* (existing
   `onAddPriority`); Tickets → *add a ticket* (new); Runs → **no add button**.

## Conflict-scan (light — first pass; re-verify at start)
- **Dashboard is live** (`packages/ui/app/sections/dashboard/Dashboard.tsx` — Run History is currently a
  Modal opened by a button; the Priorities/Run-History pseudo-tabs match the founder's description). No
  ADR forbids the tab refactor; confirm current dashboard state at start (an older note referenced an
  "Oz dashboard archived" event — verify what that referred to before touching UI).
- **No existing tickets/dashboard priority** collides; `tickets-review` is net-new.
- **Run-target coupling:** question 2 above overlaps the `new-primary-root` executor's launch-surface
  work (run currently targets `priorityId`); coordinate so the ticket-launch path reuses rather than
  forks that plumbing.
- Objective **RATIFIED** by the founder 2026-06-17 (ADR-0010 go-ahead given); design questions resolved
  above. Ready to decompose on the next launch.
- **Stale-data found at start (re-verified):** the Objective originally named ticket `0009` as a proof
  example, but `0009` is already **closed** (2026-06-17) — proof ticket will be one of the real open
  tickets (`0003`/`0005`/`0007`). The ticket **index is inconsistent**: `0005` exists in `open/` but is
  missing from `INDEX.md`'s Open table, and ID `0007` is **duplicated** (one open
  `design-ref-rebuild-clobber-guard`, one closed `post-wrap-orchestration-commit-gap`). Reconcile this
  as the **first build atom** (it's a prerequisite for the Tickets tab to render correct data).

## Recommended decomposition (post-ratification)
1. **Ticket-index hygiene** (`cocoder/tickets/**`): add `0005` to `INDEX.md` Open table; resolve the
   duplicate `0007` ID. Prereq for clean Tickets-tab data.
2. **Tabs refactor** (read-only, `packages/ui/**`): Priorities/Tickets/Runs in-panel tabs; Runs replaces
   the history button+modal; contextual add button per tab (decision 4). Priorities unchanged.
3. **Ticket-fix launch** — **gated on `new-primary-root` Addendum Atom 2** (decision 2). Reuses the
   generalized run-target; from the Tickets tab, launches a fix run that closes the ticket via the spine.
