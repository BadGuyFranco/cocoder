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
before; Tickets lists open tickets incl. real ones (e.g. `0003`/`0005`/`0012`) with a readable detail; Runs shows the
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
   **Refined (founder, 2026-06-17 live review):** the per-tab add uses a **modal dialog for BOTH** tabs
   (founder enters the details), and the item is **actually created by Oz** via a daemon create endpoint —
   **not** a chat-prefill. Priorities already does this (`NewPriorityModal` → `createPriority` POST →
   daemon writes the file, `routes.ts:485`). Tickets must get the parallel: a `NewTicketModal` + a
   create-ticket endpoint that writes `cocoder/tickets/open/NNNN-slug.md` + updates `INDEX.md` via the
   spine. The run_121 chat-prefill stub for add-ticket is **superseded** by this.

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
  tickets (`0003`/`0005`/`0012`). The ticket **index was inconsistent**: `0005` existed in `open/` but was
  missing from `INDEX.md`'s Open table, and the active design-ref ticket conflicted with closed
  `post-wrap-orchestration-commit-gap`. Reconciled by run_121 atom 0 as the **first build atom**.

## Live-review bugs (founder, 2026-06-17 — run_122)

The run_121 tabs passed automated tests but the founder found three defects in the running build. **Bugs
1 and 3 are code-complete (run_122); Bug 2 is infra — the live daemon predates the tickets routes.**

1. ✅ **FIXED (`0266172`, run_122) — Double header above the tabs.** Removed the icon/title/count row;
   promoted the tab strip to be the panel header (larger tabs); kept the contextual per-tab add button.
2. ⚠️ **INFRA — Tickets count shows 0 in the live build** despite real open tickets (`0003/0005/0012`).
   The data layer is unit-test-green; the running daemon predates `GET /workspaces/:id/tickets` (run_121)
   and `POST /workspaces/:id/tickets` (run_122). **`scripts/oz.sh restart`** (founder action — Oscar does
   not restart the daemon) activates both routes; until then the count stays 0 and Add-ticket errors at
   the bridge — expected, not a code defect. **Follow-on:** extend ticket 0010's finalization auto-rebuild
   to `packages/daemon/**` so daemon-touching runs do not require manual restart.
3. ✅ **FIXED (`bdddf29` + `efb9714`, run_122) — Add-ticket modal + create endpoint.** `NewTicketModal`
   (title/type/priority/description) + `handleCreateTicket`; `POST /workspaces/:id/tickets` allocates
   next NNNN, writes `cocoder/tickets/open/NNNN-slug.md`, updates `INDEX.md` via the ADR-0023 spine
   (mirrors `createPriority`). Defaults: type `bug|task|question|spike` (default `task`); priority default
   `none`; owner `founder-session`; created = today. Replaced the run_121 chat-prefill stub.

## Decomposition — status (run_122, 2026-06-17)

**Disposition:** `continue` — Deliverable 1 (three dashboard tabs + live-review fixes) is code-complete;
   founder **`scripts/oz.sh restart`** still needed to prove Bug 2 live. Deliverable 2 (atom 4,
   ticket-fix launch) remains **gated** on `new-primary-root` Addendum Atom 2 (run-target generalization).
   Not archive-ready until one open ticket is fixed end-to-end via a launched run whose close lands on
   trunk.

1. ✅ **DONE (`6aa5f60`) — Ticket-index hygiene** (`cocoder/tickets/**`): `0005` added to `INDEX.md` Open
   table; duplicate ID `0007` resolved by renumbering the active design-ref ticket `0007 → 0012` (closed
   historical `0007` left intact). Open tickets now `0003 / 0005 / 0012`.
2. ✅ **DONE — Tickets data layer** (`5da8926`, `packages/core` + `packages/daemon` + `packages/ui`) and
   the **Tabs refactor** (`70940a1`, `packages/ui/**`): core `readTickets` → daemon
   `GET /workspaces/:id/tickets` → UI adapter/fixture, then the in-panel **Priorities/Tickets/Runs** tabs
   (Runs replaced the history button **and** modal; contextual add per tab; Priorities byte-for-byte
   unchanged). **The original "tabs refactor" was split into a data-layer atom + a UI atom** because
   listing real tickets required new read plumbing (no ticket reader/type/endpoint existed). Deliverable 1
   (three working tabs) complete + verified.
3. ✅ **DONE (run_122) — Live-review fixes (bugs 1 + 3; Bug 2 = founder daemon restart).**
   - **`0266172` — Bug 1:** tab strip promoted to panel header; dashboard test assertions updated.
   - **`bdddf29` — Bug 3 backend:** `POST /workspaces/:id/tickets` + electron IPC + `createTicket` client.
   - **`efb9714` — Bug 3 UI:** `NewTicketModal` + `handleCreateTicket`; chat-prefill stub removed.
   - **Bug 2 (count=0):** not a buildable atom — stale daemon; founder `scripts/oz.sh restart`.
4. ⛔ **GATED — Ticket-fix launch (Deliverable 2, atom 4)** — **on `new-primary-root` Addendum Atom 2**
   (decision 2). Verified run_121/run_122: `RunInput`/`buildRunInput`/`launchRun` are still hard-typed to
   `priorityId`; no `target = ticket | priority | playbook` abstraction exists. From the Tickets tab,
   launches a fix run that closes the ticket via the spine — but must **reuse** the generalized run-target,
   not fork. Relaunch `tickets-review` for this atom only after `new-primary-root` Addendum Atom 2 lands;
   proof ticket = one of `0003 / 0005 / 0012`.
